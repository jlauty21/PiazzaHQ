// ── Init ──────────────────────────────────────────────────────────────────────
// First-run setup wizard controller. Mandatory: role (+ host address if a display).
// Optional/skippable: name, location, PIN, theme, Home Assistant connection.
// Writes settings, marks setup_complete, then reloads into the normal app.
function runSetupWizard(s0) {
  // Defensive: the wizard has no login concept of its own and should never
  // coexist with the PIN screen visible. Belt-and-suspenders on top of the
  // actual fix (a duplicate display:flex in #pin-screen's own static HTML
  // that silently overrode its intended display:none default) — this
  // ensures that stays true even if some future CSS mistake reintroduces a
  // similar issue, rather than relying solely on the element's default
  // state being correct.
  hidePinScreen();
  const wiz = document.getElementById('setup-wizard');
  if (!wiz) { return; }
  wiz.style.display = 'block';
  let role = null;          // 'host' | 'slave'
  let step = 1;
  let keyModeActive = false; // step 6: email signup vs. pasting an existing key directly

  const stepEl = (n) => wiz.querySelector(`.wiz-step[data-step="${n}"]`);
  const showStep = (n) => {
    step = n;
    wiz.querySelectorAll('.wiz-step').forEach(el => el.style.display = 'none');
    const finishStatus = document.getElementById('wiz-finish-status');
    if (finishStatus) finishStatus.textContent = ''; // clear any stale save-failure message from a previous attempt
    // Step 2 (host address) only exists for a display; step 5 (Home Assistant)
    // is skipped for one too — see that step's own HTML comment for why.
    if (n === 2 && role !== 'slave') n = 3;
    if (n === 5 && role === 'slave') n = 6;
    stepEl(n).style.display = 'block';
    step = n;
    if (n === 4) populateThemeGrid();
    // Step 3's own PIN field only applies to a host — a slave's PIN is
    // already fully decided by the host-PIN field in step 2, so showing a
    // second, functionally-inert PIN field here would just be confusing.
    if (n === 3) {
      const pinWrap = document.getElementById('wiz-pin-fields-wrap');
      if (pinWrap) pinWrap.style.display = (role === 'slave') ? 'none' : '';
    }
    document.getElementById('wiz-back').style.display = (n === 1) ? 'none' : '';
    // Skip applies to step 3 (optional basics), step 4 (optional theme), and
    // step 5 (optional Home Assistant) — step 6 (email) is required, not
    // skippable, and doesn't exist at all for a slave device.
    document.getElementById('wiz-skip').style.display = (n === 3 || n === 4 || n === 5) ? '' : 'none';
    const next = document.getElementById('wiz-next');
    const isFinalStep = (n === 6) || (n === 3 && role === 'slave');
    next.textContent = isFinalStep ? 'Finish' : 'Next';
    // On step 1 the role buttons drive progression, so hide Next until a role is picked.
    next.style.display = (n === 1 && !role) ? 'none' : '';
  };

  // Language (the first thing asked): highlight the current one; picking another saves it and reloads the wizard in that language
  {
    const cur = (window.i18n && i18n.lang) || 'en';
    wiz.querySelectorAll('.wiz-lang-btn').forEach(b => {
      if (b.dataset.lang === cur) b.style.borderColor = '#4A6CF7';
      b.addEventListener('click', async () => {
        if (b.dataset.lang === cur) return;
        try { await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ui_language: b.dataset.lang }) }); } catch {}
        if (window.i18n) window.i18n.setLanguage(b.dataset.lang);
      });
    });
  }

  // Role selection
  wiz.querySelectorAll('.wiz-role').forEach(btn => btn.addEventListener('click', () => {
    role = btn.dataset.role;
    wiz.querySelectorAll('.wiz-role').forEach(b => b.style.borderColor = '#283149');
    btn.style.borderColor = '#4A6CF7';
    document.getElementById('wiz-next').style.display = '';
  }));

  document.getElementById('wiz-back').addEventListener('click', () => {
    if (step === 6) showStep(5);
    else if (step === 5) showStep(4);
    else if (step === 4) showStep(3);
    else if (step === 3 && role === 'slave') showStep(2);
    else showStep(1);
  });

  document.getElementById('wiz-skip').addEventListener('click', () => {
    if (step === 3) showStep(4);
    else if (step === 4) showStep(5);
    else if (step === 5) showStep(6);
    else finish();
  });

  document.getElementById('wiz-next').addEventListener('click', async () => {
    if (step === 1) {
      if (!role) return;
      showStep(role === 'slave' ? 2 : 3);
    } else if (step === 2) {
      // Validate host address AND license key are both present (mandatory
      // for a Mirror — a mirror with no independently-verified license was
      // exactly the gap that let it inherit a household's full settings
      // just by knowing a reachable address, no license or email
      // verification of any kind required).
      const host = (document.getElementById('wiz-host').value || '').trim();
      const status = document.getElementById('wiz-host-status');
      if (!host) { status.style.color = '#ff8585'; status.textContent = 'Please enter your main device\u2019s address.'; return; }
      const mirrorLicense = (document.getElementById('wiz-mirror-license').value || '').trim();
      if (!mirrorLicense) { status.style.color = '#ff8585'; status.textContent = 'Please enter your household license key.'; return; }
      // Check the key against the central server directly, rather than only
      // finding out it's wrong later when the first background sync
      // silently fails — real, immediate feedback instead of a confusing
      // "why isn't this syncing" days later.
      status.style.color = '#9aa3b8'; status.textContent = 'Checking license key…';
      const nextBtn = document.getElementById('wiz-next');
      nextBtn.disabled = true;
      let checkResult;
      try {
        checkResult = await apiFetch('/api/validate-license', { method: 'POST', body: JSON.stringify({ licenseKey: mirrorLicense }) });
      } catch { checkResult = { valid: null }; }
      nextBtn.disabled = false;
      if (checkResult && checkResult.valid === false) {
        status.style.color = '#ff8585';
        status.innerHTML = 'We don\u2019t recognize that license key \u2014 double-check it in Settings \u2192 Version & License on your main device.'
          + '<br><br>Don\u2019t have an account yet? <a href="https://piazzahq.com/#get-started" target="_blank" rel="noopener" style="color:var(--accent,#4A6CF7)">Get a free key \u2192</a>'
          + '<br>Setting up your very first device? <a href="#" id="wiz-goto-host-link" style="color:var(--accent,#4A6CF7)">Go back and choose Host instead \u2192</a>';
        const gotoHostLink = document.getElementById('wiz-goto-host-link');
        // Reuses the existing wiz-back button's own click handler (which
        // already correctly returns to step 1 from step 2) rather than
        // duplicating that navigation logic here.
        if (gotoHostLink) gotoHostLink.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById('wiz-back').click();
        });
        return;
      }
      // valid === true (confirmed) or valid === null (couldn't reach the
      // central server right now, e.g. still connecting to wifi during
      // setup) both proceed — only a definite "no" blocks. The host-side
      // check at actual sync time is still the real enforcement either way.
      status.style.color = '#9aa3b8'; status.textContent = 'Saved.';
      showStep(3);
    } else if (step === 3) {
      if (role === 'slave') { finish(); return; }
      showStep(4);
    } else if (step === 4) {
      showStep(5);
    } else if (step === 5) {
      showStep(6);
    } else if (step === 6) {
      await registerAndFinish();
    } else {
      finish();
    }
  });

  // ── Step 4: theme picker ─────────────────────────────────────────────────
  // Reuses the same TEMPLATE_SWATCH/TEMPLATE_EMOJI swatches the Layout tab's
  // Template Gallery already uses, for visual consistency — but only applies
  // a theme color, not a full template (layout + widgets). Deliberately does
  // NOT call /api/templates/apply: that endpoint always INSERTS A NEW display
  // row, and a fresh install already auto-seeds one ("Main Display") — calling
  // it here would leave that orphaned and create a confusing duplicate. This
  // updates the existing seeded display's theme in place instead, at finish().
  // Also deliberately excludes a few TEMPLATE_* entries (photoframe,
  // dailydigest, commandcenter) that are full-template presets without a
  // matching CSS theme of their own — setting one as a plain theme value would
  // silently do nothing visually, the opposite of this step's whole point.
  let selectedTheme = '';
  const WIZARD_THEME_IDS = ['flightdeck','homehub','moderndark','chalkboard','corkboard','postit',
    'nautical','aviation','minimalfam','minimal','autumn','spring','summer','christmas','halloween',
    'valentine','easter','birthday','july4','newyear','custom'];
  function populateThemeGrid() {
    const grid = document.getElementById('wiz-theme-grid');
    if (grid.dataset.built) return; // build once
    grid.dataset.built = '1';
    grid.innerHTML = WIZARD_THEME_IDS.map(id => `
      <div class="wiz-theme-card" data-theme="${id}" style="border:2px solid #283149;border-radius:12px;overflow:hidden;cursor:pointer;background:#171c2c">
        <div style="height:52px;background:${TEMPLATE_SWATCH[id] || '#222'};display:flex;align-items:center;justify-content:center;font-size:22px">
          ${TEMPLATE_EMOJI[id] || '🎨'}
        </div>
        <div style="padding:6px 4px;text-align:center;font-size:10px;color:#cfd6e6;text-transform:capitalize">${id}</div>
      </div>`).join('');
    grid.querySelectorAll('.wiz-theme-card').forEach(card => card.addEventListener('click', () => {
      selectedTheme = (selectedTheme === card.dataset.theme) ? '' : card.dataset.theme; // tap again to deselect
      grid.querySelectorAll('.wiz-theme-card').forEach(c => c.style.borderColor = '#283149');
      if (selectedTheme) card.style.borderColor = '#4A6CF7';
    }));
  }

  // Let someone who already has a license key (e.g. from the website's own
  // signup form, which gives a standalone key with no device connection at
  // all) skip the email flow and paste it directly instead.
  const toggleKeyModeLink = document.getElementById('wiz-toggle-key-mode');
  if (toggleKeyModeLink) {
    toggleKeyModeLink.addEventListener('click', (e) => {
      e.preventDefault();
      keyModeActive = !keyModeActive;
      document.getElementById('wiz-email-mode').style.display = keyModeActive ? 'none' : 'block';
      document.getElementById('wiz-key-mode').style.display = keyModeActive ? 'block' : 'none';
      toggleKeyModeLink.textContent = keyModeActive
        ? 'Don\u2019t have a key yet? Use your email instead \u2192'
        : 'Already have a license key? Enter it directly \u2192';
      document.getElementById('wiz-email-status').textContent = '';
    });
  }

  async function registerAndFinish() {
    if (keyModeActive) return finishWithDirectKey();
    const emailInput = document.getElementById('wiz-email');
    const status = document.getElementById('wiz-email-status');
    const conflictCard = document.getElementById('wiz-host-conflict-card');
    const email = (emailInput.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.style.color = '#ff8585';
      status.textContent = 'Please enter a valid email address.';
      return;
    }
    const next = document.getElementById('wiz-next');
    next.disabled = true;
    next.textContent = 'Registering…';
    status.style.color = '#9aa3b8';
    status.textContent = '';
    conflictCard.style.display = 'none';
    try {
      const r = await apiFetch('/api/register-trial', { method: 'POST', body: JSON.stringify({ email }) });
      if (r && r.error === 'host_conflict') {
        // A real, common setup situation — not a generic failure — gets a
        // real choice UI instead of just an error string. See the card's
        // own HTML comment for why.
        status.textContent = '';
        const lastSeenTxt = r.otherHostLastSeen ? `, last seen ${new Date(r.otherHostLastSeen).toLocaleDateString()}` : '';
        document.getElementById('wiz-host-conflict-text').textContent =
          `${email} is already registered to another device${lastSeenTxt}. If you're setting up a second real screen for the same household, it should be a Mirror, not a second host.`;
        conflictCard.style.display = 'block';
        next.disabled = false;
        next.textContent = 'Finish';
        return;
      }
      if (!r || !r.ok) throw new Error((r && r.error) || 'Registration failed.');
      if (r.emailed) {
        // Existing email — the real key was emailed rather than returned
        // here (see /api/register-trial's own comment for why: this step
        // has no PIN to gate it yet during initial setup, so handing back
        // an EXISTING license's key directly would be exactly the
        // vulnerability that was fixed on the marketing site's identical
        // flow, just reached through a different door). Nothing was saved
        // locally. A toast (not a blocking status message) matters here
        // specifically: step 6's Next/Finish click handler unconditionally
        // calls registerAndFinish() again on every click with no state
        // tracking — blocking here and waiting for a second click would
        // just re-trigger this exact same email lookup and land right back
        // here, forever, with no way to actually finish setup.
        showToast(`We've sent your existing key to ${email} — paste it into Settings → Version & License once you have it.`, 5000);
      }
      finish();
    } catch (e) {
      // Deliberately does NOT proceed on failure — required means required. Gives
      // a clear error and lets them retry (e.g. wifi not fully connected yet)
      // rather than being a dead end with no way forward at all.
      status.style.color = '#ff8585';
      status.textContent = (e && e.message) || 'Could not reach the update server. Check your internet connection and try again.';
      next.disabled = false;
      next.textContent = 'Finish';
    }
  }

  async function finishWithDirectKey() {
    const keyInput = document.getElementById('wiz-license-key-direct');
    const status = document.getElementById('wiz-email-status');
    const key = (keyInput.value || '').trim();
    if (!key) {
      status.style.color = '#ff8585';
      status.textContent = 'Please enter your license key.';
      return;
    }
    const next = document.getElementById('wiz-next');
    next.disabled = true;
    next.textContent = 'Checking…';
    status.style.color = '#9aa3b8';
    status.textContent = 'Checking license key…';
    let checkResult;
    try {
      checkResult = await apiFetch('/api/validate-license', { method: 'POST', body: JSON.stringify({ licenseKey: key }) });
    } catch { checkResult = { valid: null }; }
    next.disabled = false;
    next.textContent = 'Finish';
    if (checkResult && checkResult.valid === false) {
      status.style.color = '#ff8585';
      status.textContent = 'We don\u2019t recognize that license key \u2014 double-check it, or use your email instead.';
      return;
    }
    // valid === true (confirmed) or valid === null (couldn't reach the
    // central server right now) both proceed — only a definite "no" blocks,
    // same reasoning as the mirror setup path.
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ update_license_key: key }) });
      // Real, reported bug fixed here: without this, license_status_cache
      // stays whatever the periodic check-in last found — which, for a
      // brand new setup, usually already ran once at ~90s after boot,
      // before this key was ever entered, caching "no license." The next
      // refresh after that is up to 6 HOURS away (see periodicUpdateCheck's
      // own schedule), so a correctly-entered, genuinely valid key could
      // sit showing "No license — free trial" for hours, not a brief
      // delay. The Settings tab's own key-entry field already does this
      // exact refresh immediately after saving (see its own comment for
      // the identical reasoning) — this wizard path just never got the
      // same fix applied to it.
      await apiFetch('/api/refresh-license', { method: 'POST' });
    } catch {} // best-effort — finish() below still saves setup_complete regardless
    finish();
  }
  document.getElementById('wiz-conflict-claim-btn').addEventListener('click', () => {
    document.getElementById('wiz-host-conflict-card').style.display = 'none';
    document.getElementById('wiz-email-status').textContent = '';
    // Switches into the exact same "I already have a key" mode the toggle
    // link above uses — finishWithDirectKey() doesn't even check for a
    // host conflict at all (see its own comment), so this sidesteps the
    // wizard's conflict check entirely rather than duplicating any claim
    // logic here. If a real conflict still exists after setup completes,
    // it's picked up properly moments later by the ongoing check-in flow's
    // own Claim/Slave/Trial modal — the one that already has a real,
    // working, one-tap Claim button. Requiring the actual key here (not a
    // bare "yes it's me" click) matters: reaching THIS card only required
    // knowing/typing an email address, no secret at all — adding a
    // no-proof claim button directly to it would have undone that
    // protection; routing through the key-verified path instead keeps the
    // same bar regardless of which door someone came in through.
    keyModeActive = true;
    document.getElementById('wiz-email-mode').style.display = 'none';
    document.getElementById('wiz-key-mode').style.display = 'block';
    if (toggleKeyModeLink) toggleKeyModeLink.textContent = 'Don\u2019t have a key yet? Use your email instead \u2192';
    const keyInput = document.getElementById('wiz-license-key-direct');
    if (keyInput) { keyInput.value = ''; keyInput.focus(); }
  });
  document.getElementById('wiz-conflict-mirror-btn').addEventListener('click', () => {
    role = 'slave';
    document.getElementById('wiz-host-conflict-card').style.display = 'none';
    document.getElementById('wiz-email-status').textContent = '';
    // Jump straight to the host-address step — role is already decided, no
    // reason to send them back through step 1's role picker they've
    // effectively already answered by hitting this conflict.
    showStep(2);
  });
  document.getElementById('wiz-conflict-email-btn').addEventListener('click', () => {
    document.getElementById('wiz-host-conflict-card').style.display = 'none';
    const emailInput = document.getElementById('wiz-email');
    emailInput.value = '';
    emailInput.focus();
  });
  const wizPinInput = document.getElementById('wiz-pin');
  if (wizPinInput) wizPinInput.addEventListener('input', () => {
    document.getElementById('wiz-pin-confirm').style.display = wizPinInput.value.trim() ? 'block' : 'none';
  });

  async function finish() {
    const pin = (document.getElementById('wiz-pin').value || '').trim();
    const pinConfirm = (document.getElementById('wiz-pin-confirm').value || '').trim();
    if (pin && pin !== pinConfirm) {
      const status = document.getElementById('wiz-finish-status');
      if (status) { status.style.color = '#ff8585'; status.textContent = "PINs don't match — try again."; }
      document.getElementById('wiz-pin-confirm').focus();
      return;
    }
    const payload = { device_role: role || 'host', setup_complete: '1' };
    if (role === 'slave') {
      const raw = (document.getElementById('wiz-host').value || '').trim()
        .replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      // Split optional :port
      let addr = raw, port = '3000';
      const m = raw.match(/^(.*?):(\d+)$/);
      if (m) { addr = m[1]; port = m[2]; }
      // Tailscale (100.x) vs LAN — store in the matching field so hostBaseURL resolves it.
      if (/^100\./.test(addr)) payload.host_ts_address = addr;
      else payload.host_lan_address = addr;
      payload.host_port = port;
      const hostPin = (document.getElementById('wiz-host-pin').value || '').trim();
      // A slave's own PIN IS the household's shared PIN, not a separate
      // value — whatever's entered here becomes this device's own app_pin
      // directly, so it doubles as both "unlock this device's own control
      // app" and "the credential this device presents when syncing with
      // the host." Simpler than tracking two separate PIN concepts, and
      // means the host can push updates back to this device using just its
      // own PIN too, since they're guaranteed to match.
      if (hostPin) payload.app_pin = hostPin;
      const mirrorLicense = (document.getElementById('wiz-mirror-license').value || '').trim();
      if (mirrorLicense) payload.update_license_key = mirrorLicense;
    }
    // Optional basics
    const name = (document.getElementById('wiz-name').value || '').trim();
    const loc  = (document.getElementById('wiz-loc').value || '').trim();
    if (name) payload.display_name = name;
    let zipToGeocode = null;
    if (loc) {
      // Anything short, alphanumeric, and comma-free is treated as a postal
      // code and sent to geocoding — covers US ZIPs (66215), ZIP+4
      // (66215-1234), and non-US formats like UK (SW1A 1AA) or Canada
      // (K1A 0B1). A comma, or anything long/wordy, reads as a typed
      // description ("Denver, CO" or "our lake house") rather than a code,
      // so it's stored as a manual label instead of sent to geocoding.
      if (!loc.includes(',') && loc.length <= 10 && /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(loc) && /\d/.test(loc)) {
        zipToGeocode = loc;
      } else {
        payload.weather_location_manual = loc;
      }
    }
    // A slave's PIN was already fully decided by the host-PIN field in step 2
    // (see its own comment) — this step's own PIN field only applies to a
    // host, so a slave filling it in too (even accidentally) can't silently
    // overwrite the value that's supposed to match the household's shared PIN.
    if (pin && role !== 'slave') payload.app_pin = pin;
    // Optional Home Assistant connection (host only — step 5 doesn't exist
    // for a slave device, so these fields simply won't be present then).
    const haUrl = document.getElementById('wiz-ha-url') ? (document.getElementById('wiz-ha-url').value || '').trim() : '';
    const haToken = document.getElementById('wiz-ha-token') ? (document.getElementById('wiz-ha-token').value || '').trim() : '';
    if (haUrl) payload.ha_base_url = haUrl;
    if (haToken) payload.ha_token = haToken;

    const next = document.getElementById('wiz-next');
    next.disabled = true; next.textContent = 'Saving…';
    // Real bug fixed here: this used to swallow a failed settings save
    // silently (bare `catch {}`) and reload anyway regardless of whether it
    // actually worked — if setup_complete never actually made it to the
    // server (a network hiccup, the host being unreachable while THIS
    // device is mid-setup, anything), the reload landed back on a wizard
    // that still thinks setup isn't done, from scratch, with everything
    // just typed now lost. That's exactly what "keeps crashing and brings
    // me back to the start" looks like from the outside — not a crash,
    // a silent failure plus an unconditional reload. Now verifies the save
    // actually reflects setup_complete before reloading, and shows a real,
    // visible error with the typed info still intact if it didn't.
    let saved = false;
    try {
      const result = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      saved = !!(result && result.setup_complete === '1');
    } catch {}
    if (!saved) {
      const status = document.getElementById('wiz-finish-status');
      if (status) {
        status.style.color = '#ff8585';
        status.textContent = 'Could not save setup — check your connection and try again. Nothing you entered was lost.';
      }
      next.disabled = false;
      next.textContent = 'Finish';
      return;
    }
    if (selectedTheme && role !== 'slave') {
      // Apply the chosen look to the auto-seeded "Main Display" in place —
      // updating its theme, not creating a second display alongside it.
      try {
        const displays = await apiFetch('/api/displays');
        const main = Array.isArray(displays) ? (displays.find(d => d.slug === 'main') || displays[0]) : null;
        if (main) await apiFetch(`/api/displays/${main.id}`, { method: 'PUT', body: JSON.stringify({ theme: selectedTheme }) });
      } catch {} // best-effort — a failed theme apply shouldn't block finishing setup
    }
    if (zipToGeocode) {
      // Real geocoding (ZIP -> lat/lon), not just saving the raw digits as a
      // setting — that alone was a real bug: nothing ever converted it into
      // coordinates, so the weather widget had nothing to actually fetch with
      // and stayed stuck on "loading weather" forever. Same endpoint Settings'
      // own "Zip lookup" button already uses. Best-effort: an invalid/
      // unrecognized ZIP shouldn't block finishing setup, since it's easy to
      // fix later from Settings.
      try { await apiFetch('/api/geocode?zip=' + encodeURIComponent(zipToGeocode)); } catch {}
    }
    // Reload into the normal app now that setup is genuinely complete.
    window.location.reload();
  }

  showStep(1);
}

