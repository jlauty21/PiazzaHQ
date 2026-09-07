'use strict';
// A stand-in Home Assistant REST API, just enough for the device app's HA
// paths: an API-alive probe, entity state reads, and service calls (which
// record what was asked and mutate the in-memory state so a follow-up read
// reflects it). No websocket — area/registry lookups degrade gracefully in
// server.js when the WS isn't reachable.
const http = require('http');

const DEFAULT_STATES = {
  'light.bar': { entity_id: 'light.bar', state: 'off', attributes: { friendly_name: 'Bar', supported_color_modes: ['color_temp', 'xy'], brightness: 0 } },
  'lock.front_door': { entity_id: 'lock.front_door', state: 'locked', attributes: { friendly_name: 'Front Door' } },
  'cover.garage': { entity_id: 'cover.garage', state: 'closed', attributes: { friendly_name: 'Garage', device_class: 'garage' } },
  'media_player.frame': { entity_id: 'media_player.frame', state: 'playing', attributes: { friendly_name: 'The Frame', volume_level: 0.2, media_title: 'Something' } },
  'sensor.hallway_temp': { entity_id: 'sensor.hallway_temp', state: '71.5', attributes: { friendly_name: 'Hallway Temp', unit_of_measurement: '°F' } },
  'binary_sensor.door': { entity_id: 'binary_sensor.door', state: 'off', attributes: { friendly_name: 'Door' } },
};

function startFakeHA(seedStates) {
  const states = JSON.parse(JSON.stringify(seedStates || DEFAULT_STATES));
  const calls = []; // { domain, service, data }

  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/api/') return send(200, { message: 'API running.' });
    if (req.method === 'GET' && url === '/api/states') return send(200, Object.values(states));

    let m;
    if (req.method === 'GET' && (m = url.match(/^\/api\/states\/(.+)$/))) {
      const id = decodeURIComponent(m[1]);
      return states[id] ? send(200, states[id]) : send(404, { message: 'not found' });
    }

    if (req.method === 'POST' && (m = url.match(/^\/api\/services\/([^/]+)\/([^/]+)$/))) {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        const [, domain, service] = m;
        calls.push({ domain, service, data });
        // Reflect the obvious ones so a reconcile read sees the change.
        const ids = [].concat(data.entity_id || []);
        for (const id of ids) {
          if (!states[id]) continue;
          if (service === 'turn_on') states[id].state = 'on';
          else if (service === 'turn_off') states[id].state = 'off';
          else if (service === 'toggle') states[id].state = states[id].state === 'on' ? 'off' : 'on';
          else if (service === 'lock') states[id].state = 'locked';
          else if (service === 'unlock') states[id].state = 'unlocked';
          else if (service === 'open_cover') states[id].state = 'open';
          else if (service === 'close_cover') states[id].state = 'closed';
        }
        send(200, ids.map(id => states[id]).filter(Boolean));
      });
      return;
    }

    send(404, { message: 'fake-ha: unhandled ' + req.method + ' ' + url });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        calls,
        states,
        setState: (id, state, attrs) => { states[id] = { entity_id: id, state, attributes: { ...(states[id] && states[id].attributes), ...(attrs || {}) } }; },
        stop: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startFakeHA, DEFAULT_STATES };
