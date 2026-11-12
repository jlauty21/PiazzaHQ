// The /tablet web app, part 6: the two sheets in the rearrange bar. "Pages" adds, renames, reorders and removes the tablet's pages. "Settings" is everything that belongs to the whole
// tablet rather than one tile: theme, colors, text size, buzz and click sound, the idle screen, the time-of-day rules, and whether changing the layout here asks for the PIN.
// The same choices as Layout, Tablet in the app. Every change applies and saves at once.
'use strict';
const TB_DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function tbPagesSheet() {
  if (!TB.edit) return;
  let confirmId = '';
  const { box, close } = tbSheet('', true);
  box.dataset.edit = '1';
  const sheet = box.firstElementChild;
  const render = () => {
    const L = TB.layout, keep = sheet.scrollTop;
    sheet.innerHTML = `<h2>Pages</h2><div class="tb-list" id="tbg-list">${L.pages.map((p, i) => `
      <div class="tb-prow${i === TB.page ? ' on' : ''}" data-i="${i}">
        <input class="tb-input" data-f="pname" aria-label="Page name" maxlength="40" value="${tbEsc(p.name)}">
        <button type="button" class="tb-btn tb-small" data-f="pshow" ${i === TB.page ? 'disabled' : ''}>${i === TB.page ? 'Showing' : 'Show'}</button>
        <button type="button" class="tb-btn tb-small" data-f="pup" aria-label="Move earlier" ${i === 0 ? 'disabled' : ''}>◀</button>
        <button type="button" class="tb-btn tb-small" data-f="pdown" aria-label="Move later" ${i === L.pages.length - 1 ? 'disabled' : ''}>▶</button>
        ${L.pages.length > 1 ? `<button type="button" class="tb-btn tb-small danger" data-f="pdel">${confirmId === p.id ? 'Remove it?' : 'Remove'}</button>` : ''}
      </div>`).join('')}</div>
      <div class="tb-row"><input class="tb-input" id="tbg-new" maxlength="40" placeholder="New page name, for example Kitchen" aria-label="New page name"><button type="button" class="tb-btn primary" data-f="padd" ${L.pages.length >= TM_MAX_PAGES ? 'disabled' : ''}>Add page</button></div>
      <button type="button" class="tb-btn" data-f="close">Done</button>`;
    sheet.scrollTop = keep;
  };
  const change = async () => { tbLastGrid = ''; render(); await tbEditCommit(); };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]'); if (!b || b.disabled) return;
    const L = TB.layout, row = b.closest('.tb-prow'), i = row ? Number(row.dataset.i) : -1, f = b.dataset.f;
    if (f === 'close') { close(); return; }
    if (f === 'padd') {
      const input = tbEl('tbg-new'), name = input.value.trim().slice(0, 40);
      if (!name) { tbToast('Give the page a name first.'); return; }
      L.pages.push({ id: 'p' + Date.now().toString(36), name, tiles: [] }); TB.page = L.pages.length - 1; TB.edit.sel = ''; tbPanelClose(); await change(); return;
    }
    if (i < 0) return;
    if (f === 'pshow') { TB.page = i; if (TB.edit) tbPanelClose(); tbLastGrid = ''; tbRedraw(); render(); return; }
    if (f === 'pup' || f === 'pdown') {
      const j = f === 'pup' ? i - 1 : i + 1, cur = L.pages[TB.page];
      [L.pages[i], L.pages[j]] = [L.pages[j], L.pages[i]]; TB.page = L.pages.indexOf(cur); await change(); return;
    }
    if (f === 'pdel') {
      const p = L.pages[i];
      if (confirmId !== p.id) { confirmId = p.id; render(); return; }            // the second tap confirms
      confirmId = ''; tbPanelClose();
      L.pages.splice(i, 1); (L.rules || []).forEach((r) => { if (r.page === p.id) r.page = ''; });
      TB.page = Math.max(0, Math.min(TB.page, L.pages.length - 1)); await change();
    }
  });
  box.addEventListener('change', async (e) => {
    if (e.target.dataset.f !== 'pname') return;
    const row = e.target.closest('.tb-prow'), p = TB.layout.pages[Number(row.dataset.i)], name = e.target.value.trim().slice(0, 40);
    if (!p || !name) { e.target.value = p ? p.name : ''; return; }
    p.name = name; tbLastGrid = ''; tbRedraw(); await tbSaveLayout();            // not redrawn: the next box a finger lands on stays there
  });
  render();
}

