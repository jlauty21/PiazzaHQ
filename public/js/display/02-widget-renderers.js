// ── Widget renderers ─────────────────────────────────────────────────────────
function analogHandDegrees(now) {
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  return {
    hour: (h + m / 60) * 30,
    minute: (m + s / 60) * 6,
    second: s * 6,
  };
}
function renderClockFace(style) {
  // 'line' (the original/default style) keeps its exact existing 12-marker
  // output unchanged — anyone already using analog sees zero visual
  // difference unless they actively pick a different Face in Settings.
  // Numeral positions for aviation/brass are computed here (radius as % of
  // the face box, same technique as the design preview this was built
  // from) rather than in pure CSS, since placing 4 labels at fixed
  // compass points needs real trigonometry, not just a rotated transform.
  const numeralPos = (idx, radiusPct) => {
    const angle = idx * 90 * Math.PI / 180;
    const x = 50 + Math.sin(angle) * radiusPct;
    const y = 50 - Math.cos(angle) * radiusPct;
    return `left:${x}%;top:${y}%`;
  };
  if (style === 'aviation') {
    let ticks = '';
    for (let i = 0; i < 60; i++) {
      ticks += `<div class="analog-tick${i % 5 === 0 ? ' major' : ''}" style="--i:${i}"></div>`;
    }
    const nums = [12, 3, 6, 9].map((n, idx) =>
      `<div class="analog-num" style="${numeralPos(idx, 34)}">${n}</div>`).join('');
    return `${ticks}<div class="analog-ring"></div>${nums}`;
  }
  if (style === 'brass') {
    const romans = { 12: 'XII', 3: 'III', 6: 'VI', 9: 'IX' };
    return [12, 3, 6, 9].map((n, idx) =>
      `<div class="analog-roman" style="${numeralPos(idx, 38)}">${romans[n]}</div>`).join('');
  }
  if (style === 'bold') {
    let markers = '';
    for (let i = 0; i < 12; i++) {
      markers += `<div class="analog-dot${i % 3 === 0 ? ' major' : ''}" style="--i:${i}"></div>`;
    }
    return markers;
  }
  // 'line' / default
  let markers = '';
  for (let i = 0; i < 12; i++) {
    markers += `<div class="analog-marker${i % 3 === 0 ? ' major' : ''}" style="--i:${i}"></div>`;
  }
  return markers;
}
function renderClock(widget) {
  const w = widget || {};
  const fontPx = w.clockFontPx || 90;
  // Per-widget override: 'default' (or unset) follows the display-wide Settings
  // value; '12'/'24' pins this specific clock regardless of that setting.
  const fmtOverride = (w.clockTimeFormat && w.clockTimeFormat !== 'default') ? w.clockTimeFormat : null;
  const use24 = fmtOverride ? (fmtOverride === '24') : use24Hour();
  // Same 'default'-follows-global convention as clockTimeFormat, one line up.
  const ampmOverride = (w.clockAmpmCase && w.clockAmpmCase !== 'default') ? w.clockAmpmCase : null;
  const dataAttr = `${fmtOverride ? ` data-format="${fmtOverride}"` : ''}${ampmOverride ? ` data-ampm="${ampmOverride}"` : ''}`;
  const now = new Date();

  if (w.clockStyle === 'analog') {
    // fontPx doubles as the face's diameter here — same slider, same stored
    // field, so switching styles doesn't need a separate size setting or
    // lose whatever size was already dialed in.
    const style = w.analogStyle || 'line';
    const deg = analogHandDegrees(now);
    return `<div class="w-clock w-clock-analog" style="--clock-size:calc(${fontPx}px * var(--ui-scale,1))">
      <div class="analog-face style-${style}">
        ${renderClockFace(style)}
        <div class="analog-hand hand-hour" style="--deg:${deg.hour}deg"></div>
        <div class="analog-hand hand-minute" style="--deg:${deg.minute}deg"></div>
        <div class="analog-hand hand-second" style="--deg:${deg.second}deg"></div>
        <div class="analog-center"></div>
      </div>
    </div>`;
  }

  let h = now.getHours(), m = now.getMinutes();
  if (use24) {
    return `<div class="w-clock"${dataAttr} style="--clock-font:calc(${fontPx}px * var(--ui-scale,1))"><div class="time">${pad(h)}:${pad(m)}</div></div>`;
  }
  const meridiem = h >= 12 ? 'pm' : 'am';
  const ampm = ampmCase(ampmOverride) === 'upper' ? meridiem.toUpperCase() : meridiem;
  h = h % 12 || 12;
  return `<div class="w-clock"${dataAttr} style="--clock-font:calc(${fontPx}px * var(--ui-scale,1))"><div class="time">${h}:${pad(m)}<span class="ampm">${ampm}</span></div></div>`;
}

// The date_format setting (Settings → Display) is the single source of
// truth for how dates read throughout the whole display — the standalone
// Date widget can still override it per-instance (its own dropdown has a
// "Use global default" option), but every other widget that shows a date
// (Agenda, Mini Calendar Strip, Tasks due dates, etc.) always follows this
// global value. Previously each of those formatted dates independently
// with its own hardcoded US month-before-day ordering, so even a household
// that set the Date widget to "International" would still see US-ordered
// dates everywhere else — this is what actually needed to be global.
function globalDateFormat() {
  return (state.settings && state.settings.date_format) || 'us_long';
}
// Whether a format prefers day-before-month ordering ("5 August" style)
// rather than month-before-day ("August 5" style) — the one axis that
// matters for the shorter weekday/month/day-style labels below, which
// don't need the standalone Date widget's full 5-way distinction (numeric
// vs. spelled-out, ISO, etc.), just this one ordering choice.
function dateFormatPrefersDayFirst(format) {
  return format === 'intl_long' || format === 'intl_short' || format === 'iso';
}
// "Sat, Aug 5" (US) or "Sat, 5 Aug" (International) — shared by anything
// showing a short weekday+month+day label (Agenda day-group headers, Mini
// Calendar Strip's day label), so both stay in sync with one global
// setting instead of two independently-hardcoded copies.
function weekdayDateLabel(d, format) {
  if (format === 'locale' && window.i18n) return i18n.date(d, 'weekdayShort');
  const dow = DAYS_S[d.getDay()], mon = MONTHS_S[d.getMonth()], day = d.getDate();
  if (format === 'us_ordinal') return `${dow}, ${mon} ${day}${ordinalSuffix(day)}`;
  if (format === 'intl_ordinal') return `${dow}, ${day}${ordinalSuffix(day)} ${mon}`;
  return dateFormatPrefersDayFirst(format) ? `${dow}, ${day} ${mon}` : `${dow}, ${mon} ${day}`;
}
// "Aug 5" (US) or "5 Aug" (International) — no weekday, used by due-date
// style labels (Tasks, Tasks Combined).
function monthDayLabel(d, format) {
  if (format === 'locale' && window.i18n) return i18n.date(d, 'monthDay');
  const mon = MONTHS_S[d.getMonth()], day = d.getDate();
  if (format === 'us_ordinal') return `${mon} ${day}${ordinalSuffix(day)}`;
  if (format === 'intl_ordinal') return `${day}${ordinalSuffix(day)} ${mon}`;
  return dateFormatPrefersDayFirst(format) ? `${day} ${mon}` : `${mon} ${day}`;
}

