function renderSettings_Wire_sGoogleConnectBtn() {
    $('s-google-connect-btn').addEventListener('click', async () => {
      const btn = $('s-google-connect-btn'), statusEl = $('s-google-connect-status');
      btn.disabled = true; statusEl.textContent = 'Preparing…';
      let start;
      try {
        start = await apiFetch('/api/google/connect-start', { method: 'POST', body: '{}' });
      } catch { statusEl.textContent = 'Request failed — check your connection.'; btn.disabled = false; return; }
      if (!start || !start.auth_url) { statusEl.textContent = (start && start.error) || 'Could not start the connection.'; btn.disabled = false; return; }
      // app.html is the phone control app, so just open the consent page
      // directly; also leave a tappable link in case the popup is blocked.
      try { window.open(start.auth_url, '_blank', 'noopener'); } catch {}
      statusEl.innerHTML = `<a href="${start.auth_url}" target="_blank" rel="noopener" style="color:var(--accent)">Open the Google sign-in page</a>, pick the account you want, and approve.`
        + `<div style="color:var(--muted);margin-top:6px">Waiting for you to approve…</div>`;
      const deadline = Date.now() + 15 * 60 * 1000;
      const poll = async () => {
        if (Date.now() > deadline) { statusEl.innerHTML = 'Timed out — tap Connect to try again.'; btn.disabled = false; return; }
        let r;
        try { r = await apiFetch('/api/google/connect-poll', { method: 'POST', body: JSON.stringify({ state: start.state }) }); }
        catch { window.__googlePoll = setTimeout(poll, 3000); return; }
        if (r.status === 'pending') { window.__googlePoll = setTimeout(poll, 3000); return; }
        if (r.status === 'connected') {
          showToast('✓ Google account connected');
          await renderSettingsKeepPlace();
          return;
        }
        statusEl.innerHTML = r.status === 'denied' ? 'Access was not granted in the Google prompt.'
          : ('Something went wrong: ' + (r.error || r.status));
        btn.disabled = false;
      };
      window.__googlePoll = setTimeout(poll, 3000);
    });
}

function renderSettings_Wire_sGoogleDisconnectBtnEtc() {
  if ($('s-google-disconnect-btn')) {
    $('s-google-disconnect-btn').addEventListener('click', async () => {
      if (!confirm('Disconnect this Google account? New events will stop being pushed to it.')) return;
      await apiFetch('/api/google-settings', { method: 'PUT', body: JSON.stringify({ disconnect: true }) });
      showToast('Google account disconnected');
      await renderSettingsKeepPlace();
    });
  }
  if ($('s-google-save-btn')) {
    $('s-google-save-btn').addEventListener('click', async () => {
      const btn = $('s-google-save-btn'), statusEl = $('s-google-save-status');
      const enabled = $('s-google-enabled').checked;
      const calId = (($('s-google-calendar') && $('s-google-calendar').value) || '').trim() || 'primary';
      btn.disabled = true; statusEl.textContent = 'Saving…';
      try {
        await apiFetch('/api/google-settings', { method: 'PUT', body: JSON.stringify({
          google_push_enabled: enabled ? '1' : '0',
          google_calendar_id: calId,
          google_calendar_name: calId === 'primary' ? 'Primary calendar' : calId,
        }) });
        showToast('✓ Google settings saved');
        await renderSettingsKeepPlace();
      } catch { statusEl.textContent = 'Save failed.'; btn.disabled = false; }
    });
  }
  if ($('s-hw-save-btn')) {
    $('s-hw-save-btn').addEventListener('click', async () => {
      const btn = $('s-hw-save-btn'), statusEl = $('s-hw-save-status');
      const body = {
        handwriting_enabled: $('s-hw-enabled').checked ? '1' : '0',
        myscript_app_key: ($('s-hw-appkey').value || '').trim(),
      };
      const hmac = ($('s-hw-hmac').value || '').trim();
      if (hmac) body.myscript_hmac_key = hmac;
      btn.disabled = true; statusEl.textContent = 'Saving…';
      try {
        await apiFetch('/api/handwriting-settings', { method: 'PUT', body: JSON.stringify(body) });
        showToast('✓ Handwriting settings saved');
        await renderSettingsKeepPlace();
      } catch { statusEl.textContent = 'Save failed.'; btn.disabled = false; }
    });
  }
}

