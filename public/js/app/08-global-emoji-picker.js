// ── Global emoji picker ───────────────────────────────────────────────────────
// A searchable, scrollable picker over a broad emoji set. onPick(emoji) is called
// with the chosen emoji. Reused for chore icons and kid avatars.
const EMOJI_SET = {
  'Smileys & People': '😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😋 😛 🤪 😜 🤗 🤔 🤨 😐 😑 😶 🙄 😏 😴 😪 🤤 😎 🤓 🥳 🤠 😺 🐱 👶 🧒 👦 👧 🧑 👨 👩 🧓 👴 👵 👮 👷 💂 🕵️ 👨‍🍳 👩‍🍳 👨‍🏫 👩‍🏫 👨‍🌾 👩‍🌾 🙋 🙆 💁 🙅 🤷 🙇 👏 🙌 👍 👎 👊 ✊ 🤛 🤝 🙏 💪 🦷 🥷 🧙 🧜‍♀️ 🦸 🦹 👑 🤴 👸'.split(' '),
  'Feelings': '😢 😭 😡 😤 😠 🥺 😟 😦 😨 😰 😱 🤒 🤕 🤢 🥶 🥵 😵 🤯 😳 😬 🙁 ☹️ 😞 😔 😩 😫 😖 😣 🤐 😷 🥱 😌 🤩 🥴 😅'.split(' '),
  'Animals & Nature': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🐙 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦏 🐪 🦒 🐎 🐖 🐏 🐑 🐐 🦌 🐕 🐩 🐈 🐓 🦃 🕊️ 🐇 🐿️ 🦔 🌳 🌲 🌴 🌵 🌷 🌸 🌹 🌺 🌻 🌼 🌿 🍀 🍁 🍂 🍃 🌱 🌾 🪴'.split(' '),
  'Weather & Sky': '☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 🌪️ 🌫️ 🌈 ☂️ ☔ ⚡ 🔥 💧 🌊 🌙 🌛 🌜 ⭐ 🌟 ✨ 🌠 ☄️ 🪐 🌍'.split(' '),
  'Food': '🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🌶️ 🥔 🍠 🥐 🍞 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍢 🍡 🍧 🍨 🍦 🥧 🍰 🎂 🧁 🍮 🍭 🍬 🍫 🍿 🧂 🥛 🍼 ☕ 🍵 🧃 🥤'.split(' '),
  'Activities': '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🥅 🏒 🏑 🥍 🏏 ⛳ 🏹 🎣 🥊 🥋 🎽 ⛸️ 🥌 🛷 🎿 ⛷️ 🏂 🏋️ 🤸 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚴 🚵 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 🎯 🎳 🎮 🎰 🧩 🎨 🖌️ 🖍️ 📚 ✏️'.split(' '),
  'School & Learning': '🎒 📚 📖 📕 📗 📘 📙 📓 📔 📒 📝 ✏️ 🖊️ 🖋️ ✂️ 📐 📏 🧮 🔬 🔭 🌡️ 🧪 🧫 🎓 🏫 🖍️ 🖌️ 🎨 🗒️ 📎 📌 🗓️ ⏰ ⏲️'.split(' '),
  'Home & Chores': '🪥 🛏️ 🛌 🛁 🚿 🧸 🧹 🧺 🧼 🧽 🪣 🧴 🗑️ 🚮 👕 👖 🧦 🧤 👗 👟 🎒 🌂 🧷 🔑 🔨 🪛 🧰 🪜 🧯 🛒 🛎️ 🕯️ 💡 🔦 🔋 📱 💻 ⌨️ 🖥️ 🖨️ 📷 ☎️ ⏰ ⏲️ 🕐 📅 📆 📌 📍 ✂️ 🖊️ 🖍️ 📝 📖 🔖 🗄️ 📦 🪟 🧻 🥣 🥤 🧊 🪠 🧵 🪡 🧯 🔌 🪒'.split(' '),
  'Seasons & Holidays': '🎄 🎃 🎆 🎇 🧨 🎉 🎊 🎁 🕎 🎋 🎍 🧧 🐰 🥚 🦃 🍂 🍁 ☘️ 💝 🎂 🕯️ 🪅 🎗️ 🦇 👻 🎅 🤶 ⛄'.split(' '),
  'Money & Awards': '💰 💵 💴 💶 💷 💳 🪙 🧾 🎁 🎈 🎉 🎊 🏆 🥇 🥈 🥉 🏅 🎖️ ⭐ 🌟'.split(' '),
  'Vehicles & Places': '🚗 🚕 🚙 🚌 🚲 🛴 🛵 🏍️ 🚀 🛸 ⛵ 🏡 🏠 🏫 🏥 🏞️ 🏖️ 🗺️'.split(' '),
  'Symbols': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💕 💞 💓 💗 💖 💘 💝 ⭐ 🌟 ✨ ✅ ☑️ ✔️ ❌ ⭕ ❗ ❓ 💯 🔔 🎵 🎶 ➕ ➖ ✖️ 🟰 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔶 🔷 🔸 🔹 🔺 🔻 ◼️ ◻️'.split(' '),
};
// Keyword lookup so search finds specific emoji by meaning, not just the category
// name they live in (e.g. typing "tooth" jumps straight to 🦷/🪥 instead of requiring
// "smileys" or scrolling). Deliberately chore/family-flavored since this picker's main
// job here is chore icons and kid avatars.
const EMOJI_KEYWORDS = {
  tooth:'🦷 🪥', teeth:'🦷 🪥', brush:'🪥 🖌️ 🖍️', bed:'🛏️ 🛌', bedtime:'🛏️ 🛌 🌙',
  bath:'🛁 🚿', shower:'🚿', trash:'🗑️ 🚮', garbage:'🗑️ 🚮', recycle:'🚮 ♻️',
  clean:'🧹 🧼 🧽 🧴 🪣', vacuum:'🧹', sweep:'🧹', mop:'🧽 🪣', soap:'🧼 🧴',
  dog:'🐶 🐕 🐩', puppy:'🐶', cat:'🐱 🐈', kitten:'🐱', pet:'🐶 🐱 🐰 🐹 🐦 🐠',
  fish:'🐠 🐟', plant:'🌱 🪴', water:'💧 🚿 🌊', money:'💰 💵 🪙', allowance:'💰 💵 🪙',
  book:'📚 📖', read:'📚 📖', pencil:'✏️', homework:'📚 ✏️ 📝', school:'🎒 📚 ✏️',
  dish:'🍽️ 🥣', dishes:'🍽️ 🥣', cook:'🍳 👨‍🍳 👩‍🍳', kitchen:'🍽️ 🍳 🥣',
  laundry:'👕 🧺 🧦', clothes:'👕 👖 👗', shoe:'👟', sock:'🧦', fold:'🧺 👕',
  bag:'🎒', backpack:'🎒', star:'⭐ 🌟', happy:'😀 😃 😄 🥳', smile:'🙂 😊',
  love:'❤️ 💕 💖', sun:'☀️', moon:'🌙', rainbow:'🌈', weather:'☀️ ⛅ 🌧️ ❄️',
  ball:'⚽ 🏀 🏈 ⚾', sport:'⚽ 🏀 🏈 ⚾ 🎾', game:'🎮 🎲 🧩', music:'🎵 🎶 🎸 🎹 🥁',
  car:'🚗 🚕', bike:'🚲', toy:'🧸', baby:'👶', kid:'🧒 👦 👧', child:'🧒 👦 👧',
  bug:'🐛 🐞 🐌', bird:'🐦 🦅 🦉', unicorn:'🦄', dinosaur:'🦖 🦕', dragon:'🐉',
  princess:'👸 🧜‍♀️', prince:'🤴', wizard:'🧙', hero:'🦸 🦹', crown:'👑', ninja:'🥷',
  trophy:'🏆 🥇 🥈 🥉', medal:'🏅 🎖️', gift:'🎁', party:'🎉 🎊 🥳', cake:'🎂 🧁',
  box:'📦 🗄️', shelf:'🗄️', window:'🪟', tissue:'🧻', ice:'🧊', cup:'🥤',
  phone:'📱 ☎️', computer:'💻 🖥️', clock:'⏰ 🕐', calendar:'📅 📆', tool:'🔨 🪛 🧰',
  house:'🏡 🏠', tree:'🌳 🌲', flower:'🌷 🌸 🌹 🌺 🌻',
  sad:'😢 😭 🙁 😞', angry:'😡 😠 😤', mad:'😡 😠', sick:'🤒 🤢 😷', scared:'😨 😱',
  tired:'😴 🥱', nervous:'😰 😬', cry:'😢 😭', worried:'😟 😦',
  rain:'🌧️ ⛈️', rainy:'🌧️', snow:'❄️ ☃️ ⛄', snowy:'❄️ ⛄', cloud:'☁️ ⛅', cloudy:'☁️ ⛅',
  storm:'⛈️ 🌩️', wind:'🌬️ 💨 🌪️', fog:'🌫️', sunny:'☀️', temperature:'🌡️',
  ruler:'📐 📏', scissors:'✂️', science:'🔬 🧪', graduate:'🎓', notebook:'📓 📔',
  plunger:'🪠', sew:'🧵 🪡', razor:'🪒', outlet:'🔌',
  christmas:'🎄 🎅 🤶', halloween:'🎃 👻 🦇', pumpkin:'🎃', ghost:'👻', easter:'🥚 🐰',
  fireworks:'🎆 🎇', thanksgiving:'🦃', holiday:'🎄 🎃 🎆 🎁',
};
function openEmojiPicker(onPick) {
  let ov = $('emoji-picker');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'emoji-picker';
    ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; });
    document.body.appendChild(ov);
  }
  const emojiBtn = e => `<button type="button" class="ep-emoji" data-e="${e}" style="font-size:26px;background:transparent;border:none;border-radius:8px;padding:5px;cursor:pointer">${e}</button>`;
  let recents = [];
  try { recents = JSON.parse(localStorage.getItem('choreEmojiRecents') || '[]'); } catch {}
  const recentGroup = recents.length ? `
    <div class="emoji-group" data-name="recently used">
      <div style="font-size:12px;color:var(--muted);font-weight:600;margin:0 0 6px">Recently Used</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${recents.map(emojiBtn).join('')}</div>
    </div>` : '';
  const groups = Object.entries(EMOJI_SET).map(([name, arr]) => `
    <div class="emoji-group" data-name="${name.toLowerCase()}">
      <div style="font-size:12px;color:var(--muted);font-weight:600;margin:10px 0 6px">${name}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${arr.map(emojiBtn).join('')}</div>
    </div>`).join('');
  ov.innerHTML = `
    <div style="background:var(--bg);width:100%;max-width:520px;height:75vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;padding:16px 16px 0">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <input class="form-input" id="emoji-search" placeholder="Search — try “dog”, “clean”, “trash”…" autocomplete="off" style="flex:1;min-width:0;font-size:18px;padding:14px 16px;height:auto">
        <button class="btn" id="emoji-close" style="background:var(--card);border:1px solid var(--border);flex-shrink:0;padding:14px 16px">Done</button>
      </div>
      <div id="emoji-results" style="display:none;flex-wrap:wrap;gap:4px;padding-bottom:20px;overflow-y:auto;flex:1"></div>
      <div id="emoji-scroll" style="overflow-y:auto;flex:1;padding-bottom:20px">${recentGroup}${groups}</div>
    </div>`;
  ov.style.display = 'flex';
  const remember = (e) => {
    recents = [e, ...recents.filter(x => x !== e)].slice(0, 16);
    try { localStorage.setItem('choreEmojiRecents', JSON.stringify(recents)); } catch {}
  };
  const bindPick = (root) => root.querySelectorAll('.ep-emoji').forEach(b => b.addEventListener('click', () => {
    remember(b.dataset.e); onPick(b.dataset.e); ov.style.display = 'none';
  }));
  bindPick(ov);
  setTimeout(() => $('emoji-search') && $('emoji-search').focus(), 50);
  $('emoji-close').addEventListener('click', () => ov.style.display = 'none');
  $('emoji-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const scroll = $('emoji-scroll'), results = $('emoji-results');
    if (!q) { scroll.style.display = ''; results.style.display = 'none'; return; }
    // Keyword hits first (specific emoji matched by meaning)...
    const hits = new Set();
    for (const [word, emojis] of Object.entries(EMOJI_KEYWORDS)) {
      if (word.includes(q) || q.includes(word)) emojis.split(' ').forEach(e => hits.add(e));
    }
    if (hits.size) {
      scroll.style.display = 'none';
      results.style.display = 'flex';
      results.innerHTML = [...hits].map(emojiBtn).join('');
      bindPick(results);
    } else {
      // ...fall back to whole categories whose name matches.
      results.style.display = 'none';
      scroll.style.display = '';
      scroll.querySelectorAll('.emoji-group').forEach(g => {
        g.style.display = g.dataset.name.includes(q) ? '' : 'none';
      });
    }
  });
}

