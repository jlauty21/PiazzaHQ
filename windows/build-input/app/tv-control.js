// tv-control.js — TV power/input control drivers for the Devices tab.
// Each driver exposes: powerOn(screen), powerOff(screen), setInput(screen, input)
// -> Promise. `screen` is the screens table row (device_id, tv_ip,
// tv_samsung_token, etc.) so drivers can read whatever per-screen config they need.
//
// These run LOCALLY on whichever Pi is physically connected to the target TV —
// CEC needs the actual HDMI cable; Roku/Samsung need to be on the same LAN as the
// TV. server.js routes a command to the right Pi's own server before calling into
// this module, the same way push-to-slaves already reaches a specific slave
// directly by its own address, rather than trying to control a TV remotely from
// a completely different network.

const { execFile } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
let WebSocket;
try { WebSocket = require('ws'); } catch { WebSocket = null; } // only needed for Samsung

// ── CEC (no extra hardware — goes out over the same HDMI cable already in use) ──
// cec-client's higher-level "on"/"standby"/"as" commands are thin, readable
// wrappers around the underlying CEC bus messages.
function cecSend(cmd) {
  return new Promise((resolve, reject) => {
    let out = '';
    const child = execFile('cec-client', ['-s', '-d', '1'], { timeout: 8000 }, (err) => {
      if (err) return reject(new Error('cec-client failed or is not installed (sudo apt install cec-utils): ' + err.message));
      resolve(out);
    });
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.write(cmd + '\n');
    child.stdin.end();
  });
}
const cecDriver = {
  powerOn:  () => cecSend('on 0'),       // device 0 = TV, in CEC addressing
  powerOff: () => cecSend('standby 0'),
  // Switching to an ARBITRARY other input isn't reliably supported across TVs
  // over CEC — but switching the TV TO the Pi's own input ("become active
  // source") is well-supported, and is really the only input-switch this app
  // ever needs: making sure the TV is actually showing the calendar.
  setInput: () => cecSend('as'),
};

// ── HDMI signal cut (no extra hardware — for monitors/displays with no CEC
// support at all, which describes most computer monitors) ───────────────────
// Doesn't ask the display to power off — most monitors don't understand any
// such request over HDMI without CEC. Instead this just stops the Pi from
// sending a signal at all, relying on the display's own built-in "no signal,
// go to sleep" behavior (DPMS), which is near-universal even on displays with
// zero smart features.
//
// xrandr (disabling the actual HDMI output at the X server level) is tried
// first — confirmed to work on the current KMS/DRM driver stack. vcgencmd
// display_power was the original approach, but testing showed it's a silent
// no-op on that same stack: it returns success without actually doing
// anything to the output, a known limitation of that legacy-era command on
// current Raspberry Pi OS. Kept only as a last-resort fallback in case xrandr
// genuinely isn't usable (no X server running at all).
//
// This runs from a background systemd service, not an interactive login
// session, so DISPLAY and XAUTHORITY can't be assumed to already be set
// correctly the way they are in an SSH shell under the same user account —
// both are set explicitly here rather than relying on inherited environment.
function xEnv() {
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ':0',
    XAUTHORITY: process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority'),
  };
}
function findXrandrOutput() {
  return new Promise((resolve, reject) => {
    execFile('xrandr', ['--query'], { timeout: 5000, env: xEnv() }, (err, stdout) => {
      if (err) return reject(err);
      const line = (stdout || '').split('\n').find(l => / connected /.test(l));
      if (!line) return reject(new Error('No connected output found in xrandr output.'));
      resolve(line.split(' ')[0]);
    });
  });
}
async function xrandrSetPower(on) {
  const output = await findXrandrOutput();
  return new Promise((resolve, reject) => {
    execFile('xrandr', ['--output', output, on ? '--auto' : '--off'], { timeout: 5000, env: xEnv() }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}
function vcgencmdDisplayPower(on) {
  return new Promise((resolve, reject) => {
    execFile('vcgencmd', ['display_power', on ? '1' : '0'], { timeout: 5000 }, (err, stdout) => {
      if (err) return reject(new Error('vcgencmd failed: ' + err.message));
      resolve(stdout);
    });
  });
}
async function setHdmiSignal(on) {
  try {
    return await xrandrSetPower(on);
  } catch (xrandrErr) {
    try {
      return await vcgencmdDisplayPower(on);
    } catch (vcgencmdErr) {
      throw new Error(`Could not control the display output. xrandr: ${xrandrErr.message} — vcgencmd: ${vcgencmdErr.message}`);
    }
  }
}
const hdmiSignalDriver = {
  powerOn:  () => setHdmiSignal(true),
  powerOff: () => setHdmiSignal(false),
  setInput: () => { throw new Error('Input switching has no meaning here — this driver only turns the Pi\'s own HDMI output on or off, not the display itself.'); },
};

// ── Roku (TVs and players — no pairing/auth needed at all) ──────────────────
function rokuKeypress(ip, key) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error('No Roku IP address configured for this screen.'));
    const req = http.request(
      { host: ip, port: 8060, path: `/keypress/${encodeURIComponent(key)}`, method: 'POST', timeout: 5000 },
      (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`Roku returned HTTP ${res.statusCode}`));
      }
    );
    req.on('error', (e) => reject(new Error('Could not reach the Roku: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Roku request timed out.')); });
    req.end();
  });
}
const rokuDriver = {
  powerOn:  (screen) => rokuKeypress(screen.tv_ip, 'PowerOn'),
  powerOff: (screen) => rokuKeypress(screen.tv_ip, 'PowerOff'),
  // input like "HDMI1" / "HDMI2" / "HDMI3" / "HDMI4" / "Tuner" / "AV1"
  setInput: (screen, input) => rokuKeypress(screen.tv_ip, `Input_${input}`),
};

