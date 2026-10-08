'use strict';
// Family member profiles: who is in the household, their colours/avatars, which tabs and features each can use, and the optional profile PIN (with its rate limit).
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/profiles.test.js and test/api/profile-pin.test.js.
module.exports = function registerProfiles({ crypto, app, db, makeRateLimiter, broadcastUpdate, clientIp }) {
  // Persona picker for the companion app — NOT authentication. See the profiles
  // table comment in the schema block. Zero rows = the app is unchanged. On a
  // slave these mutating routes proxy to the host automatically (slaveWriteGuard
  // doesn't allowlist /api/profiles as local-only).

  // Only these tabs can be hidden — calendars/favorites/settings always stay.
  const HIDEABLE_TABS = new Set(['photos', 'layout', 'displays', 'family']);
  const PROFILE_FEATURE_KEYS = new Set(['ha', 'integrations']);
  const PROFILE_PRESETS = new Set(['basic', 'intermediate', 'advanced', 'custom']);

  // Normalise a client-supplied hidden_tabs value to a JSON string of a clean
  // array (unknown / non-hideable ids dropped, deduped).
  function cleanHiddenTabs(v) {
    let arr = v;
    if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { arr = []; } }
    if (!Array.isArray(arr)) arr = [];
    return JSON.stringify([...new Set(arr.filter(t => HIDEABLE_TABS.has(t)))]);
  }
  // Normalise features to a JSON string of an object with only known boolean keys.
  function cleanFeatures(v) {
    let obj = v;
    if (typeof v === 'string') { try { obj = JSON.parse(v); } catch { obj = {}; } }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
    const out = {};
    for (const k of PROFILE_FEATURE_KEYS) { if (k in obj) out[k] = !!obj[k]; }
    return JSON.stringify(out);
  }
  function countManagers(exceptId) {
    const row = exceptId != null
      ? db.prepare(`SELECT COUNT(*) n FROM profiles WHERE is_manager = 1 AND id != ?`).get(exceptId)
      : db.prepare(`SELECT COUNT(*) n FROM profiles WHERE is_manager = 1`).get();
    return row.n;
  }

  // GET /api/profiles — rows verbatim; the client parses hidden_tabs / features.
  // A profile's gateway PIN is a family "who is using the app" lock. It used to be sent to the browser and compared
  // there, which handed every PIN to anyone who could read the profile list (including a signed-in remote session).
  // Now the list only says WHETHER a profile has one (has_pin) and the PIN is checked here.
  function publicProfile(row) {
    if (!row) return row;
    const { pin, ...rest } = row;
    return { ...rest, pin: '', has_pin: pin ? 1 : 0 };
  }
  const profilePinLimiter = makeRateLimiter({ maxAttempts: 10, windowMs: 10 * 60 * 1000, lockoutMs: 5 * 60 * 1000 });
  app.post('/api/profiles/:id/check-pin', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const row = db.prepare(`SELECT id, pin FROM profiles WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'No such profile.' });
    if (!row.pin) return res.json({ ok: true });
    const lim = profilePinLimiter.check(clientIp(req) + ':' + row.id);
    if (!lim.allowed) return res.status(429).json({ error: 'Too many wrong tries. Wait a few minutes.' });
    const given = String((req.body && req.body.pin) || '');
    const a = Buffer.from(given), b = Buffer.from(String(row.pin));
    const good = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (good) profilePinLimiter.reset(clientIp(req) + ':' + row.id);
    res.json({ ok: good });
  });
  app.get('/api/profiles', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(db.prepare(`SELECT * FROM profiles ORDER BY sort, id`).all().map(publicProfile));
  });

  // POST /api/profiles — the very first profile in a household is forced to be a
  // manager, so a household can never lock itself out of profile management.
  app.post('/api/profiles', (req, res) => {
    const b = req.body || {};
    const name = (b.name || '').toString().trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const isFirst = db.prepare(`SELECT COUNT(*) n FROM profiles`).get().n === 0;
    const landing = HIDEABLE_TABS.has(b.landing_tab) || ['favorites', 'calendars', 'settings'].includes(b.landing_tab)
      ? b.landing_tab : 'favorites';
    const preset = PROFILE_PRESETS.has(b.preset) ? b.preset : 'custom';
    const result = db.prepare(`
    INSERT INTO profiles (name, color, avatar, is_manager, landing_tab, hidden_tabs, features, pin, preset, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
      name,
      /^#[0-9a-fA-F]{3,8}$/.test(b.color || '') ? b.color : '#4A90D9',
      (b.avatar || '').toString().slice(0, 8),
      isFirst || b.is_manager ? 1 : 0,
      landing,
      cleanHiddenTabs(b.hidden_tabs),
      cleanFeatures(b.features),
      (b.pin || '').toString().replace(/\D/g, '').slice(0, 8),
      preset,
      Number.isInteger(b.sort) ? b.sort : 0
    );
    broadcastUpdate('profiles');
    res.status(201).json(publicProfile(db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(result.lastInsertRowid)));
  });

  // PUT /api/profiles/:id — partial: only the keys present in the body change.
  // pin: send "" to clear, omit to keep.
  app.put('/api/profiles/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profile not found' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const put = (col, val) => { sets.push(`${col}=?`); vals.push(val); };

    if (b.name !== undefined) {
      const n = (b.name || '').toString().trim().slice(0, 40);
      if (!n) return res.status(400).json({ error: 'name cannot be empty' });
      put('name', n);
    }
    if (b.color !== undefined && /^#[0-9a-fA-F]{3,8}$/.test(b.color || '')) put('color', b.color);
    if (b.avatar !== undefined) put('avatar', (b.avatar || '').toString().slice(0, 8));
    if (b.is_manager !== undefined) {
      const next = b.is_manager ? 1 : 0;
      // Never let the last manager demote themselves — the household would lose
      // all profile-management access.
      if (!next && existing.is_manager && countManagers(existing.id) === 0) {
        return res.status(400).json({ error: 'At least one profile must stay a manager.' });
      }
      put('is_manager', next);
    }
    if (b.landing_tab !== undefined) {
      const ok = HIDEABLE_TABS.has(b.landing_tab) || ['favorites', 'calendars', 'settings'].includes(b.landing_tab);
      put('landing_tab', ok ? b.landing_tab : 'favorites');
    }
    if (b.hidden_tabs !== undefined) put('hidden_tabs', cleanHiddenTabs(b.hidden_tabs));
    if (b.features !== undefined) put('features', cleanFeatures(b.features));
    if (b.pin !== undefined) put('pin', (b.pin || '').toString().replace(/\D/g, '').slice(0, 8));
    if (b.preset !== undefined) put('preset', PROFILE_PRESETS.has(b.preset) ? b.preset : 'custom');
    if (b.sort !== undefined && Number.isInteger(b.sort)) put('sort', b.sort);

    if (!sets.length) return res.json(existing);
    vals.push(existing.id);
    db.prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    broadcastUpdate('profiles');
    res.json(publicProfile(db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(existing.id)));
  });

  // DELETE /api/profiles/:id — refuses to remove the last manager; orphaned
  // events fall back to owner_profile_id = NULL (default colour).
  app.delete('/api/profiles/:id', (req, res) => {
    const existing = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Profile not found' });
    if (existing.is_manager && countManagers(existing.id) === 0) {
      return res.status(400).json({ error: 'This is the only manager profile — make another profile a manager first.' });
    }
    db.prepare(`UPDATE events SET owner_profile_id = NULL WHERE owner_profile_id = ?`).run(existing.id);
    db.prepare(`UPDATE messages SET author_profile_id = NULL WHERE author_profile_id = ?`).run(existing.id);
    db.prepare(`DELETE FROM profiles WHERE id = ?`).run(existing.id);
    broadcastUpdate('profiles');
    broadcastUpdate('events');
    broadcastUpdate('messages');
    res.json({ ok: true });
  });
};