// ── Spotlight tour ─────────────────────────────────────────────────────────
// Short and to the point on purpose — 5 stops over the top-level tabs someone
// actually needs to know exist, not every button in the app. Deeper features
// (weather setup, remote access, chores) are better discovered via the
// getting-started checklist below, at the person's own pace, than crammed
// into a tour they're likely to click through without reading.
const TOUR_STEPS = [
  { selector: '.tab[data-tab="favorites"]', title: 'Favorites', text: "The first thing you'll see when you open the app — quick actions and at-a-glance status, picked by you. Tap + Add a Card to build it out." },
  { selector: '.tab[data-tab="calendars"]', title: 'Your calendar', text: "Add events, see what's coming up, and manage everything that shows on the wall display's calendar." },
  { selector: '.tab[data-tab="photos"]', title: 'Photos', text: 'Upload photos here to run as a slideshow on the display — a whole family album, not just one dashboard.' },
  { selector: '.tab[data-tab="layout"]', title: 'Layout', text: 'Pick a theme and arrange what shows on the display — drag widgets around, resize them, make it yours.' },
  { selector: '.tab[data-tab="displays"]', title: 'Devices', text: 'Every screen connected to your account shows up here, including a spot to add more if you want multiple displays.' },
  { selector: '.tab[data-tab="settings"]', title: 'Settings', text: 'Weather, remote access, and everything else lives here — including a link to see this tour again, if you ever want to.' },
];
let _tourIndex = 0;