// Shared by renderDate() and tickClock()'s per-second date-string refresh
// below — both need to produce the exact same "August 5, 2026" / "5 August
// 2026" / etc. string for a given resolved format, so this exists once
// rather than two copies that could drift out of sync with each other.
// Standard ordinal suffix (1st, 2nd, 3rd, 4th... 11th/12th/13th are the
// exceptions to the simple last-digit rule, since English says "eleventh"
// not "eleveth" — the %100 check catches those).
function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}
function formatDateFull(now, format) {
  const mon = MONTHS[now.getMonth()];
  const d = now.getDate();
  const y = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(d);
  switch (format) {
    case 'intl_long':  return `${d} ${mon} ${y}`;    // "5 August 2026" — UK/most of world
    case 'iso':         return `${y}-${mm}-${dd}`;    // "2026-08-05" — unambiguous/ISO 8601
    case 'us_short':    return `${mm}/${dd}/${y}`;    // "08/05/2026" — US numeric
    case 'intl_short':  return `${dd}/${mm}/${y}`;    // "05/08/2026" — most non-US numeric
    case 'us_ordinal':  return `${mon} ${d}${ordinalSuffix(d)}, ${y}`; // "August 5th, 2026"
    case 'intl_ordinal': return `${d}${ordinalSuffix(d)} of ${mon} ${y}`; // "5th of August 2026"
    case 'locale':       return (window.i18n && i18n.date(now, 'full')) || `${mon} ${d}, ${y}`;   // the language's own order, e.g. "4. Oktober 2026"
    case 'us_long':
    default:             return `${mon} ${d}, ${y}`;  // "August 5, 2026" — US long
  }
}

function renderDate(widget) {
  const fontPx = (widget && widget.dateFontPx) || 24;
  const now = new Date();
  const dow = DAYS[now.getDay()];
  // Prominent, distinct format families rather than every possible permutation —
  // the goal is covering how different countries actually read a date at a
  // glance, not building a full locale database. An unset per-widget override
  // falls back to the global date_format setting (Settings → Display), which
  // itself defaults to 'us_long' for anyone with an existing layout/install.
  const format = (widget && widget.dateFormat) || globalDateFormat();
  const dateStr = formatDateFull(now, format);
  return `<div class="w-date" data-format="${format}" style="--date-font:calc(${fontPx}px * var(--ui-scale,1))">
    <div class="day-name">${dow}</div>
    <div class="date-str">${dateStr}</div>
  </div>`;
}

// Combined clock + date (+ optional current temperature) card — the single-
// tile "everything at a glance" layout DakBoard and similar dashboards use,
// requested as an alternative to running separate Clock/Date/Weather
// widgets side by side. Two style presets (dtStyle) rather than one fixed
// layout, since "big time, date below, temp below that" (classic) doesn't
// fit every widget box someone might drag this into — a wide, short box
// wants split (time | date+temp side by side) instead. (A third preset,
// Compact/one-line, existed briefly in beta.4/5 and was removed in beta.6 —
// didn't hold up well visually at the font sizes people actually use.)
// Reuses the exact same helpers/override conventions as
// the standalone Clock, Date, and Weather widgets (use24Hour/ampmCase,
// globalDateFormat/formatDateFull, weatherForWidget/formatTemp) rather than
// any new formatting logic, so this widget's output is guaranteed to match
// what those widgets already show for the same settings.
// Per-element font-size override for the Date & Time widget — returns an
// inline style attribute string when w[field] is set (an explicit px
// value the person chose), or '' when unset, in which case the element
// just falls through to its class's normal proportional calc(var(--dt-font)
// * ratio) rule from the CSS above. Inline styles always win over
// stylesheet rules, so this needs no !important or CSS-variable
// indirection to layer cleanly on top of the existing proportional system.
function dtSizeStyle(px) {
  return px ? ` style="font-size:${px}px"` : '';
}
function renderDateTime(widget) {
  const w = widget || {};
  const style = w.dtStyle || 'classic';
  const fontPx = w.dtFontPx || 70;
  const showSeconds = !!w.dtShowSeconds;
  const showDate = w.dtShowDate !== false;
  const showTemp = !!w.dtShowTemp;
  const align = (w.dtAlign === 'right') ? 'right' : 'left';
  const fmtOverride = (w.dtTimeFormat && w.dtTimeFormat !== 'default') ? w.dtTimeFormat : null;
  const use24 = fmtOverride ? (fmtOverride === '24') : use24Hour();
  const ampmOverride = (w.dtAmpmCase && w.dtAmpmCase !== 'default') ? w.dtAmpmCase : null;
  const dataAttr = `${fmtOverride ? ` data-format="${fmtOverride}"` : ''}${ampmOverride ? ` data-ampm="${ampmOverride}"` : ''}`;
  const dateFormat = w.dtDateFormat || globalDateFormat();
  const now = new Date();

  let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  let timeHtml;
  if (use24) {
    // No am/pm in 24-hour mode, so seconds has nothing to stack with —
    // stays an inline suffix same as before.
    const secondsHtml = showSeconds ? `<span class="dt-seconds"${dtSizeStyle(w.dtSecondsSizePx)}>${pad(s)}</span>` : '';
    timeHtml = `<span class="dt-hm"${dtSizeStyle(w.dtTimeSizePx)}>${pad(h)}:${pad(m)}</span>${secondsHtml}`;
  } else {
    const meridiem = h >= 12 ? 'pm' : 'am';
    const ampm = ampmCase(ampmOverride) === 'upper' ? meridiem.toUpperCase() : meridiem;
    h = h % 12 || 12;
    if (showSeconds) {
      // Seconds stacked above am/pm (both smaller, to the right of h:mm) —
      // matches the reference DakBoard-style layout rather than running
      // seconds and am/pm side by side, which is what this looked like
      // before. tickClock()'s per-second update doesn't need to change:
      // it finds .dt-seconds/.dt-ampm by class regardless of nesting depth,
      // and only ever touches textContent, so an inline size style set
      // here at initial render survives every later per-second update.
      timeHtml = `<span class="dt-hm"${dtSizeStyle(w.dtTimeSizePx)}>${h}:${pad(m)}</span><span class="dt-suffix"><span class="dt-seconds"${dtSizeStyle(w.dtSecondsSizePx)}>${pad(s)}</span><span class="dt-ampm"${dtSizeStyle(w.dtAmpmSizePx)}>${ampm}</span></span>`;
    } else {
      timeHtml = `<span class="dt-hm"${dtSizeStyle(w.dtTimeSizePx)}>${h}:${pad(m)}</span><span class="dt-ampm"${dtSizeStyle(w.dtAmpmSizePx)}>${ampm}</span>`;
    }
  }

  const dateHtml = showDate ? `<div class="dt-date"><span class="dt-day-name"${dtSizeStyle(w.dtDaySizePx)}>${DAYS[now.getDay()]}</span><span class="dt-date-str"${dtSizeStyle(w.dtDateSizePx)}>${formatDateFull(now, dateFormat)}</span></div>` : '';

  let tempHtml = '';
  if (showTemp) {
    const wx = weatherForWidget(w);
    if (wx && wx.current) {
      const unit = effectiveWxUnit(w);
      tempHtml = `<div class="dt-temp"${dtSizeStyle(w.dtTempSizePx)}>${formatTemp(wx.current.temperature_2m, unit)}</div>`;
    } else {
      tempHtml = `<div class="dt-temp dt-temp-loading"${dtSizeStyle(w.dtTempSizePx)}>…</div>`;
    }
  }

  return `<div class="w-datetime w-datetime-${style} w-datetime-align-${align}"${dataAttr} style="--dt-font:calc(${fontPx}px * var(--ui-scale,1))">
    <div class="dt-time">${timeHtml}</div>
    ${(dateHtml || tempHtml) ? `<div class="dt-sub">${dateHtml}${tempHtml}</div>` : ''}
  </div>`;
}

