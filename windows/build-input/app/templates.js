// ── Display Templates ─────────────────────────────────────────────────────────
// Each template is a ready-made starting point a user can apply (it creates a NEW
// display so the original is never touched), then freely customize afterward.
//
// A template defines:
//   id            unique key, also used as the display's `theme` (drives the
//                 generated background + decorations on the display side)
//   name          shown in the app
//   blurb         one-line description
//   accent        primary accent color (used by the themed background + UI hints)
//   accent2       secondary accent
//   textColor     widget text color that reads well on this theme's background
//   calDecor      calendar decoration style applied to calendar widgets:
//                   'none'     normal dots/pills
//                   'postit'   each day with events drawn as a sticky note
//                   'icon:X'   event days marked with a themed icon (egg, pumpkin,
//                              ornament, star, etc.) where X names the icon set
//   landscape/portrait   widget arrays (same shape as a saved layout)
//
// Backgrounds themselves are generated on the display (CSS/SVG scenes keyed off
// the theme id) — no image files, so nothing to license or ship.

// Helper: a calendar widget carrying a decoration style.
function cal(extra = {}) {
  return Object.assign({ type: 'minical', calView: 'month' }, extra);
}

const TEMPLATES = [
  // ── 1. Fourth of July ──────────────────────────────────────────────────────
  {
    id: 'july4', category: 'Holidays',
    name: 'Fourth of July',
    blurb: 'Fireworks over a night sky, red-white-and-blue accents, star-marked event days.',
    accent: '#e63946', accent2: '#3a6ea5', textColor: '#f5f7ff',
    calDecor: 'icon:star',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:40, h:12 },
      { type:'date',    x:2,  y:16, w:40, h:6  },
      { type:'weather', x:62, y:3,  w:36, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:9  },
      { type:'date',    x:4,  y:12, w:92, h:5  },
      { type:'weather', x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── 2. New Year's ──────────────────────────────────────────────────────────
  {
    id: 'newyear', category: 'Holidays',
    name: "New Year's",
    blurb: 'Midnight sparkle and gold confetti with an oversized countdown-style clock.',
    accent: '#d4af37', accent2: '#c0c0c0', textColor: '#fff8e7',
    calDecor: 'icon:sparkle',
    landscape: [
      { type:'clock',   x:6,  y:8,  w:88, h:26, clockFontPx:200 },
      { type:'date',    x:6,  y:36, w:88, h:8  },
      { type:'weather', x:6,  y:48, w:40, h:16 },
      cal({ x:50, y:48, w:48, h:48, calLayout:'agenda' }),
    ],
    portrait: [
      { type:'clock',   x:4,  y:6,  w:92, h:16, clockFontPx:140 },
      { type:'date',    x:4,  y:24, w:92, h:6  },
      { type:'weather', x:4,  y:32, w:92, h:12 },
      cal({ x:4, y:46, w:92, h:50, calLayout:'agenda' }),
    ],
  },

  // ── 3. Christmas ───────────────────────────────────────────────────────────
  {
    id: 'christmas', category: 'Holidays',
    name: 'Christmas',
    blurb: 'Falling snow over deep green and red, with ornament-marked event days.',
    accent: '#c1121f', accent2: '#2d6a4f', textColor: '#f6fff8',
    calDecor: 'icon:ornament',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:38, h:12 },
      { type:'date',    x:2,  y:16, w:38, h:6  },
      { type:'weather', x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',    x:4,  y:2,  w:92, h:9  },
      { type:'date',     x:4,  y:12, w:92, h:5  },
      { type:'weather',  x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4,  y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── Minimalist Family Calendar ───────────────────────────────────────────────
  // Flagship "clean" template: soft sage botanical background, an elegant script
  // family-name banner, dark text, and a roomy uncluttered month calendar.
  {
    id: 'minimalfam', category: 'General',
    name: 'Minimalist Family',
    blurb: 'A calm sage-and-white family calendar with an elegant script name banner.',
    accent: '#7c8a72', accent2: '#a9b8a0', textColor: '#3a4238',
    calDecor: 'none',
    landscape: [
      // Script family name across the top — edit the text to your family's name.
      { type:'text', x:24, y:3, w:52, h:12, textContent:'The Family',
        textFontFamily:'Great Vibes', textFontPx:64, textAlign:'center', textPreset:'plain' },
      { type:'clock',   x:3,  y:4,  w:20, h:8 },
      { type:'date',    x:3,  y:13, w:28, h:5 },
      { type:'weather', x:78, y:3,  w:20, h:14 },
      cal({ x:3, y:20, w:94, h:77, calWrap:'clamp2', calMaxLines:4 }),
    ],
    portrait: [
      { type:'text', x:4, y:2, w:92, h:10, textContent:'The Family',
        textFontFamily:'Great Vibes', textFontPx:52, textAlign:'center', textPreset:'plain' },
      { type:'clock',   x:4,  y:13, w:44, h:8 },
      { type:'date',    x:4,  y:22, w:60, h:5 },
      { type:'weather', x:4,  y:29, w:92, h:11 },
      cal({ x:2, y:42, w:96, h:56, calWrap:'clamp2', calMaxLines:4 }),
    ],
  },

  // ── Chalkboard ───────────────────────────────────────────────────────────────
  // Slate background with chalk-style handwritten white text and a hand-drawn month
  // calendar. Today gets a chalk-circle highlight (handled on the display side).
  {
    id: 'chalkboard', category: 'General',
    name: 'Chalkboard',
    blurb: 'A slate chalkboard with handwritten chalk text and a hand-drawn calendar.',
    accent: '#f4f1de', accent2: '#e07a5f', textColor: '#f4f1de',
    calDecor: 'none',
    landscape: [
      { type:'text', x:3, y:3, w:50, h:12, textContent:'Our Family',
        textFontFamily:'Caveat', textFontPx:60, textAlign:'left', textPreset:'plain' },
      { type:'weather', x:74, y:3, w:24, h:14 },
      { type:'date',    x:3, y:15, w:40, h:6 },
      cal({ x:3, y:22, w:94, h:75, calWrap:'clamp2', calMaxLines:4 }),
    ],
    portrait: [
      { type:'text', x:4, y:2, w:92, h:10, textContent:'Our Family',
        textFontFamily:'Caveat', textFontPx:52, textAlign:'center', textPreset:'plain' },
      { type:'date',    x:4, y:13, w:60, h:5 },
      { type:'weather', x:4, y:20, w:92, h:11 },
      cal({ x:2, y:33, w:96, h:65, calWrap:'clamp2', calMaxLines:4 }),
    ],
  },

  // ── Cork Board ───────────────────────────────────────────────────────────────
  // A realistic pinboard: cork-textured background with each widget rendered as a
  // piece of pinned paper (sticky notes / torn notebook paper) with a pushpin. The
  // per-person chore chart from the reference is a separate future widget (archived).
  {
    id: 'corkboard', category: 'General',
    name: 'Cork Board',
    blurb: 'A cork pinboard where each widget is a pinned note or torn paper with a pushpin.',
    accent: '#c19a6b', accent2: '#d9534f', textColor: '#3a2f25',
    calDecor: 'none',
    landscape: [
      { type:'date',    x:3,  y:4,  w:26, h:10 },
      { type:'weather', x:33, y:4,  w:24, h:14 },
      { type:'text', x:60, y:4, w:36, h:12, textContent:'Everything would be better if more people were like you!',
        textFontFamily:'Caveat', textFontPx:30, textAlign:'left', textPreset:'plain' },
      cal({ x:3, y:22, w:60, h:75, calWrap:'clamp2', calMaxLines:4 }),
      { type:'upcoming', x:66, y:22, w:31, h:75, upShowTime:true },
    ],
    portrait: [
      { type:'date',    x:4,  y:3,  w:44, h:7 },
      { type:'weather', x:52, y:3,  w:44, h:12 },
      cal({ x:3, y:17, w:94, h:55, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:3, y:74, w:94, h:24, upShowTime:true },
    ],
  },

  // ── 4. Post-it Notes ───────────────────────────────────────────────────────
  {
    id: 'postit', category: 'General',
    name: 'Post-it Notes',
    blurb: 'A corkboard calendar where every day with plans becomes a sticky note.',
    accent: '#f4a259', accent2: '#8cb369', textColor: '#2b2b2b',
    calDecor: 'postit',
    landscape: [
      { type:'date',    x:2,  y:2,  w:50, h:8 },
      { type:'weather', x:64, y:2,  w:34, h:14 },
      cal({ x:2, y:14, w:96, h:84 }),
    ],
    portrait: [
      { type:'date',    x:4,  y:2,  w:92, h:6 },
      { type:'weather', x:4,  y:10, w:92, h:12 },
      cal({ x:2, y:24, w:96, h:74 }),
    ],
  },

  // ── 5. Easter ──────────────────────────────────────────────────────────────
  {
    id: 'easter', category: 'Holidays',
    name: 'Easter',
    blurb: 'Soft pastels and a spring sky, with decorated eggs on event days.',
    accent: '#b5838d', accent2: '#83c5be', textColor: '#3d3a4b',
    calDecor: 'icon:egg',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:36, h:11 },
      { type:'date',    x:2,  y:15, w:36, h:6  },
      { type:'weather', x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:25, w:70, h:71, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:25, w:24, h:71, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:8  },
      { type:'date',    x:4,  y:11, w:92, h:5  },
      { type:'weather', x:4,  y:18, w:92, h:12 },
      cal({ x:2, y:32, w:96, h:43, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── 6. Halloween (my addition) ───────────────────────────────────────────────
  {
    id: 'halloween', category: 'Holidays',
    name: 'Halloween',
    blurb: 'A spooky purple night with drifting bats and pumpkin-marked event days.',
    accent: '#ff7518', accent2: '#7b2cbf', textColor: '#f3e8ff',
    calDecor: 'icon:pumpkin',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:38, h:12 },
      { type:'date',    x:2,  y:16, w:38, h:6  },
      { type:'weather', x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:9  },
      { type:'date',    x:4,  y:12, w:92, h:5  },
      { type:'weather', x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── 7. Autumn / Thanksgiving (my addition) ────────────────────────────────────
  {
    id: 'autumn', category: 'Seasons',
    name: 'Autumn Harvest',
    blurb: 'Warm amber tones with falling leaves — cozy for fall and Thanksgiving.',
    accent: '#bc6c25', accent2: '#606c38', textColor: '#fefae0',
    calDecor: 'icon:leaf',
    landscape: [
      { type:'clock',    x:2,  y:3,  w:38, h:12 },
      { type:'date',     x:2,  y:16, w:38, h:6  },
      { type:'weather',  x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',    x:4,  y:2,  w:92, h:9  },
      { type:'date',     x:4,  y:12, w:92, h:5  },
      { type:'weather',  x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── 8. Birthday (my addition) ─────────────────────────────────────────────────
  {
    id: 'birthday', category: 'Celebrations',
    name: 'Birthday',
    blurb: 'Balloons and confetti for a festive family display.',
    accent: '#ff5d8f', accent2: '#4cc9f0', textColor: '#fff',
    calDecor: 'icon:balloon',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:40, h:12 },
      { type:'date',    x:2,  y:16, w:40, h:6  },
      { type:'weather', x:62, y:3,  w:36, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:9  },
      { type:'date',    x:4,  y:12, w:92, h:5  },
      { type:'weather', x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── Valentine's ──────────────────────────────────────────────────────────────
  {
    id: 'valentine', category: 'Holidays',
    name: "Valentine's",
    blurb: 'Warm reds and pinks with floating hearts on event days.',
    accent: '#e63950', accent2: '#ff8fab', textColor: '#fff0f3',
    calDecor: 'icon:heart',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:38, h:12 },
      { type:'date',    x:2,  y:16, w:38, h:6  },
      { type:'weather', x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:9  },
      { type:'date',    x:4,  y:12, w:92, h:5  },
      { type:'weather', x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── Spring / Garden ──────────────────────────────────────────────────────────
  {
    id: 'spring', category: 'Seasons',
    name: 'Spring Garden',
    blurb: 'Fresh greens and soft blossoms with flowers on event days.',
    accent: '#52b788', accent2: '#f4a6c0', textColor: '#1b3a2b',
    calDecor: 'icon:flower',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:36, h:11 },
      { type:'date',    x:2,  y:15, w:36, h:6  },
      { type:'weather', x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:25, w:70, h:71, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:25, w:24, h:71, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:8  },
      { type:'date',    x:4,  y:11, w:92, h:5  },
      { type:'weather', x:4,  y:18, w:92, h:12 },
      cal({ x:2, y:32, w:96, h:43, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── Summer / Beach ───────────────────────────────────────────────────────────
  {
    id: 'summer', category: 'Seasons',
    name: 'Summer Days',
    blurb: 'Bright ocean blues and sunshine for a cheerful summer display.',
    accent: '#0077b6', accent2: '#ffb703', textColor: '#f0fbff',
    calDecor: 'icon:sun',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:38, h:12 },
      { type:'date',    x:2,  y:16, w:38, h:6  },
      { type:'weather', x:64, y:3,  w:34, h:16 },
      cal({ x:2, y:26, w:70, h:70, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:74, y:26, w:24, h:70, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:9  },
      { type:'date',    x:4,  y:12, w:92, h:5  },
      { type:'weather', x:4,  y:19, w:92, h:12 },
      cal({ x:2, y:33, w:96, h:42, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:4, y:77, w:92, h:21, upShowTime:true },
    ],
  },

  // ── Modern Dark ──────────────────────────────────────────────────────────────
  // Sleek high-contrast everyday theme (Home Hub reference). Pairs an agenda with a
  // calendar and leaves room for a chore chart — a great family-hub starting point.
  {
    id: 'moderndark', category: 'General',
    name: 'Modern Dark',
    blurb: 'A sleek dark dashboard with bold accents — great for a family hub.',
    accent: '#7c5cff', accent2: '#22d3ee', textColor: '#f5f7fb',
    calDecor: 'none',
    landscape: [
      { type:'clock',    x:2,  y:3,  w:30, h:12 },
      { type:'date',     x:2,  y:16, w:30, h:5  },
      { type:'weather',  x:2,  y:23, w:30, h:14 },
      { type:'agenda',   x:34, y:3,  w:30, h:94, agDays:7 },
      cal({ x:66, y:3, w:32, h:60, calView:'month', calWrap:'clamp2' }),
      { type:'upcoming', x:66, y:65, w:32, h:32, upShowTime:true },
    ],
    portrait: [
      { type:'clock',    x:4,  y:2,  w:50, h:8  },
      { type:'date',     x:4,  y:11, w:60, h:4  },
      { type:'weather',  x:4,  y:17, w:92, h:11 },
      cal({ x:2, y:30, w:96, h:42, calView:'month', calWrap:'clamp2' }),
      { type:'agenda',   x:4,  y:74, w:92, h:24, agDays:5 },
    ],
  },

  // ── Home Hub ─────────────────────────────────────────────────────────────────
  // The family command-center layout (reference Image 3): a weather + time strip
  // across the top, "This Week's Plans" + a to-do list side by side, and the
  // CHORE CHART as the centerpiece filling the lower half. Showcases both the
  // chore feature and the built-in to-do list.
  {
    id: 'homehub', category: 'General',
    name: 'Home Hub',
    blurb: 'A family command center: weather, this week\'s plans, a to-do list, and the chore chart front and center.',
    accent: '#7c5cff', accent2: '#22d3ee', textColor: '#f5f7fb',
    calDecor: 'none',
    landscape: [
      // Top strip: time + weather on the left, upcoming "plans" and a to-do
      // list split evenly across the right.
      { type:'clock',    x:2,  y:3,  w:20, h:10 },
      { type:'weather',  x:2,  y:14, w:30, h:18, wxForecastDays:4 },
      { type:'upcoming', x:34, y:3,  w:31, h:29, upShowTime:true },
      { type:'todo',     x:67, y:3,  w:31, h:29 },
      // Centerpiece: the chore chart fills the lower ~65% of the screen.
      { type:'chorechart', x:2, y:34, w:96, h:63, choreTitle:'Daily Chore Chart', choreShowDone:true },
    ],
    portrait: [
      { type:'clock',    x:4,  y:2,  w:50, h:7  },
      { type:'weather',  x:4,  y:10, w:92, h:13 },
      { type:'upcoming', x:4,  y:25, w:44, h:22, upShowTime:true },
      { type:'todo',     x:52, y:25, w:44, h:22 },
      { type:'chorechart', x:2, y:49, w:96, h:49, choreTitle:'Daily Chore Chart', choreShowDone:true },
    ],
  },

  // ── 9. Minimalist (my addition — a clean palate-cleanser) ─────────────────────
  {
    id: 'minimal', category: 'General',
    name: 'Minimalist',
    blurb: 'No decorations — a clean, balanced default to return to anytime.',
    accent: '#4A90D9', accent2: '#7c5cff', textColor: '#e8edf5',
    calDecor: 'none',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:34, h:11 },
      { type:'date',    x:2,  y:15, w:34, h:5  },
      { type:'weather', x:66, y:3,  w:32, h:14 },
      cal({ x:2, y:24, w:96, h:72 }),
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:92, h:8  },
      { type:'date',    x:4,  y:11, w:92, h:4  },
      { type:'weather', x:4,  y:17, w:92, h:11 },
      cal({ x:2, y:30, w:96, h:67 }),
    ],
  },

  // ── 10. Photo Frame (my addition — showcases the photo slideshow) ─────────────
  // A digital-photo-frame layout: a thin info strip up top, with the photo
  // slideshow filling nearly the whole screen as the actual centerpiece — the
  // point of this one. Uses Auto fit (handles a mix of landscape/portrait
  // photos gracefully) and a slow fade between them, both left off by default
  // on a plain Photo widget, so this is where a first-time user would actually
  // see them.
  {
    id: 'photoframe', category: 'General',
    name: 'Photo Frame',
    blurb: 'Your photos take center stage, slowly crossfading — like a real digital photo frame.',
    accent: '#2b2b2b', accent2: '#c9a876', textColor: '#f0ede6',
    calDecor: 'none',
    landscape: [
      { type:'clock',   x:2,  y:2,  w:24, h:10 },
      { type:'date',    x:2,  y:12, w:24, h:5  },
      { type:'weather', x:74, y:2,  w:24, h:15 },
      { type:'photo',   x:2,  y:19, w:96, h:79,
        photoFit:'auto', photoFadeTransition:true, photoFadeDuration:3,
        photoInterval:20, photoAutoBlurBg:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:44, h:7  },
      { type:'date',    x:50, y:2,  w:46, h:7  },
      { type:'weather', x:4,  y:10, w:92, h:11 },
      { type:'photo',   x:2,  y:23, w:96, h:75,
        photoFit:'auto', photoFadeTransition:true, photoFadeDuration:3,
        photoInterval:20, photoAutoBlurBg:true },
    ],
  },

  // ── 11. Daily Digest (my addition — showcases the "fun facts" widgets) ────────
  // Every widget here works fully out of the box with zero setup — no ticker
  // symbols, no target dates, nothing to configure — specifically so this
  // looks complete and interesting the moment it's applied. None of these four
  // widget types (dailyquote, onthisday, moonphase, news) appear in any other
  // template.
  {
    id: 'dailydigest', category: 'General',
    name: 'Daily Digest',
    blurb: 'A quote, a headline, a bit of history, and the moon — a little something to read each day.',
    accent: '#b8863d', accent2: '#5c7d5c', textColor: '#2e2418',
    calDecor: 'none',
    landscape: [
      { type:'clock',      x:2,  y:3,  w:30, h:11 },
      { type:'date',       x:2,  y:15, w:30, h:5  },
      { type:'dailyquote', x:2,  y:22, w:96, h:20 },
      { type:'news',       x:2,  y:44, w:60, h:53, newsMaxItems:8 },
      { type:'onthisday',  x:64, y:44, w:34, h:30, otdMaxItems:3 },
      { type:'moonphase',  x:64, y:76, w:34, h:21 },
    ],
    portrait: [
      { type:'clock',      x:4,  y:2,  w:44, h:8  },
      { type:'date',       x:50, y:2,  w:46, h:8  },
      { type:'dailyquote', x:4,  y:12, w:92, h:16 },
      { type:'moonphase',  x:4,  y:30, w:44, h:14 },
      { type:'onthisday',  x:50, y:30, w:46, h:14, otdMaxItems:3 },
      { type:'news',       x:4,  y:46, w:92, h:52, newsMaxItems:8 },
    ],
  },

  // ── 12. Command Center (my addition — a sleek dashboard) ──────────────────────
  // A tech-dashboard look pairing stocks, a countdown, a kitchen timer, and a
  // QR code — the last two need a quick one-time setup (a target date, a URL
  // or WiFi info) but both show a clear "set this up" prompt rather than
  // looking broken until then. None of these four widget types appear in any
  // other template.
  {
    id: 'commandcenter', category: 'General',
    name: 'Command Center',
    blurb: 'A sleek dashboard: stocks, a countdown, a kitchen timer, and a QR code, all in one glance.',
    accent: '#00d4b8', accent2: '#0a84ff', textColor: '#e8f4ff',
    calDecor: 'none',
    landscape: [
      { type:'clock',     x:2,  y:3,  w:24, h:11 },
      { type:'date',      x:2,  y:15, w:24, h:5  },
      { type:'weather',   x:28, y:3,  w:24, h:17 },
      { type:'stocks',    x:54, y:3,  w:44, h:17 },
      { type:'countdown', x:2,  y:22, w:32, h:24, cdTitle:'Next Big Day' },
      { type:'timer',     x:36, y:22, w:30, h:24, timerTitle:'Kitchen Timer', timerMinutes:10 },
      { type:'qrcode',    x:68, y:22, w:30, h:24, qrTitle:'Scan Me', qrPreset:'text' },
      { type:'news',      x:2,  y:48, w:96, h:49, newsMaxItems:10 },
    ],
    portrait: [
      { type:'clock',     x:4,  y:2,  w:46, h:7  },
      { type:'date',      x:52, y:2,  w:44, h:7  },
      { type:'weather',   x:4,  y:11, w:44, h:12 },
      { type:'stocks',    x:52, y:11, w:44, h:12 },
      { type:'countdown', x:4,  y:25, w:44, h:14, cdTitle:'Next Big Day' },
      { type:'timer',     x:52, y:25, w:44, h:14, timerTitle:'Kitchen Timer', timerMinutes:10 },
      { type:'news',      x:4,  y:41, w:92, h:36, newsMaxItems:8 },
      { type:'qrcode',    x:4,  y:79, w:92, h:19, qrTitle:'Scan Me', qrPreset:'text' },
    ],
  },

  // ── 21. Aviation (my addition — high-altitude twilight sky) ───────────────────
  {
    id: 'aviation', category: 'General',
    name: 'Aviation',
    blurb: 'Open sky at altitude, current conditions, and a compass corner — for anyone who loves flight.',
    accent: '#4a90d9', accent2: '#ff8c42', textColor: '#f5f9ff',
    calDecor: 'none',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:22, h:11 },
      { type:'date',    x:2,  y:15, w:22, h:5  },
      { type:'weather', x:2,  y:22, w:22, h:15 },
      { type:'metar',   x:2,  y:39, w:22, h:36, wxShowTaf:true },
      cal({ x:26, y:3,  w:72, h:72, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:26, y:77, w:72, h:19, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:44, h:8  },
      { type:'date',    x:50, y:2,  w:44, h:8  },
      { type:'weather', x:4,  y:11, w:44, h:12 },
      { type:'metar',   x:50, y:11, w:44, h:12, wxShowTaf:false },
      cal({ x:2, y:25, w:96, h:56, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:2, y:83, w:96, h:15, upShowTime:true },
    ],
  },

  // ── 22. KC-46 Ready Room (my addition — operational, METAR/TAF front and center) ──
  {
    id: 'flightdeck', category: 'General',
    name: 'Flight Deck',
    blurb: 'Current field weather up front, schedule at a glance — built like an actual ready room display.',
    accent: '#5b8dd6', accent2: '#f4a300', textColor: '#e8edf5',
    calDecor: 'none',
    landscape: [
      { type:'clock', x:2, y:3, w:24, h:11 },
      { type:'date',  x:2, y:15, w:24, h:5 },
      { type:'metar', x:2, y:22, w:24, h:53, wxShowTaf:true },
      cal({ x:28, y:3, w:70, h:72, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:28, y:77, w:70, h:19, upShowTime:true },
    ],
    portrait: [
      { type:'clock', x:4,  y:2,  w:44, h:8  },
      { type:'date',  x:50, y:2,  w:44, h:8  },
      { type:'metar', x:4,  y:11, w:92, h:24, wxShowTaf:true },
      cal({ x:2, y:37, w:96, h:44, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:2, y:83, w:96, h:15, upShowTime:true },
    ],
  },
  // ── 23. Nautical (open ocean, boats crossing the water) ───────────────────────
  {
    id: 'nautical', category: 'General',
    name: 'Nautical',
    blurb: 'Open ocean with boats drifting slowly across the water — for anyone who loves being on the water.',
    accent: '#2a6f8a', accent2: '#e8c468', textColor: '#f0f7fa',
    calDecor: 'none',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:22, h:11 },
      { type:'date',    x:2,  y:15, w:22, h:5  },
      { type:'weather', x:2,  y:22, w:22, h:16 },
      cal({ x:26, y:3,  w:72, h:72, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:26, y:77, w:72, h:19, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:44, h:8  },
      { type:'date',    x:50, y:2,  w:44, h:8  },
      { type:'weather', x:4,  y:11, w:92, h:14 },
      cal({ x:2, y:27, w:96, h:54, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:2, y:83, w:96, h:15, upShowTime:true },
    ],
  },

  // ── 24. Custom (user-uploaded background + up to 3 decorations) ───────────────
  {
    id: 'custom', category: 'General',
    name: 'Custom',
    blurb: 'Upload your own background and up to 3 decorations — set each one adrift from the top, bottom, sides, or randomly.',
    accent: '#8a8a8a', accent2: '#c9c9c9', textColor: '#f5f5f5',
    calDecor: 'none',
    landscape: [
      { type:'clock',   x:2,  y:3,  w:22, h:11 },
      { type:'date',    x:2,  y:15, w:22, h:5  },
      { type:'weather', x:2,  y:22, w:22, h:16 },
      cal({ x:26, y:3,  w:72, h:72, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:26, y:77, w:72, h:19, upShowTime:true },
    ],
    portrait: [
      { type:'clock',   x:4,  y:2,  w:44, h:8  },
      { type:'date',    x:50, y:2,  w:44, h:8  },
      { type:'weather', x:4,  y:11, w:92, h:14 },
      cal({ x:2, y:27, w:96, h:54, calWrap:'clamp2', calMaxLines:3 }),
      { type:'upcoming', x:2, y:83, w:96, h:15, upShowTime:true },
    ],
  },
];

// Assigns stable widget ids and stamps the template's calendar decoration onto
// every calendar-type widget, so the decoration travels with the layout and the
// user can still tweak it per-widget afterward.
function materializeWidgets(widgets, calDecor) {
  const CAL_TYPES = new Set(['minical', 'upcoming', 'today', 'agenda']);
  return widgets.map((w, i) => {
    const out = Object.assign({ id: 'w' + (i + 1) }, w);
    if (CAL_TYPES.has(out.type) && calDecor && calDecor !== 'none') {
      out.calDecor = calDecor;
    }
    return out;
  });
}

function getTemplateSummaries() {
  return TEMPLATES.map(t => ({
    id: t.id, name: t.name, blurb: t.blurb,
    accent: t.accent, accent2: t.accent2, calDecor: t.calDecor,
    category: t.category || 'General',
  }));
}

function getTemplate(id) {
  return TEMPLATES.find(t => t.id === id) || null;
}

module.exports = { TEMPLATES, getTemplateSummaries, getTemplate, materializeWidgets };
