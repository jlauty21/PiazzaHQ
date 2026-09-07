'use strict';
// /api/ha/call-action + call-group-action are fire-and-forget: they answer as
// soon as HA accepts the call (or a fast error comes back), not after the
// service action physically finishes. A slow HA (a cover mid-travel) must not
// make the client wait — the response comes back within ~2s with pending:true,
// and the command still reached HA.
const { bootServer, api } = require('../lib/boot-server');
const { startFakeHA } = require('../lib/fake-ha');
const { check, eq, ok, report } = require('../lib/tap');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const ha = await startFakeHA();
  const srv = await bootServer();
  const G = (p) => api(srv.base, 'GET', p);
  const P = (p, b) => api(srv.base, 'POST', p, b);
  const PUT = (p, b) => api(srv.base, 'PUT', p, b);

  try {
    await check('point the server at the fake HA', async () => {
      eq((await PUT('/api/settings', { ha_base_url: ha.baseUrl, ha_token: 'test-token' })).status, 200);
    });

    await check('a fast service call returns ok with pending:false', async () => {
      ha.setServiceDelay(0);
      const before = ha.calls.length;
      const r = await P('/api/ha/call-action', { entityId: 'cover.garage', action: 'close_cover' });
      eq(r.status, 200);
      eq(r.json.ok, true);
      eq(r.json.pending, false);
      eq(ha.calls.length, before + 1);
      eq(ha.calls[ha.calls.length - 1].service, 'close_cover');
    });

    await check('a SLOW HA does not block the client: ~2s, pending:true, command still sent', async () => {
      ha.setServiceDelay(6000); // HA won't answer the service call for 6s
      const before = ha.calls.length;
      const t0 = Date.now();
      const r = await P('/api/ha/call-action', { entityId: 'cover.garage', action: 'open_cover' });
      const elapsed = Date.now() - t0;
      eq(r.status, 200);
      eq(r.json.ok, true);
      eq(r.json.pending, true, 'client told the action is still settling');
      ok(elapsed < 3500, `responded in ${elapsed}ms, well before HA finished`);
      eq(ha.calls.length, before + 1, 'the open_cover call still went to HA');
      eq(ha.calls[ha.calls.length - 1].service, 'open_cover');
      await sleep(6500); // let the background request drain before the next test
    });

    await check('group action is fire-and-forget too', async () => {
      ha.setServiceDelay(6000);
      const before = ha.calls.length;
      const t0 = Date.now();
      const r = await P('/api/ha/call-group-action', { entityIds: ['light.bar', 'lock.front_door'], action: 'turn_off' });
      const elapsed = Date.now() - t0;
      eq(r.status, 200);
      eq(r.json.ok, true);
      eq(r.json.pending, true);
      ok(elapsed < 3500, `responded in ${elapsed}ms`);
      eq(ha.calls.length, before + 1);
      await sleep(6500);
    });

    await check('a genuine bad-domain action still fails fast (guard, before HA)', async () => {
      ha.setServiceDelay(0);
      const r = await P('/api/ha/call-action', { entityId: 'light.bar', action: 'unlock' });
      eq(r.status, 400);
    });
  } finally {
    await srv.stop();
    await ha.stop();
  }

  report();
})();