// Searchable bottom-sheet picker over the full Home Assistant entity list —
// same shape as openEmojiPicker() above (search input + scrollable filtered
// list), just a flat list instead of grouped categories since entities don't
// have a natural small set of groups the way emoji do. Cached across opens in
// the same session (cachedHaEntities) since the full list rarely changes
// within a single editing session and re-fetching on every open would be
// wasteful for an install with hundreds of entities.
let cachedHaEntities = null;
// Real Home Assistant areas — { areas: [{id,name}], entityAreas: {entity_id: area_id} }.
// Cached per session same as cachedHaEntities above (server itself also
// caches this for 5 minutes, so a session-long client cache on top of that
// just avoids the extra round-trip on every picker open). null = not yet
// fetched; { areas: [], entityAreas: {} } = fetched but HA has none
// configured (or the WebSocket lookup failed) — both cases skip re-fetching.
let cachedHaAreas = null;
async function ensureHaAreasLoaded() {
  if (cachedHaAreas) return cachedHaAreas;
  try {
    const result = await apiFetch('/api/ha/areas');
    cachedHaAreas = (result && Array.isArray(result.areas)) ? result : { areas: [], entityAreas: {} };
  } catch { cachedHaAreas = { areas: [], entityAreas: {} }; }
  return cachedHaAreas;
}
// Generic searchable HA entity picker — a bottom sheet with text search
// (matches friendly name AND entity_id) plus an optional area filter.
// opts.onPick(entityId, friendlyName) fires on selection, then the sheet
// closes. opts.domains (optional) limits the list to those entity-id
// prefixes; opts.current (optional) highlights the row already chosen.
// Shared by the layout widget picker (openEntityPicker) and the Home
// Assistant alert form's entity chooser.
function openHaEntitySearch(opts) {
  const onPick = (opts && opts.onPick) || (() => {});
  const current = (opts && opts.current) || '';
  const domainSet = (opts && Array.isArray(opts.domains) && opts.domains.length) ? new Set(opts.domains) : null;
  let ov = $('ha-entity-picker');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ha-entity-picker';
    ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `
    <div style="background:var(--bg);width:100%;max-width:520px;height:75vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;padding:16px 16px 0">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <input class="form-input" id="ha-entity-search" placeholder="Search name or entity id…" autocomplete="off" style="flex:1;width:auto;min-width:0;font-size:16px;padding:12px 14px">
        <button class="btn" id="ha-entity-close" style="background:var(--card);border:1px solid var(--border);flex-shrink:0;width:auto;margin-top:0;padding:12px 16px">Done</button>
      </div>
      <div style="margin-bottom:10px">
        <select class="form-input" id="ha-area-filter" style="width:100%;font-size:14px;padding:10px 12px">
          <option value="">All areas</option>
        </select>
      </div>
      <div id="ha-entity-list" style="overflow-y:auto;flex:1;padding-bottom:20px;font-size:13px;color:var(--muted)">Loading…</div>
    </div>`;
  ov.style.display = 'flex';
  $('ha-entity-close').addEventListener('click', () => ov.style.display = 'none');
  setTimeout(() => $('ha-entity-search') && $('ha-entity-search').focus(), 50);

  const renderList = (items) => {
    const listEl = $('ha-entity-list');
    if (!listEl) return;
    if (!items.length) { listEl.innerHTML = `<p style="padding:20px 4px">No matching entities.</p>`; return; }
    listEl.innerHTML = items.map(e => `
      <button type="button" class="ha-entity-item" data-id="${escapeHtml(e.entity_id)}" data-name="${escapeHtml(e.friendly_name)}"
        style="display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;background:${e.entity_id === current ? 'var(--card)' : 'transparent'};border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}${e.entity_id === current ? ' ✓' : ''}</span>
        <span style="font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)} — ${escapeHtml(e.state)}${e.unit ? ' ' + escapeHtml(e.unit) : ''}</span>
      </button>`).join('');
    listEl.querySelectorAll('.ha-entity-item').forEach(btn => {
      btn.addEventListener('click', () => {
        ov.style.display = 'none';
        onPick(btn.dataset.id, btn.dataset.name);
      });
    });
  };

  // Area + text filters combine (AND) — picking an area narrows the list to
  // that room, and search still narrows further within it. entityAreas maps
  // entity_id -> area_id; an entity with no area (not assigned to a room in
  // HA at all) simply never matches a specific area filter, same as it
  // wouldn't show up under any room in HA's own UI.
  const applyFilters = () => {
    if (!cachedHaEntities) return;
    const q = ($('ha-entity-search').value || '').trim().toLowerCase();
    const areaId = $('ha-area-filter') ? $('ha-area-filter').value : '';
    let list = cachedHaEntities;
    if (domainSet) list = list.filter(en => domainSet.has(en.entity_id.split('.')[0]));
    if (areaId) {
      const entityAreas = (cachedHaAreas && cachedHaAreas.entityAreas) || {};
      list = list.filter(en => entityAreas[en.entity_id] === areaId);
    }
    if (q) list = list.filter(en => en.friendly_name.toLowerCase().includes(q) || en.entity_id.toLowerCase().includes(q));
    renderList(list);
  };

  (async () => {
    const [entitiesResult] = await Promise.all([
      cachedHaEntities ? Promise.resolve(cachedHaEntities) : apiFetch('/api/ha/entities'),
      ensureHaAreasLoaded(),
    ]);
    if (Array.isArray(entitiesResult)) {
      cachedHaEntities = entitiesResult;
    } else if (!cachedHaEntities) {
      $('ha-entity-list').innerHTML = `<p style="padding:20px 4px">⚠️ ${escapeHtml((entitiesResult && entitiesResult.error) || 'Could not load entities')}</p>`;
      return;
    }
    const areaSelect = $('ha-area-filter');
    if (areaSelect && cachedHaAreas && cachedHaAreas.areas.length) {
      areaSelect.innerHTML = `<option value="">All areas</option>` +
        cachedHaAreas.areas.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    } else if (areaSelect) {
      // No areas came back (HA has none configured, an older HA version, or
      // the WebSocket lookup failed) — hide the filter entirely rather than
      // show a dropdown with nothing but "All areas" in it.
      areaSelect.parentElement.style.display = 'none';
    }
    applyFilters();
  })();

  $('ha-entity-search').addEventListener('input', applyFilters);
  $('ha-area-filter').addEventListener('change', applyFilters);
}

// Layout widget entity picker — applies the pick to a widget object (label
// auto-follow + autosave). Thin wrapper over openHaEntitySearch.
function openEntityPicker(w) {
  openHaEntitySearch({
    current: w.haEntityId,
    onPick: (newId, newName) => {
      // Refresh the label to match the newly-picked entity whenever the
      // current label is empty OR was itself auto-filled from whatever
      // entity this widget PREVIOUSLY pointed to (haLabelAutoFor tracks
      // that) — never touch a label someone actually typed themselves.
      if (!w.haLabel || w.haLabelAutoFor === w.haEntityId) {
        w.haLabel = newName;
        w.haLabelAutoFor = newId;
      }
      w.haEntityId = newId;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    },
  });
}

