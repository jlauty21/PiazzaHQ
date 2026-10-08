function drawWidgetSettingsPanel_Build_clock(_c) {
  const { w, _st } = _c;
    const fontPx = w.clockFontPx || 90;
    const timeFormat = w.clockTimeFormat || 'default';
    const clockStyle = w.clockStyle || 'digital';
    const analogStyle = w.analogStyle || 'line';
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Style</label>
        <select class="form-input" id="clock-style">
          <option value="digital" ${clockStyle==='digital'?'selected':''}>Digital</option>
          <option value="analog" ${clockStyle==='analog'?'selected':''}>Analog</option>
        </select>
      </div>
      <div class="settings-row" id="clock-analog-style-row" style="${clockStyle === 'analog' ? '' : 'display:none'}">
        <label>Face</label>
        <select class="form-input" id="clock-analog-style">
          <option value="line" ${analogStyle==='line'?'selected':''}>Minimalist Line</option>
          <option value="aviation" ${analogStyle==='aviation'?'selected':''}>Aviation Chronograph</option>
          <option value="brass" ${analogStyle==='brass'?'selected':''}>Warm Brass</option>
          <option value="bold" ${analogStyle==='bold'?'selected':''}>Bold Modern</option>
        </select>
      </div>
      <div class="settings-row" id="clock-font-row">
        <label>${clockStyle === 'analog' ? 'Size (px)' : 'Font Size (px)'}</label>
        <div class="range-row">
          <input type="range" id="clock-font-range" min="30" max="400" step="2" value="${fontPx}">
          <span class="range-val" id="clock-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row" id="clock-time-format-row" style="${clockStyle === 'analog' ? 'display:none' : ''}">
        <label>Time Format</label>
        <select class="form-input" id="clock-time-format">
          <option value="default" ${timeFormat==='default'?'selected':''}>Use display setting</option>
          <option value="12" ${timeFormat==='12'?'selected':''}>12-hour (2:30 PM)</option>
          <option value="24" ${timeFormat==='24'?'selected':''}>24-hour (14:30)</option>
        </select>
      </div>
      <div class="settings-row" id="clock-ampm-case-row" style="${clockStyle === 'analog' ? 'display:none' : ''}">
        <label>AM/PM Style</label>
        <select class="form-input" id="clock-ampm-case">
          <option value="default" ${(w.clockAmpmCase||'default')==='default'?'selected':''}>Use display setting</option>
          <option value="lower" ${w.clockAmpmCase==='lower'?'selected':''}>Lowercase (2:30 pm)</option>
          <option value="upper" ${w.clockAmpmCase==='upper'?'selected':''}>Uppercase (2:30 PM)</option>
        </select>
      </div>
    `;
}

async function drawWidgetSettingsPanel_Build_datetime(_c) {
  const { w, _st } = _c;
    const fontPx = w.dtFontPx || 70;
    const dtStyle = w.dtStyle || 'classic';
    const timeFormat = w.dtTimeFormat || 'default';
    const dtDateSettings = await apiFetch('/api/settings');
    const dtGlobalDateLabel = DATE_FORMAT_LABELS[(dtDateSettings && dtDateSettings.date_format) || 'us_long'];
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Style</label>
        <select class="form-input" id="dt-style-select">
          <option value="classic" ${dtStyle==='classic'?'selected':''}>Classic (stacked)</option>
          <option value="split" ${dtStyle==='split'?'selected':''}>Split (side by side)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Alignment</label>
        <select class="form-input" id="dt-align-select">
          <option value="left" ${(w.dtAlign||'left')==='left'?'selected':''}>Left</option>
          <option value="right" ${w.dtAlign==='right'?'selected':''}>Right</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="dt-font-range" min="20" max="300" step="2" value="${fontPx}">
          <span class="range-val" id="dt-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Per-Item Font Sizes ${infoBtn("Each item defaults to a proportional share of the Font Size above. Drag any of these off 0 to size that one item independently instead — set it back to 0 (Auto) to return it to proportional.")}</label>
      </div>
      ${dtSizeOverrideRowHtml('dt-time-size', 'Time', w.dtTimeSizePx, 300)}
      ${dtSizeOverrideRowHtml('dt-seconds-size', 'Seconds', w.dtSecondsSizePx, 200)}
      ${dtSizeOverrideRowHtml('dt-ampm-size', 'AM/PM', w.dtAmpmSizePx, 200)}
      ${dtSizeOverrideRowHtml('dt-day-size', 'Day Name', w.dtDaySizePx, 200)}
      ${dtSizeOverrideRowHtml('dt-date-size', 'Date', w.dtDateSizePx, 200)}
      ${dtSizeOverrideRowHtml('dt-temp-size', 'Temperature', w.dtTempSizePx, 200)}
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Seconds</label>
        <input type="checkbox" id="dt-show-seconds" ${w.dtShowSeconds?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Date</label>
        <input type="checkbox" id="dt-show-date" ${w.dtShowDate !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Temperature ${infoBtn("Pulls from this display's Weather settings — same location/unit any Weather widget uses. Shows a loading dot until the first weather fetch completes.")}</label>
        <input type="checkbox" id="dt-show-temp" ${w.dtShowTemp?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-8px">Temperature uses this display's Weather settings — same location/unit any Weather widget uses.</p>
      <div class="settings-row">
        <label>Time Format</label>
        <select class="form-input" id="dt-time-format">
          <option value="default" ${timeFormat==='default'?'selected':''}>Use display setting</option>
          <option value="12" ${timeFormat==='12'?'selected':''}>12-hour (2:30 PM)</option>
          <option value="24" ${timeFormat==='24'?'selected':''}>24-hour (14:30)</option>
        </select>
      </div>
      ${ampmCaseOverrideRowHtml('dt-ampm-case-select', w.dtAmpmCase)}
      ${dateFormatOverrideRowHtml('dt-date-format-select', w.dtDateFormat, dtGlobalDateLabel)}
    `;
}

