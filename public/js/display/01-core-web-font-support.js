
// A number with the household language's decimal mark (12.5 -> 12,5 in German); English is plain toFixed.
const fmtNum = (v, minF, maxF) => (window.i18n && i18n.num) ? i18n.num(v, minF, maxF) : (maxF != null && maxF !== minF ? String(Math.round(v * Math.pow(10, maxF)) / Math.pow(10, maxF)) : Number(v).toFixed(minF || 0));
const MONTHS = (window.i18n && i18n.months('long')) || ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_S = (window.i18n && i18n.months('short')) || ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = (window.i18n && i18n.weekdays('long')) || ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAYS_S = (window.i18n && i18n.weekdays('short')) || ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Web font support (text widget) ────────────────────────────────────────────
// Mirror of the app's font map. System fonts render instantly; the rest are loaded
// from Google Fonts on demand the first time a widget uses them.
const FONT_STACKS = {
  'Inter': "'Inter',sans-serif",
  'Montserrat': "'Montserrat',sans-serif",
  'Oswald': "'Oswald',sans-serif",
  'Bebas Neue': "'Bebas Neue',sans-serif",
  'Playfair Display': "'Playfair Display',serif",
  'Merriweather': "'Merriweather',serif",
  'Georgia': "Georgia,'Times New Roman',serif",
  'Dancing Script': "'Dancing Script',cursive",
  'Pacifico': "'Pacifico',cursive",
  'Great Vibes': "'Great Vibes',cursive",
  'Sacramento': "'Sacramento',cursive",
  'Satisfy': "'Satisfy',cursive",
  'Caveat': "'Caveat',cursive",
  'Lobster': "'Lobster',cursive",
  'Comfortaa': "'Comfortaa',sans-serif",
  'Righteous': "'Righteous',sans-serif",
};
const GOOGLE_FONTS = new Set(Object.keys(FONT_STACKS).filter(f => f !== 'Georgia' && f !== 'Inter'));
function cssFontStack(name) { return FONT_STACKS[name] || FONT_STACKS['Inter']; }
function ensureWebFont(name) {
  if (!name || !GOOGLE_FONTS.has(name)) return;
  const id = 'gfont-' + name.replace(/\s+/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;500;700&display=swap`;
  document.head.appendChild(link);
}
// Themed calendar decoration icons (used when a calendar widget's calDecor is "icon:NAME").
// A day with one or more events shows this icon; more events repeat it (capped).
const CAL_DECOR_ICONS = {
  star: '⭐', sparkle: '✨', ornament: '🎄', egg: '🥚',
  pumpkin: '🎃', leaf: '🍁', balloon: '🎈',
  heart: '❤️', flower: '🌸', sun: '☀️', wave: '🌊',
  turkey: '🦃', menorah: '🕎',
};
// ── Weather SVG icons (no emoji font dependency — renders reliably in kiosk Chromium) ──
function weatherSVG(code, isDay = 1) {
  const c = '#e8edf5', sun = '#fbbf24', moon = '#cbd5e8', cloud = '#9bb0cc', rain = '#5b9bd5', snow = '#cfe3f5', bolt = '#fbbf24';
  const icons = {
    clear: `<svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="10" fill="${sun}"/>
      <g stroke="${sun}" stroke-width="2.5" stroke-linecap="round"><line x1="24" y1="2" x2="24" y2="8"/><line x1="24" y1="40" x2="24" y2="46"/>
      <line x1="2" y1="24" x2="8" y2="24"/><line x1="40" y1="24" x2="46" y2="24"/>
      <line x1="8.5" y1="8.5" x2="12.5" y2="12.5"/><line x1="35.5" y1="35.5" x2="39.5" y2="39.5"/>
      <line x1="8.5" y1="39.5" x2="12.5" y2="35.5"/><line x1="35.5" y1="12.5" x2="39.5" y2="8.5"/></g></svg>`,
    // Night-clear: crescent moon (used instead of the sun when is_day = 0).
    clearnight: `<svg viewBox="0 0 48 48" fill="none"><path d="M30 6a18 18 0 1 0 12 30A14 14 0 0 1 30 6z" fill="${moon}"/>
      <g fill="#fff" opacity="0.85"><circle cx="14" cy="12" r="1"/><circle cx="20" cy="7" r="0.8"/><circle cx="10" cy="20" r="0.8"/></g></svg>`,
    partlycloudy: `<svg viewBox="0 0 48 48" fill="none"><circle cx="19" cy="18" r="8" fill="${sun}"/>
      <path d="M14 36c-4.4 0-8-3.4-8-7.6 0-3.8 2.9-7 6.7-7.5C13.6 17 17 14 21.5 14c5 0 9.2 3.6 10 8.3 3.9.6 6.9 4 6.9 8 0 4.5-3.7 8.1-8.3 8.1H14z" fill="${cloud}"/></svg>`,
    // Night partly-cloudy: moon peeking behind the cloud.
    partlycloudynight: `<svg viewBox="0 0 48 48" fill="none"><path d="M24 7a10 10 0 1 0 7 17A8 8 0 0 1 24 7z" fill="${moon}"/>
      <path d="M14 36c-4.4 0-8-3.4-8-7.6 0-3.8 2.9-7 6.7-7.5C13.6 17 17 14 21.5 14c5 0 9.2 3.6 10 8.3 3.9.6 6.9 4 6.9 8 0 4.5-3.7 8.1-8.3 8.1H14z" fill="${cloud}"/></svg>`,
    cloudy: `<svg viewBox="0 0 48 48" fill="none"><path d="M13 37c-5 0-9-3.9-9-8.7 0-4.4 3.3-8 7.6-8.6C12.5 14.8 17 11 22.3 11c5.8 0 10.6 4.2 11.5 9.6 4.5.6 8 4.6 8 9.3 0 5.2-4.3 9.4-9.6 9.4H13z" fill="${cloud}"/></svg>`,
    fog: `<svg viewBox="0 0 48 48" fill="none"><path d="M13 22c-4.4 0-8-3.2-8-7.2 0-3.6 2.9-6.6 6.7-7.1C12.5 4.6 16.7 2 21.5 2c5 0 9.2 3.4 10 7.8 3.9.6 6.9 3.8 6.9 7.6 0 .5 0 .9-.1 1.4H13z" fill="${cloud}" opacity="0.7"/>
      <g stroke="${cloud}" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="28" x2="42" y2="28"/><line x1="10" y1="34" x2="38" y2="34"/><line x1="6" y1="40" x2="42" y2="40"/></g></svg>`,
    drizzle: `<svg viewBox="0 0 48 48" fill="none"><path d="M13 26c-4.4 0-8-3.2-8-7.2 0-3.6 2.9-6.6 6.7-7.1C12.5 7.6 16.7 5 21.5 5c5 0 9.2 3.4 10 7.8 3.9.6 6.9 3.8 6.9 7.6 0 3.7-3.2 6.6-7.2 6.6H13z" fill="${cloud}"/>
      <g stroke="${rain}" stroke-width="2.5" stroke-linecap="round"><line x1="15" y1="32" x2="13" y2="38"/><line x1="24" y1="32" x2="22" y2="38"/><line x1="33" y1="32" x2="31" y2="38"/></g></svg>`,
    rain: `<svg viewBox="0 0 48 48" fill="none"><path d="M13 24c-4.4 0-8-3.2-8-7.2 0-3.6 2.9-6.6 6.7-7.1C12.5 5.6 16.7 3 21.5 3c5 0 9.2 3.4 10 7.8 3.9.6 6.9 3.8 6.9 7.6 0 3.7-3.2 6.6-7.2 6.6H13z" fill="${cloud}"/>
      <g stroke="${rain}" stroke-width="3" stroke-linecap="round"><line x1="14" y1="30" x2="11" y2="40"/><line x1="24" y1="30" x2="21" y2="40"/><line x1="34" y1="30" x2="31" y2="40"/></g></svg>`,
    snow: `<svg viewBox="0 0 48 48" fill="none"><path d="M13 22c-4.4 0-8-3.2-8-7.2 0-3.6 2.9-6.6 6.7-7.1C12.5 3.6 16.7 1 21.5 1c5 0 9.2 3.4 10 7.8 3.9.6 6.9 3.8 6.9 7.6 0 3.7-3.2 6.6-7.2 6.6H13z" fill="${cloud}"/>
      <g stroke="${snow}" stroke-width="2.5" stroke-linecap="round"><line x1="14" y1="29" x2="14" y2="41"/><line x1="8.5" y1="32" x2="19.5" y2="38"/><line x1="8.5" y1="38" x2="19.5" y2="32"/>
      <line x1="34" y1="29" x2="34" y2="41"/><line x1="28.5" y1="32" x2="39.5" y2="38"/><line x1="28.5" y1="38" x2="39.5" y2="32"/></g></svg>`,
    thunder: `<svg viewBox="0 0 48 48" fill="none"><path d="M13 22c-4.4 0-8-3.2-8-7.2 0-3.6 2.9-6.6 6.7-7.1C12.5 3.6 16.7 1 21.5 1c5 0 9.2 3.4 10 7.8 3.9.6 6.9 3.8 6.9 7.6 0 3.7-3.2 6.6-7.2 6.6H13z" fill="${cloud}"/>
      <path d="M25 26l-7 11h6l-3 9 10-13h-6l4-7z" fill="${bolt}"/></svg>`,
  };
  const map = {
    0:'clear', 1:'partlycloudy', 2:'partlycloudy', 3:'cloudy',
    45:'fog', 48:'fog',
    51:'drizzle', 53:'drizzle', 55:'drizzle',
    61:'rain', 63:'rain', 65:'rain',
    71:'snow', 73:'snow', 75:'snow',
    80:'drizzle', 81:'rain', 82:'thunder',
    95:'thunder', 96:'thunder', 99:'thunder',
  };
  let key = map[code] || 'cloudy';
  // At night, swap the sunny variants for their moon counterparts.
  if (!isDay) {
    if (key === 'clear') key = 'clearnight';
    else if (key === 'partlycloudy') key = 'partlycloudynight';
  }
  return icons[key] || icons.cloudy;
}

const WMO_ICONS = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',95:'⛈️',96:'⛈️',99:'⛈️'};
const WMO_DESC = {0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',48:'Icy fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Showers',81:'Rain showers',82:'Violent showers',95:'Thunderstorm',96:'Thunderstorm',99:'Heavy thunderstorm'};

function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function use24Hour(){ return !!(state.settings && state.settings.time_format === '24'); }
// Returns 'upper' or 'lower' — the display-wide am/pm casing preference
// (Settings → Display → "AM/PM Style"), defaulting to lowercase. Optional
// `override` ('upper'|'lower') lets a specific widget ignore the
// display-wide setting — same shape as weekStartDay()'s override param
// above and clockTimeFormat's 'default'-means-follow-global convention.
function ampmCase(override){ if (override === 'upper' || override === 'lower') return override; return (state.settings && state.settings.ampm_case === 'upper') ? 'upper' : 'lower'; }
// Returns 0 (Sunday) or 1 (Monday) based on the week_start_day setting.
// Optional `override` (0 or 1) lets a specific widget ignore the display-wide
// setting — used for the minical grid's per-widget "Week starts on" option.
function weekStartDay(override){ if (override === 0 || override === 1) return override; return (state.settings && state.settings.week_start_day === '1') ? 1 : 0; }
// JS's native getDay() is always 0=Sun..6=Sat, regardless of any preference —
// this re-indexes it relative to the CONFIGURED start of the week, so grid math
// ("how many empty cells before day 1") works correctly either way.
function dayIndexForWeekStart(date, override){ return (date.getDay() - weekStartDay(override) + 7) % 7; }
function fmtTime(t, ampmOverride){ if(!t) return 'All day'; const [h,m]=t.split(':').map(Number); if (use24Hour()) return `${pad(h)}:${pad(m)}`; const meridiem = h>=12?'pm':'am'; return `${h%12||12}:${pad(m)} ${ampmCase(ampmOverride)==='upper' ? meridiem.toUpperCase() : meridiem}`; }

// ── State ────────────────────────────────────────────────────────────────────
let state = { events:[], reminders:[], messages:[], cameras:[], meals:{}, weather:null, settings:{}, photoSettings:{}, photos:[], layout:[], tasksByProject:{}, tasksErrorByProject:{}, news:[], newsError:null, stocks:[], stocksError:null, choreChart:null, stickers:[], flightmap:{}, flightWatch:[] };
// Set during startup identity resolution (see the /api/screen-config call
// below) and left as the single source of truth for "is this device
// currently a slave" everywhere else in the file — enterEditMode() in
// particular gates on this, see its own comment for why.
let isSlaveDevice = false;
let slideIndex = 0, slideTimer = null;
// Per-widget independent slideshow state, for any photo widget with its own
// custom cycle time (w.photoInterval) instead of following the shared global
// timer above. Keyed by widget id: { index, timer, currentMs }.
const widgetSlideState = {};
// Which slideIndex a given photo widget should use — its OWN independent one,
// if it has a custom interval configured and syncPerWidgetPhotoTimers() has set
// one up for it, otherwise the shared global one every other widget uses.
function getSlideIndexForWidget(w) {
  const st = w && w.photoInterval ? widgetSlideState[w.id] : null;
  return st ? st.index : slideIndex;
}
// Keeps the set of per-widget timers in sync with the current layout — called
// whenever the layout changes (not just once at startup), since widgets get
// added/removed/reconfigured live. Starts a new independent timer for any
// photo widget that has a custom interval and doesn't have one running yet (or
// whose interval just changed), and tears down timers for widgets that no
// longer exist or no longer have a custom interval set (those fall back to the
// shared global timer instead).
function syncPerWidgetPhotoTimers() {
  const activeIds = new Set();
  (state.layout || []).forEach(w => {
    if (w.type !== 'photo' || !w.photoInterval) return;
    const id = String(w.id);
    activeIds.add(id);
    const desiredMs = Math.max(3, parseInt(w.photoInterval) || 30) * 1000;
    let st = widgetSlideState[id];
    if (!st) { st = widgetSlideState[id] = { index: 0, timer: null, currentMs: 0 }; }
    if (st.currentMs === desiredMs) return; // already running at the right interval
    if (st.timer) clearInterval(st.timer);
    st.currentMs = desiredMs;
    st.timer = setInterval(() => {
      // Re-resolve the widget fresh from state.layout by id on every tick, rather
      // than closing over the `w` captured when this timer was created — that `w`
      // goes stale the moment the widget's OWN settings change (e.g. which photo
      // is selected) without its interval also changing, since this whole block is
      // skipped (via the currentMs check above) whenever the interval is unchanged.
      // A stale closure meant the timer kept iterating the widget's OLD photo list
      // forever after an edit — looking like a slideshow that wouldn't turn off
      // even with only one photo selected. Matches how the shared global timer in
      // startSlideshowTimer() already re-looks-up its widget fresh every tick.
      const current = (state.layout || []).find(ww => String(ww.id) === id) || w;
      const photos = photosForWidget(current);
      if (!photos.length) return;
      st.index = (st.index + 1) % photos.length;
      const el = document.querySelector(`#canvas .widget-photo[data-widget-id="${id}"]`);
      if (el) crossfadePhotoWidget(el, current);
    }, desiredMs);
  });
  Object.keys(widgetSlideState).forEach(id => {
    if (!activeIds.has(id)) {
      if (widgetSlideState[id].timer) clearInterval(widgetSlideState[id].timer);
      delete widgetSlideState[id];
    }
  });
}
let currentOrientation = null;