function startTour() {
  _tourIndex = 0;
  document.getElementById('tour-blocker').style.display = 'block';
  document.getElementById('tour-spotlight').style.display = 'block';
  document.getElementById('tour-callout').style.display = 'block';
  showTourStep(0);
}

function showTourStep(i) {
  const step = TOUR_STEPS[i];
  const el = document.querySelector(step.selector);
  if (!el) { nextTourStep(); return; } // skip a step whose target isn't present for some reason
  el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  // The tab bar scrolls horizontally on narrow screens — give that a moment
  // to finish before measuring the target's real position.
  setTimeout(() => positionTourStep(el, i), 260);
}

function positionTourStep(el, i) {
  const step = TOUR_STEPS[i];
  const r = el.getBoundingClientRect();
  const PAD = 6;
  const spot = document.getElementById('tour-spotlight');
  spot.style.top = (r.top - PAD) + 'px';
  spot.style.left = (r.left - PAD) + 'px';
  spot.style.width = (r.width + PAD * 2) + 'px';
  spot.style.height = (r.height + PAD * 2) + 'px';

  document.getElementById('tour-step-count').textContent = `Step ${i + 1} of ${TOUR_STEPS.length}`;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-text').textContent = step.text;
  document.getElementById('tour-next').textContent = (i === TOUR_STEPS.length - 1) ? 'Done' : 'Next';

  // Prefer positioning the callout below the target; flip above it if there
  // isn't enough room (e.g. a tab near the bottom of a short screen).
  const callout = document.getElementById('tour-callout');
  const calloutHeight = callout.offsetHeight || 140;
  const spaceBelow = window.innerHeight - r.bottom;
  const top = (spaceBelow > calloutHeight + 24) ? (r.bottom + 14) : Math.max(10, r.top - calloutHeight - 14);
  const left = Math.min(Math.max(10, r.left), window.innerWidth - 316);
  callout.style.top = top + 'px';
  callout.style.left = left + 'px';
}

function nextTourStep() {
  _tourIndex++;
  if (_tourIndex >= TOUR_STEPS.length) { endTour(); return; }
  showTourStep(_tourIndex);
}

async function endTour() {
  document.getElementById('tour-blocker').style.display = 'none';
  document.getElementById('tour-spotlight').style.display = 'none';
  document.getElementById('tour-callout').style.display = 'none';
  try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ tour_completed: '1' }) }); } catch {}
}

if (document.getElementById('tour-next')) document.getElementById('tour-next').addEventListener('click', nextTourStep);
if (document.getElementById('tour-skip')) document.getElementById('tour-skip').addEventListener('click', endTour);
window.addEventListener('resize', () => {
  const spot = document.getElementById('tour-spotlight');
  if (spot && spot.style.display === 'block') {
    const el = document.querySelector(TOUR_STEPS[_tourIndex].selector);
    if (el) positionTourStep(el, _tourIndex);
  }
});

// Reads host_conflict_cache (populated by storeLicenseInfo() server-side
// from the mothership's response) and, if present, shows the popup. Called
// on every app load — the cache is cleared the moment a conflict is
// resolved (by /api/resolve-host-conflict) or naturally on the next
// check-in that no longer reports one, so this doesn't keep re-showing
// something already handled.
let _hostConflictWired = false;
function checkHostConflict(s) {
  if (!s || !s.host_conflict_cache) { document.getElementById('host-conflict-modal').style.display = 'none'; return; }
  let conflict;
  try { conflict = JSON.parse(s.host_conflict_cache); } catch { return; }
  if (!conflict || !conflict.otherHostDeviceId) return;

  document.getElementById('hc-other-device').textContent = conflict.otherHostDeviceId;
  const lastSeenEl = document.getElementById('hc-other-lastseen');
  if (conflict.otherHostLastSeen) {
    const d = new Date(conflict.otherHostLastSeen);
    lastSeenEl.textContent = isNaN(d) ? '' : `That device last checked in ${d.toLocaleString()}.`;
  } else {
    lastSeenEl.textContent = '';
  }
  document.getElementById('host-conflict-modal').style.display = 'flex';

  if (_hostConflictWired) return; // buttons only need wiring once, ever
  _hostConflictWired = true;
  const statusEl = document.getElementById('hc-status');
  const resolve = async (action, label) => {
    statusEl.textContent = label;
    document.querySelectorAll('#host-conflict-modal button').forEach(b => b.disabled = true);
    try {
      const r = await apiFetch('/api/resolve-host-conflict', { method: 'POST', body: JSON.stringify({ action }) });
      if (r && r.error) { statusEl.textContent = '❌ ' + r.error; document.querySelectorAll('#host-conflict-modal button').forEach(b => b.disabled = false); return; }
      document.getElementById('host-conflict-modal').style.display = 'none';
      if (action === 'slave') showToast('Saved — finish setting the other device\u2019s address under Settings → Multi-Device.');
      else showToast('Saved ✓');
    } catch {
      statusEl.textContent = '❌ Could not reach the update server — try again in a moment.';
      document.querySelectorAll('#host-conflict-modal button').forEach(b => b.disabled = false);
    }
  };
  document.getElementById('hc-claim-btn').addEventListener('click', () => resolve('claim', 'Setting this device as the main one…'));
  document.getElementById('hc-slave-btn').addEventListener('click', () => resolve('slave', 'Saving…'));
  document.getElementById('hc-trial-btn').addEventListener('click', () => resolve('trial', 'Switching to a free license…'));
  document.getElementById('hc-dismiss-btn').addEventListener('click', () => {
    document.getElementById('host-conflict-modal').style.display = 'none';
  });
}

