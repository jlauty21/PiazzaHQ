// ── the render/animation loop for one widget ──
function fmStartInstance(el, w) {
  const id = w.id;
  const old = _fmInst.get(id);
  if (old && old.raf) cancelAnimationFrame(old.raf);
  const baseC = el.querySelector('.fm-base'), airC = el.querySelector('.fm-air');
  const badge = el.querySelector('.fm-badge'), dataEl = el.querySelector('.fm-data'), emptyEl = el.querySelector('.fm-empty');
  if (!baseC || !airC) return;
  const inst = {
    id, el, baseC, airC, badge, dataEl, emptyEl, w,
    view: null, baseDirty: true, raf: 0, selectedHex: (old && old.selectedHex) || null,
    lastTarget: old && old.lastTarget || null, lastW: 0, lastH: 0,
  };
  _fmInst.set(id, inst);

  // Resolve theme colours to concrete rgb()/rgba() strings the 2D canvas can
  // always parse. Read the vars from the widget element itself (not <html>) —
  // themes are set on body[data-theme], which document.documentElement does
  // NOT inherit, so reading from <html> gave the wrong (default-dark) palette
  // on light themes like corkboard and the map drew light-on-light = blank.
  const _fmProbe = document.createElement('span');
  _fmProbe.style.cssText = 'position:absolute;left:-9999px;width:0;height:0';
  const resolveColor = (expr) => {
    try {
      _fmProbe.style.color = '';
      _fmProbe.style.color = expr;
      el.appendChild(_fmProbe);
      const c = getComputedStyle(_fmProbe).color;
      _fmProbe.remove();
      return c && c !== '' ? c : expr;
    } catch { return expr; }
  };
  const themeCol = () => {
    const cs = getComputedStyle(el);
    const g = (v, f) => (cs.getPropertyValue(v) || '').trim() || f;
    const text = g('--text', '#1a1a1a'), accent = g('--accent', '#4A90D9');
    const accent2 = g('--accent2', '') || accent;
    const mix = (c, pct) => resolveColor(`color-mix(in srgb, ${c} ${pct}%, transparent)`);
    return {
      text, accent, accent2,
      ocean: mix(text, 7),   // full-canvas water wash
      land: mix(text, 26),   // land fill — solid enough to read on a paper/light theme
      coast: mix(text, 46),  // coastlines + country borders
      stateLn: mix(text, 22), // internal state / province lines — subtler
      trail: mix(accent, 55),
      tagBg: mix(text, 15),  // per-aircraft info block backdrop (drawn twice)
      altLo: resolveColor(accent2), altHi: resolveColor(accent),
    };
  };

  function sizeCanvases() {
    const r = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    if (W === inst.lastW && H === inst.lastH) return { W, H, dpr, changed: false };
    for (const c of [baseC, airC]) { c.width = W * dpr; c.height = H * dpr; }
    inst.lastW = W; inst.lastH = H; inst.baseDirty = true;
    return { W, H, dpr, changed: true };
  }

  function drawBase(W, H, dpr, col) {
    const ctx = baseC.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // a water wash across the whole panel so the map reads as its own surface
    // regardless of what the theme puts behind the widget (a paper card on
    // corkboard, a dark panel on dark themes, etc.)
    ctx.fillStyle = col.ocean;
    ctx.fillRect(0, 0, W, H);
    if (!_fmBasemap.land) return;
    const v = inst.view;
    // Build the basemap in SCREEN space for THIS view (cached until the view
    // moves). Doing it here rather than as one pre-projected path + ctx.scale()
    // is what fixes both the smear across the map and the totally blank map
    // when zoomed in — see _fmRingsPath().
    const bk = Math.round(v.centerLat * 40) + ',' + Math.round(v.centerLon * 40) + ',' + Math.round(v.zoom * 20) + ',' + W + 'x' + H;
    if (!inst._basePaths || inst._basePaths.key !== bk) {
      inst._basePaths = {
        key: bk,
        land: _fmRingsPath(_fmBasemap.land, v, W, H),
        border: _fmStrokeRingsPath(_fmBasemap.border, v, W, H),
        stateLines: _fmBasemap.stateLines ? _fmStrokeRingsPath(_fmBasemap.stateLines, v, W, H) : null,
      };
    }
    const bp = inst._basePaths;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.fillStyle = col.land;
    ctx.fill(bp.land, 'evenodd');
    if (bp.stateLines && inst.w.fmStates !== false) {
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = col.stateLn;
      ctx.stroke(bp.stateLines);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = col.coast;
    ctx.stroke(bp.border);
    ctx.restore();
    // search-radius ring for radius / airline filters, in screen space
    const ff = inst.w.fmFilter || {};
    if (ff.radiusNm && ff.lat != null && ff.lon != null) {
      const c = fmProject(+ff.lat, +ff.lon, v, W, H);
      const rLat = (+ff.radiusNm) / 60;
      const rx = (rLat / Math.max(0.2, Math.cos(+ff.lat * FM_DEG))) * v.zoom;
      const ry = (fmMercY(+ff.lat + rLat) - fmMercY(+ff.lat)) * v.zoom;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = col.stateLn;
      ctx.stroke();
      ctx.restore();
    }
  }

  // parse "rgb(a)(...)" to [r,g,b,a]; anything else -> null
  function _rgba(s) {
    const m = /rgba?\(([^)]+)\)/i.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] == null ? 1 : p[3]];
  }
  function altColor(altFt, col) {
    const t = Math.max(0, Math.min(1, (altFt || 0) / 40000));
    const lo = _rgba(col.altLo), hi = _rgba(col.altHi);
    if (!lo || !hi) return col.accent;
    const c = i => Math.round(lo[i] + (hi[i] - lo[i]) * t);
    return `rgb(${c(0)}, ${c(1)}, ${c(2)})`;
  }
  function drawTrail(ctx, seed, live, view, W, H, col) {
    if (!seed || seed.length < 2) { if (!seed) return; }
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    const pts = (seed || []).slice();
    let started = false;
    for (const s of pts) { const q = fmProject(s[1], s[2], view, W, H); if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y); }
    if (live) { const q = fmProject(live.lat, live.lon, view, W, H); if (!started) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
    ctx.strokeStyle = col.trail;
    ctx.stroke();
  }
  function drawPlane(ctx, x, y, trackDeg, fill, selected) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((trackDeg || 0)) * FM_DEG);
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (selected) { ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    ctx.restore();
  }
  // Build a tag's content + measured size (no drawing). `full` adds route +
  // altitude/speed/climb lines; otherwise it's just ident + ICAO type.
  function buildTag(ctx, a, fontPx, bold, full) {
    const ident = a.callsign || a.reg || (a.hex || '').toUpperCase();
    if (!ident) return null;
    const f1 = fontPx, f2 = Math.max(9, fontPx - 2);
    const lines = [{ t: ident + (a.type ? '   ' + a.type : ''), big: true }];
    if (full) {
      if (a.route && (a.route.from || a.route.to)) {
        const ap = x => x ? (x.iata || x.icao || x.city || '?') : '?';
        lines.push({ t: ap(a.route.from) + ' → ' + ap(a.route.to), accent: true });
      }
      const parts = [];
      if (a.onGround) parts.push('on ground');
      else {
        if (a.altFt != null) parts.push('FL' + Math.round(a.altFt / 100));
        if (a.gsKts != null) parts.push(Math.round(a.gsKts) + ' kt');
        const vr = a.vertRateFpm;
        if (vr > 150) parts.push('↑'); else if (vr < -150) parts.push('↓');
      }
      if (parts.length) lines.push({ t: parts.join('  ') });
    }
    const padX = 6, padY = 4, lh = f2 + 4;
    let wMax = 0;
    for (const ln of lines) {
      ctx.font = `${ln.big ? (bold ? '700 ' : '600 ') : ''}${ln.big ? f1 : f2}px Inter, system-ui, sans-serif`;
      wMax = Math.max(wMax, ctx.measureText(ln.t).width);
    }
    return {
      lines, bold, f1, f2, lh, padX, padY,
      boxW: Math.ceil(wMax) + padX * 2,
      boxH: padY * 2 + f1 + (lines.length - 1) * lh,
    };
  }
  function paintTag(ctx, bx, by, px, py, tag, col) {
    const { boxW, boxH, lines, bold, f1, f2, lh, padX, padY } = tag;
    ctx.save();
    // leader line to the nearest point on the box border
    const lx = Math.max(bx, Math.min(px, bx + boxW));
    const ly = Math.max(by, Math.min(py, by + boxH));
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lx, ly);
    ctx.strokeStyle = col.stateLn; ctx.lineWidth = 1; ctx.stroke();
    // box (filled twice for a touch more opacity)
    const rr = 4;
    ctx.beginPath();
    ctx.moveTo(bx + rr, by);
    ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, rr);
    ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, rr);
    ctx.arcTo(bx, by + boxH, bx, by, rr);
    ctx.arcTo(bx, by, bx + boxW, by, rr);
    ctx.closePath();
    ctx.fillStyle = col.tagBg; ctx.fill(); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = bold ? col.altHi : col.stateLn; ctx.stroke();
    // text
    ctx.textBaseline = 'top';
    let ty = by + padY;
    for (const ln of lines) {
      ctx.font = `${ln.big ? (bold ? '700 ' : '600 ') : ''}${ln.big ? f1 : f2}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = col.tagBg;
      ctx.strokeText(ln.t, bx + padX, ty);
      ctx.fillStyle = ln.big ? (bold ? col.altHi : col.text) : (ln.accent ? col.altHi : col.stateLn);
      ctx.fillText(ln.t, bx + padX, ty);
      ty += ln.big ? f1 + 2 : lh;
    }
    ctx.restore();
  }
  const _rectHit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const _overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
                                 Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  // Choose a non-overlapping box position around (px,py). Returns {bx,by}.
  function placeTag(px, py, boxW, boxH, obstacles, W, H) {
    const g = 12;
    const cands = [
      [px + g, py - boxH - g], [px + g, py + g],
      [px - g - boxW, py - boxH - g], [px - g - boxW, py + g],
      [px + g, py - boxH / 2], [px - g - boxW, py - boxH / 2],
      [px - boxW / 2, py - boxH - g], [px - boxW / 2, py + g],
      [px + g, py - boxH - g * 3.2], [px - g - boxW, py + g * 3.2],
      [px + g * 3.2, py - boxH / 2], [px - g * 3.2 - boxW, py - boxH / 2],
    ];
    let best = null, bestScore = Infinity;
    for (const [cx, cy] of cands) {
      const bx = Math.max(2, Math.min(cx, W - boxW - 2));
      const by = Math.max(2, Math.min(cy, H - boxH - 2));
      const r = { x: bx, y: by, w: boxW, h: boxH };
      let score = 0;
      for (const o of obstacles) score += _overlapArea(r, o);
      // small penalty for drifting from the ideal up-right spot
      score += Math.hypot(bx - (px + g), by - (py - boxH - g)) * 0.02;
      if (score === 0) return { bx, by };
      if (score < bestScore) { bestScore = score; best = { bx, by }; }
    }
    return best;
  }

  function frame() {
    if (_fmInst.get(id) !== inst) return; // superseded
    const { W, H, dpr } = sizeCanvases();
    const key = fmKey(inst.w);
    const data = state.flightmap[key];
    const col = themeCol();

    // view easing
    const desired = fmDesiredView(inst.w, data, W, H);
    if (!inst.view) inst.view = { ...desired };
    const v = inst.view;
    const near = Math.abs(v.centerLat - desired.centerLat) < 0.02 && Math.abs(v.centerLon - desired.centerLon) < 0.02 && Math.abs(v.zoom - desired.zoom) < 0.5;
    if (!near) {
      v.centerLat += (desired.centerLat - v.centerLat) * 0.12;
      v.centerLon += (desired.centerLon - v.centerLon) * 0.12;
      v.zoom += (desired.zoom - v.zoom) * 0.12;
      inst.baseDirty = true;
    }

    if (!_fmBasemap.land) { ensureFmBasemap(); maybePollFmBasemap(); }
    if (inst.baseDirty && _fmBasemap.land) { drawBase(W, H, dpr, col); inst.baseDirty = false; }

    // air layer
    const actx = airC.getContext('2d');
    actx.setTransform(dpr, 0, 0, dpr, 0, 0);
    actx.clearRect(0, 0, W, H);
    const now = Date.now();
    const ac = (data && data.aircraft) || [];
    inst._screen = [];
    const onScreen = [];
    for (const a of ac) {
      const dr = fmDeadReckon(a, now);
      const q = fmProject(dr.lat, dr.lon, v, W, H);
      if (q.x < -20 || q.x > W + 20 || q.y < -20 || q.y > H + 20) continue;
      const seed = (data.trailSeed || {})[a.hex];
      if (inst.w.fmShowTrails !== false) drawTrail(actx, seed, dr, v, W, H, col);
      const sel = a.hex === inst.selectedHex;
      drawPlane(actx, q.x, q.y, a.trackDeg, sel ? col.accent : altColor(a.altFt, col), sel);
      const rec = { hex: a.hex, x: q.x, y: q.y, a };
      inst._screen.push(rec);
      onScreen.push(rec);
    }
    // per-aircraft tags on top of every chevron. Off with the "Label
    // aircraft" setting; the selected/followed one is always tagged.
    //   <= 16 on screen : full block (ident + type / route / alt·speed·climb)
    //   17..60          : just ident + type
    //   > 60            : nothing (except the selected one, full)
    const wantLabels = inst.w.fmLabels !== false;
    const labelFont = Math.max(10, (inst.w.fmFontPx || 13) - 1);
    if (wantLabels || inst.selectedHex) {
      const n = onScreen.length;
      const fullAll = n <= 16;
      const tagged = onScreen.filter(r => (r.hex === inst.selectedHex) || (wantLabels && n <= 60));
      // Solve the placement (deconfliction) only every ~0.55s or when the set
      // of tagged aircraft / the zoom changes — between solves each block just
      // rides along with its chevron, so labels stay stable and don't jitter.
      const solveKey = tagged.map(r => r.hex).sort().join(',') + '|' + Math.round(v.zoom);
      inst._tagPos = inst._tagPos || {};
      if (!inst._tagSolveAt || now - inst._tagSolveAt > 550 || solveKey !== inst._tagSolveKey) {
        inst._tagSolveAt = now; inst._tagSolveKey = solveKey;
        const chevBoxes = onScreen.map(r => ({ x: r.x - 9, y: r.y - 9, w: 18, h: 18 }));
        // selected first, then top-to-bottom, so the important one gets its spot
        const order = tagged.slice().sort((a, b) =>
          (b.hex === inst.selectedHex) - (a.hex === inst.selectedHex) || a.y - b.y);
        const placed = [];
        const fresh = {};
        for (const r of order) {
          const isSel = r.hex === inst.selectedHex;
          const tag = buildTag(actx, r.a, labelFont, isSel, isSel || fullAll);
          if (!tag) continue;
          const pos = placeTag(r.x, r.y, tag.boxW, tag.boxH, placed.concat(chevBoxes), W, H);
          placed.push({ x: pos.bx, y: pos.by, w: tag.boxW, h: tag.boxH });
          fresh[r.hex] = { bx: pos.bx, by: pos.by, ax: r.x, ay: r.y, full: isSel || fullAll };
        }
        inst._tagPos = fresh;
      }
      for (const r of tagged) {
        const p = inst._tagPos[r.hex];
        const isSel = r.hex === inst.selectedHex;
        const tag = buildTag(actx, r.a, labelFont, isSel, p ? p.full : (isSel || fullAll));
        if (!tag) continue;
        let bx, by;
        if (p) { bx = p.bx + (r.x - p.ax); by = p.by + (r.y - p.ay); }
        else { bx = r.x + 12; by = r.y - tag.boxH - 12; }
        bx = Math.max(2, Math.min(bx, W - tag.boxW - 2));
        by = Math.max(2, Math.min(by, H - tag.boxH - 2));
        paintTag(actx, bx, by, r.x, r.y, tag, col);
      }
    }

    // badge
    let bd = '';
    if (!_fmBasemap.land) bd = 'setting up map…';
    else if (data && data.degraded) bd = '<span class="fm-delayed">⚠ delayed</span>';
    else if ((inst.w.fmSubject || 'filter') === 'filter') bd = ac.length + ' aircraft';
    if (data && data.source) bd += (bd ? ' · ' : '') + data.source.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (badge) badge.innerHTML = bd;

    // empty / no-signal
    if (emptyEl) {
      const s = inst.w.fmSubject || 'filter';
      if (_fmBasemap.land && !ac.length && (s === 'flight' || s === 'watch')) {
        emptyEl.hidden = false;
        emptyEl.innerHTML = `<div class="fm-emoji">✈️</div><div>Not currently tracked${inst.lastTarget ? ' — waiting for the next position' : ''}</div>`;
      } else emptyEl.hidden = true;
    }

    // data block
    if (dataEl) {
      let show = inst.selectedHex ? ac.find(a => a.hex === inst.selectedHex) : null;
      if (!show && (inst.w.fmSubject === 'flight' || inst.w.fmSubject === 'watch')) show = ac[0];
      if (show) {
        const vs = show.vertRateFpm > 120 ? '↑' : show.vertRateFpm < -120 ? '↓' : '→';
        const alt = show.onGround ? 'on ground' : (show.altFt != null ? Math.round(show.altFt).toLocaleString() + ' ft' : '—');
        const rt = show.route;
        const ap = (a) => a ? (a.iata || a.icao || a.city || '?') : '?';
        dataEl.hidden = false;
        dataEl.style.fontSize = (inst.w.fmFontPx || 13) + 'px';
        dataEl.innerHTML =
          `<div class="fm-cs">${escapeHtmlD(show.callsign || show.reg || show.hex.toUpperCase())}</div>` +
          (rt && (rt.from || rt.to) ? `<div class="fm-route">${escapeHtmlD(ap(rt.from))} → ${escapeHtmlD(ap(rt.to))}</div>` : '') +
          `<div class="fm-sub">${escapeHtmlD([show.typeName || show.type, show.reg].filter(Boolean).join(' · ') || '')}</div>` +
          `<div>${alt}${show.gsKts != null && !show.onGround ? ' · ' + Math.round(show.gsKts) + ' kt ' + vs : ''}</div>`;
      } else dataEl.hidden = true;
    }

    inst.raf = requestAnimationFrame(frame);
  }
  inst.raf = requestAnimationFrame(frame);
}

function wireFlightMaps() {
  document.querySelectorAll('.w-flightmap[data-widget-id]').forEach(el => {
    const id = el.getAttribute('data-widget-id');
    const w = (state.layout || []).find(x => String(x.id) === String(id));
    if (!w) return;
    fmStartInstance(el, w);
    if (el._fmTapWired) return;
    el._fmTapWired = true;
    el.addEventListener('click', (e) => {
      // the expand button + tapping an aircraft for its detail card both work
      // even in Live Edit (they don't move or edit the widget).
      if (e.target.closest('.fm-expand')) { e.stopPropagation(); openFlightMapOverlay(id); return; }
      const inst = _fmInst.get(id);
      if (!inst || !inst._screen) return;
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // generous touch target; a tap near a plane opens its detail, a tap in
      // empty space does nothing (use the ⛶ button for the full-screen map).
      let best = null, bd = 44;
      for (const s of inst._screen) { const d = Math.hypot(s.x - px, s.y - py); if (d < bd) { bd = d; best = s; } }
      if (best) {
        e.stopPropagation();
        inst.selectedHex = best.hex;
        openFmAircraftDetail(fmKey(inst.w), best.hex);
      }
    });
  });
  // clean up instances whose element is gone
  for (const [id, inst] of _fmInst) {
    if (!document.body.contains(inst.el)) { if (inst.raf) cancelAnimationFrame(inst.raf); _fmInst.delete(id); }
  }
  maybePollFmBasemap();
  startFmPolling();
}
function renderFmAll() {
  // nudge every live instance to redraw its base (theme / data changed)
  for (const inst of _fmInst.values()) inst.baseDirty = true;
}

function openFlightMapOverlay(widgetId) {
  const w = (state.layout || []).find(x => String(x.id) === String(widgetId));
  if (!w) return;
  let ov = document.getElementById('flightmap-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'flightmap-overlay';
    ov.innerHTML = `<button id="flightmap-overlay-close" aria-label="Close">✕</button>
      <div class="fmo-map"><canvas class="fm-base"></canvas><canvas class="fm-air"></canvas><div class="fm-badge"></div><div class="fm-data" hidden></div></div>
      <div class="fmo-list"></div>`;
    document.body.appendChild(ov);
    const close = () => { ov.classList.remove('on'); const i = _fmInst.get('__overlay__'); if (i && i.raf) cancelAnimationFrame(i.raf); _fmInst.delete('__overlay__'); };
    ov.querySelector('#flightmap-overlay-close').addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('on')) close(); });
  }
  ov.classList.add('on');
  const mapEl = ov.querySelector('.fmo-map');
  const listEl = ov.querySelector('.fmo-list');
  const ow = { ...w, id: '__overlay__' };
  fmStartInstance(mapEl, ow);
  mapEl._fmTapWired = false;
  if (!mapEl._fmOvWired) {
    mapEl._fmOvWired = true;
    mapEl.addEventListener('click', (e) => {
      const inst = _fmInst.get('__overlay__'); if (!inst || !inst._screen) return;
      const r = mapEl.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      let best = null, bd = 26;
      for (const s of inst._screen) { const d = Math.hypot(s.x - px, s.y - py); if (d < bd) { bd = d; best = s; } }
      if (best) { inst.selectedHex = best.hex; openFmAircraftDetail(fmKey(ow), best.hex); }
    });
  }
  const refreshList = () => {
    if (!ov.classList.contains('on')) return;
    const inst = _fmInst.get('__overlay__');
    const data = state.flightmap[fmKey(ow)];
    const ac = (data && data.aircraft) || [];
    const apc = (x) => x ? (x.iata || x.icao || '') : '';
    listEl.innerHTML = ac.slice(0, 60).map(a => {
      const rt = a.route && (a.route.from || a.route.to) ? `${apc(a.route.from)}→${apc(a.route.to)}` : '';
      return `<div class="fmo-row ${inst && inst.selectedHex === a.hex ? 'sel' : ''}" data-hex="${a.hex}">
        <span>${escapeHtmlD(a.callsign || a.reg || a.hex.toUpperCase())}${rt ? ` <span style="opacity:.6">${escapeHtmlD(rt)}</span>` : ''}</span>
        <span>${escapeHtmlD(a.typeName || a.type || '')} ${a.onGround ? 'GND' : (a.altFt != null ? Math.round(a.altFt / 100) : '')}</span>
      </div>`;
    }).join('') || '<div style="opacity:.6;padding:8px">No aircraft in view</div>';
    listEl.querySelectorAll('.fmo-row').forEach(row => row.addEventListener('click', () => {
      const i = _fmInst.get('__overlay__'); if (i) i.selectedHex = row.dataset.hex;
      refreshList();
      openFmAircraftDetail(fmKey(ow), row.dataset.hex);
    }));
  };
  refreshList();
  clearInterval(ov._listTID);
  ov._listTID = setInterval(refreshList, 3000);
  fetchFlightmap(true);
}

// Full detail card for one aircraft — everything the feed + adsbdb give us.
// Re-renders every 2s off the latest poll data; closes on ✕ / tap-outside / Esc.
let _fmDetail = null; // { key, hex, tid }
function openFmAircraftDetail(key, hex) {
  if (!hex) return;
  let ov = document.getElementById('fm-detail-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'fm-detail-overlay';
    ov.innerHTML = `<div class="fmd-card"><button class="fmd-close" aria-label="Close">✕</button><div class="fmd-body"></div></div>`;
    document.body.appendChild(ov);
    const close = () => {
      ov.classList.remove('on');
      if (_fmDetail) { clearInterval(_fmDetail.tid); _fmDetail = null; }
      const fmo = document.querySelector('#flightmap-overlay .fmo-list'); if (fmo) fmo.style.visibility = '';
    };
    ov._close = close;
    ov.querySelector('.fmd-close').addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('on')) close(); });
  }
  const card = ov.querySelector('.fmd-body');
  const fld = (k, val) => val === '' || val == null ? '' : `<div class="k">${k}</div><div>${escapeHtmlD(String(val))}</div>`;
  const ap = (x) => {
    if (!x) return '—';
    const code = [x.iata, x.icao].filter(Boolean).join(' / ');
    return (x.name || x.city || code || '?') + (code && (x.name || x.city) ? ` (${code})` : '');
  };
  const render = () => {
    const data = state.flightmap[key];
    const a = ((data && data.aircraft) || []).find(x => x.hex === hex);
    if (!a) { card.innerHTML = `<div class="fmd-head"><span class="fmd-cs">${escapeHtmlD(hex.toUpperCase())}</span></div><div class="fmd-foot">No longer in view.</div>`; return; }
    const ageS = a._at ? Math.round((Date.now() - a._at) / 1000) : null;
    const vr = a.vertRateFpm;
    const vrTxt = a.onGround ? '' : (vr > 120 ? `climbing ${Math.round(vr)} fpm` : vr < -120 ? `descending ${Math.round(-vr)} fpm` : 'level');
    const sq = a.squawk;
    const sqEmerg = sq === '7500' ? ' ⚠ hijack' : sq === '7600' ? ' ⚠ radio failure' : sq === '7700' ? ' ⚠ emergency' : '';
    card.innerHTML =
      `<div class="fmd-head">
        <span class="fmd-cs">${escapeHtmlD(a.callsign || a.reg || a.hex.toUpperCase())}</span>
        <span class="fmd-type">${escapeHtmlD([a.typeName || a.type, a.type && a.typeName ? a.type : ''].filter(Boolean).join(' · '))}</span>
        ${a.mil ? '<span class="fmd-mil">Military</span>' : ''}
      </div>
      ${(a.route && (a.route.from || a.route.to)) ? `<div class="fmd-route"><b>${escapeHtmlD(ap(a.route.from))}</b> → <b>${escapeHtmlD(ap(a.route.to))}</b>${a.route.airline ? `<br><span class="fmd-type">${escapeHtmlD(a.route.airline)}</span>` : ''}</div>` : ''}
      <div class="fmd-grid">
        ${fld('Status', a.onGround ? 'On ground' : 'In flight')}
        ${fld('Altitude', a.onGround ? '—' : (a.altFt != null ? Math.round(a.altFt).toLocaleString() + ' ft' + (vrTxt ? ' · ' + vrTxt : '') : '—'))}
        ${fld('Ground speed', a.gsKts != null ? Math.round(a.gsKts) + ' kt' : '—')}
        ${fld('Heading', a.trackDeg != null ? Math.round(a.trackDeg) + '°' : '—')}
        ${fld('Squawk', sq ? sq + sqEmerg : '—')}
        ${fld('Registration', a.reg || '—')}
        ${fld('ICAO hex', a.hex ? a.hex.toUpperCase() : '—')}
        ${fld('Operator', a.owner || '')}
        ${fld('Position', (a.lat != null && a.lon != null) ? a.lat.toFixed(4) + ', ' + a.lon.toFixed(4) : '—')}
      </div>
      <div class="fmd-foot">${data && data.source ? 'via ' + escapeHtmlD(data.source.replace(/^https?:\/\//, '')) : ''}${ageS != null ? ` · updated ${ageS}s ago` : ''}</div>`;
  };
  _fmDetail = { key, hex, tid: setInterval(render, 2000) };
  render();
  ov.classList.add('on');
  const fmo = document.querySelector('#flightmap-overlay .fmo-list'); if (fmo) fmo.style.visibility = 'hidden';
  fetchFlightmap(true);
}

// Shared: builds the location label + scale style for any weather widget variant.
// Auto-fit for the Weather widget (wxAutoFit setting): measures the widget's
// actual available box size — via clientWidth/clientHeight, which already
// reflects whatever padding/decoration the current theme adds (corkboard's
// pushpin+padding included, with no theme-specific logic needed here) —
// against the weather content's own natural size at 100% scale, and computes
// a --wx-scale that fills the box as closely as possible without
// overflowing. Replaces the purely manual Content Size slider when on, which
// never accounted for the widget's actual box dimensions at all: resizing
// the box via the drag handles didn't change content size in ANY theme,
// corkboard just made the mismatch most visible since its extra chrome left
// less room to begin with (see conversation this shipped from).
const WX_AUTOFIT_MIN_SCALE = 0.4;
// No upper clamp, deliberately — a widget box is already a direct, real
// measurement of how much room is actually available, so there's no
// equivalent risk of "too big" the way there is a real risk of "too small"
// (a sliver of a box producing unreadably tiny text, which the floor above
// still guards against). A 2.5x ceiling here just meant a genuinely large
// widget box — someone filling a big chunk of the screen with the current
// temperature — stopped growing well short of what the box could actually
// fit.
function autoFitWeatherContent(widgetEl) {
  // Disabled — multiple rounds of fixes (math, timing, clamps, the resize
  // trigger itself) didn't resolve the reported "doesn't grow with widget
  // size" behavior, and it wasn't worth further guessing without being able
  // to see it run. Left as a no-op rather than deleted, so every call site
  // (setupWeatherAutoFit, rerenderSingleWidget, applyResizeFrame) stays
  // harmless and this can be re-enabled later just by removing this one
  // line, without needing to rewire anything.
  return;
  const root = widgetEl.querySelector('.w-weather');
  if (!root) return;
  // Reset to a known baseline and measure fresh every time, rather than
  // computing a ratio off whatever scale happened to be applied last —
  // that would compound rounding error over repeated resizes instead of
  // always starting from the same 100% reference.
  //
  // Real bug, caught after shipping: this baseline MUST include
  // var(--ui-scale,1), not just a bare '1' — widgetEl.clientWidth/Height
  // are real on-screen pixels, which already reflect whatever --ui-scale
  // is in effect (it's rarely exactly 1 — only at the literal 1920px
  // reference resolution). Measuring naturalW/H at a bare, ui-scale-
  // ignorant baseline while comparing against an ui-scale-INCLUDING
  // available size produces a scale ratio that's off by a factor of
  // --ui-scale in either direction — on any screen/preview that isn't
  // exactly reference-sized (i.e. almost always), which is exactly why
  // this wasn't caught by the earlier synthetic-number tests: those used
  // plain numbers with no actual CSS var() resolution involved at all, so
  // this class of bug couldn't show up there regardless of how many cases
  // were tried.
  root.style.setProperty('--wx-scale', 'var(--ui-scale,1)');
  const naturalW = root.scrollWidth;
  const naturalH = root.scrollHeight;
  if (!naturalW || !naturalH) return; // not actually rendered yet (e.g. still showing "Loading weather…")
  const availW = widgetEl.clientWidth;
  const availH = widgetEl.clientHeight;
  if (!availW || !availH) return;
  let scale = Math.min(availW / naturalW, availH / naturalH);
  scale = Math.max(WX_AUTOFIT_MIN_SCALE, scale);
  root.style.setProperty('--wx-scale', `calc(${scale.toFixed(3)} * var(--ui-scale,1))`);
}
// One shared observer, torn down and rebuilt on every full renderLayout()
// pass rather than incrementally tracked — renderLayout() replaces the
// canvas's innerHTML wholesale, so any individually-tracked target elements
// would already be stale/disconnected by then anyway. Cheap to recreate;
// avoids ever accumulating disconnected targets with no easy way to list
// and prune them (ResizeObserver has no "what am I watching" API).
let _weatherAutoFitObserver = null;
function setupWeatherAutoFit() {
  if (_weatherAutoFitObserver) _weatherAutoFitObserver.disconnect();
  _weatherAutoFitObserver = new ResizeObserver((entries) => {
    // The browser coalesces repeated same-target entries within a drag-
    // resize into one callback already — no separate debounce needed here.
    entries.forEach(entry => autoFitWeatherContent(entry.target));
  });
  document.querySelectorAll('.widget[data-widget-id]').forEach(el => {
    const w = state.layout.find(x => String(x.id) === String(el.dataset.widgetId));
    if (w && ['weather', 'weatherCurrent', 'weatherForecast', 'weatherHourly', 'weatherComboForecast'].includes(w.type) && w.wxAutoFit) {
      // Applied directly here, not left to .observe()'s own initial firing —
      // ResizeObserver callbacks are ALWAYS asynchronous by spec, never
      // synchronous, regardless of whether .observe() itself is called
      // eagerly or deferred (an earlier version of this fix mistakenly
      // assumed calling .observe() synchronously would make the fit land
      // synchronously too — it doesn't; only the .observe() CALL was
      // synchronous, the actual callback still fired on its own async
      // schedule, so the flash this was meant to fix was still there).
      // Calling the real fit function directly means the browser's next
      // paint already reflects the correct size — .observe() below still
      // matters for catching FUTURE genuine resizes, just not this first one.
      autoFitWeatherContent(el);
      _weatherAutoFitObserver.observe(el);
    }
  });
}
// ── Auto-fit, phase 2: Clock, Date, Countdown, Timer, Text ─────────────────────
// Same underlying idea as weather's auto-fit above (measure the widget's real
// box via clientWidth/clientHeight, adjust content to fit), but these five
// are simpler in one way and trickier in another:
//  - Simpler: each already threads ONE base font value through its CSS as a
//    single custom property (--clock-font, --date-font, --cd-font,
//    --timer-font — all pre-existing, not added for this), with every
//    internal text element sized as a multiple of it. Auto-fit only has to
//    compute one new pixel value, not several.
//  - Text is the odd one out: it doesn't use that indirection (font-size is
//    set directly, no CSS var), AND — the real complication — its content
//    WRAPS (word-break/white-space:normal at 100% width), where the other
//    four are always a single fixed-format line that never wraps. Changing
//    a wrapping element's font-size changes where it wraps, which changes
//    its height, which is exactly what you're trying to solve for — a
//    single upfront ratio (this box is 80% the natural size, so scale by
//    0.8) works fine for non-wrapping content but can still overflow or
//    undershoot for wrapping content, since shrinking the font also
//    reflows the line breaks. Text gets its own iterative shrink-to-fit
//    function below instead of the shared ratio-based one.
const TEXT_AUTOFIT_MIN_SCALE = 0.25;
// No upper clamp here either, same reasoning as WX_AUTOFIT_MIN_SCALE's own
// comment above — the widget box is a direct, real measurement of available
// room, so there's nothing to guard against on the "too big" side the way
// the floor guards against "too small."
const AUTOFIT_LINE_WIDGETS = {
  clock:     { rootSel: '.w-clock:not(.w-clock-analog)', cssVar: '--clock-font', fontDefault: 90 },
  date:      { rootSel: '.w-date',      cssVar: '--date-font',  fontDefault: 24 },
  countdown: { rootSel: '.w-countdown', cssVar: '--cd-font',    fontDefault: 22 },
  timer:     { rootSel: '.w-timer',     cssVar: '--timer-font', fontDefault: 32 },
};
// For the four non-wrapping widgets above: single-shot ratio scaling, same
// technique as weather's autoFitWeatherContent.
function autoFitLineContent(widgetEl, type) {
  // Disabled — same reasoning as autoFitWeatherContent's own comment above.
  return;
  const cfg = AUTOFIT_LINE_WIDGETS[type];
  if (!cfg) return;
  const root = widgetEl.querySelector(cfg.rootSel);
  if (!root) return; // e.g. an analog clock has no .w-clock:not(.w-clock-analog) match — nothing to fit, not an error
  // Same fix as autoFitWeatherContent's own comment above: the measurement
  // baseline has to include var(--ui-scale,1), matching what widgetEl's
  // clientWidth/clientHeight actually reflect (real on-screen pixels,
  // already ui-scaled) — a bare pixel value here would only measure
  // correctly at the exact 1920px reference resolution.
  root.style.setProperty(cfg.cssVar, `calc(${cfg.fontDefault}px * var(--ui-scale,1))`);
  const naturalW = root.scrollWidth, naturalH = root.scrollHeight;
  if (!naturalW || !naturalH) return;
  const availW = widgetEl.clientWidth, availH = widgetEl.clientHeight;
  if (!availW || !availH) return;
  let scale = Math.min(availW / naturalW, availH / naturalH);
  scale = Math.max(TEXT_AUTOFIT_MIN_SCALE, scale);
  root.style.setProperty(cfg.cssVar, `calc(${(cfg.fontDefault * scale).toFixed(2)}px * var(--ui-scale,1))`);
}
// Text: iterative shrink-to-fit by HEIGHT only — width is already handled by
// .tx-body's own wrap (100% of its container), so there's nothing to solve
// for on that axis. Starts from the widget's own configured font size (not
// always fontDefault — unlike the four above, an existing Text widget's
// chosen size is much more likely to be intentional/meaningful content-wise,
// e.g. someone picked 48px for a heading-style note), and steps down in
// ~4% increments — small enough not to visibly "jump," bounded to a sane
// number of iterations so a pathological case can't loop for a long time.
function autoFitWrappedTextContent(widgetEl, w) {
  // Disabled — same reasoning as autoFitWeatherContent's own comment above.
  return;
  const body = widgetEl.querySelector('.w-text .tx-body');
  if (!body) return;
  const startPx = w.textFontPx || 28;
  const availH = widgetEl.clientHeight;
  if (!availH) return;
  let px = startPx;
  body.style.fontSize = `calc(${px}px * var(--ui-scale,1))`;
  let guard = 60; // ~4%/step from typical sizes down to TEXT_AUTOFIT_MIN_SCALE's floor, with headroom
  while (body.scrollHeight > availH && guard-- > 0) {
    px *= 0.96;
    if (px < startPx * TEXT_AUTOFIT_MIN_SCALE) { px = startPx * TEXT_AUTOFIT_MIN_SCALE; body.style.fontSize = `calc(${px.toFixed(2)}px * var(--ui-scale,1))`; break; }
    body.style.fontSize = `calc(${px.toFixed(2)}px * var(--ui-scale,1))`;
  }
  // Growing back up isn't attempted here — a box that's larger than the text
  // needs is a fine, common state (most Text widgets are short notes in a
  // generously-sized box) and doesn't call for the same urgency overflowing
  // does. If growth-to-fill is wanted later, it's a separate, simpler pass
  // in the other direction from the same starting point.
}
function autoFitTextWidgetContent(widgetEl, w) {
  if (w.type === 'text') { autoFitWrappedTextContent(widgetEl, w); return; }
  autoFitLineContent(widgetEl, w.type);
}
let _textAutoFitObserver = null;
function setupTextAutoFit() {
  if (_textAutoFitObserver) _textAutoFitObserver.disconnect();
  _textAutoFitObserver = new ResizeObserver((entries) => {
    entries.forEach(entry => {
      const w = state.layout.find(x => String(x.id) === String(entry.target.dataset.widgetId));
      if (w) autoFitTextWidgetContent(entry.target, w);
    });
  });
  document.querySelectorAll('.widget[data-widget-id]').forEach(el => {
    const w = state.layout.find(x => String(x.id) === String(el.dataset.widgetId));
    if (w && ['clock', 'date', 'countdown', 'timer', 'text'].includes(w.type) && w.autoFit) {
      // Applied directly, same reasoning as setupWeatherAutoFit's own
      // comment above — ResizeObserver callbacks are always asynchronous,
      // so leaving the first fit to .observe()'s own initial firing let the
      // browser paint one un-fit frame first on every full renderLayout()
      // pass (which happens far more often than just initial page load —
      // background weather/calendar/HA polling all trigger one).
      autoFitTextWidgetContent(el, w);
      _textAutoFitObserver.observe(el);
    }
  });
}
function weatherWidgetStyle(widget) {
  const locationFontPx = (widget && widget.wxLocationFontPx) || 14;
  const locationAlign = (widget && widget.wxLocationAlign) || 'left';
  const contentScale = (widget && widget.wxContentScale) || 1;
  return `--wx-location-font:calc(${locationFontPx}px * var(--ui-scale,1));--wx-location-text-align:${locationAlign};--wx-scale:calc(${contentScale} * var(--ui-scale,1))`;
}
function weatherLocationLabel() {
  const settings = state.settings || {};
  return settings.weather_location_manual || settings.weather_location_auto || '';
}
// Weather data is always fetched and cached in Fahrenheit (see getWeather()
// server-side) — Fahrenheit/Celsius is purely a display-time choice,
// converted here rather than re-fetching from Open-Meteo per unit. That
// keeps the weather cache simple (one fetch per location, not one per
// location-per-unit) and means adding this setting never doubled outbound
// API calls.
function formatTemp(fahrenheit, unit) {
  if (fahrenheit == null || isNaN(fahrenheit)) return '--';
  const val = unit === 'celsius' ? (fahrenheit - 32) * 5 / 9 : fahrenheit;
  return `${Math.round(val)}°`;
}
// "6:42 AM" from an Open-Meteo/OWM local-time ISO string ("2026-09-11T06:42").
// NWS doesn't report sunrise/sunset (blank strings) — returns '' right back,
// same "just don't show it" contract every other optional field here uses.
function formatWxTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hr = d.getHours() % 12 || 12, ap = d.getHours() < 12 ? 'AM' : 'PM';
  return `${hr}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
// A small horizon-line glyph with an arrow up (sunrise) or down (sunset).
function weatherSunIcon(kind) {
  const c = kind === 'set' ? '#7ec8e3' : '#fbbf24';
  const arrow = kind === 'set'
    ? `<path d="M12 4v6" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M9 7l3 3 3-3" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    : `<path d="M12 10V4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M9 7l3-3 3 3" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  return `<svg viewBox="0 0 24 24" fill="none">${arrow}<path d="M4 15h16" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M7 15a5 5 0 0 1 10 0" stroke="${c}" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;
}
// Feels-like/humidity/gust/UV row for a "current conditions" block — shared
// by weatherCurrent and weatherComboForecast. Each field is its own toggle;
// a toggled-on field with no data from the active provider (NWS reports
// none of these) is just skipped rather than showing a dash.
function weatherStatRow(widget, cur) {
  const w = widget || {};
  const unit = effectiveWxUnit(widget);
  const stats = [];
  if (w.wxShowFeelsLike && cur.apparent_temperature != null) stats.push(['Feels', formatTemp(cur.apparent_temperature, unit)]);
  if (w.wxShowHumidity && cur.relative_humidity_2m != null) stats.push(['Humidity', `${Math.round(cur.relative_humidity_2m)}<span class="wx-stat-unit">%</span>`]);
  if (w.wxShowWindGust && cur.wind_gusts_10m != null) stats.push(['Gusts', `${Math.round(cur.wind_gusts_10m)}<span class="wx-stat-unit">mph</span>`]);
  if (w.wxShowUV && cur.uv_index != null) stats.push(['UV', Math.round(cur.uv_index)]);
  if (!stats.length) return '';
  return `<div class="wx-stat-row">${stats.map(([label, value]) =>
    `<div class="wx-stat"><div class="wx-stat-label">${label}</div><div class="wx-stat-value">${value}</div></div>`).join('')}</div>`;
}
// Sunrise/sunset row — always today's (index 0 of the daily arrays).
function weatherSunRow(widget, daily) {
  if (!(widget && widget.wxShowSunrise) || !daily) return '';
  const rise = formatWxTime((daily.sunrise || [])[0]);
  const set = formatWxTime((daily.sunset || [])[0]);
  if (!rise && !set) return '';
  return `<div class="wx-sun-row">` +
    (rise ? `<span class="wx-sun-pt">${weatherSunIcon('rise')}<b>${rise}</b></span>` : '') +
    (set ? `<span class="wx-sun-pt">${weatherSunIcon('set')}<b>${set}</b></span>` : '') +
    `</div>`;
}
// Resolves the EFFECTIVE unit for one widget — its own override if set
// (matching the same override pattern already used for location, see
// wxLat/wxLon), otherwise the device-wide default from Settings → Weather.
function effectiveWxUnit(widget) {
  const settings = state.settings || {};
  return (widget && widget.wxUnit) || settings.weather_unit || 'fahrenheit';
}
// Builds the forecast-day strip HTML for up to `days` days.
// showSunToday: only renderWeatherForecast's standalone daily list opts in —
// renderWeatherCurrent's inline strip and the legacy renderWeather forecast
// already show today's sunrise/sunset in their own dedicated row above this
// strip, so adding it again to day-0's tile here would be redundant.
function weatherForecastDays(daily, days, unit, showSunToday) {
  const dailyCodes = daily.weather_code ?? daily.weathercode ?? [];
  const n = Math.min(days || 5, daily.time.length);
  return daily.time.slice(0, n).map((t,i) => {
    const d = new Date(t+'T00:00:00');
    const sunToday = (showSunToday && i === 0) ? (() => {
      const rise = formatWxTime((daily.sunrise || [])[0]);
      const set = formatWxTime((daily.sunset || [])[0]);
      if (!rise && !set) return '';
      return `<div class="fd-sun">` +
        (rise ? `<span class="fd-sun-pt">${weatherSunIcon('rise')}${rise}</span>` : '') +
        (set ? `<span class="fd-sun-pt">${weatherSunIcon('set')}${set}</span>` : '') +
        `</div>`;
    })() : '';
    return `<div class="fd">
      <div class="fd-name">${DAYS_S[d.getDay()]}</div>
      <div class="fd-icon">${weatherSVG(dailyCodes[i])}</div>
      <div class="fd-hi">${formatTemp(daily.temperature_2m_max[i], unit)}</div>
      <div class="fd-lo">${formatTemp(daily.temperature_2m_min[i], unit)}</div>
      ${sunToday}
    </div>`;
  }).join('');
}

function renderWeather(widget) {
  const wx = weatherForWidget(widget);
  if (!wx) return `<div class="w-weather"><div class="no-data">Loading weather…</div></div>`;
  const cur = wx.current, daily = wx.daily;
  const code = cur.weather_code ?? cur.weathercode;
  const locationLabel = (widget && widget.wxLabel) || weatherLocationLabel();
  const showLoc = !widget || widget.wxShowLocation !== false;
  const forecastDays = (widget && widget.wxForecastDays) || 5;
  const unit = effectiveWxUnit(widget);
  const forecast = weatherForecastDays(daily, forecastDays, unit);
  const locationHtml = (showLoc && locationLabel) ? `<div class="wx-location">${escapeHtmlD(locationLabel)}</div>` : '';
  const curHtml = `<div class="cur">
      <div class="icon">${weatherSVG(code, cur.is_day)}</div>
      <div><div class="temp">${formatTemp(cur.temperature_2m, unit)}</div>
      <div class="desc">${WMO_DESC[code]||''}</div></div>
    </div>`;
  // Location Position ('top', default = above current weather, or 'bottom' =
  // directly above the forecast strip) just changes the order these three
  // blocks stack in — the current-weather block always fills whichever slot
  // the location isn't in, so there's only ever one setting to manage
  // rather than two that could get set inconsistently.
  const locationAtBottom = (widget && widget.wxLocationPosition) === 'bottom';
  const stacked = locationAtBottom ? `${curHtml}${locationHtml}` : `${locationHtml}${curHtml}`;
  return `<div class="w-weather" style="${weatherWidgetStyle(widget)}">
    ${stacked}
    ${weatherStatRow(widget, cur)}
    ${weatherSunRow(widget, daily)}
    <div class="forecast">${forecast}</div>
  </div>`;
}

// Current-weather-only widget: the big current conditions, no forecast strip.
// Honors wxForecastDays only in that it can optionally append a compact strip if
// the user sets days > 0 (default 0 = current only).
function renderWeatherCurrent(widget) {
  const wx = weatherForWidget(widget);
  if (!wx) return `<div class="w-weather"><div class="no-data">Loading weather…</div></div>`;
  const cur = wx.current, daily = wx.daily;
  const code = cur.weather_code ?? cur.weathercode;
  const locationLabel = (widget && widget.wxLabel) || weatherLocationLabel();
  const showLoc = !widget || widget.wxShowLocation !== false;
  const days = (widget && widget.wxForecastDays !== undefined) ? widget.wxForecastDays : 0;
  const unit = effectiveWxUnit(widget);
  const strip = days > 0 ? `<div class="forecast">${weatherForecastDays(daily, days, unit)}</div>` : '';
  const hi = daily.temperature_2m_max ? formatTemp(daily.temperature_2m_max[0], unit) : null;
  const lo = daily.temperature_2m_min ? formatTemp(daily.temperature_2m_min[0], unit) : null;
  const locationHtml = (showLoc && locationLabel) ? `<div class="wx-location">${escapeHtmlD(locationLabel)}</div>` : '';
  const curHtml = `<div class="cur">
      <div class="icon">${weatherSVG(code, cur.is_day)}</div>
      <div><div class="temp">${formatTemp(cur.temperature_2m, unit)}</div>
      <div class="desc">${WMO_DESC[code]||''}</div>
      ${hi!==null ? `<div class="wx-hilo">H ${hi} · L ${lo}</div>` : ''}</div>
    </div>`;
  // Same Location Position toggle as the combined weather widget — only
  // visibly matters when the optional forecast strip (days > 0) is on,
  // since with it off there's nothing below the current-weather block for
  // "above the forecast" to mean. Harmless no-op otherwise.
  const locationAtBottom = (widget && widget.wxLocationPosition) === 'bottom';
  const stacked = (locationAtBottom && strip) ? `${curHtml}${locationHtml}` : `${locationHtml}${curHtml}`;
  return `<div class="w-weather w-weather-current" style="${weatherWidgetStyle(widget)}">
    ${stacked}
    ${weatherStatRow(widget, cur)}
    ${weatherSunRow(widget, daily)}
    ${strip}
  </div>`;
}

// Forecast-only widget: just the multi-day strip, user-chosen day count (default 5).
function renderWeatherForecast(widget) {
  const wx = weatherForWidget(widget);
  if (!wx) return `<div class="w-weather"><div class="no-data">Loading weather…</div></div>`;
  const daily = wx.daily;
  const locationLabel = (widget && widget.wxLabel) || weatherLocationLabel();
  const days = (widget && widget.wxForecastDays) || 5;
  const showLoc = !widget || widget.wxShowLocation !== false;
  const unit = effectiveWxUnit(widget);
  return `<div class="w-weather w-weather-forecast" style="${weatherWidgetStyle(widget)}">
    ${(showLoc && locationLabel) ? `<div class="wx-location">${escapeHtmlD(locationLabel)}</div>` : ''}
    <div class="forecast forecast-only">${weatherForecastDays(daily, days, unit, widget && widget.wxShowSunrise)}</div>
  </div>`;
}

// Hourly / time-of-day weather widget. Two styles:
//  • 'hourly'  — a strip of the next N hours (wxHours, default 6), each with icon,
//                temperature, and precip chance.
//  • 'parts'   — Morning / Afternoon / Evening blocks (like the email briefing),
//                each averaged from that part of today's hourly forecast.
function renderWeatherHourly(widget) {
  const wx = weatherForWidget(widget);
  if (!wx || !wx.hourly || !wx.hourly.time) {
    return `<div class="w-weather"><div class="no-data">Loading weather…</div></div>`;
  }
  const w = widget || {};
  const style = w.wxHourlyStyle || 'hourly';
  const showLoc = w.wxShowLocation !== false;
  const locationLabel = w.wxLabel || weatherLocationLabel();
  const unit = effectiveWxUnit(widget);
  const h = wx.hourly;
  const times = h.time, temps = h.temperature_2m || [], codes = h.weather_code || [], pops = h.precipitation_probability || [];
  const isDayArr = h.is_day || null;

  // Find the index of the current hour (API returns hours from 00:00 local today).
  const now = new Date();
  let startIdx = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())) { startIdx = i; break; }
  }

  let inner = '';
  if (style === 'parts') {
    // Morning 6-12, Afternoon 12-18, Evening 18-24 — averaged from today's hours.
    const block = (a, b, label) => {
      const t = [], c = [], p = [];
      // Map today's local hours a..b to hourly indices (today starts at index 0 of the day).
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0);
      for (let i = 0; i < times.length; i++) {
        const dt = new Date(times[i]);
        if (dt < dayStart) continue;
        const hr = dt.getHours();
        const sameDay = dt.getDate() === now.getDate() && dt.getMonth() === now.getMonth();
        if (sameDay && hr >= a && hr < b && temps[i] != null) { t.push(temps[i]); c.push(codes[i]); if (pops[i]!=null) p.push(pops[i]); }
      }
      if (!t.length) return '';
      const avg = t.reduce((x,y)=>x+y,0)/t.length; // raw average — formatTemp() does the only rounding, after unit conversion
      const code = c.slice().sort((x,y)=>y-x)[0];
      const pop = p.length ? Math.max(...p) : 0;
      const dayTime = (a >= 6 && a < 18) ? 1 : 0;
      return `<div class="wxh-part">
        <div class="wxh-part-label">${label}</div>
        <div class="wxh-part-icon">${weatherSVG(code, dayTime)}</div>
        <div class="wxh-part-temp">${formatTemp(avg, unit)}</div>
        <div class="wxh-part-meta">${WMO_DESC[code]||''}${pop>0?` · ${pop}%`:''}</div>
      </div>`;
    };
    inner = `<div class="wxh-parts">
      ${block(6,12,'Morning')}${block(12,18,'Afternoon')}${block(18,24,'Evening')}
    </div>`;
  } else {
    // Hourly strip: next N hours from now.
    const count = Math.max(2, Math.min(12, parseInt(w.wxHours) || 6));
    const feelsArr = h.apparent_temperature || [];
    const cells = [];
    for (let k = 0; k < count; k++) {
      const i = startIdx + k;
      if (temps[i] == null) break;
      const dt = new Date(times[i]);
      const hr = dt.getHours() % 12 || 12, ap = dt.getHours() < 12 ? 'AM' : 'PM';
      const isDay = isDayArr ? isDayArr[i] : (dt.getHours() >= 6 && dt.getHours() < 19 ? 1 : 0);
      const pop = pops[i] != null ? pops[i] : 0;
      const feels = (w.wxShowFeelsLike && feelsArr[i] != null) ? `<div class="wxh-feels">feels ${formatTemp(feelsArr[i], unit)}</div>` : '';
      cells.push(`<div class="wxh-hour">
        <div class="wxh-hr">${hr}${ap}</div>
        <div class="wxh-icon">${weatherSVG(codes[i], isDay)}</div>
        <div class="wxh-temp">${formatTemp(temps[i], unit)}</div>
        ${feels}
        <div class="wxh-pop">${pop>0?pop+'%':''}</div>
      </div>`);
    }
    inner = `<div class="wxh-strip">${cells.join('')}</div>`;
  }

  return `<div class="w-weather w-weather-hourly" style="${weatherWidgetStyle(widget)}">
    ${(showLoc && locationLabel) ? `<div class="wx-location">${escapeHtmlD(locationLabel)}</div>` : ''}
    ${inner}
  </div>`;
}

