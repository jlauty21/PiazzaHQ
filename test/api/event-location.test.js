'use strict';
// Calendar event locations: a local event carries `location` through
// create/list/update, and a feed's per-calendar `show_location` flag persists.
// (The feed-side gating — location blanked unless show_location=1 — is the
// SELECT ... CASE in /api/events; the parse side is covered in parse-ics.test.)
const { bootServer, api } = require('../lib/boot-server');
const { check, eq, ok, report } = require('../lib/tap');

(async () => {
  const srv = await bootServer();
  const G = (p) => api(srv.base, 'GET', p);
  const P = (p, b) => api(srv.base, 'POST', p, b);
  const PUT = (p, b) => api(srv.base, 'PUT', p, b);

  try {
    let id;
    await check('local event: location survives create -> list -> update', async () => {
      const c = await P('/api/events', { title: 'Hockey', date: '2026-11-14', location: 'Cedar Rapids Ice Arena' });
      eq(c.status, 201);
      eq(c.json.location, 'Cedar Rapids Ice Arena');
      id = c.json.id;

      const list = await G('/api/events?from=2026-11-01&to=2026-11-30');
      eq(list.json.find(e => e.id === id && e.source === 'local').location, 'Cedar Rapids Ice Arena');

      // partial PUT that doesn't mention location leaves it intact
      await PUT(`/api/events/${id}`, { title: 'Hockey (rescheduled)' });
      const l2 = await G('/api/events?from=2026-11-01&to=2026-11-30');
      eq(l2.json.find(e => e.id === id).location, 'Cedar Rapids Ice Arena');

      // and an explicit change takes
      await PUT(`/api/events/${id}`, { location: 'Rink 2' });
      const l3 = await G('/api/events?from=2026-11-01&to=2026-11-30');
      eq(l3.json.find(e => e.id === id).location, 'Rink 2');
    });

    await check('events-manage also returns location for local events', async () => {
      const m = await G('/api/events-manage?from=2026-11-01');
      const row = m.json.find(e => e.source === 'local' && e.id === id);
      ok(row, 'local event present in events-manage');
      eq(row.location, 'Rink 2');
    });

    await check('a feed keeps its show_location flag (default off, toggles on)', async () => {
      const add = await P('/api/feeds', { name: 'Kids Hockey', url: 'https://example.invalid/hockey.ics', color: '#4A90D9' });
      // sync will fail against an unreachable URL — that's fine, the row is still created
      ok(add.status === 201, `feed created (status ${add.status})`);
      const fid = add.json.id;
      eq(add.json.show_location, 0, 'defaults off');

      eq((await PUT(`/api/feeds/${fid}`, { show_location: true })).status, 200);
      const feeds = await G('/api/feeds');
      eq(feeds.json.find(f => f.id === fid).show_location, 1);

      eq((await PUT(`/api/feeds/${fid}`, { show_location: false })).status, 200);
      const feeds2 = await G('/api/feeds');
      eq(feeds2.json.find(f => f.id === fid).show_location, 0);
    });
  } finally {
    await srv.stop();
  }

  report();
})();