// Generic rotation reminders (trash/recycling day and anything else that
// recurs on a schedule but isn't a real calendar event — watering plants,
// medication days, whatever). Deliberately separate from the events/
// calendar system: no title/notes/attendees, just a name+icon+schedule,
// computed via reminderOccursOnDate()/nextReminderOccurrence() (see
// fetchReminders() and its neighbors) so the calendar-grid badges and
// Agenda integration elsewhere in this file can never disagree with what
// this widget itself shows — one shared source of truth for "is X due".
// Four selectable styles (w.remStyle), each showing the same underlying
// data differently rather than needing separate logic per style:
//   'banner'  — one line, whichever reminder is soonest
//   'list'    — every active reminder, always visible, each with its own next-due
//   'hero'    — soonest reminder gets a big treatment, the rest as small chips
//   'week'    — a 7-day strip (Sun–Sat, respecting week_start_day) with icons
//               on the days each reminder falls, today outlined
// Renders a reminder's icon consistently across every context it appears in
// (calendar-day badges, Agenda rows, the management list, and every
// Reminders widget style) — a reminder's icon can be an emoji (default), a
// short text label, or a small uploaded image (icon_type on the reminders
// table, added alongside the existing icon column rather than replacing
// it — icon still holds the emoji OR the text string, icon_image is the
// only genuinely new field). Each call site keeps its OWN existing wrapper
// element/class for sizing (.rem-icon, .rem-chip-icon, .mc-reminder-badge,
// etc. — all originally just held an emoji character, sized via font-size)
// — this only decides what goes INSIDE that wrapper, via em-based sizing,
// so an image or text label scales consistently with whatever context-
// specific size that wrapper already computes rather than needing a fixed
// pixel size special-cased per call site.
// Renders a reminder's icon consistently across every context it appears in
// (calendar-day badges, Agenda rows, the management list, and every
// Reminders widget style) — a reminder's icon can be an emoji (default), a
// short text label, or a small uploaded image (icon_type on the reminders
// table, added alongside the existing icon column rather than replacing
// it — icon still holds the emoji OR the text string, icon_image is the
// only genuinely new field). Each call site keeps its OWN existing wrapper
// element/class for sizing (.rem-icon, .rem-chip-icon, .mc-reminder-badge,
// etc. — all originally just held an emoji character, sized via font-size)
// — this only decides what goes INSIDE that wrapper, via em-based sizing,
// so an image or text label scales consistently with whatever context-
// specific size that wrapper already computes rather than needing a fixed
// pixel size special-cased per call site.
// textScale: an extra multiplier applied only to text-type icons, on top of
// the automatic length-based shrink below — only Mini Calendar's badges
// currently expose this as a per-widget setting (calReminderTextSizePct),
// so every other call site just omits it and gets the default of 1 (no
// change), leaving their text-reminder sizing exactly as it was.
// Same logic as reminderScheduleSummary() in app.html — see that copy for
// the full explanation. Suffixed D to match this file's own convention for
// duplicated copies (escapeHtmlD, nthWeekOptionsD, etc.), and uses DAYS_S
// (this file's existing day-abbreviation constant) instead of a locally
// redefined array.
function reminderScheduleSummaryD(r) {
  const cfg = r.schedule_config || {};
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const nthLabel = (n) => n === -1 ? 'last' : n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  let base = '';
  if (r.schedule_type === 'weekly') {
    const days = (cfg.daysOfWeek || []).map(d => DAYS_S[d]).join(', ');
    const every = (cfg.weekInterval || 1) > 1 ? `Every ${cfg.weekInterval} weeks` : 'Weekly';
    base = days ? `${every} — ${days}` : `${every} — no days set`;
  } else if (r.schedule_type === 'interval') {
    base = `Every ${cfg.intervalDays || '?'} days`;
  } else if (r.schedule_type === 'monthly') {
    const every = (cfg.monthInterval || 1) > 1 ? `Every ${cfg.monthInterval} months` : 'Monthly';
    base = cfg.monthlyMode === 'nthWeekday'
      ? `${every} on the ${nthLabel(cfg.nthWeek)} ${DAYS_S[cfg.nthWeekday]}`
      : `${every} on day ${cfg.dayOfMonth || '?'}`;
  } else if (r.schedule_type === 'yearly') {
    const every = (cfg.yearInterval || 1) > 1 ? `Every ${cfg.yearInterval} years` : 'Yearly';
    const month = monthNames[(cfg.yearlyMonth || 1) - 1];
    base = cfg.yearlyMode === 'nthWeekday'
      ? `${every} on the ${nthLabel(cfg.yearlyNthWeek)} ${DAYS_S[cfg.yearlyNthWeekday]} of ${month}`
      : `${every} on ${month} ${cfg.yearlyDay || '?'}`;
  }
  if (cfg.endType === 'onDate' && cfg.endDate) base += `, until ${cfg.endDate}`;
  else if (cfg.endType === 'afterCount' && cfg.endCount) base += `, ${cfg.endCount}×`;
  return base;
}
function reminderIconHtml(r, textScale) {
  if (!r) return '';
  const type = r.icon_type || 'emoji';
  if (type === 'image' && r.icon_image) {
    return `<img class="rem-icon-img" src="/uploads/${encodeURIComponent(r.icon_image)}" alt="">`;
  }
  if (type === 'text' && r.icon) {
    const len = r.icon.length;
    // Longer labels shrink to still fit a badge originally sized for one
    // emoji character — tuned by eye against the shortest/tightest context
    // (Mini Calendar's day badges), not a measured fit-to-container pass
    // (nothing else in this file measures text width for sizing either).
    const baseScale = len <= 3 ? 1 : len <= 6 ? 0.62 : len <= 9 ? 0.46 : 0.36;
    const scale = baseScale * (textScale || 1);
    return `<span class="rem-icon-text" style="font-size:${scale}em">${escapeHtmlD(r.icon)}</span>`;
  }
  return escapeHtmlD(r.icon || '📌');
}