// Raw, structured hourly data — shared by every Combo Forecast layout style
// below, since each style formats the same underlying hours differently.
// Reuses the exact same "find the current hour" logic as
// renderWeatherHourly's own hourly-strip branch above, since both need the
// identical starting point.
function weatherComboHourlyCells(wx, count, unit) {
  const h = wx.hourly;
  if (!h || !h.time) return [];
  const times = h.time, temps = h.temperature_2m || [], codes = h.weather_code || [], pops = h.precipitation_probability || [];
  const isDayArr = h.is_day || null;
  const now = new Date();
  let startIdx = 0;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    if (t >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours())) { startIdx = i; break; }
  }
  const cells = [];
  for (let k = 0; k < count; k++) {
    const i = startIdx + k;
    if (temps[i] == null) break;
    const dt = new Date(times[i]);
    const hr = dt.getHours() % 12 || 12, ap = dt.getHours() < 12 ? 'AM' : 'PM';
    const isDay = isDayArr ? isDayArr[i] : (dt.getHours() >= 6 && dt.getHours() < 19 ? 1 : 0);
    cells.push({
      label: k === 0 ? 'Now' : `${hr}${ap}`,
      icon: weatherSVG(codes[i], isDay),
      temp: formatTemp(temps[i], unit),
      pop: pops[i] != null ? pops[i] : 0,
    });
  }
  return cells;
}

