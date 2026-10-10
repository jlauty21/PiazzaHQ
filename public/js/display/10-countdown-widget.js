// ── Countdown widget ─────────────────────────────────────────────────────────
// Purely local — no network needed. Counts down to (or up from) a target date,
// optionally rolling forward a year at a time for recurring things like birthdays.
function renderCountdown(widget) {
  const w = widget || {};
  const fontPx = w.cdFontPx || 22;
  const title = w.cdTitle || 'Countdown';
  if (!w.cdDate) {
    return `<div class="w-countdown" style="--cd-font:calc(${fontPx}px * var(--ui-scale,1))"><div class="cd-title">${escapeHtmlD(title)}</div><div class="no-data">Set a date in widget settings</div></div>`;
  }
  const [y, m, d] = w.cdDate.split('-').map(Number);
  let target = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  if (w.cdTime) {
    const [th, tm] = w.cdTime.split(':').map(Number);
    target.setHours(th || 0, tm || 0, 0, 0);
  }
  const now = new Date();
  if (w.cdRepeatYearly) {
    // Roll the target forward by whole years until it's not in the past, so a
    // birthday/anniversary just keeps counting down to the NEXT occurrence.
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    while (target < todayMid) target.setFullYear(target.getFullYear() + 1);
  }
  // Real bug found here: plain `target - now` is raw elapsed milliseconds,
  // not calendar days — if a DST transition falls between now and the
  // target, the hour it adds or removes can flip the Math.ceil()/floor()
  // below by a whole day. Confirmed live: at local midnight, a countdown to
  // a date exactly 7 calendar days out showed "8 days to go" for the week
  // leading into the November fall-back (the found hour nudges the ceil up).
  // Standard correction: add back the difference between the two dates' own
  // DST offsets, so the math reflects wall-clock calendar days the way a
  // person would count them, not true physical elapsed time.
  const diffMs = (target - now) + (now.getTimezoneOffset() - target.getTimezoneOffset()) * 60000;
  const dayMs = 86400000;
  let body;
  if (Math.abs(diffMs) < dayMs && target.toDateString() === now.toDateString()) {
    body = `<div class="cd-today">🎉 Today!</div>`;
  } else if (diffMs > 0) {
    const days = Math.ceil(diffMs / dayMs);
    body = `<div class="cd-num">${days}</div><div class="cd-unit">day${days === 1 ? '' : 's'} to go</div>`;
  } else {
    const days = Math.floor(-diffMs / dayMs);
    body = `<div class="cd-num cd-past">${days}</div><div class="cd-unit">day${days === 1 ? '' : 's'} ago</div>`;
  }
  return `<div class="w-countdown" style="--cd-font:calc(${fontPx}px * var(--ui-scale,1))">
    <div class="cd-title">${escapeHtmlD(title)}</div>
    ${body}
  </div>`;
}

// ── Weather Radar widget (RainViewer, free, no API key) ─────────────────────
// This widget can't be built as a plain HTML string the way most widgets
// are — a Leaflet map needs a real, already-in-the-DOM container element to
// attach to, and its own JS-managed tile layers/animation timer. So
// renderRadar() only returns a placeholder shell (title + empty map div with
// a data-radar-id marker); the actual Leaflet instance is created/recreated
// by initRadarWidgets(), called after every renderLayout()/
// rerenderSingleWidget() the same way renderQRCodes() is — see those call
// sites' own comments for why a separate post-render pass is needed at all.
// Every full renderLayout() throws away and recreates ALL widget DOM
// (canvas.innerHTML = '' — see top of that function), so the map container
// is a brand-new element on every refresh; there is no way to "reuse" a
// previous Leaflet instance, so this tears down and fully recreates the map
// (and its animation timer) every time, keyed by widget id.
const radarMapInstances = new Map();   // widget id -> Leaflet map instance
const radarAnimTimers = new Map();     // widget id -> setInterval id
function renderRadar(widget) {
  const w = widget || {};
  const fontPx = w.radarFontPx || 16;
  const title = w.radarTitle || 'Radar';
  const showTime = w.radarShowTime !== false;
  return `<div class="w-radar" style="--radar-font:calc(${fontPx}px * var(--ui-scale,1))">
    ${title ? `<div class="radar-title">${escapeHtmlD(title)}</div>` : ''}
    <div class="radar-time" style="display:${showTime ? 'block' : 'none'}"></div>
    <div class="radar-map" data-radar-id="${escapeHtmlD(String(w.id))}"></div>
  </div>`;
}
// Formats a RainViewer frame's Unix timestamp (seconds) as a clock time,
// respecting the same 12/24-hour preference the rest of the display uses
// (use24Hour(), pad() — both already defined globally for tickClock()).
function formatRadarFrameTime(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  let h = d.getHours(), m = d.getMinutes();
  if (use24Hour()) return `${pad(h)}:${pad(m)}`;
  const meridiem = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ampmCase()==='upper' ? meridiem.toUpperCase() : meridiem}`;
}
// "20 min ago" / "now" / "+15 min" relative to the moment this is called —
// intentionally recomputed fresh each time rather than cached, since it's
// only ever called right as a frame is shown.
function formatRadarRelative(epochSeconds) {
  const diffMin = Math.round((epochSeconds * 1000 - Date.now()) / 60000);
  if (Math.abs(diffMin) < 1) return 'now';
  return diffMin < 0 ? `${Math.abs(diffMin)} min ago` : `+${diffMin} min`;
}
function initRadarWidgets() {
  if (typeof L === 'undefined' || !window.__leafletCss) return; // Leaflet script or stylesheet still loading - re-run by their onload handlers (see <head>) and by the next render
  document.querySelectorAll('.radar-map[data-radar-id]').forEach(el => {
    const id = el.dataset.radarId;
    const w = (state.layout || []).find(x => String(x.id) === String(id));
    if (!w) return;

    // renderLayout() reuses a radar widget's existing element (instead of
    // recreating it) whenever nothing content-relevant changed — see its
    // own comment. When that happened, the map already attached to THIS
    // EXACT container is still alive and correctly showing the current
    // frame, with its own animation timer still ticking uninterrupted.
    // Tearing it down here and rebuilding from zero would be the exact
    // needless flash/reload the reuse mechanism exists to prevent —
    // confirmed still happening even after gating out the HA poll timers
    // (1.81.0-beta.4), because plenty of OTHER widgets' own refresh timers
    // call renderLayout() just as often.
    const existingMap = radarMapInstances.get(id);
    if (existingMap && existingMap.getContainer() === el) {
      // Box position/size could still have shifted even though radar's own
      // settings didn't (e.g. someone resized this widget, or another
      // widget's move nudged the layout) — Leaflet needs an explicit nudge
      // to notice its container's dimensions may have changed, since that
      // never fires its own resize-detection on its own.
      existingMap.invalidateSize();
      return;
    }

    // Always tear down any previous instance for this id first — its old
    // container element is gone (replaced by the fresh renderLayout() pass),
    // and an orphaned animation timer would otherwise keep firing forever
    // against a detached map, one more added on every single refresh.
    const prevTimer = radarAnimTimers.get(id);
    if (prevTimer) { clearInterval(prevTimer); radarAnimTimers.delete(id); }
    const prevMap = radarMapInstances.get(id);
    if (prevMap) { try { prevMap.remove(); } catch {} radarMapInstances.delete(id); }

    const lat = parseFloat(w.radarLat) || parseFloat(state.settings?.weather_lat);
    const lon = parseFloat(w.radarLon) || parseFloat(state.settings?.weather_lon);
    if (!lat || !lon) {
      el.innerHTML = '<div class="no-data" style="padding:8px">Set a location in Settings → Weather, or override it in this widget\'s settings</div>';
      return;
    }
    const zoom = Math.max(3, Math.min(8, parseInt(w.radarZoom) || 6)); // RainViewer's tiles only go to z7 natively; maxNativeZoom below upsamples for z8
    const opacity = (w.radarOpacity !== undefined ? w.radarOpacity : 80) / 100;

    const map = L.map(el, {
      center: [lat, lon], zoom,
      // No touch input on a wall display — this is a fixed picture-in-a-frame,
      // not an interactive map. Every interaction handler disabled so a
      // stray cursor/mouse near the display (or the drag-handling this app
      // already does for ITS OWN widget repositioning in edit mode) can't
      // accidentally pan or zoom the embedded map.
      zoomControl: false, attributionControl: false, dragging: false,
      touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, tap: false,
      // Kills Leaflet's own built-in CSS opacity transition on tile layers —
      // without this, setting a layer's opacity (even instantly, in JS) still
      // visibly animates over Leaflet's default fade duration, which is what
      // was showing as each frame "fading in and out" instead of just
      // cutting to the next one. The load-before-swap technique below still
      // prevents the earlier flash/gap; this only removes the fade itself.
      fadeAnimation: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 19,
    }).addTo(map);
    radarMapInstances.set(id, map);

    let radarLayer = null;   // currently-visible layer
    let frameVersion = 0;    // guards against a slow-loading frame landing after a newer one already won
    let frameLoading = false; // true while a newLayer is mid-load — see the interval's own check below
    function showFrame(host, frame) {
      const version = ++frameVersion;
      frameLoading = true;
      // Time label updates immediately (not gated behind tile load) — no
      // reason to make "what time is this frame" wait on network latency
      // when it's cheap, known information the instant a frame is chosen.
      const timeEl = el.parentElement && el.parentElement.querySelector('.radar-time');
      if (timeEl && frame.time) {
        const isForecast = frame.kind === 'forecast';
        timeEl.textContent = `${formatRadarFrameTime(frame.time)} · ${formatRadarRelative(frame.time)}${isForecast ? ' (forecast)' : ''}`;
        timeEl.classList.toggle('is-forecast', isForecast);
      }
      const url = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
      // Load-before-swap, not L.tileLayer#setUrl(): setUrl swaps every tile
      // in place, so the old frame disappears the instant new tiles START
      // loading, not when they finish — the gap between "old tiles gone"
      // and "new tiles painted" is what showed as a flash on every single
      // frame change. Instead, load the NEW frame as its own layer
      // (invisible — opacity 0, no CSS transition since fadeAnimation:false
      // on the map, backed up by a CSS override for Leaflet's own tile-fade
      // quirk — see the .w-radar .leaflet-tile rule) and only once it
      // reports fully loaded does it become visible and the old layer get
      // removed — there's always a fully-painted frame on screen, so no gap
      // to flash, and no fade either since the opacity jump isn't animated.
      // maxNativeZoom: 7 — RainViewer's radar tiles only exist up to zoom 7;
      // at the widget's max zoom setting (8) Leaflet automatically upscales
      // the z7 tiles instead of requesting a z8 tile that doesn't exist.
      const newLayer = L.tileLayer(url, { opacity: 0, zIndex: 10, maxNativeZoom: 7 });
      newLayer.once('load', () => {
        frameLoading = false;
        if (version !== frameVersion) { map.removeLayer(newLayer); return; } // superseded before it finished loading
        // Set opacity directly on each layer's own single container element,
        // not via Leaflet's setOpacity() — that method applies opacity
        // TILE-BY-TILE internally (iterating every individual tile <img> in
        // the layer), which is one atomic-looking call from the outside but
        // isn't necessarily one atomic PAINT on the actual screen, especially
        // under any load. Setting opacity on the single wrapping container
        // div per layer (what getContainer() returns) means each swap is
        // truly one property change on one element, not N changes across N
        // tiles that could paint slightly out of step with each other.
        const newContainer = newLayer.getContainer();
        if (newContainer) { newContainer.style.transition = 'none'; newContainer.style.opacity = String(opacity); }
        const oldLayer = radarLayer;
        if (oldLayer) {
          const oldContainer = oldLayer.getContainer();
          if (oldContainer) { oldContainer.style.transition = 'none'; oldContainer.style.opacity = '0'; }
        }
        radarLayer = newLayer;
        // The actual DOM removal of the old layer's tiles happens on the
        // NEXT frame, after the browser has already painted the visual
        // swap above — decoupling "make the new one visible, hide the old
        // one" (cheap, one property each) from "tear down the old layer's
        // DOM" (heavier — iterates and removes every tile) means the
        // teardown work can never compete with or delay the swap itself.
        if (oldLayer) requestAnimationFrame(() => map.removeLayer(oldLayer));
      });
      newLayer.addTo(map);
    }

    fetch('/api/radar-frames').then(r => r.json()).then(data => {
      if (!data || !data.frames || !data.frames.length) return;
      // Re-check the container is still the live one for this id — the fetch
      // above is async, and a fast subsequent refresh could have already
      // torn this exact instance down (see the top of this forEach) by the
      // time it resolves.
      if (radarMapInstances.get(id) !== map) return;
      const frameCount = w.radarAnimate ? Math.max(2, Math.min(20, parseInt(w.radarFrameCount) || 6)) : 1;
      const frames = data.frames.slice(-frameCount);
      let i = frames.length - 1; // start on the most recent frame
      showFrame(data.host, frames[i]);
      if (w.radarAnimate && frames.length > 1) {
        // Buffer EVERY frame's tiles fully before the animation loop starts
        // moving at all — not just fire-and-forget in the background. The
        // previous version preloaded everything in parallel but let the
        // interval start immediately regardless, so on a congested/slow
        // connection a frame could still come up in the visible loop before
        // its own preload had actually finished, landing right back on the
        // gap this was meant to prevent. Concurrency is capped at 3 rather
        // than firing all of them at once — a dozen-plus simultaneous tile
        // layers (each itself several individual tile requests) fighting
        // over the browser's ~6-connections-per-host limit and a Pi's
        // limited resources was plausibly making things WORSE, not better.
        function preloadFrame(path) {
          return new Promise(resolve => {
            if (radarMapInstances.get(id) !== map) { resolve(); return; } // torn down mid-preload
            const probe = L.tileLayer(`${data.host}${path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: 7 });
            probe.once('load', () => { map.removeLayer(probe); resolve(); });
            probe.addTo(map);
          });
        }
        const toPreload = frames.filter((f, idx) => idx !== i); // the shown one is already loading via showFrame() above
        let nextIdx = 0;
        async function preloadWorker() {
          while (nextIdx < toPreload.length) {
            const f = toPreload[nextIdx++];
            if (radarMapInstances.get(id) !== map) return; // torn down mid-preload
            await preloadFrame(f.path);
          }
        }
        Promise.all([preloadWorker(), preloadWorker(), preloadWorker()]).then(() => {
          if (radarMapInstances.get(id) !== map) return; // torn down while buffering
          const timer = setInterval(() => {
            // Skip this tick entirely if the previous frame's tiles are still
            // loading (shouldn't normally happen now that everything was
            // buffered up front, but stays as a safety net for e.g. a frame
            // list refresh mid-animation) — starting another load on top of
            // an in-flight one just piles up abandoned, half-loaded layers
            // instead of ever letting one actually finish and display
            // smoothly. Better to hold the current frame a little longer.
            if (frameLoading) return;
            i = (i + 1) % frames.length;
            showFrame(data.host, frames[i]);
          }, 800);
          radarAnimTimers.set(id, timer);
        });
      }
    }).catch(() => {
      if (radarMapInstances.get(id) === map) {
        L.popup({ closeButton: false, autoClose: false })
          .setLatLng([lat, lon]).setContent('Radar unavailable').openOn(map);
      }
    });
  });
}


