'use strict';
// /phone is the same page as /tablet (public/tablet.html), always laid out for a phone (window.TB_PHONE, see js/tablet/03-page.js), with its own name and its own Home Screen entry (public/phone-manifest.json).
// This turns the tablet page's HTML into the phone's. Returns null when the page is not the shape it expects (the caller then serves the plain page).
module.exports = function toPhonePage(html) {
  const out = String(html)
    .replace('/tablet-manifest.json', '/phone-manifest.json')
    .replace('<title>Piazza HQ Tablet</title>', '<title>Piazza HQ Phone</title>')
    .replace('name="apple-mobile-web-app-title" content="Tablet"', 'name="apple-mobile-web-app-title" content="Phone"')
    .replace('<link rel="stylesheet" href="/css/tablet.css">', '<script>window.TB_PHONE = true;</script>\n<link rel="stylesheet" href="/css/tablet.css">');
  return out.includes('window.TB_PHONE') && out.includes('/phone-manifest.json') ? out : null;
};
