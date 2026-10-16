'use strict';
// A recipe as a PDF (plain helper, no dependencies): Letter pages, the built-in Helvetica fonts (so nothing is embedded and the file stays tiny), the title, times, ingredients
// (with their section titles), numbered steps and notes, wrapped to the page and carried onto more pages when long. Text is written in the Western European code page (WinAnsi), so
// accented letters, fractions and typographic quotes and dashes come out right; any other character becomes "?". It exists because a phone on the local network (http, no
// share sheet) and Safari's print command cannot be relied on: a PDF opens in the phone's own viewer, where Share and Print always work. Covered by test/unit/recipe-pdf.test.js.

// Advance widths (thousandths of an em) for the printable ASCII range 32..126, from the standard Helvetica and Helvetica-Bold metrics.
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Unicode characters outside Latin-1 that the WinAnsi code page has (0x80..0x9F), and a few look-alikes for characters it lacks.
const WIN = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
const LOOK = { '⁄': '/', '−': '-', '‐': '-', '‑': '-', '‒': '-', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '→': '->', '×': '×' };

// One character as a WinAnsi byte (or "?" when the code page has no such character), and how wide it is.
function code(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 32 && cp <= 126) return cp;
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  if (WIN[ch] !== undefined) return WIN[ch];
  return 63;
}
function clean(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s).replace(/\r\n?/g, '\n')) {
    if (ch === '\n' || ch === '\t') { out += ch === '\t' ? ' ' : ch; continue; }
    const cp = ch.codePointAt(0);
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) continue;
    out += LOOK[ch] !== undefined ? LOOK[ch] : ch;
  }
  return out;
}
function width(text, size, bold) {
  const t = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of text) {
    const c = code(ch);
    if (c >= 32 && c <= 126) w += t[c - 32];
    else if (c >= 0xc0 && c <= 0xff) { const base = ch.normalize('NFD')[0]; const bc = base ? base.codePointAt(0) : 0; w += bc >= 32 && bc <= 126 ? t[bc - 32] : 556; }
    else w += 556;
  }
  return (w * size) / 1000;
}
// A string literal for the content stream: parentheses and backslash escaped, bytes above 126 written as octal.
function lit(text) {
  let s = '';
  for (const ch of text) {
    const c = code(ch);
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c >= 32 && c <= 126) s += String.fromCharCode(c);
    else s += '\\' + c.toString(8).padStart(3, '0');
  }
  return '(' + s + ')';
}
// Words onto lines no wider than `max` points; a word wider than a line is cut.
function wrap(text, size, bold, max) {
  const out = [];
  for (const para of clean(text).split('\n')) {
    const words = para.split(/ +/).filter((w) => w !== '');
    if (!words.length) { out.push(''); continue; }
    let line = '';
    const flush = () => { if (line) out.push(line); line = ''; };
    for (let w of words) {
      while (width(w, size, bold) > max) {                       // a long word: cut it to fit
        let cut = w.length; while (cut > 1 && width(w.slice(0, cut), size, bold) > max) cut--;
        flush(); out.push(w.slice(0, cut)); w = w.slice(cut);
      }
      const tryLine = line ? line + ' ' + w : w;
      if (width(tryLine, size, bold) <= max) line = tryLine; else { flush(); line = w; }
    }
    flush();
  }
  return out;
}

// recipe: { title, description, facts: ['Serves 4', ...], ingredients: [{ group, text }], steps: [text], notes, source }
function buildRecipePdf(recipe) {
  const PW = 612, PH = 792, M = 54, TOP = PH - M, BOTTOM = M + 10, MAXW = PW - 2 * M;
  const pages = [[]];
  let y = TOP;
  const put = (text, x, size, bold) => { pages[pages.length - 1].push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${lit(text)} Tj ET`); };
  const need = (h) => { if (y - h < BOTTOM) { pages.push([]); y = TOP; } };
  const gap = (n) => { y -= n; };
  // a block of wrapped lines, each line kept with the page it starts on; hang = extra left margin for continuation lines
  function block(text, size, { bold = false, indent = 0, hang = 0, lead = 1.3, first = '' } = {}) {
    const max = MAXW - indent - hang;
    const lines = wrap(text, size, bold, max);
    lines.forEach((ln, i) => {
      need(size * lead);
      y -= size * lead;
      if (i === 0 && first) put(first, M + indent, size, bold);
      put(ln, M + indent + hang, size, bold);
    });
  }
  const r = recipe || {};
  block(String(r.title || 'Recipe'), 22, { bold: true, lead: 1.2 });
  gap(4);
  if (r.facts && r.facts.length) { block(r.facts.join('     '), 10.5, { lead: 1.4 }); gap(2); }
  if (r.description) { gap(4); block(r.description, 11, { lead: 1.4 }); }
  if (r.ingredients && r.ingredients.length) {
    gap(14); need(40); block('INGREDIENTS', 10, { bold: true });
    gap(2);
    for (const i of r.ingredients) {
      if (i.group) { gap(5); block(i.group, 11, { bold: true }); gap(1); }
      else block(i.text, 11, { indent: 4, hang: 12, first: '•' });
    }
  }
  if (r.steps && r.steps.length) {
    gap(14); need(40); block('STEPS', 10, { bold: true });
    gap(2);
    r.steps.forEach((s, n) => { gap(3); block(s, 11, { hang: 22, first: (n + 1) + '.', lead: 1.35 }); });
  }
  if (r.notes) { gap(14); need(40); block('NOTES', 10, { bold: true }); gap(2); block(r.notes, 10.5, { lead: 1.4 }); }
  if (r.source) { gap(12); block(r.source, 9, { lead: 1.4 }); }

  // ── the file: objects 1 catalog, 2 pages, 3 and 4 the fonts, then a content stream and a page for each page ──
  const objs = [];
  const total = pages.length;
  const kids = pages.map((_, i) => `${5 + i * 2 + 1} 0 R`).join(' ');
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${total} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((ops, i) => {
    const footer = `BT /F1 8.5 Tf ${(PW / 2 - 40).toFixed(2)} 30 Td ${lit(total > 1 ? `Page ${i + 1} of ${total}` : 'Piazza HQ')} Tj ET`;
    const stream = ops.concat(footer).join('\n');
    objs[5 + i * 2] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    objs[6 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let n = 1; n < objs.length; n++) { offsets[n] = Buffer.byteLength(out, 'latin1'); out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info << /Title ${lit(String(r.title || 'Recipe').slice(0, 120))} /Producer (Piazza HQ) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { buildRecipePdf, wrap, width };
