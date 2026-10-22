// "Screen Rotation" in each screen's card in the Devices tab: turn that screen at the system level (see src/system-rotation.js) without opening the control app on that Pi.
// The host relays the request to the Pi the screen is plugged into (server.js: /api/screens/:deviceId/system-rotation). The same choice, trial and keep-or-put-back step as Settings.
function screenRotationSectionHtml(s) {
  const id = s.device_id, open = typeof openScreenSubAccordions !== 'undefined' && openScreenSubAccordions.has(id + ':rot');
  return `
        <div class="acc-section${open ? ' open' : ''}" data-acc="screensub-${id}-rot">
          <button class="acc-head" data-acc-toggle="screensub-${id}-rot">
            <span class="acc-ic">🔄</span>
            <span class="acc-text"><span class="acc-label">Screen Rotation</span></span>
            <span class="acc-caret">${open ? '▾' : '▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="screensub-${id}-rot" style="${open ? '' : 'display:none'}">
            <div class="sysrot-card" data-id="${id}" data-online="${s.online ? '1' : '0'}">
              <p class="sysrot-note" style="font-size:12px;color:var(--muted);margin:0 0 8px">Open this section to check whether this screen can be turned.</p>
              <div class="sysrot-controls" style="display:none">
                <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <label style="margin-bottom:0">Rotate this screen at the system level</label>
                  <select class="form-input sysrot-select" style="width:auto;max-width:55%">
                    <option value="off">Off</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                    <option value="inverted">Upside down</option>
                  </select>
                </div>
                <p style="font-size:11px;color:var(--muted);margin:6px 0 0">For a Raspberry Pi screen that is turned (on its side or upside down). The Pi's desktop turns the picture itself, so the mouse and touch move the right way, and the app stops turning the page inside the browser for this screen. Pick the way the screen is turned, the same names as Raspberry Pi's Screen Configuration. It tries the change first and puts it back after 20 seconds unless you keep it.</p>
                <div class="sysrot-confirm" style="display:none;margin:8px 0;padding:10px;border:1px solid var(--accent);border-radius:10px">
                  <div style="font-size:13px;margin-bottom:8px">Does the screen look right? It goes back by itself unless you keep this.</div>
                  <div style="display:flex;gap:8px;align-items:center"><button class="icon-btn sysrot-keep" type="button">Keep</button><button class="icon-btn sysrot-back" type="button">Put it back</button><span class="sysrot-sec" style="font-size:13px;color:var(--muted)"></span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
`;
}

// "Mouse Pointer" in the same card: Hidden / Only over whiteboards / Everywhere for that screen (its own setting, made here without opening the control app on that Pi).
function screenPointerSectionHtml(s) {
  const id = s.device_id, open = typeof openScreenSubAccordions !== 'undefined' && openScreenSubAccordions.has(id + ':ptr');
  return `
        <div class="acc-section${open ? ' open' : ''}" data-acc="screensub-${id}-ptr">
          <button class="acc-head" data-acc-toggle="screensub-${id}-ptr">
            <span class="acc-ic">🖱️</span>
            <span class="acc-text"><span class="acc-label">Mouse Pointer</span></span>
            <span class="acc-caret">${open ? '▾' : '▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="screensub-${id}-ptr" style="${open ? '' : 'display:none'}">
            <div class="ptr-card" data-id="${id}" data-online="${s.online ? '1' : '0'}">
              <p class="ptr-note" style="font-size:12px;color:var(--muted);margin:0 0 8px">Open this section to read this screen's setting.</p>
              <div class="ptr-controls" style="display:none">
                <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <label style="margin-bottom:0">Mouse pointer</label>
                  <select class="form-input ptr-select" style="width:auto;max-width:55%">
                    <option value="0">Hidden</option>
                    <option value="board">Only over whiteboards</option>
                    <option value="1">Everywhere</option>
                  </select>
                </div>
                <p style="font-size:11px;color:var(--muted);margin:6px 0 0">For a screen you use with a mouse instead of a touchscreen. The display normally hides the pointer, and on a Raspberry Pi a small tool also hides it after the mouse stops. Choose "Only over whiteboards" to show it just on the whiteboards (a crosshair on the drawing), or "Everywhere" to show it all over this screen. It works at once, with no restart, for this screen only, and on the display itself Ctrl+Shift+M steps through the three choices.</p>
              </div>
            </div>
          </div>
        </div>
`;
}

