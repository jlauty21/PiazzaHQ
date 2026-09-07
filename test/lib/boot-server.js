'use strict';
// Boots the REAL server.js as a child process against a throwaway DATA_DIR
// and an ephemeral port, waits for its "running at" line, and hands back the
// base URL + a stop() that kills it and deletes the temp dir.
//
// Child process (not require()) so server.js needs no change — it calls
// startServer() unconditionally at the bottom. Every boot is isolated: fresh
// DATA_DIR each time, so migrations run from scratch (or from a seed DB you
// pass in).
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SERVER = path.join(REPO, 'server.js');

function pickPort() { return 40000 + Math.floor(Math.random() * 20000); }

async function bootServer(opts = {}) {
  const { env = {}, seedDbPath = null, demo = false, waitMs = 25000, tries = 3 } = opts;

  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phq-test-'));
    if (seedDbPath) fs.copyFileSync(seedDbPath, path.join(dataDir, 'calendar.db'));
    const port = pickPort();

    const child = spawn(process.execPath, [SERVER], {
      cwd: REPO,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        PORT: String(port),
        ...(demo ? { DEMO_MODE: '1' } : {}),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    const grab = (b) => { out += b.toString(); };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);

    const ready = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: `no "running at" line in ${waitMs}ms` }), waitMs);
      child.stdout.on('data', () => {
        if (/Piazza HQ running at/.test(out)) { clearTimeout(timer); resolve({ ok: true }); }
      });
      child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: false, reason: `exited (code ${code}) before ready` }); });
    });

    if (!ready.ok) {
      lastErr = new Error(`bootServer: ${ready.reason}\n--- server output ---\n${out}\n---------------------`);
      try { child.kill('SIGKILL'); } catch {}
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
      // A port collision on Linux is an uncaught throw -> retry with a new one.
      if (/EADDRINUSE|before ready/.test(ready.reason)) continue;
      throw lastErr;
    }

    const base = `http://127.0.0.1:${port}`;
    const stop = () => new Promise((resolve) => {
      child.removeAllListeners('exit');
      child.on('exit', () => {
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
        resolve();
      });
      child.kill('SIGKILL');
    });

    return { base, dataDir, stop, output: () => out, pid: child.pid };
  }
  throw lastErr || new Error('bootServer: could not start after retries');
}

// Convenience: JSON fetch that throws on a non-2xx unless `allowStatus` says otherwise.
async function api(base, method, pathAndQuery, body, opts = {}) {
  const res = await fetch(base + pathAndQuery, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...(opts.headers || {}) } : (opts.headers || {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: opts.redirect || 'manual',
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

module.exports = { bootServer, api };
