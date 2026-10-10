// ── "My Flights" — a profile's saved flights (flight_watch rows with
// profile_id set). A Flight Map widget in "saved flight" mode tracks
// whichever are active today. Stacks over the profile editor sheet.
const FW_KIND_LABEL = { callsign: 'Flight / callsign', reg: 'Tail number', hex: 'ICAO hex' };
async function openMyFlightsSheet(profile) {
  if (!profile || !profile.id) return;
  document.querySelectorAll('.myflights-back').forEach(el => el.remove());
  ensureProfileCss();
  const back = document.createElement('div');
  back.className = 'pf-sheet-back myflights-back';
  back.style.zIndex = '10050';
  back.innerHTML = `<div class="pf-sheet">
    <h3>✈️ ${escapeHtml(profile.name || 'Profile')}'s flights</h3>
    <div id="mf-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
    <div class="pf-field"><label>Add a flight</label>
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <select id="mf-kind" class="form-input" style="flex:0 0 auto;width:auto">
          <option value="callsign">Flight / callsign</option>
          <option value="reg">Tail #</option>
          <option value="hex">ICAO hex</option>
        </select>
        <input id="mf-value" class="form-input" placeholder="e.g. DAL456" style="flex:1">
      </div>
      <input id="mf-label" class="form-input" placeholder="Label (optional) — e.g. Denver trip" style="margin-bottom:6px">
      <div style="display:flex;gap:6px;align-items:center">
        <label style="font-size:12px;color:var(--muted);flex:0 0 auto">Active</label>
        <input id="mf-from" class="form-input" type="date" style="flex:1">
        <span style="color:var(--muted)">→</span>
        <input id="mf-to" class="form-input" type="date" style="flex:1">
      </div>
      <p style="font-size:11px;color:var(--muted);margin:6px 0 0">Leave the dates blank for a flight that's active right now. A range makes a future trip auto-activate then expire.</p>
      <div id="mf-err" style="color:var(--danger,#ff5d5d);font-size:12px;min-height:15px;margin-top:6px"></div>
    </div>
    <div class="pf-actions">
      <button class="pf-btn primary" id="mf-add">Add</button>
      <button class="pf-btn ghost" id="mf-close">Done</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const $ = (id) => back.querySelector('#' + id);
  const close = () => back.remove();
  $('mf-close').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });

  const iso = (d) => d.toISOString().slice(0, 10);
  const fmtRange = (r) => {
    if (!r.active_from && !r.active_to) return 'now';
    const today = iso(new Date());
    const pending = r.active_from && r.active_from > today;
    const expired = r.active_to && r.active_to < today;
    return `${r.active_from || '…'} → ${r.active_to || '…'}${pending ? ' (upcoming)' : expired ? ' (past)' : ''}`;
  };
  async function refresh() {
    let rows = [];
    try { rows = (await apiFetch('/api/flight-watch')).filter(r => String(r.profile_id) === String(profile.id)); } catch {}
    const list = $('mf-list');
    if (!rows.length) { list.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">No flights yet.</p>`; return; }
    list.innerHTML = rows.map(r => `
      <div style="display:flex;align-items:center;gap:8px;background:var(--card-2,rgba(255,255,255,0.05));border-radius:10px;padding:8px 10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${escapeHtml(r.value)} <span style="font-size:11px;color:var(--muted);font-weight:400">${escapeHtml(FW_KIND_LABEL[r.kind] || r.kind)}</span></div>
          <div style="font-size:11px;color:var(--muted)">${escapeHtml(r.label ? r.label + ' · ' : '')}${escapeHtml(fmtRange(r))}</div>
        </div>
        <button class="pf-btn danger" data-del="${r.id}" style="padding:4px 10px;flex:0 0 auto">Remove</button>
      </div>`).join('');
    list.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      await apiFetch('/api/flight-watch/' + b.dataset.del, { method: 'DELETE' });
      refresh();
    }));
  }
  $('mf-add').addEventListener('click', async () => {
    const value = $('mf-value').value.trim();
    if (!value) { $('mf-err').textContent = 'Enter a flight number, callsign, tail number or hex.'; return; }
    const body = {
      profile_id: profile.id, kind: $('mf-kind').value, value,
      label: $('mf-label').value.trim(),
      active_from: $('mf-from').value || '', active_to: $('mf-to').value || '',
    };
    const r = await apiFetch('/api/flight-watch', { method: 'POST', body: JSON.stringify(body) });
    if (r && r.id) {
      $('mf-value').value = ''; $('mf-label').value = ''; $('mf-from').value = ''; $('mf-to').value = ''; $('mf-err').textContent = '';
      refresh();
    } else { $('mf-err').textContent = (r && r.error) || 'Could not add'; }
  });
  refresh();
}

