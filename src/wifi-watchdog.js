'use strict';
// Brings a Raspberry Pi's Wi-Fi back by itself when it drops and does not come back (feedback #39, and the owner's own Pi on 2026-10-26).
// What was seen on a Pi 4: the Pi tried to move to another access point of a mesh, the access point refused it, and from then on the Wi-Fi driver refused every
// attempt to join ("Association request to the driver failed", 93 times) while the network list still showed the network at full strength. NetworkManager
// reported "the Wi-Fi network could not be found". The Pi was alive (the screen kept updating) but off the network for over an hour: no control app, no ping,
// no SSH, no weather. Turning Wi-Fi off and on again brought it back at once; only a reboot did otherwise.
// What it does, on a Raspberry Pi only (never Docker / Windows / the demo), every 30 seconds: if the Wi-Fi has not been connected for 90 seconds, it tries, one
// step at a time with a minute between steps, until the Wi-Fi is back:
//   1. turns Wi-Fi off and on,  2. restarts the Wi-Fi services (wpa_supplicant, NetworkManager),  3. reloads the Wi-Fi driver (only the Pi's own brcmfmac one).
// After the last step it waits 10 minutes and starts again, so a router that is simply switched off is not hammered.
// It does nothing when: a network cable is connected (the Pi is reachable that way), Wi-Fi has been switched off on purpose (the desktop's "Turn Off Wireless LAN"),
// no Wi-Fi network has ever been set up on this Pi, or there is no NetworkManager. The changes need root; it tries without, then with `sudo -n` (the default Pi user has
// passwordless sudo). What it did is recorded in the setting wifi_watchdog_status (this box only, never synced to a mirror) and in the log with "[wifi-watchdog]".
// Opt out with the setting wifi_watchdog_off = 1, the environment variable PIAZZA_WIFI_WATCHDOG=off, or the file ~/.piazzahq-no-wifi-watchdog.
// Covered by test/unit/wifi-watchdog.test.js.
module.exports = function registerWifiWatchdog({ fs, path, os, execFile, DEPLOYMENT, IS_DEMO, getSetting, setSetting, hooks }) {
  // optional hooks (the tests pass their own clock, sleep and log and no timers; the server passes none)
  const h = hooks || {};
  const now = h.now || (() => Date.now());
  const sleep = h.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const say = h.say || ((m) => console.log(m));
  const startTimers = h.timers !== false;
  const GRACE_MS = 90 * 1000;           // down this long before anything is done (a hop between access points takes seconds)
  const STEP_WAIT_MS = 60 * 1000;       // after a step, give the Wi-Fi this long to come back before the next one
  const COOLDOWN_MS = 10 * 60 * 1000;   // after the last step, wait this long before starting over
  const run = (cmd, args, timeout = 20000) => new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') || (err ? String(err.message || err) : '') }));
    } catch (e) { resolve({ ok: false, out: '', err: String(e.message || e) }); }
  });
  async function asRoot(cmd, args) {
    const first = await run(cmd, args);
    if (first.ok) return first;
    return run('sudo', ['-n', cmd, ...args]);
  }

  // `nmcli -t -f DEVICE,TYPE,STATE device` -> [{device, type, state}] (terse mode escapes ':' inside a field as '\:').
  function parseDevices(out) {
    const rows = [];
    for (const line of String(out || '').split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split(/(?<!\\):/).map((p) => p.replace(/\\:/g, ':'));
      if (parts.length >= 3) rows.push({ device: parts[0], type: parts[1], state: parts.slice(2).join(':').trim() });
    }
    return rows;
  }
  const isConnected = (state) => /^connected/i.test(String(state || ''));
  const hasWifiProfile = (nmcliOut) => /(^|\n)802-11-wireless\s*(\n|$)/.test(String(nmcliOut || ''));
  const radioEnabled = (out) => /^\s*enabled\s*$/i.test(String(out || ''));

  // The three steps. Each returns a short description of what it did, or '' when it does not apply to this Pi.
  const steps = [
    { name: 'turned Wi-Fi off and on', go: async () => {
      const off = await asRoot('nmcli', ['radio', 'wifi', 'off']);
      if (!off.ok) return null;
      await sleep(3000);
      const on = await asRoot('nmcli', ['radio', 'wifi', 'on']);
      if (!on.ok) return null;
      // NetworkManager does not join again by itself after a manual disconnect, or once it has given up after failed attempts; asking it to connect clears that
      await sleep(4000);
      await asRoot('nmcli', ['device', 'connect', wifiDevice || 'wlan0']);
      return true;
    } },
    { name: 'restarted the Wi-Fi services', go: async () => {
      const a = await asRoot('systemctl', ['restart', 'wpa_supplicant']);
      const b = await asRoot('systemctl', ['restart', 'NetworkManager']);
      return (a.ok || b.ok) ? true : null;
    } },
    { name: 'reloaded the Wi-Fi driver', go: async () => {
      let mods = '';
      try { mods = fs.readFileSync('/proc/modules', 'utf8'); } catch {}
      if (!/^brcmfmac\b/m.test(mods)) return '';                                        // not the Pi's own Wi-Fi chip: leave the driver alone
      await asRoot('modprobe', ['-r', 'brcmfmac_wcc']);                                   // newer kernels split the driver in two; not present on older ones
      const rm = await asRoot('modprobe', ['-r', 'brcmfmac']);
      await sleep(3000);
      const add = await asRoot('modprobe', ['brcmfmac']);
      return (rm.ok || add.ok) ? true : null;
    } },
  ];

  let downSince = 0;       // when the Wi-Fi was first seen not connected (0 = it is fine)
  let nextStep = 0;        // which step is next
  let nextAllowedAt = 0;   // no step before this time
  let lastDone = '';       // what was done most recently, for the recovery message
  let busy = false;
  // A log that survives a reboot (the system log on many Pis is kept only for the current boot): one line per event in ~/.local/state/piazzahq/wifi-watchdog.log, the same
  // folder as the kiosk launch history, trimmed to the last 300 lines once it passes 100 KB. scripts/kiosk-diagnose.sh prints the end of it.
  const LOG_FILE = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'piazzahq', 'wifi-watchdog.log');
  function note(msg) {
    say('[wifi-watchdog] ' + msg);
    try {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
      fs.appendFileSync(LOG_FILE, new Date(now()).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') + ' ' + msg + '\n');
      if (fs.statSync(LOG_FILE).size > 100 * 1024) fs.writeFileSync(LOG_FILE, fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-300).join('\n') + '\n');
    } catch {}
  }
  let wifiDevice = '';     // the Wi-Fi interface as NetworkManager names it (wlan0 on a Pi)
  let loggedNoRoot = false;

  const status = (s) => { if (getSetting('wifi_watchdog_status') !== s) setSetting('wifi_watchdog_status', s); };
  const watchStamp = () => new Date(now()).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const watchReset = () => { downSince = 0; nextStep = 0; nextAllowedAt = 0; };
  const optedOut = () => getSetting('wifi_watchdog_off') === '1' || fs.existsSync(path.join(os.homedir(), '.piazzahq-no-wifi-watchdog')) || String(process.env.PIAZZA_WIFI_WATCHDOG || '').toLowerCase() === 'off';

  // One look. Returns what it decided, for the tests and the log.
  async function watchTick() {
    if (DEPLOYMENT !== 'pi' || IS_DEMO) return { skipped: 'not a Raspberry Pi' };
    if (busy) return { skipped: 'busy' };
    busy = true;
    try {
      if (optedOut()) { watchReset(); return { skipped: 'turned off by you' }; }
      const dev = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device']);
      if (!dev.ok) { watchReset(); return { skipped: 'no NetworkManager' }; }
      const rows = parseDevices(dev.out);
      const wifi = rows.find((r) => r.type === 'wifi');
      if (!wifi) { watchReset(); return { skipped: 'no Wi-Fi' }; }
      wifiDevice = wifi.device;
      if (/^unmanaged/i.test(wifi.state)) { watchReset(); return { skipped: 'Wi-Fi is not managed by NetworkManager' }; }
      if (isConnected(wifi.state)) {
        if (downSince) {
          const secs = Math.round((now() - downSince) / 1000);
          const msg = lastDone ? `Wi-Fi was down ${secs}s; it is back after: ${lastDone}` : `Wi-Fi was down ${secs}s and came back by itself`;
          note(msg);
          status(watchStamp() + ': ' + msg);
        }
        watchReset(); lastDone = '';
        return { ok: true };
      }
      if (rows.some((r) => r.type === 'ethernet' && isConnected(r.state))) { watchReset(); return { skipped: 'a network cable is connected' }; }
      const radio = await run('nmcli', ['radio', 'wifi']);
      if (radio.ok && !radioEnabled(radio.out)) { watchReset(); return { skipped: 'Wi-Fi is switched off' }; }
      const prof = await run('nmcli', ['-t', '-f', 'TYPE', 'connection', 'show']);
      if (prof.ok && !hasWifiProfile(prof.out)) { watchReset(); return { skipped: 'no Wi-Fi network set up' }; }

      const t = now();
      if (!downSince) { downSince = t; note(`Wi-Fi is ${wifi.state}: waiting ${GRACE_MS / 1000}s before doing anything`); return { down: true, waiting: true }; }
      if (t - downSince < GRACE_MS) return { down: true, waiting: true };
      if (t < nextAllowedAt) return { down: true, waiting: true };

      // act: the next step that applies to this Pi
      let did = '';
      while (nextStep < steps.length) {
        const s = steps[nextStep];
        nextStep++;
        note(`Wi-Fi has been ${wifi.state} for ${Math.round((t - downSince) / 1000)}s: trying "${s.name}"`);
        const r = await s.go();
        if (r === '') continue;                                                       // does not apply here: next one at once
        if (r === null) {
          if (!loggedNoRoot) { loggedNoRoot = true; note(`"${s.name}" failed (needs sudo?)`); }
          status(`${watchStamp()}: could not run "${s.name}" (needs sudo)`);
        } else { did = s.name; lastDone = s.name; status(`${watchStamp()}: Wi-Fi down ${Math.round((t - downSince) / 1000)}s: ${s.name}`); }
        break;
      }
      nextAllowedAt = now() + (nextStep >= steps.length ? COOLDOWN_MS : STEP_WAIT_MS);
      if (nextStep >= steps.length) nextStep = 0;                                        // start over after the cool-down
      return { down: true, acted: did };
    } catch (e) { note('check failed: ' + (e && e.message || e)); return { error: String(e && e.message || e) }; }
    finally { busy = false; }
  }

  if (startTimers && DEPLOYMENT === 'pi' && !IS_DEMO) {
    setTimeout(() => { watchTick(); setInterval(watchTick, 30 * 1000).unref(); }, 60 * 1000).unref();
  }
  return { check: watchTick, parseDevices, isConnected, hasWifiProfile, radioEnabled, _state: () => ({ downSince, nextStep, nextAllowedAt }) };
};
