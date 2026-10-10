
const COLORS = ['#4A90D9','#7ec8e3','#34d399','#fbbf24','#f87171','#a78bfa','#f472b6','#fb923c'];
const MONTHS = (window.i18n && i18n.months('short')) || ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS   = (window.i18n && i18n.weekdays('short')) || ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// Per-browser preference for which tab the app opens to. Same pattern/
// scope as tabs_autohide and pull_refresh_enabled (defined further down,
// alongside the App Preferences UI that also sets this) — not synced
// across devices, since different people opening this app from their own
// phone may reasonably want different starting tabs (a kid-focused parent
// living in Favorites vs. someone who mostly checks Calendar). Declared
// here, ahead of currentTab's own initialization just below, specifically
// so that init can call it directly — a plain array literal rather than a
// module-level const, so there's no separate declaration this could run
// ahead of.
function getDefaultTab() {
  const valid = ['favorites', 'calendars', 'photos', 'layout', 'displays', 'family', 'settings'];
  try {
    const v = localStorage.getItem('default_tab');
    return valid.includes(v) ? v : 'favorites';
  } catch { return 'favorites'; }
}
let currentTab = getDefaultTab();

// ── "What's New" popup ───────────────────────────────────────────────────────
// Short, friendly, non-technical release notes — deliberately separate from
// CHANGELOG.md, which is written for a developer picking this project back
// up later, not for whoever's actually using the app day to day. Update
// this alongside CHANGELOG.md on every release meant for real use — a
// version bump with no entry here just won't trigger a popup for it,
// silently (not an error), so it's fine to skip purely-internal versions.
const RELEASE_NOTES = {
  '1.92.2': [
    'New: Home Assistant templates are now easy to write. Under the Template box on an Entity Status widget there is a Template wizard with Step by step, Recipes and Insert buttons, a live preview, plain-English error hints, a device search and an Inspect button that shows a device’s details. Put two asterisks around words to make them bold, and pick Left, Center or Right alignment (Template Alignment). Ready-made recipes include washer and dryer, “Laundry swapped?” (using the washer door), doors open, lights on, who is home, and temperature and humidity. More examples are on piazzahq.com/template-cookbook.',
    'New: link a Todoist project or a Google Tasks list to the Family Hub To-Do (Family Hub → To-Do → “Link a list”). It works like any other list, including on the wall display. Adding, ticking and deleting items go straight to Todoist or Google, and removing the link never deletes your list there.',
    'New: Google Tasks in the Tasks widget. Connect it in Settings → Data Sources → Google Tasks, then pick a Google list next to your Todoist projects.',
    'New: Settings are tidier. Google Tasks and Voice Control (Siri Shortcuts) now sit under Data Sources, and Update Backups under Advanced.',
    'Severe weather alerts: ticking an alert type no longer folds the section. It is clearer how the alert types and the minimum severity fit together, and there are “Select all” and “Deselect all” buttons.',
    'Translations: leftover English in German, French and Spanish is now translated, including many error messages.',
    'Raspberry Pi: the kiosk command always uses the current copy, and Wi-Fi power saving turns off at boot.',
    'Other minor security and bug improvements.',
  ],
  '1.92.0': [
    'New: Deutsch, Français and Español. Pick your language on the first setup screen or in Settings → Display. The whole app, the wall display, the kids page and your emails follow it, with local dates, 24-hour time, Monday weeks and your currency. These are first versions, so tell us about any wording that looks off.',
    'New: add a calendar by signing in. In Calendars, choose “Add from your Google account” or “Add from your iCloud account” instead of pasting a link.',
    'New: Google Photos as a photo source. In Family Hub → Photos, connect your account, tap Pick photos, and the photos you choose are copied into your library. Google only shares the photos you pick, so tap it again to add more.',
    'New: an optional private address to reach Piazza HQ from anywhere (Settings → Security → Remote access link), protected by a password you set, with optional email alerts for new sign-ins.',
    'New: Entity Status can show how long something has been in its current state (“Cycle complete · 2 hr. ago”), or the result of a Home Assistant template that you write yourself. The Smart Home Dashboard widget is now called Smart Home Grid.',
    'New: the Web Page widget has a “Let this page keep its sign-in” switch, for pages like a Home Assistant dashboard that need to remember a login.',
    'New: Text shadow (Settings → Display) makes clocks, dates and weather easier to read over photos.',
    'Kids page: a long list of bonus chores no longer pushes a child’s own chores off the screen.',
    'Your wall display now refreshes itself every 6 hours by default (change it in Settings → Display), a Raspberry Pi keeps its Wi-Fi awake so it stays reachable, and a display that comes up blank after a restart repairs itself.',
    'Fixed: calendar events that repeat a set number of times (“weekly, 4 times”) now stop at the right place.',
  ],
  '1.78.1': [
    'Most explanatory text in Settings is now behind a small ⓘ button instead of always taking up space.',
    'Fixed a broken "Copy Link" button on the Devices tab.',
    'Fixed a visual glitch on the Redeem button in a kid\'s sticker sheet.',
    'Stickers can now be backdated to a previous day.',
  ],
  '1.79.0': [
    'New: a Favorites tab — the first thing you\'ll see when you open the app now, with quick-action and at-a-glance cards you pick yourself.',
    'Cards include: giving a sticker, adding a chore, adding to the shopping list, redeeming a reward, today\'s chore progress, sticker balances, weather, shopping list count, screens online, a shortcut to a specific kid, and the Family Hub QR code.',
    'Tapping a status card jumps you straight to the related tab.',
    'New: choose which tab the app opens to (Settings → App Preferences → Default Tab).',
    'New: got an idea for a card that\'s not in the picker? Send it straight to the developer with the "Request a New Card" button.',
    'New: you\'ll now see a banner when the developer replies to feedback you\'ve sent.',
    'The tab bar is a bit more compact so more tabs fit before it scrolls.',
  ],
  '1.79.1': [
    'The Weather card now shows a real forecast — today\'s high/low plus the next few days, not just the current temperature.',
    'A few more Favorites cards now have a "view more" link to jump to the full tab.',
    'Favorites cards are a bit more compact overall.',
    'New: Home Assistant Favorites cards — toggle a light/switch, toggle a whole room/group, fire a scene or script, or adjust a thermostat, all right from Favorites.',
    'New: a Next Up card showing your next calendar event, and To-Do Count / Add a To-Do Item cards.',
    'Fixed font-size limits on many widgets that were capped lower than they should be — Agenda, Weather, Calendar, News, Stocks, To-Do, Shopping List, Chore Chart, and more can all be sized much larger now.',
  ],
  '1.82.0': [
    'New: displays can now switch on a schedule — either at a specific time, or rotating through a list of displays/templates automatically.',
    'Each scheduled switch can be turned on or off individually without losing its settings, and you\'ll now get a warning if two are set to fire at the same time.',
    'If a schedule that was actively overriding what a screen shows gets turned off, the screen now goes back to its own real layout automatically.',
    'New: "Open to Edit in New Tab" sessions get their own section on the Devices tab, name themselves after whatever they\'re previewing, and clean themselves up automatically instead of piling up.',
    'Plus various bug fixes and performance improvements.',
  ],
  '1.83.1': [
    'New: Combo Forecast widget — combines hourly and daily weather into one widget, with four layout styles to choose from (Stacked, Timeline, Split Columns, or Compact Tabs).',
    'Current conditions can be shown right in that same widget, with your choice of layout automatically adjusting to fit it in well.',
    'Plus various bug fixes and improvements.',
  ],
  '1.83.2': [
    'New: tap any calendar event on the display to see its full detail — title, full date/time, which calendar it\'s from, and its description.',
    'New: "Show Location Name" checkbox on every weather widget — turn off the location name and keep just the weather itself.',
    'The Live Editing toolbar can now be moved and minimized, so it\'s easier to work around on a crowded screen.',
    'Plus various bug fixes and improvements.',
  ],
  '1.83.3': [
    'New: Piazza HQ now runs on Windows — a single installer, no separate Node.js install, with the same automatic updates as the Pi. Set it up as a normal control app, or as a full-screen wall display that starts at sign-in.',
    'New: Docker support — run it headless on a NAS, mini PC, or home server you already have, no dedicated hardware or screen required.',
    'New: on the Windows wall display, tap the screen to reveal a button that exits full-screen mode.',
    'Plus various bug fixes and improvements.',
  ],
  '1.83.4': [
    'Fixed a real, serious bug: a screen rotating between displays could — under a specific, now-understood set of conditions — silently overwrite a real, named display\'s own content with whatever the rotation was showing at that moment. Fixed at the actual save function itself, so this can\'t happen through any path.',
    'Fixed: deleting or editing a TV-control schedule slot on a slave device could silently fail (report success but not actually apply).',
    'Improved: the "cut the signal" TV-control option (for monitors without CEC) now tries the display\'s actual sleep signal (DPMS) first, which puts more monitors into a genuine low-power sleep rather than just showing a "no signal" message.',
  ],
  '1.83.5': [
    'Fixed a real bug on Windows: downloading a full backup (or a code backup) could crash the whole server, not just the download — confirmed happening consistently, not a rare edge case.',
    'Security: closed a real gap where certain text — event titles and notes from your calendar (including subscribed calendar feeds), news headlines, and a few other fields — wasn\'t being safely escaped before display. Nothing suggests this was ever exploited; fixed as a precaution across every place it applied.',
    'Fixed: several more actions (installing an update, restoring a backup, the Windows kiosk-exit button) could silently target the wrong device, or fail outright, when run from a secondary/mirror screen.',
    'Fixed: a recurring "every N weeks" event, or a countdown widget, could be off by one day right around a Daylight Saving Time change.',
    'A round of hardening across the app — no other user-visible changes.',
  ],
  '1.85.0': [
    'Family profiles: give each person their own view of the app. Hide the tabs and features they don\'t use, pick a preset (Basic / Intermediate / Advanced), and switch profiles instantly from the avatar in the header. Optional per-profile PIN. With no profiles set up, nothing changes.',
    'Tag an event "for" a family member (added on the wall display) and it colour-codes by that person everywhere; the event list gets a "just mine" filter.',
    'Event locations: the venue or address from a calendar can now show under each event in the Agenda / Upcoming / Today views. Turn it on per calendar in Settings → Calendars, and fine-tune it per widget.',
    'Home Assistant: search for an entity by name or id when picking one, edit an alert rule in place, and set each display\'s alert banner position, size and style independently. Active alerts now also show in the app.',
    'Home Assistant buttons (lights, covers, scenes) respond as soon as the command is accepted instead of waiting for the device to finish moving.',
    'Fixed: a display could switch from portrait to landscape after an update if it reloaded mid-restart.',
  ],
  '1.86.0': [
    'New: a Family Message Board — short notes household members leave for each other, shown on the wall and cleared by anyone. A widget for the display and a Board tab in Family Hub. When family profiles are set up, notes show the poster\'s avatar and name. Off by default (Settings → Features & Family Hub).',
    'New: a weekly Meal Plan — plan breakfast, lunch and/or dinner from the Meals tab in Family Hub, shown as a widget on the wall. "Copy last week" fills the empty slots, and a widget can hide days that aren\'t planned yet. Off by default.',
    'New: a Camera widget — a live RTSP / ONVIF / Home Assistant camera on the wall (Layout → Smart Home), with tap-to-enlarge. Needs some CPU: a Raspberry Pi 4 or 5, or run the server on Docker or Windows. Camera stream URLs stay on the server, never sent to a display.',
    'Fixed: calendar event locations weren\'t showing on the Grid calendar or where the per-calendar / per-widget overrides should have applied. Turning "Show location" on for a calendar now surfaces it everywhere, and the per-widget override wins over everything.',
    'Every widget now follows the display theme properly — several had a fixed dark tint and a fixed blue accent that looked wrong on the lighter themes (Post-it, Cork Board) and any custom theme.',
    'The Message Board, Meal Plan and Camera widgets can now be configured right on the screen in Live Editing, not just from the app.',
    'Feedback replies now open in a full-screen conversation view, and a display no longer comes back blank after an update.',
  ],
  '1.87.0': [
    'New: a Flight Map widget — live aircraft on the wall from free community ADS-B data. Track all military traffic, one or more aircraft types, an airline, everything within a radius of a place, a squawk code, a specific flight, or a family member\'s saved flight. Off by default (Settings → Features).',
    'New: My Flights — each family profile gets a saved-flights list (Settings → Family profiles → edit a person → Manage flights), so a flying family member can add the day\'s flight number from their phone and have the wall pick it up automatically.',
    'New: iCloud Shared Album as a photo source — paste a public shared-album link in Settings → Photos and new photos sync in on a timer alongside your uploads.',
    'New: the Chore Chart widget can show the shared bonus-chore pool on the wall — a toggle adds a strip of what\'s up for grabs today and who\'s already claimed what.',
    'Plus various bug fixes and improvements.',
  ],
  '1.87.2': [
    'New: five more weather details — feels-like temperature, humidity, wind gusts, sunrise/sunset, and UV index — each its own toggle in a weather widget\'s settings, off by default.',
    'New: severe weather alerts (Settings → Severe Weather Alerts) — free US National Weather Service warnings/watches near your location, delivered through the same on-screen banner and phone alerts as Home Assistant alerts.',
    'New: a weather widget\'s location override can now be set by typing a place name, not just a ZIP code.',
    'New: three display templates — Thanksgiving, Hanukkah, and Back to School.',
    'New: the wall display can now notice when its own screen freezes up and restart itself automatically, with a notification when it happens.',
    'Fixed: calendar feeds, place-name location search, and several other features could fail or hang ("Host Unreachable") on networks with partial IPv6 connectivity.',
  ],
  '1.87.5': [
    'Fixed: replies from the developer on a Feedback & Ideas thread weren\'t reaching your device — they\'ll now show up normally, including any that seemed to go missing before.',
    'Fixed: replying to the developer could make the conversation box appear to collapse when you tapped in to type, on iPhone.',
    'Fixed: a display could get stuck showing a white screen on boot even after updating, if it was set up before the fix for that first shipped.',
  ],
  '1.87.6': [
    'Improved: "Other devices on this license" now lives inside Settings → Multi-Device, right next to the host and display controls.',
    'Plus minor app refinements.',
  ],
  '1.87.7': [
    'New: multiple shopping lists — keep a separate list for the regular grocery store, Costco, the pharmacy, and more. Add and switch lists from Family Hub → Shopping, then choose which list each Shopping List widget shows.',
    'New: the Shopping List widget can shrink its text so a long list always fits (on by default — turn it off in the widget\'s settings).',
    'Improved: Shopping List widgets now show up on mirror displays too.',
    'Plus minor app refinements.',
  ],
  '1.87.8': [
    'Fixed: some widgets — including Daily Quote, Air Quality, the Message Board, Reminders, and Flight Map — and photo/image uploads could fail with an error on a device that has an App PIN set. Both now work correctly with a PIN in place.',
  ],
  '1.87.9': [
    'Bug fixes and improvements.',
  ],
  '1.87.10': [
    'Bug fixes and improvements.',
  ],
  '1.87.11': [
    'New: let Home Assistant control this display. Settings → Home Assistant Control gives you two ways to do it — generate a token to wire into Home Assistant\'s rest_command and trigger a screen\'s power or layout (light/dark theme included) from any automation, or connect it to your MQTT broker and a Power switch plus a Layout picker just appear in Home Assistant on their own, no YAML required.',
    'Fixed: the web interface could stop responding from other devices after the Pi had been running for a while, with a reboot the only way to get it back. Found and fixed the underlying cause — it\'s now caught and cleaned up automatically.',
    'Plus various other bug fixes and improvements.',
  ],
  '1.87.12': [
    'New: a third way to connect Home Assistant — a native integration installed through HACS, with its own real setup screen (enter this device\'s address and an automation token, click connect). No YAML, no broker. See Settings → Home Assistant Control for the "Add to Home Assistant" button.',
    'Plus various other bug fixes and improvements.',
  ],
};