// ── Settings → Security → Remote access login ────────────────────────────────
// The remote password (and the signed-in remote devices) live on the device,
// not in the synced settings — see the login gate in server.js. Nothing here
// changes anything for people at home: the gate only applies to requests that
// arrive from outside the home network.
function raAgoText(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 90) return m + " min ago";
  const h = Math.floor(m / 60);
  if (h < 48) return h + " hr ago";
  return Math.floor(h / 24) + " days ago";
}
function raDeviceName(ua) {
  ua = String(ua || "");
  const os = /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? os + " · " + br : os;
}
async function renderRemoteAuthPanel() {
  const box = document.getElementById("ra-body");
  if (!box) return;
  const st = await apiFetch("/api/remote-auth/status");
  if (!st || st.__authFailed || st.__parseError) { box.textContent = "Not available right now."; return; }
  const say = (t, bad) => { const m = box.querySelector("#ra-msg"); if (m) { m.textContent = t || ""; m.style.color = bad ? "#ff8585" : "var(--muted)"; } };
  const pwFields = (idp, ph) => `
    <input class="form-input" id="${idp}1" type="password" autocomplete="new-password" placeholder="${ph}" style="margin-top:8px">
    <input class="form-input" id="${idp}2" type="password" autocomplete="new-password" placeholder="Confirm password" style="margin-top:8px">`;
  const savePassword = async (idp, extra) => {
    const p1 = box.querySelector("#" + idp + "1").value;
    const p2 = box.querySelector("#" + idp + "2").value;
    if (p1 !== p2) { say("Passwords don't match — try again.", true); return; }
    const r = await apiFetch("/api/remote-auth/password", { method: "PUT", body: JSON.stringify(Object.assign({ password: p1 }, extra || {})) });
    if (r && r.ok) { showToast("Remote password saved ✓"); renderRemoteAuthPanel(); renderRemoteLinkPanel(true); }
    else say((r && r.error) || "Could not save the password.", true);
  };

  if (!st.configured) {
    box.innerHTML = `
      <div style="font-size:12px;color:var(--muted);margin-bottom:2px">Not set up. Remote access links are coming in a later update — setting a password now is safe and changes nothing on your home network. Use a few unrelated words, like "maple river lantern quiet" (at least 10 characters).</div>
      ${pwFields("ra-new", "Remote password (10+ characters)")}
      <button type="button" class="settings-save" id="ra-set" style="margin:10px 0 0">Set remote password</button>
      <div id="ra-msg" style="font-size:12px;margin-top:6px"></div>`;
    box.querySelector("#ra-set").addEventListener("click", () => savePassword("ra-new"));
    return;
  }

  const sess = await apiFetch("/api/remote-auth/sessions");
  const act = await apiFetch("/api/remote-auth/events");
  // Email alerts are a home-network-only setting: from outside this comes back as an error and the controls are hidden.
  const al = await apiFetch("/api/remote-access/alerts");
  const alOk = !!(al && !al.error && !al.__authFailed && !al.__parseError && al.mode !== undefined);
  const alLabel = alOk ? ({ off: "Off", new: "New devices + lockouts", all: "Every sign-in" }[al.mode] || "Off") : "";
  const alertsHtml = alOk ? `
    <details id="ra-alerts" style="margin-top:12px">
      <summary style="cursor:pointer;font-size:13px">Email alerts <span style="font-size:11px;color:var(--muted)">\u2014 ${alLabel}</span></summary>
      <div style="font-size:12px;color:var(--muted);margin-top:6px;line-height:1.45">Get an email when someone signs in from outside your home, or keeps getting the password wrong. It never contains a password.</div>
      <select class="form-input" id="ra-al-mode" style="margin-top:8px">
        <option value="off" ${al.mode === "off" ? "selected" : ""}>Off</option>
        <option value="new" ${al.mode === "new" ? "selected" : ""}>New devices and lockouts (recommended)</option>
        <option value="all" ${al.mode === "all" ? "selected" : ""}>Every sign-in, and lockouts</option>
      </select>
      <input class="form-input" id="ra-al-email" type="email" autocomplete="email" placeholder="Send alerts to (email address)" value="${escapeHtml(al.email || al.default_email || "")}" style="margin-top:8px">
      ${al.sender_ready ? "" : `<div style="font-size:12px;color:#f0b34a;margin-top:6px">Sending email isn\u2019t set up yet. Add the sending account under Daily Briefing first, then come back.</div>`}
      ${al.last_error ? `<div style="font-size:12px;color:#ff8585;margin-top:6px">Last alert failed: ${escapeHtml(al.last_error)}</div>` : ""}
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
        <button type="button" class="settings-save" id="ra-al-save" style="margin:0">Save</button>
        <button type="button" id="ra-al-test" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer">Send a test email</button>
      </div>
      <div id="ra-al-msg" style="font-size:12px;margin-top:6px"></div>
    </details>` : `<div style="font-size:12px;color:var(--muted);margin-top:12px">Email alerts for remote sign-ins can be changed from your home network.</div>`;
  const evs = act && Array.isArray(act.events) ? act.events : [];
  const newBad = act && act.new_failed ? act.new_failed : 0, newGood = act && act.new_success ? act.new_success : 0;
  const actRows = evs.length ? evs.slice(0, 12).map((e) => `
      <div style="display:flex;gap:8px;margin-top:6px;font-size:12px;line-height:1.35">
        <span style="color:${e.ok ? "#3ecf8e" : "#ff8585"};flex-shrink:0">${e.ok ? "2713" : "2717"}</span>
        <span style="flex:1;min-width:0">${e.ok ? "Signed in" : "Wrong password"} 00b7 ${escapeHtml(raDeviceName(e.user_agent))}<span style="color:var(--muted)"> 00b7 ${raAgoText(e.at)}${e.ip ? " 00b7 " + escapeHtml(e.ip) : ""}${e.country ? " (" + escapeHtml(e.country) + ")" : ""}</span></span>
      </div>`).join("") : `<div style="font-size:12px;color:var(--muted);margin-top:6px">No sign-ins yet.</div>`;
  const list = Array.isArray(sess) ? sess : [];
  const rows = list.length ? list.map((s) => `
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13px">
        <div style="flex:1;min-width:0">
          <div>${escapeHtml(raDeviceName(s.user_agent))}${s.current ? " <span style=\"font-size:10px;color:var(--muted)\">this device</span>" : ""}</div>
          <div style="font-size:11px;color:var(--muted)">Last active ${raAgoText(s.last_seen)}${s.ip ? " · " + escapeHtml(s.ip) : ""}</div>
        </div>
        <button type="button" class="ra-signout" data-id="${escapeHtml(s.id)}" style="background:none;border:1px solid var(--border);color:var(--danger);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">Sign out</button>
      </div>`).join("") : `<div style="font-size:12px;color:var(--muted);margin-top:8px">No remote devices are signed in.</div>`;
  box.innerHTML = `
    <div style="font-size:13px"><b>On.</b> <span style="color:var(--muted)">Asked for only when someone reaches this device from outside your home network.</span></div>
    <div style="margin-top:6px">${rows}</div>
    ${list.length > 1 ? `<button type="button" id="ra-signout-all" style="background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;padding:8px 0 0">Sign out all remote devices</button>` : ""}
    <details id="ra-activity" style="margin-top:12px"${newBad || newGood ? " open" : ""}>
      <summary style="cursor:pointer;font-size:13px">Recent sign-in activity${newBad || newGood ? ` <span style="font-size:11px;color:${newBad ? "#ff8585" : "var(--muted)"}">2014 ${newGood} new sign-in${newGood === 1 ? "" : "s"}${newBad ? ", " + newBad + " wrong password" + (newBad === 1 ? "" : "s") : ""}</span>` : ""}</summary>
      ${actRows}
      <div style="font-size:11px;color:var(--muted);margin-top:6px">Wrong guesses are limited automatically. If you see a sign-in you do not recognise, change the password 2014 that signs every remote device out.</div>
    </details>
    ${alertsHtml}
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-top:12px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:var(--text)">
      <input type="checkbox" id="ra-always" ${st.always_require ? "checked" : ""} style="margin-top:2px">
      <span>Also ask for it on other devices on my home Wi-Fi <span style="color:var(--muted)">(this screen itself never asks)</span></span>
    </label>
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:13px">Change password</summary>
      ${st.remote ? `<input class="form-input" id="ra-cur" type="password" autocomplete="current-password" placeholder="Current password" style="margin-top:8px">` : ""}
      ${pwFields("ra-chg", "New remote password (10+ characters)")}
      <button type="button" class="settings-save" id="ra-change" style="margin:10px 0 0">Change password</button>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Changing it signs every remote device out.</div>
    </details>
    <button type="button" id="ra-remove" style="background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;padding:10px 0 0">Remove remote password</button>
    <div id="ra-msg" style="font-size:12px;margin-top:6px"></div>`;

  box.querySelectorAll(".ra-signout").forEach((b) => b.addEventListener("click", async () => {
    await apiFetch("/api/remote-auth/sessions/" + encodeURIComponent(b.dataset.id), { method: "DELETE" });
    renderRemoteAuthPanel();
  }));
  const all = box.querySelector("#ra-signout-all");
  if (all) all.addEventListener("click", async () => {
    if (!confirm("Sign out every remote device?")) return;
    await apiFetch("/api/remote-auth/sessions", { method: "DELETE" });
    renderRemoteAuthPanel();
  });
  const alSave = box.querySelector("#ra-al-save"), alTest = box.querySelector("#ra-al-test");
  const alSay = (t, bad) => { const m = box.querySelector("#ra-al-msg"); if (m) { m.textContent = t || ""; m.style.color = bad ? "#ff8585" : "var(--muted)"; } };
  const alBody = () => JSON.stringify({ mode: box.querySelector("#ra-al-mode").value, email: box.querySelector("#ra-al-email").value.trim() });
  if (alSave) alSave.addEventListener("click", async () => {
    alSave.disabled = true; alSay("Saving\u2026");
    const r = await apiFetch("/api/remote-access/alerts", { method: "POST", body: alBody() });
    alSave.disabled = false;
    if (r && r.error) { alSay(r.error, true); return; }
    alSay(r.mode === "off" ? "Email alerts are off." : "Saved. You will get an email when this happens.");
    box.querySelector("#ra-alerts summary span").textContent = "\u2014 " + ({ off: "Off", new: "New devices + lockouts", all: "Every sign-in" }[r.mode] || "Off");
  });
  if (alTest) alTest.addEventListener("click", async () => {
    const email = box.querySelector("#ra-al-email").value.trim();
    alTest.disabled = true; alSay("Sending\u2026");
    // the test goes to the saved address, so save what is typed first
    const saved = await apiFetch("/api/remote-access/alerts", { method: "POST", body: JSON.stringify({ mode: box.querySelector("#ra-al-mode").value, email }) });
    if (saved && saved.error) { alSay(saved.error, true); alTest.disabled = false; return; }
    const r = await apiFetch("/api/remote-access/alerts/test", { method: "POST", body: "{}" });
    alTest.disabled = false;
    if (r && r.error) alSay(r.error, true); else alSay("Test email sent to " + email + ". Check that inbox (and spam).");
  });
  const actEl = box.querySelector("#ra-activity");
  if (actEl) {
    const markSeen = () => { if (newBad || newGood) apiFetch("/api/remote-auth/events/seen", { method: "POST", body: "{}" }); };
    if (actEl.open) markSeen();
    actEl.addEventListener("toggle", () => { if (actEl.open) markSeen(); });
  }
  box.querySelector("#ra-always").addEventListener("change", async (e) => {
    const r = await apiFetch("/api/settings", { method: "PUT", body: JSON.stringify({ remote_access_require_auth: e.target.checked ? "1" : "0" }) });
    if (r && r.__authFailed) return;
    showToast(e.target.checked ? "Other devices will be asked to sign in" : "Home devices will not be asked");
  });
  box.querySelector("#ra-change").addEventListener("click", () => {
    const cur = box.querySelector("#ra-cur");
    savePassword("ra-chg", cur ? { current_password: cur.value } : null);
  });
  box.querySelector("#ra-remove").addEventListener("click", async () => {
    if (!confirm("Remove the remote password? Remote sign-in will stop working, and remote access will be turned off, until you set a new one.")) return;
    let body;
    if (st.remote) {
      const cur = prompt("Enter the current remote password to confirm:");
      if (cur === null) return;
      body = JSON.stringify({ current_password: cur });
    }
    const r = await apiFetch("/api/remote-auth/password", { method: "DELETE", body });
    if (r && r.ok) { showToast(r.remote_access_stopped ? "Remote password removed \u2014 remote access turned off" : "Remote password removed"); renderRemoteAuthPanel(); renderRemoteLinkPanel(true); }
    else say((r && r.error) || "Could not remove it.", true);
  });
}

// ── Severe weather alerts: which alert types you get, and snoozing one (Settings -> Severe Weather Alerts) ──────
// Talks to /api/weather-alerts/{state,muted,snooze}; every change saves at once (no Save button needed). A type that
// is switched off never alerts, whatever its severity. Snooze is by TYPE because the Weather Service re-issues one
// warning under new ids all day - snoozing a single alert would not hold.
async function renderWxAlertTypes() {
  const box = document.getElementById("wx-types-box");
  if (!box) return;
  const st = await apiFetch("/api/weather-alerts/state");
  if (!document.getElementById("wx-types-box")) return;
  if (!st || st.error || st.__authFailed || st.__parseError) { box.textContent = "Not available right now."; return; }

  const muted = new Set(st.muted || []);
  const snoozed = st.snoozed || {};
  const sevOf = {};
  (st.recent_events || []).forEach((e) => { if (e.severity) sevOf[e.event] = e.severity; });
  const SEV_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
  const recent = (st.recent_events || []).map((e) => e.event);
  const known = (st.known_events || []).filter((e) => recent.indexOf(e) < 0);
  const listed = recent.concat(known);
  // A muted type that is in neither list (e.g. one NWS stopped sending) must survive a save, so keep it in the list too.
  for (const m of muted) if (listed.indexOf(m) < 0) listed.push(m);
  const when = (ms) => {
    const d = new Date(ms), t = d.toLocaleTimeString((window.i18n && i18n.lang) || undefined, { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString((window.i18n && i18n.lang) || undefined, { weekday: "short" }) + " " + t;
  };
  const box1 = (ev) => `<label class="wx-type-row" data-rank="${sevOf[ev] ? SEV_RANK[sevOf[ev]] : ''}" style="display:flex;gap:8px;align-items:center;padding:3px 0;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:var(--text);font-size:13px">
      <input type="checkbox" class="wx-type-cb" data-event="${escapeHtml(ev)}" ${muted.has(ev) ? "" : "checked"}> <span>${escapeHtml(ev)}</span>${sevOf[ev] ? `<span style="margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap">last rated ${escapeHtml(sevOf[ev])}</span>` : ''}<span class="wx-below" style="display:none;font-size:11px;color:#e0a339;white-space:nowrap">below your minimum</span></label>`;

  const snoozeLines = Object.keys(snoozed).map((ev) => `<div style="display:flex;gap:10px;align-items:center;font-size:13px;color:var(--text);margin-bottom:4px">
      <span>${escapeHtml(ev)} — quiet until ${escapeHtml(when(snoozed[ev]))}</span>
      <button type="button" class="wx-snooze-cancel" data-event="${escapeHtml(ev)}" style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0">Cancel</button></div>`).join("");
  const snoozable = listed.filter((e) => !snoozed[e]);
  const btn = "background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer";

  const wasOpen = Array.from(box.querySelectorAll("details")).map((d) => d.open);   // a redraw must not fold the sections the person is using
  box.innerHTML = `${snoozeLines}
    <details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px;color:var(--text)">Snooze a type for a while</summary>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <select class="form-input" id="wx-snooze-type" style="flex:1;min-width:180px">${snoozable.map((e) => `<option>${escapeHtml(e)}</option>`).join("")}</select>
        <button type="button" class="wx-snooze-go" data-hours="1" style="${btn}">1 hour</button>
        <button type="button" class="wx-snooze-go" data-hours="6" style="${btn}">6 hours</button>
        <button type="button" class="wx-snooze-go" data-hours="24" style="${btn}">24 hours</button>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px">Quiets every alert of that type, including updates to a warning that is already out.</div>
    </details>
    <details style="margin-top:8px"><summary style="cursor:pointer;font-size:13px;color:var(--text)">Choose which types you get${muted.size ? ` <span style="color:var(--muted)">(${muted.size} turned off)</span>` : ""}</summary>
      <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="wx-type-all" data-on="1" style="${btn}">Select all</button><button type="button" class="wx-type-all" data-on="0" style="${btn}">Deselect all</button></div>
      <div style="margin-top:8px">
        ${recent.length ? `<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Seen near you lately</div>${recent.map(box1).join("")}<div style="height:8px"></div>` : ""}
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">${recent.length ? "Other types" : "All types"}</div>
        ${listed.filter((e) => recent.indexOf(e) < 0).map(box1).join("")}
      </div>
    </details>
    <div id="wx-types-msg" style="font-size:12px;margin-top:6px"></div>`;

  box.querySelectorAll("details").forEach((d, i) => { if (wasOpen[i]) d.open = true; });
  const msg = (t, bad) => { const m = document.getElementById("wx-types-msg"); if (m) { m.textContent = t || ""; m.style.color = bad ? "#ff8585" : "var(--muted)"; } };
  box.querySelectorAll(".wx-type-cb").forEach((cb) => cb.addEventListener("change", async () => {
    const off = Array.from(box.querySelectorAll(".wx-type-cb")).filter((x) => !x.checked).map((x) => x.dataset.event);
    const r = await apiFetch("/api/weather-alerts/muted", { method: "PUT", body: JSON.stringify({ events: off }) });
    if (r && r.error) { cb.checked = !cb.checked; msg(r.error, true); return; }
    showToast(cb.checked ? cb.dataset.event + " alerts on" : cb.dataset.event + " alerts turned off");
    const sum = box.querySelector("details:nth-of-type(2) > summary");
    if (sum) sum.innerHTML = "Choose which types you get" + (off.length ? ' <span style="color:var(--muted)">(' + off.length + " turned off)</span>" : "");
  }));
  // Select all / Deselect all: one save for the whole list (the same muted list the single boxes write), put back if it fails.
  box.querySelectorAll(".wx-type-all").forEach((b) => b.addEventListener("click", async () => {
    const on = b.dataset.on === "1";
    const cbs = Array.from(box.querySelectorAll(".wx-type-cb")), was = cbs.map((x) => x.checked);
    cbs.forEach((x) => { x.checked = on; });
    const off = on ? [] : cbs.map((x) => x.dataset.event);
    const r = await apiFetch("/api/weather-alerts/muted", { method: "PUT", body: JSON.stringify({ events: off }) });
    if (r && r.error) { cbs.forEach((x, i) => { x.checked = was[i]; }); msg(r.error, true); return; }
    showToast(on ? "All alert types on" : "All alert types turned off");
    const sum = box.querySelector("details:nth-of-type(2) > summary");
    if (sum) sum.innerHTML = "Choose which types you get" + (off.length ? ' <span style="color:var(--muted)">(' + off.length + " turned off)</span>" : "");
  }));
  const applyMin = () => {
    const sel = document.getElementById("s-wxalert-severity");
    const min = SEV_RANK[(sel && sel.value) || st.min_severity || "Moderate"] ?? 2;
    box.querySelectorAll(".wx-type-row").forEach((row) => {
      const r = row.dataset.rank === "" ? null : Number(row.dataset.rank);
      const below = r !== null && r < min;
      row.style.opacity = below ? "0.55" : "";
      const tag = row.querySelector(".wx-below");
      if (tag) tag.style.display = below ? "" : "none";
    });
  };
  applyMin();
  { const sel = document.getElementById("s-wxalert-severity"); if (sel) sel.onchange = applyMin; }
  box.querySelectorAll(".wx-snooze-go").forEach((b) => b.addEventListener("click", async () => {
    const sel = document.getElementById("wx-snooze-type");
    if (!sel || !sel.value) { msg("Pick a type to snooze.", true); return; }
    const hours = Number(b.dataset.hours);
    const r = await apiFetch("/api/weather-alerts/snooze", { method: "POST", body: JSON.stringify({ event: sel.value, hours }) });
    if (r && r.error) { msg(r.error, true); return; }
    showToast(sel.value + " quiet for " + hours + (hours === 1 ? " hour" : " hours"));
    renderWxAlertTypes();
  }));
  box.querySelectorAll(".wx-snooze-cancel").forEach((b) => b.addEventListener("click", async () => {
    const r = await apiFetch("/api/weather-alerts/snooze", { method: "POST", body: JSON.stringify({ event: b.dataset.event, hours: 0 }) });
    if (r && r.error) { msg(r.error, true); return; }
    showToast(b.dataset.event + " alerts back on");
    renderWxAlertTypes();
  }));
}

