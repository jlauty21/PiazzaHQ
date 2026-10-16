// Presentations (Photos tab > Presentations): make a deck from a PDF or from pictures, tidy it, and show it on a screen with a remote control.
// A PDF is turned into one picture per page right here in the browser (the pdf.js library in /vendor/pdfjs, loaded only when needed), so the server,
// often a Raspberry Pi, never converts anything. The pictures are sent to the server one page at a time (POST /api/decks/:id/pages).

// ── the Photos / Presentations switch at the top of the Photos tab ───────────────────────────────────────
function photosSubtab() { try { return localStorage.getItem('photos_subtab') === 'presentations' ? 'presentations' : 'photos'; } catch { return 'photos'; } }
function setPhotosSubtab(v) { try { localStorage.setItem('photos_subtab', v); } catch { /* not saved */ } }
function photosSubtabBar(active) {
  const b = (id, label) => `<button class="photos-subtab-btn" data-sub="${id}" style="flex:1;padding:9px 6px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;${active === id ? 'background:var(--accent);color:#fff' : 'background:transparent;color:var(--muted)'}">${label}</button>`;
  return `<div style="display:flex;gap:4px;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:3px;margin:0 0 14px">${b('photos', 'Photos')}${b('presentations', 'Presentations')}</div>`;
}
function wirePhotosSubtabBar() {
  document.querySelectorAll('.photos-subtab-btn').forEach((btn) => btn.addEventListener('click', () => {
    setPhotosSubtab(btn.dataset.sub); stopPresPolling();
    if (btn.dataset.sub === 'presentations') renderPresentations(); else renderPhotos();
  }));
}

// ── turning a file into page pictures ─────────────────────────────────────────────────────────────────────
const PRES_QUALITY = { standard: { side: 1920, jpeg: 0.85 }, high: { side: 3840, jpeg: 0.8 } };
const PRES_NOT_SUPPORTED = /\.(pptx?|key|odp|ppsx?|docx?|pages|odt|xlsx?)$/i;
let _pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => { _pdfjsPromise = null; reject(new Error('The PDF reader could not be loaded. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}
const canvasBlob = (canvas, type, q) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The page could not be converted.'))), type, q));
async function pagePictures(source, w, h, q) {
  // source: a canvas or image already at the right size. Returns { page, thumb } JPEG blobs on a white ground.
  const full = document.createElement('canvas'); full.width = w; full.height = h;
  const fx = full.getContext('2d'); fx.fillStyle = '#fff'; fx.fillRect(0, 0, w, h); fx.drawImage(source, 0, 0, w, h);
  const tw = Math.max(1, Math.round(w >= h ? 320 : 320 * w / h)), th = Math.max(1, Math.round(tw * h / w));
  const small = document.createElement('canvas'); small.width = tw; small.height = th;
  small.getContext('2d').drawImage(full, 0, 0, tw, th);
  const out = { page: await canvasBlob(full, 'image/jpeg', q), thumb: await canvasBlob(small, 'image/jpeg', 0.7) };
  full.width = full.height = small.width = small.height = 0;   // free the memory right away
  return out;
}
// Calls onPage({page, thumb}, index, total) for each page of the file, in order.
async function presConvertFile(file, quality, onPage, onStart) {
  const Q = PRES_QUALITY[quality] || PRES_QUALITY.standard;
  const name = file.name || '';
  if (PRES_NOT_SUPPORTED.test(name)) throw new Error(`${name} can't be used directly. In PowerPoint, Keynote or Google Slides, use File → Save as / Export → PDF, then upload that PDF here.`);
  if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
    const lib = await loadPdfJs();
    let doc;
    try {
      doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error(`${name} is password protected. Remove the password and try again.`);
      throw new Error(`${name} could not be read as a PDF.`);
    }
    if (onStart) onStart(doc.numPages);
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Q.side / Math.max(v1.width, v1.height) });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blobs = await pagePictures(canvas, canvas.width, canvas.height, Q.jpeg);
      canvas.width = canvas.height = 0; page.cleanup();
      await onPage(blobs, p - 1, doc.numPages);
    }
    doc.destroy();
    return;
  }
  if (/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(name)) {
    if (onStart) onStart(1);
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { throw new Error(`${name} could not be read as a picture.`); }
    const k = Math.min(1, Q.side / Math.max(bmp.width, bmp.height));
    const blobs = await pagePictures(bmp, Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)), Q.jpeg);
    if (bmp.close) bmp.close();
    await onPage(blobs, 0, 1);
    return;
  }
  throw new Error(`${name || 'That file'} isn't a PDF or a picture. Use a PDF, JPEG, PNG or WebP file.`);
}

