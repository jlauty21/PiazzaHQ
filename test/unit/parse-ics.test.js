'use strict';
// parseICS(icsText, feedId, feedColor, timeZone) — the feed-ingestion path.
// A synthetic fixture once hid a real parseICS bug (see HANDOFF.md), so:
//   - the cases below are the FORMATTING paths (all-day / multi-day / timed /
//     UTC vs floating / the self-pushed-UID dedup skip / cancellations),
//   - and every real .ics dropped in test/fixtures/ics/ is also run through
//     as a smoke check (parses, returns an array, no throw).
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, ok, report } = require('../lib/tap');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const s = evalInSandbox(
  ['decodeICSText', 'utcToLocalParts', 'parseICSDate', 'reconcileRecurrenceOverrides', 'parseICS']
    .map(n => extractFunction(SERVER, `function ${n}(`)),
  { getLocalTimezone: () => 'America/Chicago' },
  ['parseICS']
);
const TZ = 'America/Chicago';
const parse = (ics) => s.parseICS(ics, null, null, TZ);

const VEVENT = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

(async () => {
  await check('all-day single event', () => {
    const [e] = parse(VEVENT('UID:a1\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20260704\r\nDTEND;VALUE=DATE:20260705'));
    eq(e.date, '2026-07-04');
    eq(e.start_time, null);
    eq(e.end_date, '2026-07-04'); // DTEND is exclusive -> last day is the 4th
  });

  await check('all-day multi-day: end_date is the day before the exclusive DTEND', () => {
    const [e] = parse(VEVENT('UID:a2\r\nSUMMARY:Trip\r\nDTSTART;VALUE=DATE:20260704\r\nDTEND;VALUE=DATE:20260708'));
    eq(e.date, '2026-07-04');
    eq(e.end_date, '2026-07-07');
  });

  await check('timed event, floating local time taken as written', () => {
    const [e] = parse(VEVENT('UID:a3\r\nSUMMARY:Call\r\nDTSTART:20260704T143000\r\nDTEND:20260704T150000'));
    eq(e.date, '2026-07-04');
    eq(e.start_time, '14:30');
    eq(e.end_time, '15:00');
  });

  await check('timed event in UTC (trailing Z) is converted to the feed timezone', () => {
    // 2026-07-04 02:00Z is 2026-07-03 21:00 in America/Chicago (CDT, -5)
    const [e] = parse(VEVENT('UID:a4\r\nSUMMARY:Late\r\nDTSTART:20260704T020000Z'));
    eq(e.date, '2026-07-03');
    eq(e.start_time, '21:00');
  });

  await check('skips a VEVENT missing essentials (no UID / no SUMMARY)', () => {
    eq(parse(VEVENT('SUMMARY:No uid\r\nDTSTART;VALUE=DATE:20260704')).length, 0);
    eq(parse(VEVENT('UID:x\r\nDTSTART;VALUE=DATE:20260704')).length, 0);
  });

  await check('skips this app\'s own pushed-out events (dedup) by UID pattern', () => {
    eq(parse(VEVENT('UID:piazzahq-local-42@piazzahq.local\r\nSUMMARY:Mine\r\nDTSTART;VALUE=DATE:20260704')).length, 0);
    eq(parse(VEVENT('UID:phqlocal99@google.com\r\nSUMMARY:Mine\r\nDTSTART;VALUE=DATE:20260704')).length, 0);
    // but a normal google UID is kept
    eq(parse(VEVENT('UID:abc123@google.com\r\nSUMMARY:Theirs\r\nDTSTART;VALUE=DATE:20260704')).length, 1);
  });

  await check('drops a CANCELLED event', () => {
    eq(parse(VEVENT('UID:c1\r\nSUMMARY:Off\r\nDTSTART;VALUE=DATE:20260704\r\nSTATUS:CANCELLED')).length, 0);
  });

  await check('decodes escaped text in SUMMARY / DESCRIPTION', () => {
    const [e] = parse(VEVENT('UID:d1\r\nSUMMARY:Drinks\\, then dinner\r\nDESCRIPTION:line1\\nline2\r\nDTSTART;VALUE=DATE:20260704'));
    eq(e.title, 'Drinks, then dinner');
    eq(e.notes, 'line1 line2');
  });

  await check('unfolds RFC 5545 continuation lines before parsing', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:A very long title that spans\r\n  two folded lines\r\nDTSTART;VALUE=DATE:20260704\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    eq(parse(ics)[0].title, 'A very long title that spans two folded lines');
  });

  // Real fixtures — smoke only. Drop scrubbed .ics exports from real feeds
  // into test/fixtures/ics/ ; each must at least parse to an array.
  const fixtureDir = path.join(__dirname, '..', 'fixtures', 'ics');
  const fixtures = fs.existsSync(fixtureDir) ? fs.readdirSync(fixtureDir).filter(f => f.endsWith('.ics')) : [];
  for (const f of fixtures) {
    await check(`real fixture parses: ${f}`, () => {
      const out = parse(fs.readFileSync(path.join(fixtureDir, f), 'utf8'));
      ok(Array.isArray(out), 'returns an array');
      for (const e of out) ok(e.uid && e.title && e.date, `every returned event has uid+title+date (${f})`);
    });
  }
  if (!fixtures.length) console.log('  (no test/fixtures/ics/*.ics yet — add real feed exports to widen coverage)');

  report();
})();
