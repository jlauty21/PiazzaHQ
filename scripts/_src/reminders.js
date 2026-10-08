'use strict';
// Reminders (trash day, recycling every N days, ...): create, list, edit, switch off, delete, schedule validation and icon images.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/reminders.test.js.
module.exports = function registerReminders({ path, fs, app, demoCleanText, db, UPLOAD_DIR, upload, broadcastUpdate }) {
  // anything else that recurs on a schedule but isn't a real calendar event:
  // no title/notes/attendees, just a name+icon+schedule. Two schedule types
  // cover the common cases without needing full RRULE complexity: 'weekly'
  // (specific days of the week, e.g. trash is every Tuesday) and 'interval'
  // (every N days from a reference date, e.g. recycling every 14 days
  // starting from a known date). Household-shared data, same as events —
  // participates in the host/slave sync snapshot below, not per-widget or
  // per-display. ──────────────────────────────────────────────────────────
  app.get('/api/reminders', (req, res) => {
    const rows = db.prepare(`SELECT * FROM reminders WHERE active = 1 ORDER BY id ASC`).all();
    res.json(rows.map(r => ({ ...r, schedule_config: JSON.parse(r.schedule_config) })));
  });

  // POST /api/reminders/icon-image — uploads a reminder icon image standalone,
  // not tied to a specific reminder id, so it works identically whether the
  // person is creating a brand new reminder or editing an existing one (the
  // modal uploads on file-select, then includes the returned filename in the
  // reminder's own create/save payload below). Reuses the same UPLOAD_DIR and
  // `upload` multer instance as photos — no server-side resizing here, matching
  // every other upload in this file (no image-processing library exists or is
  // used anywhere; photos and custom-theme decorations are both stored at
  // whatever size was uploaded and sized down at render time via CSS instead).
  // A reminder icon renders at badge/chip scale everywhere it appears — see
  // reminderIconHtml() in display.html for the CSS-based sizing.
  app.post('/api/reminders/icon-image', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded (must be JPEG, PNG, WebP, or GIF).' });
    res.json({ ok: true, filename: req.file.filename });
  });

  // Validates a reminder's schedule_type/schedule_config shape — shared by
  // POST and PUT below rather than duplicated, since the rules are identical
  // for both. Returns an error string, or null if valid. Deliberately loose
  // where a wrong value just means "won't match any date" rather than
  // corrupting anything (e.g. an out-of-range weekday) — this exists to catch
  // missing required fields and obviously malformed types, not to be a
  // bulletproof schema validator.
  function validateReminderSchedule(scheduleType, cfg) {
    cfg = cfg || {};
    if (!['weekly', 'interval', 'monthly', 'yearly'].includes(scheduleType)) {
      return "schedule_type must be 'weekly', 'interval', 'monthly', or 'yearly'";
    }
    if (scheduleType === 'weekly') {
      if (!Array.isArray(cfg.daysOfWeek) || !cfg.daysOfWeek.length) return 'Pick at least one day of the week';
    } else if (scheduleType === 'interval') {
      if (!cfg.startDate) return 'A start date is required';
      if (!Number.isInteger(cfg.intervalDays) || cfg.intervalDays < 1) return 'intervalDays must be a positive whole number';
    } else if (scheduleType === 'monthly') {
      if (!cfg.startDate) return 'A start date is required';
      if (cfg.monthlyMode === 'nthWeekday') {
        if (![1,2,3,4,-1].includes(cfg.nthWeek)) return 'nthWeek must be 1-4 or -1 (last)';
        if (!Number.isInteger(cfg.nthWeekday) || cfg.nthWeekday < 0 || cfg.nthWeekday > 6) return 'nthWeekday must be 0-6';
      } else {
        if (!Number.isInteger(cfg.dayOfMonth) || cfg.dayOfMonth < 1 || cfg.dayOfMonth > 31) return 'dayOfMonth must be 1-31';
      }
    } else if (scheduleType === 'yearly') {
      if (!cfg.startDate) return 'A start date is required';
      if (!Number.isInteger(cfg.yearlyMonth) || cfg.yearlyMonth < 1 || cfg.yearlyMonth > 12) return 'yearlyMonth must be 1-12';
      if (cfg.yearlyMode === 'nthWeekday') {
        if (![1,2,3,4,-1].includes(cfg.yearlyNthWeek)) return 'yearlyNthWeek must be 1-4 or -1 (last)';
        if (!Number.isInteger(cfg.yearlyNthWeekday) || cfg.yearlyNthWeekday < 0 || cfg.yearlyNthWeekday > 6) return 'yearlyNthWeekday must be 0-6';
      } else {
        if (!Number.isInteger(cfg.yearlyDay) || cfg.yearlyDay < 1 || cfg.yearlyDay > 31) return 'yearlyDay must be 1-31';
      }
    }
    if (cfg.endType && !['never', 'onDate', 'afterCount'].includes(cfg.endType)) {
      return "endType must be 'never', 'onDate', or 'afterCount'";
    }
    if (cfg.endType === 'onDate' && !cfg.endDate) return 'An end date is required when Ends is set to "On a date"';
    if (cfg.endType === 'afterCount' && (!Number.isInteger(cfg.endCount) || cfg.endCount < 1)) {
      return 'endCount must be a positive whole number when Ends is set to "After a number of times"';
    }
    return null;
  }
  app.post('/api/reminders', (req, res) => {
    const { name, icon, icon_type, icon_image, schedule_type, schedule_config } = req.body;
    if (!name || !schedule_type || !schedule_config) {
      return res.status(400).json({ error: 'name, schedule_type, and schedule_config are required' });
    }
    const scheduleError = validateReminderSchedule(schedule_type, schedule_config);
    if (scheduleError) return res.status(400).json({ error: scheduleError });
    const validIconType = ['emoji', 'text', 'image'].includes(icon_type) ? icon_type : 'emoji';
    const result = db.prepare(`
    INSERT INTO reminders (name, icon, icon_type, icon_image, schedule_type, schedule_config)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(demoCleanText(name, 120), icon || '📌', validIconType, validIconType === 'image' ? (icon_image || null) : null, schedule_type, JSON.stringify(schedule_config));
    const row = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(result.lastInsertRowid);
    broadcastUpdate('reminders');
    res.status(201).json({ ...row, schedule_config: JSON.parse(row.schedule_config) });
  });

  app.put('/api/reminders/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Reminder not found' });
    const { name, icon, icon_type, icon_image, schedule_type, schedule_config, active } = req.body;
    const newScheduleType = schedule_type ?? existing.schedule_type;
    const newScheduleConfig = schedule_config !== undefined ? schedule_config : JSON.parse(existing.schedule_config);
    const scheduleError = validateReminderSchedule(newScheduleType, newScheduleConfig);
    if (scheduleError) return res.status(400).json({ error: scheduleError });
    const newIconType = icon_type !== undefined
      ? (['emoji', 'text', 'image'].includes(icon_type) ? icon_type : 'emoji')
      : existing.icon_type;
    const newIconImage = newIconType === 'image' ? (icon_image ?? existing.icon_image) : null;
    // Clean up the old file whenever it's being replaced by a different one, or
    // dropped entirely because the type changed away from 'image' — same
    // pattern removeCustomThemeFile() already uses for decorations, just
    // inline here since this is the only place a reminder's own icon image
    // ever changes.
    if (existing.icon_image && existing.icon_image !== newIconImage) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, existing.icon_image)); } catch {}
    }
    db.prepare(`
    UPDATE reminders SET name=?, icon=?, icon_type=?, icon_image=?, schedule_type=?, schedule_config=?, active=?
    WHERE id=?
  `).run(
      name !== undefined ? demoCleanText(name, 120) : existing.name,
      icon ?? existing.icon,
      newIconType,
      newIconImage,
      newScheduleType,
      JSON.stringify(newScheduleConfig),
      active !== undefined ? (active ? 1 : 0) : existing.active,
      req.params.id
    );
    const row = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
    broadcastUpdate('reminders');
    res.json({ ...row, schedule_config: JSON.parse(row.schedule_config) });
  });

  app.delete('/api/reminders/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Reminder not found' });
    if (existing.icon_image) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, existing.icon_image)); } catch {}
    }
    db.prepare(`DELETE FROM reminders WHERE id = ?`).run(req.params.id);
    broadcastUpdate('reminders');
    res.json({ ok: true });
  });
};
