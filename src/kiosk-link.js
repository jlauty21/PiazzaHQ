'use strict';
// Keeps the `kiosk` command people type (/usr/local/bin/kiosk) pointing at this project's own scripts/kiosk. Older installs put a COPY there, owned by root,
// and no update can touch it - so a Pi installed months ago still runs a months-old `kiosk`: run over SSH it starts the browser with no screen to draw on
// (the browser exits at once while the old script still prints "Kiosk started"), which left a Pi on its desktop with no display (seen on two Test Pis,
// 2026-10-08). The installer already makes a symlink on a fresh install; this does it for the older ones.
// Raspberry Pi only, never the demo. Needs root: it uses `sudo -n` (the default Pi user has passwordless sudo) and otherwise just records "needs sudo" in the
// setting kiosk_link_status (scripts/kiosk-diagnose.sh also prints the one-line fix). The old file is kept as ~/.local/state/piazzahq/kiosk.old-<time>.
// Opt out with the setting kiosk_link_fix = 0 or the file ~/.piazzahq-keep-kiosk-copy. Covered by test/unit/kiosk-link.test.js.
module.exports = function registerKioskLink({ fs, path, os, execFile, projectDir, DEPLOYMENT, IS_DEMO, getSetting, setSetting }) {
  const LINK = '/usr/local/bin/kiosk';
  const target = path.join(projectDir, 'scripts', 'kiosk');
  const run = (cmd, args) => new Promise((resolve) => {
    try { execFile(cmd, args, { timeout: 10000 }, (err, stdout, stderr) => resolve({ ok: !err, err: String(stderr || '') || (err ? String(err.message || err) : '') })); }
    catch (e) { resolve({ ok: false, err: String(e.message || e) }); }
  });

  // 'missing' | 'linked' | 'stale'
  function linkState() {
    let st;
    try { st = fs.lstatSync(LINK); } catch { return 'missing'; }
    if (st.isSymbolicLink()) {
      try { return path.resolve(path.dirname(LINK), fs.readlinkSync(LINK)) === path.resolve(target) ? 'linked' : 'stale'; } catch { return 'stale'; }
    }
    return 'stale';
  }

  async function ensureKioskLink() {
    const out = { skipped: '', fixed: false, failed: '' };
    if (DEPLOYMENT !== 'pi' || IS_DEMO) { out.skipped = 'not a Raspberry Pi'; return out; }
    if (getSetting('kiosk_link_fix') === '0' || fs.existsSync(path.join(os.homedir(), '.piazzahq-keep-kiosk-copy'))) { out.skipped = 'turned off by you'; return out; }
    if (!fs.existsSync(target)) { out.skipped = 'scripts/kiosk not found'; return out; }
    const state = linkState();
    if (state === 'missing') { out.skipped = 'no kiosk command installed'; return out; }
    if (state === 'linked') { out.skipped = 'already linked'; return out; }
    // keep the old file, then point the command at the project's own copy
    try {
      const dir = path.join(os.homedir(), '.local', 'state', 'piazzahq');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(LINK, path.join(dir, 'kiosk.old-' + new Date().toISOString().replace(/[:.]/g, '-')));
    } catch { /* a missing backup must not stop the repair of a stale helper */ }
    try { fs.chmodSync(target, 0o755); } catch {}
    const r = await run('sudo', ['-n', 'ln', '-sfn', target, LINK]);
    if (r.ok && linkState() === 'linked') out.fixed = true; else out.failed = (r.err || 'could not replace it').trim().slice(0, 160);
    return out;
  }

  async function checkKioskLinkNow() {
    try {
      const r = await ensureKioskLink();
      const status = r.skipped || (r.fixed ? 'replaced the old copy with a link to this install' : 'could not replace the old copy (needs sudo)');
      if (getSetting('kiosk_link_status') !== status) {
        setSetting('kiosk_link_status', status);
        if (!r.skipped) console.log('[kiosk] ' + status + (r.failed ? ' - ' + r.failed : ''));
      }
      return r;
    } catch (e) { console.error('[kiosk] link check failed: ' + (e && e.message || e)); return null; }
  }
  if (DEPLOYMENT === 'pi' && !IS_DEMO) {
    setTimeout(checkKioskLinkNow, 45 * 1000).unref();
    setInterval(checkKioskLinkNow, 24 * 60 * 60 * 1000).unref();
  }
  return { ensureKioskLink, linkState, checkKioskLink: checkKioskLinkNow };
};
