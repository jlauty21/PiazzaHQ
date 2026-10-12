// Presentation mode on the display: shows a deck or a playlist (one flat list of page pictures, each with its own seconds, fit, background and effect)
// full screen over the layout, stepped by hand (tap the screen, swipe, arrow / page keys, a presentation clicker, or the remote in the app) or timed.
// The server keeps what a person started on a screen, so a restart goes back to it; the page it is on is reported after every change so the app's remote
// shows the right one. A screen can also have a SCHEDULE (hours when it shows a deck or playlist by itself): that is run here, on the display, using its
// own clock, and reported to the server so the remote can see and step it. A person's own start wins over the schedule until they stop it, and stopping a
// scheduled run keeps it off until that window is over. Loaded before 13-clock-tick.js, which calls presentationBoot() once the page is up and hands over
// the live commands. The automatic photo screensaver stays out of the way while a presentation is up.
(function initPresentation() {
  const NOT_PREVIEW = !(typeof IS_PREVIEW !== 'undefined' && IS_PREVIEW);
  const S = { src: null, pages: [], index: 0, mode: '', source: '', runKey: '', suppressKey: '', schedule: [], timer: null, layer: null, stage: null, current: null, controls: null, note: null,
    controlsTimer: null, noteTimer: null, token: 0, reportTimer: null };
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
    const { slide, img } = makeSlide(page);
    S.stage.appendChild(slide);
    applyTurn(slide, page.rotation);
    await ready(img);
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
    for (const off of [1, -1]) { const p = S.pages[i + off] || (S.src.loop && S.pages[(i + off + S.pages.length) % S.pages.length]); if (p) { const pre = new Image(); pre.src = p.url; } }
  }

  function schedule() {
    clearTimeout(S.timer);
    if (S.mode !== 'auto' || !S.src || S.pages.length < 2) return;                 // one page: nothing to move on to
    const page = S.pages[S.index] || {};
    S.timer = setTimeout(() => step(1, true), Math.max(2, Number(page.seconds) || 10) * 1000);
  }

  function step(delta, fromTimer) {
    if (!S.src || !S.pages.length) return;
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

  window.addEventListener('resize', () => { if (S.current) applyTurn(S.current, S.current.dataset.rot); });

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
    const r = Number(displayConfig && displayConfig.rotation) || 0, b = el.getBoundingClientRect();
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
    const page = S.pages[S.index]; if (!page) return;
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

  async function startPresentation({ kind, id, deck_id, mode, index, source }) {
    if (!kind) { kind = 'deck'; id = id || deck_id; }
    let src;
    try { src = await api(`/api/present/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`); } catch { return; }
    if (!src || !src.pages || !src.pages.length) return;
    const same = S.src && S.src.kind === src.kind && S.src.id === src.id;
    const wanted = Math.max(0, Math.min(src.pages.length - 1, Number(index) || 0));
    S.src = src; S.pages = src.pages; S.source = source === 'schedule' ? 'schedule' : 'manual';
    if (!S.layer) buildLayer();
    S.layer.hidden = false;
    document.body.classList.add('presenting');
    if (!same) { S.stage.innerHTML = ''; S.current = null; }
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
    S.src = null; S.pages = []; S.mode = ''; S.current = null; S.source = ''; S.runKey = '';
    if (S.layer) { S.layer.hidden = true; if (S.stage) S.stage.innerHTML = ''; }
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
      if (S.pages[i]) { S.pages[i].rotation = Number(data.rotation) || 0; if (i === S.index && S.current) applyTurn(S.current, S.pages[i].rotation); }
    }
  };

  // The deck or playlist being shown was edited (pages added, reordered, settings changed) or deleted, or a photo it uses changed.
  window.presentationDecksChanged = async function () {
    if (!S.src) return;
    try {
      const src = await api(`/api/present/${encodeURIComponent(S.src.kind)}/${encodeURIComponent(S.src.id)}`);
      if (!src.pages.length) { stopPresentation(false); return; }
      S.src = src; S.pages = src.pages;
      if (S.index >= S.pages.length) S.index = S.pages.length - 1;
      const cur = S.pages[S.index];
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
    for (const r of S.schedule) if (ruleActive(r, d)) return { kind: r.kind, id: r.id, key: `${r.kind}:${r.id}:${r.start}-${r.end}` };
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
    startPresentation({ kind: tg.kind, id: tg.id, source: 'schedule' }).then(() => { if (S.src && S.source === 'schedule') S.runKey = tg.key; });
  }

  // After a page load, a reconnect, a schedule change and every 5 s: do what the server says this screen should be doing (a command can be missed while
  // offline), and re-read the schedule.
  async function syncWithServer() {
    if (!screenId()) return;
    let st; try { st = await api(`/api/screens/${encodeURIComponent(screenId())}/presentation`); } catch { return; }
    S.schedule = Array.isArray(st.schedule) ? st.schedule : [];
    const kind = st.kind || (st.deck_id ? 'deck' : null), id = st.ref_id || st.deck_id || null;
    if (kind && id) {
      if (!S.src || S.source !== 'manual' || S.src.kind !== kind || S.src.id !== id) startPresentation({ kind, id, mode: st.mode, index: st.index, source: 'manual' });
      else if (st.mode && st.mode !== S.mode && Date.now() - (S.modeAt || 0) > 8000) { S.mode = st.mode; updateControls(); schedule(); }   // not for a few seconds after a change made here: the server has not heard of it yet
    } else if (S.src && S.source === 'manual') stopPresentation(false);
    tickSchedule();
  }
  window.presentationBoot = function () { syncWithServer(); setInterval(syncWithServer, 5000); setInterval(tickSchedule, 15000); };
})();
