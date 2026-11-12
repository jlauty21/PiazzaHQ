// Live video of a Home Assistant camera (a Google Nest camera or doorbell, which only offers WebRTC) through the server's relay, /api/camera/<id>/ha-webrtc (src/camera.js).
// The relay passes Home Assistant's WebRTC handshake along; the video itself comes straight from the camera. Used by the wall Camera widget (js/display/16-camera-live.js);
// the /tablet page has its own copy of this in js/tablet/02-tiles.js (tbHaLive).
//
//   const h = phqHaWebrtc(cameraId, onend);
//   h.video   a <video> (muted, so a browser lets it start by itself); put it in the page
//   h.ok      a Promise: true once video is flowing, false when it cannot be (a refusal, a timeout of 15 s, a failed connection)
//   h.stop()  hang up
// `onend` (optional) is called when the video drops after it had been playing, so the caller can start it again.
function phqHaWebrtc(id, onend) {
  const v = document.createElement('video');
  v.className = 'cam-ha-video'; v.autoplay = true; v.muted = true; v.setAttribute('playsinline', '');
  let pc = null, ws = null, done = false, stopped = false, wasOk = false, resolveOk;
  const ok = new Promise((r) => { resolveOk = r; });
  const finish = (good) => { if (done) return; done = true; wasOk = good; clearTimeout(timer); resolveOk(good); };
  const ended = () => { if (stopped || !wasOk) return; stopped = true; if (onend) onend(); };
  const stop = () => { done = true; stopped = true; clearTimeout(timer); try { ws && ws.close(); } catch { /* closed */ } try { pc && pc.close(); } catch { /* closed */ } v.srcObject = null; };
  const timer = setTimeout(() => { stop(); resolveOk(false); }, 15000);
  const send = (o) => { try { ws.send(JSON.stringify(o)); } catch { /* closed */ } };
  if (!window.RTCPeerConnection) { finish(false); return { video: v, ok, stop }; }
  try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + `/api/camera/${encodeURIComponent(id)}/ha-webrtc`); } catch { finish(false); return { video: v, ok, stop }; }
  ws.onerror = () => finish(false);
  ws.onclose = () => { finish(false); ended(); };
  ws.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    try {
      if (m.type === 'config') {
        pc = new RTCPeerConnection({ iceServers: m.iceServers || [] });
        pc.addTransceiver('audio', { direction: 'recvonly' }); pc.addTransceiver('video', { direction: 'recvonly' });
        pc.createDataChannel(m.dataChannel || 'dataSendChannel');            // the camera's service wants a data channel in the offer (Home Assistant names it)
        pc.ontrack = (ev) => { if (!v.srcObject) v.srcObject = new MediaStream(); v.srcObject.addTrack(ev.track); v.play().catch(() => { /* muted, so this normally works */ }); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') finish(true); else if (pc.connectionState === 'failed') { finish(false); ended(); } };
        pc.onicecandidate = (ev) => { if (ev.candidate && !m.getCandidatesUpfront) send({ type: 'candidate', candidate: ev.candidate.toJSON() }); };
        await pc.setLocalDescription(await pc.createOffer());
        if (m.getCandidatesUpfront) await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') r(); }; setTimeout(r, 3000); });
        send({ type: 'offer', sdp: pc.localDescription.sdp });
      } else if (m.type === 'answer' && pc) await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      else if (m.type === 'candidate' && pc) { try { await pc.addIceCandidate(m.candidate); } catch { /* a late or unusable candidate */ } }
      else if (m.type === 'error') finish(false);
    } catch { finish(false); }
  };
  return { video: v, ok, stop };
}
