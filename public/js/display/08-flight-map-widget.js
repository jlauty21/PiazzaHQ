// ── Flight Map widget advanced settings ───────────────────────────────────
function renderFlightMapAdvancedSettings(w) {
  const subject = w.fmSubject || 'filter';
  const f = w.fmFilter || {};
  const filterMode = f.mil ? 'mil' : (f.type ? 'type' : (f.squawk ? 'squawk' : (f.airline ? 'airline' : (f.radiusNm ? 'radius' : 'mil'))));
  const trailMin = Math.max(2, Math.min(360, Number(w.fmTrailMin) || 30));
  const profiles = Array.isArray(state.profiles) ? state.profiles : [];
  const homeSet = state.settings && state.settings.weather_lat && state.settings.weather_lon;
  const sel = (v, cur) => v === cur ? 'selected' : '';
  return `
    <div class="was-row">
      <label>Show</label>
      <select id="fm-subject" style="width:100%">
        <option value="filter" ${sel('filter', subject)}>A group of aircraft (filter)</option>
        <option value="flight" ${sel('flight', subject)}>One specific flight</option>
        <option value="watch" ${sel('watch', subject)}>A saved flight (from the app)</option>
      </select>
    </div>
    <div class="was-row" id="fm-filter-block" ${subject === 'filter' ? '' : 'hidden'}>
      <label>Which aircraft</label>
      <select id="fm-filter-mode" style="width:100%">
        <option value="mil" ${sel('mil', filterMode)}>All military</option>
        <option value="type" ${sel('type', filterMode)}>All of one type (ICAO code)</option>
        <option value="airline" ${sel('airline', filterMode)}>An airline (United, Delta, …)</option>
        <option value="radius" ${sel('radius', filterMode)}>Everything near home</option>
        <option value="squawk" ${sel('squawk', filterMode)}>A squawk code</option>
      </select>
      <div id="fm-type-row" style="margin-top:8px" ${filterMode === 'type' ? '' : 'hidden'}>
        <input type="text" id="fm-type" placeholder="e.g. B738, A320" value="${escapeHtmlD(f.type || '')}" style="width:100%">
        <p class="was-hint">ICAO type designator(s), comma-separated for more than one. A Boeing 737-800 is <code>B738</code>, an A320 <code>A320</code>, a C-17 <code>C17</code>.</p>
      </div>
      <div id="fm-squawk-row" style="margin-top:8px" ${filterMode === 'squawk' ? '' : 'hidden'}>
        <input type="text" id="fm-squawk" placeholder="e.g. 7700" maxlength="4" value="${escapeHtmlD(f.squawk || '')}" style="width:100%">
      </div>
      <div id="fm-airline-row" style="margin-top:8px" ${filterMode === 'airline' ? '' : 'hidden'}>
        <input type="text" id="fm-airline" list="fm-airline-list" placeholder="e.g. UAL, DAL, AAL" value="${escapeHtmlD(f.airline || '')}" style="width:100%">
        <datalist id="fm-airline-list">
          <option value="UAL">United</option><option value="DAL">Delta</option><option value="AAL">American</option>
          <option value="SWA">Southwest</option><option value="JBU">JetBlue</option><option value="ASA">Alaska</option>
          <option value="FFT">Frontier</option><option value="NKS">Spirit</option><option value="SKW">SkyWest</option>
          <option value="FDX">FedEx</option><option value="UPS">UPS</option><option value="GTI">Atlas Air</option>
        </datalist>
        <p class="was-hint">ICAO callsign prefix(es), comma-separated. Covers the area around the map centre (radius below) — the ADS-B feed has no global airline query.</p>
      </div>
      <label id="fm-milonly-row" style="display:${(filterMode === 'mil' || filterMode === 'airline') ? 'none' : 'flex'};align-items:center;gap:8px;margin-top:10px;cursor:pointer">
        <input type="checkbox" id="fm-milonly" ${f.milOnly ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
        Military only ${infoBtn("Drop civil aircraft that happen to share an ICAO type — e.g. civil aircraft that happen to share an ICAO type with a military variant.")}
      </label>
      <div id="fm-center-row" style="margin-top:10px" ${filterMode === 'radius' ? 'hidden' : ''}>
        <label style="font-size:12px;opacity:.8">Centre the map on (optional)</label>
        <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
          <input type="text" id="fm-cplace" placeholder="City, airport, or ZIP" value="${escapeHtmlD(f.centerLabel || '')}" style="flex:1;min-width:0">
          <button type="button" id="fm-cgo" style="flex:0 0 auto;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);cursor:pointer">Set</button>
          <button type="button" id="fm-chome" style="flex:0 0 auto;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);cursor:pointer">Home</button>
          <button type="button" id="fm-cclear" style="flex:0 0 auto;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);cursor:pointer">Clear</button>
        </div>
        <p class="was-hint" id="fm-cplace-hint">${f.centerLat != null && f.centerLon != null && f.centerLat !== '' ? '📍 ' + (f.centerLabel || ((+f.centerLat).toFixed(2) + ', ' + (+f.centerLon).toFixed(2))) : 'Type a place and press Set (or Enter). Blank = a fixed near-hemisphere view.'}</p>
        <!-- Only type/mil/squawk modes use this span — airline/radius modes size
             the view off "Search radius" instead (fmDesiredView checks radiusNm
             first), so this slider would silently do nothing there. -->
        <div id="fm-span-row" ${filterMode === 'airline' ? 'hidden' : ''}>
          <div class="was-range-row" style="margin-top:6px">
            <input type="range" id="fm-span" min="400" max="6000" step="100" value="${Math.max(400, Math.min(6000, Number(f.spanNm) || 2600))}">
            <span class="was-range-val" id="fm-span-val">${Math.max(400, Math.min(6000, Number(f.spanNm) || 2600))} nm across</span>
          </div>
        </div>
      </div>
      <div id="fm-radius-row" style="margin-top:8px" ${(filterMode === 'radius' || filterMode === 'airline') ? '' : 'hidden'}>
        <label style="font-size:12px;opacity:.8">Search radius</label>
        <div class="was-range-row">
          <input type="range" id="fm-radius" min="20" max="250" step="10" value="${Math.max(20, Math.min(250, Number(f.radiusNm) || (filterMode === 'airline' ? 250 : 150)))}">
          <span class="was-range-val" id="fm-radius-val">${Math.max(20, Math.min(250, Number(f.radiusNm) || (filterMode === 'airline' ? 250 : 150)))} nm</span>
        </div>
        <p class="was-hint">${homeSet ? 'Around the map centre above (or your weather location).' : 'Set your location in Settings → Weather first.'}</p>
      </div>
    </div>
    <div class="was-row" id="fm-flight-block" ${subject === 'flight' ? '' : 'hidden'}>
      <label>Flight</label>
      <div style="display:flex;gap:6px">
        <select id="fm-flight-kind" style="flex:0 0 auto">
          <option value="callsign" ${sel('callsign', w.fmFlightKind || 'callsign')}>Callsign</option>
          <option value="reg" ${sel('reg', w.fmFlightKind)}>Tail #</option>
          <option value="hex" ${sel('hex', w.fmFlightKind)}>ICAO hex</option>
        </select>
        <input type="text" id="fm-flight-value" placeholder="e.g. DAL456" value="${escapeHtmlD(w.fmFlightValue || '')}" style="flex:1">
      </div>
      <p class="was-hint">A pilot flies whatever aircraft is on the route, so track the day's callsign/flight number (they'll need to tell you), not a fixed tail.</p>
    </div>
    <div class="was-row" id="fm-watch-block" ${subject === 'watch' ? '' : 'hidden'}>
      <label>Whose flights</label>
      <select id="fm-watch-profile" style="width:100%">
        <option value="">Everyone's saved flights</option>
        ${profiles.map(p => `<option value="${p.id}" ${String(w.fmWatchProfileId) === String(p.id) ? 'selected' : ''}>${escapeHtmlD(p.name || 'Profile')}</option>`).join('')}
      </select>
      <p class="was-hint">Saved flights are added from the app. This widget follows whichever ones are active today.</p>
    </div>
    <div class="was-toggle-row">
      <label>Follow the aircraft ${infoBtn("Keep the map centred on the tracked flight. For a filter, leave this off so the view stays put.")}</label>
      <input type="checkbox" id="fm-follow" ${w.fmFollow ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Show the info panel</label>
      <input type="checkbox" id="fm-showdata" ${w.fmShowData !== false ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Show trails</label>
      <input type="checkbox" id="fm-showtrails" ${w.fmShowTrails !== false ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Label aircraft ${infoBtn("Show each aircraft's callsign next to it. Auto-hidden when the view is too crowded to read; the selected one is always labelled.")}</label>
      <input type="checkbox" id="fm-labels" ${w.fmLabels !== false ? 'checked' : ''}>
    </div>
    <div class="was-toggle-row">
      <label>Show state / province lines ${infoBtn("Draw US state borders (and, where the data has them, other admin boundaries) under the country outlines.")}</label>
      <input type="checkbox" id="fm-states" ${w.fmStates !== false ? 'checked' : ''}>
    </div>
    <div class="was-row">
      <label>Trail length</label>
      <div class="was-range-row">
        <input type="range" id="fm-trail" min="5" max="360" step="5" value="${trailMin}">
        <span class="was-range-val" id="fm-trail-val">${fmDurLabel(trailMin)}</span>
      </div>
    </div>
    <p class="was-hint">Positions come from free community ADS-B receivers (airplanes.live, with adsb.lol / adsb.fi as backups). Coverage is thin over oceans and remote areas — an aircraft there shows its last known position.</p>
  `;
}
function wireFlightMapAdvancedSettings(w) {
  const save = () => { rerenderSingleWidget(w.id); scheduleLayoutSave(); fetchFlightmap(true); };
  const $ = (id) => document.getElementById(id);
  const setHidden = (id, hide) => { const e = $(id); if (e) e.hidden = hide; };
  const subj = $('fm-subject');
  if (subj) subj.addEventListener('change', (e) => {
    w.fmSubject = e.target.value;
    setHidden('fm-filter-block', w.fmSubject !== 'filter');
    setHidden('fm-flight-block', w.fmSubject !== 'flight');
    setHidden('fm-watch-block', w.fmSubject !== 'watch');
    if (w.fmSubject === 'flight' || w.fmSubject === 'watch') w.fmFollow = true;
    const fc = $('fm-follow'); if (fc) fc.checked = !!w.fmFollow;
    save();
  });
  // Filter-level extras (map centre, "military only") are independent of the
  // mil/type/squawk sub-mode, so preserve them across mode + value edits.
  const extras = () => {
    const c = {};
    const f0 = w.fmFilter || {};
    if (f0.centerLat != null && f0.centerLat !== '') c.centerLat = f0.centerLat;
    if (f0.centerLon != null && f0.centerLon !== '') c.centerLon = f0.centerLon;
    if (f0.centerLabel) c.centerLabel = f0.centerLabel;
    if (f0.spanNm) c.spanNm = f0.spanNm;
    if (f0.milOnly) c.milOnly = true;
    return c;
  };
  const center = extras; // legacy name used below
  const homeLL = () => ({ lat: parseFloat(state.settings.weather_lat), lon: parseFloat(state.settings.weather_lon) });
  const fmode = $('fm-filter-mode');
  if (fmode) fmode.addEventListener('change', (e) => {
    const m = e.target.value;
    if (m === 'radius') {
      w.fmFilter = { ...extras(), radiusNm: Number(($('fm-radius') || {}).value) || 150, ...homeLL() };
      delete w.fmFilter.centerLat; delete w.fmFilter.centerLon; delete w.fmFilter.spanNm;
    } else if (m === 'airline') {
      const ex = extras();
      const c = homeLL();
      w.fmFilter = { ...ex, airline: ($('fm-airline') || {}).value || '', radiusNm: Number(($('fm-radius') || {}).value) || 250,
        lat: (ex.centerLat != null ? ex.centerLat : c.lat), lon: (ex.centerLon != null ? ex.centerLon : c.lon) };
      delete w.fmFilter.milOnly;
    } else {
      w.fmFilter = { ...extras() };
      if (m === 'mil') { w.fmFilter.mil = true; delete w.fmFilter.milOnly; }
      else if (m === 'type') w.fmFilter.type = ($('fm-type') || {}).value || '';
      else if (m === 'squawk') w.fmFilter.squawk = ($('fm-squawk') || {}).value || '';
    }
    setHidden('fm-type-row', m !== 'type');
    setHidden('fm-squawk-row', m !== 'squawk');
    setHidden('fm-airline-row', m !== 'airline');
    setHidden('fm-radius-row', m !== 'radius' && m !== 'airline');
    setHidden('fm-span-row', m === 'airline');
    setHidden('fm-center-row', m === 'radius');
    const mr = $('fm-milonly-row'); if (mr) mr.style.display = (m === 'mil' || m === 'airline') ? 'none' : 'flex';
    save();
  });
  const alIn = $('fm-airline');
  if (alIn) alIn.addEventListener('input', (e) => {
    w.fmFilter = { ...(w.fmFilter || {}), airline: e.target.value.toUpperCase() };
    save();
  });
  const mil1 = $('fm-milonly');
  if (mil1) mil1.addEventListener('change', (e) => {
    w.fmFilter = { ...(w.fmFilter || {}) };
    if (e.target.checked) w.fmFilter.milOnly = true; else delete w.fmFilter.milOnly;
    save();
  });
  const tIn = $('fm-type');
  if (tIn) tIn.addEventListener('input', (e) => { w.fmFilter = { ...extras(), type: e.target.value.toUpperCase() }; save(); });
  const sqIn = $('fm-squawk');
  if (sqIn) sqIn.addEventListener('input', (e) => { w.fmFilter = { ...center(), squawk: e.target.value.replace(/\D/g, '').slice(0, 4) }; save(); });
  const setCenter = (lat, lon, label) => {
    const base = { ...(w.fmFilter || {}) };
    delete base.centerLat; delete base.centerLon; delete base.centerLabel;
    const ok = lat !== '' && lon !== '' && Number.isFinite(+lat) && Number.isFinite(+lon);
    if (ok) { base.centerLat = +lat; base.centerLon = +lon; if (label) base.centerLabel = label; }
    // airline mode's point query centres on lat/lon — keep it in sync with the
    // chosen centre (falls back to home when cleared).
    if (base.airline) {
      base.lat = ok ? +lat : parseFloat(state.settings.weather_lat);
      base.lon = ok ? +lon : parseFloat(state.settings.weather_lon);
    }
    w.fmFilter = base; save();
    const hint = $('fm-cplace-hint');
    if (hint) hint.textContent = ok
      ? ('📍 ' + (label || ((+lat).toFixed(2) + ', ' + (+lon).toFixed(2))))
      : 'Type a place and press Set (or Enter). Blank = a fixed near-hemisphere view.';
  };
  const placeIn = $('fm-cplace');
  const runPlaceSearch = async () => {
    const q = (placeIn.value || '').trim();
    const hint = $('fm-cplace-hint');
    if (q.length < 2) { setCenter('', ''); return; }
    if (hint) hint.textContent = 'Searching…';
    try {
      const r = await fetch('/api/place-search?q=' + encodeURIComponent(q)).then(x => x.json());
      if (r && r.lat != null && r.lon != null) { placeIn.value = r.label || q; setCenter(r.lat, r.lon, r.label || q); }
      else if (hint) hint.textContent = (r && r.error) || 'Nothing found for that.';
    } catch { if (hint) hint.textContent = 'Search failed — try again.'; }
  };
  if ($('fm-cgo')) $('fm-cgo').addEventListener('click', runPlaceSearch);
  if (placeIn) placeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPlaceSearch(); } });
  if ($('fm-chome')) $('fm-chome').addEventListener('click', () => {
    const la = parseFloat(state.settings.weather_lat), lo = parseFloat(state.settings.weather_lon);
    if (Number.isFinite(la) && Number.isFinite(lo)) { placeIn.value = 'Home'; setCenter(la, lo, 'Home'); }
  });
  if ($('fm-cclear')) $('fm-cclear').addEventListener('click', () => { placeIn.value = ''; setCenter('', ''); });
  const spanIn = $('fm-span');
  if (spanIn) spanIn.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('fm-span-val').textContent = v + ' nm across';
    w.fmFilter = { ...(w.fmFilter || {}), spanNm: v }; save();
  });
  const rIn = $('fm-radius');
  if (rIn) rIn.addEventListener('input', (e) => {
    const val = Number(e.target.value);
    $('fm-radius-val').textContent = val + ' nm';
    const cur = w.fmFilter || {};
    const useLat = cur.centerLat != null ? cur.centerLat : parseFloat(state.settings.weather_lat);
    const useLon = cur.centerLon != null ? cur.centerLon : parseFloat(state.settings.weather_lon);
    w.fmFilter = { ...cur, radiusNm: val, lat: useLat, lon: useLon };
    save();
  });
  const fk = $('fm-flight-kind');
  if (fk) fk.addEventListener('change', (e) => { w.fmFlightKind = e.target.value; save(); });
  const fv = $('fm-flight-value');
  if (fv) fv.addEventListener('input', (e) => { w.fmFlightValue = e.target.value.toUpperCase().trim(); save(); });
  const wp = $('fm-watch-profile');
  if (wp) wp.addEventListener('change', (e) => { w.fmWatchProfileId = e.target.value || null; save(); });
  const fol = $('fm-follow');
  if (fol) fol.addEventListener('change', (e) => { w.fmFollow = e.target.checked; save(); });
  const sd = $('fm-showdata');
  if (sd) sd.addEventListener('change', (e) => { w.fmShowData = e.target.checked; save(); });
  const stt = $('fm-showtrails');
  if (stt) stt.addEventListener('change', (e) => { w.fmShowTrails = e.target.checked; save(); });
  const lbl = $('fm-labels');
  if (lbl) lbl.addEventListener('change', (e) => { w.fmLabels = e.target.checked; save(); });
  const stl = $('fm-states');
  if (stl) stl.addEventListener('change', (e) => { w.fmStates = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const tr = $('fm-trail');
  if (tr) tr.addEventListener('input', (e) => {
    w.fmTrailMin = parseInt(e.target.value, 10);
    $('fm-trail-val').textContent = fmDurLabel(w.fmTrailMin);
    save();
  });
}

// ── Camera widget advanced settings ───────────────────────────────────────
// Cameras are a global managed list (state.cameras, URLs redacted). The panel
// lets you pick one, add/edit/remove one inline, set fit + title, and test.
let _camFormOpen = false;      // is the add/edit form showing
let _camFormEditId = null;     // null = adding; an id = editing that camera
let _camFormSource = 'url';    // 'url' | 'ha'
let _camPanelWidgetId = null;  // which widget's camera panel is open (reset the form when it changes)
function renderCameraAdvancedSettings(w) {
  const cams = state.cameras || [];
  const fit = w.camFit === 'cover' ? 'cover' : 'contain';
  const opts = cams.map(c => `<option value="${c.id}" ${String(c.id) === String(w.camId) ? 'selected' : ''}>${escapeHtmlD(c.name)}${c.kind === 'ha' ? ' (HA)' : ''}</option>`).join('');
  const editing = _camFormEditId != null ? cams.find(c => String(c.id) === String(_camFormEditId)) : null;

  const form = _camFormOpen ? `
    <div class="was-box" style="padding:10px;margin-top:8px">
      <div class="was-row">
        <label>Name</label>
        <input type="text" id="cam-f-name" value="${escapeHtmlD(editing ? editing.name : '')}" placeholder="Driveway">
      </div>
      <div class="was-row">
        <label>Source</label>
        <select id="cam-f-source">
          <option value="url" ${_camFormSource === 'url' ? 'selected' : ''}>Direct URL (RTSP / ONVIF / MJPEG)</option>
          <option value="ha" ${_camFormSource === 'ha' ? 'selected' : ''}>Home Assistant camera</option>
        </select>
      </div>
      <div class="was-row" id="cam-f-url-row" style="${_camFormSource === 'url' ? '' : 'display:none'}">
        <label>Stream URL</label>
        <input type="text" id="cam-f-url" placeholder="rtsp://user:pass@192.168.1.9:554/stream1" value="">
        <p class="was-hint" style="margin-top:6px">${editing ? 'Leave blank to keep the saved URL. ' : ''}Needs RTSP/ONVIF/MJPEG — not a browser page. Credentials in the URL are fine; they stay on the server.</p>
      </div>
      <div class="was-row" id="cam-f-ha-row" style="${_camFormSource === 'ha' ? '' : 'display:none'}">
        <label>Camera entity</label>
        <select id="cam-f-ha-entity"><option value="">Loading Home Assistant cameras…</option></select>
      </div>
      <div id="cam-f-error" class="was-hint" style="color:#ff9b9b;display:none"></div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button id="cam-f-save" type="button" style="flex:1;padding:10px;border-radius:9px;border:none;background:var(--accent,#4A90D9);color:#fff;font-weight:700">${editing ? 'Save changes' : 'Add camera'}</button>
        <button id="cam-f-cancel" type="button" style="flex:0 0 auto;padding:10px 14px;border-radius:9px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#fff">Cancel</button>
      </div>
    </div>` : '';

  return `
    <div class="was-row">
      <label>Camera</label>
      ${cams.length ? `<select id="cam-select"><option value="">— none —</option>${opts}</select>` : `<p class="was-hint" style="margin-top:0">No cameras yet — add one below.</p>`}
    </div>
    ${cams.length && w.camId && !_camFormOpen ? `
    <div class="was-row" style="display:flex;gap:8px">
      <button id="cam-edit-btn" type="button" class="was-mini-btn">✏️ Edit</button>
      <button id="cam-del-btn" type="button" class="was-mini-btn">🗑️ Remove</button>
      <button id="cam-test-btn" type="button" class="was-mini-btn">📶 Test</button>
      <span id="cam-test-result" class="was-hint" style="align-self:center"></span>
    </div>` : ''}
    ${!_camFormOpen ? `<div class="was-row"><button id="cam-add-btn" type="button" style="width:100%;padding:10px;border-radius:9px;border:1px dashed rgba(255,255,255,0.25);background:transparent;color:var(--text)">＋ Add a camera</button></div>` : ''}
    ${form}
    <div class="was-row">
      <label>Fit</label>
      <select id="cam-fit">
        <option value="contain" ${fit === 'contain' ? 'selected' : ''}>Contain (show the whole frame)</option>
        <option value="cover" ${fit === 'cover' ? 'selected' : ''}>Cover (fill, may crop)</option>
      </select>
    </div>
    <div class="was-toggle-row">
      <label>Show title</label>
      <input type="checkbox" id="cam-show-title" ${w.camShowTitle !== false ? 'checked' : ''}>
    </div>
    <p class="was-hint">Live H.264/H.265 needs some CPU — a Pi 4 or 5 handles one or two streams; on an older Pi, run the server on Docker or Windows instead.</p>
  `;
}
function wireCameraAdvancedSettings(w) {
  const sel = document.getElementById('cam-select');
  if (sel) sel.addEventListener('change', (e) => {
    w.camId = e.target.value ? parseInt(e.target.value, 10) : null;
    if (!w.camTitle) { /* title follows the camera name via renderCamera's fallback */ }
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id); // refresh Edit/Remove/Test row visibility
  });
  const fit = document.getElementById('cam-fit');
  if (fit) fit.addEventListener('change', (e) => { w.camFit = e.target.value; rerenderSingleWidget(w.id); scheduleLayoutSave(); });
  const showTitle = document.getElementById('cam-show-title');
  if (showTitle) showTitle.addEventListener('change', (e) => { w.camShowTitle = e.target.checked; rerenderSingleWidget(w.id); scheduleLayoutSave(); });

  const addBtn = document.getElementById('cam-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => { _camFormOpen = true; _camFormEditId = null; _camFormSource = 'url'; openWidgetAdvancedPanel(w.id); });
  const editBtn = document.getElementById('cam-edit-btn');
  if (editBtn) editBtn.addEventListener('click', () => {
    const cam = (state.cameras || []).find(c => String(c.id) === String(w.camId));
    _camFormOpen = true; _camFormEditId = w.camId; _camFormSource = cam && cam.kind === 'ha' ? 'ha' : 'url';
    openWidgetAdvancedPanel(w.id);
  });
  const delBtn = document.getElementById('cam-del-btn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!w.camId) return;
    if (!confirm('Remove this camera? Any widget using it will go blank.')) return;
    try { await fetch(`/api/cameras/${w.camId}`, { method: 'DELETE' }); } catch {}
    w.camId = null; scheduleLayoutSave();
    await fetchCameras(); rerenderSingleWidget(w.id); openWidgetAdvancedPanel(w.id);
  });
  const testBtn = document.getElementById('cam-test-btn');
  if (testBtn) testBtn.addEventListener('click', async () => {
    const out = document.getElementById('cam-test-result');
    if (out) out.textContent = 'testing…';
    try {
      const r = await (await fetch(`/api/cameras/${w.camId}/test`)).json();
      if (out) { out.textContent = r.ok ? '✓ streaming' : ('✗ ' + (r.error || 'no signal')); out.style.color = r.ok ? '#3ec97a' : '#ff9b9b'; }
    } catch { if (out) { out.textContent = '✗ could not test'; out.style.color = '#ff9b9b'; } }
  });

  // The add/edit form
  const src = document.getElementById('cam-f-source');
  if (src) src.addEventListener('change', (e) => {
    _camFormSource = e.target.value;
    document.getElementById('cam-f-url-row').style.display = _camFormSource === 'url' ? '' : 'none';
    document.getElementById('cam-f-ha-row').style.display = _camFormSource === 'ha' ? '' : 'none';
    if (_camFormSource === 'ha') loadCamHaEntities();
  });
  if (_camFormOpen && _camFormSource === 'ha') loadCamHaEntities();
  const cancel = document.getElementById('cam-f-cancel');
  if (cancel) cancel.addEventListener('click', () => { _camFormOpen = false; _camFormEditId = null; openWidgetAdvancedPanel(w.id); });
  const save = document.getElementById('cam-f-save');
  if (save) save.addEventListener('click', async () => {
    const err = document.getElementById('cam-f-error');
    const showErr = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } };
    const name = document.getElementById('cam-f-name').value.trim();
    if (!name) return showErr('Give the camera a name.');
    const kind = _camFormSource === 'ha' ? 'ha' : 'url';
    let url = '';
    if (kind === 'ha') {
      url = document.getElementById('cam-f-ha-entity').value;
      if (!url) return showErr('Pick a Home Assistant camera entity.');
      url = 'ha:' + url;
    } else {
      url = document.getElementById('cam-f-url').value.trim();
      if (!_camFormEditId && !url) return showErr('Enter the stream URL.');
    }
    save.disabled = true; save.textContent = 'Saving…';
    try {
      const body = { name, kind };
      if (url) body.url = url;
      let res;
      if (_camFormEditId) res = await fetch(`/api/cameras/${_camFormEditId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      else res = await fetch('/api/cameras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { save.disabled = false; save.textContent = _camFormEditId ? 'Save changes' : 'Add camera'; return showErr(j.error || 'Could not save.'); }
      if (!_camFormEditId && j && j.id) { w.camId = j.id; scheduleLayoutSave(); }
      _camFormOpen = false; _camFormEditId = null;
      await fetchCameras();
      rerenderSingleWidget(w.id);
      openWidgetAdvancedPanel(w.id);
    } catch {
      save.disabled = false; save.textContent = _camFormEditId ? 'Save changes' : 'Add camera';
      showErr('Could not save — try again.');
    }
  });
}
async function loadCamHaEntities() {
  const sel = document.getElementById('cam-f-ha-entity');
  if (!sel) return;
  try {
    if (!cachedHaEntitiesD) { const r = await fetch('/api/ha/entities'); const d = await r.json(); cachedHaEntitiesD = Array.isArray(d) ? d : []; }
  } catch { cachedHaEntitiesD = cachedHaEntitiesD || []; }
  const cams = (cachedHaEntitiesD || []).filter(e => e.entity_id.startsWith('camera.'));
  const editing = _camFormEditId != null ? (state.cameras || []).find(c => String(c.id) === String(_camFormEditId)) : null;
  const cur = editing && editing.kind === 'ha' ? editing.host_hint : '';
  sel.innerHTML = cams.length
    ? `<option value="">— choose —</option>` + cams.map(e => `<option value="${escapeHtmlD(e.entity_id)}" ${e.entity_id === cur ? 'selected' : ''}>${escapeHtmlD(e.friendly_name)}</option>`).join('')
    : `<option value="">No camera.* entities found — is Home Assistant connected?</option>`;
}

// ── Manage Reminders panel ──────────────────────────────────────────────
// Wired exactly once, below, NOT from inside wireRemindersAdvancedSettings()
// above — see the CSS comment on #manage-reminders-panel for why. Two
// sub-views in one panel: the list (default) and an add/edit form, swapped
// via manage-reminders-body's innerHTML rather than two separate panels.
// Same reasoning as app.html's identical variable — see its own comment.
// Five controls in Mini Calendar's settings (Layout, Color Coding, Wrap
// Event Text, Show Reminders, Show Stickers) trigger a full
// openWidgetAdvancedPanel() re-render because they gate other rows'
// visibility; without this, the accordion section containing whichever
// control was just touched would snap shut on every redraw. Defaults to
// nothing open (null) — reset back to that whenever a different widget's
// panel opens — see openWidgetAdvancedPanel()'s own widget-switch handling.
let _calSettingsOpenSection = null; // null = nothing open by default
let _calSettingsOpenSectionForWidgetId = null;
let _manageRemindersEditingId = null; // null = "add new"; a reminder's id = editing that one
// See app.html's identical variable for the full explanation — tracks an
// uploaded-but-not-yet-saved icon image filename for the currently open form.
let _mrPendingIconImage = null;
function openManageRemindersPanel() {
  _manageRemindersEditingId = null;
  renderManageRemindersList();
  document.getElementById('manage-reminders-panel').style.display = 'flex';
}
function closeManageRemindersPanel() {
  document.getElementById('manage-reminders-panel').style.display = 'none';
}
function renderManageRemindersList() {
  document.getElementById('manage-reminders-title').textContent = 'Manage Reminders';
  const body = document.getElementById('manage-reminders-body');
  const reminders = state.reminders || [];
  const scheduleLabel = (r) => reminderScheduleSummaryD(r);
  body.innerHTML = `
    <button id="mr-add-btn" type="button" style="width:100%;padding:12px;border-radius:10px;border:none;background:var(--accent,#4A90D9);color:#fff;font-size:14px;font-weight:700;margin-bottom:16px">+ Add Reminder</button>
    ${reminders.length ? reminders.map(r => `
      <div class="mr-item">
        <div class="mr-item-icon">${reminderIconHtml(r)}</div>
        <div class="mr-item-info">
          <div class="mr-item-name">${escapeHtmlD(r.name)}</div>
          <div class="mr-item-schedule">${escapeHtmlD(scheduleLabel(r))}</div>
        </div>
        <div class="mr-item-actions">
          <button class="mr-icon-btn mr-edit" data-id="${r.id}">✏️</button>
          <button class="mr-icon-btn mr-delete" data-id="${r.id}">🗑️</button>
        </div>
      </div>
    `).join('') : `<p style="color:rgba(255,255,255,0.5);font-size:13.5px;text-align:center;margin-top:30px">No reminders yet — add one to get started.</p>`}
  `;
  document.getElementById('mr-add-btn').addEventListener('click', () => openManageRemindersForm(null));
  body.querySelectorAll('.mr-edit').forEach(btn => btn.addEventListener('click', () => openManageRemindersForm(btn.dataset.id)));
  body.querySelectorAll('.mr-delete').forEach(btn => btn.addEventListener('click', () => deleteReminder(btn.dataset.id)));
}
async function deleteReminder(id) {
  const r = (state.reminders || []).find(x => String(x.id) === String(id));
  if (!confirm(`Delete "${r ? r.name : 'this reminder'}"? This removes it everywhere it's shown, including the calendar.`)) return;
  try {
    await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
    await fetchReminders();
    renderManageRemindersList();
    renderLayout();
  } catch { alert('Could not delete — check the connection and try again.'); }
}
// Same helpers as app.html's nthWeekOptions/weekdayOptions/monthOptions,
// suffixed D to match this file's own naming convention for its duplicated
// copies (escapeHtmlD, etc.).
function nthWeekOptionsD(selected) {
  const opts = [[1,'First'],[2,'Second'],[3,'Third'],[4,'Fourth'],[-1,'Last']];
  return opts.map(([v,l]) => `<option value="${v}" ${String(selected)===String(v)?'selected':''}>${l}</option>`).join('');
}
function weekdayOptionsD(selected) {
  const full = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return full.map((l, i) => `<option value="${i}" ${String(selected)===String(i)?'selected':''}>${l}</option>`).join('');
}
function monthOptionsD(selected) {
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names.map((l, i) => `<option value="${i+1}" ${String(selected)===String(i+1)?'selected':''}>${l}</option>`).join('');
}
function openManageRemindersForm(id) {
  _manageRemindersEditingId = id;
  const existing = id ? (state.reminders || []).find(x => String(x.id) === String(id)) : null;
  _mrPendingIconImage = existing && existing.icon_type === 'image' ? (existing.icon_image || null) : null;
  document.getElementById('manage-reminders-title').textContent = existing ? 'Edit Reminder' : 'Add Reminder';
  const body = document.getElementById('manage-reminders-body');
  const cfg = (existing && existing.schedule_config) || {};
  const scheduleType = (existing && existing.schedule_type) || 'weekly';
  const selectedDays = new Set(scheduleType === 'weekly' ? (cfg.daysOfWeek || []) : []);
  body.innerHTML = `
    <div class="mr-form-row">
      <label>Name</label>
      <input type="text" id="mr-f-name" value="${existing ? escapeHtmlD(existing.name) : ''}" placeholder="e.g. Trash, Recycling, Water plants" maxlength="40">
    </div>
    <div class="mr-form-row">
      <label>Icon</label>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        ${[['emoji','Emoji'],['text','Text'],['image','Image']].map(([val, label]) => `
          <button type="button" class="mr-icontype-btn${(existing ? (existing.icon_type || 'emoji') : 'emoji') === val ? ' active' : ''}" data-icontype="${val}"
            style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
              background:${(existing ? (existing.icon_type || 'emoji') : 'emoji') === val ? 'rgba(74,144,217,0.3)' : 'transparent'};
              color:${(existing ? (existing.icon_type || 'emoji') : 'emoji') === val ? '#fff' : '#a8b2c4'};font-size:12px;font-weight:700">${label}</button>
        `).join('')}
      </div>
      <div id="mr-f-icon-emoji-row" style="${(existing ? (existing.icon_type||'emoji') : 'emoji') !== 'emoji' ? 'display:none' : ''}">
        <input type="text" id="mr-f-icon" value="${existing && existing.icon ? existing.icon : '📌'}" maxlength="4" style="width:70px;text-align:center;font-size:20px">
      </div>
      <div id="mr-f-icon-text-row" style="${(existing ? existing.icon_type : '') !== 'text' ? 'display:none' : ''}">
        <input type="text" id="mr-f-icon-text" value="${existing && existing.icon_type === 'text' ? escapeHtmlD(existing.icon || '') : ''}" maxlength="12" placeholder="e.g. Trash">
        <div style="font-size:11px;color:#a8b2c4;margin-top:4px">Short label — long text shrinks to fit, but stays most readable around 4-6 characters.</div>
      </div>
      <div id="mr-f-icon-image-row" style="${(existing ? existing.icon_type : '') !== 'image' ? 'display:none' : ''}">
        <input type="file" id="mr-f-icon-file" accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
        <div style="display:flex;align-items:center;gap:10px">
          <div id="mr-f-icon-preview" style="width:44px;height:44px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05) center/contain no-repeat;background-image:${existing && existing.icon_type === 'image' && existing.icon_image ? `url('/uploads/${escapeHtmlD(existing.icon_image)}')` : 'none'}"></div>
          <button type="button" id="mr-f-icon-upload-btn" style="padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e8edf5;font-size:13px">${existing && existing.icon_type === 'image' && existing.icon_image ? 'Replace image' : 'Choose image'}</button>
        </div>
        <div style="font-size:11px;color:#a8b2c4;margin-top:4px">Shown small everywhere a reminder icon appears — a simple, high-contrast image works best.</div>
      </div>
    </div>
    <div class="mr-form-row">
      <label>Repeats</label>
      <select id="mr-f-type">
        <option value="weekly" ${scheduleType==='weekly'?'selected':''}>Weekly</option>
        <option value="interval" ${scheduleType==='interval'?'selected':''}>Daily</option>
        <option value="monthly" ${scheduleType==='monthly'?'selected':''}>Monthly</option>
        <option value="yearly" ${scheduleType==='yearly'?'selected':''}>Yearly</option>
      </select>
    </div>
    <div class="mr-form-row" id="mr-f-weekly-row" style="${scheduleType!=='weekly'?'display:none':''}">
      <label>Every</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="mr-f-week-interval" min="1" max="52" value="${cfg.weekInterval || 1}" style="width:70px">
        <span style="color:#a8b2c4;font-size:13px">week(s), on:</span>
      </div>
      <div class="mr-dow-row" style="margin-top:10px">
        ${DAYS_S.map((d, i) => `<button type="button" class="mr-dow-btn${selectedDays.has(i)?' active':''}" data-dow="${i}">${d}</button>`).join('')}
      </div>
    </div>
    <div class="mr-form-row" id="mr-f-interval-row" style="${scheduleType!=='interval'?'display:none':''}">
      <label>Repeat every</label>
      <input type="number" id="mr-f-interval-days" min="1" max="365" value="${cfg.intervalDays || 14}"> days
    </div>
    <div class="mr-form-row" id="mr-f-monthly-row" style="${scheduleType!=='monthly'?'display:none':''}">
      <label>Every</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="mr-f-month-interval" min="1" max="24" value="${cfg.monthInterval || 1}" style="width:70px">
        <span style="color:#a8b2c4;font-size:13px">month(s)</span>
      </div>
      <select id="mr-f-monthly-mode" style="margin-top:10px">
        <option value="dayOfMonth" ${(cfg.monthlyMode||'dayOfMonth')==='dayOfMonth'?'selected':''}>On a specific day of the month</option>
        <option value="nthWeekday" ${cfg.monthlyMode==='nthWeekday'?'selected':''}>On the nth weekday</option>
      </select>
      <div id="mr-f-monthly-dayofmonth-row" style="margin-top:10px;${cfg.monthlyMode==='nthWeekday'?'display:none':''}">
        <label>Day of month</label>
        <input type="number" id="mr-f-day-of-month" min="1" max="31" value="${cfg.dayOfMonth || 1}">
      </div>
      <div id="mr-f-monthly-nthweekday-row" style="margin-top:10px;display:flex;gap:8px;${cfg.monthlyMode!=='nthWeekday'?'display:none':''}">
        <select id="mr-f-nth-week" style="flex:1">${nthWeekOptionsD(cfg.nthWeek)}</select>
        <select id="mr-f-nth-weekday" style="flex:1">${weekdayOptionsD(cfg.nthWeekday)}</select>
      </div>
    </div>
    <div class="mr-form-row" id="mr-f-yearly-row" style="${scheduleType!=='yearly'?'display:none':''}">
      <label>Every</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="mr-f-year-interval" min="1" max="20" value="${cfg.yearInterval || 1}" style="width:70px">
        <span style="color:#a8b2c4;font-size:13px">year(s), in:</span>
      </div>
      <select id="mr-f-yearly-month" style="margin-top:10px">${monthOptionsD(cfg.yearlyMonth)}</select>
      <select id="mr-f-yearly-mode" style="margin-top:10px">
        <option value="date" ${(cfg.yearlyMode||'date')==='date'?'selected':''}>On a specific date</option>
        <option value="nthWeekday" ${cfg.yearlyMode==='nthWeekday'?'selected':''}>On the nth weekday</option>
      </select>
      <div id="mr-f-yearly-date-row" style="margin-top:10px;${cfg.yearlyMode==='nthWeekday'?'display:none':''}">
        <label>Day</label>
        <input type="number" id="mr-f-yearly-day" min="1" max="31" value="${cfg.yearlyDay || 1}">
      </div>
      <div id="mr-f-yearly-nthweekday-row" style="margin-top:10px;display:flex;gap:8px;${cfg.yearlyMode!=='nthWeekday'?'display:none':''}">
        <select id="mr-f-yearly-nth-week" style="flex:1">${nthWeekOptionsD(cfg.yearlyNthWeek)}</select>
        <select id="mr-f-yearly-nth-weekday" style="flex:1">${weekdayOptionsD(cfg.yearlyNthWeekday)}</select>
      </div>
    </div>
    <div class="mr-form-row" id="mr-f-startdate-row">
      <label>Starts</label>
      <input type="date" id="mr-f-start-date" value="${cfg.startDate || todayStr()}">
    </div>
    <div class="mr-form-row">
      <label>Ends</label>
      <select id="mr-f-end-type">
        <option value="never" ${(cfg.endType||'never')==='never'?'selected':''}>Never</option>
        <option value="onDate" ${cfg.endType==='onDate'?'selected':''}>On a date</option>
        <option value="afterCount" ${cfg.endType==='afterCount'?'selected':''}>After a number of times</option>
      </select>
      <div id="mr-f-end-date-row" style="margin-top:10px;${cfg.endType!=='onDate'?'display:none':''}">
        <input type="date" id="mr-f-end-date" value="${cfg.endDate || ''}">
      </div>
      <div id="mr-f-end-count-row" style="margin-top:10px;${cfg.endType!=='afterCount'?'display:none':''}">
        <input type="number" id="mr-f-end-count" min="1" max="999" value="${cfg.endCount || 10}">
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:22px">
      <button id="mr-f-cancel" type="button" style="flex:1;padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#e8edf5;font-size:14px">Cancel</button>
      <button id="mr-f-save" type="button" style="flex:1;padding:12px;border-radius:10px;border:none;background:var(--accent,#4A90D9);color:#fff;font-size:14px;font-weight:700">Save</button>
    </div>
  `;
  const typeSel = document.getElementById('mr-f-type');
  typeSel.addEventListener('change', (e) => {
    document.getElementById('mr-f-weekly-row').style.display = e.target.value === 'weekly' ? '' : 'none';
    document.getElementById('mr-f-interval-row').style.display = e.target.value === 'interval' ? '' : 'none';
    document.getElementById('mr-f-monthly-row').style.display = e.target.value === 'monthly' ? '' : 'none';
    document.getElementById('mr-f-yearly-row').style.display = e.target.value === 'yearly' ? '' : 'none';
  });
  if (document.getElementById('mr-f-monthly-mode')) {
    document.getElementById('mr-f-monthly-mode').addEventListener('change', (e) => {
      document.getElementById('mr-f-monthly-dayofmonth-row').style.display = e.target.value === 'dayOfMonth' ? '' : 'none';
      document.getElementById('mr-f-monthly-nthweekday-row').style.display = e.target.value === 'nthWeekday' ? '' : 'none';
    });
  }
  if (document.getElementById('mr-f-yearly-mode')) {
    document.getElementById('mr-f-yearly-mode').addEventListener('change', (e) => {
      document.getElementById('mr-f-yearly-date-row').style.display = e.target.value === 'date' ? '' : 'none';
      document.getElementById('mr-f-yearly-nthweekday-row').style.display = e.target.value === 'nthWeekday' ? '' : 'none';
    });
  }
  document.getElementById('mr-f-end-type').addEventListener('change', (e) => {
    document.getElementById('mr-f-end-date-row').style.display = e.target.value === 'onDate' ? '' : 'none';
    document.getElementById('mr-f-end-count-row').style.display = e.target.value === 'afterCount' ? '' : 'none';
  });
  body.querySelectorAll('.mr-dow-btn').forEach(btn => btn.addEventListener('click', () => btn.classList.toggle('active')));
  body.querySelectorAll('.mr-icontype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.mr-icontype-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'transparent';
        b.style.color = active ? '#fff' : '#a8b2c4';
      });
      document.getElementById('mr-f-icon-emoji-row').style.display = btn.dataset.icontype === 'emoji' ? '' : 'none';
      document.getElementById('mr-f-icon-text-row').style.display = btn.dataset.icontype === 'text' ? '' : 'none';
      document.getElementById('mr-f-icon-image-row').style.display = btn.dataset.icontype === 'image' ? '' : 'none';
    });
  });
  document.getElementById('mr-f-icon-upload-btn').addEventListener('click', () => document.getElementById('mr-f-icon-file').click());
  document.getElementById('mr-f-icon-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/reminders/icon-image', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) { alert('Upload failed: ' + data.error); return; }
      _mrPendingIconImage = data.filename;
      document.getElementById('mr-f-icon-preview').style.backgroundImage = `url('/uploads/${data.filename}')`;
      document.getElementById('mr-f-icon-upload-btn').textContent = 'Replace image';
    } catch { alert('Upload failed — check the connection and try again.'); }
  });
  document.getElementById('mr-f-cancel').addEventListener('click', renderManageRemindersList);
  document.getElementById('mr-f-save').addEventListener('click', saveReminderForm);
}
async function saveReminderForm() {
  const name = document.getElementById('mr-f-name').value.trim();
  const activeTypeBtn = document.querySelector('.mr-icontype-btn.active');
  const iconType = activeTypeBtn ? activeTypeBtn.dataset.icontype : 'emoji';
  let icon;
  if (iconType === 'text') {
    icon = document.getElementById('mr-f-icon-text').value.trim();
    if (!icon) { alert('Enter a short text label, or switch to Emoji/Image.'); return; }
  } else if (iconType === 'image') {
    if (!_mrPendingIconImage) { alert('Choose an image first, or switch to Emoji/Text.'); return; }
    icon = null;
  } else {
    icon = document.getElementById('mr-f-icon').value.trim() || '📌';
  }
  const scheduleType = document.getElementById('mr-f-type').value;
  if (!name) { alert('Give this reminder a name first.'); return; }
  const startDate = document.getElementById('mr-f-start-date').value;
  let scheduleConfig;
  if (scheduleType === 'weekly') {
    const days = [...document.querySelectorAll('.mr-dow-btn.active')].map(b => parseInt(b.dataset.dow, 10));
    if (!days.length) { alert('Pick at least one day of the week.'); return; }
    const weekInterval = parseInt(document.getElementById('mr-f-week-interval').value, 10) || 1;
    scheduleConfig = { daysOfWeek: days, weekInterval, startDate };
  } else if (scheduleType === 'interval') {
    const intervalDays = parseInt(document.getElementById('mr-f-interval-days').value, 10);
    if (!intervalDays || intervalDays < 1 || !startDate) { alert('Fill in both the interval and start date.'); return; }
    scheduleConfig = { intervalDays, startDate };
  } else if (scheduleType === 'monthly') {
    const monthInterval = parseInt(document.getElementById('mr-f-month-interval').value, 10) || 1;
    const monthlyMode = document.getElementById('mr-f-monthly-mode').value;
    if (!startDate) { alert('Pick a start date.'); return; }
    scheduleConfig = { monthlyMode, monthInterval, startDate };
    if (monthlyMode === 'dayOfMonth') {
      const dayOfMonth = parseInt(document.getElementById('mr-f-day-of-month').value, 10);
      if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) { alert('Pick a valid day of the month.'); return; }
      scheduleConfig.dayOfMonth = dayOfMonth;
    } else {
      scheduleConfig.nthWeek = parseInt(document.getElementById('mr-f-nth-week').value, 10);
      scheduleConfig.nthWeekday = parseInt(document.getElementById('mr-f-nth-weekday').value, 10);
    }
  } else { // yearly
    const yearInterval = parseInt(document.getElementById('mr-f-year-interval').value, 10) || 1;
    const yearlyMonth = parseInt(document.getElementById('mr-f-yearly-month').value, 10);
    const yearlyMode = document.getElementById('mr-f-yearly-mode').value;
    if (!startDate) { alert('Pick a start date.'); return; }
    scheduleConfig = { yearlyMode, yearlyMonth, yearInterval, startDate };
    if (yearlyMode === 'date') {
      const yearlyDay = parseInt(document.getElementById('mr-f-yearly-day').value, 10);
      if (!yearlyDay || yearlyDay < 1 || yearlyDay > 31) { alert('Pick a valid day.'); return; }
      scheduleConfig.yearlyDay = yearlyDay;
    } else {
      scheduleConfig.yearlyNthWeek = parseInt(document.getElementById('mr-f-yearly-nth-week').value, 10);
      scheduleConfig.yearlyNthWeekday = parseInt(document.getElementById('mr-f-yearly-nth-weekday').value, 10);
    }
  }
  const endType = document.getElementById('mr-f-end-type').value;
  scheduleConfig.endType = endType;
  if (endType === 'onDate') {
    const endDate = document.getElementById('mr-f-end-date').value;
    if (!endDate) { alert('Pick an end date.'); return; }
    scheduleConfig.endDate = endDate;
  } else if (endType === 'afterCount') {
    const endCount = parseInt(document.getElementById('mr-f-end-count').value, 10);
    if (!endCount || endCount < 1) { alert('Enter how many times it should repeat.'); return; }
    scheduleConfig.endCount = endCount;
  }
  const payload = {
    name, icon, icon_type: iconType,
    icon_image: iconType === 'image' ? _mrPendingIconImage : undefined,
    schedule_type: scheduleType, schedule_config: scheduleConfig,
  };
  const saveBtn = document.getElementById('mr-f-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try {
    if (_manageRemindersEditingId) {
      await fetch(`/api/reminders/${_manageRemindersEditingId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    } else {
      await fetch('/api/reminders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    }
    await fetchReminders();
    renderManageRemindersList();
    renderLayout();
  } catch {
    alert('Could not save — check the connection and try again.');
    saveBtn.disabled = false; saveBtn.textContent = 'Save';
  }
}
(function wireManageRemindersPanelOnce() {
  const closeBtn = document.getElementById('manage-reminders-close');
  if (closeBtn) closeBtn.addEventListener('click', closeManageRemindersPanel);
})();


function renderNewsAdvancedSettings(w) {
  const fontPx = w.newsFontPx || 13;
  const maxItems = w.newsMaxItems || 8;
  return `
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="news-font-range" min="8" max="48" step="1" value="${fontPx}">
        <span class="was-range-val" id="news-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Headlines to Show</label>
      <div class="was-range-row">
        <input type="range" id="news-max-range" min="3" max="15" step="1" value="${maxItems}">
        <span class="was-range-val" id="news-max-val">${maxItems}</span>
      </div>
    </div>
    <p class="was-hint">Top general headlines, refreshed about every 15 minutes.</p>
  `;
}
function wireNewsAdvancedSettings(w) {
  const fontRange = document.getElementById('news-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.newsFontPx = parseInt(e.target.value, 10);
    document.getElementById('news-font-val').textContent = w.newsFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const maxRange = document.getElementById('news-max-range');
  if (maxRange) maxRange.addEventListener('input', (e) => {
    w.newsMaxItems = parseInt(e.target.value, 10);
    document.getElementById('news-max-val').textContent = w.newsMaxItems;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderStocksAdvancedSettings(w) {
  const fontPx = w.stockFontPx || 14;
  const tickers = Array.isArray(w.stockTickers) ? w.stockTickers : [];
  return `
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="stock-font-range" min="8" max="96" step="1" value="${fontPx}">
        <span class="was-range-val" id="stock-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Show Indices</label>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
        <div class="was-toggle-row" style="margin-bottom:0">
          <label>Dow Jones</label>
          <input type="checkbox" id="stock-show-dow" ${w.hideDow ? '' : 'checked'}>
        </div>
        <div class="was-toggle-row" style="margin-bottom:0">
          <label>Nasdaq</label>
          <input type="checkbox" id="stock-show-nasdaq" ${w.hideNasdaq ? '' : 'checked'}>
        </div>
        <div class="was-toggle-row" style="margin-bottom:0">
          <label>S&amp;P 500</label>
          <input type="checkbox" id="stock-show-sp" ${w.hideSP ? '' : 'checked'}>
        </div>
      </div>
      <p class="was-hint" style="margin-bottom:0">Uncheck any index to hide it.</p>
    </div>
    <div class="was-box">
      <label style="display:block;font-size:13px;color:rgba(255,255,255,0.75);margin-bottom:8px">Tickers to Track</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="stock-ticker-input" placeholder="e.g. AAPL or BTC-USD" style="flex:1;text-transform:uppercase" autocomplete="off">
        <button type="button" id="stock-ticker-add-btn" class="was-inline-btn">Add</button>
      </div>
      <div id="stock-ticker-chips" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${tickers.length ? '' : `<span class="was-hint" style="margin:0">No custom tickers added yet.</span>`}
      </div>
      <p class="was-hint" style="margin:10px 0 6px">Quick-add crypto:</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${[['BTC-USD','₿ Bitcoin'],['ETH-USD','Ethereum'],['SOL-USD','Solana'],['DOGE-USD','Dogecoin']].map(([sym,lbl]) => `
          <button type="button" class="was-ticker-quickadd" data-sym="${sym}">${lbl}</button>
        `).join('')}
      </div>
      <p class="was-hint">Add stock tickers (e.g. AAPL, TSLA) or crypto pairs (e.g. BTC-USD, ETH-USD) — both show together on this widget, crypto tagged separately. This is per-widget: other Stock widgets on your displays track their own separate list.</p>
    </div>
  `;
}
function wireStocksAdvancedSettings(w) {
  const fontRange = document.getElementById('stock-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.stockFontPx = parseInt(e.target.value, 10);
    document.getElementById('stock-font-val').textContent = w.stockFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showDow = document.getElementById('stock-show-dow');
  if (showDow) showDow.addEventListener('change', (e) => {
    w.hideDow = !e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showNasdaq = document.getElementById('stock-show-nasdaq');
  if (showNasdaq) showNasdaq.addEventListener('change', (e) => {
    w.hideNasdaq = !e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const showSP = document.getElementById('stock-show-sp');
  if (showSP) showSP.addEventListener('change', (e) => {
    w.hideSP = !e.target.checked;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });

  // ── Ticker chips (per-widget, moved in from the old device-wide Data
  // Sources setting — see fetchStocks()/renderStocks() in this file for the
  // fetch-union/render-filter halves of this) ──────────────────────────────
  if (!Array.isArray(w.stockTickers)) w.stockTickers = [];
  const chipsEl = document.getElementById('stock-ticker-chips');
  const renderChips = () => {
    if (!chipsEl) return;
    if (!w.stockTickers.length) {
      chipsEl.innerHTML = `<span class="was-hint" style="margin:0">No custom tickers added yet.</span>`;
      return;
    }
    chipsEl.innerHTML = w.stockTickers.map(t => `
      <span class="was-ticker-chip">${t}<button type="button" class="stock-ticker-remove-btn" data-ticker="${t}">×</button></span>
    `).join('');
    chipsEl.querySelectorAll('.stock-ticker-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        w.stockTickers = w.stockTickers.filter(t => t !== btn.dataset.ticker);
        renderChips();
        rerenderSingleWidget(w.id);
        scheduleLayoutSave();
      });
    });
  };
  const addTicker = (val) => {
    val = (val || '').trim().toUpperCase();
    if (!val || w.stockTickers.includes(val)) return;
    w.stockTickers.push(val);
    renderChips();
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  };
  const tickerInput = document.getElementById('stock-ticker-input');
  const addBtn = document.getElementById('stock-ticker-add-btn');
  if (addBtn) addBtn.addEventListener('click', () => { addTicker(tickerInput.value); tickerInput.value = ''; });
  if (tickerInput) tickerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTicker(tickerInput.value); tickerInput.value = ''; }
  });
  document.querySelectorAll('.was-ticker-quickadd').forEach(btn => {
    btn.addEventListener('click', () => addTicker(btn.dataset.sym));
  });
}

function renderTravelAdvancedSettings(w) {
  const fontPx = w.travelFontPx || 18;
  return `
    <div class="was-row">
      <label>Label</label>
      <input type="text" id="tv-label" value="${escapeHtmlD(w.travelLabel||'Travel Time')}" placeholder="e.g. To Work">
    </div>
    <div class="was-row">
      <label>From</label>
      <input type="text" id="tv-origin" value="${escapeHtmlD(w.travelOrigin||'')}" placeholder="e.g. Home, or a full address">
    </div>
    <div class="was-row">
      <label>To</label>
      <input type="text" id="tv-destination" value="${escapeHtmlD(w.travelDestination||'')}" placeholder="e.g. 123 Main St, Columbus, OH">
    </div>
    <div class="was-row">
      <label>Mode</label>
      <select id="tv-mode">
        <option value="driving"   ${(!w.travelMode||w.travelMode==='driving')?'selected':''}>🚗 Driving</option>
        <option value="walking"   ${w.travelMode==='walking'?'selected':''}>🚶 Walking</option>
        <option value="bicycling" ${w.travelMode==='bicycling'?'selected':''}>🚴 Bicycling</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="tv-font-range" min="8" max="72" step="1" value="${fontPx}">
        <span class="was-range-val" id="tv-font-val">${fontPx}px</span>
      </div>
    </div>
    <p class="was-hint">Uses free road-network routing by default (no live traffic). For traffic-aware times, add a Google Maps API key in the app's Settings → Travel Time.</p>
  `;
}
function wireTravelAdvancedSettings(w) {
  const labelInput = document.getElementById('tv-label');
  if (labelInput) labelInput.addEventListener('input', (e) => {
    w.travelLabel = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  // Origin/destination need a fresh fetch once someone's actually done typing
  // (blur), same restraint as the METAR ICAO field and the weather ZIP
  // lookup — a new address has no route data cached for it yet.
  const refetchIfReady = async () => {
    if (w.travelOrigin && w.travelDestination) {
      await fetchTravelTimes();
      rerenderSingleWidget(w.id);
    }
  };
  const originInput = document.getElementById('tv-origin');
  if (originInput) {
    originInput.addEventListener('input', (e) => { w.travelOrigin = e.target.value; scheduleLayoutSave(); });
    originInput.addEventListener('blur', refetchIfReady);
  }
  const destInput = document.getElementById('tv-destination');
  if (destInput) {
    destInput.addEventListener('input', (e) => { w.travelDestination = e.target.value; scheduleLayoutSave(); });
    destInput.addEventListener('blur', refetchIfReady);
  }
  const modeSel = document.getElementById('tv-mode');
  if (modeSel) modeSel.addEventListener('change', async (e) => {
    w.travelMode = e.target.value;
    scheduleLayoutSave();
    await refetchIfReady(); // travel mode changes the route itself, not just display — needs a real re-fetch, not just a re-render
  });
  const fontRange = document.getElementById('tv-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.travelFontPx = parseInt(e.target.value, 10);
    document.getElementById('tv-font-val').textContent = w.travelFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderSportsAdvancedSettings(w) {
  const fontPx = w.spFontPx || 16;
  const teamRow = w.spTeamId ? `
    <div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:10px">
      ${w.spTeamBadge ? `<img src="${escapeHtmlD(w.spTeamBadge)}" style="width:36px;height:36px;object-fit:contain">` : ''}
      <div style="flex:1"><b>${escapeHtmlD(w.spTeamName||'')}</b></div>
      <button type="button" id="sp-change-btn" class="was-inline-btn" style="height:36px;padding:0 14px">Change</button>
    </div>
  ` : `
    <div style="display:flex;gap:8px">
      <input type="text" id="sp-search-input" placeholder="e.g. Kansas City Chiefs" style="flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:8px;color:#e8edf5;padding:11px 12px;font-size:14px">
      <button type="button" id="sp-search-btn" class="was-inline-btn">Search</button>
    </div>
  `;
  return `
    <div class="was-row">
      <label>Team</label>
      ${teamRow}
      <div id="sp-results" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>
    </div>
    <div class="was-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="sp-font-range" min="8" max="64" step="1" value="${fontPx}">
        <span class="was-range-val" id="sp-font-val">${fontPx}px</span>
      </div>
    </div>
    <p class="was-hint">Shows the next scheduled game and the most recent final score. Real-time in-play score updates aren't available on the free data source this uses.</p>
  `;
}
function wireSportsAdvancedSettings(w) {
  const fontRange = document.getElementById('sp-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.spFontPx = parseInt(e.target.value, 10);
    document.getElementById('sp-font-val').textContent = w.spFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const renderResults = (teams) => {
    const box = document.getElementById('sp-results');
    if (!box) return;
    if (!teams.length) { box.innerHTML = `<p class="was-hint">No teams found — try a different spelling.</p>`; return; }
    box.innerHTML = teams.map(t => `
      <button type="button" class="sp-result-pick" data-id="${t.id}" data-name="${escapeHtmlD(t.name)}" data-badge="${escapeHtmlD(t.badge||'')}"
        style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:8px 10px;cursor:pointer;text-align:left;width:100%;color:#e8edf5">
        ${t.badge ? `<img src="${escapeHtmlD(t.badge)}" style="width:30px;height:30px;object-fit:contain">` : '<span style="width:30px"></span>'}
        <span style="flex:1"><b>${escapeHtmlD(t.name)}</b><br><span style="font-size:11px;opacity:0.6">${escapeHtmlD(t.sport)}${t.league ? ' · ' + escapeHtmlD(t.league) : ''}</span></span>
      </button>`).join('');
    box.querySelectorAll('.sp-result-pick').forEach(btn => btn.addEventListener('click', async () => {
      w.spTeamId = btn.dataset.id;
      w.spTeamName = btn.dataset.name;
      w.spTeamBadge = btn.dataset.badge || null;
      scheduleLayoutSave();
      await fetchSports(); // this team's game data isn't cached under any id yet
      rerenderSingleWidget(w.id);
      openWidgetAdvancedPanel(w.id); // switches the panel from search UI to the "current team" row
    }));
  };
  const doSearch = async () => {
    const input = document.getElementById('sp-search-input');
    const q = input ? input.value.trim() : '';
    const box = document.getElementById('sp-results');
    if (!q || !box) return;
    box.innerHTML = `<p class="was-hint">Searching…</p>`;
    try {
      const r = await (await fetch(`/api/sports/search-team?q=${encodeURIComponent(q)}`)).json();
      renderResults(r.teams || []);
    } catch { box.innerHTML = `<p class="was-hint">❌ Search failed.</p>`; }
  };
  const searchBtn = document.getElementById('sp-search-btn');
  if (searchBtn) searchBtn.addEventListener('click', doSearch);
  const searchInput = document.getElementById('sp-search-input');
  if (searchInput) searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  const changeBtn = document.getElementById('sp-change-btn');
  if (changeBtn) changeBtn.addEventListener('click', () => {
    w.spTeamId = null; w.spTeamName = null; w.spTeamBadge = null;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id); // switches the panel back to the search UI
  });
}

function renderTextAdvancedSettings(w) {
  const preset = w.textPreset || 'plain';
  const fontPx = w.textFontPx || 28;
  const align = w.textAlign || 'left';
  const weight = w.textWeight || 'normal';
  const fontFamily = w.textFontFamily || 'Inter';
  const fontOpt = (val, lbl) => `<option value="${val}" ${fontFamily===val?'selected':''}>${lbl}</option>`;
  // Same font list as app.html's own editor, grouped the same way — a
  // person switching between editing on their phone and on the display
  // should see the identical set of choices either place.
  return `
    <div class="was-row">
      <label>Text</label>
      <textarea id="text-content" rows="3" placeholder="Type anything…" style="width:100%;box-sizing:border-box;resize:vertical;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);border-radius:8px;color:#e8edf5;padding:11px 12px;font-size:14px;font-family:inherit">${(w.textContent||'').replace(/</g,'&lt;')}</textarea>
    </div>
    <div class="was-row">
      <label>Style Preset ${infoBtn("A starting style — you can still fine-tune font, size, weight, and alignment below.")}</label>
      <select id="text-preset">
        <option value="plain"   ${preset==='plain'?'selected':''}>Plain text</option>
        <option value="heading" ${preset==='heading'?'selected':''}>Heading (large, bold)</option>
        <option value="label"   ${preset==='label'?'selected':''}>Label (small, uppercase)</option>
      </select>
    </div>
    <div class="was-row">
      <label>Font</label>
      <select id="text-font-family">
        <optgroup label="Clean / Sans">
          ${fontOpt('Inter','Inter')}
          ${fontOpt('Montserrat','Montserrat')}
          ${fontOpt('Oswald','Oswald')}
          ${fontOpt('Bebas Neue','Bebas Neue')}
        </optgroup>
        <optgroup label="Classic / Serif">
          ${fontOpt('Playfair Display','Playfair Display')}
          ${fontOpt('Merriweather','Merriweather')}
          ${fontOpt('Georgia','Georgia')}
        </optgroup>
        <optgroup label="Cursive / Fancy">
          ${fontOpt('Dancing Script','Dancing Script (cursive)')}
          ${fontOpt('Pacifico','Pacifico (fun script)')}
          ${fontOpt('Great Vibes','Great Vibes (elegant)')}
          ${fontOpt('Sacramento','Sacramento (delicate)')}
          ${fontOpt('Satisfy','Satisfy (casual)')}
          ${fontOpt('Caveat','Caveat (handwritten)')}
        </optgroup>
        <optgroup label="Playful / Display">
          ${fontOpt('Lobster','Lobster')}
          ${fontOpt('Comfortaa','Comfortaa')}
          ${fontOpt('Righteous','Righteous')}
        </optgroup>
      </select>
      <div id="text-font-sample" style="margin-top:8px;padding:10px 12px;border:1px dashed rgba(255,255,255,0.2);border-radius:8px;font-size:22px;color:#e8edf5;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">The quick brown fox 123</div>
    </div>
    <div class="was-row" id="text-font-row">
      <label>Font Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="text-font-range" min="10" max="480" step="2" value="${fontPx}">
        <span class="was-range-val" id="text-font-val">${fontPx}px</span>
      </div>
      <p class="was-hint">Goes up to very large for big headline text.</p>
    </div>
    <div class="was-row">
      <label>Weight</label>
      <select id="text-weight">
        <option value="normal" ${weight==='normal'?'selected':''}>Normal</option>
        <option value="500"    ${weight==='500'?'selected':''}>Medium</option>
        <option value="bold"   ${weight==='bold'?'selected':''}>Bold</option>
      </select>
    </div>
    <div class="was-row">
      <label>Alignment ${infoBtn("Tip: drag the widget's corner handles to resize the box — the text scales with your chosen size, and the box grows to fit.")}</label>
      <select id="text-align">
        <option value="left"   ${align==='left'?'selected':''}>Left</option>
        <option value="center" ${align==='center'?'selected':''}>Center</option>
        <option value="right"  ${align==='right'?'selected':''}>Right</option>
      </select>
    </div>
  `;
}
function wireTextAdvancedSettings(w) {
  const contentInput = document.getElementById('text-content');
  if (contentInput) contentInput.addEventListener('input', (e) => {
    w.textContent = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const presetSel = document.getElementById('text-preset');
  if (presetSel) presetSel.addEventListener('change', (e) => {
    w.textPreset = e.target.value;
    // Apply the same sensible per-preset defaults app.html's own editor does.
    if (w.textPreset === 'heading') { w.textFontPx = 48; w.textWeight = 'bold'; }
    else if (w.textPreset === 'label') { w.textFontPx = 16; w.textWeight = '500'; }
    else { w.textFontPx = 28; w.textWeight = 'normal'; }
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
    openWidgetAdvancedPanel(w.id); // refresh the size/weight controls to match
  });
  const fontFamilySel = document.getElementById('text-font-family');
  if (fontFamilySel) {
    const applySample = () => {
      const sample = document.getElementById('text-font-sample');
      if (sample) sample.style.fontFamily = cssFontStack(w.textFontFamily || 'Inter');
    };
    ensureWebFont(w.textFontFamily || 'Inter');
    applySample();
    fontFamilySel.addEventListener('change', (e) => {
      w.textFontFamily = e.target.value;
      ensureWebFont(w.textFontFamily);
      applySample();
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
    });
  }
  const fontRange = document.getElementById('text-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.textFontPx = parseInt(e.target.value, 10);
    document.getElementById('text-font-val').textContent = w.textFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const weightSel = document.getElementById('text-weight');
  if (weightSel) weightSel.addEventListener('change', (e) => {
    w.textWeight = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const alignSel = document.getElementById('text-align');
  if (alignSel) alignSel.addEventListener('change', (e) => {
    w.textAlign = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

function renderDecorationAdvancedSettings(w) {
  const emoji = w.decorEmoji || '🌿';
  const fontPx = w.decorFontPx || 60;
  const opacity = w.decorOpacity ?? 100;
  const rotation = w.decorRotation || 0;
  const quickPicks = ['🌿','🪴','🌱','🍃','🌵','🌴','🍀','🌸','🌼','🌻','🍁','🦋','⭐','✨','💫','🎈','🎉','☀️','🌙','☁️','❤️','🐝','🌈','🔥'];
  return `
    <div class="was-row">
      <label>Quick Pick</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
        ${quickPicks.map(e => `<button type="button" class="decor-quickpick" data-emoji="${e}" style="font-size:22px;width:40px;height:40px;border-radius:8px;border:1px solid ${e===emoji?'var(--accent, #4A90D9)':'rgba(255,255,255,0.18)'};background:${e===emoji?'rgba(74,144,217,0.15)':'rgba(255,255,255,0.05)'};cursor:pointer">${e}</button>`).join('')}
      </div>
    </div>
    <div class="was-row">
      <label>Or Type Any Emoji</label>
      <input type="text" id="decor-emoji-input" value="${escapeHtmlD(emoji)}" maxlength="8" placeholder="🌿">
    </div>
    <div class="was-row">
      <label>Size (px)</label>
      <div class="was-range-row">
        <input type="range" id="decor-font-range" min="16" max="300" step="2" value="${fontPx}">
        <span class="was-range-val" id="decor-font-val">${fontPx}px</span>
      </div>
    </div>
    <div class="was-row">
      <label>Opacity ${infoBtn("Lower for a subtle watermark-style touch instead of a bold graphic.")}</label>
      <div class="was-range-row">
        <input type="range" id="decor-opacity-range" min="10" max="100" step="5" value="${opacity}">
        <span class="was-range-val" id="decor-opacity-val">${opacity}%</span>
      </div>
    </div>
    <div class="was-row">
      <label>Rotation ${infoBtn("A slight tilt can help it read like a placed sticker rather than a perfectly centered icon.")}</label>
      <div class="was-range-row">
        <input type="range" id="decor-rotation-range" min="-45" max="45" step="1" value="${rotation}">
        <span class="was-range-val" id="decor-rotation-val">${rotation}°</span>
      </div>
    </div>
  `;
}
function wireDecorationAdvancedSettings(w) {
  document.querySelectorAll('.decor-quickpick').forEach(btn => {
    btn.addEventListener('click', () => {
      w.decorEmoji = btn.dataset.emoji;
      rerenderSingleWidget(w.id);
      scheduleLayoutSave();
      openWidgetAdvancedPanel(w.id); // refresh so the newly-picked swatch shows highlighted
    });
  });
  const emojiInput = document.getElementById('decor-emoji-input');
  if (emojiInput) emojiInput.addEventListener('input', (e) => {
    w.decorEmoji = e.target.value;
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const fontRange = document.getElementById('decor-font-range');
  if (fontRange) fontRange.addEventListener('input', (e) => {
    w.decorFontPx = parseInt(e.target.value, 10);
    document.getElementById('decor-font-val').textContent = w.decorFontPx + 'px';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const opacityRange = document.getElementById('decor-opacity-range');
  if (opacityRange) opacityRange.addEventListener('input', (e) => {
    w.decorOpacity = parseInt(e.target.value, 10);
    document.getElementById('decor-opacity-val').textContent = w.decorOpacity + '%';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
  const rotationRange = document.getElementById('decor-rotation-range');
  if (rotationRange) rotationRange.addEventListener('input', (e) => {
    w.decorRotation = parseInt(e.target.value, 10);
    document.getElementById('decor-rotation-val').textContent = w.decorRotation + '°';
    rerenderSingleWidget(w.id);
    scheduleLayoutSave();
  });
}

