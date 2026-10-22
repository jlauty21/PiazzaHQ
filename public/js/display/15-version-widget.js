// Version widget: which Piazza HQ version this device runs and whether an update is waiting. On a mirror screen it also says how its host is doing ("the Docker host is behind"), and it can
// list every screen with its version. The data comes from GET /api/version-status (src/version-status.js), asked for when the widget first draws and again every 30 minutes.
//   verTitle  heading (default "Piazza HQ")      verFontPx  text size (default 20)      verShowScreens  list every screen with its version (default off)
const VER_REFRESH_MS = 30 * 60 * 1000;
let _verFetching = false, _verTimer = null;

async function fetchVersionStatus() {
  if (_verFetching) return;
  _verFetching = true;
  try {
    const r = await fetch('/api/version-status');
    state.versionStatus = r.ok ? await r.json() : null;
    state.versionStatusFailed = !r.ok;
  } catch (e) { state.versionStatus = state.versionStatus || null; state.versionStatusFailed = true; }
  _verFetching = false;
  (state.layout || []).filter((w) => w && w.type === 'version').forEach((w) => { try { rerenderSingleWidget(w.id); } catch (e) { /* not on screen */ } });
}
function verEnsure() {
  if (!state.versionStatus && !_verFetching && !state.versionStatusFailed) fetchVersionStatus();
  if (!_verTimer) _verTimer = setInterval(() => { state.versionStatusFailed = false; fetchVersionStatus(); }, VER_REFRESH_MS);
}

// "Up to date" / "Update available: 1.94.0" / "Checking…" for one device's status object
function verChip(s) {
  if (!s) return '<span class="ver-chip">Could not check</span>';
  if (s.updateAvailable) return '<span class="ver-chip warn">⬆ <span>Update available</span>' + (s.latest ? ': <b>' + escapeHtmlD(s.latest) + '</b>' : '') + '</span>';
  if (!s.checked) return '<span class="ver-chip">Checking for updates…</span>';
  return '<span class="ver-chip ok">✓ <span>Up to date</span></span>';
}
function verRow(label, s) {
  return '<div class="ver-row"><span class="ver-label">' + escapeHtmlD(label) + '</span><span class="ver-num">' + escapeHtmlD(s.version || '?') + '</span>' + verChip(s) + '</div>';
}

function renderVersion(widget) {
  const w = widget || {};
  verEnsure();
  const fontPx = w.verFontPx || 20;
  const style = '--ver-font:calc(' + fontPx + 'px * var(--ui-scale,1))';
  const title = (w.verTitle || '').trim() || 'Piazza HQ';
  const s = state.versionStatus;
  if (!s) {
    return '<div class="w-version" style="' + style + '"><div class="ver-title">' + escapeHtmlD(title) + '</div><div class="no-data">' + (state.versionStatusFailed ? 'Could not check' : 'Checking for updates…') + '</div></div>';
  }
  let rows = '';
  if (s.host !== undefined) {                                  // a mirror screen: how the host is doing, then this screen
    rows += s.host ? verRow('Host', s.host) : '<div class="ver-row"><span class="ver-label">Host</span><span class="ver-chip">Could not reach the host</span></div>';
    rows += verRow('This screen', s);
  } else {
    rows += verRow('', s);
  }
  const docker = (s.host && s.host.container && s.host.updateAvailable) || (s.host === undefined && s.container && s.updateAvailable);
  const dockerLatest = s.host && s.host.container && s.host.updateAvailable ? s.host.latest : s.latest;
  const hint = docker ? '<div class="ver-hint"><span>Update the Docker image to get</span> <b>' + escapeHtmlD(dockerLatest || '') + '</b></div>' : '';
  let screens = '';
  if (w.verShowScreens && Array.isArray(s.screens) && s.screens.length) {
    screens = '<div class="ver-screens"><div class="ver-sub">Screens</div>' + s.screens.map((x) => '<div class="ver-screen' + (x.online ? '' : ' off') + '"><span class="ver-sname">' + escapeHtmlD(x.name) + '</span><span class="ver-num">' + escapeHtmlD(x.version || '?') + '</span>'
      + (x.outdated ? '<span class="ver-chip warn">⬆</span>' : x.version ? '<span class="ver-chip ok">✓</span>' : '') + '</div>').join('') + '</div>';
  }
  return '<div class="w-version" style="' + style + '"><div class="ver-title">' + escapeHtmlD(title) + '</div>' + rows + hint + screens + '</div>';
}