// Beta-suffix-aware version compare — same scheme as the mothership server's
// own compareVersions()/cmpVer() (see TURNOVER.md): same x.y.z, a plain
// release always outranks any numbered beta of it; between two betas of the
// same x.y.z, higher beta number wins, compared numerically not as strings.
function compareAppVersions(a, b) {
  const parse = v => {
    const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/);
    if (!m) return { major: 0, minor: 0, patch: 0, beta: null };
    return { major: +m[1], minor: +m[2], patch: +m[3], beta: m[4] ? +m[4] : null };
  };
  const pa = parse(a), pb = parse(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  if (pa.beta === null && pb.beta === null) return 0;
  if (pa.beta === null) return 1;   // plain always outranks a beta of the same x.y.z
  if (pb.beta === null) return -1;
  return pa.beta - pb.beta;
}

// Compares the actual running version (from /api/version, not this file's
// own hardcoded string — that's the SOURCE this popup is written from, not
// necessarily what's live) against the last version this browser has
// acknowledged. Shows notes for every version in between, oldest first, in
// one popup — not one popup per version — so jumping several releases at
// once (e.g. from stable straight onto a beta a few rounds in) doesn't spam
// several popups back to back.
function checkForNewVersionPopup(currentVersion) {
  if (!currentVersion) return;
  let lastSeen = null;
  try { lastSeen = localStorage.getItem('last_seen_version'); } catch {}
  if (!lastSeen) {
    // First time ever this browser has loaded the app (or storage was
    // cleared) — nothing to compare against, and "what's new" doesn't mean
    // anything to someone who's never seen an "old" version. Just record
    // where we're starting from; the Getting Started tour is this case's
    // actual onboarding, not this popup.
    try { localStorage.setItem('last_seen_version', currentVersion); } catch {}
    return;
  }
  if (compareAppVersions(currentVersion, lastSeen) <= 0) return; // same or somehow older — nothing to announce
  const versions = Object.keys(RELEASE_NOTES)
    .filter(v => compareAppVersions(v, lastSeen) > 0 && compareAppVersions(v, currentVersion) <= 0)
    .sort(compareAppVersions);
  try { localStorage.setItem('last_seen_version', currentVersion); } catch {}
  if (!versions.length) return; // version changed, but nothing curated to announce for it — stay silent, not an empty popup
  showWhatsNewPopup(versions);
}
function showWhatsNewPopup(versions) {
  const body = versions.map(v => `
    <div style="margin-bottom:14px">
      <div style="font-weight:700;font-size:13px;color:var(--accent);margin-bottom:6px">v${v}</div>
      <ul style="margin:0;padding-left:18px">
        ${(RELEASE_NOTES[v] || []).map(n => `<li style="margin-bottom:5px;font-size:13.5px;line-height:1.4">${n}</li>`).join('')}
      </ul>
    </div>`).join('');
  showSheet(`
    <h3 style="margin:0 0 12px">✨ What's New</h3>
    <div style="max-height:60vh;overflow-y:auto">${body}</div>
    <button class="btn btn-primary" id="whatsnew-close" style="margin-top:6px">Got it</button>
  `);
  $('whatsnew-close').addEventListener('click', closeSheet);
}

