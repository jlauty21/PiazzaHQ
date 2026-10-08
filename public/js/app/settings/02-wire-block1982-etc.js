function renderSettings_Wire_block1982Etc() {
  { const y = $('copyright-year'); if (y) y.textContent = new Date().getFullYear(); }

  // ── Weather provider: show the API key field only for OpenWeatherMap ─────────
  (function wireWeatherProvider() {
    const sel = $('s-weather-provider'), keyRow = $('s-weather-key-row');
    if (sel && keyRow) sel.addEventListener('change', () => {
      keyRow.style.display = sel.value === 'openweathermap' ? '' : 'none';
    });
  })();

  // ── Support the Project card: buttons are already rendered directly in
  // the template above (see hasSupportLinks/supportButtonsHtml at the top
  // of renderSettings — fetched before the template renders so the whole
  // section, header included, simply doesn't exist in the DOM when no
  // links are configured, rather than existing-but-hidden). Nothing left
  // to wire here.

  (function wireTravelProvider() {
    const sel = $('s-travel-provider'), keyRow = $('s-travel-key-row');
    if (sel && keyRow) sel.addEventListener('change', () => {
      keyRow.style.display = sel.value === 'google' ? '' : 'none';
    });
  })();

  (function wireMessageBoardEnable() {
    const cb = $('s-messageboard-enabled'), row = $('s-messageboard-autoclear-row');
    if (cb && row) cb.addEventListener('change', () => {
      row.style.display = cb.checked ? '' : 'none';
    });
  })();

  (function wireWeatherAlertEnable() {
    const cb = $('s-wxalert-enabled'), row = $('s-wxalert-severity-row'), typesRow = $('s-wxalert-types-row');
    if (cb && row) cb.addEventListener('change', () => {
      row.style.display = cb.checked ? '' : 'none';
      if (typesRow) typesRow.style.display = cb.checked ? '' : 'none';
    });
  })();

  (function wireFamilyHubCard() {
    const qrEl = $('hub-qr-container'), linkEl = $('hub-link-text'), copyBtn = $('hub-copy-btn');
    if (!qrEl) return;
    const hubUrl = `${window.location.origin}/hub`;
    if (linkEl) linkEl.textContent = hubUrl;
    // Same qrcodejs library/pattern as the wall-display QR widget (display.html) —
    // generate once the CDN script has actually loaded, since it's deferred and
    // may not be ready yet the instant this card renders.
    function drawQr() {
      if (typeof QRCode === 'undefined') { setTimeout(drawQr, 200); return; }
      qrEl.innerHTML = '';
      try { new QRCode(qrEl, { text: hubUrl, width: 120, height: 120, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); }
      catch (e) { console.error('Family Hub QR render failed:', e); }
    }
    drawQr();
    if (copyBtn) copyBtn.addEventListener('click', () => copyToClipboard(hubUrl));
  })();

  // ── Photo defaults: slider live-preview labels, and show/hide the interval
  // row based on whether slideshow is on ─────────────────────────────────────
  (function wirePhotoDefaults() {
    if ($('s-ps-brightness')) $('s-ps-brightness').addEventListener('input', (e) => {
      $('s-brightness-val').textContent = e.target.value + '%';
    });
    if ($('s-ps-opacity')) $('s-ps-opacity').addEventListener('input', (e) => {
      $('s-opacity-val').textContent = e.target.value + '%';
    });
    if ($('s-ps-slideshow')) $('s-ps-slideshow').addEventListener('change', (e) => {
      const row = $('s-interval-row');
      if (row) {
        row.style.opacity = e.target.value === '1' ? '1' : '.4';
        row.style.pointerEvents = e.target.value === '1' ? 'auto' : 'none';
      }
    });
  })();

  if ($('s-replay-tour')) $('s-replay-tour').addEventListener('click', () => {
    // The tab bar itself is always visible regardless of which tab's content is
    // showing, so the tour can start right from here — no need to navigate away
    // from Settings first.
    startTour();
  });

  if ($('s-replay-checklist')) $('s-replay-checklist').addEventListener('click', async () => {
    try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ checklist_dismissed: '' }) }); } catch {}
    // Unlike the tour, the checklist only renders on the Calendar tab, so
    // actually navigate there to make it visible again.
    const calTab = document.querySelector('.tab[data-tab="calendars"]');
    if (calTab) calTab.click();
  });
}

function renderSettings_wireCustomTheme() {
  (function wireCustomTheme() {
    const bgFile = $('custom-bg-file');
    const triggerBgUpload = () => bgFile && bgFile.click();
    if ($('custom-bg-upload')) $('custom-bg-upload').addEventListener('click', triggerBgUpload);
    if ($('custom-bg-replace')) $('custom-bg-replace').addEventListener('click', triggerBgUpload);
    if ($('custom-bg-remove')) $('custom-bg-remove').addEventListener('click', async () => {
      if (!confirm('Remove the custom background?')) return;
      await apiFetch('/api/custom-theme/background', { method: 'DELETE' });
      showToast('Background removed');
      renderSettings();
    });
    if (bgFile) bgFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('image', file);
      showToast('Uploading…');
      // See /api/photos' upload handler above — same bug.
      const data = await apiFetch('/api/custom-theme/background', { method: 'POST', body: fd });
      if (data.error) showToast('Upload failed: ' + data.error);
      else showToast('Background uploaded ✓');
      renderSettings();
    });

    document.querySelectorAll('.custom-deco-upload, .custom-deco-replace').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.querySelector(`.custom-deco-file[data-slot="${btn.dataset.slot}"]`);
        if (input) input.click();
      });
    });
    document.querySelectorAll('.custom-deco-file').forEach(input => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('image', file);
        showToast('Uploading…');
        // See /api/photos' upload handler above — same bug.
        const data = await apiFetch(`/api/custom-theme/decoration/${input.dataset.slot}`, { method: 'POST', body: fd });
        if (data.error) showToast('Upload failed: ' + data.error);
        else showToast('Decoration uploaded ✓');
        renderSettings();
      });
    });
    document.querySelectorAll('.custom-deco-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this decoration?')) return;
        await apiFetch(`/api/custom-theme/decoration/${btn.dataset.slot}`, { method: 'DELETE' });
        showToast('Decoration removed');
        renderSettings();
      });
    });
    document.querySelectorAll('.custom-deco-behavior').forEach(sel => {
      sel.addEventListener('change', async () => {
        await apiFetch(`/api/custom-theme/decoration/${sel.dataset.slot}/behavior`, {
          method: 'PUT', body: JSON.stringify({ behavior: sel.value }),
        });
        showToast('Behavior updated ✓');
      });
    });
  })();
}

