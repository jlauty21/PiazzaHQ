'use strict';
// filterHaEntitiesD(query, areaId) — the wall display's HA entity picker
// filter (Live Edit advanced panels). Matches friendly name OR entity id,
// AND-combined with an optional area filter. Mirror of app.html's own
// picker filter; the searchable-alert-picker work (1.85.0-beta.1) leans on
// the same "name or id" match.
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, report } = require('../lib/tap');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'display.html'), 'utf8');

const ENTITIES = [
  { entity_id: 'light.kitchen_main', friendly_name: 'Kitchen Main' },
  { entity_id: 'light.bar', friendly_name: 'Bar Light' },
  { entity_id: 'lock.front_door', friendly_name: 'Front Door' },
  { entity_id: 'sensor.kitchen_temp', friendly_name: 'Kitchen Temperature' },
];
const AREAS = {
  areas: [{ id: 'a_kitchen', name: 'Kitchen' }, { id: 'a_hall', name: 'Hall' }],
  entityAreas: { 'light.kitchen_main': 'a_kitchen', 'sensor.kitchen_temp': 'a_kitchen', 'lock.front_door': 'a_hall' },
};

function filter(query, areaId, { entities = ENTITIES, areas = AREAS } = {}) {
  const s = evalInSandbox(
    [extractFunction(HTML, 'function filterHaEntitiesD(')],
    { cachedHaEntitiesD: entities, cachedHaAreasD: areas },
    ['filterHaEntitiesD']
  );
  return s.filterHaEntitiesD(query, areaId).map(e => e.entity_id);
}

(async () => {
  await check('empty query, no area -> everything', () => {
    eq(filter('', '').length, 4);
    eq(filter(null, null).length, 4);
  });

  await check('matches on friendly name, case-insensitively, trimmed', () => {
    eq(filter('  KITCHEN ', ''), ['light.kitchen_main', 'sensor.kitchen_temp']);
  });

  await check('matches on entity id too', () => {
    eq(filter('front_door', ''), ['lock.front_door']);
    eq(filter('light.', ''), ['light.kitchen_main', 'light.bar']);
  });

  await check('area filter narrows to that room', () => {
    eq(filter('', 'a_kitchen'), ['light.kitchen_main', 'sensor.kitchen_temp']);
    eq(filter('', 'a_hall'), ['lock.front_door']);
  });

  await check('area + text combine (AND)', () => {
    eq(filter('temp', 'a_kitchen'), ['sensor.kitchen_temp']);
    eq(filter('bar', 'a_kitchen'), []); // bar light is in no area
  });

  await check('no matches -> empty array, not a throw', () => {
    eq(filter('zzz-nothing', ''), []);
  });

  await check('unknown area id -> nothing (entity with no area never matches a specific one)', () => {
    eq(filter('', 'a_nonexistent'), []);
  });

  report();
})();
