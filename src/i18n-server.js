// Server-side translation for text the server itself writes (emails). Same catalog
// as the screens (public/locales/<lang>.json, English text -> translation), so one
// file holds a language. English never loads a catalog: t(text) just fills {names}.
const fs = require('fs');
const path = require('path');

const LOCALES = { en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES' };
const cache = {};

function catalog(lang) {
  if (cache[lang]) return cache[lang];
  let strings = {};
  try {
    if (/^[a-z]{2,3}$/.test(lang)) strings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'locales', lang + '.json'), 'utf8')).strings || {};
  } catch { /* missing or broken catalog: stay English */ }
  return (cache[lang] = strings);
}

// t('High {hi} - Low {lo}', { hi: '70', lo: '50' }) in the household language.
// Text with no translation comes out in English; the {names} are always filled in.
function forLanguage(lang) {
  lang = String(lang || 'en').toLowerCase();
  const strings = lang === 'en' ? {} : catalog(lang);
  const t = (text, vars) => {
    const out = strings[text] || text;
    return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
  };
  t.lang = lang;
  t.locale = LOCALES[lang] || 'en-US';
  t.english = lang === 'en' || !LOCALES[lang];
  // '2026-10-04' style day -> "Sunday, October 4" / "Sonntag, 4. Oktober" (opts = Intl options)
  t.day = (ymd, opts) => new Date(ymd + 'T00:00:00').toLocaleDateString(t.locale, opts);
  // '14:30' -> "2:30 PM" in English, "14:30" otherwise
  t.time = (hhmm) => {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    if (!t.english) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  return t;
}

module.exports = { forLanguage };
