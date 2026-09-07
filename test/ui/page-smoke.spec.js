'use strict';
// Loads the real display.html and app.html in a browser with every /api/*
// call stubbed, and checks their inline <script> blocks actually parsed and
// ran: a syntax error or an early uncaught reference in any block stops the
// later top-level `function` declarations from ever defining. Several past
// bugs (HANDOFF.md) were exactly "threw on load", invisible to a syntax
// check of the file as a whole.
const { test, expect } = require('./lib');

async function stubApi(page) {
  await page.route('**/api/live', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' }));
  await page.route('**/api/version', (r) => r.fulfill({ json: { version: '1.85.0-beta.5', isBeta: true, deployment: 'test' } }));
  await page.route('**/api/settings', (r) => r.fulfill({ json: { device_role: 'host' } }));
  await page.route('**/api/screen-config**', (r) => r.fulfill({ json: {
    assigned_display_slug: '', addresses: null, port: 3000,
    alert_banner_position: 'top', alert_banner_size: 'm', alert_banner_style: 'solid',
    floating_switcher_enabled: false, floating_switcher_presets: [], floating_switcher_schedule: [],
  } }));
  // Everything else: an empty object is a safe default for the JSON callers;
  // list callers guard with Array.isArray, so this doesn't wedge them.
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
}

test('display.html: script blocks parse; core globals are defined', async ({ page, site }) => {
  await stubApi(page);
  await page.goto(site + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const want = ['renderLayout', 'pollHaAlerts', 'applyAlertBannerConfig', 'predictHaState', 'eventDetailKey', 'openEventDetail'];
  const defined = await page.evaluate((names) => names.filter((n) => typeof window[n] === 'function'), want);
  expect(defined).toEqual(want);
});

test('app.html: script blocks parse; core globals are defined', async ({ page, site }) => {
  await stubApi(page);
  await page.goto(site + '/app', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const want = ['checkHaAlertBannerApp', 'openHaEntitySearch', 'openEntityPicker', 'feedbackThreadSignature'];
  const defined = await page.evaluate((names) => names.filter((n) => typeof window[n] === 'function'), want);
  expect(defined).toEqual(want);
});
