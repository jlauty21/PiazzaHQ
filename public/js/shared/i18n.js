/* Piazza HQ - language support (shared by the control app, the wall display, the Family Hub and the kids page).
 *
 * How it works, in one paragraph: the pages are written in English. When the household language (setting "ui_language") is something other than English,
 * this file loads that language's catalog (public/locales/<lang>.json: English text -> translated text) and translates what the page SHOWS: every text node,
 * and the placeholder / title / aria-label / alt attributes, once at load and again for everything the page draws later (a MutationObserver). It also
 * translates the text of alert / confirm / prompt. In English it installs NOTHING - no observer, no work - so English users are exactly as before.
 *
 * Catalog entries are matched on the text a user would read, with spaces collapsed. An entry may hold {placeholders} ("{n} days left"); it then matches any text
 * of that shape and carries the pieces over into the translation ("Noch {n} Tage"). What is NOT translated, on purpose: anything the family typed (event
 * titles, names, notes) - it only changes when it happens to be word-for-word an interface text; <script>, <style>, <textarea>, and anything marked
 * translate="no" or class="notranslate".
 *
 * The dictionary of words is public/locales/<lang>.json:  { "meta": {"lang":"de","name":"Deutsch"}, "strings": { "Today": "Heute", ... } }
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api.pure;
  if (root && root.document) api.boot();
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  var LANG_KEY = 'phq_lang';
  var CAT_KEY = 'phq_catalog_';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'label'];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 0 };

  // ── pure helpers (also exported for the unit test) ──
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // strings -> { exact: Map, patterns: [{re, names, out}] }
  function compile(strings) {
    var exact = Object.create(null), patterns = [];
    Object.keys(strings || {}).forEach(function (k) {
      var v = strings[k];
      if (typeof v !== 'string' || v === '') return;
      if (/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(k)) {
        var names = [];
        var src = norm(k).split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/).map(function (part) {
          var m = part.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
          // {x} / {y} / {z} may be empty: they stand for the optional plural "s" ("1 item" has nothing there)
          if (m) { names.push(m[1]); return /^[xyz]$/.test(m[1]) ? '(.*?)' : '(.+?)'; }
          return escapeRe(part);
        }).join('');
        patterns.push({ re: new RegExp('^' + src + '$'), names: names, out: v, lit: norm(k).replace(/\{[^}]*\}/g, '').length });
      } else {
        exact[norm(k)] = v;
      }
    });
    // the most specific pattern (the most fixed text) first
    patterns.sort(function (a, b) { return b.lit - a.lit; });
    return { exact: exact, patterns: patterns };
  }

  // The singular or plural form for a number, by the language's own rule (German and English: exactly 1 is singular).
  function plural(lang, value, one, other) {
    var n = parseFloat(String(value).replace(',', '.'));
    if (isNaN(n)) return other;
    try { if (typeof Intl !== 'undefined' && Intl.PluralRules) return new Intl.PluralRules(lang || 'en').select(n) === 'one' ? one : other; } catch (e) {}
    return n === 1 ? one : other;
  }

  // Translate one piece of text; returns the translation, or null when there is none (so the caller leaves the text alone).
  // A text made of several UI texts joined by " · " ("Everyone · Every day", "Pictures + words · ⭐ 0"): when the whole is unknown, each piece that IS a known
  // UI text is translated and the others are kept as they are (names, numbers). A piece must match a catalog entry in full, as with whole texts.
  function translate(cat, raw) {
    var whole = translateWhole(cat, raw);
    if (whole != null || !cat || raw == null) return whole;
    var core = norm(raw);
    if (!core || core.length > 400 || core.indexOf(' \u00b7 ') < 0) return null;
    var any = false;
    var parts = core.split(' \u00b7 ').map(function (p) { var t = translateWhole(cat, p); if (t != null) { any = true; return t.trim(); } return p; });
    if (!any) return null;
    return String(raw).match(/^\s*/)[0] + parts.join(' \u00b7 ') + String(raw).match(/\s*$/)[0];
  }
  function translateWhole(cat, raw) {
    if (!cat || raw == null) return null;
    var core = norm(raw);
    if (!core || core.length > 1500) return null;
    var hit = cat.exact[core];
    var out = null;
    if (hit !== undefined && hit !== core) out = hit;
    else if (hit === undefined) {
      for (var i = 0; i < cat.patterns.length; i++) {
        var p = cat.patterns[i], m = p.re.exec(core);
        if (!m) continue;
        out = p.out.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(?:\|([^|}]*)\|([^}]*))?\}/g, function (all, name, one, other) {
          var at = p.names.indexOf(name);
          if (one === undefined) return at >= 0 ? m[at + 1] : all;
          return at >= 0 ? plural(cat.lang, m[at + 1], one, other) : all;      // {count|Eintrag|Einträge}: the form that fits the number captured as {count}
        });
        break;
      }
    }
    if (out == null) return null;
    var lead = String(raw).match(/^\s*/)[0], trail = String(raw).match(/\s*$/)[0];
    return lead + out + trail;
  }

  // Names of the weekdays / months in a language, from the browser's own data (null for English: the pages already carry English arrays).
  function names(lang, kind, style) {
    if (!lang || lang === 'en' || typeof Intl === 'undefined') return null;
    var out = [], i, d;
    if (kind === 'weekday') { for (i = 0; i < 7; i++) { d = new Date(2023, 0, 1 + i); out.push(new Intl.DateTimeFormat(lang, { weekday: style }).format(d)); } }
    else { for (i = 0; i < 12; i++) { d = new Date(2023, i, 1); out.push(new Intl.DateTimeFormat(lang, { month: style }).format(d)); } }
    // German short names come with a trailing dot ("Mo.", "Jan."): the pages add their own punctuation, so drop it
    return out.map(function (x) { return x.replace(/\.$/, ''); });
  }

  // A paragraph that mixes text with simple inline tags ("On your <b>main device</b>, open ...") is translated AS A WHOLE, so the sentence can be reordered:
  // its catalog key is the paragraph's markup. Only when every child element is a plain inline tag with no id (nothing the page's code holds on to).
  var INLINE = /^(B|I|EM|STRONG|CODE|KBD|SMALL|U|SUP|SUB|BR|SPAN|MARK|S)$/;
  function mixed(el) {
    if (!el.firstChild || el.children.length === 0 || el.children.length > 12) return false;
    var text = false, n;
    for (n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && /[A-Za-z]/.test(n.nodeValue)) text = true;
      else if (n.nodeType === 1 && (!INLINE.test(n.tagName) || n.id || n.children.length > 0 || n.hasAttribute('onclick'))) return false;
    }
    return text;
  }
  // A date the way that language writes it: 'full' (4. Oktober 2026), 'weekdayShort' (So., 4. Okt.), 'monthDay' (4. Okt.). English reads like the US.
  var DATE_KINDS = { full: { day: 'numeric', month: 'long', year: 'numeric' }, weekdayShort: { weekday: 'short', day: 'numeric', month: 'short' }, monthDay: { day: 'numeric', month: 'short' } };
  function dateText(lang, d, kind) {
    if (typeof Intl === 'undefined') return null;
    return new Intl.DateTimeFormat(!lang || lang === 'en' ? 'en-US' : lang, DATE_KINDS[kind] || DATE_KINDS.full).format(d);
  }
  // Money: the household's currency (setting "currency"; empty = the language's usual one: euro for German, dollar otherwise), written the way the language writes it.
  // English + dollar stays exactly "$12.50". opts.sign -> "+" / "-" in front (the amount itself is shown without its sign).
  var LANG_CURRENCY = { de: 'EUR', fr: 'EUR', es: 'EUR' };
  function currencyCode(lang, chosen) { return chosen || LANG_CURRENCY[lang] || 'USD'; }
  function moneyText(lang, chosen, amount, opts) {
    var v = Number(amount) || 0, code = currencyCode(lang, chosen), neg = v < 0;
    var shown = (opts && opts.sign) ? Math.abs(v) : v;
    var out;
    try { out = new Intl.NumberFormat(!lang || lang === 'en' ? 'en-US' : lang, { style: 'currency', currency: code, useGrouping: !!lang && lang !== 'en' }).format(shown); }
    catch (e) { out = '$' + shown.toFixed(2); }
    return (opts && opts.sign) ? (neg ? '-' : '+') + out : out;
  }
  function currencySymbol(lang, chosen) {
    try { var p = new Intl.NumberFormat(!lang || lang === 'en' ? 'en-US' : lang, { style: 'currency', currency: currencyCode(lang, chosen), currencyDisplay: 'narrowSymbol' }).formatToParts(0); for (var i = 0; i < p.length; i++) if (p[i].type === 'currency') return p[i].value; } catch (e) {}
    return '$';
  }
  var pure = { norm: norm, compile: compile, translate: translate, names: names, mixed: mixed, dateText: dateText, moneyText: moneyText, currencySymbol: currencySymbol };

  // ── browser part ──
  function boot() {
    var doc = root.document;
    var I = root.i18n = { lang: 'en', ready: false, cat: null, t: function (s) { return s; }, weekdays: function () { return null; }, months: function () { return null; }, date: function (d, kind) { return dateText('en', d, kind); }, money: function (a, o) { return moneyText('en', chosenCurrency(), a, o); }, currencySymbol: function () { return currencySymbol('en', chosenCurrency()); }, setCurrency: setCurrency, setLanguage: setLanguage, pure: pure };
    var stored = 'en';
    try { stored = root.localStorage.getItem(LANG_KEY) || 'en'; } catch (e) {}
    // The public website sets these before loading this file: its German pages carry their language in the page itself (PHQ_FORCE_LANG) and keep their catalog
    // under /assets/locales/ (PHQ_LOCALES); there is no device settings API there to follow.
    var forced = root.PHQ_FORCE_LANG ? String(root.PHQ_FORCE_LANG).toLowerCase() : '';
    if (forced) stored = forced;
    var localesBase = root.PHQ_LOCALES || '/locales/';
    function chosenCurrency() { try { return root.localStorage.getItem('phq_currency') || ''; } catch (e) { return ''; } }
    function setCurrency(code) { try { root.localStorage.setItem('phq_currency', code || ''); } catch (e) {} }

    function setLanguage(lang) {
      try { root.localStorage.setItem(LANG_KEY, lang || 'en'); } catch (e) {}
      root.location.reload();
    }

    // English: nothing to install. Still check, once, whether the household language was changed elsewhere (another device) - then reload to follow it.
    function followServer(applied) {
      if (!root.fetch || forced) return;
      root.fetch('/api/settings', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
        if (!s) return;
        // the household currency changed elsewhere (or this browser never knew it): remember it, and draw the amounts again once
        var prevCur = chosenCurrency(), newCur = s.currency || '';
        setCurrency(newCur);
        if (prevCur !== newCur) { var cg = 'phq_cur_reload'; try { if (root.sessionStorage.getItem(cg) !== newCur + '|') { root.sessionStorage.setItem(cg, newCur + '|'); root.location.reload(); return; } } catch (e) {} }
        var want = (s.ui_language || 'en').toLowerCase();
        if (want !== applied) {
          try { root.localStorage.setItem(LANG_KEY, want); } catch (e) {}
          var guard = 'phq_lang_reload';
          try { if (root.sessionStorage.getItem(guard) === want) return; root.sessionStorage.setItem(guard, want); } catch (e) {}
          root.location.reload();
        }
      }).catch(function () {});
    }

    if (stored === 'en') { followServer('en'); return; }

    I.lang = stored;
    try { doc.documentElement.setAttribute('lang', stored); } catch (e) {}   // the page says what language it is in
    var cat = null;
    try { var cached = root.localStorage.getItem(CAT_KEY + stored); if (cached) { cat = compile(JSON.parse(cached).strings); cat.lang = stored; } } catch (e) {}
    I.cat = cat;
    I.t = function (s, params) {
      var out = I.cat ? translate(I.cat, s) : null;
      var res = out == null ? s : out;
      if (params) res = String(res).replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, function (all, k) { return params[k] != null ? params[k] : all; });
      return res;
    };
    I.weekdays = function (style) { return names(stored, 'weekday', style); };
    I.months = function (style) { return names(stored, 'month', style); };
    I.date = function (d, kind) { return dateText(stored, d, kind); };
    I.money = function (a, o) { return moneyText(stored, chosenCurrency(), a, o); };
    I.currencySymbol = function () { return currencySymbol(stored, chosenCurrency()); };
    // numbers with the language's decimal mark: 1.234,50 in German
    I.num = function (v, minF, maxF) {
      try { return new Intl.NumberFormat(stored, { minimumFractionDigits: minF || 0, maximumFractionDigits: maxF == null ? (minF || 0) : maxF }).format(v); } catch (e) { return Number(v).toFixed(minF || 0); }
    };
    doc.documentElement.setAttribute('lang', stored);

    function skip(el) {
      if (!el || el.nodeType !== 1) return false;
      if (SKIP_TAGS[el.tagName]) return true;
      if (el.getAttribute('translate') === 'no' || (el.classList && el.classList.contains('notranslate')) || el.isContentEditable) return true;
      return false;
    }
    function attrs(el) {
      // a textarea's own text is the family's; its placeholder / title are ours
      if (!I.cat || (el.getAttribute('translate') === 'no') || (el.classList && el.classList.contains('notranslate'))) return;
      for (var i = 0; i < ATTRS.length; i++) {
        var a = ATTRS[i];
        if (!el.hasAttribute(a)) continue;
        var v = el.getAttribute(a), out = translate(I.cat, v);
        if (out != null && out !== v) el.setAttribute(a, out);
      }
      if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type || '')) {
        var vv = el.value, o2 = translate(I.cat, vv);
        if (o2 != null && o2 !== vv) el.value = o2;
      }
    }
    function textNode(n) {
      var p = n.parentNode;
      if (!p || skip(p) || (p.closest && p.closest('[translate="no"],.notranslate,script,style,textarea'))) return;
      var v = n.nodeValue;
      if (!v || !/[A-Za-z]/.test(v)) return;
      var out = translate(I.cat, v);
      if (out != null && out !== v) n.nodeValue = out;
    }
    function walk(node) {
      if (!node) return;
      if (node.nodeType === 3) { textNode(node); return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'TEXTAREA') { attrs(node); return; }   // its text is the family's; its placeholder is ours
      if (skip(node)) return;
      if (mixed(node)) {
        var whole = translate(I.cat, node.innerHTML);
        if (whole != null && whole !== node.innerHTML) { node.innerHTML = whole; return; }
      }
      attrs(node);
      for (var c = node.firstChild; c; c = c.nextSibling) walk(c);
    }
    function applyAll() {
      if (!I.cat) return;
      if (doc.title) { var t = translate(I.cat, doc.title); if (t != null && t !== doc.title) doc.title = t; }
      walk(doc.body);
    }

    // dialogs
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
      var orig = root[name];
      if (typeof orig !== 'function') return;
      root[name] = function (msg) {
        var args = Array.prototype.slice.call(arguments);
        if (typeof msg === 'string') args[0] = I.t(msg);
        return orig.apply(root, args);
      };
    });

    var observing = false;
    function observe() {
      if (observing || !root.MutationObserver || !doc.body) return;
      observing = true;
      new root.MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]); }
          else if (m.type === 'characterData') textNode(m.target);
          else if (m.type === 'attributes') attrs(m.target);
        }
      }).observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    }
    function start() { applyAll(); observe(); I.ready = true; }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();

    // fresh catalog (the cached one is only for an instant first paint)
    if (root.fetch) {
      root.fetch(localesBase + encodeURIComponent(stored) + '.json').then(function (r) { return r.ok ? r.text() : null; }).then(function (txt) {
        if (!txt) return;
        var json = JSON.parse(txt);
        try { root.localStorage.setItem(CAT_KEY + stored, txt); } catch (e) {}
        var first = !I.cat;
        I.cat = compile(json.strings); I.cat.lang = stored;
        cat = I.cat;
        if (first && doc.body) { applyAll(); observe(); }
        else if (doc.body) applyAll();
      }).catch(function () {});
    }
    followServer(stored);
  }

  return { pure: pure, boot: boot };
}));
