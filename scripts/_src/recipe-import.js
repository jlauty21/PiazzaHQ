'use strict';
// Recipes, phase 2: getting a recipe in from somewhere else. Three pure-ish helpers used by src/recipes.js (a plain helper like recipe-parse.js: nothing from
// server.js is handed in):
//   parseRecipeText(text)            a pasted block ("Pancakes / Ingredients / ... / Directions / ...") -> the same preview shape the editor takes
//   extractRecipeFromHtml(html, url) the schema.org Recipe data most recipe sites embed (JSON-LD) -> the same preview shape, or null
//   safeGet(url, opts)               fetches a page or a picture for the server, refusing addresses on the local network (so a recipe link can never be used to
//                                    poke at the router, the NAS or the server itself), with a size cap, a timeout and a limit on redirects
// Covered by test/unit/recipe-import.test.js and test/api/recipes-import.test.js.
const dns = require('dns').promises;
const net = require('net');

const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').replace(/[ \t]+/g, ' ').trim();

// ── small text helpers ──────────────────────────────────────────────────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°', frac12: '1/2', frac14: '1/4', frac34: '3/4', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…' };
function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(Number(d)); } catch { return ' '; } })
    .replace(/&([a-z0-9]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}
const stripTags = (s) => decodeEntities(String(s == null ? '' : s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, ''));

// "PT1H15M" -> 75, "15 minutes" -> 15, "1 hr 30 min" -> 90, 20 -> 20 (as minutes). 0 when unreadable.
function minutesOf(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.max(0, Math.round(v));
  const s = String(v).trim();
  let m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(s);
  if (m && (m[1] || m[2] || m[3] || m[4])) return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) + (Number(m[4] || 0) >= 30 ? 1 : 0);
  let total = 0, found = false;
  const day = /(\d+(?:\.\d+)?)\s*(?:d|day|days)\b/i.exec(s); if (day) { total += Number(day[1]) * 1440; found = true; }
  const hr = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(s); if (hr) { total += Number(hr[1]) * 60; found = true; }
  const mn = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/i.exec(s); if (mn) { total += Number(mn[1]); found = true; }
  if (found) return Math.round(total);
  m = /^(\d+)$/.exec(s); if (m) return Number(m[1]);
  return 0;
}
// "4 servings", ["4", "4 servings"], 6, "Makes 12 cookies" -> the first whole number, else 4
function servingsOf(v) {
  const first = Array.isArray(v) ? v.find((x) => x !== null && x !== '') : v;
  if (typeof first === 'number' && first > 0) return first;
  const m = /(\d+(?:\.\d+)?)/.exec(String(first == null ? '' : first));
  return m ? Math.max(0.5, Number(m[1])) : 4;
}
const listOf = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// ── pasted text ─────────────────────────────────────────────────────────────────────────────────────────────
const H_ING = /^(?:ingredients?|what you(?:'|’)?ll need|you will need|you(?:'|’)?ll need)\s*:?\s*$/i;
const H_DIR = /^(?:directions?|instructions?|method|steps?|preparation|procedure|how to make it|to make)\s*:?\s*$/i;
const looksLikeAmount = (line) => /^[-*•·–]?\s*(?:\d|[¼½¾⅓⅔⅛⅜⅝⅞]|an?\s+(?:pinch|dash|handful|can|clove|cup|tbsp|tsp|slice)\b)/i.test(line);