// ── Moon Phase widget ────────────────────────────────────────────────────────
// Computed with a standard synodic-month approximation from a known new moon
// reference — no network call, works offline, always available.
const MOON_PHASES = [
  { max: 0.033, name: 'New Moon', icon: '🌑' },
  { max: 0.25,  name: 'Waxing Crescent', icon: '🌒' },
  { max: 0.283, name: 'First Quarter', icon: '🌓' },
  { max: 0.467, name: 'Waxing Gibbous', icon: '🌔' },
  { max: 0.533, name: 'Full Moon', icon: '🌕' },
  { max: 0.717, name: 'Waning Gibbous', icon: '🌖' },
  { max: 0.75,  name: 'Last Quarter', icon: '🌗' },
  { max: 0.967, name: 'Waning Crescent', icon: '🌘' },
  { max: 1.001, name: 'New Moon', icon: '🌑' },
];
const SYNODIC_MONTH_DAYS = 29.530588853;
// A known new moon: Jan 6, 2000, 18:14 UTC.
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);
function moonPhaseFraction(date = new Date()) {
  const daysSince = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  let frac = (daysSince % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
  if (frac < 0) frac += 1;
  return frac;
}
function moonPhaseInfo(frac) {
  return MOON_PHASES.find(p => frac <= p.max) || MOON_PHASES[MOON_PHASES.length - 1];
}
function renderMoonPhase(widget) {
  const w = widget || {};
  const fontPx = w.mpFontPx || 20;
  const frac = moonPhaseFraction(new Date());
  const info = moonPhaseInfo(frac);
  // Illumination approximated from phase angle — 0% at new, 100% at full.
  const illumination = Math.round((1 - Math.cos(frac * 2 * Math.PI)) * 50);
  const showIllum = w.mpShowIllum !== false;
  const showAge = !!w.mpShowAge;
  const ageDays = Math.round(frac * SYNODIC_MONTH_DAYS);
  return `<div class="w-moonphase" style="--mp-font:calc(${fontPx}px * var(--ui-scale,1))">
    <div class="mp-icon">${info.icon}</div>
    <div class="mp-name">${info.name}</div>
    ${showIllum ? `<div class="mp-illum">${illumination}% illuminated</div>` : ''}
    ${showAge ? `<div class="mp-age">Day ${ageDays} of the lunar cycle</div>` : ''}
  </div>`;
}

// ── Air Quality / Pollen / UV widget ─────────────────────────────────────────
function renderAirQuality(widget) {
  const w = widget || {};
  const fontPx = w.aqFontPx || 18;
  const style = `--aq-font:calc(${fontPx}px * var(--ui-scale,1))`;
  if (!state.airQuality) {
    if (state.airQualityError) {
      return `<div class="w-airquality" style="${style}"><div class="aq-head">Air Quality</div><div class="no-data">${escapeHtmlD(state.airQualityError)}</div></div>`;
    }
    return `<div class="w-airquality" style="${style}"><div class="aq-head">Air Quality</div><div class="no-data">Loading…</div></div>`;
  }
  const data = state.airQuality;
  const showUV = w.aqShowUV !== false;
  const showPollen = w.aqShowPollen !== false;
  const pollenRows = [
    ['Grass', data.pollen?.grass], ['Birch', data.pollen?.birch], ['Ragweed', data.pollen?.ragweed],
  ].filter(([, v]) => v != null && v > 0);
  return `<div class="w-airquality" style="${style}">
    <div class="aq-head">Air Quality</div>
    <div class="aq-main">
      <div class="aq-aqi" style="color:${data.aqiInfo.color}">${data.aqi != null ? data.aqi : '—'}</div>
      <div class="aq-label" style="color:${data.aqiInfo.color}">${escapeHtmlD(data.aqiInfo.label)}</div>
    </div>
    <div class="aq-details">
      ${data.pm2_5 != null ? `<div class="aq-item"><span>PM2.5</span><span>${Math.round(data.pm2_5)} µg/m³</span></div>` : ''}
      ${data.pm10 != null ? `<div class="aq-item"><span>PM10</span><span>${Math.round(data.pm10)} µg/m³</span></div>` : ''}
      ${showUV && data.uv != null ? `<div class="aq-item"><span>UV Index</span><span style="color:${data.uvInfo.color}">${data.uv} · ${escapeHtmlD(data.uvInfo.label)}</span></div>` : ''}
      ${showPollen && pollenRows.length ? pollenRows.map(([name, v]) => `<div class="aq-item"><span>${name} pollen</span><span>${Math.round(v)}</span></div>`).join('') : ''}
    </div>
  </div>`;
}

// ── Travel Time widget ───────────────────────────────────────────────────────
const TRAVEL_MODE_ICON = { driving: '🚗', walking: '🚶', bicycling: '🚴' };
function renderTravelTime(widget) {
  const w = widget || {};
  const fontPx = w.travelFontPx || 18;
  const style = `--tv-font:calc(${fontPx}px * var(--ui-scale,1))`;
  const label = w.travelLabel || 'Travel Time';
  const icon = TRAVEL_MODE_ICON[w.travelMode] || TRAVEL_MODE_ICON.driving;
  if (!w.travelOrigin || !w.travelDestination) {
    return `<div class="w-travel" style="${style}"><div class="tv-label">${escapeHtmlD(label)}</div><div class="no-data">Set an origin and destination in this widget's settings</div></div>`;
  }
  const data = (state.travelTimes || {})[w.id];
  const err = (state.travelTimesError || {})[w.id];
  if (!data) {
    if (err) return `<div class="w-travel" style="${style}"><div class="tv-label">${escapeHtmlD(label)}</div><div class="no-data">${escapeHtmlD(err)}</div></div>`;
    return `<div class="w-travel" style="${style}"><div class="tv-label">${escapeHtmlD(label)}</div><div class="no-data">Loading…</div></div>`;
  }
  return `<div class="w-travel" style="${style}">
    <div class="tv-label">${escapeHtmlD(label)}</div>
    <div class="tv-mode">${icon}</div>
    <div class="tv-duration">${data.durationMin}<span class="unit">min</span></div>
    <div class="tv-distance">${data.distanceMiles} mi</div>
    <div class="tv-traffic-tag ${data.trafficAware ? 'live' : 'typical'}">${data.trafficAware ? '● Live traffic' : 'Typical time'}</div>
  </div>`;
}

// ── Home Assistant Entity Status (Tier 1: single read-only entity) ─────────
// Data comes from state.haEntities (populated by fetchHaEntities() below,
// same "collect what's actually needed, fetch in parallel, cache by key"
// shape as fetchWeather() above) — this function just reads whatever's
// already there, same division of responsibility as every other widget here.
// Domains this app knows how to CONTROL, not just display — anything else
// (sensor, binary_sensor, etc.) falls back to Tier 1's original read-only
// rendering below. Grouped by which of the three control shapes they use.
const HA_TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean']);
const HA_CLIMATE_DOMAINS = new Set(['climate']);
const HA_TRIGGER_DOMAINS = new Set(['scene', 'script']);
function haDomainOf(entityId) { return (entityId || '').split('.')[0]; }
// Simple domain → emoji mapping for the Icon-only and Card dashboard views
// below. HA itself has a much richer per-entity icon system (Material
// Design Icons, per-device overrides) — we don't fetch any of that (the
// trimmed /api/ha/state response never included it, and pulling it in would
// mean a real new fetch+render pipeline for a purely cosmetic touch), so
// this is a deliberately coarse, domain-level fallback instead. An area
// tile always gets the room emoji — it represents a whole space, not any
// one entity's domain.
const HA_DOMAIN_ICONS = {
  light: '💡', switch: '🔌', fan: '🌀', input_boolean: '🔘',
  climate: '🌡️', scene: '🎬', script: '▶️',
  lock: '🔒', cover: '🪟', media_player: '📺', sensor: '📊', binary_sensor: '📊',
};
function haDomainIcon(domain) { return HA_DOMAIN_ICONS[domain] || '🏠'; }

// Shared control markup for a single HA entity — factored out of
// renderEntityStatus (Tier 2) so Tier 4's multi-entity dashboard can reuse the
// exact same toggle/climate/trigger/readonly markup and CSS classes instead of
// re-implementing them. Reusing the SAME class names (ha-toggle-switch,
// ha-temp-btn, ha-trigger-btn) is deliberate beyond just style reuse: it means
// wireEntityStatusTaps() — which queries by those class names — automatically
// wires up dashboard tiles too, with zero new tap-handling code needed.
// `label`/`showUnit` are passed in rather than read off a single widget, since
// the dashboard has many entities (and many labels) per widget, not one.
function renderHaEntityControl(entityId, data, label, showUnit, wAttrs, sparkline) {
  if (!data) return `<div class="ha-label">${escapeHtmlD(label)}</div><div class="no-data">Loading…</div>`;
  if (data.error) return `<div class="ha-label">${escapeHtmlD(label)}</div><div class="no-data">${escapeHtmlD(data.error)}</div>`;
  const domain = haDomainOf(entityId);

  if (HA_TOGGLE_DOMAINS.has(domain)) {
    const isOn = data.state === 'on';
    // A dimmable light, or a fan with a variable speed, that's currently on
    // gets a slider under the switch. Light `brightness` is HA's 0-255; fan
    // `percentage` is already 0-100. Both shown/sent as a percent.
    let slider = null; // { pct, action, param, aria }
    if (isOn && domain === 'light' && typeof data.brightness === 'number') {
      slider = { pct: Math.max(1, Math.round(data.brightness / 255 * 100)),
        action: 'set_brightness', param: 'brightness_pct', aria: 'Brightness' };
    } else if (isOn && domain === 'fan' && typeof data.fanPercentage === 'number') {
      slider = { pct: Math.max(1, Math.round(data.fanPercentage)),
        action: 'set_fan_speed', param: 'fan_pct', aria: 'Speed' };
    }
    // Colour controls for an on light: a warm↔cool slider if it's a
    // tunable-white light, and a strip of preset swatches if it does colour.
    const modes = Array.isArray(data.colorModes) ? data.colorModes : [];
    const extras = [];
    if (isOn && domain === 'light' && typeof data.colorTempK === 'number' && modes.includes('color_temp')) {
      const lo = data.minColorTempK || 2000, hi = data.maxColorTempK || 6500;
      extras.push(`<input type="range" class="ha-bright-slider ha-ct-slider" min="${lo}" max="${hi}" value="${Math.round(data.colorTempK)}"
        data-entity-id="${escapeHtmlD(entityId)}" data-ha-action="set_color_temp" data-ha-param="kelvin"
        data-interactive="1"${wAttrs} aria-label="Colour temperature for ${escapeHtmlD(label)}">`);
    }
    if (isOn && domain === 'light' && (modes.includes('hs') || modes.includes('rgb') || modes.includes('xy') || modes.includes('rgbw') || modes.includes('rgbww'))) {
      const SWATCHES = ['255,86,86', '255,170,60', '255,236,120', '120,220,120', '110,180,255', '190,130,255', '255,255,255'];
      extras.push(`<div class="ha-swatch-row">` + SWATCHES.map(rgb =>
        `<button type="button" class="ha-swatch" data-entity-id="${escapeHtmlD(entityId)}" data-ha-action="set_color" data-ha-rgb="${rgb}"
          data-interactive="1"${wAttrs} aria-label="Set colour" style="background:rgb(${rgb})"></button>`).join('') + `</div>`);
    }
    return `<div class="ha-label">${escapeHtmlD(label)}</div>
      <button type="button" class="ha-toggle-switch ${isOn ? 'on' : 'off'}" data-entity-id="${escapeHtmlD(entityId)}"
        data-interactive="1"${wAttrs} aria-label="Toggle ${escapeHtmlD(label)}">
        <span class="ha-toggle-knob"></span>
      </button>
      ${slider ? `<input type="range" class="ha-bright-slider" min="1" max="100" value="${slider.pct}"
        data-entity-id="${escapeHtmlD(entityId)}" data-ha-action="${slider.action}" data-ha-param="${slider.param}"
        data-interactive="1"${wAttrs} aria-label="${slider.aria} for ${escapeHtmlD(label)}">` : ''}
      ${extras.join('')}
      <div class="ha-toggle-state">${isOn ? (slider ? slider.pct + '%' : 'On') : 'Off'}</div>`;
  }

  if (HA_CLIMATE_DOMAINS.has(domain)) {
    const target = data.targetTemp;
    const current = data.currentTemp;
    const hasTarget = typeof target === 'number';
    return `<div class="ha-label">${escapeHtmlD(label)}</div>
      <div class="ha-climate-row">
        <button type="button" class="ha-temp-btn ha-temp-down" data-entity-id="${escapeHtmlD(entityId)}"
          data-interactive="1"${wAttrs} aria-label="Lower temperature" ${hasTarget ? '' : 'disabled'}>−</button>
        <div class="ha-climate-readout">
          <div class="ha-climate-target">${hasTarget ? Math.round(target) + '°' : '—'}</div>
          ${typeof current === 'number' ? `<div class="ha-climate-current">now ${Math.round(current)}°</div>` : ''}
        </div>
        <button type="button" class="ha-temp-btn ha-temp-up" data-entity-id="${escapeHtmlD(entityId)}"
          data-interactive="1"${wAttrs} aria-label="Raise temperature" ${hasTarget ? '' : 'disabled'}>+</button>
      </div>`;
  }

  if (HA_TRIGGER_DOMAINS.has(domain)) {
    return `<div class="ha-label">${escapeHtmlD(label)}</div>
      <button type="button" class="ha-trigger-btn" data-entity-id="${escapeHtmlD(entityId)}"
        data-interactive="1"${wAttrs}>▶ ${domain === 'scene' ? 'Set Scene' : 'Run'}</button>`;
  }

  if (domain === 'cover') {
    const st = (data.state || '').toLowerCase();
    const stText = st === 'open' ? 'Open' : st === 'closed' ? 'Closed'
      : st ? st.charAt(0).toUpperCase() + st.slice(1) : '—';
    const b = (act, glyph, aria) => `<button type="button" class="ha-action-btn" data-entity-id="${escapeHtmlD(entityId)}"
      data-ha-action="${act}" data-interactive="1"${wAttrs} aria-label="${aria} ${escapeHtmlD(label)}">${glyph}</button>`;
    return `<div class="ha-label">${escapeHtmlD(label)}</div>
      <div class="ha-cover-row">${b('open_cover', '▲', 'Open')}${b('stop_cover', '■', 'Stop')}${b('close_cover', '▼', 'Close')}</div>
      <div class="ha-toggle-state">${escapeHtmlD(stText)}</div>`;
  }

  if (domain === 'lock') {
    const locked = data.state === 'locked';
    const st = data.state === 'unlocked' ? 'Unlocked' : locked ? 'Locked' : (data.state || '—');
    return `<div class="ha-label">${escapeHtmlD(label)}</div>
      <button type="button" class="ha-action-btn ha-lock-btn" data-entity-id="${escapeHtmlD(entityId)}"
        data-ha-action="${locked ? 'unlock' : 'lock'}" data-interactive="1"${wAttrs}>${locked ? '🔓 Unlock' : '🔒 Lock'}</button>
      <div class="ha-toggle-state">${escapeHtmlD(st)}</div>`;
  }

  if (domain === 'media_player') {
    const st = (data.state || '').toLowerCase();
    const playing = st === 'playing';
    const active = playing || st === 'paused' || st === 'buffering';
    const b = (act, glyph, aria) => `<button type="button" class="ha-action-btn" data-entity-id="${escapeHtmlD(entityId)}"
      data-ha-action="${act}" data-interactive="1"${wAttrs} aria-label="${aria}">${glyph}</button>`;
    const volPct = typeof data.volumeLevel === 'number' ? Math.round(data.volumeLevel * 100) : null;
    const stText = active ? (playing ? 'Playing' : 'Paused')
      : st ? st.charAt(0).toUpperCase() + st.slice(1) : '—';
    return `<div class="ha-label">${escapeHtmlD(label)}</div>
      ${data.mediaTitle ? `<div class="ha-media-title">${escapeHtmlD(data.mediaTitle)}</div>` : ''}
      <div class="ha-media-row">
        ${b('media_previous_track', '⏮', 'Previous track')}
        ${b('media_play_pause', playing ? '⏸' : '▶', playing ? 'Pause' : 'Play')}
        ${b('media_next_track', '⏭', 'Next track')}
      </div>
      ${volPct != null ? `<input type="range" class="ha-bright-slider" min="0" max="100" value="${volPct}"
        data-entity-id="${escapeHtmlD(entityId)}" data-ha-action="volume_set" data-ha-param="volume_pct"
        data-interactive="1"${wAttrs} aria-label="Volume for ${escapeHtmlD(label)}">` : ''}
      <div class="ha-toggle-state">${escapeHtmlD(stText)}</div>`;
  }

  // Tier 1 fallback: anything else stays read-only, exactly as before —
  // plus, for a numeric sensor in the Entity Status widget, a 24h sparkline
  // (filled in after render by wireHaSparklines()).
  const numeric = Number.isFinite(parseFloat(data.state));
  const spark = (sparkline && domain === 'sensor' && numeric)
    ? `<div class="ha-sparkline" data-entity-id="${escapeHtmlD(entityId)}"></div>` : '';
  return `<div class="ha-label">${escapeHtmlD(label)}</div>
    <div class="ha-value">${escapeHtmlD(data.state)}${(showUnit && data.unit) ? `<span class="ha-unit">${escapeHtmlD(data.unit)}</span>` : ''}</div>
    ${spark}`;
}

// "2 hr. ago"-style line for how long an entity has been in its current state (Home Assistant's last_changed), in the display language.
// Recomputed every time the widget redraws, which happens on each Home Assistant refresh.
function haSinceText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  let n = 0, unit = 'minute';
  for (const [u, s] of units) { if (sec >= s) { n = Math.floor(sec / s); unit = u; break; } }
  if (sec < 60) return 'just now'; // the page's own text translation handles this one
  try { return new Intl.RelativeTimeFormat((window.i18n && i18n.lang) || undefined, { numeric: 'always', style: 'short' }).format(-n, unit); }
  catch (e) { return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago'; }
}
// Template output is plain text, except that **words between double asterisks** are bold. The text is escaped first and only then are the pairs turned into <strong>,
// so a template can never inject markup. A lone ** stays as typed; a pair never spans a line break.
function haTemplateHtml(text) {
  return escapeHtmlD(text).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
}
function haSinceHtml(iso) {
  const txt = haSinceText(iso);
  return txt ? `<div class="ha-since">${escapeHtmlD(txt)}</div>` : '';
}

function renderEntityStatus(widget) {
  const w = widget || {};
  const fontPx = w.haFontPx || 20;
  const style = `--ha-font:calc(${fontPx}px * var(--ui-scale,1))`;
  // A Template (Home Assistant syntax) replaces the entity control with the text Home Assistant makes of it; no entity needed.
  const tpl = String(w.haTemplate || '').trim();
  if (tpl) {
    const t = (state.haTemplates || {})[tpl];
    const body = !t ? 'Loading…' : (t.error ? `<span class="no-data">${escapeHtmlD(t.error)}</span>` : haTemplateHtml(t.text));
    const alignClass = w.haAlign === 'left' || w.haAlign === 'right' ? ' ha-align-' + w.haAlign : '';
    return `<div class="w-entitystatus ha-template-layout${alignClass}" style="${style}">${w.haLabel ? `<div class="ha-label">${escapeHtmlD(w.haLabel)}</div>` : ''}<div class="ha-template">${body}</div></div>`;
  }
  if (!w.haEntityId) {
    return `<div class="w-entitystatus" style="${style}"><div class="no-data">Choose an entity in this widget's settings</div></div>`;
  }
  const data = (state.haEntities || {})[w.haEntityId];
  const label = w.haLabel || (data && data.friendly_name) || w.haEntityId;
  const domain = haDomainOf(w.haEntityId);
  const wAttrs = w.id != null ? ` data-widget-id="${w.id}"` : '';
  const layoutClass = HA_TOGGLE_DOMAINS.has(domain) ? ' ha-toggle-layout'
    : HA_CLIMATE_DOMAINS.has(domain) ? ' ha-climate-layout'
    : HA_TRIGGER_DOMAINS.has(domain) ? ' ha-trigger-layout'
    : domain === 'cover' ? ' ha-climate-layout'
    : domain === 'lock' ? ' ha-trigger-layout'
    : domain === 'media_player' ? ' ha-climate-layout' : '';
  const since = (w.haShowSince && data && !data.error) ? haSinceHtml(data.changed) : '';
  return `<div class="w-entitystatus${layoutClass}" style="${style}">${renderHaEntityControl(w.haEntityId, data, label, w.haShowUnit !== false, wAttrs, w.haShowSparkline !== false)}${since}</div>`;
}

// ── Group Control widget ────────────────────────────────────────────────────
// A single tile that controls MULTIPLE entities together as ONE group action
// (e.g. "turn a whole floor off") — deliberately distinct from the Smart
// Home Dashboard widget, which shows multiple entities individually
// controlled. w.gcEntityIds is a flat array of plain entity_id strings — no
// per-entity room label needed here, unlike the dashboard, since this
// widget never displays members individually, only the combined state.
// "On" reads as true if ANYTHING in the group is currently on (matches how
// a real light-group switch usually reads); tapping works out the correct
// single target action itself — see call-group-action's own comment for
// why this can't just blindly use HA's toggle service on a mixed group.
function renderGroupControl(widget) {
  const w = widget || {};
  const fontPx = w.gcFontPx || 20;
  const style = `--ha-font:calc(${fontPx}px * var(--ui-scale,1))`;
  // Combines individually-picked entities with whatever's CURRENTLY in any
  // selected areas, resolved fresh every render (see resolveAreaMemberIds()
  // — this is the live behavior, not a one-time snapshot). Deduped via Set
  // since an individually-picked entity might also happen to be in a
  // selected area.
  const idSet = new Set(Array.isArray(w.gcEntityIds) ? w.gcEntityIds : []);
  if (Array.isArray(w.gcAreaIds) && w.gcAreaIds.length) {
    resolveAreaMemberIds(w.gcAreaIds).forEach(id => idSet.add(id));
  }
  const ids = [...idSet];
  if (!ids.length) {
    return `<div class="w-groupcontrol" style="${style}"><div class="no-data">Choose entities or an area in this widget's settings</div></div>`;
  }
  const haEntities = state.haEntities || {};
  const known = ids.filter(id => haEntities[id] && !haEntities[id].error);
  const onCount = known.filter(id => haEntities[id].state === 'on').length;
  const isOn = onCount > 0;
  const label = w.gcTitle || 'Group';
  const countText = known.length ? `${onCount} of ${known.length} on` : 'Unavailable';
  const wAttrs = w.id != null ? ` data-widget-id="${w.id}"` : '';
  return `<div class="w-groupcontrol" style="${style}">
    <div class="ha-label">${escapeHtmlD(label)}</div>
    <button type="button" class="ha-toggle-switch ${isOn ? 'on' : 'off'}" data-group-ids="${escapeHtmlD(JSON.stringify(ids))}"
      data-interactive="1"${wAttrs} aria-label="Toggle ${escapeHtmlD(label)}">
      <span class="ha-toggle-knob"></span>
    </button>
    <div class="ha-toggle-state">${escapeHtmlD(countText)}</div>
  </div>`;
}

// ── Dashboard alternate views (List / Icon-only / Card / Tap-card) ─────────
// The Grid view (default, w.haDashView unset or 'grid') keeps its EXACT
// original markup/behavior below, completely untouched — these are
// additive, not a rewrite of what's already shipped and working. Every
// view shares the same underlying data (individual entities + resolved
// live area membership); only the per-item HTML changes.
//
// Toggle-like items (lights/switches/fans/input_booleans, and EVERY area —
// an area is always a combined toggle by definition) get full support in
// all five views via renderDashToggleTile() below. Anything else (climate,
// scene/script, sensors) falls back: Icon-only shows just an icon + tiny
// value with no interactivity (no room for a stepper/button at that size);
// every other alternate view embeds the exact same full-featured control
// markup renderHaEntityControl() already produces (climate steppers,
// trigger buttons, read-only values) inside that view's own wrapper —
// reused as-is, not reimplemented per view. Tap-card specifically also
// falls back to the Card layout for non-toggle items, since "tap anywhere"
// doesn't make sense for a stepper that needs its own +/- targets.
function haDashItemIsToggleLike(desc) {
  if (desc.isArea) return true;
  return HA_TOGGLE_DOMAINS.has(haDomainOf(desc.id));
}
function renderDashToggleTile(view, label, isOn, stateText, targetAttr, icon) {
  if (view === 'list') {
    return `<div class="ha-dash-list-row">
      <span class="ha-label">${escapeHtmlD(label)}</span>
      <span class="ha-dash-state-text">${escapeHtmlD(stateText)}</span>
      <button type="button" class="ha-toggle-switch ${isOn ? 'on' : 'off'}" ${targetAttr} data-interactive="1" aria-label="Toggle ${escapeHtmlD(label)}">
        <span class="ha-toggle-knob"></span>
      </button>
    </div>`;
  }
  if (view === 'icon') {
    return `<div class="ha-dash-icon-item">
      <button type="button" class="ha-dash-icon-circle ${isOn ? 'on' : ''}" ${targetAttr} data-interactive="1" aria-label="Toggle ${escapeHtmlD(label)}" style="border-radius:50%;cursor:pointer;touch-action:manipulation">${icon}</button>
      <div class="ha-dash-icon-label">${escapeHtmlD(label)}</div>
    </div>`;
  }
  if (view === 'tapcard') {
    return `<button type="button" class="ha-dash-tapcard ${isOn ? 'on' : ''}" ${targetAttr} data-interactive="1" aria-label="Toggle ${escapeHtmlD(label)}">
      <div class="ha-dash-card-icon">${icon}</div>
      <div class="ha-dash-card-mid"><div class="ha-label">${escapeHtmlD(label)}</div></div>
      <div class="ha-dash-card-state">${escapeHtmlD(isOn ? 'On' : 'Off')}</div>
    </button>`;
  }
  // card
  return `<div class="ha-dash-card-row">
    <div class="ha-dash-card-icon">${icon}</div>
    <div class="ha-dash-card-mid"><div class="ha-label">${escapeHtmlD(label)}</div><div class="ha-dash-meta">${escapeHtmlD(stateText)}</div></div>
    <button type="button" class="ha-toggle-switch ${isOn ? 'on' : 'off'}" ${targetAttr} data-interactive="1" aria-label="Toggle ${escapeHtmlD(label)}">
      <span class="ha-toggle-knob"></span>
    </button>
  </div>`;
}
// Renders one dashboard tile — an individual entity or a whole-area
// combined toggle — for whichever view is active. desc is either
// { isArea:false, id } or { isArea:true, areaId, name }.
function renderDashItem(view, desc) {
  const haEntities = state.haEntities || {};
  if (desc.isCombo) {
    const memberIds = resolveComboMemberIds(desc.combo);
    const known = memberIds.filter(id => haEntities[id] && !haEntities[id].error);
    const onCount = known.filter(id => haEntities[id].state === 'on').length;
    const isOn = onCount > 0;
    const countText = known.length ? `${onCount} of ${known.length} on` : 'Unavailable';
    const groupAttr = `data-group-ids="${escapeHtmlD(JSON.stringify(memberIds))}"`;
    const name = desc.combo.name || 'Group';
    if (view === 'grid' || !view) {
      return `<div class="ha-dash-item">
        <div class="ha-label">${escapeHtmlD(name)}</div>
        <button type="button" class="ha-toggle-switch ${isOn ? 'on' : 'off'}" ${groupAttr} data-interactive="1" aria-label="Toggle ${escapeHtmlD(name)}">
          <span class="ha-toggle-knob"></span>
        </button>
        <div class="ha-toggle-state">${escapeHtmlD(countText)}</div>
      </div>`;
    }
    return renderDashToggleTile(view, name, isOn, countText, groupAttr, '🎚️');
  }
  if (desc.isArea) {
    const memberIds = resolveAreaMemberIds([desc.areaId]);
    const known = memberIds.filter(id => haEntities[id] && !haEntities[id].error);
    const onCount = known.filter(id => haEntities[id].state === 'on').length;
    const isOn = onCount > 0;
    const countText = known.length ? `${onCount} of ${known.length} on` : 'Unavailable';
    const groupAttr = `data-group-ids="${escapeHtmlD(JSON.stringify(memberIds))}"`;
    if (view === 'grid' || !view) {
      return `<div class="ha-dash-item">
        <div class="ha-label">${escapeHtmlD(desc.name)}</div>
        <button type="button" class="ha-toggle-switch ${isOn ? 'on' : 'off'}" ${groupAttr} data-interactive="1" aria-label="Toggle ${escapeHtmlD(desc.name)}">
          <span class="ha-toggle-knob"></span>
        </button>
        <div class="ha-toggle-state">${escapeHtmlD(countText)}</div>
      </div>`;
    }
    return renderDashToggleTile(view, desc.name, isOn, countText, groupAttr, '🏠');
  }

  const data = haEntities[desc.id];
  const domain = haDomainOf(desc.id);
  const label = (data && data.friendly_name) || desc.id;

  if (view === 'grid' || !view) {
    return `<div class="ha-dash-item">${renderHaEntityControl(desc.id, data, label, true, '')}</div>`;
  }
  if (haDashItemIsToggleLike(desc) && data && !data.error) {
    const isOn = data.state === 'on';
    const entAttr = `data-entity-id="${escapeHtmlD(desc.id)}"`;
    return renderDashToggleTile(view, label, isOn, (data.state === 'on' ? 'On' : data.state === 'off' ? 'Off' : data.state), entAttr, haDomainIcon(domain));
  }
  if (view === 'icon') {
    const valueText = data && !data.error ? (data.state + (data.unit ? ' ' + data.unit : '')) : ((data && data.error) || '…');
    return `<div class="ha-dash-icon-item">
      <div class="ha-dash-icon-circle" title="${escapeHtmlD(valueText)}">${haDomainIcon(domain)}</div>
      <div class="ha-dash-icon-label">${escapeHtmlD(label)}</div>
    </div>`;
  }
  const controlHtml = renderHaEntityControl(desc.id, data, label, true, '');
  if (view === 'list') return `<div class="ha-dash-list-row">${controlHtml}</div>`;
  // card, and tapcard's non-toggle fallback
  return `<div class="ha-dash-card-row">
    <div class="ha-dash-card-icon">${haDomainIcon(domain)}</div>
    <div class="ha-dash-card-mid">${controlHtml}</div>
  </div>`;
}
// Wraps a run of already-rendered tile HTML in whatever container each view
// needs — Grid and Icon-only use a CSS grid, everything else is a plain
// vertical stack (each row/card already carries its own spacing/dividers).
function wrapDashItems(view, itemsHtml) {
  if (view === 'icon') return `<div class="ha-dash-icon-grid">${itemsHtml}</div>`;
  if (view === 'grid' || !view) return `<div class="ha-dash-grid">${itemsHtml}</div>`;
  return itemsHtml;
}

// ── Tier 4: multi-entity dashboard ────────────────────────────────────────
// w.haEntityIds is an array of { id, room } — room is an optional free-text
// label the person chose when picking entities in app.html's settings panel;
// '' means "no room set". When w.haGroupByRoom is on (default) and at least
// one entity actually has a room, entities are grouped into per-room
// sections (an "Other" section catches anything without one); otherwise it's
// a single flat grid, same as if grouping were simply off. Icon-only always
// stays flat regardless of this setting — room headers would defeat the
// point of that view's density.
// w.haAreaIds is separate — a selected area renders as ONE combined toggle
// tile for everything in it (identical markup/behavior to the Group Control
// widget's own tile, including reusing the same data-group-ids tap-wiring
// path), not expanded into individual entity rows. An area is a single
// switch for "everything in this room," not a shortcut for picking each of
// its entities one by one — that's what individually picking entities is
// for. Area tiles always sit in their own section, since each one already
// carries the area's own name as its label — there's nothing further to
// group it under.
// w.haDashView picks which of the five view styles renders the body —
// 'grid' (default/unset), 'list', 'icon', 'card', or 'tapcard'. See the
// renderDashItem()/renderDashToggleTile() block above for how each renders.
function renderSmartHomeDashboard(widget) {
  const w = widget || {};
  const fontPx = w.haDashFontPx || 16;
  const style = `--ha-font:calc(${fontPx}px * var(--ui-scale,1))`;
  const view = w.haDashView || 'grid';
  const individualEntries = Array.isArray(w.haEntityIds) ? w.haEntityIds : [];
  const areaIds = Array.isArray(w.haAreaIds) ? w.haAreaIds : [];
  const comboGroups = Array.isArray(w.haComboGroups) ? w.haComboGroups : [];
  if (!individualEntries.length && !areaIds.length && !comboGroups.length) {
    return `<div class="w-smarthomedash" style="${style}">${w.haDashTitle ? `<div class="ha-dash-title">${escapeHtmlD(w.haDashTitle)}</div>` : ''}<div class="no-data">Choose entities or an area in this widget's settings</div></div>`;
  }

  const entityItemHtml = (entry) => renderDashItem(view, { isArea: false, id: entry.id });
  const areaItemHtml = (areaId) => {
    const area = cachedHaAreasD && cachedHaAreasD.areas.find(a => a.id === areaId);
    return renderDashItem(view, { isArea: true, areaId, name: area ? area.name : areaId });
  };
  const comboItemHtml = (combo) => renderDashItem(view, { isCombo: true, combo });

  // Combo groups get their own section, same reasoning as areas — each one
  // already carries its own name as its label, so there's nothing further
  // to group it under. Sits above the plain area tiles so a
  // deliberately-curated combined switch reads as the more prominent
  // option, not buried under individual single-area tiles.
  const combosHtml = comboGroups.length ? wrapDashItems(view, comboGroups.map(comboItemHtml).join('')) : '';
  const areasHtml = areaIds.length ? wrapDashItems(view, areaIds.map(areaItemHtml).join('')) : '';
  const anyRoomSet = individualEntries.some(e => e.room);
  let bodyHtml;
  if (view !== 'icon' && w.haGroupByRoom !== false && anyRoomSet) {
    // Preserve first-seen room order rather than alphabetizing, so the
    // layout stays stable/predictable as someone adds entities over time.
    const rooms = [];
    const byRoom = new Map();
    individualEntries.forEach(e => {
      const key = e.room || '';
      if (!byRoom.has(key)) { byRoom.set(key, []); rooms.push(key); }
      byRoom.get(key).push(e);
    });
    // "Other" (no room) sorts last regardless of when it was first seen.
    rooms.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : 0));
    const roomsHtml = rooms.map(room => `
      <div class="ha-dash-room">
        <h4>${escapeHtmlD(room || 'Other')}</h4>
        ${wrapDashItems(view, byRoom.get(room).map(entityItemHtml).join(''))}
      </div>`).join('');
    bodyHtml = combosHtml + areasHtml + roomsHtml;
  } else {
    bodyHtml = combosHtml + areasHtml + wrapDashItems(view, individualEntries.map(entityItemHtml).join(''));
  }
  return `<div class="w-smarthomedash" style="${style}">${w.haDashTitle ? `<div class="ha-dash-title">${escapeHtmlD(w.haDashTitle)}</div>` : ''}${bodyHtml}</div>`;
}