// Raw, structured daily data — same underlying source as weatherForecastDays()
// above, but returns plain objects instead of pre-built .fd-shaped HTML,
// since none of the four Combo Forecast layouts below use that specific
// markup shape (each needs its own). Keeps the raw hi/lo alongside the
// formatted string — Stacked's gradient bar needs the actual numbers to
// scale correctly; nothing else uses them.
function weatherComboDailyCells(daily, days, unit) {
  const dailyCodes = daily.weather_code ?? daily.weathercode ?? [];
  const n = Math.min(days || 5, daily.time.length);
  return daily.time.slice(0, n).map((t, i) => {
    const d = new Date(t + 'T00:00:00');
    return {
      day: i === 0 ? 'Today' : DAYS_S[d.getDay()],
      icon: weatherSVG(dailyCodes[i]),
      hi: formatTemp(daily.temperature_2m_max[i], unit),
      lo: formatTemp(daily.temperature_2m_min[i], unit),
      hiRaw: daily.temperature_2m_max[i],
      loRaw: daily.temperature_2m_min[i],
    };
  });
}

// Combo Hourly + Daily Forecast — one widget merging what weatherHourly and
// weatherForecast otherwise show separately, in one of four selectable
// layouts (wxComboStyle). Each style gets its own default hour/day count
// Current-conditions block for the Combo widget — added after a mockup
// review, by explicit request. The "full" version deliberately reuses the
// app's EXISTING .cur/.icon/.temp/.desc/.wx-hilo markup shape verbatim
// (same as renderWeather()/renderWeatherCurrent() build above) rather than
// inventing new classes — those are already scoped under .w-weather in
// CSS, which this widget's own outer wrapper already carries, so the
// exact same styling applies with zero new CSS needed for this variant.
// The "compact" version is Columns-specific — confirmed via the mockup
// that the full 56px/48px hero block ran noticeably taller than either
// column's own list below it, visibly unbalancing the widget; this
// smaller treatment (its own new CSS, since nothing existing matches it)
// keeps current conditions present without dominating a layout that's
// already tight on vertical room.
function weatherComboCurrentHtml(wx, unit, compact, locationLabel, widget) {
  const cur = wx.current, daily = wx.daily;
  const code = cur.weather_code ?? cur.weathercode;
  const hi = daily && daily.temperature_2m_max ? formatTemp(daily.temperature_2m_max[0], unit) : null;
  const lo = daily && daily.temperature_2m_min ? formatTemp(daily.temperature_2m_min[0], unit) : null;
  const locHtml = locationLabel ? `<div class="wx-location">${escapeHtmlD(locationLabel)}</div>` : '';
  // Stat/sun rows only on the "full" variant — the compact (Columns-only)
  // variant is deliberately kept small so it doesn't outgrow the column
  // list beside it (see comment above), so those rows skip it entirely.
  if (compact) {
    return `<div class="wxc-cur-compact">
      <div class="wxc-cur-compact-icon">${weatherSVG(code, cur.is_day)}</div>
      <div>
        <div class="wxc-cur-compact-temp">${formatTemp(cur.temperature_2m, unit)}</div>
        ${locHtml}
      </div>
      <div class="wxc-cur-compact-desc">${WMO_DESC[code]||''}${hi!==null ? ` · H${hi} L${lo}` : ''}</div>
    </div>`;
  }
  return `<div class="cur">
      <div class="icon">${weatherSVG(code, cur.is_day)}</div>
      <div><div class="temp">${formatTemp(cur.temperature_2m, unit)}</div>
      ${locHtml}
      <div class="desc">${WMO_DESC[code]||''}</div>
      ${hi!==null ? `<div class="wx-hilo">H ${hi} · L ${lo}</div>` : ''}</div>
    </div>
    ${weatherStatRow(widget, cur)}
    ${weatherSunRow(widget, daily)}`;
}
function renderWeatherComboForecast(widget) {
  const wx = weatherForWidget(widget);
  if (!wx || !wx.daily) return `<div class="w-weather"><div class="no-data">Loading weather…</div></div>`;
  const w = widget || {};
  const style = ['stacked', 'timeline', 'columns', 'tabs'].includes(w.wxComboStyle) ? w.wxComboStyle : 'stacked';
  const unit = effectiveWxUnit(widget);
  const showLoc = w.wxShowLocation !== false;
  const locationLabel = w.wxLabel || weatherLocationLabel();
  // Added after the mockup review, by explicit request — defaults ON,
  // since a toggle (rather than always-on) keeps the leaner, no-current
  // look available to anyone who preferred what shipped first.
  const showCurrent = w.wxComboShowCurrent !== false;
  const hasCur = showCurrent && wx.current;
  // By explicit request: the location label now sits inside the
  // current-conditions block itself, right after the temperature — not
  // as its own separate line above everything. Only when there's an
  // actual current-conditions block for it to sit inside, though — if
  // "Show current conditions" is off, there's no temperature for it to
  // be "aligned with" in the first place, so it falls back to its
  // original standalone line instead of silently disappearing just
  // because an unrelated toggle is off.
  const curHtml = hasCur ? weatherComboCurrentHtml(wx, unit, style === 'columns', showLoc ? locationLabel : '', widget) : '';
  const standaloneLocationHtml = (!hasCur && showLoc && locationLabel) ? `<div class="wx-location">${escapeHtmlD(locationLabel)}</div>` : '';

  const styleDefaults = {
    stacked:  { hours: 8, days: 5 },
    timeline: { hours: 6, days: 4 },
    columns:  { hours: 5, days: 5 },
    tabs:     { hours: 8, days: 6 },
  };
  const d = styleDefaults[style];
  const hourCount = w.wxHours || d.hours;
  const dayCount = (w.wxForecastDays !== undefined) ? w.wxForecastDays : d.days;

  const hourly = weatherComboHourlyCells(wx, hourCount, unit);
  const daily = weatherComboDailyCells(wx.daily, dayCount, unit);

  let inner;
  if (style === 'timeline') inner = curHtml + weatherComboTimelineHtml(hourly, daily);
  else if (style === 'columns') inner = curHtml + weatherComboColumnsHtml(hourly, daily);
  else if (style === 'tabs') inner = curHtml + weatherComboTabsHtml(w, hourly, daily);
  else inner = curHtml + weatherComboStackedHtml(hourly, daily);

  // By explicit request: the whole content block (current conditions +
  // whichever style's own hourly/daily content) can be aligned left,
  // right, or center within the widget's own box, for whenever that box
  // is wider than the content actually needs. Applies uniformly across
  // all four styles, not just one — wraps everything in a width:fit-content
  // container (so the block only ever takes up its own natural width,
  // never stretches) and positions that whole block via align-items on the
  // outer flex column, rather than trying to align each piece of content
  // individually.
  const contentAlign = ['left', 'right', 'center'].includes(w.wxComboAlign) ? w.wxComboAlign : 'left';
  const alignItemsValue = contentAlign === 'right' ? 'flex-end' : contentAlign === 'center' ? 'center' : 'flex-start';

  return `<div class="w-weather w-weather-combo w-weather-combo-${style}" style="${weatherWidgetStyle(widget)};align-items:${alignItemsValue}">
    ${standaloneLocationHtml}
    <div style="width:fit-content;max-width:100%;display:flex;flex-direction:column;align-items:${alignItemsValue}">${inner}</div>
  </div>`;
}