function renderSettings_Wire_sHaDetectBtn(_c) {
  const { updateHaTokenLink } = _c;
    $('s-ha-detect-btn').addEventListener('click', async () => {
      const btn = $('s-ha-detect-btn');
      const statusEl = $('s-ha-detect-status');
      const resultsEl = $('s-ha-detect-results');
      btn.disabled = true;
      btn.textContent = 'Scanning…';
      statusEl.textContent = 'This can take a few seconds.';
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
      try {
        const r = await apiFetch('/api/ha/discover');
        const found = (r && Array.isArray(r.found)) ? r.found : [];
        if (!found.length) {
          statusEl.textContent = "Couldn't find it automatically — enter the URL below manually.";
        } else if (found.length === 1) {
          $('s-ha-url').value = found[0].url;
          statusEl.textContent = found[0].viaTailscale
            ? `Found it (via Tailscale) — filled in ${found[0].url}. Note: Home Assistant's own login page can sometimes reject Tailscale addresses — if login fails, try its regular LAN address once you're on the same network.`
            : `Found it — filled in ${found[0].url}`;
          updateHaTokenLink();
        } else {
          statusEl.textContent = `Found ${found.length} — pick one:`;
          resultsEl.style.display = 'flex';
          resultsEl.innerHTML = found.map(f => `
            <button type="button" class="ha-detect-pick" data-url="${escapeHtml(f.url)}"
              style="text-align:left;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 13px;font-size:13px;cursor:pointer">
              ${escapeHtml(f.name)} — <span style="color:var(--muted)">${escapeHtml(f.url)}${f.viaTailscale ? ' (Tailscale)' : ''}</span>
            </button>`).join('');
          resultsEl.querySelectorAll('.ha-detect-pick').forEach(pickBtn => {
            pickBtn.addEventListener('click', () => {
              $('s-ha-url').value = pickBtn.dataset.url;
              statusEl.textContent = `Using ${pickBtn.dataset.url}`;
              resultsEl.style.display = 'none';
              updateHaTokenLink();
            });
          });
        }
      } catch {
        statusEl.textContent = "Couldn't reach the server to scan — enter the URL below manually.";
      }
      btn.disabled = false;
      btn.textContent = '🔍 Detect automatically';
    });
}

function renderSettings_Wire_sHaTestBtn() {
    $('s-ha-test-btn').addEventListener('click', async () => {
      const url = $('s-ha-url').value.trim();
      const token = $('s-ha-token').value.trim();
      const resultEl = $('s-ha-test-result');
      if (!url || !token) { resultEl.textContent = '❌ Enter a URL and token first'; resultEl.style.color = 'var(--muted)'; return; }
      $('s-ha-test-btn').textContent = 'Testing…';
      $('s-ha-test-btn').disabled = true;
      resultEl.textContent = '';
      try {
        // Tests whatever's currently typed, not whatever's already saved —
        // otherwise this could pass or fail based on debounced-auto-save
        // timing rather than the actual values on screen right now.
        const r = await apiFetch(`/api/ha/test?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`);
        if (r.ok) {
          resultEl.textContent = '✅ Connected';
          resultEl.style.color = 'var(--accent)';
        } else {
          resultEl.textContent = '❌ ' + (r.error || 'Could not connect');
          resultEl.style.color = '#e85454';
        }
      } catch {
        resultEl.textContent = '❌ Could not reach the server';
        resultEl.style.color = '#e85454';
      }
      $('s-ha-test-btn').textContent = 'Test Connection';
      $('s-ha-test-btn').disabled = false;
    });
}