// Per-entity fetch sequence guard — state.haEntities is written from two
// independent places (the periodic fetchHaEntities() poll, and this
// function's own post-action confirm fetch), and nothing previously stopped
// an older, slower-to-resolve response from landing AFTER a newer one and
// clobbering it. Concretely: tap a toggle right as the 60s poll's request
// for that same entity is in flight, and the poll's response (captured
// BEFORE your tap, reflecting the pre-toggle state) could resolve AFTER
// your tap's own fresh-confirm fetch — silently overwriting the correct new
// state with the opposite, stale one. Root-caused from a user report of
// "quick taps sometimes show the opposite status."
// Fix: every fetch for a given entity stamps itself with the next sequence
// number at ISSUE time (not resolve time); a response only gets applied if
// it's still the latest one issued for that entity. An older response
// arriving late is simply discarded instead of being trusted.
const haEntityFetchSeq = {};
function nextHaSeq(entityId) {
  haEntityFetchSeq[entityId] = (haEntityFetchSeq[entityId] || 0) + 1;
  return haEntityFetchSeq[entityId];
}
// After an optimistic tap we "hold" the commanded state: HA's own entity
// state lags the service call, sometimes by many seconds (Z-Wave/Zigbee
// locks especially), so a read in that window still shows the OLD value and
// would snap the control back. While the hold is active, ignore any read
// that STILL reports the pre-tap value. Anything else — the new value, a
// transient ('unlocking'), 'jammed', an error — clears the hold and
// applies immediately. A generous cap stops a stuck hold from hiding
// reality forever.
const _haOptimisticHold = {}; // entityId -> { minUntil, until, want }
// States that mean "stop holding and show this" even if it isn't the target —
// a real problem the user needs to see, not a transient on the way there.
const HA_TERMINAL_STATES = new Set(['jammed', 'unavailable', 'unknown']);
function applyHaEntityState(entityId, mySeq, data) {
  if (haEntityFetchSeq[entityId] !== mySeq) return false; // superseded by a newer fetch already in flight/applied
  const hold = _haOptimisticHold[entityId];
  if (hold) {
    const now = Date.now();
    const st = data && data.state;
    const errored = !data || data.error;
    const terminal = st && HA_TERMINAL_STATES.has(st);
    // Only accept HA's own value once it's had time to settle on the REAL
    // state — a lock/cover often reports the target once (HA's optimistic
    // guess), bounces back to the old value for a beat, THEN lands on the
    // real one. Ignore everything (except a genuine error/jam) until minUntil,
    // then release the moment it confirms the target; hard cap at `until`.
    const settled = st === hold.want && now >= hold.minUntil;
    if (!(errored || terminal || settled || now >= hold.until)) return false;
    delete _haOptimisticHold[entityId];
  }
  state.haEntities = state.haEntities || {};
  state.haEntities[entityId] = data;
  return true;
}