function renderSettings_wireSavedThemes() {
  (function wireSavedThemes() {
    const listEl = $('saved-themes-list');
    if (!listEl) return;

    async function loadSavedThemes() {
      let themes = [];
      try { themes = await apiFetch('/api/custom-themes'); } catch { themes = []; }
      if (!Array.isArray(themes) || !themes.length) {
        listEl.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">No saved themes yet.</p>`;
        return;
      }
      listEl.innerHTML = themes.map(t => `
        <div class="settings-card" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px">
          ${t.bg_file ? `<img src="${t.bg_file}" style="width:44px;height:30px;object-fit:cover;border-radius:6px;border:1px solid var(--border);flex-shrink:0">` : `<div style="width:44px;height:30px;border-radius:6px;background:var(--card);border:1px solid var(--border);flex-shrink:0"></div>`}
          <div style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.name)}</div>
          <button type="button" class="ghost small theme-load" data-id="${t.id}">Load</button>
          <button type="button" class="icon-btn theme-rename" data-id="${t.id}" data-name="${escapeHtml(t.name)}" title="Rename">✏️</button>
          <button type="button" class="icon-btn del theme-delete" data-id="${t.id}" title="Delete">🗑️</button>
        </div>`).join('');

      listEl.querySelectorAll('.theme-load').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Load this theme? It will replace the background/decorations above — save your current edits first if you want to keep them.')) return;
        const r = await apiFetch(`/api/custom-themes/${b.dataset.id}/load`, { method: 'POST' });
        if (r && r.ok) { showToast(`✓ Loaded "${r.loadedThemeName}"`); renderSettings(); }
        else showToast('❌ ' + ((r && r.error) || 'Could not load theme'));
      }));
      listEl.querySelectorAll('.theme-rename').forEach(b => b.addEventListener('click', async () => {
        const name = prompt('Rename theme:', b.dataset.name);
        if (!name || !name.trim() || name.trim() === b.dataset.name) return;
        await apiFetch(`/api/custom-themes/${b.dataset.id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
        loadSavedThemes();
      }));
      listEl.querySelectorAll('.theme-delete').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete this saved theme? This only removes the saved copy — it won\'t change what\'s currently active above.')) return;
        await apiFetch(`/api/custom-themes/${b.dataset.id}`, { method: 'DELETE' });
        loadSavedThemes();
      }));
    }

    if ($('save-theme-btn')) $('save-theme-btn').addEventListener('click', async () => {
      const name = prompt('Save the current background + decorations as a theme named:');
      if (!name || !name.trim()) return;
      const r = await apiFetch('/api/custom-themes', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      if (r && r.id) { showToast(`✓ Saved "${r.name}"`); loadSavedThemes(); }
      else showToast('❌ ' + ((r && r.error) || 'Could not save theme'));
    });

    loadSavedThemes();
  })();
}

function renderSettings_wireBetaChecklist(_c) {
  const { renderChecklistMarkdown } = _c;
  (function wireBetaChecklist() {
    const el = $('beta-checklist-content');
    if (!el) return;
    const load = () => apiFetch('/api/beta-checklist').then(r => {
      if (!r || r.__authFailed || r.error) {
        el.innerHTML = `<p style="color:var(--muted)">${(r && r.error) || 'Could not load BETA_CHECKLIST.md.'}</p>`;
        return;
      }
      // checkedIndices comes from the database (beta_checklist_checked),
      // not from [ ]/[x] markers in the file content — those markers are
      // ignored entirely now. See the endpoint's own server-side comment
      // for why: the file gets wholesale-replaced on every update, so a
      // checkmark stored IN it would silently vanish on the very next
      // beta; the database survives updates, so checked state lives there.
      el.innerHTML = renderChecklistMarkdown(r.content || '', new Set(r.checkedIndices || []));
      wireChecklistTaps();
    }).catch(() => { el.innerHTML = `<p style="color:var(--muted)">Could not load BETA_CHECKLIST.md.</p>`; });
    // Tapping an item flips it optimistically (instant feedback) before the
    // server confirms, then reconciles with a full reload either way — on
    // success the reload just reflects what's already showing; on failure
    // it reverts the optimistic change back to the real saved state
    // rather than leaving the UI showing something that didn't actually
    // save.
    function wireChecklistTaps() {
      el.querySelectorAll('.beta-checklist-item').forEach(li => {
        li.addEventListener('click', async () => {
          const index = parseInt(li.dataset.index);
          const wasDone = li.dataset.done === '1';
          li.dataset.done = wasDone ? '0' : '1';
          li.style.opacity = wasDone ? '' : '.55';
          li.style.textDecoration = wasDone ? '' : 'line-through';
          const mark = li.querySelector('.beta-checklist-mark');
          if (mark) mark.textContent = wasDone ? '☐' : '✅';
          const r = await apiFetch('/api/beta-checklist/toggle', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ index }) });
          if (!r || !r.ok) { showToast('❌ Could not save — reloading'); load(); }
        });
      });
    }
    load();
  })();
}

function renderSettings_wireBackup() {
  (function wireBackup() {
    const btn = $('backup-download-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const status = $('backup-status');
      btn.disabled = true;
      status.textContent = 'Preparing backup… this can take a moment depending on how many photos you have.';
      try {
        const resp = await fetch('/api/backup/download');
        if (!resp.ok) {
          let msg = 'Backup failed.';
          try { const j = await resp.json(); if (j.error) msg = j.error; } catch {}
          status.textContent = '❌ ' + msg;
          btn.disabled = false;
          return;
        }
        const blob = await resp.blob();
        const cd = resp.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="?([^"]+)"?/);
        const filename = match ? match[1] : 'piazzahq-backup.zip';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        status.textContent = 'Backup downloaded ✓';
        setTimeout(() => { if (status.textContent === 'Backup downloaded ✓') status.textContent = ''; }, 4000);
      } catch (e) {
        status.textContent = '❌ Backup failed — check your connection and try again.';
      }
      btn.disabled = false;
    });
  })();
}

function renderSettings_wireRestore() {
  (function wireRestore() {
    const pickBtn = $('restore-pick-btn'), fileInput = $('restore-file-input'),
      nameEl = $('restore-filename'), goBtn = $('restore-go-btn'), status = $('restore-status');
    if (!pickBtn) return;
    let selectedFile = null;

    pickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files && fileInput.files[0];
      if (!selectedFile) { nameEl.textContent = ''; goBtn.style.display = 'none'; return; }
      nameEl.textContent = `Selected: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(1)} MB)`;
      goBtn.style.display = '';
      status.textContent = '';
    });

    goBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      if (!confirm(
        'This replaces EVERYTHING currently on this device — every event, layout, chore, photo, and setting — ' +
        'with what\'s in this backup file. A safety copy of the current data is kept automatically, but this ' +
        'cannot be undone from within the app. Continue?'
      )) return;

      goBtn.disabled = true; pickBtn.disabled = true;
      status.textContent = 'Uploading and restoring… this can take a while for a large backup. Don\'t close this page.';
      try {
        const formData = new FormData();
        formData.append('backup', selectedFile);
        const resp = await fetch('/api/backup/restore', { method: 'POST', body: formData });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          status.textContent = '❌ ' + (j.error || 'Restore failed.');
          goBtn.disabled = false; pickBtn.disabled = false;
          return;
        }
        status.textContent = '✓ ' + (j.message || 'Restored — restarting now.');
        // The server process restarts itself a moment after responding (same
        // as a code update does) — give it a few seconds, then reload so the
        // person lands back in the app with their restored data rather than
        // needing to notice the disconnect and refresh by hand themselves.
        setTimeout(() => { location.reload(); }, 4000);
      } catch (e) {
        status.textContent = '❌ Restore failed — check your connection and try again.';
        goBtn.disabled = false; pickBtn.disabled = false;
      }
    });
  })();
}

function renderSettings_wireFeedback(_c) {
  const { s } = _c;
  (function wireFeedback() {
    const submitBtn = $('fb-submit-btn');
    if (!submitBtn) return;
    const status = $('fb-status');

    // Load developer replies. By default shows only threads with NEW (unread) replies
    // and marks them seen. "Show past replies" re-fetches the full history (all threads
    // that have any developer reply) WITHOUT marking anything, so the user can review.
    async function loadFeedbackReplies(showAll = false) {
      let data;
      try { data = await apiFetch('/api/feedback-replies' + (showAll ? '?all=1' : '')); } catch { return; }
      const box = $('fb-replies');
      if (!box) return;
      const threads = (data && data.threads) || [];

      if (!threads.length) {
        if (showAll) {
          box.style.display = '';
          box.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:8px">No past replies.</div>` +
            `<button class="fb-replies-toggle" data-mode="unread" style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0">Hide past replies</button>`;
          wireRepliesToggle(box);
        } else {
          box.style.display = 'none'; box.innerHTML = '';
          // Even with no unread, offer a way to view history.
          renderShowPastLink(box);
        }
        return;
      }

      box.style.display = '';
      // Each thread is a tappable row that opens a full-screen, messaging-app
      // style conversation view (openFeedbackThread) — replying inline in the
      // long Settings page meant the on-screen keyboard shoved the original
      // message off-screen and the page kept scrolling behind it.
      box.innerHTML = `<div style="font-weight:700;font-size:14px;margin-bottom:8px;color:var(--accent)">💬 ${showAll ? 'Your conversations' : 'Replies from the developer'}</div>` +
        threads.map(t => {
          const msgs = t.thread || [];
          const last = msgs[msgs.length - 1] || {};
          const preview = (last.text || '').replace(/\s+/g, ' ').slice(0, 90);
          return `
          <button class="fb-thread-open" data-id="${t.id}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--accent);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--card);color:var(--text);cursor:pointer">
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;color:var(--muted);margin-bottom:3px">Your ${escapeHtml(t.kind||'feedback')} · ${msgs.length} message${msgs.length===1?'':'s'}</div>
              <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${last.text ? `<b>${last.from==='dev'?'Developer: ':'You: '}</b>${escapeHtml(preview)}` : '<span style="color:var(--muted)">Tap to open</span>'}</div>
            </div>
            ${!showAll ? '<span style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex:0 0 auto"></span>' : ''}
            <span style="color:var(--muted);font-size:18px;flex:0 0 auto">›</span>
          </button>`;
        }).join('') +
        `<button class="fb-replies-toggle" data-mode="${showAll ? 'unread' : 'all'}" style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer;padding:0">${showAll ? 'Hide past replies' : 'Show past replies'}</button>`;

      box.querySelectorAll('.fb-thread-open').forEach(btn => btn.addEventListener('click', () => {
        const t = threads.find(x => String(x.id) === btn.dataset.id);
        if (t) openFeedbackThread(t);
      }));

      // Only mark seen when viewing the default (unread) view — viewing history shouldn't
      // clear the "new reply" state prematurely.
      if (!showAll) {
        threads.forEach(t => { apiFetch(`/api/feedback-replies/${t.id}/seen`, { method:'POST' }).catch(()=>{}); });
      }
      wireRepliesToggle(box);
    }

    function ensureFeedbackThreadCss() {
      if (document.getElementById('fbt-css')) return;
      const st = document.createElement('style');
      st.id = 'fbt-css';
      st.textContent = `
        .fbt-overlay{position:fixed;left:0;top:0;width:100%;z-index:100000;background:var(--bg);display:flex;flex-direction:column;overscroll-behavior:contain}
        .fbt-head{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:12px 12px;border-bottom:1px solid var(--border);background:var(--card)}
        .fbt-back{background:none;border:none;color:var(--accent);font-size:30px;line-height:1;cursor:pointer;padding:0 6px}
        .fbt-title{font-size:15px;font-weight:700}
        .fbt-sub{font-size:11px;color:var(--muted)}
        .fbt-body{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;display:flex;flex-direction:column;gap:8px;overscroll-behavior:contain}
        .fbt-msg{display:flex;flex-direction:column;max-width:82%}
        .fbt-msg.me{align-self:flex-end;align-items:flex-end}
        .fbt-msg.them{align-self:flex-start;align-items:flex-start}
        .fbt-bubble{padding:9px 12px;border-radius:15px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word}
        .fbt-msg.me .fbt-bubble{background:var(--accent);color:#fff;border-bottom-right-radius:4px}
        .fbt-msg.them .fbt-bubble{background:var(--card);border:1px solid var(--border);border-bottom-left-radius:4px}
        .fbt-time{font-size:10px;color:var(--muted);margin-top:2px}
        .fbt-input{flex:0 0 auto;display:flex;gap:8px;align-items:flex-end;padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--border);background:var(--card)}
        .fbt-input textarea{flex:1;resize:none;border:1px solid var(--border);border-radius:18px;padding:9px 14px;font:inherit;font-size:14px;background:var(--bg);color:var(--text);max-height:120px;line-height:1.4}
        .fbt-input button{flex:0 0 auto;width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:16px;cursor:pointer}
        .fbt-input button:disabled{opacity:.5}
      `;
      document.head.appendChild(st);
    }

    function openFeedbackThread(t) {
      if (!t) return;
      ensureFeedbackThreadCss();
      const ov = document.createElement('div');
      ov.className = 'fbt-overlay';
      ov.innerHTML = `
        <div class="fbt-head">
          <button class="fbt-back" aria-label="Back">‹</button>
          <div><div class="fbt-title">Your ${escapeHtml(t.kind || 'feedback')}</div><div class="fbt-sub">Conversation with the developer</div></div>
        </div>
        <div class="fbt-body" id="fbt-body"></div>
        <div class="fbt-input">
          <textarea id="fbt-text" rows="1" placeholder="Message…" autocomplete="off"></textarea>
          <button id="fbt-send" aria-label="Send">➤</button>
        </div>`;
      document.body.appendChild(ov);
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const bodyEl = ov.querySelector('#fbt-body');
      const textEl = ov.querySelector('#fbt-text');
      const sendBtn = ov.querySelector('#fbt-send');

      const renderMsgs = () => {
        bodyEl.innerHTML = (t.thread || []).map(m => `
          <div class="fbt-msg ${m.from === 'dev' ? 'them' : 'me'}">
            <div class="fbt-bubble">${escapeHtml(m.text || '')}</div>
            ${m.at ? `<div class="fbt-time">${escapeHtml(m.at)}</div>` : ''}
          </div>`).join('');
      };
      const toBottom = () => { bodyEl.scrollTop = bodyEl.scrollHeight; };
      renderMsgs();
      requestAnimationFrame(toBottom);

      // Keep the whole view (and the input bar) sized to the space the
      // on-screen keyboard leaves — the "messaging app" behaviour. Must also
      // track vv.offsetTop, not just vv.height: this overlay is
      // position:fixed with top:0, which pins it to the LAYOUT viewport.
      // On iOS Safari, focusing the input scrolls the page so the keyboard
      // doesn't cover it, which shifts the VISUAL viewport's offsetTop down
      // — height-only tracking left the box shrunk to the keyboard-open
      // height but still anchored at the old top:0, so its top portion
      // scrolled out of view while it shrank, reading as the whole message
      // area collapsing. Re-pinning top to vv.offsetTop keeps the overlay
      // matched to what's actually on screen.
      const vv = window.visualViewport;
      const fit = () => {
        if (vv) { ov.style.height = vv.height + 'px'; ov.style.top = vv.offsetTop + 'px'; }
        else { ov.style.height = window.innerHeight + 'px'; }
        toBottom();
      };
      fit();
      if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }

      const autoGrow = () => { textEl.style.height = 'auto'; textEl.style.height = Math.min(textEl.scrollHeight, 120) + 'px'; };
      textEl.addEventListener('input', autoGrow);

      const close = () => {
        if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
        ov.remove();
        document.body.style.overflow = prevOverflow;
        loadFeedbackReplies();
      };
      ov.querySelector('.fbt-back').addEventListener('click', close);

      const send = async () => {
        const text = textEl.value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        t.thread = [...(t.thread || []), { from: 'user', text, at: '' }];
        renderMsgs();
        textEl.value = ''; autoGrow(); toBottom();
        try {
          await apiFetch(`/api/feedback-replies/${t.id}`, { method: 'POST', body: JSON.stringify({ text }) });
        } catch { showToast('Could not send — check your connection'); }
        sendBtn.disabled = false;
        textEl.focus();
      };
      sendBtn.addEventListener('click', send);
      textEl.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
      });
      setTimeout(() => textEl.focus(), 80);
    }
    // Let the "developer replied" banner jump straight into a conversation.
    window.__openFeedbackThread = openFeedbackThread;
    window.__markFeedbackThreadSeen = (id) => { apiFetch(`/api/feedback-replies/${id}/seen`, { method: 'POST' }).catch(() => {}); };

    function renderShowPastLink(box) {
      // A subtle link so the user can always pull up history even with nothing unread.
      box.style.display = '';
      box.innerHTML = `<button class="fb-replies-toggle" data-mode="all" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0">Show past replies from the developer</button>`;
      wireRepliesToggle(box);
    }

    function wireRepliesToggle(box) {
      const btn = box.querySelector('.fb-replies-toggle');
      if (btn) btn.addEventListener('click', () => loadFeedbackReplies(btn.dataset.mode === 'all'));
    }

    loadFeedbackReplies();

    let fbImageFile = null;
    // Photo picker
    const photoBtn = $('fb-photo-btn'), imageInput = $('fb-image'), preview = $('fb-image-preview');
    if (photoBtn) {
      photoBtn.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', () => {
        fbImageFile = imageInput.files && imageInput.files[0] || null;
        if (fbImageFile) {
          const url = URL.createObjectURL(fbImageFile);
          preview.innerHTML = `<div style="display:flex;align-items:center;gap:10px">
            <img src="${url}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">
            <span style="font-size:13px;color:var(--muted);flex:1">${escapeHtml(fbImageFile.name)}</span>
            <button type="button" id="fb-image-clear" class="icon-btn">✕</button></div>`;
          photoBtn.textContent = '📷 Change photo';
          const clr = $('fb-image-clear');
          if (clr) clr.addEventListener('click', () => { fbImageFile = null; imageInput.value=''; preview.innerHTML=''; photoBtn.textContent='📷 Add a photo (optional)'; });
        }
      });
    }
    submitBtn.addEventListener('click', async () => {
      const message = $('fb-message').value.trim();
      if (!message) { status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = 'Please enter a message first.'; return; }
      submitBtn.disabled = true;
      status.style.color = 'var(--muted)'; status.textContent = 'Sending…';
      try {
        // Use FormData so an optional screenshot can ride along.
        const fd = new FormData();
        fd.append('kind', $('fb-kind').value);
        fd.append('message', message);
        fd.append('device_name', (s.display_name || ''));
        if (fbImageFile) fd.append('image', fbImageFile);
        const r = await apiFetch('/api/feedback', { method:'POST', body: fd });
        if (r && r.ok) {
          status.style.color = 'var(--accent)'; status.textContent = '✓ Thanks — your note was sent.';
          $('fb-message').value = '';
          fbImageFile = null; if (imageInput) imageInput.value=''; if (preview) preview.innerHTML='';
          if (photoBtn) photoBtn.textContent = '📷 Add a photo (optional)';
        } else {
          status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = (r && r.error) || 'Could not send.';
        }
      } catch { status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = 'Could not send — check your connection.'; }
      submitBtn.disabled = false;
    });

    // Digest config. Recipient is hardcoded to the developer server-side, so we only
    // expose the enable toggle and the send time here.
    const enabled = $('fb-digest-enabled'), fields = $('fb-digest-fields');
    const time = $('fb-time');
    if (s.feedback_enabled === '1') { enabled.checked = true; fields.style.display = 'block'; }
    time.value = s.feedback_time || '08:00';
    // Central server fields
    const cUrl = $('fb-central-url'), cKey = $('fb-central-key');
    if (cUrl) cUrl.value = s.feedback_central_url || '';
    if (cKey) cKey.value = s.feedback_central_key || '';
    const saveDigest = async () => {
      await apiFetch('/api/settings', { method:'PUT', body: JSON.stringify({
        feedback_enabled: enabled.checked ? '1' : '0',
        feedback_time: time.value || '08:00',
        feedback_central_url: cUrl ? cUrl.value.trim() : '',
        feedback_central_key: cKey ? cKey.value.trim() : '',
      }) });
    };
    enabled.addEventListener('change', () => { fields.style.display = enabled.checked ? 'block' : 'none'; saveDigest(); });
    time.addEventListener('change', saveDigest);
    if (cUrl) cUrl.addEventListener('change', saveDigest);
    if (cKey) cKey.addEventListener('change', saveDigest);
  })();
}