// ── Remote access link (Settings -> Security) ────────────────────────────────
// The switch that gives this household a private web address. Host device only;
// needs the remote password above. Status comes from /api/remote-access/status;
// the server does the work (address from the Piazza HQ server, helper download,
// tunnel process) and this panel just shows where it has got to.
let _rlTimer = null, _rlLastKey = '';
function rlStopPolling() { if (_rlTimer) { clearTimeout(_rlTimer); _rlTimer = null; } }
async function renderRemoteLinkPanel(force) {
  rlStopPolling();
  const box = document.getElementById("rl-body");
  if (!box) return;
  const st = await apiFetch("/api/remote-access/status");
  if (!document.getElementById("rl-body")) return;             // panel left the screen while we waited
  if (!st || st.__authFailed || st.__parseError || st.error) { box.textContent = "Not available right now."; return; }
  const key = JSON.stringify(st);
  const changed = force || key !== _rlLastKey;
  _rlLastKey = key;
  const busy = st.enabled && (st.state === "connecting" || st.state === "downloading");
  _rlTimer = setTimeout(() => renderRemoteLinkPanel(false), busy ? 2500 : 8000);
  if (!changed) return;

  const say = (t, bad) => { const m = box.querySelector("#rl-msg"); if (m) { m.textContent = t || ""; m.style.color = bad ? "#ff8585" : "var(--muted)"; } };
  const note = (t) => `<div style="font-size:12px;color:var(--muted);line-height:1.45">${t}</div>`;
  let html;
  if (!st.is_host) {
    html = note("Remote access is set up on your main (host) device. This screen is reached through it, so there is nothing to do here.");
  } else if (st.available === false && !st.enabled) {
    html = note("Not available yet — this is coming soon. Nothing has been changed on your device.");
  } else if (!st.password_set && !st.enabled) {
    html = note("Set a remote password above first. It protects your calendar when someone opens the link from outside your home.");
  } else if (!st.enabled) {
    html = `${st.notice ? `<div style="font-size:12px;color:#f0b34a;margin-bottom:8px">${escapeHtml(st.notice)}</div>` : ""}${note("Get a private web address for your calendar, so you can check and edit it from anywhere. You will sign in with your remote password. Nothing is opened on your home network or router.")}
      ${st.hostname ? note("Your address will be " + escapeHtml(st.hostname) + " again.") : ""}
      ${st.eligible ? "" : note(escapeHtml(st.message || ""))}
      <button type="button" class="settings-save" id="rl-on" style="margin:10px 0 0" ${st.eligible ? "" : "disabled"}>Turn on remote access</button>`;
  } else {
    const label = { connected: "On — connected", connecting: "Connecting…", downloading: "Getting ready… (a one-time download)", error: "Trouble connecting", blocked: "Paused" }[st.state] || "On";
    const dot = st.state === "connected" ? "#3ecf8e" : (st.state === "error" || st.state === "blocked" ? "#ff8585" : "#f0b34a");
    html = `<div style="font-size:13px"><span style="color:${dot}">●</span> <b>${label}</b></div>
      ${st.url ? `<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <a href="${escapeHtml(st.app_url || st.url)}" target="_blank" rel="noopener" style="font-size:13px;word-break:break-all">${escapeHtml(st.app_url || st.url)}</a>
        <button type="button" id="rl-copy" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer">Copy</button>
      </div>
      <div id="rl-qr" style="background:#fff;padding:8px;border-radius:10px;line-height:0;display:inline-block;margin-top:10px"></div>
      ${note("Scan with your phone, or open the link and sign in with your remote password.")}` : ""}
      ${st.state === "error" && st.last_error ? `<div style="font-size:12px;color:#ff8585;margin-top:6px">${escapeHtml(st.last_error)}</div>` : ""}
      ${st.state === "blocked" ? `<div style="font-size:12px;color:#ff8585;margin-top:6px">${escapeHtml(st.message || "")}</div>` : ""}
      ${st.url ? `<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-top:12px;cursor:pointer;text-transform:none;letter-spacing:0;font-weight:400;color:var(--text)">
        <input type="checkbox" id="rl-control" ${st.allow_control ? "checked" : ""} style="margin-top:2px">
        <span>Also allow smart-home and TV control from outside <span style="color:var(--muted)">(lights, locks, switching a TV on or off). Off keeps a remote sign-in to calendars, lists and settings. Only changeable at home.</span></span>
      </label>
      <details id="rl-rename-box" style="margin-top:10px">
        <summary style="cursor:pointer;font-size:13px">Change the address</summary>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <input class="form-input" id="rl-rename" type="text" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="for example: smith-family" style="flex:1;min-width:160px">
          <button type="button" class="settings-save" id="rl-rename-go" style="margin:0">Change</button>
        </div>
        <div id="rl-rename-hint" style="font-size:11px;color:var(--muted);margin-top:4px">3\u201330 letters, numbers or hyphens. We add 4 random digits so strangers can\u2019t guess it. Your old link stops working right away.</div>
      </details>` : ""}
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px">
        <button type="button" id="rl-off" style="background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;padding:0">Turn off</button>
        <button type="button" id="rl-release" style="background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0">Turn off and give this address back</button>
      </div>`;
  }
  box.innerHTML = html + `<div id="rl-msg" style="font-size:12px;margin-top:6px"></div>`;

  const on = box.querySelector("#rl-on");
  if (on) on.addEventListener("click", async () => {
    on.disabled = true; say("Setting up…");
    const r = await apiFetch("/api/remote-access/enable", { method: "POST", body: "{}" });
    if (r && r.error) { say(r.error, true); on.disabled = false; return; }
    renderRemoteLinkPanel(true);
  });
  const off = box.querySelector("#rl-off");
  if (off) off.addEventListener("click", async () => {
    off.disabled = true;
    const r = await apiFetch("/api/remote-access/disable", { method: "POST", body: "{}" });
    if (r && r.error) { say(r.error, true); off.disabled = false; return; }
    showToast("Remote access turned off");
    renderRemoteLinkPanel(true);
  });
  const rel = box.querySelector("#rl-release");
  if (rel) rel.addEventListener("click", async () => {
    if (!confirm("Turn off remote access and give this address back? You will get a new, different address if you turn it on again, and any links you shared stop working.")) return;
    rel.disabled = true;
    const r = await apiFetch("/api/remote-access/disable", { method: "POST", body: JSON.stringify({ release: true }) });
    if (r && r.error) { say(r.error, true); rel.disabled = false; return; }
    showToast("Address given back");
    renderRemoteLinkPanel(true);
  });
  const ctl = box.querySelector("#rl-control");
  if (ctl) ctl.addEventListener("change", async () => {
    const r = await apiFetch("/api/remote-access/control", { method: "POST", body: JSON.stringify({ allow: ctl.checked }) });
    if (r && r.error) { ctl.checked = !ctl.checked; say(r.error, true); return; }
    showToast(ctl.checked ? "Smart-home and TV control allowed from outside" : "Smart-home and TV control blocked from outside");
    renderRemoteLinkPanel(true);
  });
  const rn = box.querySelector("#rl-rename-go");
  if (rn) rn.addEventListener("click", async () => {
    const name = box.querySelector("#rl-rename").value.trim();
    if (!name) { say("Type the words you want in the address.", true); return; }
    if (!confirm("Change the address? Your old link stops working right away, so anyone you shared it with will need the new one.")) return;
    rn.disabled = true; say("Changing\u2026");
    const r = await apiFetch("/api/remote-access/rename", { method: "POST", body: JSON.stringify({ name }) });
    rn.disabled = false;
    if (r && r.error) { say(r.error, true); return; }
    showToast("Address changed");
    renderRemoteLinkPanel(true);
  });
  const copy = box.querySelector("#rl-copy");
  if (copy) copy.addEventListener("click", () => copyToClipboard(st.app_url || st.url));
  const qr = box.querySelector("#rl-qr");
  if (qr && (st.app_url || st.url)) {
    let tries = 0;
    const draw = () => {
      if (typeof QRCode === "undefined") { if (++tries < 15) setTimeout(draw, 200); return; }
      try { qr.innerHTML = ""; new QRCode(qr, { text: st.app_url || st.url, width: 130, height: 130, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); } catch {}
    };
    draw();
  }
}

function renderProfilesSettingsBody() {
  const box = document.getElementById('profiles-settings-body');
  if (!box) return;
  if (!PROFILES.length) {
    box.innerHTML = `<button class="settings-save" id="pf-settings-setup" style="margin:0">Set up family profiles</button>`;
    box.querySelector('#pf-settings-setup').addEventListener('click', () => openProfileEditor(null));
    return;
  }
  const canMgr = canManageProfiles();
  const rowFor = (p, suffix) => `
    <button class="pf-row-btn" data-id="${p.id}" style="margin-top:6px">
      ${profileAvatarHtml(p, 26)}
      <span style="flex:1">${escapeHtml(p.name)}${suffix || ''}</span>
      <span style="color:var(--muted);font-size:12px">${PROFILE_PRESET_LABELS[p.preset] || 'Custom'}</span>
    </button>`;
  const list = canMgr
    ? PROFILES.map(p => rowFor(p, (p.is_manager ? ' <span style="font-size:10px;color:var(--muted)">manager</span>' : '') + (p.has_pin ? ' 🔒' : ''))).join('')
    : (activeProfile ? rowFor(activeProfile, ' <span style="font-size:10px;color:var(--muted)">you</span>') : '');
  box.innerHTML = `
    <div style="font-size:12px;color:var(--muted);margin-bottom:2px">${activeProfile ? 'Active on this device: <b>' + escapeHtml(activeProfile.name) + '</b>' : 'No profile chosen on this device.'}</div>
    ${list}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      ${canMgr ? `<button class="settings-save" id="pf-settings-add" style="margin:0">＋ Add profile</button>` : ''}
      <button class="settings-save" id="pf-settings-switch" style="margin:0;background:var(--card);border:1px solid var(--border);color:var(--text)">Switch / choose profile</button>
    </div>`;
  box.querySelectorAll('.pf-row-btn').forEach(btn => btn.addEventListener('click', () => {
    const p = profileById(btn.dataset.id);
    if (p) openProfileEditor(p);
  }));
  const add = box.querySelector('#pf-settings-add');
  if (add) add.addEventListener('click', () => openProfileEditor(null));
  box.querySelector('#pf-settings-switch').addEventListener('click', openProfilePicker);
}

init();