async function init() {
  // First-run: if setup hasn't been completed on this device, show the wizard and
  // stop here. The wizard reloads the page when done, re-entering init() with setup
  // complete. This is per-device (setup_complete is a LOCAL_ONLY setting).
  let s0 = null;
  try {
    s0 = await apiFetch('/api/settings');
    // Real bug fixed here: a 401 (this device has a PIN and this browser
    // isn't currently authenticated — an entirely normal, expected state on
    // every fresh page load for a PIN-protected device, not an error) used
    // to come back from apiFetch() as a plain empty object, indistinguishable
    // from "this device's settings are genuinely empty." !s0.setup_complete
    // would then be true for BOTH cases, incorrectly launching the first-run
    // wizard on a device that was actually fully set up. Fixed by gating
    // JUST the wizard-trigger condition on __authFailed — deliberately NOT
    // returning out of init() entirely here (an earlier version of this fix
    // did exactly that, which quietly broke something worse: it skipped
    // checkAuth() and everything after it below on EVERY normal page load
    // for a PIN-protected device, not just this one edge case, since the
    // settings fetch above is the very first network call init() makes and
    // will always 401 before a fresh browser has logged in). apiFetch()
    // already shows the PIN screen itself for a 401 — checkAuth() below is
    // a second, independent, correct way of arriving at the same "not
    // authenticated" state via /api/auth/status, and needs to still run
    // normally so the rest of startup proceeds once login succeeds.
    if (s0 && !s0.__authFailed && !s0.setup_complete) {
      // A previous incomplete/abandoned setup attempt can leave device_role
      // (and host_* fields, from an attempted slave/Mirror setup) behind
      // even though setup itself never actually finished. Confirmed as a
      // real source of confusion: a fresh retry's very first settings
      // write would see this stale device_role already in the database
      // and get routed through slaveWriteGuard's host-proxy logic based
      // on leftover state from an attempt that never completed, instead
      // of starting genuinely clean — which is exactly what made an
      // earlier "wizard keeps failing" report so hard to pin down. Reset
      // it here, before the wizard even shows, so every fresh attempt
      // starts from the same known-clean state regardless of what a prior
      // abandoned attempt left behind.
      if (s0.device_role) {
        try {
          await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({
            device_role: '', host_lan_address: '', host_ts_address: '', host_port: '',
          }) });
          s0.device_role = ''; s0.host_lan_address = ''; s0.host_ts_address = ''; s0.host_port = '';
        } catch {} // best-effort — a failed cleanup just leaves prior behavior unchanged, not a new failure mode
      }
      runSetupWizard(s0);
      return;
    }
  } catch {}

  const authed = await checkAuth();
  if (authed) {
    try { await initProfiles(); } catch (e) { console.error('profiles init', e); }
    loadEvents();
    // If this page load is the result of a pull-to-refresh, return to
    // whichever tab that was triggered from instead of always landing back
    // on Calendar (loadEvents' own default render). Reuses the real tab
    // button's click handler (rather than duplicating its active-class/
    // currentTab/renderTab logic here) so this behaves exactly like the
    // person tapping that tab themselves.
    try {
      const returnTab = localStorage.getItem('pull_refresh_return_tab');
      if (returnTab) {
        localStorage.removeItem('pull_refresh_return_tab');
        const btn = document.querySelector(`.tab[data-tab="${returnTab}"]`);
        if (btn) btn.click();
      } else if (currentTab !== 'favorites') {
        // Content for the right tab is already rendering (currentTab was set
        // from getDefaultTab() before loadEvents()/renderTab() ran above) —
        // this just fixes the tab bar's own visual highlight, which is
        // hardcoded to Favorites in the static HTML. Directly swapping the
        // class here (not simulating a click) avoids a second, wasted
        // render of content that's already correct.
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        const btn = document.querySelector(`.tab[data-tab="${currentTab}"]`);
        if (btn) { btn.classList.add('active'); btn.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' }); }
      }
    } catch {}
    // Surface read-only mode if this device is a slave.
    try {
      const s = await apiFetch('/api/settings');
      checkHostConflict(s);
      // Spotlight tour: host devices only, once, right after the settings that
      // decide this are actually available. A slave device is read-only and
      // mostly mirrors the host, so touring its own tab bar wouldn't add much.
      if (s && (s.device_role || 'host') === 'host' && !s.tour_completed) {
        setTimeout(() => { try { startTour(); } catch (e) { console.error('tour', e); } }, 600);
      }
      // Chores/To-Do/Shopping tab is optional and now consolidated under
      // Family Hub — see updateFamilyHubVisibility()'s own comment.
      updateFamilyHubVisibility(s);
      if (s && s.device_role === 'slave') {
        const b = document.getElementById('slave-banner');
        if (b) b.style.display = '';
        // Disable the daily-email controls on a slave (host sends it) and show why.
        const note = document.getElementById('briefing-slave-note');
        if (note) note.style.display = '';
        const bfEnabled = document.getElementById('bf-enabled');
        if (bfEnabled) bfEnabled.disabled = true;
        const bfFields = document.getElementById('bf-fields');
        if (bfFields) { bfFields.style.opacity = '.4'; bfFields.style.pointerEvents = 'none'; }
      } else {
        // Host-only: proactively surface (a) a newer release upstream, and (b) any
        // slave screens that haven't caught up yet — checked here so it's visible
        // the moment the app opens, not only if the parent happens to dig into
        // Settings or Displays on their own.
        checkFleetUpdateStatus();
        setInterval(checkFleetUpdateStatus, 600_000); // every 10 min
        checkLicenseGraceBanner();
        setInterval(checkLicenseGraceBanner, 600_000); // every 10 min
        checkFeedbackReplyBanner();
        setInterval(checkFeedbackReplyBanner, 600_000); // every 10 min
        // Delayed slightly so it doesn't compete with the tour/other startup
        // banners above for attention on the very first paint — same
        // reasoning as startTour()'s own 600ms delay just above.
        setTimeout(() => { try { maybeShowFeedbackPopup(s); } catch (e) { console.error('feedback popup', e); } }, 1200);
      }
      // HA alert banner — host AND slave (a slave proxies the active list).
      checkHaAlertBannerApp();
      setInterval(checkHaAlertBannerApp, 60_000);
      window.addEventListener('focus', () => { checkHaAlertBannerApp(); });
    } catch {}

    // Watch for a server update and force a refresh — without yanking the page out
    // from under someone mid-edit at the exact moment it becomes available. Unlike
    // the wall display (which hard-reloads instantly, since there's nothing to lose
    // there), the control app shows a banner with a visible countdown: reloads on
    // its own after a grace period, or immediately if tapped, or postponed by 5
    // minutes if genuinely mid-task — but it does still force it eventually, fixing
    // the "I updated but the new feature isn't showing" stale-page confusion.
    let _appBootVersion = null;
    try { const v = await apiFetch('/api/version'); if (v && !v.__authFailed) { _appBootVersion = v.version; initAppDemo(v); } } catch {}
    // Staggered after the tour (600ms) and before the feedback popup
    // (1200ms) — same "don't compete for attention on first paint" reasoning
    // as both of those already use.
    setTimeout(() => { try { checkForNewVersionPopup(_appBootVersion); } catch (e) { console.error('whats-new popup', e); } }, 900);
    setInterval(async () => {
      try {
        const v = await apiFetch('/api/version');
        if (v && !v.__authFailed && _appBootVersion && v.version && v.version !== _appBootVersion) {
          startAppReloadCountdown();
        }
      } catch { /* server mid-restart; check again next tick */ }
    }, 60_000);
  }
}

let _appReloadTimer = null;
function startAppReloadCountdown(seconds = 20) {
  const ub = document.getElementById('update-banner');
  const countdownEl = document.getElementById('update-banner-countdown');
  if (!ub) return;
  ub.style.display = '';
  if (_appReloadTimer) clearInterval(_appReloadTimer);
  let remaining = seconds;
  const tick = () => {
    countdownEl.textContent = ` (refreshing in ${remaining}s)`;
    if (remaining <= 0) { clearInterval(_appReloadTimer); window.location.reload(); return; }
    remaining--;
  };
  tick();
  _appReloadTimer = setInterval(tick, 1000);
}
function postponeAppReload(e) {
  e.preventDefault();
  if (_appReloadTimer) clearInterval(_appReloadTimer);
  document.getElementById('update-banner').style.display = 'none';
  // Still forces it eventually — just not right this moment.
  setTimeout(() => startAppReloadCountdown(20), 5 * 60 * 1000);
}

// Tapping the top banner now actually installs the update, rather than just
// navigating to Settings and making the person find and tap the button there
// too. Self-contained (not reusing the Settings tab's own pollForReturn) since
// that function closes over Settings-tab-local elements that may not even be
// on screen when this banner is tapped from elsewhere in the app.
async function installUpdateFromBanner() {
  const banner = document.getElementById('server-update-banner');
  if (!banner) return;
  banner.onclick = null; // prevent double-taps while this is in flight
  banner.style.cursor = 'default';
  banner.textContent = '⏳ Downloading and installing the update…';
  let resp = null;
  let networkError = false;
  try {
    resp = await apiFetch('/api/update-from-server', { method: 'POST' });
  } catch {
    // The server often exits to restart moments after sending this
    // response (applying the update) — depending on timing, that can cut
    // the connection before this fetch fully receives it, throwing a
    // network-level error even though the update actually started fine
    // server-side. Falls through to the same polling path as a normal
    // success below, rather than declaring failure outright — the poll
    // loop finds out either way. A REAL failure (no update available, a
    // download error) returns a clean JSON response and never reaches this
    // catch at all, so this doesn't risk masking an actual problem.
    networkError = true;
  }
  if ((resp && resp.ok) || networkError) {
    banner.textContent = (resp && resp.to) ? `✓ Updating to v${resp.to} — restarting…` : '✓ Update started — restarting…';
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      try {
        const d = await apiFetch('/api/version', { cache: 'no-store' });
        if (d && !d.__authFailed) {
          clearInterval(iv);
          banner.style.display = 'none';
          showToast(`✅ Updated to v${d.version} — reloading…`);
          // Reload so this app actually picks up the new code — otherwise the
          // update completes on the server but the page keeps running the old,
          // stale JavaScript until someone manually refreshes. Short delay so
          // the toast is actually visible first.
          setTimeout(() => window.location.reload(), 1200);
        }
      } catch { /* still restarting — keep polling */ }
      if (tries > 60) { // ~60s — download + restart can take a little longer
        clearInterval(iv);
        banner.textContent = "⚠️ Taking longer than expected — tap to check Settings.";
        banner.onclick = () => document.querySelector('.tab[data-tab="settings"]').click();
        banner.style.cursor = 'pointer';
      }
    }, 1000);
  } else {
    // The real reason (a version-check failure, a download error, a
    // validation rejection, etc.) is already sitting in resp.error — the
    // server's own /api/update-from-server route always returns one on
    // failure. Previously discarded entirely in favor of the same generic
    // text regardless of cause, which is exactly why this was
    // undiagnosable from the app itself: journalctl never logs this route's
    // failures (it returns the error directly to the client instead of
    // logging server-side), so the response body was the ONLY place the
    // real reason ever existed.
    const reason = (resp && resp.error) ? resp.error : 'Unknown error.';
    banner.textContent = `❌ Update failed: ${reason}`;
    banner.onclick = () => document.querySelector('.tab[data-tab="settings"]').click();
    banner.style.cursor = 'pointer';
  }
}