// Style 1: Stacked — hourly strip on top, daily list below a divider. Each
// day's hi/lo bar is scaled to the WEEK's overall min/max, not just that
// day's own range — the same convention most forecast apps use, so a
// day's bar position/width is directly comparable to every other day's at
// a glance, not just internally consistent with itself.
function weatherComboStackedHtml(hourly, daily) {
  const hourlyHtml = hourly.length ? `<div class="wxc-hourly">
    ${hourly.map(h => `<div class="wxc-hour">
      <div class="wxc-hr-label">${h.label}</div>
      <div class="wxc-hr-icon">${h.icon}</div>
      <div class="wxc-hr-temp">${h.temp}</div>
      <div class="wxc-hr-pop">${h.pop > 0 ? h.pop + '%' : ''}</div>
    </div>`).join('')}
  </div>` : '';

  const allHi = daily.map(d => d.hiRaw).filter(v => v != null);
  const allLo = daily.map(d => d.loRaw).filter(v => v != null);
  const weekMax = allHi.length ? Math.max(...allHi) : 100;
  const weekMin = allLo.length ? Math.min(...allLo) : 0;
  const range = Math.max(weekMax - weekMin, 1); // avoid divide-by-zero on a perfectly flat week

  const dailyHtml = daily.length ? `<div class="wxc-divider"></div><div class="wxc-daily">
    ${daily.map(d => {
      const leftPct = (d.loRaw != null) ? ((d.loRaw - weekMin) / range) * 100 : 0;
      const widthPct = (d.hiRaw != null && d.loRaw != null) ? Math.max(((d.hiRaw - d.loRaw) / range) * 100, 6) : 100;
      return `<div class="wxc-day-row">
        <div class="wxc-day-name">${d.day}</div>
        <div class="wxc-day-icon">${d.icon}</div>
        <div class="wxc-day-bar-wrap">
          <div class="wxc-day-lo">${d.lo}</div>
          <div class="wxc-day-bar-track"><div class="wxc-day-bar" style="left:${leftPct}%;width:${widthPct}%"></div></div>
          <div class="wxc-day-hi">${d.hi}</div>
        </div>
      </div>`;
    }).join('')}
  </div>` : '';

  return hourlyHtml + dailyHtml;
}

