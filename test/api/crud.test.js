'use strict';
// Boots the real server.js on a fresh DATA_DIR and drives real routes:
// migrations run clean, core CRUD round-trips, the HA action guards reject
// before touching HA, the per-screen banner settings round-trip, and demo
// mode fences the integration routes.
const { bootServer, api } = require('../lib/boot-server');
const { check, eq, ok, report } = require('../lib/tap');

(async () => {
  const srv = await bootServer();
  const G = (p) => api(srv.base, 'GET', p);
  const P = (p, b) => api(srv.base, 'POST', p, b);
  const PUT = (p, b) => api(srv.base, 'PUT', p, b);
  const DEL = (p, b) => api(srv.base, 'DELETE', p, b);

  try {
    await check('server boots on an empty DATA_DIR (migrations ran, no crash)', () => {
      ok(/Piazza HQ running at/.test(srv.output()));
    });

    await check('GET /api/version reports a version and stable/beta flag', async () => {
      const r = await G('/api/version');
      eq(r.status, 200);
      ok(typeof r.json.version === 'string' && r.json.version.length > 0);
      eq(typeof r.json.isBeta, 'boolean');
    });

    await check('events: create -> list -> update -> delete round-trip', async () => {
      const created = await P('/api/events', { title: 'Dentist', date: '2026-09-10', notes: 'bring form' });
      eq(created.status, 201);
      const id = created.json.id;
      ok(id != null, 'created event has an id');

      const list = await G('/api/events?from=2026-09-01&to=2026-09-30');
      eq(list.status, 200);
      const mine = list.json.find(e => e.id === id && e.source === 'local');
      ok(mine, 'created event shows up in the list as source:local');
      eq(mine.title, 'Dentist');

      const upd = await PUT(`/api/events/${id}`, { title: 'Dentist (moved)', date: '2026-09-11' });
      eq(upd.status, 200);
      const after = await G('/api/events?from=2026-09-01&to=2026-09-30');
      eq(after.json.find(e => e.id === id).title, 'Dentist (moved)');

      const del = await DEL(`/api/events/${id}`);
      ok(del.status === 200 || del.status === 204);
      const gone = await G('/api/events?from=2026-09-01&to=2026-09-30');
      ok(!gone.json.some(e => e.id === id && e.source === 'local'), 'deleted event is gone');
    });

    await check('ha-alerts: PUT the list (camelCase shape) then GET it back', async () => {
      const put = await PUT('/api/ha-alerts', { alerts: [
        { id: 'r1', entityId: 'sensor.hallway_temp', name: 'Freezer', op: 'above', value: '10', dwellMin: 5, message: 'warm', enabled: true, screen: true, phone: false },
      ] });
      eq(put.status, 200);
      const got = await G('/api/ha-alerts');
      eq(got.json.alerts.length, 1);
      eq(got.json.alerts[0].entityId, 'sensor.hallway_temp');
      eq(got.json.alerts[0].dwellMin, 5);
      eq(got.json.alerts[0].phone, false);
    });

    await check('hidden-events: POST hides, DELETE restores', async () => {
      const key = 'ical:abc@x';
      eq((await P('/api/hidden-events', { event_key: key, scope: 'series', title: 'X' })).status, 200);
      const list = await G('/api/hidden-events');
      ok(list.json.some(h => h.event_key === key), 'hidden row present');
      eq((await DEL('/api/hidden-events', { event_key: key })).status, 200);
      const after = await G('/api/hidden-events');
      ok(!after.json.some(h => h.event_key === key), 'hidden row removed');
    });

    await check('HA guard: wrong-domain action -> 400 before any HA call', async () => {
      const r = await P('/api/ha/call-action', { entityId: 'light.bar', action: 'unlock' });
      eq(r.status, 400);
      ok(/lock/.test(r.json.error || ''), 'error mentions the required domain');
    });

    await check('HA guard: on/off aimed at a read-only domain -> 400', async () => {
      const r = await P('/api/ha/call-action', { entityId: 'sensor.hallway_temp', action: 'toggle' });
      eq(r.status, 400);
      ok(/read-only/i.test(r.json.error || ''));
    });

    await check('per-screen banner settings round-trip via /api/screen-config; bad values clamp', async () => {
      const screens = await G('/api/screens');
      // /api/screen-config auto-registers a screen for an unknown id
      const cfg0 = await G('/api/screen-config?screen=phq-test-screen');
      eq(cfg0.status, 200);
      // find the device_id it just created
      const list = await G('/api/screens');
      const dev = list.json[list.json.length - 1];
      ok(dev && dev.device_id, 'a screen row exists to target');

      eq((await PUT(`/api/screens/${dev.device_id}`, { alert_banner_position: 'center', alert_banner_size: 'xxl', alert_banner_style: 'amber' })).status, 200);
      const cfg1 = await G(`/api/screen-config?screen=${encodeURIComponent(dev.device_id)}`);
      eq(cfg1.json.alert_banner_position, 'center');
      eq(cfg1.json.alert_banner_size, 'xxl');
      eq(cfg1.json.alert_banner_style, 'amber');

      await PUT(`/api/screens/${dev.device_id}`, { alert_banner_position: 'sideways', alert_banner_size: 'giant', alert_banner_style: 'neon' });
      const cfg2 = await G(`/api/screen-config?screen=${encodeURIComponent(dev.device_id)}`);
      eq(cfg2.json.alert_banner_position, 'top');
      eq(cfg2.json.alert_banner_size, 'm');
      eq(cfg2.json.alert_banner_style, 'solid');
    });
  } finally {
    await srv.stop();
  }

  // ── demo mode fences the integration routes ──
  const demo = await bootServer({ demo: true });
  try {
    await check('DEMO_MODE: /api/version says demo:true', async () => {
      const r = await api(demo.base, 'GET', '/api/version');
      eq(r.json.demo, true);
    });
    await check('DEMO_MODE: a blocked integration route -> 403', async () => {
      const r = await api(demo.base, 'PUT', '/api/ha-alerts', { alerts: [] });
      eq(r.status, 403);
      ok(/not available in the demo/i.test(r.json.error || ''));
    });
    await check('DEMO_MODE: reading is still allowed (GET /api/ha-alerts)', async () => {
      const r = await api(demo.base, 'GET', '/api/ha-alerts');
      eq(r.status, 200);
    });
  } finally {
    await demo.stop();
  }

  report();
})();
