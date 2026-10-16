'use strict';
// Recipes: reading an ingredient line ("1 1/2 cups flour, sifted") into quantity / unit / name / note, scaling it to another number of servings, and writing a
// quantity the way a cook would say it (1 1/2, not 1.5). Pure functions with no database, used by src/recipes.js and tested in test/unit/recipe-parse.test.js.
// Parsing is best effort and never blocks saving: the original line is always kept (`raw`), and whatever cannot be read becomes the name.

const UNI = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6 };
const UNI_CLASS = Object.keys(UNI).join('');

// canonical unit -> [spellings it is typed as]; `fixed` units are written the same for one and many (tsp, oz, g...)
const UNITS = {
  cup: { alias: ['cup', 'cups', 'c'], plural: 'cups' },
  tbsp: { alias: ['tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons', 'tbl', 'T'], fixed: true },
  tsp: { alias: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 't'], fixed: true },
  'fl oz': { alias: ['fl oz', 'fl. oz', 'fluid ounce', 'fluid ounces'], fixed: true },
  oz: { alias: ['oz', 'ounce', 'ounces'], fixed: true },
  lb: { alias: ['lb', 'lbs', 'pound', 'pounds'], fixed: true },
  g: { alias: ['g', 'gram', 'grams', 'gr'], fixed: true },
  kg: { alias: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'], fixed: true },
  ml: { alias: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], fixed: true },
  l: { alias: ['l', 'liter', 'liters', 'litre', 'litres'], fixed: true },
  pint: { alias: ['pint', 'pints', 'pt'], plural: 'pints' },
  quart: { alias: ['quart', 'quarts', 'qt'], plural: 'quarts' },
  gallon: { alias: ['gallon', 'gallons', 'gal'], plural: 'gallons' },
  pinch: { alias: ['pinch', 'pinches'], plural: 'pinches' },
  dash: { alias: ['dash', 'dashes'], plural: 'dashes' },
  clove: { alias: ['clove', 'cloves'], plural: 'cloves' },
  can: { alias: ['can', 'cans', 'tin', 'tins'], plural: 'cans' },
  jar: { alias: ['jar', 'jars'], plural: 'jars' },
  bottle: { alias: ['bottle', 'bottles'], plural: 'bottles' },
  bag: { alias: ['bag', 'bags'], plural: 'bags' },
  package: { alias: ['package', 'packages', 'pkg', 'pkgs', 'packet', 'packets'], plural: 'packages' },
  stick: { alias: ['stick', 'sticks'], plural: 'sticks' },
  slice: { alias: ['slice', 'slices'], plural: 'slices' },
  piece: { alias: ['piece', 'pieces'], plural: 'pieces' },
  bunch: { alias: ['bunch', 'bunches'], plural: 'bunches' },
  sprig: { alias: ['sprig', 'sprigs'], plural: 'sprigs' },
  head: { alias: ['head', 'heads'], plural: 'heads' },
  handful: { alias: ['handful', 'handfuls'], plural: 'handfuls' },
};
// Longest spelling first, so "fl oz" wins over "oz" and "tablespoons" over "t".
const UNIT_SPELLINGS = [];
for (const [canon, u] of Object.entries(UNITS)) for (const a of u.alias) UNIT_SPELLINGS.push([a, canon]);
UNIT_SPELLINGS.sort((a, b) => b[0].length - a[0].length);

const num = (s) => Number(s);

