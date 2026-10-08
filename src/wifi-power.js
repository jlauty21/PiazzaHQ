'use strict';
// Keeps the Pi's Wi-Fi power saving OFF. A wall display is on around the clock, and with power saving on, a Pi's Wi-Fi radio can doze: the Pi still looks
// connected to the router and works fine outward (the screen keeps updating), but nothing from other devices gets through - no control app, no ping, no SSH -
// until a reboot (feedback #39). Switching it off costs a little power and fixes that.
// What it does, on a Raspberry Pi only (never Docker / Windows / the demo): shortly after the server starts, and every hour after (a reconnect can bring the
// driver's default back), it
//   1. sets NetworkManager's Wi-Fi profile that is in use to "powersave = disable" (survives reboots), and
//   2. turns power saving off on the live Wi-Fi interface right now (works without NetworkManager too, since this runs on every start).
// Both need root for the change itself; it tries without, then with `sudo -n` (the default Pi user has passwordless sudo), and if neither works it just
// records that in the setting wifi_powersave_status and carries on. Opt out with the setting wifi_powersave_off = 0 or the environment variable
// PIAZZA_WIFI_POWERSAVE=keep or by creating the file ~/.piazzahq-keep-wifi-powersave. Where NetworkManager refuses the app's own change (the background
// service is not in a desktop session) and sudo needs a password, scripts/wifi-powersave-off.sh makes the profile change from the desktop session at boot. Covered by test/unit/wifi-power.test.js.
module.exports = function registerWifiPower({ fs, path, os, execFile, DEPLOYMENT, IS_DEMO, getSetting, setSetting }) {
  const run = (cmd, args, timeout = 8000) => new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') || (err ? String(err.message || err) : '') }));
    } catch (e) { resolve({ ok: false, out: '', err: String(e.message || e) }); }
  });
  // The change itself needs root: try as the current user, then through passwordless sudo.
  async function asRoot(cmd, args) {
    const first = await run(cmd, args);
    if (first.ok) return first;
    return run('sudo', ['-n', cmd, ...args]);
  }

  // `iw dev` -> the Wi-Fi interface names ("Interface wlan0").
  const wifiInterfaces = (iwDevOut) => [...String(iwDevOut || '').matchAll(/^\s*Interface\s+(\S+)/gm)].map((m) => m[1]);
  // `nmcli -t -f NAME,TYPE connection show --active` -> names of active Wi-Fi profiles (terse mode escapes ':' in names as '\:').
  function activeWifiProfiles(nmcliOut) {
    const out = [];
    for (const line of String(nmcliOut || '').split('\n')) {
      const i = line.lastIndexOf(':');
      if (i < 0) continue;
      const type = line.slice(i + 1).trim(), name = line.slice(0, i).replace(/\\:/g, ':');
      if (type === '802-11-wireless' && name) out.push(name);
    }
    return out;
  }
  // `nmcli -g 802-11-wireless.powersave connection show X` -> true when it is already "disable" (2).
  const profileHasPowerSaveOff = (v) => /^\s*(2\b|disable)/i.test(String(v || ''));
  const powerSaveIsOff = (iwOut) => /Power save:\s*off/i.test(String(iwOut || ''));

  async function ensureWifiPowerSaveOff() {
    const result = { skipped: '', changed: [], failed: [] };
    if (DEPLOYMENT !== 'pi' || IS_DEMO) { result.skipped = 'not a Raspberry Pi'; return result; }
    if (getSetting('wifi_powersave_off') === '0' || fs.existsSync(path.join(os.homedir(), '.piazzahq-keep-wifi-powersave')) || String(process.env.PIAZZA_WIFI_POWERSAVE || '').toLowerCase() === 'keep') { result.skipped = 'turned off by you'; return result; }
    const iw = await run('iw', ['dev']);
    const ifaces = iw.ok ? wifiInterfaces(iw.out) : [];
    if (!ifaces.length) { result.skipped = iw.ok ? 'no Wi-Fi' : 'iw not available'; return result; }

    // 1. the NetworkManager profile in use (persists across reboots)
    const nm = await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show', '--active']);
    if (nm.ok) {
      for (const name of activeWifiProfiles(nm.out)) {
        const cur = await run('nmcli', ['-g', '802-11-wireless.powersave', 'connection', 'show', name]);
        if (cur.ok && profileHasPowerSaveOff(cur.out)) continue;
        const set = await asRoot('nmcli', ['connection', 'modify', name, '802-11-wireless.powersave', '2']);
        (set.ok ? result.changed : result.failed).push('profile ' + name);
      }
    }
    // 2. the live interface (right now, and covers a Pi without NetworkManager)
    for (const ifc of ifaces) {
      const cur = await run('iw', ['dev', ifc, 'get', 'power_save']);
      if (cur.ok && powerSaveIsOff(cur.out)) continue;
      const set = await asRoot('iw', ['dev', ifc, 'set', 'power_save', 'off']);
      (set.ok ? result.changed : result.failed).push('interface ' + ifc);
    }
    return result;
  }

  async function checkWifiPowerSave() {
    try {
      const r = await ensureWifiPowerSaveOff();
      const status = r.skipped ? r.skipped : r.failed.length ? 'could not change (needs sudo): ' + r.failed.join(', ') : r.changed.length ? 'switched off: ' + r.changed.join(', ') : 'already off';
      if (getSetting('wifi_powersave_status') !== status) {
        setSetting('wifi_powersave_status', status);
        if (!r.skipped) console.log('[wifi] power saving: ' + status);
      }
      return r;
    } catch (e) { console.error('[wifi] power-save check failed: ' + (e && e.message || e)); return null; }
  }
  if (DEPLOYMENT === 'pi' && !IS_DEMO) {
    setTimeout(checkWifiPowerSave, 20 * 1000).unref();
    setInterval(checkWifiPowerSave, 60 * 60 * 1000).unref();
  }
  return { ensureWifiPowerSaveOff, wifiInterfaces, activeWifiProfiles, profileHasPowerSaveOff, powerSaveIsOff };
};