// Best-guess of an entity's state right after an action, so the control can
// jump to the commanded position immediately and reconcile with the real
// value when the confirm fetch (and the next poll) lands. Returns a merged
// copy, or null when the outcome isn't predictable (e.g. a scene trigger).
function predictHaState(cur, action, extra) {
  const c = cur && !cur.error ? cur : {};
  const e = extra || {};
  const on = { ...c, state: 'on' };
  switch (action) {
    case 'toggle':     return { ...c, state: c.state === 'on' ? 'off' : 'on' };
    case 'turn_on':    return on;
    case 'turn_off':   return { ...c, state: 'off' };
    case 'lock':       return { ...c, state: 'locked' };
    case 'unlock':     return { ...c, state: 'unlocked' };
    case 'open_cover': return { ...c, state: 'open' };
    case 'close_cover':return { ...c, state: 'closed' };
    case 'media_play_pause':
      return { ...c, state: c.state === 'playing' ? 'paused' : 'playing' };
    case 'set_brightness':
      return { ...on, brightness: Math.round((Number(e.brightness_pct) || 0) / 100 * 255) };
    case 'set_fan_speed':
      return { ...on, fanPercentage: Number(e.fan_pct) || 0 };
    case 'volume_set':
      return { ...c, volumeLevel: (Number(e.volume_pct) || 0) / 100 };
    case 'set_color_temp':
      return { ...on, colorTempK: Number(e.kelvin) || c.colorTempK };
    case 'set_color': {
      const rgb = String(e.rgb || '').split(',').map(n => parseInt(n, 10));
      return rgb.length === 3 && rgb.every(Number.isFinite) ? { ...on, rgbColor: rgb } : on;
    }
    case 'set_temperature':
      return typeof e.temperature === 'number' ? { ...c, targetTemp: e.temperature } : null;
    default: return null; // trigger, set_scene, stop_cover, media_next/prev — nothing safe to assume
  }
}
// After a tap: jump the widget to the commanded state right away (seq-bumped
// so an in-flight poll can't undo it), fire the action, then reconcile with
// a fresh state fetch — on success OR failure, so a rejected action snaps
// back to reality instead of leaving the optimistic guess showing.
async function callHaAction(entityId, action, extra) {
  const cur = (state.haEntities || {})[entityId];
  const predicted = predictHaState(cur, action, extra);
  if (predicted) {
    // Hold the commanded state until HA reports something other than the
    // pre-tap value. Cap generously — covers/locks can take many seconds.
    const slowDomain = action === 'open_cover' || action === 'close_cover' || action === 'lock' || action === 'unlock';
    const now = Date.now();
    _haOptimisticHold[entityId] = {
      minUntil: now + (slowDomain ? 5000 : 1200),
      until:    now + (slowDomain ? 15000 : 6000),
      want: predicted.state,
    };
    const optSeq = nextHaSeq(entityId);
    if (applyHaEntityState(entityId, optSeq, predicted)) renderLayout();
  }
  const reconcile = async () => {
    try {
      const mySeq = nextHaSeq(entityId);
      const stateRes = await fetch(`/api/ha/state/${encodeURIComponent(entityId)}`);
      const fresh = await stateRes.json();
      if (applyHaEntityState(entityId, mySeq,
        (fresh && fresh.entity_id) ? fresh : { error: (fresh && fresh.error) || 'Unavailable' })) renderLayout();
    } catch {}
  };
  try {
    const body = { entityId, action, ...(extra || {}) };
    const r = await fetch('/api/ha/call-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      console.error('HA action failed:', data.error || r.status);
      delete _haOptimisticHold[entityId]; // let the truth back in
      try { if (typeof showDisplayToast === 'function') showDisplayToast('⚠ ' + (data.error || 'Home Assistant rejected that')); } catch {}
      await reconcile(); // undo the optimistic guess
      return false;
    }
    if (predicted) {
      // Don't reconcile immediately — an early read still shows the pre-tap
      // state and the hold above would just reject it anyway. Poll for the
      // real value a few times; the hold ignores any read still showing the
      // old state, so these are safe to fire early. Extra late reads for
      // slow domains (locks/covers) so we don't wait on the ambient poll.
      const slow = action === 'open_cover' || action === 'close_cover' || action === 'lock' || action === 'unlock';
      (slow ? [5500, 8000, 11000, 14000] : [1400, 3500]).forEach(ms => setTimeout(reconcile, ms));
    } else {
      await reconcile(); // trigger/scene/stop — nothing predicted to protect
    }
    return true;
  } catch (e) {
    console.error('HA action failed:', e);
    delete _haOptimisticHold[entityId];
    await reconcile();
    return false;
  }
}