function renderSettings_Wire_sHaalertAddBtn() {
    const statusEl = $('s-haalert-status');
    // PUT the whole list; no re-render (used by the per-row toggles — the
    // checkbox already reflects the new state).
    const putHaAlerts = async () => {
      statusEl.textContent = 'Saving…';
      try {
        const r = await apiFetch('/api/ha-alerts', { method: 'PUT', body: JSON.stringify({ alerts: window.__haAlerts || [] }) });
        window.__haAlerts = (r && Array.isArray(r.alerts)) ? r.alerts : (window.__haAlerts || []);
        statusEl.textContent = 'Saved.';
        setTimeout(() => { if (statusEl.textContent === 'Saved.') statusEl.textContent = ''; }, 1200);
      } catch { statusEl.textContent = 'Save failed.'; }
    };
    // For add/delete the list rows change, so re-render — but keep the user
    // where they are (don't collapse the accordion back to the top).
    const saveHaAlerts = async () => { await putHaAlerts(); await renderSettingsKeepPlace(); };
    // Set while the form is editing an existing rule (its id) rather than
    // adding a new one; reset on every settings re-render since this whole
    // block re-runs. null = add mode.
    let _haAlertEditingId = null;
    // Common state values per HA domain — so "state is" is a dropdown, not a
    // guess. Anything not listed falls back to the entity's current state
    // plus a free-text "Other…".
    const HA_COMMON_STATES = {
      binary_sensor:['on','off'], switch:['on','off'], light:['on','off'], fan:['on','off'],
      input_boolean:['on','off'], update:['on','off'], automation:['on','off'], siren:['on','off'],
      cover:['open','closed','opening','closing'], lock:['locked','unlocked','jammed','opening'],
      person:['home','not_home'], device_tracker:['home','not_home'],
      media_player:['playing','paused','idle','off','standby','buffering','on'],
      climate:['off','heat','cool','heat_cool','auto','dry','fan_only'],
      alarm_control_panel:['disarmed','armed_home','armed_away','armed_night','armed_vacation','pending','arming','triggered'],
      vacuum:['cleaning','docked','paused','idle','returning','error'],
      sun:['above_horizon','below_horizon'], water_heater:['off','eco','electric','gas','heat_pump','high_demand','performance'],
    };
    const curStateOf = (id) => {
      const e = (window.__haAlertEntities || cachedHaEntities || []).find(x => x.entity_id === id);
      return e ? e.state : '';
    };
    function rebuildValueField() {
      const wrap = $('s-haalert-value-wrap'); if (!wrap) return;
      const id = $('s-haalert-entity').value || '';
      const op = $('s-haalert-op').value;
      const domain = id.split('.')[0];
      const cur = curStateOf(id);
      $('s-haalert-cur').textContent = cur ? `Currently: ${cur}` : '';
      if (op === 'above' || op === 'below') {
        wrap.innerHTML = `<input class="form-input" id="s-haalert-value" type="number" step="any" placeholder="number" style="width:100%">`;
        return;
      }
      const opts = [];
      if (cur) opts.push(cur);
      for (const v of (HA_COMMON_STATES[domain] || [])) if (!opts.includes(v)) opts.push(v);
      if (!opts.length) {
        wrap.innerHTML = `<input class="form-input" id="s-haalert-value" placeholder="state value" style="width:100%">`;
        return;
      }
      wrap.innerHTML =
        `<select class="form-input" id="s-haalert-value" style="width:100%">` +
        opts.map(v => `<option value="${v.replace(/"/g,'&quot;')}"${v===cur?' selected':''}>${escapeHtml(v)}</option>`).join('') +
        `<option value="__other__">Other…</option></select>` +
        `<input class="form-input" id="s-haalert-value-other" placeholder="custom state" style="width:100%;margin-top:6px;display:none">`;
      $('s-haalert-value').addEventListener('change', () => {
        const o = $('s-haalert-value-other');
        if (o) o.style.display = $('s-haalert-value').value === '__other__' ? 'block' : 'none';
      });
    }
    const readValue = () => {
      const v = ($('s-haalert-value') && $('s-haalert-value').value || '').trim();
      if (v === '__other__') return ($('s-haalert-value-other') && $('s-haalert-value-other').value || '').trim();
      return v;
    };
    const resetAlertEntityBtn = () => {
      const btn = $('s-haalert-entity-btn'); if (!btn) return;
      const id = $('s-haalert-entity').value || '';
      if (id) {
        const e = (window.__haAlertEntities || cachedHaEntities || []).find(x => x.entity_id === id);
        btn.textContent = ((e && e.friendly_name) || id) + ' — ' + id;
        btn.style.color = 'var(--text)';
      } else {
        btn.textContent = 'Choose an entity…';
        btn.style.color = 'var(--muted)';
      }
    };
    // Populate the form fields from a rule object (or clear them for `null`).
    // Must run after the entities prefetch so the entity-button label and the
    // "state is" dropdown can resolve names/current state.
    const fillAlertForm = (a) => {
      $('s-haalert-entity').value = (a && a.entityId) || '';
      resetAlertEntityBtn();
      $('s-haalert-op').value = (a && a.op) || 'eq';
      $('s-haalert-dwell').value = (a && a.dwellMin) || 0;
      $('s-haalert-msg').value = (a && a.message) || '';
      rebuildValueField();
      if (a && a.value != null && a.value !== '') {
        const vf = $('s-haalert-value');
        if (vf && vf.tagName === 'SELECT') {
          if ([...vf.options].some(o => o.value === a.value)) {
            vf.value = a.value;
          } else {
            vf.value = '__other__';
            const o = $('s-haalert-value-other');
            if (o) { o.style.display = 'block'; o.value = a.value; }
          }
        } else if (vf) {
          vf.value = a.value;
        }
      }
    };
    const openAlertForm = async (editId) => {
      _haAlertEditingId = editId || null;
      $('s-haalert-form').style.display = 'block';
      $('s-haalert-add-btn').style.display = 'none';
      $('s-haalert-add-confirm').textContent = editId ? 'Save changes' : 'Add alert';
      statusEl.textContent = '';
      // Prefetch so curStateOf / the name lookup have data even before the
      // search sheet is opened; the sheet itself also loads/caches entities.
      try {
        const ents = await apiFetch('/api/ha/entities');
        window.__haAlertEntities = Array.isArray(ents) ? ents : [];
        if (!cachedHaEntities && Array.isArray(ents)) cachedHaEntities = ents;
      } catch {}
      fillAlertForm(editId ? (window.__haAlerts || []).find(x => x.id === editId) : null);
    };
    $('s-haalert-add-btn').addEventListener('click', () => openAlertForm(null));
    if ($('s-haalert-entity-btn')) $('s-haalert-entity-btn').addEventListener('click', () => {
      openHaEntitySearch({
        current: $('s-haalert-entity').value || '',
        onPick: (id) => { $('s-haalert-entity').value = id; resetAlertEntityBtn(); rebuildValueField(); },
      });
    });
    $('s-haalert-op').addEventListener('change', rebuildValueField);
    $('s-haalert-add-cancel').addEventListener('click', () => {
      _haAlertEditingId = null;
      $('s-haalert-form').style.display = 'none';
      $('s-haalert-add-btn').style.display = '';
      statusEl.textContent = '';
    });
    $('s-haalert-add-confirm').addEventListener('click', async () => {
      const entityId = ($('s-haalert-entity').value || '').trim();
      const value = readValue();
      if (!entityId) { statusEl.textContent = 'Pick an entity.'; return; }
      if (!value) { statusEl.textContent = 'Enter a value to compare against.'; return; }
      const ent = (window.__haAlertEntities || cachedHaEntities || []).find(e => e.entity_id === entityId);
      const name = (ent && ent.friendly_name) || entityId;
      const fields = {
        entityId, name,
        op: $('s-haalert-op').value,
        value,
        dwellMin: Math.max(0, Math.min(1440, parseInt($('s-haalert-dwell').value, 10) || 0)),
        message: ($('s-haalert-msg').value || '').trim(),
      };
      window.__haAlerts = window.__haAlerts || [];
      if (_haAlertEditingId) {
        const a = window.__haAlerts.find(x => x.id === _haAlertEditingId);
        if (a) Object.assign(a, fields); // keep id / enabled / screen / phone
        _haAlertEditingId = null;
      } else {
        window.__haAlerts.push({ id: 'a' + Date.now().toString(36), enabled: true, ...fields });
      }
      await saveHaAlerts();
    });
    document.querySelectorAll('.s-haalert-row').forEach(row => {
      const id = row.dataset.id;
      const del = row.querySelector('.s-haalert-del');
      const edit = row.querySelector('.s-haalert-edit');
      const chk = row.querySelector('.s-haalert-enabled');
      const scr = row.querySelector('.s-haalert-screen');
      const phn = row.querySelector('.s-haalert-phone');
      if (edit) edit.addEventListener('click', () => openAlertForm(id));
      if (del) del.addEventListener('click', async () => {
        window.__haAlerts = (window.__haAlerts || []).filter(a => a.id !== id);
        await saveHaAlerts();
      });
      const patch = (field, val) => {
        const a = (window.__haAlerts || []).find(x => x.id === id);
        if (a) { a[field] = val; return putHaAlerts(); }
      };
      if (chk) chk.addEventListener('change', () => patch('enabled', chk.checked));
      if (scr) scr.addEventListener('change', () => patch('screen', scr.checked));
      if (phn) phn.addEventListener('change', () => patch('phone', phn.checked));
    });
}