function renderReminders(widget) {
  const w = widget || {};
  const style = w.remStyle || 'banner';
  const fontPx = w.remFontPx || 22;
  const fontStyle = ` style="--rem-font:calc(${fontPx}px * var(--ui-scale,1))"`;
  const reminders = (state.reminders || []).filter(r => r.active !== 0);
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; })();

  if (!reminders.length) {
    return `<div class="w-reminders w-reminders-empty"${fontStyle}><div class="rem-empty-text">No reminders set up yet</div></div>`;
  }

  // Soonest occurrence per reminder, shared across every style below.
  const withNext = reminders
    .map(r => ({ r, next: nextReminderOccurrence(r, todayStr, 60) }))
    .filter(x => x.next)
    .sort((a, b) => a.next.daysUntil - b.next.daysUntil);

  if (!withNext.length) {
    return `<div class="w-reminders w-reminders-empty"${fontStyle}><div class="rem-empty-text">Nothing due soon</div></div>`;
  }

  const dueLabel = (daysUntil) => daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`;

  if (style === 'list') {
    const rows = withNext.map(({ r, next }) => `
      <div class="rem-row">
        <div class="rem-dot ${next.daysUntil===0?'rem-dot-today':next.daysUntil===1?'rem-dot-tomorrow':''}"></div>
        <div class="rem-icon">${reminderIconHtml(r)}</div>
        <div class="rem-name">${escapeHtmlD(r.name)}</div>
        <div class="rem-when ${next.daysUntil===0?'rem-when-today':next.daysUntil===1?'rem-when-tomorrow':''}">${dueLabel(next.daysUntil)}</div>
      </div>`).join('');
    return `<div class="w-reminders w-reminders-list"${fontStyle}>${rows}</div>`;
  }

  if (style === 'hero') {
    const [{ r: heroR, next: heroNext }, ...rest] = withNext;
    const chips = rest.slice(0, 3).map(({ r, next }) => `
      <div class="rem-chip">
        <div class="rem-chip-icon">${reminderIconHtml(r)}</div>
        <div class="rem-chip-name">${escapeHtmlD(r.name)}</div>
        <div class="rem-chip-when">${next.daysUntil} day${next.daysUntil===1?'':'s'}</div>
      </div>`).join('');
    return `<div class="w-reminders w-reminders-hero"${fontStyle}>
      <div class="rem-hero-main">
        <div class="rem-hero-icon">${reminderIconHtml(heroR)}</div>
        <div>
          <div class="rem-hero-title">${escapeHtmlD(heroR.name)}</div>
          <div class="rem-hero-when">${dueLabel(heroNext.daysUntil)}</div>
        </div>
      </div>
      ${chips ? `<div class="rem-hero-rest">${chips}</div>` : ''}
    </div>`;
  }

  if (style === 'week') {
    const wsd = weekStartDay(w.remWeekStart);
    const today = new Date();
    const todayDow = today.getDay();
    const offsetToStart = (todayDow - wsd + 7) % 7;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - offsetToStart);
    const dayCells = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      const isToday = dateStr === todayStr;
      const dayReminders = reminders.filter(r => reminderOccursOnDate(r, dateStr));
      const icon = dayReminders.length ? reminderIconHtml(dayReminders[0]) : '';
      dayCells.push(`<div class="rem-week-day${dayReminders.length?' rem-week-day-active':''}${isToday?' rem-week-day-today':''}">
        <div class="rem-week-dow">${DAYS_S[d.getDay()]}</div>
        <div class="rem-week-icon">${icon}</div>
      </div>`);
    }
    const leadIcon = reminderIconHtml(withNext[0].r);
    return `<div class="w-reminders w-reminders-week"${fontStyle}>
      <div class="rem-week-title"><span class="rem-week-title-icon">${leadIcon}</span><span class="rem-week-title-text">This Week</span></div>
      <div class="rem-week-strip">${dayCells.join('')}</div>
    </div>`;
  }

  // 'banner' (default)
  const { r, next } = withNext[0];
  const badge = next.daysUntil === 0 ? 'Due today' : next.daysUntil === 1 ? 'Out tonight' : dueLabel(next.daysUntil);
  return `<div class="w-reminders w-reminders-banner"${fontStyle}>
    <div class="rem-icon rem-banner-icon">${reminderIconHtml(r)}</div>
    <div class="rem-banner-text">
      <div class="rem-banner-title">${escapeHtmlD(r.name)}</div>
      <div class="rem-banner-when">${dueLabel(next.daysUntil)}</div>
    </div>
    <div class="rem-banner-badge">${escapeHtmlD(badge)}</div>
  </div>`;
}

// ── Family Message Board widget ───────────────────────────────────────────
// A whiteboard corner, not a chat: short notes household members leave for
// each other, newest first, pinned ones on top. Data lives in state.messages
// (fetchMessages(), kept live via the 'messages' SSE topic). Colour-coded by
// author the same way events are colour-coded by owner — profile colour when
// author_profile_id links to a live profile, else the note's stored color.
function mbNoteColor(msg) {
  if (msg && msg.author_profile_id != null) {
    const c = _profileColorById.get(Number(msg.author_profile_id));
    if (c) return c;
  }
  return (msg && msg.color) || '#4A90D9';
}
// created_at comes from SQLite datetime('now') — 'YYYY-MM-DD HH:MM:SS' in UTC,
// no zone marker — so normalise to ISO-with-Z before parsing.
function mbFmtAgo(createdAt) {
  if (!createdAt) return '';
  const t = Date.parse(String(createdAt).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.round(days / 7);
  return `${wks}w ago`;
}
function renderMessageBoard(widget) {
  const w = widget || {};
  const fontPx = w.mbFontPx || 14;
  const showAuthor = w.mbShowAuthor !== false;
  const showTime = w.mbShowTime !== false;
  const maxShown = Number.isFinite(w.mbMaxNotes) && w.mbMaxNotes > 0 ? w.mbMaxNotes : 8;
  const style = ` style="--mb-font:calc(${fontPx}px * var(--ui-scale,1))"`;
  // Server already orders pinned DESC, created_at DESC — keep that order.
  const notes = (state.messages || []).slice(0, maxShown);

  const head = `<div class="mb-head">
      <div class="mb-head-title">Message Board</div>
      <button class="mb-add-btn" data-interactive="1" aria-label="Add a note">＋</button>
    </div>`;

  if (!notes.length) {
    const empty = editModeActive ? `<div class="mb-empty">No messages yet</div>` : `<div class="mb-list"></div>`;
    return `<div class="w-messageboard"${style}>${head}${empty}</div>`;
  }

  const cards = notes.map(m => {
    const color = mbNoteColor(m);
    const p = m.author_profile_id != null ? profileByIdD(m.author_profile_id) : null;
    let author = '';
    if (showAuthor) {
      if (p) author = `${profileAvatarHtmlD(p, Math.round((w.mbFontPx || 14) * 1.05))}<span class="mb-author">${escapeHtmlD(p.name)}</span>`;
      else if (m.author) author = `<span class="mb-author">${escapeHtmlD(m.author)}</span>`;
    }
    const time = showTime ? `<span class="mb-time">${escapeHtmlD(mbFmtAgo(m.created_at))}</span>` : '';
    return `<div class="mb-card${m.pinned ? ' mb-card-pinned' : ''}" style="--mb-color:${escapeHtmlD(color)}">
      <div class="mb-card-head">
        ${author || `<span class="mb-dot"></span>`}
        ${time}
        <span class="mb-card-head-spacer"></span>
        <button class="mb-pin${m.pinned ? ' mb-pin-on' : ''}" data-interactive="1" data-mb-pin="${m.id}" aria-label="${m.pinned ? 'Unpin' : 'Pin'} note">📌</button>
        <button class="mb-x" data-interactive="1" data-mb-x="${m.id}" aria-label="Remove note">✕</button>
      </div>
      <div class="mb-text">${escapeHtmlD(m.text)}</div>
    </div>`;
  }).join('');

  return `<div class="w-messageboard"${style}>${head}<div class="mb-list">${cards}</div></div>`;
}
function wireMessageBoardTaps() {
  document.querySelectorAll('.w-messageboard .mb-add-btn').forEach(el => {
    if (el._tapWired) return; el._tapWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (editModeActive) return; openMessageAddSheet(); });
  });
  document.querySelectorAll('.w-messageboard [data-mb-x]').forEach(el => {
    if (el._tapWired) return; el._tapWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (editModeActive) return; mbDeleteNote(el.dataset.mbX); });
  });
  document.querySelectorAll('.w-messageboard [data-mb-pin]').forEach(el => {
    if (el._tapWired) return; el._tapWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (editModeActive) return; mbTogglePin(el.dataset.mbPin); });
  });
}
async function mbDeleteNote(id) {
  const note = (state.messages || []).find(m => String(m.id) === String(id));
  if (!note) return;
  state.messages = (state.messages || []).filter(m => String(m.id) !== String(id));
  renderLayout();
  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
  } catch {
    await fetchMessages(); renderLayout();
    showDisplayToast('❌ Could not remove — try again.');
    return;
  }
  showDisplayToast('Removed', { undo: async () => {
    try {
      await fetch('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: note.text, author: note.author || '', author_profile_id: note.author_profile_id || null, color: note.color || undefined }),
      });
    } catch {}
    await fetchMessages(); renderLayout();
  } });
}
async function mbTogglePin(id) {
  const note = (state.messages || []).find(m => String(m.id) === String(id));
  if (!note) return;
  const next = note.pinned ? 0 : 1;
  try {
    const res = await fetch(`/api/messages/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: next }),
    });
    if (!res.ok) throw new Error('pin failed');
  } catch {
    showDisplayToast('❌ Could not update — try again.');
    return;
  }
  await fetchMessages(); renderLayout();
}
// Lightweight add-a-note sheet for someone standing at the wall — a trimmed
// clone of the event-add sheet (just a textarea + Post/Cancel). Wall-posted
// notes carry no author (see the spec §7): a visitor jotting "dentist moved
// to 3pm" doesn't need a name on it. Built on demand so it costs nothing on
// screens that never use it.
function openMessageAddSheet() {
  let overlay = document.getElementById('mb-add-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mb-add-overlay';
    overlay.innerHTML = `
      <div id="mb-add-card" role="dialog" aria-modal="true" aria-label="Add a note">
        <button id="mb-add-close" aria-label="Close">✕</button>
        <div id="mb-add-heading">Add a note</div>
        <textarea id="mb-add-text" maxlength="280" rows="3" placeholder="Leave a note for the family…"></textarea>
        <div id="mb-add-error" class="ea-error" style="display:none"></div>
        <div class="ea-actions">
          <button id="mb-add-cancel">Cancel</button>
          <button id="mb-add-save">Post</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('mb-add-close').addEventListener('click', close);
    document.getElementById('mb-add-cancel').addEventListener('click', close);
    document.getElementById('mb-add-save').addEventListener('click', async () => {
      const ta = document.getElementById('mb-add-text');
      const err = document.getElementById('mb-add-error');
      const save = document.getElementById('mb-add-save');
      const text = (ta.value || '').trim();
      if (!text) { err.textContent = 'Type a note first.'; err.style.display = 'block'; return; }
      save.disabled = true; save.textContent = 'Posting…';
      try {
        const res = await fetch('/api/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error('post failed');
        close();
        await fetchMessages(); renderLayout();
      } catch {
        err.textContent = 'Could not post — try again.'; err.style.display = 'block';
      } finally {
        save.disabled = false; save.textContent = 'Post';
      }
    });
  }
  document.getElementById('mb-add-text').value = '';
  document.getElementById('mb-add-error').style.display = 'none';
  const save = document.getElementById('mb-add-save');
  save.disabled = false; save.textContent = 'Post';
  overlay.style.display = 'flex';
  setTimeout(() => { try { document.getElementById('mb-add-text').focus(); } catch {} }, 50);
}

// ── Meal Plan widget ──────────────────────────────────────────────────────
// Today + the next mpDays. state.meals is keyed 'YYYY-MM-DD' -> { [slot]: row }.
// Which slots show is w.mpSlots (per-widget) falling back to the household's
// settings.mealplan_slots (default just 'dinner'). Tapping a slot opens a
// small editor. An unplanned slot shows a faint dash — that's the point, it
// prompts planning.
const MP_SLOT_ORDER = ['breakfast', 'lunch', 'dinner'];
const MP_SLOT_ABBR = { breakfast: 'B', lunch: 'L', dinner: 'D' };
const MP_SLOT_NAME = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
function mpAddDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function mpActiveSlots(w) {
  let list = Array.isArray(w && w.mpSlots) && w.mpSlots.length
    ? w.mpSlots
    : String((state.settings && state.settings.mealplan_slots) || 'dinner').split(',');
  list = list.map(s => String(s).trim().toLowerCase()).filter(s => MP_SLOT_ORDER.includes(s));
  if (!list.length) list = ['dinner'];
  return MP_SLOT_ORDER.filter(s => list.includes(s));
}
function renderMealPlan(widget) {
  const w = widget || {};
  const fontPx = w.mpFontPx || 15;
  const days = Math.max(3, Math.min(14, Number(w.mpDays) || 7));
  const style = ` style="--mp-font:calc(${fontPx}px * var(--ui-scale,1))"`;
  const meals = state.meals || {};
  const today = todayStr();
  const slots = mpActiveSlots(w);
  const single = slots.length === 1;
  const slot0 = slots[0];
  // Optional filter: drop days / slot lines that have no meal against them, so
  // the widget only lists what's actually planned. Off by default. Applies in
  // Live Edit too (add meals from the app's Meals tab, or toggle this off).
  const hideEmpty = !!w.mpHideEmpty;

  const rows = [];
  let anyPlanned = false;
  for (let i = 0; i < days; i++) {
    const date = mpAddDays(today, i);
    const [yy, mm, dd] = date.split('-').map(Number);
    const dow = new Date(yy, mm - 1, dd).getDay();
    const dayLabel = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAYS_S[dow];
    const dayMeals = meals[date] || {};

    if (single) {
      const m = dayMeals[slot0];
      if (m) anyPlanned = true;
      if (hideEmpty && !m) continue;
      rows.push(`<div class="mp-row${i === 0 ? ' mp-today' : ''}" data-interactive="1" data-mp-date="${date}" data-mp-slot="${slot0}">
        <span class="mp-day">${escapeHtmlD(dayLabel)}</span>
        <span class="mp-dom">${i > 1 ? dd : ''}</span>
        ${m ? `<span class="mp-title">${escapeHtmlD(m.title)}</span>` : `<span class="mp-empty">—</span>`}
      </div>`);
    } else {
      const visSlots = hideEmpty ? slots.filter(s => dayMeals[s]) : slots;
      slots.forEach(s => { if (dayMeals[s]) anyPlanned = true; });
      if (hideEmpty && !visSlots.length) continue;
      const slotLines = visSlots.map(s => {
        const m = dayMeals[s];
        return `<div class="mp-slotline" data-interactive="1" data-mp-date="${date}" data-mp-slot="${s}">
          <span class="mp-slot">${MP_SLOT_ABBR[s]}</span>
          ${m ? `<span class="mp-title">${escapeHtmlD(m.title)}</span>` : `<span class="mp-empty">—</span>`}
        </div>`;
      }).join('');
      rows.push(`<div class="mp-daygroup${i === 0 ? ' mp-today' : ''}">
        <div class="mp-dayhdr"><span class="mp-day">${escapeHtmlD(dayLabel)}</span><span class="mp-dom">${i > 1 ? dd : ''}</span></div>
        ${slotLines}
      </div>`);
    }
  }

  // With hideEmpty off the list always has `days` rows, so it's never blank;
  // with hideEmpty on and nothing planned it would be, so show a line.
  const empty = (!rows.length && w.mpHideEmpty)
    ? `<div class="mp-hint">Nothing planned yet</div>` : '';
  const heading = single
    ? (slot0 === 'dinner' ? "This Week's Dinners" : `This Week's ${MP_SLOT_NAME[slot0]}`)
    : "This Week's Meals";

  return `<div class="w-mealplan"${style}>
    <div class="mp-head">${heading}</div>
    <div class="mp-list${single ? '' : ' mp-multi'}">${rows.join('')}</div>
    ${empty}
  </div>`;
}
function wireMealPlanTaps() {
  document.querySelectorAll('.w-mealplan [data-mp-date][data-mp-slot]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (editModeActive) return; openMealEditSheet(el.dataset.mpDate, el.dataset.mpSlot); });
  });
}
function openMealEditSheet(date, slot) {
  slot = MP_SLOT_ORDER.includes(slot) ? slot : 'dinner';
  let overlay = document.getElementById('mp-edit-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'mp-edit-overlay';
    overlay.innerHTML = `
      <div id="mp-edit-card" role="dialog" aria-modal="true" aria-label="Plan a meal">
        <button id="mp-edit-close" aria-label="Close">✕</button>
        <div id="mp-edit-heading">Dinner</div>
        <input type="text" id="mp-edit-title" maxlength="80" placeholder="Tacos, leftovers, Grandma's…">
        <textarea id="mp-edit-notes" maxlength="300" rows="2" placeholder="Notes (optional)"></textarea>
        <div id="mp-edit-error" class="ea-error" style="display:none"></div>
        <div class="ea-actions">
          <button id="mp-edit-clear">Clear</button>
          <button id="mp-edit-save">Save</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('mp-edit-close').addEventListener('click', close);
    const submit = async (title) => {
      const err = document.getElementById('mp-edit-error');
      const save = document.getElementById('mp-edit-save');
      const clr = document.getElementById('mp-edit-clear');
      save.disabled = clr.disabled = true;
      try {
        const res = await fetch(`/api/meals/${overlay.dataset.date}/${overlay.dataset.slot}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, notes: document.getElementById('mp-edit-notes').value || '' }),
        });
        if (!res.ok) throw new Error('save failed');
        close();
        await fetchMeals(); renderLayout();
      } catch {
        err.textContent = 'Could not save — try again.'; err.style.display = 'block';
        save.disabled = clr.disabled = false;
      }
    };
    document.getElementById('mp-edit-save').addEventListener('click', () => {
      const t = (document.getElementById('mp-edit-title').value || '').trim();
      if (!t) { const err = document.getElementById('mp-edit-error'); err.textContent = 'Enter a meal, or tap Clear.'; err.style.display = 'block'; return; }
      submit(t);
    });
    document.getElementById('mp-edit-clear').addEventListener('click', () => submit(''));
  }
  overlay.dataset.date = date;
  overlay.dataset.slot = slot;
  const m = ((state.meals || {})[date] || {})[slot] || {};
  const [yy, mm, dd] = date.split('-').map(Number);
  const dow = new Date(yy, mm - 1, dd).getDay();
  document.getElementById('mp-edit-heading').textContent = `${MP_SLOT_NAME[slot]} · ${DAYS_S[dow]} ${MONTHS_S[mm - 1]} ${dd}`;
  document.getElementById('mp-edit-title').value = m.title || '';
  document.getElementById('mp-edit-notes').value = m.notes || '';
  document.getElementById('mp-edit-error').style.display = 'none';
  const save = document.getElementById('mp-edit-save');
  const clr = document.getElementById('mp-edit-clear');
  save.disabled = clr.disabled = false;
  overlay.style.display = 'flex';
  setTimeout(() => { try { document.getElementById('mp-edit-title').focus(); } catch {} }, 50);
}