// Host-only. Checks two independent things and surfaces each with a banner + a dot
// on the relevant tab, so a parent notices without having to remember to look:
//   1. Is a newer release available from the central server? (Settings tab)
//   2. Are any online slave screens running an older version than this host? (Displays tab)
async function checkFleetUpdateStatus() {
  try {
    const info = await apiFetch('/api/update-check');
    const serverBanner = document.getElementById('server-update-banner');
    const settingsDot = document.getElementById('settings-tab-dot');
    if (info && info.updateAvailable) {
      if (serverBanner) {
        serverBanner.textContent = `🆕 Version ${info.latestVersion} is available — tap to update.`;
        serverBanner.style.display = 'block';
      }
      if (settingsDot) settingsDot.classList.add('show');
    } else {
      if (serverBanner) serverBanner.style.display = 'none';
      if (settingsDot) settingsDot.classList.remove('show');
    }
  } catch { /* update server unreachable — leave prior banner state alone */ }

  try {
    const [ver, screens] = await Promise.all([
      apiFetch('/api/version').catch(() => ({})),
      apiFetch('/api/screens').catch(() => []),
    ]);
    window._hostVersion = (ver && !ver.__authFailed ? ver.version : null) || window._hostVersion || '';
    // Grace period after the host's OWN version changes — right after
    // updating the host, every mirror is legitimately still on the old
    // version until it polls/receives its own push, which isn't instant.
    // Without this, the very next check after updating always fires a
    // false-alarm "screens are behind" warning for something that isn't
    // actually a problem yet, just a normal in-progress rollout. Detected
    // client-side (comparing this check's version against the last one
    // THIS browser saw) rather than a server-side timestamp, since the
    // host's own app is what both applies the update and is checking
    // here — no new server state needed for that to work.
    let inGracePeriod = false;
    try {
      const prevVersion = localStorage.getItem('host_version_seen');
      // Deliberately fires on a null prevVersion too (not just prevVersion
      // !== current) — this is the exact bug that shipped in beta.13's
      // first version of this code: host_version_seen didn't exist before
      // beta.13 introduced it, so the very first time this ran (updating
      // FROM beta.12, which never wrote this key), prevVersion was null,
      // the "&& prevVersion" check made the whole condition false, and the
      // brand-new grace period failed its own first real-world test by
      // never activating at all. Treating "no prior observation" the same
      // as "it just changed" is the right call anyway, not just a
      // workaround: if we don't know how long this version's been
      // running, a short precautionary grace period is a far better
      // failure mode than an immediate false alarm.
      if (ver.version && prevVersion !== ver.version) {
        localStorage.setItem('host_version_changed_at', String(Date.now()));
      }
      if (ver.version) localStorage.setItem('host_version_seen', ver.version);
      const changedAt = parseInt(localStorage.getItem('host_version_changed_at')) || 0;
      const GRACE_MS = 20 * 60 * 1000; // 20 minutes
      if (changedAt && (Date.now() - changedAt) < GRACE_MS) inGracePeriod = true;
    } catch {}
    const behind = (screens || []).filter(s =>
      s.is_remote && s.online && s.screen_version && ver.version && s.screen_version !== ver.version);
    const fleetBanner = document.getElementById('fleet-behind-banner');
    const fleetText = document.getElementById('fleet-behind-banner-text');
    const fleetClose = document.getElementById('fleet-behind-banner-close');
    const displaysDot = document.getElementById('displays-tab-dot');
    // Dismissible the same "for the rest of today" way the license-grace
    // banner already is — reappears tomorrow, or immediately if the
    // situation changes tomorrow, rather than being silenced for good
    // after one tap.
    const today = new Date().toISOString().slice(0, 10);
    const dismissedToday = localStorage.getItem('fleet_behind_banner_dismissed_on') === today;
    if (behind.length && !inGracePeriod) {
      if (fleetBanner && fleetText && !dismissedToday) {
        fleetText.textContent = `⚠️ ${behind.length} screen${behind.length===1?'':'s'} ${behind.length===1?'is':'are'} running an older version — tap to push the update.`;
        fleetBanner.style.display = 'flex';
        if (fleetClose) {
          fleetClose.onclick = (e) => {
            e.stopPropagation();
            localStorage.setItem('fleet_behind_banner_dismissed_on', today);
            fleetBanner.style.display = 'none';
          };
        }
      } else if (fleetBanner) {
        fleetBanner.style.display = 'none';
      }
      if (displaysDot) displaysDot.classList.add('show');
    } else {
      if (fleetBanner) fleetBanner.style.display = 'none';
      if (displaysDot) displaysDot.classList.remove('show');
    }
  } catch { /* screens list unreachable — leave prior banner state alone */ }
}

// A separate, additional in-app notification (kept deliberately distinct
// from the wall display's own popups, which stay as-is) — visible the
// moment the app opens regardless of which tab someone's on, not just
// buried as text within the Settings → Version & License section itself.
// Always dismissible, same "dismissed for the rest of the day" pattern
// already used on the display side, so it reappears the next day as a
// gentle reminder rather than being gone for good after one tap.
async function checkLicenseGraceBanner() {
  const banner = document.getElementById('license-grace-banner');
  const textEl = document.getElementById('license-grace-banner-text');
  const closeBtn = document.getElementById('license-grace-banner-close');
  if (!banner || !textEl) return;
  try {
    const s = await apiFetch('/api/settings');
    const noLicenseSince = Number(s && s.no_license_since) || 0;
    if (!noLicenseSince) { banner.style.display = 'none'; return; }
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('license_grace_banner_dismissed_on') === today) { banner.style.display = 'none'; return; }
    const daysSince = Math.floor((Date.now() - noLicenseSince) / 86_400_000);
    const daysLeft = 7 - daysSince;
    textEl.textContent = daysLeft > 0
      ? `⚠️ A license is required — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left before the wall display stops working. Tap to add one.`
      : `⚠️ The wall display has stopped working — tap to add a license key.`;
    textEl.onclick = () => document.querySelector('.tab[data-tab="settings"]').click();
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        localStorage.setItem('license_grace_banner_dismissed_on', today);
        banner.style.display = 'none';
      };
    }
    banner.style.display = 'flex';
  } catch { /* update server unreachable — leave prior banner state alone */ }
}

// Global, dismissible banner for a developer reply on ANY feedback thread —
// visible from wherever the app happens to be open, not just when someone's
// already sitting in Settings → Feedback & Ideas (which already had its own
// unread-reply list, just not surfaced anywhere outside that one screen).
// Reuses the exact same /api/feedback-replies data source and unread
// semantics as that existing list (default call = unread threads only) —
// this banner is a second VIEW onto the same data, not a second mechanism.
// Dismissing the banner does NOT mark threads seen server-side (that still
// only happens by actually opening the replies list, same as before) — it
// just hides today's banner via localStorage, same "per-day" dismissal
// pattern the license grace banner already uses, so it reappears once E.g.
// tomorrow, or the moment a NEW reply comes in, rather than being silenced
// forever after one dismissal.
// Polls for a selector to appear rather than guessing a fixed delay —
// renderSettings() is async (fetches settings/briefing/photo-settings/
// version before building any HTML), so a naive setTimeout after
// switching tabs would be racing an unpredictable render time instead of
// actually waiting for it. Gives up silently after ~2s (attempts default)
// rather than throwing, since the worst case here is just "the section
// doesn't auto-expand," not a broken page.
function waitFor(selector, callback, attempts) {
  attempts = attempts === undefined ? 40 : attempts;
  const el = document.querySelector(selector);
  if (el) { callback(el); return; }
  if (attempts <= 0) return;
  setTimeout(() => waitFor(selector, callback, attempts - 1), 50);
}