// Style 2: Timeline Continuum — one unbroken horizontal strip, hours
// flowing directly into days. Skips daily[0] ("Today") deliberately — it's
// already fully represented by the hourly cells immediately before it, so
// showing it again would be genuinely redundant (the same day twice), not
// just visually repetitive.
function weatherComboTimelineHtml(hourly, daily) {
  const hourCells = hourly.map((h, i) => `<div class="wxc-tl-cell${i===0?' now':''}">
    <div class="wxc-tl-label">${h.label}</div>
    <div class="wxc-tl-icon">${h.icon}</div>
    <div class="wxc-tl-temp">${h.temp}</div>
  </div>`).join('');
  const dayCells = daily.slice(1).map((d, i) => `<div class="wxc-tl-cell${i===0?' day-boundary':''}">
    <div class="wxc-tl-label">${d.day}</div>
    <div class="wxc-tl-icon">${d.icon}</div>
    <div class="wxc-tl-temp">${d.hi}</div>
    <div class="wxc-tl-temp lo">${d.lo}</div>
  </div>`).join('');
  return `<div class="wxc-timeline">${hourCells}${dayCells}</div>`;
}

// Style 3: Split Columns — hourly and daily as two compact vertical lists
// side by side, divided by a hairline.
function weatherComboColumnsHtml(hourly, daily) {
  return `<div class="wxc-columns">
    <div class="wxc-col">
      <div class="wxc-col-title">Hourly</div>
      ${hourly.map(h => `<div class="wxc-col-row">
        <div class="wxc-col-label">${h.label}</div>
        <div class="wxc-col-icon">${h.icon}</div>
        <div class="wxc-col-temp">${h.temp}</div>
      </div>`).join('')}
    </div>
    <div class="wxc-col-divider"></div>
    <div class="wxc-col">
      <div class="wxc-col-title">Daily</div>
      ${daily.map(d => `<div class="wxc-col-row">
        <div class="wxc-col-label">${d.day}</div>
        <div class="wxc-col-icon">${d.icon}</div>
        <div class="wxc-col-temp">${d.hi}<span class="wxc-col-lo">${d.lo}</span></div>
      </div>`).join('')}
    </div>
  </div>`;
}

