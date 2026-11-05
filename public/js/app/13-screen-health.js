// ── Screen health (Devices tab) ──────────────────────────────────────────────
// Is each screen OK, without SSH. The facts come from GET /api/screen-health (src/screen-health.js); the words are made here, from those facts, so they can be
// translated. Each screen's card on the Devices tab has a "Health" section (loadScreens() leaves an empty slot in it; shRenderSlots() fills it), and its green / amber /
// red / grey dot is the one in the card's title. A thin line above the list says how many screens are fine. Statuses: good (running normally), repaired (the Wi-Fi
// fixed itself in the last 7 days), stuck (reporting, but the display has not drawn for over 5 minutes), off (not reporting: grey, never an alarm, since many screens are
// off on purpose). "Reload display" reloads a screen's display page.
const SH_OPEN = new Set();            // screens whose Health section is open: kept across the 15-second refresh
let SH_LAST = null;                   // the last answer from /api/screen-health, so a card that is redrawn can be filled again at once
const SH_COLOR = { good: '#34d399', repaired: '#fbbf24', stuck: '#f87171', off: '#6b7fa3' };
const SH_LABEL = { good: 'Running normally', repaired: 'Fixed itself', stuck: 'Not drawing', off: 'Not reporting' };

function shEnsureCss() {
  if (document.getElementById('sh-css')) return;
  const st = document.createElement('style'); st.id = 'sh-css';
  st.textContent = `
    #screen-health .sh-summary { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; padding: 0 2px; font-size: 12.5px; color: var(--muted); }
    #screen-health .sh-summary button { font: inherit; background: none; border: none; padding: 0; color: inherit; cursor: pointer; text-align: left; }
    #screen-health .sh-summary button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
    .sh-pill { font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
    .sh-pill.good { background: rgba(52,211,153,.14); color: #34d399; }
    .sh-pill.repaired { background: rgba(251,191,36,.14); color: #fbbf24; }
    .sh-pill.stuck { background: rgba(248,113,113,.14); color: var(--danger); }
    .sh-acc-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
    .sh-acc-dot.good { background: #34d399; }
    .sh-acc-dot.repaired { background: #fbbf24; }
    .sh-acc-dot.stuck { background: var(--danger); }
    .sh-acc-dot.off { background: #6b7fa3; }
    .sh-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
    .sh-chip { font-size: 11.5px; color: var(--text); background: rgba(255,255,255,.04); border: 1px solid var(--border); border-radius: 8px; padding: 3px 8px; }
    .sh-chip.warn { color: #fbbf24; border-color: rgba(251,191,36,.35); background: rgba(251,191,36,.08); }
    .sh-chip.bad { color: var(--danger); border-color: rgba(248,113,113,.4); }
    .sh-detail h4 { margin: 2px 0 8px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
    .sh-tl { list-style: none; margin: 0 0 12px; padding: 0; }
    .sh-tl li { position: relative; padding: 0 0 10px 16px; font-size: 12.5px; line-height: 1.4; }
    .sh-tl li::before { content: ''; position: absolute; left: 2px; top: 6px; width: 7px; height: 7px; border-radius: 50%; background: #fbbf24; }
    .sh-tl li.none::before { background: var(--accent); }
    .sh-tl time { display: block; font-size: 11px; color: var(--muted); }
    .sh-tip { font-size: 12.5px; line-height: 1.45; background: rgba(74,144,217,.1); border: 1px solid rgba(74,144,217,.28); border-radius: 10px; padding: 9px 11px; margin: 0 0 12px; }
    .sh-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .sh-act { font: inherit; font-size: 13px; font-weight: 600; border-radius: 10px; padding: 9px 13px; cursor: pointer; border: 1px solid var(--border); background: var(--card); color: var(--text); }
    .sh-act.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .sh-act:disabled { opacity: .6; cursor: default; }
    .sh-legend { margin-top: 12px; font-size: 11.5px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .sh-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }`;
  document.head.appendChild(st);
}