// Adds the pages of the chosen files to a deck (a new one when deckId is empty). Shows progress in #pres-progress. Returns the deck id, or '' if nothing was added.
async function presImportFiles(files, { deckId = '', quality = 'standard', existingPages = 0 } = {}) {
  files = Array.from(files || []);
  if (!files.length) return '';
  // Refuse what cannot be used before anything is created.
  for (const file of files) {
    const name = file.name || '';
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(name);
    const isPic = /^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(name);
    if (isPdf || isPic) continue;
    showToast('❌ ' + (PRES_NOT_SUPPORTED.test(name)
      ? `${name} can't be used directly. In PowerPoint, Keynote or Google Slides, use File → Save as / Export → PDF, then upload that PDF here.`
      : `${name || 'That file'} isn't a PDF or a picture. Use a PDF, JPEG, PNG or WebP file.`), 7000);
    return '';
  }
  const box = $('pres-progress');
  const say = (msg, pct) => { if (box) { box.style.display = 'block'; box.innerHTML = `<div style="font-size:13px;margin-bottom:8px">${escapeHtml(msg)}</div><div style="height:8px;background:var(--border);border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.max(3, Math.min(100, pct || 0))}%;background:var(--accent);transition:width .2s"></div></div>`; } };
  let created = false, added = 0, failure = '';
  try {
    if (!deckId) {
      const base = (files[0].name || 'Presentation').replace(/\.[^.]+$/, '').slice(0, 80) || 'Presentation';
      const d = await apiFetch('/api/decks', { method: 'POST', body: JSON.stringify({ name: base }) });
      if (d.error) throw new Error(d.error);
      deckId = d.id; created = true;
    }
    for (const file of files) {
      say(`Reading ${file.name}…`, 3);
      await presConvertFile(file, quality, async (blobs, i, n) => {
        if (existingPages + added >= 200) throw new Error('A presentation can have up to 200 pages.');
        say(`${file.name}: page ${i + 1} of ${n}`, Math.round(((i + 1) / n) * 100));
        const fd = new FormData(); fd.append('page', blobs.page, 'page.jpg'); fd.append('thumb', blobs.thumb, 'thumb.jpg');
        const r = await apiFetch(`/api/decks/${deckId}/pages`, { method: 'POST', body: fd });
        if (r && r.error) throw new Error(r.error);
        added++;
      });
    }
  } catch (e) { failure = e && e.message ? e.message : 'The file could not be added.'; }
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  if (failure) {
    showToast('❌ ' + failure, 6000);
    if (created && !added) { try { await apiFetch(`/api/decks/${deckId}`, { method: 'DELETE' }); } catch { /* leave it */ } return ''; }
  }
  if (added) showToast(added === 1 ? '✓ Added 1 page' : `✓ Added ${added} pages`);
  return deckId;
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────────
let presDecks = [], presPlaylists = [], presRecipes = [], presScreens = [], presStates = {}, presPollTimer = null, presEditId = '', presPlEditId = '';
const presEligibleScreens = () => presScreens.filter((s) => s.name && s.online && !String(s.device_id).startsWith('preview_'));   // a screen that is off is not worth listing (or waiting for)
function stopPresPolling() { if (presPollTimer) { clearInterval(presPollTimer); presPollTimer = null; } }
const presVisible = () => currentTab === 'photos' && photosSubtab() === 'presentations' && !presEditId && !presPlEditId;
// each piece is its own element so the language catalog can translate it on its own
const presSummary = (d) => `<span>${d.page_count === 1 ? '1 page' : `${d.page_count} pages`}</span> · <span>${d.interval_sec > 0 ? `every ${d.interval_sec} seconds` : 'by hand'}</span>${d.interval_sec > 0 && d.loop ? ' · <span>repeats</span>' : ''}`;

async function renderPresentations() {
  stopPresPolling();
  if (presEditId) return renderDeckEditor(presEditId);
  if (presPlEditId) return renderPlaylistEditor(presPlEditId);
  [presDecks, presPlaylists, presScreens, presRecipes] = await Promise.all([apiFetch('/api/decks').catch(() => []), apiFetch('/api/playlists').catch(() => []), apiFetch('/api/screens').catch(() => []), apiFetch('/api/recipes').catch(() => [])]);
  if (!Array.isArray(presRecipes)) presRecipes = [];
  if (!Array.isArray(presDecks)) presDecks = [];
  if (!Array.isArray(presPlaylists)) presPlaylists = [];
  if (!Array.isArray(presScreens)) presScreens = [];
  if (!presVisible()) return;
  const deckCards = presDecks.length ? presDecks.map((d) => `
    <div class="settings-card" style="padding:10px 12px;display:flex;gap:12px;align-items:center;margin-bottom:8px">
      <div style="width:110px;height:62px;border-radius:8px;background:#000 center/contain no-repeat ${d.cover ? `url('${d.cover}')` : ''};flex:0 0 auto;border:1px solid var(--border)"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.name)}</div>
        <div style="font-size:12px;color:var(--muted)">${presSummary(d)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button class="btn-mini pres-present-btn" data-kind="deck" data-id="${d.id}" ${d.page_count ? '' : 'disabled'} style="background:var(--accent);color:#fff;border-color:var(--accent)">▶ Present</button>
          <button class="btn-mini pres-edit-btn" data-id="${d.id}">Edit</button>
          <button class="btn-mini pres-del-btn" data-id="${d.id}" style="color:#c0392b">Delete</button>
        </div>
      </div>
    </div>`).join('') : `<div class="empty-state"><div class="emoji">📽️</div><p>No presentations yet.<br>Upload a PDF or some pictures below.</p></div>`;
  const plCards = presPlaylists.map((p) => `
    <div class="settings-card" style="padding:10px 12px;margin-bottom:8px">
      <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">📃 ${escapeHtml(p.name)}</div>
      <div style="font-size:12px;color:var(--muted)">${presPlaylistSummary(p)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        <button class="btn-mini pres-present-btn" data-kind="playlist" data-id="${p.id}" ${p.page_count ? '' : 'disabled'} style="background:var(--accent);color:#fff;border-color:var(--accent)">▶ Present</button>
        <button class="btn-mini pres-pl-edit-btn" data-id="${p.id}">Edit</button>
        <button class="btn-mini pres-pl-del-btn" data-id="${p.id}" style="color:#c0392b">Delete</button>
      </div>
    </div>`).join('');
  $('content').innerHTML = `
    ${photosSubtabBar('presentations')}
    <div class="section-header" style="margin-top:4px">Presentations (${presDecks.length})</div>
    <p style="font-size:12px;color:var(--muted);margin:-4px 0 12px;padding:0 2px">Show a slide deck, a menu, a schedule or any document full screen on a display. Step through it by hand (tap the screen, or use the remote below) or let it run on its own.</p>
    <div id="pres-remote"></div>
    ${deckCards}
    <div id="pres-progress" style="display:none;background:var(--card2);border:1px solid var(--accent);border-radius:12px;padding:14px 16px;margin:12px 0"></div>
    <input type="file" id="pres-file-input" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/gif,.pptx,.ppt,.key,.odp" multiple style="display:none">
    <div class="upload-zone" id="pres-upload-zone">
      <div class="emoji">📄</div>
      <p>Tap to upload a PDF or pictures</p>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin:8px 2px 0;font-size:12px;color:var(--muted)">
      <span>Quality</span>
      <select class="form-input" id="pres-quality" style="width:auto;padding:6px 8px;font-size:12px"><option value="standard">Standard (full HD)</option><option value="high">High (4K screens, bigger files)</option></select>
    </div>
    <p style="font-size:12px;color:var(--muted);margin:10px 2px 0">Using PowerPoint, Keynote or Google Slides? Use File → Save as / Export → PDF, then upload the PDF here. Each page becomes a picture, so animations and videos don't play.</p>
    <div class="section-header" style="margin-top:22px">Playlists (${presPlaylists.length})</div>
    <p style="font-size:12px;color:var(--muted);margin:-4px 0 12px;padding:0 2px">A playlist runs several presentations and photos one after the other on a screen, in a loop.</p>
    ${plCards}
    <button class="btn" id="pres-pl-new" style="background:var(--card);border:1px solid var(--border);padding:10px">+ New playlist</button>
    <div class="section-header" style="margin-top:22px">Schedules</div>
    <p style="font-size:12px;color:var(--muted);margin:-4px 0 12px;padding:0 2px">Have a screen show a presentation or playlist by itself during certain hours. Anything you start by hand wins until you stop it.</p>
    <div id="pres-schedules"></div>
    <div class="section-header" style="margin-top:22px">Phone remote</div>
    <div class="settings-card" style="padding:12px 14px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">Open this page on a phone to start and step through presentations without the app.</div>
      <div id="pres-remote-url" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;word-break:break-all;margin-bottom:8px">${escapeHtml(window.location.origin + '/remote')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn-mini" id="pres-remote-copy">Copy link</button><button class="btn-mini" id="pres-remote-open">Open</button></div>
    </div>`;
  wirePhotosSubtabBar();
  presRemoteSig = '';                                                                  // a fresh page: the remote must draw itself again
  $('pres-upload-zone').addEventListener('click', () => $('pres-file-input').click());
  $('pres-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const id = await presImportFiles(files, { quality: $('pres-quality').value });
    if (id) { presEditId = String(id); renderPresentations(); } else renderPresentations();
  });
  document.querySelectorAll('.pres-edit-btn').forEach((b) => b.addEventListener('click', () => { presEditId = b.dataset.id; renderPresentations(); }));
  document.querySelectorAll('.pres-del-btn').forEach((b) => b.addEventListener('click', async () => {
    const d = presDecks.find((x) => String(x.id) === b.dataset.id);
    if (!confirm(`Delete "${d ? d.name : 'this presentation'}"? Any screen showing it will stop.`)) return;
    const r = await apiFetch(`/api/decks/${b.dataset.id}`, { method: 'DELETE' });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderPresentations();
  }));
  document.querySelectorAll('.pres-pl-edit-btn').forEach((b) => b.addEventListener('click', () => { presPlEditId = b.dataset.id; renderPresentations(); }));
  document.querySelectorAll('.pres-pl-del-btn').forEach((b) => b.addEventListener('click', async () => {
    const p = presPlaylists.find((x) => String(x.id) === b.dataset.id);
    if (!confirm(`Delete "${p ? p.name : 'this playlist'}"? Any screen showing it will stop.`)) return;
    const r = await apiFetch(`/api/playlists/${b.dataset.id}`, { method: 'DELETE' });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderPresentations();
  }));
  $('pres-remote-copy').addEventListener('click', () => copyToClipboard(window.location.origin + '/remote'));
  $('pres-remote-open').addEventListener('click', () => window.open(window.location.origin + '/remote', '_blank'));
  $('pres-pl-new').addEventListener('click', () => {
    showSheet(`
      <h3 style="margin:0 0 10px">New playlist</h3>
      <input class="form-input" id="pres-pl-name" placeholder="e.g. Lunch rotation" maxlength="80">
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-primary" id="pres-pl-create" style="flex:1">Create</button>
        <button class="btn" id="pres-pl-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
      </div>`);
    $('pres-pl-cancel').addEventListener('click', closeSheet);
    $('pres-pl-create').addEventListener('click', async () => {
      const name = $('pres-pl-name').value.trim();
      if (!name) { showToast('Give the playlist a name.'); return; }
      const r = await apiFetch('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      closeSheet(); presPlEditId = String(r.id); renderPresentations();
    });
  });
  document.querySelectorAll('.pres-present-btn').forEach((b) => b.addEventListener('click', () => openPresentOn(b.dataset.kind, Number(b.dataset.id))));
  renderRemote(true);                                                                   // at once, with "Checking…" where a screen has not answered yet
  renderSchedules();
  presPollBusy = true;
  pollPresStates(() => { if (presVisible()) { renderRemote(); renderSchedules(); } }).finally(() => { presPollBusy = false; });
  presPollTimer = setInterval(() => {
    if (!presVisible()) { stopPresPolling(); return; }
    if (document.hidden || presPollBusy) return;                                       // in the background, or the last round is still out
    presPollBusy = true;
    pollPresStates(() => renderRemote()).finally(() => { presPollBusy = false; });
  }, 3000);
}

// ── the remote ───────────────────────────────────────────────────────────────────────────────────────────
let presPending = {}, presLastControl = {}, presRemoteSig = '', presPressAt = 0, presPollBusy = false;
// One screen's state, giving up after 4 seconds so a slow screen never holds up the others (or the first thing the person sees).
const presBad = (r) => !r || r.__networkError || r.__authFailed || r.__parseError;      // apiFetch's way of saying "no real answer" (a dropped connection, a timeout, a bad reply)
function presReadState(deviceId) {
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
  return apiFetch(`/api/screens/${encodeURIComponent(deviceId)}/presentation`, ctl ? { signal: ctl.signal } : {})
    .then((r) => (presBad(r) ? { ok: false } : { ok: true, r })).catch(() => ({ ok: false })).finally(() => { if (timer) clearTimeout(timer); });
}
async function pollPresStates(onEach) {
  const list = presEligibleScreens();
  await Promise.all(list.map((s) => {
    const t0 = Date.now();
    return presReadState(s.device_id).then((x) => {
      if ((presLastControl[s.device_id] || 0) > t0) return;                                                                      // a read that began before a command is out of date
      presStates[s.device_id] = (x.ok && x.r && !x.r.error) ? x.r : { error: (x.r && x.r.error) || 'unreachable' };
      if (onEach) onEach(s.device_id);
    });
  }));
}
const PRES_PENDING_TEXT = { start: 'Starting…', stop: 'Stopping…' };
// The buttons say "rotate_left" for a quarter turn the other way; the screen is told a rotate by -90.
const presBody = (a) => a === 'rotate_left' ? { action: 'rotate', by: -90 } : { action: a };
// "Open the full-screen controller when I start": one choice for this browser, shared by the remote and the "Present on…" sheet.
const presWantsController = () => { try { return localStorage.getItem('pres_open_controller') === '1'; } catch { return false; } };
const presSetWantsController = (on) => { try { localStorage.setItem('pres_open_controller', on ? '1' : '0'); } catch { /* not kept */ } };
const presOpenCtlHtml = (style) => `<label style="display:flex;align-items:center;gap:8px;font-size:12px;${style || ''}"><input type="checkbox" class="pres-open-ctl" ${presWantsController() ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> <span>Open the full-screen controller when I start</span></label>`;
const presWireOpenCtl = (root) => root.querySelectorAll('.pres-open-ctl').forEach((c) => c.addEventListener('change', () => presSetWantsController(c.checked)));
async function presControl(deviceId, body) {
  const a = body.action;
  presPending[deviceId] = PRES_PENDING_TEXT[a] || 'Working…';
  presLastControl[deviceId] = Date.now();
  renderRemote(true);
  let r = null;
  try { r = await apiFetch(`/api/screens/${encodeURIComponent(deviceId)}/presentation`, { method: 'POST', body: JSON.stringify(body) }); }
  catch { r = { error: 'The command could not be sent.' }; }
  if (presBad(r)) r = { error: 'The command could not be sent.' };
  delete presPending[deviceId];
  presLastControl[deviceId] = Date.now();
  if (r && r.error) { showToast('❌ ' + r.error); renderRemote(true); return null; }
  if (r && r.state) presStates[deviceId] = r.state;
  if (a === 'start' && presWantsController() && !presFs) openPresentController(deviceId);
  if (a === 'start') showToast(r.delivered ? 'Presenting ✓' : 'Saved. The screen starts when it next connects.');
  else if (a === 'stop') showToast(r.delivered ? 'Stopped ✓' : 'Stopped. The screen follows within a few seconds.');
  renderRemote(true);
  setTimeout(() => { if (presVisible()) pollPresStates().then(() => renderRemote()); }, 1500);      // confirm with a fresh read
  return r;
}
// What can be started: presentations with pages, playlists with something in them, and recipes (cooked at their own servings). Value "deck:5" / "playlist:3" / "recipe:9".
const presTargetOptions = (cur) => {
  const decks = presDecks.filter((d) => d.page_count), lists = presPlaylists.filter((p) => p.page_count), recs = presRecipes;
  const o = (v, label) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  return (decks.length ? `<optgroup label="Presentations">${decks.map((d) => o('deck:' + d.id, d.name)).join('')}</optgroup>` : '') + (lists.length ? `<optgroup label="Playlists">${lists.map((p) => o('playlist:' + p.id, p.name)).join('')}</optgroup>` : '') + (recs.length ? `<optgroup label="Recipes">${recs.map((r) => o('recipe:' + r.id, r.title)).join('')}</optgroup>` : '');
};
const presParseTarget = (v) => { const [kind, id] = String(v || '').split(':'); return kind && id ? { kind, id: Number(id) } : null; };
function renderRemote(force) {
  const el = $('pres-remote');
  if (!el) return;
  const sig = JSON.stringify([presEligibleScreens().map((s) => [s.device_id, s.name, s.online]), presEligibleScreens().map((s) => { const st = presStates[s.device_id] || {}; return [st.active, st.name, st.mode, st.index, st.page_count, st.source, st.error]; }), presPending, presDecks.map((d) => [d.id, d.name, d.page_count]), presPlaylists.map((p) => [p.id, p.name, p.page_count])]);
  if (!force) {
    if (sig === presRemoteSig) return;                                                                      // nothing changed: leave the buttons alone
    if (Date.now() - presPressAt < 1500) return;                                                            // a finger is on or just left a button
    if (el.contains(document.activeElement) && /^(SELECT|INPUT)$/.test(document.activeElement.tagName)) return;   // do not pull a menu out from under a finger
  }
  presRemoteSig = sig;
  const screens = presEligibleScreens();
  if (!screens.length || (!presDecks.length && !presPlaylists.length && !presRecipes.length)) { el.innerHTML = ''; return; }
  const rows = screens.map((s) => {
    const st = presStates[s.device_id] || {};
    const id = escapeHtml(s.device_id);
    const pend = presPending[s.device_id], dis = pend ? ' disabled' : '';
    let body;
    if (!presStates[s.device_id]) body = `<div style="font-size:12px;color:var(--muted)">Checking…</div>`;
    else if (st.error) body = `<div style="font-size:12px;color:var(--muted)">Can't reach this screen right now.</div>`;
    else if (st.active) {
      const auto = st.mode === 'auto';
      body = `
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px"><span class="notranslate">${escapeHtml(st.name || '')}</span> · <span>page ${st.index + 1} of ${st.page_count}</span> · <span>${auto ? 'running by itself' : 'stepping by hand'}</span>${st.source === 'schedule' ? ' · <span>scheduled</span>' : ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="prev" style="min-width:44px">◀</button>
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="${auto ? 'pause' : 'play'}" style="min-width:76px">${auto ? '❚❚ Pause' : '▶ Play'}</button>
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="next" style="min-width:44px">▶</button>
          <select class="form-input pres-rc-goto"${dis} data-id="${id}" style="width:auto;padding:6px 8px;font-size:12px">${Array.from({ length: st.page_count }, (_, i) => `<option value="${i}" ${i === st.index ? 'selected' : ''}>Page ${i + 1}</option>`).join('')}</select>
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="rotate_left" title="Turn this page a quarter turn to the left" style="min-width:44px">⟲</button>
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="rotate" title="Turn this page a quarter turn" style="min-width:44px">⟳</button>
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="stop" style="color:#c0392b">■ Stop</button>
        </div>`;
    } else {
      body = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <select class="form-input pres-rc-deck"${dis} data-id="${id}" style="width:auto;max-width:60%;padding:6px 8px;font-size:12px">${presTargetOptions('')}</select>
          <button class="btn-mini pres-rc"${dis} data-id="${id}" data-a="start" style="background:var(--accent);color:#fff;border-color:var(--accent)">▶ Start</button>
        </div>`;
    }
    const pendHtml = pend ? `<div style="font-size:12px;color:var(--accent);margin-bottom:6px">${pend}</div>` : '';
    return `<div style="padding:10px 0;border-top:1px solid var(--border)"><div style="font-weight:600;font-size:13px;margin-bottom:6px">🖥️ ${escapeHtml(s.name)}${s.online ? '' : ' <span style="font-weight:400;color:var(--muted)">· offline</span>'}</div>${pendHtml}${body}</div>`;
  }).join('');
  el.innerHTML = `<div class="settings-card" style="padding:12px 14px;margin-bottom:12px"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><div style="font-weight:600;font-size:14px;margin-bottom:2px">Remote control</div><button class="btn-mini pres-fs-open">⛶ Full-screen controller</button></div><div style="font-size:12px;color:var(--muted);margin-bottom:6px">Start a presentation on a screen and step through it from here.</div>${presOpenCtlHtml('color:var(--text);margin-bottom:4px')}${rows}</div>`;
  el.addEventListener('pointerdown', () => { presPressAt = Date.now(); });
  const fsBtn = el.querySelector('.pres-fs-open'); if (fsBtn) fsBtn.addEventListener('click', () => openPresentController());
  el.querySelectorAll('.pres-rc').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.id, a = b.dataset.a;
    if (a === 'start') {
      const sel = el.querySelector(`.pres-rc-deck[data-id="${CSS.escape(id)}"]`);
      const t = sel && presParseTarget(sel.value);
      if (!t) return;
      await presControl(id, { action: 'start', kind: t.kind, id: t.id });
    } else await presControl(id, presBody(a));
  }));
  presWireOpenCtl(el);
  el.querySelectorAll('.pres-rc-goto').forEach((s) => s.addEventListener('change', () => presControl(s.dataset.id, { action: 'goto', index: Number(s.value) })));
}

function openPresentOn(kind, id) {
  const screens = presEligibleScreens();
  const item = (kind === 'playlist' ? presPlaylists : presDecks).find((x) => x.id === id);
  if (!screens.length) { showToast('No screens yet. Connect a display and give it a name in Devices first.'); return; }
  showSheet(`
    <h3 style="margin:0 0 4px">Present on which screen?</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px">${escapeHtml(item ? item.name : '')}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${screens.map((s) => `<button class="pres-pick-screen" data-id="${escapeHtml(s.device_id)}" style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--text);font-size:14px;text-align:left"><span style="font-size:20px">🖥️</span><span>${escapeHtml(s.name)}<span style="display:block;font-size:11px;color:var(--muted)">${s.online ? (s.is_remote ? 'Online · mirror' : 'Online') : (s.is_remote ? 'Offline · mirror' : 'Offline')}</span></span></button>`).join('')}
    </div>
    ${presOpenCtlHtml('color:var(--text);margin-top:12px')}
    <button class="btn" id="pres-pick-cancel" style="width:100%;margin-top:14px;background:var(--card);border:1px solid var(--border)">Cancel</button>`);
  $('pres-pick-cancel').addEventListener('click', closeSheet);
  presWireOpenCtl(document);
  document.querySelectorAll('.pres-pick-screen').forEach((b) => b.addEventListener('click', async () => {
    closeSheet();
    await presControl(b.dataset.id, { action: 'start', kind, id });
  }));
}

// ── schedules: when each screen shows what ───────────────────────────────────────────────────────────────
const presScheduleDays = (days) => { const d = (days || []).slice().sort().join(','); return d === '1,2,3,4,5' ? 'weekdays' : d === '0,6' ? 'weekends' : 'all'; };
function presScheduleRowHtml(deviceId, r) {
  const dv = presScheduleDays(r.days), cur = r.kind && r.id ? `${r.kind}:${r.id}` : '';
  return `<div class="pres-sched-row" data-id="${escapeHtml(deviceId)}" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
    <input type="time" class="form-input pres-sched-start" value="${r.start || '11:00'}" style="width:132px">
    <span style="font-size:12px;color:var(--muted)">to</span>
    <input type="time" class="form-input pres-sched-end" value="${r.end || '14:00'}" style="width:132px">
    <select class="form-input pres-sched-days" style="width:auto"><option value="all" ${dv === 'all' ? 'selected' : ''}>Every day</option><option value="weekdays" ${dv === 'weekdays' ? 'selected' : ''}>Weekdays</option><option value="weekends" ${dv === 'weekends' ? 'selected' : ''}>Weekends</option></select>
    <select class="form-input pres-sched-target" style="width:auto;max-width:100%">${presTargetOptions(cur)}</select>
    <button type="button" class="icon-btn del small pres-sched-del" title="Remove">✕</button>
  </div>`;
}
function renderSchedules() {
  const el = $('pres-schedules');
  if (!el) return;
  const screens = presEligibleScreens();
  if (!screens.length || (!presDecks.some((d) => d.page_count) && !presPlaylists.some((p) => p.page_count) && !presRecipes.length)) { el.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:0 2px">Add a presentation and name a screen in Devices to set a schedule.</div>`; return; }
  el.innerHTML = screens.map((s) => {
    const st = presStates[s.device_id] || {};
    const rules = Array.isArray(st.schedule) ? st.schedule : [];
    const id = escapeHtml(s.device_id);
    return `<div class="settings-card" style="padding:12px 14px;margin-bottom:8px" data-id="${id}">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">🖥️ ${escapeHtml(s.name)}</div>
      ${!presStates[s.device_id] ? `<div style="font-size:12px;color:var(--muted)">Checking…</div>` : st.error ? `<div style="font-size:12px;color:var(--muted)">Can't reach this screen right now.</div>` : `
      <div class="pres-sched-list" data-id="${id}">${rules.map((r) => presScheduleRowHtml(s.device_id, r)).join('')}</div>
      <button type="button" class="pres-sched-add btn-mini" data-id="${id}">+ Add hours</button>`}
    </div>`;
  }).join('');
  const collect = (deviceId) => Array.from(el.querySelectorAll(`.pres-sched-row[data-id="${CSS.escape(deviceId)}"]`)).map((row) => {
    const dv = row.querySelector('.pres-sched-days').value, t = presParseTarget(row.querySelector('.pres-sched-target').value) || {};
    return { start: row.querySelector('.pres-sched-start').value, end: row.querySelector('.pres-sched-end').value, days: dv === 'weekdays' ? [1, 2, 3, 4, 5] : dv === 'weekends' ? [0, 6] : [], kind: t.kind, id: t.id };
  });
  const save = async (deviceId) => {
    const r = await apiFetch(`/api/screens/${encodeURIComponent(deviceId)}/presentation-schedule`, { method: 'PUT', body: JSON.stringify({ schedule: collect(deviceId) }) });
    if (r && r.error) { showToast('❌ ' + r.error); return false; }
    if (presStates[deviceId]) presStates[deviceId].schedule = r.schedule;
    return true;
  };
  const wireRow = (row) => {
    const id = row.dataset.id;
    row.querySelectorAll('input,select').forEach((x) => x.addEventListener('change', () => save(id)));
    row.querySelector('.pres-sched-del').addEventListener('click', async () => { row.remove(); await save(id); });
  };
  el.querySelectorAll('.pres-sched-row').forEach(wireRow);
  el.querySelectorAll('.pres-sched-add').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.id, list = el.querySelector(`.pres-sched-list[data-id="${CSS.escape(id)}"]`);
    if (list.querySelectorAll('.pres-sched-row').length >= 8) { showToast('At most 8 scheduled times.'); return; }
    const first = presTargetOptions('').match(/value="([^"]+)"/);
    const t = first ? presParseTarget(first[1]) : null;
    if (!t) return;
    list.insertAdjacentHTML('beforeend', presScheduleRowHtml(id, { start: '11:00', end: '14:00', days: [], kind: t.kind, id: t.id }));
    wireRow(list.lastElementChild);
    await save(id);
  }));
}