// Tell the local server once this page has really put a frame on screen. Two animation frames, because
// requestAnimationFrame only fires while the browser is compositing the window: a page that runs but is
// stuck blank (or never ran at all) stays silent, and the kiosk launcher's paint watchdog then reloads it.
let _paintedSent = false;
function reportPainted() {
  if (_paintedSent) return;
  _paintedSent = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { fetch('/api/display/painted', { method: 'POST', keepalive: true }).catch(() => {}); } catch {}
  }));
}

// ── Orientation ──────────────────────────────────────────────────────────────
// The display's render config (orientation override + in-browser rotation),
// loaded from /api/display-config at startup. Defaults keep the old auto behavior.
let displayConfig = { force_orientation: 'auto', rotation: 0, theme: '', screensaverTag: '', screensaverPhotoId: null, ambientMode: '', ambientClockCorner: 'bl', ambientPhotoFit: 'cover', ambientFadeTransition: true, ambientPhotoInterval: '', ambientBlurBg: true, ambientFadeDuration: '2', fxScale: '1', fxDensity: '1', customBg: '', customDeco1: '', customDeco2: '', customDeco3: '', customDeco1Behavior: 'random', customDeco2Behavior: 'random', customDeco3Behavior: 'random' };

// ── Theme (template) backgrounds & effects ───────────────────────────────────
// Sets body[data-theme] (drives the CSS background scene) and spawns the matching
// animated particles into #theme-fx. Safe to call repeatedly; clears prior FX.
// Tracks setInterval ids for Flight Deck's continuously-updating TCAS altitude tags —
// clearing #theme-fx's innerHTML removes the DOM elements but NOT these JS
// timers, so without this list they'd silently pile up every time applyTheme()
// re-runs (theme change, orientation change, etc.).
let _tcasIntervals = [];
function applyTheme() {
  _tcasIntervals.forEach(id => clearInterval(id));
  _tcasIntervals = [];
  const theme = (displayConfig.theme || '').trim();
  const body = document.body;
  const fx = document.getElementById('theme-fx');
  if (fx) fx.innerHTML = '';

  if (!theme) { body.removeAttribute('data-theme'); try { applyTextColor(); applyFontFamily(); } catch {} return; }
  body.setAttribute('data-theme', theme);
  try { applyTextColor(); applyFontFamily(); } catch {} // re-evaluate light/dark text for the new theme
  // Themes that rely on a specific web font load it here so it's ready before render
  // (e.g. the Chalkboard's handwritten Caveat font used across the whole display).
  try {
    if (theme === 'chalkboard') ensureWebFont('Caveat');
  } catch {}
  if (!fx) return;

  // Each theme maps to a particle recipe. Kept lightweight (CSS transforms only)
  // so it's smooth even on a Pi. Counts are modest for the same reason.
  // fxDensity (user-adjustable, Devices tab) scales how MANY particles spawn —
  // separate from fxScale, which scales how big each one is. Wrapping it into
  // the shared make() helper here means every theme's particle count scales
  // automatically without touching each individual call site.
  //
  // NOT `parseFloat(...) || 1`: that's a real bug when the setting is "Off",
  // since Off's actual value is the number 0, which is falsy in JS — the ||
  // would silently treat an explicit 0 the same as "nothing set at all" and
  // fall back to the default (1, full density), meaning "Off" never actually
  // turned animations off. parseFloat's own NaN result is the correct signal
  // for "nothing valid was set"; 0 itself needs to survive untouched.
  const parsedFxDensity = parseFloat(displayConfig.fxDensity);
  const userFxDensity = Number.isNaN(parsedFxDensity) ? 1 : parsedFxDensity;
  const make = (count, build) => {
    const n = Math.max(0, Math.round(count * userFxDensity));
    for (let i = 0; i < n; i++) fx.appendChild(build(i));
  };
  const el = (html, style) => {
    const d = document.createElement('div');
    d.className = 'fx-particle';
    d.style.cssText = style;
    d.innerHTML = html;
    return d;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  // Particle sizes were fixed pixel values, never wired into the --ui-scale system
  // everything else (fonts, widget sizes) already uses to look right across very
  // different screen resolutions — so they looked the same size on a 4K TV as on
  // a small tablet, appearing too small on a big screen. fxScale combines that
  // existing auto-scale with a new user-adjustable multiplier (Devices tab) for
  // further control beyond what auto-scaling alone gets right.
  const wrapEl = document.getElementById('rotate-wrap');
  const cssUiScale = wrapEl ? (parseFloat(getComputedStyle(wrapEl).getPropertyValue('--ui-scale')) || 1) : 1;
  const userFxScale = parseFloat(displayConfig.fxScale) || 1;
  const fxScale = cssUiScale * userFxScale;
  const rndSize = (a, b) => rnd(a, b) * fxScale;
  // For the themes below that spawn particles via a manual for-loop instead of
  // make() (because they need to attach extra elements — embers — per iteration,
  // which make() doesn't support), scale their own loop bound the same way.
  const densify = (count) => Math.max(0, Math.round(count * userFxDensity));

  if (theme === 'christmas') {
    // Mostly real snowflake shapes, with a smaller portion of plain dots mixed
    // in for depth — like real snowfall, where distant flakes read as tiny
    // specks and closer ones show actual detail.
    const flakes = ['❄','❅','❆'];
    make(30, (i) => {
      const size = rndSize(12, 26), left = rnd(0, 100), dur = rnd(7, 15), delay = rnd(-15, 0);
      return el(flakes[i % flakes.length], `left:${left}%;font-size:${size}px;color:rgba(255,255,255,0.9);`
        + `--drift:${rnd(-40,40)}px;animation:fx-fall ${dur}s linear ${delay}s infinite;`);
    });
    make(16, () => {
      const size = rndSize(3, 7), left = rnd(0, 100), dur = rnd(6, 14), delay = rnd(-14, 0);
      return el('', `left:${left}%;width:${size}px;height:${size}px;border-radius:50%;`
        + `background:rgba(255,255,255,0.8);--drift:${rnd(-40,40)}px;`
        + `animation:fx-fall ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'easter') {
    // Painted Easter eggs (a real egg shape, not a plain dot) gently floating
    // upward, each a different pastel with a simple decorative stripe — like
    // hand-painted eggs, not identical colored blobs.
    const colors = ['#ffd1dc','#cdeac0','#b5d8ff','#fff3b0','#e0c3fc'];
    const stripes = ['#ff8fab','#8fd694','#7fb8e8','#ffe066','#c084fc'];
    make(16, (i) => {
      const w = rndSize(15, 25), h = w * 1.3, left = rnd(0, 100), dur = rnd(11, 20), delay = rnd(-20, 0);
      const color = colors[i % colors.length];
      const stripe = stripes[i % stripes.length];
      const egg = `<div style="width:100%;height:100%;border-radius:50% 50% 50% 50% / 40% 40% 60% 60%;`
        + `background:${color};position:relative;overflow:hidden;`
        + `box-shadow:inset -15% -10% 20% rgba(0,0,0,0.12), inset 12% 12% 18% rgba(255,255,255,0.4);">`
        + `<div style="position:absolute;left:0;right:0;top:38%;height:16%;background:${stripe};opacity:0.8;"></div>`
        + `</div>`;
      return el(egg, `left:${left}%;width:${w}px;height:${h}px;opacity:0.9;--drift:${rnd(-30,30)}px;`
        + `animation:fx-egg-rise ${dur}s ease-in-out ${delay}s infinite;`);
    });
  } else if (theme === 'autumn') {
    const leaves = ['🍂','🍁','🍃'];
    make(24, (i) => {
      const size = rndSize(16, 30), left = rnd(0, 100), dur = rnd(8, 16), delay = rnd(-16, 0);
      return el(leaves[i % leaves.length], `left:${left}%;font-size:${size}px;--drift:${rnd(-60,60)}px;`
        + `animation:fx-fall ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'halloween') {
    make(14, (i) => {
      const size = rndSize(18, 34), left = rnd(0, 100), dur = rnd(7, 13), delay = rnd(-13, 0);
      return el('🦇', `left:${left}%;font-size:${size}px;--drift:${rnd(-120,120)}px;`
        + `animation:fx-fall ${dur}s ease-in-out ${delay}s infinite;`);
    });
  } else if (theme === 'july4') {
    applyTheme_if315({ fx, el, rnd, fxScale, rndSize, densify });
  } else if (theme === 'newyear') {
    applyTheme_if362({ fx, make, el, rnd, fxScale, rndSize, densify });
  } else if (theme === 'birthday') {
    // Multi-colored balloons drifting upward — CSS-drawn (not an emoji) so each
    // one can actually be a different color, rather than all rendering identically.
    const colors = ['#ff5d8f','#4cc9f0','#ffd166','#9b5de5','#06d6a0','#ff8fab'];
    make(14, (i) => {
      const w = rndSize(22, 36), h = w * 1.18, left = rnd(0, 100), dur = rnd(10, 18), delay = rnd(-18, 0);
      const color = colors[i % colors.length];
      const body = `<div style="width:100%;height:80%;border-radius:50% 50% 50% 50% / 58% 58% 42% 42%;`
        + `background:${color};box-shadow:inset -25% -20% 30% rgba(0,0,0,0.18), inset 20% 20% 25% rgba(255,255,255,0.35);"></div>`
        + `<div style="position:absolute;left:50%;top:80%;width:1px;height:22%;background:rgba(255,255,255,0.4);transform:translateX(-50%);"></div>`;
      return el(body, `left:${left}%;width:${w}px;height:${h}px;--drift:${rnd(-50,50)}px;`
        + `animation:fx-rise ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'thanksgiving') {
    // Harvest leaves, a chestnut, and drifting wheat — deliberately a different
    // glyph mix from Autumn's ('🍂','🍁','🍃') so picking this over the plain
    // seasonal template still feels like its own distinct look.
    const harvest = ['🍂','🌰','🌾'];
    make(20, (i) => {
      const size = rndSize(15, 28), left = rnd(0, 100), dur = rnd(9, 17), delay = rnd(-17, 0);
      return el(harvest[i % harvest.length], `left:${left}%;font-size:${size}px;--drift:${rnd(-50,50)}px;`
        + `animation:fx-fall ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'hanukkah') {
    // Calm, not confetti — mostly soft rising candlelight embers (like Summer's
    // bubbles, but warm gold) with a few Stars of David drifting up among them,
    // fitting a holiday about light rather than a festive shower.
    make(24, () => {
      const size = rndSize(5, 13), left = rnd(0, 100), dur = rnd(9, 17), delay = rnd(-17, 0);
      return el('', `left:${left}%;width:${size}px;height:${size}px;border-radius:50%;`
        + `background:rgba(255,208,110,0.55);box-shadow:0 0 6px 2px rgba(255,208,110,0.35);`
        + `--drift:${rnd(-25,25)}px;animation:fx-rise ${dur}s linear ${delay}s infinite;`);
    });
    make(8, () => {
      const size = rndSize(14, 22), left = rnd(0, 100), dur = rnd(12, 20), delay = rnd(-20, 0);
      return el('✡️', `left:${left}%;font-size:${size}px;opacity:0.8;--drift:${rnd(-30,30)}px;`
        + `animation:fx-rise ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'valentine') {
    // Floating hearts drifting upward
    make(18, (i) => {
      const size = rndSize(14, 28), left = rnd(0, 100), dur = rnd(9, 18), delay = rnd(-18, 0);
      return el('❤️', `left:${left}%;font-size:${size}px;opacity:0.85;--drift:${rnd(-40,40)}px;`
        + `animation:fx-rise ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'spring') {
    // Falling blossom petals
    const petals = ['🌸','🌼','🌷'];
    make(20, (i) => {
      const size = rndSize(14, 26), left = rnd(0, 100), dur = rnd(10, 18), delay = rnd(-18, 0);
      return el(petals[i % petals.length], `left:${left}%;font-size:${size}px;--drift:${rnd(-70,70)}px;`
        + `animation:fx-fall ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'summer') {
    // Gentle rising bubbles, like sun-warmed sea
    make(22, () => {
      const size = rndSize(6, 16), left = rnd(0, 100), dur = rnd(8, 16), delay = rnd(-16, 0);
      return el('', `left:${left}%;width:${size}px;height:${size}px;border-radius:50%;`
        + `background:rgba(255,255,255,0.35);border:1px solid rgba(255,255,255,0.5);--drift:${rnd(-30,30)}px;`
        + `animation:fx-rise ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'aviation') {
    applyTheme_if466({ make, el, rnd, rndSize });
  } else if (theme === 'nautical') {
    // Boats drifting slowly across the waterline — reuses fx-flypath (built for
    // planes) but with y0≈y1 so the movement reads as purely horizontal, at a
    // slight per-boat offset for depth. Genuinely slow (40-70s to cross) to
    // read as "drifting," not racing. Most emoji fonts render these boats
    // facing right by default, so right-to-left boats are flipped via
    // scaleX(-1) rather than rotated (rotating would tip the boat, which looks
    // wrong for something that should stay upright on the water).
    const boats = ['⛵','🚤','🛥️','⛴️'];
    make(5, (i) => {
      const boat = boats[i % boats.length];
      const goingRight = Math.random() < 0.5;
      const y = rnd(62, 86); // stays within the water band of the background
      const x0 = goingRight ? -10 : 110, x1 = goingRight ? 110 : -10;
      const size = rndSize(22, 38), dur = rnd(40, 70), delay = rnd(-70, 0);
      const flip = goingRight ? '' : 'scaleX(-1)';
      return el(`<span style="display:inline-block;transform:${flip};filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))">${boat}</span>`,
        `--x0:${x0}vw;--y0:${y}vh;--x1:${x1}vw;--y1:${(y + rnd(-2,2)).toFixed(1)}vh;--face:0deg;`
        + `font-size:${size}px;animation:fx-flypath ${dur}s linear ${delay}s infinite;`);
    });
  } else if (theme === 'custom') {
    applyTheme_if523({ make, el, rnd, rndSize });
  } else if (theme === 'flightdeck') {
    applyTheme_if564({ fx, rnd, densify });
  }
  // 'postit', 'minimal', 'moderndark', and the clean family themes have no particles by design.
}

// Orientation decides which saved layout (landscape/portrait) to show. Normally
// auto-detected from the screen, but a display can force one regardless — useful
// when the physical screen's reported size doesn't match how it's mounted.
function getOrientation(){
  // The display's own orientation: honor a forced setting, else derive from the real
  // screen resolution. In PREVIEW we still want the display's TRUE orientation (so a
  // landscape TV previews as landscape even on a portrait phone) — not the phone's.
  // A ?previewOrientation= URL param (set by the Layout tab's Live Preview) takes
  // priority over everything else — purely additive, only present when explicitly
  // set, so it can't affect any real display's own detection.
  const previewOrientationParam = new URLSearchParams(window.location.search).get('previewOrientation');
  if (previewOrientationParam === 'landscape' || previewOrientationParam === 'portrait') return previewOrientationParam;
  if (displayConfig.force_orientation === 'landscape') return 'landscape';
  if (displayConfig.force_orientation === 'portrait') return 'portrait';
  if (IS_PREVIEW && state.displayRes && state.displayRes.w && state.displayRes.h) {
    return state.displayRes.w >= state.displayRes.h ? 'landscape' : 'portrait';
  }
  return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
}

// When rotated 90° or 270°, the content's width/height are swapped relative to the
// physical screen, so layout math must use the rotated frame's dimensions, not the
// raw viewport's. 0°/180° keep the viewport dimensions as-is.
// In preview the layout is drawn into the letterboxed mini-display box (set by
// applyPreviewScale), so widget positions must be relative to THAT box, not the full
// phone viewport. _previewBox holds its pixel size.
let _previewBox = null;
function effectiveWidth(){
  if (IS_PREVIEW && _previewBox) return _previewBox.w;
  const r = displayConfig.rotation || 0;
  return (r === 90 || r === 270) ? window.innerHeight : window.innerWidth;
}
function effectiveHeight(){
  if (IS_PREVIEW && _previewBox) return _previewBox.h;
  const r = displayConfig.rotation || 0;
  return (r === 90 || r === 270) ? window.innerWidth : window.innerHeight;
}

// Applies the in-browser rotation to the wrapper so the whole view (photos +
// widgets) spins together. Sizes the wrapper to the rotated frame first so its
// contents lay out in the right aspect, then rotates it about the viewport center.
function applyRotation() {
  const wrap = document.getElementById('rotate-wrap');
  if (!wrap) return;

  // PREVIEW MODE: render the whole display at a fixed reference size matching the
  // wall screen's aspect ratio, then shrink the ENTIRE thing with one transform so
  // it's a true miniature — fonts, spacing and widgets all scale by the identical
  // factor. This looks exactly like the TV, just smaller (unlike per-font scaling,
  // which can't keep proportions when the viewport's aspect ratio differs).
  if (IS_PREVIEW) {
    applyPreviewScale();
    return;
  }

  const r = displayConfig.rotation || 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (r === 90 || r === 270) {
    // Wrapper takes the swapped dimensions, then we offset + rotate so the
    // rotated box ends up centered and filling the physical screen.
    wrap.style.width = vh + 'px';
    wrap.style.height = vw + 'px';
    wrap.style.left = ((vw - vh) / 2) + 'px';
    wrap.style.top = ((vh - vw) / 2) + 'px';
    wrap.style.transform = `rotate(${r}deg)`;
  } else {
    wrap.style.width = vw + 'px';
    wrap.style.height = vh + 'px';
    wrap.style.left = '0px';
    wrap.style.top = '0px';
    wrap.style.transform = r === 180 ? 'rotate(180deg)' : 'none';
  }
  applyUiScale();
}

// Preview renders at the REAL display's resolution, then scales the whole canvas
// down to fit the viewport (letterboxed). This makes the preview a true miniature
// of the wall display — identical proportions and relative text sizes — so no
// zooming is ever needed. The TV's actual resolution is reported by the Pi
// (state.displayRes); we fall back to common sizes only if it isn't known yet.
const PREVIEW_FALLBACK_LANDSCAPE = { w: 3840, h: 2160 }; // 4K 16:9
const PREVIEW_FALLBACK_PORTRAIT  = { w: 2160, h: 3840 };
function applyPreviewScale() {
  const wrap = document.getElementById('rotate-wrap');
  if (!wrap) return;
  const vw = window.innerWidth, vh = window.innerHeight;

  // The display's true size/orientation (real TV res if known, else 4K fallback).
  const portrait = getOrientation() === 'portrait';
  // A Live Preview (Layout tab) can ask for a SPECIFIC reference resolution via
  // ?previewResolution=WxH, taking priority over the server-reported one — this
  // is what actually lets someone preview at a size other than their one real,
  // already-deployed screen. Without this, previewing a portrait layout while
  // the reported screen is landscape (or vice versa) rendered at the WRONG
  // aspect ratio entirely — right widget data, wrong shape.
  const resParam = new URLSearchParams(window.location.search).get('previewResolution');
  let ref;
  if (resParam && /^\d+x\d+$/.test(resParam)) {
    const [rw, rh] = resParam.split('x').map(Number);
    ref = { w: rw, h: rh };
  } else {
    ref = state.displayRes && state.displayRes.w && state.displayRes.h
      ? { w: state.displayRes.w, h: state.displayRes.h }
      : (portrait ? PREVIEW_FALLBACK_PORTRAIT : PREVIEW_FALLBACK_LANDSCAPE);
  }

  // A ?previewRotation= param (set by the Layout tab's Live Preview, when the
  // profile being edited has a rotation override) swaps the reference frame's
  // width/height for 90°/270°, exactly like effectiveWidth()/effectiveHeight()
  // already do for a REAL (non-preview) rotated display. Widget percentages
  // are always interpreted against this "effective" frame in both modes by
  // design — so this swap alone is enough; unlike the real display, preview
  // has no actual physical monitor with a fixed native pixel grid to map back
  // onto afterward, so no further CSS rotate() transform is needed here. Was
  // a real, confirmed bug before this: a profile rotated 90° previewed flat,
  // still landscape-shaped, never reflecting the rotation at all.
  const rotationParam = Number(new URLSearchParams(window.location.search).get('previewRotation')) || 0;
  if (rotationParam === 90 || rotationParam === 270) {
    ref = { w: ref.h, h: ref.w };
  }

  // KEY APPROACH (no transform, no 4K canvas — those fought the mobile viewport):
  // render the wrapper at a real, on-screen size that fits the phone while keeping
  // the TV's exact aspect ratio (letterboxed). Then size widget *fonts* via --ui-scale
  // so a label that's e.g. 5% of the TV's width is also 5% of this box's width. Widget
  // positions are already percentages, so the layout matches the TV proportionally.
  const fitScale = Math.min(vw / ref.w, vh / ref.h); // how much the TV shrinks to fit
  const boxW = Math.round(ref.w * fitScale);
  const boxH = Math.round(ref.h * fitScale);

  wrap.style.transform = 'none';
  wrap.style.position = 'fixed';
  wrap.style.width = boxW + 'px';
  wrap.style.height = boxH + 'px';
  // Center in the viewport (letterbox margins).
  wrap.style.left = Math.max(0, Math.round((vw - boxW) / 2)) + 'px';
  wrap.style.top = Math.max(0, Math.round((vh - boxH) / 2)) + 'px';

  // Record the box so widget layout math positions relative to it (not the viewport).
  const changed = !_previewBox || _previewBox.w !== boxW || _previewBox.h !== boxH;
  _previewBox = { w: boxW, h: boxH };

  // Fonts: reproduce EXACTLY what the wall display does, then shrink by the same
  // factor the box is shrunk. The TV computes its own ui-scale as
  // min(MAX_UI_SCALE, tvW/1920) — matching applyUiScale()'s own formula exactly,
  // MAX_UI_SCALE included. This used to be hardcoded to min(1, ...) here, a stale
  // copy of applyUiScale()'s OLD formula from before it was updated to allow
  // scaling up to 2x for a larger-than-reference display (4K etc.) — meaning
  // preview stayed capped at the old 1x-only behavior after that fix landed,
  // rendering fonts at roughly half size compared to the real display for any
  // target resolution above the 1920px reference. The preview box is (boxW/tvW)
  // the size of the TV, so to look identical the font scale must be
  // tvUiScale × (boxW / tvW). Dividing by the real TV width — not the 1920
  // reference — is the other key correction; using 1920 made preview text
  // roughly 2× too large on a 4K display.
  const tvW = ref.w;
  const tvUiScale = Math.min(MAX_UI_SCALE, tvW / UI_REFERENCE_WIDTH);
  const uiScale = tvUiScale * (boxW / tvW);
  wrap.style.setProperty('--ui-scale', uiScale.toFixed(4));

  // If the box size changed (first run, rotation, resize), re-lay the widgets so
  // their pixel positions recompute against the new box dimensions.
  if (changed && state.layout && state.layout.length) renderLayout();
}

// Widget positions and sizes are percentages, so they already adapt to any screen.
// But widget *content* (fonts) is authored in pixels tuned for a full-size wall
// display. On a SMALL screen (a phone preview) those fixed pixels look huge relative
// to the canvas. So we shrink content on small screens — but we must NEVER enlarge
// it on big ones (that's what blew up the wall display). The scale is therefore
// capped at 1.0: at the reference width and above, content renders at its designed
// size; below it, content scales down proportionally so a phone mirrors the big
// screen instead of overflowing.
const UI_REFERENCE_WIDTH = 1920; // widget pixel sizes are tuned for a ~1080p wall display
// Shared with applyPreviewScale() below, not just applyUiScale() — the actual
// fix for the bug that motivated pulling this out to top level at all: the two
// functions need the exact same cap to render identically, and a second local
// copy is exactly how they silently drifted apart before (applyUiScale() was
// updated to allow scaling up to 2x for a larger-than-reference display, but
// applyPreviewScale() kept referencing an old, no-longer-matching hardcoded 1).
const MAX_UI_SCALE = 2; // 2x covers 4K relative to the 1080p reference
function applyUiScale() {
  const wrap = document.getElementById('rotate-wrap');
  if (!wrap) return;
  const frameW = effectiveWidth();
  // Was hard-capped at 1.0 — shrank content for smaller-than-reference screens,
  // but explicitly refused to ever grow it for a bigger one, which meant a 4K
  // screen rendered widget fonts at the exact same pixel size as 1080p, looking
  // smaller/cramped relative to everything else (which DOES scale, being
  // percentage-based). A prior version allowed unlimited upscaling and, per an
  // existing comment here, that broke the wall display — so this raises the cap
  // to a bounded maximum instead of removing it outright, to get real
  // cross-resolution scaling without reopening whatever that original failure was.
  let scale = Math.min(MAX_UI_SCALE, frameW / UI_REFERENCE_WIDTH);
  scale = Math.max(0.25, scale); // floor so tiny embeds don't vanish
  wrap.style.setProperty('--ui-scale', scale.toFixed(4));
}

// Applies the global default widget text color from settings to the page root.
// Individual widgets without their own override inherit this via normal CSS cascade.
// Exception: some themes are LIGHT (e.g. Minimalist Family) and define their own
// dark text in CSS. For those we must not stamp the (light) settings color onto
// <html>, or it would override the theme and make text unreadable on a pale
// background. We clear the inline override so the theme's CSS wins.
// Themes that define their OWN --text in CSS (light or warm-toned) and must not be
// overridden by the global widget_text_color setting.
const LIGHT_THEMES = new Set(['minimalfam', 'chalkboard', 'corkboard', 'spring', 'easter', 'postit']);
// Applies this PROFILE's own default widget font (displayConfig.fontFamily —
// a per-layout choice, same as theme itself, not a device-wide setting) so
// different profiles on the same device can each have their own default,
// mirroring applyTextColor() just below for the "individual widgets without
// their own override inherit this via normal CSS cascade" approach. Reads
// from displayConfig rather than state.settings for exactly that reason —
// this needs to change whenever the assigned profile changes, the same
// moment theme does, not on some separate device-wide settings timeline.
function applyFontFamily() {
  const name = ((typeof displayConfig !== 'undefined' && displayConfig.fontFamily) || '').trim();
  if (!name || !FONT_STACKS[name]) { document.documentElement.style.removeProperty('--global-font-family'); return; }
  ensureWebFont(name);
  document.documentElement.style.setProperty('--global-font-family', cssFontStack(name));
}
// Optional drop shadow behind every widget's text (setting text_shadow: off / soft / strong), so a clock or the weather stays readable over a photo.
// The shadow is dark on a dark-text-on-light theme's opposite: a light theme has dark text, so its shadow is white (a dark one would only smudge it).
function applyTextShadow() {
  const level = (state.settings && state.settings.text_shadow) || 'off';
  const root = document.documentElement;
  if (level !== 'soft' && level !== 'strong') { root.removeAttribute('data-text-shadow'); return; }
  const theme = (typeof displayConfig !== 'undefined' && displayConfig.theme || '').trim() || (document.body.getAttribute('data-theme') || '');
  root.setAttribute('data-text-shadow', level);
  root.style.setProperty('--text-shadow-rgb', LIGHT_THEMES.has(theme) ? '255,255,255' : '0,0,0');
}
function applyTextColor() {
  try { applyTextShadow(); } catch (e) {}
  // The authoritative theme is the one this display/profile is rendering
  // (displayConfig.theme), the same source applyTheme() uses — NOT global settings,
  // which differ on a display showing an assigned profile.
  const theme = (typeof displayConfig !== 'undefined' && displayConfig.theme || '').trim()
             || (document.body.getAttribute('data-theme') || '');
  if (LIGHT_THEMES.has(theme)) {
    document.documentElement.style.removeProperty('--text');
    return;
  }
  const color = (state.settings && state.settings.widget_text_color) || '#e8edf5';
  document.documentElement.style.setProperty('--text', color);
}

// ── Layout rendering ─────────────────────────────────────────────────────────
// Content-relevant Radar settings only — position/size/text-color/opacity are
// NOT included here because those are re-applied to every widget (reused or
// fresh) unconditionally further down in renderLayout(); this fingerprint is
// only used to decide whether the underlying Leaflet map itself needs to be
// torn down and rebuilt, or can keep running exactly as-is.
function radarFingerprint(w) {
  return JSON.stringify([
    w.radarLat || '', w.radarLon || '', w.radarZoom || 6,
    !!w.radarAnimate, w.radarFrameCount || 6,
    (w.radarOpacity !== undefined ? w.radarOpacity : 80),
  ]);
}
let _renderDeferredDuringDrag = false;
function renderLayout() {
  // Never blow away #canvas while a widget is being dragged or resized in
  // Live Edit — it would replace the very element the pointer is captured on,
  // silently ending the gesture ("moves a bit, then stops"). Any re-render
  // that lands mid-drag is coalesced into one that runs on drag end.
  // Guard against a WEDGED drag state: if the tracked element is gone from
  // the DOM, the gesture is already dead (its pointerup/cancel can never
  // fire), so clearing here is the only thing that lets renders resume —
  // otherwise every widget freezes indefinitely on its last drawn state.
  if (_dragState && !(_dragState.el && _dragState.el.isConnected)) _dragState = null;
  if (_resizeState && !(_resizeState.el && _resizeState.el.isConnected)) _resizeState = null;
  if (_dragState || _resizeState) { _renderDeferredDuringDrag = true; return; }
  const canvas = document.getElementById('canvas');
  const W = effectiveWidth(), H = effectiveHeight();
  // Radar widgets hold real, expensive-to-recreate state (a live Leaflet map
  // + a running animation timer) that the wholesale canvas.innerHTML wipe
  // below would otherwise destroy and rebuild from scratch on EVERY call to
  // this function — and renderLayout() is called constantly, by every other
  // widget's own independent refresh timer (weather, tasks, chores, HA,
  // etc.), not just when something about radar itself changed. Detach any
  // existing radar elements BEFORE the wipe so they can be put back
  // untouched below if their content hasn't actually changed — confirmed
  // report: this was still visibly "flashing/reloading" even after the
  // HA-poll-render-gating fix (1.81.0-beta.4), because THOSE weren't the
  // only timers driving renderLayout(); they were just the most frequent
  // ones. See the matching skip-check in initRadarWidgets().
  const preservedRadarEls = new Map(); // widget id -> element
  canvas.querySelectorAll('.widget-radar[data-widget-id]').forEach(el => {
    const id = el.dataset.widgetId;
    if (id) preservedRadarEls.set(id, el);
  });
  // Same idea for Web Page widgets: a live frame must not be torn down and reloaded every time something unrelated
  // (a calendar sync, a weather poll) makes the layout redraw, so keep the element while its address/title/refresh are unchanged.
  const preservedWebEls = new Map();
  canvas.querySelectorAll('.widget-webpage[data-widget-id]').forEach(el => { const id = el.dataset.widgetId; if (id) preservedWebEls.set(id, el); });
  // A frame's page is destroyed the moment its element is taken out of the document - even if it is put straight back
  // (found in a real browser: reusing the element alone still reloaded the page on every redraw). So frames that will
  // be reused are never detached: clear everything EXCEPT them, and don't re-append them below. Layering is by explicit
  // z-index, so their position among the siblings in the DOM does not matter.
  const keepWebEls = new Set();
  (state.layout || []).forEach(w => {
    if (w.type !== 'webpage') return;
    const c = preservedWebEls.get(String(w.id));
    if (c && c.dataset.wpFingerprint === webPageFingerprint(w)) keepWebEls.add(c);
  });
  Array.from(canvas.childNodes).forEach(n => { if (!keepWebEls.has(n)) canvas.removeChild(n); });

  state.layout.forEach((w, i) => {
    let el = null;
    let reused = false;
    if (w.type === 'webpage') {
      const candidate = preservedWebEls.get(String(w.id));
      if (candidate && candidate.dataset.wpFingerprint === webPageFingerprint(w)) { el = candidate; reused = true; preservedWebEls.delete(String(w.id)); }
    }
    if (w.type === 'radar') {
      const candidate = preservedRadarEls.get(String(w.id));
      if (candidate && candidate.dataset.radarFingerprint === radarFingerprint(w)) {
        el = candidate;
        reused = true;
        preservedRadarEls.delete(String(w.id));
        // Title/font/show-time can all change without affecting the
        // fingerprint (none of them touch the map itself) — since a reused
        // element skips the innerHTML rebuild below entirely, update these
        // directly here so they still stay live even while the map
        // underneath persists.
        const titleEl = el.querySelector('.radar-title');
        if (titleEl) titleEl.textContent = w.radarTitle || 'Radar';
        el.style.setProperty('--radar-font', `calc(${w.radarFontPx || 16}px * var(--ui-scale,1))`);
        const timeEl = el.querySelector('.radar-time');
        if (timeEl) timeEl.style.display = (w.radarShowTime !== false) ? 'block' : 'none';
      }
    }
    if (reused && w.type === 'webpage') { const f = el.querySelector('.wp-frame'); if (f) f.style.cssText = webPageFrameStyle(w); }
    if (!el) el = document.createElement('div');
    el.className = 'widget widget-' + w.type + (w.photoFullscreenBg ? ' fullscreen-bg' : '');
    el.dataset.widgetId = w.id || '';
    if (w.type === 'radar') el.dataset.radarFingerprint = radarFingerprint(w);
    if (w.type === 'webpage') el.dataset.wpFingerprint = webPageFingerprint(w);
    if (w.photoFullscreenBg) {
      // Full-screen background: a rendering-time-only override, deliberately
      // never touches the widget's own stored x/y/w/h/z — turning this off
      // later restores it exactly where it was, no restore logic needed.
      // Matches app.html's own makeEditorWidget() treatment of the same field.
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = W + 'px';
      el.style.height = H + 'px';
      el.style.zIndex = -1;
    } else {
      el.style.left   = (w.x / 100 * W) + 'px';
      el.style.top    = (w.y / 100 * H) + 'px';
      el.style.width  = (w.w / 100 * W) + 'px';
      el.style.height = (w.h / 100 * H) + 'px';
      el.style.zIndex = (w.z !== undefined ? w.z : i);
    }
    // Per-widget text color override — falls back to the global --text default
    // (set on :root by applyTextColor) when the widget hasn't set its own.
    // Explicit removeProperty in the else branch matters now that an element
    // CAN persist across renders (see the radar reuse path above) — this was
    // safe to skip before only because every element was always freshly
    // created from scratch on every single render, so there was never a
    // stale prior value to leak from.
    if (w.textColor) el.style.setProperty('--text', w.textColor); else el.style.removeProperty('--text');
    // --pill-text: the SAME override, extended to Mini Calendar's full-day
    // pill title text (.mc-ev-pill), which reads its own variable instead of
    // --text — that element's base color is deliberately NOT var(--text)
    // under any theme (a colored pill needs contrast against ITS OWN
    // background, not the page's general text color), so it needed its own
    // variable to be overridable at all, following the exact same "explicit
    // choice wins, unset falls back to the sensible default" shape.
    if (w.textColor) el.style.setProperty('--pill-text', w.textColor); else el.style.removeProperty('--pill-text');
    // Secondary text (labels, AM/PM, subtitles, etc.) — falls back to --muted
    // (see .widget base rule) when the widget hasn't set its own, same pattern
    // as the primary color above.
    if (w.textColor2) el.style.setProperty('--text2', w.textColor2); else el.style.removeProperty('--text2');
    // Per-widget font override — same fallback spirit as the color overrides
    // above: falls back to the display-wide default (applyFontFamily(), which
    // itself falls back to each widget's own hardcoded default if neither is
    // set) when this widget hasn't chosen its own. Sets BOTH the actual
    // font-family property (works for the majority of widgets, which have no
    // font-family rule of their own and just inherit it normally) AND the
    // --per-widget-font variable (needed for the handful — currently just the
    // Clock — that have their own specific font-family rule and so wouldn't
    // otherwise notice an inherited value at all).
    if (w.fontFamily && FONT_STACKS[w.fontFamily]) {
      ensureWebFont(w.fontFamily);
      const stack = cssFontStack(w.fontFamily);
      el.style.fontFamily = stack;
      el.style.setProperty('--per-widget-font', stack);
    } else {
      el.style.fontFamily = '';
      el.style.removeProperty('--per-widget-font');
    }

    // Per-widget transparency:
    //  • tileOpacity (0-100): opacity of an optional card/tile drawn BEHIND the
    //    widget. 0 (default) = no tile, fully see-through to the background photo.
    //  • textOpacity (0-100, default 100): fades the widget's text/colors so the
    //    background shows through them.
    const tileOpacity = (w.tileOpacity !== undefined ? w.tileOpacity : 0) / 100;
    if (tileOpacity > 0) {
      el.classList.add('has-tile');
      el.style.setProperty('--tile-alpha', tileOpacity.toFixed(2));
    }
    const textOpacity = (w.textOpacity !== undefined ? w.textOpacity : 100) / 100;
    el.style.opacity = (textOpacity < 1) ? textOpacity.toFixed(2) : '';

    // Reused radar elements keep their existing content (the live Leaflet
    // map) untouched — overwriting innerHTML here would destroy it and
    // defeat the entire point of reusing the node. Fresh/changed widgets
    // (including radar widgets whose fingerprint DID change) render
    // normally.
    //
    // Isolated in its own try/catch — a real incident (2026-09-13) traced
    // "unrelated widgets going blank together" back to exactly this call
    // having none: this whole loop is a plain forEach, so ONE widget's
    // render throwing killed the loop right there, and every widget later
    // in state.layout simply never got its turn that pass. A widget that
    // throws now just logs and renders nothing itself — every other widget,
    // regardless of position in the layout, still draws normally.
    if (!reused) {
      try { el.innerHTML = renderWidget(w); }
      catch (e) { console.error('renderWidget failed for', w.type, w.id, e); el.innerHTML = ''; }
    }
    if (el.parentNode !== canvas) canvas.appendChild(el);   // a kept web page frame is already in place: moving it would reload its page
  });

  // Any radar element still left in preservedRadarEls at this point belongs
  // to a widget that's gone (deleted, or type changed) — its Leaflet
  // instance and animation timer would otherwise keep running forever
  // against a now-fully-detached element. Clean both up explicitly rather
  // than relying on initRadarWidgets() to ever notice, since a removed
  // widget produces no `.radar-map[data-radar-id]` element for it to find.
  preservedWebEls.forEach((el, id) => { const t = webPageTimers.get(id); if (t) { clearInterval(t); webPageTimers.delete(id); } });
  preservedRadarEls.forEach((el, id) => {
    const timer = radarAnimTimers.get(id);
    if (timer) { clearInterval(timer); radarAnimTimers.delete(id); }
    const map = radarMapInstances.get(id);
    if (map) { try { map.remove(); } catch {} radarMapInstances.delete(id); }
  });

  // Auto-fit (weather + clock/date/countdown/timer/text): applied
  // synchronously here, NOT deferred to requestAnimationFrame like the rest
  // of this post-render pass below. Real report: with rAF, every widget got
  // one paint at its un-fit base size before the correction landed a frame
  // later — invisible on the very first page load, but this file has a lot
  // of background polling that calls this exact function (weather every few
  // minutes, calendar every 5, Home Assistant every 8-15 SECONDS while
  // editing) — each one visibly flashed an auto-fit widget small-then-big
  // on every single refresh. Reading clientWidth/Height forces a synchronous
  // layout calculation regardless of whether it's asked for eagerly here or
  // lazily on next paint — every widget's box size was already set as an
  // explicit, absolute pixel value earlier in this same function (not
  // intrinsic/content-driven), so there's nothing async this measurement
  // was actually waiting on. Doing it before yielding back to the browser
  // means the browser's next paint already reflects the fitted size —
  // there's no intermediate un-fit frame left for it to show.
  setupWeatherAutoFit();
  setupTextAutoFit();

  // After cells are in the DOM and sized, trim calendar days that overflow so event
  // text never spills into adjacent day boxes. rAF ensures layout has been computed.
  requestAnimationFrame(() => { adaptCalendarEventFontSizes(); fitCalendarCells(); });
  requestAnimationFrame(renderQRCodes);
  requestAnimationFrame(initWebPages);
  requestAnimationFrame(initRadarWidgets);
  requestAnimationFrame(wireChoreChartTaps);
  requestAnimationFrame(wireMessageBoardTaps);
  requestAnimationFrame(wireMealPlanTaps);
  requestAnimationFrame(wireCameraStreams);
  requestAnimationFrame(wireCameraTaps);
  requestAnimationFrame(wireFlightMaps);
  requestAnimationFrame(wireTodoWidgetTaps);
  requestAnimationFrame(wireShoppingWidgetTaps);
  requestAnimationFrame(wireTasksWidgetTaps);
  requestAnimationFrame(wireMiniCalNav);
  requestAnimationFrame(wireEntityStatusTaps);
  requestAnimationFrame(wireHaSparklines); // fill the sensor trend line — a full re-render recreates the empty placeholder
  requestAnimationFrame(wireLayoutSwitcherTaps);
  requestAnimationFrame(wireWeatherComboTabTaps);
  requestAnimationFrame(wireEventDetailTaps);
  if (editModeActive) requestAnimationFrame(wireWidgetDragging);
  // Phase 4: a full re-render (SSE 'layout' push, the periodic 5-min
  // refresh, etc.) recreates every widget element from scratch, including
  // whichever one is currently selected — its DOM node is gone, so the old
  // .selected class and the selection overlay's position would otherwise go
  // stale silently. Re-sync onto the freshly-created element, or deselect
  // cleanly if it's simply no longer there (e.g. someone else deleted it).
  if (editModeActive && selectedWidgetId != null) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`#canvas .widget[data-widget-id="${CSS.escape(String(selectedWidgetId))}"]`);
      if (el) { el.classList.add('selected'); injectEditChrome(el); }
      else deselectWidgetForEdit();
    });
  }
  // Start/stop/retime any per-widget slideshow timers to match what's actually
  // in the layout now — widgets get added, removed, and reconfigured live.
  syncPerWidgetPhotoTimers();
}

// Height-based fitting for month-calendar day cells: show as many events as fit in
// each cell's available height, then replace the rest with an accurate "+N more".
// This respects variable-length and wrapping titles, unlike a fixed event count.
// Adaptive Font Sizing (Calendar widget setting, opt-in): for an event whose
// text just barely wraps onto a second line — the common case being a
// birthday event styled like "🎂Name🎂", where the trailing emoji alone tips
// it over — shrinks that ONE event's font size by up to
// ADAPTIVE_FONT_MAX_SHRINK_PX and keeps the smaller size only if it's enough
// to bring the line back to one. If even the maximum allowed shrink still
// wraps, the event is left at its original size and wrapped exactly as
// before — deliberately narrow (a character or two over the edge), not a
// general auto-shrink-to-fit, so a genuinely long title is never silently
// squeezed down to something hard to read.
//
// Only relevant when the widget's own Wrap Event Text setting is on in the
// first place — event lines never wrap at all in the default mode (they
// truncate with "…" instead), so there's nothing to adapt there.
//
// Must run BEFORE fitCalendarCells(): shrinking a wrapped event back down to
// one line changes how much vertical space it takes, which affects that
// function's own overflow/"+N more" calculation — run in the wrong order,
// fitCalendarCells would measure the still-wrapped (taller) height and could
// hide an event that would actually have fit once un-wrapped.
const ADAPTIVE_FONT_MAX_SHRINK_PX = 2;
function adaptCalendarEventFontSizes() {
  const resetAndMeasure = (lineEl) => {
    // Always start from the widget's configured size, not whatever a prior
    // pass left this element at — otherwise a widget resize, a shorter
    // event title replacing a longer one, or turning the font size back up
    // could only ever ratchet smaller, never recover.
    lineEl.style.fontSize = '';
    const cs = getComputedStyle(lineEl);
    const lineH = parseFloat(cs.lineHeight) || 16;
    const baseFontPx = parseFloat(cs.fontSize);
    const isWrapped = () => Math.round(lineEl.offsetHeight / lineH) > 1;
    if (!isWrapped()) return; // already fits on one line — nothing to do
    for (let px = 1; px <= ADAPTIVE_FONT_MAX_SHRINK_PX; px++) {
      lineEl.style.fontSize = (baseFontPx - px) + 'px';
      if (!isWrapped()) return; // found a small-enough shrink that fixes it — keep it
    }
    lineEl.style.fontSize = ''; // budget exhausted — revert, leave wrapped as before
  };

  document.querySelectorAll('.w-minical[data-widget-id]').forEach(calEl => {
    const w = state.layout.find(x => String(x.id) === String(calEl.dataset.widgetId));
    if (!w || !w.calAdaptiveFontSizing) return;
    const wrapMode = w.calWrap === 'clamp2' ? 'clamp2' : (w.calWrap === true || w.calWrap === 'on') ? 'on' : 'off';
    if (wrapMode === 'off') return; // default mode truncates instead of wrapping — nothing to adapt
    calEl.querySelectorAll('.mc-ev-text, .mc-ev-pill').forEach(resetAndMeasure);
  });

  document.querySelectorAll('.w-minical-agenda[data-widget-id]').forEach(calEl => {
    const w = state.layout.find(x => String(x.id) === String(calEl.dataset.widgetId));
    if (!w || !w.calAdaptiveFontSizing || !w.calWrap) return;
    calEl.querySelectorAll('.ag-title').forEach(resetAndMeasure);
  });
}
function fitCalendarCells() {
  const containers = document.querySelectorAll('.mc-events[data-fit="1"]');
  containers.forEach(box => {
    const moreEl = box.querySelector('.mc-ev-more');
    const baseMore = moreEl ? parseInt(moreEl.dataset.baseMore || '0') : 0;
    const events = Array.from(box.children).filter(c => !c.classList.contains('mc-ev-more'));
    // Reset: show everything, hide the more-chip, then measure.
    events.forEach(e => { e.style.display = ''; });
    if (moreEl) moreEl.style.display = 'none';

    // User-defined hard cap on LINES per day (not events). 0 = auto (height only).
    // Because events can wrap, we cap by measured line-rows: sum each visible event's
    // rendered height in line-units and stop when we'd exceed maxLines. This is more
    // predictable across displays than pure height fitting, which can overrun.
    const maxLines = parseInt(box.dataset.maxLines || '0') || 0;

    const avail = box.clientHeight;
    if ((!avail && !maxLines) || events.length === 0) return;

    // Determine one text line's height from the first event (fallback to 16px).
    let lineH = 16;
    if (events[0]) {
      const cs = getComputedStyle(events[0]);
      const lh = parseFloat(cs.lineHeight);
      if (lh && !isNaN(lh)) lineH = lh;
    }

    let hiddenCount = baseMore;
    const fitsHeight = () => box.scrollHeight <= avail;
    const fitsLines = () => {
      if (!maxLines) return true;
      // Count line-rows consumed by currently-visible events.
      let lines = 0;
      for (const e of events) {
        if (e.style.display === 'none') continue;
        lines += Math.max(1, Math.round(e.offsetHeight / lineH));
      }
      // Reserve one line for the "+N more" chip if any are hidden.
      return lines + (hiddenCount > 0 ? 1 : 0) <= maxLines;
    };

    // Quick exit: everything already fits both constraints and nothing was pre-capped.
    if (baseMore === 0 && fitsHeight() && fitsLines()) return;

    if (moreEl) moreEl.style.display = '';
    // Binary search for the largest event count that still fits, instead of
    // peeling events off one at a time and re-measuring after each — a real
    // incident (2026-09-13) traced a genuine slowdown on Pi-class hardware
    // back to exactly that: each single-event peel forces its own synchronous
    // layout reflow (read scrollHeight/offsetHeight right after a DOM write),
    // so a busy day with many events meant many forced reflows, once per
    // cell, on every render pass — worse the less room a cell has left for
    // events (e.g. once weather-on-calendar content is also eating into that
    // same space). "Fits" is monotonic in how many events are shown (hiding
    // an event can only shrink scrollHeight/line count, never grow it), so
    // this converges to the exact same cutoff the old linear peel did, just
    // in O(log n) measurements instead of O(n).
    const setVisibleCount = (n) => { for (let i = 0; i < events.length; i++) events[i].style.display = i < n ? '' : 'none'; };
    const fits = () => fitsHeight() && fitsLines();
    let visible = events.length;
    setVisibleCount(visible);
    if (!fits()) {
      // Find the largest count in [0, events.length) that fits.
      let lo = 0, hi = events.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        setVisibleCount(mid);
        if (fits()) lo = mid; else hi = mid - 1;
      }
      visible = lo;
      setVisibleCount(visible);
    }
    hiddenCount += events.length - visible;
    if (moreEl) {
      if (hiddenCount > 0) {
        moreEl.textContent = `+${hiddenCount} more`;
        moreEl.style.display = '';
      } else {
        moreEl.style.display = 'none';
      }
    }
  });
}

function renderWidget(w) {
  switch(w.type) {
    case 'smarthomeDashboard': return renderSmartHomeDashboard(w);
    case 'clock':    return renderClock(w);
    case 'date':     return renderDate(w);
    case 'datetime': return renderDateTime(w);
    case 'reminders': return renderReminders(w);
    case 'weather':  return renderWeather(w);
    case 'weatherCurrent':  return renderWeatherCurrent(w);
    case 'weatherForecast': return renderWeatherForecast(w);
    case 'weatherHourly': return renderWeatherHourly(w);
    case 'weatherComboForecast': return renderWeatherComboForecast(w);
    case 'minical':  return renderMiniCal(w);
    case 'upcoming': return renderUpcoming(w);
    case 'today':    return renderToday(w);
    case 'agenda':   return renderAgenda(w);
    case 'tasks':    return renderTasks(w);
    case 'todo':     return renderTodoWidget(w);
    case 'tasksCombined': return renderTasksCombined(w);
    case 'news':     return renderNews(w);
    case 'stocks':   return renderStocks(w);
    case 'text':     return renderText(w);
    case 'photo':    return renderPhotoWidget(w);
    case 'chorechart': return renderChoreChart(w);
    case 'chorelb': return renderChoreLeaderboard(w);
    case 'shoppinglist': return renderShoppingListWidget(w);
    case 'messageboard': return renderMessageBoard(w);
    case 'mealplan': return renderMealPlan(w);
    case 'camera': return renderCamera(w);
    case 'flightmap': return renderFlightMap(w);
    case 'countdown': return renderCountdown(w);
    case 'moonphase': return renderMoonPhase(w);
    case 'airquality': return renderAirQuality(w);
    case 'radar': return renderRadar(w);
    case 'travel': return renderTravelTime(w);
    case 'entitystatus': return renderEntityStatus(w);
    case 'groupcontrol': return renderGroupControl(w);
    case 'qrcode': return renderQRCode(w);
    case 'webpage': return renderWebPage(w);
    case 'timer': return renderTimer(w);
    case 'onthisday': return renderOnThisDay(w);
    case 'dailyquote': return renderDailyQuote(w);
    case 'sports': return renderSports(w);
    case 'metar': return renderMetarTaf(w);
    case 'decoration': return renderDecoration(w);
    case 'layoutswitcher': return renderLayoutSwitcher(w);
    default: return '';
  }
}