// Style 4: Compact Tabs — a tab switches between a full-width Hourly view
// and a full-width Daily view rather than showing both at once. Which tab
// is active is purely client-side, in-memory, per widget id — deliberately
// NOT a persisted widget setting (not saved, doesn't sync to the app or
// other screens), since it's "what this screen happens to be showing right
// now," not a configuration choice someone made. Survives this widget being
// individually re-rendered (rerenderSingleWidget reads it back from this
// map before rebuilding) but not a full page reload — the same lifetime as
// any other transient, glanceable UI state on the display, like which
// Agenda day is scrolled into view.
const _weatherComboActiveTab = {};
function weatherComboTabsHtml(widget, hourly, daily) {
  const id = widget && widget.id;
  const active = _weatherComboActiveTab[id] || 'hourly';
  const content = active === 'daily'
    ? daily.map(d => `<div class="wxc-tab-day">
        <div class="wxc-tab-day-name">${d.day}</div>
        <div class="wxc-tab-day-icon">${d.icon}</div>
        <div class="wxc-tab-day-temp">${d.hi}<span class="wxc-tab-day-lo">${d.lo}</span></div>
      </div>`).join('')
    : hourly.map(h => `<div class="wxc-tab-hour">
        <div class="wxc-tab-hour-label">${h.label}</div>
        <div class="wxc-tab-hour-icon">${h.icon}</div>
        <div class="wxc-tab-hour-temp">${h.temp}</div>
      </div>`).join('');
  return `<div class="wxc-tabs" data-widget-id="${id}">
    <div class="wxc-tab-btn${active==='hourly'?' active':''}" data-tab="hourly">Hourly</div>
    <div class="wxc-tab-btn${active==='daily'?' active':''}" data-tab="daily">Daily</div>
  </div>
  <div class="wxc-tab-content ${active === 'daily' ? 'wxc-tab-content-daily' : 'wxc-tab-content-hourly'}">${content}</div>`;
}
// Delegated click listener per .wxc-tabs element — re-wires fresh on every
// re-render since rerenderSingleWidget() replaces this element entirely
// each time (same established pattern as wireChoreChartTaps() etc. above:
// the _tapWired guard only prevents double-wiring the SAME element within
// one call to this function, not across separate re-renders producing a
// new element).
function wireWeatherComboTabTaps() {
  document.querySelectorAll('.wxc-tabs[data-widget-id]').forEach(el => {
    if (el._tapWired) return;
    el._tapWired = true;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.wxc-tab-btn');
      if (!btn) return;
      const id = el.dataset.widgetId;
      _weatherComboActiveTab[id] = btn.dataset.tab;
      rerenderSingleWidget(id);
    });
  });
}