function renderSettings_wireMultiDevice(_c) {
  const { renderOtherDevicesBody } = _c;
  (function wireMultiDevice() {
    const role = $('md-role');
    if (!role) return;
    const slaveFields = $('md-slave-fields'), hostInfo = $('md-host-info');
    const statusEl = $('md-sync-status');
    const toggle = () => {
      const isSlave = role.value === 'slave';
      if (slaveFields) slaveFields.style.display = isSlave ? '' : 'none';
      if (hostInfo) hostInfo.style.display = isSlave ? 'none' : '';
    };
    role.addEventListener('change', toggle);

    // Save role + host address settings (these are local-only, saved directly).
    const saveMd = async () => {
      await apiFetch('/api/settings', { method:'PUT', body: JSON.stringify({
        device_role: role.value,
        host_ts_address: ($('md-host-ts')?.value || '').trim(),
        host_lan_address: ($('md-host-lan')?.value || '').trim(),
        host_port: ($('md-host-port')?.value || '3000').trim(),
        sync_interval_min: $('md-sync-interval')?.value || '5',
      })});
    };
    [role, $('md-host-ts'), $('md-host-lan'), $('md-host-port'), $('md-sync-interval')]
      .forEach(el => el && el.addEventListener('change', saveMd));

    if ($('md-auto-push')) $('md-auto-push').addEventListener('change', async (e) => {
      await apiFetch('/api/settings', { method:'PUT', body: JSON.stringify({
        auto_push_updates: e.target.checked ? '1' : '0'
      })});
      showToast(e.target.checked ? 'Auto-push enabled' : 'Auto-push disabled');
    });

    if ($('md-test-btn')) $('md-test-btn').addEventListener('click', async () => {
      await saveMd();
      statusEl.textContent = 'Testing…';
      try {
        const r = await apiFetch('/api/sync/test');
        statusEl.textContent = r.ok
          ? `✓ Connected to host (v${r.hostVersion||'?'}, ${r.photos||0} photos) via ${r.via}`
          : `✗ ${r.error || 'Could not reach host'}${r.via ? ' ('+r.via+')' : ''}`;
      } catch (e) { statusEl.textContent = '✗ ' + (e.message||'Test failed'); }
    });

    if ($('md-sync-now-btn')) $('md-sync-now-btn').addEventListener('click', async () => {
      await saveMd();
      statusEl.textContent = 'Syncing…';
      try {
        const r = await apiFetch('/api/sync/now', { method:'POST' });
        statusEl.textContent = (r.status === 'ok' ? '✓ Synced' : '✗ ' + r.status) +
          (r.at ? ' · ' + new Date(r.at).toLocaleString() : '');
        showToast(r.status === 'ok' ? 'Synced from host ✓' : 'Sync failed');
      } catch (e) { statusEl.textContent = '✗ ' + (e.message||'Sync failed'); }
    });

    if ($('md-promote-btn')) $('md-promote-btn').addEventListener('click', async () => {
      if (!confirm('Make THIS display the host?\n\nIt will serve its last-synced content as the new source of truth. You must then point your other displays at this device. Continue?')) return;
      try {
        await apiFetch('/api/sync/promote', { method:'POST' });
        showToast('This device is now the host');
        role.value = 'host'; toggle();
      } catch (e) { showToast('Promotion failed'); }
    });

    renderOtherDevicesBody();
  })();
}

