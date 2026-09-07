'use strict';
// The HA alert banner, rendered by real display.html CSS + JS in a real
// browser. Mounts just the banner slice (its CSS block + BANNER_STYLES +
// applyAlertBannerConfig + pollHaAlerts) into a bare page so we test the
// rendering without fighting display.html's full boot. Covers what the unit
// tests can't: actual layout / computed styles for each position + size +
// style, and the dismiss click path.
const { test, expect, cssBetween, readPublic } = require('./lib');
const { extractFunction, extractConst } = require('../lib/extract');

const HTML = readPublic('display.html');
const CSS = cssBetween(HTML, '/* ── Home Assistant alert banner ──', '/* ── Demo-mode corner pill');
const JS = [
  extractConst(HTML, 'BANNER_STYLES'),
  extractFunction(HTML, 'function applyAlertBannerConfig('),
  extractFunction(HTML, 'function pollHaAlerts('),
].join('\n\n');

const ALERT = { key: 'ha-alert:test', kind: 'ha-alert', title: 'Home Assistant', body: 'Garage open for 15 minutes' };

async function mountBanner(page, site, { notifications = [ALERT], cfg = {} } = {}) {
  const dismissed = [];
  await page.route('**/api/notifications/active', (r) => r.fulfill({ json: { notifications } }));
  await page.route('**/api/notifications/dismiss', async (r) => {
    let key = null;
    try { key = r.request().postDataJSON().key; } catch {}
    dismissed.push(key);
    await r.fulfill({ json: { ok: true } });
  });

  // Navigate to a real origin first so the relative fetch() inside
  // pollHaAlerts resolves to an http URL the routes can match; setContent
  // then swaps the document but keeps that URL as the base.
  await page.goto(site + '/__harness', { waitUntil: 'commit' });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0}
    #rotate-wrap{position:relative;width:1280px;height:800px;background:#111}
    ${CSS}
  </style></head><body>
  <div id="rotate-wrap"></div>
  <script>
    window.escapeHtmlD = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    var state = ${JSON.stringify(cfg)};
    ${JS}
    window.__poll = pollHaAlerts;
  </script></body></html>`);
  await page.evaluate(() => window.__poll());
  await page.locator('#ha-alert-banner').first().waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
  return { dismissed };
}

test('renders with the message and default data-attrs', async ({ page, site }) => {
  await mountBanner(page, site, { cfg: {} });
  const bar = page.locator('#ha-alert-banner');
  await expect(bar).toHaveAttribute('data-pos', 'top');
  await expect(bar).toHaveAttribute('data-size', 'm');
  await expect(bar).toHaveAttribute('data-style', 'solid');
  await expect(page.locator('.ha-alert-msg')).toContainText('Garage open for 15 minutes');
});

test('position: bottom pins the banner to the bottom of the layout', async ({ page, site }) => {
  await mountBanner(page, site, { cfg: { alertBannerPosition: 'bottom' } });
  const box = await page.locator('#ha-alert-banner .ha-alert-row').boundingBox();
  expect(box.y + box.height).toBeGreaterThan(700); // near the 800px-tall container's bottom
});

test('position: center shows a full-bleed dim scrim and centers the card', async ({ page, site }) => {
  await mountBanner(page, site, { cfg: { alertBannerPosition: 'center' } });
  const bar = page.locator('#ha-alert-banner');
  await expect(bar).toHaveAttribute('data-pos', 'center');
  const info = await bar.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { bg: cs.backgroundColor, w: r.width, h: r.height };
  });
  expect(info.bg).toMatch(/rgba?\(0,\s*0,\s*0/); // the scrim
  expect(info.w).toBeGreaterThan(1200);
  expect(info.h).toBeGreaterThan(700);
});

test('size scales the row font: xxl is far larger than s', async ({ page, site }) => {
  await mountBanner(page, site, { cfg: { alertBannerSize: 's' } });
  const small = await page.locator('.ha-alert-row').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await mountBanner(page, site, { cfg: { alertBannerSize: 'xxl' } });
  const huge = await page.locator('.ha-alert-row').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(huge).toBeGreaterThan(small * 2);
});

test('an unknown style/size/position clamps to the defaults', async ({ page, site }) => {
  await mountBanner(page, site, { cfg: { alertBannerPosition: 'sideways', alertBannerSize: 'giant', alertBannerStyle: 'neon' } });
  const bar = page.locator('#ha-alert-banner');
  await expect(bar).toHaveAttribute('data-pos', 'top');
  await expect(bar).toHaveAttribute('data-size', 'm');
  await expect(bar).toHaveAttribute('data-style', 'solid');
});

test('the ✕ removes the row and POSTs the dismiss key', async ({ page, site }) => {
  const { dismissed } = await mountBanner(page, site);
  await page.locator('#ha-alert-banner .ha-alert-x').click();
  await expect(page.locator('#ha-alert-banner')).toHaveCount(0);
  expect(dismissed).toEqual(['ha-alert:test']);
});

test('two active alerts render two dismissible rows', async ({ page, site }) => {
  await mountBanner(page, site, { notifications: [
    ALERT,
    { key: 'ha-alert:two', kind: 'ha-alert', body: 'Freezer above 10' },
  ] });
  await expect(page.locator('#ha-alert-banner .ha-alert-row')).toHaveCount(2);
});