// Color palette for event pills (cycles per-event so different events are visually distinct,
// but falls back to the event's own color if it has one assigned)
// Converts a hex color (#rgb or #rrggbb) + this event's feed's opacity
// (0-100; undefined/100 = fully opaque) into whatever CSS color value is
// actually needed — the hex string unchanged when fully opaque (the
// overwhelmingly common case, and every existing call site already
// expects a plain hex/CSS-color string), or an rgba() string once the
// feed's opacity has been turned down. Only iCal feeds carry
// color_opacity at all (see the PUT /api/feeds/:id endpoint and the two
// SQL queries that attach it to each ical-sourced event) — local
// (manually-added) events never have this field, so they're completely
// unaffected regardless, exactly matching the request's own scope
// ("calendar feeds," not events in general). One function, every call
// site (Mini Calendar dots, Agenda/Upcoming/Today background tints, and
// anything added later) automatically gets this — nothing else needed
// to change.
// hex + opacity (0-100) -> whatever CSS color value is actually needed —
// the hex unchanged when fully opaque (the common case), an rgba() string
// once opacity drops below 100. Shared by eventPillColor() below and
// anywhere else that needs this same conversion.
function hexWithOpacity(hex, opacity) {
  if (opacity === undefined || opacity === null || opacity >= 100) return hex;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex; // not a recognizable hex color — fall back rather than risk an invalid rgba()
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
}