// Group version of callHaAction() above, for the Group Control widget —
// works out the correct single target action itself (if ANYTHING in the
// group is currently on, turn everything off; only turn everything on if
// the whole group is off) since HA's toggle service can't be trusted with
// a mixed-state group (see call-group-action's own server-side comment for
// why). Re-fetches every member's fresh state afterward using the SAME
// sequence-guarded pattern as callHaAction — each entity gets its own
// independent stamp/apply, so a concurrent poll response for any ONE
// member can't clobber it, same protection extended to every entity in
// the group rather than just one.
async function callHaGroupAction(entityIds) {
  if (!Array.isArray(entityIds) || !entityIds.length) return false;
  const haEntities = state.haEntities || {};
  const anyOn = entityIds.some(id => haEntities[id] && haEntities[id].state === 'on');
  const action = anyOn ? 'turn_off' : 'turn_on';
  // Optimistic: flip every member to the target now, seq-bumped.
  const want = anyOn ? 'off' : 'on';
  let optChanged = false;
  entityIds.forEach(id => {
    const p = predictHaState(haEntities[id], action);
    if (!p) return;
    _haOptimisticHold[id] = { minUntil: Date.now() + 1200, until: Date.now() + 6000, want };
    if (applyHaEntityState(id, nextHaSeq(id), { ...p, state: want })) optChanged = true;
  });
  if (optChanged) renderLayout();
  const reconcileAll = () => Promise.all(entityIds.map(async (id) => {
    try {
      const mySeq = nextHaSeq(id);
      const stateRes = await fetch(`/api/ha/state/${encodeURIComponent(id)}`);
      const fresh = await stateRes.json();
      applyHaEntityState(id, mySeq, (fresh && fresh.entity_id) ? fresh : { error: (fresh && fresh.error) || 'Unavailable' });
    } catch {}
  })).then(renderLayout);
  try {
    const r = await fetch('/api/ha/call-group-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds, action }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
      console.error('HA group action failed:', data.error || r.status);
      entityIds.forEach(id => delete _haOptimisticHold[id]);
      reconcileAll();
      return false;
    }
    setTimeout(reconcileAll, 1200);
    setTimeout(reconcileAll, 3500);
    return true;
  } catch (e) {
    console.error('HA group action failed:', e);
    entityIds.forEach(id => delete _haOptimisticHold[id]);
    reconcileAll();
    return false;
  }
}