// ── Camera widget ─────────────────────────────────────────────────────────
// A live RTSP / ONVIF / Home Assistant camera on the wall. The server runs a
// local go2rtc that ingests the stream and repackages it; this widget is just
// a <video-stream> (the vendored go2rtc component) pointed at the WebSocket
// reverse-proxy /api/camera/<id>/ws. state.cameras carries no URLs — only the
// id/name we need. Tap → openCameraOverlay() for a fullscreen look.
function renderCamera(widget) {
  const w = widget || {};
  const showTitle = w.camShowTitle !== false;
  const fit = w.camFit === 'cover' ? 'cover' : 'contain';
  const cam = (state.cameras || []).find(c => String(c.id) === String(w.camId));
  const titleTxt = w.camTitle || (cam && cam.name) || 'Camera';
  const head = showTitle ? `<div class="cam-title">${escapeHtmlD(titleTxt)}</div>` : '';

  if (!w.camId || !cam) {
    const hint = editModeActive
      ? `<div class="cam-hint">Choose a camera in this widget's settings</div>`
      : '';
    return `<div class="w-camera">${head}<div class="cam-frame cam-empty"><div class="cam-emoji">📹</div>${hint}</div></div>`;
  }
  if (_cameraServiceState === 'downloading') {
    return `<div class="w-camera">${head}<div class="cam-frame cam-empty"><div class="cam-emoji">📹</div><div class="cam-hint">Setting up the camera service…</div></div></div>`;
  }
  if (_cameraServiceState === 'unavailable') {
    return `<div class="w-camera">${head}<div class="cam-frame cam-empty"><div class="cam-hint">Camera support needs the current installer on this display — or run the server on Docker / Windows.</div></div></div>`;
  }
  // The <video-stream> gets its src wired in wireCameraStreams() (it's a JS
  // property setter, not an attribute) so we can also set background/media/
  // muted first and kill the built-in controls.
  return `<div class="w-camera" style="--cam-fit:${fit}">
    ${head}
    <div class="cam-frame" data-interactive="1" data-cam-id="${cam.id}">
      <video-stream data-cam-src="/api/camera/${cam.id}/ws" data-cam-poster="/api/camera/${cam.id}/frame.jpeg"></video-stream>
    </div>
  </div>`;
}
function wireCameraStreams() {
  document.querySelectorAll('.w-camera video-stream[data-cam-src]').forEach(el => {
    if (el._camWired) return;
    el._camWired = true;
    try {
      el.background = true;          // keep streaming even if the tab hides (kiosk never hides; a phone preview benefits)
      el.media = 'video';           // no audio negotiation — it's a wall display
      el.mode = 'webrtc,mse,mjpeg'; // WebRTC first (co-located go2rtc), fall back through MSE to MJPEG
      if (el.video) { el.video.controls = false; el.video.muted = true; if (el.dataset.camPoster) el.video.poster = el.dataset.camPoster; }
      el.src = el.dataset.camSrc;   // setter -> connects
      // oninit() may run a tick later on first paint; make sure controls stay off.
      setTimeout(() => { if (el.video) { el.video.controls = false; el.video.muted = true; if (el.dataset.camPoster && !el.video.poster) el.video.poster = el.dataset.camPoster; } }, 0);
    } catch (e) { console.warn('camera wire failed', e); }
  });
}
function wireCameraTaps() {
  document.querySelectorAll('.w-camera .cam-frame[data-cam-id]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', () => {
      if (editModeActive) return;
      openCameraOverlay(el.dataset.camId);
    });
  });
  maybePollCameraService();
}
// While the media service is coming up (first-run binary download, or go2rtc
// still starting), re-check its state every few seconds so the widget swaps
// from "Setting up…" to the live view on its own. Stops once it settles.
let _camServicePollTID = null;
function maybePollCameraService() {
  const hasCam = (state.layout || []).some(w => w && w.type === 'camera' && w.camId);
  const transient = _cameraServiceState === 'downloading' || _cameraServiceState === 'starting' || _cameraServiceState === 'unknown';
  if (!hasCam || !transient) { if (_camServicePollTID) { clearInterval(_camServicePollTID); _camServicePollTID = null; } return; }
  if (_camServicePollTID) return;
  _camServicePollTID = setInterval(async () => {
    let s = '';
    try { s = (await (await fetch('/api/camera/service')).json()).state; } catch {}
    if (s && s !== _cameraServiceState) { _cameraServiceState = s; renderLayout(); }
    if (s && s !== 'downloading' && s !== 'starting') { clearInterval(_camServicePollTID); _camServicePollTID = null; }
  }, 4000);
}
function openCameraOverlay(camId) {
  const cam = (state.cameras || []).find(c => String(c.id) === String(camId));
  if (!cam) return;
  let overlay = document.getElementById('camera-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'camera-overlay';
    overlay.innerHTML = `
      <button id="camera-overlay-close" aria-label="Close">✕</button>
      <div id="camera-overlay-title"></div>
      <div id="camera-overlay-frame"></div>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.style.display = 'none';
      const f = document.getElementById('camera-overlay-frame');
      if (f) f.innerHTML = ''; // drop the extra go2rtc consumer
    };
    document.getElementById('camera-overlay-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.style.display === 'flex') close(); });
  }
  document.getElementById('camera-overlay-title').textContent = cam.name || 'Camera';
  const frame = document.getElementById('camera-overlay-frame');
  frame.innerHTML = '';
  const vs = document.createElement('video-stream');
  vs.background = true;
  vs.media = 'video';
  vs.mode = 'webrtc,mse,mjpeg';
  frame.appendChild(vs);
  vs.src = `/api/camera/${cam.id}/ws`;
  setTimeout(() => { if (vs.video) { vs.video.controls = false; vs.video.muted = true; vs.video.poster = `/api/camera/${cam.id}/frame.jpeg`; } }, 0);
  overlay.style.display = 'flex';
}

// ═══ Flight Map widget (live ADS-B) ═════════════════════════════════════════
// Self-drawn world map on <canvas> + aircraft polled from /api/flightmap/*.
// The basemap (land + country borders) is a TopoJSON downloaded once by the
// server and decoded here into two Path2Ds; drawing is then just a
// transform + fill/stroke, cheap enough to redraw on a weak Pi. Aircraft
// dead-reckon between polls so they glide.
const FM_DEG = Math.PI / 180;
function fmMercY(lat) { const l = Math.max(-85, Math.min(85, lat)) * FM_DEG; return Math.log(Math.tan(Math.PI / 4 + l / 2)) / FM_DEG; }
function fmDurLabel(m) { return m >= 60 ? fmtNum(m / 60, m % 60 === 0 ? 0 : 1) + ' h' : m + ' min'; }

const _fmBasemap = { dlState: 'idle', land: null, border: null, stateLines: null, stateAttempts: 0, promise: null };
let _fmBasemapPollTID = null;
const _fmInst = new Map();  // widget id -> render instance

// TopoJSON object -> a Path2D of its rings, projected (lon, mercY(lat)).
// TopoJSON object -> a flat list of [lon,lat] rings (no projection yet).
function _fmTopoRings(topo, obj) {
  const out = [];
  const dec = window.TopoLite.decode(topo, obj);
  for (const poly of dec.polygons) for (const ring of poly) out.push(ring);
  return out;
}
// Sutherland-Hodgman: clip a simple polygon (array of [x,y]) against an
// axis-aligned rectangle, one edge of the rectangle at a time. Standard,
// exact — unlike clamping stray points, it can't distort a fill's winding.
function _fmClipRect(pts, x0, y0, x1, y1) {
  function clipSide(input, inside, cross) {
    if (input.length < 3) return [];
    const out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i - 1 + input.length) % input.length];
      const curIn = inside(cur), prevIn = inside(prev);
      if (curIn) { if (!prevIn) out.push(cross(prev, cur)); out.push(cur); }
      else if (prevIn) out.push(cross(prev, cur));
    }
    return out;
  }
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  let poly = pts;
  poly = clipSide(poly, p => p[0] >= x0, (a, b) => lerp(a, b, (x0 - a[0]) / (b[0] - a[0])));
  poly = clipSide(poly, p => p[0] <= x1, (a, b) => lerp(a, b, (x1 - a[0]) / (b[0] - a[0])));
  poly = clipSide(poly, p => p[1] >= y0, (a, b) => lerp(a, b, (y0 - a[1]) / (b[1] - a[1])));
  poly = clipSide(poly, p => p[1] <= y1, (a, b) => lerp(a, b, (y1 - a[1]) / (b[1] - a[1])));
  return poly;
}
// Project [lon,lat] rings into a SCREEN-space Path2D for the current view.
// A single pre-projected world path + ctx.scale() had two problems: an
// antimeridian-crossing ring (Russia, Antarctica) drew a line straight across
// the map, and zoomed in, the untouched rest of the world projected tens of
// thousands of pixels past every edge — Skia silently dropped a fill that
// large. Fix: split rings at any edge too long to be real coastline (handles
// the antimeridian), then CLIP each piece to a window around the current view
// before projecting, so the path Skia actually rasterises never exceeds a
// couple of panel-widths regardless of zoom. Real clipping, not clamping —
// clamping distorts which pixels are "inside" and silently over-fills.
// Shared by both path builders below: the view's clip window (in lon /
// mercY-lat "projected" degrees, generous by a fixed PIXEL margin converted
// to degrees — a flat degree margin would be tiny at low zoom but balloon to
// thousands of screen pixels at high zoom, defeating the point), plus
// splitting a ring into pieces at any edge too long to be real coastline (a
// 50m dataset's edges are well under 2°) — an antimeridian wrap or a stray
// decode discontinuity.
function _fmClipWindow(v, W, H) {
  const cMY = fmMercY(v.centerLat);
  const marginPx = 150;
  const halfW = (W / 2 + marginPx) / v.zoom, halfH = (H / 2 + marginPx) / v.zoom;
  return { cLon: v.centerLon, cMY, x0: v.centerLon - halfW, x1: v.centerLon + halfW, y0: cMY - halfH, y1: cMY + halfH };
}
function _fmSplitRing(ring) {
  const pieces = [[]];
  let prevLon = null, prevLat = null;
  for (const pt of ring) {
    const lon = pt[0], lat = pt[1];
    if (prevLon !== null && (Math.abs(lon - prevLon) > 180 || Math.hypot(lon - prevLon, lat - prevLat) > 30)) pieces.push([]);
    pieces[pieces.length - 1].push([lon, fmMercY(lat)]);
    prevLon = lon; prevLat = lat;
  }
  return pieces;
}
// A filled shape (land): real polygon clipping. The clip-boundary segments
// Sutherland-Hodgman inserts are invisible/correct as part of an area fill.
function _fmRingsPath(rings, v, W, H) {
  const p = new Path2D();
  if (!rings || !rings.length) return p;
  const { cMY, x0, x1, y0, y1 } = _fmClipWindow(v, W, H);
  for (const ring of rings) {
    for (let poly of _fmSplitRing(ring)) {
      if (poly.length < 3) continue;
      // Shift by whichever multiple of 360° brings this piece near the clip
      // window — Russia's lon run near -170 needs +360 to sit next to a
      // window centred past +170, and vice versa.
      const avgLon = poly.reduce((s, q) => s + q[0], 0) / poly.length;
      if (avgLon < x0 - 180) poly = poly.map(q => [q[0] + 360, q[1]]);
      else if (avgLon > x1 + 180) poly = poly.map(q => [q[0] - 360, q[1]]);
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const q of poly) { if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0]; if (q[1] < by0) by0 = q[1]; if (q[1] > by1) by1 = q[1]; }
      if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue; // no overlap with the view — skip entirely
      const clipped = _fmClipRect(poly, x0, y0, x1, y1);
      if (clipped.length < 3) continue;
      let started = false;
      for (const q of clipped) {
        const sx = W / 2 + (q[0] - v.centerLon) * v.zoom, sy = H / 2 - (q[1] - cMY) * v.zoom;
        if (!started) { p.moveTo(sx, sy); started = true; } else p.lineTo(sx, sy);
      }
      p.closePath();
    }
  }
  return p;
}
// Liang-Barsky: clip a single segment to an axis-aligned rect. Returns the
// visible portion as [x0,y0,x1,y1], or null if none of it is inside.
function _fmClipSegment(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const edges = [[-dx, x0 - xmin], [dx, xmax - x0], [-dy, y0 - ymin], [dy, ymax - y0]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}
// A stroked outline (country borders, state lines): clip each EDGE
// independently instead of the whole polygon. Polygon clipping (_fmRingsPath)
// is wrong here — filling in the rectangle's own edges where a huge landmass
// gets cut off is invisible on a fill but draws as a bogus straight line
// (exactly the diagonal streak this was built to fix) when stroked. Per-edge
// clipping only ever draws pieces of the real coastline, never a seam.
function _fmStrokeRingsPath(rings, v, W, H) {
  const p = new Path2D();
  if (!rings || !rings.length) return p;
  const { x0, x1, y0, y1 } = _fmClipWindow(v, W, H);
  const proj = (q) => [W / 2 + (q[0] - v.centerLon) * v.zoom, H / 2 - (q[1] - fmMercY(v.centerLat)) * v.zoom];
  for (const ring of rings) {
    for (let piece of _fmSplitRing(ring)) {
      if (piece.length < 2) continue;
      // Whole-piece bbox reject BEFORE walking every edge — at anything but a
      // world-spanning view, most of the ~100k border points belong to a
      // continent nowhere near the window; this turns that into an O(1) skip
      // per piece instead of O(edges). Same antimeridian re-centring as the
      // fill path, for the same reason (a piece near -170° needs +360° to
      // land next to a window centred past +170°, and vice versa).
      const avgLon = piece.reduce((s, q) => s + q[0], 0) / piece.length;
      if (avgLon < x0 - 180) piece = piece.map(q => [q[0] + 360, q[1]]);
      else if (avgLon > x1 + 180) piece = piece.map(q => [q[0] - 360, q[1]]);
      let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      for (const q of piece) { if (q[0] < bx0) bx0 = q[0]; if (q[0] > bx1) bx1 = q[0]; if (q[1] < by0) by0 = q[1]; if (q[1] > by1) by1 = q[1]; }
      if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
      for (let i = 1; i < piece.length; i++) {
        const a = piece[i - 1], b = piece[i];
        if ((a[0] < x0 && b[0] < x0) || (a[0] > x1 && b[0] > x1) || (a[1] < y0 && b[1] < y0) || (a[1] > y1 && b[1] > y1)) continue; // both on the same outside side — cheap reject
        const clipped = _fmClipSegment(a[0], a[1], b[0], b[1], x0, y0, x1, y1);
        if (!clipped) continue;
        const s0 = proj([clipped[0], clipped[1]]), s1 = proj([clipped[2], clipped[3]]);
        p.moveTo(s0[0], s0[1]);
        p.lineTo(s1[0], s1[1]);
      }
    }
  }
  return p;
}
async function ensureFmBasemap() {
  const statesDone = !!_fmBasemap.stateLines || (_fmBasemap.stateAttempts || 0) >= 5;
  if (_fmBasemap.land && statesDone) return true;
  if (_fmBasemap.promise) return _fmBasemap.promise;
  _fmBasemap.promise = (async () => {
    try {
      if (!window.TopoLite) return false;
      if (!_fmBasemap.land) {
        const st = await fetch('/api/flightmap/basemap').then(r => r.json()).catch(() => ({}));
        _fmBasemap.dlState = st.state || 'idle';
        if (st.state !== 'ready') return false;
        const topo = await fetch('/api/flightmap/basemap.json').then(r => r.json());
        _fmBasemap.land = _fmTopoRings(topo, 'land');
        _fmBasemap.border = _fmTopoRings(topo, 'countries');
        _fmBasemap.dlState = 'ready';
      }
      // state / province lines — best-effort, never blocks the world map
      if (!_fmBasemap.stateLines && (_fmBasemap.stateAttempts || 0) < 5) {
        _fmBasemap.stateAttempts = (_fmBasemap.stateAttempts || 0) + 1;
        try {
          const sr = await fetch('/api/flightmap/states.json');
          if (sr.ok) { const stopo = await sr.json(); _fmBasemap.stateLines = _fmTopoRings(stopo, 'states'); }
        } catch {}
      }
      return !!_fmBasemap.land;
    } catch (e) { return false; }
    finally { _fmBasemap.promise = null; }
  })();
  return _fmBasemap.promise;
}
function maybePollFmBasemap() {
  const wanted = (state.layout || []).some(w => w && w.type === 'flightmap');
  const done = _fmBasemap.land && (_fmBasemap.stateLines || (_fmBasemap.stateAttempts || 0) >= 5);
  if (!wanted || done) { if (_fmBasemapPollTID) { clearInterval(_fmBasemapPollTID); _fmBasemapPollTID = null; } return; }
  if (_fmBasemapPollTID) return;
  _fmBasemapPollTID = setInterval(async () => {
    const ok = await ensureFmBasemap();
    if (ok) { clearInterval(_fmBasemapPollTID); _fmBasemapPollTID = null; renderFmAll(); }
  }, 5000);
}

// ── per-query data fetch ──
function fmQueryParams(w) {
  const p = new URLSearchParams();
  const s = w.fmSubject || 'filter';
  if (s === 'flight') {
    p.set('subject', 'flight');
    const k = w.fmFlightKind === 'reg' ? 'reg' : (w.fmFlightKind === 'hex' ? 'hex' : 'callsign');
    p.set(k, w.fmFlightValue || '');
  } else if (s === 'watch') {
    p.set('subject', 'watch');
    if (w.fmWatchProfileId != null && w.fmWatchProfileId !== '') p.set('profileId', w.fmWatchProfileId);
  } else {
    p.set('subject', 'filter');
    const f = w.fmFilter || {};
    if (f.mil) p.set('mil', '1');
    else if (f.type) p.set('type', f.type);
    else if (f.squawk) p.set('squawk', f.squawk);
    else if (f.airline && f.lat != null && f.lon != null) { p.set('radiusNm', f.radiusNm || 250); p.set('lat', f.lat); p.set('lon', f.lon); p.set('callsignPrefix', f.airline); }
    else if (f.radiusNm && f.lat != null && f.lon != null) { p.set('radiusNm', f.radiusNm); p.set('lat', f.lat); p.set('lon', f.lon); }
    if (f.milOnly && !f.mil) p.set('milOnly', '1');
  }
  if (w.fmTrailMin) p.set('trailMin', w.fmTrailMin);
  return p;
}
function fmKey(w) { return fmQueryParams(w).toString(); }

let _fmFetchInFlight = new Set();
async function fetchFlightmap(force) {
  const widgets = (state.layout || []).filter(w => w && w.type === 'flightmap');
  const keys = new Set();
  for (const w of widgets) {
    const key = fmKey(w);
    if (keys.has(key)) continue;
    keys.add(key);
    const cur = state.flightmap[key];
    if (!force && cur && Date.now() - cur.at < 8000) continue;
    if (_fmFetchInFlight.has(key)) continue;
    _fmFetchInFlight.add(key);
    try {
      const d = await fetch('/api/flightmap/state?' + key).then(r => r.json());
      const now = Date.now();
      for (const a of (d.aircraft || [])) a._at = now;
      state.flightmap[key] = {
        at: now, aircraft: d.aircraft || [], trailSeed: d.trailSeed || {},
        degraded: !!d.degraded, source: d.source || null,
      };
    } catch (e) { /* keep last */ }
    finally { _fmFetchInFlight.delete(key); }
  }
  // drop stale keys no widget uses any more
  for (const k of Object.keys(state.flightmap)) if (!keys.has(k)) delete state.flightmap[k];
  renderFmAll();
}
let _fmPollTID = null;
function startFmPolling() {
  if (_fmPollTID) return;
  _fmPollTID = setInterval(() => {
    if ((state.layout || []).some(w => w && w.type === 'flightmap')) fetchFlightmap(false);
  }, 12000);
}

// ── widget HTML ──
function renderFlightMap(widget) {
  const w = widget || {};
  const showData = w.fmShowData !== false;
  return `<div class="w-flightmap" data-widget-id="${w.id}" data-fm-key="${escapeHtmlD(fmKey(w))}">
    <canvas class="fm-base"></canvas>
    <canvas class="fm-air"></canvas>
    <div class="fm-badge"></div>
    ${showData ? '<div class="fm-data" hidden></div>' : ''}
    <button class="fm-expand" title="Expand" aria-label="Expand">⛶</button>
    <div class="fm-empty" hidden></div>
  </div>`;
}

// ── projection helpers ──
function fmProject(lat, lon, view, W, H) {
  return {
    x: W / 2 + (lon - view.centerLon) * view.zoom,
    y: H / 2 - (fmMercY(lat) - fmMercY(view.centerLat)) * view.zoom,
  };
}
function fmDeadReckon(a, now) {
  if (a.onGround || !a.gsKts || a.trackDeg == null) return { lat: a.lat, lon: a.lon };
  const dt = Math.max(0, (now - (a._at || now)) / 1000);
  const nm = a.gsKts * dt / 3600;
  const dLat = (nm / 60) * Math.cos(a.trackDeg * FM_DEG);
  const dLon = (nm / 60) * Math.sin(a.trackDeg * FM_DEG) / Math.max(0.2, Math.cos(a.lat * FM_DEG));
  return { lat: a.lat + dLat, lon: a.lon + dLon };
}
function fmDesiredView(w, data, W, H) {
  const s = w.fmSubject || 'filter';
  const ac = (data && data.aircraft) || [];
  if (s === 'flight' || s === 'watch') {
    const tgt = ac[0];
    const inst = _fmInst.get(w.id);
    if (tgt) { if (inst) inst.lastTarget = { lat: tgt.lat, lon: tgt.lon }; }
    const c = tgt || (inst && inst.lastTarget);
    if (c) { const span = 16; return { centerLat: c.lat, centerLon: c.lon, zoom: Math.max(W, H) / span }; }
    return { centerLat: 30, centerLon: -40, zoom: W / 360 };
  }
  const f = w.fmFilter || {};
  if (f.radiusNm && f.lat != null && f.lon != null) {
    // Fit the radius circle's bounding box into the viewport, correcting for
    // the Mercator stretch at this latitude (a naive radius/60 degrees is
    // ~25% off at mid-latitudes, so the shown area didn't match the radius).
    const cLat = +f.lat, cLon = +f.lon, rLat = Math.max(0.25, (+f.radiusNm) / 60);
    const ySpan = fmMercY(Math.min(85, cLat + rLat)) - fmMercY(Math.max(-85, cLat - rLat));
    const xSpan = 2 * rLat / Math.max(0.2, Math.cos(cLat * FM_DEG));
    return { centerLat: cLat, centerLon: cLon, zoom: Math.max(0.15, Math.min((W * 0.9) / xSpan, (H * 0.9) / ySpan)) };
  }
  // an explicit centre pins mil/type/squawk to a region (spanNm across); no
  // centre = a fixed near-hemisphere view so the map doesn't wander.
  if (f.centerLat != null && f.centerLon != null && f.centerLat !== '' && f.centerLon !== '') {
    const spanNm = Math.max(200, Math.min(6000, +f.spanNm || 2600));
    return { centerLat: +f.centerLat, centerLon: +f.centerLon, zoom: Math.max(W, H) / (spanNm / 60) };
  }
  const homeLon = parseFloat(state.settings && state.settings.weather_lon);
  return { centerLat: 25, centerLon: Number.isFinite(homeLon) ? homeLon : -30, zoom: W / 360 };
}