function renderSettings_Wire_sNotifprefs() {
    const st = $('s-notifprefs-status');
    const saveNotifPrefs = async () => {
      st.textContent = 'Saving…';
      try {
        const r = await apiFetch('/api/notif-prefs', { method: 'PUT', body: JSON.stringify({ prefs: window.__notifPrefs || {} }) });
        window.__notifPrefs = (r && r.prefs) || window.__notifPrefs;
        st.textContent = 'Saved.';
        setTimeout(() => { if (st.textContent === 'Saved.') st.textContent = ''; }, 1500);
      } catch { st.textContent = 'Save failed.'; }
    };
    document.querySelectorAll('.s-notifpref-row').forEach(row => {
      const kind = row.dataset.kind;
      const scr = row.querySelector('.s-np-screen');
      const phn = row.querySelector('.s-np-phone');
      const set = () => {
        window.__notifPrefs = window.__notifPrefs || {};
        window.__notifPrefs[kind] = { screen: !!(scr && scr.checked), phone: !!(phn && phn.checked) };
        return saveNotifPrefs();
      };
      if (scr) scr.addEventListener('change', set);
      if (phn) phn.addEventListener('change', set);
    });
}

function renderSettings_Wire_sVoiceTokenShowBtnEtc() {
  if ($('s-voice-token-show-btn')) {
    $('s-voice-token-show-btn').addEventListener('click', () => {
      const input = $('s-voice-token');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }
  if ($('s-voice-token-gen-btn')) {
    $('s-voice-token-gen-btn').addEventListener('click', async () => {
      const willReplace = !!$('s-voice-token').value;
      if (willReplace && !confirm('This breaks any Shortcut already built with the current token until you update it there too. Continue?')) return;
      $('s-voice-token-gen-btn').disabled = true;
      try {
        const r = await apiFetch('/api/voice-token/generate', { method: 'POST' });
        if (r && r.token) {
          await renderSettingsKeepPlace(); // re-render so the field/instructions/button label all reflect the new state
          const freshInput = $('s-voice-token');
          if (freshInput) { freshInput.value = r.token; freshInput.type = 'text'; } // show once, easiest moment to copy
          showToast('Voice token generated');
        }
      } catch { showToast('Could not generate a token — try again'); }
    });
  }
  if ($('s-voice-token-revoke-btn')) {
    $('s-voice-token-revoke-btn').addEventListener('click', async () => {
      if (!confirm('This immediately breaks any Shortcut using the current token. Continue?')) return;
      try {
        await apiFetch('/api/voice-token', { method: 'DELETE' });
        $('s-voice-token').value = '';
        $('s-voice-instructions').style.display = 'none';
        showToast('Voice token revoked');
        await renderSettingsKeepPlace(); // re-render so the button row reflects "no token" state
      } catch { showToast('Could not revoke — try again'); }
    });
  }

  // ── Home Assistant control (reverse): automation token ────────────────────
  // Same generate/show/revoke shape as the Voice Token block just above —
  // server-generated, shown once on creation, re-rendered via
  // renderSettingsKeepPlace() so the instructions block and button labels
  // stay in sync with whether a token currently exists.
  if ($('s-automation-token-show-btn')) {
    $('s-automation-token-show-btn').addEventListener('click', () => {
      const input = $('s-automation-token');
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }
  if ($('s-automation-token-gen-btn')) {
    $('s-automation-token-gen-btn').addEventListener('click', async () => {
      const willReplace = !!$('s-automation-token').value;
      if (willReplace && !confirm('This breaks any Home Assistant automation already using the current token until you update it there too. Continue?')) return;
      $('s-automation-token-gen-btn').disabled = true;
      try {
        const r = await apiFetch('/api/automation-token/generate', { method: 'POST' });
        if (r && r.token) {
          await renderSettingsKeepPlace();
          const freshInput = $('s-automation-token');
          if (freshInput) { freshInput.value = r.token; freshInput.type = 'text'; } // show once, easiest moment to copy
          showToast('Automation token generated');
        }
      } catch { showToast('Could not generate a token — try again'); }
    });
  }
  if ($('s-automation-token-revoke-btn')) {
    $('s-automation-token-revoke-btn').addEventListener('click', async () => {
      if (!confirm('This immediately breaks any Home Assistant automation using the current token. Continue?')) return;
      try {
        await apiFetch('/api/automation-token', { method: 'DELETE' });
        $('s-automation-token').value = '';
        $('s-automation-instructions').style.display = 'none';
        showToast('Automation token revoked');
        await renderSettingsKeepPlace();
      } catch { showToast('Could not revoke — try again'); }
    });
  }

  // ── Home Assistant control (reverse): MQTT ─────────────────────────────────
  if ($('s-mqtt-enabled')) {
    $('s-mqtt-enabled').addEventListener('change', (e) => {
      $('s-mqtt-fields').style.display = e.target.checked ? 'flex' : 'none';
    });
  }
}

function renderSettings_Wire_sMqttTestBtn() {
    $('s-mqtt-test-btn').addEventListener('click', async () => {
      const btn = $('s-mqtt-test-btn');
      const statusEl = $('s-mqtt-status');
      btn.disabled = true;
      statusEl.textContent = 'Testing…';
      statusEl.style.color = 'var(--muted)';
      try {
        const r = await apiFetch('/api/mqtt/test', {
          method: 'POST',
          body: JSON.stringify({
            brokerUrl: $('s-mqtt-url').value.trim(),
            username: $('s-mqtt-username').value.trim(),
            password: $('s-mqtt-password').value,
          }),
        });
        if (r && r.ok) { statusEl.textContent = '✓ Connected'; statusEl.style.color = 'var(--good,#3ec97a)'; }
        else { statusEl.textContent = '✗ ' + ((r && r.error) || 'Could not connect'); statusEl.style.color = 'var(--danger,#e85454)'; }
      } catch { statusEl.textContent = '✗ Could not reach this device'; statusEl.style.color = 'var(--danger,#e85454)'; }
      btn.disabled = false;
    });
}

function renderSettings_Wire_sMqttSaveBtn() {
    $('s-mqtt-save-btn').addEventListener('click', async () => {
      const btn = $('s-mqtt-save-btn');
      const statusEl = $('s-mqtt-status');
      btn.disabled = true;
      try {
        await apiFetch('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            mqtt_enabled: $('s-mqtt-enabled').checked ? '1' : '0',
            mqtt_broker_url: $('s-mqtt-url').value.trim(),
            mqtt_username: $('s-mqtt-username').value.trim(),
            mqtt_password: $('s-mqtt-password').value,
            mqtt_discovery_prefix: $('s-mqtt-prefix').value.trim(),
          }),
        });
        statusEl.textContent = 'Saved — connecting…';
        statusEl.style.color = 'var(--muted)';
        showToast('MQTT settings saved');
      } catch { showToast('Could not save — try again'); }
      btn.disabled = false;
    });
}

function renderSettings_Wire_settingsFormEl(_c) {
  const { scheduleSettingsAutoSave, settingsFormEl } = _c;
    // Each renderSettings() call defines fresh input/change handlers that
    // close over THIS render's tickers/briefingProjectIds (both re-declared
    // from scratch every render, then mutated in place as the person edits
    // — see their own declarations above). Previously nothing removed the
    // PREVIOUS render's handlers before attaching new ones — they're
    // delegated onto the persistent #content container, which survives
    // every tab switch (only its innerHTML gets replaced) — so revisiting
    // Settings more than once in a session left that many duplicate
    // handlers stacked, each firing its own redundant PUT /api/settings on
    // every edit. The save-queue fix in saveAllSettings() means stacked
    // duplicates can no longer corrupt data by racing each other, but they
    // were still wasteful, AND — the real, separate bug this specifically
    // fixes — an old stacked handler's closure still points at whatever
    // tickers/briefingProjectIds array existed when IT was first wired, not
    // the current render's, so a save triggered by a stale handler could
    // silently persist outdated stock tickers or Todoist project selections
    // instead of what's actually showing on screen. Tracking the handlers
    // on window (removeEventListener needs the exact same function
    // reference used to add it, which an inline arrow function never
    // exposes) and removing the previous pair before adding the new one
    // closes this properly, rather than just serializing around it.
    if (window._settingsInputHandler) settingsFormEl.removeEventListener('input', window._settingsInputHandler);
    if (window._settingsChangeHandler) settingsFormEl.removeEventListener('change', window._settingsChangeHandler);
    window._settingsInputHandler = (e) => {
      const t = e.target;
      if (!t.matches('input, select, textarea')) return;
      if (t.id === 's-pin') return; // manual-only, see saveAllSettings() comment
      if (t.id && t.id.indexOf('ra-') === 0) return; // remote-login panel saves itself
      // These already have their own dedicated save-on-change handlers elsewhere
      // (uploading something, adding a briefing recipient, etc.) — auto-saving
      // the whole form on top would be redundant, not incorrect, but let's not
      // double up. (Used to also guard a 'stock-ticker-input' class here, but
      // that referenced a class the old ticker input never actually had — a
      // pre-existing no-op — and is moot now anyway since v1.77.77 moved
      // ticker tracking off this page entirely.)
      scheduleSettingsAutoSave(t.type === 'checkbox' || t.tagName === 'SELECT' ? 400 : 1500);
    };
    window._settingsChangeHandler = (e) => {
      const t = e.target;
      if (!t.matches('input, select, textarea') || t.id === 's-pin' || (t.id && t.id.indexOf('ra-') === 0)) return;
      if (t.type === 'checkbox' || t.tagName === 'SELECT') scheduleSettingsAutoSave(400);
    };
    settingsFormEl.addEventListener('input', window._settingsInputHandler);
    settingsFormEl.addEventListener('change', window._settingsChangeHandler);
}

function renderSettings_Wire_sPinRemoveBtn() {
    $('s-pin-remove-btn').addEventListener('click', async () => {
      // Re-entering the current PIN (not just a yes/no confirm) matters here:
      // an active session alone shouldn't be enough to permanently disable
      // PIN protection — a stale or hijacked session could otherwise remove
      // it silently, with lasting effect long after that temporary access is
      // gone. Enforced server-side too (see PUT /api/settings), since a
      // client-side-only check wouldn't stop a scripted request that skips
      // this prompt entirely.
      const entered = prompt('Enter the current PIN to confirm removing PIN protection:');
      if (entered === null) return; // cancelled
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ app_pin: '', current_pin_confirm: entered.trim() }),
      });
      if (res && res.__authFailed) return; // apiFetch already handled (session itself invalid, unrelated to the confirm check below)
      if (res && res.error) {
        alert(res.error);
        return;
      }
      renderSettings(); // re-render so the field/button reflect "no PIN set" immediately, not on next visit
    });
}

