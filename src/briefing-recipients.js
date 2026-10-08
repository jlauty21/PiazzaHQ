'use strict';
const { forLanguage } = require('./i18n-server.js');
// Daily briefing recipients (name + email) and the preview / test-send / send-now routes.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/briefing-recipients.test.js.
module.exports = function registerBriefingRecipients({ app, db, getEmailSettings, getBriefingRecipients, buildMailTransporter, friendlyMailError, assembleBriefingContent, renderBriefingHTML, renderBriefingText, sendBriefing }) {
  app.get('/api/briefing-recipients', (req, res) => {
    res.json(getBriefingRecipients(false));
  });

  app.post('/api/briefing-recipients', (req, res) => {
    const { name, email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email address is required' });
    const maxOrder = db.prepare(`SELECT MAX(sort_order) as m FROM briefing_recipients`).get().m || 0;
    const result = db.prepare(
      `INSERT INTO briefing_recipients (name, email, enabled, sort_order) VALUES (?, ?, 1, ?)`
    ).run((name || '').trim(), email.trim(), maxOrder + 1);
    res.status(201).json(db.prepare(`SELECT * FROM briefing_recipients WHERE id = ?`).get(result.lastInsertRowid));
  });

  app.put('/api/briefing-recipients/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM briefing_recipients WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Recipient not found' });
    const { name, email, enabled } = req.body;
    db.prepare(`UPDATE briefing_recipients SET name=?, email=?, enabled=? WHERE id=?`).run(
      name !== undefined ? name.trim() : existing.name,
      email !== undefined ? email.trim() : existing.email,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      req.params.id
    );
    res.json(db.prepare(`SELECT * FROM briefing_recipients WHERE id = ?`).get(req.params.id));
  });

  app.delete('/api/briefing-recipients/:id', (req, res) => {
    const result = db.prepare(`DELETE FROM briefing_recipients WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Recipient not found' });
    res.json({ ok: true });
  });

  // GET /api/briefing-settings/preview — renders the HTML without sending, for in-app preview.
  // Uses the first enabled recipient's name if available, otherwise a placeholder, so the
  // preview reflects real personalization without requiring a recipient to already exist.
  app.get('/api/briefing-settings/preview', async (req, res) => {
    try {
      const content = await assembleBriefingContent();
      const s = getEmailSettings();
      const recipients = getBriefingRecipients(true);
      const previewName = req.query.name || (recipients[0] && recipients[0].name) || 'there';
      const html = renderBriefingHTML(content, s.display_name, previewName);
      res.send(html);
    } catch (e) {
      res.status(500).send(`<p style="font-family:sans-serif;color:#c00;padding:20px">Preview failed: ${e.message}</p>`);
    }
  });

  // POST /api/briefing-settings/test — sends a real email to ONE address for setup verification,
  // without affecting briefing_last_sent or touching the full recipient list.
  app.post('/api/briefing-settings/test', async (req, res) => {
    const testEmail = req.body.email;
    if (!testEmail || !testEmail.includes('@')) return res.status(400).json({ error: 'Enter a valid email to send the test to' });
    try {
      const s = getEmailSettings();
      if (!s.briefing_email_user || !s.briefing_email_pass) {
        throw new Error('Fill in the sender account and app password first.');
      }
      const content = await assembleBriefingContent();
      const transporter = buildMailTransporter(s);
      const T = forLanguage((db.prepare(`SELECT value FROM settings WHERE key = 'ui_language'`).get() || {}).value || 'en');
      const dateLabel = T.day(content.today, { weekday: 'short', month: 'short', day: 'numeric' });
      await transporter.sendMail({
        from: `"${s.display_name || 'Daily Briefing'}" <${s.briefing_email_user}>`,
        to: testEmail,
        subject: `[Test] ${T('Your Daily Briefing')} — ${dateLabel}`,
        text: renderBriefingText(content, req.body.name || T('there')),
        html: renderBriefingHTML(content, s.display_name, req.body.name || T('there')),
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: friendlyMailError(e) });
    }
  });

  // POST /api/briefing-settings/send-now — sends the real briefing to every enabled
  // recipient immediately, outside the schedule. Returns per-recipient results.
  app.post('/api/briefing-settings/send-now', async (req, res) => {
    try {
      const results = await sendBriefing();
      res.json({ ok: true, results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
