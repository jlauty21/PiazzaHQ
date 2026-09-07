'use strict';
// predictHaState(cur, action, extra) — the optimistic-update prediction the
// wall display shows the instant you tap an HA control, before HA confirms.
// Six betas (1.84.0-beta.33..38) were spent getting the flash-back
// behaviour right; this pins the prediction itself so a refactor can't
// quietly change what "immediately" shows.
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, report } = require('../lib/tap');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'display.html'), 'utf8');
const predict = evalInSandbox(
  [extractFunction(HTML, 'function predictHaState(')], {}, ['predictHaState']
).predictHaState;

(async () => {
  await check('toggle flips on<->off from the current state', () => {
    eq(predict({ state: 'on' }, 'toggle').state, 'off');
    eq(predict({ state: 'off' }, 'toggle').state, 'on');
    eq(predict({ state: 'anything-else' }, 'toggle').state, 'on');
  });

  await check('fixed-target actions set the expected state', () => {
    eq(predict({ state: 'off' }, 'turn_on').state, 'on');
    eq(predict({ state: 'on' }, 'turn_off').state, 'off');
    eq(predict({ state: 'unlocked' }, 'lock').state, 'locked');
    eq(predict({ state: 'locked' }, 'unlock').state, 'unlocked');
    eq(predict({ state: 'closed' }, 'open_cover').state, 'open');
    eq(predict({ state: 'open' }, 'close_cover').state, 'closed');
  });

  await check('other fields on the current entity are preserved', () => {
    const cur = { state: 'on', friendly_name: 'Bar', brightness: 128, colorTempK: 2700 };
    const out = predict(cur, 'turn_off');
    eq(out.friendly_name, 'Bar');
    eq(out.brightness, 128);
    eq(out.state, 'off');
  });

  await check('media_play_pause flips playing<->paused', () => {
    eq(predict({ state: 'playing' }, 'media_play_pause').state, 'paused');
    eq(predict({ state: 'paused' }, 'media_play_pause').state, 'playing');
    eq(predict({ state: 'idle' }, 'media_play_pause').state, 'playing');
  });

  await check('set_brightness -> on + brightness scaled 0..255', () => {
    const out = predict({ state: 'off' }, 'set_brightness', { brightness_pct: 60 });
    eq(out.state, 'on');
    eq(out.brightness, Math.round(60 / 100 * 255)); // 153
  });

  await check('set_fan_speed -> on + fanPercentage', () => {
    const out = predict({ state: 'off' }, 'set_fan_speed', { fan_pct: 40 });
    eq(out.state, 'on');
    eq(out.fanPercentage, 40);
  });

  await check('volume_set -> volumeLevel 0..1, does NOT force state on', () => {
    const out = predict({ state: 'paused' }, 'volume_set', { volume_pct: 25 });
    eq(out.volumeLevel, 0.25);
    eq(out.state, 'paused');
  });

  await check('set_color_temp -> on + kelvin, falls back to current when absent', () => {
    eq(predict({ state: 'on', colorTempK: 2700 }, 'set_color_temp', { kelvin: 4000 }).colorTempK, 4000);
    eq(predict({ state: 'on', colorTempK: 2700 }, 'set_color_temp', {}).colorTempK, 2700);
  });

  await check('set_color -> rgbColor array for a valid triple, just on for a bad one', () => {
    const good = predict({ state: 'off' }, 'set_color', { rgb: '255,168,90' });
    eq(good.rgbColor, [255, 168, 90]);
    eq(good.state, 'on');
    const bad = predict({ state: 'off' }, 'set_color', { rgb: 'nope' });
    eq(bad.rgbColor, undefined);
    eq(bad.state, 'on');
  });

  await check('set_temperature -> targetTemp only for a numeric temperature', () => {
    eq(predict({ state: 'heat' }, 'set_temperature', { temperature: 71 }).targetTemp, 71);
    eq(predict({ state: 'heat' }, 'set_temperature', { temperature: '71' }), null);
    eq(predict({ state: 'heat' }, 'set_temperature', {}), null);
  });

  await check('no safe assumption -> null (trigger / stop_cover / media_next / unknown)', () => {
    for (const a of ['trigger', 'set_scene', 'stop_cover', 'media_next_track', 'media_previous_track', 'bogus']) {
      eq(predict({ state: 'on' }, a), null);
    }
  });

  await check('an errored or null current entity is treated as empty', () => {
    eq(predict({ error: 'Unavailable' }, 'turn_on').state, 'on');
    eq(predict(null, 'lock').state, 'locked');
    eq(predict(undefined, 'toggle').state, 'on');
  });

  report();
})();