// A number at the start of `s`: "1 1/2", "1-1/2", "3/4", "1.5", "2", "½", "1½". Returns { value, len } or null.
function readNumber(s) {
  let m;
  if ((m = new RegExp(`^(\\d+)\\s*([${UNI_CLASS}])`).exec(s))) return { value: num(m[1]) + UNI[m[2]], len: m[0].length };
  if ((m = new RegExp(`^([${UNI_CLASS}])`).exec(s))) return { value: UNI[m[1]], len: m[0].length };
  if ((m = /^(\d+)\s+(\d+)\/(\d+)(?!\d)/.exec(s)) && num(m[3])) return { value: num(m[1]) + num(m[2]) / num(m[3]), len: m[0].length };
  if ((m = /^(\d+)-(\d+)\/(\d+)(?!\d)/.exec(s)) && num(m[3])) return { value: num(m[1]) + num(m[2]) / num(m[3]), len: m[0].length };
  if ((m = /^(\d+)\/(\d+)(?!\d)/.exec(s)) && num(m[2])) return { value: num(m[1]) / num(m[2]), len: m[0].length };
  if ((m = /^(\d*\.\d+|\d+)/.exec(s))) return { value: num(m[1]), len: m[0].length };
  return null;
}

function matchUnit(s) {
  for (const [spell, canon] of UNIT_SPELLINGS) {
    // case matters only for the one-letter T (tablespoon) and t (teaspoon)
    if (spell === 'T' || spell === 't') { if (s[0] !== spell) continue; }
    else if (s.slice(0, spell.length).toLowerCase() !== spell.toLowerCase()) continue;
    const after = s.slice(spell.length);
    if (/^[A-Za-z]/.test(after)) continue;                       // "cupcakes" is not "cup"
    return { unit: canon, len: spell.length + (after[0] === '.' ? 1 : 0) };
  }
  return null;
}

const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();

// One line -> { raw, header } for a section title ("For the sauce:"), or { raw, quantity, quantity_max, unit, name, note } for an ingredient, or null for nothing.
function parseIngredient(line) {
  let raw = clean(line).replace(/^[-*•·–]\s+/, '');
  if (!raw) return null;
  if (/:$/.test(raw) && !/^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(raw) && raw.length <= 60) return { raw, header: raw.replace(/:$/, '').trim() };
  let rest = raw, quantity = null, quantity_max = null, unit = '', note = '';

  const n1 = readNumber(rest);
  if (n1) {
    quantity = n1.value; rest = rest.slice(n1.len).trimStart();
    const range = /^(?:-|–|—|to)\s*/i.exec(rest);
    if (range) {
      const n2 = readNumber(rest.slice(range[0].length));
      if (n2 && n2.value > quantity) { quantity_max = n2.value; rest = rest.slice(range[0].length + n2.len).trimStart(); }
    }
  } else {
    // "a pinch of salt", "an onion" is just a name; only "a/an" + a unit counts as one
    const a = /^(a|an)\s+(.+)$/i.exec(rest);
    if (a && matchUnit(a[2])) { quantity = 1; rest = a[2]; }
  }

  // "(14 oz)" straight after the amount belongs to the note: "1 (14 oz) can tomatoes"
  const paren = /^\(([^)]*)\)\s*/.exec(rest);
  if (quantity !== null && paren) { note = clean(paren[1]); rest = rest.slice(paren[0].length); }

  if (quantity !== null) {
    const u = matchUnit(rest);
    if (u) { unit = u.unit; rest = rest.slice(u.len).trimStart(); rest = rest.replace(/^of\s+/i, ''); }
  }

  // "flour, sifted" / "butter (softened)": what follows the first comma, or a closing bracket, is a note
  let name = rest;
  const comma = name.indexOf(',');
  if (comma > 0) { note = clean([note, name.slice(comma + 1)].filter(Boolean).join(', ')); name = name.slice(0, comma); }
  const tail = /\s*\(([^)]*)\)\s*$/.exec(name);
  if (tail) { note = clean([note, tail[1]].filter(Boolean).join(', ')); name = name.slice(0, tail.index); }
  name = clean(name);
  if (/\s+to taste$/i.test(name)) { name = name.replace(/\s+to taste$/i, ''); note = clean([note, 'to taste'].filter(Boolean).join(', ')); }
  if (!name) { name = raw; quantity = null; quantity_max = null; unit = ''; note = ''; }   // could not make sense of it: keep the line as the name
  return { raw, quantity, quantity_max, unit, name, note };
}