// A page picture turned a quarter at a time (0 / 90 / 180 / 270), filling its box: the box must be position:relative; overflow:hidden; container-type:size.
function presTurnedPic(url, rot) {
  const r = [90, 180, 270].includes(Number(rot)) ? Number(rot) : 0, swap = r === 90 || r === 270;
  return `<img src="${url}" alt="" draggable="false" style="position:absolute;left:50%;top:50%;width:${swap ? '100cqh' : '100%'};height:${swap ? '100cqw' : '100%'};object-fit:contain;transform:translate(-50%,-50%) rotate(${r}deg);display:block">`;
}

// ── the deck editor ──────────────────────────────────────────────────────────────────────────────────────
async function renderDeckEditor(id) {
  const d = await apiFetch(`/api/decks/${id}`).catch(() => null);
  if (!d || d.error) { presEditId = ''; showToast('That presentation no longer exists.'); return renderPresentations(); }
  const opt = (val, label, cur) => `<option value="${val}" ${String(cur) === String(val) ? 'selected' : ''}>${label}</option>`;
  const secs = [0, 5, 8, 10, 15, 20, 30, 45, 60, 120, 300];
  const pages = d.pages.map((p, i) => `
    <div class="pres-page" data-id="${p.id}" data-own-rot="${p.rotation}" style="background:var(--card2);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="position:relative;aspect-ratio:16/9;background:#000;overflow:hidden;container-type:size">${presTurnedPic(p.thumb, p.rotation >= 0 ? p.rotation : d.rotation)}<span style="position:absolute;left:6px;top:4px;font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 3px #000">${i + 1}</span>${p.rotation >= 0 ? `<button class="pres-pg-rotreset" data-id="${p.id}" style="position:absolute;right:4px;top:4px;border:none;border-radius:6px;background:rgba(0,0,0,0.65);color:#fff;font-size:10px;padding:2px 6px;cursor:pointer">Reset turn</button>` : ''}</div>
      <div style="display:flex;align-items:center;gap:4px;padding:5px 6px">
        <button class="btn-mini pres-pg-move" data-id="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Earlier" style="padding:4px 8px">◀</button>
        <button class="btn-mini pres-pg-move" data-id="${p.id}" data-dir="1" ${i === d.pages.length - 1 ? 'disabled' : ''} title="Later" style="padding:4px 8px">▶</button>
        <button class="btn-mini pres-pg-rot" data-id="${p.id}" title="Turn this page a quarter turn" style="padding:4px 8px${p.rotation >= 0 ? ';color:var(--accent);border-color:var(--accent)' : ''}">↻</button>
        <select class="form-input pres-pg-secs" data-id="${p.id}" title="How long this page stays up" style="flex:1;min-width:0;padding:4px 4px;font-size:11px">${opt(0, 'Deck time', p.duration_sec)}${secs.filter((s) => s).map((s) => opt(s, `${s} s`, p.duration_sec)).join('')}</select>
        <button class="btn-mini pres-pg-del" data-id="${p.id}" title="Remove this page" style="padding:4px 8px;color:#c0392b">✕</button>
      </div>
    </div>`).join('');
  $('content').innerHTML = `
    <button class="btn-mini" id="pres-back" style="margin-bottom:10px">‹ All presentations</button>
    <div class="settings-card" style="padding:12px 14px;margin-bottom:12px">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Name</label>
      <input class="form-input" id="pres-name" value="${escapeHtml(d.name)}" maxlength="80">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
        <div style="flex:1;min-width:150px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Moving on</label>
          <select class="form-input" id="pres-interval">${[0, 5, 8, 10, 15, 20, 30, 45, 60, 120, 300].map((s) => opt(s, s === 0 ? 'By hand only' : `Every ${s} seconds`, d.interval_sec)).join('')}</select></div>
        <div style="flex:1;min-width:150px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Between pages</label>
          <select class="form-input" id="pres-transition">${opt('fade', 'Fade', d.transition)}${opt('slide', 'Slide', d.transition)}${opt('none', 'No effect', d.transition)}</select></div>
        <div style="flex:1;min-width:150px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Page fit</label>
          <select class="form-input" id="pres-fit">${opt('contain', 'Show the whole page', d.fit)}${opt('cover', 'Fill the screen (crops)', d.fit)}</select></div>
        <div style="flex:1;min-width:150px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Turn pages</label>
          <select class="form-input" id="pres-rotation">${opt(0, 'Upright', d.rotation)}${opt(90, 'Turned right (90°)', d.rotation)}${opt(180, 'Upside down (180°)', d.rotation)}${opt(270, 'Turned left (270°)', d.rotation)}</select></div>
        <div style="flex:1;min-width:150px"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Behind the page</label>
          <select class="form-input" id="pres-bg">${opt('black', 'Black', d.background)}${opt('white', 'White', d.background)}${opt('blur', 'Blurred page', d.background)}</select></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px"><input type="checkbox" id="pres-loop" ${d.loop ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> Start again after the last page</label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px"><input type="checkbox" id="pres-touch" ${d.touch ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> A tap or swipe on the screen steps through it</label>
    </div>
    <div class="section-header" style="margin-top:4px">Pages (${d.pages.length})</div>
    <div id="pres-pages" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px">${pages}</div>
    <div id="pres-progress" style="display:none;background:var(--card2);border:1px solid var(--accent);border-radius:12px;padding:14px 16px;margin:12px 0"></div>
    <input type="file" id="pres-add-input" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/gif,.pptx,.ppt,.key,.odp" multiple style="display:none">
    <button class="btn btn-primary" id="pres-add-btn">+ Add pages from a PDF or pictures</button>`;
  $('pres-back').addEventListener('click', () => { presEditId = ''; renderPresentations(); });
  const save = async (patch) => { const r = await apiFetch(`/api/decks/${d.id}`, { method: 'PUT', body: JSON.stringify(patch) }); if (r && r.error) showToast('❌ ' + r.error); return r; };
  $('pres-name').addEventListener('change', () => save({ name: $('pres-name').value }));
  $('pres-interval').addEventListener('change', () => save({ interval_sec: Number($('pres-interval').value) }));
  $('pres-transition').addEventListener('change', () => save({ transition: $('pres-transition').value }));
  $('pres-fit').addEventListener('change', () => save({ fit: $('pres-fit').value }));
  $('pres-bg').addEventListener('change', () => save({ background: $('pres-bg').value }));
  $('pres-rotation').addEventListener('change', async () => { await save({ rotation: Number($('pres-rotation').value) }); renderDeckEditor(d.id); });
  document.querySelectorAll('.pres-pg-rot').forEach((b) => b.addEventListener('click', async () => {
    const p = d.pages.find((x) => x.id === Number(b.dataset.id)); if (!p) return;
    const to = (((p.rotation >= 0 ? p.rotation : d.rotation) + 90) % 360);
    const r = await apiFetch(`/api/decks/${d.id}/pages/${p.id}`, { method: 'PUT', body: JSON.stringify({ rotation: to }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderDeckEditor(d.id);
  }));
  document.querySelectorAll('.pres-pg-rotreset').forEach((b) => b.addEventListener('click', async () => {
    const r = await apiFetch(`/api/decks/${d.id}/pages/${b.dataset.id}`, { method: 'PUT', body: JSON.stringify({ rotation: -1 }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderDeckEditor(d.id);
  }));
  $('pres-loop').addEventListener('change', () => save({ loop: $('pres-loop').checked }));
  $('pres-touch').addEventListener('change', () => save({ touch: $('pres-touch').checked }));
  document.querySelectorAll('.pres-pg-move').forEach((b) => b.addEventListener('click', async () => {
    const ids = d.pages.map((p) => p.id), i = ids.indexOf(Number(b.dataset.id)), j = i + Number(b.dataset.dir);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const r = await apiFetch(`/api/decks/${d.id}/order`, { method: 'PUT', body: JSON.stringify({ pageIds: ids }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderDeckEditor(d.id);
  }));
  document.querySelectorAll('.pres-pg-secs').forEach((s) => s.addEventListener('change', async () => {
    const r = await apiFetch(`/api/decks/${d.id}/pages/${s.dataset.id}`, { method: 'PUT', body: JSON.stringify({ duration_sec: Number(s.value) }) });
    if (r && r.error) showToast('❌ ' + r.error);
  }));
  document.querySelectorAll('.pres-pg-del').forEach((b) => b.addEventListener('click', async () => {
    if (d.pages.length === 1 && !confirm('This is the last page. Remove it?')) return;
    const r = await apiFetch(`/api/decks/${d.id}/pages/${b.dataset.id}`, { method: 'DELETE' });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderDeckEditor(d.id);
  }));
  $('pres-add-btn').addEventListener('click', () => $('pres-add-input').click());
  $('pres-add-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    await presImportFiles(files, { deckId: d.id, existingPages: d.pages.length });
    renderDeckEditor(d.id);
  });
}

// ── the playlist editor ──────────────────────────────────────────────────────────────────────────────────
const presPlaylistSummary = (p) => `<span>${p.item_count === 1 ? '1 item' : `${p.item_count} items`}</span> · <span>${p.page_count === 1 ? '1 page' : `${p.page_count} pages`}</span>${p.loop ? ' · <span>repeats</span>' : ''}`;
async function renderPlaylistEditor(id) {
  const [p, decks, photos] = await Promise.all([apiFetch(`/api/playlists/${id}`).catch(() => null), apiFetch('/api/decks').catch(() => []), apiFetch('/api/photos').catch(() => [])]);
  if (!p || p.error) { presPlEditId = ''; showToast('That playlist no longer exists.'); return renderPresentations(); }
  const tags = [...new Set((Array.isArray(photos) ? photos : []).flatMap((x) => String(x.tags || '').split(',').map((t) => t.trim()).filter(Boolean)))].sort();
  const secs = [3, 5, 8, 10, 15, 20, 30, 60];
  const rows = p.items.map((it, i) => `
    <div class="pres-pl-item" data-i="${i}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-bottom:6px">
      <span style="font-size:18px">${it.kind === 'deck' ? '📽️' : '🖼️'}</span>
      <div style="flex:1;min-width:120px"><div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.kind === 'deck' ? escapeHtml(it.label || 'Missing presentation') : (it.ref ? `<span>Photos tagged</span> ${escapeHtml(it.ref)}` : '<span>All photos</span>')}</div>
        <div style="font-size:11px;color:var(--muted)">${it.pages === 1 ? '1 page' : `${it.pages} pages`}</div></div>
      ${it.kind === 'photos' ? `<select class="form-input pres-pl-secs" data-i="${i}" title="Seconds per photo" style="width:auto;padding:4px 6px;font-size:12px">${secs.map((s) => `<option value="${s}" ${it.seconds === s ? 'selected' : ''}>${s} s</option>`).join('')}</select>` : ''}
      <button class="btn-mini pres-pl-move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Earlier" style="padding:4px 8px">◀</button>
      <button class="btn-mini pres-pl-move" data-i="${i}" data-dir="1" ${i === p.items.length - 1 ? 'disabled' : ''} title="Later" style="padding:4px 8px">▶</button>
      <button class="btn-mini pres-pl-rm" data-i="${i}" title="Remove this item" style="padding:4px 8px;color:#c0392b">✕</button>
    </div>`).join('');
  const withPages = (Array.isArray(decks) ? decks : []).filter((d) => d.page_count);
  $('content').innerHTML = `
    <button class="btn-mini" id="pres-back" style="margin-bottom:10px">‹ All presentations</button>
    <div class="settings-card" style="padding:12px 14px;margin-bottom:12px">
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Name</label>
      <input class="form-input" id="pres-pl-nm" value="${escapeHtml(p.name)}" maxlength="80">
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px"><input type="checkbox" id="pres-pl-loop" ${p.loop ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> Start again after the last item</label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px"><input type="checkbox" id="pres-pl-touch" ${p.touch ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> A tap or swipe on the screen steps through it</label>
    </div>
    <div class="section-header" style="margin-top:4px">Items (${p.items.length})</div>
    <p style="font-size:12px;color:var(--muted);margin:-4px 0 10px;padding:0 2px">Presentations keep their own timing, effect and look. Photos get the seconds you choose.</p>
    <div id="pres-pl-items">${rows || '<div class="empty-state"><p>Nothing in this playlist yet.</p></div>'}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px">
      <select class="form-input" id="pres-pl-add-deck" style="width:auto;max-width:60%"><option value="">+ Add a presentation…</option>${withPages.map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
      <select class="form-input" id="pres-pl-add-photos" style="width:auto;max-width:60%"><option value="__none">+ Add photos…</option><option value="">All photos in the slideshow</option>${tags.map((t) => `<option value="${escapeHtml(t)}">Photos tagged ${escapeHtml(t)}</option>`).join('')}</select>
    </div>`;
  $('pres-back').addEventListener('click', () => { presPlEditId = ''; renderPresentations(); });
  const items = p.items.map((it) => ({ kind: it.kind, ref: it.ref, seconds: it.seconds }));
  const saveItems = async () => {
    const r = await apiFetch(`/api/playlists/${p.id}/items`, { method: 'PUT', body: JSON.stringify({ items }) });
    if (r && r.error) { showToast('❌ ' + r.error); return; }
    renderPlaylistEditor(p.id);
  };
  const save = async (patch) => { const r = await apiFetch(`/api/playlists/${p.id}`, { method: 'PUT', body: JSON.stringify(patch) }); if (r && r.error) showToast('❌ ' + r.error); };
  $('pres-pl-nm').addEventListener('change', () => save({ name: $('pres-pl-nm').value }));
  $('pres-pl-loop').addEventListener('change', () => save({ loop: $('pres-pl-loop').checked }));
  $('pres-pl-touch').addEventListener('change', () => save({ touch: $('pres-pl-touch').checked }));
  $('pres-pl-add-deck').addEventListener('change', () => { const v = $('pres-pl-add-deck').value; if (!v) return; items.push({ kind: 'deck', ref: v, seconds: 0 }); saveItems(); });
  $('pres-pl-add-photos').addEventListener('change', () => { const v = $('pres-pl-add-photos').value; if (v === '__none') return; items.push({ kind: 'photos', ref: v, seconds: 10 }); saveItems(); });
  document.querySelectorAll('.pres-pl-move').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.i), j = i + Number(b.dataset.dir); if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; saveItems(); }));
  document.querySelectorAll('.pres-pl-rm').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.i), 1); saveItems(); }));
  document.querySelectorAll('.pres-pl-secs').forEach((s) => s.addEventListener('change', () => { items[Number(s.dataset.i)].seconds = Number(s.value); saveItems(); }));
}

