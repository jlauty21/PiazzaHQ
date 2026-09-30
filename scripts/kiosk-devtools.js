#!/usr/bin/env node
'use strict';
// Talks to the kiosk browser through its local debug port (Chrome DevTools Protocol, 127.0.0.1 only).
// Used by wait-for-server-and-launch-kiosk.sh to repair a display tab that never loaded, and handy by hand:
//
//   node scripts/kiosk-devtools.js status              what the display tab is showing (url | readyState | title)
//   node scripts/kiosk-devtools.js navigate [url]      load the display page in that tab (default http://localhost:3000/?nopreview)
//   node scripts/kiosk-devtools.js reload              reload the tab
//
// Why it exists: on a busy boot, a Chromium helper process can take too long to start; the browser restarts its
// network helper, the first page load (already in flight) is lost, and the tab is left on an empty about:blank for
// good - a white screen. Keyboard tools (xdotool F5) cannot help on a native-Wayland browser window; this works on
// both desktop types and needs no window at all.
//
// Exit codes: 0 ok, 2 browser's debug port not reachable, 3 no page tab, 4 the tab did not answer in time.
// `status` prints exactly one line; the first word of the line is "blank" when the tab holds no real page.
const path = require('path');
let WebSocket;
try { WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws')); } catch { try { WebSocket = require('ws'); } catch { /* handled below */ } }

const PORT = process.env.PI_CALENDAR_DEBUG_PORT || '9222';
const DEFAULT_URL = process.env.PI_CALENDAR_DISPLAY_URL || 'http://localhost:3000/?nopreview';
const cmd = process.argv[2] || 'status';
const arg = process.argv[3];

function bail(code, msg) { console.log(msg); process.exit(code); }

(async () => {
  if (!WebSocket) bail(2, 'unreachable: the ws module is not available');
  let list;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(4000) });
    list = await r.json();
  } catch (e) { bail(2, 'unreachable: ' + (e.message || e)); }
  const page = (list || []).find((t) => t.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) bail(3, 'no page tab');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  try { await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(() => rej(new Error('connect timeout')), 4000); }); }
  catch (e) { bail(2, 'unreachable: ' + e.message); }

  let id = 0; const pending = new Map();
  ws.on('message', (m) => { try { const j = JSON.parse(m); if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } } catch { /* ignore */ } });
  const send = (method, params = {}, ms = 6000) => new Promise((resolve) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); resolve({ timeout: true }); }, ms);
    pending.set(i, (j) => { clearTimeout(t); resolve(j); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  if (cmd === 'status') {
    const r = await send('Runtime.evaluate', { expression: 'document.readyState + "|" + location.href + "|" + document.title', returnByValue: true });
    if (r.timeout) bail(4, 'unresponsive: the tab did not answer');
    const v = (r.result && r.result.result && r.result.result.value) || '';
    const [ready, href, ...t] = String(v).split('|');
    const blank = !href || href === 'about:blank' || href.startsWith('chrome-error:') || href === '';
    console.log(`${blank ? 'blank' : 'page'} ${ready} ${href || '(none)'} [${t.join('|')}]`);
    process.exit(0);
  }
  if (cmd === 'navigate') {
    const r = await send('Page.navigate', { url: arg || DEFAULT_URL });
    if (r.timeout) bail(4, 'unresponsive: the tab did not answer');
    if (r.error) bail(4, 'error: ' + JSON.stringify(r.error));
    console.log('navigated');
    setTimeout(() => process.exit(0), 200);
    return;
  }
  if (cmd === 'reload') {
    const r = await send('Page.reload', {});
    if (r.timeout) bail(4, 'unresponsive: the tab did not answer');
    console.log('reloaded');
    setTimeout(() => process.exit(0), 200);
    return;
  }
  bail(1, 'usage: kiosk-devtools.js status | navigate [url] | reload');
})().catch((e) => bail(2, 'error: ' + (e && e.message || e)));