function renderSettings_wireUpdate() {
  (function wireUpdate() {
    const verEl = $('app-version');
    const licenseKeyInput = $('update-license-key');
    const status = $('update-status');
    if (!verEl && !licenseKeyInput) return;

    // Show current version. Uses apiFetch (not plain fetch) so the session
    // token actually gets attached — this was the real bug: /api/version
    // requires auth, and a plain, unauthenticated fetch() 401s unconditionally
    // regardless of whether the session is valid, logged in, incognito or not.
    // Every other call in this same function already uses apiFetch; this one
    // was the outlier. Note apiFetch's contract differs from plain fetch: it
    // already awaits and returns the parsed JSON body directly (not a Response
    // with .ok/.json()), and returns {__authFailed:true} on a genuine 401
    // (while also triggering the PIN screen itself as a side effect — the
    // right behavior for an actually-expired session, not just a silently
    // blank version field).
    apiFetch('/api/version').then(d => {
      if (!d || d.__authFailed) throw new Error('version check failed (unauthorized)');
      if (verEl) verEl.textContent = 'v' + (d.version || '?');
    }).catch(() => { if (verEl) verEl.textContent = 'unknown'; });

    // Load the saved license key. Updates themselves are always automatic now —
    // there is no manual/auto choice, no beta channel, and no manual zip upload
    // in this UI; the device just stays current on its own in the background.
    apiFetch('/api/settings').then(s => {
      if (!s) return;
      if (licenseKeyInput && s.update_license_key) licenseKeyInput.value = s.update_license_key;
      // Account Status (trial/access-ends/"Manage your license") hidden —
      // Piazza HQ is being offered free right now, so this info and the
      // license-management link have no reason to show. renderLicenseStatus()
      // itself is left intact below, just not called, so this is a one-line
      // uncomment away from coming back if that changes later.
      // renderLicenseStatus(s);
    });

    // license_status_cache / trial_until_cache are populated by the same
    // periodic mothership check-in (or the on-demand refresh below) that
    // decides things like the widget-count limit — this just surfaces that
    // same information to the person instead of leaving it invisible until
    // something breaks because of it.
    function renderLicenseStatus(s) {
      const row = $('license-status-row'), info = $('license-status-info');
      if (!row || !info) return;
      const statusRaw = s.license_status_cache || '';
      if (!statusRaw) return; // never checked in with the mothership yet — nothing to show
      const STATUS_META = {
        active:   { label: 'Active',                color: 'var(--good, #3ec97a)' },
        free:     { label: 'Free',                  color: 'var(--good, #3ec97a)' },
        past_due: { label: 'Payment past due',       color: '#e0a030' },
        canceled: { label: 'Canceled',                color: 'var(--danger, #ff5d5d)' },
        none:     { label: 'No license key yet — still free', color: 'var(--muted)' },
        trial:    { label: 'Trial (legacy)',        color: 'var(--muted)' },
      };
      const meta = STATUS_META[statusRaw] || { label: statusRaw, color: 'var(--muted)' };
      const accessThrough = s.trial_until_cache || '';
      let expiryHtml = '';
      if (accessThrough) {
        const d = new Date(accessThrough);
        const dateStr = isNaN(d) ? accessThrough : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        const verb = statusRaw === 'active' ? 'Access continues through' : (statusRaw === 'none' ? 'Free access through' : 'Access ends');
        expiryHtml = `<br><span style="color:var(--muted);font-size:12px">${verb} ${dateStr}.</span>`;
      }
      const serverUrl = (s.update_server_url || '').trim().replace(/\/$/, '');
      const activateHtml = (statusRaw !== 'active' && serverUrl)
        ? `<br><a href="${serverUrl}/#get-started" target="_blank" rel="noopener" style="color:var(--accent);font-size:12px">Manage your license →</a>`
        : '';
      // Same 7-day grace period the wall display itself enforces (see
      // checkLicenseBlock() in display.html) — surfaced here too, so
      // whoever's managing this device via Settings sees the same
      // countdown, rather than only discovering it once the display
      // actually stops rendering.
      let graceHtml = '';
      const noLicenseSince = Number(s.no_license_since) || 0;
      if (noLicenseSince) {
        const daysSince = Math.floor((Date.now() - noLicenseSince) / 86_400_000);
        const daysLeft = 7 - daysSince;
        graceHtml = daysLeft > 0
          ? `<br><span style="color:#e0a030;font-size:12px;font-weight:600">A license is required — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left before the wall display stops working.</span>`
          : `<br><span style="color:var(--danger,#ff5d5d);font-size:12px;font-weight:600">The wall display has stopped working — add a license key above to restore it.</span>`;
      }
      row.style.display = '';
      info.innerHTML = `<span style="color:${meta.color};font-weight:600">${meta.label}</span>${expiryHtml}${activateHtml}${graceHtml}`;
    }

    const setStatus = (html, color) => { if (status) { status.innerHTML = html; status.style.color = color || 'var(--muted)'; } };

    // Persist the license key when the field loses focus — entering a valid one
    // could immediately unlock a release that was previously gated. Also
    // triggers an immediate refresh of the cached license/trial/limits status
    // right after saving, rather than leaving that cache stale until the next
    // scheduled check-in (first run ~90s after boot, then every 6 hours) —
    // without this, someone could enter a key that genuinely upgraded their
    // account and still hit the old trial widget-limit block for hours
    // afterward, with nothing on screen explaining why.
    if (licenseKeyInput) {
      licenseKeyInput.addEventListener('change', async () => {
        const key = licenseKeyInput.value.trim();
        if (!key) {
          // Clearing an existing key is a real, consequential action now
          // that a license-less HOST enters a 7-day grace period before the
          // wall display stops rendering entirely — this needs an actual
          // confirmation, not silently accepting an empty field the way any
          // other setting would. Role-aware: a mirror clearing its own key
          // just can't sync until it's re-entered, a genuinely different
          // and less severe consequence than what a host faces.
          const s0 = await apiFetch('/api/settings');
          const isHost = !s0 || s0.device_role !== 'slave';
          const warning = isHost
            ? 'Remove this license key? After 7 days without one, the wall display will stop working until a valid key is entered again.'
            : 'Remove this license key? This mirror won\u2019t be able to sync with the main device until a valid key is entered again.';
          if (!confirm(warning)) {
            licenseKeyInput.value = (s0 && s0.update_license_key) || '';
            return;
          }
        }
        await apiFetch('/api/settings', { method:'PUT', body: JSON.stringify({ update_license_key: key }) });
        if (!key) { setStatus('License key cleared.', 'var(--muted)'); return; }
        setStatus('Saved — checking your account…', 'var(--muted)');
        try {
          const r = await apiFetch('/api/refresh-license', { method: 'POST' });
          if (r && r.error) { setStatus('License key saved. Couldn\u2019t confirm account status right now — it\u2019ll sync automatically soon.', 'var(--muted)'); return; }
          const label = r && r.licenseStatus ? r.licenseStatus : 'unknown';
          setStatus(`License key saved — account status: ${label}.`, 'var(--good, #3ec97a)');
          // Re-fetches settings and re-renders Account Status with the fresh
          // licenseStatus/trialUntil — commented out along with the rest of
          // Account Status (see the initial-load call site above); the
          // re-fetch has no purpose without it, so no need to still make
          // that extra round-trip on every license key save.
          // const freshSettings = await apiFetch('/api/settings');
          // if (freshSettings) renderLicenseStatus(freshSettings);
        } catch {
          setStatus('License key saved. Couldn\u2019t confirm account status right now — it\u2019ll sync automatically soon.', 'var(--muted)');
        }
      });
    }

    // ── Update timing: immediate (default, fully automatic — see
    // periodicUpdateCheck() in server.js) vs. a scheduled daily install
    // time, plus the manual Check/Update controls that only matter in the
    // scheduled case (immediate mode already handles itself in the
    // background — nothing to manually trigger, same reasoning 1.39.3
    // removed these controls for entirely). ──────────────────────────────
    const scheduleModeSelect = $('update-schedule-mode');
    const scheduleTimeRow = $('update-schedule-time-row');
    const scheduleTimeInput = $('update-schedule-time');
    const manualRow = $('update-manual-row');
    const helpText = $('update-help-text');
    const checkBtn = $('update-check-btn');
    const updateNowBtn = $('update-now-btn');

    // Container deployments can't self-update — the code lives on an
    // immutable image layer, so updating means pulling a newer image and
    // recreating the container. Hide the timing/manual controls and show
    // that guidance instead. containerMode also short-circuits
    // applyScheduleModeUI() below in case the settings fetch resolves after
    // this one and tries to re-show the manual row.
    let containerMode = false;
    apiFetch('/api/version').then(async (d) => {
      if (!d || d.deployment !== 'container') return;
      containerMode = true;
      const row = scheduleModeSelect && scheduleModeSelect.closest('.settings-row');
      if (row) row.style.display = 'none';
      if (scheduleTimeRow) scheduleTimeRow.style.display = 'none';
      if (manualRow) manualRow.style.display = 'none';
      let extra = '';
      try {
        const info = await apiFetch('/api/update-check');
        if (info && info.updateAvailable) extra = ` Version ${info.latestVersion} is available.`;
      } catch {}
      if (helpText) helpText.textContent =
        'This runs in a container. To update, pull the latest image and recreate the container ' +
        '(e.g. docker compose pull && docker compose up -d).' + extra;
    }).catch(() => {});

    function applyScheduleModeUI(mode) {
      if (containerMode) return;
      const scheduled = mode === 'scheduled';
      if (scheduleTimeRow) scheduleTimeRow.style.display = scheduled ? '' : 'none';
      if (manualRow) manualRow.style.display = scheduled ? 'flex' : 'none';
      if (helpText) helpText.textContent = scheduled
        ? 'Updates install once a day at the time above. Use the buttons below anytime you don\u2019t want to wait.'
        : 'Updates install automatically in the background — there\u2019s nothing to manage here.';
      // A pending "update available" state from a prior check shouldn't
      // linger after switching back to Immediate — that mode installs on
      // its own moments later regardless, and a stale "Update Now" button
      // sitting there would just be confusing.
      if (!scheduled && updateNowBtn) updateNowBtn.style.display = 'none';
    }

    if (scheduleModeSelect) {
      apiFetch('/api/settings').then(s => {
        if (!s) return;
        const mode = s.update_schedule_mode || 'immediate';
        scheduleModeSelect.value = mode;
        if (scheduleTimeInput) scheduleTimeInput.value = s.update_schedule_time || '03:00';
        applyScheduleModeUI(mode);
      });
      scheduleModeSelect.addEventListener('change', async () => {
        const mode = scheduleModeSelect.value;
        applyScheduleModeUI(mode);
        await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ update_schedule_mode: mode }) });
      });
    }
    if (scheduleTimeInput) {
      scheduleTimeInput.addEventListener('change', async () => {
        await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ update_schedule_time: scheduleTimeInput.value || '03:00' }) });
      });
    }

    // Reuses /api/update-check — the same endpoint the top banner's
    // checkFleetUpdateStatus() already polls every 10 minutes — just
    // surfaced here as an on-demand button instead of waiting for that.
    if (checkBtn) {
      checkBtn.addEventListener('click', async () => {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Checking…';
        try {
          const info = await apiFetch('/api/update-check');
          if (info && info.updateAvailable) {
            setStatus(`Version ${info.latestVersion} is available.`, 'var(--good, #3ec97a)');
            if (updateNowBtn) updateNowBtn.style.display = '';
          } else {
            setStatus(`You\u2019re up to date${info && info.currentVersion ? ' (v' + info.currentVersion + ')' : ''}.`, 'var(--muted)');
            if (updateNowBtn) updateNowBtn.style.display = 'none';
          }
        } catch {
          setStatus('Could not reach the update server.', 'var(--muted)');
        } finally {
          checkBtn.disabled = false;
          checkBtn.textContent = 'Check for Updates';
        }
      });
    }

    // Same install path and the same restart-can-look-like-a-network-error
    // handling as installUpdateFromBanner() above, just targeting this
    // button/status area instead of the top banner — kept self-contained
    // rather than shared for the same reason that function already gives
    // for not reusing Settings' own pollForReturn: closing over
    // banner-specific elements that may not exist wherever this runs.
    if (updateNowBtn) {
      updateNowBtn.addEventListener('click', async () => {
        updateNowBtn.disabled = true;
        updateNowBtn.textContent = 'Installing…';
        setStatus('⏳ Downloading and installing the update…', 'var(--muted)');
        let resp = null, networkError = false;
        try {
          resp = await apiFetch('/api/update-from-server', { method: 'POST' });
        } catch {
          networkError = true;
        }
        if ((resp && resp.ok) || networkError) {
          setStatus(resp && resp.to ? `✓ Updating to v${resp.to} — restarting…` : '✓ Update started — restarting…', 'var(--good, #3ec97a)');
          let tries = 0;
          const iv = setInterval(async () => {
            tries++;
            try {
              const d = await apiFetch('/api/version', { cache: 'no-store' });
              if (d && !d.__authFailed) {
                clearInterval(iv);
                setStatus(`✅ Updated to v${d.version}.`, 'var(--good, #3ec97a)');
                updateNowBtn.style.display = 'none';
                updateNowBtn.disabled = false;
                updateNowBtn.textContent = 'Update Now';
                if (verEl) verEl.textContent = 'v' + d.version;
              }
            } catch { /* still restarting — keep polling */ }
            if (tries > 60) {
              clearInterval(iv);
              setStatus('⚠️ Taking longer than expected — check back in a minute.', 'var(--muted)');
              updateNowBtn.disabled = false;
              updateNowBtn.textContent = 'Update Now';
            }
          }, 1000);
        } else {
          const reason = (resp && resp.error) ? resp.error : 'Unknown error.';
          setStatus(`❌ Update failed: ${reason}`, 'var(--danger, #ff5d5d)');
          updateNowBtn.disabled = false;
          updateNowBtn.textContent = 'Update Now';
        }
      });
    }
  })();
}

