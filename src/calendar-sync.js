'use strict';
// Calendar sync: reading calendar feeds (ICS links, Google and iCloud), the ICS parser and repeat rules, the feed sync loop, and pushing local events out to iCloud (CalDAV) and Google. One module because these parts call each other throughout.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/unit/parse-ics, recurrence-count, build-event-ics, google/icloud pull, boot-sync-delay tests and test/api feed / pull / event tests.
module.exports = function registerCalendarSync({ URL, fetchWithTimeout, IS_DEMO, db, broadcastUpdate, getTimezoneOverride, getSetting, isSlave, httpsRequest, setSetting }) {

  // Real, confirmed bug (contact-form inquiry #6, 2026-09-12): a household on
  // a network with broken/partial outbound IPv6 (common — many home ISPs/
  // routers are like this) got "Host Unreachable" trying to sync a calendar
  // feed, worked around it by editing the feed URL into SQLite directly. Two
  // gaps, same shape as fixes already applied elsewhere in this file:
  //  - No `family: 4`. Without it, Node can resolve an IPv6 address for the
  //    calendar host and fail outright (ENETUNREACH/EHOSTUNREACH) on a broken
  //    IPv6 path — unlike a browser, Node doesn't "happy eyeballs" fall back
  //    to IPv4 on its own. Already fixed for Gmail SMTP in
  //    buildMailTransporter(); never applied here, despite this being the
  //    single most-used outbound call in the app.
  //  - No request timeout. A connection that stalls (not outright fails) hung
  //    forever with no error — the same bug class already fixed in
  //    httpGetJSON()/getWeather() this session, missed here.
  // PIAZZA_FETCH_TIMEOUT_MS overrides the default (tests only — lets a test
  // exercise a genuine timeout in milliseconds instead of waiting out the real
  // 20s default; unset in prod).
  async function fetchUrl(urlStr, timeoutMs = Number(process.env.PIAZZA_FETCH_TIMEOUT_MS) || 20000) {
    // Redirects and gzip/deflate/br decompression are both handled by fetch()
    // itself now — no manual redirect-following or zlib step needed the way
    // the old http.get()-based version required (iCloud in particular always
    // gzips its .ics feeds).
    const res = await fetchWithTimeout(urlStr, {
      headers: {
        'User-Agent': 'PiazzaHQ/1.0',
        // Some calendar hosts (e.g. iCloud) serve different/empty content to
        // requests that don't look like they're asking for calendar data —
        // an explicit Accept header makes this request look more like what a
        // real calendar client sends.
        'Accept': 'text/calendar, text/plain, */*',
      },
      timeoutMs,
      timeoutMessage: `Timed out after ${timeoutMs}ms fetching ${urlStr}`,
    });
    let body;
    try { body = await res.text(); }
    catch (e) { throw new Error(`Failed to read calendar response: ${e.message}`); }
    // Treat non-2xx as a real failure instead of silently parsing whatever
    // error page/body came back as "0 events found".
    if (!res.ok) {
      throw new Error(`Calendar server returned HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }
    return body;
  }

  function parseICS(icsText, feedId, feedColor, timeZone) {
    const events = [];
    // Resolve the timezone once for the whole feed (used to localize UTC times).
    const tz = timeZone || getLocalTimezone();
    // Unfold lines (RFC 5545: lines ending in \r\n + space/tab are continuations)
    const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n');
    const lines = unfolded.split('\n');

    let inEvent = false, current = {};
    for (const raw of lines) {
      const line = raw.trim();
      if (line === 'BEGIN:VEVENT') { inEvent = true; current = { exdates: [] }; continue; }
      if (line === 'END:VEVENT') {
        inEvent = false;
        // Keep any VEVENT that has the essentials. Overrides (with a recurrenceId)
        // and cancellations are sorted out in the reconciliation step below.
        // Skip events this device pushed OUT itself (see the push section): if
        // the household also subscribes to the same iCloud/Google calendar as a
        // feed, its own pushed events would otherwise come back in as duplicate
        // 'ical:' rows alongside the original 'local:' ones. Both UID forms are
        // self-identifying — piazzahq-local-<id>@piazzahq.local for CalDAV, and
        // phqlocal<id>@google.com for events created with our deterministic id
        // through Google's API.
        if (current.uid && current.title && current.date
            && !/^piazzahq-local-\d+@piazzahq\.local$/.test(current.uid)
            && !/^phqlocal\d+@google\.com$/i.test(current.uid)) {
          events.push(current);
        }
        continue;
      }
      if (!inEvent) continue;

      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key   = line.slice(0, colon).toUpperCase();
      const value = line.slice(colon + 1).trim();

      // UID
      if (key === 'UID') current.uid = value;

      // Summary (title) — may have params like SUMMARY;LANGUAGE=en:Title
      if (key.startsWith('SUMMARY')) current.title = decodeICSText(value);

      // Description
      if (key.startsWith('DESCRIPTION')) current.notes = decodeICSText(value).slice(0, 500);

      // Location (venue / address) — may carry params like LOCATION;LANGUAGE=en:...
      if (key.startsWith('LOCATION')) current.location = decodeICSText(value).slice(0, 300);

      // DTSTART — handles date-only (VALUE=DATE) and datetime
      if (key.startsWith('DTSTART')) {
        const parsed = parseICSDate(key, value, tz);
        if (parsed) { current.date = parsed.date; current.start_time = parsed.time; }
      }
      if (key.startsWith('DTEND')) {
        const parsed = parseICSDate(key, value, tz);
        if (parsed) {
          current.end_time = parsed.time;
          // RFC 5545: for all-day (VALUE=DATE) events, DTEND is exclusive —
          // a 3-day event Mon-Wed has DTEND of Thursday. Subtract a day so our
          // stored end_date reflects the actual last day the event occurs.
          if (!parsed.time) {
            const d = new Date(parsed.date + 'T00:00:00');
            d.setDate(d.getDate() - 1);
            current.end_date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          } else {
            current.end_date = parsed.date;
          }
        }
      }

      // RRULE — recurrence pattern, e.g. "FREQ=YEARLY" or "FREQ=WEEKLY;BYDAY=MO,WE,FR"
      if (key === 'RRULE') current.rrule = value;

      // RECURRENCE-ID — marks this VEVENT as an override of a SINGLE occurrence of a
      // recurring series (same UID). Its value is the ORIGINAL date/time of the
      // occurrence being replaced. Captured here; reconciled after parsing so the
      // original instance is suppressed and this modified one shown in its place.
      if (key.startsWith('RECURRENCE-ID')) {
        const parsed = parseICSDate(key, value, tz);
        if (parsed) current.recurrenceId = parsed.date;
      }

      // STATUS — CANCELLED means this (occurrence or event) should not be shown.
      if (key === 'STATUS') current.status = value.toUpperCase();

      // EXDATE — one or more cancelled occurrence dates. Can appear as multiple EXDATE
      // lines, and/or as a comma-separated list within a single line.
      if (key.startsWith('EXDATE')) {
        for (const part of value.split(',')) {
          const parsed = parseICSDate(key, part.trim(), tz);
          if (parsed) current.exdates.push(parsed.date);
        }
      }
    }
    return reconcileRecurrenceOverrides(events);
  }

  // Reconciles per-occurrence overrides (RECURRENCE-ID) against their master series.
  // Calendar providers express "this one instance moved/changed/was cancelled" as a
  // SEPARATE VEVENT sharing the series UID, with a RECURRENCE-ID naming the original
  // occurrence. Without handling these you get duplicates (the original instance AND
  // the override) or ghosts (a cancelled instance still showing).
  //
  // For each override we:
  //   • add the original occurrence date to the master's EXDATEs, so expansion skips it
  //   • if the override is CANCELLED, drop it entirely (occurrence simply removed)
  //   • otherwise keep it as a standalone one-off at its new date/time
  function reconcileRecurrenceOverrides(events) {
    // Index masters (recurring, no recurrenceId) by UID. A UID could in theory have
    // a non-recurring master too; we only need the recurring ones for suppression.
    const mastersByUid = new Map();
    for (const e of events) {
      if (!e.recurrenceId && e.rrule) mastersByUid.set(e.uid, e);
    }

    const result = [];
    for (const e of events) {
      // Drop any event/occurrence explicitly cancelled.
      if (e.status === 'CANCELLED') {
        // If it's a cancelled override, still suppress the original instance below.
        if (e.recurrenceId) {
          const master = mastersByUid.get(e.uid);
          if (master) master.exdates.push(e.recurrenceId);
        }
        continue;
      }

      if (e.recurrenceId) {
        // A modified single occurrence: suppress the original in the master series,
        // then keep this override as a standalone event at its new slot.
        const master = mastersByUid.get(e.uid);
        if (master) master.exdates.push(e.recurrenceId);
        // Strip recurrence fields so it's treated as a one-off (it has no RRULE anyway).
        const oneOff = { ...e };
        delete oneOff.rrule;
        result.push(oneOff);
        continue;
      }

      result.push(e);
    }
    return result;
  }

  // The display's configured IANA timezone (e.g. "America/Chicago"). Calendar times
  // marked UTC (trailing Z) are converted into this zone so they land on the right
  // day and clock time. Shares the same 'timezone_override' setting as appNow()
  // (Settings tab -> Timezone) rather than a separate key, so one control governs
  // both "what day is it" logic and calendar-feed UTC conversion. Falls back to
  // the Pi's system zone, then Chicago, if the override is unset.
  function getLocalTimezone() {
    const override = getTimezoneOverride();
    if (override) return override;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; }
    catch { return 'America/Chicago'; }
  }

  // Converts a UTC instant to {date:'YYYY-MM-DD', time:'HH:MM'} in the given IANA zone.
  function utcToLocalParts(utcDate, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = {};
    for (const p of fmt.formatToParts(utcDate)) parts[p.type] = p.value;
    let hour = parts.hour === '24' ? '00' : parts.hour; // some engines emit 24 for midnight
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
  }

  function parseICSDate(key, value, timeZone) {
    // All-day: DTSTART;VALUE=DATE:20240315 — no time, no zone conversion (it's a
    // floating calendar date by definition).
    if (key.includes('VALUE=DATE') || /^\d{8}$/.test(value)) {
      const d = value.replace(/\D/g, '').slice(0, 8);
      return { date: `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`, time: null };
    }
    // DateTime: 20240315T093000Z (UTC) or 20240315T093000 (local/floating)
    const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (m) {
      const [, yy, mo, dd, hh, mi, , z] = m;
      // UTC (trailing Z): convert to the configured local zone so the day/time are
      // correct. Without this, e.g. a 03:00Z meeting showed a day late at 3am.
      if (z && timeZone) {
        const utc = new Date(Date.UTC(+yy, +mo - 1, +dd, +hh, +mi, 0));
        return utcToLocalParts(utc, timeZone);
      }
      // No Z: a "floating"/local time — take it as written (this is what the spec
      // intends for local-time values, and matches how most personal events read).
      return { date: `${yy}-${mo}-${dd}`, time: `${hh}:${mi}` };
    }
    return null;
  }

  function decodeICSText(s) {
    return s.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  }

  // ── Recurring event expansion (RRULE) ─────────────────────────────────────────
  // Supported: FREQ (DAILY/WEEKLY/MONTHLY/YEARLY), INTERVAL, COUNT, UNTIL,
  // BYDAY (plain like "MO,WE,FR" and ordinal like "2MO"/"-1FR"), BYMONTH,
  // BYMONTHDAY, BYSETPOS (e.g. "BYDAY=MO;BYSETPOS=3" = 3rd Monday — the form
  // Outlook/Exchange and many corporate calendars emit), and EXDATE exclusions.
  //
  // Known limitations (rare in personal/family calendars, but worth knowing):
  //   • BYWEEKNO / BYYEARDAY / BYHOUR / sub-daily FREQ (HOURLY/MINUTELY/SECONDLY)
  //     aren't expanded — these essentially never appear on a wall calendar.
  //   • INTERVAL for weekly is approximated by week parity from the start date
  //     (no explicit WKST handling).
  //   • VTIMEZONE blocks with named TZID offsets aren't parsed; UTC ("Z") times ARE
  //     converted to the configured local zone, and floating local times are taken
  //     as written. A TZID-with-custom-offset time is treated as floating (shown as
  //     written), which is correct for same-zone calendars and off only if a feed
  //     specifies a zone different from the display's.
  //
  // Handled: per-occurrence overrides (RECURRENCE-ID — moved/edited/cancelled single
  // instances) and STATUS:CANCELLED, reconciled against their master series.
  //
  // Occurrences are bounded to a window around "now" (rather than expanding a
  // "forever" yearly birthday out to infinity) so storage and sync time stay bounded.
  const RECURRENCE_WINDOW_PAST_DAYS   = 366;       // ~1 year back, covers "this already happened" lookups
  const RECURRENCE_WINDOW_FUTURE_DAYS = 366 * 2;    // ~2 years ahead, plenty for a wall calendar

  const WEEKDAY_CODES = ['SU','MO','TU','WE','TH','FR','SA'];

  function parseRRule(rruleStr) {
    const parts = {};
    for (const pair of rruleStr.split(';')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) parts[k.toUpperCase()] = v;
    }
    return {
      freq: parts.FREQ,
      interval: parseInt(parts.INTERVAL) || 1,
      count: parts.COUNT ? parseInt(parts.COUNT) : null,
      until: parts.UNTIL ? parseICSDate('UNTIL', parts.UNTIL, getLocalTimezone())?.date : null,
      byday: parts.BYDAY ? parts.BYDAY.split(',') : null,       // e.g. ["MO","WE"] or ["1MO","-1FR"]
      bymonthday: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : null,
      bymonth: parts.BYMONTH ? parts.BYMONTH.split(',').map(Number) : null,  // e.g. [11] for November — restricts which months occurrences land in
      bysetpos: parts.BYSETPOS ? parts.BYSETPOS.split(',').map(Number) : null,  // e.g. [3] = the 3rd match within each period; [-1] = the last. Outlook/Exchange emit "BYDAY=MO;BYSETPOS=3" for "3rd Monday".
    };
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function addMonths(dateStr, n) {
    const [y, m, day] = dateStr.split('-').map(Number);
    const totalMonths = (y * 12 + (m - 1)) + n;
    const targetYear  = Math.floor(totalMonths / 12);
    const targetMonth = totalMonths % 12; // 0-indexed
    const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const targetDay = Math.min(day, lastDayOfTargetMonth);
    return `${targetYear}-${String(targetMonth+1).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
  }
  function addYears(dateStr, n) {
    const [y, m, day] = dateStr.split('-').map(Number);
    const targetYear = y + n;
    const lastDayOfTargetMonth = new Date(targetYear, m, 0).getDate(); // m is already 1-indexed here, so month=m gives day-0 of month m = last day of month m
    const targetDay = Math.min(day, lastDayOfTargetMonth);
    return `${targetYear}-${String(m).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
  }

  // Expands a single recurring VEVENT into a list of { date, end_date } occurrences
  // within the sync window. `base` is the parsed event (has .date, .end_date, .rrule, .exdates).
  function expandRecurrence(base) {
    const rule = parseRRule(base.rrule);
    if (!rule.freq) return [{ date: base.date, end_date: base.end_date }]; // malformed RRULE — treat as one-off

    const today = new Date();
    const windowStart = addDays(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`, -RECURRENCE_WINDOW_PAST_DAYS);
    const windowEnd   = addDays(`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`, RECURRENCE_WINDOW_FUTURE_DAYS);
    const hardStop    = rule.until && rule.until < windowEnd ? rule.until : windowEnd;
    const exdateSet   = new Set(base.exdates || []);

    // Span length (in days) stays constant across all occurrences for multi-day events
    const spanDays = base.end_date
      ? Math.round((new Date(base.end_date+'T00:00:00') - new Date(base.date+'T00:00:00')) / 86400000)
      : 0;

    const occurrences = [];
    // COUNT: the calendar standard counts EVERY occurrence of the series from its first date, including ones that were cancelled
    // (EXDATE), moved to another day (an edited occurrence is stored as its own event and its original date lands in exdates), or that
    // fall before the look-back window. Only afterwards are they filtered down to what is shown. So `count` below goes up for every
    // occurrence generated, and `emit()` decides whether this one is shown. A series with a COUNT is therefore always walked from its
    // real start, never from the window start (or the count would begin partway through the series).
    let count = 0;
    const emit = (d) => {
      if (d >= windowStart && !exdateSet.has(d)) occurrences.push({ date: d, end_date: spanDays ? addDays(d, spanDays) : null });
    };
    const MAX_ITER = 3000; // safety valve against pathological/infinite-loop RRULEs
    let iter = 0;

    if (rule.freq === 'YEARLY' && !rule.byday) {
      let i = 0;
      while (iter++ < MAX_ITER) {
        const d = addYears(base.date, i * rule.interval); // always offset from the ORIGINAL date, not the previous occurrence — avoids clamp-drift (e.g. Feb 29 -> Feb 28 sticking permanently)
        if (d > hardStop) break;
        count++;
        emit(d);
        if (rule.count && count >= rule.count) break;
        i++;
      }
    } else if (rule.freq === 'MONTHLY' && !rule.byday) {
      let i = 0;
      while (iter++ < MAX_ITER) {
        const d = addMonths(base.date, i * rule.interval); // same fix as above, for monthly (e.g. Jan 31 -> Feb 28 -> back to Mar 31, not stuck at 28)
        if (d > hardStop) break;
        count++;
        emit(d);
        if (rule.count && count >= rule.count) break;
        i++;
      }
    } else if (rule.freq === 'WEEKLY' || (rule.freq === 'MONTHLY' && rule.byday) || (rule.freq === 'YEARLY' && rule.byday)) {
      // BYDAY-based patterns ("every Mon/Wed/Fri", "2nd Tuesday of the month", etc.)
      // Walk day-by-day through the window and test each candidate date against the rule —
      // simpler and more robust than computing offsets directly, at the cost of more iterations.
      // A WEEKLY rule with NO BYDAY (common from iCloud/Apple for simple weekly events)
      // implies "the same weekday as DTSTART". Without this, targetWeekdays was empty and
      // NOTHING matched — silently dropping the entire series.
      let effectiveByday = rule.byday;
      if (!effectiveByday && rule.freq === 'WEEKLY') {
        effectiveByday = [WEEKDAY_CODES[new Date(base.date + 'T00:00:00').getDay()]];
      }
      const targetWeekdays = (effectiveByday || []).map(code => {
        const m = code.match(/^(-?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
        return m ? { ord: m[1] ? parseInt(m[1]) : null, day: WEEKDAY_CODES.indexOf(m[2]) } : null;
      }).filter(Boolean);

      const scanEnd = hardStop < windowEnd ? hardStop : windowEnd;

      // BYSETPOS (e.g. "BYDAY=MO;BYSETPOS=3" = 3rd Monday) selects the Nth matching
      // day within each period rather than every match. We collect the raw weekday
      // matches first, then — if BYSETPOS is set — keep only the chosen position(s)
      // within each month. This is the format Outlook/Exchange use, and without it
      // "3rd Monday" was expanding to EVERY Monday.
      const useSetPos = rule.bysetpos && (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY');
      const candidatesByPeriod = {}; // 'YYYY-MM' -> [dateStr, ...] in chronological order

      // Where the day-by-day scan starts. A COUNT series is walked from its real start. Otherwise from the window start, when the series
      // began earlier. With BYSETPOS the scan must begin on the 1st of that month: "the 3rd Monday" is the 3rd of the WHOLE month, so a
      // scan that began mid-month (at the series start, or the window start) would number the days from the wrong place.
      let d = (base.date < windowStart && !rule.count) ? windowStart : base.date;
      if (useSetPos) d = d.slice(0, 8) + '01';

      while (d <= scanEnd && iter++ < MAX_ITER * 5) {
        const dd = new Date(d + 'T00:00:00');
        const weekday = dd.getDay();

        // BYMONTH restriction (e.g. Thanksgiving = FREQ=YEARLY;BYMONTH=11;BYDAY=4TH):
        // only months in the list are eligible. Without this, "4th Thursday" matched
        // in every month, producing ~12x too many (wrong) occurrences.
        const monthOk = !rule.bymonth || rule.bymonth.includes(dd.getMonth() + 1);

        const matchesDay = monthOk && targetWeekdays.some(t => {
          if (t.day !== weekday) return false;
          if (t.ord === null) return true; // no ordinal = every occurrence of this weekday
          // Ordinal (e.g. "2TU" = 2nd Tuesday, "-1FR" = last Friday of the month) only
          // applies for MONTHLY/YEARLY; figure out which occurrence-of-the-month this is.
          const dayOfMonth = dd.getDate();
          const occurrenceInMonth = Math.ceil(dayOfMonth / 7); // 1st, 2nd, 3rd... occurrence of this weekday in the month
          if (t.ord > 0) return occurrenceInMonth === t.ord;
          // Negative ordinal: count from the end of the month instead
          const lastDayOfMonth = new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate();
          const occurrencesRemainingInMonth = Math.ceil((lastDayOfMonth - dayOfMonth + 1) / 7);
          return occurrencesRemainingInMonth === Math.abs(t.ord);
        });

        // INTERVAL for WEEKLY is approximated by week-count parity from the start date;
        // good enough for the "every other week" case without full WKST handling.
        // Real bug found here: subtracting two LOCAL-time Date objects (`dd` and a
        // fresh `new Date(base.date+'T00:00:00')`) loses or gains an hour across any
        // DST transition the span crosses, so the millisecond difference isn't a
        // clean multiple of a day — e.g. Jan 5 to Mar 9, 2026 (crossing the Mar 8
        // spring-forward) comes out to 62.958 days instead of exactly 63, and
        // Math.floor() of that turns an ODD week into an even one, matching a week
        // an every-2-weeks rule should have skipped. Confirmed live: an
        // INTERVAL=2;BYDAY=MO rule starting 2026-01-05 produced an extra occurrence
        // on 2026-03-09, one week early. Fixed the same way this file's own
        // isoWeekStr()/getKidStreak() already do date-only math elsewhere: build
        // both endpoints with Date.UTC() from their calendar Y/M/D instead of
        // parsing a local-time string — UTC has no DST, so the day count is exact
        // regardless of what the span crosses.
        const [baseY, baseM, baseD] = base.date.split('-').map(Number);
        const weeksSinceStart = Math.floor((Date.UTC(dd.getFullYear(), dd.getMonth(), dd.getDate()) - Date.UTC(baseY, baseM - 1, baseD)) / (7*86400000));
        const intervalOk = rule.freq !== 'WEEKLY' || rule.interval <= 1 || (weeksSinceStart % rule.interval === 0);

        if (matchesDay && intervalOk && (useSetPos || d >= base.date)) {
          if (useSetPos) {
            // Defer selection: bucket by month, choose the Nth after scanning.
            const periodKey = `${dd.getFullYear()}-${dd.getMonth()}`;
            (candidatesByPeriod[periodKey] ||= []).push(d);
          } else {
            count++;
            emit(d);
            if (rule.count && count >= rule.count) break;
          }
        }
        d = addDays(d, 1);
      }

      // Apply BYSETPOS: from each month's ordered candidate list, keep only the
      // positions named (1-based; negatives count from the end, so -1 = last).
      if (useSetPos) {
        const periods = Object.keys(candidatesByPeriod).sort((a, b) => {
          const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
          return ay !== by ? ay - by : am - bm;
        });
        for (const key of periods) {
          const list = candidatesByPeriod[key];
          // Skip a month whose end falls past the scan window: its candidate list is
          // incomplete, so a negative BYSETPOS (-1 = "last") would wrongly pick a
          // mid-month day. Only apply BYSETPOS to fully-scanned months.
          const [py, pm] = key.split('-').map(Number); // pm is 0-indexed month
          const lastDayOfPeriod = `${py}-${String(pm+1).padStart(2,'0')}-${String(new Date(py, pm+1, 0).getDate()).padStart(2,'0')}`;
          if (lastDayOfPeriod > scanEnd) continue;
          // The positions named for this month, in date order (BYSETPOS=-1,1 must not count the last day before the first). Days before the
          // series start are not part of it; they were only in the list so the numbering is right.
          const picked = [...new Set(rule.bysetpos.map((posRaw) => list[posRaw > 0 ? posRaw - 1 : list.length + posRaw]).filter((x) => x && x >= base.date))].sort();
          for (const chosen of picked) {
            count++;
            emit(chosen);
            if (rule.count && count >= rule.count) break;
          }
          if (rule.count && count >= rule.count) break;
        }
        // BYSETPOS results were gathered per-month in order; ensure global sort.
        occurrences.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      }
    } else if (rule.freq === 'DAILY') {
      let d = base.date;
      while (d <= hardStop && iter++ < MAX_ITER) {
        count++;
        emit(d);
        if (rule.count && count >= rule.count) break;
        d = addDays(d, rule.interval);
      }
    } else {
      // Unsupported FREQ (SECONDLY/MINUTELY/HOURLY essentially never appear for
      // all-day personal events) — fall back to just the single base occurrence.
      return [{ date: base.date, end_date: base.end_date }];
    }

    return occurrences.length ? occurrences : [{ date: base.date, end_date: base.end_date }];
  }

  // ── Google Calendar as a calendar SOURCE (pull) ───────────────────────────────────────────────────────────────────
  // A feed whose address is `google:<calendarId>` (or `google:primary`) is read through the Google sign-in this device
  // already has for pushing events out, instead of from a pasted private ICS address. The sign-in's scope
  // (calendar.events) can read events of a calendar whose id it is given, but cannot LIST calendars (that would need the
  // wider calendar.readonly scope and Google's heavier verification), so a calendar other than the main one is added by
  // its id. Google expands repeating events itself (singleEvents), so none of the ICS recurrence code is involved; the
  // rows land in ical_events through the same write as every other feed.
  const GOOGLE_FEED_PREFIX = 'google:';
  function isGoogleFeedUrl(url) { return typeof url === 'string' && url.startsWith(GOOGLE_FEED_PREFIX); }
  function googleFeedCalendarId(url) {
    try { return decodeURIComponent(String(url).slice(GOOGLE_FEED_PREFIX.length)) || 'primary'; } catch { return 'primary'; }
  }
  function googleFeedUrlValid(url) { return /^google:[A-Za-z0-9._%@+=-]{1,200}$/.test(String(url || '')); }
  function googleCleanText(t, max) {
    return String(t == null ? '' : t).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .trim().slice(0, max);
  }
  // One Google event -> the row shape syncFeed writes, or null if it should not appear on the wall.
  function googleItemToOccurrence(item, timeZone) {
    if (!item || item.status === 'cancelled') return null;
    const id = String(item.id || '');
    if (!id) return null;
    // Events this app pushed to Google itself (googleEventBody() gives them ids starting "phqlocal") already exist locally:
    // pulling them back would show every pushed event twice.
    if (id.startsWith('phqlocal')) return null;
    if (item.eventType === 'workingLocation') return null;                       // "Home"/"Office" markers, clutter on a wall calendar
    if (Array.isArray(item.attendees) && item.attendees.some((a) => a && a.self && a.responseStatus === 'declined')) return null;
    const st = item.start || {}, en = item.end || {};
    const base = { uid: 'g:' + id, title: googleCleanText(item.summary, 300) || '(No title)', notes: googleCleanText(item.description, 2000), location: googleCleanText(item.location, 500) };
    if (st.date) {                                                               // all-day: Google's end date is EXCLUSIVE, ours is the last day
      let endDate = null;
      if (en.date) { const d = new Date(en.date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); endDate = d.toISOString().slice(0, 10); }
      return { ...base, date: st.date, end_date: (endDate && endDate > st.date) ? endDate : null, start_time: null, end_time: null };
    }
    if (st.dateTime) {
      const a0 = new Date(st.dateTime);
      if (isNaN(a0.getTime())) return null;
      const a = utcToLocalParts(a0, timeZone);
      let b = null;
      if (en.dateTime) { const b0 = new Date(en.dateTime); if (!isNaN(b0.getTime())) b = utcToLocalParts(b0, timeZone); }
      return { ...base, date: a.date, end_date: (b && b.date > a.date) ? b.date : null, start_time: a.time, end_time: b ? b.time : null };
    }
    return null;
  }
  async function fetchGoogleOccurrences(feed) {
    const calId = googleFeedCalendarId(feed.url);
    let token;
    try { token = await getGoogleAccessToken(); }
    catch (e) {
      const m = String((e && e.message) || e);
      if (/isn't connected|not configured/i.test(m)) throw new Error("Google Calendar isn't connected on this device. Connect your Google account first (Settings), then sync this calendar again.");
      throw new Error('Google sign-in problem: ' + m);
    }
    const tz = getLocalTimezone();
    const now = Date.now();
    const timeMin = new Date(now - RECURRENCE_WINDOW_PAST_DAYS * 86400000).toISOString();
    const timeMax = new Date(now + RECURRENCE_WINDOW_FUTURE_DAYS * 86400000).toISOString();
    const out = [];
    let pageToken = '';
    for (let page = 0; page < 8; page++) {
      const qs = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '2500', timeMin, timeMax });
      if (pageToken) qs.set('pageToken', pageToken);
      const r = await googleApi(`/calendars/${encodeURIComponent(calId)}/events?${qs}`, 'GET', { token });
      if (r.statusCode === 404) throw new Error(`Google could not find the calendar "${calId}". Check its id (in Google Calendar: Settings, pick the calendar, "Integrate calendar").`);
      if (r.statusCode === 403) throw new Error(`Google says this account is not allowed to read "${calId}". Check that calendar is shared with the connected account.`);
      if (r.statusCode === 401) throw new Error('Google no longer accepts this sign-in. Disconnect and connect your Google account again.');
      if (r.statusCode !== 200 || !r.json) throw new Error(`Google returned an error (HTTP ${r.statusCode}). It will be tried again at the next sync.`);
      for (const item of (r.json.items || [])) { const occ = googleItemToOccurrence(item, tz); if (occ) out.push(occ); }
      pageToken = r.json.nextPageToken || '';
      if (!pageToken) break;
    }
    return out;
  }

  // ── iCloud calendar as a calendar SOURCE (pull) ──────────────────────────────────────────────────────────────────
  // A feed whose address is `icloud:<calendar collection URL>` is read over CalDAV with the Apple ID + app-specific password
  // already saved for pushing events to iCloud (the password only needs to be saved - push does not have to be on). Apple
  // has no OAuth for this, so "sign in" for iCloud can only ever mean those two. The collection URL comes from the same
  // discovery the push settings use, so people PICK their calendars. The REPORT returns whole events (master + any edited
  // occurrences together); they are stitched into one calendar text and go through the same parser and repeat-expansion as
  // a pasted link, so every repeat/exception rule is the one already proven.
  const ICLOUD_FEED_PREFIX = 'icloud:';
  function isIcloudFeedUrl(url) { return typeof url === 'string' && url.startsWith(ICLOUD_FEED_PREFIX); }
  // The only places the Apple password may ever be sent: https on icloud.com (or a test fake named in PIAZZA_TEST_ICLOUD_ORIGIN).
  function icloudHostOk(u) {
    if (process.env.PIAZZA_TEST_ICLOUD_ORIGIN && u.origin === process.env.PIAZZA_TEST_ICLOUD_ORIGIN) return true;
    return u.protocol === 'https:' && /(^|\.)icloud\.com$/i.test(u.hostname);
  }
  function icloudFeedCollectionUrl(url) { return String(url).slice(ICLOUD_FEED_PREFIX.length); }
  function icloudFeedUrlValid(url) {
    if (!isIcloudFeedUrl(url) || String(url).length > 600) return false;
    try { const u = new URL(icloudFeedCollectionUrl(url)); return !u.username && !u.password && icloudHostOk(u); } catch { return false; }
  }
  // A CalDAV calendar-query answer -> one calendar text holding every VEVENT (VTIMEZONE etc. dropped; the parser reads times itself).
  function icsFromCaldavReport(xmlBody) {
    const stripped = stripXmlNsPrefixes(String(xmlBody || ''));
    const events = [];
    const re = /<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/gi;
    let m;
    while ((m = re.exec(stripped))) {
      let t = m[1].trim();
      const cd = t.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      if (cd) t = cd[1];
      else t = t.replace(/&#13;/g, '').replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      for (const ev of (t.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [])) events.push(ev);
    }
    return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Piazza HQ//iCloud pull//EN\r\n' + events.join('\r\n') + '\r\nEND:VCALENDAR\r\n';
  }
  async function fetchIcloudIcs(feed) {
    const cfg = getCaldavConfig();
    if (!cfg.username || !cfg.password) throw new Error('Add your Apple ID and an app-specific password first (Settings, Push to iCloud Calendar), then sync this calendar again.');
    const collection = icloudFeedCollectionUrl(feed.url);
    const fmt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const now = Date.now();
    const body = '<?xml version="1.0" encoding="utf-8"?>' +
      '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop>' +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
      `<c:time-range start="${fmt(now - RECURRENCE_WINDOW_PAST_DAYS * 86400000)}" end="${fmt(now + RECURRENCE_WINDOW_FUTURE_DAYS * 86400000)}"/>` +
      '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
    const r = await httpsRequest(collection, 'REPORT', { auth: { user: cfg.username, pass: cfg.password }, headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Depth': '1' }, body });
    if (r.statusCode === 401 || r.statusCode === 403) throw new Error('iCloud rejected the Apple ID or app-specific password. Update them in Settings (Push to iCloud Calendar) and sync again.');
    if (r.statusCode === 404) throw new Error('iCloud could not find that calendar any more. It may have been deleted or renamed; remove it here and add it again.');
    if (r.statusCode !== 207 && r.statusCode !== 200) throw new Error(`iCloud returned an error (HTTP ${r.statusCode}). It will be tried again at the next sync.`);
    return icsFromCaldavReport(r.body);
  }

  // ICS text -> the rows we store: parse, then expand repeating events into one row per occurrence in the window.
  function occurrencesFromIcs(icsText, feed) {
    const parsedEvents = parseICS(icsText, feed.id, feed.color, getLocalTimezone());
    const occurrences = [];
    for (const e of parsedEvents) {
      if (e.rrule) {
        for (const occ of expandRecurrence(e)) occurrences.push({ ...e, date: occ.date, end_date: occ.end_date });
      } else {
        occurrences.push(e);
      }
    }
    return { parsedCount: parsedEvents.length, occurrences };
  }

  async function syncFeed(feed) {
    let occurrences = [], parsedCount = 0;
    if (isGoogleFeedUrl(feed.url)) {
      occurrences = await fetchGoogleOccurrences(feed);
      parsedCount = occurrences.length;
    } else {
      let icsText;
      if (isIcloudFeedUrl(feed.url)) {
        icsText = await fetchIcloudIcs(feed);
      } else {
        icsText = await fetchUrl(feed.url);
        // A real .ics response always starts with this — if it's missing, the host
        // likely returned something else entirely (an HTML error/login page, an
        // empty body, etc.) even with a 200 status, which silently produced "0
        // events synced" with no visible error before this check existed.
        if (!icsText || !icsText.includes('BEGIN:VCALENDAR')) {
          throw new Error(
            'Response did not look like a calendar file (no BEGIN:VCALENDAR found) — ' +
            'the server may be blocking this kind of automated request, or the URL may be wrong.'
          );
        }
      }
      ({ parsedCount, occurrences } = occurrencesFromIcs(icsText, feed));
    }

    // Replace all events for this feed
    const replace = db.transaction(() => {
      db.prepare(`DELETE FROM ical_events WHERE feed_id = ?`).run(feed.id);
      const insert = db.prepare(
        `INSERT OR REPLACE INTO ical_events (uid, feed_id, title, date, end_date, start_time, end_time, notes, location)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of occurrences) {
        const endDate = (e.end_date && e.end_date > e.date) ? e.end_date : null;
        insert.run(e.uid, feed.id, e.title, e.date, endDate, e.start_time || null, e.end_time || null, e.notes || '', e.location || '');
      }
      db.prepare(`UPDATE ical_feeds SET last_synced = datetime('now') WHERE id = ?`).run(feed.id);
    });
    replace();
    console.log(`Synced feed "${feed.name}": ${parsedCount} events (${occurrences.length} occurrences after expanding recurrences)`);
    return occurrences.length;
  }

  // Auto-sync all enabled feeds — interval is configurable in Settings (default 30 min)
  async function syncAllFeeds() {
    const feeds = db.prepare(`SELECT * FROM ical_feeds WHERE enabled = 1`).all();
    for (const feed of feeds) {
      try { await syncFeed(feed); }
      catch (e) { console.error(`Feed sync failed for "${feed.name}":`, e.message); }
      // Let queued HTTP requests (the display's, mostly) run between feeds instead
      // of a whole sync monopolising the event loop.
      await new Promise((r) => setImmediate(r));
    }
    if (feeds.length) broadcastUpdate('events');
  }

  function getSyncIntervalMs() {
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'ical_sync_minutes'`).get();
    const minutes = parseInt(row?.value) || 30;
    return minutes * 60 * 1000;
  }

  function scheduleNextSync() {
    setTimeout(async () => {
      await syncAllFeeds();
      scheduleNextSync(); // reschedule using whatever the interval setting is *now*
    }, getSyncIntervalMs());
  }
  scheduleNextSync();
  // Also sync on startup - but WHEN depends on whether there is anything to show
  // yet. A brand-new install has no events, so it syncs almost immediately (3s). A
  // device that already holds synced events (every reboot and every self-update)
  // waits 90s: the first sync parses and expands thousands of recurring events on
  // the main thread while the kiosk browser is launching and compiling a 1.2 MB
  // page on a 1 GB Pi, and measured on a Pi 3B+ that contention was the whole
  // "white screen for ~26 seconds after a reboot" (first paint takes ~5s when the
  // Pi is idle). The display shows the stored events meanwhile; broadcastUpdate
  // refreshes it when the sync lands. PIAZZA_BOOT_SYNC_DELAY_SEC overrides.
  function chooseBootSyncDelayMs(hasSyncedEvents, envValue) {
    const override = parseInt(envValue, 10);
    if (Number.isFinite(override) && override >= 0) return override * 1000;
    return hasSyncedEvents ? 90 * 1000 : 3000;
  }
  setTimeout(syncAllFeeds, chooseBootSyncDelayMs(
    !!db.prepare(`SELECT 1 FROM ical_events LIMIT 1`).get(),
    process.env.PIAZZA_BOOT_SYNC_DELAY_SEC));

  // ── Pushing local events out to external calendars (iCloud + Google) ────────
  // Everything above about calendars is the PULL side: subscribe to a published
  // .ics URL and display it, read-only. Everything below is the PUSH side: when
  // someone creates a local event here, also write it to their real iCloud
  // and/or Google calendar so it shows up in Apple Calendar / Google Calendar
  // on their other devices. Both are opt-in per household, both best-effort — a
  // push that fails NEVER blocks or fails the local event's own create/update/
  // delete (the local copy is always the source of truth), it just gets
  // recorded on the row and retried by a background sweep.
  //
  // CalDAV servers vary which namespace prefix they put on DAV:/caldav: elements
  // (d:, D:, cal:, or none) — strip the prefixes so one set of tag-matching
  // regexes works regardless. Same hand-rolled approach as parseICS(); the
  // responses here are flat and predictable enough that a full XML parser
  // dependency isn't worth it.
  function stripXmlNsPrefixes(xml) {
    return xml.replace(/<(\/?)[a-zA-Z0-9_.-]+:/g, '<$1');
  }
  function xmlFirstTag(xml, tag) {
    const m = stripXmlNsPrefixes(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
  }
  function xmlFirstHref(xml) {
    const m = stripXmlNsPrefixes(xml).match(/<href[^>]*>([^<]+)<\/href>/i);
    return m ? m[1].trim() : null;
  }

  const ICLOUD_CALDAV_ROOT = 'https://caldav.icloud.com/';

  // RFC 6764 discovery against iCloud: principal -> calendar-home-set -> list of
  // calendar collections that actually accept VEVENTs. Returns [{url, name}].
  async function discoverCalDAVCalendars(username, password) {
    const auth = { user: username, pass: password };
    const xmlHeaders = { 'Content-Type': 'text/xml; charset=utf-8', 'Depth': '0' };

    // 1. current-user-principal (also resolves the per-account host via redirect)
    const principalReq = await httpsRequest(ICLOUD_CALDAV_ROOT, 'PROPFIND', {
      auth, headers: xmlHeaders,
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`,
    });
    if (principalReq.statusCode === 401) throw new Error('iCloud rejected the Apple ID or app-specific password.');
    if (principalReq.statusCode !== 207) throw new Error(`Unexpected response from iCloud (HTTP ${principalReq.statusCode}) while looking up the account.`);
    const origin = new URL(principalReq.finalUrl).origin;
    const principalHref = xmlFirstTag(principalReq.body, 'current-user-principal') && xmlFirstHref(xmlFirstTag(principalReq.body, 'current-user-principal'));
    if (!principalHref) throw new Error('Could not find the iCloud account principal in the response.');

    // 2. calendar-home-set
    const homeReq = await httpsRequest(new URL(principalHref, origin).toString(), 'PROPFIND', {
      auth, headers: xmlHeaders,
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><c:calendar-home-set/></prop></propfind>`,
    });
    if (homeReq.statusCode !== 207) throw new Error(`Unexpected response from iCloud (HTTP ${homeReq.statusCode}) while looking up the calendar home.`);
    const homeSetInner = xmlFirstTag(homeReq.body, 'calendar-home-set');
    const homeHref = homeSetInner && xmlFirstHref(homeSetInner);
    if (!homeHref) throw new Error('Could not find the iCloud calendar home in the response.');

    // 3. enumerate calendar collections (Depth: 1)
    const listReq = await httpsRequest(new URL(homeHref, origin).toString(), 'PROPFIND', {
      auth, headers: { ...xmlHeaders, 'Depth': '1' },
      body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><prop><displayname/><resourcetype/><c:supported-calendar-component-set/></prop></propfind>`,
    });
    if (listReq.statusCode !== 207) throw new Error(`Unexpected response from iCloud (HTTP ${listReq.statusCode}) while listing calendars.`);

    // Parse the multistatus. Deliberately lenient — iCloud varies tag
    // attributes and namespace placement between accounts, and the failure
    // mode of being too strict (an EMPTY picker) is far worse than being too
    // loose (one stray non-event calendar in the list). So: keep any child
    // collection under the home whose resourcetype names "calendar", and
    // only drop one if its component set is present AND explicitly has no
    // VEVENT (a VTODO-only Reminders list). A parse miss on the component
    // set means "keep it", not "drop it".
    const stripped = stripXmlNsPrefixes(listReq.body);
    const normPath = (u) => { try { return new URL(u, origin).pathname.replace(/\/?$/, '/'); } catch { return String(u).replace(/\/?$/, '/'); } };
    const homePath = normPath(homeHref);
    const blocks = stripped.split(/<response[\s>]/i).slice(1);
    const seenHrefs = [];
    const calendars = [];
    for (const block of blocks) {
      const href = (block.match(/<href[^>]*>([^<]+)<\/href>/i) || [])[1];
      if (!href) continue;
      seenHrefs.push(href.trim());
      if (normPath(href.trim()) === homePath) continue;             // the calendar-home collection itself
      const rt = (block.match(/<resourcetype[\s>]([\s\S]*?)<\/resourcetype>/i) || [])[1] || '';
      if (!/<calendar[\s/>]/i.test(rt)) continue;                    // not a calendar collection (inbox/outbox/dropbox/etc.)
      const compSet = (block.match(/<supported-calendar-component-set[\s>]([\s\S]*?)<\/supported-calendar-component-set>/i) || [])[1];
      if (compSet && !/VEVENT/i.test(compSet)) continue;             // present and definitively event-less -> skip
      const nameMatch = block.match(/<displayname[^>]*>([^<]*)<\/displayname>/i);
      calendars.push({
        url: new URL(href.trim(), origin).toString(),
        name: (nameMatch && nameMatch[1].trim()) || href.trim(),
      });
    }
    if (!calendars.length) {
      console.error('CalDAV discovery found no calendars. Raw list body:\n' + listReq.body.slice(0, 4000));
      throw new Error(`Connected to iCloud, but couldn't match any calendars. Collections it returned: ${seenHrefs.slice(0, 20).join(', ') || '(none)'}`);
    }
    return calendars;
  }

  // ── Building the VEVENT to push ──────────────────────────────────────────────
  function escapeICSText(s) {
    // Inverse of decodeICSText(): backslash FIRST, then the rest.
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  // RFC 5545: content lines must be folded at <=75 octets, continuations start
  // with a single space. `notes` can run to 500 chars, well past that.
  function foldICSLine(line) {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 74) return line;
    const out = [];
    let start = 0;
    while (start < bytes.length) {
      let end = Math.min(start + (out.length ? 73 : 74), bytes.length);
      // Don't split a multi-byte UTF-8 sequence: back up while the next byte is a continuation byte (10xxxxxx).
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      out.push((out.length ? ' ' : '') + bytes.slice(start, end).toString('utf8'));
      start = end;
    }
    return out.join('\r\n');
  }
  function icsStamp(d = new Date()) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }
  function caldavUidFor(eventId) { return `piazzahq-local-${eventId}@piazzahq.local`; }

  // Turns an `events` table row into a full VCALENDAR document for a PUT.
  function buildEventICS(row) {
    const uid = caldavUidFor(row.id);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Piazza HQ//Local Event//EN', 'BEGIN:VEVENT',
      `UID:${uid}`, `DTSTAMP:${icsStamp()}`];

    if (!row.start_time) {
      // All-day. DTEND is exclusive per RFC 5545 — one day past the last day.
      const endExclusive = new Date((row.end_date || row.date) + 'T00:00:00');
      endExclusive.setDate(endExclusive.getDate() + 1);
      const endStr = `${endExclusive.getFullYear()}${String(endExclusive.getMonth() + 1).padStart(2, '0')}${String(endExclusive.getDate()).padStart(2, '0')}`;
      lines.push(`DTSTART;VALUE=DATE:${row.date.replace(/-/g, '')}`);
      lines.push(`DTEND;VALUE=DATE:${endStr}`);
    } else {
      // Timed. Floating local time (no Z, no TZID) — this app has one global
      // timezone and treats floating times as "take as written", matching
      // parseICSDate()'s own handling of the inbound side.
      const startD = (row.date || '').replace(/-/g, '');
      const startT = (row.start_time || '00:00').replace(/:/g, '') + '00';
      lines.push(`DTSTART:${startD}T${startT}`);
      if (row.end_time) {
        const endD = ((row.end_date || row.date) || '').replace(/-/g, '');
        const endT = row.end_time.replace(/:/g, '') + '00';
        lines.push(`DTEND:${endD}T${endT}`);
      }
    }

    lines.push(foldICSLine(`SUMMARY:${escapeICSText(row.title)}`));
    if (row.notes) lines.push(foldICSLine(`DESCRIPTION:${escapeICSText(row.notes)}`));
    if (row.location) lines.push(foldICSLine(`LOCATION:${escapeICSText(row.location)}`));
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ── Push / delete a single event ────────────────────────────────────────────
  function getCaldavConfig() {
    return {
      enabled: getSetting('icloud_push_enabled') === '1',
      username: getSetting('icloud_username') || '',
      password: getSetting('icloud_app_password') || '',
      calendarUrl: getSetting('icloud_calendar_url') || '',
    };
  }
  function caldavObjectUrl(calendarUrl, eventId) {
    return calendarUrl.replace(/\/?$/, '/') + `piazzahq-local-${eventId}.ics`;
  }
  function setEventCaldavFields(id, fields) {
    const cols = Object.keys(fields);
    if (!cols.length) return;
    db.prepare(`UPDATE events SET ${cols.map(c => `${c}=?`).join(', ')} WHERE id=?`)
      .run(...cols.map(c => fields[c]), id);
  }

  // Never throws to its caller — fire-and-forget from the /api/events handlers.
  // Serves both "create" and "edit" (deterministic object URL => an edit is just
  // a re-PUT to the same place). No-ops silently unless push is fully configured.
  async function pushLocalEventToCalDAV(row) {
    if (IS_DEMO) return;
    try {
      const cfg = getCaldavConfig();
      if (!cfg.username || !cfg.password) return;
      const t = row.target_calendar || null;
      if (t === 'local' || t === 'google') return; // explicitly not an iCloud target
      // Which calendar: an explicit per-event choice wins (and overrides the
      // global enable toggle — the user picked it on purpose); otherwise fall
      // back to the configured default calendar, which does respect the toggle.
      let calendarUrl;
      if (t && t.startsWith('caldav:')) {
        calendarUrl = t.slice('caldav:'.length);
      } else {
        if (!cfg.enabled || !cfg.calendarUrl) return;
        calendarUrl = cfg.calendarUrl;
      }
      if (!calendarUrl) return;
      const objUrl = caldavObjectUrl(calendarUrl, row.id);
      const res = await httpsRequest(objUrl, 'PUT', {
        auth: { user: cfg.username, pass: cfg.password },
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        body: buildEventICS(row),
      });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setEventCaldavFields(row.id, {
          caldav_uid: caldavUidFor(row.id),
          caldav_url: objUrl,
          caldav_pushed_at: new Date().toISOString(),
          caldav_push_error: null,
        });
      } else {
        setEventCaldavFields(row.id, { caldav_push_error: `HTTP ${res.statusCode}` });
        console.error(`CalDAV push failed for event ${row.id}: HTTP ${res.statusCode} ${res.body.slice(0, 200)}`);
      }
    } catch (e) {
      try { setEventCaldavFields(row.id, { caldav_push_error: e.message.slice(0, 300) }); } catch {}
      console.error(`CalDAV push failed for event ${row.id}:`, e.message);
    }
  }

  // Never throws. No-ops if the row was never pushed. Fired from the DELETE
  // handler AFTER the local row is already gone, so it takes the pre-delete row.
  async function deleteEventFromCalDAV(row) {
    if (IS_DEMO) return;
    try {
      if (!row || !row.caldav_url) return;
      const cfg = getCaldavConfig();
      if (!cfg.username || !cfg.password) return; // can't authenticate; leave the remote copy, nothing better to do
      const res = await httpsRequest(row.caldav_url, 'DELETE', {
        auth: { user: cfg.username, pass: cfg.password },
      });
      if (!((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 404)) {
        console.error(`CalDAV delete failed for event ${row.id}: HTTP ${res.statusCode}`);
      }
    } catch (e) {
      console.error(`CalDAV delete failed for event ${row.id}:`, e.message);
    }
  }

  // ── Google Calendar push ───────────────────────────────────────────────────
  // Same shape as the CalDAV push above, but Google's a REST/JSON API behind
  // OAuth instead of CalDAV+app-password. Connecting uses a standard
  // authorization-code + PKCE flow, but relayed through the mothership: Google
  // redirects to https://piazzahq.com/oauth/google/callback (a stable URL this
  // wall-mounted box doesn't have), which stashes the auth code; this box polls
  // for it and does the token exchange itself. (The device/"limited input" flow
  // would need no redirect at all, but Google doesn't allow Calendar scopes
  // through it — hence the relay.) See /api/google/connect-start below.
  //
  // client_id/client_secret are a SINGLE OAuth client shared across every
  // household (owned by the project, not created per install). They're read
  // from env first (GOOGLE_OAUTH_CLIENT_ID / _SECRET, e.g. via systemd
  // EnvironmentFile) with a settings-row fallback so the mothership can push
  // them down at provision time later without a code change. The secret and the
  // PKCE verifier never leave this box — the mothership only ever sees a
  // short-lived single-use auth code, useless without them.
  const GOOGLE_TOKEN_URL = process.env.PIAZZA_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';   // env override: tests only
  const GOOGLE_USERINFO_URL = process.env.PIAZZA_GOOGLE_USERINFO_URL || 'https://openidconnect.googleapis.com/v1/userinfo';   // the env override is for tests only (a fake Google)
  const GOOGLE_CAL_API = process.env.PIAZZA_GOOGLE_CAL_API || 'https://www.googleapis.com/calendar/v3';   // env override: tests only
  // calendar.events lets us insert/update/delete events on any calendar the
  // user can access — but NOT list their calendars (that needs the broader
  // calendar/calendar.readonly scope, which drags in a heavier OAuth
  // verification). So we don't offer a picker: events go to `primary` by
  // default, with an optional manual calendar-ID override. `openid email` is
  // non-sensitive and just gives us the account address for the UI.
  const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.events';

  function getGoogleConfig() {
    return {
      enabled: getSetting('google_push_enabled') === '1',
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || getSetting('google_oauth_client_id') || '',
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || getSetting('google_oauth_client_secret') || '',
      refreshToken: getSetting('google_refresh_token') || '',
      calendarId: getSetting('google_calendar_id') || '',
    };
  }
  function googleClientConfigured() {
    const c = getGoogleConfig();
    return !!(c.clientId && c.clientSecret);
  }
  function setGoogleDisconnected() {
    for (const k of ['google_refresh_token', 'google_access_token', 'google_access_token_expiry',
                     'google_account_email', 'google_calendar_id', 'google_calendar_name']) setSetting(k, '');
    setSetting('google_push_enabled', '0');
  }

  const formEncode = (obj) => Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  // Returns a currently-valid access token, refreshing (and caching) if the
  // stored one is missing or within 5 min of expiry. Throws if not connected.
  async function getGoogleAccessToken() {
    const cfg = getGoogleConfig();
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('Google OAuth client is not configured on this server.');
    if (!cfg.refreshToken) throw new Error("Google Calendar isn't connected.");
    const cached = getSetting('google_access_token') || '';
    const expiry = Number(getSetting('google_access_token_expiry') || 0);
    if (cached && Date.now() < expiry - 5 * 60 * 1000) return cached;
    const res = await httpsRequest(GOOGLE_TOKEN_URL, 'POST', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken, grant_type: 'refresh_token' }),
    });
    let data = {}; try { data = JSON.parse(res.body || '{}'); } catch {}
    if (res.statusCode !== 200 || !data.access_token) {
      // A revoked/expired refresh token is permanent — reflect that in the UI
      // rather than failing every push forever against a dead credential.
      if (data.error === 'invalid_grant') setGoogleDisconnected();
      throw new Error('Google token refresh failed: ' + (data.error || `HTTP ${res.statusCode}`));
    }
    setSetting('google_access_token', data.access_token);
    setSetting('google_access_token_expiry', String(Date.now() + (data.expires_in || 3600) * 1000));
    return data.access_token;
  }

  async function googleApi(pathOrUrl, method, { token, body } = {}) {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : GOOGLE_CAL_API + pathOrUrl;
    const res = await httpsRequest(url, method, {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : null,
    });
    let json = null; try { json = res.body ? JSON.parse(res.body) : null; } catch {}
    return { statusCode: res.statusCode, json, raw: res.body };
  }

  // The connected account's email, from the OpenID userinfo endpoint (the
  // `openid email` scope). Cosmetic — for the "Connected as X" line. Best
  // effort; returns '' if it fails.
  async function googleGetAccountEmail(token) {
    try {
      const res = await httpsRequest(GOOGLE_USERINFO_URL, 'GET', { headers: { 'Authorization': `Bearer ${token}` } });
      const j = JSON.parse(res.body || '{}');
      return (res.statusCode === 200 && j.email) ? j.email : '';
    } catch { return ''; }
  }

  // Turns an `events` row into the JSON body Google's API wants. Mirrors
  // buildEventICS()'s handling of all-day vs timed and exclusive end dates.
  function googleEventBody(row) {
    const b = { id: `phqlocal${row.id}`, summary: row.title || '(no title)' };
    if (row.notes) b.description = row.notes;
    if (row.location) b.location = row.location;
    if (!row.start_time) {
      const endExclusive = new Date((row.end_date || row.date) + 'T00:00:00');
      endExclusive.setDate(endExclusive.getDate() + 1);
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      b.start = { date: row.date };
      b.end = { date: iso(endExclusive) };
    } else {
      const tz = getLocalTimezone();
      b.start = { dateTime: `${row.date}T${row.start_time}:00`, timeZone: tz };
      b.end = { dateTime: `${row.end_date || row.date}T${(row.end_time || row.start_time)}:00`, timeZone: tz };
    }
    return b;
  }

  async function pushLocalEventToGoogle(row) {
    if (IS_DEMO) return;
    try {
      const cfg = getGoogleConfig();
      const t = row.target_calendar || null;
      if (t === 'local' || (t && t.startsWith('caldav:'))) return; // explicitly not a Google target
      // An explicit 'google' choice pushes even if the global toggle is off;
      // the default (no choice) still respects the toggle.
      if (t !== 'google' && !cfg.enabled) return;
      if (!cfg.refreshToken || !cfg.calendarId || !googleClientConfigured()) return;
      const token = await getGoogleAccessToken();
      const calId = encodeURIComponent(cfg.calendarId);
      const gid = `phqlocal${row.id}`;
      // Insert with our deterministic id; if it already exists (edit / retry),
      // Google 409s and we switch to a full update at that id — same
      // create-or-update shape as the CalDAV re-PUT.
      let res = await googleApi(`/calendars/${calId}/events`, 'POST', { token, body: googleEventBody(row) });
      if (res.statusCode === 409) {
        res = await googleApi(`/calendars/${calId}/events/${gid}`, 'PUT', { token, body: googleEventBody(row) });
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setEventCaldavFields(row.id, { google_event_id: gid, google_pushed_at: new Date().toISOString(), google_push_error: null });
      } else {
        const msg = (res.json && res.json.error && res.json.error.message) || `HTTP ${res.statusCode}`;
        setEventCaldavFields(row.id, { google_push_error: String(msg).slice(0, 300) });
        console.error(`Google push failed for event ${row.id}: ${msg}`);
      }
    } catch (e) {
      try { setEventCaldavFields(row.id, { google_push_error: e.message.slice(0, 300) }); } catch {}
      console.error(`Google push failed for event ${row.id}:`, e.message);
    }
  }

  async function deleteEventFromGoogle(row) {
    if (IS_DEMO) return;
    try {
      if (!row || !row.google_event_id) return;
      const cfg = getGoogleConfig();
      if (!cfg.refreshToken || !googleClientConfigured()) return;
      const calId = encodeURIComponent(cfg.calendarId || 'primary');
      const token = await getGoogleAccessToken();
      const res = await googleApi(`/calendars/${calId}/events/${row.google_event_id}`, 'DELETE', { token });
      if (!((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 404 || res.statusCode === 410)) {
        console.error(`Google delete failed for event ${row.id}: HTTP ${res.statusCode}`);
      }
    } catch (e) {
      console.error(`Google delete failed for event ${row.id}:`, e.message);
    }
  }

  // One sweep, both targets. Host-only — a slave proxies its event writes to
  // the host, so it never runs a push and has nothing to retry.
  async function retryFailedExternalPushes() {
    if (IS_DEMO) return;
    if (isSlave()) return;
    // Gate only on having credentials, not on the enable toggle — a row can
    // carry an explicit per-event target that should push regardless. The
    // per-row push functions make the real decision.
    const caldav = getCaldavConfig();
    if (caldav.username && caldav.password) {
      for (const row of db.prepare(`SELECT * FROM events WHERE caldav_push_error IS NOT NULL`).all()) {
        await pushLocalEventToCalDAV(row);
      }
    }
    const google = getGoogleConfig();
    if (google.refreshToken && googleClientConfigured()) {
      for (const row of db.prepare(`SELECT * FROM events WHERE google_push_error IS NOT NULL`).all()) {
        await pushLocalEventToGoogle(row);
      }
    }
  }
  setInterval(retryFailedExternalPushes, 15 * 60 * 1000);
  return { fetchUrl, getLocalTimezone, utcToLocalParts, parseICSDate, decodeICSText, parseICS, expandRecurrence, isGoogleFeedUrl, googleFeedUrlValid, isIcloudFeedUrl, icloudHostOk, icloudFeedUrlValid, syncFeed, discoverCalDAVCalendars, stripXmlNsPrefixes, getCaldavConfig, caldavUidFor, buildEventICS, setEventCaldavFields, pushLocalEventToCalDAV, deleteEventFromCalDAV, GOOGLE_TOKEN_URL, GOOGLE_SCOPE, getGoogleConfig, googleClientConfigured, setGoogleDisconnected, formEncode, googleGetAccountEmail, getGoogleAccessToken, googleApi, pushLocalEventToGoogle, deleteEventFromGoogle, RECURRENCE_WINDOW_PAST_DAYS, RECURRENCE_WINDOW_FUTURE_DAYS };
};