// Many lines (or an array of lines) -> ingredient rows in order, each with the section title it is under (group_label).
function parseIngredientLines(input, limit = 100) {
  const lines = Array.isArray(input) ? input : String(input == null ? '' : input).split(/\r?\n/);
  const out = [];
  let group = '';
  for (const l of lines) {
    const p = parseIngredient(typeof l === 'string' ? l : (l && l.raw) || '');
    if (!p) continue;
    if (p.header !== undefined) { group = p.header; continue; }
    out.push({ ...p, group_label: group });
    if (out.length >= limit) break;
  }
  return out;
}

const FRACS = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8'], [1, '']];
// 1.5 -> "1 1/2", 0.333 -> "1/3", 12.4 -> "12.4". Nothing for a missing amount.
function formatQty(q) {
  if (q === null || q === undefined || !Number.isFinite(Number(q)) || Number(q) <= 0) return '';
  q = Number(q);
  if (q >= 10) { const r = Math.round(q * 10) / 10; return String(r); }
  let whole = Math.floor(q + 1e-9);
  const frac = q - whole;
  let best = FRACS[0];
  for (const f of FRACS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  if (best[0] === 1) { whole += 1; best = FRACS[0]; }
  if (whole === 0 && best[0] === 0) return '1/8';            // a tiny amount still shows as something
  return [whole || '', best[1]].filter((x) => x !== '').join(' ');
}

const OF_UNITS = new Set(['pinch', 'dash', 'handful', 'bunch']);
const unitWord = (unit, many) => { const u = UNITS[unit]; if (!u) return unit || ''; return many && !u.fixed ? u.plural : unit; };

// The line as shown at a scale: "2 cups flour, sifted". factor 1 = as written.
function ingredientDisplay(ing, factor = 1) {
  if (!ing) return '';
  const f = Number.isFinite(Number(factor)) && Number(factor) > 0 ? Number(factor) : 1;
  if (ing.quantity === null || ing.quantity === undefined) return [ing.name, ing.note ? (/^\d/.test(ing.note) ? `(${ing.note})` : `, ${ing.note}`) : ''].join('').replace(/^, /, '').trim() || ing.raw || '';
  const q = Number(ing.quantity) * f;
  const qmax = ing.quantity_max !== null && ing.quantity_max !== undefined ? Number(ing.quantity_max) * f : null;
  const amount = qmax ? `${formatQty(q)}-${formatQty(qmax)}` : formatQty(q);
  const many = (qmax || q) > 1.0001;
  const of = ing.unit && OF_UNITS.has(ing.unit) ? 'of' : '';                 // "a pinch of salt", "2 handfuls of spinach"
  const parts = [amount, ing.unit ? unitWord(ing.unit, many) : '', of, ing.name].filter(Boolean).join(' ');
  const note = ing.note ? (/^\d/.test(ing.note) ? ` (${ing.note})` : `, ${ing.note}`) : '';
  return parts + note;
}

// "10 min", "1 hr 30 min", "90 sec", "1 hour, 15 minutes" -> seconds; 0 when the text is not just a time.
function parseTimer(text) {
  let s = String(text == null ? '' : text).toLowerCase().trim();
  if (!s) return 0;
  let total = 0, any = false;
  s = s.replace(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g, (m, n, u) => { any = true; total += Number(n) * (/^h/.test(u) ? 3600 : /^m/.test(u) ? 60 : 1); return ' '; });
  if (!any || /[^\s,and&+]/.test(s.replace(/\band\b/g, ''))) return 0;                // something else was in there: not a timer
  return Math.min(86400, Math.round(total));
}
// The way a timer is written back into a step: 600 -> "10 min", 5400 -> "1 hr 30 min", 90 -> "1 min 30 sec".
function formatTimer(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [h ? h + ' hr' : '', m ? m + ' min' : '', s ? s + ' sec' : ''].filter(Boolean).join(' ');
}

module.exports = { parseTimer, formatTimer, parseIngredient, parseIngredientLines, formatQty, ingredientDisplay, UNITS };
