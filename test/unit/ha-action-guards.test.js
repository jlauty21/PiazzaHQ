'use strict';
// The Home Assistant call-action guard tables. `POST /api/ha/call-action`
// rejects (400, before any HA call) an action whose entity is the wrong
// domain — DOMAIN_LOCKED_ACTIONS (betas 1.84.0-beta.9..15) — or an
// on/off/toggle aimed at a read-only domain — HA_READ_ONLY_DOMAINS /
// HA_UNTARGETED_ACTIONS (1.85.0-beta.2). This asserts the DATA those checks
// run on: the actual thing that changes when a guard is added or broken.
const fs = require('fs');
const path = require('path');
const { extractConst } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, ok, report } = require('../lib/tap');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const NAMES = ['HA_ACTIONS', 'DOMAIN_LOCKED_ACTIONS', 'HA_READ_ONLY_DOMAINS', 'HA_UNTARGETED_ACTIONS'];
const g = evalInSandbox(NAMES.map(n => extractConst(SERVER, n)), {}, NAMES);

(async () => {
  await check('domain-locked actions map to their required entity domain', () => {
    eq(g.DOMAIN_LOCKED_ACTIONS.unlock, 'lock');
    eq(g.DOMAIN_LOCKED_ACTIONS.lock, 'lock');
    eq(g.DOMAIN_LOCKED_ACTIONS.open_cover, 'cover');
    eq(g.DOMAIN_LOCKED_ACTIONS.set_brightness, 'light');
    eq(g.DOMAIN_LOCKED_ACTIONS.volume_set, 'media_player');
    eq(g.DOMAIN_LOCKED_ACTIONS.set_fan_speed, 'fan');
  });

  await check('every domain-locked action is a real action in HA_ACTIONS', () => {
    for (const action of Object.keys(g.DOMAIN_LOCKED_ACTIONS)) {
      ok(Object.prototype.hasOwnProperty.call(g.HA_ACTIONS, action),
        `"${action}" is in DOMAIN_LOCKED_ACTIONS but not HA_ACTIONS — the route would 400 "unknown action" before the domain check runs`);
    }
  });

  await check('generic on/off/toggle/trigger are NOT domain-locked', () => {
    for (const a of ['turn_on', 'turn_off', 'toggle', 'trigger']) {
      ok(!(a in g.DOMAIN_LOCKED_ACTIONS), `"${a}" should stay domain-agnostic`);
    }
  });

  await check('read-only domains include the non-actuable ones', () => {
    for (const d of ['sensor', 'binary_sensor', 'weather', 'sun', 'air_quality', 'zone']) {
      ok(g.HA_READ_ONLY_DOMAINS.has(d), `"${d}" should be treated as read-only`);
    }
  });

  await check('read-only domains do NOT include anything actuable', () => {
    for (const d of ['light', 'switch', 'fan', 'cover', 'lock', 'media_player', 'climate', 'scene', 'script', 'input_boolean']) {
      ok(!g.HA_READ_ONLY_DOMAINS.has(d), `"${d}" is actuable and must not be flagged read-only`);
    }
  });

  await check('untargeted actions are exactly the generic on/off set', () => {
    eq([...g.HA_UNTARGETED_ACTIONS].sort(), ['toggle', 'trigger', 'turn_off', 'turn_on']);
  });

  await check('the read-only reject only fires for untargeted actions', () => {
    // A targeted action (e.g. open_cover) at a sensor is already caught by
    // DOMAIN_LOCKED_ACTIONS; the read-only guard is specifically the
    // catch for the generic ones, so its action set must be a subset of
    // the untargeted set.
    for (const a of g.HA_UNTARGETED_ACTIONS) {
      ok(!(a in g.DOMAIN_LOCKED_ACTIONS), `"${a}" cannot be both untargeted and domain-locked`);
    }
  });

  report();
})();
