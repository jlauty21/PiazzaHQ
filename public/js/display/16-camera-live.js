// ── Camera widget, part two: Home Assistant (Google Nest) cameras and sound ─────────────────────────────────────────────────────────────────
// A Home Assistant camera that only offers WebRTC (a Nest camera or doorbell) is played through the server's relay (js/shared/cam-webrtc.js) instead of the go2rtc <video-stream>. The
// widgets of such a camera hold a slot (.cam-ha); the stream itself lives here, one per camera, so a redraw of the layout does not hang up and dial again. Streams that drop, or cannot
// start, are tried again after a growing pause (8 s, 16 s ... up to a minute).
//
// Sound: whether a camera plays its sound is one household choice per camera, kept in the setting camera_sound ({ "<camera id>": true }) and changed from the Favorites tab, from the
// speaker button a widget can show, or from the widget's settings. Video always starts silent (a browser lets only silent video start by itself) and is then unmuted; if the browser
// refuses, it stays silent. (The kiosk browser on a Pi is started so that it does not refuse.)
const CAMLIVE = {};                         // camera id -> { state: 'connecting' | 'on' | 'failed', stop, video, fails, retryAt }
let camOverlayId = '';                      // the camera whose big view is open (its widget makes way: a second stream of the same camera)
let camBlocked = false;                     // the browser refused sound: do not ask again until there is a touch
let camOverlayHa = null;                    // the big view's own stream when it is a Home Assistant camera

const camIsHa = (id) => { const c = (state.cameras || []).find((x) => String(x.id) === String(id)); return !!c && c.kind === 'ha'; };
function camSoundMap() { try { const m = JSON.parse((state.settings && state.settings.camera_sound) || '{}'); return m && typeof m === 'object' ? m : {}; } catch { return {}; } }
const camSoundOn = (id) => !!camSoundMap()[id];
const CAM_SPK_ON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';
const CAM_SPK_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9l5 6M21 9l-5 6"/></svg>';
const camSpeakerHtml = (id) => `<button type="button" class="cam-spk" data-cam-spk="${id}" aria-label="Turn the sound on" aria-pressed="false">${CAM_SPK_OFF}</button>`;

// Make every playing camera match the household's choice, and show it on the speaker buttons.
function camApplySound() {
  const map = camSoundMap();
  document.querySelectorAll('.w-camera .cam-frame[data-cam-id], #camera-overlay-frame[data-cam-id]').forEach((fr) => {
    const id = fr.dataset.camId, v = fr.querySelector('video'), want = !!map[id];
    if (v && v.muted === want && !(want && camBlocked)) {
      v.muted = !want;
      if (want) v.play().catch(() => { camBlocked = true; v.muted = true; v.play().catch(() => { /* not playing yet */ }); camPaintSpeaker(fr); });   // the browser said no: stay silent
    }
    camPaintSpeaker(fr);
  });
}
function camPaintSpeaker(fr) {
  const b = fr.querySelector('.cam-spk'); if (!b) return;
  const v = fr.querySelector('video'), on = !!(v && !v.muted);
  if (b.dataset.s === (on ? 'on' : 'off')) return;
  b.dataset.s = on ? 'on' : 'off'; b.innerHTML = on ? CAM_SPK_ON : CAM_SPK_OFF;
  b.setAttribute('aria-label', on ? 'Turn the sound off' : 'Turn the sound on'); b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('on', on);
}
// A tap on a speaker button: the household's choice for that camera flips, here at once and on the server for every screen.
async function camToggleSound(id) {
  const on = !camSoundOn(id), m = camSoundMap();
  if (on) m[id] = true; else delete m[id];
  state.settings = Object.assign({}, state.settings, { camera_sound: JSON.stringify(m) });
  camApplySound();
  try {
    const r = await fetch(`/api/cameras/${encodeURIComponent(id)}/sound`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
    if (!r.ok) throw new Error('refused');
  } catch {
    const back = camSoundMap(); if (on) delete back[id]; else back[id] = true;                                  // it did not reach the server: put it back
    state.settings = Object.assign({}, state.settings, { camera_sound: JSON.stringify(back) });
    camApplySound();
  }
}

// ── Home Assistant cameras on a widget ──
function camHaMessage(box, text) {
  let m = box.querySelector('.cam-ha-msg');
  if (!text) { if (m) m.remove(); return; }
  if (!m) { m = document.createElement('div'); m.className = 'cam-ha-msg'; box.appendChild(m); }
  if (m.textContent !== text) m.textContent = text;
}
function camHaStart(id) {
  const prev = CAMLIVE[id], e = { state: 'connecting', stop() { /* nothing yet */ }, video: null, fails: prev ? prev.fails : 0, retryAt: 0 };
  CAMLIVE[id] = e;
  const fail = () => { e.stop(); if (e.video) e.video.remove(); e.video = null; e.state = 'failed'; e.fails++; e.retryAt = Date.now() + Math.min(60000, 8000 * e.fails); camHaWire(); };
  const h = phqHaWebrtc(id, () => { if (CAMLIVE[id] === e) fail(); });
  e.stop = h.stop; e.video = h.video;
  h.ok.then((good) => { if (CAMLIVE[id] !== e) return; if (good) { e.state = 'on'; e.fails = 0; camHaWire(); camApplySound(); } else fail(); });
}
// Start, keep in place and stop the streams to match the widgets that are on show now. Runs after every draw of the layout and every few seconds.
function camHaWire() {
  const want = new Set();
  document.querySelectorAll('.w-camera .cam-ha[data-ha-cam]').forEach((box) => {
    const id = box.dataset.haCam;
    if (box.closest('.widget.rot-off') || id === camOverlayId) return;           // in a rotation but not on show, or the big view has it
    want.add(id);
    let e = CAMLIVE[id];
    if (!e || (e.state === 'failed' && Date.now() >= e.retryAt)) { camHaStart(id); e = CAMLIVE[id]; }
    if (e.video && e.video.parentNode !== box) { box.appendChild(e.video); e.video.play().catch(() => { /* muted: starts by itself */ }); }
    camHaMessage(box, e.state === 'on' ? '' : e.state === 'failed' ? 'Live view unavailable' : 'Connecting…');
  });
  Object.keys(CAMLIVE).forEach((id) => {
    if (want.has(id)) return;
    const e = CAMLIVE[id]; e.stop(); if (e.video) e.video.remove(); delete CAMLIVE[id];
  });
  camApplySound();
}
setInterval(() => { if (document.querySelector('.w-camera .cam-ha[data-ha-cam]') || Object.keys(CAMLIVE).length) camHaWire(); }, 5000);

// ── the big view of a Home Assistant camera ──
function camOverlayStartHa(id, frame) {
  camOverlayId = String(id); camHaWire();                                        // its widget lets go first
  frame.innerHTML = '<div class="cam-ha-msg">Connecting…</div>';
  const h = phqHaWebrtc(id);
  camOverlayHa = h;
  h.ok.then((good) => {
    if (camOverlayHa !== h) return;
    if (good) { frame.innerHTML = ''; frame.appendChild(h.video); camApplySound(); }
    else frame.innerHTML = '<div class="cam-ha-msg">Live view unavailable</div>';
  });
}
function camOverlayStop() {
  if (camOverlayHa) { camOverlayHa.stop(); camOverlayHa = null; }
  camOverlayId = ''; camHaWire();                                                // the widget carries on
}

// The first touch lets a browser start sound: look again at every camera then.
['pointerup', 'click', 'keydown'].forEach((n) => document.addEventListener(n, () => { camBlocked = false; try { camApplySound(); } catch { /* none yet */ } }, true));