function renderSettings_Wire_loadUpdateBackupsList() {
  (async function loadUpdateBackupsList() {
    const container = $('update-backups-list');
    if (!container) return;
    let data;
    try {
      data = await apiFetch('/api/update-backups');
    } catch {
      container.innerHTML = '<p style="font-size:12px;color:var(--danger, #ff5d5d)">Could not load backup history.</p>';
      return;
    }
    if (!data || (!data.rolling.length && !data.monthly.length)) {
      container.innerHTML = '<p style="font-size:12px;color:var(--muted)">No backups yet — one gets created automatically the next time an update is applied.</p>';
      return;
    }
    const fmtDate = (iso) => {
      if (!iso) return '';
      try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
      catch { return iso; }
    };
    const renderGroup = (title, items) => {
      if (!items.length) return '';
      return `
        <div style="margin-top:14px">
          <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">${title}</div>
          ${items.map(b => `
            <div class="backup-row" data-type="${b.type}" data-name="${escapeHtml(b.name)}" data-version="${escapeHtml(b.version)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:600">v${escapeHtml(b.version)}${b.version === data.currentVersion ? ' <span style="font-weight:400;color:var(--muted)">(current)</span>' : ''}</div>
                <div style="font-size:11px;color:var(--muted)">${fmtDate(b.createdAt)}</div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn backup-download-btn" type="button" style="padding:8px 12px;font-size:12px;background:var(--card);border:1px solid var(--border)">Download</button>
                <button class="btn backup-restore-btn" type="button" style="padding:8px 12px;font-size:12px;background:var(--card);border:1px solid var(--border);color:var(--danger, #ff5d5d)">Restore</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };
    container.innerHTML = renderGroup('Monthly (historical)', data.monthly) + renderGroup('Recent (last 10)', data.rolling);

    // Same fetch+blob download approach as the data backup button above —
    // surfaces a real error message instead of the browser navigating to a
    // raw JSON error page on failure.
    container.querySelectorAll('.backup-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.backup-row');
        const { type, name } = row.dataset;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Zipping…';
        try {
          const resp = await fetch(`/api/update-backups/${type}/${encodeURIComponent(name)}/download`);
          if (!resp.ok) {
            let msg = 'Download failed.';
            try { const j = await resp.json(); if (j.error) msg = j.error; } catch {}
            showToast('❌ ' + msg);
            btn.disabled = false; btn.textContent = originalText;
            return;
          }
          const blob = await resp.blob();
          const cd = resp.headers.get('Content-Disposition') || '';
          const match = cd.match(/filename="?([^"]+)"?/);
          const filename = match ? match[1] : 'piazzahq-backup.zip';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
          showToast('Downloaded ✓');
        } catch {
          showToast('❌ Download failed — check your connection and try again.');
        }
        btn.disabled = false; btn.textContent = originalText;
      });
    });
    container.querySelectorAll('.backup-restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.backup-row');
        const { type, name, version } = row.dataset;
        if (!confirm(`Restore to v${version}? This replaces the app's current code with this backup and restarts the server. Your calendar data, photos, and other content are never touched — only the app itself.`)) return;
        btn.disabled = true;
        btn.textContent = 'Restoring…';
        try {
          const resp = await apiFetch(`/api/update-backups/${type}/${encodeURIComponent(name)}/restore`, { method: 'POST' });
          if (resp && resp.ok) {
            showToast('Restoring — reconnecting shortly…');
          } else {
            showToast('❌ ' + ((resp && resp.error) || 'Restore failed'));
            btn.disabled = false; btn.textContent = 'Restore';
          }
        } catch {
          // A network error here often just means the restart already began
          // before the response could come back — same ambiguity the normal
          // Update Now flow already handles by treating it as success and
          // polling for the server to come back.
          showToast('Restoring — reconnecting shortly…');
        }
      });
    });
  })();
}

