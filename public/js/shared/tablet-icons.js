// The icons and colors a tablet tile can use. Shared by the tablet page (public/js/tablet/) and the editor in the app (public/js/app/15-tablet-editor.js), so the picker in the
// editor shows exactly what the tablet draws. Each icon is one SVG path on a 24 by 24 grid, drawn as an outline.
'use strict';
const TB_ICONS = {
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  plug: 'M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  cover: 'M3 21V9l9-6 9 6v12M7 21v-8h10v8',
  tv: 'M3 5h18v12H3zM8 21h8M12 17v4',
  play: 'M6 4l14 8-14 8z',
  meal: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 4-3 7h3v11',
  check: 'M5 12l4 4 10-10',
  msg: 'M4 5h16v11H9l-5 4z',
  temp: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
  fan: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10c0-4 1-7 4-7 2 0 2 3 0 5M14 12c4 0 7 1 7 4 0 2-3 2-5 0M12 14c0 4-1 7-4 7-2 0-2-3 0-5M10 12c-4 0-7-1-7-4 0-2 3-2 5 0',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  screen: 'M3 5h18v12H3zM8 21h8M12 17v4M7 10l3 3 5-5',
  up: 'M12 19V5M6 11l6-6 6 6',
  dot: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  home: 'M3 11l9-8 9 8M5 10v10h14V10M10 20v-6h4v6',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01',
  garage: 'M3 21V8l9-5 9 5v13M7 21v-9h10v9M7 15h10',
  sun: 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  bed: 'M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-8v6',
  sofa: 'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3zM6 18v2M18 18v2',
  car: 'M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v1M17 19v1',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  power: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0',
  fire: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9z',
  snow: 'M12 3v18M4 7.5l16 9M4 16.5l16-9M9 4l3 2 3-2M9 20l3-2 3 2',
  wifi: 'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  speaker: 'M7 3h10v18H7zM12 17a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 7h.01',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  blinds: 'M4 4h16M4 8h16M4 12h16M4 16h16M12 16v5',
  washer: 'M5 3h14v18H5zM5 8h14M12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  tree: 'M12 3l5 7h-3l4 6H6l4-6H7zM12 16v5',
  cloud: 'M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  broom: 'M14 3l4 4-6 6M10 11l-5 7 3 3 7-5M6 15l3 3',
  cart: 'M3 4h2l2.5 11h10L20 7H6M9 20h.01M17 20h.01',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  timer: 'M12 8v5l3 2M9 2h6M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2',
  photo: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M16 9h.01',
  plus: 'M12 5v14M5 12h14',
  vacuum: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 4v2',
  mower: 'M3 17h14l3-5h-6M7 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM16 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 12V7h4',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  pencil: 'M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
};
const TB_COLORS = { amber: '#ffc857', blue: '#5aa2f0', green: '#34d399', red: '#f0765a', purple: '#b794f6', teal: '#2dd4bf', pink: '#f472b6', gray: '#64748b' };
// Does a tile have no on/off of its own (a scene, a lock, a thermostat, a sensor, the clock, most Piazza HQ tiles, a group that only turns things on or off)? Its color is then
// used all the time. A light, switch, fan, blind or media player takes its color only while it is on.
function tbIsStateless(tile) {
  if (tile.kind === 'camera') return false;
  if (tile.kind === 'card') return !['update_status', 'chores'].includes(tile.ref);
  if (tile.kind === 'group') return (tile.group_mode || 'toggle') !== 'toggle';
  if (tile.kind === 'routine') return (tile.routine || {}).mode !== 'toggle';
  const d = String(tile.ref).split('.')[0];
  if (d === 'automation') return tile.tap === 'run';                // run with a tap: no on/off of its own; switched on and off: like a switch
  return !['light', 'switch', 'input_boolean', 'fan', 'cover', 'media_player'].includes(d);
}
const tbSvg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${TB_ICONS[name] || TB_ICONS.dot}"/></svg>`;
