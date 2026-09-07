'use strict';
// Small pure(-ish) display.html helpers:
//  - eventDetailKey(e): the composite key that keeps local (int id) and
//    ical (uid string) event namespaces from colliding, per-occurrence.
//  - applyAlertBannerConfig(): clamps the per-screen banner
//    position/size/style (1.85.0-beta.4/5) to valid values before writing
//    them as data-attrs.
const fs = require('fs');
const path = require('path');
const { extractFunction, extractConst } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, report } = require('../lib/tap');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'display.html'), 'utf8');

const eventDetailKey = evalInSandbox(
  [extractFunction(HTML, 'function eventDetailKey(')], {}, ['eventDetailKey']
).eventDetailKey;

const BANNER_SRC = [
  extractConst(HTML, 'BANNER_STYLES'),
  extractFunction(HTML, 'function applyAlertBannerConfig('),
];
function applyBanner(cfg) {
  const bar = { dataset: {} };
  const s = evalInSandbox(BANNER_SRC, {
    document: { getElementById: (id) => (id === 'ha-alert-banner' ? bar : null) },
    state: cfg,
  }, ['applyAlertBannerConfig']);
  s.applyAlertBannerConfig();
  return bar.dataset;
}

(async () => {
  await check('eventDetailKey composes source:id:date', () => {
    eq(eventDetailKey({ source: 'local', id: 42, date: '2026-09-06' }), 'local:42:2026-09-06');
    eq(eventDetailKey({ source: 'ical', id: 'ABC-123@google.com', date: '2026-12-25' }), 'ical:ABC-123@google.com:2026-12-25');
  });

  await check('eventDetailKey keeps a shared id distinct across sources and dates', () => {
    const a = eventDetailKey({ source: 'local', id: 1, date: '2026-09-06' });
    const b = eventDetailKey({ source: 'ical', id: 1, date: '2026-09-06' });
    const c = eventDetailKey({ source: 'ical', id: 1, date: '2026-09-13' });
    eq(new Set([a, b, c]).size, 3);
  });

  await check('applyAlertBannerConfig passes valid values through', () => {
    eq(applyBanner({ alertBannerPosition: 'center', alertBannerSize: 'xxl', alertBannerStyle: 'amber' }),
      { pos: 'center', size: 'xxl', style: 'amber' });
    eq(applyBanner({ alertBannerPosition: 'bottom', alertBannerSize: 's', alertBannerStyle: 'toast' }),
      { pos: 'bottom', size: 's', style: 'toast' });
  });

  await check('applyAlertBannerConfig clamps unknown values to the defaults', () => {
    eq(applyBanner({ alertBannerPosition: 'sideways', alertBannerSize: 'enormous', alertBannerStyle: 'neon' }),
      { pos: 'top', size: 'm', style: 'solid' });
  });

  await check('applyAlertBannerConfig defaults when the fields are absent', () => {
    eq(applyBanner({}), { pos: 'top', size: 'm', style: 'solid' });
  });

  report();
})();
