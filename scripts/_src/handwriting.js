'use strict';
// Handwriting-to-text (optional, for the display's add-event sheet): MyScript settings and the recognise route.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/handwriting.test.js.
module.exports = function registerHandwriting({ crypto, app, db, getSetting, httpsRequest }) {
  // MyScript keys are UUIDs. Pull the UUID out of whatever was pasted rather
  // than storing it verbatim — a stray "* " bullet or quotes from a copy/paste
  // otherwise sails through and MyScript just 401s with no hint why (seen live).
  function cleanMyScriptKey(v) {
    const s = String(v == null ? '' : v);
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : s.trim();
  }
  app.put('/api/handwriting-settings', (req, res) => {
    const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const tx = db.transaction(() => {
      if (req.body.handwriting_enabled !== undefined) upsert.run('handwriting_enabled', String(req.body.handwriting_enabled));
      if (req.body.myscript_app_key !== undefined) upsert.run('myscript_app_key', cleanMyScriptKey(req.body.myscript_app_key));
      // HMAC key only overwrites when a new one is actually typed — blank = keep.
      const newHmac = cleanMyScriptKey(req.body.myscript_hmac_key);
      if (newHmac) upsert.run('myscript_hmac_key', newHmac);
    });
    tx();
    res.json({ ok: true });
  });

  app.get('/api/handwriting-settings', (req, res) => {
    res.json({
      handwriting_enabled: getSetting('handwriting_enabled') || '0',
      myscript_app_key: getSetting('myscript_app_key') || '',
      myscript_hmac_key_set: !!getSetting('myscript_hmac_key'),
      // What the display actually needs to decide whether to show the ✍️ button.
      handwriting_ready: (getSetting('handwriting_enabled') === '1') && !!getSetting('myscript_app_key'),
    });
  });

  // Recognize a set of pen strokes. The browser sends raw strokes; the HMAC
  // signing (a shared secret) happens here so that secret never ships to a
  // display. Best-effort: any failure returns a clean error and the sheet just
  // keeps the typed field.
  app.post('/api/handwriting/recognize', async (req, res) => {
    try {
      if (getSetting('handwriting_enabled') !== '1') return res.status(400).json({ error: 'Handwriting input is turned off.' });
      const appKey = getSetting('myscript_app_key');
      const hmacKey = getSetting('myscript_hmac_key');
      if (!appKey || !hmacKey) return res.status(400).json({ error: 'MyScript keys are not configured.' });
      const strokes = Array.isArray(req.body && req.body.strokes) ? req.body.strokes : null;
      if (!strokes || !strokes.length) return res.status(400).json({ error: 'No strokes provided.' });
      // strokes: [ [ {x,y,t}, ... ], ... ]  ->  MyScript v4 batch shape
      const payload = {
        configuration: { lang: (req.body && req.body.lang) || 'en_US' },
        contentType: 'Text',
        strokeGroups: [{
          strokes: strokes.map(s => ({
            x: s.map(p => p.x), y: s.map(p => p.y), t: s.map(p => p.t),
            pointerType: 'PEN',
          })),
        }],
      };
      const body = JSON.stringify(payload);
      const hmac = crypto.createHmac('sha512', appKey + hmacKey).update(body).digest('hex');
      // Accept MUST be a format MyScript actually produces — JIIX is its
      // structured JSON result (has `label` + `words[]`). Asking for plain
      // application/json gets a 406 "no suitable mime type".
      const r = await httpsRequest('https://cloud.myscript.com/api/v4.0/iink/batch', 'POST', {
        body,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/vnd.myscript.jiix', 'applicationKey': appKey, 'hmac': hmac },
      });
      if (r.statusCode !== 200) {
        console.error('MyScript recognize failed', r.statusCode, String(r.body).slice(0, 300));
        let detail = '';
        try { const e = JSON.parse(r.body || '{}'); detail = e.code || e.message || ''; } catch {}
        return res.status(502).json({ error: detail ? `MyScript: ${detail}` : 'Recognition service error.' });
      }
      let text = '';
      try { const j = JSON.parse(r.body || '{}'); text = j.label || (j.words || []).map(w => w.label).join(' '); } catch {}
      res.json({ text: (text || '').trim() });
    } catch (e) {
      console.error('handwriting recognize error', e && e.message);
      res.status(500).json({ error: 'Could not recognize handwriting.' });
    }
  });
};
