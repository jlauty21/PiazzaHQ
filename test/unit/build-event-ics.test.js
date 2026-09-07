'use strict';
// The CalDAV-push side: turning an `events` row into a VCALENDAR body.
//  - escapeICSText / foldICSLine: RFC 5545 text encoding + line folding.
//  - buildEventICS: all-day vs timed vs multi-day date formatting, and the
//    self-identifying UID that is BOTH the dedup key (parseICS skips it on
//    the way back in) and what makes an edit a re-PUT to the same object.
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('../lib/extract');
const { evalInSandbox } = require('../lib/sandbox');
const { check, eq, ok, report } = require('../lib/tap');

const SERVER = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const s = evalInSandbox(
  ['escapeICSText', 'foldICSLine', 'icsStamp', 'caldavUidFor', 'buildEventICS']
    .map(n => extractFunction(SERVER, `function ${n}(`)),
  { Buffer },
  ['escapeICSText', 'foldICSLine', 'buildEventICS', 'caldavUidFor']
);

const lines = (ics) => ics.split('\r\n');
const has = (ics, line) => lines(ics).includes(line);

(async () => {
  await check('escapeICSText escapes backslash first, then ; , and newline', () => {
    eq(s.escapeICSText('a;b,c'), 'a\\;b\\,c');
    eq(s.escapeICSText('line1\nline2'), 'line1\\nline2');
    eq(s.escapeICSText('back\\slash'), 'back\\\\slash');
    // backslash must be doubled BEFORE the others get their escaping backslash
    eq(s.escapeICSText(';'), '\\;');
    eq(s.escapeICSText('\\;'), '\\\\\\;');
  });

  await check('escapeICSText coerces null/undefined to empty', () => {
    eq(s.escapeICSText(null), '');
    eq(s.escapeICSText(undefined), '');
  });

  await check('foldICSLine leaves a short line untouched', () => {
    eq(s.foldICSLine('SUMMARY:short'), 'SUMMARY:short');
  });

  await check('foldICSLine folds a long line with a leading space on continuations', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(200);
    const folded = s.foldICSLine(long);
    const parts = folded.split('\r\n');
    ok(parts.length > 1, 'should have folded into multiple lines');
    ok(Buffer.from(parts[0], 'utf8').length <= 74, 'first line <= 74 octets');
    for (let i = 1; i < parts.length; i++) {
      ok(parts[i].startsWith(' '), 'continuation lines start with a space');
      ok(Buffer.from(parts[i], 'utf8').length <= 74, 'continuation <= 74 octets');
    }
    eq(parts.map(p => (p.startsWith(' ') ? p.slice(1) : p)).join(''), long);
  });

  await check('foldICSLine does not split a multi-byte UTF-8 character', () => {
    const folded = s.foldICSLine('X:' + 'é'.repeat(60)); // é = 2 bytes each
    for (const part of folded.split('\r\n')) {
      // each unfolded chunk must still be valid UTF-8 round-tripping to é's
      const body = part.startsWith(' ') ? part.slice(1) : part;
      ok(!body.includes('�'), 'no replacement char — sequence was not split mid-character');
    }
  });

  await check('buildEventICS UID is the self-identifying dedup key', () => {
    eq(s.caldavUidFor(42), 'piazzahq-local-42@piazzahq.local');
    ok(has(s.buildEventICS({ id: 42, title: 'X', date: '2026-09-06' }), 'UID:piazzahq-local-42@piazzahq.local'));
  });

  await check('all-day event: DATE-valued DTSTART and an EXCLUSIVE DTEND (next day)', () => {
    const ics = s.buildEventICS({ id: 1, title: 'Trip', date: '2026-09-06' });
    ok(has(ics, 'DTSTART;VALUE=DATE:20260906'), 'DTSTART is the date, no time');
    ok(has(ics, 'DTEND;VALUE=DATE:20260907'), 'DTEND is one day past (exclusive)');
  });

  await check('multi-day all-day: DTEND is the day after end_date', () => {
    const ics = s.buildEventICS({ id: 2, title: 'Vacation', date: '2026-09-06', end_date: '2026-09-10' });
    ok(has(ics, 'DTSTART;VALUE=DATE:20260906'));
    ok(has(ics, 'DTEND;VALUE=DATE:20260911'));
  });

  await check('timed event: floating local DTSTART/DTEND, no Z, no TZID', () => {
    const ics = s.buildEventICS({ id: 3, title: 'Call', date: '2026-09-06', start_time: '14:30', end_time: '15:00' });
    ok(has(ics, 'DTSTART:20260906T143000'));
    ok(has(ics, 'DTEND:20260906T150000'));
    ok(!/DTSTART:[^\r\n]*Z/.test(ics), 'no trailing Z');
    ok(!/TZID/.test(ics), 'no TZID param');
  });

  await check('timed event with no end_time omits DTEND', () => {
    const ics = s.buildEventICS({ id: 4, title: 'Reminder', date: '2026-09-06', start_time: '09:00' });
    ok(has(ics, 'DTSTART:20260906T090000'));
    ok(!/\r\nDTEND/.test(ics), 'no DTEND line');
  });

  await check('SUMMARY is escaped; DESCRIPTION only present when notes exist', () => {
    const withNotes = s.buildEventICS({ id: 5, title: 'a;b', date: '2026-09-06', notes: 'c,d' });
    ok(has(withNotes, 'SUMMARY:a\\;b'));
    ok(withNotes.includes('DESCRIPTION:c\\,d'));
    const noNotes = s.buildEventICS({ id: 6, title: 'x', date: '2026-09-06' });
    ok(!noNotes.includes('DESCRIPTION:'), 'no empty DESCRIPTION line');
  });

  await check('output is CRLF-delimited and ends with CRLF', () => {
    const ics = s.buildEventICS({ id: 7, title: 'x', date: '2026-09-06' });
    ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    ok(ics.endsWith('END:VCALENDAR\r\n'));
    ok(!/\n[^\r]/.test(ics.replace(/\r\n/g, '')), 'no lone LF');
  });

  report();
})();
