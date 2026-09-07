'use strict';
// Family member profiles: /api/profiles CRUD, the manager guards, the
// gateway-PIN keep/clear behaviour, event owner_profile_id round-trip and
// orphan cleanup, and that the sync snapshot carries the profiles table.
const { bootServer, api } = require('../lib/boot-server');
const { check, eq, ok, report } = require('../lib/tap');

(async () => {
  const srv = await bootServer();
  const G = (p) => api(srv.base, 'GET', p);
  const P = (p, b) => api(srv.base, 'POST', p, b);
  const PUT = (p, b) => api(srv.base, 'PUT', p, b);
  const DEL = (p, b) => api(srv.base, 'DELETE', p, b);

  try {
    let jon, sam;

    await check('starts empty, then the first profile is forced to be a manager', async () => {
      const empty = await G('/api/profiles');
      eq(empty.status, 200);
      eq(empty.json.length, 0);

      const a = await P('/api/profiles', { name: 'Jon', preset: 'advanced' });
      eq(a.status, 201);
      eq(a.json.is_manager, 1, 'first profile is a manager regardless of the body');
      jon = a.json.id;

      const b = await P('/api/profiles', {
        name: 'Sam', preset: 'basic',
        hidden_tabs: ['photos', 'layout', 'displays', 'nonsense'],
        features: { ha: false, integrations: false, bogus: true },
        landing_tab: 'calendars', pin: '12ab34',
      });
      eq(b.status, 201);
      eq(b.json.is_manager, 0, 'later profiles are not managers by default');
      sam = b.json.id;
      eq(JSON.parse(b.json.hidden_tabs).sort().join(','), 'displays,layout,photos', 'unknown tab ids are dropped');
      eq(JSON.parse(b.json.features).bogus, undefined, 'unknown feature keys are dropped');
      eq(b.json.pin, '1234', 'pin keeps digits only');
    });

    await check('PUT is partial; pin keeps on omit, clears on ""', async () => {
      const r1 = await PUT(`/api/profiles/${sam}`, { name: 'Samuel', preset: 'intermediate' });
      eq(r1.status, 200);
      eq(r1.json.name, 'Samuel');
      eq(r1.json.pin, '1234', 'pin unchanged when the key is absent');

      const r2 = await PUT(`/api/profiles/${sam}`, { pin: '' });
      eq(r2.json.pin, '', 'empty string clears the pin');
    });

    await check('the last manager cannot be demoted or deleted', async () => {
      const demote = await PUT(`/api/profiles/${jon}`, { is_manager: false });
      eq(demote.status, 400);
      const del = await DEL(`/api/profiles/${jon}`);
      eq(del.status, 400);

      // promote Sam, then Jon can go
      eq((await PUT(`/api/profiles/${sam}`, { is_manager: true })).status, 200);
      eq((await DEL(`/api/profiles/${jon}`)).status, 200);
    });

    await check('events carry owner_profile_id, and it is nulled when the owner is deleted', async () => {
      const ev = await P('/api/events', { title: 'Dentist', date: '2026-09-10', owner_profile_id: sam });
      eq(ev.status, 201);
      eq(ev.json.owner_profile_id, sam);

      const list = await G('/api/events?from=2026-09-01&to=2026-09-30');
      eq(list.json.find(e => e.id === ev.json.id).owner_profile_id, sam);

      // add another manager so Sam is deletable
      const kid = await P('/api/profiles', { name: 'Kid', is_manager: true });
      eq((await DEL(`/api/profiles/${sam}`)).status, 200);

      const after = await G('/api/events?from=2026-09-01&to=2026-09-30');
      eq(after.json.find(e => e.id === ev.json.id).owner_profile_id, null, 'orphaned event owner is nulled');
      void kid;
    });

    await check('the sync snapshot includes the profiles table', async () => {
      const snap = await G('/api/sync/export');
      eq(snap.status, 200);
      ok(Array.isArray(snap.json.tables.profiles), 'tables.profiles is an array');
      ok(snap.json.tables.profiles.length >= 1);
    });
  } finally {
    await srv.stop();
  }

  report();
})();