function renderSettings_Wire_block4365(_c) {
  const { saveAllSettings, saveAppPin, _st } = _c;
  $('settings-save-btn').addEventListener('click', async () => {
    const pinResult = await saveAppPin();
    if (pinResult === 'mismatch' || pinResult === 'error') return;
    const pinJustSet = pinResult === 'set';
    // Real design flaw fixed here: this field is deliberately never
    // pre-filled with the actual PIN (a password field showing the real
    // secret back would defeat the point of it) — but that meant "blank"
    // was being used to mean two completely different things: "I never
    // touched this" (the normal case, every single time Settings is
    // opened) and "please remove my PIN." Saving anything else while the
    // field just sat at its default blank state used to trigger this exact
    // confirm dialog every time, for no reason. Blank now genuinely means
    // "no change" — removing the PIN is its own explicit button below,
    // shown only when one is actually set (see s-pin-remove-btn).
    if (_st._settingsAutoSaveTimer) { clearTimeout(_st._settingsAutoSaveTimer); _st._settingsAutoSaveTimer = null; }
    await saveAllSettings();
    $('bf-email-pass').value = '';
    // Same as the remove-PIN button below: re-render so the field's placeholder
    // and the "Remove PIN protection" button reflect the new state now, not the
    // next time Settings is opened (it kept saying "No PIN set" until then).
    if (pinJustSet) await renderSettingsKeepPlace();
  });
}

