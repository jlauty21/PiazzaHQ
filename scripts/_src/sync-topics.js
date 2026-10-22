'use strict';
// Which parts of the display's data changed in a sync from the host. After every sync a mirror used to announce settings, events, reminders, photos, layout and cameras to its display,
// whether or not any of them had changed, and the display re-draws every widget on each one. A host sends a new version whenever anything in the household changes (every stroke
// on a whiteboard, for one), so a mirror showing a whiteboard re-drew its whole screen, and every picture on it flashed, with each stroke. Now only the parts whose data really
// differs from the last sync are announced (all of them on the first sync after a start, as before). A sync that changes nothing a display shows announces nothing.
// Covered by test/unit/sync-topics.test.js.
module.exports = function createSyncTopics({ crypto }) {
  const last = {};
  function groups(snap) {
    const t = (snap && snap.tables) || {};
    return {
      settings: [snap && snap.settings, snap && snap.photoSettings],
      events: [t.events, t.ical_feeds, t.ical_events, t.hidden_events],
      reminders: [t.reminders],
      photos: [t.photos],
      layout: [t.layouts, t.displays, t.saved_layouts],
      cameras: [t.cameras],
      boards: [t.whiteboards, t.stamps],                // a drawing on a whiteboard changed: the boards fetch what is new, nothing else is redrawn
      drawings: [t.kid_drawings, t.kid_draw_prefs],     // a kid's drawing was sent, picked or pinned: the Kids' Drawing widget looks again
    };
  }
  // the topics to announce for this snapshot, remembering what it looked like
  function changedTopics(snap) {
    const out = [];
    for (const [topic, parts] of Object.entries(groups(snap))) {
      const sig = crypto.createHash('md5').update(JSON.stringify(parts)).digest('hex');
      if (last[topic] !== sig) { last[topic] = sig; out.push(topic); }
    }
    return out;
  }
  return { changedTopics };
};