// Switches to Settings AND opens Feedback & Ideas specifically (it lives
// two accordion levels deep: the outer Advanced group, then its own
// section within that group) — rather than just landing on Settings' own
// top and leaving the person to find and expand it themselves.
function openFeedbackSection() {
  const settingsTab = document.querySelector('.tab[data-tab="settings"]');
  if (settingsTab) settingsTab.click();
  waitFor('.acc-section[data-acc="Advanced"] > .acc-head', (advancedToggle) => {
    const advancedSection = advancedToggle.closest('.acc-section');
    if (advancedSection && !advancedSection.classList.contains('open')) advancedToggle.click();
    // The Feedback & Ideas section only exists in the DOM once Advanced's
    // own inner accordion has been built (it's built up-front by
    // transformSettingsToAccordion() regardless of open/closed state, so
    // this should already be present — waitFor here mainly guards against
    // any remaining render timing rather than an open/closed dependency).
    waitFor('.acc-section[data-acc="Feedback & Ideas"] > .acc-head', (fbToggle) => {
      const fbSection = fbToggle.closest('.acc-section');
      if (fbSection && !fbSection.classList.contains('open')) fbToggle.click();
      fbToggle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Per-thread dismissal, NOT per-day. The previous version tracked
// dismissal with a single "dismissed today" date, which was the actual
// bug being reported: dismissing the banner for one reply suppressed it
// for the REST OF THE DAY regardless of whether a different (or newly
// re-replied-to) thread showed up afterward — a second, genuinely new
// reply arriving later that same day was silently swallowed. Fixed by
// remembering a signature per thread instead: id + how many messages are
// in it. Dismissing records the CURRENT signature of every thread shown
// at that moment; the next check only counts a thread as "new" if its
// signature isn't in that remembered set — so a different thread, or the
// SAME thread getting an additional reply (its message count goes up,
// changing its signature), both correctly show the banner again, while a
// thread whose signature is unchanged stays quiet.
function feedbackThreadSignature(t) { return `${t.id}:${(t.thread || []).length}`; }
async function checkFeedbackReplyBanner() {
  const banner = document.getElementById('feedback-reply-banner');
  const textEl = document.getElementById('feedback-reply-banner-text');
  const closeBtn = document.getElementById('feedback-reply-banner-close');
  if (!banner || !textEl) return;
  try {
    const data = await apiFetch('/api/feedback-replies');
    const threads = (data && data.threads) || [];
    if (!threads.length) { banner.style.display = 'none'; return; }
    let dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem('feedback_reply_banner_dismissed_sigs') || '[]'); } catch {}
    const dismissedSet = new Set(dismissed);
    const newThreads = threads.filter(t => !dismissedSet.has(feedbackThreadSignature(t)));
    if (!newThreads.length) { banner.style.display = 'none'; return; }
    textEl.textContent = newThreads.length === 1
      ? `💬 The developer replied to your feedback — tap to view.`
      : `💬 The developer replied to ${newThreads.length} of your feedback threads — tap to view.`;
    // One new thread → open the conversation directly (and mark it seen);
    // several → the Feedback section, where each is a tappable row.
    if (newThreads.length === 1 && typeof window.__openFeedbackThread === 'function') {
      textEl.onclick = () => {
        banner.style.display = 'none';
        try { window.__markFeedbackThreadSeen(newThreads[0].id); } catch {}
        window.__openFeedbackThread(newThreads[0]);
      };
    } else {
      textEl.onclick = openFeedbackSection;
    }
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        try { localStorage.setItem('feedback_reply_banner_dismissed_sigs', JSON.stringify(threads.map(feedbackThreadSignature))); } catch {}
        banner.style.display = 'none';
      };
    }
    banner.style.display = 'flex';
  } catch { /* central server unreachable — leave prior banner state alone */ }
}
// ── Alert banner (in the app) ───────────────────────────────────────────────
// The wall display shows any fired notification (HA alert, severe weather,
// kiosk auto-recovery, whatever NOTIF_KINDS grows to) as an on-screen banner
// with its own "✕" to dismiss; most wall displays — including every one of
// Jon's — aren't touchscreens, so that "✕" is often physically unreachable.
// This surfaces the exact same active notifications here in the app instead,
// and dismissing from here clears them everywhere (same
// /api/notifications/dismiss the display's own banner calls), whether or not
// this phone is set up to receive push. Works on host and slave (a slave
// proxies /api/notifications/active to its host). Originally HA-alert-only
// (hence the element IDs below still saying "ha-alert") — broadened to every
// kind after a real incident where a kiosk-recovery notice got stuck on a
// non-touch display with no way to clear it short of a power cycle.
async function checkHaAlertBannerApp() {
  const banner = document.getElementById('ha-alert-banner-app');
  const textEl = document.getElementById('ha-alert-banner-app-text');
  const closeBtn = document.getElementById('ha-alert-banner-app-close');
  if (!banner || !textEl) return;
  try {
    const data = await apiFetch('/api/notifications/active');
    let alerts = (data && data.notifications) || [];
    // The active profile has Home Assistant hidden — don't surface HA-sourced
    // alerts here specifically; every other kind (weather, kiosk-recovery,
    // future ones) still shows regardless of the HA profile setting, since
    // none of them have anything to do with Home Assistant.
    if (typeof profileAllows === 'function' && !profileAllows('ha')) {
      alerts = alerts.filter(n => n && n.kind !== 'ha-alert');
    }
    if (!alerts.length) { banner.style.display = 'none'; return; }
    textEl.textContent = alerts.length === 1
      ? `⚠ ${alerts[0].body || alerts[0].title || 'Alert'}`
      : `⚠ ${alerts.length} alerts active — tap to review`;
    textEl.onclick = () => { const t = document.querySelector('.tab[data-tab="settings"]'); if (t) t.click(); };
    if (closeBtn) closeBtn.onclick = async (e) => {
      e.stopPropagation();
      banner.style.display = 'none';
      for (const a of alerts) {
        try { await apiFetch('/api/notifications/dismiss', { method: 'POST', body: JSON.stringify({ key: a.key }) }); } catch {}
      }
    };
    banner.style.display = 'flex';
  } catch { /* server unreachable — leave whatever's shown */ }
}
// ── Periodic feedback prompt ─────────────────────────────────────────────────
// Roughly-weekly nudge to submit feedback/feature ideas — real request, not
// tied to any particular bug. Host-only (see call site in init()): a mirror
// is typically a secondary/kids' display, not where the primary user would
// naturally be asked this.
//
// Eligibility is tracked with a single settings field,
// feedback_popup_next_eligible_at (an ISO timestamp), stored the same way
// app_pin and every other per-household setting already is — locally on this
// household's own server, not sent anywhere else. No separate "opted out"
// boolean: "Don't ask again" just pushes that same timestamp ~10 years out,
// which is simpler than a second field and behaves identically.
async function maybeShowFeedbackPopup(s) {
  if (!s) return;
  const nextEligible = s.feedback_popup_next_eligible_at ? new Date(s.feedback_popup_next_eligible_at).getTime() : 0;
  if (!nextEligible) {
    // Never scheduled before — this is either a brand-new install or an
    // existing one updating to the version that introduced this feature.
    // Either way, don't ambush someone with a feedback prompt on the very
    // page load that set this up; schedule the FIRST prompt a few days out
    // instead, same as a normal snooze, and stop here for now.
    await scheduleNextFeedbackPopup(3);
    return;
  }
  if (Date.now() < nextEligible) return; // not due yet
  showFeedbackPopup();
}
async function scheduleNextFeedbackPopup(days) {
  const next = new Date(Date.now() + days * 86_400_000).toISOString();
  try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ feedback_popup_next_eligible_at: next }) }); } catch {}
}
function showFeedbackPopup() {
  const overlay = document.getElementById('feedback-popup-overlay');
  if (overlay) overlay.classList.add('open');
}
function closeFeedbackPopup() {
  const overlay = document.getElementById('feedback-popup-overlay');
  if (overlay) overlay.classList.remove('open');
}
(function wireFeedbackPopup() {
  const overlay = document.getElementById('feedback-popup-overlay');
  const closeBtn = document.getElementById('fp-close-btn');
  const snoozeBtn = document.getElementById('fp-snooze-btn');
  const optOutBtn = document.getElementById('fp-optout-btn');
  const sendBtn = document.getElementById('fp-send-btn');
  const status = document.getElementById('fp-status');
  if (!overlay || !sendBtn) return; // defensive — nothing to wire if the markup isn't there

  // Tapping the dark backdrop counts as "maybe later," same as the ✕ and the
  // explicit button — not silently dismissing without rescheduling, which
  // would make it reappear on every single app open until someone happens to
  // hit the one specific button that reschedules it.
  const dismissAsSnooze = async () => { closeFeedbackPopup(); await scheduleNextFeedbackPopup(7); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismissAsSnooze(); });
  if (closeBtn) closeBtn.addEventListener('click', dismissAsSnooze);
  if (snoozeBtn) snoozeBtn.addEventListener('click', dismissAsSnooze);
  if (optOutBtn) optOutBtn.addEventListener('click', async () => {
    closeFeedbackPopup();
    await scheduleNextFeedbackPopup(3650); // ~10 years — effectively off, no separate flag needed
  });
  sendBtn.addEventListener('click', async () => {
    const message = document.getElementById('fp-message').value.trim();
    if (!message) { status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = 'Type a quick note first.'; return; }
    sendBtn.disabled = true;
    status.style.color = 'var(--muted)'; status.textContent = 'Sending…';
    try {
      const fd = new FormData();
      fd.append('kind', document.getElementById('fp-kind').value);
      fd.append('message', message);
      const r = await apiFetch('/api/feedback', { method: 'POST', body: fd });
      if (r && r.ok) {
        status.style.color = 'var(--accent)'; status.textContent = '✓ Thanks — that was sent.';
        await scheduleNextFeedbackPopup(7);
        setTimeout(() => {
          closeFeedbackPopup();
          document.getElementById('fp-message').value = '';
          status.textContent = '';
          sendBtn.disabled = false;
        }, 1200); // brief pause so the confirmation is actually visible before the sheet closes itself
      } else {
        status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = (r && r.error) || 'Could not send.';
        sendBtn.disabled = false;
      }
    } catch {
      status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = 'Could not send — check your connection.';
      sendBtn.disabled = false;
    }
  });
})();

// ═══════════════════════════════════════════════════════════════════════════
// Family member profiles — a per-person view configuration for THIS app.
// Persona picker, NOT authentication: switching is instant, a per-profile PIN
// is only a gentle gate into that profile and locks nothing else. Zero
// profiles configured => the app behaves exactly as it did before. The active
// profile is chosen per-device (localStorage) and never sent to the server.
// Backend: `profiles` table + /api/profiles in server.js.
// ═══════════════════════════════════════════════════════════════════════════
let PROFILES = [];
let activeProfile = null;
const PROFILE_ACTIVE_KEY = 'piazzahq_profile_id';
const PROFILE_ALWAYS_TABS = ['favorites', 'calendars', 'settings'];
const PROFILE_HIDEABLE_TABS = [
  { id: 'photos', label: 'Photos' },
  { id: 'layout', label: 'Layout' },
  { id: 'displays', label: 'Devices' },
  { id: 'family', label: 'Family Hub' },
];
const PROFILE_FEATURES = [
  { key: 'ha', label: 'Home Assistant', hint: 'smart-home cards, widgets & alerts' },
  { key: 'integrations', label: 'Integrations & extras', hint: 'Todoist, calendar push, daily email' },
];
const PROFILE_PRESET_MAP = {
  basic:        { hidden_tabs: ['photos', 'layout', 'displays'], features: { ha: false, integrations: false }, landing_tab: 'calendars' },
  intermediate: { hidden_tabs: [],                               features: { ha: true,  integrations: false }, landing_tab: 'favorites' },
  advanced:     { hidden_tabs: [],                               features: { ha: true,  integrations: true  }, landing_tab: 'favorites' },
};
const PROFILE_PRESET_LABELS = { basic: 'Basic', intermediate: 'Intermediate', advanced: 'Advanced', custom: 'Custom' };
const PROFILE_COLORS = ['#4A90D9', '#E0655B', '#3FB27F', '#B87BD6', '#E0983B', '#4CB0C4', '#D96BA0', '#7C83E0'];
const PROFILE_TAB_LABELS = { favorites: 'Favorites', calendars: 'Calendar', photos: 'Photos', layout: 'Layout', displays: 'Devices', family: 'Family Hub', settings: 'Settings' };

function profileParseJson(v, fallback) {
  try { const x = JSON.parse(v); return x == null ? fallback : x; } catch { return fallback; }
}
function profileById(id) { return PROFILES.find(p => Number(p.id) === Number(id)) || null; }
function canManageProfiles() { return !activeProfile || !!activeProfile.is_manager; }
function profileAllows(feature) {
  if (!activeProfile) return true;
  return profileParseJson(activeProfile.features, {})[feature] !== false;
}
function profileHiddenTabs() {
  if (!activeProfile) return [];
  const arr = profileParseJson(activeProfile.hidden_tabs, []);
  return Array.isArray(arr) ? arr.filter(t => !PROFILE_ALWAYS_TABS.includes(t)) : [];
}
function profileHiddenSettingsSections() {
  const out = new Set();
  if (!profileAllows('ha')) out.add('Home Assistant');
  if (!profileAllows('integrations')) ['Todoist', 'Push to iCloud Calendar', 'Push to Google Calendar', 'Daily Briefing'].forEach(s => out.add(s));
  return out;
}
function profileInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function profileAvatarHtml(p, size) {
  const s = size || 26;
  const face = (p.avatar && p.avatar.trim()) ? p.avatar.trim() : profileInitials(p.name);
  return `<span class="profile-avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.5)}px;background:${escapeHtml(p.color || '#4A90D9')}">${escapeHtml(face)}</span>`;
}