// Fills the empty .ha-sparkline placeholders (rendered by renderHaEntityControl
// for numeric sensors in Entity Status widgets) with a small inline SVG of the
// last 24h. History is fetched once per entity and cached ~10 min so re-renders
// don't re-hit the server; the periodic layout refresh picks up new data.
// Cached as raw points, not a pre-rendered SVG string — tick density is
// decided per DOM element from its actual width (buildSparklineSVG's pxWidth
// option), so two differently-sized widgets showing the same entity need
// their own render even though they share one fetch.
const _haSparkCache = new Map(); // entityId -> { points, fetchedAt }
const HA_SPARK_TTL = 10 * 60 * 1000;

// ── Notification banner (HA alerts today, other kinds later) ──
// Per-screen look — position/size/style from /api/screen-config
// (screens.alert_banner_*), stashed on state by resolveAssignedProfile().
const BANNER_STYLES = ['solid', 'bar', 'toast', 'outline', 'amber', 'strong'];
function applyAlertBannerConfig() {
  const bar = document.getElementById('ha-alert-banner');
  if (!bar) return;
  const pos = ['top', 'bottom', 'center'].includes(state.alertBannerPosition) ? state.alertBannerPosition : 'top';
  const size = ['s', 'm', 'l', 'xl', 'xxl'].includes(state.alertBannerSize) ? state.alertBannerSize : 'm';
  const style = BANNER_STYLES.includes(state.alertBannerStyle) ? state.alertBannerStyle : 'solid';
  bar.dataset.pos = pos;
  bar.dataset.size = size;
  bar.dataset.style = style;
}
async function pollHaAlerts() {
  let items = [];
  try {
    const j = await (await fetch('/api/notifications/active')).json();
    items = (j && Array.isArray(j.notifications)) ? j.notifications : [];
  } catch { return; } // server mid-restart etc. — keep whatever's shown
  let bar = document.getElementById('ha-alert-banner');
  if (!items.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ha-alert-banner';
    // Inside #rotate-wrap so the banner spins + resizes with the content
    // when the display has an in-browser rotation set (a body-level fixed
    // element would stay glued to the physical viewport instead).
    (document.getElementById('rotate-wrap') || document.body).appendChild(bar);
  }
  applyAlertBannerConfig();
  bar.innerHTML = items.map(n => `
    <div class="ha-alert-row" data-notif-key="${escapeHtmlD(n.key)}">
      <span class="ha-alert-msg">⚠ ${escapeHtmlD(n.body || n.title || 'Alert')}</span>
      <button type="button" class="ha-alert-x" data-interactive="1" aria-label="Dismiss">✕</button>
    </div>`).join('');
  bar.querySelectorAll('.ha-alert-x').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = btn.closest('.ha-alert-row');
      const key = row && row.dataset.notifKey;
      row && row.remove();
      if (!bar.querySelector('.ha-alert-row')) bar.remove();
      if (key) { try { await fetch('/api/notifications/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); } catch {} }
    });
  });
}
// ── Demo mode: countdown strip + "demo ended" curtain ──
// Driven entirely by /api/version's `demo` / `demoLeaseEndsAt` (epoch ms).
// On a normal (non-demo) build this is a no-op and nothing renders.
let _demoTimer = null;
function initDemoBanner(v) {
  if (!v || !v.demo) return;
  window.__isDemo = true;
  window.__demoLeaseEndsAt = Number(v.demoLeaseEndsAt) || 0;
  let bar = document.getElementById('demo-banner');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'demo-banner';
    // The scan-to-control QR: a static per-instance asset
    // (demo-qr-<n>.svg → https://d<n>.piazzahq.com/app?scan=1). Only shown
    // when this instance is broker-wired and we know its number.
    const qr = (v.demoBrokerUrl && v.demoInstance)
      ? `<img class="demo-qr" src="/demo-qr-${encodeURIComponent(v.demoInstance)}.svg" alt="Scan to control from your phone">
         <span class="demo-qr-cap">Scan to control from your phone</span>`
      : '';
    bar.innerHTML =
      '<div class="demo-row"><span class="demo-dot"></span>' +
      '<span class="demo-count">Demo</span></div>' +
      '<div class="demo-row"><a href="https://piazzahq.com" target="_blank" rel="noopener">Get your own →</a></div>' +
      qr;
    document.body.appendChild(bar);
  }
  const countEl = bar.querySelector('.demo-count');
  const tick = () => {
    const endsAt = Number(window.__demoLeaseEndsAt) || 0;
    if (!endsAt) { countEl.textContent = 'Demo'; return; }
    const ms = endsAt - Date.now();
    if (ms <= 0) { showDemoEnded(); return; }
    const s = Math.floor(ms / 1000);
    const mm = Math.floor(s / 60), ss = s % 60;
    countEl.textContent = `resets in ${mm}:${String(ss).padStart(2, '0')}`;
  };
  tick();
  if (_demoTimer) clearInterval(_demoTimer);
  _demoTimer = setInterval(tick, 1000);
  startDemoHeartbeat(v);
  wireDemoCursorInput();
  maybeShowDemoTour();
  // Repeat visitors (tour already dismissed) still get the one-time
  // touch-vs-mouse hint; first-timers get the same point from the tour card.
  let _tourSeen = false;
  try { _tourSeen = localStorage.getItem('demoTourSeen') === '1'; } catch {}
  if (_tourSeen) setTimeout(showDemoCursorHint, 2500);
  // If the tour was already dismissed in this browser, still nudge toward
  // the pencil once (its own localStorage flag stops it after the first).
  let _tourUp = false;
  try { _tourUp = localStorage.getItem('demoTourSeen') !== '1'; } catch {}
  if (!_tourUp) setTimeout(showDemoEditHint, 1500);
}
// One-time (per browser) walkthrough of how to poke at the demo.
function maybeShowDemoTour() {
  try { if (localStorage.getItem('demoTourSeen') === '1') return; } catch {}
  if (document.getElementById('demo-tour')) return;
  const el = document.createElement('div');
  el.id = 'demo-tour';
  el.innerHTML =
    '<div class="dt-card">' +
      '<h2>You’re in the live demo</h2>' +
      '<p>A real, private copy of Piazza HQ. Have a poke around — it wipes itself in a few minutes.</p>' +
      '<ul>' +
        '<li><span class="dt-ic">✏️</span><span><b>Tap the pencil</b> (bottom-right) to rearrange the layout.</span></li>' +
        '<li><span class="dt-ic">📅</span><span><b>Long-press a day</b> on the calendar to add an event.</span></li>' +
        '<li><span class="dt-ic">👆</span><span><b>Tap a widget</b> — check off a chore, tick a to-do, open an event.</span></li>' +
        '<li><span class="dt-ic">📱</span><span><b>Scan the code</b> (top-right) to drive this screen from your phone.</span></li>' +
        '<li><span class="dt-ic">🖱️</span><span><b>On a computer?</b> This is built for a touch screen so the cursor is hidden — press <b>Space</b> (or just move your mouse) to use it.</span></li>' +
        '<li><span class="dt-ic">⏱️</span><span>Everything <b>resets automatically</b> for the next visitor.</span></li>' +
      '</ul>' +
      '<button class="dt-go" type="button">Start exploring</button>' +
    '</div>';
  el.querySelector('.dt-go').addEventListener('click', () => {
    try { localStorage.setItem('demoTourSeen', '1'); } catch {}
    el.remove();
    setTimeout(showDemoEditHint, 400);
  });
  document.body.appendChild(el);
}
// A one-time bubble pointing at the edit pencil (which itself is hidden
// until the first screen tap) — reveals the pencil and nudges toward it.
function showDemoEditHint() {
  if (!window.__isDemo || editModeActive) return;
  try { if (localStorage.getItem('demoEditHintSeen') === '1') return; } catch {}
  if (document.getElementById('demo-edit-hint')) return;
  const pencil = document.getElementById('edit-mode-trigger');
  if (pencil) { pencil.classList.add('shown'); clearTimeout(_editIconHideTimer); }
  const hint = document.createElement('div');
  hint.id = 'demo-edit-hint';
  hint.textContent = 'Tap the pencil to move widgets around';
  document.body.appendChild(hint);
  const done = () => {
    try { localStorage.setItem('demoEditHintSeen', '1'); } catch {}
    hint.remove();
    // Let the pencil resume its normal auto-hide.
    if (pencil && pencil.classList.contains('shown')) {
      _editIconHideTimer = setTimeout(() => pencil.classList.remove('shown'), 4000);
    }
  };
  if (pencil) pencil.addEventListener('click', done, { once: true });
  setTimeout(done, 8000);
}