// ── presentation mode: the app as a full-screen controller ──────────────────────────────────────────────
// A full-screen page for one screen: the page that is up now and the next one, huge Previous / Next buttons, Play or Pause, Stop (or Start when nothing is
// showing), and the keyboard (arrows, page keys, space, P, Esc to leave). It asks the browser for real full screen and keeps the phone awake where it can.
let presFs = null;
async function openPresentController(preferId) {
  closePresentController();
  const screens = presEligibleScreens();
  if (!screens.length) { showToast('No screens yet. Connect a display and give it a name in Devices first.'); return; }
  const running = screens.find((s) => (presStates[s.device_id] || {}).active);
  const id = preferId && screens.some((s) => s.device_id === preferId) ? preferId : (running || screens[0]).device_id;
  const el = document.createElement('div');
  el.id = 'pres-fs';
  el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#0b0f1a;color:#eef2fb;display:flex;flex-direction:column;padding:max(10px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));font-family:inherit';
  document.body.appendChild(el);
  presFs = { id, el, timer: null, sig: '', srcKey: '', src: null, wake: null, onKey: null };
  presFs.onKey = (e) => {
    if (!presFs) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
    const st = presStates[presFs.id] || {}, k = e.key;
    let a = null;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter' || k === 'ArrowDown') a = 'next';
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace' || k === 'ArrowUp') a = 'prev';
    else if (k === 'p' || k === 'P') a = st.mode === 'auto' ? 'pause' : 'play';
    else if (k === 'r') a = 'rotate';
    else if (k === 'R') a = 'rotate_left';
    else if (k === 'Escape') { closePresentController(); e.preventDefault(); return; }
    if (a && st.active) { e.preventDefault(); presFsAct(a); }
  };
  document.addEventListener('keydown', presFs.onKey, true);
  const me = presFs;
  try { if (el.requestFullscreen) { await el.requestFullscreen(); if (presFs === me) me.fsOn = true; } } catch { /* the page still fills the window */ }
  if (presFs !== me) return;                                                                      // closed (or opened again) while the browser was going full screen
  try { if (navigator.wakeLock) me.wake = await navigator.wakeLock.request('screen'); } catch { /* not available */ }
  if (presFs !== me) { try { if (me.wake) me.wake.release(); } catch { /* ignore */ } return; }
  await presFsRefresh(true);
  if (presFs !== me) return;
  presFs.timer = setInterval(() => { if (document.hidden || presFs.busy) return; presFs.busy = true; presFsRefresh(false).finally(() => { if (presFs) presFs.busy = false; }); }, 1500);
  document.addEventListener('fullscreenchange', presFsFullscreenChange);
}
function presFsFullscreenChange() { if (presFs && presFs.fsOn && !document.fullscreenElement && presFs.leftOnPurpose !== false) { /* leaving real full screen by the browser's own gesture ends controller mode */ closePresentController(true); } }
function closePresentController(fromBrowser) {
  const f = presFs;
  if (!f) return;
  presFs = null;
  clearInterval(f.timer);
  document.removeEventListener('keydown', f.onKey, true);
  document.removeEventListener('fullscreenchange', presFsFullscreenChange);
  try { if (f.wake) f.wake.release(); } catch { /* ignore */ }
  try { if (!fromBrowser && document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ }
  f.el.remove();
  if (presVisible && presVisible()) { pollPresStates().then(() => renderRemote(true)); }
}
// A recipe's text page, drawn small for the controller's Now and Next previews.
function presTextCard(p) {
  const lines = p.kind === 'cover' ? [p.title] : p.kind === 'ingredients' ? (p.lines || []).slice(0, 5).map((l) => l.group || l.text) : p.kind === 'step' ? [String(p.body || '').slice(0, 140)] : [p.body || ''];
  const head = p.kind === 'step' ? `<div style="font-size:11px;opacity:.7;margin-bottom:4px">${p.n} / ${p.of}</div>` : p.kind === 'ingredients' ? `<div style="font-size:11px;opacity:.7;margin-bottom:4px">${p.part} / ${p.parts}</div>` : '';
  return `<div style="position:absolute;inset:0;padding:8px 10px;overflow:hidden;background:#0b0f1a;color:#eef2fb;font-size:${p.kind === 'cover' ? 15 : 12}px;line-height:1.25;${p.kind === 'cover' || p.kind === 'end' ? 'display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700' : ''}">${head}${p.kind === 'end' && !lines[0] ? '🍽️' : lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')}</div>`;
}
async function presFsRefresh(force) {
  const f = presFs;
  if (!f) return;
  const t0 = Date.now();
  try {
    const x = await presReadState(f.id);
    if ((presLastControl[f.id] || 0) <= t0) presStates[f.id] = (x.ok && x.r && !x.r.error) ? x.r : { error: (x.r && x.r.error) || 'unreachable' };
  } catch { presStates[f.id] = { error: 'unreachable' }; }
  if (presFs !== f) return;
  const st = presStates[f.id] || {};
  const key = st.active ? `${st.active_kind}:${st.active_ref}${st.active_kind === 'recipe' ? ':' + st.servings : ''}` : '';
  if (key && key !== f.srcKey) {
    f.srcKey = key; f.src = null;
    try { f.src = await apiFetch(`/api/present/${encodeURIComponent(st.active_kind)}/${encodeURIComponent(st.active_ref)}${st.active_kind === 'recipe' && st.servings ? '?servings=' + encodeURIComponent(st.servings) : ''}`); } catch { /* no previews, the buttons still work */ }
    if (presFs !== f) return;
  } else if (!key) { f.srcKey = ''; f.src = null; }
  presFsRender(force);
}
async function presFsAct(a) {
  const f = presFs;
  if (!f) return;
  const body = presBody(a);
  if (a === 'start') { const sel = f.el.querySelector('.fs-target'); const t = sel && presParseTarget(sel.value); if (!t) return; body.kind = t.kind; body.id = t.id; }
  const turning = a === 'rotate' || a === 'rotate_left';
  if (turning) { const st = presStates[f.id] || {}, pg = f.src && f.src.pages && f.src.pages[st.index]; if (pg) { pg.rotation = (((Number(pg.rotation) || 0) + (a === 'rotate' ? 90 : 270)) % 360); presFsRender(true); } }   // show the turn at once
  await presControl(f.id, body);
  if (presFs === f) { if (turning) f.srcKey = ''; await presFsRefresh(true); }
}
function presFsRender(force) {
  const f = presFs;
  if (!f) return;
  const screens = presEligibleScreens();
  const st = presStates[f.id] || {};
  const sig = JSON.stringify([f.id, st.active, st.name, st.mode, st.index, st.page_count, st.source, st.error, presPending[f.id], f.srcKey, !!f.src, screens.map((s) => s.device_id)]);
  if (!force && sig === f.sig) return;
  if (!force && f.el.contains(document.activeElement) && /^(SELECT)$/.test(document.activeElement.tagName)) return;
  f.sig = sig;
  const pend = presPending[f.id], dis = pend ? ' disabled' : '';
  const pages = (f.src && f.src.pages) || [];
  const cur = pages[st.index] || null, nxt = pages[st.index + 1] || (f.src && f.src.loop ? pages[0] : null);
  const btn = 'border:none;border-radius:18px;background:#262d44;color:#fff;font:inherit;font-weight:700;cursor:pointer;';
  const big = (id, label, flex, bg) => `<button id="${id}"${dis} style="${btn}flex:${flex};font-size:min(18vw,110px);${bg ? `background:${bg};` : ''}">${label}</button>`;
  const pic = (p, label, w) => `<div style="flex:${w};min-width:0;display:flex;flex-direction:column"><div style="font-size:12px;color:#9aa6c0;margin:0 0 4px">${label}</div><div class="fs-pic" style="flex:1;min-height:0;position:relative;overflow:hidden;container-type:size;background:#000;border-radius:10px;border:1px solid rgba(255,255,255,0.12)">${p && p.type === 'text' ? presTextCard(p) : (p ? presTurnedPic(p.thumb || p.url, p.rotation) : '')}</div></div>`;
  let body;
  if (st.error) body = `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#9aa6c0;text-align:center">Can't reach this screen right now.</div>`;
  else if (st.active) {
    const auto = st.mode === 'auto';
    body = `
      <div style="display:flex;gap:10px;flex:1;min-height:0;margin:8px 0">${pic(cur, 'Now', 3)}${pic(nxt, 'Next', 2)}</div>
      ${pend ? `<div style="text-align:center;color:#4A90D9;font-size:14px;margin-bottom:6px">${pend}</div>` : ''}
      <div style="display:flex;gap:10px;height:34vh;max-height:300px;min-height:120px">${big('fs-prev', '◀', 1)}${big('fs-next', '▶', 1, '#4A90D9')}</div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px">
        <button id="fs-play"${dis} style="${btn}padding:16px 4px;font-size:17px;white-space:nowrap">${auto ? '❚❚ Pause' : '▶ Play'}</button>
        <button id="fs-rotate-left"${dis} style="${btn}padding:16px 4px;font-size:24px" aria-label="Turn left" title="Turn this page a quarter turn to the left">⟲</button>
        <button id="fs-rotate"${dis} style="${btn}padding:16px 4px;font-size:24px" aria-label="Turn right" title="Turn this page a quarter turn to the right">⟳</button>
        <button id="fs-stop"${dis} style="${btn}padding:16px 4px;font-size:17px;color:#e0584c;white-space:nowrap">■ Stop</button>
      </div>`;
  } else {
    body = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
        <div style="color:#9aa6c0">Nothing is showing on this screen.</div>
        ${pend ? `<div style="color:#4A90D9">${pend}</div>` : ''}
        <select class="fs-target"${dis} style="font:inherit;font-size:18px;padding:14px;border-radius:12px;background:#262d44;color:#fff;border:1px solid rgba(255,255,255,0.15);max-width:90%">${presTargetOptions('')}</select>
        <button id="fs-start"${dis} style="${btn}padding:18px 40px;font-size:22px;background:#4A90D9">▶ Start</button>
      </div>`;
  }
  f.el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <select id="fs-screen" style="font:inherit;font-size:15px;padding:8px;border-radius:10px;background:#262d44;color:#fff;border:1px solid rgba(255,255,255,0.15);min-width:0;flex:1">${screens.map((s) => `<option value="${escapeHtml(s.device_id)}" ${s.device_id === f.id ? 'selected' : ''}>🖥️ ${escapeHtml(s.name)}</option>`).join('')}</select>
      <button id="fs-exit" style="${btn}padding:10px 16px;font-size:16px;white-space:nowrap;flex:none" aria-label="Close">✕ Exit</button>
    </div>
    ${st.active ? `<div id="fs-now" style="display:flex;gap:6px;font-size:13px;color:#9aa6c0;margin-top:6px;min-width:0"><span class="notranslate" style="flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(st.name || '')}</span><span style="flex:none;white-space:nowrap">· ${st.index + 1} / ${st.page_count}${st.source === 'schedule' ? ' · <span>scheduled</span>' : ''}</span></div>` : ''}
    ${body}
    <button id="fs-exit2" style="${btn}margin-top:10px;padding:14px;font-size:16px;background:transparent;border:1px solid rgba(255,255,255,0.25)">Exit the controller</button>`;
  const q = (id) => f.el.querySelector('#' + id);
  q('fs-exit').addEventListener('click', () => closePresentController());
  q('fs-exit2').addEventListener('click', () => closePresentController());
  q('fs-screen').addEventListener('change', () => { f.id = q('fs-screen').value; f.srcKey = ''; f.src = null; f.sig = ''; presFsRefresh(true); });
  [['fs-prev', 'prev'], ['fs-next', 'next'], ['fs-stop', 'stop'], ['fs-start', 'start'], ['fs-rotate', 'rotate'], ['fs-rotate-left', 'rotate_left']].forEach(([id, a]) => { const b = q(id); if (b) b.addEventListener('click', () => presFsAct(a)); });
  const pl = q('fs-play'); if (pl) pl.addEventListener('click', () => presFsAct(st.mode === 'auto' ? 'pause' : 'play'));
}