// Multi-select variant of openEntityPicker() above, for Tier 4's Smart Home
// Dashboard widget — same search/list shape, but tapping an entity toggles it
// in w.haEntityIds (an array of {id, room}) instead of picking one and
// closing. Shares the same cachedHaEntities cache. Toggling an entity OFF
// removes its whole entry (including any room label already set on it) —
// simplest mental model ("it's just not in the list anymore"), and cheap to
// re-add if that was a mistake.
function openEntityPickerMulti(w) {
  let ov = $('ha-entity-picker');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ha-entity-picker';
    ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => { if (e.target === ov) closeMultiPicker(); });
    document.body.appendChild(ov);
  }
  if (!Array.isArray(w.haEntityIds)) w.haEntityIds = [];
  if (!Array.isArray(w.haAreaIds)) w.haAreaIds = [];
  const closeMultiPicker = () => {
    ov.style.display = 'none';
    autoSaveLayout();
    drawWidgetSettingsPanel(); // refresh so the picked count/room list shows in the main panel
  };
  ov.innerHTML = `
    <div style="background:var(--bg);width:100%;max-width:520px;height:85vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;padding:16px 16px 0">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <div style="flex:1;font-size:16px;font-weight:600">Choose Entities</div>
        <button class="btn" id="ha-entity-close" style="background:var(--card);border:1px solid var(--border);flex-shrink:0;width:auto;margin-top:0;padding:12px 16px">Done</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding-bottom:20px">
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin:4px 0 6px">Add a Whole Area</div>
        <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Stays live — any device you add to it in Home Assistant later is included automatically. Its entities won't also show up below to avoid picking the same thing twice.</p>
        <div id="ha-area-picklist" style="margin-bottom:16px"></div>
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin:4px 0 6px">Add Individual Entities</div>
        <input class="form-input" id="ha-entity-search" placeholder="Search entities…" autocomplete="off" style="width:100%;font-size:16px;padding:12px 14px;margin-bottom:10px">
        <select class="form-input" id="ha-area-filter" style="width:100%;font-size:14px;padding:10px 12px;margin-bottom:10px">
          <option value="">All areas</option>
        </select>
        <div id="ha-entity-list" style="font-size:13px;color:var(--muted)">Loading…</div>
      </div>
    </div>`;
  ov.style.display = 'flex';
  $('ha-entity-close').addEventListener('click', closeMultiPicker);

  const isCoveredByArea = (entityId) => {
    if (!w.haAreaIds.length || !cachedHaAreas) return false;
    const areaId = (cachedHaAreas.entityAreas || {})[entityId];
    return !!areaId && w.haAreaIds.includes(areaId);
  };
  const renderList = (items) => {
    const listEl = $('ha-entity-list');
    if (!listEl) return;
    if (!items.length) { listEl.innerHTML = `<p style="padding:20px 4px">No matching entities.</p>`; return; }
    listEl.innerHTML = items.map(e => {
      if (isCoveredByArea(e.entity_id)) {
        return `
        <div style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 4px;border-bottom:1px solid var(--border);opacity:0.4">
          <input type="checkbox" checked disabled style="width:20px;height:20px;flex-shrink:0">
          <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
            <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}</span>
            <span style="font-size:11px;color:var(--muted)">Included via its area — uncheck the area above to pick it individually instead</span>
          </span>
        </div>`;
      }
      const checked = w.haEntityIds.some(entry => entry.id === e.entity_id);
      return `
      <button type="button" class="ha-entity-item" data-id="${escapeHtml(e.entity_id)}" data-name="${escapeHtml(e.friendly_name)}"
        style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <input type="checkbox" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;pointer-events:none">
        <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
          <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}</span>
          <span style="font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)} — ${escapeHtml(e.state)}${e.unit ? ' ' + escapeHtml(e.unit) : ''}</span>
        </span>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.ha-entity-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const idx = w.haEntityIds.findIndex(entry => entry.id === id);
        if (idx >= 0) {
          w.haEntityIds.splice(idx, 1);
        } else {
          w.haEntityIds.push({ id, room: '' });
        }
        renderList(currentList());
      });
    });
  };

  // Area + text filters combine (AND).
  const currentList = () => {
    if (!cachedHaEntities) return [];
    const q = ($('ha-entity-search').value || '').trim().toLowerCase();
    const areaId = $('ha-area-filter') ? $('ha-area-filter').value : '';
    let list = cachedHaEntities;
    if (areaId) {
      const entityAreas = (cachedHaAreas && cachedHaAreas.entityAreas) || {};
      list = list.filter(en => entityAreas[en.entity_id] === areaId);
    }
    if (q) list = list.filter(en => en.friendly_name.toLowerCase().includes(q) || en.entity_id.toLowerCase().includes(q));
    return list;
  };

  // Whole-area selection (live) — a genuinely different action from
  // individually picking entities above, not a one-time bulk-insert. An
  // area checked here means "everything currently in it, always" (resolved
  // fresh at render/action time on the display, see resolveAreaMemberIds()
  // in display.html) — its member entities are deliberately excluded from
  // being ALSO individually checkable above, so there's never a confusing
  // overlap between the two.
  const renderAreaPicklist = () => {
    const el = $('ha-area-picklist');
    if (!el) return;
    if (!cachedHaAreas || !cachedHaAreas.areas.length) {
      el.innerHTML = `<p style="font-size:12px;color:var(--muted)">No areas found in Home Assistant.</p>`;
      return;
    }
    el.innerHTML = cachedHaAreas.areas.map(a => {
      const checked = w.haAreaIds.includes(a.id);
      return `
      <button type="button" class="ha-area-item" data-area-id="${escapeHtml(a.id)}"
        style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <input type="checkbox" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;pointer-events:none">
        <span style="font-size:14px;color:var(--text)">${escapeHtml(a.name)}</span>
      </button>`;
    }).join('');
    el.querySelectorAll('.ha-area-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const areaId = btn.dataset.areaId;
        const idx = w.haAreaIds.indexOf(areaId);
        if (idx >= 0) w.haAreaIds.splice(idx, 1);
        else w.haAreaIds.push(areaId);
        renderAreaPicklist();
        renderList(currentList()); // covered-by-area disabling needs to update too
      });
    });
  };

  (async () => {
    const [entitiesResult] = await Promise.all([
      cachedHaEntities ? Promise.resolve(cachedHaEntities) : apiFetch('/api/ha/entities'),
      ensureHaAreasLoaded(),
    ]);
    if (Array.isArray(entitiesResult)) {
      cachedHaEntities = entitiesResult;
    } else if (!cachedHaEntities) {
      $('ha-entity-list').innerHTML = `<p style="padding:20px 4px">⚠️ ${escapeHtml((entitiesResult && entitiesResult.error) || 'Could not load entities')}</p>`;
      return;
    }
    const areaSelect = $('ha-area-filter');
    if (areaSelect && cachedHaAreas && cachedHaAreas.areas.length) {
      areaSelect.innerHTML = `<option value="">All areas</option>` +
        cachedHaAreas.areas.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    } else if (areaSelect) {
      areaSelect.style.display = 'none';
    }
    renderAreaPicklist();
    renderList(cachedHaEntities);
  })();

  $('ha-entity-search').addEventListener('input', () => renderList(currentList()));
  $('ha-area-filter').addEventListener('change', () => renderList(currentList()));
}

// Multi-select picker for the Group Control widget — same search/area-filter
// shape as openEntityPickerMulti() above, but simpler: w.gcEntityIds is a
// flat array of plain entity_id strings, not {id,room} objects. No room
// tracking at all here — Group Control never displays members individually,
// so there's nothing for a room label to organize.
function openGroupEntityPicker(w) {
  let ov = $('ha-entity-picker');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ha-entity-picker';
    ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => { if (e.target === ov) closeGroupPicker(); });
    document.body.appendChild(ov);
  }
  if (!Array.isArray(w.gcEntityIds)) w.gcEntityIds = [];
  if (!Array.isArray(w.gcAreaIds)) w.gcAreaIds = [];
  const closeGroupPicker = () => {
    ov.style.display = 'none';
    autoSaveLayout();
    drawWidgetSettingsPanel(); // refresh so the picked count shows in the main panel
  };
  ov.innerHTML = `
    <div style="background:var(--bg);width:100%;max-width:520px;height:85vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;padding:16px 16px 0">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <div style="flex:1;font-size:16px;font-weight:600">Choose Entities</div>
        <button class="btn" id="ha-entity-close" style="background:var(--card);border:1px solid var(--border);flex-shrink:0;width:auto;margin-top:0;padding:12px 16px">Done</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding-bottom:20px">
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin:4px 0 6px">Add a Whole Area</div>
        <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Stays live — any device you add to it in Home Assistant later is included automatically. Its entities won't also show up below to avoid picking the same thing twice.</p>
        <div id="ha-area-picklist" style="margin-bottom:16px"></div>
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin:4px 0 6px">Add Individual Entities</div>
        <input class="form-input" id="ha-entity-search" placeholder="Search entities…" autocomplete="off" style="width:100%;font-size:16px;padding:12px 14px;margin-bottom:10px">
        <select class="form-input" id="ha-area-filter" style="width:100%;font-size:14px;padding:10px 12px;margin-bottom:10px">
          <option value="">All areas</option>
        </select>
        <div id="ha-entity-list" style="font-size:13px;color:var(--muted)">Loading…</div>
      </div>
    </div>`;
  ov.style.display = 'flex';
  $('ha-entity-close').addEventListener('click', closeGroupPicker);

  const isCoveredByArea = (entityId) => {
    if (!w.gcAreaIds.length || !cachedHaAreas) return false;
    const areaId = (cachedHaAreas.entityAreas || {})[entityId];
    return !!areaId && w.gcAreaIds.includes(areaId);
  };
  const renderList = (items) => {
    const listEl = $('ha-entity-list');
    if (!listEl) return;
    if (!items.length) { listEl.innerHTML = `<p style="padding:20px 4px">No matching entities.</p>`; return; }
    listEl.innerHTML = items.map(e => {
      if (isCoveredByArea(e.entity_id)) {
        return `
        <div style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 4px;border-bottom:1px solid var(--border);opacity:0.4">
          <input type="checkbox" checked disabled style="width:20px;height:20px;flex-shrink:0">
          <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
            <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}</span>
            <span style="font-size:11px;color:var(--muted)">Included via its area — uncheck the area above to pick it individually instead</span>
          </span>
        </div>`;
      }
      const checked = w.gcEntityIds.includes(e.entity_id);
      return `
      <button type="button" class="ha-entity-item" data-id="${escapeHtml(e.entity_id)}"
        style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <input type="checkbox" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;pointer-events:none">
        <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
          <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}</span>
          <span style="font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)} — ${escapeHtml(e.state)}${e.unit ? ' ' + escapeHtml(e.unit) : ''}</span>
        </span>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.ha-entity-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const idx = w.gcEntityIds.indexOf(id);
        if (idx >= 0) w.gcEntityIds.splice(idx, 1);
        else w.gcEntityIds.push(id);
        renderList(currentList());
      });
    });
  };

  const currentList = () => {
    if (!cachedHaEntities) return [];
    const q = ($('ha-entity-search').value || '').trim().toLowerCase();
    const areaId = $('ha-area-filter') ? $('ha-area-filter').value : '';
    let list = cachedHaEntities;
    if (areaId) {
      const entityAreas = (cachedHaAreas && cachedHaAreas.entityAreas) || {};
      list = list.filter(en => entityAreas[en.entity_id] === areaId);
    }
    if (q) list = list.filter(en => en.friendly_name.toLowerCase().includes(q) || en.entity_id.toLowerCase().includes(q));
    return list;
  };

  const renderAreaPicklist = () => {
    const el = $('ha-area-picklist');
    if (!el) return;
    if (!cachedHaAreas || !cachedHaAreas.areas.length) {
      el.innerHTML = `<p style="font-size:12px;color:var(--muted)">No areas found in Home Assistant.</p>`;
      return;
    }
    el.innerHTML = cachedHaAreas.areas.map(a => {
      const checked = w.gcAreaIds.includes(a.id);
      return `
      <button type="button" class="ha-area-item" data-area-id="${escapeHtml(a.id)}"
        style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <input type="checkbox" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;pointer-events:none">
        <span style="font-size:14px;color:var(--text)">${escapeHtml(a.name)}</span>
      </button>`;
    }).join('');
    el.querySelectorAll('.ha-area-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const areaId = btn.dataset.areaId;
        const idx = w.gcAreaIds.indexOf(areaId);
        if (idx >= 0) w.gcAreaIds.splice(idx, 1);
        else w.gcAreaIds.push(areaId);
        renderAreaPicklist();
        renderList(currentList());
      });
    });
  };

  (async () => {
    const [entitiesResult] = await Promise.all([
      cachedHaEntities ? Promise.resolve(cachedHaEntities) : apiFetch('/api/ha/entities'),
      ensureHaAreasLoaded(),
    ]);
    if (Array.isArray(entitiesResult)) {
      cachedHaEntities = entitiesResult;
    } else if (!cachedHaEntities) {
      $('ha-entity-list').innerHTML = `<p style="padding:20px 4px">⚠️ ${escapeHtml((entitiesResult && entitiesResult.error) || 'Could not load entities')}</p>`;
      return;
    }
    const areaSelect = $('ha-area-filter');
    if (areaSelect && cachedHaAreas && cachedHaAreas.areas.length) {
      areaSelect.innerHTML = `<option value="">All areas</option>` +
        cachedHaAreas.areas.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    } else if (areaSelect) {
      areaSelect.style.display = 'none';
    }
    renderAreaPicklist();
    renderList(cachedHaEntities);
  })();

  $('ha-entity-search').addEventListener('input', () => renderList(currentList()));
  $('ha-area-filter').addEventListener('change', () => renderList(currentList()));
}