let editingId  = null;
let selectedColor = COLORS[0];
let allEvents = [];

const $ = id => document.getElementById(id);
// Only plain web addresses are usable in a Web Page widget (the display enforces this too).
function wpUrlOk(v){ try { const u = new URL(String(v).trim()); return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname; } catch { return false; } }
function escapeHtml(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Shared clipboard-copy helper — every "copy link" button in this app should
// go through this rather than call navigator.clipboard directly. That API
// requires a secure context (HTTPS or localhost); Piazza HQ is virtually
// always reached over plain HTTP (a LAN IP or Tailscale IP, never TLS), so
// navigator.clipboard is simply undefined in real-world use here, not just
// occasionally unavailable. Falls back to the older execCommand('copy')
// technique (a temporary, invisible, selected textarea), which has no
// secure-context restriction and actually copies rather than just showing
// the text for someone to select manually.
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); showToast('Link copied ✓'); return; }
    catch { /* fall through to the legacy method below */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(ok ? 'Link copied ✓' : 'Could not copy — long-press the link to copy it manually');
  } catch {
    showToast('Could not copy — long-press the link to copy it manually');
  }
}

// Reusable "ⓘ" info button — tap to pop up an explanation, instead of a long
// paragraph always sitting on the page. Built once, used everywhere a section
// used to carry a wordy always-visible <p> of context. Text can include simple
// HTML (e.g. <b>) since callers control it directly, never user input.
window._infoTexts = {
  'alert-banner-help':
    `Controls how a fired Home Assistant alert appears <b>on this screen</b> — each display can differ, so a banner readable across the room on a big TV can be smaller on a nearby tablet.<br><br>
    <b>Position</b>: <b>Top</b> / <b>Bottom</b> are edge strips (the logical edge — they rotate with the layout, so they stay upright on a sideways-mounted screen). <b>Center (card)</b> floats a notification card in the middle of the screen over a dimmed background — hardest to miss.<br><br>
    <b>Text size</b> scales with the screen, so "Large" on a 4K TV is genuinely large. "Huge" is for a big display seen from across a room.<br><br>
    <b>Style</b>: <b>Solid red bar</b> is the default full-width strip. <b>Bold</b> adds heavier framing. <b>Amber</b> is a less-alarming colour. <b>Dark w/ red edge</b> and <b>Dark outline</b> are lower-key. <b>Corner toast</b> is a smaller rounded card in the corner.<br><br>
    Changes apply live — if a banner is currently showing it updates immediately.`,
  'screen-settings-help':
    `Orientation and rotation here follow this physical screen — handy for a TV mounted sideways.<br><br>
    <b>Screensaver Source</b> picks what this screen's screensaver/photo mode draws from — a tag (cycles through every photo with that tag) or one specific photo (no cycling); tag photos in the Photos tab.<br><br>
    <b>Display Mode</b> swaps this screen to just its photo (with or without a clock) instead of the usual widgets — takes effect immediately, no reboot.<br><br>
    If this display's own layout already has a Clock/Date widget, "Photo + time" matches its exact position automatically and the corner picker is just a fallback for when it doesn't. Leave on defaults to inherit/share.`,
  'tv-control-help':
    `<b>CEC</b> needs no setup — it goes out over the same HDMI cable already in use, though input-switching support varies by TV, and many computer monitors don't support CEC at all.<br><br>
    <b>Cut HDMI Signal</b> is for exactly that case: it doesn't ask the display to power off, it just stops sending it a signal and relies on the display's own built-in sleep-on-no-signal behavior — no CEC or network smarts needed, but no input switching either.<br><br>
    <b>Roku</b> needs its IP (no pairing). <b>Samsung</b> needs its IP plus one-time pairing — accept the prompt that appears on the TV screen.<br><br>
    Add as many scheduled times as you like, or none at all.`,
  'photo-fit-help':
    `<b>Fill</b> covers the whole widget but may crop edges.<br><br>
    <b>Fit to width/height</b> shows the entire photo in that dimension and may leave a little space on the other sides.<br><br>
    <b>Auto</b> decides per photo — a photo that matches this widget's own shape gets filled, a mismatched one (e.g. a portrait photo in a landscape widget) is shown whole with a softly blurred version of the same photo filling the gap, instead of always cropping or always leaving bars. Best if this slideshow mixes landscape and portrait photos.`,
  'cal-max-events-help':
    `<b>Auto (0)</b> fits as many events as each day box can hold and collapses the rest into "+X more" — text never spills into another day. Set a number to force a hard cap instead.`,
  'cal-max-lines-help':
    `Caps each day by number of text <b>lines</b> (counting wrapped titles), not events. Use this if events still overflow on your display despite Auto — it's the most reliable limit. <b>Auto (0)</b> uses height-based fitting.`,
  'cal-decor-help':
    `"Post-it notes" draws each day with events as a sticky note. The icon styles mark event days with a festive symbol instead of dots. Templates set this automatically, but you can mix and match here.`,
  'photo-interval-help':
    `This widget's own cycle time, independent of every other photo widget's timing. Leave on the global setting (Photos tab) to keep it in sync with the rest.`,
  'aq-help':
    `Uses the same location as the Weather widget (Settings → Weather). Pollen data is currently only available for European locations from our free data source — it'll just show AQI/PM/UV elsewhere.`,
  'metar-help':
    `Live METAR conditions and TAF forecast from NOAA's Aviation Weather Center — free, no account needed. Best for airport-adjacent weather or aviation-minded households; flight category (VFR/MVFR/IFR/LIFR) is computed from the reported visibility and cloud ceiling.`,
  'location-name-help':
    `Shown next to the current temperature on the Weather widget. Filled in automatically from your ZIP/postal code, but you can edit it to say whatever you'd like — a neighborhood name, a nickname, anything.`,
  'weather-source-help':
    `Open-Meteo is the default and needs no setup. National Weather Service is also free and authoritative but only works in the US. OpenWeatherMap requires a free API key. If any source fails, the display automatically falls back to Open-Meteo.`,
  'autorefresh-help':
    `Does a full page reload (like pressing F5) on this schedule, <b>every 6 hours by default</b> — it keeps a display that runs for weeks fresh and recovers one that got stuck. Content already updates live, so you will rarely notice it: it waits until nobody is touching the screen (and Live Edit is closed), and until the display's server is answering. Choose <b>Off</b> to never reload automatically.`,
  'date-format-help':
    `Sets how dates read across the whole display — Agenda, Mini Calendar, Tasks due dates, the standalone Date widget, and anywhere else a date shows up. The Date widget also has its own per-widget override in Layout if you want just that one widget to differ from everything else.`,
  'force-real-display-help':
    `Live Editing (tap the screen, then the ✏️ icon, to select/move/resize/delete/edit widgets right on the wall display) only turns off when a URL explicitly includes <code>?preview=1</code> without also including <code>?allowEdit=1</code>. The Layout tab's own Live Edit panel uses this on purpose: its small embedded thumbnail stays glance-only (so it can't accidentally overwrite the real layout), while its "Open to Edit in New Tab" link deliberately allows real editing there. Earlier versions also guessed based on the browser's screen size, which could misfire on a screen with unusual OS-level display scaling; that guessing was removed, so this toggle generally shouldn't be needed anymore. Left here as a per-device safety net in case Live Editing is ever unexpectedly unavailable on a real screen — turning it on here doesn't affect any other screen.`,
  'timezone-help':
    `Piazza HQ normally uses the Pi's own system clock for "what day is it" — chore resets, the daily briefing time, and so on — and also uses this zone to convert synced calendar (Google Calendar / ICS) events that arrive in UTC, so their times land correctly. Set this if the Pi's system timezone is ever wrong (e.g. a fresh SD card defaulting to UTC), or if imported calendar events are showing at the wrong time. Leave on <b>Use Pi's system clock</b> otherwise. Every zone is listed with its current UTC offset (and abbreviation like CDT/PST when available) — this updates automatically across Daylight Saving changes, so you don't need to switch zones twice a year.`,
  'custom-theme-help':
    `Builds a "Custom" theme you can select like any other, from the template gallery. The background can be any photo (JPEG, PNG, or WebP). Decorations must be PNG specifically — that's what lets the background show through around them instead of a solid rectangle drifting across the screen. Each decoration's behavior (falls from top, rises from bottom, enters from a side, or a random mix) is independent, so all 3 can move differently.`,
  'bf-task-scope-help':
    `"All tasks" emails every open task regardless of due date (overdue and future due dates are labeled). "Only tasks due today" narrows to today and overdue.`,
  'bf-news-per-section-help':
    `News in the email is grouped by section (World, National, Local, and each keyword) using your Settings → News sources. This caps how many headlines appear under each section.`,
  'autopush-help':
    `When you update this host, it updates itself first, confirms it's healthy, then automatically pushes the same update to every connected display — so all your devices always run the same version. Each display still safely rolls back on its own if an update fails.`,
  'photo-defaults-help':
    `<b>Brightness</b> darkens the photo with an overlay so text on top stays readable.<br><br>
    <b>Opacity</b> makes the photo itself transparent, letting the background show through.<br><br>
    A specific Photo widget (Layout tab) or a screen's ambient mode (Devices tab) can override any of these — this section is just what's used when nothing else is set.`,
  'backup-help':
    `Downloads the actual database file this device runs on, plus every uploaded photo, zipped together — not a partial export. Includes everything: events, layouts, chores, allowance history, PIN, all settings.<br><br>
    To restore one — from this device or another Piazza HQ install — use the Restore section right below Download here. It replaces everything currently on the device with what's in the backup, so it asks for confirmation first, and keeps a safety copy of what was there immediately before in case anything needs to be undone by hand.`,
  'fx-scale-help':
    `Scales this screen's animated theme effects (fireworks, snow, falling leaves, and so on) — only visible when the assigned layout has a themed background set. These already auto-scale with the screen's actual resolution, same as fonts and widgets do; this is an extra multiplier on top, for cases auto-scaling alone doesn't get quite right — like a big TV viewed from further away wanting bigger effects than its resolution alone would suggest.`,
  'fx-density-help':
    `Controls how MANY particles a theme's animated effect spawns — separate from Animation Size, which controls how big each one is. Only visible when the assigned layout has a themed background set. Turn it down for just the occasional heart or snowflake, or up for a much busier effect, without changing anything else about it.`,
};
let _infoIdCounter = 0;
function infoBtn(text) {
  const id = 'info-' + (_infoIdCounter++);
  window._infoTexts[id] = text;
  return `<span class="info-btn" onclick="showInfoPopup('${id}')" role="button" aria-label="More info">ⓘ</span>`;
}
function showInfoPopup(id) {
  const text = window._infoTexts[id];
  if (!text) return;
  const existing = document.getElementById('info-popup-modal');
  if (existing) existing.remove(); // in case one's already open somehow
  const modal = document.createElement('div');
  modal.id = 'info-popup-modal';
  modal.innerHTML = `<div id="info-popup-content">${text}<div style="text-align:right;margin-top:14px"><button id="info-popup-close">Got it</button></div></div>`;
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  document.getElementById('info-popup-close').addEventListener('click', () => modal.remove());
}