// ── Samsung (Tizen, 2016+ models) — needs one-time pairing ───────────────────
// First connection prompts an Allow/Deny popup on the TV itself; once allowed,
// the TV hands back a token that's reused for every future command so pairing
// only ever happens once. Self-signed cert on the TV's local API, hence
// rejectUnauthorized:false — a LAN-only connection to a device the user already
// physically owns and is pairing on purpose, not a public endpoint.
function samsungSend(screen, keys, { pairingOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!WebSocket) return reject(new Error('The "ws" package is not installed on this device yet — apply the latest update, which now installs it automatically, then try again.'));
    if (!screen.tv_ip) return reject(new Error('No Samsung TV IP address configured for this screen.'));
    const appName = Buffer.from('Piazza HQ').toString('base64');
    const tokenParam = screen.tv_samsung_token ? `&token=${encodeURIComponent(screen.tv_samsung_token)}` : '';
    const url = `wss://${screen.tv_ip}:8002/api/v2/channels/samsung.remote.control?name=${appName}${tokenParam}`;
    const ws = new WebSocket(url, { rejectUnauthorized: false });
    let settled = false;
    let newToken = null;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      fn(arg);
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error(screen.tv_samsung_token
        ? 'Samsung TV did not respond in time.'
        : 'No response — check the TV screen for an Allow/Deny prompt and accept it, then try again.'));
    }, 25000);

    ws.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event === 'ms.channel.connect') {
        if (msg.data && msg.data.token) newToken = msg.data.token;
        if (pairingOnly) {
          return finish(resolve, { token: newToken || screen.tv_samsung_token || null });
        }
        // Connected and authorized — send each key in sequence.
        for (const key of keys) {
          try { ws.send(JSON.stringify({
            method: 'ms.remote.control',
            params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' },
          })); } catch {}
          await new Promise(r => setTimeout(r, 400)); // small gap between keys
        }
        finish(resolve, { token: newToken || screen.tv_samsung_token || null });
      } else if (msg.event === 'ms.channel.unauthorized') {
        finish(reject, new Error('Pairing was denied on the TV.'));
      }
    });
    ws.on('error', (e) => finish(reject, new Error('Could not reach the Samsung TV: ' + e.message)));
  });
}
const samsungDriver = {
  // Note: Samsung's remote API exposes ONE power button (a toggle), not
  // separate on/off signals for most models — pressing it while already on
  // turns it off and vice versa, same as the real remote. There's no reliable
  // way to query current power state first, so "Power On" and "Power Off" in
  // the app both just press the same button; worth confirming this behaves the
  // way you'd expect on your specific Frame TV during testing.
  // Also Frame-TV-specific: whether pressing power lands on a true off state or
  // Art Mode depends on a setting ON the TV itself, not something this can
  // control — if it lands on Art Mode when you expected fully off, that's the
  // TV's own configuration, not a bug here.
  powerOn:  (screen) => samsungSend(screen, ['KEY_POWER']),
  powerOff: (screen) => samsungSend(screen, ['KEY_POWER']),
  // Direct HDMI-number keys are more precise than the generic KEY_SOURCE
  // (which just cycles through inputs one at a time without knowing which).
  setInput: (screen, input) => {
    const num = String(input || '').replace(/\D/g, '');
    return samsungSend(screen, [num ? `KEY_HDMI${num}` : 'KEY_SOURCE']);
  },
  pair: (screen) => samsungSend(screen, [], { pairingOnly: true }),
};

const DRIVERS = { cec: cecDriver, 'hdmi-signal': hdmiSignalDriver, roku: rokuDriver, samsung: samsungDriver };
module.exports = { DRIVERS };