// Editor for ONE combo group on the Smart Home Dashboard widget — combines
// several areas and/or entities into a single named tile. Same picker
// shape (search, area filter, area checkboxes) as openEntityPickerMulti()/
// openGroupEntityPicker() above, plus a name field, but scoped to
// combo.areaIds/combo.entityIds rather than the widget's own top-level
// selections. Deliberately independent of the widget's top-level picks —
// no cross-checking against those or other combo groups, a documented
// simplification rather than an oversight (see the equivalent comment in
// display.html's wireComboGroupEditor()).
function openComboGroupPicker(w, combo) {
  let ov = $('ha-entity-picker');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ha-entity-picker';
    ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => { if (e.target === ov) closeComboPicker(); });
    document.body.appendChild(ov);
  }
  if (!Array.isArray(combo.entityIds)) combo.entityIds = [];
  if (!Array.isArray(combo.areaIds)) combo.areaIds = [];
  const closeComboPicker = () => {
    ov.style.display = 'none';
    autoSaveLayout();
    drawWidgetSettingsPanel();
  };
  ov.innerHTML = `
    <div style="background:var(--bg);width:100%;max-width:520px;height:85vh;display:flex;flex-direction:column;border-radius:18px 18px 0 0;padding:16px 16px 0">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
        <div style="flex:1;font-size:16px;font-weight:600">Combo Group</div>
        <button class="btn" id="ha-entity-close" style="background:var(--card);border:1px solid var(--border);flex-shrink:0;width:auto;margin-top:0;padding:12px 16px">Done</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding-bottom:20px">
        <input class="form-input" id="ha-combo-name-input" value="${escapeHtml(combo.name || '')}" placeholder="e.g. Upstairs"
          style="width:100%;font-size:16px;padding:12px 14px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin:4px 0 6px">Add an Area</div>
        <div id="ha-combo-area-picklist" style="margin-bottom:16px"></div>
        <div style="font-size:13px;font-weight:600;color:var(--muted);margin:4px 0 6px">Add Individual Entities</div>
        <input class="form-input" id="ha-entity-search" placeholder="Search entities…" autocomplete="off" style="width:100%;font-size:16px;padding:12px 14px;margin-bottom:10px">
        <select class="form-input" id="ha-area-filter" style="width:100%;font-size:14px;padding:10px 12px;margin-bottom:10px">
          <option value="">All areas</option>
        </select>
        <div id="ha-entity-list" style="font-size:13px;color:var(--muted)">Loading…</div>
      </div>
    </div>`;
  ov.style.display = 'flex';
  $('ha-entity-close').addEventListener('click', closeComboPicker);
  $('ha-combo-name-input').addEventListener('input', (e) => { combo.name = e.target.value; });

  const isCoveredByArea = (entityId) => {
    if (!combo.areaIds.length || !cachedHaAreas) return false;
    const areaId = (cachedHaAreas.entityAreas || {})[entityId];
    return !!areaId && combo.areaIds.includes(areaId);
  };
  const renderList = (items) => {
    const listEl = $('ha-entity-list');
    if (!listEl) return;
    if (!items.length) { listEl.innerHTML = `<p style="padding:20px 4px">No matching entities.</p>`; return; }
    listEl.innerHTML = items.map(e => {
      if (isCoveredByArea(e.entity_id)) {
        return `
        <div style="display:flex;align-items:center;gap:10px;width:100%;padding:12px 4px;border-bottom:1px solid var(--border);opacity:0.4">
          <input type="checkbox" checked disabled style="width:20px;height:20px;flex-shrink:0">
          <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
            <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}</span>
            <span style="font-size:11px;color:var(--muted)">Included via an area already in this group</span>
          </span>
        </div>`;
      }
      const checked = combo.entityIds.includes(e.entity_id);
      return `
      <button type="button" class="ha-entity-item" data-id="${escapeHtml(e.entity_id)}"
        style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <input type="checkbox" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;pointer-events:none">
        <span style="display:flex;flex-direction:column;align-items:flex-start;min-width:0">
          <span style="font-size:14px;color:var(--text)">${escapeHtml(e.friendly_name)}</span>
          <span style="font-size:11px;color:var(--muted)">${escapeHtml(e.entity_id)} — ${escapeHtml(e.state)}${e.unit ? ' ' + escapeHtml(e.unit) : ''}</span>
        </span>
      </button>`;
    }).join('');
    listEl.querySelectorAll('.ha-entity-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const idx = combo.entityIds.indexOf(id);
        if (idx >= 0) combo.entityIds.splice(idx, 1);
        else combo.entityIds.push(id);
        renderList(currentList());
      });
    });
  };
  const currentList = () => {
    if (!cachedHaEntities) return [];
    const q = ($('ha-entity-search').value || '').trim().toLowerCase();
    const areaId = $('ha-area-filter') ? $('ha-area-filter').value : '';
    let list = cachedHaEntities;
    if (areaId) {
      const entityAreas = (cachedHaAreas && cachedHaAreas.entityAreas) || {};
      list = list.filter(en => entityAreas[en.entity_id] === areaId);
    }
    if (q) list = list.filter(en => en.friendly_name.toLowerCase().includes(q) || en.entity_id.toLowerCase().includes(q));
    return list;
  };
  const renderAreaPicklist = () => {
    const el = $('ha-combo-area-picklist');
    if (!el) return;
    if (!cachedHaAreas || !cachedHaAreas.areas.length) {
      el.innerHTML = `<p style="font-size:12px;color:var(--muted)">No areas found in Home Assistant.</p>`;
      return;
    }
    el.innerHTML = cachedHaAreas.areas.map(a => {
      const checked = combo.areaIds.includes(a.id);
      return `
      <button type="button" class="ha-area-item" data-area-id="${escapeHtml(a.id)}"
        style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:transparent;border:none;border-bottom:1px solid var(--border);padding:12px 4px;cursor:pointer">
        <input type="checkbox" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0;pointer-events:none">
        <span style="font-size:14px;color:var(--text)">${escapeHtml(a.name)}</span>
      </button>`;
    }).join('');
    el.querySelectorAll('.ha-area-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const areaId = btn.dataset.areaId;
        const idx = combo.areaIds.indexOf(areaId);
        if (idx >= 0) combo.areaIds.splice(idx, 1);
        else combo.areaIds.push(areaId);
        renderAreaPicklist();
        renderList(currentList());
      });
    });
  };

  (async () => {
    const [entitiesResult] = await Promise.all([
      cachedHaEntities ? Promise.resolve(cachedHaEntities) : apiFetch('/api/ha/entities'),
      ensureHaAreasLoaded(),
    ]);
    if (Array.isArray(entitiesResult)) {
      cachedHaEntities = entitiesResult;
    } else if (!cachedHaEntities) {
      $('ha-entity-list').innerHTML = `<p style="padding:20px 4px">⚠️ ${escapeHtml((entitiesResult && entitiesResult.error) || 'Could not load entities')}</p>`;
      return;
    }
    const areaSelect = $('ha-area-filter');
    if (areaSelect && cachedHaAreas && cachedHaAreas.areas.length) {
      areaSelect.innerHTML = `<option value="">All areas</option>` +
        cachedHaAreas.areas.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    } else if (areaSelect) {
      areaSelect.style.display = 'none';
    }
    renderAreaPicklist();
    renderList(cachedHaEntities);
  })();

  $('ha-entity-search').addEventListener('input', () => renderList(currentList()));
  $('ha-area-filter').addEventListener('change', () => renderList(currentList()));
}