// Presets tuned for text legibility (not the same palette as event colors) —
// high-contrast neutrals first since that's the most common fix for text getting
// washed out over a busy photo background, plus a couple of warm/cool options.
const TEXT_COLOR_PRESETS = [
  { label: 'White',        value: '#e8edf5' },
  { label: 'Black',        value: '#10131c' },
  { label: 'Yellow',       value: '#fde047' },
  { label: 'Light Blue',   value: '#7ec8e3' },
  { label: 'Soft Orange',  value: '#fdba74' },
];

// Builds a row of preset swatches + wires them to update a hidden state and an
// adjacent native color input. Shared by the global default picker and every
// per-widget override picker so they behave identically.
function renderColorSwatches(containerId, customInputId, currentValue, onChange) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = TEXT_COLOR_PRESETS.map(p => `
    <button class="text-color-swatch" data-value="${p.value}" title="${p.label}"
      style="width:36px;height:36px;border-radius:50%;cursor:pointer;
        background:${p.value}; border:2px solid ${currentValue && currentValue.toLowerCase()===p.value.toLowerCase() ? 'var(--accent)' : 'var(--border)'}">
    </button>
  `).join('');
  container.querySelectorAll('.text-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.text-color-swatch').forEach(b => b.style.border = '2px solid var(--border)');
      btn.style.border = '2px solid var(--accent)';
      if ($(customInputId)) $(customInputId).value = btn.dataset.value;
      onChange(btn.dataset.value);
    });
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, durationMs = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), durationMs);
}

// ── Reusable collapsible accordion ────────────────────────────────────────────
// Renders a tappable section header that expands its content; opening one section
// collapses the others within the same accordion. Used in Displays and Settings.
// s.hidden: hides the WHOLE section (header included), for content that's
// conditionally irrelevant entirely (e.g. Reminder/Sticker badges only apply
// to Mini Calendar's Grid layout) — applied directly on the .acc-section
// element itself, not a wrapping div, since wireAccordion() only looks at
// DIRECT children of its container and an extra wrapper would break that.
function accordionSection(s, openByDefault = false) {
  return `
    <div class="acc-section${openByDefault ? ' open' : ''}" data-acc="${s.id}" style="${s.hidden ? 'display:none' : ''}">
      <button class="acc-head" data-acc-toggle="${s.id}">
        <span class="acc-ic">${s.icon || ''}</span>
        <span class="acc-text"><span class="acc-label">${s.label}</span>${s.sub ? `<span class="acc-sub">${s.sub}</span>` : ''}</span>
        <span class="acc-caret">${openByDefault ? '▾' : '▸'}</span>
      </button>
      <div class="acc-body" data-acc-body="${s.id}" style="${openByDefault ? '' : 'display:none'}">
        ${s.inner}
      </div>
    </div>`;
}
function wireAccordion(containerId) {
  const root = $(containerId);
  if (!root) return;
  // Only this accordion's OWN sections — not sections nested inside one of them
  // (e.g. the advanced sub-accordion lives inside the outer accordion's Advanced
  // section). Using :scope > limits us to direct children so a nested toggle never
  // triggers the parent's collapse-all.
  const ownSections = () => root.querySelectorAll(':scope > .acc-section');
  ownSections().forEach(sec => {
    const btn = sec.querySelector(':scope > .acc-head');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      // Don't let this click also reach an outer accordion's handler.
      e.stopPropagation();
      const isOpen = sec.classList.contains('open');
      // Collapse all of OUR sections, then open this one (unless it was already open).
      ownSections().forEach(s => {
        const body = s.querySelector(':scope > .acc-body');
        const caret = s.querySelector(':scope > .acc-head .acc-caret');
        s.classList.remove('open');
        if (body) body.style.display = 'none';
        if (caret) caret.textContent = '▸';
      });
      if (!isOpen) {
        sec.classList.add('open');
        const body = sec.querySelector(':scope > .acc-body');
        const caret = sec.querySelector(':scope > .acc-head .acc-caret');
        if (body) body.style.display = '';
        if (caret) caret.textContent = '▾';
      }
    });
  });
}

