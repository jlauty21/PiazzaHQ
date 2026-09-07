'use strict';
const { defineConfig } = require('@playwright/test');

// Headless Chromium only. Serial (workers:1) — the specs each spin up their
// own tiny static server and there's no benefit to parallelism at this
// size. Default viewport is wall-display sized: below ~1100px display.html
// auto-enables IS_PREVIEW and disables the very edit-mode behaviour some
// specs test (HANDOFF.md, "Testing approach").
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 5000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