function renderSettings_Wire_sIcloudDiscoverBtn() {
    $('s-icloud-discover-btn').addEventListener('click', async () => {
      const btn = $('s-icloud-discover-btn'), statusEl = $('s-icloud-discover-status');
      const user = ($('s-icloud-user').value || '').trim();
      const pass = ($('s-icloud-pass').value || '').trim(); // blank = server falls back to the saved password
      if (!user) { statusEl.textContent = 'Enter your Apple ID first.'; return; }
      btn.disabled = true; btn.textContent = 'Checking…'; statusEl.textContent = 'Contacting iCloud…';
      try {
        const r = await apiFetch('/api/caldav/discover', { method: 'POST', body: JSON.stringify({ username: user, app_password: pass }) });
        if (r && r.ok && Array.isArray(r.calendars) && r.calendars.length) {
          const sel = $('s-icloud-calendar');
          const prev = sel.value;
          window.__icloudCals = r.calendars.map(c => ({ url: c.url, name: c.name || c.url }));
          sel.innerHTML = r.calendars.map(c =>
            `<option value="${c.url.replace(/"/g,'&quot;')}" ${c.url===prev?'selected':''}>${(c.name||c.url).replace(/</g,'&lt;')}</option>`
          ).join('');
          $('s-icloud-calendar-row').style.display = '';
          statusEl.textContent = `Found ${r.calendars.length} calendar${r.calendars.length===1?'':'s'} — pick a default and Save (all appear in the per-event picker on the display).`;
        } else {
          statusEl.textContent = (r && r.error) || 'Could not read your calendars.';
        }
      } catch (e) {
        statusEl.textContent = 'Request failed — check your connection.';
      }
      btn.disabled = false; btn.textContent = '🔍 Find my calendars';
    });
}