// This event's color, with opacity applied — only iCal feeds carry
// opacity at all (local/manually-added events never have color_opacity,
// so they're always rendered at full strength regardless of widget).
// Opacity resolves in two tiers, same pattern as every other global-
// setting-plus-per-widget-override in this app: a WIDGET can override a
// specific feed's opacity for itself alone (widget.feedOpacityOverride,
// an {feedId: percentage} map — set from that widget's own settings
// panel, see renderCalendarAdvancedSettings and friends), falling back to
// the feed's own global default (e.color_opacity, set from the Calendar
// Feeds section) when this widget has no override for that particular
// feed. Different displays showing the same feed can therefore genuinely
// disagree about how loud that calendar looks, without needing to change
// the feed's own global setting (which every OTHER widget/display still
// reads from by default).
function eventPillColor(e, widget) {
  // A local event tagged to a family member takes that person's colour;
  // everything else keeps its feed / stored colour.
  let hex = e.color || '#4A90D9';
  if (e.owner_profile_id != null && _profileColorById.has(Number(e.owner_profile_id))) {
    hex = _profileColorById.get(Number(e.owner_profile_id)) || hex;
  }
  const override = widget && widget.feedOpacityOverride && e.feed_id != null
    ? widget.feedOpacityOverride[e.feed_id]
    : undefined;
  const opacity = (override !== undefined && override !== null) ? override : e.color_opacity;
  return hexWithOpacity(hex, opacity);
}

// Event detail modal — new feature, by explicit request: tapping any
// calendar event (month grid, Agenda/Upcoming/Today's rows, MiniCal's own
// Agenda layout) shows its full detail, most usefully the description
// (server-side field `notes`, sliced to 500 chars from the source
// calendar's own DESCRIPTION), which none of those compact views have
// room to show at all today.
//
// Composite key uniquely identifies one OCCURRENCE of one event, not just
// the event itself — a recurring ical event's `uid` (aliased to `id` by
// the /api/events query) repeats across every occurrence date, so `id`
// alone isn't unique; `source` ('local' vs 'ical') keeps the two
// otherwise-separate id namespaces (autoincrement integer vs ical uid
// string) from ever colliding.
function eventDetailKey(e) {
  return `${e.source}:${e.id}:${e.date}`;
}
function openEventDetail(key, openerWidget) {
  const e = (state.events || []).find(ev => eventDetailKey(ev) === key);
  if (!e) return;
  const overlay = document.getElementById('event-detail-overlay');
  if (!overlay) return;

  document.getElementById('event-detail-colorbar').style.background = eventPillColor(e, null);
  document.getElementById('event-detail-title').textContent = e.title;

  const isMultiDay = e.end_date && e.end_date > e.date;
  const startD = new Date(e.date + 'T00:00:00');
  const fmt = globalDateFormat();
  let timeText;
  if (isMultiDay) {
    const endD = new Date(e.end_date + 'T00:00:00');
    timeText = `${monthDayLabel(startD, fmt)} – ${monthDayLabel(endD, fmt)}`;
  } else {
    const dayText = monthDayLabel(startD, fmt);
    timeText = e.start_time
      ? `${dayText} · ${fmtTime(e.start_time)}${e.end_time ? ' – ' + fmtTime(e.end_time) : ''}`
      : `${dayText} · All day`;
  }
  document.getElementById('event-detail-time').textContent = timeText;

  const sourceEl = document.getElementById('event-detail-source');
  const ownerName = e.owner_profile_id != null ? profileNameByIdD(e.owner_profile_id) : '';
  const sourceText = e.feed_name || (ownerName ? `For ${ownerName}` : '');
  sourceEl.textContent = sourceText;
  sourceEl.style.display = sourceText ? '' : 'none';

  const locEl = document.getElementById('event-detail-location');
  if (locEl) {
    // Match whatever the widget this was opened from would show, so the popup
    // and the widget agree — the per-feed override (if any) and the feed's
    // own "Show location" both apply. Treat the widget master as "on" here:
    // you tapped in for the details, so the only thing that should still
    // suppress a location is an explicit force-off override for this feed.
    const showLoc = widgetShowsLocation(e, openerWidget || null, true);
    locEl.textContent = showLoc ? e.location : '';
    locEl.style.display = showLoc ? '' : 'none';
  }

  const notesEl = document.getElementById('event-detail-notes');
  notesEl.textContent = e.notes || '';
  notesEl.style.display = e.notes ? '' : 'none';

  // Delete is only offered for events created in Piazza HQ — deleting one
  // that came from a subscribed feed would just have it re-sync on the next
  // poll, which is confusing. `source` is 'local' vs 'ical'. Feed events get
  // "Hide from display" instead: a local suppression (hidden_events table)
  // that's reversible from the app's Manage events screen.
  const canDelete = e.source === 'local' && e.id != null;
  const delBtn = document.getElementById('event-detail-delete');
  if (delBtn) {
    delBtn.hidden = !canDelete;
    delBtn.disabled = false;
    delBtn.textContent = 'Delete event';
    _eventDetailLocalId = canDelete ? e.id : null;
  }

  const hideBtn = document.getElementById('event-detail-hide');
  const hideSeriesBtn = document.getElementById('event-detail-hide-series');
  const canHide = !canDelete && e.id != null;
  _eventDetailHideCtx = canHide
    ? { key: (e.source === 'ical' ? `ical:${e.id}` : `local:${e.id}`), date: e.date, title: e.title || '' }
    : null;
  if (hideBtn) {
    hideBtn.hidden = !canHide;
    hideBtn.disabled = false;
    hideBtn.textContent = 'Hide from display';
  }
  if (hideSeriesBtn) {
    // ical events can recur; offer a one-tap "hide every occurrence" too.
    const showSeries = canHide && e.source === 'ical';
    hideSeriesBtn.hidden = !showSeries;
    hideSeriesBtn.disabled = false;
    if (showSeries) {
      const t = (e.title || 'this event').slice(0, 40);
      hideSeriesBtn.textContent = `Hide every "${t}"`;
    }
  }

  overlay.style.display = 'flex';
}
let _eventDetailLocalId = null;
let _eventDetailHideCtx = null;
async function hideEventFromDetail(scope) {
  const ctx = _eventDetailHideCtx;
  if (!ctx) return;
  const isSeries = scope === 'series';
  const msg = isSeries
    ? `Hide every occurrence of "${ctx.title}" from all displays? You can restore it from the app's Manage events screen.`
    : `Hide this event from all displays? You can restore it from the app's Manage events screen.`;
  if (!confirm(msg)) return;
  const btn = document.getElementById(isSeries ? 'event-detail-hide-series' : 'event-detail-hide');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Hiding…'; }
  try {
    const body = isSeries
      ? { event_key: ctx.key, scope: 'series', title: ctx.title }
      : { event_key: ctx.key, scope: 'occurrence', date: ctx.date, title: ctx.title };
    const r = await fetch('/api/hidden-events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('hide failed');
    closeEventDetail();
    try { await fetchEvents(); renderLayout(); } catch {}
    showDisplayToast('Hidden — restore it from the app’s Manage events screen.');
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = orig || (isSeries ? 'Hide every occurrence' : 'Hide from display'); }
    showDisplayToast('❌ Could not hide — try again.');
  }
}
async function deleteEventFromDetail() {
  const id = _eventDetailLocalId;
  if (id == null) return;
  if (!confirm('Delete this event? If it was pushed to iCloud or Google, it will be removed there too.')) return;
  const btn = document.getElementById('event-detail-delete');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    const r = await fetch(`/api/events/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('delete failed');
    closeEventDetail();
    try { await fetchEvents(); renderLayout(); } catch {}
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = 'Delete failed — try again'; }
  }
}
function closeEventDetail() {
  const overlay = document.getElementById('event-detail-overlay');
  if (overlay) overlay.style.display = 'none';
}

