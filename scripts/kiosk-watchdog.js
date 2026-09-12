#!/usr/bin/env node
// kiosk-watchdog.js — see ~/.claude/plans/patient-lantern-watch.md.
//
// Run periodically (piazzahq-kiosk-watchdog.timer, ~3 min) as the kiosk
// user. Detects a genuinely FROZEN kiosk tab — not just a crashed process,
// which a plain `pgrep` check would already catch — via the Chrome
// DevTools Protocol, and recovers it through the existing `kiosk restart`
// command. Reports what happened back through the app's own notification
// pipeline (the same one Home Assistant alerts and severe weather alerts
// already use) so a recovery isn't silent.
//
// Why not just "is Chromium still running": the 2026-09-12 incident this
// exists for wasn't a crash — the renderer froze while the process stayed
// alive. The CDP HTTP endpoint (`/json`) is served by the BROWSER process,
// which can keep answering even while a specific TAB's renderer is fully
// hung, so finding a target there is necessary but not sufficient. The
// actual liveness proof is a Runtime.evaluate round-trip dispatched into
// that renderer over its own WebSocket.

'use strict';
const http = require('http');
const WebSocket = require('ws');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_URL = process.env.PI_CALENDAR_URL || 'http://localhost:3000';
const DEBUG_PORT = process.env.PIAZZA_KIOSK_DEBUG_PORT || '9222';
const KIOSK_BIN = process.env.PIAZZA_KIOSK_BIN || '/usr/local/bin/kiosk';
const CONFIG_DIR = path.join(os.homedir(), '.config');
const OFF_SENTINEL = path.join(CONFIG_DIR, 'piazzahq-kiosk-off');
const STATE_FILE = path.join(CONFIG_DIR, 'piazzahq-kiosk-watchdog-state.json');
const MAX_RESTARTS = 3;
const WINDOW_MS = 30 * 60 * 1000;
const HTTP_TIMEOUT_MS = 4000;
const CDP_TIMEOUT_MS = 5000;

function httpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function isKioskRunning() {
  return new Promise((resolve) => {
    // `--` ends pgrep's own option parsing so a pattern starting with "-"
    // (the kiosk flag itself) isn't mistaken for more flags.
    execFile('pgrep', ['-f', '--', '--kiosk'], (err) => resolve(!err));
  });
}

async function isKioskResponsive() {
  let targets;
  try {
    const r = await httpGet(`http://127.0.0.1:${DEBUG_PORT}/json`, HTTP_TIMEOUT_MS);
    targets = JSON.parse(r.body);
  } catch {
    return false; // devtools endpoint itself unreachable — treat as hung
  }
  const target = Array.isArray(targets)
    ? targets.find((t) => t.type === 'page' && String(t.url || '').includes('localhost:3000'))
    : null;
  if (!target || !target.webSocketDebuggerUrl) return false;

  return new Promise((resolve) => {
    let done = false;
    let ws;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { ws && ws.close(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), CDP_TIMEOUT_MS);
    try {
      ws = new WebSocket(target.webSocketDebuggerUrl);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '1+1', returnByValue: true } }));
    });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.id === 1 && msg.result && msg.result.result && msg.result.result.value === 2) {
        clearTimeout(timer);
        finish(true);
      }
    });
    ws.on('error', () => { clearTimeout(timer); finish(false); });
  });
}

// Pure — no fs/timers/network — so it's directly unit-testable via the
// extractFunction/evalInSandbox pattern the rest of this codebase's tests
// use. Drops timestamps older than windowMs (a genuinely fixed problem from
// hours ago shouldn't count against a fresh incident today), then compares
// the surviving count against the cap. Returns the PRUNED list either way,
// since the caller persists it regardless of whether this attempt restarts.
function decideRestart(restarts, now, maxRestarts, windowMs) {
  const pruned = (restarts || []).filter((t) => now - t < windowMs);
  return { allowed: pruned.length < maxRestarts, pruned };
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { restarts: [] }; }
}
function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch {}
}

function runKioskRestart() {
  return new Promise((resolve) => {
    execFile(KIOSK_BIN, ['restart'], { timeout: 15000 }, (err) => resolve(!err));
  });
}

// Best-effort — a failed report must never affect recovery itself, and
// never blocks the watchdog exiting.
function reportToApp(body) {
  try {
    const data = JSON.stringify(body);
    const req = http.request(`${APP_URL}/api/kiosk-watchdog/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: HTTP_TIMEOUT_MS,
    });
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(data);
  } catch {}
}

async function main() {
  if (fs.existsSync(OFF_SENTINEL)) return; // deliberate maintenance mode — never fight it

  let serverUp = false;
  try {
    const r = await httpGet(APP_URL, HTTP_TIMEOUT_MS);
    serverUp = r.status < 500;
  } catch {
    serverUp = false;
  }
  // A server problem, not a kiosk problem — piazzahq.service (Restart=always)
  // handles its own recovery; restarting the browser here would just point a
  // perfectly fine kiosk at a server that isn't answering yet.
  if (!serverUp) return;

  const running = await isKioskRunning();
  let reason = null;
  if (!running) reason = 'crashed';
  else if (!(await isKioskResponsive())) reason = 'hung';
  if (!reason) return; // healthy

  const state = readState();
  const now = Date.now();
  const { allowed, pruned } = decideRestart(state.restarts, now, MAX_RESTARTS, WINDOW_MS);
  state.restarts = pruned;

  if (!allowed) {
    // Kept failing — a blind retry loop at this point is more likely to be
    // burning CPU/SD-card writes on a genuinely broken page than fixing
    // anything. Surface it instead of hiding it behind another silent try.
    writeState(state);
    reportToApp({ restarted: false, reason, giveUp: true });
    return;
  }

  const restarted = await runKioskRestart();
  if (restarted) state.restarts.push(now);
  writeState(state);
  reportToApp({ restarted, reason, giveUp: false });
}

main().catch(() => {}); // a watchdog that crashes is its own bad joke