// Per-screen "Screen Settings" accordion in the Devices tab. Deliberately NOT
// using wireAccordion() above — that one only looks at DIRECT children of its
// container (:scope > .acc-section), but each screen's accordion is nested
// several levels deep inside its card, so it would never find them. Also
// deliberately independent per card (not "only one open at a time") — unlike
// Layouts & profiles' sub-sections, which are mutually exclusive views of the
// same area, comparing two screens' settings side by side is a reasonable
// thing to want.
// Wires the Settings tab's "To-Do Lists" manager. List-level actions (add/delete
// a whole list) re-render the Settings tab, since the structure genuinely
// changes. Item-level actions (add/toggle/delete a single item) do targeted DOM
// updates instead — a full re-render would rebuild the accordion from scratch
// and collapse whatever list the person has open, the same bug just fixed for
// the Devices tab's per-screen accordion.
function wireTodoListsManager() {
  const manager = document.getElementById('todo-lists-manager');
  if (!manager) return;

  const newListBtn = document.getElementById('todo-newlist-btn');
  if (newListBtn) newListBtn.addEventListener('click', async () => {
    const input = document.getElementById('todo-newlist-input');
    const name = input.value.trim();
    if (!name) return;
    const r = await apiFetch('/api/todo-lists', { method: 'POST', body: JSON.stringify({ name }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    showToast(`List "${name}" added ✓`);
    renderTodoTab();   // this manager lives on the Family Hub To-Do tab: redraw that tab, not Settings
  });

  // Link a list that already lives in Todoist or Google Tasks: it then works here like any other list (and on the display), and what you do goes to that service.
  const linkBtn = document.getElementById('todo-link-btn');
  if (linkBtn) linkBtn.addEventListener('click', async () => {
    const panel = document.getElementById('todo-link-panel');
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
    panel.style.display = '';
    panel.innerHTML = '<div style="font-size:12px;color:var(--muted)">Loading your lists…</div>';
    const r = await apiFetch('/api/todoist/projects').catch((e) => ({ error: (e && e.message) || 'Could not load your lists.' }));
    const already = window._linkedTodoKeys || new Set();
    const opts = (Array.isArray(r) ? r : []).map((p) => {
      const google = !!p.google || String(p.id).indexOf('g:') === 0;
      return { source: google ? 'google' : 'todoist', id: String(p.id), name: google ? String(p.name).replace(/^Google Tasks:\s*/, '') : String(p.name) };
    }).filter((o) => !already.has(o.source + '|' + o.id));
    if (!opts.length) {
      panel.innerHTML = '<div style="font-size:12px;color:var(--muted)">' + (Array.isArray(r) ? 'Every list you have is already linked.' : 'Nothing to link yet. Connect Todoist or Google Tasks first (Settings > Data Sources).' + (r && r.error ? ' (' + escapeHtml(r.error) + ')' : '')) + '</div>';
      return;
    }
    panel.innerHTML = '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">Choose a list to link</div>' + opts.map((o, i) =>
      '<button type="button" class="todo-link-opt" data-i="' + i + '" style="display:flex;justify-content:space-between;gap:10px;width:100%;text-align:left;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:9px 12px;font-size:13px;cursor:pointer;margin-bottom:6px"><span>' + escapeHtml(o.name) + '</span><span style="color:var(--muted)">' + (o.source === 'google' ? 'Google Tasks' : 'Todoist') + '</span></button>').join('');
    panel.querySelectorAll('.todo-link-opt').forEach((b) => b.addEventListener('click', async () => {
      const o = opts[Number(b.dataset.i)];
      b.disabled = true;
      const res = await apiFetch('/api/todo-lists', { method: 'POST', body: JSON.stringify({ name: o.name, source: o.source, remote_id: o.id }) });
      if (res && res.error) { b.disabled = false; showToast('❌ ' + res.error); return; }
      showToast(`Linked "${o.name}" ✓`);
      renderTodoTab();   // this manager lives on the Family Hub To-Do tab: redraw that tab, not Settings
    }));
  });

  manager.querySelectorAll('.todo-list-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const linked = btn.dataset.listSource;
      const svc = linked === 'google' ? 'Google Tasks' : 'Todoist';
      if (linked ? !confirm(`Remove the link to "${btn.dataset.listName}"? The list in ${svc} stays exactly as it is.`) : !confirm(`Delete "${btn.dataset.listName}" and all its items? This can't be undone.`)) return;
      await apiFetch(`/api/todo-lists/${btn.dataset.listId}`, { method: 'DELETE' });
      showToast(linked ? 'Link removed ✓' : 'List deleted ✓');
      renderTodoTab();   // this manager lives on the Family Hub To-Do tab: redraw that tab, not Settings
    });
  });

  async function addTodoItem(listId) {
    const input = manager.querySelector(`.todo-item-input[data-list-id="${listId}"]`);
    const text = input.value.trim();
    if (!text) return;
    const r = await apiFetch(`/api/todo-lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ text }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    input.value = '';
    const itemsContainer = document.getElementById(`todo-items-${listId}`);
    if (itemsContainer) {
      const emptyMsg = itemsContainer.querySelector('p');
      if (emptyMsg) emptyMsg.remove();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';
      row.dataset.itemId = r.id;
      row.innerHTML = `
        <input type="checkbox" class="todo-item-done" data-item-id="${r.id}" style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
        <span style="flex:1">${escapeHtml(text)}</span>
        <button type="button" class="icon-btn del small todo-item-del" data-item-id="${r.id}" title="Delete item">🗑️</button>
      `;
      itemsContainer.appendChild(row);
      row.querySelector('.todo-item-done').addEventListener('change', (e) => toggleTodoItemDone(r.id, e.target.checked));
      row.querySelector('.todo-item-del').addEventListener('click', () => deleteTodoItem(r.id));
      updateTodoListCount(listId);
    }
  }

  function updateTodoListCount(listId) {
    const itemsContainer = document.getElementById(`todo-items-${listId}`);
    const sub = manager.querySelector(`.acc-section[data-acc="todolist-${listId}"] .acc-sub`);
    if (sub && itemsContainer) {
      const count = itemsContainer.querySelectorAll('[data-item-id]').length;
      sub.textContent = `${count} item${count===1?'':'s'}`;
    }
  }

  async function toggleTodoItemDone(itemId, done) {
    const res = await apiFetch(`/api/todo-items/${itemId}`, { method: 'PUT', body: JSON.stringify({ done }) });
    const row = manager.querySelector(`[data-item-id="${itemId}"]`);
    if (res && res.error) { showToast('❌ ' + res.error); const cb = row && row.querySelector('.todo-item-done'); if (cb) cb.checked = !done; return; }
    const span = row ? row.querySelector('span') : null;
    if (span) {
      span.style.textDecoration = done ? 'line-through' : '';
      span.style.color = done ? 'var(--muted)' : '';
    }
  }

  async function deleteTodoItem(itemId) {
    const row = manager.querySelector(`[data-item-id="${itemId}"]`);
    const listSection = row ? row.closest('.acc-section') : null;
    const listId = listSection ? listSection.dataset.acc.replace(/^todolist-/, '') : null;
    const res = await apiFetch(`/api/todo-items/${itemId}`, { method: 'DELETE' });
    if (res && res.error) { showToast('❌ ' + res.error); return; }
    if (row) row.remove();
    if (listId) updateTodoListCount(listId);
  }

  manager.querySelectorAll('.todo-item-add-btn').forEach(btn => {
    btn.addEventListener('click', () => addTodoItem(btn.dataset.listId));
  });
  manager.querySelectorAll('.todo-item-input').forEach(inp => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodoItem(inp.dataset.listId); });
  });
  manager.querySelectorAll('.todo-item-done').forEach(cb => {
    cb.addEventListener('change', (e) => toggleTodoItemDone(cb.dataset.itemId, e.target.checked));
  });
  manager.querySelectorAll('.todo-item-del').forEach(btn => {
    btn.addEventListener('click', () => deleteTodoItem(btn.dataset.itemId));
  });
}

function wireScreenSettingsAccordions() {
  document.querySelectorAll('#screens-list .acc-section[data-acc^="tvsettings-"]').forEach(sec => {
    const btn = sec.querySelector(':scope > .acc-head');
    if (!btn) return;
    const deviceId = sec.dataset.acc.replace(/^tvsettings-/, '');
    btn.addEventListener('click', () => {
      const isOpen = sec.classList.contains('open');
      const body = sec.querySelector(':scope > .acc-body');
      const caret = sec.querySelector(':scope > .acc-head .acc-caret');
      sec.classList.toggle('open', !isOpen);
      if (body) body.style.display = isOpen ? 'none' : '';
      if (caret) caret.textContent = isOpen ? '▸' : '▾';
      if (isOpen) openScreenAccordions.delete(deviceId); else openScreenAccordions.add(deviceId);
    });
  });
}

// Display / Ambient Mode / TV Control, one level deeper than Screen Settings
// itself. Grouped per screen (a screensub-<deviceId>-<subId> id), so opening
// one of a screen's three sub-sections only collapses that SAME screen's
// other two, not every screen's — matching the "compare two screens side by
// side" reasoning openScreenAccordions above already establishes. Not using
// the generic wireAccordion() helper: that one only looks at DIRECT children
// of a single named container, but these sub-sections are nested several
// levels deep inside each screen's own card, and there are as many
// independent groups-of-three as there are screens.
function wireScreenSubAccordions() {
  document.querySelectorAll('#screens-list .acc-section[data-acc^="screensub-"]').forEach(sec => {
    const btn = sec.querySelector(':scope > .acc-head');
    if (!btn) return;
    const [, deviceId, subId] = sec.dataset.acc.match(/^screensub-(.+)-(display|ambient|tv|fls)$/) || [];
    if (!deviceId) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let this also trigger the outer Screen Settings toggle
      const isOpen = sec.classList.contains('open');
      // Collapse this screen's OTHER two sub-sections (not other screens').
      document.querySelectorAll(`#screens-list .acc-section[data-acc^="screensub-${deviceId}-"]`).forEach(otherSec => {
        const otherBody = otherSec.querySelector(':scope > .acc-body');
        const otherCaret = otherSec.querySelector(':scope > .acc-head .acc-caret');
        otherSec.classList.remove('open');
        if (otherBody) otherBody.style.display = 'none';
        if (otherCaret) otherCaret.textContent = '▸';
        const [, , otherSubId] = otherSec.dataset.acc.match(/^screensub-(.+)-(display|ambient|tv|fls)$/) || [];
        if (otherSubId) openScreenSubAccordions.delete(deviceId + ':' + otherSubId);
      });
      if (!isOpen) {
        sec.classList.add('open');
        const body = sec.querySelector(':scope > .acc-body');
        const caret = sec.querySelector(':scope > .acc-head .acc-caret');
        if (body) body.style.display = '';
        if (caret) caret.textContent = '▾';
        openScreenSubAccordions.add(deviceId + ':' + subId);
      }
    });
  });
}

// "Show Screen Switcher" and "Schedule" — the two sections nested inside the
// Screen Switcher accordion. Deliberately its OWN function, not folded into
// wireScreenSubAccordions() above, since these two need to expand/collapse
// INDEPENDENTLY of each other (both open at once is fine) — by explicit
// request, and because the schedule can be actively firing regardless of
// whether the switcher button itself is enabled (checkSchedules() never
// checks floating_switcher_enabled at all), so hiding one behind the
// other's state would misrepresent that. Uses "flssub-" as a distinct
// data-acc prefix specifically so it's never matched by
// wireScreenSubAccordions()'s own "screensub-" selector/regex above, or
// vice versa.
function wireFlsSubAccordions() {
  document.querySelectorAll('#screens-list .acc-section[data-acc^="flssub-"]').forEach(sec => {
    const btn = sec.querySelector(':scope > .acc-head');
    if (!btn) return;
    const [, deviceId, subId] = sec.dataset.acc.match(/^flssub-(.+)-(toggle|schedule|editbar)$/) || [];
    if (!deviceId) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let this also trigger the outer Screen Switcher/Screen Settings toggles
      const isOpen = sec.classList.contains('open');
      const body = sec.querySelector(':scope > .acc-body');
      const caret = sec.querySelector(':scope > .acc-head .acc-caret');
      sec.classList.toggle('open', !isOpen);
      if (body) body.style.display = isOpen ? 'none' : '';
      if (caret) caret.textContent = isOpen ? '▸' : '▾';
      const key = deviceId + ':fls-' + subId;
      if (isOpen) openScreenSubAccordions.delete(key);
      else openScreenSubAccordions.add(key);
    });
  });
}