function parseRecipeText(input) {
  const raw = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
  const lines = raw.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  const out = { title: '', description: '', servings: 4, prep_min: 0, cook_min: 0, tags: [], ingredients: [], steps: [], source_name: '', source_url: '', origin: 'imported', image_url: '' };

  // meta lines are read wherever they are and removed
  const rest = [];
  for (const l of lines) {
    let m;
    if ((m = /^(?:serves?|servings?|yield|yields|makes)\s*:?\s*(.+)$/i.exec(l)) && /\d/.test(m[1]) && l.length < 60) { out.servings = servingsOf(m[1]); continue; }
    if ((m = /^prep(?:aration)?\s*time\s*:?\s*(.+)$/i.exec(l))) { out.prep_min = minutesOf(m[1]); continue; }
    if ((m = /^cook(?:ing)?\s*time\s*:?\s*(.+)$/i.exec(l))) { out.cook_min = minutesOf(m[1]); continue; }
    if ((m = /^total\s*time\s*:?\s*(.+)$/i.exec(l))) { if (!out.cook_min) out.cook_min = minutesOf(m[1]); continue; }
    rest.push(l);
  }
  const L = rest;
  const iIng = L.findIndex((l) => H_ING.test(l));
  const iDir = L.findIndex((l, i) => H_DIR.test(l) && i > Math.max(iIng, -1));

  let ingLines = [], stepBlock = [], head = [];
  if (iIng >= 0) {
    head = L.slice(0, iIng);
    ingLines = L.slice(iIng + 1, iDir >= 0 ? iDir : L.length);
    stepBlock = iDir >= 0 ? L.slice(iDir + 1) : [];
  } else if (iDir >= 0) {
    head = []; stepBlock = L.slice(iDir + 1);
    const before = L.slice(0, iDir);
    const firstAmount = before.findIndex(looksLikeAmount);
    head = firstAmount > 0 ? before.slice(0, firstAmount) : (firstAmount === 0 ? [] : before);
    ingLines = firstAmount >= 0 ? before.slice(firstAmount) : [];
  } else {
    // no headings at all: the first run of lines that start with an amount are the ingredients, what comes after them is the method
    const first = L.findIndex(looksLikeAmount);
    if (first < 0) { head = L; }
    else {
      head = L.slice(0, first);
      let end = first; while (end < L.length && (looksLikeAmount(L[end]) || L[end] === '' || /:$/.test(L[end]))) end++;
      ingLines = L.slice(first, end); stepBlock = L.slice(end);
    }
  }

  // the title is the first real line before the ingredients; any other text there is the description
  const headLines = head.filter(Boolean);
  const t = headLines.findIndex((l) => l.length <= 100 && !/[.!?]$/.test(l));
  const title = t >= 0 ? headLines[t] : (headLines[0] || '');
  out.title = clean(title).slice(0, 120);
  out.description = clean(headLines.filter((l, i) => !(i === t || (t < 0 && i === 0))).join(' ')).slice(0, 2000);

  out.ingredients = ingLines.map((l) => l.replace(/^[-*•·–]\s*/, '')).filter(Boolean);
  // steps: a blank line separates steps when there are any; otherwise one line is one step. Leading numbers are dropped.
  const hasBlank = stepBlock.some((l, i) => l === '' && i > 0 && stepBlock[i - 1] !== '');
  const paras = [];
  if (hasBlank) { let cur = []; for (const l of stepBlock) { if (l === '') { if (cur.length) paras.push(cur.join(' ')); cur = []; } else cur.push(l); } if (cur.length) paras.push(cur.join(' ')); }
  else for (const l of stepBlock) if (l) paras.push(l);
  out.steps = paras.map((p) => clean(p.replace(/^(?:step\s*)?\d{1,2}\s*[.):\-]\s*/i, '').replace(/^[-*•·–]\s*/, ''))).filter(Boolean).slice(0, 100);
  if (!out.title && out.ingredients.length === 0 && out.steps.length === 0) return null;
  if (!out.title) out.title = 'Pasted recipe';
  return out;
}

// What a site calls the category ("Main Course", "Side Dish", "Desserts", "Appetizers") -> one of our courses, or '' when it is not one of them.
const COURSE_RULES = [['dessert', /dessert|sweet|cake|cookie|brownie|pie\b|pastry|candy/], ['breakfast', /breakfast|brunch/], ['appetizer', /appetizer|starter|hors|finger food|\bdip\b/], ['soup', /\bsoup|stew|chowder|bisque/],
  ['salad', /salad/], ['side', /\bside/], ['drink', /drink|beverage|cocktail|smoothie|juice/], ['snack', /snack/], ['lunch', /lunch/], ['dinner', /dinner|supper/], ['main', /\bmain|entr[eé]e|casserole/]];