function shUptimeText(sec) {
  const m = Math.floor(sec / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `Up ${d} d ${h % 24} h`;
  if (h >= 1) return `Up ${h} h ${m % 60} min`;
  return `Up ${Math.max(1, m)} min`;
}
function shFrameText(sec) { return sec < 120 ? `Drew a frame ${sec} s ago` : `Drew a frame ${Math.round(sec / 60)} min ago`; }
function shWhenText(ts) {
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
}
function shRepairText(r) {
  const m = Math.max(1, Math.round((r.down_s || 0) / 60));
  if (r.how === 'services') return `Wi-Fi dropped for ${m} min. Fixed by restarting the Wi-Fi services.`;
  if (r.how === 'driver') return `Wi-Fi dropped for ${m} min. Fixed by reloading the Wi-Fi driver.`;
  return `Wi-Fi dropped for ${m} min. Switched Wi-Fi off and on; back online.`;
}
function shCopyText(s) {
  const h = s.health || {};
  const lines = [`${s.name || s.device_id} (${s.role})`, `status: ${s.status}`, `version: ${s.version || '?'}`];
  if (h.model) lines.push(`model: ${h.model}`);
  if (h.uptime_s != null) lines.push(`uptime: ${Math.round(h.uptime_s / 60)} min`);
  if (h.painted_s != null) lines.push(`last frame: ${h.painted_s} s ago`);
  if (h.net) lines.push(`network: ${h.net.kind}${h.net.signal_dbm != null ? ' ' + h.net.signal_dbm + ' dBm' : ''}`);
  if (h.repairs) lines.push(`wifi repairs, 7 days: ${h.repairs.count7}`);
  lines.push(`last seen: ${s.last_seen ? new Date(s.last_seen).toISOString() : '?'}`);
  return lines.join('\n');
}

// The short line under "Health" while it is closed: the status in words, then the network and how long it has been up.
function shSubLine(s) {
  const h = s.health, parts = [SH_LABEL[s.status] || SH_LABEL.good];
  if (s.status === 'off') parts.push(`Not seen since ${shWhenText(s.last_seen)}`);
  else if (h) {
    if (h.net && h.net.kind === 'wired') parts.push('Wired network');
    else if (h.net && h.net.kind === 'wifi' && h.net.signal_dbm != null) parts.push(`Wi-Fi ${String(h.net.signal_dbm).replace('-', '−')} dBm`);
    else if (h.net && h.net.kind === 'none') parts.push('No network');
    if (h.uptime_s != null) parts.push(shUptimeText(h.uptime_s));
  }
  return parts.join(' · ');
}

// What a screen's Health section holds when it is open: a few facts as chips, what was repaired (or "nothing to report"), a tip when one applies, and two buttons.
function shDetailHtml(s) {
  const h = s.health;
  const roleLabel = s.role === 'host' ? 'Host' : s.role === 'mirror' ? 'Mirror' : 'Display';
  const sub = [roleLabel, h && h.model, s.version].filter(Boolean).join(' · ');
  const chips = [];
  if (s.status === 'off') chips.push(`<span class="sh-chip">${escapeHtml(`Not seen since ${shWhenText(s.last_seen)}`)}</span>`);
  else if (h) {
    if (s.status === 'stuck') chips.push(`<span class="sh-chip bad">${escapeHtml(`Display not drawing for ${s.stuck_minutes} min`)}</span>`);
    else if (h.painted_s != null) chips.push(`<span class="sh-chip">${escapeHtml(shFrameText(h.painted_s))}</span>`);
    if (h.uptime_s != null) chips.push(`<span class="sh-chip">${escapeHtml(shUptimeText(h.uptime_s))}</span>`);
    if (h.net && h.net.kind === 'wired') chips.push(`<span class="sh-chip">Wired network</span>`);
    else if (h.net && h.net.kind === 'wifi') chips.push(`<span class="sh-chip">${escapeHtml(h.net.signal_dbm != null ? `Wi-Fi ${String(h.net.signal_dbm).replace('-', '−')} dBm` : 'Wi-Fi')}</span>`);
    else if (h.net && h.net.kind === 'none') chips.push(`<span class="sh-chip bad">No network</span>`);
    if (h.repairs && h.repairs.count7 > 0) chips.push(`<span class="sh-chip warn">${escapeHtml(`Wi-Fi fixed itself ${h.repairs.count7}×`)}</span>`);
  }
  let detail = '';
  const items = (h && h.repairs && h.repairs.items) || [];
  if (s.status === 'off') {
    detail += `<p class="sh-tip">This screen is not reporting. If it should be on, check its power and Wi-Fi.</p>`;
  } else {
    detail += `<h4>Recent</h4><ul class="sh-tl">` + (items.length
      ? items.map((r) => `<li><time>${escapeHtml(raAgoText(r.at))}</time>${escapeHtml(shRepairText(r))}</li>`).join('')
      : `<li class="none">Nothing to report in the last 7 days</li>`) + `</ul>`;
    if (s.status === 'stuck') detail += `<p class="sh-tip">${escapeHtml(`The display has not drawn for ${s.stuck_minutes} min. Try reloading it; if that does not help, unplug the screen's power for 10 seconds.`)}</p>`;
    else if (h && h.repairs && h.repairs.count7 >= 3) detail += `<p class="sh-tip">${escapeHtml(`This screen has needed ${h.repairs.count7} Wi-Fi repairs this week. A network cable is the most reliable fix.`)}</p>`;
  }
  detail += `<div class="sh-actions">` + (s.status === 'off' ? '' : `<button type="button" class="sh-act primary" data-sh-reload="${escapeHtml(s.device_id)}">Reload display</button>`) + `<button type="button" class="sh-act" data-sh-copy="${escapeHtml(s.device_id)}">Copy details</button></div>`;
  return `<div class="sh-detail"><p class="sh-sub" style="font-size:12px;color:var(--muted);margin:0 0 8px">${escapeHtml(sub)}</p>${chips.length ? `<div class="sh-chips">${chips.join('')}</div>` : ''}${detail}</div>`;
}

// loadScreens() leaves, in each screen's card, a [data-sh-acc] section (hidden) with a [data-sh-sub] line and a [data-sh-slot] body, and a [data-sh-dot] in the title.
// This fills them from the last answer. A screen the health list does not have (a Live Edit preview, an old record) keeps the section hidden and its plain dot.
function shRenderSlots() {
  const list = document.getElementById('screens-list');
  if (!list || !SH_LAST) return;
  shEnsureCss();
  const byId = new Map(SH_LAST.screens.map((s) => [s.device_id, s]));
  list.querySelectorAll('[data-sh-acc]').forEach((sec) => {
    const id = sec.dataset.shAcc, s = byId.get(id);
    if (!s) { sec.style.display = 'none'; return; }
    const open = SH_OPEN.has(id);
    sec.style.display = '';
    sec.classList.toggle('open', open);
    const body = sec.querySelector(':scope > .acc-body'), caret = sec.querySelector(':scope > .acc-head .acc-caret');
    if (body) body.style.display = open ? '' : 'none';
    if (caret) caret.textContent = open ? '▾' : '▸';
    sec.querySelector('[data-sh-sub]').innerHTML = `<span class="sh-acc-dot ${s.status}" aria-hidden="true"></span>${escapeHtml(shSubLine(s))}`;
    sec.querySelector('[data-sh-slot]').innerHTML = shDetailHtml(s);
    const head = sec.querySelector(':scope > .acc-head');
    head.setAttribute('aria-expanded', String(open));
    head.onclick = () => {
      const now = !sec.classList.contains('open');
      sec.classList.toggle('open', now); head.setAttribute('aria-expanded', String(now));
      if (body) body.style.display = now ? '' : 'none';
      if (caret) caret.textContent = now ? '▾' : '▸';
      if (now) SH_OPEN.add(id); else SH_OPEN.delete(id);
    };
    const dot = list.querySelector(`[data-sh-dot="${CSS.escape(id)}"]`);
    if (dot) { dot.style.background = SH_COLOR[s.status] || SH_COLOR.good; dot.title = SH_LABEL[s.status] || ''; dot.dataset.status = s.status; }
  });
  list.querySelectorAll('[data-sh-reload]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const r = await apiFetch(`/api/screens/${encodeURIComponent(b.dataset.shReload)}/reload-display`, { method: 'POST', body: '{}' }).catch(() => null);
    b.disabled = false;
    if (r && r.ok) showToast('Reloading the display…'); else showToast('Could not reload that display');
  }));
  list.querySelectorAll('[data-sh-copy]').forEach((b) => b.addEventListener('click', async () => {
    const s = byId.get(b.dataset.shCopy);
    if (!s) return;
    try { await navigator.clipboard.writeText(shCopyText(s)); showToast('Details copied'); } catch { showToast('Could not copy'); }
  }));
}