// Lightweight bottom-sheet used by the chore editors.
function showSheet(html) {
  let ov = $('chore-sheet');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'chore-sheet';
    ov.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end;justify-content:center';
    ov.addEventListener('click', e => { if (e.target === ov) closeSheet(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div style="background:var(--bg);width:100%;max-width:520px;max-height:90vh;overflow-y:auto;border-radius:18px 18px 0 0;padding:22px 20px 30px">${html}</div>`;
  ov.style.display = 'flex';
}
function closeSheet() { const ov = $('chore-sheet'); if (ov) ov.style.display = 'none'; }

// ── Settings ──────────────────────────────────────────────────────────────────
// ── Settings ──────────────────────────────────────────────────────────────────
// Timezone override dropdown: every IANA zone the browser knows about, each
// labeled with its current UTC offset (and named abbreviation like CDT/PST
// when the browser exposes one). Computed fresh at render time rather than
// hardcoded, since a zone's offset changes across DST — a label baked in at
// one time of year would be wrong the other half of it. No "Custom…" entry:
// this list is meant to be exhaustive enough that free-text entry is never
// needed.

// Broad fallback zone list for browsers without Intl.supportedValuesOf
// (older Safari, etc.) — used only when the full enumeration API isn't
// available, so those users still get a decent picker rather than nothing.
const FALLBACK_TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'America/Toronto', 'America/Mexico_City', 'UTC', 'Europe/London', 'Europe/Paris',
  'Europe/Athens', 'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Australia/Perth', 'Pacific/Auckland',
];

// Current offset of an IANA zone from UTC, in minutes (positive = east of
// UTC). Computed by diffing the same instant's wall-clock reading in the
// target zone vs. UTC, rather than relying on Intl's newer 'shortOffset'/
// 'longOffset' timeZoneName values, so it works on older browser engines too.
function tzOffsetMinutes(tz) {
  const now = new Date();
  const fieldsIn = (zone) => {
    const parts = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now)) parts[p.type] = p.value;
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second);
  };
  try { return Math.round((fieldsIn(tz) - fieldsIn('UTC')) / 60000); }
  catch { return 0; }
}

// e.g. "CDT, UTC-5" or just "UTC+5:30" when the browser has no distinct
// named abbreviation for the zone.
function tzOffsetLabel(tz) {
  const mins = tzOffsetMinutes(tz);
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  const offsetStr = `UTC${sign}${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}`;
  let abbr = '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short', hour: '2-digit' }).formatToParts(new Date());
    const p = parts.find(x => x.type === 'timeZoneName');
    if (p && p.value && !/^GMT|^UTC/.test(p.value)) abbr = p.value;
  } catch { /* fall back to numeric offset only */ }
  return abbr ? `${abbr}, ${offsetStr}` : offsetStr;
}

const TZ_AREAS = {
  de: { Europe: 'Europa', America: 'Amerika', Asia: 'Asien', Africa: 'Afrika', Australia: 'Australien', Atlantic: 'Atlantik', Pacific: 'Pazifik', Indian: 'Indischer Ozean', Antarctica: 'Antarktis', Arctic: 'Arktis' },
  fr: { Europe: 'Europe', America: 'Amérique', Asia: 'Asie', Africa: 'Afrique', Australia: 'Australie', Atlantic: 'Atlantique', Pacific: 'Pacifique', Indian: 'océan Indien', Antarctica: 'Antarctique', Arctic: 'Arctique' },
  es: { Europe: 'Europa', America: 'América', Asia: 'Asia', Africa: 'África', Australia: 'Australia', Atlantic: 'Atlántico', Pacific: 'Pacífico', Indian: 'océano Índico', Antarctica: 'Antártida', Arctic: 'Ártico' },
};
// e.g. "America/Argentina/Buenos_Aires" -> "Buenos Aires (Argentina)";
// "Europe/London" -> "London (Europe)"; "UTC" -> "UTC".
function tzFriendlyName(tz) {
  if (tz === 'UTC') return 'UTC';
  const segs = tz.split('/');
  const last = segs[segs.length - 1].replace(/_/g, ' ');
  if (segs.length === 1) return last;
  let mid = segs.length === 3 ? segs[1].replace(/_/g, ' ') : segs[0].replace(/_/g, ' ');
  // the continent / ocean part in the household language (city names are left as they are)
  const lang = (window.i18n && i18n.lang) || 'en';
  if (TZ_AREAS[lang] && TZ_AREAS[lang][mid]) mid = TZ_AREAS[lang][mid];
  return `${last} (${mid})`;
}

// Builds the full option list, sorted by current UTC offset (then name).
// `currentValue` — the device's already-saved timezone_override — is
// appended if somehow missing from the enumerated set (e.g. a value saved
// under a browser with the full list, now being viewed from one without
// Intl.supportedValuesOf), so an existing setting never silently vanishes
// from the dropdown on save.
function buildTimezoneOptions(currentValue) {
  const opts = [['', "Use Pi's system clock (default)"]];
  let zones;
  try { zones = (typeof Intl.supportedValuesOf === 'function') ? Intl.supportedValuesOf('timeZone') : null; }
  catch { zones = null; }
  if (!zones || !zones.length) zones = FALLBACK_TIMEZONES;
  if (currentValue && !zones.includes(currentValue)) zones = [...zones, currentValue];

  const withOffsets = zones.map(tz => ({ tz, mins: tzOffsetMinutes(tz), name: tzFriendlyName(tz) }));
  withOffsets.sort((a, b) => a.mins - b.mins || a.name.localeCompare(b.name));
  for (const z of withOffsets) opts.push([z.tz, `${z.name} — ${tzOffsetLabel(z.tz)}`]);
  return opts;
}
async function renderSettings() {
  const _st = {};
  const [s, bs, ps, verInfo, supportLinks, cs, gs, hs, haAlertsResp, phoneAlerts, notifPrefsResp] = await Promise.all([
    apiFetch('/api/settings'),
    apiFetch('/api/briefing-settings'),
    apiFetch('/api/photo-settings'),
    apiFetch('/api/version'),
    apiFetch('/api/support-links'),
    apiFetch('/api/caldav-settings'),
    apiFetch('/api/google-settings'),
    apiFetch('/api/handwriting-settings'),
    apiFetch('/api/ha-alerts').catch(() => ({ alerts: [] })),
    apiFetch('/api/phone-alerts').catch(() => ({ enabled: '0', setup_url: '' })),
    apiFetch('/api/notif-prefs').catch(() => ({ kinds: [], prefs: {} })),
  ]);

  const haAlerts = (haAlertsResp && Array.isArray(haAlertsResp.alerts)) ? haAlertsResp.alerts : [];
  window.__haAlerts = haAlerts.slice();
  window.__phoneAlertsSetupUrl = (phoneAlerts && phoneAlerts.setup_url) || '';
  const notifKinds = (notifPrefsResp && Array.isArray(notifPrefsResp.kinds)) ? notifPrefsResp.kinds : [];
  const notifPrefs = (notifPrefsResp && notifPrefsResp.prefs) || {};
  window.__notifPrefs = JSON.parse(JSON.stringify(notifPrefs));
  // Beta Checklist is a testing tool, not something a real end user on a
  // stable release should ever see — matches the server's own gate on
  // both /api/beta-checklist endpoints (isBetaVersion()), so hiding the
  // section here is a UI nicety on top of an actual enforcement, not the
  // only thing standing between a stable build and this feature.
  const isBeta = !!(verInfo && verInfo.isBeta);
  window.__isDemo = !!(verInfo && verInfo.demo);
  // Fetched up front (not after the template renders) specifically so the
  // WHOLE "Support the Project" section — header included, now that it's
  // its own standalone accordion entry rather than tucked inside Feedback
  // & Ideas — only exists in the DOM when there's actually a link to show.
  // Rendering the header unconditionally and hiding just the card inside
  // it (the original approach) would leave a real, tappable, permanently
  // empty accordion entry on any install where neither link is
  // configured — worse than the card just quietly not existing.
  const hasSupportLinks = !!(supportLinks && (supportLinks.stripeUrl || supportLinks.paypalUrl));
  const supportButtonsHtml = [
    supportLinks && supportLinks.stripeUrl ? `<a href="${supportLinks.stripeUrl.replace(/"/g,'&quot;')}" target="_blank" rel="noopener" class="settings-save" style="text-decoration:none;text-align:center;flex:1;min-width:140px">☕ Buy me a coffee</a>` : '',
    supportLinks && supportLinks.paypalUrl ? `<a href="${supportLinks.paypalUrl.replace(/"/g,'&quot;')}" target="_blank" rel="noopener" class="settings-save" style="text-decoration:none;text-align:center;flex:1;min-width:140px;background:var(--card);border:1px solid var(--border);color:var(--text)">PayPal</a>` : '',
  ].filter(Boolean).join('');
  const tzOptions = buildTimezoneOptions(s.timezone_override || '');
  renderSettings_Build_contentMarkup({ s, bs, ps, cs, gs, hs, phoneAlerts, haAlerts, notifKinds, notifPrefs, isBeta, hasSupportLinks, supportButtonsHtml, tzOptions });
  renderSettings_Wire_block1982Etc();

  // ── Custom theme: background + up to 3 decorations ───────────────────────────
  renderSettings_wireCustomTheme();

  // ── Saved custom themes: named snapshots of the background/decorations above ──
  renderSettings_wireSavedThemes();

  // ── Beta Checklist viewer ────────────────────────────────────────────────
  renderSettings_wireBetaChecklist({ renderChecklistMarkdown });

  // Small, purpose-built markdown renderer for BETA_CHECKLIST.md
  // specifically — deliberately not the same formatReleaseNotes() used for
  // update notes below, which intentionally STRIPS headers (flat bullets
  // are the right shape there); this file's whole point is organization BY
  // beta build, so headers need to render, not disappear. Handles just
  // what this one file actually uses: #/##/### headers, "- [ ] "/"- [x] "
  // checklist items (☐/✅, tappable — see wireBetaChecklistTaps below),
  // plain "- " bullets, "---" dividers, and **bold** inline.
  //
  // Real bug fixed here: items in this file are word-wrapped across
  // several physical source lines for readability in a text editor —
  //   - [ ] Confirm the Favorites tab actually renders correctly on a
  //     real phone screen — only checked for valid HTML/JS...
  // — and the first version of this renderer processed one physical line
  // at a time, so only that first line was ever recognized as the
  // checklist item; every wrapped continuation line fell through to the
  // "plain paragraph" branch instead, rendering in a completely different
  // (dimmer, unstyled) visual treatment right below its own bullet. Fixed
  // by grouping lines into logical blocks FIRST (a block starts at any
  // header/rule/checklist-item/bullet line and keeps absorbing subsequent
  // lines as continuation text until a blank line or the next block
  // starts), then rendering one block at a time — so a wrapped item's
  // text is properly reassembled into the single list item it always was.
  //
  // Each checklist item also gets a stable 0-based `data-index` (its
  // position among ALL checklist items in the file, top to bottom) —
  // this is exactly the same numbering PUT /api/beta-checklist/toggle
  // uses server-side to find and flip the right line, so tapping an item
  // client-side and toggling it server-side always agree on which one.
  function renderChecklistMarkdown(raw, checkedIndices) {
    checkedIndices = checkedIndices || new Set();
    const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const rawLines = String(raw).split(/\r?\n/);

    // Pass 1: group physical lines into logical blocks.
    const HEADER_RE = /^(#{1,3})\s+(.*)/;
    const HR_RE = /^---+$/;
    const CHK_RE = /^[-*]\s+\[( |x|X)\]\s+(.*)/;
    const BULLET_RE = /^[-*]\s+(.*)/;
    const blocks = [];
    let current = null;
    const flush = () => { if (current) { blocks.push(current); current = null; } };
    for (const rawLine of rawLines) {
      const t = rawLine.trim();
      if (!t) { flush(); continue; }
      if (HR_RE.test(t)) { flush(); blocks.push({ type: 'hr' }); continue; }
      const h = t.match(HEADER_RE);
      if (h) { flush(); blocks.push({ type: 'h', level: h[1].length, text: h[2] }); continue; }
      const chk = t.match(CHK_RE);
      // Note: chk[1] ([ ] vs [x] in the file text itself) is deliberately
      // NOT used for done-state anymore — see checkedIndices below. Only
      // matched here to recognize the line AS a checklist item at all.
      if (chk) { flush(); current = { type: 'chk', text: chk[2] }; continue; }
      const bullet = t.match(BULLET_RE);
      if (bullet) { flush(); current = { type: 'li', text: bullet[1] }; continue; }
      // Continuation of whatever block is currently open; if nothing's
      // open this is a bare paragraph line on its own.
      if (current) { current.text += ' ' + t; }
      else { current = { type: 'p', text: t }; }
    }
    flush();

    // Pass 2: render blocks, tracking checklist items' 0-based index.
    let html = '';
    let inList = false;
    let chkIndex = 0;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (const b of blocks) {
      if (b.type === 'hr') { closeList(); html += '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">'; continue; }
      if (b.type === 'h') {
        closeList();
        const size = b.level === 1 ? '16px' : b.level === 2 ? '14.5px' : '13.5px';
        const margin = b.level === 1 ? '16px 0 8px' : '18px 0 6px';
        html += `<div style="font-weight:700;font-size:${size};margin:${margin}">${inline(b.text)}</div>`;
        continue;
      }
      if (b.type === 'chk') {
        if (!inList) { html += '<ul style="list-style:none;margin:0;padding:0">'; inList = true; }
        const idx = chkIndex++;
        const done = checkedIndices.has(idx);
        html += `<li class="beta-checklist-item" data-index="${idx}" data-done="${done ? '1' : '0'}" style="display:flex;gap:8px;margin-bottom:6px;cursor:pointer;${done?'opacity:.55;text-decoration:line-through':''}"><span class="beta-checklist-mark">${done?'✅':'☐'}</span><span>${inline(b.text)}</span></li>`;
        continue;
      }
      if (b.type === 'li') {
        if (!inList) { html += '<ul style="margin:0;padding-left:18px">'; inList = true; }
        html += `<li style="margin-bottom:5px">${inline(b.text)}</li>`;
        continue;
      }
      closeList();
      html += `<p style="margin:0 0 8px;color:var(--muted)">${inline(b.text)}</p>`;
      continue;
    }
    closeList();
    return html || '<p style="color:var(--muted)">Empty.</p>';
  }

  // Uses fetch+blob rather than a plain link/redirect specifically so a failure
  // (e.g. the "zip" command missing on this Pi) shows a clear error message
  // instead of the browser just navigating to a raw JSON error page.
  renderSettings_wireBackup();

  // ── Backup restore ───────────────────────────────────────────────────────
  // Deliberately a separate, more cautious flow than the download side: picking
  // a file doesn't do anything by itself (just reveals the actual restore
  // button), and the restore button itself confirms before touching anything,
  // since this genuinely replaces all current data.
  renderSettings_wireRestore();

  // ── Feedback section wiring ─────────────────────────────────────────────────
  renderSettings_wireFeedback({ s });

  // ── News source rows: star = priority toggle, checkbox = enable (dims when off) ─
  (function wireNewsSources() {
    ['national','world','local','keywords'].forEach(src => {
      const star = $(`news-${src}-priority-btn`);
      const toggle = $(`news-${src}-enabled`);
      const row = document.querySelector(`.news-src[data-src="${src}"]`);
      if (star) star.addEventListener('click', () => star.classList.toggle('on'));
      const sync = () => { if (row) row.classList.toggle('disabled', toggle && !toggle.checked); };
      if (toggle) toggle.addEventListener('change', sync);
      sync();
    });
  })();

  // ── Multi-Device (host/slave) wiring ────────────────────────────────────────
  renderSettings_wireMultiDevice({ renderOtherDevicesBody });
  // Separate top-level function (not nested in wireMultiDevice's IIFE) so the
  // revoke handler below can call it again to refresh the list in place,
  // without re-running all of wireMultiDevice's other one-time wiring.
  async function renderOtherDevicesBody() {
    const body = $('md-other-devices-body');
    if (!body) return;
    body.innerHTML = 'Loading…';
    const r = await apiFetch('/api/license-devices');
    if (!r || r.error) {
      body.innerHTML = `<p style="font-size:12px;color:var(--muted)">${escapeHtml((r && r.error) || 'Could not load — this device may not have a license key configured yet.')}</p>`;
      return;
    }
    const devices = r.devices || [];
    if (!devices.length) {
      body.innerHTML = '<p style="font-size:12px;color:var(--muted)">No devices on file for this license yet.</p>';
      return;
    }
    body.innerHTML = devices.map(d => {
      const isSelf = d.deviceId === r.ownDeviceId;
      const roleLabel = d.role === 'host' ? (d.isRecognizedHost ? 'Host' : 'Host — conflicting') : 'Display';
      const lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'never';
      const sub = [d.ip, d.version ? 'v' + d.version : '', 'last seen ' + lastSeen].filter(Boolean).join(' · ');
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border)">
        <div style="min-width:0">
          <div style="font-weight:600;font-size:13px">${escapeHtml(d.name || d.deviceId)} <span style="font-weight:400;color:${d.role==='host' && !d.isRecognizedHost ? '#e0433a' : 'var(--muted)'}">· ${roleLabel}</span></div>
          <div style="font-size:11px;color:var(--muted)">${escapeHtml(sub)}</div>
        </div>
        ${isSelf
          ? '<span style="font-size:11px;color:var(--muted);flex-shrink:0">This device</span>'
          : `<button class="icon-btn del" data-revoke-id="${escapeHtml(d.deviceId)}" data-revoke-name="${escapeHtml(d.name || d.deviceId)}" title="Remove from this license">🗑️</button>`
        }
      </div>`;
    }).join('');
    body.querySelectorAll('[data-revoke-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.revokeId, name = btn.dataset.revokeName;
        if (!confirm(`Remove "${name}" from this license?\n\nOnly do this for hardware you've actually retired or don't recognize — a device still genuinely in use will just get flagged again the next time it checks in.`)) return;
        const r = await apiFetch(`/api/license-devices/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
        if (r && r.error) { showToast('Could not remove: ' + r.error); return; }
        showToast(`Removed "${name}"`);
        renderOtherDevicesBody();
      });
    });
  }

  // Transform the flat settings sections into a collapsible accordion (with an
  // Advanced group that can be shown/hidden). Done as a DOM pass so all the inputs
  // and their handlers below keep working by ID.
  transformSettingsToAccordion();
  // Fill the "Family profiles" card (list + add/edit buttons) now that the
  // accordion structure exists.
  try { renderProfilesSettingsBody(); } catch (e) { console.error('profiles settings', e); }
  try { renderRemoteAuthPanel(); } catch (e) { console.error('remote auth panel', e); }
  try { renderRemoteLinkPanel(true); } catch (e) { console.error('remote link panel', e); }
  try { renderWxAlertTypes(); } catch (e) { console.error('weather alert types', e); }
  // The Daily Briefing's fields are themselves a nested accordion — wire it so its
  // sub-sections expand/collapse independently (like the Advanced group).
  wireAccordion('briefing-accordion');
  // Home Assistant Control's setup walkthroughs are collapsed by default (closed
  // on every render) to keep the section short — the token/fields above stay
  // visible, only the "how do I wire this up" prose hides behind a toggle.
  wireAccordion('s-automation-instructions');
  if ($('s-mqtt-fields')) wireAccordion('s-mqtt-fields');

  // Settings search: build the index from the accordion structure just
  // created above, then wire the search box. Must run after
  // transformSettingsToAccordion() so section/group elements + their
  // toggle buttons already exist to index against.
  buildSettingsSearchIndex();
  wireSettingsSearch();

  // ── Software Update wiring ──────────────────────────────────────────────────
  // Turn raw changelog text into tidy HTML: drop the "## version" header line, and
  // render "- " bullets as a clean list, joining hard-wrapped continuation lines so
  // sentences don't break mid-word on a narrow phone screen.
  function formatReleaseNotes(raw) {
    const esc = (s) => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const lines = String(raw).split(/\r?\n/);
    const items = []; let cur = null; let preamble = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (/^#{1,6}\s/.test(t) || /^v?\d+\.\d+\.\d+\b/.test(t)) continue; // skip version headers
      const m = t.match(/^[-*]\s+(.*)/);
      if (m) { if (cur !== null) items.push(cur); cur = m[1]; }
      else if (cur !== null) { cur += ' ' + t; }   // continuation of the current bullet
      else { preamble.push(t); }                    // text before any bullet
    }
    if (cur !== null) items.push(cur);
    let html = '';
    if (preamble.length) html += `<div style="margin-bottom:8px">${esc(preamble.join(' '))}</div>`;
    if (items.length) {
      html += `<ul style="margin:0;padding-left:18px">` +
        items.map(i => `<li style="margin-bottom:6px">${esc(i)}</li>`).join('') + `</ul>`;
    } else if (!preamble.length) {
      html = esc(String(raw));
    }
    return html;
  }

  // Local-only preference — writes straight to localStorage on change,
  // deliberately NOT routed through the server-settings auto-save
  // mechanism the rest of this form uses, since this never touches the
  // backend at all (see tabsAutohideEnabled() for why).
  // The household language: saved at once, then the page reloads into it (the translation layer is loaded with the page).
  const uiLangSelect = $('s-ui-language');
  if (uiLangSelect) {
    uiLangSelect.addEventListener('change', async () => {
      const lang = uiLangSelect.value;
      window.__languageSwitching = true;   // the form's own autosave would write the old time / date format straight back
      try { await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ ui_language: lang }) }); } catch {}
      if (window.i18n) window.i18n.setLanguage(lang);
    });
  }
  // The currency money amounts are shown in (empty = the language's usual one). This browser uses it at once; the form's own save stores it for everyone.
  const currencySelect = $('s-currency');
  if (currencySelect) currencySelect.addEventListener('change', () => { if (window.i18n && window.i18n.setCurrency) window.i18n.setCurrency(currencySelect.value); });
  const defaultTabSelect = $('s-default-tab');
  if (defaultTabSelect) {
    defaultTabSelect.addEventListener('change', () => {
      try { localStorage.setItem('default_tab', defaultTabSelect.value); } catch {}
    });
  }
  const tabsAutohideCheckbox = $('s-tabs-autohide');
  if (tabsAutohideCheckbox) {
    tabsAutohideCheckbox.addEventListener('change', () => {
      try { localStorage.setItem('tabs_autohide', tabsAutohideCheckbox.checked ? '1' : '0'); } catch {}
    });
  }
  const pullRefreshCheckbox = $('s-pull-refresh');
  if (pullRefreshCheckbox) {
    pullRefreshCheckbox.addEventListener('change', () => {
      try { localStorage.setItem('pull_refresh_enabled', pullRefreshCheckbox.checked ? '1' : '0'); } catch {}
    });
  }

  renderSettings_wireUpdate();

  // ── Update Backups: list, download, restore ────────────────────────────
  // Populated once per Settings render, same "fetch on tab open" pattern as
  // everything else here — backups only ever change as a side effect of an
  // update or restore actually running, both of which already reload this
  // page via their own restart-and-reconnect flow, so there's no need for
  // this list to live-update on its own.
  renderSettings_Wire_loadUpdateBackupsList();

  // Shared "a location was resolved/confirmed" success path — used both for
  // the normal single-match case and after the person picks one candidate
  // from an ambiguous-match picker (see below).
  function applyZipSuccess(label) {
    $('zip-result').textContent = '📍 ' + (label || '');
    showToast('Location saved ✓');
    // Only overwrite the Location Name field if it still matches the previous
    // auto-derived value (i.e. the person hasn't typed their own custom label) —
    // a fresh lookup shouldn't clobber an intentional manual override.
    const locField = $('s-weather-location');
    if (locField && locField.value.trim() === (s.weather_location_auto || '')) {
      locField.value = label || '';
    }
    s.weather_location_auto = label || ''; // keep save-comparison baseline current
  }

  // Renders one tappable button per candidate inside #zip-result when a ZIP/
  // postal code matched more than one real, distinct place (e.g. a plain
  // 5-digit code matching both a US ZIP and an unrelated postal code
  // overseas) — built with real DOM nodes rather than an HTML string so a
  // candidate's label never needs manual escaping.
  function renderZipCandidates(zip, candidates) {
    const wrap = $('zip-result');
    wrap.textContent = '';
    const prompt = document.createElement('div');
    prompt.textContent = `That matched more than one place — which is yours?`;
    prompt.style.marginBottom = '6px';
    wrap.appendChild(prompt);
    for (const c of candidates) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost small';
      btn.textContent = '📍 ' + (c.label || c.display_name || '');
      btn.style.display = 'block';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.marginTop = '4px';
      btn.addEventListener('click', async () => {
        wrap.textContent = 'Saving…';
        try {
          await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({
            weather_lat: c.lat, weather_lon: c.lon, weather_zip: zip, weather_location_auto: c.label,
          }) });
          applyZipSuccess(c.label);
        } catch {
          wrap.textContent = '❌ Could not save that selection — check your connection.';
        }
      });
      wrap.appendChild(btn);
    }
  }

  $('zip-lookup-btn').addEventListener('click', async () => {
    const zip = $('s-zip').value.trim();
    if (!zip) { $('zip-result').textContent = 'Enter a ZIP/postal code first'; return; }
    $('zip-lookup-btn').textContent = 'Looking up…';
    $('zip-lookup-btn').disabled = true;
    const r = await apiFetch('/api/geocode?zip=' + encodeURIComponent(zip));
    $('zip-lookup-btn').textContent = 'Look up';
    $('zip-lookup-btn').disabled = false;
    if (r.error) {
      $('zip-result').textContent = '❌ ' + r.error;
    } else if (r.ambiguous) {
      renderZipCandidates(zip, r.candidates || []);
    } else {
      applyZipSuccess(r.location_label || (r.display_name || '').split(',').slice(0, 2).join(','));
    }
  });

  // ── iCloud CalDAV push ────────────────────────────────────────────────────
  if ($('s-icloud-discover-btn')) {
    renderSettings_Wire_sIcloudDiscoverBtn();
  }
  if ($('s-icloud-save-btn')) {
    renderSettings_Wire_sIcloudSaveBtn();
  }

  // ── Google Calendar push ──────────────────────────────────────────────────
  if (window.__googlePoll) { clearTimeout(window.__googlePoll); window.__googlePoll = null; } // stop any poll from a prior render
  if ($('s-google-client-save-btn')) {
    $('s-google-client-save-btn').addEventListener('click', async () => {
      const id = ($('s-google-client-id').value || '').trim();
      const secret = ($('s-google-client-secret').value || '').trim();
      if (!id || !secret) return;
      $('s-google-client-save-btn').disabled = true;
      try {
        await apiFetch('/api/google-settings', { method: 'PUT', body: JSON.stringify({ google_oauth_client_id: id, google_oauth_client_secret: secret }) });
        showToast('✓ Client credentials saved');
        await renderSettingsKeepPlace();
      } catch { $('s-google-client-save-btn').disabled = false; }
    });
  }
  if ($('s-google-connect-btn')) {
    renderSettings_Wire_sGoogleConnectBtn();
  }
  renderSettings_Wire_sGoogleDisconnectBtnEtc();

  // Best-effort local-network scan (see /api/ha/discover's own comments for
  // what it actually tries) — a convenience for the common case, not a
  // guarantee; the URL field stays freely editable either way, and a
  // negative result just says so rather than treating it as an error.
  if ($('s-ha-detect-btn')) {
    renderSettings_Wire_sHaDetectBtn({ updateHaTokenLink });
  }
  // Once there's a URL (auto-detected or typed), point the "create a token"
  // link straight at that instance's own Security tab, so it's a real
  // one-tap deep link rather than just written instructions — same
  // information either way, this just saves the manual navigation.
  function updateHaTokenLink() {
    const linkEl = $('s-ha-token-link');
    if (!linkEl) return;
    const url = $('s-ha-url') ? $('s-ha-url').value.trim().replace(/\/+$/, '') : '';
    if (url) { linkEl.href = `${url}/profile/security`; linkEl.style.display = 'inline-block'; }
    else { linkEl.style.display = 'none'; }
  }
  if ($('s-ha-url')) {
    $('s-ha-url').addEventListener('input', updateHaTokenLink);
    updateHaTokenLink(); // reflect whatever's already saved, on first render
  }

  if ($('s-ha-test-btn')) {
    renderSettings_Wire_sHaTestBtn();
  }

  // ── Phone alerts (relayed through the mothership) ──────────────────────────
  if ($('s-phone-alerts')) {
    $('s-phone-alerts').addEventListener('change', async (e) => {
      try { await apiFetch('/api/phone-alerts', { method: 'PUT', body: JSON.stringify({ enabled: e.target.checked ? '1' : '0' }) }); showToast(e.target.checked ? 'Phone alerts on' : 'Phone alerts off'); }
      catch { e.target.checked = !e.target.checked; showToast('Could not save'); }
    });
  }
  if ($('s-phone-alerts-setup')) {
    $('s-phone-alerts-setup').addEventListener('click', () => {
      const u = window.__phoneAlertsSetupUrl;
      if (u) window.open(u, '_blank', 'noopener');
      else showToast('No license key on this device yet');
    });
  }

  // ── Home Assistant condition alerts ────────────────────────────────────────
  if ($('s-haalert-add-btn')) {
    renderSettings_Wire_sHaalertAddBtn();
  }

  // ── Per-kind notification delivery matrix ─────────────────────────────────
  if ($('s-notifprefs')) {
    renderSettings_Wire_sNotifprefs();
  }

  // ── Voice control (Siri Shortcuts) token ────────────────────────────────────
  // Generation happens server-side (crypto.randomBytes) rather than letting
  // someone type their own value — unlike ha_token (pasted from HA itself,
  // already strong), nothing else vouches for this one's strength.
  renderSettings_Wire_sVoiceTokenShowBtnEtc();
  if ($('s-mqtt-test-btn')) {
    renderSettings_Wire_sMqttTestBtn();
  }
  if ($('s-mqtt-save-btn')) {
    renderSettings_Wire_sMqttSaveBtn();
  }

  // Individual ticker tracking moved to each Stock widget's own settings in
  // v1.77.77 — see the w.type === 'stocks' branch in the widget settings
  // wiring for the replacement (per-widget renderWTickerChips()/addWTicker()).

  // Daily Briefing — enable toggle shows/hides the config fields
  $('bf-enabled').addEventListener('change', (e) => {
    $('bf-fields').style.opacity = e.target.checked ? '1' : '.4';
    $('bf-fields').style.pointerEvents = e.target.checked ? 'auto' : 'none';
  });

  // ── Briefing recipients ──────────────────────────────────────────────────────
  async function renderRecipientList() {
    const recipients = await apiFetch('/api/briefing-recipients');
    const container = $('bf-recipient-list');
    if (!container) return; // panel may have been navigated away from
    if (!Array.isArray(recipients) || !recipients.length) {
      container.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">No recipients yet — add one below.</p>`;
      return;
    }
    container.innerHTML = recipients.map(r => `
      <div class="recipient-row" data-id="${r.id}" style="display:flex;align-items:center;gap:8px;
        background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 10px;${r.enabled?'':'opacity:.45'}">
        <input type="checkbox" class="recipient-enabled-cb" data-id="${r.id}" ${r.enabled?'checked':''}
          style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name || '(no name)'}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.email}</div>
        </div>
        <button class="recipient-del-btn" data-id="${r.id}" style="background:none;border:none;color:var(--muted);
          font-size:18px;line-height:1;cursor:pointer;padding:4px 6px;flex-shrink:0">🗑️</button>
      </div>
    `).join('');

    container.querySelectorAll('.recipient-enabled-cb').forEach(cb => {
      cb.addEventListener('change', async () => {
        await apiFetch(`/api/briefing-recipients/${cb.dataset.id}`, {
          method: 'PUT', body: JSON.stringify({ enabled: cb.checked }),
        });
        renderRecipientList();
      });
    });
    container.querySelectorAll('.recipient-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await apiFetch(`/api/briefing-recipients/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Recipient removed');
        renderRecipientList();
      });
    });
  }
  renderRecipientList();

  // ── Briefing Todoist project filter ────────────────────────────────────────
  // Tracked locally and saved as part of the broader
  // briefing settings save, rather than persisting on every checkbox toggle —
  // consistent with how the rest of this form behaves.
  let briefingProjectIds = (bs.briefing_todoist_project_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  async function renderBriefingProjectList() {
    const container = $('bf-project-list');
    if (!container) return;
    const result = await apiFetch('/api/todoist/projects');
    if (!Array.isArray(result)) {
      container.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">⚠️ ${result.error || 'Could not load Todoist projects — add a Todoist token in Settings first.'}</p>`;
      return;
    }
    if (!result.length) {
      container.innerHTML = `<p style="font-size:12px;color:var(--muted);margin:0">No Todoist projects found.</p>`;
      return;
    }
    // No filter saved yet = everything included (matches the "all projects" default)
    const activeSet = briefingProjectIds.length ? new Set(briefingProjectIds) : new Set(result.map(p => p.id));
    container.innerHTML = result.map(p => `
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:0;font-weight:400;font-size:13px;color:var(--text)">
        <input type="checkbox" class="bf-project-cb" data-id="${p.id}" ${activeSet.has(p.id) ? 'checked' : ''}
          style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
        ${escapeHtml(p.name)}
      </label>
    `).join('');
    container.querySelectorAll('.bf-project-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = [...container.querySelectorAll('.bf-project-cb:checked')].map(el => el.dataset.id);
        // Everything checked = store empty (means "all projects", future projects included automatically)
        briefingProjectIds = checked.length === result.length ? [] : checked;
      });
    });
  }
  renderBriefingProjectList();

  $('bf-add-recipient-btn').addEventListener('click', async () => {
    const name = $('bf-new-name').value.trim();
    const email = $('bf-new-email').value.trim();
    if (!email || !email.includes('@')) { showToast('Enter a valid email address'); return; }
    const result = await apiFetch('/api/briefing-recipients', {
      method: 'POST', body: JSON.stringify({ name, email }),
    });
    if (result.error) { showToast('❌ ' + result.error); return; }
    $('bf-new-name').value = '';
    $('bf-new-email').value = '';
    showToast(`${name || email} added ✓`);
    renderRecipientList();
  });

  // Helper: save the current briefing form fields (used before test/send-now so
  // those actions always reflect what's on screen, not stale saved values)
  async function saveBriefingFields() {
    // Guards every field now, not just some — this can genuinely run after
    // the Settings tab's own DOM has already been replaced (async, resumes
    // after the /api/settings PUT above completes, by which point someone
    // may have already navigated to a different tab), so none of these
    // elements can be assumed to still exist. Bails out entirely if the
    // core toggle isn't there — no meaningful save to make without it,
    // and building a body from a mix of real and silently-defaulted values
    // would be worse than just skipping this particular save.
    const bfEnabled = $('bf-enabled');
    if (!bfEnabled) return;
    const briefingBody = {
      briefing_enabled: bfEnabled.checked ? '1' : '0',
      briefing_time: $('bf-time') ? ($('bf-time').value || '07:00') : '07:00',
      briefing_provider: $('bf-provider') ? $('bf-provider').value : 'email',
      briefing_email_user: $('bf-email-user') ? $('bf-email-user').value.trim() : '',
      briefing_todoist_project_ids: (typeof briefingProjectIds !== 'undefined' && briefingProjectIds) ? briefingProjectIds.join(',') : '',
      briefing_task_scope: $('bf-task-scope') ? $('bf-task-scope').value : 'all',
      briefing_weather_format: $('bf-weather-format') ? $('bf-weather-format').value : 'summary',
      briefing_include_news: ($('bf-include-news') && $('bf-include-news').checked) ? '1' : '0',
      briefing_news_per_section: $('bf-news-per-section') ? $('bf-news-per-section').value : '3',
      briefing_include_stocks: ($('bf-include-stocks') && $('bf-include-stocks').checked) ? '1' : '0',
      briefing_include_reminders: ($('bf-include-reminders') && $('bf-include-reminders').checked) ? '1' : '0',
    };
    const newPass = $('bf-email-pass') ? $('bf-email-pass').value.trim() : '';
    if (newPass !== '') briefingBody.briefing_email_pass = newPass;
    await apiFetch('/api/briefing-settings', { method: 'PUT', body: JSON.stringify(briefingBody) });
  }

  // Collects every auto-saveable settings field into one body object. Deliberately
  // excludes the PIN field — see saveAllSettings() for why.
  function collectSettingsBody() {
    const body = {
      ical_sync_minutes: $('s-sync-interval').value,
      todoist_token: $('s-todoist').value.trim(),
      ha_base_url: $('s-ha-url') ? $('s-ha-url').value.trim() : '',
      ha_token: $('s-ha-token') ? $('s-ha-token').value.trim() : '',
      stock_indices_disabled: Array.from(document.querySelectorAll('.stock-index-cb'))
        .filter(cb => !cb.checked).map(cb => cb.dataset.sym).join(','),
      weather_refresh_min: $('s-weather-refresh') ? $('s-weather-refresh').value : '15',
      weather_provider: $('s-weather-provider') ? $('s-weather-provider').value : 'open-meteo',
      weather_unit: $('s-weather-unit') ? $('s-weather-unit').value : 'fahrenheit',
      weather_api_key: $('s-weather-api-key') ? $('s-weather-api-key').value.trim() : '',
      travel_provider: $('s-travel-provider') ? $('s-travel-provider').value : 'osrm',
      travel_api_key: $('s-travel-api-key') ? $('s-travel-api-key').value.trim() : '',
      text_shadow: $('s-text-shadow') ? $('s-text-shadow').value : 'off',
      display_refresh_min: $('s-display-refresh') ? $('s-display-refresh').value : '0',
      force_real_display: ($('s-force-real-display') && $('s-force-real-display').checked) ? '1' : '0',
      week_start_day: $('s-week-start') ? $('s-week-start').value : '0',
      time_format: $('s-time-format') ? $('s-time-format').value : '12',
      ampm_case: $('s-ampm-case') ? $('s-ampm-case').value : 'lower',
      date_format: $('s-date-format') ? $('s-date-format').value : 'us_long',
      ...($('s-currency') ? { currency: $('s-currency').value } : {}),
      timezone_override: $('s-timezone') ? $('s-timezone').value : '',
      chores_enabled: ($('s-chores-enabled') && $('s-chores-enabled').checked) ? '1' : '0',
      todo_enabled: ($('s-todo-enabled') && $('s-todo-enabled').checked) ? '1' : '0',
      shopping_enabled: ($('s-shopping-enabled') && $('s-shopping-enabled').checked) ? '1' : '0',
      reminders_enabled: ($('s-reminders-enabled') && $('s-reminders-enabled').checked) ? '1' : '0',
      messageboard_enabled: ($('s-messageboard-enabled') && $('s-messageboard-enabled').checked) ? '1' : '0',
      messageboard_autoclear_days: $('s-messageboard-autoclear-days') ? String(Math.max(0, parseInt($('s-messageboard-autoclear-days').value, 10) || 0)) : '14',
      mealplan_enabled: ($('s-mealplan-enabled') && $('s-mealplan-enabled').checked) ? '1' : '0',
      flightmap_enabled: ($('s-flightmap-enabled') && $('s-flightmap-enabled').checked) ? '1' : '0',
      severe_weather_alerts_enabled: ($('s-wxalert-enabled') && $('s-wxalert-enabled').checked) ? '1' : '0',
      severe_weather_min_severity: $('s-wxalert-severity') ? $('s-wxalert-severity').value : 'Moderate',
      // News sources (priority is the ★ button's .on state)
      news_national_enabled: $('news-national-enabled').checked ? '1' : '0',
      news_national_priority: $('news-national-priority-btn').classList.contains('on') ? '1' : '0',
      news_world_enabled: $('news-world-enabled').checked ? '1' : '0',
      news_world_priority: $('news-world-priority-btn').classList.contains('on') ? '1' : '0',
      news_local_enabled: $('news-local-enabled').checked ? '1' : '0',
      news_local_priority: $('news-local-priority-btn').classList.contains('on') ? '1' : '0',
      news_local_location: $('news-local-location').value.trim(),
      news_keywords_enabled: $('news-keywords-enabled').checked ? '1' : '0',
      news_keywords_priority: $('news-keywords-priority-btn').classList.contains('on') ? '1' : '0',
      news_keywords: $('news-keywords').value.trim(),
    };
    // Only persist as a manual override if it actually differs from the
    // auto-derived value — otherwise every save would "freeze" the auto value
    // as a manual override, silently breaking future ZIP-lookup updates.
    const locationVal = $('s-weather-location').value.trim();
    body.weather_location_manual = (locationVal === (s.weather_location_auto || '')) ? '' : locationVal;
    return body;
  }

  // Saves everything EXCEPT the PIN — that field has its own confirm() dialog for
  // clearing protection, which would be genuinely dangerous to trigger automatically
  // while someone's mid-typing (e.g. briefly empty between keystrokes) rather than
  // from a deliberate button press. Every other field here is safe to auto-save:
  // worst case of an accidental change is easy to just change back.
  async function saveAllSettings({ silent = false } = {}) {
    if (window.__languageSwitching) return;   // the page is about to reload into another language; see the Language picker
    const run = async () => {
      // Built HERE, right before the request actually goes out — not when
      // saveAllSettings() was called/scheduled — so a save that had to wait
      // behind an earlier one in the queue (see below) reflects the CURRENT
      // form state, never a stale snapshot from whenever it was originally
      // queued.
      const body = collectSettingsBody();
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      // Photo defaults live on a separate endpoint — moved here from the old
      // Photos tab, which is now just upload+tagging.
      if ($('s-ps-brightness')) {
        await apiFetch('/api/photo-settings', {
          method: 'PUT',
          body: JSON.stringify({
            brightness:         $('s-ps-brightness').value,
            opacity:            $('s-ps-opacity').value,
            slideshow:          $('s-ps-slideshow').value,
            slideshow_interval: $('s-ps-interval').value,
          })
        });
      }
      await saveBriefingFields();
      if (!silent) showToast('Settings saved ✓');
      // Reflect Family Hub's own enabled/disabled features immediately (no
      // refresh needed) — see updateFamilyHubVisibility()'s own comment for
      // why this replaced three near-identical per-tab blocks.
      updateFamilyHubVisibility(body);
    };
    // Real bug this closes — the actual, demonstrable root cause behind
    // settings (Home Assistant's URL/token among them) silently reverting
    // to blank with no specific trigger anyone could point to: renderSettings()
    // wires a fresh 'input'/'change' listener onto #content EVERY time the
    // Settings tab is (re)opened, and nothing ever removes the previous
    // one — they're delegated listeners on the persistent #content
    // container, which survives every tab switch (only its innerHTML gets
    // replaced, confirmed against renderTab()). A session with more than
    // one Settings visit ends up with that many duplicate listeners, each
    // independently debouncing and firing its OWN PUT /api/settings for
    // the exact same edit. Nothing previously ordered those requests
    // against each other — an earlier-scheduled one (built from a
    // momentarily blank or half-typed field, e.g. mid-select-all-and-paste
    // into the HA token box) could resolve AFTER a later, complete one and
    // silently overwrite it, since the server just applies whatever arrives
    // last on the wire, with no concept of "older" or "newer." Chaining
    // every save through one shared, app-wide promise — and building
    // collectSettingsBody() at RUN time, not schedule time — makes the
    // actual order of outgoing PUT requests match the actual order of
    // edits, no matter how many duplicate listeners are stacked. The
    // duplicate-listener stacking itself is a separate, lower-stakes bug
    // (redundant requests, same correct data) — left alone for now, see
    // changelog.
    window._settingsSaveChain = (window._settingsSaveChain || Promise.resolve()).then(run, run);
    return window._settingsSaveChain;
  }

  // Auto-save: any change to a field in the settings form (except the PIN, and
  // except the ones with their own explicit save buttons — API keys, tickers, etc.
  // already save themselves individually) triggers a debounced save, so nothing
  // gets silently lost by forgetting to press "Save Settings" — exactly what
  // happened with the To-Do toggle before this. Checkboxes/selects save almost
  // immediately (short debounce, no need to wait for more input); text fields wait
  // a beat after the last keystroke so it's not saving on every character.
  _st._settingsAutoSaveTimer = null;
  function scheduleSettingsAutoSave(delayMs) {
    if (_st._settingsAutoSaveTimer) clearTimeout(_st._settingsAutoSaveTimer);
    _st._settingsAutoSaveTimer = setTimeout(() => { saveAllSettings({ silent: true }); }, delayMs);
  }
  // Exposed globally (saveAllSettings/collectSettingsBody are otherwise only
  // reachable from inside this closure) so the tab-switching handler further
  // up the file can flush a pending debounced save BEFORE navigating away —
  // the real bug behind "toggle a setting, switch tabs right away, and it
  // sometimes doesn't take effect or the corresponding tab doesn't appear."
  // Without this, a save that was still waiting out its debounce fires LATER
  // against whatever tab someone has since navigated to, where the settings
  // fields it reads (collectSettingsBody()'s $('...') lookups) no longer
  // exist in the DOM at all — collectSettingsBody() defensively treats a
  // missing checkbox as unchecked, so the save that finally goes out
  // silently reverts the very change someone just made, rather than
  // reflecting it. Set fresh on every renderSettings() call so it always
  // closes over the current, correct state.
  window._flushSettingsAutoSave = () => {
    if (!_st._settingsAutoSaveTimer) return;
    clearTimeout(_st._settingsAutoSaveTimer);
    _st._settingsAutoSaveTimer = null;
    saveAllSettings({ silent: true });
  };
  const settingsFormEl = document.getElementById('content');
  if (settingsFormEl) {
    renderSettings_Wire_settingsFormEl({ scheduleSettingsAutoSave, settingsFormEl });
  }

  if ($('s-pin')) {
    $('s-pin').addEventListener('input', () => {
      const typing = !!$('s-pin').value.trim();
      $('s-pin-confirm').style.display = typing ? 'block' : 'none';
      $('s-pin-save-btn').style.display = typing ? 'block' : 'none';
    });
    // Enter in either box submits, same as pressing Set PIN.
    for (const id of ['s-pin', 's-pin-confirm']) {
      $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('s-pin-save-btn').click(); } });
    }
  }
  if ($('s-pin-remove-btn')) {
    renderSettings_Wire_sPinRemoveBtn();
  }

  // Sets the app PIN on its own. Used by the "Set PIN" button, Enter in either
  // PIN box, and the main Save Settings button — the PIN is deliberately NOT
  // part of the debounced auto-save (see saveAllSettings()'s comment): a
  // half-typed PIN must never get saved. Returns 'none' (nothing typed),
  // 'mismatch', 'error', or 'set'.
  async function saveAppPin() {
    const pinVal = $('s-pin').value.trim();
    const pinConfirmVal = $('s-pin-confirm').value.trim();
    const pinHint = $('s-pin-hint');
    if (pinVal === '') return 'none';
    // Confirm-PIN check — typing a PIN blind with no confirmation step was a
    // genuine gap (see also the setup wizard's own PIN step).
    if (pinVal !== pinConfirmVal) {
      pinHint.textContent = "PINs don't match — try again.";
      pinHint.style.color = '#ff8585';
      $('s-pin-confirm').focus();
      return 'mismatch';
    }
    pinHint.style.color = '';
    pinHint.textContent = 'Set a PIN to protect the app when accessed remotely. The display is always public.';
    const res = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ app_pin: pinVal }) });
    if (res && res.__authFailed) return 'error'; // apiFetch already handled the invalid session
    if (res && res.error) {
      pinHint.textContent = res.error;
      pinHint.style.color = '#ff8585';
      return 'error';
    }
    // Real bug fixed here: setting a PIN takes effect immediately on the
    // SERVER (requireAuth reads it fresh on every request), but this
    // browser's own session never automatically became authenticated —
    // sessionToken was still null, since typing into this field is not
    // the same thing as logging in with it. The very next API call this
    // page made would then get rejected with 401 by the person's OWN
    // current session, immediately after they'd just set the PIN —
    // kicking them out of the app they were sitting in, moments after
    // saving. Establishing a real session right here, using the PIN that
    // was just set, closes that gap before anything else gets a chance
    // to fail.
    try {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinVal }),
      });
      const loginData = await loginRes.json();
      if (loginData && loginData.ok && loginData.token) {
        sessionToken = loginData.token;
        authGeneration++; // any request already in flight from before this point gets ignored on 401 — see apiFetch()'s own comment
        localStorage.setItem('pi_cal_token', sessionToken);
      }
    } catch {} // best-effort — if this fails, the next request surfaces it via the normal 401 handling, not silently
    $('s-pin').value = '';
    $('s-pin-confirm').value = '';
    $('s-pin-confirm').style.display = 'none';
    $('s-pin-save-btn').style.display = 'none';
    return 'set';
  }

  $('s-pin-save-btn').addEventListener('click', async () => {
    const btn = $('s-pin-save-btn');
    btn.disabled = true;
    try {
      if (await saveAppPin() === 'set') {
        showToast('PIN set ✓');
        await renderSettingsKeepPlace(); // placeholder + Remove button reflect the new state now
      }
    } finally { btn.disabled = false; }
  });

  renderSettings_Wire_block4365({ saveAllSettings, saveAppPin, _st });

  renderSettings_Wire_block4388Etc({ saveBriefingFields });
}