// ── Swipe-to-act on display profile cards ─────────────────────────────────────
// Swipe a card left to delete, right to duplicate. Pointer-based so it works with
// touch and mouse. Reveals a colored background hint as you drag.
function wireProfileSwipes() {
  document.querySelectorAll('.swipe-wrap').forEach(wrap => {
    const card = wrap.querySelector('.swipe-card');
    if (!card) return;
    let startX = 0, dx = 0, dragging = false, decided = false;
    const THRESH = 90; // px to trigger an action

    card.addEventListener('pointerdown', (e) => {
      // Don't hijack taps on buttons/selects/links inside the card.
      if (e.target.closest('button, select, a, input')) return;
      dragging = true; decided = false; startX = e.clientX; dx = 0;
      card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (!decided && Math.abs(dx) > 6) { decided = true; try { card.setPointerCapture(e.pointerId); } catch {} }
      if (decided) {
        card.style.transform = `translateX(${dx}px)`;
        wrap.classList.toggle('swipe-left', dx < -20);
        wrap.classList.toggle('swipe-right', dx > 20);
      }
    });
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = 'transform .2s';
      const id = wrap.dataset.id, name = wrap.dataset.name, canDelete = wrap.dataset.canDelete === '1';
      if (dx <= -THRESH && canDelete) {
        card.style.transform = 'translateX(-100%)';
        setTimeout(() => deleteDisplayById(id, name), 180);
      } else if (dx >= THRESH) {
        card.style.transform = '';
        wrap.classList.remove('swipe-left','swipe-right');
        duplicateDisplayById(id, name);
      } else {
        card.style.transform = '';
        wrap.classList.remove('swipe-left','swipe-right');
        if (dx <= -THRESH && !canDelete) showToast('At least one display must remain');
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
  });
}

async function deleteDisplayById(id, name) {
  if (!confirm(`Remove "${name}"? Its layout will be deleted. This can't be undone.`)) {
    renderLayoutProfilesSubTab(); // reset any swipe transform
    return;
  }
  const result = await apiFetch(`/api/displays/${id}`, { method: 'DELETE' });
  if (result.error) { showToast('❌ ' + result.error); renderLayoutProfilesSubTab(); return; }
  showToast('Display removed');
  renderLayoutProfilesSubTab();
}
async function duplicateDisplayById(id, name) {
  const result = await apiFetch(`/api/displays/${id}/duplicate`, { method: 'POST' });
  if (result.error) { showToast('❌ ' + result.error); return; }
  showToast(`Duplicated "${name}" ✓`);
  renderLayoutProfilesSubTab();
}

// Turns the flat Settings markup (a series of .section-header + .settings-card
// blocks) into a collapsible accordion. Each header becomes a tappable section;
// opening one closes the others. "Advanced" sections are tucked behind a toggle.
const SETTINGS_ICONS = {
  'General':'🏠', 'Display':'🖥️', 'Photo Widget Defaults':'🖼️', 'Features & Family Hub':'✨', 'Weather':'☀️', 'Calendar Sync':'🔄', 'Todoist':'✅', 'Google Tasks':'☑️', 'To-Do Lists':'📝',
  'Stocks':'📈', 'News':'📰', 'Daily Briefing':'✉️', 'Feedback & Ideas':'💬', 'Version & License':'⬆️', 'Security':'🔒', 'Multi-Device':'🖥️', 'Home Assistant':'🏠', 'Home Assistant Control':'🏠', 'Severe Weather Alerts':'⚠️', 'App Preferences':'📱', 'Beta Checklist':'✅',
  'Support the Project':'☕',
  'Push to iCloud Calendar':'📅', 'Push to Google Calendar':'📅', 'Handwriting input':'✍️',
  'Family profiles':'👥',
};
// Sections nested inside a named group's own mini-accordion, rather than
// sitting as top-level accordion items — cuts the scanning distance for a
// long Settings list without needing another tab. "Advanced" is deliberately
// inserted at the very end (matches its long-standing position); other
// groups insert in-place, where their first member would have appeared.
// Feedback & Ideas and Support the Project are deliberately NOT listed here —
// the developer's ask: pull both out of Advanced into their own standalone top-level
// entries, but keep them at the very bottom of the whole list (neither is
// something a user browses to routinely). See BOTTOM_ANCHORED_SECTIONS below
// for how that bottom placement is actually enforced.
const SETTINGS_GROUPS = {
  'Display':               'Display & Appearance',
  'Photo Widget Defaults': 'Display & Appearance',
  'Custom Theme':          'Display & Appearance',
  'Weather':                 'Data Sources',
  'Travel Time':             'Data Sources',
  'News':                    'Data Sources',
  'Stocks':                  'Data Sources',
  'Todoist':                 'Data Sources',
  'Google Tasks':            'Data Sources',
  'Home Assistant':          'Data Sources',
  'Severe Weather Alerts':   'Data Sources',
  'Calendar Sync':           'Data Sources',
  'Push to iCloud Calendar': 'Data Sources',
  'Push to Google Calendar': 'Data Sources',
  'Handwriting input':       'Data Sources',
  'Voice Control (Siri Shortcuts)': 'Data Sources',
  'Version & License':  'Advanced', // was 'Software Update' — stale after that section got renamed; fixed here too
  'Multi-Device':       'Advanced',
  'Daily Briefing':     'Advanced',
  'Backup':             'Advanced',
  'Update Backups':     'Advanced',
  'Beta Checklist':     'Advanced',
};
// Standalone top-level sections (not part of any named group) that should
// still consistently sit at the very bottom of the whole accordion,
// regardless of where their own section-header happens to live in the
// source markup. Order in this array is the order they'll render in —
// last item is the bottom-most link. Applied as a final pass in
// transformSettingsToAccordion(), AFTER the Advanced group's own
// end-of-list placement, so both of these end up below Advanced too.
const BOTTOM_ANCHORED_SECTIONS = ['Feedback & Ideas', 'Support the Project'];
// Settings sections with no meaning inside a shared, resettable demo instance —
// every one of these either drives an external integration, a credential, the
// update/host machinery, or the app PIN, all of which the demo server also
// blocks at the API. Removed from the DOM before the accordion is built (see
// transformSettingsToAccordion) whenever /api/version reports demo mode.
const DEMO_HIDDEN_SETTINGS_SECTIONS = new Set([
  'Custom Theme', 'Calendar Sync', 'Push to iCloud Calendar', 'Push to Google Calendar',
  'Handwriting input', 'Todoist', 'Google Tasks', 'Home Assistant', 'Home Assistant Control', 'Voice Control (Siri Shortcuts)',
  'Daily Briefing', 'Security', 'Feedback & Ideas', 'Multi-Device', 'Version & License',
  'Update Backups', 'Beta Checklist', 'Backup',
]);
// Demo mode in the control app: a slim countdown strip + a broker heartbeat
// that holds the lease open while this tab is here (mirrors display.html).
// No-op unless /api/version reports demo mode.
let _appDemoBeat = null;
function initAppDemo(v) {
  if (!v || !v.demo) return;
  window.__isDemo = true;
  window.__demoLeaseEndsAt = Number(v.demoLeaseEndsAt) || 0;
  let bar = document.getElementById('app-demo-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'app-demo-bar';
    bar.style.cssText = 'position:sticky;top:0;z-index:9999;display:flex;gap:10px;align-items:center;justify-content:center;'
      + 'padding:6px 12px;font-size:12px;font-weight:600;background:#23262B;color:#fff;';
    bar.innerHTML = '<span>Demo</span><span class="adb-count" style="font-variant-numeric:tabular-nums"></span>'
      + '<a href="https://piazzahq.com" target="_blank" rel="noopener" style="color:#8ec3ff;font-weight:700">Get your own →</a>';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  const home = 'https://piazzahq.com/';
  const bail = () => { try { location.href = home; } catch {} };
  const countEl = bar.querySelector('.adb-count');
  setInterval(() => {
    const endsAt = Number(window.__demoLeaseEndsAt) || 0;
    if (!endsAt) { countEl.textContent = ''; return; }
    const s = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
    countEl.textContent = `resets in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s <= 0) bail();
  }, 1000);
  if (v.demoBrokerUrl && !_appDemoBeat) {
    if (v.demoScan) {
      // Scanned-in phone: no lease of its own — just poll whether the wall's
      // lease is still alive, and follow it home when it ends.
      const poll = () => fetch(v.demoBrokerUrl + '/demo/lease-ok?scan=1&n=' + encodeURIComponent(v.demoInstance))
        .then(r => r.json()).then(j => {
          if (j && j.ok === false) bail();
          else if (j && j.endsAt) window.__demoLeaseEndsAt = j.endsAt;
        }).catch(() => {});
      poll();
      _appDemoBeat = setInterval(poll, 20000);
    } else {
      const beat = () => fetch(v.demoBrokerUrl + '/demo/heartbeat', { method: 'POST', credentials: 'include', keepalive: true })
        .then(r => r.json()).then(j => {
          if (j && j.ok === false) bail();
          else if (j && j.endsAt) window.__demoLeaseEndsAt = j.endsAt;
        }).catch(() => {});
      beat();
      _appDemoBeat = setInterval(beat, 45000);
    }
  }
}
const SETTINGS_GROUP_META = {
  'Display & Appearance': { icon: '🖥️', summary: 'Display behavior, photo defaults, custom theme', deferToEnd: false },
  'Data Sources':         { icon: '🔌', summary: 'Weather, news, stocks, calendars, Home Assistant, Todoist, handwriting', deferToEnd: false },
  'Advanced':             { icon: '⚙︎', summary: 'Version & license, multi-device, briefing, feedback, backup', deferToEnd: true },
};
// Settings Search — synonym expansion table. This is the "broad concept"
// layer: the index itself is auto-scraped from the live DOM (every
// .settings-row label + its ⓘ tooltip text) so a new setting is searchable
// by its own literal label the moment it's added, with zero upkeep here.
// This table only exists to catch everyday words that don't literally
// appear in any label — e.g. "time" doesn't appear in "Date format", but a
// user thinking "time" should still land there. Each value is a fragment
// that genuinely appears somewhere in the settings UI, so it composes with
// plain substring matching rather than needing its own fuzzy layer.
const SETTINGS_SEARCH_SYNONYMS = {
  time: ['time format', 'timezone', 'date format', 'send time', 'sync every', 'refresh', 'slide interval'],
  date: ['date format', 'week starts', 'timezone'],
  clock: ['time format', 'timezone'],
  day: ['week starts', 'date format'],
  week: ['week starts on'],
  timezone: ['timezone', 'time format'],

  weather: ['weather', 'zip', 'postal code', 'units', 'fahrenheit', 'celsius', 'forecast'],
  temperature: ['weather', 'units', 'fahrenheit', 'celsius'],
  forecast: ['weather'],
  location: ['zip', 'postal code', 'location name', 'weather', 'travel', 'base url'],
  zip: ['zip / postal code', 'weather'],
  address: ['base url', 'gmail address', 'host lan address', 'host tailscale address', 'location name'],

  password: ['pin', 'api key', 'app password', 'token', 'license key'],
  pin: ['app pin', 'security'],
  security: ['app pin', 'security', 'token'],
  lock: ['app pin', 'security'],
  login: ['app pin', 'security'],

  kids: ['chore chart', 'built-in to-do lists'],
  chores: ['chore chart'],
  todo: ['built-in to-do lists', 'todoist'],
  tasks: ['built-in to-do lists', 'todoist', 'which tasks to include'],
  shopping: ['shopping list'],
  groceries: ['shopping list'],

  email: ['daily briefing', 'recipients', 'gmail', 'sending account', 'enable daily email'],
  notifications: ['daily briefing', 'enable daily email'],
  briefing: ['daily briefing'],
  gmail: ['gmail address', 'gmail app password'],

  background: ['custom theme', 'background', 'decoration'],
  theme: ['custom theme', 'background', 'decoration', 'saved themes'],
  color: ['custom theme', 'background'],
  wallpaper: ['background', 'custom theme'],
  screen: ['display', 'brightness', 'opacity', 'auto-refresh'],
  brightness: ['brightness', 'photo widget defaults'],
  photo: ['photo widget defaults', 'slideshow', 'slide interval', 'brightness', 'opacity'],
  photos: ['photo widget defaults', 'slideshow', 'slide interval'],
  slideshow: ['slideshow', 'slide interval'],

  calendar: ['calendar sync', 'ical sync frequency'],
  sync: ['calendar sync', 'ical sync frequency', 'multi-device', 'sync every', 'auto-push'],
  google: ['calendar sync', 'travel source', 'google maps api key'],
  apple: ['calendar sync'],
  ical: ['calendar sync', 'ical sync frequency'],
  refresh: ['auto-refresh display', 'ical sync frequency', 'refresh every', 'pull down to refresh'],

  voice: ['voice control', 'voice token', 'shortcut'],
  siri: ['voice control', 'siri shortcuts', 'voice token'],
  alexa: ['voice control', 'alexa'],
  smart: ['home assistant'],
  home: ['home assistant'],

  stocks: ['stocks', 'market indices'],
  money: ['stocks', 'market indices'],
  finance: ['stocks', 'market indices'],
  market: ['market indices'],

  news: ['news', 'world', 'national', 'local', 'keywords'],
  keywords: ['keywords / topics'],
  topics: ['keywords / topics'],

  travel: ['travel time', 'travel source', 'google maps api key'],
  traffic: ['travel time', 'travel source'],
  drive: ['travel time', 'travel source'],
  commute: ['travel time'],

  devices: ['multi-device', 'host', "this device's role", 'auto-push'],
  mirror: ['multi-device', 'host', "this device's role"],
  screens: ['multi-device', 'host', "this device's role"],
  host: ['multi-device', 'host tailscale address', 'host lan address', 'host port'],
  server: ['multi-device', 'central server', 'base url'],

  update: ['version & license', 'current version', 'auto-push updates'],
  version: ['version & license', 'current version'],
  license: ['version & license', 'license key', 'account status'],
  account: ['account status', 'license key'],

  backup: ['backup'],
  restore: ['backup'],
  export: ['backup'],
  feedback: ['feedback & ideas', 'send feedback'],
  bug: ['feedback & ideas', 'send feedback'],
  support: ['feedback & ideas', 'send feedback', 'support the project'],
  help: ['feedback & ideas'],
  donate: ['support the project', 'buy me a coffee', 'paypal'],
  donation: ['support the project', 'buy me a coffee', 'paypal'],
  coffee: ['support the project', 'buy me a coffee'],
  tip: ['support the project', 'buy me a coffee', 'paypal'],
  paypal: ['support the project', 'paypal'],

  tab: ['app preferences', 'default tab', 'auto-hide tab bar'],
  navigation: ['app preferences', 'default tab'],
  startup: ['app preferences', 'default tab'],

  token: ['todoist api token', 'long-lived access token', 'voice token', 'openweathermap api key', 'google maps api key'],
  key: ['api key', 'license key'],
  api: ['api token', 'api key'],
};

// ── Settings search: build a live index from the rendered DOM, then rank
// and jump to matches. Runs AFTER transformSettingsToAccordion() so it can
// index the final accordion structure (section labels + group labels) and
// wire jump-to behavior against the same buttons the accordion itself uses.
let _settingsSearchIndex = [];
function buildSettingsSearchIndex() {
  _settingsSearchIndex = [];
  const acc = $('settings-accordion');
  if (!acc) return;
  // Leaf sections are every .acc-section EXCEPT the 3 named group wrappers
  // (Display & Appearance / Data Sources / Advanced) — those just contain a
  // nested accordion of the real sections, nothing to index on the wrapper
  // itself.
  const groupNames = Object.keys(SETTINGS_GROUP_META);
  acc.querySelectorAll('.acc-section[data-acc]').forEach(sec => {
    const sectionLabel = sec.dataset.acc;
    if (groupNames.includes(sectionLabel)) return; // group wrapper, not a leaf
    const groupLabel = SETTINGS_GROUPS[sectionLabel] || null;
    const toggleBtn = sec.querySelector(':scope > .acc-head');
    if (!toggleBtn) return;

    // Index the section itself (so "weather" alone surfaces the section
    // even if no individual row text matches).
    _settingsSearchIndex.push({
      sectionLabel, groupLabel,
      rowLabel: null,
      searchText: sectionLabel.toLowerCase(),
      sectionToggleBtn: toggleBtn,
      rowEl: null,
    });

    sec.querySelectorAll('.settings-row').forEach(row => {
      const labelEl = row.querySelector(':scope > label');
      if (!labelEl) return;
      const labelClone = labelEl.cloneNode(true);
      labelClone.querySelectorAll('.info-btn').forEach(b => b.remove());
      const rowLabel = labelClone.textContent.trim();
      if (!rowLabel) return;

      // Pull the ⓘ tooltip text (if any) so its content is searchable too —
      // e.g. "OpenWeatherMap" is only mentioned in the Weather Source
      // tooltip, not the label itself.
      let tooltipText = '';
      const infoBtnEl = row.querySelector(':scope > label .info-btn');
      if (infoBtnEl) {
        const m = /showInfoPopup\('([^']+)'\)/.exec(infoBtnEl.getAttribute('onclick') || '');
        if (m && window._infoTexts && window._infoTexts[m[1]]) {
          tooltipText = String(window._infoTexts[m[1]]).replace(/<[^>]+>/g, ' ');
        }
      }

      _settingsSearchIndex.push({
        sectionLabel, groupLabel, rowLabel,
        searchText: (sectionLabel + ' ' + rowLabel + ' ' + tooltipText).toLowerCase(),
        sectionToggleBtn: toggleBtn,
        rowEl: row,
      });
    });
  });
}

// Expands each typed token into itself plus any synonym fragments, then
// requires every token to match SOMEWHERE in an entry's search text
// (tokens are AND'd together; each token's own synonym group is OR'd).
function searchSettingsIndex(query) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const results = [];
  _settingsSearchIndex.forEach(entry => {
    let score = 0;
    for (const tok of tokens) {
      const variants = [tok, ...(SETTINGS_SEARCH_SYNONYMS[tok] || [])];
      const hit = variants.find(v => entry.searchText.includes(v));
      if (!hit) { score = -1; break; } // this token has no match at all — exclude
      score += (hit === tok ? 2 : 1); // literal match ranks slightly above a synonym-only match
      if (entry.rowLabel && entry.rowLabel.toLowerCase().includes(tok)) score += 3; // direct label hit ranks highest
    }
    if (score > 0) results.push({ entry, score });
  });
  results.sort((a, b) => b.score - a.score);
  // Collapse to at most one "section-only" entry per section if a specific
  // row from that same section is already present higher in the list —
  // showing both is redundant.
  const seenSections = new Set();
  const deduped = [];
  results.forEach(r => {
    if (!r.entry.rowLabel) {
      if (seenSections.has(r.entry.sectionLabel)) return;
    } else {
      seenSections.add(r.entry.sectionLabel);
    }
    deduped.push(r);
  });
  return deduped.slice(0, 8).map(r => r.entry);
}

function jumpToSettingsResult(entry) {
  // Open the group (if this section lives inside one) then the section
  // itself, reusing the exact buttons wireAccordion() already wired —
  // clicking them keeps all of the accordion's own open/close bookkeeping
  // correct instead of hand-rolling a parallel version of it here.
  if (entry.groupLabel) {
    const groupBtn = document.querySelector(`#settings-accordion > .acc-section[data-acc="${CSS.escape(entry.groupLabel)}"] > .acc-head`);
    if (groupBtn && !groupBtn.closest('.acc-section').classList.contains('open')) groupBtn.click();
  }
  if (entry.sectionToggleBtn && !entry.sectionToggleBtn.closest('.acc-section').classList.contains('open')) {
    entry.sectionToggleBtn.click();
  }
  const target = entry.rowEl || entry.sectionToggleBtn;
  if (!target) return;
  // Give the accordion's own open animation/layout a beat to settle before
  // measuring scroll position.
  setTimeout(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const flashEl = entry.rowEl || entry.sectionToggleBtn.closest('.acc-section');
    const flashClass = entry.rowEl ? 'settings-row-flash' : 'acc-section-flash';
    flashEl.classList.remove(flashClass); void flashEl.offsetWidth; // restart animation if re-triggered
    flashEl.classList.add(flashClass);
    setTimeout(() => flashEl.classList.remove(flashClass), 1700);
  }, 120);
}

function renderSettingsSearchResults(results, query) {
  const box = $('settings-search-results');
  if (!box) return;
  if (!query.trim()) { box.style.display = 'none'; box.innerHTML = ''; return; }
  if (!results.length) {
    box.innerHTML = `<div class="settings-search-empty">No settings found for "${query.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}"</div>`;
    box.style.display = 'block';
    return;
  }
  box.innerHTML = results.map((entry, i) => {
    const path = entry.groupLabel ? `${entry.groupLabel} › ${entry.sectionLabel}` : entry.sectionLabel;
    const title = entry.rowLabel || entry.sectionLabel;
    return `<button type="button" class="settings-search-result" data-result-idx="${i}">
      ${title}<span class="ssr-path">${path}</span>
    </button>`;
  }).join('');
  box.style.display = 'block';
  box.querySelectorAll('.settings-search-result').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      jumpToSettingsResult(results[i]);
      box.style.display = 'none';
      const input = $('settings-search-input');
      if (input) input.blur();
    });
  });
}

