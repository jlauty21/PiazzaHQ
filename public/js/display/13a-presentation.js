// Presentation mode on the display: shows a deck or a playlist (one flat list of page pictures, each with its own seconds, fit, background and effect)
// full screen over the layout, stepped by hand (tap the screen, swipe, arrow / page keys, a presentation clicker, or the remote in the app) or timed.
// The server keeps what a person started on a screen, so a restart goes back to it; the page it is on is reported after every change so the app's remote
// shows the right one. A screen can also have a SCHEDULE (hours when it shows a deck or playlist by itself): that is run here, on the display, using its
// own clock, and reported to the server so the remote can see and step it. A person's own start wins over the schedule until they stop it, and stopping a
// scheduled run keeps it off until that window is over. Loaded before 13-clock-tick.js, which calls presentationBoot() once the page is up and hands over
// the live commands. The automatic photo screensaver stays out of the way while a presentation is up.
// A recipe being cooked is shown the same way, as TEXT pages (type 'text') the server builds. This display draws it as one "cook board" instead: the ingredients on
// one side and the steps on the other (each scrolls by itself; on a narrow or upright screen one shows at a time, with buttons and a swipe to change), a text size
// control and a Close button that are always there, the step you are on lit, and the step timer (a small chip that keeps counting while you read the next step and
// beeps when it is done). A display that does not know the board draws the pages one by one.
(function initPresentation() {
  const NOT_PREVIEW = !(typeof IS_PREVIEW !== 'undefined' && IS_PREVIEW);
  const S = { src: null, pages: [], index: 0, mode: '', source: '', runKey: '', suppressKey: '', schedule: [], timer: null, layer: null, stage: null, current: null, controls: null, note: null,
    controlsTimer: null, noteTimer: null, token: 0, reportTimer: null, board: null, zoom: 0, view: 'both', checked: new Set() };
  const screenId = () => (typeof SCREEN_ID !== 'undefined' ? SCREEN_ID : '');
  const api = (path, opts) => fetch(path, opts).then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});

  window.presentationActive = () => !!S.src;
  if (!NOT_PREVIEW) { window.presentationBoot = window.presentationCommand = window.presentationDecksChanged = () => {}; return; }

  // ── the layer ───────────────────────────────────────────────────────────────────────────────────────
  function buildLayer() {
    const el = document.createElement('div');
    el.id = 'presentation';
    el.innerHTML = '<div class="pres-stage"></div><div class="pres-note"></div>'
      + '<div class="pres-controls"><button class="pres-prev" aria-label="Previous page">◀</button><button class="pres-play" aria-label="Play or pause"></button>'
      + '<button class="pres-next" aria-label="Next page">▶</button><button class="pres-rot" aria-label="Turn the page">⟳</button><span class="pres-count"></span><button class="pres-stop" aria-label="Stop the presentation">■</button></div>';
    // inside the rotating wrapper, so a screen turned 90, 180 or 270 degrees shows the pages the right way up (position:fixed is then relative to the wrapper)
    (document.getElementById('rotate-wrap') || document.body).appendChild(el);
    S.layer = el; S.stage = el.querySelector('.pres-stage'); S.controls = el.querySelector('.pres-controls'); S.note = el.querySelector('.pres-note');
    const stop = (e) => e.stopPropagation();
    S.controls.addEventListener('pointerdown', stop); S.controls.addEventListener('pointerup', stop);
    el.querySelector('.pres-prev').addEventListener('click', () => { step(-1); bumpControls(); });
    el.querySelector('.pres-next').addEventListener('click', () => { step(1); bumpControls(); });
    el.querySelector('.pres-play').addEventListener('click', () => { setMode(S.mode === 'auto' ? 'manual' : 'auto'); bumpControls(); });
    el.querySelector('.pres-rot').addEventListener('click', () => { turnPage(90); bumpControls(); });
    el.querySelector('.pres-stop').addEventListener('click', () => { stopPresentation(true); });
    wireTouch(el);
    return el;
  }

  // ── pages ───────────────────────────────────────────────────────────────────────────────────────────
  function makeSlide(page) {
    if (page.type === 'text') return { slide: makeTextSlide(page), img: null };
    const slide = document.createElement('div');
    slide.className = 'pres-slide';
    slide.dataset.fit = page.fit === 'cover' ? 'cover' : 'contain';
    slide.dataset.bg = page.background === 'white' ? 'white' : 'black';
    if (page.background === 'blur' && page.fit !== 'cover') {
      const b = document.createElement('img'); b.className = 'pres-blur'; b.alt = ''; b.draggable = false; b.src = page.url; slide.appendChild(b);
    }
    const img = document.createElement('img'); img.className = 'pres-main'; img.alt = ''; img.draggable = false; img.decoding = 'async'; img.src = page.url;
    slide.appendChild(img);
    return { slide, img };
  }

  // ── recipe pages: text the display draws itself ─────────────────────────────────────────────────────
  const tx = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const num = (n) => String(Math.round(Number(n) * 100) / 100);
  const clock = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const stopTap = (e) => e.stopPropagation();
  function makeTextSlide(page) {
    const slide = tx('div', 'pres-slide pres-text');
    slide.dataset.bg = 'black'; slide.dataset.kind = page.kind;
    const inner = tx('div', 'rt-inner'); slide.appendChild(inner);
    if (page.kind === 'cover') {
      if (page.photo) { const ph = tx('div', 'rt-photo'); const im = document.createElement('img'); im.alt = ''; im.draggable = false; im.src = page.photo; ph.appendChild(im); inner.appendChild(ph); }
      inner.appendChild(tx('h1', 'rt-title', page.title));
      const m = page.meta || {}, meta = tx('div', 'rt-meta');
      const add = (label, value, unit) => { const s = tx('span', 'rt-fact'); s.appendChild(tx('span', 'rt-label', t(label))); s.appendChild(document.createTextNode(' ' + value + (unit ? ' ' : ''))); if (unit) s.appendChild(tx('span', '', t(unit))); meta.appendChild(s); };
      if (m.servings) add('Serves', num(m.servings));
      if (m.prep_min) add('Prep', num(m.prep_min), 'min');
      if (m.cook_min) add('Cook', num(m.cook_min), 'min');
      inner.appendChild(meta);
      if (page.description) inner.appendChild(tx('div', 'rt-desc', page.description));
    } else if (page.kind === 'ingredients') {
      const head = tx('div', 'rt-head'); head.appendChild(tx('span', '', t('Ingredients')));
      if (page.parts > 1) head.appendChild(document.createTextNode(' ' + page.part + '/' + page.parts));
      inner.appendChild(head);
      const ul = tx('ul', 'rt-list');
      for (const l of page.lines || []) ul.appendChild(l.group ? tx('li', 'rt-group', l.group) : tx('li', '', l.text));
      inner.appendChild(ul);
    } else if (page.kind === 'step') {
      const head = tx('div', 'rt-head'); head.appendChild(tx('span', '', t('Step'))); head.appendChild(document.createTextNode(' ' + page.n + ' ')); head.appendChild(tx('span', '', t('of'))); head.appendChild(document.createTextNode(' ' + page.of));
      inner.appendChild(head);
      inner.appendChild(tx('div', 'rt-body', page.body));
      if (page.timer_sec > 0) {
        const b = tx('button', 'rt-timer'); b.type = 'button';
        b.appendChild(document.createTextNode('⏱ ')); b.appendChild(tx('span', '', t('Start timer'))); b.appendChild(document.createTextNode(' ' + clock(page.timer_sec)));
        b.addEventListener('pointerdown', stopTap); b.addEventListener('pointerup', stopTap);
        b.addEventListener('click', (e) => { e.stopPropagation(); startRecipeTimer(page.timer_sec, page.n); });
        inner.appendChild(b);
      }
    } else {
      inner.appendChild(tx('h1', 'rt-title', t('Enjoy!')));
      if (page.body) inner.appendChild(tx('div', 'rt-body rt-notes', page.body));
    }
    return slide;
  }

  // One step timer at a time: a chip in the corner that keeps counting while you move on to the next step, beeps when it reaches zero, and goes away when tapped.
  function beep() {
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      const ctx = S.audio || (S.audio = new C());
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.3; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.4);
    } catch { /* no sound here */ }
  }
  function clearRecipeTimer() {
    if (S.rt) { clearInterval(S.rt.iv); S.rt = null; }
    const chip = S.layer && S.layer.querySelector('.rt-chip'); if (chip) chip.remove();
  }
  function startRecipeTimer(sec, stepNo) {
    if (!S.layer) return;
    clearRecipeTimer();
    try { if (S.audio && S.audio.resume) S.audio.resume(); else { const C = window.AudioContext || window.webkitAudioContext; if (C) { S.audio = new C(); S.audio.resume(); } } } catch { /* ignore */ }   // a tap lets the browser play the beep later
    const chip = tx('button', 'rt-chip'); chip.type = 'button';
    const time = tx('span', 'rt-chip-time'), label = tx('span', 'rt-chip-label');
    chip.appendChild(tx('span', '', '⏱ ')); chip.appendChild(time); chip.appendChild(label);
    chip.addEventListener('pointerdown', stopTap); chip.addEventListener('pointerup', stopTap);
    chip.addEventListener('click', (e) => { e.stopPropagation(); clearRecipeTimer(); });
    S.layer.appendChild(chip);
    const rt = S.rt = { end: Date.now() + sec * 1000, beeps: 0, iv: null };
    const draw = () => {
      const left = Math.max(0, Math.round((rt.end - Date.now()) / 1000));
      if (left > 0) { time.textContent = clock(left); label.textContent = ' · ' + t('Step') + ' ' + stepNo; return; }
      time.textContent = t("Time's up!"); label.textContent = ''; chip.classList.add('done');
      if (rt.beeps < 8) { rt.beeps++; beep(); }
      if (rt.beeps >= 8) clearInterval(rt.iv);
    };
    rt.iv = setInterval(draw, 1000); draw();
  }

  // Turns a slide's picture by 0, 90, 180 or 270 degrees clockwise. A quarter turn swaps width and height, so the picture is laid out at the layer's turned
  // size (height by width), centred, and then rotated: whole page shown (contain) or filling the screen (cover), exactly as for an upright page.
  function applyTurn(slide, rot) {
    rot = ((Number(rot) || 0) % 360 + 360) % 360;
    slide.dataset.rot = String(rot);
    const W = slide.offsetWidth || (S.layer && S.layer.offsetWidth) || window.innerWidth, H = slide.offsetHeight || (S.layer && S.layer.offsetHeight) || window.innerHeight;
    slide.querySelectorAll('img').forEach((img) => {
      const blur = img.classList.contains('pres-blur'), extra = blur ? ' scale(1.15)' : '';
      if (rot === 90 || rot === 270) {
        img.style.right = 'auto'; img.style.bottom = 'auto';
        img.style.width = H + 'px'; img.style.height = W + 'px';
        img.style.left = ((W - H) / 2) + 'px'; img.style.top = ((H - W) / 2) + 'px';
        img.style.transform = 'rotate(' + rot + 'deg)' + extra;
      } else {
        img.style.right = ''; img.style.bottom = ''; img.style.width = ''; img.style.height = ''; img.style.left = ''; img.style.top = '';
        img.style.transform = (rot === 180 ? 'rotate(180deg)' : '') + (blur ? ' scale(1.15)' : '');
      }
    });
  }
  const ready = (img) => new Promise((resolve) => {
    if (img.complete && img.naturalWidth) return resolve();
    let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
    img.addEventListener('load', fin, { once: true }); img.addEventListener('error', fin, { once: true }); setTimeout(fin, 4000);
  });

  async function show(i, dir) {
    if (!S.src || !S.pages.length) return;
    i = Math.max(0, Math.min(S.pages.length - 1, i));
    const my = ++S.token;
    S.index = i;
    clearTimeout(S.timer);
    const page = S.pages[i];
    if (S.src.recipe) { showBoard(); return; }
    const { slide, img } = makeSlide(page);
    S.stage.appendChild(slide);
    if (img) applyTurn(slide, page.rotation);
    if (img) await ready(img);
    if (my !== S.token || !S.src) { slide.remove(); return; }            // a newer step has taken over
    const prev = S.current, tr = page.transition;
    S.current = slide;
    S.layer.dataset.bg = slide.dataset.bg;
    if (!prev || tr === 'none') {
      slide.style.opacity = 1; if (prev) prev.remove();
    } else if (tr === 'slide') {
      const d = dir < 0 ? -1 : 1;
      slide.style.transform = `translateX(${d * 100}%)`;
      slide.getBoundingClientRect();
      slide.style.transition = prev.style.transition = 'transform .45s ease';
      slide.style.transform = 'translateX(0)'; prev.style.transform = `translateX(${-d * 100}%)`;
      setTimeout(() => prev.remove(), 520);
    } else {
      slide.style.opacity = 0; slide.getBoundingClientRect();
      slide.style.transition = prev.style.transition = 'opacity .6s ease';
      slide.style.opacity = 1; prev.style.opacity = 0;
      setTimeout(() => prev.remove(), 680);
    }
    updateControls(); schedule(); report();
    for (const off of [1, -1]) { const p = S.pages[i + off] || (S.src.loop && S.pages[(i + off + S.pages.length) % S.pages.length]); if (p && p.url) { const pre = new Image(); pre.src = p.url; } }
  }

  function schedule() {
    clearTimeout(S.timer);
    if (S.mode !== 'auto' || !S.src || S.pages.length < 2) return;                 // one page: nothing to move on to
    const page = S.pages[S.index] || {};
    S.timer = setTimeout(() => step(1, true), Math.max(2, Number(page.seconds) || 10) * 1000);
  }

  function step(delta, fromTimer) {
    if (!S.src || !S.pages.length) return;
    if (S.src.recipe) { boardStep(delta); return; }
    let i = S.index + delta;
    if (i >= S.pages.length) {
      if (S.src.loop) i = 0;
      else { if (fromTimer) setMode('manual'); flashNote(t('The last page')); return; }
    }
    if (i < 0) { if (S.src.loop) i = S.pages.length - 1; else return; }
    if (i === S.index && S.current) return;                                         // the same page again: leave it as it is
    show(i, delta);
  }

  function setMode(mode) {
    if (!S.src) return;
    S.modeAt = Date.now();
    S.mode = mode === 'auto' ? 'auto' : 'manual';
    updateControls(); schedule(); report();
  }

  window.addEventListener('resize', () => { if (S.current) applyTurn(S.current, S.current.dataset.rot); if (S.board) layoutBoard(); });

  // ── the cook board: ingredients on one side, steps on the other ─────────────────────────────────────────────
  const ZOOMS = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.4];
  const stepTotal = () => S.pages.filter((p) => p.kind === 'step').length;
  const stepNoOf = (i) => { const p = S.pages[i]; if (!p) return 0; if (p.kind === 'step') return p.n; return p.kind === 'end' ? stepTotal() : 0; };
  const pageOfStep = (n) => S.pages.findIndex((p) => p.kind === 'step' && p.n === n);
  function savedZoom() { try { const z = Number(localStorage.getItem('rc_zoom_v1')); return ZOOMS.includes(z) ? z : 1; } catch { return 1; } }

  function buildBoard() {
    const r = S.src.recipe, b = tx('div', 'rc-board');
    if (!S.zoom) S.zoom = savedZoom();
    const head = tx('div', 'rc-head');
    head.appendChild(tx('div', 'rc-title', r.title));
    const m = r.meta || {}, meta = tx('div', 'rc-meta');
    const fact = (label, value, unit) => { const f = tx('span', 'rt-fact'); f.appendChild(tx('span', 'rt-label', t(label))); f.appendChild(document.createTextNode(' ' + value + (unit ? ' ' : ''))); if (unit) f.appendChild(tx('span', '', t(unit))); meta.appendChild(f); };
    if (m.servings) fact('Serves', num(m.servings));
    if (m.prep_min) fact('Prep', num(m.prep_min), 'min');
    if (m.cook_min) fact('Cook', num(m.cook_min), 'min');
    head.appendChild(meta);
    b.appendChild(head);

    const panes = tx('div', 'rc-panes');
    const ing = tx('section', 'rc-pane rc-ing'); ing.appendChild(tx('h2', 'rc-h', t('Ingredients')));
    const ul = tx('ul', 'rc-list');
    for (const l of r.ingredients || []) {
      if (l.group) { ul.appendChild(tx('li', 'rc-group', l.group)); continue; }
      const li = tx('li', 'rc-ingredient', l.text); li.dataset.key = l.text;
      if (S.checked.has(l.text)) li.classList.add('done');
      li.addEventListener('click', () => { const on = li.classList.toggle('done'); if (on) S.checked.add(l.text); else S.checked.delete(l.text); });
      ul.appendChild(li);
    }
    ing.appendChild(ul);
    const st = tx('section', 'rc-pane rc-steps'); st.appendChild(tx('h2', 'rc-h', t('Steps')));
    const ol = tx('ol', 'rc-list rc-steplist');
    for (const p of S.pages) {
      if (p.kind !== 'step') continue;
      const li = tx('li', 'rc-step'); li.dataset.n = String(p.n);
      li.appendChild(tx('span', 'rc-n', String(p.n)));
      const body = tx('div', 'rc-text'); body.appendChild(tx('div', '', p.body));
      if (p.timer_sec > 0) {
        const tb = tx('button', 'rc-timer'); tb.type = 'button';
        tb.appendChild(document.createTextNode('⏱ ')); tb.appendChild(tx('span', '', t('Start timer'))); tb.appendChild(document.createTextNode(' ' + clock(p.timer_sec)));
        tb.addEventListener('click', (e) => { e.stopPropagation(); startRecipeTimer(p.timer_sec, p.n); });
        body.appendChild(tb);
      }
      li.appendChild(body);
      li.addEventListener('click', () => { const i = pageOfStep(p.n); if (i >= 0 && i !== S.index) show(i, i > S.index ? 1 : -1); });
      ol.appendChild(li);
    }
    st.appendChild(ol);
    if (r.notes) { const nt = tx('div', 'rc-notes'); nt.appendChild(tx('div', 'rt-label', t('Notes'))); nt.appendChild(tx('div', '', r.notes)); st.appendChild(nt); }
    panes.appendChild(ing); panes.appendChild(st);
    b.appendChild(panes);

    const bar = tx('div', 'rc-bar');
    const btn = (cls, text, label) => { const x = tx('button', cls, text); x.type = 'button'; x.setAttribute('aria-label', label); x.title = label; return x; };
    const zg = tx('div', 'rc-grp');
    zg.appendChild(btn('rc-zout', 'A−', t('Smaller text'))); zg.appendChild(tx('span', 'rc-zval')); zg.appendChild(btn('rc-zin', 'A+', t('Larger text')));
    const sg = tx('div', 'rc-grp');
    sg.appendChild(btn('rc-prev', '◀', t('Previous step'))); sg.appendChild(tx('span', 'rc-pos')); sg.appendChild(btn('rc-next', '▶', t('Next step')));
    const vg = tx('div', 'rc-grp rc-views');
    for (const [v, label] of [['both', 'Both'], ['ing', 'Ingredients'], ['steps', 'Steps']]) { const vb = tx('button', 'rc-view', t(label)); vb.type = 'button'; vb.dataset.v = v; vg.appendChild(vb); }
    const close = tx('button', 'rc-close', '✕ ' + t('Close')); close.type = 'button';
    bar.appendChild(zg); bar.appendChild(sg); bar.appendChild(vg); bar.appendChild(close);
    b.appendChild(bar);

    zg.querySelector('.rc-zout').addEventListener('click', () => zoomBy(-1));
    zg.querySelector('.rc-zin').addEventListener('click', () => zoomBy(1));
    sg.querySelector('.rc-prev').addEventListener('click', () => step(-1));
    sg.querySelector('.rc-next').addEventListener('click', () => step(1));
    vg.querySelectorAll('.rc-view').forEach((vb) => vb.addEventListener('click', () => setView(vb.dataset.v)));
    close.addEventListener('click', () => stopPresentation(true));

    // this layer's own touch: nothing here turns the page, and a sideways swipe changes between ingredients and steps when only one shows
    let start = null;
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); start = localPoint(b, e); });
    b.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      if (!start) return;
      const p = localPoint(b, e), dx = p.x - start.x, dy = p.y - start.y; start = null;
      if (b.dataset.view !== 'both' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && !(e.target.closest && e.target.closest('.rc-bar'))) setView(b.dataset.view === 'ing' ? 'steps' : 'ing');
    });
    b.addEventListener('pointercancel', () => { start = null; });
    S.stage.appendChild(b);
    S.board = b;
    return b;
  }

  // wide screens show both; a narrow or upright one shows one at a time (ingredients first, steps once you are cooking)
  function layoutBoard() {
    const b = S.board; if (!b) return;
    const W = (S.layer && S.layer.offsetWidth) || window.innerWidth, H = (S.layer && S.layer.offsetHeight) || window.innerHeight;
    const wide = W >= H * 1.1 && W >= 640;
    b.dataset.layout = wide ? 'wide' : 'narrow';
    let v = S.view;
    if (!wide && v === 'both') v = stepNoOf(S.index) > 0 ? 'steps' : 'ing';
    setViewAttr(v);
    b.style.setProperty('--rc-z', String(S.zoom));
    b.querySelector('.rc-zval').textContent = Math.round(S.zoom * 100) + '%';
  }
  function setViewAttr(v) {
    const b = S.board; if (!b) return;
    const keep = {}; b.querySelectorAll('.rc-pane').forEach((p) => { keep[p.classList.contains('rc-ing') ? 'ing' : 'steps'] = p.scrollTop; });
    b.dataset.view = v;
    b.querySelectorAll('.rc-view').forEach((vb) => vb.classList.toggle('on', vb.dataset.v === v));
    b.querySelectorAll('.rc-pane').forEach((p) => { p.scrollTop = keep[p.classList.contains('rc-ing') ? 'ing' : 'steps'] || 0; });
  }
  function setView(v) { S.view = v; layoutBoard(); markCurrent(); }
  function zoomBy(dir) {
    let i = ZOOMS.indexOf(S.zoom); if (i < 0) i = ZOOMS.indexOf(1);
    S.zoom = dir === 0 ? 1 : ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
    try { localStorage.setItem('rc_zoom_v1', String(S.zoom)); } catch { /* not kept */ }
    layoutBoard(); markCurrent();
  }
  // light the step you are on, dim the ones done, and bring it into view in the steps list
  function markCurrent() {
    const b = S.board; if (!b) return;
    const n = stepNoOf(S.index), total = stepTotal();
    let cur = null;
    b.querySelectorAll('.rc-step').forEach((li) => { const k = Number(li.dataset.n); li.classList.toggle('cur', k === n); li.classList.toggle('past', k < n); if (k === n) cur = li; });
    b.querySelector('.rc-pos').textContent = n > 0 ? t('Step') + ' ' + n + ' ' + t('of') + ' ' + total : t('Ingredients');
    const pane = b.querySelector('.rc-steps');
    if (cur && pane.offsetParent) {
      const to = Math.max(0, cur.offsetTop - pane.clientHeight * 0.25);
      try { pane.scrollTo({ top: to, behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } catch { pane.scrollTop = to; }
    }
  }
  function showBoard() {
    if (!S.board || !S.board.isConnected) { S.stage.innerHTML = ''; S.current = null; buildBoard(); }
    S.layer.dataset.bg = 'black';
    layoutBoard(); markCurrent(); updateControls(); report();
  }
  function boardStep(delta) {
    const total = stepTotal(); if (!total) return;
    const c = stepNoOf(S.index), n = c + delta;
    if (n > total) { flashNote(t('The last page')); return; }
    if (n < 1) { if (c >= 1 && S.index !== 0) show(0, -1); return; }       // back from step 1 to "no step yet"
    const i = pageOfStep(n); if (i >= 0) show(i, delta);
  }

  // ── controls, touch and keys ─────────────────────────────────────────────────────────────────────────
  const t = (s) => (window.i18n && typeof i18n.t === 'function' ? i18n.t(s) : s);
  function updateControls() {
    if (!S.controls) return;
    S.controls.querySelector('.pres-play').textContent = S.mode === 'auto' ? '❚❚' : '▶▶';
    S.controls.querySelector('.pres-play').title = S.mode === 'auto' ? t('Pause') : t('Play');
    S.controls.querySelector('.pres-count').textContent = `${S.index + 1} / ${S.pages.length}`;
  }
  function bumpControls() {
    if (!S.controls) return;
    S.controls.classList.add('shown'); updateControls();
    clearTimeout(S.controlsTimer);
    S.controlsTimer = setTimeout(() => S.controls && S.controls.classList.remove('shown'), 4500);
  }
  function flashNote(text) {
    if (!S.note) return;
    S.note.textContent = text; S.note.classList.add('shown');
    clearTimeout(S.noteTimer); S.noteTimer = setTimeout(() => S.note && S.note.classList.remove('shown'), 1800);
  }
  // Where a touch is on the page itself: the screen can be turned (90, 180, 270 degrees) with the layer inside the turned wrapper, but pointer positions
  // are in physical screen coordinates, so they are turned back to the layer's own left-to-right, top-to-bottom.
  function localPoint(el, e) {
    const r = Number(typeof browserRotation === 'function' ? browserRotation() : (displayConfig && displayConfig.rotation)) || 0, b = el.getBoundingClientRect();
    if (r === 90) return { x: e.clientY - b.top, y: b.right - e.clientX };
    if (r === 180) return { x: b.right - e.clientX, y: b.bottom - e.clientY };
    if (r === 270) return { x: b.bottom - e.clientY, y: e.clientX - b.left };
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }
  function wireTouch(el) {
    let start = { x: 0, y: 0 }, st = 0;
    el.addEventListener('pointerdown', (e) => { start = localPoint(el, e); st = Date.now(); });
    el.addEventListener('pointerup', (e) => {
      if (!S.src || S.src.touch === false) return;
      const p = localPoint(el, e), dx = p.x - start.x, dy = p.y - start.y, w = el.offsetWidth || window.innerWidth;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { step(dx < 0 ? 1 : -1); return; }       // a swipe
      if (Math.abs(dx) > 14 || Math.abs(dy) > 14 || Date.now() - st > 900) return;                          // a drag or a long press is not a tap
      if (p.x < w * 0.3) step(-1); else if (p.x > w * 0.7) step(1);
      else if (e.pointerType !== 'mouse' && S.controls.classList.contains('shown')) S.controls.classList.remove('shown');   // a finger toggles the controls; a mouse click always shows them
      else bumpControls();
    });
    // a mouse (a laptop or a PC) shows the controls when it moves
    const hasMouse = () => window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    el.addEventListener('mousemove', () => { if (S.src && S.src.touch !== false && hasMouse()) bumpControls(); });
  }

  window.addEventListener('keydown', (e) => {
    if (!S.src) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    const k = e.key; let handled = true;
    if (S.src.recipe && S.board) {
      if (ae && ae.tagName === 'BUTTON' && (k === 'Enter' || k === ' ')) return;                 // a focused button is pressed, not "next step"
      const pane = (c) => S.board.querySelector(c);
      if (k === '+' || k === '=') zoomBy(1);
      else if (k === '-' || k === '_') zoomBy(-1);
      else if (k === '0') zoomBy(0);
      else if (k === 'v' || k === 'V') { const order = S.board.dataset.layout === 'wide' ? ['both', 'ing', 'steps'] : ['ing', 'steps']; setView(order[(order.indexOf(S.board.dataset.view) + 1) % order.length]); }
      else if (k === '[' || k === ']') { const p = pane('.rc-ing'); if (p) p.scrollBy({ top: (k === ']' ? 1 : -1) * p.clientHeight * 0.8, behavior: 'smooth' }); }
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); return; }
      handled = true;
    }
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'ArrowDown') step(1);
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') step(-1);
    else if (k === 'Home') show(0, -1);
    else if (k === 'End') show(S.pages.length - 1, 1);
    else if (k === 'p' || k === 'P') setMode(S.mode === 'auto' ? 'manual' : 'auto');
    else if (k === 'r' || k === 'R') turnPage(e.shiftKey ? -90 : 90);
    else if (k === 'Escape') { if (S.controls.classList.contains('shown')) S.controls.classList.remove('shown'); else bumpControls(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); if (k !== 'Escape' && S.controls && S.controls.classList.contains('shown')) bumpControls(); }
  }, true);

  // Turn the page that is up: at once here, and the server saves it on the page (so it stays, and every screen showing the same presentation agrees).
  function turnPage(by) {
    if (!S.src || !S.current) return;
    const page = S.pages[S.index]; if (!page || page.type === 'text') return;          // a recipe page is text: it has no picture to turn
    const to = (((Number(page.rotation) || 0) + by) % 360 + 360) % 360;
    page.rotation = to; applyTurn(S.current, to);
    if (screenId()) post('/api/screens/' + encodeURIComponent(screenId()) + '/presentation', { action: 'rotate', by });
  }

  // ── starting, stopping, telling the server ───────────────────────────────────────────────────────────
  function report() {
    clearTimeout(S.reportTimer);
    S.reportTimer = setTimeout(() => {
      if (!S.src || !screenId()) return;
      post(`/api/screens/${encodeURIComponent(screenId())}/presentation-report`, { index: S.index, mode: S.mode, kind: S.src.kind, ref: S.src.id, name: S.src.name, count: S.pages.length, source: S.source });
    }, 150);
  }

  async function startPresentation({ kind, id, deck_id, mode, index, source, servings }) {
    if (!kind) { kind = 'deck'; id = id || deck_id; }
    let src;
    try { src = await api(`/api/present/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${kind === 'recipe' && servings ? '?servings=' + encodeURIComponent(servings) : ''}`); } catch { return; }
    if (!src || !src.pages || !src.pages.length) return;
    const same = S.src && S.src.kind === src.kind && S.src.id === src.id && (src.kind !== 'recipe' || S.src.servings === src.servings);
    const wanted = Math.max(0, Math.min(src.pages.length - 1, Number(index) || 0));
    S.src = src; S.pages = src.pages; S.source = source === 'schedule' ? 'schedule' : 'manual';
    if (!S.layer) buildLayer();
    S.layer.hidden = false;
    S.layer.classList.toggle('cooking', !!src.recipe);
    document.body.classList.add('presenting');
    if (!same) { S.stage.innerHTML = ''; S.current = null; S.board = null; S.checked = new Set(); }
    S.mode = mode === 'manual' ? 'manual' : mode === 'auto' ? 'auto' : (src.timed ? 'auto' : 'manual');
    if (window.autoScreensaverTick) window.autoScreensaverTick();
    if (same && S.current && S.index === wanted) { updateControls(); schedule(); report(); return; }
    await show(wanted, 1);
  }

  // A person (or the remote) ending it keeps the schedule from restarting it until the current window is over.
  function stopPresentation(tellServer) {
    const w = scheduledTarget();
    if (S.src && w) S.suppressKey = w.key;
    clearTimeout(S.timer); clearTimeout(S.reportTimer); clearTimeout(S.controlsTimer);
    S.token++;
    const wasActive = !!S.src, was = S.source;
    S.src = null; S.pages = []; S.mode = ''; S.current = null; S.source = ''; S.runKey = ''; S.board = null; S.checked = new Set();
    clearRecipeTimer();
    if (S.layer) { S.layer.hidden = true; S.layer.classList.remove('cooking'); if (S.stage) S.stage.innerHTML = ''; }
    document.body.classList.remove('presenting');
    if (tellServer && wasActive && screenId()) {
      post(`/api/screens/${encodeURIComponent(screenId())}/presentation`, { action: 'stop' });
      if (was === 'schedule') post(`/api/screens/${encodeURIComponent(screenId())}/presentation-report/end`, {});
    }
    if (window.autoScreensaverTick) window.autoScreensaverTick();
  }

  // The commands the server sends this screen (from the app's remote, a Favorites card, or this screen's own stop button).
  window.presentationCommand = function (data) {
    const a = data && data.action;
    if (a === 'start') startPresentation(data);
    else if (a === 'stop') stopPresentation(false);
    else if (a === 'refresh') syncWithServer();
    else if (!S.src) return;
    else if (a === 'next') { step(1); bumpControls(); }
    else if (a === 'prev') { step(-1); bumpControls(); }
    else if (a === 'goto') show(Number(data.index) || 0, Number(data.index) >= S.index ? 1 : -1);
    else if (a === 'play') setMode('auto');
    else if (a === 'pause') setMode('manual');
    else if (a === 'rotate') {
      const i = Number(data.index);
      if (S.pages[i] && S.pages[i].type !== 'text') { S.pages[i].rotation = Number(data.rotation) || 0; if (i === S.index && S.current) applyTurn(S.current, S.pages[i].rotation); }
    }
  };

  // The deck or playlist being shown was edited (pages added, reordered, settings changed) or deleted, or a photo it uses changed.
  window.presentationDecksChanged = async function () {
    if (!S.src) return;
    try {
      const was = S.pages[S.index];
      const src = await api(`/api/present/${encodeURIComponent(S.src.kind)}/${encodeURIComponent(S.src.id)}${S.src.kind === 'recipe' && S.src.servings ? '?servings=' + encodeURIComponent(S.src.servings) : ''}`);
      if (!src.pages.length) { stopPresentation(false); return; }
      const recipeEdited = !!(S.src.recipe && S.board && JSON.stringify([S.src.recipe, S.src.pages]) !== JSON.stringify([src.recipe, src.pages]));
      S.src = src; S.pages = src.pages;
      if (S.index >= S.pages.length) S.index = S.pages.length - 1;
      if (recipeEdited) { S.board = null; showBoard(); return; }          // the recipe was edited: draw the board again
      const cur = S.pages[S.index];
      if (cur && cur.type === 'text' && JSON.stringify(cur) !== JSON.stringify(was)) { show(S.index, 1); return; }          // the recipe was edited: draw the page again
      if (S.current && cur && String((Number(cur.rotation) || 0)) !== String(S.current.dataset.rot || 0)) applyTurn(S.current, cur.rotation);
      updateControls(); schedule();
    } catch (e) { if (/404/.test(String(e.message))) stopPresentation(false); }
  };

  // ── the schedule ────────────────────────────────────────────────────────────────────────────────────
  const hm = (x) => { const m = /^(\d\d):(\d\d)$/.exec(String(x)); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  function ruleActive(r, d) {
    const a = hm(r.start), b = hm(r.end);
    if (a === null || b === null || a === b) return false;
    const day = d.getDay(), mins = d.getHours() * 60 + d.getMinutes();
    const days = Array.isArray(r.days) && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
    if (a < b) return days.includes(day) && mins >= a && mins < b;
    return (days.includes(day) && mins >= a) || (days.includes((day + 6) % 7) && mins < b);      // past midnight: the morning part belongs to the day before
  }
  function scheduledTarget(d) {
    d = d || new Date();
    for (const r of S.schedule) if (ruleActive(r, d)) return { kind: r.kind, id: r.id, servings: r.servings, key: `${r.kind}:${r.id}:${r.start}-${r.end}` };
    return null;
  }
  function tickSchedule() {
    if (typeof editModeActive !== 'undefined' && editModeActive) return;
    const tg = scheduledTarget();
    if (!tg) {
      S.suppressKey = '';
      if (S.src && S.source === 'schedule') { stopPresentation(false); if (screenId()) post(`/api/screens/${encodeURIComponent(screenId())}/presentation-report/end`, {}); }
      return;
    }
    if (S.src && S.source === 'manual') return;                                   // a person's own start wins
    if (S.suppressKey === tg.key) return;                                          // they stopped this window's show
    if (S.src && S.source === 'schedule' && S.runKey === tg.key) return;          // already running it
    S.runKey = tg.key;
    startPresentation({ kind: tg.kind, id: tg.id, servings: tg.servings, source: 'schedule' }).then(() => { if (S.src && S.source === 'schedule') S.runKey = tg.key; });
  }

  // After a page load, a reconnect, a schedule change and every 5 s: do what the server says this screen should be doing (a command can be missed while
  // offline), and re-read the schedule.
  async function syncWithServer() {
    if (!screenId()) return;
    let st; try { st = await api(`/api/screens/${encodeURIComponent(screenId())}/presentation`); } catch { return; }
    S.schedule = Array.isArray(st.schedule) ? st.schedule : [];
    const kind = st.kind || (st.deck_id ? 'deck' : null), id = st.ref_id || st.deck_id || null;
    if (kind && id) {
      if (!S.src || S.source !== 'manual' || S.src.kind !== kind || S.src.id !== id || (kind === 'recipe' && st.servings && S.src.servings !== st.servings)) startPresentation({ kind, id, mode: st.mode, index: st.index, source: 'manual', servings: st.servings });
      else if (st.mode && st.mode !== S.mode && Date.now() - (S.modeAt || 0) > 8000) { S.mode = st.mode; updateControls(); schedule(); }   // not for a few seconds after a change made here: the server has not heard of it yet
    } else if (S.src && S.source === 'manual') stopPresentation(false);
    tickSchedule();
  }
  window.presentationBoot = function () { syncWithServer(); setInterval(syncWithServer, 5000); setInterval(tickSchedule, 15000); };
})();
