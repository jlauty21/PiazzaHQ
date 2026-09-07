'use strict';
// The Home Assistant condition-alert lifecycle, end to end against a fake
// HA: an always-true rule fires, shows in the active + notifications lists,
// a dismiss clears it and it does not re-fire while the condition holds,
// and removing the rule clears everything.
const { bootServer, api } = require('../lib/boot-server');
const { startFakeHA } = require('../lib/fake-ha');
const { check, eq, ok, report } = require('../lib/tap');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { tries = 30, gap = 300 } = {}) {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(gap); }
  return false;
}

(async () => {
  const ha = await startFakeHA();
  ha.setState('sensor.hallway_temp', '85', { unit_of_measurement: '°F', friendly_name: 'Hallway Temp' });

  const srv = await bootServer();
  const G = (p) => api(srv.base, 'GET', p);
  const P = (p, b) => api(srv.base, 'POST', p, b);
  const PUT = (p, b) => api(srv.base, 'PUT', p, b);

  try {
    await check('point the server at the fake HA', async () => {
      const r = await PUT('/api/settings', { ha_base_url: ha.baseUrl, ha_token: 'test-token' });
      ok(r.status === 200, `settings PUT status ${r.status}`);
      const probe = await G('/api/ha/entities');
      ok(probe.status === 200 && Array.isArray(probe.json), 'server can read entities from the fake HA');
    });

    await check('an always-true rule fires within a couple of seconds', async () => {
      const put = await PUT('/api/ha-alerts', { alerts: [
        { id: 'lt', entityId: 'sensor.hallway_temp', name: 'Hallway Temp', op: 'above', value: '10',
          dwellMin: 0, message: 'too warm', enabled: true, screen: true, phone: true },
      ] });
      eq(put.status, 200);
      const fired = await waitFor(async () => {
        const a = await G('/api/ha-alerts/active');
        return a.json && a.json.active && a.json.active.some(x => x.id === 'lt');
      });
      ok(fired, 'rule "lt" showed up in /api/ha-alerts/active');
    });

    await check('it also surfaces as a kind:"ha-alert" notification', async () => {
      const n = await G('/api/notifications/active');
      const hit = (n.json.notifications || []).find(x => x.kind === 'ha-alert' && /too warm/.test(x.body || ''));
      ok(hit, 'notification present with the rule message');
    });

    await check('dismiss clears it and it does NOT re-fire while still true', async () => {
      const n = await G('/api/notifications/active');
      const key = (n.json.notifications.find(x => x.kind === 'ha-alert') || {}).key;
      ok(key, 'have a notification key to dismiss');
      eq((await P('/api/notifications/dismiss', { key })).status, 200);

      const staysClear = await waitFor(async () => {
        const a = await G('/api/notifications/active');
        return !(a.json.notifications || []).some(x => x.kind === 'ha-alert');
      }, { tries: 6, gap: 300 });
      ok(staysClear, 'no ha-alert notification after dismiss');
      // give the evaluator a beat to run again — must not resurrect it
      await sleep(1200);
      const again = await G('/api/notifications/active');
      ok(!(again.json.notifications || []).some(x => x.kind === 'ha-alert'), 'still clear — no re-fire while condition holds');
    });

    await check('removing the rule clears its active entry', async () => {
      eq((await PUT('/api/ha-alerts', { alerts: [] })).status, 200);
      const cleared = await waitFor(async () => {
        const a = await G('/api/ha-alerts/active');
        return (a.json.active || []).length === 0;
      });
      ok(cleared, '/api/ha-alerts/active is empty after the rule is removed');
    });
  } finally {
    await srv.stop();
    await ha.stop();
  }

  report();
})();
