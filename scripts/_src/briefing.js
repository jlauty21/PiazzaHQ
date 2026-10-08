'use strict';
// Daily briefing email (and the daily feedback digest to the product owner): content assembly, the HTML / text rendering, sending, and the schedules.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/briefing.test.js.
const { forLanguage } = require('./i18n-server.js');

module.exports = function registerBriefing({ path, fs, crypto, nodemailer, PORT, getReachableAddresses, app, IS_DEMO, db, UPLOAD_DIR, localDateStr, localHHMM, isSlave, checkTvSchedules, WMO_DESC, emailFormatTemp, emailTempUnitLabel, getWeatherResolved, fetchUrl, todoistGet, getNews, parseNewsRSS, getStocks, getAllStockTickersFromLayouts, reminderOccursOnDateServer }) {
  // Assembles today's events, tasks, news, and weather into one email, sent at a
  // configured time each day. Gmail SMTP is the only provider wired up right now,
  // but the transporter is built from a `provider` setting so adding others later
  // (Outlook, Yahoo, custom SMTP) just means adding another case below — no rewrite.

  function getEmailSettings() {
    const keys = ['briefing_enabled', 'briefing_time', 'briefing_provider',
                  'briefing_email_user', 'briefing_email_pass', 'briefing_last_sent',
                  'display_name', 'briefing_todoist_project_ids', 'briefing_task_scope',
                  'briefing_weather_format', 'briefing_include_news', 'briefing_news_per_section',
                  'briefing_include_stocks', 'briefing_include_reminders'];
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  function getBriefingRecipients(onlyEnabled = true) {
    const query = onlyEnabled
      ? `SELECT * FROM briefing_recipients WHERE enabled = 1 ORDER BY sort_order ASC, id ASC`
      : `SELECT * FROM briefing_recipients ORDER BY sort_order ASC, id ASC`;
    return db.prepare(query).all();
  }

  // The household language (Settings -> Language); emails are written in it. English is the default.
  function mailT() {
    try { return forLanguage((db.prepare(`SELECT value FROM settings WHERE key = 'ui_language'`).get() || {}).value || 'en'); } catch { return forLanguage('en'); }
  }

  function greetingForTime(date = new Date(), T = forLanguage('en')) {
    const h = date.getHours();
    if (h < 12) return T('Good morning');
    if (h < 17) return T('Good afternoon');
    return T('Good evening');
  }

  function buildMailTransporter(s) {
    if (process.env.PIAZZA_MAIL_CAPTURE_DIR) {          // tests only: record the message instead of sending it
      return { sendMail: async (msg) => {
        if (process.env.PIAZZA_MAIL_CAPTURE_FAIL === '1') throw new Error('simulated mail failure');
        fs.mkdirSync(process.env.PIAZZA_MAIL_CAPTURE_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.PIAZZA_MAIL_CAPTURE_DIR, Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json'), JSON.stringify(msg));
        return { accepted: [msg.to] };
      } };
    }
    if (s.briefing_provider === 'gmail') {
      return nodemailer.createTransport({
        service: 'gmail', // shortcut for smtp.gmail.com:587 with STARTTLS
        auth: { user: s.briefing_email_user, pass: s.briefing_email_pass },
        // Force IPv4. Without this, Node's DNS resolution can hand back an IPv6
        // address for smtp.gmail.com, and on any network with partial/broken
        // outbound IPv6 (common — many home ISPs/routers are like this) the
        // connection fails outright with ENETUNREACH before ever reaching the
        // login step. Unlike a browser, Node doesn't automatically retry on IPv4
        // ("happy eyeballs") — it just fails. This looks exactly like an auth
        // problem at a glance (mail just won't send) but has nothing to do with
        // the app password; forcing IPv4 sidesteps it entirely.
        family: 4,
      });
    }
    // Future providers (Outlook, Yahoo, custom SMTP) would add cases here, e.g.:
    // if (s.briefing_provider === 'outlook') return nodemailer.createTransport({ service: 'hotmail', ... });
    throw new Error(`Unsupported email provider: ${s.briefing_provider}`);
  }

  // Translates a raw Node/nodemailer error into something a parent can actually act
  // on, instead of a string like "connect ENETUNREACH 2607:f8b0:... - Local (:::0)"
  // that reads exactly like a credentials problem but usually isn't one.
  function friendlyMailError(e) {
    const code = e && e.code;
    const msg = String((e && e.message) || e || '');
    if (code === 'EAUTH' || /invalid login|username and password not accepted|BadCredentials/i.test(msg)) {
      return 'Gmail rejected the login — the app password is likely wrong, expired, or was revoked. Generate a fresh one at myaccount.google.com/apppasswords and re-enter it in Settings.';
    }
    if (code === 'ENETUNREACH') {
      return 'Could not reach Gmail\u2019s mail server over the network (this Pi may have broken/partial IPv6 connectivity). This is not an app-password problem.';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return 'Could not resolve smtp.gmail.com — this Pi may not have working internet/DNS access right now.';
    }
    if (code === 'ECONNREFUSED') {
      return 'The connection to Gmail was refused — a firewall on this network may be blocking outbound mail (port 587).';
    }
    if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
      return 'The connection to Gmail timed out — check this Pi\u2019s internet connection.';
    }
    return msg; // fall back to the raw message for anything not specifically recognized
  }

  // Pulls together everything the briefing needs. Reuses the same data-fetching
  // functions the API routes and display use, so the briefing always matches
  // what's actually configured (calendars, Todoist project filters aren't applied
  // here on purpose — the briefing intentionally shows ALL events/tasks for the day).
  async function assembleBriefingContent() {
    const today = localDateStr();

    // Events happening today (span-aware, same logic as the calendar widgets)
    const events = db.prepare(`
    SELECT title, date, end_date, start_time, end_time, color, notes, 'local' as source
    FROM events
    WHERE date <= ? AND COALESCE(end_date, date) >= ?
    ORDER BY start_time ASC
  `).all(today, today);
    const icalEvents = db.prepare(`
    SELECT ie.title, ie.date, ie.end_date, ie.start_time, ie.end_time, ie.notes,
           f.name as feed_name, 'ical' as source
    FROM ical_events ie
    JOIN ical_feeds f ON f.id = ie.feed_id
    WHERE f.enabled = 1 AND ie.date <= ? AND COALESCE(ie.end_date, ie.date) >= ?
    ORDER BY ie.start_time ASC
  `).all(today, today);
    const allEvents = [...events, ...icalEvents].sort((a, b) => {
      if (!a.start_time) return -1;
      if (!b.start_time) return 1;
      return a.start_time < b.start_time ? -1 : 1;
    });

    // Tasks from Todoist — filtered to selected projects if configured, otherwise all
    // projects. Scope controls due-date filtering: 'all' (default) includes every task
    // regardless of due date; 'today' narrows to tasks due today or overdue.
    let tasks = [];
    let tasksError = null;
    const tokenRow = db.prepare(`SELECT value FROM settings WHERE key = 'todoist_token'`).get();
    const projectFilterRow = db.prepare(`SELECT value FROM settings WHERE key = 'briefing_todoist_project_ids'`).get();
    const projectFilterIds = (projectFilterRow?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const taskScopeRow = db.prepare(`SELECT value FROM settings WHERE key = 'briefing_task_scope'`).get();
    const taskScope = taskScopeRow?.value === 'today' ? 'today' : 'all';
    if (tokenRow?.value) {
      try {
        const result = await todoistGet(tokenRow.value, '/api/v1/tasks');
        tasks = result;
        if (taskScope === 'today') {
          tasks = tasks.filter(t => t.due && t.due.date <= today); // due today or overdue
        }
        if (projectFilterIds.length) {
          tasks = tasks.filter(t => projectFilterIds.includes(t.project_id));
        }
      } catch (e) {
        tasksError = e.message;
      }
    }

    // Email content options
    const getS = (k) => db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value;
    const includeNews = getS('briefing_include_news') !== '0';
    const perSection = Math.max(1, Math.min(15, parseInt(getS('briefing_news_per_section')) || 3));
    const includeStocks = getS('briefing_include_stocks') === '1';
    const includeReminders = getS('briefing_include_reminders') !== '0';
    const weatherFormat = getS('briefing_weather_format') === 'hourly' ? 'hourly' : 'summary';

    // Reminders due today — same shared schedule logic every other reminder
    // surface in the app reads from (see reminderOccursOnDateServer() above),
    // so the email can never disagree with the Reminders widget or the
    // calendar-grid badges about what's due.
    let dueReminders = [];
    if (includeReminders) {
      try {
        const allReminders = db.prepare(`SELECT * FROM reminders WHERE active = 1`).all()
          .map(r => ({ ...r, schedule_config: JSON.parse(r.schedule_config) }));
        dueReminders = allReminders.filter(r => reminderOccursOnDateServer(r, today));
      } catch { dueReminders = []; }
    }

    // News — grouped by section (World / National / Local / each keyword), capped at
    // the user's chosen max per section. Uses the same sources configured for the
    // display (Settings → News), so the email mirrors what's on the wall.
    let newsSections = [];
    let newsError = null;
    if (includeNews) {
      try {
        const result = await getNews();
        const items = result.items || [];
        // Preserve the order sections first appear, then cap each.
        const order = [];
        const byGroup = {};
        for (const it of items) {
          const g = it.group || 'News';
          if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
          if (byGroup[g].length < perSection) byGroup[g].push(it);
        }
        newsSections = order.map(g => ({ label: g, items: byGroup[g] }));
      } catch (e) {
        newsError = e.message;
      }
    }

    // Weather
    let weather = null;
    let weatherError = null;
    const latRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lat'`).get();
    const lonRow = db.prepare(`SELECT value FROM settings WHERE key = 'weather_lon'`).get();
    if (latRow?.value && lonRow?.value) {
      try {
        weather = await getWeatherResolved(latRow.value, lonRow.value);
      } catch (e) {
        weatherError = e.message;
      }
    }

    // Stocks (previous-day close) — optional.
    let stocks = null;
    if (includeStocks) {
      try { const r = await getStocks(getAllStockTickersFromLayouts()); stocks = r.quotes || null; } catch { stocks = null; }
    }

    return { today, events: allEvents, tasks, tasksError, taskScope,
             newsSections, newsError, includeNews, weather, weatherError, weatherFormat,
             stocks, includeStocks, dueReminders, includeReminders };
  }

  // Fetches news for a specific scope override used only by the email. Reuses the
  // existing Google News RSS plumbing with a scope-appropriate query/label.
  async function getNewsForScope(scope) {
    const NEWS_LOCALE = 'hl=en-US&gl=US&ceid=US:en';
    let url, label;
    if (scope === 'world') {
      url = `https://news.google.com/rss/headlines/section/topic/WORLD?${NEWS_LOCALE}`; label = 'World';
    } else if (scope === 'national') {
      url = `https://news.google.com/rss/headlines/section/topic/NATION?${NEWS_LOCALE}`; label = 'National';
    } else if (scope === 'local') {
      const loc = (db.prepare(`SELECT value FROM settings WHERE key='news_local_location'`).get()?.value || '').trim();
      if (!loc) return [];
      url = `https://news.google.com/rss/search?q=${encodeURIComponent(loc)}&${NEWS_LOCALE}`; label = loc;
    } else if (scope === 'keywords') {
      const kw = (db.prepare(`SELECT value FROM settings WHERE key='news_keywords'`).get()?.value || '').trim();
      if (!kw) return [];
      url = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&${NEWS_LOCALE}`; label = kw;
    } else {
      url = `https://news.google.com/rss?${NEWS_LOCALE}`; label = 'Top Stories';
    }
    const xml = await fetchUrl(url);
    return parseNewsRSS(xml).slice(0, 10).map(it => ({ ...it, group: label }));
  }

  function fmtBriefingTime(t, T = forLanguage('en')) {
    return T.time(t);
  }

  // Everything a person, a subscribed calendar feed or a news site supplies is text, never markup.
  const escHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  // A link from a news feed only becomes a link if it is an ordinary web address.
  const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? escHtml(String(u).trim()) : '');

  function renderBriefingHTML(content, displayName, recipientName) {
    const T = mailT();
    const dateLabel = T.day(content.today, { weekday: 'long', month: 'long', day: 'numeric' });
    const greeting = greetingForTime(new Date(), T) + (recipientName ? `, ${escHtml(recipientName)}` : '');

    const eventsHtml = content.events.length ? content.events.map(e => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2a3142;width:90px;color:#8b93a7;font-size:13px;vertical-align:top">
        ${e.end_date && e.end_date > e.date ? T('All day') : (e.start_time ? fmtBriefingTime(e.start_time, T) : T('All day'))}
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #2a3142;font-size:14px;color:#e8edf5">
        ${escHtml(e.title)}${e.feed_name ? `<span style="color:#8b93a7;font-size:12px"> · ${escHtml(e.feed_name)}</span>` : ''}
      </td>
    </tr>`).join('') : `<tr><td style="padding:8px 0;color:#8b93a7;font-size:13px">${T('Nothing on the calendar today.')}</td></tr>`;

    // Only rendered as a section at all when something's actually due (see the
    // template below) — unlike Events/Tasks, absence is the COMMON case here
    // (trash day is maybe once or twice a week), so an empty-state row every
    // single day would just be daily clutter rather than useful information.
    // Icon needs its own handling here rather than reusing reminderIconHtml()
    // (display.html-only, browser-side) — an email has no relative-URL base to
    // resolve "/uploads/..." against, and this same function also backs the
    // browser-rendered preview endpoint, so build an absolute URL once and use
    // it for both rather than special-casing email vs. preview.
    const briefingBaseUrl = (() => {
      const addrs = getReachableAddresses();
      return `http://${addrs.tailscale || addrs.lan || 'localhost'}:${PORT}`;
    })();
    const remindersHtml = content.dueReminders.map(r => {
      const iconHtml = r.icon_type === 'image' && r.icon_image
        ? `<img src="${briefingBaseUrl}/uploads/${encodeURIComponent(r.icon_image)}" alt="" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;border-radius:2px">`
        : escHtml(r.icon || '📌');
      return `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #2a3142;font-size:14px;color:#e8edf5">
        ${iconHtml} ${escHtml(r.name)}
      </td>
    </tr>`;
    }).join('');

    const fmtTaskDue = (t) => {
      if (!t.due || !t.due.date) return '';
      if (t.due.date < content.today) return ` <span style="color:#f87171;font-size:12px">(${T('overdue')})</span>`;
      if (t.due.date === content.today) return ` <span style="color:#8b93a7;font-size:12px">(${T('today')})</span>`;
      // Future due date — show it (only relevant when scope is "all")
      const label = T.day(t.due.date, { month: 'short', day: 'numeric' });
      return ` <span style="color:#8b93a7;font-size:12px">(${T('due {date}', { date: label })})</span>`;
    };
    const noTasksMsg = content.taskScope === 'today' ? T('No tasks due today. 🎉') : T('No tasks. 🎉');
    const tasksHtml = content.tasksError
      ? `<p style="color:#8b93a7;font-size:13px">${T('Tasks unavailable:')} ${escHtml(content.tasksError)}</p>`
      : (content.tasks.length ? content.tasks.map(t => `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #2a3142;font-size:14px;color:#e8edf5">
            • ${escHtml(t.content)}${fmtTaskDue(t)}
          </td>
        </tr>`).join('') : `<tr><td style="padding:6px 0;color:#8b93a7;font-size:13px">${noTasksMsg}</td></tr>`);

    // News, grouped into sections (World / National / Local / each keyword), each with
    // a heading and capped at the user's per-section max.
    const newsSectionsHtml = content.newsError
      ? `<p style="color:#8b93a7;font-size:13px">${T('News unavailable:')} ${escHtml(content.newsError)}</p>`
      : (content.newsSections || []).map(section => {
          const rows = section.items.map(n => {
            const href = safeHref(n.link);
            const titleHtml = href
              ? `<a href="${href}" style="color:#e8edf5;text-decoration:none" target="_blank" rel="noopener">${escHtml(n.title)}</a>`
              : escHtml(n.title);
            const publisher = n.source ? `<br><span style="color:#8b93a7;font-size:11px;text-transform:uppercase">${escHtml(n.source)}</span>` : '';
            return `<tr><td style="padding:6px 0;border-bottom:1px solid #2a3142;font-size:13px;color:#e8edf5">${titleHtml}${publisher}</td></tr>`;
          }).join('');
          return `
          <p style="margin:14px 0 6px;color:#7c5cff;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase">${escHtml(section.label)}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
        }).join('');

    // Stocks rows (previous-day close). getStocks() returns an array of indices/tickers.
    const stocksHtml = (content.stocks && content.stocks.length)
      ? content.stocks.map(s => {
          const up = (s.change ?? 0) >= 0;
          const arrow = up ? '▲' : '▼';
          const color = up ? '#34c759' : '#ff5d5d';
          const chg = s.changePct != null ? `${up?'+':''}${s.changePct.toFixed(2)}%` : '';
          const price = s.close != null ? Math.round(s.close * 100) / 100 : null;
          return `<tr>
          <td style="padding:5px 0;border-bottom:1px solid #2a3142;font-size:13px;color:#e8edf5">${escHtml(s.label || s.symbol)}</td>
          <td style="padding:5px 0;border-bottom:1px solid #2a3142;font-size:13px;color:#e8edf5;text-align:right">${price != null ? price.toLocaleString() : '—'}</td>
          <td style="padding:5px 0 5px 12px;border-bottom:1px solid #2a3142;font-size:13px;color:${color};text-align:right;white-space:nowrap">${arrow} ${chg}</td>
        </tr>`;
        }).join('')
      : `<tr><td style="padding:5px 0;color:#8b93a7;font-size:13px">${T('Markets data unavailable')}</td></tr>`;

    // Robust weather for the email. 'summary' groups the day's hourly forecast into
    // morning (6-12), afternoon (12-18), and evening/night (18-24); 'hourly' shows a
    // compact every-3-hours strip. Falls back to the simple high/low if hourly data
    // isn't present.
    let weatherHtml = '';
    if (content.weather) {
      const cur = content.weather.current;
      const todayMax = content.weather.daily.temperature_2m_max[0];
      const todayMin = content.weather.daily.temperature_2m_min[0];
      const fmt = content.weatherFormat || 'summary';
      const hourly = content.weather.hourly;
      const headline = `<p style="font-size:28px;font-weight:300;color:#e8edf5;margin:0">${emailFormatTemp(cur.temperature_2m)}${emailTempUnitLabel()}</p>
      <p style="font-size:13px;color:#8b93a7;margin:4px 0 10px">${T('High {hi} · Low {lo}', { hi: emailFormatTemp(todayMax), lo: emailFormatTemp(todayMin) })}</p>`;

      let detail = '';
      if (hourly && hourly.time && hourly.temperature_2m) {
        // Build index map for today's hours (the API returns hourly from 00:00 today).
        const temps = hourly.temperature_2m, codes = hourly.weather_code || [], pops = hourly.precipitation_probability || [];
        const desc = (c) => { const w = WMO_DESC[c]; if (!w) return ''; const k = 'Weather: ' + w, r = T(k); return r === k ? w : r; };
        if (fmt === 'hourly') {
          const cells = [];
          for (let h = 6; h <= 21; h += 3) {
            if (temps[h] == null) continue;
            const hrLabel = T.english ? `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}` : `${String(h).padStart(2, '0')}:00`;
            const pop = pops[h] != null ? ` · ${pops[h]}%` : '';
            cells.push(`<tr>
            <td style="padding:3px 10px 3px 0;color:#8b93a7;font-size:13px;white-space:nowrap">${hrLabel}</td>
            <td style="padding:3px 0;color:#e8edf5;font-size:13px">${emailFormatTemp(temps[h])} &nbsp;${desc(codes[h])}<span style="color:#8b93a7">${pop}</span></td>
          </tr>`);
          }
          detail = `<table style="border-collapse:collapse;margin-top:2px">${cells.join('')}</table>`;
        } else {
          // summary: average each block
          const block = (a, b, label) => {
            const t = [], c = [], p = [];
            for (let h = a; h < b; h++) { if (temps[h] != null) { t.push(temps[h]); c.push(codes[h]); if (pops[h]!=null) p.push(pops[h]); } }
            if (!t.length) return '';
            const avg = t.reduce((x,y)=>x+y,0)/t.length; // raw average — emailFormatTemp() does the only rounding, after unit conversion
            // pick the "worst"/most-notable code in the block (highest code ~ more significant)
            const code = c.sort((x,y)=>y-x)[0];
            const maxPop = p.length ? Math.max(...p) : null;
            const popTxt = (maxPop != null && maxPop >= 20) ? ` · ${T('{pct}% precip', { pct: maxPop })}` : '';
            return `<tr>
            <td style="padding:4px 12px 4px 0;color:#8b93a7;font-size:13px;white-space:nowrap">${label}</td>
            <td style="padding:4px 0;color:#e8edf5;font-size:13px">${emailFormatTemp(avg)} &nbsp;${desc(code)}<span style="color:#8b93a7">${popTxt}</span></td>
          </tr>`;
          };
          detail = `<table style="border-collapse:collapse;margin-top:2px">
          ${block(6,12,T('Morning'))}${block(12,18,T('Afternoon'))}${block(18,24,T('Evening'))}
        </table>`;
        }
      }
      weatherHtml = headline + detail;
    } else if (content.weatherError) {
      weatherHtml = `<p style="color:#8b93a7;font-size:13px">${T('Weather unavailable')}</p>`;
    } else {
      weatherHtml = `<p style="color:#8b93a7;font-size:13px">${T('No location configured')}</p>`;
    }

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f1320;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f1320;padding:24px 0">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b29;border-radius:16px;overflow:hidden;border:1px solid #2a3142">

        <tr><td style="padding:28px 28px 20px;border-bottom:1px solid #2a3142">
          <p style="margin:0;color:#8b93a7;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase">
            ${escHtml(displayName || T('Daily Briefing'))}
          </p>
          <h1 style="margin:6px 0 0;color:#e8edf5;font-size:22px;font-weight:600">${greeting} 👋</h1>
          <p style="margin:4px 0 0;color:#8b93a7;font-size:14px">${dateLabel}</p>
        </td></tr>

        <tr><td style="padding:20px 28px 4px">
          ${weatherHtml}
        </td></tr>

        <tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">📅 ${T("Today's Events")}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${eventsHtml}</table>
        </td></tr>

        ${content.includeReminders && content.dueReminders.length ? `<tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">🗑️ ${T('Reminders')}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${remindersHtml}</table>
        </td></tr>` : ''}

        <tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">✅ ${content.taskScope === 'today' ? T('Tasks Due Today') : T('Tasks')}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${tasksHtml}</table>
        </td></tr>

        ${content.includeStocks && content.stocks ? `<tr><td style="padding:20px 28px 8px">
          <p style="margin:0 0 8px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">📈 ${T('Markets (prev. close)')}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${stocksHtml}</table>
        </td></tr>` : ''}

        ${content.includeNews ? `<tr><td style="padding:20px 28px 28px">
          <p style="margin:0 0 4px;color:#8b93a7;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase">📰 ${T('News')}</p>
          ${newsSectionsHtml}
        </td></tr>` : ''}

        <tr><td style="padding:16px 28px;background:#0f1320">
          <p style="margin:0;color:#5a6178;font-size:11px;text-align:center">${T('Sent by your Piazza HQ')}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  function renderBriefingText(content, recipientName) {
    const T = mailT();
    const dateLabel = T.day(content.today, { weekday: 'long', month: 'long', day: 'numeric' });
    const greeting = greetingForTime(new Date(), T) + (recipientName ? `, ${recipientName}` : '');
    const lines = [T("{greeting}! Here's your briefing for {date}.", { greeting, date: dateLabel }), ''];

    if (content.weather) {
      const cur = content.weather.current;
      lines.push(`${T('WEATHER:')} ${emailFormatTemp(cur.temperature_2m)}${emailTempUnitLabel()} (${T('High {hi} / Low {lo}', { hi: emailFormatTemp(content.weather.daily.temperature_2m_max[0]), lo: emailFormatTemp(content.weather.daily.temperature_2m_min[0]) })})`, '');
    }

    lines.push(T('EVENTS TODAY:'));
    if (content.events.length) {
      content.events.forEach(e => {
        const time = e.end_date && e.end_date > e.date ? T('All day') : (e.start_time ? fmtBriefingTime(e.start_time, T) : T('All day'));
        lines.push(`  ${time} — ${e.title}`);
      });
    } else {
      lines.push('  ' + T('Nothing scheduled.'));
    }

    lines.push('', content.taskScope === 'today' ? T('TASKS DUE TODAY:') : T('TASKS:'));
    if (content.tasks.length) {
      content.tasks.forEach(t => {
        let suffix = '';
        if (t.due && t.due.date) {
          if (t.due.date < content.today) suffix = ` (${T('overdue')})`;
          else if (t.due.date === content.today) suffix = ` (${T('today')})`;
          else {
            suffix = ` (${T('due {date}', { date: T.day(t.due.date, { month: 'short', day: 'numeric' }) })})`;
          }
        }
        lines.push(`  • ${t.content}${suffix}`);
      });
    } else {
      lines.push(content.taskScope === 'today' ? '  ' + T('Nothing due today.') : '  ' + T('No tasks.'));
    }

    lines.push('', T('NEWS:'));
    if (content.newsSections && content.newsSections.length) {
      content.newsSections.forEach(section => {
        lines.push(`  ${section.label.toUpperCase()}:`);
        section.items.forEach(n => {
          lines.push(`    • ${n.title}${n.source ? ' (' + n.source + ')' : ''}`);
          if (n.link) lines.push(`      ${n.link}`);
        });
      });
    } else {
      lines.push('  ' + T('Unavailable.'));
    }

    return lines.join('\n');
  }

  // Sends the briefing to all enabled recipients, each as a separate personalized
  // email (not one email with multiple To: addresses) — keeps the greeting genuinely
  // personal and means one bad address doesn't block delivery to everyone else.
  // Returns a per-recipient result list so the caller (scheduler or "Send Now") can
  // report partial failures instead of an all-or-nothing outcome.
  async function sendBriefing() {
    const s = getEmailSettings();
    const recipients = getBriefingRecipients(true);

    if (!recipients.length) {
      throw new Error('No recipients yet — add at least one name and email address in Settings.');
    }
    if (!s.briefing_email_user || !s.briefing_email_pass) {
      throw new Error('Email sending isn\'t fully configured yet — fill in the sender account and app password in Settings.');
    }

    const content = await assembleBriefingContent(); // same content for everyone (for now)
    const transporter = buildMailTransporter(s);
    const T = mailT();
    const dateLabel = T.day(content.today, { weekday: 'short', month: 'short', day: 'numeric' });

    const results = [];
    for (const r of recipients) {
      try {
        await transporter.sendMail({
          from: `"${s.display_name || 'Daily Briefing'}" <${s.briefing_email_user}>`,
          to: r.email,
          subject: `${T('Your Daily Briefing')} — ${dateLabel}`,
          text: renderBriefingText(content, r.name),
          html: renderBriefingHTML(content, s.display_name, r.name),
        });
        results.push({ email: r.email, ok: true });
      } catch (e) {
        results.push({ email: r.email, ok: false, error: friendlyMailError(e) });
      }
    }

    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('briefing_last_sent', ?)`).run(content.today);
    return results;
  }

  // Checks once a minute whether it's time to send today's briefing. A minute-granularity
  // poll (rather than computing a precise setTimeout delay) keeps this simple and immune
  // to clock changes, DST, or the server being restarted mid-day.
  function checkBriefingSchedule() {
    if (IS_DEMO) return;
    // A slave must never send the daily email — the host already does. Otherwise the
    // family gets duplicate briefings. The slave mirrors briefing SETTINGS via sync,
    // but only the host actually sends.
    if (isSlave()) return;
    const s = getEmailSettings();
    if (s.briefing_enabled !== '1') return;
    // Only the host sends the briefing. Slaves must never run it, or they'd race the
    // host and (via the shared last-sent flag) suppress the real send. This guard is
    // what was missing — adding a second device silently stopped scheduled briefings.
    if (isSlave()) return;

    const nowHHMM = localHHMM();
    const today = localDateStr();

    if (nowHHMM === (s.briefing_time || '07:00') && s.briefing_last_sent !== today) {
      sendBriefing()
        .then(results => {
          const okCount = results.filter(r => r.ok).length;
          console.log(`Daily briefing sent to ${okCount}/${results.length} recipients`);
        })
        .catch(e => console.error('Daily briefing failed to send:', e.message));
    }
  }
  setInterval(checkBriefingSchedule, 60 * 1000);
  setInterval(checkTvSchedules, 60 * 1000);

  // Sends a digest of unsent feedback to the product owner, then marks those rows
  // sent. Returns the count sent (0 if nothing to send). Reuses the briefing email
  // account for delivery.
  // The feedback digest always goes to the developer (you), regardless of who is
  // running the app — they're submitting bug reports/ideas that only you can act on.
  // Hardcoded on purpose so end users can't redirect feedback to themselves.
  const FEEDBACK_RECIPIENT = 'jlauty@gmail.com';

  async function sendFeedbackDigest() {
    const keys = ['feedback_enabled','briefing_provider',
                  'briefing_email_user','briefing_email_pass'];
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(()=>'?').join(',')})`).all(...keys);
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (s.feedback_enabled !== '1') return 0;

    const pending = db.prepare(`SELECT * FROM feedback WHERE sent = 0 ORDER BY created_at ASC`).all();
    if (!pending.length) return 0; // nothing to send → no email

    const transporter = buildMailTransporter({
      briefing_provider: s.briefing_provider,
      briefing_email_user: s.briefing_email_user,
      briefing_email_pass: s.briefing_email_pass,
    });

    const esc = (t) => String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const KIND_LABEL = { bug:'🐞 Bug', feature:'💡 Feature idea', feedback:'💬 Feedback' };
    const attachments = [];
    const items = pending.map(f => {
      let imgHtml = '';
      if (f.image) {
        const imgPath = path.join(UPLOAD_DIR, f.image);
        if (fs.existsSync(imgPath)) {
          const cid = 'fbimg' + f.id;
          attachments.push({ filename: f.image, path: imgPath, cid });
          imgHtml = `<div style="margin-top:10px"><img src="cid:${cid}" alt="attachment" style="max-width:100%;border-radius:8px;border:1px solid #e3e3e3"></div>`;
        }
      }
      return `
    <div style="border:1px solid #e3e3e3;border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="font-size:13px;color:#666;margin-bottom:6px">
        ${KIND_LABEL[f.kind] || '💬 Feedback'} · ${esc(f.created_at)} UTC${f.device_name ? ' · ' + esc(f.device_name) : ''}${f.app_version ? ' · v' + esc(f.app_version) : ''}
      </div>
      <div style="font-size:15px;color:#111;white-space:pre-wrap">${esc(f.message)}</div>
      ${imgHtml}
    </div>`;
    }).join('');
    const counts = pending.reduce((a,f)=>{a[f.kind]=(a[f.kind]||0)+1;return a;},{});
    const summary = Object.entries(counts).map(([k,n]) => `${n} ${k}${n>1?'s':''}`).join(' · ');

    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto">
    <h2 style="font-size:19px;color:#111">Piazza HQ — feedback digest</h2>
    <p style="color:#555;font-size:14px">${pending.length} new submission${pending.length>1?'s':''} · ${summary}</p>
    ${items}
  </div>`;

    await transporter.sendMail({
      from: s.briefing_email_user,
      to: FEEDBACK_RECIPIENT,
      subject: `Piazza HQ feedback — ${pending.length} new (${summary})`,
      html,
      attachments,
    });

    // Mark them sent so they aren't reported again.
    const ids = pending.map(f => f.id);
    db.prepare(`UPDATE feedback SET sent = 1 WHERE id IN (${ids.map(()=>'?').join(',')})`).run(...ids);
    return pending.length;
  }

  // Once-a-minute check, mirroring the briefing scheduler. Sends at feedback_time,
  // at most once per day, and only when there's something to report.
  function checkFeedbackSchedule() {
    const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN ('feedback_enabled','feedback_time','feedback_last_sent')`).all();
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (s.feedback_enabled !== '1') return;
    const nowHHMM = localHHMM();
    const today = localDateStr();
    if (nowHHMM === (s.feedback_time || '08:00') && s.feedback_last_sent !== today) {
      // Record the attempt date regardless, so we don't retry every minute for an hour.
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('feedback_last_sent', ?)`).run(today);
      sendFeedbackDigest()
        .then(n => { if (n) console.log(`Feedback digest sent (${n} item(s))`); })
        .catch(e => console.error('Feedback digest failed:', e.message));
    }
  }
  // The feedback-digest email was replaced by one-at-a-time feedback (forwarded to the
  // central server in real time) and its settings UI was hidden. This scheduler is now
  // dormant on purpose: it also lacked a host-only guard and used a SHARED last-sent
  // flag, the same bug that broke the daily briefing on a multi-device setup — so rather
  // than patch code slated for removal, it's disabled outright. See "strip dead code"
  // in project notes for cleanup once everything's proven.
  // setInterval(checkFeedbackSchedule, 60 * 1000);

  // PUT /api/briefing-settings — separate from /api/settings so the email password
  // field doesn't get echoed back in every generic settings GET response.
  app.put('/api/briefing-settings', (req, res) => {
    const allowed = ['briefing_enabled', 'briefing_time', 'briefing_provider',
                      'briefing_email_user', 'briefing_email_pass', 'briefing_todoist_project_ids',
                      'briefing_task_scope', 'briefing_weather_format', 'briefing_include_news',
                      'briefing_news_per_section', 'briefing_include_stocks', 'briefing_include_reminders'];
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const tx = db.transaction(() => {
      for (const key of allowed) {
        if (req.body[key] !== undefined) upsert.run(key, String(req.body[key]));
      }
    });
    tx();
    res.json({ ok: true });
  });

  // GET /api/briefing-settings — password is masked, never sent back in full
  app.get('/api/briefing-settings', (req, res) => {
    const s = getEmailSettings();
    res.json({
      briefing_enabled: s.briefing_enabled || '0',
      briefing_time: s.briefing_time || '07:00',
      briefing_provider: s.briefing_provider || 'gmail',
      briefing_email_user: s.briefing_email_user || '',
      briefing_email_pass_set: !!s.briefing_email_pass, // tells the UI a password exists, without exposing it
      briefing_last_sent: s.briefing_last_sent || '',
      briefing_todoist_project_ids: s.briefing_todoist_project_ids || '',
      briefing_task_scope: s.briefing_task_scope || 'all',
      briefing_weather_format: s.briefing_weather_format || 'summary',
      briefing_include_news: s.briefing_include_news || '1',
      briefing_news_per_section: s.briefing_news_per_section || '3',
      briefing_include_stocks: s.briefing_include_stocks || '0',
      briefing_include_reminders: s.briefing_include_reminders || '1',
    });
  });

  return { getEmailSettings, getBriefingRecipients, buildMailTransporter, friendlyMailError, assembleBriefingContent, renderBriefingHTML, renderBriefingText, sendBriefing, checkBriefingSchedule, checkFeedbackSchedule };
};
