/* Piazza HQ - on-screen keyboard for a touch screen that has none (a wall-mounted touch panel on a Raspberry Pi: the browser runs as a kiosk, there is no
 * keyboard to plug in, and the desktop's own keyboard does not come up for the browser).
 *
 * It is invisible until it is needed: until a text field is selected BY TOUCH it adds nothing to the page (no element, no style, no work but one listener), so a
 * wall calendar that is used with a mouse, or not touched at all, looks and behaves exactly as before.
 *
 * Setting "onscreen_keyboard" (Settings > Display):
 *   auto    (default) a touch on a text field opens it, on a Linux screen only (Raspberry Pi and other Linux kiosks); Android, iPad, Windows and ChromeOS bring their own keyboard
 *   on      a touch on a text field opens it, on any system
 *   always  any way of selecting a text field opens it (for a touch panel that reports itself as a mouse)
 *   off     never
 *
 * It is one docked keyboard for the page's own text fields: it types with the browser's own editing commands (so every page handler hears a normal "input" event),
 * keeps the field focused while it is used, lifts a sheet that would sit behind it, and follows a rotated display (it lives inside #rotate-wrap).
 * Layouts: English, German (QWERTZ), French (AZERTY), Spanish; accented letters on a long press; numbers and symbols; a number pad for number fields.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api.pure;
  if (root && root.document) root.PhqOsk = api.client;
}(typeof window !== 'undefined' ? window : this, function (root) {
  'use strict';

  // ── pure helpers (also exported for the unit test) ──
  var LETTERS = {
    en: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
    de: ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnmß'],
    fr: ['azertyuiop', 'qsdfghjklm', 'wxcvbn'],
    es: ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'],
  };
  var ALTS = {
    a: 'àáâäãåæ', e: 'èéêëē€', i: 'ìíîï', o: 'òóôöõøœ', u: 'ùúûüū', c: 'çćč', n: 'ñń', s: 'ßšś', y: 'ýÿ', z: 'žźż', l: 'ł', d: 'ð',
    '.': '…', ',': '…', '-': '–—', '?': '¿', '!': '¡', '$': '€£¥¢', '0': '°', '/': '\\', '"': '“”«»', "'": '‘’',
  };
  var SYM1 = ['1234567890', '-/:;()$&@"', ".,?!'"];
  var SYM2 = ['[]{}#%^*+=', '_\\|~<>€£¥•', ".,?!'"];
  var TEXTY = { '': 'text', text: 'text', search: 'text', password: 'text', email: 'email', url: 'url', tel: 'tel', number: 'number' };

  function layoutFor(lang) {
    lang = String(lang || 'en').slice(0, 2).toLowerCase();
    return LETTERS[lang] ? lang : 'en';
  }

  // What kind of keyboard a field needs: 'text' | 'email' | 'url' | 'number' | 'tel', or null when it is not a text field (checkbox, date, time, select, read-only...).
  function fieldKind(tag, type, readOnly, disabled, inputmode) {
    if (readOnly || disabled) return null;
    inputmode = String(inputmode || '').toLowerCase();
    if (inputmode === 'none') return null;
    tag = String(tag || '').toLowerCase(); type = String(type || '').toLowerCase();
    if (tag === 'textarea') return 'text';
    if (tag !== 'input' || !Object.prototype.hasOwnProperty.call(TEXTY, type)) return null;
    var k = TEXTY[type];
    if (k === 'text') {
      if (inputmode === 'numeric' || inputmode === 'decimal') return 'number';
      if (inputmode === 'tel') return 'tel';
      if (inputmode === 'email') return 'email';
      if (inputmode === 'url') return 'url';
    }
    return k;
  }

  // Should the keyboard open for this focus? pointerType is how the page was last touched ('touch' | 'pen' | 'mouse' | 'key' | '').
  function shouldShow(mode, pointerType, ua) {
    mode = mode || 'auto';
    if (mode === 'off') return false;
    if (mode === 'always') return true;
    if (pointerType !== 'touch' && pointerType !== 'pen') return false;
    if (mode === 'on') return true;
    return !/Android|iPhone|iPad|iPod|CrOS|Windows|Macintosh/i.test(ua || '');
  }

  // Start a sentence with a capital: true at the start of the field, after a line break, and after . ! ? and a space.
  function wantsShift(before, kind, secret, autocapitalize) {
    if (kind !== 'text' || secret) return false;
    var ac = String(autocapitalize || '').toLowerCase();
    if (ac === 'none' || ac === 'off' || ac === 'characters') return false;
    return before === '' || /(^|[\n])$/.test(before) || /[.!?]\s+$/.test(before);
  }

  // The rows of the keyboard for a field kind, a language and a layer ('abc' | 'sym1' | 'sym2'). A key is {t: text typed, l: label} or {a: action, l: label, w: width}.
  function rowsFor(kind, lang, layer) {
    var rows = [], i;
    function chars(s) { var r = []; for (i = 0; i < s.length; i++) r.push({ t: s[i], l: s[i] }); return r; }
    if (kind === 'number' || kind === 'tel') {
      rows.push(chars('123'), chars('456'), chars('789'));
      rows.push([{ t: kind === 'tel' ? '+' : '.', l: kind === 'tel' ? '+' : '.' }, { t: '0', l: '0' }, { a: 'back', l: '⌫' }]);
      rows.push([{ a: 'enter', l: '↵', w: 2 }, { a: 'hide', l: '⌄', w: 1 }]);
      return rows;
    }
    var side = kind === 'email' ? ['@', '.'] : kind === 'url' ? ['/', '.'] : [',', '.'];
    var bottom = function (toggle) {
      return [{ a: toggle.a, l: toggle.l, w: 1.5 }, { t: side[0], l: side[0] }, { a: 'space', l: ' ', w: 4 }, { t: side[1], l: side[1] }, { a: 'enter', l: '↵', w: 1.5 }, { a: 'hide', l: '⌄', w: 1 }];
    };
    if (layer === 'sym1' || layer === 'sym2') {
      var S = layer === 'sym1' ? SYM1 : SYM2;
      rows.push(chars(S[0]), chars(S[1]));
      rows.push([{ a: layer === 'sym1' ? 'sym2' : 'sym1', l: layer === 'sym1' ? '#+=' : '123', w: 1.5 }].concat(chars(S[2]), [{ a: 'back', l: '⌫', w: 1.5 }]));
      rows.push(bottom({ a: 'abc', l: 'ABC' }));
      return rows;
    }
    var L = LETTERS[layoutFor(lang)];
    rows.push(chars(L[0]), chars(L[1]));
    rows.push([{ a: 'shift', l: '⇧', w: 1.5 }].concat(chars(L[2]), [{ a: 'back', l: '⌫', w: 1.5 }]));
    rows.push(bottom({ a: 'sym1', l: '123' }));
    return rows;
  }

  var pure = { LETTERS: LETTERS, ALTS: ALTS, layoutFor: layoutFor, fieldKind: fieldKind, shouldShow: shouldShow, wantsShift: wantsShift, rowsFor: rowsFor };
  if (!root || !root.document) return { pure: pure, client: null };

  // ── the keyboard ──
  var doc = root.document;
  var STYLE = [
    '#phq-osk{position:absolute;left:0;right:0;bottom:0;z-index:2147483000;box-sizing:border-box;padding:var(--osk-pad,8px);background:#161922;',
    'border-top:2px solid #2d3344;display:flex;flex-direction:column;gap:var(--osk-gap,6px);contain:layout style;will-change:transform;',
    'user-select:none;-webkit-user-select:none;touch-action:none;color:#eef1f7;font-family:inherit}',
    '#phq-osk[hidden]{display:none}',
    '#phq-osk .osk-row{display:flex;gap:var(--osk-gap,6px);justify-content:center}',
    '#phq-osk .osk-k{position:relative;flex:1 1 0;min-width:0;height:var(--osk-kh,56px);display:flex;align-items:center;justify-content:center;border-radius:10px;',
    'background:#3b4254;color:#eef1f7;font-size:calc(var(--osk-kh,56px)*.44);line-height:1;cursor:pointer}',
    '#phq-osk .osk-k.osk-a{background:#2a2f3d;font-size:calc(var(--osk-kh,56px)*.36)}',
    '#phq-osk .osk-k.osk-on{background:#eef1f7;color:#1a1d27}',
    '#phq-osk .osk-k.osk-go{background:#4A90D9;color:#fff}',
    '#phq-osk .osk-k.osk-down{background:#6b748c}',
    '#phq-osk .osk-alts{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);display:flex;gap:4px;padding:6px;border-radius:12px;background:#12151d;',
    'z-index:2}',
    '#phq-osk .osk-alt{min-width:calc(var(--osk-kh,56px)*.8);height:var(--osk-kh,56px);display:flex;align-items:center;justify-content:center;border-radius:8px;',
    'background:#3b4254;font-size:calc(var(--osk-kh,56px)*.5)}',
    '#phq-osk .osk-alt.osk-pick{background:#4A90D9;color:#fff}',
  ].join('');

  var opts = { mode: function () { return 'auto'; }, lang: function () { return doc.documentElement.getAttribute('lang') || root.navigator.language || 'en'; } };
  var kb = null, cur = null, info = null, layer = 'abc', shift = 'off', lastShiftTap = 0;   // shift: 'off' | 'once' | 'lock'
  var lastPointer = '', lastPointerAt = 0, press = null, hideTimer = null, moved = null, repeatTimer = null, altsEl = null;
  var POINTER_TTL = 20000;

  function host() { return doc.getElementById('rotate-wrap') || doc.body; }
  function isPreview() { return doc.documentElement.classList.contains('preview'); }

  function infoFor(el) {
    if (!el || !el.tagName) return null;
    var kind = fieldKind(el.tagName, el.getAttribute('type'), el.readOnly, el.disabled, el.getAttribute('inputmode'));
    if (!kind || el.hasAttribute('data-no-osk')) return null;
    return { kind: kind, secret: String(el.getAttribute('type') || '').toLowerCase() === 'password', autocap: el.getAttribute('autocapitalize') };
  }

  // a capital for one letter; a letter with no single capital (ß) stays as it is
  function cap(ch) { var u = String(ch).toUpperCase(); return u.length === 1 ? u : ch; }

  function before() {
    try { if (cur && cur.selectionStart != null) return cur.value.slice(0, cur.selectionStart); } catch (e) { /* number and email fields have no caret to read */ }
    return cur ? String(cur.value || '') : '';
  }
  function autoShift() {
    if (shift === 'lock') return;
    shift = info && wantsShift(before(), info.kind, info.secret, info.autocap) ? 'once' : 'off';
    paintCase();
  }

  function build() {
    if (!kb) {
      if (!doc.getElementById('phq-osk-style')) { var st = doc.createElement('style'); st.id = 'phq-osk-style'; st.textContent = STYLE; doc.head.appendChild(st); }
      kb = doc.createElement('div'); kb.id = 'phq-osk'; kb.setAttribute('translate', 'no'); kb.className = 'notranslate'; kb.setAttribute('role', 'group'); kb.setAttribute('aria-label', 'Keyboard');
      kb.hidden = true;
      var stop = function (e) { e.stopPropagation(); };
      kb.addEventListener('pointerdown', onDown); kb.addEventListener('pointermove', onMove); kb.addEventListener('pointerup', onUp); kb.addEventListener('pointercancel', onCancel);
      kb.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
      kb.addEventListener('click', stop); kb.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
      kb.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      host().appendChild(kb);
    }
    if (kb.parentNode !== host()) host().appendChild(kb);
    var H = host().clientHeight || root.innerHeight, kh = Math.max(38, Math.min(72, Math.round(H * 0.085)));
    kb.style.setProperty('--osk-kh', kh + 'px');
    var rows = rowsFor(info.kind, opts.lang(), layer);
    kb.innerHTML = '';
    rows.forEach(function (r) {
      var row = doc.createElement('div'); row.className = 'osk-row';
      r.forEach(function (k) {
        var d = doc.createElement('div'); d.className = 'osk-k' + (k.a ? ' osk-a' : ''); d.style.flexGrow = String(k.w || 1);
        if (k.a === 'enter') d.className += ' osk-go';
        d.textContent = k.l; if (k.a) d.setAttribute('data-a', k.a); else d.setAttribute('data-t', k.t);
        row.appendChild(d);
      });
      kb.appendChild(row);
    });
    paintCase();
  }

  function paintCase() {
    if (!kb) return;
    var up = shift !== 'off', keys = kb.querySelectorAll('[data-t]');
    for (var i = 0; i < keys.length; i++) {
      var t = keys[i].getAttribute('data-t');
      if (layer === 'abc' && /[a-zà-ÿ]/i.test(t) && t.length === 1) { var want = up ? cap(t) : t.toLowerCase(); if (keys[i].textContent !== want) keys[i].textContent = want; }   // only a label that changed: every rewrite repaints the keyboard
    }
    var sh = kb.querySelector('[data-a="shift"]');
    if (sh) { sh.classList.toggle('osk-on', up); var mark = shift === 'lock' ? '⇪' : '⇧'; if (sh.textContent !== mark) sh.textContent = mark; }
  }

  // ── typing ──
  function insert(text) {
    if (!cur) return;
    var ok = false;
    try { ok = doc.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) fallbackEdit(text, false);
  }
  function backspace() {
    if (!cur) return;
    var ok = false;
    try { ok = doc.execCommand('delete'); } catch (e) { ok = false; }
    if (!ok) fallbackEdit('', true);
  }
  function fallbackEdit(text, del) {
    var el = cur, v = String(el.value || ''), s = v.length, e = v.length, hasCaret = true;
    try { if (el.selectionStart == null) hasCaret = false; else { s = el.selectionStart; e = el.selectionEnd; } } catch (x) { hasCaret = false; }
    if (del) { if (s === e) s = Math.max(0, s - 1); } else if (el.maxLength > 0 && v.length - (e - s) + text.length > el.maxLength) return;
    el.value = v.slice(0, s) + text + v.slice(e);
    if (hasCaret) { try { el.setSelectionRange(s + text.length, s + text.length); } catch (x) { /* ignore */ } }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function enter() {
    if (!cur) return;
    var ev = function (type) { return new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }); };
    var down = ev('keydown'); cur.dispatchEvent(down);
    if (down.defaultPrevented) return;
    cur.dispatchEvent(ev('keypress'));
    if (cur.tagName === 'TEXTAREA') insert('\n');
    else if (cur.form && typeof cur.form.requestSubmit === 'function') { try { cur.form.requestSubmit(); } catch (e) { /* no submit button */ } }
    cur.dispatchEvent(ev('keyup'));
  }

  function typeChar(ch) {
    insert(shift !== 'off' && ch.length === 1 ? cap(ch) : ch);
    if (shift === 'once') shift = 'off';
    autoShift();
  }

  function act(a, keyEl) {
    if (a === 'back') { backspace(); autoShift(); }
    else if (a === 'space') { insert(' '); autoShift(); }
    else if (a === 'enter') { enter(); autoShift(); }
    else if (a === 'hide') hide(true);
    else if (a === 'shift') {
      var now = Date.now();
      if (shift === 'lock') shift = 'off'; else if (shift === 'once' && now - lastShiftTap < 400) shift = 'lock'; else shift = shift === 'off' ? 'once' : 'off';
      lastShiftTap = now; paintCase();
    } else if (a === 'sym1' || a === 'sym2' || a === 'abc') { layer = a; build(); place(); }
    return keyEl;
  }

  // ── touches on the keyboard ──
  function keyAt(x, y) { var el = doc.elementFromPoint(x, y); return el && el.closest ? el.closest('#phq-osk .osk-k') : null; }
  function stopRepeat() { if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; } }
  function closeAlts() { if (altsEl && altsEl.parentNode) altsEl.parentNode.removeChild(altsEl); altsEl = null; }

  function onDown(e) {
    e.preventDefault(); e.stopPropagation();
    var k = e.target.closest ? e.target.closest('.osk-k') : null;
    if (!k) return;
    try { kb.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
    k.classList.add('osk-down');
    press = { k: k, t: k.getAttribute('data-t'), a: k.getAttribute('data-a'), long: false, timer: null };
    if (press.a) {
      act(press.a, k);
      if (press.a === 'back') { stopRepeat(); press.timer = setTimeout(function () { repeatTimer = setInterval(function () { backspace(); autoShift(); }, 55); }, 420); }
    } else {
      // every key types the moment it is pressed; holding a letter offers its accents, and choosing one replaces the letter that was typed
      press.upper = shift !== 'off';
      typeChar(press.t);
      var alts = ALTS[press.t.toLowerCase()] || ALTS[press.t];
      if (alts && !(info && info.kind === 'number')) {
        press.alts = alts;
        press.timer = setTimeout(function () { if (press) showAlts(press, k); }, 500);
      }
    }
  }
  function showAlts(p, k) {
    p.long = true; closeAlts();
    altsEl = doc.createElement('div'); altsEl.className = 'osk-alts';
    Array.prototype.forEach.call(p.alts, function (c) { var d = doc.createElement('div'); d.className = 'osk-alt'; d.setAttribute('data-alt', c); d.textContent = p.upper ? cap(c) : c; altsEl.appendChild(d); });
    k.appendChild(altsEl);
  }
  function onMove(e) {
    if (!press || !altsEl) return;
    var el = doc.elementFromPoint(e.clientX, e.clientY), a = el && el.closest ? el.closest('.osk-alt') : null;
    Array.prototype.forEach.call(altsEl.children, function (c) { c.classList.toggle('osk-pick', c === a); });
  }
  function onUp(e) {
    if (!press) return;
    var p = press; press = null; stopRepeat();
    if (p.timer) clearTimeout(p.timer);
    p.k.classList.remove('osk-down');
    if (p.long && altsEl) {
      var el = doc.elementFromPoint(e.clientX, e.clientY), a = el && el.closest ? el.closest('.osk-alt') : null;
      closeAlts();
      if (a) { backspace(); insert(a.textContent); autoShift(); }
      return;
    }
  }
  function onCancel() {
    if (press) { if (press.timer) clearTimeout(press.timer); press.k.classList.remove('osk-down'); press = null; }
    stopRepeat(); closeAlts();
  }

  // ── placing it, and getting a sheet out from behind it ──
  function localTop(el, rootEl) {
    var y = 0, n = el;
    while (n && n !== rootEl && n !== doc.body) { y += n.offsetTop; var p = n.offsetParent; if (p && p !== rootEl && p !== doc.body) y -= p.scrollTop; n = p; }
    return y;
  }
  function fixedAncestor(el, rootEl) {
    for (var n = el; n && n !== rootEl && n !== doc.body; n = n.parentElement) { if (root.getComputedStyle(n).position === 'fixed') return n; }
    return null;
  }
  var blurOff = null;
  function noBlur(el) {
    if (!el || (blurOff && blurOff.el === el)) return;
    restoreBlur();
    blurOff = { el: el, prev: el.style.backdropFilter, prevW: el.style.webkitBackdropFilter };
    el.style.backdropFilter = 'none'; el.style.webkitBackdropFilter = 'none';   // a full-screen blur behind the sheet is repainted at every key on a small computer; the dimming stays
  }
  function restoreBlur() { if (blurOff) { blurOff.el.style.backdropFilter = blurOff.prev; blurOff.el.style.webkitBackdropFilter = blurOff.prevW; blurOff = null; } }
  function unlift() {
    if (moved) { moved.el.style.transform = moved.prev; moved.el.style.transition = moved.prevT; moved = null; }
  }
  function place() {
    if (!cur || !kb || kb.hidden) return;
    var r = host(), H = r.clientHeight || root.innerHeight, kbH = kb.offsetHeight;
    var top = localTop(cur, r), bottom = top + cur.offsetHeight, room = H - kbH - 14, need = bottom - room;
    var mover = fixedAncestor(cur, r);
    noBlur(mover);
    if (mover) {
      // lift the sheet (its card, not the whole full-screen overlay behind it), as far as it fits, so the fields and buttons below the one being typed in stay in reach; its top is never pushed off the screen
      var card = cur; while (card.parentElement && card.parentElement !== mover) card = card.parentElement;
      if (card.parentElement === mover && card !== cur) { var ct = localTop(card, r); need = Math.max(need, Math.min(ct + card.offsetHeight - room, ct - 8)); mover = card; }
    }
    need = Math.min(need, top - 8);
    if (need > 0 && mover) {
      if (!moved || moved.el !== mover) { unlift(); moved = { el: mover, prev: mover.style.transform, prevT: mover.style.transition }; }
      mover.style.transform = 'translateY(' + (-Math.round(need)) + 'px)';
    } else {
      unlift();
      if (need > 0) { try { cur.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } }
    }
  }

  function show(el, inf) {
    clearTimeout(hideTimer); hideTimer = null;
    var sameKind = info && inf && info.kind === inf.kind;
    cur = el; info = inf;
    if (!sameKind || kb === null || kb.hidden) layer = 'abc';
    shift = 'off';
    build();
    kb.hidden = false;
    autoShift();
    place();
  }
  function hide(now) {
    clearTimeout(hideTimer); hideTimer = null; stopRepeat(); closeAlts();
    if (!kb || kb.hidden) { cur = null; return; }
    kb.hidden = true; unlift(); restoreBlur();
    if (now && cur) { try { cur.blur(); } catch (e) { /* ignore */ } }
    cur = null;
  }
  // The field lost focus. Leave the keyboard up until the tap that did it has finished (so a button does not slide away from under the finger), then close it unless another field took over.
  function softHide() {
    if (!kb || kb.hidden) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { hideTimer = null; var a = doc.activeElement; if (!(a && infoFor(a) && a === cur)) hide(false); }, 380);
  }

  function init(o) {
    if (o && typeof o.mode === 'function') opts.mode = o.mode;
    if (o && typeof o.lang === 'function') opts.lang = o.lang;
  }

  // A text field was selected (or touched while it already had the focus, which does not fire a new focus event): open the keyboard if this is a screen that wants one.
  function consider(el) {
    var inf = infoFor(el);
    if (!inf) { softHide(); return; }
    if (isPreview()) return;
    var recent = Date.now() - lastPointerAt < POINTER_TTL;
    var m; try { m = opts.mode(); } catch (x) { m = 'auto'; }
    if (shouldShow(m, recent ? lastPointer : '', root.navigator.userAgent)) { if (!kb || kb.hidden || cur !== el) show(el, inf); else { clearTimeout(hideTimer); hideTimer = null; } }
    else if (kb && !kb.hidden) softHide();
  }
  doc.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || ''; lastPointerAt = Date.now(); }, true);
  // a touch on a field that already has the focus: open it when the tap is finished (not at touch-down: the sheet lifts out of the way, and the page must not move under a finger that is still down)
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t === doc.activeElement && (!kb || kb.hidden) && !(kb && kb.contains(t))) consider(t);
  }, true);
  doc.addEventListener('focusin', function (e) { consider(e.target); }, true);
  doc.addEventListener('focusout', function (e) { if (cur && e.target === cur) softHide(); }, true);
  // A real keyboard was used: the on-screen one is not needed until the screen is touched again.
  doc.addEventListener('keydown', function (e) { if (e.isTrusted && kb && !kb.hidden) { lastPointer = 'key'; hide(false); } }, true);
  root.addEventListener('resize', function () { if (kb && !kb.hidden) { build(); place(); } });

  return { pure: pure, client: { init: init, isOpen: function () { return !!(kb && !kb.hidden); }, hide: function () { hide(true); }, pure: pure } };
}));