function renderSettings_Wire_sIcloudSaveBtn() {
    $('s-icloud-save-btn').addEventListener('click', async () => {
      const btn = $('s-icloud-save-btn'), statusEl = $('s-icloud-save-status');
      const sel = $('s-icloud-calendar');
      const enabled = $('s-icloud-enabled').checked;
      if (enabled && !sel.value) { statusEl.textContent = 'Find and pick a calendar before turning push on.'; return; }
      const body = {
        icloud_push_enabled: enabled ? '1' : '0',
        icloud_username: ($('s-icloud-user').value || '').trim(),
        icloud_calendar_url: sel.value || '',
        icloud_calendar_name: sel.value ? (sel.options[sel.selectedIndex]?.text || '') : '',
        icloud_calendars: Array.isArray(window.__icloudCals) ? window.__icloudCals : undefined,
      };
      const newPass = ($('s-icloud-pass').value || '').trim();
      if (newPass) body.icloud_app_password = newPass;
      btn.disabled = true; statusEl.textContent = 'Saving…';
      try {
        await apiFetch('/api/caldav-settings', { method: 'PUT', body: JSON.stringify(body) });
        showToast('✓ iCloud settings saved');
        await renderSettingsKeepPlace();
      } catch (e) {
        statusEl.textContent = 'Save failed.';
        btn.disabled = false;
      }
    });
}