function drawWidgetSettingsPanel_Build_messageboard(_c) {
  const { w, _st } = _c;
    const mbFontPx = w.mbFontPx || 14;
    const mbMaxNotes = Number.isFinite(w.mbMaxNotes) && w.mbMaxNotes > 0 ? w.mbMaxNotes : 8;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="mb-font-range" min="10" max="40" step="1" value="${mbFontPx}">
          <span class="range-val" id="mb-font-val">${mbFontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Max notes shown</label>
        <div class="range-row">
          <input type="range" id="mb-max-range" min="1" max="20" step="1" value="${mbMaxNotes}">
          <span class="range-val" id="mb-max-val">${mbMaxNotes}</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show author</label>
        <input type="checkbox" id="mb-show-author" ${w.mbShowAuthor!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show time</label>
        <input type="checkbox" id="mb-show-time" ${w.mbShowTime!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">Notes are shared across every Message Board widget and the Family Hub Board tab — post or clear one anywhere, it updates everywhere.</p>
    `;
}

async function drawWidgetSettingsPanel_Build_mealplan(_c) {
  const { w, _st } = _c;
    const mpDays = Math.max(3, Math.min(14, Number(w.mpDays) || 7));
    const mpFontPx = w.mpFontPx || 15;
    let mpSettings = {};
    try { mpSettings = await apiFetch('/api/settings'); } catch {}
    const householdSlots = mpParseSlots(mpSettings && mpSettings.mealplan_slots);
    const activeSlots = (Array.isArray(w.mpSlots) && w.mpSlots.length)
      ? MP_SLOTS.filter(s => w.mpSlots.includes(s))
      : householdSlots;
    const slotChecks = MP_SLOTS.map(s =>
      `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;cursor:pointer">
        <input type="checkbox" class="mp-slot-cb" value="${s}" ${activeSlots.includes(s) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
        ${MP_SLOT_NAME[s]}
      </label>`).join('');
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Meals shown</label>
        <div style="display:flex;flex-wrap:wrap">${slotChecks}</div>
        <p style="font-size:11px;color:var(--muted);margin:6px 0 0">Leave matching the household default (${householdSlots.map(s => MP_SLOT_NAME[s]).join(', ')}) to follow it. Change which meals the household plans in the Family Hub → Meals tab.</p>
      </div>
      <div class="settings-row">
        <label>Days shown</label>
        <div class="range-row">
          <input type="range" id="mp-days-range" min="3" max="14" step="1" value="${mpDays}">
          <span class="range-val" id="mp-days-val">${mpDays}</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="mp-font-range" min="10" max="36" step="1" value="${mpFontPx}">
          <span class="range-val" id="mp-font-val">${mpFontPx}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Hide unplanned meals ${infoBtn("Only list days/meals that actually have something planned — drop the ones showing a dash.")}</label>
        <input type="checkbox" id="mp-hide-empty" ${w.mpHideEmpty ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">Meals are shared across every Meal Plan widget and the Family Hub Meals tab — set one anywhere, it shows everywhere.</p>
    `;
}

async function drawWidgetSettingsPanel_Build_flightmap(_c) {
  const { w, _st } = _c;
    // Parallel copy of display.html's renderFlightMapAdvancedSettings — keep in sync.
    const subject = w.fmSubject || 'filter';
    const f = w.fmFilter || {};
    const filterMode = f.mil ? 'mil' : (f.type ? 'type' : (f.squawk ? 'squawk' : (f.airline ? 'airline' : (f.radiusNm ? 'radius' : 'mil'))));
    const trailMin = Math.max(2, Math.min(360, Number(w.fmTrailMin) || 30));
    let fmS = {}; try { fmS = await apiFetch('/api/settings'); } catch {}
    const homeSet = fmS && fmS.weather_lat && fmS.weather_lon;
    let fmProfiles = []; try { fmProfiles = await apiFetch('/api/profiles'); } catch {}
    if (!Array.isArray(fmProfiles)) fmProfiles = [];
    const sel = (v, cur) => v === cur ? 'selected' : '';
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Show</label>
        <select class="form-input" id="fm-subject">
          <option value="filter" ${sel('filter', subject)}>A group of aircraft (filter)</option>
          <option value="flight" ${sel('flight', subject)}>One specific flight</option>
          <option value="watch" ${sel('watch', subject)}>A saved flight (My Flights)</option>
        </select>
      </div>
      <div class="settings-row" id="fm-filter-block" ${subject === 'filter' ? '' : 'style="display:none"'}>
        <label>Which aircraft</label>
        <select class="form-input" id="fm-filter-mode">
          <option value="mil" ${sel('mil', filterMode)}>All military</option>
          <option value="type" ${sel('type', filterMode)}>All of one type (ICAO code)</option>
          <option value="airline" ${sel('airline', filterMode)}>An airline (United, Delta, …)</option>
          <option value="radius" ${sel('radius', filterMode)}>Everything near home</option>
          <option value="squawk" ${sel('squawk', filterMode)}>A squawk code</option>
        </select>
        <div id="fm-type-row" style="margin-top:8px;${filterMode === 'type' ? '' : 'display:none'}">
          <input class="form-input" type="text" id="fm-type" placeholder="e.g. B738, A320" value="${escapeHtml(f.type || '')}">
          <p style="font-size:11px;color:var(--muted);margin-top:4px">ICAO type designator(s), comma-separated for more than one — a Boeing 737-800 is <code>B738</code>, an A320 <code>A320</code>, a C-17 <code>C17</code>.</p>
        </div>
        <div id="fm-airline-row" style="margin-top:8px;${filterMode === 'airline' ? '' : 'display:none'}">
          <input class="form-input" type="text" id="fm-airline" list="fm-airline-list" placeholder="e.g. UAL, DAL, AAL" value="${escapeHtml(f.airline || '')}">
          <datalist id="fm-airline-list">
            <option value="UAL">United</option><option value="DAL">Delta</option><option value="AAL">American</option>
            <option value="SWA">Southwest</option><option value="JBU">JetBlue</option><option value="ASA">Alaska</option>
            <option value="FFT">Frontier</option><option value="NKS">Spirit</option><option value="SKW">SkyWest</option>
            <option value="FDX">FedEx</option><option value="UPS">UPS</option><option value="GTI">Atlas Air</option>
          </datalist>
          <p style="font-size:11px;color:var(--muted);margin-top:4px">ICAO callsign prefix(es), comma-separated. Covers the area around the map centre (radius below) — the ADS-B feed has no global airline query.</p>
        </div>
        <div id="fm-squawk-row" style="margin-top:8px;${filterMode === 'squawk' ? '' : 'display:none'}">
          <input class="form-input" type="text" id="fm-squawk" maxlength="4" placeholder="e.g. 7700" value="${escapeHtml(f.squawk || '')}">
        </div>
        <label id="fm-milonly-row" style="display:${(filterMode === 'mil' || filterMode === 'airline') ? 'none' : 'flex'};align-items:center;gap:8px;margin-top:10px;cursor:pointer">
          <input type="checkbox" id="fm-milonly" ${f.milOnly ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent);flex:0 0 auto">
          <span>Military only ${infoBtn("Drop civil aircraft sharing an ICAO type — e.g. civil aircraft that happen to share an ICAO type with a military variant.")}</span>
        </label>
        <div id="fm-radius-row" style="margin-top:8px;${(filterMode === 'radius' || filterMode === 'airline') ? '' : 'display:none'}">
          <label style="font-size:12px;color:var(--muted)">Search radius</label>
          <div class="range-row">
            <input type="range" id="fm-radius" min="20" max="250" step="10" value="${Math.max(20, Math.min(250, Number(f.radiusNm) || (filterMode === 'airline' ? 250 : 150)))}">
            <span class="range-val" id="fm-radius-val">${Math.max(20, Math.min(250, Number(f.radiusNm) || (filterMode === 'airline' ? 250 : 150)))} nm</span>
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:4px">${homeSet ? 'Around the map centre (or your weather location).' : 'Set your location in Settings → Weather first.'}</p>
        </div>
        <div id="fm-center-row" style="margin-top:10px;${filterMode === 'radius' ? 'display:none' : ''}">
          <label style="font-size:12px;color:var(--muted)">Centre the map on (optional)</label>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <input class="form-input" type="text" id="fm-cplace" placeholder="City, airport, or ZIP" value="${escapeHtml(f.centerLabel || '')}" style="flex:1;min-width:0">
            <button type="button" class="pf-btn ghost" id="fm-cgo" style="flex:0 0 auto;padding:6px 10px">Set</button>
            <button type="button" class="pf-btn ghost" id="fm-chome" style="flex:0 0 auto;padding:6px 10px">Home</button>
            <button type="button" class="pf-btn ghost" id="fm-cclear" style="flex:0 0 auto;padding:6px 10px">Clear</button>
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:4px" id="fm-cplace-hint">${f.centerLat != null && f.centerLon != null && f.centerLat !== '' ? '📍 ' + (f.centerLabel || ((+f.centerLat).toFixed(2) + ', ' + (+f.centerLon).toFixed(2))) : 'Type a place and press Set (or Enter). Blank = a fixed near-hemisphere view.'}</p>
          <!-- Only type/mil/squawk modes use this span — airline/radius modes
               size the view off "Search radius" instead, so this slider would
               silently do nothing there. -->
          <div class="range-row" id="fm-span-row" style="margin-top:6px;${filterMode === 'airline' ? 'display:none' : ''}">
            <input type="range" id="fm-span" min="400" max="6000" step="100" value="${Math.max(400, Math.min(6000, Number(f.spanNm) || 2600))}">
            <span class="range-val" id="fm-span-val">${Math.max(400, Math.min(6000, Number(f.spanNm) || 2600))} nm</span>
          </div>
        </div>
      </div>
      <div class="settings-row" id="fm-flight-block" ${subject === 'flight' ? '' : 'style="display:none"'}>
        <label>Flight</label>
        <div style="display:flex;gap:6px">
          <select class="form-input" id="fm-flight-kind" style="flex:0 0 auto;width:auto">
            <option value="callsign" ${sel('callsign', w.fmFlightKind || 'callsign')}>Callsign</option>
            <option value="reg" ${sel('reg', w.fmFlightKind)}>Tail #</option>
            <option value="hex" ${sel('hex', w.fmFlightKind)}>ICAO hex</option>
          </select>
          <input class="form-input" type="text" id="fm-flight-value" placeholder="e.g. DAL456" value="${escapeHtml(w.fmFlightValue || '')}" style="flex:1">
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:4px">A pilot flies whatever aircraft is on the route — track the day's callsign/flight number, not a fixed tail.</p>
      </div>
      <div class="settings-row" id="fm-watch-block" ${subject === 'watch' ? '' : 'style="display:none"'}>
        <label>Whose flights</label>
        <select class="form-input" id="fm-watch-profile">
          <option value="">Everyone's saved flights</option>
          ${fmProfiles.map(p => `<option value="${p.id}" ${String(w.fmWatchProfileId) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name || 'Profile')}</option>`).join('')}
        </select>
        <p style="font-size:11px;color:var(--muted);margin-top:4px">Add flights under a profile's <strong>My Flights</strong>. This widget follows whichever are active today.</p>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Follow the aircraft ${infoBtn("Keep the map centred on the tracked flight. For a filter, leave this off so the view stays put.")}</label>
        <input type="checkbox" id="fm-follow" ${w.fmFollow ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show the info panel</label>
        <input type="checkbox" id="fm-showdata" ${w.fmShowData !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show trails</label>
        <input type="checkbox" id="fm-showtrails" ${w.fmShowTrails !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Label aircraft ${infoBtn("Show each aircraft's callsign next to it. Auto-hidden when the view is too crowded; the selected one is always labelled.")}</label>
        <input type="checkbox" id="fm-labels" ${w.fmLabels !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show state / province lines</label>
        <input type="checkbox" id="fm-states" ${w.fmStates !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row">
        <label>Trail length</label>
        <div class="range-row">
          <input type="range" id="fm-trail" min="5" max="360" step="5" value="${trailMin}">
          <span class="range-val" id="fm-trail-val">${trailMin >= 60 ? (trailMin / 60).toFixed(trailMin % 60 ? 1 : 0) + ' h' : trailMin + ' min'}</span>
        </div>
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">Positions come from free community ADS-B receivers (airplanes.live, adsb.lol / adsb.fi as backups). Coverage is thin over oceans — an aircraft there shows its last known position.</p>
    `;
}

async function drawWidgetSettingsPanel_Build_camera(_c) {
  const { w, _st } = _c;
    if (_appCamPanelWidgetId !== w.id) { _appCamForm.open = false; _appCamForm.editId = null; _appCamPanelWidgetId = w.id; }
    let cams = [];
    try { cams = await apiFetch('/api/cameras'); } catch {}
    if (!Array.isArray(cams)) cams = [];
    _appCamList = cams;
    const fit = w.camFit === 'cover' ? 'cover' : 'contain';
    const opts = cams.map(c => `<option value="${c.id}" ${String(c.id) === String(w.camId) ? 'selected' : ''}>${escapeHtml(c.name)}${c.kind === 'ha' ? ' (HA)' : ''}</option>`).join('');
    const editing = _appCamForm.editId != null ? cams.find(c => String(c.id) === String(_appCamForm.editId)) : null;
    let haOpts = '';
    if (_appCamForm.open && _appCamForm.source === 'ha') {
      let ents = [];
      try { ents = await apiFetch('/api/ha/entities'); } catch {}
      const cur = editing && editing.kind === 'ha' ? editing.host_hint : '';
      const cameraEnts = (Array.isArray(ents) ? ents : []).filter(e => e.entity_id.startsWith('camera.'));
      haOpts = cameraEnts.length
        ? `<option value="">— choose —</option>` + cameraEnts.map(e => `<option value="${escapeHtml(e.entity_id)}" ${e.entity_id === cur ? 'selected' : ''}>${escapeHtml(e.friendly_name)}</option>`).join('')
        : `<option value="">No camera.* entities — is Home Assistant connected?</option>`;
    }
    const form = _appCamForm.open ? `
      <div class="settings-card" style="padding:12px;margin-top:8px">
        <div class="settings-row"><label>Name</label><input class="form-input" id="cam-f-name" value="${escapeHtml(editing ? editing.name : '')}" placeholder="Driveway"></div>
        <div class="settings-row"><label>Source</label>
          <select class="form-input" id="cam-f-source">
            <option value="url" ${_appCamForm.source === 'url' ? 'selected' : ''}>Direct URL (RTSP / ONVIF / MJPEG)</option>
            <option value="ha" ${_appCamForm.source === 'ha' ? 'selected' : ''}>Home Assistant camera</option>
          </select>
        </div>
        <div class="settings-row" id="cam-f-url-row" style="${_appCamForm.source === 'url' ? '' : 'display:none'}">
          <label>Stream URL</label>
          <input class="form-input" id="cam-f-url" placeholder="rtsp://user:pass@192.168.1.9:554/stream1" value="">
          <p style="font-size:11px;color:var(--muted);margin-top:6px">${editing ? 'Leave blank to keep the saved URL. ' : ''}RTSP / ONVIF / MJPEG — not a browser page. Credentials in the URL stay on the server, never sent to a display.</p>
        </div>
        <div class="settings-row" id="cam-f-ha-row" style="${_appCamForm.source === 'ha' ? '' : 'display:none'}">
          <label>Camera entity</label>
          <select class="form-input" id="cam-f-ha-entity">${haOpts || '<option value="">Loading…</option>'}</select>
        </div>
        <div id="cam-f-error" style="font-size:12px;color:#e5484d;display:none;margin-bottom:8px"></div>
        <div style="display:flex;gap:8px">
          <button type="button" id="cam-f-save" style="flex:1;background:var(--accent);border:none;border-radius:10px;padding:10px;color:#fff;font-weight:700;cursor:pointer">${editing ? 'Save changes' : 'Add camera'}</button>
          <button type="button" id="cam-f-cancel" class="ghost small">Cancel</button>
        </div>
      </div>` : '';
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Camera</label>
        ${cams.length ? `<select class="form-input" id="cam-select"><option value="">— none —</option>${opts}</select>` : `<p style="font-size:12px;color:var(--muted);margin:0">No cameras yet — add one below.</p>`}
      </div>
      ${cams.length && w.camId && !_appCamForm.open ? `
      <div class="settings-row" style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" id="cam-edit-btn" class="ghost small">✏️ Edit</button>
        <button type="button" id="cam-del-btn" class="ghost small">🗑️ Remove</button>
        <button type="button" id="cam-test-btn" class="ghost small">📶 Test</button>
        <span id="cam-test-result" style="font-size:12px;color:var(--muted);align-self:center"></span>
      </div>` : ''}
      ${!_appCamForm.open ? `<div class="settings-row"><button type="button" id="cam-add-btn" style="width:100%;padding:10px;border-radius:10px;border:1px dashed var(--border);background:transparent;color:var(--text);cursor:pointer">＋ Add a camera</button></div>` : ''}
      ${form}
      <div class="settings-row">
        <label>Fit</label>
        <select class="form-input" id="cam-fit">
          <option value="contain" ${fit === 'contain' ? 'selected' : ''}>Contain (whole frame)</option>
          <option value="cover" ${fit === 'cover' ? 'selected' : ''}>Cover (fill, may crop)</option>
        </select>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show title</label>
        <input type="checkbox" id="cam-show-title" ${w.camShowTitle !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11.5px;color:var(--muted);margin:8px 0 0">Live H.264/H.265 needs some CPU — a Pi 4 or 5 handles one or two streams; on an older Pi, run the server on Docker or Windows.</p>
    `;
}

async function drawWidgetSettingsPanel_Build_weather(_c) {
  const { w, _st } = _c;
    const locationFontPx = w.wxLocationFontPx || 14;
    const locationAlign = w.wxLocationAlign || 'left';
    const contentPct = Math.round(((w.wxContentScale) || 1) * 100);
    _st.wxSettings = await apiFetch('/api/settings');
    const locationVal = (_st.wxSettings && (_st.wxSettings.weather_location_manual || _st.wxSettings.weather_location_auto)) || '';
    // Forecast day count: combined + forecast default to 5; current-only defaults to 0 (off);
    // the combo widget's own default matches renderWeatherComboForecast()'s own per-style
    // defaults exactly, so this slider shows the same "effective" day count the widget itself
    // would actually use — see display.html's identical comment for the full reasoning.
    const comboStyleDayDefaults = { stacked: 5, timeline: 4, columns: 5, tabs: 6 };
    const defaultDays = w.type === 'weatherCurrent' ? 0
      : w.type === 'weatherComboForecast' ? (comboStyleDayDefaults[w.wxComboStyle || 'stacked'] || 5)
      : 5;
    const forecastDays = (w.wxForecastDays !== undefined) ? w.wxForecastDays : defaultDays;
    const dayMin = w.type === 'weatherCurrent' ? 0 : 1;
    const forecastSlider = (w.type === 'weather' || w.type === 'weatherForecast' || w.type === 'weatherCurrent' || w.type === 'weatherComboForecast') ? `
      <div class="settings-row">
        <label>Forecast Days${w.type==='weatherCurrent' ? ' (0 = current only)' : ''}</label>
        <div class="range-row">
          <input type="range" id="wx-forecast-days-range" min="${dayMin}" max="16" step="1" value="${forecastDays}">
          <span class="range-val" id="wx-forecast-days-val">${forecastDays === 0 ? 'Off' : forecastDays}</span>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px">
          How many days of forecast to show (up to 16). ${w.type==='weatherCurrent' ? 'Set to 0 for current conditions only.' : 'Default is 5.'}
        </p>
      </div>` : '';
    // Combo Forecast's own Layout Style picker and current-conditions toggle
    // — identical to display.html's own copy of these two controls.
    const wxComboStyle = w.wxComboStyle || 'stacked';
    const comboStyleControl = (w.type === 'weatherComboForecast') ? `
      <div class="settings-row">
        <label>Layout Style</label>
        <select class="form-input" id="wx-combo-style-select">
          <option value="stacked"  ${wxComboStyle==='stacked'?'selected':''}>Stacked — hourly row on top, daily list below</option>
          <option value="timeline" ${wxComboStyle==='timeline'?'selected':''}>Timeline — one continuous strip, hours flowing into days</option>
          <option value="columns"  ${wxComboStyle==='columns'?'selected':''}>Split Columns — hourly and daily side by side</option>
          <option value="tabs"     ${wxComboStyle==='tabs'?'selected':''}>Compact Tabs — a tab switches between the two (tap it on the display)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Content Alignment ${infoBtn("Where the whole hourly/daily block sits within the widget's box, if the box is wider than the content needs. Applies to all four layout styles.")}</label>
        <select class="form-input" id="wx-combo-align-select">
          <option value="left"   ${(w.wxComboAlign||'left')==='left'?'selected':''}>Left</option>
          <option value="center" ${w.wxComboAlign==='center'?'selected':''}>Center</option>
          <option value="right"  ${w.wxComboAlign==='right'?'selected':''}>Right</option>
        </select>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show current conditions</label>
        <input type="checkbox" id="wx-combo-show-current" ${w.wxComboShowCurrent !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>` : '';
    // Hourly-widget-specific controls: style (hourly strip vs morning/afternoon/evening)
    // and, for the hourly strip, how many future hours to show. The combo widget's own
    // per-style hour defaults match renderWeatherComboForecast()'s exactly.
    const comboStyleHourDefaults = { stacked: 8, timeline: 6, columns: 5, tabs: 8 };
    const wxHourlyStyle = w.wxHourlyStyle || 'hourly';
    const wxHours = w.wxHours || (w.type === 'weatherComboForecast' ? (comboStyleHourDefaults[wxComboStyle] || 8) : 6);
    const hourlyStyleControl = (w.type === 'weatherHourly') ? `
      <div class="settings-row">
        <label>Style</label>
        <select class="form-input" id="wx-hourly-style">
          <option value="hourly" ${wxHourlyStyle==='hourly'?'selected':''}>By hour (next N hours)</option>
          <option value="parts"  ${wxHourlyStyle==='parts'?'selected':''}>Morning / Afternoon / Evening</option>
        </select>
      </div>` : '';
    // Always rendered (not conditionally omitted) for weatherHourly — only its
    // CSS display toggles based on Style above — so the existing show/hide JS
    // (which looks up #wx-hours-row expecting it to already be in the DOM
    // either way) keeps working correctly in both directions. Always included
    // AND visible for the combo widget — see display.html's identical fix and
    // its own comment for the full reasoning, including the bug this avoids.
    const includeHoursSlider = w.type === 'weatherHourly' || w.type === 'weatherComboForecast';
    const hoursSliderHidden = w.type === 'weatherHourly' && wxHourlyStyle !== 'hourly';
    const hoursSlider = includeHoursSlider ? `
      <div class="settings-row" id="wx-hours-row" style="${hoursSliderHidden ? 'display:none' : ''}">
        <label>Hours to Show ${infoBtn("Number of upcoming hours in the strip. Widen the widget box if they get cramped.")}</label>
        <div class="range-row">
          <input type="range" id="wx-hours-range" min="2" max="12" step="1" value="${wxHours}">
          <span class="range-val" id="wx-hours-val">${wxHours}</span>
        </div>
      </div>` : '';
    // Off by default for every field — matches display.html's identical
    // block and reasoning: subset per widget type, since weatherHourly is
    // too tight on width for anything but feels-like, and weatherForecast
    // has no current-conditions block to hang feels/humidity/gust/UV off of.
    const hasCurrentBlock = w.type === 'weather' || w.type === 'weatherCurrent' || w.type === 'weatherComboForecast';
    const extraFieldsControl = hasCurrentBlock ? `
      <div class="settings-row" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="margin-bottom:0">Show Feels-Like Temp</label>
          <input type="checkbox" id="wx-show-feels" ${w.wxShowFeelsLike ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <label style="margin-bottom:0">Show Humidity</label>
          <input type="checkbox" id="wx-show-humidity" ${w.wxShowHumidity ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <label style="margin-bottom:0">Show Wind Gusts</label>
          <input type="checkbox" id="wx-show-gust" ${w.wxShowWindGust ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <label style="margin-bottom:0">Show UV Index</label>
          <input type="checkbox" id="wx-show-uv" ${w.wxShowUV ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
          <label style="margin-bottom:0">Show Sunrise / Sunset</label>
          <input type="checkbox" id="wx-show-sunrise" ${w.wxShowSunrise ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
      </div>` : (w.type === 'weatherHourly') ? `
      <div class="settings-row" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="margin-bottom:0">Show Feels-Like Temp ${infoBtn("Adds a small 'feels 71°' line under each hour's temperature.")}</label>
          <input type="checkbox" id="wx-show-feels" ${w.wxShowFeelsLike ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
      </div>` : (w.type === 'weatherForecast') ? `
      <div class="settings-row" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="margin-bottom:0">Show Sunrise / Sunset ${infoBtn("Adds today's sunrise and sunset time to today's row only.")}</label>
          <input type="checkbox" id="wx-show-sunrise" ${w.wxShowSunrise ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
      </div>` : '';
    _st.typeSpecificHtml = `
      <div class="settings-row" id="wx-content-scale-row">
        <label>Content Size ${infoBtn("Scales the temperature, icon, and forecast tiles together. Resize the widget box itself by dragging its corners on the layout.")}</label>
        <div class="range-row">
          <input type="range" id="wx-content-scale" min="50" max="250" step="5" value="${contentPct}">
          <span class="range-val" id="wx-content-scale-val">${contentPct}%</span>
        </div>
      </div>
      ${forecastSlider}
      ${comboStyleControl}
      ${hourlyStyleControl}
      ${hoursSlider}
      ${extraFieldsControl}
      <div class="settings-row" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="margin-bottom:0">Override location for this widget</label>
          <input type="checkbox" id="wx-loc-override" ${(w.wxLat && w.wxLon) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <p style="font-size:11px;color:var(--muted);margin:6px 0 0">Use a different location than the global one — e.g. a vacation-home display. Leave off to use the location from Settings → Weather.</p>
        <div id="wx-loc-override-fields" style="${(w.wxLat && w.wxLon) ? '' : 'display:none'};margin-top:10px">
          <label style="font-size:12px;color:var(--muted)">ZIP / Postal code</label>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input class="form-input" id="wx-loc-zip" placeholder="e.g. 90210 or SW1A 1AA" style="flex:1">
            <button id="wx-loc-lookup" style="background:var(--accent);border:none;border-radius:9px;color:#fff;padding:0 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Look up</button>
          </div>
          <div style="margin:2px 0 8px;font-size:11px;color:var(--muted);text-align:center">— or —</div>
          <label style="font-size:12px;color:var(--muted)">Search by place name</label>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input class="form-input" id="wx-loc-place" placeholder="e.g. Denver, or Yellowstone National Park" style="flex:1">
            <button id="wx-loc-place-go" style="background:var(--accent);border:none;border-radius:9px;color:#fff;padding:0 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Search</button>
          </div>
          <label style="font-size:12px;color:var(--muted)">Label (shown on the widget)</label>
          <input class="form-input" id="wx-loc-label" value="${w.wxLabel || ''}" placeholder="e.g. Lake House" style="margin-bottom:8px">
          <div id="wx-loc-status" style="font-size:12px;color:var(--muted)">${(w.wxLat && w.wxLon) ? `📍 ${w.wxLat}, ${w.wxLon}` : 'No location set yet.'}</div>
        </div>
      </div>
      <div class="settings-row">
        <label>Units for this widget</label>
        <select class="form-input" id="wx-unit-select">
          <option value="" ${!w.wxUnit ? 'selected' : ''}>Use global default (${_st.wxSettings.weather_unit === 'celsius' ? 'Celsius' : 'Fahrenheit'})</option>
          <option value="fahrenheit" ${w.wxUnit === 'fahrenheit' ? 'selected' : ''}>Fahrenheit (°F)</option>
          <option value="celsius" ${w.wxUnit === 'celsius' ? 'selected' : ''}>Celsius (°C)</option>
        </select>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Location Name ${infoBtn("Turn off to hide the location name entirely on this widget, keeping just the weather itself.")}</label>
        <input type="checkbox" id="wx-show-location" ${w.wxShowLocation !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row">
        <label>Location Name ${infoBtn("Set above, in the override box — the Label field there is this widget's location name.")}</label>
        ${(w.wxLat && w.wxLon) ? `
        ` : `
        <p style="font-size:13px;margin:0">${locationVal || '(not set)'}</p>
        <p style="font-size:11px;color:var(--muted);margin-top:6px">This is the device-wide default (Settings → Weather → Location Name), shown here for reference only — it's no longer editable from inside a widget's own settings. That used to be possible, and it was a real source of confusion: editing it from one widget's panel silently changed every OTHER weather widget across every layout too, since it was never actually specific to the widget you thought you were editing. Turn on "Override location for this widget" above if you want this one widget to show somewhere else.</p>
        `}
      </div>
      <div class="settings-row">
        <label>Location Name Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="wx-location-font-range" min="8" max="100" step="1" value="${locationFontPx}">
          <span class="range-val" id="wx-location-font-val">${locationFontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Location Name Alignment</label>
        <select class="form-input" id="wx-location-align-select">
          <option value="left"   ${locationAlign==='left'?'selected':''}>Left</option>
          <option value="center" ${locationAlign==='center'?'selected':''}>Center</option>
          <option value="right"  ${locationAlign==='right'?'selected':''}>Right</option>
        </select>
      </div>
    `;
}

async function drawWidgetSettingsPanel_Build_minical(_c) {
  const { w, _st } = _c;
    const view = w.calView || 'month';
    const fontPx = w.calFontPx || 11;
    const wrapMode = (w.calWrap === 'clamp2') ? 'clamp2' : (w.calWrap === true || w.calWrap === 'on') ? 'on' : 'off';
    const calLayout = w.calLayout || 'grid';
    const agendaDays = w.calAgendaDays || 14;
    const stripDays = w.calStripDays || 7;
    const maxEventsPerDay = (w.calMaxEventsPerDay !== undefined ? w.calMaxEventsPerDay : 0);
    const dimPast = !!w.calDimPast;
    const showEndTime = !!w.calShowEndTime;
    const calDateSettings = await apiFetch('/api/settings');
    const calGlobalDateLabel = DATE_FORMAT_LABELS[(calDateSettings && calDateSettings.date_format) || 'us_long'];
    // Matches each layout's OWN actual wrap-detection logic in display.html
    // (Grid: the 3-way wrapMode above; Agenda: a plain `!!calWrap` truthy
    // check) — not just `!!w.calWrap`, since the string 'off' is itself
    // truthy in JS and would otherwise show this toggle enabled for a Grid
    // calendar explicitly set to wrap Off.
    const wrapActiveForCurrentLayout = calLayout === 'agenda' ? !!w.calWrap : (wrapMode !== 'off');
    const layoutInner = `
      <div class="settings-row">
        <label>Layout Style</label>
        <select class="form-input" id="cal-layout-select">
          <option value="grid"   ${calLayout==='grid'?'selected':''}>Grid (month/week)</option>
          <option value="agenda" ${calLayout==='agenda'?'selected':''}>Agenda (list)</option>
          <option value="strip"  ${calLayout==='strip'?'selected':''}>Strip (single row)</option>
        </select>
      </div>
      ${dateFormatOverrideRowHtml('cal-date-format-select', w.calDateFormat, calGlobalDateLabel)}
      ${ampmCaseOverrideRowHtml('cal-ampm-case-select', w.calAmpmCase)}
      <div class="settings-row" id="cal-show-end-time-row" style="display:flex;justify-content:space-between;align-items:center;${calLayout==='strip'?'display:none':''}">
        <label style="margin-bottom:0">Show End Times ${infoBtn("Shows \"9:00 – 10:00 AM\" instead of just the start time, for events that aren't all-day or multi-day. Strip layout always shows both regardless of this setting.")}</label>
        <input type="checkbox" id="cal-show-end-time-toggle" ${showEndTime?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" id="cal-adaptive-font-row" style="display:flex;justify-content:space-between;align-items:center;${calLayout==='strip'?'display:none':''}">
        <label style="margin-bottom:0">Adaptive Font Sizing ${infoBtn(`For an event that just barely wraps to a second line (e.g. "🎂Name🎂" tipping over because of the trailing emoji), shrinks that one event's text by up to 2px — only if that's enough to bring it back to one line. A title that's genuinely too long to fit is left wrapped exactly as before, at full size.${wrapActiveForCurrentLayout ? '' : ' Requires Wrap Event Text to be on — grayed out until then, since text truncates with "…" instead of wrapping while it\'s off.'}`)}</label>
        <input type="checkbox" id="cal-adaptive-font-toggle" ${w.calAdaptiveFontSizing?'checked':''} ${wrapActiveForCurrentLayout?'':'disabled'} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Calendar View</label>
        <select class="form-input" id="cal-view-select">
          <option value="1week" ${view==='1week'?'selected':''}>1 Week</option>
          <option value="2week" ${view==='2week'?'selected':''}>2 Weeks</option>
          <option value="3week" ${view==='3week'?'selected':''}>3 Weeks</option>
          <option value="4week" ${view==='4week'?'selected':''}>4 Weeks</option>
          <option value="month" ${view==='month'?'selected':''}>Month</option>
        </select>
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Week Starts On</label>
        <select class="form-input" id="cal-week-start-select">
          <option value="default" ${(w.calWeekStart||'default')==='default'?'selected':''}>Use display setting</option>
          <option value="0" ${w.calWeekStart==='0'?'selected':''}>Sunday</option>
          <option value="1" ${w.calWeekStart==='1'?'selected':''}>Monday</option>
        </select>
      </div>
      <div class="settings-row" style="${calLayout==='agenda'?'':'display:none'}">
        <label>Days to Show Ahead</label>
        <div class="range-row">
          <input type="range" id="cal-agenda-days-range" min="3" max="30" step="1" value="${agendaDays}">
          <span class="range-val" id="cal-agenda-days-val">${agendaDays}</span>
        </div>
      </div>
      <div class="settings-row" style="${calLayout==='strip'?'':'display:none'}">
        <label>Days to Show</label>
        <div class="range-row">
          <input type="range" id="cal-strip-days-range" min="3" max="10" step="1" value="${stripDays}">
          <span class="range-val" id="cal-strip-days-val">${stripDays}</span>
        </div>
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Max Events Per Day <span class="info-btn" onclick="showInfoPopup('cal-max-events-help')">ⓘ</span></label>
        <div class="range-row">
          <input type="range" id="cal-max-events-range" min="0" max="10" step="1" value="${maxEventsPerDay}">
          <span class="range-val" id="cal-max-events-val">${maxEventsPerDay === 0 ? 'Auto' : maxEventsPerDay}</span>
        </div>
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Max Lines Per Day <span class="info-btn" onclick="showInfoPopup('cal-max-lines-help')">ⓘ</span></label>
        <div class="range-row">
          <input type="range" id="cal-max-lines-range" min="0" max="12" step="1" value="${(w.calMaxLines||0)}">
          <span class="range-val" id="cal-max-lines-val">${(w.calMaxLines||0) === 0 ? 'Auto' : (w.calMaxLines)}</span>
        </div>
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Wrap Event Text ${infoBtn('"Max 2 lines" wraps long titles but caps them at two lines so a busy day doesn\'t get clogged.')}</label>
        <select class="form-input" id="cal-wrap-mode">
          <option value="off" ${wrapMode==='off'?'selected':''}>Off — single line, cut with "…"</option>
          <option value="on" ${wrapMode==='on'?'selected':''}>On — wrap to as many lines as needed</option>
          <option value="clamp2" ${wrapMode==='clamp2'?'selected':''}>Wrap, max 2 lines</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="cal-font-range" min="6" max="64" step="1" value="${fontPx}">
          <span class="range-val" id="cal-font-val">${fontPx}px</span>
        </div>
      </div>
    `;
    const colorsInner = `
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Color Coding</label>
        <input type="checkbox" id="cal-color-coding-toggle" ${w.calColorCoding !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Off removes every colored dot and highlight from this calendar — plain text only. On by default.</p>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Multi-Day Event Style ${infoBtn("How a multi-day event (a trip, a visit) shows across the days it covers. \"Bar\" is the original style; the others are lighter-weight for a calendar with lots of single-day entries already competing for space.")}</label>
        <select class="form-input" id="cal-multiday-style-select">
          <option value="bar"    ${(w.calMultiDayStyle||'bar')==='bar'?'selected':''}>Bar — spans across the days</option>
          <option value="dot"    ${w.calMultiDayStyle==='dot'?'selected':''}>Dot — listed like a regular event, each day</option>
          <option value="line"   ${w.calMultiDayStyle==='line'?'selected':''}>Line — thin underline, name once</option>
          <option value="stripe" ${w.calMultiDayStyle==='stripe'?'selected':''}>Stripe — colored edge on the cell</option>
        </select>
      </div>
      <div class="settings-row" id="cal-fullday-style-row" style="${calLayout==='grid' && w.calColorCoding!==false?'':'display:none'}">
        <label>Full-Day Event Style ${infoBtn("How an all-day/multi-day event shows its color, independent of Color Coding above for timed events. \"Background\" is a colored pill. \"Dot\" is a lighter-weight marker matching a timed event's, no background. \"None\" shows plain text with no color indicator at all, for full-day events only. Hidden while Color Coding above is off.")}</label>
        <select class="form-input" id="cal-fullday-style-select">
          <option value="highlight" ${(w.calFullDayColorStyle||'highlight')==='highlight'?'selected':''}>Background — colored pill</option>
          <option value="dot"       ${w.calFullDayColorStyle==='dot'?'selected':''}>Dot — colored marker, no background</option>
          <option value="none"      ${w.calFullDayColorStyle==='none'?'selected':''}>None — plain text, no color</option>
        </select>
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Today Indicator Style ${infoBtn("How today's date is marked in the grid. Grid layout only — Agenda and Strip mark today a different way already and aren't affected by this.")}</label>
        <select class="form-input" id="cal-today-style-select">
          <option value="circle"    ${(w.calTodayStyle||'circle')==='circle'?'selected':''}>Circle — filled, original style</option>
          <option value="outline"   ${w.calTodayStyle==='outline'?'selected':''}>Outline — ring only, no fill</option>
          <option value="fill"      ${w.calTodayStyle==='fill'?'selected':''}>Cell Highlight — tints the whole day box</option>
          <option value="underline" ${w.calTodayStyle==='underline'?'selected':''}>Underline — thin line beneath the number</option>
          <option value="text"      ${w.calTodayStyle==='text'?'selected':''}>Text Color — just colors the number itself</option>
          <option value="none"      ${w.calTodayStyle==='none'?'selected':''}>None — no special treatment</option>
        </select>
        <div id="cal-today-color-swatches" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
          <input type="color" id="cal-today-color-custom" value="${w.calTodayColor || '#d23a3a'}"
            style="width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:none;cursor:pointer;padding:0">
          <span style="font-size:12px;color:var(--muted)">${w.calTodayColor ? 'Custom color' : 'Currently using the theme\'s default red'}</span>
        </div>
        ${w.calTodayColor ? `<button id="cal-today-color-reset-btn" style="background:none;border:none;color:var(--accent);font-size:12px;font-weight:600;cursor:pointer;padding:6px 0;margin-top:2px">Use Theme Default</button>` : ''}
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Dim Past Days ${infoBtn("Fades out days before today, so the calendar draws your eye toward what's upcoming. All days are shown at full brightness when this is off, regardless of which month they're in.")}</label>
        <input type="checkbox" id="cal-dim-past-toggle" ${dimPast?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Past Events ${infoBtn("Controls events that have already happened. \"Show dimmed\" greys them out; \"Hide\" removes them entirely.")}</label>
        <select class="form-input" id="cal-past-events-select">
          <option value="show" ${(!w.pastEvents||w.pastEvents==='show')?'selected':''}>Show normally</option>
          <option value="dim"  ${w.pastEvents==='dim'?'selected':''}>Show dimmed</option>
          <option value="hide" ${w.pastEvents==='hide'?'selected':''}>Hide</option>
        </select>
      </div>
      <div class="settings-row" style="${calLayout==='grid'?'':'display:none'}">
        <label>Decoration Style <span class="info-btn" onclick="showInfoPopup('cal-decor-help')">ⓘ</span></label>
        <select class="form-input" id="cal-decor-select">
          <option value="none"          ${(!w.calDecor||w.calDecor==='none')?'selected':''}>None (normal)</option>
          <option value="postit"        ${w.calDecor==='postit'?'selected':''}>Post-it notes</option>
          <option value="icon:star"     ${w.calDecor==='icon:star'?'selected':''}>Stars ⭐</option>
          <option value="icon:sparkle"  ${w.calDecor==='icon:sparkle'?'selected':''}>Sparkles ✨</option>
          <option value="icon:ornament" ${w.calDecor==='icon:ornament'?'selected':''}>Ornaments 🎄</option>
          <option value="icon:egg"      ${w.calDecor==='icon:egg'?'selected':''}>Easter eggs 🥚</option>
          <option value="icon:pumpkin"  ${w.calDecor==='icon:pumpkin'?'selected':''}>Pumpkins 🎃</option>
          <option value="icon:leaf"     ${w.calDecor==='icon:leaf'?'selected':''}>Leaves 🍁</option>
          <option value="icon:balloon"  ${w.calDecor==='icon:balloon'?'selected':''}>Balloons 🎈</option>
        </select>
      </div>
    `;
    const remindersInner = `
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Reminder Badges</label>
        <input type="checkbox" id="cal-show-reminders-toggle" ${w.calShowReminders?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Marks each day one of your Reminders (trash day, recycling, anything set up in a Reminders widget) is due with a small emoji badge — the same schedule the Reminders widget itself reads from.</p>
      <div class="settings-row" id="cal-reminder-position-row" style="${w.calShowReminders?'':'display:none'}">
        <label>Badge Position</label>
        <select class="form-input" id="cal-reminder-position-select">
          <option value="top-left"     ${(w.calReminderPosition||'top-left')==='top-left'?'selected':''}>Top left</option>
          <option value="top-right"    ${w.calReminderPosition==='top-right'?'selected':''}>Top right</option>
          <option value="bottom-right" ${w.calReminderPosition==='bottom-right'?'selected':''}>Bottom right</option>
          <option value="bottom-left"  ${w.calReminderPosition==='bottom-left'?'selected':''}>Bottom left</option>
        </select>
      </div>
      <div class="settings-row" id="cal-reminder-size-row" style="${w.calShowReminders?'':'display:none'}">
        <label>Badge Size (px)</label>
        <div class="range-row">
          <input type="range" id="cal-reminder-size-range" min="8" max="48" step="1" value="${w.calReminderSizePx || Math.round(fontPx * 1.4)}">
          <span class="range-val" id="cal-reminder-size-val">${w.calReminderSizePx || Math.round(fontPx * 1.4)}px</span>
        </div>
      </div>
      <div class="settings-row" id="cal-reminder-text-size-row" style="${w.calShowReminders?'':'display:none'}">
        <label>Text Reminder Size ${infoBtn('Only affects reminders using a text label as their icon (e.g. "TRASH") — emoji and image icons use Badge Size above instead. A percentage on top of the automatic shrink-to-fit that already applies to longer labels.')}</label>
        <div class="range-row">
          <input type="range" id="cal-reminder-textsize-range" min="50" max="200" step="10" value="${w.calReminderTextSizePct || 100}">
          <span class="range-val" id="cal-reminder-textsize-val">${w.calReminderTextSizePct || 100}%</span>
        </div>
      </div>
    `;
    const stickersInner = `
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Sticker Badges</label>
        <input type="checkbox" id="cal-show-stickers-toggle" ${w.calShowStickers?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Marks each day a kid earned a sticker with a small badge — their chosen star/avatar/emoji style (set per kid in the Chores tab). One badge per kid per day, however many stickers they earned.</p>
      <div class="settings-row" id="cal-sticker-position-row" style="${w.calShowStickers?'':'display:none'}">
        <label>Badge Position</label>
        <select class="form-input" id="cal-sticker-position-select">
          <option value="top-right"    ${(w.calStickerPosition||'top-right')==='top-right'?'selected':''}>Top right</option>
          <option value="top-left"     ${w.calStickerPosition==='top-left'?'selected':''}>Top left</option>
          <option value="bottom-right" ${w.calStickerPosition==='bottom-right'?'selected':''}>Bottom right</option>
          <option value="bottom-left"  ${w.calStickerPosition==='bottom-left'?'selected':''}>Bottom left</option>
        </select>
      </div>
      <div class="settings-row" id="cal-sticker-size-row" style="${w.calShowStickers?'':'display:none'}">
        <label>Badge Size (px) ${infoBtn("Defaults to matching the day number's own size. Drag to make badges bigger or smaller.")}</label>
        <div class="range-row">
          <input type="range" id="cal-sticker-size-range" min="8" max="60" step="1" value="${w.calStickerSizePx || Math.round(fontPx * 2)}">
          <span class="range-val" id="cal-sticker-size-val">${w.calStickerSizePx || Math.round(fontPx * 2)}px</span>
        </div>
      </div>
    `;
    const calWeatherStyle = w.calWeatherStyle || 'badge';
    const weatherInner = `
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Weather</label>
        <input type="checkbox" id="cal-show-weather-toggle" ${w.calShowWeather?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Shows that day's forecast on however many days ahead your household's weather location has one for — reuses that same location, nothing extra to set up.</p>
      <div class="settings-row" id="cal-weather-style-row" style="${w.calShowWeather?'':'display:none'}">
        <label>Style</label>
        <select class="form-input" id="cal-weather-style-select">
          <option value="badge" ${calWeatherStyle==='badge'?'selected':''}>Corner badge (icon + high)</option>
          <option value="row"   ${calWeatherStyle==='row'?'selected':''}>Forecast row (icon + high/low)</option>
          <option value="icon"  ${calWeatherStyle==='icon'?'selected':''}>Icon only</option>
        </select>
      </div>
      <div class="settings-row" id="cal-weather-position-row" style="${w.calShowWeather?'':'display:none'}">
        <label>Position</label>
        <select class="form-input" id="cal-weather-position-select">
          <option value="top-right"    ${(w.calWeatherPosition||'top-right')==='top-right'?'selected':''}>Top right, same row as the date</option>
          <option value="top-left"     ${w.calWeatherPosition==='top-left'?'selected':''}>Top left, same row as the date</option>
          <option value="bottom-right" ${w.calWeatherPosition==='bottom-right'?'selected':''}>Bottom right</option>
          <option value="bottom-left"  ${w.calWeatherPosition==='bottom-left'?'selected':''}>Bottom left</option>
        </select>
      </div>
      <div class="settings-row" id="cal-weather-size-row" style="${w.calShowWeather?'':'display:none'}">
        <label>Icon Size (px)</label>
        <div class="range-row">
          <input type="range" id="cal-weather-size-range" min="8" max="48" step="1" value="${w.calWeatherSizePx || Math.round(fontPx * 1.4)}">
          <span class="range-val" id="cal-weather-size-val">${w.calWeatherSizePx || Math.round(fontPx * 1.4)}px</span>
        </div>
      </div>
    `;
    _st.typeSpecificHtml = `
      <div id="minical-settings-acc">
        ${accordionSection({ id: 'layout', icon: '📐', label: 'Layout', sub: 'View, days shown, font sizing', inner: layoutInner }, _calSettingsOpenSection === 'layout')}
        ${accordionSection({ id: 'colors', icon: '🎨', label: 'Event Colors & Style', sub: 'Color coding, today indicator, decorations', inner: colorsInner }, _calSettingsOpenSection === 'colors')}
        ${accordionSection({ id: 'reminders', icon: '🗑️', label: 'Reminder Badges', sub: 'Show on calendar, position, size', inner: remindersInner, hidden: calLayout !== 'grid' }, _calSettingsOpenSection === 'reminders')}
        ${accordionSection({ id: 'stickers', icon: '⭐', label: 'Sticker Badges', sub: 'Show on calendar, position, size', inner: stickersInner, hidden: calLayout !== 'grid' }, _calSettingsOpenSection === 'stickers')}
        ${accordionSection({ id: 'weather', icon: '🌤️', label: 'Weather', sub: 'Show on calendar, style, position', inner: weatherInner, hidden: calLayout !== 'grid' }, _calSettingsOpenSection === 'weather')}
      </div>
    `;
}

async function drawWidgetSettingsPanel_Build_upcoming(_c) {
  const { w, _st } = _c;
    const fontPx = w.upFontPx || 14;
    const upLayout = w.upLayout || 'list';
    const upDateSettings = await apiFetch('/api/settings');
    const upGlobalDateLabel = DATE_FORMAT_LABELS[(upDateSettings && upDateSettings.date_format) || 'us_long'];
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Layout Style</label>
        <select class="form-input" id="up-layout-select">
          <option value="list"    ${upLayout==='list'?'selected':''}>List</option>
          <option value="cards"   ${upLayout==='cards'?'selected':''}>Cards</option>
          <option value="compact" ${upLayout==='compact'?'selected':''}>Compact</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="up-font-range" min="8" max="56" step="1" value="${fontPx}">
          <span class="range-val" id="up-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Show on each event</label>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Time / date range
            <input type="checkbox" id="up-show-time" ${w.upShowTime !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Calendar source label
            <input type="checkbox" id="up-show-source" ${w.upShowSource !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Notes
            <input type="checkbox" id="up-show-notes" ${w.upShowNotes ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
        </div>
      </div>
      ${dateFormatOverrideRowHtml('up-date-format-select', w.upDateFormat, upGlobalDateLabel)}
      ${ampmCaseOverrideRowHtml('up-ampm-case-select', w.upAmpmCase)}
    `;
}

async function drawWidgetSettingsPanel_Build_today(_c) {
  const { w, _st } = _c;
    const fontPx = w.tdFontPx || 15;
    const tdLayout = w.tdLayout || 'list';
    const tdDateSettings = await apiFetch('/api/settings');
    const tdGlobalDateLabel = DATE_FORMAT_LABELS[(tdDateSettings && tdDateSettings.date_format) || 'us_long'];
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Layout Style</label>
        <select class="form-input" id="td-layout-select">
          <option value="list"    ${tdLayout==='list'?'selected':''}>List</option>
          <option value="cards"   ${tdLayout==='cards'?'selected':''}>Cards</option>
          <option value="compact" ${tdLayout==='compact'?'selected':''}>Compact</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="td-font-range" min="8" max="56" step="1" value="${fontPx}">
          <span class="range-val" id="td-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Show on each event</label>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Time
            <input type="checkbox" id="td-show-time" ${w.tdShowTime !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Calendar source label
            <input type="checkbox" id="td-show-source" ${w.tdShowSource !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Notes
            <input type="checkbox" id="td-show-notes" ${w.tdShowNotes ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
        </div>
      </div>
      <div class="settings-row">
        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0">
          Ongoing Strip
           ${infoBtn("A separate summary line for multi-day events already in progress or starting in the next couple days — \"day 2 of 5\" instead of it just looking like another today-only event in the list.")}<input type="checkbox" id="td-show-ongoing" ${w.tdShowOngoing ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
        </label>
      </div>
      ${dateFormatOverrideRowHtml('td-date-format-select', w.tdDateFormat, tdGlobalDateLabel)}
      ${ampmCaseOverrideRowHtml('td-ampm-case-select', w.tdAmpmCase)}
    `;
}

async function drawWidgetSettingsPanel_Build_agenda(_c) {
  const { w, _st } = _c;
    const fontPx = w.agFontPx || 14;
    const agLayout = w.agLayout || 'list';
    const agDays = w.agDays || 7;
    const agDateSettings = await apiFetch('/api/settings');
    const agGlobalDateLabel = DATE_FORMAT_LABELS[(agDateSettings && agDateSettings.date_format) || 'us_long'];
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Layout Style</label>
        <select class="form-input" id="ag-layout-select">
          <option value="list"    ${agLayout==='list'?'selected':''}>List</option>
          <option value="cards"   ${agLayout==='cards'?'selected':''}>Cards</option>
          <option value="compact" ${agLayout==='compact'?'selected':''}>Compact</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Days to Show ${infoBtn("Includes today plus this many days ahead. Actual events shown still depends on how much fits in the widget's size.")}</label>
        <div class="range-row">
          <input type="range" id="ag-days-range" min="1" max="30" step="1" value="${agDays}">
          <span class="range-val" id="ag-days-val">${agDays}</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="ag-font-range" min="8" max="56" step="1" value="${fontPx}">
          <span class="range-val" id="ag-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Show on each event</label>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Time
            <input type="checkbox" id="ag-show-time" ${w.agShowTime !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Calendar source label
            <input type="checkbox" id="ag-show-source" ${w.agShowSource !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Notes
            <input type="checkbox" id="ag-show-notes" ${w.agShowNotes ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
        </div>
      </div>
      <div class="settings-row">
        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0">
          Ongoing Strip
           ${infoBtn("A separate summary line for multi-day events already in progress or starting in the next few days — \"day 2 of 5\" instead of it just looking like another one-day event grouped under today.")}<input type="checkbox" id="ag-show-ongoing" ${w.agShowOngoing ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
        </label>
      </div>
      <div class="settings-row">
        <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0">
          Show Reminders
           ${infoBtn("Trash day, recycling, or anything else set up in a Reminders widget — shown as its own line on any day it's due, same schedule the Reminders widget and the calendar-grid badges read from.")}<input type="checkbox" id="ag-show-reminders" ${w.agShowReminders ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
        </label>
      </div>
      ${dateFormatOverrideRowHtml('ag-date-format-select', w.agDateFormat, agGlobalDateLabel)}
      ${ampmCaseOverrideRowHtml('ag-ampm-case-select', w.agAmpmCase)}
    `;
}

function drawWidgetSettingsPanel_Build_tasksCombined(_c) {
  const { w, _st } = _c;
    const fontPx = w.tcFontPx || 14;
    const tcAlign = w.tcAlign || 'top';
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Projects to Include ${infoBtn("Each selected project gets its own group with a header, all in one widget.")}</label>
        <div id="tc-project-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          <p style="font-size:12px;color:var(--muted);margin:0">Loading projects…</p>
        </div>
      </div>
      <div class="settings-row">
        <label>Vertical Alignment ${infoBtn("Where the task list sits within the widget's box when it doesn't fill the whole space.")}</label>
        <select class="form-input" id="tc-align-select">
          <option value="top"    ${tcAlign==='top'?'selected':''}>Top</option>
          <option value="center" ${tcAlign==='center'?'selected':''}>Center</option>
          <option value="bottom" ${tcAlign==='bottom'?'selected':''}>Bottom</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="tc-font-range" min="8" max="56" step="1" value="${fontPx}">
          <span class="range-val" id="tc-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Due Date</label>
        <input type="checkbox" id="tc-show-due" ${w.tcShowDue !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_stocks(_c) {
  const { w, _st } = _c;
    const fontPx = w.stockFontPx || 14;
    const tickers = Array.isArray(w.stockTickers) ? w.stockTickers : [];
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="stock-font-range" min="8" max="96" step="1" value="${fontPx}">
          <span class="range-val" id="stock-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Show Indices</label>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Dow Jones
            <input type="checkbox" id="stock-show-dow" ${w.hideDow ? '' : 'checked'} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            Nasdaq
            <input type="checkbox" id="stock-show-nasdaq" ${w.hideNasdaq ? '' : 'checked'} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;font-weight:400;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">
            S&amp;P 500
            <input type="checkbox" id="stock-show-sp" ${w.hideSP ? '' : 'checked'} style="width:18px;height:18px;accent-color:var(--accent)">
          </label>
        </div>
        <p style="font-size:11px;color:var(--muted);margin:8px 0 0">Uncheck any index to hide it.</p>
      </div>
      <div class="settings-row" style="border-top:1px solid var(--border);padding-top:14px">
        <label>Tickers to Track ${infoBtn("Add stock tickers (e.g. AAPL, TSLA) or crypto pairs (e.g. BTC-USD, ETH-USD) — both show together on this widget, crypto tagged separately. This is per-widget: other Stock widgets on your displays track their own separate list.")}</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="w-ticker-input" type="text" placeholder="e.g. AAPL or BTC-USD" style="flex:1;text-transform:uppercase" autocomplete="off">
          <button type="button" id="w-ticker-add-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">Add</button>
        </div>
        <div id="w-ticker-chips" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          ${tickers.length ? '' : `<span style="font-size:12px;color:var(--muted)">No custom tickers added yet</span>`}
        </div>
        <p style="font-size:11px;color:var(--muted);margin:10px 0 6px">Quick-add crypto:</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${[['BTC-USD','₿ Bitcoin'],['ETH-USD','Ethereum'],['SOL-USD','Solana'],['DOGE-USD','Dogecoin']].map(([sym,lbl]) => `
            <button type="button" class="w-crypto-quickadd" data-sym="${sym}" style="background:var(--card);border:1px solid var(--border);border-radius:20px;padding:6px 14px;font-size:12px;color:var(--text);cursor:pointer">${lbl}</button>
          `).join('')}
        </div>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_photo(_c) {
  const { w, _st } = _c;
    const mode = w.photoMode || 'all';
    const ivSec = w.photoInterval || null; // seconds; null = use global setting
    _st.typeSpecificHtml = `
      <div class="mini-section-label">🖼️ Which Photos</div>
      <div class="settings-row">
        <label>Which Photos ${infoBtn("Choose a subset so this display shows different photos than another. Photos are uploaded in Settings → Photos (shared library).")}</label>
        <select class="form-input" id="photo-mode-select">
          <option value="all"      ${mode==='all'?'selected':''}>All active photos</option>
          <option value="selected" ${mode==='selected'?'selected':''}>Only the ones I pick</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Filter by Tag ${infoBtn("This widget's own tag — independent of whatever tag a screen's screensaver is set to. Tag photos in the Photos tab.")}</label>
        <select class="form-input" id="photo-tag-select">
          <option value="" ${!w.photoTag?'selected':''}>All tags</option>
          ${(window._photoTags||[]).map(t=>`<option value="${t}" ${w.photoTag===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row" id="photo-pick-row" style="${mode==='selected'?'':'display:none'}">
        <label>Pick Photos for This Display</label>
        <div id="photo-pick-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-top:6px">
          <div style="font-size:12px;color:var(--muted)">Loading photos…</div>
        </div>
      </div>
      <div class="mini-section-label with-divider">🎨 Appearance</div>
      <div class="settings-row" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <label style="margin-bottom:2px">Full-Screen Background ${infoBtn("Fills the whole display and sits behind every other widget — a quick way to get a photo-backed look without switching to Ambient Mode or a different template. Doesn't change this widget's own position/size, just how it's shown while this is on — turn it off anytime to go right back to exactly where it was.")}</label>
        </div>
        <input type="checkbox" id="photo-fullscreen-bg-toggle" ${w.photoFullscreenBg?'checked':''}
               style="width:22px;height:22px;accent-color:var(--accent);flex-shrink:0;margin-top:2px">
      </div>
      <div class="settings-row">
        <label>Image Fit</label>
        <select class="form-input" id="photo-fit-select">
          <option value="cover"  ${(w.photoFit||'cover')==='cover'?'selected':''}>Fill (crop to fill, no gaps)</option>
          <option value="width"  ${w.photoFit==='width'?'selected':''}>Fit to width (whole width shown)</option>
          <option value="height" ${w.photoFit==='height'?'selected':''}>Fit to height (whole height shown)</option>
          <option value="auto"   ${w.photoFit==='auto'?'selected':''}>Auto (best fit per photo — good for mixed orientations)</option>
        </select>
        <p style="font-size:11px;color:var(--muted);margin-top:6px;cursor:pointer" onclick="showInfoPopup('photo-fit-help')">
          What do these mean? ⓘ
        </p>
      </div>
      <div class="settings-row" id="photo-autoblurbg-row" style="display:${w.photoFit==='auto'?'flex':'none'};justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Blurred background behind mismatched photos</label>
        <input type="checkbox" id="photo-autoblurbg" ${w.photoAutoBlurBg!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row">
        <label>Edge Fade ${infoBtn("Softly fades the photo's edges into the background — nice for blending a photo into the display. Set any edge to 0 for a hard edge.")}</label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--muted);width:54px">Top</span>
          <input type="range" id="pw-fade-top" min="0" max="300" step="5" value="${w.fadeTop||0}" style="flex:1">
          <span class="range-val" id="pw-fade-top-val" style="width:46px;text-align:right">${w.fadeTop||0}px</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--muted);width:54px">Bottom</span>
          <input type="range" id="pw-fade-bottom" min="0" max="300" step="5" value="${w.fadeBottom||0}" style="flex:1">
          <span class="range-val" id="pw-fade-bottom-val" style="width:46px;text-align:right">${w.fadeBottom||0}px</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;color:var(--muted);width:54px">Left</span>
          <input type="range" id="pw-fade-left" min="0" max="300" step="5" value="${w.fadeLeft||0}" style="flex:1">
          <span class="range-val" id="pw-fade-left-val" style="width:46px;text-align:right">${w.fadeLeft||0}px</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--muted);width:54px">Right</span>
          <input type="range" id="pw-fade-right" min="0" max="300" step="5" value="${w.fadeRight||0}" style="flex:1">
          <span class="range-val" id="pw-fade-right-val" style="width:46px;text-align:right">${w.fadeRight||0}px</span>
        </div>
      </div>
      <div class="mini-section-label with-divider">🔄 Slideshow</div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Fade between photos</label>
        <input type="checkbox" id="photo-fadetransition" ${w.photoFadeTransition!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" id="photo-fadeduration-row" style="display:${w.photoFadeTransition!==false?'':'none'}">
        <label>Fade Duration</label>
        <select class="form-input" id="photo-fadeduration-select">
          <option value="1" ${(parseFloat(w.photoFadeDuration)||2)==1?'selected':''}>1 second (quick)</option>
          <option value="2" ${!w.photoFadeDuration||(parseFloat(w.photoFadeDuration)||2)==2?'selected':''}>2 seconds (default)</option>
          <option value="3" ${(parseFloat(w.photoFadeDuration)||2)==3?'selected':''}>3 seconds</option>
          <option value="4" ${(parseFloat(w.photoFadeDuration)||2)==4?'selected':''}>4 seconds</option>
          <option value="5" ${(parseFloat(w.photoFadeDuration)||2)==5?'selected':''}>5 seconds (slow)</option>
          <option value="8" ${(parseFloat(w.photoFadeDuration)||2)==8?'selected':''}>8 seconds (very slow)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Slide Interval <span class="info-btn" onclick="showInfoPopup('photo-interval-help')">ⓘ</span></label>
        <select class="form-input" id="photo-interval-select">
          <option value=""   ${!ivSec?'selected':''}>Use global setting</option>
          <option value="5"  ${ivSec==5?'selected':''}>5 seconds</option>
          <option value="10" ${ivSec==10?'selected':''}>10 seconds</option>
          <option value="20" ${ivSec==20?'selected':''}>20 seconds</option>
          <option value="30" ${ivSec==30?'selected':''}>30 seconds</option>
          <option value="60" ${ivSec==60?'selected':''}>1 minute</option>
          <option value="300" ${ivSec==300?'selected':''}>5 minutes</option>
        </select>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Shuffle Order</label>
        <input type="checkbox" id="photo-shuffle" ${w.photoShuffle ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
    `;
}