function ensureProfileCss() {
  if (document.getElementById('profiles-css')) return;
  const st = document.createElement('style');
  st.id = 'profiles-css';
  st.textContent = `
    .tab.profile-hidden-tab { display:none !important; }
    body[data-profile-ha="off"] .needs-ha { display:none !important; }
    body[data-profile-integrations="off"] .needs-integrations { display:none !important; }
    #profile-chip { display:inline-flex; align-items:center; gap:7px; background:var(--card); border:1px solid var(--border); border-radius:999px; padding:3px 11px 3px 3px; cursor:pointer; color:var(--text); font-size:13px; font-weight:600; line-height:1; }
    #profile-chip .pc-name { max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .profile-avatar { border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-weight:700; color:#fff; flex:0 0 auto; }
    .pf-overlay { position:fixed; inset:0; z-index:100000; background:var(--bg); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:34px 24px; overflow-y:auto; }
    .pf-overlay h2 { margin:0; font-size:20px; font-weight:700; }
    .pf-grid { display:flex; flex-wrap:wrap; gap:16px; justify-content:center; max-width:540px; }
    .pf-person { display:flex; flex-direction:column; align-items:center; gap:9px; background:none; border:none; cursor:pointer; color:var(--text); width:100px; padding:6px; border-radius:12px; }
    .pf-person:hover { background:var(--card); }
    .pf-person span.nm { font-size:13px; font-weight:600; text-align:center; word-break:break-word; }
    .pf-sheet-back { position:fixed; inset:0; z-index:100001; background:rgba(0,0,0,0.55); display:flex; align-items:flex-end; justify-content:center; }
    .pf-sheet { background:var(--card); width:100%; max-width:460px; border-radius:16px 16px 0 0; padding:18px; max-height:88vh; overflow-y:auto; }
    .pf-sheet h3 { margin:0 0 12px; font-size:16px; }
    .pf-row-btn { display:flex; align-items:center; gap:11px; width:100%; text-align:left; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-top:8px; cursor:pointer; color:var(--text); font-size:14px; }
    .pf-field { margin-top:12px; }
    .pf-field > label { display:block; font-size:12px; color:var(--muted); margin-bottom:5px; font-weight:600; }
    .pf-check { display:flex; align-items:center; gap:9px; font-size:14px; margin-top:8px; cursor:pointer; }
    .pf-check input { width:18px; height:18px; accent-color:var(--accent); flex:0 0 auto; }
    .pf-swatches { display:flex; gap:7px; flex-wrap:wrap; }
    .pf-swatch { width:26px; height:26px; border-radius:50%; cursor:pointer; border:2px solid transparent; }
    .pf-swatch.sel { border-color:var(--text); }
    .pf-actions { display:flex; gap:8px; margin-top:18px; }
    .pf-btn { flex:1; border:none; border-radius:10px; padding:12px; font-size:14px; font-weight:600; cursor:pointer; }
    .pf-btn.primary { background:var(--accent); color:#fff; }
    .pf-btn.ghost { background:var(--bg); border:1px solid var(--border); color:var(--text); }
    .pf-btn.danger { background:none; color:var(--danger,#ff5d5d); flex:0 0 auto; }
  `;
  document.head.appendChild(st);
}

function updateProfileChip() {
  const nav = document.querySelector('#app-header-inner .nav');
  if (!nav) return;
  let chip = document.getElementById('profile-chip');
  if (!PROFILES.length) { if (chip) chip.remove(); return; }
  if (!chip) {
    chip = document.createElement('button');
    chip.id = 'profile-chip';
    chip.type = 'button';
    chip.addEventListener('click', openProfileSwitcher);
    nav.appendChild(chip);
  }
  chip.innerHTML = activeProfile
    ? profileAvatarHtml(activeProfile, 26) + `<span class="pc-name">${escapeHtml(activeProfile.name)}</span>`
    : `<span class="profile-avatar" style="width:26px;height:26px;font-size:13px;background:var(--border);color:var(--text)">?</span><span class="pc-name">Choose</span>`;
}

function applyProfileView() {
  ensureProfileCss();
  const hidden = new Set(profileHiddenTabs());
  document.querySelectorAll('.tabs .tab').forEach(t => t.classList.toggle('profile-hidden-tab', hidden.has(t.dataset.tab)));
  document.body.dataset.profileHa = profileAllows('ha') ? 'on' : 'off';
  document.body.dataset.profileIntegrations = profileAllows('integrations') ? 'on' : 'off';
  updateProfileChip();
  if (hidden.has(currentTab)) {
    let target = activeProfile && activeProfile.landing_tab;
    if (!target || hidden.has(target) || !document.querySelector(`.tab[data-tab="${target}"]`)) {
      const firstVisible = document.querySelector('.tabs .tab:not(.profile-hidden-tab)');
      target = firstVisible ? firstVisible.dataset.tab : 'favorites';
    }
    const btn = document.querySelector(`.tab[data-tab="${target}"]`);
    if (btn) btn.click();
  }
}

async function loadProfiles() {
  const r = await apiFetch('/api/profiles');
  PROFILES = Array.isArray(r) ? r : [];
  return PROFILES;
}

async function initProfiles() {
  await loadProfiles();
  if (!PROFILES.length) { activeProfile = null; return; }
  let savedId = null;
  try { savedId = localStorage.getItem(PROFILE_ACTIVE_KEY); } catch {}
  const found = savedId ? profileById(savedId) : null;
  activeProfile = found || null;
  applyProfileView();
  if (!found) openProfilePicker();
}

function setActiveProfile(p) {
  activeProfile = p || null;
  try {
    if (p) localStorage.setItem(PROFILE_ACTIVE_KEY, String(p.id));
    else localStorage.removeItem(PROFILE_ACTIVE_KEY);
  } catch {}
  applyProfileView();
  renderTab();
}

function closeProfileOverlays() {
  document.querySelectorAll('.pf-overlay, .pf-sheet-back').forEach(e => e.remove());
}

function openProfilePicker() {
  closeProfileOverlays();
  ensureProfileCss();
  const ov = document.createElement('div');
  ov.className = 'pf-overlay';
  ov.innerHTML = `
    <h2>Who's using this?</h2>
    <div class="pf-grid">${PROFILES.map(p =>
      `<button class="pf-person" data-id="${p.id}">${profileAvatarHtml(p, 64)}<span class="nm">${escapeHtml(p.name)}${p.has_pin ? ' 🔒' : ''}</span></button>`).join('')}</div>
    ${canManageProfiles() ? `<button class="pf-btn ghost" id="pf-picker-add" style="max-width:280px">＋ Add a profile</button>` : ''}
  `;
  document.body.appendChild(ov);
  ov.querySelectorAll('.pf-person').forEach(btn => btn.addEventListener('click', () => {
    const p = profileById(btn.dataset.id);
    if (!p) return;
    if (p.has_pin) promptProfilePin(p, () => { closeProfileOverlays(); setActiveProfile(p); });
    else { closeProfileOverlays(); setActiveProfile(p); }
  }));
  const add = document.getElementById('pf-picker-add');
  if (add) add.addEventListener('click', () => openProfileEditor(null));
}

function promptProfilePin(p, onOk) {
  const back = document.createElement('div');
  back.className = 'pf-sheet-back';
  back.style.alignItems = 'center';
  back.innerHTML = `
    <div class="pf-sheet" style="border-radius:16px;max-width:320px;text-align:center">
      <h3 style="margin-bottom:6px">${escapeHtml(p.name)}</h3>
      <div style="font-size:13px;color:var(--muted);margin-bottom:12px">Enter this profile's PIN</div>
      <input id="pf-pin-input" type="password" inputmode="numeric" maxlength="8" style="width:150px;text-align:center;font-size:22px;letter-spacing:6px;padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)">
      <div id="pf-pin-err" style="color:var(--danger,#ff5d5d);font-size:12px;min-height:16px;margin-top:8px"></div>
      <div class="pf-actions">
        <button class="pf-btn ghost" id="pf-pin-cancel">Cancel</button>
        <button class="pf-btn primary" id="pf-pin-ok">Unlock</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const input = back.querySelector('#pf-pin-input');
  input.focus();
  const submit = async () => {
    const r = await apiFetch('/api/profiles/' + encodeURIComponent(p.id) + '/check-pin', { method: 'POST', body: JSON.stringify({ pin: input.value }) });
    if (r && r.ok) { back.remove(); onOk(); }
    else { back.querySelector('#pf-pin-err').textContent = (r && r.error) || 'Wrong PIN'; input.value = ''; input.focus(); }
  };
  back.querySelector('#pf-pin-ok').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  back.querySelector('#pf-pin-cancel').addEventListener('click', () => back.remove());
}

function openProfileSwitcher() {
  closeProfileOverlays();
  ensureProfileCss();
  const back = document.createElement('div');
  back.className = 'pf-sheet-back';
  back.innerHTML = `
    <div class="pf-sheet">
      <h3>Profiles</h3>
      ${PROFILES.map(p => `
        <button class="pf-row-btn" data-id="${p.id}">
          ${profileAvatarHtml(p, 30)}
          <span style="flex:1">${escapeHtml(p.name)}${p.has_pin ? ' 🔒' : ''}</span>
          ${activeProfile && activeProfile.id === p.id ? '<span style="color:var(--accent)">✓</span>' : ''}
        </button>`).join('')}
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
        ${canManageProfiles()
          ? `<button class="pf-btn ghost" id="pf-manage">Manage profiles</button>`
          : (activeProfile ? `<button class="pf-btn ghost" id="pf-edit-self">Edit my profile</button>` : '')}
      </div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelectorAll('.pf-row-btn').forEach(btn => btn.addEventListener('click', () => {
    const p = profileById(btn.dataset.id);
    if (!p) return;
    back.remove();
    if (activeProfile && activeProfile.id === p.id) { openProfileEditor(p); return; }
    if (p.has_pin) promptProfilePin(p, () => setActiveProfile(p));
    else setActiveProfile(p);
  }));
  const manage = back.querySelector('#pf-manage');
  if (manage) manage.addEventListener('click', () => { back.remove(); openProfileManager(); });
  const editSelf = back.querySelector('#pf-edit-self');
  if (editSelf) editSelf.addEventListener('click', () => { back.remove(); openProfileEditor(activeProfile); });
}