// Wired once per list render. The screen is asked only when its section is opened (a card for every screen would otherwise call every Pi).
function wireScreenRotation(list) {
  list.querySelectorAll('.sysrot-card').forEach((card) => {
    const id = card.dataset.id, note = card.querySelector('.sysrot-note'), controls = card.querySelector('.sysrot-controls');
    const sel = card.querySelector('.sysrot-select'), conf = card.querySelector('.sysrot-confirm'), sec = card.querySelector('.sysrot-sec');
    const base = '/api/screens/' + encodeURIComponent(id) + '/system-rotation';
    let tick = null, loaded = false;
    const hideConfirm = () => { if (tick) clearInterval(tick); tick = null; conf.style.display = 'none'; };
    const showConfirm = (seconds) => {
      let left = seconds; conf.style.display = 'block'; sec.textContent = left;
      if (tick) clearInterval(tick);
      tick = setInterval(() => { left--; sec.textContent = left > 0 ? left : ''; if (left <= 0) { hideConfirm(); load(); } }, 1000);
    };
    async function load() {
      loaded = true;
      if (card.dataset.online !== '1') { note.textContent = 'This screen is offline.'; note.style.display = ''; controls.style.display = 'none'; loaded = false; return; }
      note.textContent = 'Checking…'; note.style.display = '';
      const r = await apiFetch(base);
      if (!r || r.error) { note.textContent = (r && r.error) || 'Could not reach this screen.'; controls.style.display = 'none'; loaded = false; return; }
      if (!r.supported) { note.textContent = 'This screen cannot be turned from here. It needs a Raspberry Pi desktop.'; controls.style.display = 'none'; return; }
      note.style.display = 'none'; controls.style.display = '';
      sel.value = r.setting || 'off';
      if (r.pendingSeconds > 0) showConfirm(r.pendingSeconds);
    }
    const head = card.closest('.acc-section').querySelector(':scope > .acc-head');
    if (head) head.addEventListener('click', () => { if (!loaded) load(); });
    if (card.closest('.acc-section').classList.contains('open')) load();
    sel.addEventListener('change', async () => {
      const r = await apiFetch(base, { method: 'POST', body: JSON.stringify({ rotation: sel.value }) });
      if (r && r.error) { showToast(r.error); load(); return; }
      if (sel.value === 'off') { hideConfirm(); showToast('Screen rotation turned off'); return; }
      showConfirm(r && r.pendingSeconds ? r.pendingSeconds : 20);
    });
    card.querySelector('.sysrot-keep').addEventListener('click', async () => { await apiFetch(base + '/keep', { method: 'POST', body: '{}' }); hideConfirm(); showToast('Screen rotation kept'); });
    card.querySelector('.sysrot-back').addEventListener('click', async () => { await apiFetch(base + '/revert', { method: 'POST', body: '{}' }); hideConfirm(); load(); showToast('Screen rotation put back'); });
  });
  list.querySelectorAll('.ptr-card').forEach((card) => {
    const id = card.dataset.id, note = card.querySelector('.ptr-note'), controls = card.querySelector('.ptr-controls'), sel = card.querySelector('.ptr-select');
    const base = '/api/screens/' + encodeURIComponent(id) + '/pointer';
    let loaded = false;
    async function load() {
      loaded = true;
      if (card.dataset.online !== '1') { note.textContent = 'This screen is offline.'; note.style.display = ''; controls.style.display = 'none'; loaded = false; return; }
      note.textContent = 'Checking…'; note.style.display = '';
      const r = await apiFetch(base);
      if (!r || r.error) { note.textContent = (r && r.error) || 'Could not reach this screen.'; controls.style.display = 'none'; loaded = false; return; }
      note.style.display = 'none'; controls.style.display = '';
      sel.value = r.mode === '1' || r.mode === 'board' ? r.mode : '0';
    }
    const head = card.closest('.acc-section').querySelector(':scope > .acc-head');
    if (head) head.addEventListener('click', () => { if (!loaded) load(); });
    if (card.closest('.acc-section').classList.contains('open')) load();
    sel.addEventListener('change', async () => {
      const r = await apiFetch(base, { method: 'POST', body: JSON.stringify({ mode: sel.value }) });
      if (r && r.error) { showToast(r.error); load(); return; }
      showToast(sel.value === '1' ? 'Mouse pointer shown' : sel.value === 'board' ? 'Mouse pointer: only over whiteboards' : 'Mouse pointer hidden');
    });
  });
}