function courseOf(category) {
  const s = String(category == null ? '' : category).toLowerCase();
  for (const [course, re] of COURSE_RULES) if (re.test(s)) return course;
  return '';
}

// ── a web page's embedded recipe (schema.org JSON-LD) ───────────────────────────────────────────────────────
function findRecipeNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n, depth + 1); if (r) return r; } return null; }
  const types = listOf(node['@type']).map((t) => String(t).toLowerCase());
  if (types.includes('recipe')) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) { const r = findRecipeNode(node[key], depth + 1); if (r) return r; }
  return null;
}
function stepTexts(v, depth = 0) {
  const out = [];
  if (depth > 5 || v === null || v === undefined) return out;
  if (typeof v === 'string') { for (const part of stripTags(v).split(/\n+/)) { const t = clean(part); if (t) out.push(t); } return out; }
  if (Array.isArray(v)) { for (const x of v) out.push(...stepTexts(x, depth + 1)); return out; }
  if (typeof v === 'object') {
    const types = listOf(v['@type']).map((t) => String(t).toLowerCase());
    if (types.includes('howtosection') || v.itemListElement) return stepTexts(v.itemListElement, depth + 1);
    return stepTexts(v.text || v.name || '', depth + 1);
  }
  return out;
}
function imageOf(v, base) {
  const first = Array.isArray(v) ? v[0] : v;
  const u = first && typeof first === 'object' ? (first.url || first.contentUrl || '') : first;
  if (!u || typeof u !== 'string') return '';
  try { return new URL(u, base || undefined).href; } catch { return ''; }
}
function nameOf(v) { const f = Array.isArray(v) ? v[0] : v; return clean(f && typeof f === 'object' ? f.name : f); }