function openProfileManager() {
  closeProfileOverlays();
  ensureProfileCss();
  const back = document.createElement('div');
  back.className = 'pf-sheet-back';
  back.innerHTML = `
    <div class="pf-sheet">
      <h3>Family profiles</h3>
      ${PROFILES.map(p => `
        <button class="pf-row-btn" data-id="${p.id}">
          ${profileAvatarHtml(p, 30)}
          <span style="flex:1">${escapeHtml(p.name)}${p.is_manager ? ' <span style="font-size:10px;color:var(--muted)">manager</span>' : ''}${p.has_pin ? ' 🔒' : ''}</span>
          <span style="color:var(--muted);font-size:12px">${PROFILE_PRESET_LABELS[p.preset] || 'Custom'}</span>
        </button>`).join('') || '<div style="font-size:13px;color:var(--muted)">No profiles yet.</div>'}
      <div class="pf-actions">
        <button class="pf-btn primary" id="pf-add">＋ Add profile</button>
        <button class="pf-btn ghost" id="pf-close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  back.querySelector('#pf-close').addEventListener('click', () => back.remove());
  back.querySelector('#pf-add').addEventListener('click', () => { back.remove(); openProfileEditor(null); });
  back.querySelectorAll('.pf-row-btn').forEach(btn => btn.addEventListener('click', () => { back.remove(); openProfileEditor(profileById(btn.dataset.id)); }));
}

function openProfileEditor(profile) {
  closeProfileOverlays();
  ensureProfileCss();
  const isNew = !profile;
  const firstEver = isNew && PROFILES.length === 0;
  const p = profile || { name: '', color: PROFILE_COLORS[PROFILES.length % PROFILE_COLORS.length], avatar: '', is_manager: firstEver ? 1 : 0, landing_tab: 'favorites', hidden_tabs: '[]', features: '{}', pin: '', preset: firstEver ? 'advanced' : 'custom' };
  const manager = canManageProfiles();
  const editingSelf = activeProfile && profile && activeProfile.id === profile.id;
  if (!isNew && !manager && !editingSelf) { showToast('You can only edit your own profile'); return; }

  let hiddenTabs = new Set(profileParseJson(p.hidden_tabs, []));
  let features = { ...profileParseJson(p.features, {}) };
  let color = p.color || PROFILE_COLORS[0];
  let landingPref = p.landing_tab || 'favorites';

  const back = document.createElement('div');
  back.className = 'pf-sheet-back';
  back.innerHTML = `
    <div class="pf-sheet">
      <h3>${isNew ? 'New profile' : 'Edit profile'}</h3>
      <div class="pf-field"><label>Name</label>
        <input id="pf-name" class="form-input" maxlength="40" placeholder="e.g. Mom" value="${escapeHtml(p.name)}"></div>
      <div class="pf-field"><label>Avatar — emoji or initials (optional)</label>
        <input id="pf-avatar" class="form-input" maxlength="8" placeholder="Auto from name" value="${escapeHtml(p.avatar || '')}"></div>
      <div class="pf-field"><label>Colour</label>
        <div class="pf-swatches" id="pf-swatches">${PROFILE_COLORS.map(c => `<span class="pf-swatch${c === color ? ' sel' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>
      <div class="pf-field"><label>Preset</label>
        <select id="pf-preset" class="form-input">${['basic', 'intermediate', 'advanced', 'custom'].map(k => `<option value="${k}"${k === (p.preset || 'custom') ? ' selected' : ''}>${PROFILE_PRESET_LABELS[k]}</option>`).join('')}</select></div>
      <div class="pf-field"><label>Tabs this profile sees</label>
        ${PROFILE_HIDEABLE_TABS.map(t => `<label class="pf-check"><input type="checkbox" class="pf-tab" data-tab="${t.id}"${hiddenTabs.has(t.id) ? '' : ' checked'}> ${t.label}</label>`).join('')}
        <div style="font-size:11px;color:var(--muted);margin-top:6px">Calendar, Favorites and Settings are always shown.</div></div>
      <div class="pf-field"><label>Features</label>
        ${PROFILE_FEATURES.map(f => `<label class="pf-check"><input type="checkbox" class="pf-feat" data-feat="${f.key}"${features[f.key] === false ? '' : ' checked'}> ${f.label} <span style="font-size:11px;color:var(--muted)">— ${f.hint}</span></label>`).join('')}</div>
      <div class="pf-field"><label>Opens to</label><select id="pf-landing" class="form-input"></select></div>
      <div class="pf-field"><label>Gateway PIN — optional, prompted only when switching in</label>
        <input id="pf-pin" class="form-input" inputmode="numeric" maxlength="8" placeholder="${p.has_pin ? '•••• set — blank keeps it' : 'No PIN'}" value="">
        ${p.has_pin ? `<label class="pf-check" style="margin-top:6px"><input type="checkbox" id="pf-pin-remove"> Remove this PIN</label>` : ''}</div>
      ${(!isNew && window._flightmapEnabled) ? `<div class="pf-field"><label>My Flights ${infoBtn("Flights this person is on — a Flight Map widget set to follow them (or everyone's saved flights) tracks whichever are active today. Add the day's callsign / flight number; give it a date range if it's a future trip.")}</label>
        <button type="button" class="pf-btn ghost" id="pf-flights" style="width:100%">✈️ Manage ${escapeHtml(p.name || 'this person')}'s flights…</button></div>` : ''}
      ${manager ? `<label class="pf-check" style="margin-top:14px"><input type="checkbox" id="pf-manager"${p.is_manager ? ' checked' : ''}> Manager — can edit everyone's profile</label>` : ''}
      <div class="pf-actions">
        <button class="pf-btn primary" id="pf-save">Save</button>
        <button class="pf-btn ghost" id="pf-cancel">Cancel</button>
        ${(!isNew && manager) ? `<button class="pf-btn danger" id="pf-delete">Delete</button>` : ''}
      </div>
      <div id="pf-err" style="color:var(--danger,#ff5d5d);font-size:12px;min-height:16px;margin-top:8px"></div>
    </div>`;
  document.body.appendChild(back);

  const rebuildLanding = () => {
    const visible = ['favorites', 'calendars', ...PROFILE_HIDEABLE_TABS.map(t => t.id).filter(id => !hiddenTabs.has(id)), 'settings'];
    if (!visible.includes(landingPref)) landingPref = 'favorites';
    back.querySelector('#pf-landing').innerHTML = visible.map(v => `<option value="${v}"${v === landingPref ? ' selected' : ''}>${PROFILE_TAB_LABELS[v]}</option>`).join('');
  };
  rebuildLanding();

  back.querySelectorAll('.pf-swatch').forEach(sw => sw.addEventListener('click', () => {
    color = sw.dataset.c;
    back.querySelectorAll('.pf-swatch').forEach(s => s.classList.toggle('sel', s === sw));
  }));
  const markCustom = () => { back.querySelector('#pf-preset').value = 'custom'; };
  back.querySelector('#pf-preset').addEventListener('change', e => {
    const m = PROFILE_PRESET_MAP[e.target.value];
    if (!m) return;
    hiddenTabs = new Set(m.hidden_tabs);
    features = { ...m.features };
    landingPref = m.landing_tab;
    back.querySelectorAll('.pf-tab').forEach(cb => { cb.checked = !hiddenTabs.has(cb.dataset.tab); });
    back.querySelectorAll('.pf-feat').forEach(cb => { cb.checked = features[cb.dataset.feat] !== false; });
    rebuildLanding();
  });
  back.querySelectorAll('.pf-tab').forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) hiddenTabs.delete(cb.dataset.tab); else hiddenTabs.add(cb.dataset.tab);
    markCustom(); rebuildLanding();
  }));
  back.querySelectorAll('.pf-feat').forEach(cb => cb.addEventListener('change', () => { features[cb.dataset.feat] = cb.checked; markCustom(); }));
  back.querySelector('#pf-landing').addEventListener('change', e => { landingPref = e.target.value; });
  const flightsBtn = back.querySelector('#pf-flights');
  if (flightsBtn) flightsBtn.addEventListener('click', () => openMyFlightsSheet(p));

  back.querySelector('#pf-cancel').addEventListener('click', () => {
    back.remove();
    if (isNew && !activeProfile && PROFILES.length) openProfilePicker();
  });

  const del = back.querySelector('#pf-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`Delete the profile "${p.name}"? Events they own lose their colour tag.`)) return;
    const r = await apiFetch(`/api/profiles/${p.id}`, { method: 'DELETE' });
    if (r && r.ok) {
      back.remove();
      if (activeProfile && activeProfile.id === p.id) { activeProfile = null; try { localStorage.removeItem(PROFILE_ACTIVE_KEY); } catch {} }
      await loadProfiles();
      applyProfileView();
      if (PROFILES.length && !activeProfile) openProfilePicker();
      renderTab();
      showToast('Profile deleted');
    } else {
      back.querySelector('#pf-err').textContent = (r && r.error) || 'Could not delete';
    }
  });

  back.querySelector('#pf-save').addEventListener('click', async () => {
    const name = back.querySelector('#pf-name').value.trim();
    if (!name) { back.querySelector('#pf-err').textContent = 'Name is required'; return; }
    const body = {
      name,
      avatar: back.querySelector('#pf-avatar').value.trim(),
      color,
      preset: back.querySelector('#pf-preset').value,
      hidden_tabs: [...hiddenTabs],
      features,
      landing_tab: landingPref,
    };
    const pinVal = back.querySelector('#pf-pin').value.replace(/\D/g, '');
    const rmPin = back.querySelector('#pf-pin-remove');
    if (rmPin && rmPin.checked) body.pin = '';       // explicitly remove the PIN
    else if (isNew || pinVal) body.pin = pinVal;     // on edit, blank = keep existing
    const mgr = back.querySelector('#pf-manager');
    if (mgr) body.is_manager = mgr.checked;
    else if (firstEver) body.is_manager = true;

    const r = isNew
      ? await apiFetch('/api/profiles', { method: 'POST', body: JSON.stringify(body) })
      : await apiFetch(`/api/profiles/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r && r.id) {
      back.remove();
      await loadProfiles();
      if (isNew && !activeProfile) setActiveProfile(profileById(r.id));
      else {
        if (activeProfile) activeProfile = profileById(activeProfile.id) || activeProfile;
        applyProfileView();
        renderTab();
      }
      showToast(isNew ? 'Profile created' : 'Profile saved');
    } else {
      back.querySelector('#pf-err').textContent = (r && r.error) || 'Could not save';
    }
  });
}