// ── Demo: touch-vs-mouse ──────────────────────────────────────────────────
// The cursor is hidden on the display by design. In the public demo a visitor
// might be on a plain monitor with a mouse, so give them their pointer back:
// Space toggles it, and a real mouse move reveals it (a touch-only user never
// fires one). Persisted for the session. Demo only — the real wall display
// stays cursorless.
let _demoCursorWired = false;
function _demoSetCursor(on) {
  document.documentElement.classList.toggle('demo-show-cursor', on);
  try { sessionStorage.setItem('demoShowCursor', on ? '1' : '0'); } catch {}
}
function wireDemoCursorInput() {
  if (_demoCursorWired || !window.__isDemo) return;
  _demoCursorWired = true;
  try { if (sessionStorage.getItem('demoShowCursor') === '1') _demoSetCursor(true); } catch {}

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.key !== ' ') return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    e.preventDefault();
    _demoSetCursor(!document.documentElement.classList.contains('demo-show-cursor'));
    _dismissDemoCursorHint();
  });

  let _moves = 0;
  window.addEventListener('mousemove', () => {
    if (++_moves < 3) return; // ignore one or two stray events
    if (!document.documentElement.classList.contains('demo-show-cursor')) _demoSetCursor(true);
    _dismissDemoCursorHint();
  }, { passive: true });
}
function showDemoCursorHint() {
  if (!window.__isDemo || editModeActive) return;
  if (document.getElementById('demo-cursor-hint') || document.getElementById('demo-tour')) return;
  try { if (sessionStorage.getItem('demoCursorHintSeen') === '1') return; } catch {}
  if (document.documentElement.classList.contains('demo-show-cursor')) return; // already using a cursor
  try { sessionStorage.setItem('demoCursorHintSeen', '1'); } catch {}
  const el = document.createElement('div');
  el.id = 'demo-cursor-hint';
  el.innerHTML = '<span>Built for a touch screen — on a computer, <b>press Space</b> or move your mouse to use a cursor.</span>' +
    '<button class="dch-x" type="button" aria-label="Dismiss">✕</button>';
  el.querySelector('.dch-x').addEventListener('click', _dismissDemoCursorHint);
  document.body.appendChild(el);
  setTimeout(_dismissDemoCursorHint, 18000);
}
function _dismissDemoCursorHint() {
  const el = document.getElementById('demo-cursor-hint');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 320);
}

