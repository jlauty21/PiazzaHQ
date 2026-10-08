'use strict';
// Reminder recurrence engine: does a reminder fall on a given date (weekly / interval / monthly / yearly, with end conditions)? Pure date logic, used by the daily briefing.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/unit/reminder-recurrence.test.js.
module.exports = function registerReminderRecurrence({}) {
  // Modeled on iOS Calendar's custom-recurrence picker (Repeat → Custom),
  // added on top of the original two-pattern system (weekly / interval) to
  // also support monthly, yearly, and a universal end condition. Every new
  // field is additive and optional — a reminder saved before this existed has
  // none of them, and every branch below treats their absence as "no
  // constraint," so old reminders keep behaving exactly as they always did.
  //
  // schedule_type: 'weekly' | 'interval' (daily) | 'monthly' | 'yearly'
  // schedule_config, universal fields (all types):
  //   startDate: 'YYYY-MM-DD' — anchor for interval counting and end conditions.
  //     Always required going forward for anything besides plain weekly, but
  //     optional/ignored for weekly's own day-of-week check (backward compat).
  //   endType: 'never' (default) | 'onDate' | 'afterCount'
  //   endDate: 'YYYY-MM-DD' — used when endType='onDate'
  //   endCount: integer — used when endType='afterCount', counts pattern
  //     matches from startDate up to and including the date being checked
  // schedule_config, per schedule_type:
  //   weekly:   daysOfWeek:[0-6,...], weekInterval:N (default 1, "every N weeks")
  //   interval: intervalDays:N ("every N days" — the original/only pattern
  //             this type ever had; kept under this name for backward compat
  //             rather than renamed to something like 'daily')
  //   monthly:  monthlyMode:'dayOfMonth'|'nthWeekday', monthInterval:N (default 1),
  //             dayOfMonth:1-31 (dayOfMonth mode), nthWeek:1-4|-1 + nthWeekday:0-6
  //             (nthWeekday mode, -1 = "last")
  //   yearly:   yearlyMonth:1-12, yearInterval:N (default 1),
  //             yearlyMode:'date'|'nthWeekday', yearlyDay:1-31 (date mode),
  //             yearlyNthWeek:1-4|-1 + yearlyNthWeekday:0-6 (nthWeekday mode)
  //
  // A day-by-day scan is used for 'afterCount' rather than a closed-form
  // occurrence-number formula — reminders are a small, low-frequency dataset
  // (this runs against a handful of rows, not thousands), and a bounded scan
  // is far less error-prone to get right across four different recurrence
  // shapes than four separate closed-form counting formulas would be. Capped
  // at 10 years so a malformed/missing startDate can't scan effectively
  // forever.
  const REMINDER_COUNT_SCAN_CAP_DAYS = 3650;

  function reminderDaysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function reminderStartOfWeek(d) { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
  // nth: 1-4 for 1st-4th occurrence of that weekday in the month, -1 for the
  // last. Returns null if that occurrence doesn't exist (e.g. a 5th Monday in
  // a month that only has 4) — the caller treats null as "no match," not an
  // error, since this can legitimately happen for `nth` in 1-4 depending on
  // how the month falls.
  function reminderNthWeekdayOfMonth(year, month0, weekday, nth) {
    if (nth === -1) {
      const last = new Date(year, month0 + 1, 0);
      const offset = (last.getDay() - weekday + 7) % 7;
      return new Date(year, month0, last.getDate() - offset);
    }
    const first = new Date(year, month0, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    const day = 1 + offset + (nth - 1) * 7;
    const d = new Date(year, month0, day);
    return d.getMonth() === month0 ? d : null;
  }
  // Whether the recurrence PATTERN itself lands on this date — ignores the end
  // condition entirely (reminderOccursOnDateServer, below, layers that on top).
  // Kept as its own function because 'afterCount' needs to re-run this in a
  // scan without recursively re-checking the end condition on every step.
  function reminderMatchesPatternServer(reminder, d) {
    const cfg = reminder.schedule_config || {};
    const type = reminder.schedule_type;
    if (type === 'weekly') {
      if (!Array.isArray(cfg.daysOfWeek) || !cfg.daysOfWeek.includes(d.getDay())) return false;
      if (cfg.startDate) {
        const start = new Date(cfg.startDate + 'T00:00:00');
        if (d < start) return false;
        const interval = cfg.weekInterval || 1;
        if (interval > 1) {
          const weeks = reminderDaysBetween(reminderStartOfWeek(start), reminderStartOfWeek(d)) / 7;
          if (weeks % interval !== 0) return false;
        }
      }
      return true;
    }
    if (type === 'interval') {
      if (!cfg.startDate || !cfg.intervalDays) return false;
      const start = new Date(cfg.startDate + 'T00:00:00');
      const diff = reminderDaysBetween(start, d);
      return diff >= 0 && diff % cfg.intervalDays === 0;
    }
    if (type === 'monthly') {
      if (!cfg.startDate) return false;
      const start = new Date(cfg.startDate + 'T00:00:00');
      if (d < start) return false;
      const interval = cfg.monthInterval || 1;
      if (interval > 1) {
        const monthsDiff = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
        if (monthsDiff % interval !== 0) return false;
      }
      if (cfg.monthlyMode === 'nthWeekday') {
        const target = reminderNthWeekdayOfMonth(d.getFullYear(), d.getMonth(), cfg.nthWeekday, cfg.nthWeek);
        return !!target && target.getDate() === d.getDate();
      }
      return d.getDate() === cfg.dayOfMonth; // naturally skips months without that day (e.g. 31st in Feb)
    }
    if (type === 'yearly') {
      if (!cfg.startDate) return false;
      const start = new Date(cfg.startDate + 'T00:00:00');
      if (d < start) return false;
      if (d.getMonth() + 1 !== cfg.yearlyMonth) return false;
      const interval = cfg.yearInterval || 1;
      if (interval > 1) {
        const yearsDiff = d.getFullYear() - start.getFullYear();
        if (yearsDiff % interval !== 0) return false;
      }
      if (cfg.yearlyMode === 'nthWeekday') {
        const target = reminderNthWeekdayOfMonth(d.getFullYear(), d.getMonth(), cfg.yearlyNthWeekday, cfg.yearlyNthWeek);
        return !!target && target.getDate() === d.getDate();
      }
      return d.getDate() === cfg.yearlyDay;
    }
    return false;
  }
  function reminderOccursOnDateServer(reminder, dateStr) {
    const cfg = reminder.schedule_config || {};
    const d = new Date(dateStr + 'T00:00:00');
    if (!reminderMatchesPatternServer(reminder, d)) return false;
    const endType = cfg.endType || 'never';
    if (endType === 'onDate') {
      return !cfg.endDate || dateStr <= cfg.endDate;
    }
    if (endType === 'afterCount') {
      if (!cfg.endCount || !cfg.startDate) return true;
      const start = new Date(cfg.startDate + 'T00:00:00');
      let count = 0;
      for (let i = 0; i <= REMINDER_COUNT_SCAN_CAP_DAYS; i++) {
        const cur = new Date(start);
        cur.setDate(cur.getDate() + i);
        if (cur > d) break;
        if (reminderMatchesPatternServer(reminder, cur)) count++;
      }
      return count <= cfg.endCount;
    }
    return true;
  }
  return { reminderOccursOnDateServer };
};