function wireSettingsSearch() {
  const input = $('settings-search-input');
  const clearBtn = $('settings-search-clear-btn');
  const box = $('settings-search-results');
  if (!input || !box) return;
  let debounceTimer = null;
  input.addEventListener('input', () => {
    if (clearBtn) clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const results = searchSettingsIndex(input.value);
      renderSettingsSearchResults(results, input.value);
    }, 120);
  });
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });
  if (clearBtn) clearBtn.addEventListener('click', () => {
    input.value = ''; clearBtn.style.display = 'none';
    box.style.display = 'none'; box.innerHTML = '';
    input.focus();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.settings-search-wrap')) box.style.display = 'none';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; box.style.display = 'none'; input.blur(); }
  });
}

function transformSettingsToAccordion() {
  const content = $('content');
  if (!content) return;
  // Strip sections that shouldn't appear at all (header + every sibling up to
  // the next header/save button) before they're folded into the accordion:
  //  - demo mode hides every credential / integration / update section
  //  - the active family profile can hide Home Assistant and/or the extra
  //    integrations (Todoist, calendar push, daily briefing)
  const stripSections = new Set();
  if (window.__isDemo) DEMO_HIDDEN_SETTINGS_SECTIONS.forEach(s => stripSections.add(s));
  if (typeof profileHiddenSettingsSections === 'function') profileHiddenSettingsSections().forEach(s => stripSections.add(s));
  if (stripSections.size) {
    [...content.querySelectorAll('.section-header')].forEach(h => {
      if (!stripSections.has(h.textContent.trim())) return;
      let n = h.nextElementSibling;
      while (n && !n.classList.contains('section-header') && !n.classList.contains('settings-save')) {
        const next = n.nextElementSibling; n.remove(); n = next;
      }
      h.remove();
    });
  }
  const headers = [...content.querySelectorAll('.section-header')];
  if (!headers.length) return;

  // Collect each section: the header + all siblings up to the next header.
  const groups = headers.map(h => {
    const label = h.textContent.trim();
    const nodes = [];
    let n = h.nextElementSibling;
    while (n && !n.classList.contains('section-header') && !n.classList.contains('settings-save')) {
      const next = n.nextElementSibling; nodes.push(n); n = next;
    }
    return { label, header: h, nodes };
  });

  const accId = 'settings-accordion';
  const acc = document.createElement('div');
  acc.className = 'accordion'; acc.id = accId;

  // Each named group gets its own wrapper acc-section + inner mini-accordion,
  // built lazily the first time one of its member sections is encountered.
  const groupInner = {};   // groupName -> inner accordion element
  const groupWrapper = {}; // groupName -> outer acc-section element (the group itself)
  function getOrCreateGroup(groupName) {
    if (groupInner[groupName]) return groupInner[groupName];
    const inner = document.createElement('div');
    inner.className = 'accordion'; inner.id = 'settings-accordion-' + groupName.replace(/\W+/g, '-').toLowerCase();
    groupInner[groupName] = inner;

    const wrapper = document.createElement('div');
    wrapper.className = 'acc-section'; wrapper.dataset.acc = groupName;
    const body = document.createElement('div');
    body.className = 'acc-body'; body.dataset.accBody = groupName;
    body.style.display = 'none';
    body.appendChild(inner);
    const meta = SETTINGS_GROUP_META[groupName] || { icon: '📁', summary: '' };
    wrapper.innerHTML = `<button class="acc-head" data-acc-toggle="${groupName}">
      <span class="acc-ic">${meta.icon}</span>
      <span class="acc-text"><span class="acc-label">${groupName}</span><span class="acc-sub">${meta.summary}</span></span>
      <span class="acc-caret">▸</span></button>`;
    wrapper.appendChild(body);
    groupWrapper[groupName] = wrapper;

    if (!meta.deferToEnd) acc.appendChild(wrapper); // in-place: right where this group's first member appears
    return inner;
  }

  groups.forEach(g => {
    const sec = document.createElement('div');
    sec.className = 'acc-section'; sec.dataset.acc = g.label;
    // Default ALL sections collapsed — they only open when the user taps them.
    const open = false;
    const body = document.createElement('div');
    body.className = 'acc-body'; body.dataset.accBody = g.label;
    if (!open) body.style.display = 'none';
    g.nodes.forEach(node => body.appendChild(node));
    sec.innerHTML = `<button class="acc-head" data-acc-toggle="${g.label}">
      <span class="acc-ic">${SETTINGS_ICONS[g.label] || '•'}</span>
      <span class="acc-text"><span class="acc-label">${g.label}</span></span>
      <span class="acc-caret">${open ? '▾' : '▸'}</span></button>`;
    sec.appendChild(body);
    g.header.remove();

    const groupName = SETTINGS_GROUPS[g.label];
    if (groupName) getOrCreateGroup(groupName).appendChild(sec);
    else acc.appendChild(sec);
  });

  // Groups deferred to the end (currently just Advanced) get appended now,
  // after every ungrouped/in-place section — matches Advanced's long-standing
  // position at the bottom of the list.
  Object.keys(SETTINGS_GROUP_META).forEach(groupName => {
    if (SETTINGS_GROUP_META[groupName].deferToEnd && groupWrapper[groupName]) {
      acc.appendChild(groupWrapper[groupName]);
    }
  });

  // Explicit bottom-anchored standalone sections (Feedback & Ideas, Support
  // the Project) — moved here LAST, in BOTTOM_ANCHORED_SECTIONS' own order,
  // so they consistently sit below even the just-appended Advanced group
  // regardless of where their own section-header sits in the source
  // markup. appendChild on an already-present node moves it rather than
  // duplicating it, so this is a pure reorder, not a second copy.
  BOTTOM_ANCHORED_SECTIONS.forEach(label => {
    const sec = acc.querySelector(`:scope > .acc-section[data-acc="${CSS.escape(label)}"]`);
    if (sec) acc.appendChild(sec);
  });

  // Insert the accordion where the first header used to be (before the Save button).
  const saveBtn = content.querySelector('.settings-save');
  content.insertBefore(acc, saveBtn);

  // Wire the outer accordion and every group's own inner mini-accordion independently.
  wireAccordion(accId);
  Object.keys(groupInner).forEach(groupName => wireAccordion(groupInner[groupName].id));
}

// Re-render the Settings tab WITHOUT throwing the user back to the top: it
// records which accordion sections are open + the scroll position, calls
// renderSettings(), then re-opens the same path and restores scroll. Use
// this instead of a bare renderSettings() after an in-section save so a
// toggle/add/delete doesn't collapse everything.
async function renderSettingsKeepPlace() {
  const root = document.getElementById('settings-accordion');
  const openIds = root ? [...root.querySelectorAll('.acc-section.open')].map(s => s.dataset.acc).filter(Boolean) : [];
  const sc = document.getElementById('content');
  const sy = sc ? sc.scrollTop : 0;
  await renderSettings();
  // Document order puts an outer group before its sub-sections, so opening
  // in this order restores the full "group → section" path correctly.
  for (const id of openIds) {
    const head = document.querySelector(`#settings-accordion [data-acc-toggle="${String(id).replace(/["\\]/g, '\\$&')}"]`);
    const sec = head && head.closest('.acc-section');
    if (head && sec && !sec.classList.contains('open')) head.click();
  }
  if (sc) sc.scrollTop = sy;
}

