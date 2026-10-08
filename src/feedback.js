'use strict';
// User feedback: submit (stored locally and forwarded to the central server) and the developer-reply thread routes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/feedback.test.js.
module.exports = function registerFeedback({ URL, path, fs, fetchWithTimeout, app, db, UPLOAD_DIR, upload, APP_VERSION, resolveFeedbackUrl, resolveFeedbackKey, DEVICE_ID, getSetting, updateSetting }) {
  // Stored locally and emailed to the product owner as a once-daily digest. The
  // recipient + email creds are configured server-side (see feedback_* settings).
  app.post('/api/feedback', upload.single('image'), (req, res) => {
    const { kind, message, device_name } = req.body || {};
    const msg = (message || '').trim();
    if (!msg) return res.status(400).json({ error: 'Message is required' });
    const k = ['bug','feature','feedback'].includes(kind) ? kind : 'feedback';
    const image = req.file ? req.file.filename : '';
    db.prepare(`INSERT INTO feedback (kind, message, device_name, app_version, image) VALUES (?,?,?,?,?)`)
      .run(k, msg.slice(0, 4000), (device_name || '').slice(0, 120), APP_VERSION, image);
    // Best-effort real-time forward to the central server (mothership). Never blocks
    // or fails the user's submission — local storage + email digest remain the
    // baseline; this is an additive delivery path.
    forwardFeedbackToCentral({ kind: k, message: msg, device_name, image }).catch(() => {});
    res.json({ ok: true });
  });

  // POSTs a feedback item to the configured central intake endpoint, if one is set.
  // Does nothing (resolves) when no URL is configured, so the feature is fully
  // optional and the app works identically with or without a central server. Uses a
  // plain JSON body (image as base64) so there are no extra dependencies on the Pi.
  async function forwardFeedbackToCentral({ kind, message, device_name, image }) {
    const base = resolveFeedbackUrl();
    if (!base) return; // feature off
    const key = resolveFeedbackKey();
    const target = new URL(`${base}/api/v1/feedback`);

    const payload = {
      kind, message,
      device_name: device_name || getSetting('display_name') || '',
      // NOT DEVICE_ID — this app has two separate, unrelated per-device
      // identifiers. DEVICE_ID (the scr_... file-based one) is used for
      // host/slave sync identity. screen_device_id_cache is the ID
      // fetchUpdateInfo() actually sends to /api/v1/update-check, which is
      // what the mothership records into licenseActivations. The mothership
      // resolves a feedback submitter's email by joining feedback.device_id
      // against licenseActivations.device_id — that only works if this sends
      // the SAME id update-check does. Sending DEVICE_ID here (as this
      // originally did) meant that join could essentially never match for any
      // real device, silently breaking email resolution for ~all submissions.
      device_id: updateSetting('screen_device_id_cache', '') || DEVICE_ID || '',
      app_version: APP_VERSION,
    };
    if (key) payload.key = key;
    if (image) {
      try {
        const imgPath = path.join(UPLOAD_DIR, image);
        if (fs.existsSync(imgPath)) {
          const ext = (path.extname(image).slice(1) || 'jpeg').toLowerCase();
          payload.image_base64 = `data:image/${ext};base64,` + fs.readFileSync(imgPath).toString('base64');
        }
      } catch { /* skip image on any read error */ }
    }
    const body = JSON.stringify(payload);
    const res = await fetchWithTimeout(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'x-feedback-key': key } : {}) },
      body,
      timeoutMs: 8000,
      timeoutMessage: 'central feedback timeout',
    });
    await res.text(); // drain the body, matching the original's resp.resume()/'end' wait
  }

  // Small helper: make a JSON request to the central server (GET or POST), returning the
  // parsed body. Used for the feedback reply thread. Resolves null on any failure so the
  // UI degrades gracefully when the server is unreachable.
  async function centralRequest(method, pathAndQuery, bodyObj) {
    const base = resolveFeedbackUrl();
    if (!base) return null;
    const key = resolveFeedbackKey();
    let target;
    try { target = new URL(base + pathAndQuery); } catch { return null; }
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    try {
      const res = await fetchWithTimeout(target, {
        method,
        headers: {
          'Accept': 'application/json',
          ...(key ? { 'x-feedback-key': key } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        timeoutMs: 8000,
      });
      return await res.json();
    } catch { return null; }
  }

  // The id a feedback thread is actually filed under server-side — see the identical
  // resolution (and the full explanation) in forwardFeedbackToCentral() above: the
  // mothership joins feedback.device_id against licenseActivations.device_id, which
  // only has entries keyed by screen_device_id_cache (what fetchUpdateInfo() sends),
  // never by DEVICE_ID. The three routes below used to query with bare DEVICE_ID —
  // a different id namespace entirely — so a device could never find its OWN
  // feedback threads and every developer reply sat permanently invisible, no matter
  // how long the device polled. Must stay in lockstep with the submit-side id.
  function feedbackDeviceId() {
    return getSetting('screen_device_id_cache') || DEVICE_ID || '';
  }

  // APP endpoint: fetch any developer replies to this device's feedback.
  app.get('/api/feedback-replies', async (req, res) => {
    const key = resolveFeedbackKey();
    const allParam = (req.query.all === '1' || req.query.all === 'true') ? '&all=1' : '';
    const out = await centralRequest('GET',
      `/api/v1/feedback-replies?device=${encodeURIComponent(feedbackDeviceId())}&key=${encodeURIComponent(key)}${allParam}`);
    res.json(out || { threads: [] });
  });

  // APP endpoint: user replies back on a thread.
  app.post('/api/feedback-replies/:id', async (req, res) => {
    const text = (req.body && req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Message required' });
    const out = await centralRequest('POST', `/api/v1/feedback-replies/${encodeURIComponent(req.params.id)}`,
      { text, device: feedbackDeviceId(), key: resolveFeedbackKey() });
    res.json(out || { error: 'Could not reach the server.' });
  });

  // APP endpoint: mark a thread's developer replies as seen.
  app.post('/api/feedback-replies/:id/seen', async (req, res) => {
    await centralRequest('POST', `/api/v1/feedback-replies/${encodeURIComponent(req.params.id)}/seen`,
      { device: feedbackDeviceId(), key: resolveFeedbackKey() });
    res.json({ ok: true });
  });
};
