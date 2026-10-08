'use strict';
// Chore engine: which chores a kid has on a day (daily / weekly / once / take-turns), creating the day's rows, carry-over, the streak and the sticker balance.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/chores-core.test.js, test/api/chore-rotation.test.js and test/unit/chore-rotation.test.js.
module.exports = function registerChoreEngine({ db, localDateStr }) {
  // A chore DEFINITION recurs; we expand it into per-kid, per-date instances on demand.
  // Scheduling is intentionally simpler than full ICS: daily, weekly-by-weekday, or a
  // one-time date.
  function choreAppliesOn(chore, dateStr) {
    if (!chore.active) return false;
    const d = new Date(dateStr + 'T00:00:00');
    if (chore.freq === 'once') return (chore.on_date || '') === dateStr;
    if (chore.freq === 'daily') return true;
    if (chore.freq === 'weekly') {
      const codes = (chore.byday || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!codes.length) return true; // no specific days = every day
      const WD = ['SU','MO','TU','WE','TH','FR','SA'];
      return codes.includes(WD[d.getDay()]);
    }
    return false;
  }
  // Which kids a chore is for, on a given date. assignee is one of:
  //   'all'              -> every kid
  //   '3'                -> a single kid id (legacy/simple case)
  //   '3,5,7'            -> a specific subset of kids (comma-separated ids)
  function choreKidIds(chore, dateStr) {
    let ids;
    if (chore.assignee === 'all') {
      ids = db.prepare(`SELECT id FROM kids ORDER BY sort_order, id`).all().map(r => r.id);
    } else {
      ids = String(chore.assignee || '')
        .split(',').map(s => parseInt(s.trim())).filter(Number.isFinite);
    }
    // Take turns: just the one person whose turn it is on this date.
    if (chore.rotate && chore.freq !== 'once' && dateStr) {
      const kidsInOrder = db.prepare(`SELECT id FROM kids ORDER BY sort_order, id`).all().map(r => r.id);
      const cycle = kidsInOrder.filter(k => ids.includes(k));   // the cycle always runs in the kids' own order
      const one = choreRotationKidId(chore, dateStr, cycle);
      return one == null ? [] : [one];
    }
    return ids;
  }
  // How many days a chore applies on in [fromStr, toStr), negative if toStr is before fromStr. Whole weeks are counted by arithmetic so a
  // date years away costs the same as tomorrow.
  function choreApplicableDaysBefore(chore, fromStr, toStr) {
    if (fromStr === toStr) return 0;
    if (fromStr > toStr) return -choreApplicableDaysBefore(chore, toStr, fromStr);
    const utc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    const days = Math.round((utc(toStr) - utc(fromStr)) / 86400000);
    const codes = chore.freq === 'weekly' ? String(chore.byday || '').split(',').map(x => x.trim()).filter(Boolean) : [];
    if (!codes.length) return days;                        // every day (daily, or weekly with no days picked = every day)
    const WD = ['SU','MO','TU','WE','TH','FR','SA'];
    const weeks = Math.floor(days / 7);
    let count = weeks * codes.filter((c, i) => WD.includes(c) && codes.indexOf(c) === i).length;
    for (let i = 0; i < days % 7; i++) {
      if (codes.includes(WD[new Date(utc(fromStr) + (weeks * 7 + i) * 86400000).getUTCDay()])) count++;
    }
    return count;
  }
  // Which of the cycle's people (kid ids, in order) has a take-turns chore on dateStr: the start person on the anchor day, then the next
  // person for each day the chore applies on since. Worked out from the date alone, so a skipped day or a restart cannot shift it.
  function choreRotationKidId(chore, dateStr, kidIds) {
    const n = kidIds.length;
    if (!n) return null;
    let start = kidIds.indexOf(Number(chore.rotate_start));
    if (start < 0) start = 0;
    const k = choreApplicableDaysBefore(chore, chore.rotate_anchor || dateStr, dateStr);
    return kidIds[(((start + k) % n) + n) % n];
  }
  // Ensures instance rows exist for a given date across all active chores, so the
  // kid/parent/wall views all read consistent state. Also pulls forward unfinished
  // carryover chores from previous days (marked overdue).
  function materializeChoreInstances(dateStr) {
    const chores = db.prepare(`SELECT * FROM chores WHERE active = 1 AND bonus = 0`).all();
    const ins = db.prepare(`INSERT OR IGNORE INTO chore_instances (chore_id, kid_id, date, pay_amount) VALUES (?, ?, ?, ?)`);
    const movedAway = db.prepare(`SELECT 1 FROM chore_instances WHERE chore_id = ? AND reassigned_from = ? AND date = ?`);
    const tx = db.transaction(() => {
      for (const c of chores) {
        if (!choreAppliesOn(c, dateStr)) continue;
        for (const kidId of choreKidIds(c, dateStr)) {
          if (movedAway.get(c.id, kidId, dateStr)) continue; // swapped to someone else for this one day
          ins.run(c.id, kidId, dateStr, c.pay_amount || 0);
        }
      }
    });
    tx();
  }
  // Returns a kid's chores for a date: today's applicable ones plus any carryover
  // (unfinished, carryover=1, from an earlier date).
  function getKidChores(kidId, dateStr) {
    materializeChoreInstances(dateStr);
    const rows = db.prepare(`
    SELECT ci.id as instance_id, ci.date, ci.done, ci.completed_at, ci.pay_amount, ci.proof_photo,
           c.id as chore_id, c.title, c.icon, c.celebrate, c.carryover, c.at_time, c.notes, c.photo_required
    FROM chore_instances ci
    JOIN chores c ON c.id = ci.chore_id
    WHERE ci.kid_id = ?
      AND ( ci.date = ?
            OR (ci.done = 0 AND c.carryover = 1 AND ci.date < ?) )
    ORDER BY (ci.date < ?) DESC, c.at_time = '' ASC, c.at_time ASC, c.sort_order, c.id
  `).all(kidId, dateStr, dateStr, dateStr);
    return rows.map(r => ({ ...r, overdue: r.date < dateStr && !r.done }));
  }
  // Current streak = consecutive days (walking backward from today) where every chore
  // instance dated that day was completed. A day with zero instances (no chore applied,
  // or the app simply wasn't running that day to materialize them) is skipped rather
  // than breaking the streak — we only ever break on a day that demonstrably had
  // chores left undone. Stops at the kid's created_at date so a new kid never inherits
  // a phantom streak from before they existed.
  function getKidStreak(kidId, todayStr = localDateStr()) {
    const kid = db.prepare(`SELECT created_at FROM kids WHERE id = ?`).get(kidId);
    if (!kid) return 0;
    const earliest = (kid.created_at || '').slice(0, 10) || todayStr;
    const [y, m, d] = todayStr.split('-').map(Number);
    let cursor = new Date(y, m - 1, d);
    let streak = 0, isFirstDay = true;
    for (let i = 0; i < 3650; i++) {
      const ds = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      if (ds < earliest) break;
      const rows = db.prepare(`SELECT done FROM chore_instances WHERE kid_id = ? AND date = ?`).all(kidId, ds);
      if (rows.length) {
        const allDone = rows.every(r => r.done);
        if (allDone) streak++;
        else if (!isFirstDay) break; // today being incomplete doesn't break the streak yet
      }
      isFirstDay = false;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
  // Sticker balance = every sticker ever earned minus every star ever spent on a
  // reward redemption. Same append-only-ledger math as allowance's SUM(amount) —
  // no mutable running-total column anywhere, so it's always derivable and a
  // redemption undo (see DELETE /api/sticker-redemptions/:id) is exact.
  function getKidStickerBalance(kidId) {
    const earned = db.prepare(`SELECT COUNT(*) c FROM stickers WHERE kid_id = ?`).get(kidId).c;
    const spent = db.prepare(`SELECT COALESCE(SUM(star_cost),0) c FROM sticker_redemptions WHERE kid_id = ?`).get(kidId).c;
    return earned - spent;
  }
  return { materializeChoreInstances, getKidChores, getKidStreak, getKidStickerBalance };
};