// The thin line above the list: one pill, and how many screens. Tapping it opens and scrolls to the first screen that needs a look (or does nothing when all is well).
function shSummaryHtml(d) {
  const sm = d.summary || {};
  const pill = sm.stuck ? ['stuck', 'Needs attention'] : sm.repaired ? ['repaired', 'Fixed itself recently'] : ['good', 'All good'];
  const count = d.screens.length === 1 ? '1 screen' : `${d.screens.length} screens`;
  return `<div class="sh-summary"><span class="sh-pill ${pill[0]}">${pill[1]}</span>${pill[0] === 'good' ? `<span>${escapeHtml(count)}</span>` : `<button type="button" data-sh-first="${pill[0]}">${escapeHtml(count)} · Show</button>`}</div>`;
}

async function loadScreenHealth() {
  const box = document.getElementById('screen-health');
  if (!box) return;
  let d;
  try { d = await apiFetch('/api/screen-health'); } catch { return; }
  if (!d || d.__authFailed || d.__parseError || !Array.isArray(d.screens)) return;
  if (!document.getElementById('screen-health')) return;                      // the tab changed while we waited
  SH_LAST = d;
  if (!d.screens.length) { box.innerHTML = ''; shRenderSlots(); return; }
  shEnsureCss();
  box.innerHTML = shSummaryHtml(d);
  const first = box.querySelector('[data-sh-first]');
  if (first) first.addEventListener('click', () => {
    const want = first.dataset.shFirst, s = d.screens.find((x) => x.status === want) || d.screens.find((x) => x.status === 'stuck' || x.status === 'repaired');
    if (!s) return;
    SH_OPEN.add(s.device_id);
    shRenderSlots();
    const sec = document.querySelector(`#screens-list [data-sh-acc="${CSS.escape(s.device_id)}"]`);
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  shRenderSlots();
}
