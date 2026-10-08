'use strict';
// Display painted signal: the kiosk browser says it drew a frame (loopback only) and the launcher reads that to know the page is alive.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/display-state.test.js.
module.exports = function registerDisplayPainted({ crypto, app }) {
  // The kiosk launcher (scripts/wait-for-server-and-launch-kiosk.sh) needs to know whether the browser's display
  // page actually drew something: a boot that ends on a blank white screen looks, to the server, exactly like a
  // healthy one. The page POSTs here once it has put a frame on screen (two animation frames after its first render,
  // so a window that is not being composited never reports). Only the kiosk browser on this device counts
  // (loopback, no proxy headers); the launcher compares the count with the one it saw at launch. boot_id changes
  // when the server restarts, so a restart can't be mistaken for "no paint".
  const DISPLAY_STATE = { bootId: crypto.randomBytes(4).toString('hex'), paintedCount: 0, lastPaintedAt: 0 };
  function displayReqIsLocal(req) {
    const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
    const loopback = a === '::1' || /^127\./.test(a);
    const proxied = ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-forwarded-host', 'forwarded', 'x-real-ip', 'true-client-ip'].some((h) => req.headers[h] !== undefined);
    return loopback && !proxied;
  }
  app.post('/api/display/painted', (req, res) => {
    if (displayReqIsLocal(req)) { DISPLAY_STATE.paintedCount++; DISPLAY_STATE.lastPaintedAt = Date.now(); }
    res.json({ ok: true });
  });
  app.get('/api/display/state', (req, res) => {
    if (!displayReqIsLocal(req)) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'no-store');
    res.json({ boot_id: DISPLAY_STATE.bootId, painted_count: DISPLAY_STATE.paintedCount, last_painted_at: DISPLAY_STATE.lastPaintedAt });
  });
};
