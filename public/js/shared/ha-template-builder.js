'use strict';
// Template helper for Entity Status widgets: a toolbar that inserts correct Home Assistant template code for you, a recipe gallery that writes a whole template from a
// few choices, a live preview, and plain-English explanations when something is wrong. Used by the control app (widget settings) and by the display's Live Edit panel,
// which is why it is one shared script. It never changes how a template is stored: it only fills the same text box people can still type in.
// The functions at the top are pure (no page needed) and are unit-tested in Node; the part under "page UI" needs a browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HaTemplateBuilder = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ── pure helpers ──────────────────────────────────────────────────────────
  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";   // a Home Assistant template string literal
  const T = (s) => { try { return (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(s) : s; } catch (e) { return s; } };
  const ID_RE = /^[a-z_]+\.[a-z0-9_]+$/;
  const okId = (id) => { if (!ID_RE.test(String(id))) throw new Error('not an entity id: ' + id); return id; };

  const S = {
    value: (id) => '{{ states(' + q(okId(id)) + ') }}',
    valueUnit: (id) => '{{ states(' + q(okId(id)) + ') }} {{ state_attr(' + q(id) + ", 'unit_of_measurement') }}",
    title: (id) => '{{ states(' + q(okId(id)) + ') | title }}',
    name: (id) => '{{ state_attr(' + q(okId(id)) + ", 'friendly_name') }}",
    since: (id) => '{{ time_since(states.' + okId(id) + '.last_changed, 2) }}',
    ifOn: (id, yes, no) => '{% if is_state(' + q(okId(id)) + ", 'on') %}" + yes + '{% else %}' + no + '{% endif %}',
    countDomainOn: (domain) => '{{ states.' + String(domain).replace(/[^a-z_]/g, '') + " | selectattr('state', 'eq', 'on') | list | count }}",
    countClassOn: (domain, cls) => '{{ states.' + String(domain).replace(/[^a-z_]/g, '') + " | selectattr('attributes.device_class', 'eq', " + q(cls) + ") | selectattr('state', 'eq', 'on') | list | count }}",
    peopleHome: () => "{{ states.person | selectattr('state', 'eq', 'home') | map(attribute='name') | join(', ') or " + q(T('Nobody')) + ' }}',
    round: (id, n) => '{{ states(' + q(okId(id)) + ') | float(0) | round(' + (parseInt(n, 10) || 0) + ') }}',
    bold: (t) => '**' + t + '**',
  };

  // What can be counted. Each is "what a person calls it" -> the snippet. device_class values are Home Assistant's own.
  const COUNTS = [
    { id: 'lights', label: 'Lights on', make: () => S.countDomainOn('light') },
    { id: 'doors', label: 'Doors open', make: () => S.countClassOn('binary_sensor', 'door') },
    { id: 'windows', label: 'Windows open', make: () => S.countClassOn('binary_sensor', 'window') },
    { id: 'garage', label: 'Garage doors open', make: () => S.countClassOn('binary_sensor', 'garage_door') },
    { id: 'motion', label: 'Motion detected', make: () => S.countClassOn('binary_sensor', 'motion') },
    { id: 'switches', label: 'Switches on', make: () => S.countDomainOn('switch') },
  ];

  // Whole templates from a few choices. slots = entities to pick (domains limits the list), fields = short texts with a default.
  const ANY = ['sensor', 'binary_sensor', 'switch', 'input_select', 'input_boolean', 'cover', 'lock', 'light', 'climate', 'media_player', 'person', 'vacuum', 'fan', 'water_heater'];
  const RECIPES = [
    {
      id: 'laundry', title: 'Washer and dryer', blurb: 'Two machines, how long each has been in its state, and a reminder to move the laundry along.',
      slots: [{ key: 'washer', label: 'Washer', domains: ['sensor', 'binary_sensor', 'switch', 'input_select'] }, { key: 'dryer', label: 'Dryer', domains: ['sensor', 'binary_sensor', 'switch', 'input_select'] }],
      fields: [{ key: 'idle', label: 'State that means finished', def: 'idle', raw: true }, { key: 'wname', label: 'Washer label', def: 'Washer' }, { key: 'dname', label: 'Dryer label', def: 'Dryer' }],
      build: (v) => v.wname + ': **' + S.title(v.washer) + '** for ' + S.since(v.washer) + '\n'
        + v.dname + ': **' + S.title(v.dryer) + '** for ' + S.since(v.dryer) + '\n'
        + '{% if is_state(' + q(v.washer) + ', ' + q(v.idle) + ') and is_state(' + q(v.dryer) + ', ' + q(v.idle) + ') %}' + T('All done, nothing to swap')
        + '{% elif is_state(' + q(v.washer) + ', ' + q(v.idle) + ') %}' + T('Move the wet laundry to the dryer!') + '{% endif %}',
    },
    {
      id: 'laundry-swap', title: 'Laundry swapped?', blurb: 'The washer and how long it has been that way, and whether the laundry has been swapped yet: it counts as swapped once the washer door has been opened since the washer last changed.',
      slots: [{ key: 'washer', label: 'Washer', domains: ['sensor', 'binary_sensor', 'switch', 'input_select'] }, { key: 'door', label: 'Washer door', domains: ['binary_sensor', 'sensor'] }],
      fields: [{ key: 'wname', label: 'Washer label', def: 'Washer' }, { key: 'swapped', label: 'When swapped, say', def: 'Laundry was swapped ✅' }, { key: 'needs', label: 'Until then, say', def: 'Laundry needs to be swapped 🧺' }],
      build: (v) => v.wname + ': **' + S.title(v.washer) + '** for ' + S.since(v.washer) + '\n'
        + '{% if states.' + okId(v.door) + '.last_changed > states.' + okId(v.washer) + '.last_changed %}**' + v.swapped + '**{% else %}**' + v.needs + '**{% endif %}',
    },
    {
      id: 'status', title: 'One thing and how long', blurb: 'The state of one device with how long it has been that way, like "Garage: Open for 5 minutes".',
      slots: [{ key: 'e', label: 'Device', domains: ANY }],
      fields: [{ key: 'label', label: 'Label', def: 'Garage' }],
      build: (v) => v.label + ': **' + S.title(v.e) + '** for ' + S.since(v.e),
    },
    {
      id: 'yesno', title: 'A yes or no message', blurb: 'Say one thing when something is on and another when it is off.',
      slots: [{ key: 'e', label: 'Device', domains: ['binary_sensor', 'switch', 'light', 'input_boolean', 'fan', 'cover'] }],
      fields: [{ key: 'yes', label: 'When it is on, say', def: 'Dishwasher is running' }, { key: 'no', label: 'Otherwise say', def: 'Dishwasher is done' }],
      build: (v) => '**' + S.ifOn(v.e, v.yes, v.no) + '**',
    },
    {
      id: 'count', title: 'How many are on or open', blurb: 'A count of lights on, doors open, windows open and so on, across the whole house.',
      slots: [],
      fields: [{ key: 'what', label: 'What to count', def: 'doors', options: COUNTS.map((c) => [c.id, c.label]) }],
      build: (v) => { const c = COUNTS.find((x) => x.id === v.what) || COUNTS[0]; return T(c.label) + ': **' + c.make() + '**'; },
    },
    {
      id: 'home', title: 'Who is home', blurb: 'The names of everyone Home Assistant says is home (or "Nobody").',
      slots: [], fields: [{ key: 'label', label: 'Label', def: 'Home now' }],
      build: (v) => v.label + ': **' + S.peopleHome() + '**',
    },
    {
      id: 'climate', title: 'Temperature and humidity', blurb: 'Two sensors on one line.',
      slots: [{ key: 't', label: 'Temperature sensor', domains: ['sensor'] }, { key: 'h', label: 'Humidity sensor', domains: ['sensor'] }],
      fields: [{ key: 'label', label: 'Label', def: 'Living room' }],
      build: (v) => v.label + ': **' + S.valueUnit(v.t) + '** · **' + S.valueUnit(v.h) + '**',
    },
  ];

  S.unitOf = (id) => '{{ state_attr(' + q(okId(id)) + ", 'unit_of_measurement') }}";

  // What the step-by-step guide offers first: one line each, in plain English. Most reuse a recipe's pieces (devices to pick, texts to set, how to build it).
  const byId = (id) => RECIPES.find((r) => r.id === id);
  const GOALS = [
    {
      id: 'value', ask: 'Show a value from a sensor, like a temperature', title: 'A value',
      slots: [{ key: 'e', label: 'Which device or sensor?', domains: ['sensor', 'input_number', 'number', 'climate', 'weather'] }],
      fields: [
        { key: 'label', label: 'Label', def: 'Temperature' },
        { key: 'round', label: 'Round to', def: '', options: [['', 'As it is'], ['0', 'Whole numbers'], ['1', '1 decimal'], ['2', '2 decimals']] },
        { key: 'unit', label: 'Show the unit', def: true },
        { key: 'bold', label: 'Make the value bold', def: true },
      ],
      build: (v) => { const num = v.round !== '' ? S.round(v.e, v.round) : S.value(v.e); const core = num + (v.unit ? ' ' + S.unitOf(v.e) : ''); return v.label + ': ' + (v.bold ? '**' + core + '**' : core); },
    },
    {
      id: 'since', ask: 'Show how long ago something changed', title: 'How long ago',
      slots: [{ key: 'e', label: 'Which device?', domains: ANY }],
      fields: [{ key: 'label', label: 'Label', def: 'Last changed' }],
      build: (v) => v.label + ': **' + S.since(v.e) + '**',
    },
    Object.assign({ ask: "Show a device's state and how long it has been that way" }, byId('status')),
    Object.assign({ ask: 'Say one thing when something is on and another when it is off' }, byId('yesno')),
    Object.assign({ ask: 'Count things around the house (lights on, doors open and so on)' }, byId('count')),
    Object.assign({ ask: 'Show who is home' }, byId('home')),
  ];

  const levenshtein = (a, b) => {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  };

  // Entity ids a template mentions: 'sensor.x' in quotes, and states.sensor.x.  Only ids whose domain is one Home Assistant really has here are returned,
  // so 'attributes.device_class' and the like are never mistaken for an entity.
  function mentionedEntities(template, entities) {
    const domains = new Set((entities || []).map((e) => String(e.entity_id).split('.')[0]));
    const found = new Set();
    String(template || '').replace(/'([a-z_]+\.[a-z0-9_]+)'/g, (m, id) => { if (domains.has(id.split('.')[0])) found.add(id); return m; })
      .replace(/states\.([a-z_]+)\.([a-z0-9_]+)/g, (m, d, o) => { if (domains.has(d)) found.add(d + '.' + o); return m; });
    return [...found];
  }
  function unknownEntities(template, entities) {
    const have = new Set((entities || []).map((e) => e.entity_id));
    return mentionedEntities(template, entities).filter((id) => !have.has(id)).map((id) => {
      const dom = id.split('.')[0];
      const pool = (entities || []).filter((e) => e.entity_id.split('.')[0] === dom);
      const best = pool.map((e) => ({ id: e.entity_id, d: levenshtein(id, e.entity_id) })).sort((a, b) => a.d - b.d)[0];
      return { id, suggestion: best && best.d <= Math.max(3, Math.floor(id.length / 3)) ? best.id : '' };
    });
  }

  // Home Assistant's own error text -> a sentence a beginner can act on. Unknown errors come back as they are.
  function explainError(raw) {
    const m = String(raw || '');
    let r;
    if ((r = /Encountered unknown tag '([^']+)'/i.exec(m))) {
      const t = r[1];
      if (/^(endif|else|elif)$/.test(t)) return 'There is a {% ' + t + ' %} without an {% if %} before it. Each {% if %} is written once and closed with a single {% endif %}.';
      if (t === 'endfor') return 'There is an {% endfor %} without a {% for %} before it.';
      return 'The instruction "' + t + '" is not one Home Assistant knows. The common ones are if, elif, else, endif, for, endfor and set.';
    }
    if (/Unexpected end of template/i.test(m)) {
      const need = /'(endif|endfor)'/.exec(m);
      return need ? 'An {% ' + (need[1] === 'endif' ? 'if' : 'for') + ' %} was opened but never closed. Add {% ' + need[1] + ' %} at the end of it.' : 'The template stops too early. Check that every {% if %} has an {% endif %}.';
    }
    if ((r = /No filter named '([^']+)'/i.exec(m))) return 'There is no filter called "' + r[1] + '". A filter goes after a | (for example | title or | round(1)). Check the spelling.';
    if (/expected token 'end of print statement'/i.test(m)) return "Something between {{ and }} is not valid. Check the quotes and brackets, and that each value is written like states('sensor.name').";
    if ((r = /unexpected '(.)'/i.exec(m))) return 'There is a stray "' + r[1] + '". Check that every {{ has a matching }} and every {% has a matching %}.';
    if ((r = /'([^']+)' is undefined/i.exec(m)) || (r = /UndefinedError:?[^']*'([^']+)'/i.exec(m))) return '"' + r[1] + '" does not exist here. Check the spelling, and put device names in quotes inside states(\'...\').';
    if (/TemplateSyntaxError/i.test(m)) return 'The template is not written correctly. Check that every {{ has a }} and every {% has a %}, and that quotes come in pairs.';
    return m;
  }

  // **bold** -> <strong>, after escaping everything else (the same rule the display uses)
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const boldHtml = (text) => esc(text).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

  function filterEntities(entities, { domains, search } = {}) {
    const words = String(search || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (entities || []).filter((e) => {
      if (domains && domains.length && domains.indexOf(String(e.entity_id).split('.')[0]) < 0) return false;
      const hay = (e.friendly_name + ' ' + e.entity_id).toLowerCase();
      return words.every((w) => hay.indexOf(w) >= 0);
    });
  }

  const pure = { S, COUNTS, RECIPES, GOALS, q, mentionedEntities, unknownEntities, explainError, boldHtml, filterEntities, levenshtein };
  if (typeof document === 'undefined') return pure;

  // ── page UI ───────────────────────────────────────────────────────────────
  const CSS = `
.htb { margin-top:8px; font-size:13px; color:inherit; text-align:left }
.htb button { font:inherit; cursor:pointer; color:inherit; background:rgba(127,127,127,.14); border:1px solid rgba(127,127,127,.4); border-radius:7px; padding:5px 9px }
.htb button:hover { background:rgba(127,127,127,.26) }
.htb button.htb-guide { background:#3b5bdb; border-color:#3b5bdb; color:#fff }
.htb-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center }
.htb-bar .htb-label { opacity:.7; margin:0 2px 0 6px }
.htb-ac { margin:4px 0; border:1px solid rgba(127,127,127,.45); border-radius:8px; background:#fff; color:#1b1f2a; max-height:210px; overflow:auto; box-shadow:0 4px 14px rgba(0,0,0,.25) }
.htb-ac[hidden] { display:none }
.htb-ac .htb-aci { display:block; width:100%; text-align:left; border:0; border-bottom:1px solid #eceff4; border-radius:0; background:#fff; color:#1b1f2a; padding:6px 10px }
.htb-ac .htb-aci.on, .htb-ac .htb-aci:hover { background:#e4eaff }
.htb-ac small { opacity:.65; margin-left:6px }
.htb-live { margin-top:8px; padding:8px 10px; border-radius:8px; border:1px solid rgba(127,127,127,.35); background:rgba(127,127,127,.08); min-height:18px; white-space:pre-line; overflow-wrap:anywhere }
.htb-live strong { font-weight:800 }
.htb-live.htb-err { border-color:#c0392b }
.htb-hint { margin-top:6px; font-size:12px; color:#b9770e }
.htb-hint button { padding:1px 6px; margin-left:4px; font-size:12px }
.htb-modal { position:fixed; inset:0; z-index:2147483200; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:12px; font-size:14px }
.htb-card { background:#fff; color:#1b1f2a; width:min(520px,100%); max-height:88vh; overflow:auto; border-radius:12px; padding:16px; box-shadow:0 10px 40px rgba(0,0,0,.4); text-align:left }
.htb-card h3 { margin:0 0 6px; font-size:17px } .htb-card p { margin:4px 0 10px; opacity:.75; font-size:13px }
.htb-card input[type=text], .htb-card select { width:100%; box-sizing:border-box; font:inherit; padding:8px 10px; border:1px solid #b9bfcc; border-radius:8px; background:#fff; color:#1b1f2a; margin:3px 0 8px }
.htb-card label { display:block; font-size:12px; opacity:.8; margin-top:6px }
.htb-card label.htb-check { display:flex; align-items:center; gap:8px; opacity:1; font-size:13px; margin:8px 0 }
.htb-card .htb-list { max-height:44vh; overflow:auto; border:1px solid #d5d9e2; border-radius:8px }
.htb-card .htb-item { display:block; width:100%; text-align:left; border:0; border-bottom:1px solid #eceff4; border-radius:0; background:#fff; color:#1b1f2a; padding:8px 10px }
.htb-card .htb-item:hover { background:#eef2ff }
.htb-card .htb-item small { display:block; opacity:.65; overflow-wrap:anywhere }
.htb-card .htb-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap }
.htb-card button { color:#1b1f2a; background:#eef0f5; border:1px solid #c5cad6; font:inherit; cursor:pointer; border-radius:7px; padding:6px 10px }
.htb-card button:disabled { opacity:.5; cursor:default }
.htb-card button.htb-primary { background:#3b5bdb; border-color:#3b5bdb; color:#fff }
.htb-card .htb-prev { margin-top:10px; padding:8px 10px; border-radius:8px; background:#f3f5fa; white-space:pre-line; font-size:13px; overflow-wrap:anywhere }
.htb-card .htb-prev strong { font-weight:800 }
.htb-card .htb-step { font-size:12px; opacity:.6; margin-bottom:4px }
.htb-recipe { display:block; width:100%; text-align:left; padding:10px 12px !important; margin-bottom:8px; background:#f6f7fb !important }
.htb-recipe small { display:block; opacity:.7; font-weight:400 }
.htb-chosen { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:3px 0 8px }
.htb-attr { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid #eceff4 }
.htb-attr span { overflow-wrap:anywhere } .htb-attr em { opacity:.6; font-style:normal }
`;

  function injectCss() {
    if (document.getElementById('htb-css')) return;
    const st = document.createElement('style'); st.id = 'htb-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = (tag, attrs, html) => { const n = document.createElement(tag); if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]); if (html !== undefined) n.innerHTML = html; return n; };

  function modal(contentHtml) {
    const wrap = el('div', { class: 'htb-modal', role: 'dialog' });
    const card = el('div', { class: 'htb-card' }, contentHtml);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) close(); });
    return { wrap, card, close };
  }

  // pick one entity from a searchable list; resolves with the entity or null
  function pickEntity(entities, { title, domains }) {
    return new Promise((resolve) => {
      const m = modal('<h3></h3><input type="text" class="htb-search" placeholder="Search by name" autocomplete="off" spellcheck="false"><div class="htb-list"></div><div class="htb-actions"><button type="button" class="htb-cancel">Cancel</button></div>');
      m.card.querySelector('h3').textContent = title;
      const list = m.card.querySelector('.htb-list'), search = m.card.querySelector('.htb-search');
      let done = false;
      const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
      const draw = () => {
        const rows = filterEntities(entities, { domains, search: search.value }).slice(0, 60);
        list.innerHTML = '';
        if (!rows.length) { list.appendChild(el('div', { style: 'padding:10px;opacity:.7' }, 'Nothing matches.')); return; }
        rows.forEach((e) => {
          const b = el('button', { type: 'button', class: 'htb-item' });
          b.appendChild(document.createTextNode(e.friendly_name));
          const sm = el('small'); sm.textContent = e.entity_id + '  ·  ' + e.state + (e.unit ? ' ' + e.unit : ''); b.appendChild(sm);
          b.addEventListener('click', () => finish(e));
          list.appendChild(b);
        });
      };
      search.addEventListener('input', draw);
      m.card.querySelector('.htb-cancel').addEventListener('click', () => finish(null));
      m.wrap.addEventListener('mousedown', (ev) => { if (ev.target === m.wrap) finish(null); });
      draw(); setTimeout(() => search.focus(), 0);
    });
  }

  function insertAtCursor(box, text) {
    const s = box.selectionStart == null ? box.value.length : box.selectionStart, e = box.selectionEnd == null ? s : box.selectionEnd;
    box.value = box.value.slice(0, s) + text + box.value.slice(e);
    const pos = s + text.length; try { box.setSelectionRange(pos, pos); } catch (err) { /* not focusable */ }
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
    box.focus();
  }
  function setWhole(box, text) {
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // the fields of a recipe or wizard step: text boxes, a choice list, or a tick box (vals[key] is a string, or a boolean for a tick box)
  function initialValues(def) {
    const vals = {};
    (def.fields || []).forEach((f) => { vals[f.key] = (f.raw || f.options || typeof f.def === 'boolean') ? f.def : T(f.def); });
    return vals;
  }
  function renderFields(form, def, vals, onChange) {
    (def.fields || []).forEach((f) => {
      let inp;
      if (typeof f.def === 'boolean') {
        const lab = el('label', { class: 'htb-check' }); inp = el('input', { type: 'checkbox' }); inp.checked = !!vals[f.key];
        lab.appendChild(inp); const sp = el('span'); sp.textContent = f.label; lab.appendChild(sp); form.appendChild(lab);
        inp.addEventListener('change', () => { vals[f.key] = inp.checked; onChange(); });
        return;
      }
      form.appendChild(el('label', null, '')).textContent = f.label;
      if (f.options) { inp = el('select'); f.options.forEach(([v, t]) => { const o = el('option'); o.value = v; o.textContent = t; inp.appendChild(o); }); inp.value = vals[f.key]; }
      else { inp = el('input', { type: 'text' }); inp.value = vals[f.key]; }
      inp.addEventListener('input', () => { vals[f.key] = inp.value; clearTimeout(inp._t); inp._t = setTimeout(onChange, 400); });
      inp.addEventListener('change', () => { vals[f.key] = inp.value; onChange(); });
      form.appendChild(inp);
    });
  }

  // opts: { box: the <textarea>, host: element to build into, getEntities(): Promise<[{entity_id,state,friendly_name,unit}]>, preview(template): Promise<{text}|{error}>,
  //         getAttributes(id): Promise<{state,last_changed,attributes}> (optional: without it there is no Inspect button) }
  function mount(opts) {
    injectCss();
    const { box, host } = opts;
    let entCache = null;
    const entitiesP = () => (entCache ? Promise.resolve(entCache) : Promise.resolve(opts.getEntities ? opts.getEntities() : []).then((l) => (entCache = Array.isArray(l) ? l : [])).catch(() => []));
    const previewP = (tpl) => Promise.resolve(opts.preview ? opts.preview(tpl) : {}).catch(() => ({ error: 'Could not reach the server.' }));
    host.innerHTML = '';
    const root = el('div', { class: 'htb' });
    root.innerHTML = '<div class="htb-ac" hidden></div>'
      + '<div class="htb-bar"><button type="button" class="htb-guide" data-k="guide">Step by step…</button><span class="htb-label">Insert:</span>'
      + '<button type="button" data-k="value">A value…</button><button type="button" data-k="since">How long…</button><button type="button" data-k="ifon">If on or off…</button>'
      + '<button type="button" data-k="count">Count…</button><button type="button" data-k="bold">Bold</button><button type="button" data-k="recipes">Recipes…</button>'
      + (opts.getAttributes ? '<button type="button" data-k="inspect">Inspect…</button>' : '') + '</div>'
      + '<div class="htb-live" aria-live="polite"></div><div class="htb-hints"></div>';
    host.appendChild(root);
    const live = root.querySelector('.htb-live'), hints = root.querySelector('.htb-hints'), ac = root.querySelector('.htb-ac');

    // ── live preview ──
    let timer = null, seq = 0;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const tpl = box.value.trim(); const my = ++seq;
        hints.innerHTML = '';
        if (!tpl) { live.className = 'htb-live'; live.textContent = 'Your result appears here as you type.'; return; }
        live.className = 'htb-live'; live.textContent = 'Asking Home Assistant…';
        const [ents, r] = await Promise.all([entitiesP(), previewP(tpl)]);
        if (my !== seq) return;                                       // a newer keystroke is already being answered
        if (r && r.error) { live.className = 'htb-live htb-err'; live.textContent = explainError(r.error); }
        else { live.className = 'htb-live'; if (r && r.text) live.innerHTML = boldHtml(r.text); else live.textContent = '(nothing: the template came out empty)'; }
        unknownEntities(tpl, ents).forEach((u) => {
          const h = el('div', { class: 'htb-hint' });
          const msg = el('span');
          msg.textContent = u.suggestion
            ? 'Home Assistant has no device called "' + u.id + '". Did you mean "' + u.suggestion + '"?'
            : 'Home Assistant has no device called "' + u.id + '".';
          h.appendChild(msg);
          if (u.suggestion) {
            const fix = el('button', { type: 'button' }, 'Use it'); h.appendChild(fix);
            fix.addEventListener('click', () => setWhole(box, box.value.split(u.id).join(u.suggestion)));
          }
          hints.appendChild(h);
        });
      }, 650);
    };
    box.addEventListener('input', refresh);
    refresh();

    // ── autocomplete: after a quote or "states." the device names that fit what has been typed so far ──
    let acRows = [], acIdx = 0, acStart = 0;
    const acClose = () => { ac.hidden = true; ac.innerHTML = ''; acRows = []; };
    const acAccept = (e) => {
      const pos = box.selectionStart;
      box.value = box.value.slice(0, acStart) + e.entity_id + box.value.slice(pos);
      const np = acStart + e.entity_id.length; try { box.setSelectionRange(np, np); } catch (err) { /* ignore */ }
      acClose();
      box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true }));
      box.focus();
    };
    const acDraw = () => {
      ac.innerHTML = '';
      acRows.forEach((e, i) => {
        const b = el('button', { type: 'button', class: 'htb-aci' + (i === acIdx ? ' on' : '') });
        b.appendChild(document.createTextNode(e.friendly_name));
        const sm = el('small'); sm.textContent = e.entity_id + ' · ' + e.state + (e.unit ? ' ' + e.unit : ''); b.appendChild(sm);
        b.addEventListener('mousedown', (ev) => { ev.preventDefault(); acAccept(e); });     // before the box loses focus
        ac.appendChild(b);
      });
      ac.hidden = !acRows.length;
    };
    const acUpdate = async () => {
      const pos = box.selectionStart; if (pos == null || box.selectionEnd !== pos) return acClose();
      const m = /(?:['"]|states\.)([a-z_][a-z0-9_.]*)$/.exec(box.value.slice(0, pos));
      if (!m || m[1].length < 2) return acClose();
      const ents = await entitiesP();
      const partial = m[1];
      const domains = new Set(ents.map((e) => e.entity_id.split('.')[0]));
      // only when it looks like the start of a device id (has a dot, or begins a kind of device): not for words like 'on' or 'home'
      if (partial.indexOf('.') < 0 && ![...domains].some((d) => d.indexOf(partial) === 0)) return acClose();
      if (box.selectionStart !== pos) return;                         // the cursor moved while the list loaded
      acStart = pos - partial.length;
      // like any completion list: the kind of device must START with what was typed; after the dot, the rest of the name only has to contain it
      const dot = partial.indexOf('.');
      const kindQ = dot < 0 ? partial : partial.slice(0, dot), nameQ = dot < 0 ? '' : partial.slice(dot + 1);
      acRows = ents.filter((e) => { const i = e.entity_id.indexOf('.'); return e.entity_id.slice(0, i).indexOf(kindQ) === 0 && e.entity_id.slice(i + 1).indexOf(nameQ) >= 0 && e.entity_id !== partial; })
        .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1)).slice(0, 8);
      acIdx = 0; acDraw();
    };
    box.addEventListener('input', acUpdate);
    box.addEventListener('click', acUpdate);
    box.addEventListener('keydown', (ev) => {
      if (ac.hidden || !acRows.length) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); acIdx = (acIdx + 1) % acRows.length; acDraw(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); acIdx = (acIdx - 1 + acRows.length) % acRows.length; acDraw(); }
      else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); acAccept(acRows[acIdx]); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); acClose(); }
    });
    box.addEventListener('blur', () => setTimeout(acClose, 150));

    // ── toolbar ──
    const withEntity = async (title, domains, fn) => { const ents = await entitiesP(); const e = await pickEntity(ents, { title, domains }); if (e) fn(e); };
    const btn = (k) => root.querySelector('[data-k=' + k + ']');
    btn('value').addEventListener('click', () => withEntity('Which device or sensor?', null, (e) => insertAtCursor(box, e.unit ? S.valueUnit(e.entity_id) : S.value(e.entity_id))));
    btn('since').addEventListener('click', () => withEntity('Which device? (shows how long it has been in its current state)', null, (e) => insertAtCursor(box, S.since(e.entity_id))));
    btn('bold').addEventListener('click', () => {
      const s = box.selectionStart, e = box.selectionEnd;
      if (s != null && e > s) insertAtCursor(box, S.bold(box.value.slice(s, e))); else insertAtCursor(box, '**text**');
    });
    btn('ifon').addEventListener('click', () => withEntity('Which device? (something that is on or off)', ['binary_sensor', 'switch', 'light', 'input_boolean', 'fan', 'cover', 'lock'], (e) => {
      const m = modal('<h3>Say one thing when it is on, another when it is off</h3><label>When it is on, say</label><input type="text" class="htb-yes" value="On"><label>Otherwise say</label><input type="text" class="htb-no" value="Off"><div class="htb-actions"><button type="button" class="htb-cancel">Cancel</button><button type="button" class="htb-primary htb-go">Insert</button></div>');
      m.card.querySelector('.htb-cancel').addEventListener('click', m.close);
      m.card.querySelector('.htb-go').addEventListener('click', () => { const y = m.card.querySelector('.htb-yes').value, n = m.card.querySelector('.htb-no').value; m.close(); insertAtCursor(box, S.ifOn(e.entity_id, y, n)); });
    }));
    btn('count').addEventListener('click', () => {
      const m = modal('<h3>How many in the whole house?</h3><p>Inserts a number, for example Doors open: 2.</p><div class="htb-list"></div><div class="htb-actions"><button type="button" class="htb-cancel">Cancel</button></div>');
      m.card.querySelector('.htb-cancel').addEventListener('click', m.close);
      const list = m.card.querySelector('.htb-list');
      COUNTS.forEach((c) => { const b = el('button', { type: 'button', class: 'htb-item' }); b.textContent = c.label; b.addEventListener('click', () => { m.close(); insertAtCursor(box, c.make()); }); list.appendChild(b); });
    });

    // ── inspector: what can I show from this device? ──
    if (opts.getAttributes) btn('inspect').addEventListener('click', async () => {
      const ents = await entitiesP();
      const e = await pickEntity(ents, { title: 'Which device do you want to look at?' });
      if (!e) return;
      const d = await Promise.resolve(opts.getAttributes(e.entity_id)).catch(() => ({ error: 'Could not reach the server.' }));
      const m = modal('<h3></h3><p>Tap Insert next to anything you want to show.</p><div class="htb-list htb-attrs"></div><div class="htb-actions"><button type="button" class="htb-cancel">Close</button></div>');
      m.card.querySelector('h3').textContent = e.friendly_name;
      m.card.querySelector('.htb-cancel').addEventListener('click', m.close);
      const list = m.card.querySelector('.htb-attrs');
      if (!d || d.error) { list.appendChild(el('div', { style: 'padding:10px' })).textContent = explainError((d && d.error) || 'Could not reach the server.'); return; }
      const rows = [
        ['State', d.state, S.value(e.entity_id)],
        ['Name', (d.attributes && d.attributes.friendly_name) || e.friendly_name, S.name(e.entity_id)],
        ['How long in this state', d.last_changed ? '' : '', S.since(e.entity_id)],
      ];
      Object.keys(d.attributes || {}).forEach((k) => { if (k !== 'friendly_name') rows.push([k, d.attributes[k], '{{ state_attr(' + q(e.entity_id) + ', ' + q(k) + ') }}']); });
      rows.forEach(([label, value, snippet]) => {
        const row = el('div', { class: 'htb-attr' });
        const left = el('span'); left.appendChild(document.createTextNode(label));
        const shown = value === null ? 'none' : String(value === undefined ? '' : value).slice(0, 80);
        if (shown) { const em = el('em'); em.textContent = '  ' + shown; left.appendChild(em); }
        const add = el('button', { type: 'button' }, 'Insert');
        add.addEventListener('click', () => { m.close(); insertAtCursor(box, snippet); });
        row.appendChild(left); row.appendChild(add); list.appendChild(row);
      });
    });

    // ── recipes ──
    btn('recipes').addEventListener('click', () => {
      const m = modal('<h3>Pick a recipe</h3><p>Choose what you want to show; you pick your own devices next. You can still edit the result.</p><div class="htb-recipes"></div><div class="htb-actions"><button type="button" class="htb-cancel">Cancel</button></div>');
      m.card.querySelector('.htb-cancel').addEventListener('click', m.close);
      const holder = m.card.querySelector('.htb-recipes');
      RECIPES.forEach((rc) => {
        const b = el('button', { type: 'button', class: 'htb-recipe' }); b.appendChild(document.createTextNode(rc.title));
        const sm = el('small'); sm.textContent = rc.blurb; b.appendChild(sm);
        b.addEventListener('click', () => { m.close(); recipeForm(rc); });
        holder.appendChild(b);
      });
    });
    async function recipeForm(rc) {
      const ents = await entitiesP();
      const vals = initialValues(rc);
      const m = modal('<h3></h3><p></p><div class="htb-form"></div><div class="htb-prev"></div><div class="htb-actions"><button type="button" class="htb-cancel">Cancel</button><button type="button" class="htb-primary htb-go" disabled>Use this</button></div>');
      m.card.querySelector('h3').textContent = rc.title; m.card.querySelector('p').textContent = rc.blurb;
      const form = m.card.querySelector('.htb-form'), prev = m.card.querySelector('.htb-prev'), go = m.card.querySelector('.htb-go');
      const ready = () => rc.slots.every((s) => vals[s.key]);
      const update = async () => {
        go.disabled = !ready();
        if (!ready()) { prev.textContent = 'Choose the devices above to see the result.'; return; }
        const r = await previewP(rc.build(vals));
        if (r && r.error) prev.textContent = explainError(r.error); else prev.innerHTML = boldHtml((r && r.text) || '');
      };
      rc.slots.forEach((s) => {
        form.appendChild(el('label', null, '')).textContent = s.label;
        const row = el('div', { class: 'htb-chosen' }); const nameSpan = el('span'); nameSpan.textContent = 'Not chosen yet'; row.appendChild(nameSpan);
        const b = el('button', { type: 'button' }, 'Choose…'); row.appendChild(b); form.appendChild(row);
        b.addEventListener('click', async () => { const e = await pickEntity(ents, { title: s.label, domains: s.domains }); if (e) { vals[s.key] = e.entity_id; nameSpan.textContent = e.friendly_name; update(); } });
      });
      renderFields(form, rc, vals, update);
      m.card.querySelector('.htb-cancel').addEventListener('click', m.close);
      go.addEventListener('click', () => {
        if (!ready()) return;
        const tpl = rc.build(vals);
        if (box.value.trim() && box.value.trim() !== tpl && !confirm('Replace what you have written with this recipe?')) return;
        m.close(); setWhole(box, tpl);
      });
      update();
    }

    // ── step by step: what do you want to show? -> which device(s) -> the wording -> check it -> done (or add another line) ──
    btn('guide').addEventListener('click', () => wizard());
    async function wizard() {
      const ents = await entitiesP();
      const lines = [];                                              // lines finished so far in this session
      const stepText = (n, g) => 'Step ' + n + ' of ' + (g.slots.length ? 4 : 3);
      const m = modal('<div class="htb-step"></div><h3></h3><p></p><div class="htb-body"></div><div class="htb-prev" hidden></div><div class="htb-actions"></div>');
      const stepEl = m.card.querySelector('.htb-step'), h = m.card.querySelector('h3'), p = m.card.querySelector('p'), body = m.card.querySelector('.htb-body'), prev = m.card.querySelector('.htb-prev'), actions = m.card.querySelector('.htb-actions');
      const act = (label, cls, fn, disabled) => { const b = el('button', { type: 'button', class: cls || '' }); b.textContent = label; if (disabled) b.disabled = true; b.addEventListener('click', fn); actions.appendChild(b); return b; };
      const frame = (stepText, title, hint) => { body.innerHTML = ''; actions.innerHTML = ''; prev.hidden = true; stepEl.textContent = stepText; h.textContent = title; p.textContent = hint || ''; p.hidden = !hint; };

      function chooseGoal() {
        frame(lines.length ? 'Another line' : 'Step 1', 'What do you want to show?', 'Pick the closest one. You choose your own devices next, and can change the wording after.');
        GOALS.forEach((g) => {
          const b = el('button', { type: 'button', class: 'htb-recipe' }); b.appendChild(document.createTextNode(g.ask));
          b.addEventListener('click', () => chooseSlots(g, initialValues(g), 0));
          body.appendChild(b);
        });
        act('Cancel', '', m.close);
      }
      function chooseSlots(g, vals, i) {
        if (i >= g.slots.length) return wording(g, vals);
        const s = g.slots[i];
        frame(stepText(2, g), s.label, '');
        const row = el('div', { class: 'htb-chosen' }); const nameSpan = el('span'); nameSpan.textContent = vals[s.key] ? (ents.find((e) => e.entity_id === vals[s.key]) || { friendly_name: vals[s.key] }).friendly_name : 'Not chosen yet';
        const choose = el('button', { type: 'button' }, 'Choose…'); row.appendChild(nameSpan); row.appendChild(choose); body.appendChild(row);
        const next = act('Next', 'htb-primary', () => chooseSlots(g, vals, i + 1), !vals[s.key]);
        act('Back', '', () => (i === 0 ? chooseGoal() : chooseSlots(g, vals, i - 1)));
        act('Cancel', '', m.close);
        choose.addEventListener('click', async () => { const e = await pickEntity(ents, { title: s.label, domains: s.domains }); if (e) { vals[s.key] = e.entity_id; nameSpan.textContent = e.friendly_name; next.disabled = false; } });
      }
      function wording(g, vals) {
        frame(stepText(g.slots.length ? 3 : 2, g), 'How should it read?', g.title);
        if (g.fields.length) renderFields(body, g, vals, () => {}); else body.appendChild(el('p', null, '')).textContent = 'Nothing to set for this one.';
        act('Next', 'htb-primary', () => check(g, vals));
        act('Back', '', () => (g.slots.length ? chooseSlots(g, vals, g.slots.length - 1) : chooseGoal()));
        act('Cancel', '', m.close);
      }
      async function check(g, vals) {
        frame(stepText(g.slots.length ? 4 : 3, g), 'Does this look right?', '');
        const line = g.build(vals);
        prev.hidden = false; prev.textContent = 'Asking Home Assistant…';
        const r = await previewP(line);
        if (r && r.error) prev.textContent = explainError(r.error); else prev.innerHTML = boldHtml((r && r.text) || '');
        const finish = (all) => {
          const tpl = all.join('\n');
          if (box.value.trim() && box.value.trim() !== tpl && !confirm('Replace what you have written with this?')) return;
          m.close(); setWhole(box, tpl);
        };
        act('Use this', 'htb-primary', () => finish(lines.concat([line])));
        act('Add another line', '', () => { lines.push(line); chooseGoal(); });
        act('Back', '', () => wording(g, vals));
        act('Cancel', '', m.close);
      }
      chooseGoal();
    }
    return { refresh, destroy() { clearTimeout(timer); host.innerHTML = ''; } };
  }

  return Object.assign({ mount, insertAtCursor, setWhole, pickEntity }, pure);
});
