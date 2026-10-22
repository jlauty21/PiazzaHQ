// The drawing board, shared by the Whiteboard widget on the wall display, the kids' drawing pad and the Family Hub's Board tab:
//   const ctl = DrawUI.mount(rootElement, { board, api, readOnly, toolbar: 'always' | 'touch', isEditing, name, big, noKeep, onChange, prefs })
//   prefs (optional): { load(): Promise<{ color, size, tool, stamp, shape, fillShape }>, save(obj) } - the pad starts the way this person left it (the kids' pads keep this per kid)
// A board is a list of strokes (src/whiteboard.js). Each is { t, c: '#rrggbb', w: size as a fraction of the board's width, p: [x, y, ...] as fractions 0..1 of the board's width and height }:
//   t 'pen' | 'marker' | 'eraser'   p = the path
//   t 'line' | 'rect' | 'ellipse'   p = [x1, y1, x2, y2]; f: 1 = filled (rect, ellipse)
//   t 'stamp'                       p = [x, y]; s = the emoji; w = its size
//   t 'text'                        p = [x, y]; s = the words; w = their size
//   t 'fill'                        p = [x, y]: the paint bucket - everything joined to that spot that looks the same as it, when the strokes are drawn again in order
// They are drawn again from the list whenever the board is resized, undone, replayed or reloaded, so one board looks right on a wall screen and on a phone.
// The pen and eraser are drawn as the finger moves (only the new piece); the marker and the shapes are drawn whole on a live layer and put on the board when the finger lifts.
// A rubbing eraser is a stroke that is drawn "out", so undo takes it back like anything else. api(path, init) returns the parsed answer of the server.
// Two fingers pinch to zoom (up to 8x) and drag to move around; a Ctrl + mouse wheel zooms too, and the corner button puts the whole board back. Drawing is always one finger.
// A board can have a picture behind the drawing (background 'photo'); the toolbar can replay the drawing stroke by stroke (and record that as a video) and print it.
(function () {
  'use strict';
  const BACKGROUNDS = ['white', 'chalkboard', 'paper', 'grid', 'lined', 'clear'];     // what the background button cycles through (a picture has its own button)
  // A background can also be any color, with an optional see-through amount: 'color:#rrggbb' or 'color:#rrggbbaa' (aa = how solid it is).
  const BG_COLOR_RE = /^color:#([0-9a-f]{6})([0-9a-f]{2})?$/;
  const BG_SWATCHES = ['#000000', '#1b1b1f', '#22332c', '#0f2a3d', '#3b1d5a', '#7a1f1f', '#b45309', '#14532d', '#ffffff', '#f6f0df', '#fde68a', '#fbcfe8', '#bfdbfe', '#d9f99d'];
  const BG_BASE = { white: '#ffffff', chalkboard: '#22332c', paper: '#f6f0df', lined: '#fffef6' };
  const isBackground = (bg) => bg === 'photo' || BACKGROUNDS.includes(bg) || BG_COLOR_RE.test(bg || '');
  function bgRgba(bg) {
    const m = BG_COLOR_RE.exec(bg || '');
    if (!m) return null;
    const h = m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  const bgCss = (bg) => { const c = bgRgba(bg); return c ? 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.round(c[3] * 1000) / 1000 + ')' : ''; };
  const bgHex = (bg) => { const m = BG_COLOR_RE.exec(bg || ''); return m ? '#' + m[1] : BG_BASE[bg] || ''; };          // the plain color of a background that is one
  const bgSolid = (bg) => { const m = BG_COLOR_RE.exec(bg || ''); return m && m[2] ? parseInt(m[2], 16) / 255 : 1; };      // 1 = solid, 0 = see-through
  const makeBg = (hex, solid) => 'color:' + hex.toLowerCase() + (solid < 0.999 ? Math.round(Math.max(0, Math.min(1, solid)) * 255).toString(16).padStart(2, '0') : '');
  const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const lumHex = (hex) => { const h = (hex || '').replace('#', ''); return h.length === 6 ? lum(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)) : null; };
  const contrastOf = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const COLORS = ['#111111', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ffffff'];
  const SIZE_MIN = 0.002, SIZE_MAX = 0.06;               // the size slider: a pen width as a fraction of the board's width (thin hairline to a fat brush), spaced like a camera zoom
  const sizeAt = (pos) => SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, Math.min(100, Math.max(0, pos)) / 100);
  const posOf = (size) => Math.round(100 * Math.log(Math.min(SIZE_MAX, Math.max(SIZE_MIN, size)) / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN));
  const SIZE_KEY = 'drawui_size';
  const STAMP_GROUPS = [
    ['⭐', '❤️', '😀', '👍', '🌈', '☀️', '🌸', '🐶', '🐱', '🦋', '🎈', '🍕', '🚀', '🎉', '✅', '❓'],                  // the first 16 are the ones that were always there
    ['😂', '😍', '😎', '😴', '😡', '🥳', '🤔', '😭', '😇', '🙌', '👏', '👎', '✌️', '💪'],
    ['💛', '💚', '💙', '💜', '✨', '🔥', '💥', '❌', '❗', '📌', '💡', '🔔'],
    ['🌙', '⛅', '⚡', '❄️', '🌻', '🌲', '🍀'],
    ['🐭', '🐰', '🦊', '🐻', '🐼', '🐸', '🦁', '🐯', '🐮', '🐷', '🐔', '🦄', '🐢', '🐠', '🐝'],
    ['🍎', '🍌', '🍓', '🍔', '🍟', '🍦', '🎂', '🍪', '☕'],
    ['🎁', '🏆', '⚽', '🏀', '🎵', '🎨', '📚', '✏️', '✈️', '🚗', '🏠', '📅'],
  ];
  const STAMPS = [].concat(...STAMP_GROUPS);
  const STAMP_K = 6;                                     // a stamp is this many times as big as the pen size (so the slider's far end is a stamp 36% of the board's width)
  const MARKER_ALPHA = 0.45, MAX_SIDE = 1600, MIN_STEP = 0.6;
  const TEXT_K = 3;                                      // text is this many times the pen size (the slider's far end: letters 18% of the board's width)
  const OPS_MAX = 200;
  const FREE = ['pen', 'marker', 'eraser'], SHAPES = ['line', 'rect', 'ellipse'];
  const TEXT_FONT = (px) => '600 ' + px + 'px Inter, system-ui, "Segoe UI", sans-serif';
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  const t = (s) => (window.i18n && typeof window.i18n.t === 'function' ? window.i18n.t(s) : s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const HEXRE = /^#[0-9a-f]{6}$/i;
  function hsvToHex(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: mx ? d / mx : 0, v: mx };
  }
  const RECENT_KEY = 'drawui_recent_colors';
  function recentColors() { try { const a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter((c) => HEXRE.test(c)).slice(0, 10) : []; } catch (e) { return []; } }
  function rememberColor(c) { try { localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recentColors().filter((x) => x !== c)].slice(0, 10))); } catch (e) { /* no storage: nothing remembered */ } }
  // what the person typed -> '#rrggbb', or '' if it is not a color (accepts rgb and rrggbb, with or without the #)
  function parseHex(txt) {
    let x = String(txt || '').trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(x)) x = x.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/.test(x) ? '#' + x : '';
  }

  function ensureStyle() {
    if (document.getElementById('draw-ui-style')) return;
    const st = document.createElement('style');
    st.id = 'draw-ui-style';
    const css = `
  .dw { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: 10px; user-select: none; -webkit-user-select: none; touch-action: none; font-family: inherit; }
  .dw.bg-white { background: #ffffff; } .dw.bg-chalkboard { background: #22332c; } .dw.bg-paper { background: #f6f0df; } .dw.bg-clear { background: transparent; }
  .dw.bg-grid { background-color: #ffffff; background-image: linear-gradient(rgba(0,0,0,0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.13) 1px, transparent 1px); background-size: 28px 28px; }
  .dw.bg-lined { background-color: #fffef6; background-image: linear-gradient(transparent 31px, rgba(60,110,200,0.28) 32px); background-size: 100% 32px; }
  .dw.bg-photo { background-color: #ffffff; background-size: cover; background-position: center; background-repeat: no-repeat; }
  .dw-bar .bgp { border-color: rgba(255,255,255,0.45); } .dw-bar .bgp.on { border-color: #8cc0ff; }
  .dw-bar input[type=color] { width: 42px; min-width: 42px; height: 34px; padding: 0; border: 0; border-radius: 8px; background: none; cursor: pointer; }
  .dw-bar input.bgalpha { width: 110px; height: 34px; touch-action: none; accent-color: #8cc0ff; cursor: pointer; }
  .dw.dw-bordered { box-shadow: inset 0 0 0 2px rgba(128,128,128,0.55); box-shadow: inset 0 0 0 2px color-mix(in srgb, currentColor 45%, transparent); }
  .dw-view > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
  .dw.ro .dw-view > canvas { pointer-events: none; }
  .dw.big .dw-bar { padding: 8px; gap: 8px; } .dw.big .dw-bar button { min-width: 56px; height: 56px; font-size: 26px; border-radius: 14px; } .dw.big .dw-bar .sw { width: 46px; min-width: 46px; height: 46px; }
  .dw-bar { position: absolute; left: 6px; right: 6px; bottom: 6px; display: flex; gap: 6px; align-items: center; padding: 6px; border-radius: 14px; background: rgba(16,20,32,0.86); color: #eef2fb; overflow-x: auto; scrollbar-width: none; z-index: 2; transition: opacity .2s; touch-action: pan-x; }
  .dw-bar::-webkit-scrollbar { display: none; }
  .dw-bar.hidden { opacity: 0; pointer-events: none; }
  .dw-bar button, .dw-bar label.btn { flex: 0 0 auto; min-width: 42px; height: 42px; border-radius: 10px; border: 2px solid transparent; background: rgba(255,255,255,0.12); color: inherit; font-size: 18px; line-height: 1; padding: 0 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; font-family: inherit; }
  .dw-bar button.on { border-color: #8cc0ff; background: rgba(74,144,217,0.5); }
  .dw-bar button:disabled { opacity: 0.35; }
  .dw-bar .sw { width: 34px; min-width: 34px; height: 34px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); padding: 0; }
  .dw-bar .sw.cur { border-width: 3px; border-color: #fff; box-shadow: 0 0 0 2px rgba(0,0,0,0.5); }
  .dw-bar .sw.on { border: 3px solid #8cc0ff; box-shadow: 0 0 0 2px rgba(0,0,0,0.5); }
  .dw-bar .szwrap { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding: 0 4px; }
  .dw-bar .szbox { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; }
  .dw-bar .szdot { display: block; border-radius: 50%; background: currentColor; }
  .dw-bar input.size { width: 130px; height: 34px; touch-action: none; accent-color: #8cc0ff; cursor: pointer; }
  .dw.big .dw-bar input.size { width: 170px; height: 56px; }
  .dw-bar .sep { flex: 0 0 1px; align-self: stretch; background: rgba(255,255,255,0.2); margin: 4px 2px; }
  .dw-bar .ask { flex: 0 0 auto; padding: 0 6px; font-size: 14px; font-weight: 600; white-space: nowrap; }
  .dw-bar .stamp { font-size: 24px; padding: 0 4px; min-width: 42px; }
  .dw-bar .stamp img.stampimg, .dw-bar button img.stampimg { width: 30px; height: 30px; object-fit: contain; display: block; }
  .dw-bar .thumb { padding: 0; width: 64px; min-width: 64px; overflow: hidden; } .dw-bar .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .dw-bar input[type=file] { display: none; }
  .dw-ur { position: absolute; left: 8px; top: 8px; display: flex; gap: 8px; z-index: 2; }
  .dw-ur button { width: 48px; height: 48px; border-radius: 50%; border: 0; background: rgba(16,20,32,0.86); color: #eef2fb; font-size: 24px; line-height: 1; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: inline-flex; align-items: center; justify-content: center; font-family: inherit; }
  .dw-ur button:disabled { opacity: 0.35; cursor: default; }
  .dw.big .dw-ur button { width: 60px; height: 60px; font-size: 30px; }
  .dw-bar .sw.rainbow { background: conic-gradient(#e53935, #fdd835, #43a047, #1e88e5, #8e24aa, #e53935); }
  .dw-pop { position: absolute; left: 6px; bottom: 64px; width: 232px; max-width: calc(100% - 12px); padding: 10px; border-radius: 14px; background: rgba(16,20,32,0.94); color: #eef2fb; z-index: 3; display: none; touch-action: none; box-sizing: border-box; }
  .dw.big .dw-pop { bottom: 82px; width: 280px; }
  .dw-pop canvas { display: block; width: 100%; border-radius: 8px; touch-action: none; cursor: crosshair; }
  .dw-pop canvas.sv { height: 130px; } .dw-pop canvas.hue { height: 22px; margin-top: 10px; }
  .dw-pop .row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
  .dw-pop .cur { width: 34px; height: 34px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.6); flex: 0 0 auto; }
  .dw-pop input { flex: 1; min-width: 0; height: 34px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.1); color: inherit; font-size: 16px; padding: 0 8px; font-family: monospace; box-sizing: border-box; }
  .dw-pop .rec { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .dw-pop .rec button { width: 30px; height: 30px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); padding: 0; cursor: pointer; }
  .dw-text { position: absolute; z-index: 4; width: min(320px, 70%); background: rgba(255,255,255,0.88); border: 2px dashed #1e88e5; border-radius: 6px; padding: 0 6px; font-weight: 600; font-family: Inter, system-ui, 'Segoe UI', sans-serif; outline: none; line-height: 1.25; box-sizing: border-box; }
  .dw-note { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); background: rgba(16,20,32,0.88); color: #eef2fb; padding: 6px 14px; border-radius: 999px; font-size: 14px; opacity: 0; transition: opacity .25s; pointer-events: none; z-index: 3; max-width: 90%; text-align: center; }
  .dw-note.on { opacity: 1; }
  .dw-view { position: absolute; left: 0; top: 0; width: 100%; height: 100%; transform-origin: 0 0; touch-action: none; }
  .dw-zoom { position: absolute; right: 8px; top: 8px; z-index: 2; height: 40px; padding: 0 14px; border-radius: 20px; border: 0; background: rgba(16,20,32,0.86); color: #eef2fb; font-size: 15px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: none; font-family: inherit; }
  .dw-zoom.on { display: inline-flex; align-items: center; gap: 6px; }`;
    st.textContent = css.replace(/\.dw\.bg-(\w+) \{/g, '.dw.bg-$1, .dw-view.bg-$1 {');                 // the zoomable layer wears the same background as the board
    document.head.appendChild(st);
  }

  // ── drawing a list of strokes onto a canvas ────────────────────────────────────────────────────────────────
  function pathOf(ctx, p, W, H, upTo) {
    ctx.beginPath();
    const n = Math.min(p.length / 2, upTo == null ? Infinity : upTo);
    ctx.moveTo(p[0] * W, p[1] * H);
    if (n === 1) ctx.lineTo(p[0] * W + 0.01, p[1] * H);                  // a dot
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 2] * W, p[i * 2 + 1] * H);
  }
  function rgbOf(hex) { const n = parseInt(String(hex).slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // The paint bucket: fills the region joined to (fx, fy) whose pixels look like the one there (alpha counts, so an empty board is one region and a closed outline is another), plus a
  // pixel's width past it so the soft edge of the outline is not left white. Painted UNDER what is already there, so the outline stays on top.
  function floodFill(ctx, W, H, fx, fy, hex) {
    const x0 = Math.min(W - 1, Math.max(0, Math.round(fx * W))), y0 = Math.min(H - 1, Math.max(0, Math.round(fy * H)));
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const i0 = (y0 * W + x0) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
    const [fr, fg, fb] = rgbOf(hex);
    if (ta === 255 && tr === fr && tg === fg && tb === fb) return;       // already that color
    const near = (i) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) + Math.abs(d[i + 3] - ta) <= 64;
    const seen = new Uint8Array(W * H), stack = [x0, y0];
    while (stack.length) {
      let y = stack.pop(), x = stack.pop();
      if (seen[y * W + x] || !near((y * W + x) * 4)) continue;
      let l = x, r = x;
      while (l > 0 && !seen[y * W + l - 1] && near((y * W + l - 1) * 4)) l--;
      while (r < W - 1 && !seen[y * W + r + 1] && near((y * W + r + 1) * 4)) r++;
      for (let i = l; i <= r; i++) seen[y * W + i] = 1;
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= H) continue;
        let inRun = false;
        for (let i = l; i <= r; i++) {
          const ok = !seen[ny * W + i] && near((ny * W + i) * 4);
          if (ok && !inRun) { stack.push(i, ny); inRun = true; } else if (!ok) inRun = false;
        }
      }
    }
    const out = new Uint8Array(seen);                                    // the region, grown by one pixel
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (seen[y * W + x]) continue;
      if ((x > 0 && seen[y * W + x - 1]) || (x < W - 1 && seen[y * W + x + 1]) || (y > 0 && seen[(y - 1) * W + x]) || (y < H - 1 && seen[(y + 1) * W + x])) out[y * W + x] = 1;
    }
    for (let k = 0; k < out.length; k++) {
      if (!out[k]) continue;
      const i = k * 4, a = d[i + 3] / 255;
      d[i] = Math.round(d[i] * a + fr * (1 - a)); d[i + 1] = Math.round(d[i + 1] * a + fg * (1 - a)); d[i + 2] = Math.round(d[i + 2] * a + fb * (1 - a)); d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const stampImgs = new Map(), imgWaiters = new Set();
  const stampUrl = (src) => '/uploads/' + encodeURIComponent(String(src).slice(4));
  function stampImage(src) {                                 // the picture of an "img:" stamp if it has loaded (and it asks for a redraw when it does)
    const url = stampUrl(src);
    let im = stampImgs.get(url);
    if (!im) { im = new Image(); im.onload = () => imgWaiters.forEach((f) => f()); im.src = url; stampImgs.set(url, im); }
    return im.complete && im.naturalWidth ? im : null;
  }
  function preloadStamps(strokes) {                          // before a picture of the board is made: every stamp picture is there
    const srcs = [...new Set(strokes.filter((st) => st.t === 'stamp' && /^img:/.test(st.s || '')).map((st) => st.s))];
    return Promise.all(srcs.map((src) => new Promise((resolve) => {
      const url = stampUrl(src);
      let im = stampImgs.get(url);
      if (im && im.complete && im.naturalWidth) return resolve();
      if (!im) { im = new Image(); stampImgs.set(url, im); im.src = url; }
      im.addEventListener('load', () => resolve()); im.addEventListener('error', () => resolve());
    })));
  }
  function drawStroke(ctx, s, W, H) {
    if (!s || !s.p || s.p.length < 2) return;
    if (s.t === 'fill') { floodFill(ctx, W, H, s.p[0], s.p[1], s.c); return; }
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, s.w * W);
    if (s.t === 'text') {
      ctx.font = TEXT_FONT(Math.max(8, s.w * W)); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = s.c;
      ctx.fillText(s.s || '', s.p[0] * W, s.p[1] * H);
    } else if (s.t === 'stamp' && /^img:/.test(s.s || '')) {
      const im = stampImage(s.s), size = Math.max(8, s.w * W);
      if (im) { const k = Math.min(size / im.naturalWidth, size / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; ctx.drawImage(im, s.p[0] * W - w / 2, s.p[1] * H - h / 2, w, h); }
    } else if (s.t === 'stamp') {
      const size = Math.max(8, s.w * W);
      ctx.font = size + 'px ' + EMOJI_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.s || '⭐', s.p[0] * W, s.p[1] * H);
    } else if (s.t === 'line' || s.t === 'rect' || s.t === 'ellipse') {
      if (s.p.length < 4) { ctx.restore(); return; }
      const x1 = s.p[0] * W, y1 = s.p[1] * H, x2 = s.p[2] * W, y2 = s.p[3] * H;
      ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
      ctx.beginPath();
      if (s.t === 'line') { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      else if (s.t === 'rect') ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      else ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(0.5, Math.abs(x2 - x1) / 2), Math.max(0.5, Math.abs(y2 - y1) / 2), 0, 0, Math.PI * 2);
      if (s.f && s.t !== 'line') ctx.fill(); else ctx.stroke();
    } else {
      if (s.t === 'eraser') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000'; }
      else { ctx.strokeStyle = s.c; if (s.t === 'marker') ctx.globalAlpha = MARKER_ALPHA; }
      pathOf(ctx, s.p, W, H);
      ctx.stroke();
    }
    ctx.restore();
  }
  // ── where a stroke is, for selecting it ──
  let measureCtx = null;
  function textWidth(txt, px) { if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d'); measureCtx.font = TEXT_FONT(px); return measureCtx.measureText(txt).width; }
  function strokeBox(st, W, H) {                            // the box round a stroke, in canvas pixels
    if (st.t === 'stamp') { const half = Math.max(0.02, st.w) * 0.62 * W; return { x0: st.p[0] * W - half, y0: st.p[1] * H - half, x1: st.p[0] * W + half, y1: st.p[1] * H + half }; }
    if (st.t === 'text') { const size = Math.max(8, st.w * W); return { x0: st.p[0] * W - 4, y0: st.p[1] * H - size * 0.62, x1: st.p[0] * W + textWidth(st.s || '', size) + 4, y1: st.p[1] * H + size * 0.62 }; }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < st.p.length; i += 2) { x0 = Math.min(x0, st.p[i] * W); x1 = Math.max(x1, st.p[i] * W); y0 = Math.min(y0, st.p[i + 1] * H); y1 = Math.max(y1, st.p[i + 1] * H); }
    const pad = st.w * W / 2 + 4;
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const k = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
    return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
  }
  function hitStroke(st, x, y, W, H) {                      // is the spot (canvas pixels) on this stroke? (fills and the rubbing eraser cannot be picked)
    if (st.t === 'fill' || st.t === 'eraser') return false;
    const tol = Math.max(10, st.w * W / 2 + 6);
    if (st.t === 'stamp' || st.t === 'text') { const b = strokeBox(st, W, H); return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; }
    const P = (i) => [st.p[i * 2] * W, st.p[i * 2 + 1] * H];
    if (st.t === 'line') { const a = P(0), b = P(1); return distSeg(x, y, a[0], a[1], b[0], b[1]) <= tol; }
    if (st.t === 'rect') {
      const a = P(0), b = P(1), l = Math.min(a[0], b[0]), r = Math.max(a[0], b[0]), tp = Math.min(a[1], b[1]), bt = Math.max(a[1], b[1]);
      if (st.f) return x >= l - tol && x <= r + tol && y >= tp - tol && y <= bt + tp * 0 + tol;
      return [[l, tp, r, tp], [r, tp, r, bt], [r, bt, l, bt], [l, bt, l, tp]].some((e) => distSeg(x, y, e[0], e[1], e[2], e[3]) <= tol);
    }
    if (st.t === 'ellipse') {
      const a = P(0), b = P(1), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.max(1, Math.abs(b[0] - a[0]) / 2), ry = Math.max(1, Math.abs(b[1] - a[1]) / 2);
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry), slack = tol / Math.min(rx, ry);
      return st.f ? r <= 1 + slack : Math.abs(r - 1) <= slack;
    }
    const n = st.p.length / 2;                              // pen and marker: along the path
    if (n === 1) { const a = P(0); return Math.hypot(x - a[0], y - a[1]) <= tol; }
    for (let i = 0; i < n - 1; i++) { const a = P(i), b = P(i + 1); if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= tol) return true; }
    return false;
  }
  function drawAll(ctx, strokes, W, H, ink) {                // ink: the flattened picture of earlier strokes (an Image), drawn first
    ctx.clearRect(0, 0, W, H);
    if (ink) ctx.drawImage(ink, 0, 0, W, H);
    for (const s of strokes) drawStroke(ctx, s, W, H);
  }
  // The background of a board painted into a canvas (the same look as the CSS ones). scale: how many canvas pixels one CSS pixel of the board is.
  function paintBase(g, background, img, W, H, scale) {
    g.fillStyle = bgCss(background) || (background === 'chalkboard' ? '#22332c' : background === 'paper' ? '#f6f0df' : background === 'lined' ? '#fffef6' : '#ffffff');
    g.fillRect(0, 0, W, H);
    if (background === 'photo' && img && img.width) {
      const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    }
    if (background === 'grid') { g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 1; const step = 28 * scale; for (let x = 0; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (let y = 0; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
    if (background === 'lined') { g.strokeStyle = 'rgba(60,110,200,0.28)'; g.lineWidth = 1; const step = 32 * scale; for (let y = step; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
  }
  function loadImage(url) {
    return new Promise((resolve) => { if (!url) return resolve(null); const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = url; });
  }
  // The board as a picture to keep: its background drawn in, the strokes on top, at most 1280 on the long side. photoUrl: the picture behind it, if the background is a picture.
  function toPng(strokes, background, aspectW, aspectH, cb, photoUrl, inkUrl) {
    const long = 1280, k = long / Math.max(aspectW, aspectH);
    const W = Math.max(2, Math.round(aspectW * k)), H = Math.max(2, Math.round(aspectH * k));
    Promise.all([loadImage(background === 'photo' ? photoUrl : null), loadImage(inkUrl || null), preloadStamps(strokes)]).then(([img, ink]) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      paintBase(g, background, img, W, H, k * 0.9);
      const layer = document.createElement('canvas'); layer.width = W; layer.height = H;
      drawAll(layer.getContext('2d'), strokes, W, H, ink);
      g.drawImage(layer, 0, 0);
      c.toBlob(cb, 'image/png');
    });
  }

  function mount(root, opts) {
    ensureStyle();
    const api = opts.api, say = opts.say || function () {};
    const board = opts.board;
    const S = { strokes: [], ops: [], redoOps: [], busy: false, queued: 0, version: 0, background: 'white', photo: '', photoImg: null, ink: '', inkImg: null, tool: 'pen', color: COLORS[0], size: 0.009, sel: null, customStamps: null, shape: 'rect', replaySpeed: 1, eyedrop: false, k: 1, zx: 0, zy: 0, res: 1, pinch: null, pinchHold: false, stamp: STAMPS[0], fillShape: false, drawing: null, ro: !!opts.readOnly, pane: null, replaying: false, penSeenAt: 0, destroyed: false, saving: 0 };
    const isEditing = () => (opts.isEditing ? !!opts.isEditing() : false);
    const photoUrl = () => (S.photo ? '/uploads/' + encodeURIComponent(S.photo) : '');

    root.innerHTML = '';
    // A board that shows the theme through it (Transparent, or a see-through color) has no edge of its own, so it gets a thin border: always ('on'), never ('off'), or only then ('auto', the default).
    const seeThrough = () => S.background === 'clear' || (BG_COLOR_RE.test(S.background) && bgSolid(S.background) < 0.999);
    const bordered = () => opts.border === 'on' || (opts.border !== 'off' && seeThrough());
    const boxClass = () => 'dw bg-' + (BG_COLOR_RE.test(S.background) ? 'color' : S.background) + (S.ro ? ' ro' : '') + (opts.big ? ' big' : '') + (opts.cursor ? ' dw-cur' : '') + (bordered() ? ' dw-bordered' : '');
    const box = document.createElement('div'); box.className = boxClass();
    const main = document.createElement('canvas'), live = document.createElement('canvas');
    live.style.pointerEvents = 'none';
    const note = document.createElement('div'); note.className = 'dw-note';
    const view = document.createElement('div'); view.className = 'dw-view bg-white';
    view.appendChild(main); view.appendChild(live);
    box.appendChild(view); box.appendChild(note);
    const zoomBtn = document.createElement('button'); zoomBtn.type = 'button'; zoomBtn.className = 'dw-zoom'; zoomBtn.title = t('Reset zoom'); zoomBtn.setAttribute('aria-label', t('Reset zoom'));
    if (!opts.readOnly) box.appendChild(zoomBtn);
    let bar = null;
    let ur = null, pop = null;
    if (!S.ro) {
      bar = document.createElement('div'); bar.className = 'dw-bar'; box.appendChild(bar);
      // undo and redo live outside the toolbar, in the top corner of the board: always in reach, even while the toolbar is hidden
      ur = document.createElement('div'); ur.className = 'dw-ur';
      ur.innerHTML = `<button type="button" data-act="undo" title="${esc(t('Undo'))}" aria-label="${esc(t('Undo'))}">↶</button><button type="button" data-act="redo" title="${esc(t('Redo'))}" aria-label="${esc(t('Redo'))}">↷</button>`;
      box.appendChild(ur);
      pop = document.createElement('div'); pop.className = 'dw-pop'; box.appendChild(pop);
    }
    root.appendChild(box);

    let W = 0, H = 0, mctx = null, lctx = null, noteTimer = null, barTimer = null, replayRaf = 0, recorder = null;
    function flash(msg) { note.textContent = msg; note.classList.add('on'); clearTimeout(noteTimer); noteTimer = setTimeout(() => note.classList.remove('on'), 2200); }
    function fit() {
      const r = box.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const k = Math.min(S.res, (S.res > 1 ? 2800 : MAX_SIDE) / Math.max(r.width, r.height));      // sharper canvases when zoomed in (re-drawn from the strokes)
      const nw = Math.max(2, Math.round(r.width * k)), nh = Math.max(2, Math.round(r.height * k));
      if (nw === W && nh === H) return false;
      W = nw; H = nh;
      for (const c of [main, live]) { c.width = W; c.height = H; }
      mctx = main.getContext('2d', { willReadFrequently: true }); lctx = live.getContext('2d');
      return true;
    }
    function redraw(skip) {
      if (!mctx) return;
      if (skip === undefined) return drawAll(mctx, S.strokes, W, H, S.inkImg);
      mctx.clearRect(0, 0, W, H);
      if (S.inkImg) mctx.drawImage(S.inkImg, 0, 0, W, H);
      S.strokes.forEach((st, i) => { if (i !== skip) drawStroke(mctx, st, W, H); });          // all but the sticker being moved
    }
    function setBackground(bg, photo) {
      if (photo !== undefined && photo !== S.photo) { S.photo = photo || ''; S.photoImg = null; }
      S.background = isBackground(bg) ? bg : 'white';
      if (S.background === 'photo' && !S.photo) S.background = 'white';
      box.className = boxClass();
      box.style.backgroundImage = S.background === 'photo' ? 'url("' + photoUrl() + '")' : '';
      box.style.backgroundColor = bgCss(S.background);
      view.className = 'dw-view bg-' + (BG_COLOR_RE.test(S.background) ? 'color' : S.background); view.style.backgroundImage = box.style.backgroundImage; view.style.backgroundColor = box.style.backgroundColor;
    }

    // ── the server ───────────────────────────────────────────────────────────────────────────────────────
    async function load() {
      let b = null;
      try { b = await api('/api/boards/' + encodeURIComponent(board)); } catch (e) { b = null; }
      if (S.destroyed || !b || !Array.isArray(b.strokes)) return false;
      if (S.drawing || S.replaying || S.saving > 0 || S.queued > 0 || b.version < S.version) return false;        // never pull the picture out from under a finger or a replay, or step back to an older one
      if (b.version === S.version && S.strokes.length === b.strokes.length && b.background === S.background && (b.photo || '') === S.photo && (b.ink || '') === S.ink) return false;
      if ((b.ink || '') !== S.ink) { S.ink = b.ink || ''; S.inkImg = S.ink ? await loadImage('/uploads/' + encodeURIComponent(S.ink)) : null; if (S.destroyed) return false; }
      S.strokes = b.strokes; S.version = b.version; setBackground(b.background, b.photo || ''); autoInk(false); S.ops = []; S.redoOps = []; S.sel = null;
      fit(); redraw(); syncBar();
      return true;
    }
    async function post(path, init) {
      S.saving++;
      try { return await api(path, init); } catch (e) { return null; } finally { S.saving--; }
    }
    async function addStroke(stroke) {
      const r = await post('/api/boards/' + encodeURIComponent(board) + '/strokes', { method: 'POST', body: JSON.stringify({ stroke }) });
      if (r && r.version) { S.version = Math.max(S.version, r.version); return true; }
      if (r && r.error) flash(r.error);
      else flash(t('Not saved. The drawing is still here.'));
      return false;
    }

    // ── drawing ───────────────────────────────────────────────────────────────────────────────────────
    if (!opts.prefs) { try { const v = parseFloat(localStorage.getItem(SIZE_KEY)); if (v >= SIZE_MIN && v <= SIZE_MAX) S.size = v; } catch (e) { /* no storage: the default size */ } }
    // ── remembering how someone likes the pad (color, size, tool, stamp): kept by the caller, e.g. per kid on the server ──
    const PREF_TOOLS = ['pen', 'marker', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'stamp', 'text'];
    let prefsSig = '', prefsReady = false, prefsTimer = 0, lastTool = 'pen';
    const prefsNow = () => ({ color: S.color, size: Math.round(S.size * 100000) / 100000, tool: PREF_TOOLS.includes(S.tool) ? S.tool : lastTool, stamp: S.stamp, shape: S.shape, fillShape: !!S.fillShape });
    function notePrefs() {
      if (PREF_TOOLS.includes(S.tool)) lastTool = S.tool;
      if (!opts.prefs || !prefsReady) return;
      const cur = prefsNow(), sig = JSON.stringify(cur);
      if (sig === prefsSig) return;
      prefsSig = sig; clearTimeout(prefsTimer);
      prefsTimer = setTimeout(() => { try { opts.prefs.save(cur); } catch (e) { /* not kept this time */ } }, 800);
    }
    function applyPrefs(p) {
      p = p || {};
      if (HEXRE.test(p.color || '')) { S.color = p.color.toLowerCase(); S.userColor = !['#111111', '#ffffff'].includes(S.color); }
      if (Number(p.size) >= SIZE_MIN && Number(p.size) <= SIZE_MAX) S.size = Number(p.size);
      if (PREF_TOOLS.includes(p.tool)) { S.tool = p.tool; lastTool = p.tool; }
      if (typeof p.stamp === 'string' && p.stamp) S.stamp = p.stamp;
      if (SHAPES.includes(p.shape)) S.shape = p.shape;
      if (typeof p.fillShape === 'boolean') S.fillShape = p.fillShape;
      autoInk(false);
      prefsSig = JSON.stringify(prefsNow()); prefsReady = true; syncBar();
    }
    const width = () => S.size;
    const stampSize = () => Math.min(0.4, S.size * STAMP_K);
    function pointOf(e) { const r = main.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; }
    // ── zoom: two fingers pinch and drag; the view is scaled and moved with CSS, and the canvases are drawn again sharper once it settles ──────────────────────────
    const MAX_ZOOM = 8;
    function applyZoom() {
      const r = box.getBoundingClientRect();
      S.k = Math.min(MAX_ZOOM, Math.max(1, S.k));
      S.zx = Math.min(0, Math.max(r.width * (1 - S.k), S.zx)); S.zy = Math.min(0, Math.max(r.height * (1 - S.k), S.zy));   // the board always covers the frame
      view.style.transform = S.k === 1 ? '' : 'translate(' + S.zx + 'px,' + S.zy + 'px) scale(' + S.k + ')';
      zoomBtn.classList.toggle('on', S.k > 1.01);
      zoomBtn.textContent = '⤢ ' + Math.round(S.k * 100) + '%';
    }
    let resTimer = 0;
    function settleRes() {
      clearTimeout(resTimer);
      resTimer = setTimeout(() => {
        if (S.destroyed) return;
        if (S.drawing || S.replaying || S.pinch) return settleRes();
        const want = Math.min(4, Math.max(1, Math.ceil(S.k)));
        if (want !== S.res) { S.res = want; if (fit()) { redraw(); drawSelection(); } }
      }, 300);
    }
    function zoomAt(cx, cy, k2) {                              // zoom to k2 keeping the spot under (cx, cy) (client coordinates) where it is
      const r = box.getBoundingClientRect(), fx = cx - r.left, fy = cy - r.top;
      const nk = Math.min(MAX_ZOOM, Math.max(1, k2)), px = (fx - S.zx) / S.k, py = (fy - S.zy) / S.k;
      S.k = nk; S.zx = fx - px * nk; S.zy = fy - py * nk;
      applyZoom(); settleRes();
    }
    function resetZoom() { S.k = 1; S.zx = 0; S.zy = 0; applyZoom(); settleRes(); }
    const touches = new Map();                                  // fingers on the board: pointer id -> [x, y]
    const pinchGeo = () => { const [a, b] = [...touches.values()]; return { d: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; };
    function pinchDown(e) {
      if (S.ro || e.pointerType !== 'touch') return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (S.pinchHold && touches.size > 1) e.stopImmediatePropagation();
      if (touches.size !== 2) return;
      e.stopImmediatePropagation();
      if (S.drawing) {                                          // the first finger had started a stroke: it was the start of a pinch, not a stroke
        S.drawing = null; if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
        if (lctx) lctx.clearRect(0, 0, W, H);
        redraw(); syncBar();
      }
      const g = pinchGeo(), r = box.getBoundingClientRect();
      S.pinch = { d: g.d, k: S.k, c: [(g.mx - r.left - S.zx) / S.k, (g.my - r.top - S.zy) / S.k] };   // the board spot under the middle of the two fingers
      S.pinchHold = true;
    }
    function pinchMove(e) {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (!S.pinch || touches.size < 2) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const g = pinchGeo(), r = box.getBoundingClientRect(), nk = Math.min(MAX_ZOOM, Math.max(1, S.pinch.k * g.d / S.pinch.d));
      S.k = nk; S.zx = g.mx - r.left - S.pinch.c[0] * nk; S.zy = g.my - r.top - S.pinch.c[1] * nk;   // follows the fingers: zoom and drag together
      applyZoom();
    }
    function pinchUp(e) {
      if (!touches.delete(e.pointerId)) return;
      if (S.pinch && touches.size < 2) { S.pinch = null; settleRes(); }
      if (!touches.size) S.pinchHold = false;
    }
    main.addEventListener('pointerdown', pinchDown);             // registered first: it sees a second finger before the drawing code does
    main.addEventListener('pointermove', pinchMove);
    main.addEventListener('pointerup', pinchUp); main.addEventListener('pointercancel', pinchUp);
    // Safari on an iPhone or iPad also has its own pinch for the whole page: on the board, the pinch is the board's
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) box.addEventListener(g, (e) => e.preventDefault());
    if (!opts.readOnly) {
      box.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAt(e.clientX, e.clientY, S.k * Math.exp(-e.deltaY * 0.01)); return; }
        if (S.ro || S.replaying || S.drawing || isEditing() || e.target.closest('.dw-pop') || !e.deltaY) return;
        e.preventDefault();                                                                               // a mouse wheel changes the pen size
        S.size = sizeAt(posOf(S.size) - Math.sign(e.deltaY) * 4);
        if (!opts.prefs) { try { localStorage.setItem(SIZE_KEY, String(S.size)); } catch (x) { /* nothing remembered */ } }
        const dot = bar && bar.querySelector('.szdot'); if (dot) dot.style.cssText = dotStyle();
        const sl = bar && bar.querySelector('input.size'); if (sl) sl.value = posOf(S.size);
        notePrefs();
      }, { passive: false });
      zoomBtn.addEventListener('click', (e) => { e.stopPropagation(); resetZoom(); });
    }

    // ── strokes already on the board: tap one with the Select tool, then move it, resize it (the size slider), recolor it, delete it, or (words) edit the words ──
    const selectable = (st) => !!st && st.t !== 'fill' && st.t !== 'eraser';
    function strokeAtPoint(x, y) {                            // x, y as fractions of the board: the top-most stroke under that spot, or -1
      for (let i = S.strokes.length - 1; i >= 0; i--) if (hitStroke(S.strokes[i], x * W, y * H, W, H)) return i;
      return -1;
    }
    function selectionBox(ctx, st) {
      const bx = strokeBox(st, W, H);
      ctx.save(); ctx.lineWidth = 3; ctx.setLineDash([7, 5]);
      ctx.strokeStyle = '#ffffff'; ctx.strokeRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
      ctx.lineDashOffset = 6; ctx.strokeStyle = '#1e88e5'; ctx.strokeRect(bx.x0, bx.y0, bx.x1 - bx.x0, bx.y1 - bx.y0);
      ctx.restore();
    }
    function drawSelection() {                                // the dashed box round the selected stroke, on the live layer
      if (!lctx || S.drawing || S.replaying) return;
      lctx.clearRect(0, 0, W, H);
      const st = S.sel !== null ? S.strokes[S.sel] : null;
      if (selectable(st)) selectionBox(lctx, st);
    }
    const kOf = (st) => (st.t === 'stamp' ? STAMP_K : st.t === 'text' ? TEXT_K : st.t === 'marker' ? 2 : 1);       // how many pen sizes a stroke's own size is
    const sizeOfStroke = (st) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, st.w / kOf(st)));
    const wFor = (st, size) => Math.round(Math.min(st.t === 'stamp' ? 0.4 : st.t === 'text' ? 0.25 : 0.2, Math.max(0.0005, size * kOf(st))) * 100000) / 100000;
    // the stroke the size slider and the delete button act on: the selected one, or (with the Stamp or Text tool) the one just placed
    function selTarget() {
      if (S.sel !== null && selectable(S.strokes[S.sel])) return S.sel;
      const last = S.strokes.length - 1;
      return (S.tool === 'stamp' || S.tool === 'text') && last >= 0 && S.strokes[last].t === S.tool ? last : -1;
    }
    const onStampImage = () => { if (!S.destroyed && !S.replaying && !S.drawing && S.strokes.some((st) => st.t === 'stamp' && /^img:/.test(st.s || ''))) scheduleRedraw(); };
    imgWaiters.add(onStampImage);
    let rdRaf = 0;
    function scheduleRedraw() { if (rdRaf) return; rdRaf = requestAnimationFrame(() => { rdRaf = 0; redraw(); drawSelection(); }); }
    // Everything sent to the server goes one at a time, in order. A stroke is named by its kind, words/emoji, where it starts and how many points it has, so a stale edit from another
    // screen is refused (409) instead of changing the wrong stroke; then the board is loaded again.
    const queue = (fn) => { S.queued++; S.chain = (S.chain || Promise.resolve()).then(fn).catch(() => {}).then(() => { S.queued--; }); return S.chain; };
    const expectOf = (st) => ({ t: st.t, s: st.s, p: [st.p[0], st.p[1]], n: st.p.length / 2 });
    const strokePath = (idx) => '/api/boards/' + encodeURIComponent(board) + '/strokes/' + idx;
    function strokeCall(path, init) {
      return queue(async () => {
        const r = await post(path, init);
        if (r && r.version && !r.error) { S.version = Math.max(S.version, r.version); saveOps(); return; }
        flash(t('That was changed on another screen.'));
        S.version = -1; S.queued--; await load(); S.queued++;
      });
    }
    const callPut = (idx, after, before) => strokeCall(strokePath(idx), { method: 'PUT', body: JSON.stringify({ stroke: after, expect: expectOf(before) }) });
    const callRemove = (idx, st) => strokeCall(strokePath(idx) + '/remove', { method: 'POST', body: JSON.stringify({ expect: expectOf(st) }) });
    const callInsert = (idx, st) => strokeCall('/api/boards/' + encodeURIComponent(board) + '/strokes/insert', { method: 'POST', body: JSON.stringify({ index: idx, stroke: st }) });

    // ── undo and redo: a list of what was done (a stroke added, deleted or changed), kept on this device so it survives a reload as long as nobody else has changed the board ──
    let opsTimer = 0;
    const opsKey = () => 'drawui_ops_' + board;
    function saveOps() {
      clearTimeout(opsTimer);
      opsTimer = setTimeout(() => { try { localStorage.setItem(opsKey(), JSON.stringify({ v: S.version, ops: S.ops.slice(-OPS_MAX), redo: S.redoOps.slice(-OPS_MAX) })); } catch (e) { /* nothing kept */ } }, 500);
    }
    function restoreOps() {
      if (S.ops.length || S.redoOps.length) return;
      try { const j = JSON.parse(localStorage.getItem(opsKey()) || 'null'); if (j && j.v === S.version && Array.isArray(j.ops)) { S.ops = j.ops; S.redoOps = Array.isArray(j.redo) ? j.redo : []; syncBar(); } } catch (e) { /* none */ }
    }
    function pushOp(op) { S.ops.push(op); if (S.ops.length > OPS_MAX) S.ops.shift(); S.redoOps = []; saveOps(); }
    const sameStroke = (a, b) => !!a && !!b && a.t === b.t && a.s === b.s && a.c === b.c && a.p.length === b.p.length && Math.abs(a.p[0] - b.p[0]) < 0.0006 && Math.abs(a.p[1] - b.p[1]) < 0.0006 && Math.abs(a.w - b.w) < 0.0002;
    function findStroke(st, hint) {
      if (hint !== undefined && hint !== null && sameStroke(S.strokes[hint], st)) return hint;
      for (let i = S.strokes.length - 1; i >= 0; i--) if (sameStroke(S.strokes[i], st)) return i;
      return -1;
    }
    const cloneStroke = (st) => ({ ...st, p: st.p.slice() });
    async function undo() {
      if (S.busy || S.replaying) return;
      S.busy = true;
      try {
        let op = S.ops.pop();
        if (!op) { const i = S.strokes.length - 1; if (i < 0) return; op = { k: 'add', stroke: cloneStroke(S.strokes[i]) }; }          // nothing recorded (an older drawing): take the last stroke off
        if (op.k === 'add') {
          const i = findStroke(op.stroke);
          if (i < 0) { flash(t('That was changed on another screen.')); return; }
          S.strokes.splice(i, 1); redraw(); callRemove(i, op.stroke);
        } else if (op.k === 'del') {
          const i = Math.min(op.idx, S.strokes.length);
          S.strokes.splice(i, 0, op.stroke); op.idx = i; redraw(); callInsert(i, op.stroke);
        } else if (op.k === 'edit') {
          const i = findStroke(op.after, op.idx);
          if (i < 0) { flash(t('That was changed on another screen.')); return; }
          S.strokes[i] = cloneStroke(op.before); op.idx = i; redraw(); callPut(i, op.before, op.after);
        }
        S.redoOps.push(op);
      } finally { S.busy = false; S.sel = null; syncBar(); saveOps(); }
    }
    async function redo() {
      if (S.busy || S.replaying) return;
      S.busy = true;
      try {
        const op = S.redoOps.pop();
        if (!op) return;
        if (op.k === 'add') {
          S.strokes.push(cloneStroke(op.stroke)); drawStroke(mctx, op.stroke, W, H);
          queue(() => addStroke(op.stroke));
        } else if (op.k === 'del') {
          const i = findStroke(op.stroke, op.idx);
          if (i < 0) { flash(t('That was changed on another screen.')); return; }
          S.strokes.splice(i, 1); op.idx = i; redraw(); callRemove(i, op.stroke);
        } else if (op.k === 'edit') {
          const i = findStroke(op.before, op.idx);
          if (i < 0) { flash(t('That was changed on another screen.')); return; }
          S.strokes[i] = cloneStroke(op.after); op.idx = i; redraw(); callPut(i, op.after, op.before);
        }
        S.ops.push(op);
      } finally { S.busy = false; S.sel = null; syncBar(); saveOps(); }
    }
    function editStroke(idx, after) {                         // a stroke changed (moved, resized, recolored, words changed)
      const before = S.strokes[idx];
      const next = { ...after, p: after.p.map((v) => Math.round(v * 10000) / 10000), w: Math.round(after.w * 100000) / 100000 };
      S.strokes[idx] = next; pushOp({ k: 'edit', idx, before: cloneStroke(before), after: cloneStroke(next) });
      callPut(idx, next, before); redraw(); syncBar();
      if (opts.onChange) opts.onChange();
    }
    function deleteSelected() {
      const idx = selTarget();
      if (idx < 0) return;
      const st = S.strokes[idx];
      S.strokes.splice(idx, 1); S.sel = null; pushOp({ k: 'del', idx, stroke: cloneStroke(st) });
      redraw(); syncBar(); showBar(); callRemove(idx, st);
      if (opts.onChange) opts.onChange();
    }
    function applyColorToSelected() {                         // a color picked while a stroke (not a sticker) is selected recolors it
      const i = S.sel, st = i !== null ? S.strokes[i] : null;
      if (!selectable(st) || st.t === 'stamp' || st.c === S.color) return;
      editStroke(i, { ...st, c: S.color });
    }

    // ── words: tap with the Text tool, type, press Enter ──
    let textInp = null;
    function closeTextInput() { if (textInp) { const e = textInp; textInp = null; e.remove(); } }
    function openTextInput(spot, idx) {                        // spot: where, as fractions; idx: the words stroke being edited, or null for new words
      closeTextInput();
      const r = box.getBoundingClientRect(), st = idx !== null && idx !== undefined ? S.strokes[idx] : null;
      const w = st ? st.w : Math.min(0.25, S.size * TEXT_K);
      const px = Math.max(14, Math.min(160, w * r.width * S.k));
      const inp = document.createElement('input');
      inp.type = 'text'; inp.maxLength = 120; inp.className = 'dw-text'; inp.value = st ? st.s : ''; inp.setAttribute('aria-label', t('Text'));
      inp.style.cssText = 'left:' + (spot[0] * r.width * S.k + S.zx) + 'px;top:' + (spot[1] * r.height * S.k + S.zy - px * 0.75) + 'px;font-size:' + px + 'px;color:' + (st ? st.c : S.color);
      box.appendChild(inp); textInp = inp;
      inp.focus();
      let done = false;
      const finish = (ok) => { if (done) return; done = true; const v = inp.value.trim(); closeTextInput(); if (ok && v) commitText(v, spot, st ? idx : null, w); };
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
      inp.addEventListener('blur', () => finish(true));
      inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    function commitText(v, spot, idx, w) {
      if (idx !== null) { const st = S.strokes[idx]; if (st && st.t === 'text' && v !== st.s) editStroke(idx, { ...st, s: v.slice(0, 120) }); return; }
      const stroke = { t: 'text', c: S.color, w: Math.round(w * 100000) / 100000, p: [Math.round(spot[0] * 10000) / 10000, Math.round(spot[1] * 10000) / 10000], s: v.slice(0, 120) };
      S.sel = null; drawStroke(mctx, stroke, W, H); commit(stroke);
      S.sel = S.strokes.length - 1; syncBar(); showBar();
    }
    // A board that is getting full is flattened: everything on it becomes one picture under the next strokes (the server refuses strokes past its limit).
    const pointsOnBoard = () => S.strokes.reduce((n, st) => n + st.p.length / 2, 0);
    async function flattenBoard() {
      if (!S.strokes.length || S.replaying || S.destroyed) return;
      const n = S.strokes.length, c = document.createElement('canvas');
      await preloadStamps(S.strokes);
      c.width = W; c.height = H;
      drawAll(c.getContext('2d'), S.strokes, W, H, S.inkImg);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      if (!blob) return;
      let r = null;
      try { r = await fetch('/api/boards/' + encodeURIComponent(board) + '/flatten?n=' + n, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob }).then((x) => (x.ok ? x.json() : null)); } catch (e) { r = null; }
      if (!r || !r.ink || S.strokes.length !== n) { S.version = -1; S.queued--; await load(); S.queued++; return; }                  // the board changed meanwhile: carry on from the server's
      S.ink = r.ink; S.inkImg = await loadImage('/uploads/' + encodeURIComponent(r.ink));
      S.version = Math.max(S.version, r.version || 0); S.strokes = []; S.ops = []; S.redoOps = []; S.sel = null;
      redraw(); syncBar(); saveOps(); flash(t('Board tidied up.'));
    }
    function commit(stroke) {                                 // a finished stroke: onto the board, the list, and the server
      S.strokes.push(stroke); pushOp({ k: 'add', stroke: cloneStroke(stroke) });
      syncBar();
      const saved = queue(() => addStroke(stroke)).then(() => { if (opts.onChange) opts.onChange(); });
      if (pointsOnBoard() > (window.DrawUI && window.DrawUI.FLATTEN_AT || 45000)) queue(() => flattenBoard());
      return saved;
    }
    function onDown(e) {
      if (S.ro || S.replaying || S.pinch || S.pinchHold || isEditing() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.pointerType === 'pen') S.penSeenAt = Date.now();
      else if (e.pointerType === 'touch' && Date.now() - S.penSeenAt < 1500) return;       // a palm resting while a stylus is in use
      if (S.drawing) return;
      e.preventDefault(); e.stopPropagation();
      const [x, y] = pointOf(e);
      if (S.eyedrop) {                                        // pick the color under the finger: the ink there, or the background where there is none
        const px = mctx.getImageData(Math.min(W - 1, Math.round(x * W)), Math.min(H - 1, Math.round(y * H)), 1, 1).data;
        const bgc = bgHex(S.background) || '#ffffff';
        const hex = px[3] > 40 ? '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('') : bgc;
        S.eyedrop = false; S.pane = null; useColor(hex, true); applyColorToSelected(); syncBar(); flash(hex);
        return;
      }
      if (S.pane) { S.pane = null; syncBar(); }
      if (S.tool === 'select') {
        const i = strokeAtPoint(x, y);
        S.sel = i >= 0 ? i : null;
        if (i >= 0) {
          const st = S.strokes[i];
          S.size = sizeOfStroke(st);                                                         // the slider shows this stroke's size
          try { main.setPointerCapture(e.pointerId); } catch (x2) { /* a pointer that is already gone */ }
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          for (let j = 0; j < st.p.length; j += 2) { minX = Math.min(minX, st.p[j]); maxX = Math.max(maxX, st.p[j]); minY = Math.min(minY, st.p[j + 1]); maxY = Math.max(maxY, st.p[j + 1]); }
          S.drawing = { id: e.pointerId, kind: 'move', idx: i, orig: cloneStroke(st), moving: cloneStroke(st), start: [x, y], lim: [-minX, 1 - maxX, -minY, 1 - maxY], last: [x * W, y * H], moved: false };
        }
        showBar(); syncBar();
        return;
      }
      if (S.tool === 'text') {                                // opens the box to type in when the finger lifts (a keyboard only opens from a lift on some phones)
        try { main.setPointerCapture(e.pointerId); } catch (x2) { /* a pointer that is already gone */ }
        S.drawing = { id: e.pointerId, kind: 'text', spot: [x, y], last: [x * W, y * H], moved: false };
        return;
      }
      if (S.tool === 'fill') {                                // a tap: no dragging
        const stroke = { t: 'fill', c: S.color, w: 0.001, p: [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] };
        drawStroke(mctx, stroke, W, H);
        S.sel = null; commit(stroke); showBar();
        return;
      }
      try { main.setPointerCapture(e.pointerId); } catch (x2) { /* a pointer that is already gone */ }
      const tool = S.tool, kind = FREE.includes(tool) ? 'free' : tool === 'stamp' ? 'stamp' : 'shape';
      const w = tool === 'eraser' ? Math.max(0.02, width() * 2.2) : tool === 'marker' ? width() * 2 : tool === 'stamp' ? stampSize() : width();
      S.drawing = { id: e.pointerId, kind, t: tool, c: tool === 'eraser' ? '#ffffff' : S.color, w, p: kind === 'shape' ? [x, y, x, y] : [x, y], last: [x * W, y * H], moved: false };
      if (kind === 'stamp') S.drawing.s = S.stamp;
      if (kind === 'shape' && S.fillShape && tool !== 'line') S.drawing.f = 1;
      if (tool === 'pen' || tool === 'eraser') drawStroke(mctx, { t: tool, c: S.drawing.c, w, p: [x, y] }, W, H);
      else drawLive();
      showBar();
      syncBar();
    }
    function onMove(e) {
      const d = S.drawing;
      if (!d || e.pointerId !== d.id) return;
      e.preventDefault();
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (list.length ? list : [e])) {
        const [x, y] = pointOf(ev), px = x * W, py = y * H;
        if (Math.hypot(px - d.last[0], py - d.last[1]) < MIN_STEP) continue;
        d.moved = true;
        if (d.kind === 'text') { d.last = [px, py]; continue; }
        if (d.kind === 'move') {
          if (!d.hidden) { d.hidden = true; redraw(d.idx); }                                  // the stroke is drawn on the live layer while it moves
          const dx = Math.min(d.lim[1], Math.max(d.lim[0], x - d.start[0])), dy = Math.min(d.lim[3], Math.max(d.lim[2], y - d.start[1]));
          d.moving = { ...d.orig, p: d.orig.p.map((v, i) => v + (i % 2 ? dy : dx)) }; d.last = [px, py]; continue;
        }
        if (d.kind === 'shape') { d.p[2] = x; d.p[3] = y; d.last = [px, py]; continue; }
        if (d.kind === 'stamp') { d.p = [x, y]; d.last = [px, py]; continue; }
        if (d.p.length / 2 >= 4999) break;
        if (d.t !== 'marker') drawStroke(mctx, { t: d.t, c: d.c, w: d.w, p: [d.last[0] / W, d.last[1] / H, x, y] }, W, H);
        d.p.push(x, y); d.last = [px, py];
      }
      if (d.t === 'marker' || d.kind !== 'free') drawLive();
    }
    let liveRaf = 0;
    function drawLive() {
      if (liveRaf) return;
      liveRaf = requestAnimationFrame(() => {
        liveRaf = 0;
        if (!S.drawing || !lctx) return;
        lctx.clearRect(0, 0, W, H);
        drawStroke(lctx, S.drawing.kind === 'move' ? S.drawing.moving : S.drawing, W, H);
        if (S.drawing.kind === 'move') selectionBox(lctx, S.drawing.moving);
      });
    }
    async function onUp(e) {
      const d = S.drawing;
      if (!d || e.pointerId !== d.id) return;
      S.drawing = null;
      try { main.releasePointerCapture(e.pointerId); } catch (x) { /* already released */ }
      if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
      if (lctx) lctx.clearRect(0, 0, W, H);
      if (d.kind === 'text') { openTextInput(d.spot, null); return; }
      if (d.kind === 'move') {                                // let go of a stroke: it stays where it was put
        if (d.moved) editStroke(d.idx, d.moving); else redraw();
        drawSelection(); syncBar();
        return;
      }
      if (d.kind === 'shape' && !d.moved) return;             // a tap with a shape tool draws nothing
      const stroke = { t: d.t, c: d.c, w: Math.round(d.w * 100000) / 100000, p: d.p.map((v) => Math.round(v * 10000) / 10000) };
      if (d.s) stroke.s = d.s;
      if (d.kind === 'stamp') flash(t('Drag the size slider to resize it.'));
      if (d.f) stroke.f = 1;
      if (d.t === 'marker' || d.kind !== 'free') drawStroke(mctx, stroke, W, H);
      S.sel = null;
      const saved = commit(stroke);
      if (d.kind === 'stamp') { S.sel = S.strokes.length - 1; syncBar(); }                 // the sticker just placed is the selected one
      await saved;
    }
    function onCancel(e) {
      const d = S.drawing;
      if (!d || e.pointerId !== d.id) return;
      S.drawing = null;
      if (lctx) lctx.clearRect(0, 0, W, H);
      redraw(); drawSelection();
    }
    main.addEventListener('pointerdown', onDown);
    main.addEventListener('pointermove', onMove);
    main.addEventListener('pointerup', onUp);
    main.addEventListener('pointercancel', onCancel);
    main.addEventListener('contextmenu', (e) => e.preventDefault());

    // ── the toolbar ───────────────────────────────────────────────────────────────────────────────────
    function showBar() {
      if (!bar) return;
      bar.classList.remove('hidden');
      clearTimeout(barTimer);
      if (opts.toolbar === 'touch' && !S.pane) barTimer = setTimeout(() => { if (!S.drawing && !S.pane) bar.classList.add('hidden'); }, 6000);
    }
    let thumbs = null;                                        // recent photos for the picture picker
    // the dot beside the size slider: about how thick the line is (a stamp: how big, within the same little box)
    function dotStyle() {
      const px = Math.max(3, Math.min(30, Math.round((S.tool === 'stamp' ? stampSize() : S.tool === 'text' ? S.size * TEXT_K : S.tool === 'select' && S.sel !== null && S.strokes[S.sel] ? S.strokes[S.sel].w : S.tool === 'eraser' ? Math.max(0.02, S.size * 2.2) : S.size) * (W || 600))));
      return 'width:' + px + 'px;height:' + px + 'px';
    }
    function drawBar() {
      if (!bar) return;
      const tool = (id, ico, label) => `<button type="button" data-tool="${id}" class="${S.tool === id ? 'on' : ''}" title="${esc(label)}" aria-label="${esc(label)}">${ico}</button>`;
      const colors = () => COLORS.map((c) => `<button type="button" class="sw ${S.tool !== 'eraser' && S.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="${esc(t('Color'))}"></button>`).join('')
        + (COLORS.includes(S.color) ? '' : `<button type="button" class="sw ${S.tool !== 'eraser' ? 'on' : ''}" data-color="${S.color}" style="background:${S.color}" aria-label="${esc(t('Color'))}"></button>`)
        ;
      const act = (id, ico, label, dis) => `<button type="button" data-act="${id}" title="${esc(label)}" aria-label="${esc(label)}" ${dis ? 'disabled' : ''}>${ico}</button>`;
      if (S.pane === 'clear') {
        bar.innerHTML = `<span class="ask">${esc(t('Clear the whole board?'))}</span><button type="button" data-act="clear-yes" class="on">${esc(t('Clear'))}</button><button type="button" data-act="clear-no">${esc(t('Cancel'))}</button>`;
      } else if (S.pane === 'color') {
        bar.innerHTML = act('pane-close', '←', t('Back')) + colors() + '<span class="sep"></span>' + `<button type="button" data-act="eyedrop" class="${S.eyedrop ? 'on' : ''}" title="${esc(t('Pick a color from the board'))}" aria-label="${esc(t('Pick a color from the board'))}">💧</button>`;
      } else if (S.pane === 'shapes') {
        bar.innerHTML = act('pane-close', '←', t('Back')) + tool('line', '╱', t('Line')) + tool('rect', '▭', t('Rectangle')) + tool('ellipse', '◯', t('Ellipse'))
          + '<span class="sep"></span>' + `<button type="button" data-act="fillshape" class="${S.fillShape ? 'on' : ''}" title="${esc(t('Filled'))}" aria-label="${esc(t('Filled'))}">◼</button>`;
      } else if (S.pane === 'bg') {
        const cur = S.background, hex = bgHex(cur), solid = bgSolid(cur);
        const pre = (id, label, style) => `<button type="button" class="sw bgp ${cur === id ? 'on' : ''}" data-bg="${esc(id)}" style="${style}" title="${esc(label)}" aria-label="${esc(label)}"></button>`;
        const ruled = 'background-color:#ffffff;background-image:linear-gradient(rgba(0,0,0,0.3) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.3) 1px,transparent 1px);background-size:8px 8px';
        const lines = 'background-color:#fffef6;background-image:linear-gradient(transparent 6px,rgba(60,110,200,0.6) 7px);background-size:100% 8px';
        const checker = 'background-color:#ffffff;background-image:linear-gradient(45deg,#b8b8b8 25%,transparent 25%,transparent 75%,#b8b8b8 75%),linear-gradient(45deg,#b8b8b8 25%,transparent 25%,transparent 75%,#b8b8b8 75%);background-size:10px 10px;background-position:0 0,5px 5px';
        bar.innerHTML = act('pane-close', '←', t('Back'))
          + pre('white', t('White'), 'background:#ffffff') + pre('chalkboard', t('Chalkboard'), 'background:#22332c') + pre('paper', t('Paper'), 'background:#f6f0df')
          + pre('grid', t('Grid'), ruled) + pre('lined', t('Lined'), lines) + pre('clear', t('Transparent'), checker)
          + '<span class="sep"></span>'
          + BG_SWATCHES.map((c) => pre('color:' + c, c, 'background:' + c)).join('')
          + '<span class="sep"></span>'
          + `<input type="color" data-bgcolor="1" value="${hex || '#22332c'}" title="${esc(t('Custom color'))}" aria-label="${esc(t('Custom color'))}">`
          + `<span class="ask">${esc(t('See-through'))}</span>`
          + `<input type="range" class="bgalpha" min="0" max="90" step="5" value="${Math.round((1 - solid) * 100)}" ${hex ? '' : 'disabled'} aria-label="${esc(t('See-through'))}" title="${esc(t('See-through'))}">`;
      } else if (S.pane === 'more') {
        bar.innerHTML = act('pane-close', '←', t('Back'))
          + act('bg', '🎨', t('Background')) + act('photo', '🖼️', t('Picture'))
          + '<span class="sep"></span>'
          + act('replay', '▶️', t('Replay'), !S.strokes.length) + act('print', '🖨️', t('Print'), !S.strokes.length)
          + (opts.noKeep ? '' : act('keep', '💾', t('Keep this drawing'), !S.strokes.length && !S.ink));
      } else if (S.pane === 'stamps') {
        bar.innerHTML = act('pane-close', '←', t('Back'))
          + `<label class="btn" title="${esc(t('Make a stamp from a picture'))}">📷<input type="file" accept="image/*" data-stampfile="1"></label>`
          + (S.customStamps || []).map((x) => `<button type="button" class="stamp ${S.stamp === 'img:' + x.filename ? 'on' : ''}" data-stamp="img:${esc(x.filename)}" aria-label="${esc(t('Stamp'))}"><img class="stampimg" src="/uploads/${encodeURIComponent(x.filename)}" alt=""></button>`).join('')
          + (S.customStamps && S.customStamps.length ? '<span class="sep"></span>' : '')
          + STAMP_GROUPS.map((g) => g.map((s) => `<button type="button" class="stamp ${S.stamp === s ? 'on' : ''}" data-stamp="${esc(s)}" aria-label="${esc(t('Stamp'))}">${s}</button>`).join('')).join('<span class="sep"></span>');
      } else if (S.pane === 'photo') {
        bar.innerHTML = act('pane-close', '←', t('Back'))
          + `<label class="btn" title="${esc(t('Take or choose a picture'))}">📷<input type="file" accept="image/*" data-file="1"></label>`
          + act('photo-none', '🚫', t('No picture'), S.background !== 'photo')
          + '<span class="sep"></span>'
          + (thumbs || []).map((p) => `<button type="button" class="thumb ${S.photo === p.filename && S.background === 'photo' ? 'on' : ''}" data-photo="${esc(p.filename)}" aria-label="${esc(t('Picture'))}"><img src="/uploads/${encodeURIComponent(p.filename)}" alt=""></button>`).join('');
      } else if (S.pane === 'replay') {
        const canRec = !!(window.MediaRecorder && typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream);
        const speed = (v) => `<button type="button" data-speed="${v}" class="${S.replaySpeed === v ? 'on' : ''}" aria-label="${esc(t('Speed'))} ${v}×">${v}×</button>`;
        bar.innerHTML = act('replay-stop', '⏹', t('Stop')) + (canRec && !recorder ? act('replay-video', '🎬', t('Save as video')) : '') + '<span class="sep"></span>' + speed(0.5) + speed(1) + speed(2) + `<span class="ask">${esc(recorder ? t('Recording…') : t('Replay'))}</span>`;
      } else {
        const shapeIco = { line: '╱', rect: '▭', ellipse: '◯' }[S.shape] || '▭';
        bar.innerHTML = tool('pen', '✏️', t('Pen')) + tool('marker', '🖍️', t('Marker')) + tool('eraser', '🧽', t('Eraser')) + tool('fill', '🪣', t('Fill'))
          + '<span class="sep"></span>'
          + `<button type="button" data-act="shapes" class="${SHAPES.includes(S.tool) ? 'on' : ''}" title="${esc(t('Shapes'))}" aria-label="${esc(t('Shapes'))}">${shapeIco}</button>`
          + `<button type="button" data-tool="stamp" class="${S.tool === 'stamp' ? 'on' : ''}" title="${esc(t('Stamp'))}" aria-label="${esc(t('Stamp'))}">${/^img:/.test(S.stamp) ? `<img class="stampimg" src="${stampUrl(S.stamp)}" alt="">` : S.stamp}</button>`
          + tool('text', 'Aa', t('Text')) + tool('select', '👆', t('Select'))
          + (S.sel !== null && selectable(S.strokes[S.sel]) && S.strokes[S.sel].t === 'text' ? `<button type="button" data-act="text-edit" title="${esc(t('Edit the words'))}" aria-label="${esc(t('Edit the words'))}">✏️</button>` : '')
          + (S.sel !== null && selectable(S.strokes[S.sel]) ? `<button type="button" data-act="sel-del" title="${esc(t('Delete'))}" aria-label="${esc(t('Delete'))}">❌</button>` : '')
          + '<span class="sep"></span>'
          + `<button type="button" class="sw cur" data-act="colors" style="background:${S.color}" title="${esc(t('Color'))}" aria-label="${esc(t('Color'))}"></button>`
          + `<span class="szwrap"><span class="szbox"><i class="szdot" style="${dotStyle()}"></i></span><input type="range" class="size" min="0" max="100" step="1" value="${posOf(S.size)}" aria-label="${esc(t('Width'))}" title="${esc(t('Width'))}"></span>`
          + '<span class="sep"></span>'
          + act('clear', '🗑️', t('Clear'), !S.strokes.length && !S.ink)
          + act('more', '⋯', t('More'));
      }
    }
    function syncBar() {
      drawBar();
      notePrefs();
      drawSelection();
      if (ur) { const [u, r] = ur.querySelectorAll('button'); u.disabled = !(S.ops.length || S.strokes.length) || S.replaying; r.disabled = !S.redoOps.length || S.replaying; }
      syncPop();
    }

    // ── the color picker: any color, by the square (shade) and the strip (hue), or by typing its code; the last ten used are kept on this device ──
    let popFor = false, hsv = { h: 0, s: 1, v: 1 };
    function paintPop() {
      const sv = pop.querySelector('canvas.sv'), hu = pop.querySelector('canvas.hue'); if (!sv || !hu) return;
      const g = sv.getContext('2d'), w = sv.width, h = sv.height;
      g.fillStyle = hsvToHex(hsv.h, 1, 1); g.fillRect(0, 0, w, h);
      let gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.beginPath(); g.arc(hsv.s * w, (1 - hsv.v) * h, 7, 0, Math.PI * 2); g.lineWidth = 3; g.strokeStyle = '#000'; g.stroke(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
      const hg = hu.getContext('2d'), hw = hu.width, hh = hu.height;
      const hr = hg.createLinearGradient(0, 0, hw, 0); for (let i = 0; i <= 6; i++) hr.addColorStop(i / 6, hsvToHex(i * 60, 1, 1));
      hg.fillStyle = hr; hg.fillRect(0, 0, hw, hh);
      const hx = hsv.h / 360 * hw; hg.fillStyle = '#fff'; hg.fillRect(hx - 3, 0, 6, hh); hg.strokeStyle = '#000'; hg.lineWidth = 1.5; hg.strokeRect(hx - 3, 0, 6, hh);
      pop.querySelector('.cur').style.background = S.color;
      const inp = pop.querySelector('input'); if (document.activeElement !== inp) inp.value = S.color;
    }
    function useColor(c, keep) {
      S.userColor = true; S.color = c.toLowerCase(); if (S.tool === 'eraser') S.tool = 'pen';
      if (keep) rememberColor(S.color);
    }
    function buildPop() {
      pop.innerHTML = `<canvas class="sv" width="232" height="130"></canvas><canvas class="hue" width="232" height="22"></canvas>
        <div class="row"><span class="cur"></span><input type="text" maxlength="7" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="${esc(t('Color code'))}"></div><div class="rec"></div>`;
      const sv = pop.querySelector('canvas.sv'), hu = pop.querySelector('canvas.hue'), inp = pop.querySelector('input');
      const drag = (canvas, apply) => {
        const at = (e) => { const r = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
        let on = false;
        canvas.addEventListener('pointerdown', (e) => { on = true; inp.blur(); try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* gone */ } e.preventDefault(); e.stopPropagation(); apply(at(e)); });
        canvas.addEventListener('pointermove', (e) => { if (on) { e.preventDefault(); apply(at(e)); } });
        const end = (e) => { if (!on) return; on = false; rememberColor(S.color); showRecent(); applyColorToSelected(); syncBar(); };
        canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
      };
      drag(sv, ([x, y]) => { hsv.s = x; hsv.v = 1 - y; useColor(hsvToHex(hsv.h, hsv.s, hsv.v)); paintPop(); });
      drag(hu, ([x]) => { hsv.h = x * 360; useColor(hsvToHex(hsv.h, hsv.s, hsv.v)); paintPop(); });
      inp.addEventListener('input', () => { const c = parseHex(inp.value); if (c) { hsv = hexToHsv(c); useColor(c, true); paintPop(); showRecent(); applyColorToSelected(); syncBar(); } });
      pop.querySelector('.rec').addEventListener('click', (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; hsv = hexToHsv(b.dataset.c); useColor(b.dataset.c, true); paintPop(); showRecent(); applyColorToSelected(); syncBar(); });
      showRecent();
    }
    function showRecent() {
      const rec = pop.querySelector('.rec'); if (!rec) return;
      rec.innerHTML = recentColors().map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${esc(t('Color'))}"></button>`).join('');
    }
    function syncPop() {
      if (!pop) return;
      const want = S.pane === 'color';
      if (want && !popFor) { hsv = hexToHsv(S.color); buildPop(); paintPop(); }
      popFor = want; pop.style.display = want ? 'block' : 'none';
    }
    function pngOfBoard(cb) { toPng(S.strokes, S.background, W, H, cb, photoUrl(), S.ink ? '/uploads/' + encodeURIComponent(S.ink) : ''); }
    async function setPhoto(blob) {
      const type = blob.type || 'image/jpeg';
      let r = null;
      try { r = await fetch('/api/boards/' + encodeURIComponent(board) + '/photo', { method: 'POST', headers: { 'Content-Type': type }, body: blob }).then((x) => (x.ok ? x.json() : null)); } catch (e) { r = null; }
      if (!r || !r.photo) return flash(t('Could not load the picture.'));
      S.version = Math.max(S.version, r.version || 0); setBackground('photo', r.photo);
      S.pane = null; syncBar(); showBar();
    }
    // a picture from the phone: shrunk to at most 1600 on the long side first (a camera picture is several MB)
    function shrink(file) {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => {
          const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
        };
        im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        im.src = url;
      });
    }
    // a picture from the camera or files, shrunk to fit in a box this big (a stamp keeps its see-through parts: it is sent as a PNG)
    function shrinkTo(file, max, type, quality) {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file), im = new Image();
        im.onload = () => {
          const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob((b) => resolve(b), type, quality);
        };
        im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        im.src = url;
      });
    }
    async function makeStamp(file) {
      const blob = await shrinkTo(file, 256, 'image/png');
      let r = null;
      try { if (blob) r = await fetch('/api/stamps', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob }).then((x) => (x.ok ? x.json() : null)); } catch (e) { r = null; }
      if (!r || !r.filename) return flash(t('Could not load the picture.'));
      S.customStamps = [...(S.customStamps || []), { id: r.id, filename: r.filename }];
      S.stamp = 'img:' + r.filename; S.tool = 'stamp'; S.pane = null; syncBar(); showBar();
    }
    function download(blob, name) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    }
    // Print: the picture on a page of its own, which opens the print dialog. Where there is no window to open (a kiosk, a blocked pop-up) the picture is downloaded instead.
    function printBoard() {
      if (!S.strokes.length) return;
      let win = null;
      try { win = window.open('', '_blank'); } catch (e) { win = null; }            // opened now, while the tap still counts, filled in when the picture is ready
      pngOfBoard((blob) => {
        if (!blob) { if (win) win.close(); return flash(t('Could not print. The picture was downloaded instead.')); }
        if (!win) { download(blob, 'drawing.png'); return flash(t('Could not print. The picture was downloaded instead.')); }
        const url = URL.createObjectURL(blob);
        win.document.write('<!doctype html><title>' + esc(opts.name || 'Whiteboard') + '</title><style>html,body{margin:0}img{display:block;max-width:100%;max-height:100vh;margin:0 auto}@page{margin:10mm}</style><img src="' + url + '">');
        win.document.close();
        const im = win.document.querySelector('img');
        const go = () => { try { win.focus(); win.print(); } catch (e) { /* the person can print from the window */ } };
        if (im.complete) setTimeout(go, 100); else im.onload = () => setTimeout(go, 100);
      });
    }
    // Replay: the drawing again, stroke by stroke, as it was made (pen strokes grow along their path; a shape, a stamp or a fill appears when its turn comes).
    // With record: the replay is also filmed (a canvas stream) and saved as a video.
    function stopReplay(finished) {
      if (!S.replaying) return;
      S.replaying = false; cancelAnimationFrame(replayRaf); replayRaf = 0;
      if (lctx) lctx.clearRect(0, 0, W, H);
      const rec = recorder; recorder = null;
      if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) { /* ended already */ } }
      S.pane = null; redraw(); syncBar(); showBar();
      if (finished && !rec) flash(t('Replay'));
    }
    async function startReplay(record) {
      if (S.replaying || !S.strokes.length || !mctx) return;
      if (record && S.background === 'photo' && !S.photoImg) S.photoImg = await loadImage(photoUrl());          // the film needs the picture behind it
      if (S.replaying || S.destroyed) return;
      const list = S.strokes.slice();
      const cost = list.map((s) => (FREE.includes(s.t) ? Math.max(6, s.p.length / 2) : 14));
      const cum = []; let total = 0; for (const c of cost) { total += c; cum.push(total); }
      const dur = Math.min(24000, Math.max(3000, total * 14));
      S.replaying = true; S.pane = 'replay'; S.drawing = null;
      mctx.clearRect(0, 0, W, H); lctx.clearRect(0, 0, W, H);
      if (S.inkImg) mctx.drawImage(S.inkImg, 0, 0, W, H);
      let recC = null, rg = null, chunks = [], mime = '';
      const baseImg = S.background === 'photo' ? S.photoImg : null;
      if (record && window.MediaRecorder && HTMLCanvasElement.prototype.captureStream) {
        mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
        try {
          recC = document.createElement('canvas'); recC.width = W; recC.height = H; rg = recC.getContext('2d');
          recorder = new MediaRecorder(recC.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : {});
          recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
          recorder.onstop = () => {
            const type = (recorder && recorder.mimeType) || mime || 'video/webm';
            if (chunks.length) { download(new Blob(chunks, { type }), 'drawing-replay.' + (/mp4/.test(type) ? 'mp4' : 'webm')); flash(t('Saved')); }
          };
          recorder.start(200);
        } catch (e) { recorder = null; recC = null; }
      }
      const compose = () => { if (!rg) return; paintBase(rg, S.background, baseImg, W, H, 1); rg.drawImage(main, 0, 0); rg.drawImage(live, 0, 0); };
      syncBar(); showBar();
      let pos = 0, lastNow = performance.now();
      let done = 0, endAt = 0;
      const frame = (now) => {
        if (!S.replaying || S.destroyed) return;
        pos += Math.max(0, now - lastNow) * S.replaySpeed; lastNow = now;
        const units = Math.min(total, pos / dur * total);
        while (done < list.length && cum[done] <= units) { drawStroke(mctx, list[done], W, H); done++; lctx.clearRect(0, 0, W, H); }
        if (done < list.length) {
          const s = list[done];
          if (FREE.includes(s.t) && s.t !== 'eraser') {
            const frac = (units - (cum[done] - cost[done])) / cost[done], n = Math.max(1, Math.floor(frac * s.p.length / 2));
            lctx.clearRect(0, 0, W, H); drawStroke(lctx, { ...s, p: s.p.slice(0, n * 2) }, W, H);
          }
        }
        compose();
        if (done >= list.length) {
          if (!endAt) endAt = now;
          if (now - endAt > 700) return stopReplay(true);          // held a moment on the finished picture
        }
        replayRaf = requestAnimationFrame(frame);
      };
      replayRaf = requestAnimationFrame(frame);
    }

    async function saveBackground(next) {
      const r = await post('/api/boards/' + encodeURIComponent(board), { method: 'PUT', body: JSON.stringify({ background: next }) });
      if (r && r.version) S.version = Math.max(S.version, r.version);
      else if (r && r.error) flash(r.error);
    }
    async function chooseBackground(next) {
      setBackground(next); autoInk(true); syncBar(); showBar();
      await saveBackground(next);
    }
    // What is behind a see-through board: the first solid color found going up from the board (a theme that paints a picture gives nothing, and the pen is left alone).
    function backdropLum() {
      for (let el = root; el; el = el.parentElement) {
        const m = /rgba?[(]([0-9. ]+),([0-9. ]+),([0-9. ]+)(?:,([0-9. ]+))?[)]/.exec(getComputedStyle(el).backgroundColor || '');
        if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return lum(Number(m[1]), Number(m[2]), Number(m[3]));
      }
      return null;
    }
    function boardLum() {
      const c = bgRgba(S.background), hex = bgHex(S.background);
      if (S.background === 'clear' || (c && c[3] < 0.5)) return backdropLum();
      if (c) { const back = c[3] < 0.999 ? backdropLum() : null; const base = lum(c[0], c[1], c[2]); return back === null ? base : base * c[3] + back * (1 - c[3]); }
      if (hex) return lumHex(hex);
      return S.background === 'grid' ? 1 : null;                         // a picture: no way to know
    }
    // The pen that was never chosen (or is plainly lost on this background) turns light on a dark board and dark on a light one.
    function autoInk(userChange) {
      if (S.ro) return;
      const bl = boardLum(); if (bl === null) return;
      const pen = lumHex(S.color); if (pen === null) return;
      if (S.userColor && !(userChange && contrastOf(bl, pen) < 3)) return;
      const want = bl < 0.4 ? '#ffffff' : COLORS[0];
      if (S.color !== want && contrastOf(bl, pen) < 4.5) { S.color = want; if (S.tool === 'eraser') S.tool = 'pen'; }
    }
    async function act(a) {
      if (a === 'undo') { await undo();
      } else if (a === 'redo') { await redo();
      } else if (a === 'clear') { S.pane = 'clear'; syncBar(); showBar(); }
      else if (a === 'clear-no' || a === 'pane-close') { S.pane = null; syncBar(); showBar(); }
      else if (a === 'clear-yes') {
        S.pane = null;
        const r = await post('/api/boards/' + encodeURIComponent(board) + '/clear', { method: 'POST', body: '{}' });
        S.strokes = []; S.ops = []; S.redoOps = []; S.sel = null; S.ink = ''; S.inkImg = null; saveOps(); if (r && r.version) S.version = Math.max(S.version, r.version);
        redraw(); syncBar(); showBar();
      } else if (a === 'bg') {
        S.pane = 'bg'; syncBar(); showBar();
      } else if (a === 'photo') {
        S.pane = 'photo'; syncBar(); showBar();
        if (!thumbs) { try { const l = await api('/api/photos'); thumbs = Array.isArray(l) ? l.filter((p) => p && p.filename).slice(-10).reverse() : []; } catch (e) { thumbs = []; } syncBar(); }
      } else if (a === 'photo-none') {
        setBackground('white'); S.pane = null; syncBar();
        const r = await post('/api/boards/' + encodeURIComponent(board), { method: 'PUT', body: JSON.stringify({ background: 'white' }) });
        if (r && r.version) S.version = Math.max(S.version, r.version);
      } else if (a === 'sel-del') { deleteSelected();
      } else if (a === 'text-edit') {
        const i = S.sel; const st = i !== null ? S.strokes[i] : null;
        if (st && st.t === 'text') openTextInput([st.p[0], st.p[1]], i);
      } else if (a === 'colors') { S.pane = S.pane === 'color' ? null : 'color'; S.eyedrop = false; syncBar(); showBar();
      } else if (a === 'shapes') { S.pane = S.pane === 'shapes' ? null : 'shapes'; syncBar(); showBar();
      } else if (a === 'more') { S.pane = S.pane === 'more' ? null : 'more'; syncBar(); showBar();
      } else if (a === 'eyedrop') { S.eyedrop = !S.eyedrop; syncBar(); if (S.eyedrop) flash(t('Tap the board to pick that color.'));
      } else if (a === 'fillshape') { S.fillShape = !S.fillShape; syncBar(); showBar(); }
      else if (a === 'replay') startReplay(false);
      else if (a === 'replay-video') { stopReplay(false); await startReplay(true); }
      else if (a === 'replay-stop') stopReplay(false);
      else if (a === 'print') { S.pane = null; syncBar(); showBar(); printBoard(); }
      else if (a === 'keep') {
        if (!S.strokes.length) return;
        S.pane = null; syncBar(); showBar();
        pngOfBoard(async (blob) => {
          if (!blob) return flash(t('Could not keep it.'));
          let r = null;
          try { r = await fetch('/api/boards/' + encodeURIComponent(board) + '/keep?name=' + encodeURIComponent(opts.name || 'Whiteboard'), { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob }).then((x) => (x.ok ? x.json() : null)); } catch (e) { r = null; }
          flash(r ? t('Kept. It shows on the Kids\' Drawing widget.') : t('Could not keep it.'));
        });
      }
    }
    if (bar) {
      bar.addEventListener('click', async (e) => {
        if (e.target.closest('label.btn')) return;                              // the file chooser opens by itself
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        e.stopPropagation();
        if (b.dataset.tool) {
          S.tool = b.dataset.tool;
          S.pane = S.tool === 'stamp' ? 'stamps' : null;
          if (S.pane === 'stamps' && S.customStamps === null) { S.customStamps = []; api('/api/stamps').then((l) => { S.customStamps = Array.isArray(l) ? l : []; if (S.pane === 'stamps') syncBar(); }).catch(() => {}); }
          if (SHAPES.includes(S.tool)) S.shape = S.tool;
          if (S.tool !== 'select' && S.tool !== 'stamp' && S.tool !== 'text') S.sel = null;
          syncBar(); showBar();
        }
        else if (b.dataset.speed) { S.replaySpeed = Number(b.dataset.speed); syncBar(); }
        else if (b.dataset.stamp) { S.stamp = b.dataset.stamp; S.tool = 'stamp'; S.pane = null; syncBar(); showBar(); }
        else if (b.dataset.photo) {
          const fn = b.dataset.photo;
          setBackground('photo', fn); S.pane = null; syncBar();
          const r = await post('/api/boards/' + encodeURIComponent(board), { method: 'PUT', body: JSON.stringify({ background: 'photo', photo: fn }) });
          if (r && r.version) S.version = Math.max(S.version, r.version);
          else if (r && r.error) flash(r.error);
        }
        else if (b.dataset.bg) {
          const v = b.dataset.bg, keepSolid = bgSolid(S.background);
          await chooseBackground(BG_COLOR_RE.test(v) && keepSolid < 0.999 ? makeBg(bgHex(v), keepSolid) : v);          // a new color keeps the see-through amount that was set
        }
        else if (b.dataset.color) { S.userColor = true; S.color = b.dataset.color; if (S.tool === 'eraser') S.tool = 'pen'; applyColorToSelected(); syncBar(); if (S.pane === 'color' && pop) { hsv = hexToHsv(S.color); paintPop(); } showBar(); }
        else if (b.dataset.act) act(b.dataset.act);
      });
      // The size slider. While it moves only the little dot (and a stamp just placed) change; the bar is not redrawn, which would drop the slider from under the finger.
      bar.addEventListener('input', (e) => {
        if (e.target.dataset && (e.target.dataset.bgcolor || (e.target.classList && e.target.classList.contains('bgalpha')))) {          // live while it moves; saved when it is let go
          const picker = bar.querySelector('input[data-bgcolor]'), slider = bar.querySelector('input.bgalpha');
          const hex = e.target.dataset.bgcolor ? e.target.value : (bgHex(S.background) || (picker && picker.value) || '#22332c');
          const next = makeBg(hex, 1 - Number(slider ? slider.value : 0) / 100);
          setBackground(next); autoInk(true);
          return;
        }
        if (!e.target.classList || !e.target.classList.contains('size')) return;
        S.size = sizeAt(Number(e.target.value));
        const dot = bar.querySelector('.szdot'); if (dot) dot.style.cssText = dotStyle();
        const idx = selTarget();
        if (idx >= 0 && !S.drawing && !S.replaying) {                                                      // the selected stroke follows the slider
          const st = S.strokes[idx];
          if (!S.sizeBefore || S.sizeBefore.idx !== idx) S.sizeBefore = { idx, stroke: cloneStroke(st) };
          st.w = wFor(st, S.size); S.stampDirty = true; scheduleRedraw();
        }
        showBar();
      });
      bar.addEventListener('change', async (e) => {
        if (e.target.dataset && (e.target.dataset.bgcolor || (e.target.classList && e.target.classList.contains('bgalpha')))) { syncBar(); await saveBackground(S.background); return; }
        if (e.target.dataset && e.target.dataset.stampfile) { const f0 = e.target.files && e.target.files[0]; if (f0) await makeStamp(f0); return; }
        if (e.target.classList && e.target.classList.contains('size')) {
          if (!opts.prefs) { try { localStorage.setItem(SIZE_KEY, String(S.size)); } catch (x) { /* nothing remembered */ } }
          notePrefs();
          if (S.stampDirty) {                                                                           // let go: the resized stroke is saved (and can be undone)
            S.stampDirty = false;
            const bf = S.sizeBefore; S.sizeBefore = null;
            const cur = bf && S.strokes[bf.idx];
            if (cur && !sameStroke(cur, bf.stroke)) {
              const after = cloneStroke(cur);
              pushOp({ k: 'edit', idx: bf.idx, before: bf.stroke, after });
              callPut(bf.idx, after, bf.stroke);
              if (opts.onChange) opts.onChange();
            }
          }
          return;
        }
        const f = e.target && e.target.dataset && e.target.dataset.file ? e.target.files && e.target.files[0] : null;
        if (!f) return;
        const blob = await shrink(f);
        if (!blob) return flash(t('Could not load the picture.'));
        await setPhoto(blob);
      });
    }
    // A mouse and keyboard (no touchscreen): while the pointer is over the board, Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes, Delete removes what is selected,
    // Esc lets go of it, and P M E F T V pick the pen, marker, eraser, fill, text and select tools.
    let hover = false;
    box.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hover = true; });
    box.addEventListener('pointerleave', () => { hover = false; });
    const onKey = (e) => {
      if (!hover || S.destroyed || S.ro || S.replaying || S.drawing || isEditing() || e.altKey) return;
      const tg = e.target; if (tg && tg.closest && tg.closest('input, textarea, select, [contenteditable="true"]')) return;
      const k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      if ((k === 'delete' || k === 'backspace') && S.sel !== null) { e.preventDefault(); deleteSelected(); return; }
      if (k === 'escape') { if (S.pane) S.pane = null; else S.sel = null; syncBar(); redraw(); return; }
      const tool = { p: 'pen', m: 'marker', e: 'eraser', f: 'fill', t: 'text', v: 'select' }[k];
      if (tool && bar) { e.preventDefault(); S.pane = null; syncBar(); const b = bar.querySelector('[data-tool="' + tool + '"]'); if (b) b.click(); }
    };
    document.addEventListener('keydown', onKey);
    if (ur) ur.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; e.stopPropagation(); act(b.dataset.act); });
    box.addEventListener('pointerdown', () => { if (opts.toolbar === 'touch') showBar(); }, true);

    // ── start ───────────────────────────────────────────────────────────────────────────────────────
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (fit() && !S.replaying) redraw(); }) : null;
    if (ro) ro.observe(box);
    fit(); applyZoom(); syncBar(); showBar();
    load().then(() => { if (!S.strokes.length) { fit(); redraw(); } restoreOps(); });
    if (opts.prefs && !S.ro) { Promise.resolve().then(() => opts.prefs.load()).then(applyPrefs).catch(() => { prefsReady = true; }); }
    return {
      refresh: load,
      strokes: () => S.strokes.slice(),
      background: () => S.background,
      version: () => S.version,
      png: (cb) => pngOfBoard(cb),
      flush: () => new Promise((resolve) => { const t0 = Date.now(); const tick = () => ((S.saving === 0 && S.queued === 0) || Date.now() - t0 > 4000 ? resolve() : setTimeout(tick, 50)); tick(); }),     // every stroke is on the server
      setReadOnly(v) { S.ro = !!v; box.classList.toggle('ro', S.ro); },
      setCursor(v) { opts.cursor = !!v; box.classList.toggle('dw-cur', !!v); },
      setBorder(v) { opts.border = v; box.classList.toggle('dw-bordered', bordered()); },                       // the display's mouse pointer setting changed
      destroy() { S.destroyed = true; document.removeEventListener('keydown', onKey); clearTimeout(prefsTimer); imgWaiters.delete(onStampImage); clearTimeout(resTimer); S.replaying = false; clearTimeout(barTimer); clearTimeout(noteTimer); if (ro) ro.disconnect(); if (liveRaf) cancelAnimationFrame(liveRaf); if (replayRaf) cancelAnimationFrame(replayRaf); if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch (e) { /* ended */ } } },
    };
  }

  window.DrawUI = { FLATTEN_AT: 45000, mount, drawAll, drawStroke, toPng, BACKGROUNDS, COLORS, STAMPS, SIZE_MIN, SIZE_MAX };
})();