// ── tablet settings ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The "Idle photos" choices of the tablet settings sheet: which photos, how long each stays, the order, how a photo is fitted, and whether small ones are skipped.
TB.photoTags = TB.photoTags || null;
function tbPhotoFields(idle) {
  const o = tmPhotoOpts(idle), tags = TB.photoTags || [];
  const sel = (cls, opts, cur) => '<select class="tb-input ' + cls + '">' + opts.map(([v, l]) => '<option value="' + tbEsc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + tbEsc(l) + '</option>').join('') + '</select>';
  const secs = [...new Set([...TM_PHOTO_SECONDS, o.seconds])].sort((a, b) => a - b).map((n) => [n, n < 60 ? n + ' seconds' : (n / 60) + (n === 60 ? ' minute' : ' minutes')]);
  return '<div class="tb-row wrapfields"><label>Photos from' + sel('tb-ptag', [['', 'All the slideshow photos'], ...tags.map((t) => [t, 'Tagged ' + t]), ...(o.tag && !tags.includes(o.tag) ? [[o.tag, 'Tagged ' + o.tag]] : [])], o.tag) + '</label>'
    + `<label>Change photo every${sel('tb-psec', secs, o.seconds)}</label></div>`
    + tbSeg('porder', TM_PHOTO_ORDERS, o.order) + tbSeg('pfit', TM_PHOTO_FITS, o.fit)
    + '<div class="tb-segs"><button type="button" class="tb-seg tb-toggle' + (o.skip_small ? ' on' : '') + '" data-f="pskip" aria-pressed="' + o.skip_small + '">Skip small photos that would look blurry</button></div>';
}
function tbSettingsSheet() {
  if (!TB.edit) return;
  const { box, close } = tbSheet('', true);
  box.dataset.edit = '1';
  const sheet = box.firstElementChild;
  const field = (label, body) => `<div class="tb-pf"><div class="tb-pl">${label}</div>${body}</div>`;
  const sel = (cls, opts, cur, attr) => `<select class="tb-input ${cls}" ${attr || ''}>${opts.map(([v, l]) => `<option value="${tbEsc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${tbEsc(l)}</option>`).join('')}</select>`;
  const ruleRow = (r, i) => `<div class="tb-rule" data-i="${i}">
      <div class="tb-row"><span>From</span><input type="time" class="tb-input tb-time-in" data-r="from" value="${r.from}"><span>to</span><input type="time" class="tb-input tb-time-in" data-r="to" value="${r.to}"><button type="button" class="tb-btn tb-small danger" data-f="rrm">Remove</button></div>
      <div class="tb-days" role="group" aria-label="Days">${TB_DAY_LETTERS.map((d, n) => `<button type="button" class="tb-day${r.days.includes(n) ? ' on' : ''}" data-f="rday" data-d="${n}" aria-pressed="${r.days.includes(n)}">${d}</button>`).join('')}</div>
      <div class="tb-row wrapfields"><label>Dim the screen${sel('', [[0, 'Not at all'], [25, 'A little'], [50, 'Quite a lot'], [75, 'Very dark']], r.dim || 0, 'data-r="dim"')}</label>
        <label>Show${sel('', [['', 'The tiles'], ['clock', 'The clock'], ['photos', 'Photos and the clock']], r.screen || '', 'data-r="screen"')}</label>
        <label>Open the page${sel('', [['', 'Do not change'], ...TB.layout.pages.map((p) => [p.id, p.name])], r.page || '', 'data-r="page"')}</label></div></div>`;
  if (!TB.photoTags) tbApi('/api/photos').then((r) => { TB.photoTags = tmPhotoTags(tbOk(r) ? tbList(r) : []); if (box.isConnected) render(); });
  const render = () => {
    const L = TB.layout, th = L.theme, keep = sheet.scrollTop, rules = L.rules || [];
    sheet.innerHTML = `<h2>Tablet settings</h2>
      ${field('Theme', tbSeg('mode', [['dark', 'Dark'], ['light', 'Light']], th.mode))}
      ${field('Colors', tbSeg('palette', [['', 'Standard'], ['warm', 'Warm'], ['forest', 'Forest'], ['ocean', 'Ocean'], ['mono', 'Black and white']], th.palette || ''))}
      ${TM_LOOKS.map((l) => field(l.label, tbSeg('look_' + l.key, l.choices, th[l.key] || ''))).join('')}
      ${field('Text size', tbSeg('text', [['', 'Standard'], ['large', 'Large'], ['xlarge', 'Extra large']], th.text || ''))}
      ${field('Touch feedback', `<div class="tb-segs"><button type="button" class="tb-seg tb-toggle${th.haptics === false ? '' : ' on'}" data-f="haptics" aria-pressed="${th.haptics !== false}">Buzz on touch</button><button type="button" class="tb-seg tb-toggle${th.sound ? ' on' : ''}" data-f="sound" aria-pressed="${!!th.sound}">Click sound on touch</button></div>`)}
      ${field('When idle', tbSeg('idle', [['photos', 'Photos and the clock'], ['clock', 'The clock'], ['off', 'Stay on the tiles']], L.idle.mode))}
      ${field('Go idle after', sel('tb-mins', tmIdleOptions(L.idle.minutes), L.idle.minutes))}
      ${L.idle.mode === 'photos' || rules.some((r) => r.screen === 'photos') ? field('Idle photos', tbPhotoFields(L.idle)) : ''}
      ${field('Tip', `<div class="tb-segs"><button type="button" class="tb-seg tb-toggle${L.start_hint === false ? '' : ' on'}" data-f="starthint" aria-pressed="${L.start_hint !== false}">Show how to edit when the page opens</button></div>`)}
      ${L.pages.length > 1 ? field('Pages', `<div class="tb-segs"><button type="button" class="tb-seg tb-toggle${L.swipe === false ? '' : ' on'}" data-f="swipe" aria-pressed="${L.swipe !== false}">Swipe sideways to change page</button></div>`) : ''}
      ${field('On a phone', `<div class="tb-segs"><button type="button" class="tb-seg tb-toggle${L.phone_small ? ' on' : ''}" data-f="phonesmall" aria-pressed="${!!L.phone_small}">Smaller tiles</button></div><div class="tb-hint2">Simple tiles are a third of a row wide and one line high. A tile can choose its own size in its options.</div>`)}
      ${field('Ask before a tile acts', tbSeg('confirmmode', TM_CONFIRM_MODES, L.confirm_mode || '') + '<div class="tb-hint2">A touch by accident then asks "Do this now?" first. A tile can also ask on its own, in its options.</div>')}
      ${field('Changing this layout', `<div class="tb-segs"><button type="button" class="tb-seg tb-toggle${L.edit_pin === false ? '' : ' on'}" data-f="editpin" aria-pressed="${L.edit_pin !== false}">Ask for the PIN first</button></div><div class="tb-hint2">Only when this household has a PIN set.</div>`)}
      ${field('Time of day', `<div class="tb-hint2">For example: dim the screen and show the clock after 9pm, or open the Kitchen page at 6am.</div>${rules.map(ruleRow).join('')}<button type="button" class="tb-btn" data-f="radd" ${rules.length >= 8 ? 'disabled' : ''}>Add a rule</button>`)}
      <button type="button" class="tb-btn primary" data-f="close">Done</button>`;
    sheet.scrollTop = keep;
  };
  const apply = async (theme) => { render(); await tbEditCommit({ theme }); };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]'); if (!b || b.disabled) return;
    const L = TB.layout, th = L.theme, f = b.dataset.f, v = b.dataset.v;
    L.rules = L.rules || [];
    if (f === 'close') { close(); return; }
    if (f === 'mode') th.mode = v;
    else if (f === 'palette') { if (v) th.palette = v; else delete th.palette; }
    else if (f === 'text') { if (v) th.text = v; else delete th.text; }
    else if (f.startsWith('look_') && TM_LOOKS.some((l) => 'look_' + l.key === f)) { const k = f.slice(5); if (v) th[k] = v; else delete th[k]; }
    else if (f === 'haptics') { if (th.haptics === false) delete th.haptics; else th.haptics = false; }
    else if (f === 'sound') { if (th.sound) delete th.sound; else th.sound = true; }
    else if (f === 'idle') L.idle.mode = v;
    else if (f === 'pfit' || f === 'porder') tmSetPhotoOpt(L.idle, f === 'pfit' ? 'fit' : 'order', v);
    else if (f === 'pskip') tmSetPhotoOpt(L.idle, 'skip_small', !tmPhotoOpts(L.idle).skip_small);
    else if (f === 'starthint') { if (L.start_hint === false) delete L.start_hint; else L.start_hint = false; }
    else if (f === 'confirmmode') { if (v) L.confirm_mode = v; else delete L.confirm_mode; }
    else if (f === 'phonesmall') { if (L.phone_small) delete L.phone_small; else L.phone_small = true; }
    else if (f === 'swipe') { if (L.swipe === false) delete L.swipe; else L.swipe = false; }
    else if (f === 'editpin') { if (L.edit_pin === false) delete L.edit_pin; else L.edit_pin = false; }
    else if (f === 'radd') L.rules.push({ id: 'r' + Date.now().toString(36), from: '21:00', to: '06:00', days: [0, 1, 2, 3, 4, 5, 6], dim: 50, screen: '', page: '' });
    else if (f === 'rrm') L.rules.splice(Number(b.closest('.tb-rule').dataset.i), 1);
    else if (f === 'rday') {
      const r = L.rules[Number(b.closest('.tb-rule').dataset.i)], d = Number(b.dataset.d), on = r.days.includes(d);
      if (on && r.days.length === 1) return;                                      // a rule needs at least one day
      r.days = on ? r.days.filter((x) => x !== d) : [...r.days, d].sort();
    } else return;
    await apply(true);
  });
  box.addEventListener('change', async (e) => {
    const L = TB.layout, t = e.target;
    if (t.classList.contains('tb-mins')) { L.idle.minutes = Number(t.value); await apply(false); return; }
    if (t.classList.contains('tb-ptag') || t.classList.contains('tb-psec')) { tmSetPhotoOpt(L.idle, t.classList.contains('tb-ptag') ? 'tag' : 'seconds', t.value); await apply(false); return; }
    const key = t.dataset.r; if (!key) return;
    const r = L.rules[Number(t.closest('.tb-rule').dataset.i)]; if (!r) return;
    if (key === 'from' || key === 'to') { if (!t.value) return; r[key] = t.value; }
    else if (key === 'dim') r.dim = Number(t.value);
    else r[key] = t.value;
    await tbEditCommit();                                                         // not redrawn: the next box a finger lands on stays there
  });
  render();
}
