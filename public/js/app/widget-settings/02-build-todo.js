async function drawWidgetSettingsPanel_Build_todo(_c) {
  const { w, _st } = _c;
    const lists = await apiFetch('/api/todo-lists').catch(()=>[]);
    const tdFontPx = w.todoFontPx || 15;
    const listOptions = (lists && lists.length)
      ? lists.map(l => `<option value="${l.id}" ${Number(w.listId)===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')
      : '';
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Which List</label>
        ${lists && lists.length ? `
        <select class="form-input" id="td-list-select">
          <option value="">Choose a list…</option>
          ${listOptions}
        </select>` : `<p style="font-size:12px;color:var(--muted)">No to-do lists yet. Add one in Settings → To-Do Lists.</p>`}
      </div>
      <div class="settings-row">
        <label>Title (optional)</label>
        <input class="form-input" id="td-title" value="${escapeHtml(w.todoTitle||'')}" placeholder="Defaults to the list's own name">
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="td-font-range" min="8" max="80" step="1" value="${tdFontPx}">
          <span class="range-val" id="td-font-val">${tdFontPx}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show completed items ${infoBtn("Add and check off items from Settings → To-Do Lists — this display shows them read-only.")}</label>
        <input type="checkbox" id="td-showdone" ${w.todoShowDone!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
    `;
}

async function drawWidgetSettingsPanel_Build_shoppinglist(_c) {
  const { w, _st } = _c;
    const slFontPx = w.shoppingFontPx || 15;
    const slLists = await apiFetch('/api/shopping-lists').catch(() => []);
    const slChosen = (Array.isArray(slLists) ? slLists : []).find(l => l.id === Number(w.shoppingListId)) || (Array.isArray(slLists) ? slLists[0] : null);
    const slListPicker = (Array.isArray(slLists) && slLists.length) ? `
      <div class="settings-row">
        <label>Which List ${infoBtn("Add more lists, like Costco or Pharmacy, from Family Hub → Shopping. Each Shopping List widget shows one list.")}</label>
        <select class="form-input" id="sl-list-select">
          ${slLists.map(l => `<option value="${l.id}" ${slChosen && slChosen.id === l.id ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}
        </select>
      </div>` : '';
    _st.typeSpecificHtml = `
      ${slListPicker}
      <div class="settings-row">
        <label>Title</label>
        <input class="form-input" id="sl-title" value="${escapeHtml(w.shoppingTitle||'Shopping List')}">
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="sl-font-range" min="8" max="80" step="1" value="${slFontPx}">
          <span class="range-val" id="sl-font-val">${slFontPx}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show checked-off items</label>
        <input type="checkbox" id="sl-showdone" ${w.shoppingShowDone!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Shrink text to fit the whole list ${infoBtn("When the list is longer than the widget, the text shrinks until every item shows. A list that already fits keeps the font size above.")}</label>
        <input type="checkbox" id="sl-autofit" ${w.shoppingAutoFit!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Tap an item right on the display to check it off, or add/manage items from Family Hub (/hub) or the "🛒 Shopping" settings below.</p>
    `;
}

async function drawWidgetSettingsPanel_Build_chorechart(_c) {
  const { w, _st } = _c;
    const allKids = await apiFetch('/api/kids').catch(()=>[]);
    const selected = Array.isArray(w.choreKidIds) ? w.choreKidIds.map(String) : null; // null = all
    const kidChecks = (allKids && allKids.length) ? allKids.map(k => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
        <input type="checkbox" class="cc-kid-pick" value="${k.id}" ${(!selected || selected.includes(String(k.id)))?'checked':''} style="width:18px;height:18px;accent-color:var(--accent)">
        <span style="font-size:20px">${k.avatar||'🙂'}</span>
        <span style="color:${k.color}">${escapeHtml(k.name)}</span>
      </label>`).join('') : `<p style="font-size:12px;color:var(--muted)">No kids yet. Add them in the Chores tab.</p>`;
    const ccFontPx = w.choreFontPx || 15;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Chart Title</label>
        <input class="form-input" id="cc-title" value="${escapeHtml(w.choreTitle||'Daily Chore Chart')}">
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="cc-font-range" min="8" max="80" step="1" value="${ccFontPx}">
          <span class="range-val" id="cc-font-val">${ccFontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Which Children ${infoBtn("Defaults to everyone. Uncheck a child to leave them off this display.")}</label>
        <div id="cc-kid-picks">${kidChecks}</div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show completed chores</label>
        <input type="checkbox" id="cc-showdone" ${w.choreShowDone!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show ⭐ Sticker Balance</label>
        <input type="checkbox" id="cc-showstickers" ${w.choreShowStickers!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Shows each kid's sticker balance next to their streak, when they have one. On by default.</p>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show ⭐ Bonus chores</label>
        <input type="checkbox" id="cc-showbonus" ${w.choreShowBonus?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:-4px">Adds a strip below the chart with the shared bonus / extra-credit chores up for grabs today. Claiming still happens in the app or on the kid page. Off by default.</p>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">If this is blank on the display, make sure you've added kids and chores in the <b>Chores</b> tab.</p>
    `;
}

async function drawWidgetSettingsPanel_Build_chorelb(_c) {
  const { w, _st } = _c;
    const allKidsLb = await apiFetch('/api/kids').catch(()=>[]);
    const selectedLb = Array.isArray(w.lbKidIds) ? w.lbKidIds.map(String) : null; // null = all
    const kidChecksLb = (allKidsLb && allKidsLb.length) ? allKidsLb.map(k => `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
        <input type="checkbox" class="lb-kid-pick" value="${k.id}" ${(!selectedLb || selectedLb.includes(String(k.id)))?'checked':''} style="width:18px;height:18px;accent-color:var(--accent)">
        <span style="font-size:20px">${k.avatar||'🙂'}</span>
        <span style="color:${k.color}">${escapeHtml(k.name)}</span>
      </label>`).join('') : `<p style="font-size:12px;color:var(--muted)">No kids yet. Add them in the Chores tab.</p>`;
    const lbFontPx = w.lbFontPx || 15;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Title</label>
        <input class="form-input" id="lb-title" value="${escapeHtml(w.lbTitle||'Chore Leaderboard')}">
      </div>
      <div class="settings-row">
        <label>Rank By</label>
        <select class="form-input" id="lb-rankby">
          <option value="streak" ${(w.lbRankBy||'streak')==='streak'?'selected':''}>Current streak</option>
          <option value="weekly" ${w.lbRankBy==='weekly'?'selected':''}>Chores done this week</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="lb-font-range" min="8" max="80" step="1" value="${lbFontPx}">
          <span class="range-val" id="lb-font-val">${lbFontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Which Children ${infoBtn("Defaults to everyone. Uncheck a child to leave them off this leaderboard.")}</label>
        <div id="lb-kid-picks">${kidChecksLb}</div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Ties are broken by name. If this is blank on the display, make sure you've added kids and chores in the <b>Chores</b> tab.</p>
    `;
}

function drawWidgetSettingsPanel_Build_countdown(_c) {
  const { w, _st } = _c;
    const fontPx = w.cdFontPx || 22;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Title</label>
        <input class="form-input" id="cd-title" value="${escapeHtml(w.cdTitle||'Countdown')}" placeholder="e.g. Disney Trip">
      </div>
      <div class="settings-row">
        <label>Target Date</label>
        <input class="form-input" id="cd-date" type="date" value="${w.cdDate||''}">
      </div>
      <div class="settings-row">
        <label>Time (optional)</label>
        <input class="form-input" id="cd-time" type="time" value="${w.cdTime||''}">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Repeats every year ${infoBtn("For birthdays/anniversaries — always counts down to the next occurrence instead of going negative once the date passes.")}</label>
        <input type="checkbox" id="cd-repeat" ${w.cdRepeatYearly?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" id="cd-font-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="cd-font-range" min="8" max="100" step="1" value="${fontPx}">
          <span class="range-val" id="cd-font-val">${fontPx}px</span>
        </div>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_radar(_c) {
  const { w, _st } = _c;
    const fontPx = w.radarFontPx || 16;
    const zoom = w.radarZoom || 6;
    const opacity = (w.radarOpacity !== undefined ? w.radarOpacity : 80);
    const frameCount = w.radarFrameCount || 6;
    const animate = !!w.radarAnimate;
    const showTime = w.radarShowTime !== false;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Title</label>
        <input class="form-input" id="radar-title" value="${escapeHtml(w.radarTitle||'Radar')}" placeholder="e.g. Radar">
      </div>
      <div class="settings-row" style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <label style="margin-bottom:0">Override location for this widget</label>
          <input type="checkbox" id="radar-loc-override" ${(w.radarLat && w.radarLon) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <p style="font-size:11px;color:var(--muted);margin:6px 0 0">Use a different location than the global one — e.g. a vacation house, or a storm you're tracking elsewhere. Leave off to use the location from Settings → Weather.</p>
        <div id="radar-loc-override-fields" style="${(w.radarLat && w.radarLon) ? '' : 'display:none'};margin-top:10px">
          <label style="font-size:12px;color:var(--muted)">ZIP / Postal code</label>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input class="form-input" id="radar-loc-zip" placeholder="e.g. 90210 or SW1A 1AA" style="flex:1">
            <button id="radar-loc-lookup" style="background:var(--accent);border:none;border-radius:9px;color:#fff;padding:0 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Look up</button>
          </div>
          <div id="radar-loc-status" style="font-size:12px;color:var(--muted)">${(w.radarLat && w.radarLon) ? `📍 ${w.radarLat}, ${w.radarLon}` : 'No location set yet.'}</div>
        </div>
      </div>
      <div class="settings-row">
        <label>Zoom Level</label>
        <div class="range-row">
          <input type="range" id="radar-zoom-range" min="3" max="8" step="1" value="${zoom}">
          <span class="range-val" id="radar-zoom-val">${zoom}</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Radar Opacity (%)</label>
        <div class="range-row">
          <input type="range" id="radar-opacity-range" min="10" max="100" step="5" value="${opacity}">
          <span class="range-val" id="radar-opacity-val">${opacity}%</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Frame Time ${infoBtn("Shows the currently-displayed frame's clock time and how old (or, for forecast frames, how far ahead) it is, as a small badge in the corner of the map.")}</label>
        <input type="checkbox" id="radar-show-time" ${showTime?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Animate ${infoBtn("Loops through the last several radar frames (about 10 minutes apart) instead of showing just the latest one. Uses a little more data/CPU on the display.")}</label>
        <input type="checkbox" id="radar-animate" ${animate?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" id="radar-frames-row" style="display:${animate?'block':'none'}">
        <label>Frames to Loop ${infoBtn("Up to ~13 frames is RainViewer's observed radar history — a hard 2-hour ceiling on their free tier, not a limit set here. Going higher extends the loop into their short-term nowcast: a near-future extrapolation (roughly 30–60 min ahead), not a full weather-model forecast.")}</label>
        <div class="range-row">
          <input type="range" id="radar-frames-range" min="2" max="20" step="1" value="${frameCount}">
          <span class="range-val" id="radar-frames-val">${frameCount}</span>
        </div>
      </div>
      <div class="settings-row" id="radar-font-row">
        <label>Title Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="radar-font-range" min="8" max="64" step="1" value="${fontPx}">
          <span class="range-val" id="radar-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Radar data from RainViewer — free, worldwide coverage, no account needed.</p>
    `;
}

function drawWidgetSettingsPanel_Build_travel(_c) {
  const { w, _st } = _c;
    const fontPx = w.travelFontPx || 18;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Label</label>
        <input class="form-input" id="tv-label" value="${escapeHtml(w.travelLabel||'Travel Time')}" placeholder="e.g. To Work">
      </div>
      <div class="settings-row">
        <label>From</label>
        <input class="form-input" id="tv-origin" value="${escapeHtml(w.travelOrigin||'')}" placeholder="e.g. Home, or a full address">
      </div>
      <div class="settings-row">
        <label>To</label>
        <input class="form-input" id="tv-destination" value="${escapeHtml(w.travelDestination||'')}" placeholder="e.g. 123 Main St, Columbus, OH">
      </div>
      <div class="settings-row">
        <label>Mode</label>
        <select class="form-input" id="tv-mode">
          <option value="driving"   ${(!w.travelMode||w.travelMode==='driving')?'selected':''}>🚗 Driving</option>
          <option value="walking"   ${w.travelMode==='walking'?'selected':''}>🚶 Walking</option>
          <option value="bicycling" ${w.travelMode==='bicycling'?'selected':''}>🚴 Bicycling</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="tv-font-range" min="8" max="72" step="1" value="${fontPx}">
          <span class="range-val" id="tv-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Uses free road-network routing by default (no live traffic). For traffic-aware times, add a Google Maps API key in Settings → Travel Time.</p>
    `;
}

function drawWidgetSettingsPanel_Build_webpage(_c) {
  const { w, _st } = _c;
    const wpMins = parseInt(w.wpRefreshMin, 10) || 0;
    const wpOpt = (v, label) => `<option value="${v}" ${wpMins === v ? 'selected' : ''}>${label}</option>`;
    const wpNum = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const wpZoomV = wpNum(w.wpZoom, 25, 300, 100), wpYV = wpNum(w.wpScrollY, 0, 10000, 0);
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Web address</label>
        <input class="form-input" id="wp-url" value="${escapeHtml(w.wpUrl||'')}" placeholder="https://example.com/page" autocapitalize="none" spellcheck="false">
        <div id="wp-url-hint" style="font-size:11px;color:var(--muted);margin-top:4px">${w.wpUrl && !wpUrlOk(w.wpUrl) ? 'That is not a web address. It has to start with http:// or https://' : 'Starts with http:// or https://'}</div>
      </div>
      <div class="settings-row">
        <label>Title (optional)</label>
        <input class="form-input" id="wp-title" value="${escapeHtml(w.wpTitle||'')}" placeholder="e.g. Homework this week">
      </div>
      <div class="settings-row">
        <label>Reload the page</label>
        <select class="form-input" id="wp-refresh">${wpOpt(0, 'Never')}${wpOpt(5, 'Every 5 minutes')}${wpOpt(15, 'Every 15 minutes')}${wpOpt(60, 'Every hour')}</select>
      </div>
      <div class="settings-row">
        <label>Zoom</label>
        <div class="range-row">
          <input type="range" id="wp-zoom" min="25" max="300" step="5" value="${wpZoomV}">
          <span class="range-val" id="wp-zoom-val">${wpZoomV}%</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Scroll down</label>
        <div class="range-row">
          <input type="range" id="wp-scroll-y" min="0" max="6000" step="25" value="${Math.min(6000, wpYV)}">
          <span class="range-val" id="wp-scroll-y-val">${wpYV}px</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Let this page keep its sign-in ${infoBtn("For a page that needs to remember a login, like Home Assistant. Gives the page its own storage inside the box. Only works for a page on a different computer than this one, and only turn it on for a page you trust.")}</label>
        <input type="checkbox" id="wp-keep-login" ${w.wpKeepLogin ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:4px">Zoom and scroll move the page inside the box; they do not reload it. A page's own scroll position cannot be read from here, so set how far down to start with the slider.</p>
      <p style="font-size:11px;color:var(--muted);margin-top:4px">Shows the page inside a sandboxed box: it can run its own scripts but cannot touch this app. Works best with simple pages you host yourself that need no sign-in. Many large sites (Canvas, school portals) refuse to be shown inside another page. If your page loads a data file from its own server, that server must send an Access-Control-Allow-Origin header for it - or put the data straight into the page. If the display is on https, the address has to be https too.</p>
    `;
}

function drawWidgetSettingsPanel_Build_qrcode(_c) {
  const { w, _st } = _c;
    const preset = w.qrPreset || 'text';
    const fontPx = w.qrFontPx || 14;
    const sizePx = w.qrSizePx || 180;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Title (optional)</label>
        <input class="form-input" id="qr-title" value="${escapeHtml(w.qrTitle||'')}" placeholder="e.g. Join Our WiFi">
      </div>
      <div class="settings-row">
        <label>Code Size (px)</label>
        <div class="range-row">
          <input type="range" id="qr-size-range" min="80" max="500" step="10" value="${sizePx}">
          <span class="range-val" id="qr-size-val">${sizePx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Content Type</label>
        <select class="form-input" id="qr-preset">
          <option value="text" ${preset==='text'?'selected':''}>Text or URL</option>
          <option value="wifi" ${preset==='wifi'?'selected':''}>WiFi Network</option>
        </select>
      </div>
      <div class="settings-row" id="qr-text-row" style="display:${preset==='text'?'block':'none'}">
        <label>Content</label>
        <textarea class="form-input" id="qr-content" rows="2" placeholder="https://example.com or any text">${escapeHtml(w.qrContent||'')}</textarea>
      </div>
      <div id="qr-wifi-rows" style="display:${preset==='wifi'?'block':'none'}">
        <div class="settings-row">
          <label>Network Name (SSID)</label>
          <input class="form-input" id="qr-ssid" value="${escapeHtml(w.qrSSID||'')}" placeholder="e.g. HomeWiFi">
        </div>
        <div class="settings-row">
          <label>Password</label>
          <input class="form-input" id="qr-password" type="text" value="${escapeHtml(w.qrPassword||'')}" placeholder="Network password">
        </div>
        <div class="settings-row">
          <label>Security</label>
          <select class="form-input" id="qr-encryption">
            <option value="WPA" ${(w.qrEncryption||'WPA')==='WPA'?'selected':''}>WPA/WPA2</option>
            <option value="WEP" ${w.qrEncryption==='WEP'?'selected':''}>WEP</option>
            <option value="nopass" ${w.qrEncryption==='nopass'?'selected':''}>None (open network)</option>
          </select>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:-4px">Guests scan this to join automatically — no typing the password. Password is stored in your layout data like any other widget setting.</p>
      </div>
      <div class="settings-row">
        <label>Title Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="qr-font-range" min="8" max="56" step="1" value="${fontPx}">
          <span class="range-val" id="qr-font-val">${fontPx}px</span>
        </div>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_timer(_c) {
  const { w, _st } = _c;
    const fontPx = w.timerFontPx || 32;
    const isRunning = !!w.timerEndsAt;
    const isPaused = !isRunning && typeof w.timerRemainingSec === 'number' && w.timerRemainingSec > 0;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Title</label>
        <input class="form-input" id="tm-title" value="${escapeHtml(w.timerTitle||'Timer')}">
      </div>
      <div class="settings-row">
        <label>Duration (minutes)</label>
        <input class="form-input" id="tm-minutes" type="number" min="1" max="240" step="1" value="${w.timerMinutes||5}" ${isRunning||isPaused?'disabled':''}>
        ${isRunning||isPaused ? '<p style="font-size:11px;color:var(--muted);margin-top:6px">Reset the timer to change the duration.</p>' : ''}
      </div>
      <div class="settings-row" style="display:flex;gap:8px">
        ${!isRunning && !isPaused ? `<button type="button" class="btn btn-primary" id="tm-start" style="flex:1">▶ Start</button>` : ''}
        ${isRunning ? `<button type="button" class="btn" id="tm-pause" style="flex:1;background:var(--card);border:1px solid var(--border)">⏸ Pause</button>` : ''}
        ${isPaused ? `<button type="button" class="btn btn-primary" id="tm-resume" style="flex:1">▶ Resume</button>` : ''}
        ${isRunning || isPaused ? `<button type="button" class="btn" id="tm-reset" style="flex:1;background:var(--card);border:1px solid var(--border)">↺ Reset</button>` : ''}
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:2px">This wall display has no touch input, so Start/Pause/Reset live here — the countdown then shows live on the display, updating every second.</p>
      <div class="settings-row" id="tm-font-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="tm-font-range" min="12" max="110" step="1" value="${fontPx}">
          <span class="range-val" id="tm-font-val">${fontPx}px</span>
        </div>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_layoutswitcher(_c) {
  const { w, _st } = _c;
    const fontPx = w.switcherFontPx || 15;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Live Displays</label>
        <div id="ls-display-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          <div style="font-size:12px;color:var(--muted)">Loading…</div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px">Switches this screen to whatever that display is currently showing — its actual live arrangement, not a fixed snapshot.</p>
      </div>
      <div class="settings-row">
        <label>Saved Templates</label>
        <div id="ls-preset-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          <div style="font-size:12px;color:var(--muted)">Loading…</div>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px">A fixed layout saved ahead of time (Layout tab → Saved) — not tied to any display, always switches to exactly what was saved.</p>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="ls-font-range" min="10" max="40" step="1" value="${fontPx}">
          <span class="range-val" id="ls-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Schedule (optional)</label>
        <p style="font-size:11px;color:var(--muted);margin-top:2px;margin-bottom:8px">Automatically switch at set times — the buttons above still work too, any time.</p>
        <div id="ls-schedule-list" style="display:flex;flex-direction:column;gap:10px"></div>
        <button type="button" class="btn" id="ls-schedule-add-btn" style="width:100%;margin-top:8px;background:var(--card);border:1px solid var(--border)">+ Add a scheduled switch</button>
      </div>
      <div class="settings-row">
        <label>Copy This Switcher To Another Layout</label>
        <div style="display:flex;gap:8px;margin-top:4px">
          <select class="form-input" id="ls-copy-target" style="flex:1"><option value="">Loading layouts…</option></select>
          <button type="button" class="btn" id="ls-copy-btn" style="background:var(--card);border:1px solid var(--border);white-space:nowrap">Copy</button>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px">Places an identical switcher (same assigned targets, same position) onto that display — so switching to a layout that doesn't have its own switcher yet never becomes a dead end.</p>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_sports(_c) {
  const { w, _st } = _c;
    const fontPx = w.spFontPx || 16;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Team</label>
        ${w.spTeamId ? `
          <div style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px">
            ${w.spTeamBadge ? `<img src="${escapeHtml(w.spTeamBadge)}" style="width:36px;height:36px;object-fit:contain">` : ''}
            <div style="flex:1"><b>${escapeHtml(w.spTeamName||'')}</b></div>
            <button type="button" class="btn" id="sp-change-btn" style="background:var(--bg);border:1px solid var(--border);padding:6px 12px;font-size:12px">Change</button>
          </div>
        ` : `
          <div style="display:flex;gap:8px">
            <input class="form-input" id="sp-search-input" placeholder="e.g. Kansas City Chiefs" style="flex:1;font-size:15px;padding:12px 14px">
            <button type="button" class="btn btn-primary" id="sp-search-btn" style="padding:0 16px">Search</button>
          </div>
        `}
        <div id="sp-results" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="sp-font-range" min="8" max="64" step="1" value="${fontPx}">
          <span class="range-val" id="sp-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Shows the next scheduled game and the most recent final score. Real-time in-play score updates aren't available on the free data source this uses.</p>
    `;
}

function drawWidgetSettingsPanel_Build_text(_c) {
  const { w, _st } = _c;
    const preset = w.textPreset || 'plain';
    const fontPx = w.textFontPx || 28;
    const align = w.textAlign || 'left';
    const weight = w.textWeight || 'normal';
    const fontFamily = w.textFontFamily || 'Inter';
    const textColor = w.textColor || '';
    const fontOpt = (val, lbl) => `<option value="${val}" ${fontFamily===val?'selected':''}>${lbl}</option>`;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Text</label>
        <textarea class="form-input" id="text-content" rows="3" placeholder="Type anything…" style="resize:vertical">${(w.textContent || '').replace(/</g,'&lt;')}</textarea>
      </div>
      <div class="settings-row">
        <label>Style Preset ${infoBtn("A starting style — you can still fine-tune font, size, weight, and color below.")}</label>
        <select class="form-input" id="text-preset">
          <option value="plain"   ${preset==='plain'?'selected':''}>Plain text</option>
          <option value="heading" ${preset==='heading'?'selected':''}>Heading (large, bold)</option>
          <option value="label"   ${preset==='label'?'selected':''}>Label (small, uppercase)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Font</label>
        <select class="form-input" id="text-font-family">
          <optgroup label="Clean / Sans">
            ${fontOpt('Inter','Inter')}
            ${fontOpt('Montserrat','Montserrat')}
            ${fontOpt('Oswald','Oswald')}
            ${fontOpt('Bebas Neue','Bebas Neue')}
          </optgroup>
          <optgroup label="Classic / Serif">
            ${fontOpt('Playfair Display','Playfair Display')}
            ${fontOpt('Merriweather','Merriweather')}
            ${fontOpt('Georgia','Georgia')}
          </optgroup>
          <optgroup label="Cursive / Fancy">
            ${fontOpt('Dancing Script','Dancing Script (cursive)')}
            ${fontOpt('Pacifico','Pacifico (fun script)')}
            ${fontOpt('Great Vibes','Great Vibes (elegant)')}
            ${fontOpt('Sacramento','Sacramento (delicate)')}
            ${fontOpt('Satisfy','Satisfy (casual)')}
            ${fontOpt('Caveat','Caveat (handwritten)')}
          </optgroup>
          <optgroup label="Playful / Display">
            ${fontOpt('Lobster','Lobster')}
            ${fontOpt('Comfortaa','Comfortaa')}
            ${fontOpt('Righteous','Righteous')}
          </optgroup>
        </select>
        <div id="text-font-sample" style="margin-top:8px;padding:10px 12px;border:1px dashed var(--border);border-radius:8px;font-size:22px;color:var(--text);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">The quick brown fox 123</div>
      </div>
      <div class="settings-row" id="text-font-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="text-font-range" min="10" max="480" step="2" value="${fontPx}">
          <span class="range-val" id="text-font-val">${fontPx}px</span>
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px">Goes up to very large for big headline text.</p>
      </div>
      <div class="settings-row">
        <label>Weight</label>
        <select class="form-input" id="text-weight">
          <option value="normal" ${weight==='normal'?'selected':''}>Normal</option>
          <option value="500"    ${weight==='500'?'selected':''}>Medium</option>
          <option value="bold"   ${weight==='bold'?'selected':''}>Bold</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Alignment ${infoBtn("Tip: drag the widget's corner handles to resize the box — the text scales with your chosen size, and the box grows to fit.")}</label>
        <select class="form-input" id="text-align">
          <option value="left"   ${align==='left'?'selected':''}>Left</option>
          <option value="center" ${align==='center'?'selected':''}>Center</option>
          <option value="right"  ${align==='right'?'selected':''}>Right</option>
        </select>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_decoration(_c) {
  const { w, _st } = _c;
    const emoji = w.decorEmoji || '🌿';
    const fontPx = w.decorFontPx || 60;
    const opacity = w.decorOpacity ?? 100;
    const rotation = w.decorRotation || 0;
    const quickPicks = ['🌿','🪴','🌱','🍃','🌵','🌴','🍀','🌸','🌼','🌻','🍁','🦋','⭐','✨','💫','🎈','🎉','☀️','🌙','☁️','❤️','🐝','🌈','🔥'];
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Quick Pick</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
          ${quickPicks.map(e => `<button type="button" class="decor-quickpick" data-emoji="${e}" style="font-size:22px;width:40px;height:40px;border-radius:8px;border:1px solid ${e===emoji?'var(--accent)':'var(--border)'};background:${e===emoji?'rgba(74,144,217,0.15)':'var(--card)'};cursor:pointer">${e}</button>`).join('')}
        </div>
      </div>
      <div class="settings-row">
        <label>Or Type Any Emoji</label>
        <input class="form-input" id="decor-emoji-input" value="${escapeHtml(emoji)}" maxlength="8" placeholder="🌿">
      </div>
      <div class="settings-row">
        <label>Size (px)</label>
        <div class="range-row">
          <input type="range" id="decor-font-range" min="16" max="300" step="2" value="${fontPx}">
          <span class="range-val" id="decor-font-val">${fontPx}px</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Opacity ${infoBtn("Lower for a subtle watermark-style touch instead of a bold graphic.")}</label>
        <div class="range-row">
          <input type="range" id="decor-opacity-range" min="10" max="100" step="5" value="${opacity}">
          <span class="range-val" id="decor-opacity-val">${opacity}%</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Rotation ${infoBtn("A slight tilt can help it read like a placed sticker rather than a perfectly centered icon.")}</label>
        <div class="range-row">
          <input type="range" id="decor-rotation-range" min="-45" max="45" step="1" value="${rotation}">
          <span class="range-val" id="decor-rotation-val">${rotation}°</span>
        </div>
      </div>
    `;
}

function drawWidgetSettingsPanel_Build_entitystatus(_c) {
  const { w, _st } = _c;
    const fontPx = w.haFontPx || 20;
    const entityLabel = w.haEntityId ? (w.haLabel || w.haEntityId) : null;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Entity</label>
        <button type="button" id="ha-entity-picker-btn" class="form-input" style="text-align:left;cursor:pointer;color:${entityLabel ? 'var(--text)' : 'var(--muted)'}">
          ${entityLabel ? escapeHtml(entityLabel) : 'Tap to choose an entity…'}
        </button>
        ${w.haEntityId ? `<p style="font-size:11px;color:var(--muted);margin-top:6px">${escapeHtml(w.haEntityId)}</p>` : ''}
      </div>
      <div class="settings-row">
        <label>Template wizard (optional) ${infoBtn("Write a Home Assistant template and the widget shows what Home Assistant makes of it. Not sure where to start? Tap Step by step, or Recipes for ready-made ones, and the Insert buttons add the right code for you. Put **double asterisks** around words to make them bold. The display asks Home Assistant again every few seconds. More examples: piazzahq.com/template-cookbook. When this is filled in it replaces the entity control, and you do not need to choose an entity.")}</label>
        <textarea class="form-input" id="ha-template-input" rows="5" spellcheck="false" autocapitalize="none" placeholder="{{ states('sensor.washer') | title }}" style="font-family:monospace;font-size:13px">${escapeHtml(w.haTemplate || '')}</textarea>
        <div id="ha-template-tools"></div>
      </div>
      <div class="settings-row">
        <label>Template Alignment ${infoBtn("Which side of the widget the Template text lines up to. Left or Right keeps it snug against one edge, handy in a narrow column or a tight layout.")}</label>
        <select class="form-input" id="ha-align-select">
          <option value="center" ${(w.haAlign||'center')==='center'?'selected':''}>Center</option>
          <option value="left" ${w.haAlign==='left'?'selected':''}>Left</option>
          <option value="right" ${w.haAlign==='right'?'selected':''}>Right</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Display Label</label>
        <input class="form-input" id="ha-label-input" value="${escapeHtml(w.haLabel || '')}" placeholder="Defaults to the entity's own name">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Unit</label>
        <input type="checkbox" id="ha-show-unit" ${w.haShowUnit !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Trend Graph</label>
        <input type="checkbox" id="ha-show-sparkline" ${w.haShowSparkline !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Time in This State ${infoBtn("Adds a small line under the value saying how long it has been like this, e.g. \"Cycle complete · 2 hr. ago\" for a washing machine or \"Open · 15 min. ago\" for a door.")}</label>
        <input type="checkbox" id="ha-show-since" ${w.haShowSince ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="ha-font-range" min="10" max="90" step="1" value="${fontPx}">
          <span class="range-val" id="ha-font-val">${fontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Needs Home Assistant connected first — see Settings → Home Assistant.</p>
    `;
}

function drawWidgetSettingsPanel_Build_smarthomeDashboard(_c) {
  const { w, _st } = _c;
    const dashEntities = Array.isArray(w.haEntityIds) ? w.haEntityIds : [];
    const dashAreas = Array.isArray(w.haAreaIds) ? w.haAreaIds : [];
    const dashCombos = Array.isArray(w.haComboGroups) ? w.haComboGroups : [];
    const dashFontPx = w.haDashFontPx || 16;
    _st.typeSpecificHtml = `
      <p style="font-size:12px;color:var(--muted);margin:0 0 10px">A grid of tiles built from the devices and rooms you pick. It is not a copy of a Home Assistant dashboard — to show one of those, use a Web Page widget.</p>
      <div class="settings-row">
        <label>Entities</label>
        <button type="button" id="ha-dash-picker-btn" class="form-input" style="text-align:left;cursor:pointer">
          ${(dashEntities.length || dashAreas.length) ? `${dashEntities.length} entit${dashEntities.length === 1 ? 'y' : 'ies'}${dashAreas.length ? ` + ${dashAreas.length} area${dashAreas.length === 1 ? '' : 's'}` : ''} selected` : 'Tap to choose entities…'}
        </button>
      </div>
      <div class="settings-row">
        <label>Combo Groups ${infoBtn("Combine several areas and/or entities into ONE named switch — e.g. \"Upstairs\" = Bedroom + Bathroom + Office, one tile. Separate from the plain area tiles above, which stay one tile per area.")}</label>
        ${dashCombos.length ? `
        <div id="ha-dash-combo-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${dashCombos.map((combo, i) => {
            const memberCount = (combo.areaIds || []).length + (combo.entityIds || []).length;
            return `
            <div style="display:flex;align-items:center;gap:8px">
              <button type="button" class="ha-dash-combo-edit-btn form-input" data-id="${escapeHtml(combo.id)}" style="text-align:left;cursor:pointer;flex:1">
                ${escapeHtml(combo.name || 'Untitled')} — ${memberCount} member${memberCount === 1 ? '' : 's'}
              </button>
              <button type="button" class="ha-dash-combo-remove-btn" data-id="${escapeHtml(combo.id)}" aria-label="Remove"
                style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);color:#ff5d5d;font-size:16px;cursor:pointer">×</button>
            </div>`;
          }).join('')}
        </div>
        ` : ''}
        <button type="button" id="ha-dash-combo-add-btn" class="btn"
          style="width:100%;background:rgba(74,144,217,0.12);border:1px solid var(--accent);color:var(--accent);margin-top:0">
          + New Combo Group
        </button>
      </div>
      ${dashAreas.length ? `
      <div class="settings-row">
        <label>Areas (live — always includes whatever's currently in each)</label>
        <div id="ha-dash-area-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${dashAreas.map((areaId, i) => {
            const area = cachedHaAreas && cachedHaAreas.areas.find(a => a.id === areaId);
            return `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;color:var(--text);flex:1">${escapeHtml(area ? area.name : areaId)}</span>
              <button type="button" class="ha-dash-area-remove-btn" data-index="${i}" aria-label="Remove"
                style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);color:#ff5d5d;font-size:16px;cursor:pointer">×</button>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}
      ${dashEntities.length ? `
      <div class="settings-row">
        <label>Individual Entities — Rooms (optional, groups the dashboard into sections)</label>
        <div id="ha-dash-room-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${dashEntities.map((entry, i) => `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(entry.id)}</span>
              <input class="form-input ha-dash-room-input" data-index="${i}" value="${escapeHtml(entry.room || '')}"
                placeholder="Room (e.g. Kitchen)" style="width:auto;flex:0 0 140px">
              <button type="button" class="ha-dash-remove-btn" data-index="${i}" aria-label="Remove"
                style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);color:#ff5d5d;font-size:16px;cursor:pointer">×</button>
            </div>`).join('')}
        </div>
      </div>
      ` : ''}
      ${dashEntities.length ? `
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Group by Room</label>
        <input type="checkbox" id="ha-dash-group-toggle" ${w.haGroupByRoom !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      ` : ''}
      <div class="settings-row">
        <label>View</label>
        <select class="form-input" id="ha-dash-view-select">
          <option value="grid" ${(!w.haDashView || w.haDashView === 'grid') ? 'selected' : ''}>Grid</option>
          <option value="list" ${w.haDashView === 'list' ? 'selected' : ''}>List</option>
          <option value="icon" ${w.haDashView === 'icon' ? 'selected' : ''}>Icon-only</option>
          <option value="card" ${w.haDashView === 'card' ? 'selected' : ''}>Card</option>
          <option value="tapcard" ${w.haDashView === 'tapcard' ? 'selected' : ''}>Tap-card (whole card is the switch)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Title (optional)</label>
        <input class="form-input" id="ha-dash-title-input" value="${escapeHtml(w.haDashTitle || '')}" placeholder="e.g. Home">
      </div>
      <div class="settings-row">
        <label>Tile/Text Size (px) ${infoBtn("Controls the size of everything in each tile/row — icons, toggles, and text all scale together from this one setting.")}</label>
        <div class="range-row">
          <input type="range" id="ha-dash-font-range" min="8" max="56" step="1" value="${dashFontPx}">
          <span class="range-val" id="ha-dash-font-val">${dashFontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Needs Home Assistant connected first — see Settings → Home Assistant.</p>
    `;
}

function drawWidgetSettingsPanel_Build_groupcontrol(_c) {
  const { w, _st } = _c;
    const gcEntities = Array.isArray(w.gcEntityIds) ? w.gcEntityIds : [];
    const gcAreas = Array.isArray(w.gcAreaIds) ? w.gcAreaIds : [];
    const gcFontPx = w.gcFontPx || 20;
    _st.typeSpecificHtml = `
      <div class="settings-row">
        <label>Entities ${infoBtn("One tap on the wall display turns ALL of these on or off together — if anything in the group is on, tapping turns everything off; only turns everything on if the whole group is currently off. For entities you want to see and control individually instead, use a Smart Home Grid widget.")}</label>
        <button type="button" id="ha-group-picker-btn" class="form-input" style="text-align:left;cursor:pointer">
          ${(gcEntities.length || gcAreas.length) ? `${gcEntities.length} entit${gcEntities.length === 1 ? 'y' : 'ies'}${gcAreas.length ? ` + ${gcAreas.length} area${gcAreas.length === 1 ? '' : 's'}` : ''} selected` : 'Tap to choose entities…'}
        </button>
      </div>
      ${gcAreas.length ? `
      <div class="settings-row">
        <label>Areas (live — always includes whatever's currently in each)</label>
        <div id="ha-group-area-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${gcAreas.map((areaId, i) => {
            const area = cachedHaAreas && cachedHaAreas.areas.find(a => a.id === areaId);
            return `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:13px;color:var(--text);flex:1">${escapeHtml(area ? area.name : areaId)}</span>
              <button type="button" class="ha-group-area-remove-btn" data-index="${i}" aria-label="Remove"
                style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);color:#ff5d5d;font-size:16px;cursor:pointer">×</button>
            </div>`;
          }).join('')}
        </div>
      </div>
      ` : ''}
      ${gcEntities.length ? `
      <div class="settings-row">
        <label>Individual Entities</label>
        <div id="ha-group-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          ${gcEntities.map((entId, i) => `
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:var(--muted);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(entId)}</span>
              <button type="button" class="ha-group-remove-btn" data-index="${i}" aria-label="Remove"
                style="flex:0 0 auto;width:32px;height:32px;border-radius:8px;background:rgba(255,93,93,0.12);border:1px solid rgba(255,93,93,0.3);color:#ff5d5d;font-size:16px;cursor:pointer">×</button>
            </div>`).join('')}
        </div>
      </div>
      ` : ''}
      <div class="settings-row">
        <label>Title</label>
        <input class="form-input" id="ha-group-title-input" value="${escapeHtml(w.gcTitle || '')}" placeholder="e.g. Upstairs">
      </div>
      <div class="settings-row">
        <label>Font Size (px)</label>
        <div class="range-row">
          <input type="range" id="ha-group-font-range" min="10" max="60" step="1" value="${gcFontPx}">
          <span class="range-val" id="ha-group-font-val">${gcFontPx}px</span>
        </div>
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">Needs Home Assistant connected first — see Settings → Home Assistant.</p>
    `;
}

function drawWidgetSettingsPanel_Build_isCalendarWidget(_c) {
  const { w, _st } = _c;
    _st.contentHtml = `
      <div class="settings-row">
        <label>Calendars to Show</label>
        <div id="source-filter-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
          <div style="font-size:12px;color:var(--muted)">Loading calendars…</div>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Multi-day Events</label>
        <input type="checkbox" id="show-multiday-toggle" ${w.showMultiDay !== false ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Show Location ${infoBtn("Shows each event's location — for calendars that have location turned on in Settings → Calendars (or forced on in 📍 Per-Feed Location below). On by default. In a Grid calendar it's appended to the title line; Agenda gives it its own wrapped line.")}</label>
        <input type="checkbox" id="show-location-toggle" ${(() => { const k = { minical:'calShowLocation', agenda:'agShowLocation', upcoming:'upShowLocation', today:'tdShowLocation' }[w.type]; return w[k] !== false ? 'checked' : ''; })()} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div class="settings-row" id="fop-accordion-wrap">
        ${accordionSection({ id: 'fop', icon: '🎨', label: 'Per-Feed Opacity', sub: 'this display only',
          inner: `
            <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Override a calendar's opacity for just this widget, without changing its global default in Calendar Feeds.</p>
            <div id="feed-opacity-override-list" style="display:flex;flex-direction:column;gap:10px">
              <div style="font-size:12px;color:var(--muted)">Loading calendars…</div>
            </div>
          `
        })}
      </div>
      <div class="settings-row" id="flo-accordion-wrap">
        ${accordionSection({ id: 'flo', icon: '📍', label: 'Per-Feed Location', sub: 'this widget only',
          inner: `
            <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Force a calendar's location on or off for just this widget — wins over both its global "Show location" in Calendar Feeds and this widget's own Show Location toggle.</p>
            <div id="feed-location-override-list" style="display:flex;flex-direction:column;gap:10px">
              <div style="font-size:12px;color:var(--muted)">Loading calendars…</div>
            </div>
          `
        })}
      </div>
    `;
}

function drawWidgetSettingsPanel_Wire_panelInnerHTML(_c) {
  const { panel, w, def, colorHtml, fontHtml, _st } = _c;
  panel.innerHTML = `
    <div class="settings-card" style="margin-bottom:14px">
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${def.icon} ${def.label}</span>
        <span style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span id="widget-panel-expand-btn" style="color:var(--muted);font-size:16px;padding:2px 6px;border-radius:6px;cursor:pointer" title="Make 10% bigger">⤢</span>
          <span id="widget-panel-del-btn" style="color:var(--muted);font-size:14px;padding:2px 6px;border-radius:6px;cursor:pointer" title="Remove">✕</span>
          <span style="font-size:11px;color:var(--muted);margin-left:4px">Layer: ${getLayerPosition(w)}</span>
        </span>
      </div>
      <div class="settings-row">
        <label style="display:flex;justify-content:space-between;align-items:center">
          <span>🔒 Lock Position ${infoBtn("Prevents accidentally dragging or resizing this widget on the canvas. A 🔒 badge shows on the widget itself while locked — uncheck here to move it again.")}</span>
          <input type="checkbox" id="widget-lock-toggle" ${w.locked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
        </label>
      </div>
      <div class="settings-row">
        <label>Fine-Tune Position ${infoBtn("A zoomed-in view centered on this widget — drag it here for finer control than dragging on the full canvas allows, especially on a small screen.")}</label>
        <div id="fine-tune-viewport" style="position:relative;overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--card);max-height:280px">
          <div id="fine-tune-stage"></div>
        </div>
      </div>
      <div class="settings-row">
        <label>Layer Order</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="icon-btn" id="layer-front-btn" style="width:100%;font-size:12px;gap:6px;display:flex;align-items:center;justify-content:center">⬆️ Bring to Front</button>
          <button class="icon-btn" id="layer-back-btn" style="width:100%;font-size:12px;gap:6px;display:flex;align-items:center;justify-content:center">⬇️ Send to Back</button>
          <button class="icon-btn" id="layer-up-btn" style="width:100%;font-size:12px;gap:6px;display:flex;align-items:center;justify-content:center">🔼 Forward</button>
          <button class="icon-btn" id="layer-down-btn" style="width:100%;font-size:12px;gap:6px;display:flex;align-items:center;justify-content:center">🔽 Backward</button>
        </div>
      </div>
      ${colorHtml}
      ${fontHtml}
      ${_st.typeSpecificHtml}
      ${_st.contentHtml}
    </div>
  `;
}

function drawWidgetSettingsPanel_Wire_clock(_c) {
  const { w } = _c;
    $('clock-style').addEventListener('change', (e) => {
      w.clockStyle = e.target.value;
      // Full re-render (not just updating w and letting the next tick pick it
      // up) so the Face row's visibility, the Time Format row's visibility,
      // and the "Size" vs "Font Size" label all update immediately, and the
      // widget itself switches shape right away rather than waiting for
      // something else to trigger it.
      drawWidgetSettingsPanel();
      rebuildCanvas();
    });
    if ($('clock-analog-style')) {
      $('clock-analog-style').addEventListener('change', (e) => {
        w.analogStyle = e.target.value;
        rebuildCanvas();
      });
    }
    $('clock-font-range').addEventListener('input', (e) => {
      w.clockFontPx = parseInt(e.target.value);
      $('clock-font-val').textContent = w.clockFontPx + 'px';
    });
    $('clock-time-format').addEventListener('change', (e) => {
      w.clockTimeFormat = e.target.value; // 'default' | '12' | '24'
    });
    if ($('clock-ampm-case')) {
      $('clock-ampm-case').addEventListener('change', (e) => {
        w.clockAmpmCase = e.target.value; // 'default' | 'lower' | 'upper'
      });
    }
}

function drawWidgetSettingsPanel_Wire_datetime(_c) {
  const { w } = _c;
    $('dt-style-select').addEventListener('change', (e) => {
      w.dtStyle = e.target.value;
    });
    if ($('dt-align-select')) $('dt-align-select').addEventListener('change', (e) => { w.dtAlign = e.target.value; });
    $('dt-font-range').addEventListener('input', (e) => {
      w.dtFontPx = parseInt(e.target.value);
      $('dt-font-val').textContent = w.dtFontPx + 'px';
    });
    // Same wiring shape for all six per-item size overrides — 0 clears the
    // override back to Auto (proportional), matching dtSizeOverrideRowHtml's
    // own 0-means-Auto convention above.
    [['dt-time-size', 'dtTimeSizePx'], ['dt-seconds-size', 'dtSecondsSizePx'],
     ['dt-ampm-size', 'dtAmpmSizePx'], ['dt-day-size', 'dtDaySizePx'],
     ['dt-date-size', 'dtDateSizePx'], ['dt-temp-size', 'dtTempSizePx']].forEach(([id, field]) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('input', (e) => {
        const v = parseInt(e.target.value);
        if (v) w[field] = v; else delete w[field];
        $(id + '-val').textContent = v ? v + 'px' : 'Auto';
      });
    });
    $('dt-show-seconds').addEventListener('change', (e) => { w.dtShowSeconds = e.target.checked; });
    $('dt-show-date').addEventListener('change', (e) => { w.dtShowDate = e.target.checked; });
    $('dt-show-temp').addEventListener('change', (e) => { w.dtShowTemp = e.target.checked; });
    $('dt-time-format').addEventListener('change', (e) => { w.dtTimeFormat = e.target.value; });
    if ($('dt-ampm-case-select')) $('dt-ampm-case-select').addEventListener('change', (e) => { w.dtAmpmCase = e.target.value; });
    if ($('dt-date-format-select')) $('dt-date-format-select').addEventListener('change', (e) => { w.dtDateFormat = e.target.value; });
}

function drawWidgetSettingsPanel_Wire_flightmap(_c) {
  const { w } = _c;
    const $$ = (id) => document.getElementById(id);
    const hide = (id, h) => { const e = $$(id); if (e) e.style.display = h ? 'none' : ''; };
    if ($$('fm-subject')) $$('fm-subject').addEventListener('change', (e) => {
      w.fmSubject = e.target.value;
      hide('fm-filter-block', w.fmSubject !== 'filter');
      hide('fm-flight-block', w.fmSubject !== 'flight');
      hide('fm-watch-block', w.fmSubject !== 'watch');
      if (w.fmSubject === 'flight' || w.fmSubject === 'watch') { w.fmFollow = true; if ($$('fm-follow')) $$('fm-follow').checked = true; }
      rebuildCanvas();
    });
    const fmCenter = () => {
      const f0 = w.fmFilter || {}, c = {};
      if (f0.centerLat != null && f0.centerLat !== '') c.centerLat = f0.centerLat;
      if (f0.centerLon != null && f0.centerLon !== '') c.centerLon = f0.centerLon;
      if (f0.centerLabel) c.centerLabel = f0.centerLabel;
      if (f0.spanNm) c.spanNm = f0.spanNm;
      if (f0.milOnly) c.milOnly = true;
      return c;
    };
    if ($$('fm-filter-mode')) $$('fm-filter-mode').addEventListener('change', (e) => {
      const m = e.target.value;
      if (m === 'radius') {
        const ex = fmCenter(); delete ex.centerLat; delete ex.centerLon; delete ex.spanNm;
        apiFetch('/api/settings').then(s => { w.fmFilter = { ...ex, radiusNm: Number(($$('fm-radius') || {}).value) || 150, lat: parseFloat(s.weather_lat), lon: parseFloat(s.weather_lon) }; rebuildCanvas(); }).catch(() => {});
      } else if (m === 'airline') {
        const ex = fmCenter();
        apiFetch('/api/settings').then(s => {
          w.fmFilter = { ...ex, airline: ($$('fm-airline') || {}).value || '', radiusNm: Number(($$('fm-radius') || {}).value) || 250,
            lat: (ex.centerLat != null ? ex.centerLat : parseFloat(s.weather_lat)), lon: (ex.centerLon != null ? ex.centerLon : parseFloat(s.weather_lon)) };
          delete w.fmFilter.milOnly; rebuildCanvas();
        }).catch(() => {});
      } else {
        w.fmFilter = { ...fmCenter() };
        if (m === 'mil') { w.fmFilter.mil = true; delete w.fmFilter.milOnly; }
        else if (m === 'type') w.fmFilter.type = ($$('fm-type') || {}).value || '';
        else if (m === 'squawk') w.fmFilter.squawk = ($$('fm-squawk') || {}).value || '';
      }
      hide('fm-type-row', m !== 'type'); hide('fm-squawk-row', m !== 'squawk'); hide('fm-airline-row', m !== 'airline');
      hide('fm-radius-row', m !== 'radius' && m !== 'airline'); hide('fm-center-row', m === 'radius'); hide('fm-span-row', m === 'airline');
      const mr = $$('fm-milonly-row'); if (mr) mr.style.display = (m === 'mil' || m === 'airline') ? 'none' : 'flex';
      rebuildCanvas();
    });
    if ($$('fm-airline')) $$('fm-airline').addEventListener('input', (e) => { w.fmFilter = { ...(w.fmFilter || {}), airline: e.target.value.toUpperCase() }; rebuildCanvas(); });
    if ($$('fm-milonly')) $$('fm-milonly').addEventListener('change', (e) => {
      w.fmFilter = { ...(w.fmFilter || {}) };
      if (e.target.checked) w.fmFilter.milOnly = true; else delete w.fmFilter.milOnly;
      rebuildCanvas();
    });
    if ($$('fm-type')) $$('fm-type').addEventListener('input', (e) => { w.fmFilter = { ...fmCenter(), type: e.target.value.toUpperCase() }; rebuildCanvas(); });
    if ($$('fm-squawk')) $$('fm-squawk').addEventListener('input', (e) => { w.fmFilter = { ...fmCenter(), squawk: e.target.value.replace(/\D/g, '').slice(0, 4) }; rebuildCanvas(); });
    const fmCHint = (t) => { if ($$('fm-cplace-hint')) $$('fm-cplace-hint').textContent = t; };
    const fmSetCenter = (lat, lon, label) => {
      const base = { ...(w.fmFilter || {}) }; delete base.centerLat; delete base.centerLon; delete base.centerLabel;
      const ok = lat !== '' && lon !== '' && Number.isFinite(+lat) && Number.isFinite(+lon);
      if (ok) { base.centerLat = +lat; base.centerLon = +lon; if (label) base.centerLabel = label; }
      fmCHint(ok ? ('📍 ' + (label || ((+lat).toFixed(2) + ', ' + (+lon).toFixed(2)))) : 'Type a place and press Set (or Enter). Blank = a fixed near-hemisphere view.');
      if (base.airline) {
        if (ok) { base.lat = +lat; base.lon = +lon; w.fmFilter = base; rebuildCanvas(); }
        else { apiFetch('/api/settings').then(s => { base.lat = parseFloat(s.weather_lat); base.lon = parseFloat(s.weather_lon); w.fmFilter = base; rebuildCanvas(); }).catch(() => { w.fmFilter = base; rebuildCanvas(); }); }
        return;
      }
      w.fmFilter = base; rebuildCanvas();
    };
    const cplace = $$('fm-cplace');
    const fmRunPlaceSearch = async () => {
      const q = (cplace.value || '').trim();
      if (q.length < 2) { fmSetCenter('', ''); return; }
      fmCHint('Searching…');
      try {
        const r = await apiFetch('/api/place-search?q=' + encodeURIComponent(q));
        if (r && r.lat != null && r.lon != null) { cplace.value = r.label || q; fmSetCenter(r.lat, r.lon, r.label || q); }
        else fmCHint((r && r.error) || 'Nothing found for that.');
      } catch { fmCHint('Search failed — try again.'); }
    };
    if ($$('fm-cgo')) $$('fm-cgo').addEventListener('click', fmRunPlaceSearch);
    if (cplace) cplace.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fmRunPlaceSearch(); } });
    if ($$('fm-chome')) $$('fm-chome').addEventListener('click', () => {
      apiFetch('/api/settings').then(s => { const la = parseFloat(s.weather_lat), lo = parseFloat(s.weather_lon); if (Number.isFinite(la) && Number.isFinite(lo)) { cplace.value = 'Home'; fmSetCenter(la, lo, 'Home'); } }).catch(() => {});
    });
    if ($$('fm-cclear')) $$('fm-cclear').addEventListener('click', () => { cplace.value = ''; fmSetCenter('', ''); });
    if ($$('fm-span')) $$('fm-span').addEventListener('input', (e) => { const v = Number(e.target.value); $$('fm-span-val').textContent = v + ' nm'; w.fmFilter = { ...(w.fmFilter || {}), spanNm: v }; rebuildCanvas(); });
    if ($$('fm-radius')) $$('fm-radius').addEventListener('input', (e) => {
      const val = Number(e.target.value); $$('fm-radius-val').textContent = val + ' nm';
      const cur = w.fmFilter || {};
      if (cur.centerLat != null && cur.centerLon != null) { w.fmFilter = { ...cur, radiusNm: val, lat: cur.centerLat, lon: cur.centerLon }; rebuildCanvas(); }
      else apiFetch('/api/settings').then(s => { w.fmFilter = { ...cur, radiusNm: val, lat: parseFloat(s.weather_lat), lon: parseFloat(s.weather_lon) }; rebuildCanvas(); }).catch(() => {});
    });
    if ($$('fm-flight-kind')) $$('fm-flight-kind').addEventListener('change', (e) => { w.fmFlightKind = e.target.value; rebuildCanvas(); });
    if ($$('fm-flight-value')) $$('fm-flight-value').addEventListener('input', (e) => { w.fmFlightValue = e.target.value.toUpperCase().trim(); rebuildCanvas(); });
    if ($$('fm-watch-profile')) $$('fm-watch-profile').addEventListener('change', (e) => { w.fmWatchProfileId = e.target.value || null; rebuildCanvas(); });
    if ($$('fm-follow')) $$('fm-follow').addEventListener('change', (e) => { w.fmFollow = e.target.checked; });
    if ($$('fm-showdata')) $$('fm-showdata').addEventListener('change', (e) => { w.fmShowData = e.target.checked; rebuildCanvas(); });
    if ($$('fm-showtrails')) $$('fm-showtrails').addEventListener('change', (e) => { w.fmShowTrails = e.target.checked; rebuildCanvas(); });
    if ($$('fm-labels')) $$('fm-labels').addEventListener('change', (e) => { w.fmLabels = e.target.checked; rebuildCanvas(); });
    if ($$('fm-states')) $$('fm-states').addEventListener('change', (e) => { w.fmStates = e.target.checked; rebuildCanvas(); });
    if ($$('fm-trail')) $$('fm-trail').addEventListener('input', (e) => { const m = parseInt(e.target.value, 10); w.fmTrailMin = m; $$('fm-trail-val').textContent = m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0) + ' h' : m + ' min'; });
}

function drawWidgetSettingsPanel_Wire_camera(_c) {
  const { w } = _c;
    if ($('cam-select')) $('cam-select').addEventListener('change', (e) => {
      w.camId = e.target.value ? parseInt(e.target.value, 10) : null;
      rebuildCanvas(); drawWidgetSettingsPanel();
    });
    if ($('cam-fit')) $('cam-fit').addEventListener('change', (e) => { w.camFit = e.target.value; });
    if ($('cam-show-title')) $('cam-show-title').addEventListener('change', (e) => { w.camShowTitle = e.target.checked; });
    if ($('cam-add-btn')) $('cam-add-btn').addEventListener('click', () => { _appCamForm = { open: true, editId: null, source: 'url' }; drawWidgetSettingsPanel(); });
    if ($('cam-edit-btn')) $('cam-edit-btn').addEventListener('click', () => {
      const cam = _appCamList.find(c => String(c.id) === String(w.camId));
      _appCamForm = { open: true, editId: w.camId, source: cam && cam.kind === 'ha' ? 'ha' : 'url' };
      drawWidgetSettingsPanel();
    });
    if ($('cam-del-btn')) $('cam-del-btn').addEventListener('click', async () => {
      if (!w.camId || !confirm('Remove this camera? Any widget using it will go blank.')) return;
      try { await apiFetch(`/api/cameras/${w.camId}`, { method: 'DELETE' }); } catch {}
      w.camId = null; rebuildCanvas(); drawWidgetSettingsPanel();
    });
    if ($('cam-test-btn')) $('cam-test-btn').addEventListener('click', async () => {
      const out = $('cam-test-result');
      if (out) out.textContent = 'testing…';
      try {
        const r = await apiFetch(`/api/cameras/${w.camId}/test`);
        if (out) { out.textContent = r && r.ok ? '✓ streaming' : ('✗ ' + ((r && r.error) || 'no signal')); out.style.color = r && r.ok ? '#30a46c' : '#e5484d'; }
      } catch { if (out) { out.textContent = '✗ could not test'; out.style.color = '#e5484d'; } }
    });
    if ($('cam-f-source')) $('cam-f-source').addEventListener('change', (e) => { _appCamForm.source = e.target.value; drawWidgetSettingsPanel(); });
    if ($('cam-f-cancel')) $('cam-f-cancel').addEventListener('click', () => { _appCamForm = { open: false, editId: null, source: 'url' }; drawWidgetSettingsPanel(); });
    if ($('cam-f-save')) $('cam-f-save').addEventListener('click', async () => {
      const err = $('cam-f-error');
      const showErr = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } };
      const name = ($('cam-f-name').value || '').trim();
      if (!name) return showErr('Give the camera a name.');
      const kind = _appCamForm.source === 'ha' ? 'ha' : 'url';
      let url = '';
      if (kind === 'ha') {
        url = $('cam-f-ha-entity').value;
        if (!url) return showErr('Pick a Home Assistant camera entity.');
        url = 'ha:' + url;
      } else {
        url = ($('cam-f-url').value || '').trim();
        if (!_appCamForm.editId && !url) return showErr('Enter the stream URL.');
      }
      const save = $('cam-f-save');
      save.disabled = true; save.textContent = 'Saving…';
      try {
        const body = { name, kind };
        if (url) body.url = url;
        let r;
        if (_appCamForm.editId) r = await apiFetch(`/api/cameras/${_appCamForm.editId}`, { method: 'PUT', body: JSON.stringify(body) });
        else r = await apiFetch('/api/cameras', { method: 'POST', body: JSON.stringify(body) });
        if (r && r.error) { save.disabled = false; save.textContent = _appCamForm.editId ? 'Save changes' : 'Add camera'; return showErr(r.error); }
        if (!_appCamForm.editId && r && r.id) w.camId = r.id;
        _appCamForm = { open: false, editId: null, source: 'url' };
        rebuildCanvas(); drawWidgetSettingsPanel();
      } catch {
        save.disabled = false; save.textContent = _appCamForm.editId ? 'Save changes' : 'Add camera';
        showErr('Could not save — try again.');
      }
    });
}

function drawWidgetSettingsPanel_Wire_weather(_c) {
  const { w } = _c;
    $('wx-content-scale').addEventListener('input', (e) => {
      const pct = parseInt(e.target.value);
      w.wxContentScale = pct / 100;
      $('wx-content-scale-val').textContent = pct + '%';
    });
    if ($('wx-forecast-days-range')) {
      $('wx-forecast-days-range').addEventListener('input', (e) => {
        w.wxForecastDays = parseInt(e.target.value);
        $('wx-forecast-days-val').textContent = w.wxForecastDays === 0 ? 'Off' : w.wxForecastDays;
      });
    }
    if ($('wx-hourly-style')) {
      $('wx-hourly-style').addEventListener('change', (e) => {
        w.wxHourlyStyle = e.target.value;
        const hr = $('wx-hours-row'); if (hr) hr.style.display = e.target.value === 'hourly' ? '' : 'none';
      });
    }
    if ($('wx-hours-range')) {
      $('wx-hours-range').addEventListener('input', (e) => {
        w.wxHours = parseInt(e.target.value);
        $('wx-hours-val').textContent = w.wxHours;
      });
    }
    if ($('wx-combo-style-select')) {
      $('wx-combo-style-select').addEventListener('change', (e) => {
        w.wxComboStyle = e.target.value;
        // Re-renders the whole panel — a style change shifts the DISPLAYED
        // default for both Forecast Days and Hours to Show at once (each
        // style has its own), same reasoning as display.html's identical
        // fix. drawWidgetSettingsPanel() takes no arguments — it reads the
        // currently selected widget from the global selectedId itself, so
        // this correctly rebuilds using the just-changed w.wxComboStyle.
        drawWidgetSettingsPanel();
      });
    }
    if ($('wx-combo-align-select')) {
      $('wx-combo-align-select').addEventListener('change', (e) => {
        w.wxComboAlign = e.target.value;
      });
    }
    if ($('wx-combo-show-current')) {
      $('wx-combo-show-current').addEventListener('change', (e) => {
        w.wxComboShowCurrent = e.target.checked;
      });
    }
    $('wx-location-font-range').addEventListener('input', (e) => {
      w.wxLocationFontPx = parseInt(e.target.value);
      $('wx-location-font-val').textContent = w.wxLocationFontPx + 'px';
    });
    $('wx-location-align-select').addEventListener('change', (e) => {
      w.wxLocationAlign = e.target.value;
    });
    // Location name is no longer editable from inside a widget's own settings
    // panel at all — it's a global setting (Settings → Weather), and letting
    // it be edited from here too (even with a warning label) was a real,
    // confirmed source of confusion: editing it from one widget's panel
    // silently changed every OTHER weather widget across every layout. The
    // panel now just displays it for reference; see the per-widget override
    // section above for giving THIS widget its own distinct location.
    if ($('wx-unit-select')) {
      $('wx-unit-select').addEventListener('change', (e) => {
        w.wxUnit = e.target.value || undefined; // '' (use global default) stores as no override at all
      });
    }
    if ($('wx-show-location')) {
      $('wx-show-location').addEventListener('change', (e) => { w.wxShowLocation = e.target.checked; });
    }
    const wireCheck = (id, prop) => {
      if ($(id)) $(id).addEventListener('change', (e) => { w[prop] = e.target.checked; });
    };
    wireCheck('wx-show-feels', 'wxShowFeelsLike');
    wireCheck('wx-show-humidity', 'wxShowHumidity');
    wireCheck('wx-show-gust', 'wxShowWindGust');
    wireCheck('wx-show-uv', 'wxShowUV');
    wireCheck('wx-show-sunrise', 'wxShowSunrise');

    // Per-widget location override (e.g. vacation home).
    const ovToggle = $('wx-loc-override');
    if (ovToggle) {
      ovToggle.addEventListener('change', (e) => {
        const fields = $('wx-loc-override-fields');
        if (e.target.checked) {
          fields.style.display = '';
        } else {
          fields.style.display = 'none';
          // Clearing the override reverts the widget to the global location.
          delete w.wxLat; delete w.wxLon; delete w.wxLabel;
          showToast('Using global weather location');
        }
      });
    }
    if ($('wx-loc-label')) {
      $('wx-loc-label').addEventListener('input', (e) => { w.wxLabel = e.target.value; });
    }
    if ($('wx-loc-lookup')) {
      $('wx-loc-lookup').addEventListener('click', async () => {
        const zip = $('wx-loc-zip').value.trim();
        if (!zip) { $('wx-loc-status').textContent = 'Enter a ZIP/postal code first.'; return; }
        $('wx-loc-status').textContent = 'Looking up…';
        try {
          const r = await apiFetch(`/api/geocode?save=0&zip=${encodeURIComponent(zip)}`);
          if (r && r.ambiguous && Array.isArray(r.candidates)) {
            const statusEl = $('wx-loc-status');
            statusEl.textContent = '';
            const prompt = document.createElement('div');
            prompt.textContent = 'That matched more than one place — which is yours?';
            prompt.style.marginBottom = '6px';
            statusEl.appendChild(prompt);
            for (const c of r.candidates) {
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'ghost small';
              btn.textContent = '📍 ' + (c.label || c.display_name || '');
              btn.style.display = 'block';
              btn.style.width = '100%';
              btn.style.textAlign = 'left';
              btn.style.marginTop = '4px';
              btn.addEventListener('click', () => {
                w.wxLat = String(c.lat); w.wxLon = String(c.lon);
                if (!w.wxLabel && c.label) { w.wxLabel = c.label; $('wx-loc-label').value = c.label; }
                statusEl.textContent = `📍 ${c.label || (c.lat + ', ' + c.lon)}`;
                showToast('Location set — Save Layout to keep it');
              });
              statusEl.appendChild(btn);
            }
          } else if (r && r.lat && r.lon) {
            w.wxLat = String(r.lat); w.wxLon = String(r.lon);
            if (!w.wxLabel && r.label) { w.wxLabel = r.label; $('wx-loc-label').value = r.label; }
            $('wx-loc-status').textContent = `📍 ${r.label || (r.lat + ', ' + r.lon)}`;
            showToast('Location set — Save Layout to keep it');
          } else {
            $('wx-loc-status').textContent = r && r.error ? r.error : 'Could not find that location.';
          }
        } catch {
          $('wx-loc-status').textContent = 'Lookup failed — check your connection.';
        }
      });
    }
    if ($('wx-loc-place-go')) {
      const runPlaceSearch = async () => {
        const q = ($('wx-loc-place').value || '').trim();
        if (q.length < 2) { $('wx-loc-status').textContent = 'Type at least 2 characters.'; return; }
        $('wx-loc-status').textContent = 'Searching…';
        try {
          const r = await apiFetch(`/api/place-search?q=${encodeURIComponent(q)}`);
          if (r && r.lat != null && r.lon != null) {
            w.wxLat = String(r.lat); w.wxLon = String(r.lon);
            if (!w.wxLabel && r.label) { w.wxLabel = r.label; $('wx-loc-label').value = r.label; }
            $('wx-loc-status').textContent = `📍 ${r.label || (r.lat + ', ' + r.lon)}`;
            showToast('Location set — Save Layout to keep it');
          } else {
            $('wx-loc-status').textContent = (r && r.error) || 'Nothing found for that.';
          }
        } catch {
          $('wx-loc-status').textContent = 'Search failed — check your connection.';
        }
      };
      $('wx-loc-place-go').addEventListener('click', runPlaceSearch);
      $('wx-loc-place').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runPlaceSearch(); } });
    }
}