function extractRecipeFromHtml(html, pageUrl) {
  const blocks = [];
  const re = /<script[^>]+type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) blocks.push(m[1]);
  let node = null;
  for (const b of blocks) {
    let json = b.trim().replace(/^<!--/, '').replace(/-->$/, '').replace(/^\/\*<!\[CDATA\[\*\//, '').replace(/\/\*\]\]>\*\/$/, '');
    let data = null;
    try { data = JSON.parse(json); } catch { try { data = JSON.parse(json.replace(/,\s*([}\]])/g, '$1')); } catch { data = null; } }
    const found = data && findRecipeNode(data);
    if (found && (found.recipeIngredient || found.recipeInstructions || found.ingredients)) { node = found; break; }
  }
  if (!node) return null;
  let host = '';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { /* none */ }
  const prep = minutesOf(node.prepTime), cook = minutesOf(node.cookTime), total = minutesOf(node.totalTime);
  // Sites put dozens of keywords on a page ("easy banana bread recipe moist best ever"...). Keep a handful that read like tags: the category and cuisine first, then
  // short keywords; nothing long, wordy or link-like.
  const tags = [];
  let course = '';
  for (const cat of listOf(node.recipeCategory)) for (const part of String(cat == null ? '' : cat).split(',')) { const c = courseOf(clean(stripTags(part))); if (c && !course) course = c; }   // the first category that is a course
  for (const k of [node.recipeCategory, node.recipeCuisine, node.keywords]) for (const item of listOf(k)) for (const part of String(item == null ? '' : item).split(',')) {
    const s = clean(stripTags(part)).toLowerCase().replace(/^[#"'\s]+|[#"'.\s]+$/g, '');
    if (s && !(k === node.recipeCategory && courseOf(s))) tags.push(s);                       // a category that became the course is not repeated as a tag
  }
  const niceTags = [...new Set(tags)].filter((s) => s.length <= 24 && s.split(/\s+/).length <= 3 && !/https?:|www\.|@/.test(s)).slice(0, 5);
  const ingredients = listOf(node.recipeIngredient || node.ingredients).map((x) => clean(stripTags(x))).filter(Boolean).slice(0, 100);
  return {
    title: clean(stripTags(node.name)).slice(0, 120),
    description: clean(stripTags(node.description)).slice(0, 2000),
    servings: servingsOf(node.recipeYield),
    prep_min: prep, cook_min: cook || Math.max(0, total - prep),
    tags: niceTags, course,
    ingredients, steps: stepTexts(node.recipeInstructions).slice(0, 100),
    source_name: nameOf(node.publisher) || nameOf(node.author) || host, source_url: String(pageUrl || ''), origin: 'imported', image_url: imageOf(node.image, pageUrl),
  };
}

// ── fetching safely ─────────────────────────────────────────────────────────────────────────────────────────
function privateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb') || l.startsWith('fc') || l.startsWith('fd')) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l);
    if (mapped) return privateAddress(mapped[1]);
    return false;
  }
  return true;
}
// Throws an Error with .code 'BLOCKED' | 'BAD_URL' when the address may not be fetched.
async function assertPublicUrl(urlStr, allowPrivate) {
  let u;
  try { u = new URL(urlStr); } catch { const e = new Error('That is not a web address.'); e.code = 'BAD_URL'; throw e; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { const e = new Error('Only http and https addresses can be read.'); e.code = 'BAD_URL'; throw e; }
  if (u.username || u.password) { const e = new Error('That address has a login in it, which cannot be used.'); e.code = 'BAD_URL'; throw e; }
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) { const e = new Error('That address could not be found.'); e.code = 'UNREACHABLE'; throw e; }
  if (addrs.some(privateAddress)) { const e = new Error('That address is on your own network, which is not allowed here.'); e.code = 'BLOCKED'; throw e; }
  return u;
}

// opts: { maxBytes, timeoutMs, accept, allowPrivate, maxRedirects } -> { url, contentType, buffer }
async function safeGet(urlStr, opts = {}) {
  const maxBytes = opts.maxBytes || 3 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs || 12000;
  const maxRedirects = opts.maxRedirects === undefined ? 4 : opts.maxRedirects;
  const allowPrivate = opts.allowPrivate || process.env.PIAZZA_RECIPE_IMPORT_ALLOW_PRIVATE === '1';   // the env switch is for the test suite only
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = await assertPublicUrl(current, allowPrivate);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(u.href, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PiazzaHQ recipe import)', Accept: opts.accept || 'text/html,application/xhtml+xml,*/*;q=0.8' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { current = new URL(res.headers.get('location'), u.href).href; continue; }
      if (!res.ok) { const e = new Error(`The page answered with an error (${res.status}).`); e.code = 'HTTP'; throw e; }
      const chunks = []; let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } const e = new Error('That is too big to read.'); e.code = 'TOO_BIG'; throw e; }
        chunks.push(Buffer.from(value));
      }
      return { url: u.href, contentType: String(res.headers.get('content-type') || '').toLowerCase(), buffer: Buffer.concat(chunks) };
    } catch (e) {
      if (e && e.name === 'AbortError') { const err = new Error('The page took too long to answer.'); err.code = 'TIMEOUT'; throw err; }
      if (e && e.code) throw e;
      const err = new Error('The page could not be reached.'); err.code = 'UNREACHABLE'; throw err;
    } finally { clearTimeout(timer); }
  }
  const e = new Error('The page sent us around in circles (too many redirects).'); e.code = 'HTTP'; throw e;
}

// the kind of picture a buffer really is (not what a server claims)
function imageKind(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

module.exports = { courseOf, parseRecipeText, extractRecipeFromHtml, safeGet, assertPublicUrl, privateAddress, imageKind, minutesOf, servingsOf, decodeEntities };