// Hold the lease open while this tab is here: ping the broker every 45s.
// When the tab goes away the pings stop and the broker frees the slot after
// its idle window. credentials:'include' sends the .piazzahq.com lease cookie.
let _demoBeat = null;
function startDemoHeartbeat(v) {
  if (!v || !v.demo || !v.demoBrokerUrl || _demoBeat) return;
  const beat = () => {
    fetch(v.demoBrokerUrl + '/demo/heartbeat', { method: 'POST', credentials: 'include', keepalive: true })
      .then(r => r.json()).then(j => {
        if (j && j.endsAt) { window.__demoLeaseEndsAt = j.endsAt; }
        if (j && j.ok === false) { showDemoEnded(); }
      }).catch(() => {});
  };
  beat();
  _demoBeat = setInterval(beat, 45000);
}
function showDemoEnded() {
  if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
  if (_demoBeat) { clearInterval(_demoBeat); _demoBeat = null; }
  if (document.getElementById('demo-ended')) return;
  const home = 'https://piazzahq.com/';
  const el = document.createElement('div');
  el.id = 'demo-ended';
  el.innerHTML = '<h2>That’s the demo</h2>' +
    '<p>Everything you changed has been wiped for the next visitor. Taking you back…</p>' +
    '<a class="demo-cta" href="' + home + '">Set up your own Piazza HQ</a>';
  document.body.appendChild(el);
  // Return to the marketing site after a beat so the wall (or phone) doesn't
  // just sit on a dead instance.
  setTimeout(() => { try { location.href = home; } catch {} }, 4500);
}
// Picks the densest hour interval (4h, then 6h, then 8h) whose tick labels
// won't crowd each other given the sparkline's actual rendered pixel width —
// a narrower widget (smaller Font Size setting) falls back to sparser ticks
// automatically; a genuinely tiny one falls back to just the two endpoints.
function pickSparkTickHours(pxWidth, t0, t1) {
  const approxLabelPx = 34; // "11 PM"-ish worst case at the tick-label font size, plus breathing room
  for (const h of [4, 6, 8]) {
    const stepMs = h * 3600 * 1000;
    const n = Math.floor((t1 - t0) / stepMs) + 1;
    if (n < 2) continue;
    if (pxWidth / (n - 1) >= approxLabelPx) return h;
  }
  return null;
}
function fmtSparkVal(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : fmtNum(r, 1);
}
// opts: { unit, pxWidth } — unit is appended to the peak/trough labels (e.g.
// "°"), pxWidth is the sparkline element's actual rendered width, used only
// to decide tick density (see pickSparkTickHours above).
function buildSparklineSVG(points, opts) {
  if (!points || points.length < 2) return '';
  const unit = (opts && opts.unit) || '';
  const pxWidth = (opts && opts.pxWidth) || 0;
  // HA history only records CHANGES, so the last point is when the sensor last
  // moved — not "now". A steady sensor (a battery, a door contact) would end
  // hours ago, stretching its few points across the whole width and making
  // the right-hand time/"now" label wrong. Hold the last value out to now —
  // it IS the sensor's current state until it changes. Found on real data.
  const nowMs = (opts && opts.nowMs) || Date.now();
  const lastPt = points[points.length - 1];
  if (nowMs - lastPt.t > 10 * 60 * 1000) points = points.concat([{ t: nowMs, v: lastPt.v }]);
  const vs = points.map(p => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) { min -= 1; max += 1; }
  const W = 100, H = 36, padX = 3, padTop = 3, padBottom = 11;
  const plotH = H - padTop - padBottom;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const span = (t1 - t0) || 1;
  const xy = points.map(p => ({
    x: padX + (p.t - t0) / span * (W - 2 * padX),
    y: padTop + plotH - (p.v - min) / (max - min) * plotH,
    v: p.v,
  }));
  let peakI = 0, troughI = 0;
  xy.forEach((p, i) => { if (p.v > xy[peakI].v) peakI = i; if (p.v < xy[troughI].v) troughI = i; });
  const peak = xy[peakI], trough = xy[troughI];
  const line = xy.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${padX},${padTop + plotH} ${line} ${(W - padX)},${padTop + plotH}`;

  // Flips each label above/below its dot depending on how close to the top
  // edge it sits, and clamps its text-anchor near either end so it doesn't
  // run off the plot.
  const valueLabel = (p, val, cls) => {
    const anchor = p.x < 15 ? 'start' : p.x > W - 15 ? 'end' : 'middle';
    const dy = p.y < padTop + 8 ? 9 : -4;
    return `<text x="${p.x.toFixed(1)}" y="${(p.y + dy).toFixed(1)}" text-anchor="${anchor}" class="ha-spark-note ${cls}">${fmtSparkVal(val)}${unit}</text>`;
  };

  const tickHours = pickSparkTickHours(pxWidth, t0, t1);
  const tickY = padTop + plotH + 3;
  const labelY = tickY + 6;
  const fmtHour = t => new Date(t).toLocaleTimeString((window.i18n && i18n.lang) || undefined, { hour: 'numeric' }).replace(' ', '');
  let ticksSvg;
  if (tickHours) {
    const stepMs = tickHours * 3600 * 1000;
    const parts = [];
    for (let tt = t0; tt <= t1 + 1; tt += stepMs) {
      const x = padX + (tt - t0) / span * (W - 2 * padX);
      const anchor = x < 10 ? 'start' : x > W - 10 ? 'end' : 'middle';
      parts.push(`<line x1="${x.toFixed(1)}" y1="${(padTop + plotH).toFixed(1)}" x2="${x.toFixed(1)}" y2="${tickY.toFixed(1)}" class="ha-spark-tick"/>
        <text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${anchor}" class="ha-spark-tick-label">${fmtHour(tt)}</text>`);
    }
    ticksSvg = parts.join('');
  } else {
    // Too narrow for even the sparsest interval — just label the two ends.
    // Relative ("23h ago" / "now"), not clock times: a ~24h window starts and
    // ends at nearly the same hour of day, so real clock labels here both read
    // e.g. "8PM" — found on real 24h data, where it was meaningless.
    const spanH = Math.max(1, Math.round((t1 - t0) / 3600000));
    ticksSvg = `<text x="${padX}" y="${labelY.toFixed(1)}" text-anchor="start" class="ha-spark-tick-label">${spanH}h ago</text>
      <text x="${(W - padX)}" y="${labelY.toFixed(1)}" text-anchor="end" class="ha-spark-tick-label">now</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ha-spark-svg">
    <polygon points="${area}" class="ha-spark-fill"/>
    <polyline points="${line}" class="ha-spark-line"/>
    <circle cx="${peak.x.toFixed(1)}" cy="${peak.y.toFixed(1)}" r="1.6" class="ha-spark-dot"/>
    <circle cx="${trough.x.toFixed(1)}" cy="${trough.y.toFixed(1)}" r="1.6" class="ha-spark-dot" opacity="0.55"/>
    ${valueLabel(peak, max, 'peak')}
    ${valueLabel(trough, min, '')}
    ${ticksSvg}
  </svg>`;
}
async function wireHaSparklines() {
  const els = document.querySelectorAll('.ha-sparkline[data-entity-id]:not([data-spark-done])');
  for (const el of els) {
    if (el.hasAttribute('data-spark-done')) continue; // already filled by an earlier same-entity iteration below
    const id = el.dataset.entityId;
    let points;
    const cached = _haSparkCache.get(id);
    if (cached && (Date.now() - cached.fetchedAt) < HA_SPARK_TTL) {
      points = cached.points;
    } else {
      try {
        const r = await fetch(`/api/ha/history/${encodeURIComponent(id)}?hours=24`);
        const j = await r.json();
        points = (j && Array.isArray(j.points)) ? j.points : [];
        _haSparkCache.set(id, { points, fetchedAt: Date.now() });
      } catch { points = null; }
    }
    if (!points) { el.setAttribute('data-spark-done', '1'); continue; } // leave the placeholder empty
    const unit = (state.haEntities && state.haEntities[id] && state.haEntities[id].unit) || '';
    // Fill every current instance of this entity's sparkline in one pass — a
    // re-render since the fetch started may have replaced the element we
    // started from, and two differently-sized widgets showing the same
    // entity legitimately want different tick density, so each instance is
    // rendered against its own actual width rather than sharing one cached
    // SVG string the way this used to work.
    document.querySelectorAll(`.ha-sparkline[data-entity-id="${CSS.escape(id)}"]:not([data-spark-done])`).forEach(cur => {
      const pxWidth = cur.getBoundingClientRect().width || 0;
      cur.innerHTML = buildSparklineSVG(points, { unit, pxWidth });
      cur.setAttribute('data-spark-done', '1');
    });
  }
}
function wireEntityStatusTaps() {
  // Shared click handler for anything that's a simple on/off toggle target —
  // the original .ha-toggle-switch pill, plus the two new dashboard-view
  // shapes that act identically (Icon-only's circle, Tap-card's whole
  // card) but aren't visually toggle-switches themselves. All three carry
  // either data-entity-id (single entity) or data-group-ids (Group Control
  // / a whole-area tile) — same dispatch either way.
  const wireToggleLike = (selector) => {
    document.querySelectorAll(`${selector}[data-interactive]`).forEach(btn => {
      if (btn._tapWired) return; btn._tapWired = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        btn.disabled = true;
        if (btn.dataset.groupIds) {
          let ids = [];
          try { ids = JSON.parse(btn.dataset.groupIds); } catch {}
          callHaGroupAction(ids).finally(() => { btn.disabled = false; });
        } else {
          callHaAction(btn.dataset.entityId, 'toggle').finally(() => { btn.disabled = false; });
        }
      });
    });
  };
  wireToggleLike('.ha-toggle-switch');
  wireToggleLike('.ha-dash-icon-circle');
  wireToggleLike('.ha-dash-tapcard');
  document.querySelectorAll('.ha-temp-btn[data-interactive]').forEach(btn => {
    if (btn._tapWired) return; btn._tapWired = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const entityId = btn.dataset.entityId;
      const data = (state.haEntities || {})[entityId];
      if (!data || typeof data.targetTemp !== 'number') return;
      const step = typeof data.tempStep === 'number' ? data.tempStep : 1;
      const dir = btn.classList.contains('ha-temp-up') ? 1 : -1;
      let next = data.targetTemp + dir * step;
      if (typeof data.minTemp === 'number') next = Math.max(data.minTemp, next);
      if (typeof data.maxTemp === 'number') next = Math.min(data.maxTemp, next);
      btn.disabled = true;
      callHaAction(entityId, 'set_temperature', { temperature: next }).finally(() => { btn.disabled = false; });
    });
  });
  document.querySelectorAll('.ha-trigger-btn[data-interactive]').forEach(btn => {
    if (btn._tapWired) return; btn._tapWired = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '✓ Done';
      callHaAction(btn.dataset.entityId, 'trigger').finally(() => {
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 1500);
      });
    });
  });
  // Buttons that carry their own action: cover (open/stop/close), lock
  // (lock/unlock), media transport, and light colour swatches. Any extra
  // params (a swatch's rgb) ride along in data-ha-* attrs.
  document.querySelectorAll('.ha-action-btn[data-ha-action][data-interactive], .ha-swatch[data-ha-action][data-interactive]').forEach(btn => {
    if (btn._tapWired) return; btn._tapWired = true;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const action = btn.dataset.haAction;
      if (!action) return;
      const extra = btn.dataset.haRgb ? { rgb: btn.dataset.haRgb } : undefined;
      btn.disabled = true;
      callHaAction(btn.dataset.entityId, action, extra).finally(() => {
        setTimeout(() => { btn.disabled = false; }, 800);
      });
    });
  });
  // Sliders (light brightness, media_player volume) — fire on release
  // (change), not while dragging, so it's one HA call per adjustment. The
  // action + the param name it wants are spelled out on the element.
  document.querySelectorAll('.ha-bright-slider[data-ha-action][data-interactive]').forEach(sl => {
    if (sl._tapWired) return; sl._tapWired = true;
    sl.addEventListener('click', (e) => e.stopPropagation());
    sl.addEventListener('change', (e) => {
      e.stopPropagation();
      const val = Math.round(Number(sl.value));
      if (!Number.isFinite(val)) return;
      const action = sl.dataset.haAction;
      const param = sl.dataset.haParam || 'value';
      sl.disabled = true;
      callHaAction(sl.dataset.entityId, action, { [param]: val })
        .finally(() => { setTimeout(() => { sl.disabled = false; }, 400); });
    });
  });
}

