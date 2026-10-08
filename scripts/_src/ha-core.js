'use strict';
// Home Assistant core (read-only Entity Status): the request helpers, connection test, auto-discovery on the local network / Tailscale, and the entity list.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/ha-read.test.js.
module.exports = function registerHaCore({ URL, path, http, fetchWithTimeout, os, app, PORT, getSetting, execFileSync }) {
  // Same shape as the Todoist/Weather integrations above: the base URL + token live
  // in settings and are used ONLY server-side — the browser/display never sees the
  // token, only ever talks to these proxy endpoints. Unlike Todoist (a fixed
  // hostname), Home Assistant is self-hosted at a URL the user provides, so the
  // request helper parses it dynamically (same pattern as centralRequest() above)
  // rather than assuming a hostname.
  function haRequest(pathAndQuery, method, body, opts) {
    return haRequestWith(getSetting('ha_base_url'), getSetting('ha_token'), pathAndQuery, method || 'GET', body || null, opts || {});
  }
  // Last outcome of a real HA REST interaction — powers the `ha` field in the
  // fleet check-in (fetchUpdateInfo). null = this device has never talked to
  // HA (either not configured, or configured but nothing's polled yet).
  let _haHealth = null; // { ok: boolean, at: epochMs } | null
  function haRequestWith(baseUrl, token, pathAndQuery, method = 'GET', body = null, opts = {}) {
    const configured = !!(baseUrl && token);
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
    const p = (async () => {
      if (!baseUrl || !token) throw { status: 400, message: 'Home Assistant isn\'t configured yet — add a URL and token in Settings' };
      let target;
      try { target = new URL(baseUrl.replace(/\/+$/, '') + pathAndQuery); } catch { throw { status: 400, message: 'Invalid Home Assistant URL' }; }
      const bodyStr = body ? JSON.stringify(body) : null;
      const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
      if (bodyStr) headers['Content-Type'] = 'application/json';
      let res;
      try {
        res = await fetchWithTimeout(target, { method, headers, body: bodyStr, timeoutMs, timeoutMessage: 'Home Assistant request timed out' });
      } catch (e) { throw { status: 502, message: `Could not reach Home Assistant: ${e.message}` }; }
      if (res.status === 401 || res.status === 403) {
        throw { status: 401, message: 'Home Assistant rejected the token — check it\'s still valid' };
      }
      if (res.status === 404) throw { status: 404, message: opts.textBody ? 'Home Assistant has no template service' : 'Entity not found' };
      // opts.textBody (the template renderer): a 400 carries Home Assistant's own explanation of what is wrong with the template - pass it on.
      if (res.status === 400 && opts.textBody) { let why = (await res.text()).split(String.fromCharCode(10)).join(' ').trim();
        // the real Home Assistant answers {"message": "Error rendering template: ..."}; show just the message
        try { const j = JSON.parse(why); if (j && typeof j.message === 'string') why = j.message; } catch {}
        why = why.slice(0, 300); throw { status: 400, message: why || 'Home Assistant could not use that template' }; }
      if (res.status >= 400) throw { status: 502, message: `Home Assistant returned status ${res.status}` };
      const data = await res.text();
      if (opts.textBody) return data; // plain text, not JSON
      // A successful service call can return an empty body (204-shaped 200) or a
      // JSON array of the entities it affected — either is fine, only genuinely
      // malformed JSON (when a body was actually sent back) is an error.
      if (!data.trim()) return null;
      try { return JSON.parse(data); }
      catch { throw { status: 502, message: 'Could not parse Home Assistant\'s response' }; }
    })();
    // Only "HA is configured but we couldn't reach/authenticate it" is a health
    // signal — the not-configured reject above isn't. A token/permission error
    // (status 401) counts as unhealthy; so does any transport failure.
    if (!configured) return p;
    return p.then(
      (v) => { _haHealth = { ok: true, at: Date.now() }; return v; },
      (e) => { _haHealth = { ok: false, at: Date.now() }; throw e; }
    );
  }

  // GET /api/ha/discover — best-effort auto-detection of a Home Assistant
  // instance on the local network, for the Settings "Detect automatically"
  // button. Tries, in order: this machine itself (covers the common case of HA
  // running in Docker on the same box as this server), the well-known mDNS
  // hostname most home networks resolve automatically, this machine's own LAN
  // subnet (a fast, concurrency-limited port-8123 sweep), and — if the
  // `tailscale` CLI is present — every peer on this device's own tailnet,
  // since Tailscale IPs aren't guessable by subnet-scanning the way a LAN is.
  // Confirmed via HA's unauthenticated /manifest.json, which is a stable,
  // public fingerprint (name: "Home Assistant") — no token needed to detect
  // it, only to actually use it afterward.
  function probeHaCandidate(hostname, port) {
    return new Promise((resolve) => {
      const req = http.get({ hostname, port, path: '/manifest.json', timeout: 600 }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed && typeof parsed.name === 'string' && parsed.name.toLowerCase().includes('home assistant')) {
              resolve({ url: `http://${hostname}:${port}`, name: parsed.name });
            } else resolve(null);
          } catch { resolve(null); }
        });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
    });
  }
  // Runs a batch of candidate probes with a concurrency cap, since a full /24
  // sweep is 254 hosts — doing them all at once would be an unnecessary burst
  // of simultaneous connections for what's a one-tap, non-urgent action.
  async function probeInBatches(candidates, concurrency = 24) {
    const found = [];
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(c => probeHaCandidate(c.hostname, c.port)));
      results.forEach(r => { if (r) found.push(r); });
    }
    return found;
  }
  function localIPv4Subnets() {
    // Returns { selfIps, subnetPrefixes } — every non-internal IPv4 this
    // machine has, and the /24 prefix of each, deduplicated. Multiple
    // interfaces (e.g. Wi-Fi + Ethernet, or a Tailscale interface which also
    // shows up here but is deliberately excluded from subnet-scanning — see
    // the Tailscale peer lookup below instead, since its /10 CGNAT range is
    // far too large to brute-force).
    const selfIps = [];
    const prefixes = new Set();
    Object.values(os.networkInterfaces()).flat().forEach(iface => {
      if (!iface || iface.internal || iface.family !== 'IPv4') return;
      if (iface.address.startsWith('100.')) return; // Tailscale CGNAT range — handled separately
      selfIps.push(iface.address);
      prefixes.add(iface.address.split('.').slice(0, 3).join('.'));
    });
    return { selfIps, prefixes: [...prefixes] };
  }
  function tailscalePeerIps() {
    // Best-effort only — silently returns [] if the `tailscale` CLI isn't
    // installed or the daemon isn't running, both totally normal (most
    // installs won't have it), rather than treating either as an error.
    try {
      const out = execFileSync('tailscale', ['status', '--json'], { timeout: 3000 }).toString();
      const status = JSON.parse(out);
      return Object.values(status.Peer || {})
        .map(p => (p.TailscaleIPs || [])[0])
        .filter(ip => ip && ip.includes('.'));
    } catch { return []; }
  }
  // This machine's OWN Tailscale IP (not a peer's) — used by the "Add a
  // Display" flow so the generated URL/QR code works regardless of what
  // network the NEW device is actually on, as long as it's also joined to
  // the same tailnet. A LAN-only URL (this admin's own current
  // window.location.origin) would only work if the new device happens to be
  // on the same Wi-Fi — not a safe assumption for something like a Fire
  // Stick that might get moved between rooms/networks.
  function tailscaleSelfIp() {
    try {
      const out = execFileSync('tailscale', ['status', '--json'], { timeout: 3000 }).toString();
      const status = JSON.parse(out);
      const ips = (status.Self && status.Self.TailscaleIPs) || [];
      return ips.find(ip => ip.includes('.')) || null;
    } catch { return null; }
  }
  // GET /api/tailscale-status — powers the "Add a Display" section in the
  // Devices tab: whether Tailscale is actually installed/running on THIS
  // machine (not assumed), and its IP if so, so the UI can build a URL
  // that'll actually work from a device on a different network, and can
  // give an honest "not detected" message rather than a URL that silently
  // won't work when the new device isn't on the same Wi-Fi.
  app.get('/api/tailscale-status', (req, res) => {
    const ip = tailscaleSelfIp();
    res.json({ installed: !!ip, ip, port: PORT });
  });
  app.get('/api/ha/discover', async (req, res) => {
    try {
      const candidates = [
        { hostname: 'localhost', port: 8123 },
        { hostname: 'homeassistant.local', port: 8123 },
      ];
      const { prefixes } = localIPv4Subnets();
      prefixes.forEach(prefix => {
        for (let host = 1; host <= 254; host++) candidates.push({ hostname: `${prefix}.${host}`, port: 8123 });
      });
      tailscalePeerIps().forEach(ip => candidates.push({ hostname: ip, port: 8123 }));

      const found = await probeInBatches(candidates);
      found.forEach(f => { if (/^https?:\/\/100\./.test(f.url)) f.viaTailscale = true; });
      // Dedupe (the same instance can legitimately be found twice — e.g. via
      // both "localhost" and this machine's own LAN IP).
      const seen = new Set();
      const unique = found.filter(f => (seen.has(f.url) ? false : (seen.add(f.url), true)));
      res.json({ found: unique });
    } catch (e) {
      res.status(500).json({ found: [], error: e.message });
    }
  });

  // GET /api/ha/test — validates the configured URL+token, for a Settings "Test
  // Connection" button. Accepts optional ?url=&token= to test values the person
  // just typed but hasn't necessarily saved yet (same reasoning as the weather
  // ZIP lookup's ?save=0 — testing shouldn't depend on the debounced auto-save
  // having already fired by the time someone clicks the button). Falls back to
  // the saved settings when neither is provided. HA's /api/ endpoint just
  // confirms the API is up and the token is valid; it doesn't return anything
  // the UI needs beyond that.
  app.get('/api/ha/test', async (req, res) => {
    const urlOverride = req.query.url;
    const tokenOverride = req.query.token;
    try {
      if (urlOverride !== undefined || tokenOverride !== undefined) {
        await haRequestWith(urlOverride ?? getSetting('ha_base_url'), tokenOverride ?? getSetting('ha_token'), '/api/');
      } else {
        await haRequest('/api/');
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/ha/entities — the FULL entity list, trimmed to just what a picker
  // needs. Used interactively (opening the entity picker in Settings/widget
  // config), never polled, so no caching here — unlike /api/ha/state/:id below,
  // which display.html hits on a refresh timer and specifically needs caching to
  // avoid hammering someone's Home Assistant instance from multiple displays.
  app.get('/api/ha/entities', async (req, res) => {
    try {
      const all = await haRequest('/api/states');
      const trimmed = (Array.isArray(all) ? all : []).map(e => ({
        entity_id: e.entity_id,
        state: e.state,
        friendly_name: (e.attributes && e.attributes.friendly_name) || e.entity_id,
        unit: (e.attributes && e.attributes.unit_of_measurement) || '',
      })).sort((a, b) => a.friendly_name.localeCompare(b.friendly_name));
      res.json(trimmed);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });
  // _haHealth is reassigned inside haRequestWith(), so it cannot be handed out by value: hand out a getter. The reader is the update-check URL builder.
  return { haRequest, haRequestWith, getHaHealth: () => _haHealth };
};