function renderSettings_Wire_block4388Etc(_c) {
  const { saveBriefingFields } = _c;
  $('bf-preview-btn').addEventListener('click', () => {
    // Opens the rendered HTML in a new tab. PIN-protected sessions carry over since
    // it's the same origin/cookie-less token scheme used by the rest of the app.
    window.open('/api/briefing-settings/preview', '_blank');
  });

  $('bf-send-now-btn').addEventListener('click', async () => {
    if (!confirm('Send the daily briefing to all enabled recipients right now?')) return;
    $('bf-send-now-btn').textContent = 'Sending…';
    $('bf-send-now-btn').disabled = true;
    await saveBriefingFields();
    const result = await apiFetch('/api/briefing-settings/send-now', { method: 'POST' });
    $('bf-send-now-btn').textContent = '📤 Send Now';
    $('bf-send-now-btn').disabled = false;
    if (result.error) {
      showToast('❌ ' + result.error);
    } else {
      const okCount = result.results.filter(r => r.ok).length;
      const total = result.results.length;
      showToast(okCount === total
        ? `Sent to ${total} recipient${total===1?'':'s'} ✓`
        : `Sent to ${okCount} of ${total} — check failures`);
      renderSettings(); // refresh "Last sent" timestamp
    }
  });

  $('bf-test-btn').addEventListener('click', async () => {
    const testEmail = $('bf-test-email').value.trim();
    if (!testEmail || !testEmail.includes('@')) { showToast('Enter an email to send the test to'); return; }
    $('bf-test-btn').textContent = 'Sending…';
    $('bf-test-btn').disabled = true;
    await saveBriefingFields();
    const result = await apiFetch('/api/briefing-settings/test', {
      method: 'POST', body: JSON.stringify({ email: testEmail }),
    });
    $('bf-test-btn').textContent = 'Send Test';
    $('bf-test-btn').disabled = false;
    if (result.error) {
      showToast('❌ ' + result.error);
    } else {
      showToast('Test sent ✓ Check that inbox');
      $('bf-email-pass').value = '';
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    // What is there to sign out of? A remote sign-in (someone reaching this device from outside, or a home
    // device that was asked for the remote password), and/or an App PIN session. Only show the PIN screen
    // when a PIN actually exists - with none set it was a dead end that asked for a PIN nobody had.
    let remoteSt = null, pinSet = false;
    try { remoteSt = await fetch('/api/remote-auth/status').then((r) => r.json()); } catch (e) { /* offline: fall through */ }
    try { pinSet = !!(await fetch('/api/auth/status', { headers: sessionToken ? { 'x-session-token': sessionToken } : {} }).then((r) => r.json())).pin_set; } catch (e) { /* offline: fall through */ }
    if (sessionToken) await apiFetch('/api/auth/logout', { method: 'POST' });
    if (remoteSt && remoteSt.configured && remoteSt.authenticated) {
      try { await fetch('/api/remote-auth/logout', { method: 'POST' }); } catch (e) { /* the cookie also expires on its own */ }
      sessionToken = null; try { localStorage.removeItem('pi_cal_token'); } catch (e) { /* private mode */ }
      window.location.href = '/login';
      return;
    }
    if (pinSet) showPinScreen();
    else showToast('Nothing to sign out of — no PIN or remote password is protecting this device.');
  });
}

// Google Tasks: its own sign-in (only the tasks permission), same relayed flow as the Calendar one above.
function renderSettings_Wire_sGoogleTasks() {
  const btn = $('s-gtasks-connect-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      const statusEl = $('s-gtasks-connect-status');
      btn.disabled = true; statusEl.textContent = 'Preparing…';
      let start;
      try { start = await apiFetch('/api/google-tasks/connect-start', { method: 'POST', body: '{}' }); }
      catch { statusEl.textContent = 'Request failed — check your connection.'; btn.disabled = false; return; }
      if (!start || !start.auth_url) { statusEl.textContent = (start && start.error) || 'Could not start the connection.'; btn.disabled = false; return; }
      try { window.open(start.auth_url, '_blank', 'noopener'); } catch {}
      statusEl.innerHTML = `<a href="${start.auth_url}" target="_blank" rel="noopener" style="color:var(--accent)">Open the Google sign-in page</a>, pick the account that has your tasks, and approve.`
        + `<div style="color:var(--muted);margin-top:6px">Waiting for you to approve…</div>`;
      const deadline = Date.now() + 15 * 60 * 1000;
      const poll = async () => {
        if (!$('s-gtasks-connect-status')) return;
        if (Date.now() > deadline) { statusEl.textContent = 'Timed out — tap Connect to try again.'; btn.disabled = false; return; }
        let r;
        try { r = await apiFetch('/api/google-tasks/connect-poll', { method: 'POST', body: JSON.stringify({ state: start.state }) }); }
        catch { setTimeout(poll, 3000); return; }
        if (r.status === 'pending') { setTimeout(poll, 3000); return; }
        if (r.status === 'connected') { showToast('✓ Google Tasks connected'); await renderSettingsKeepPlace(); return; }
        statusEl.textContent = r.status === 'denied' ? 'Access was not granted in the Google prompt.' : ('Something went wrong: ' + (r.error || r.status));
        btn.disabled = false;
      };
      setTimeout(poll, 3000);
    });
  }
  // Connected: ask Google for the lists once and say what happened, so a switched-off API is spelled out here instead of the lists just not showing up.
  if ($('s-gtasks-health')) {
    $('s-gtasks-health').textContent = 'Checking your Google task lists…';
    apiFetch('/api/google-tasks?check=1').then((r) => {
      const el = $('s-gtasks-health'); if (!el) return;
      if (r && r.problem) { el.style.color = '#e5484d'; el.textContent = r.problem; }
      else if (r && typeof r.lists === 'number') { el.style.color = 'var(--muted)'; el.textContent = r.lists === 1 ? '1 Google task list found.' : r.lists + ' Google task lists found.'; }
      else el.textContent = '';
    }).catch(() => { const el = $('s-gtasks-health'); if (el) el.textContent = ''; });
  }
  if ($('s-gtasks-disconnect-btn')) {
    $('s-gtasks-disconnect-btn').addEventListener('click', async () => {
      if (!confirm('Disconnect Google Tasks? Tasks widgets that show a Google list will stop updating.')) return;
      await apiFetch('/api/google-tasks/disconnect', { method: 'POST', body: '{}' });
      showToast('Google Tasks disconnected');
      await renderSettingsKeepPlace();
    });
  }
}
