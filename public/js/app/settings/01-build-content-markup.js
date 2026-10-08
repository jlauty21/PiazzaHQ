function renderSettings_Build_contentMarkup(_c) {
  const { s, bs, ps, cs, gs, hs, phoneAlerts, haAlerts, notifKinds, notifPrefs, isBeta, hasSupportLinks, supportButtonsHtml, tzOptions } = _c;
  $('content').innerHTML = `
    <div class="settings-search-wrap">
      <input type="text" id="settings-search-input" class="form-input" placeholder="🔍 Search settings — try “time”, “pin”, “weather”…" autocomplete="off">
      <button type="button" id="settings-search-clear-btn" class="settings-search-clear" aria-label="Clear search">✕</button>
      <div id="settings-search-results"></div>
    </div>

    <div class="section-header">Weather</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>ZIP / Postal Code</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="s-zip" value="${s.weather_zip||''}" placeholder="e.g. 66215 or SW1A 1AA" style="flex:1">
          <button id="zip-lookup-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">Look up</button>
        </div>
        <div id="zip-result" style="font-size:12px;color:var(--muted);margin-top:6px;min-height:18px">${s.weather_zip && s.weather_lat ? '📍 Location saved for ' + s.weather_zip : ''}</div>
      </div>
      <div class="settings-row">
        <label>Location Name <span class="info-btn" onclick="showInfoPopup('location-name-help')">ⓘ</span></label>
        <input class="form-input" id="s-weather-location" value="${s.weather_location_manual || s.weather_location_auto || ''}" placeholder="e.g. Columbus, OH" autocomplete="off">
      </div>
      <div class="settings-row">
        <label>Units ${infoBtn("The default for every weather widget. Any individual widget can override this in its own settings.")}</label>
        <select class="form-input" id="s-weather-unit">
          <option value="fahrenheit" ${(!s.weather_unit||s.weather_unit==='fahrenheit')?'selected':''}>Fahrenheit (°F)</option>
          <option value="celsius"    ${s.weather_unit==='celsius'?'selected':''}>Celsius (°C)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Refresh every ${infoBtn("How often the display pulls fresh weather. The day/night icon updates on this schedule too.")}</label>
        <select class="form-input" id="s-weather-refresh">
          <option value="5"  ${(s.weather_refresh_min==='5')?'selected':''}>5 minutes</option>
          <option value="10" ${(s.weather_refresh_min==='10')?'selected':''}>10 minutes</option>
          <option value="15" ${(s.weather_refresh_min==='15'||!s.weather_refresh_min)?'selected':''}>15 minutes</option>
          <option value="30" ${(s.weather_refresh_min==='30')?'selected':''}>30 minutes</option>
          <option value="60" ${(s.weather_refresh_min==='60')?'selected':''}>60 minutes</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Weather Source <span class="info-btn" onclick="showInfoPopup('weather-source-help')">ⓘ</span></label>
        <select class="form-input" id="s-weather-provider">
          <option value="open-meteo"    ${(!s.weather_provider||s.weather_provider==='open-meteo')?'selected':''}>Open-Meteo (free, no key needed)</option>
          <option value="nws"           ${s.weather_provider==='nws'?'selected':''}>National Weather Service (free, US only)</option>
          <option value="openweathermap" ${s.weather_provider==='openweathermap'?'selected':''}>OpenWeatherMap (needs your API key)</option>
        </select>
      </div>
      <div class="settings-row" id="s-weather-key-row" style="${s.weather_provider==='openweathermap'?'':'display:none'}">
        <label>OpenWeatherMap API Key ${infoBtn("Stored on your device only. Get one free at openweathermap.org → API keys.")}</label>
        <input class="form-input" id="s-weather-api-key" value="${(s.weather_api_key||'').replace(/"/g,'&quot;')}" placeholder="Paste your API key" autocomplete="off">
      </div>
    </div>

    <div class="section-header">Travel Time</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 10px">Applies to every Travel Time widget. Set each widget's own origin/destination in Layout — this just controls how the drive time is calculated.</p>
      <div class="settings-row">
        <label>Travel Source</label>
        <select class="form-input" id="s-travel-provider">
          <option value="osrm"   ${(!s.travel_provider||s.travel_provider==='osrm')?'selected':''}>Free road-network routing (no live traffic)</option>
          <option value="google" ${s.travel_provider==='google'?'selected':''}>Google Maps (needs your API key, live traffic)</option>
        </select>
      </div>
      <div class="settings-row" id="s-travel-key-row" style="${s.travel_provider==='google'?'':'display:none'}">
        <label>Google Maps API Key ${infoBtn("Stored on your device only. Needs the Distance Matrix API enabled in Google Cloud Console. Without a key here, Travel Time widgets automatically use the free routing source instead.")}</label>
        <input class="form-input" id="s-travel-api-key" value="${(s.travel_api_key||'').replace(/"/g,'&quot;')}" placeholder="Paste your API key" autocomplete="off">
      </div>
    </div>

    <div class="section-header">Features &amp; Family Hub</div>
    <div class="settings-card">
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Chore chart ${infoBtn("Show the Chores tab and chore-chart widget. Turn off if you don't use it.")}</label>
        </div>
        <input type="checkbox" id="s-chores-enabled" ${s.chores_enabled!=='0'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Built-in to-do lists ${infoBtn("Show the To-Do tab and to-do widget — a fully local alternative to the Todoist-backed Tasks widget. Manage lists and items in the To-Do tab.")}</label>
        </div>
        <input type="checkbox" id="s-todo-enabled" ${s.todo_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Shopping list ${infoBtn("Show the Shopping tab and shopping-list widget.")}</label>
        </div>
        <input type="checkbox" id="s-shopping-enabled" ${s.shopping_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Reminders ${infoBtn("Show the Reminders tab in Family Hub — manage trash day, recycling, or anything else on a rotating schedule from here, not just from a Reminders widget's own settings.")}</label>
        </div>
        <input type="checkbox" id="s-reminders-enabled" ${s.reminders_enabled!=='0'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Message board ${infoBtn("Show the Board tab in Family Hub and the Message Board widget — short notes household members leave for each other, shown on the wall display and cleared by anyone.")}</label>
        </div>
        <input type="checkbox" id="s-messageboard-enabled" ${s.messageboard_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" id="s-messageboard-autoclear-row" style="${s.messageboard_enabled==='1'?'':'display:none'}">
        <label>Auto-clear notes after ${infoBtn("Notes older than this many days are cleared automatically (pinned notes are kept). Set to 0 to never auto-clear.")}</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input class="form-input" type="number" min="0" max="365" id="s-messageboard-autoclear-days" value="${Number.isFinite(parseInt(s.messageboard_autoclear_days,10))?parseInt(s.messageboard_autoclear_days,10):14}" style="width:80px">
          <span style="font-size:13px;color:var(--muted)">days (0 = never)</span>
        </div>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Meal plan ${infoBtn("Show the Meals tab in Family Hub and the Meal Plan widget — one planned dinner per day, shown on the wall.")}</label>
        </div>
        <input type="checkbox" id="s-mealplan-enabled" ${s.mealplan_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Flight Map ${infoBtn("Show the Flight Map widget in the layout palette — a self-drawn world map with live aircraft (military, a type, a radius, or one tracked flight). Positions come from free community ADS-B APIs; a small world basemap downloads once. No Family Hub tab.")}</label>
        </div>
        <input type="checkbox" id="s-flightmap-enabled" ${s.flightmap_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
    </div>
    <div class="settings-card">
      <p style="font-size:13px;color:var(--muted);padding:14px 16px 0;margin:0 0 14px">Whichever of the features above are turned on also show up together in <b>Family Hub</b> — one installable app for Chores/To-Do/Shopping, no need to open the full calendar app. A feature switched off up there is hidden from the Hub too, not just the full app. Scan the code or visit the link below on any phone, then "Add to Home Screen" for a real app icon and full-screen launch.</p>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:0 16px 16px">
        <div id="hub-qr-container" style="background:#fff;padding:10px;border-radius:12px;line-height:0;flex-shrink:0;width:140px;height:140px;display:flex;align-items:center;justify-content:center"></div>
        <div style="flex:1;min-width:180px">
          <div id="hub-link-text" style="font-size:14px;font-weight:600;word-break:break-all;margin-bottom:8px"></div>
          <button type="button" id="hub-copy-btn" class="ghost small">📋 Copy Link</button>
        </div>
      </div>
    </div>

    <div class="section-header">Custom Theme</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 10px">Build your own theme: a background image, plus up to 3 decorations that drift across the screen. Select "Custom" as your display's theme to use it. <span class="info-btn" onclick="showInfoPopup('custom-theme-help')">ⓘ</span></p>

      <div class="settings-row">
        <label>Background</label>
        ${s.custom_theme_bg ? `
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
            <img src="${s.custom_theme_bg}" style="width:64px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
            <button type="button" class="ghost small" id="custom-bg-remove">Remove</button>
            <button type="button" class="ghost small" id="custom-bg-replace">Replace</button>
          </div>
        ` : `
          <button type="button" class="settings-save" id="custom-bg-upload" style="background:var(--card);border:1px solid var(--border);color:var(--text);margin-top:6px">⬆️ Upload background image</button>
        `}
        <input type="file" id="custom-bg-file" accept="image/jpeg,image/png,image/webp" style="display:none">
      </div>

      ${[1, 2, 3].map(slot => {
        const src = s['custom_theme_deco' + slot];
        const behavior = s['custom_theme_deco' + slot + '_behavior'] || 'random';
        return `
      <div class="settings-row">
        <label>Decoration ${slot}</label>
        ${src ? `
          <div style="display:flex;align-items:center;gap:10px;margin-top:6px;flex-wrap:wrap">
            <img src="${src}" style="width:44px;height:44px;object-fit:contain;background:var(--card);border-radius:6px;border:1px solid var(--border)">
            <select class="form-input custom-deco-behavior" data-slot="${slot}" style="width:auto;min-width:140px">
              <option value="top" ${behavior === 'top' ? 'selected' : ''}>Falls from top</option>
              <option value="bottom" ${behavior === 'bottom' ? 'selected' : ''}>Rises from bottom</option>
              <option value="left" ${behavior === 'left' ? 'selected' : ''}>Enters from left</option>
              <option value="right" ${behavior === 'right' ? 'selected' : ''}>Enters from right</option>
              <option value="random" ${behavior === 'random' ? 'selected' : ''}>Random each time</option>
            </select>
            <button type="button" class="ghost small custom-deco-remove" data-slot="${slot}">Remove</button>
            <button type="button" class="ghost small custom-deco-replace" data-slot="${slot}">Replace</button>
          </div>
        ` : `
          <button type="button" class="settings-save custom-deco-upload" data-slot="${slot}" style="background:var(--card);border:1px solid var(--border);color:var(--text);margin-top:6px">⬆️ Upload PNG decoration</button>
        `}
        <input type="file" class="custom-deco-file" data-slot="${slot}" accept="image/png" style="display:none">
      </div>`;
      }).join('')}

      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <label class="lbl" style="margin:0 0 8px">Saved Themes ${infoBtn("Save the background + decorations above as a named theme so you can switch between looks later. Loading a saved theme replaces what's above — save first if you want to keep your current edits.")}</label>
        <div id="saved-themes-list"><div style="font-size:12px;color:var(--muted)">Loading…</div></div>
        <button type="button" class="btn" id="save-theme-btn" style="background:var(--card);border:1px solid var(--border);margin-top:10px;width:100%">💾 Save current as…</button>
      </div>
    </div>

    <div class="section-header">Display</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>Text shadow ${infoBtn("Adds a soft shadow behind the text of every widget so clocks, dates and weather stay easy to read on top of a photo or a busy background. Off by default.")}</label>
        <select class="form-input" id="s-text-shadow">
          <option value="off" ${(!s.text_shadow||s.text_shadow==='off')?'selected':''}>Off</option>
          <option value="soft" ${s.text_shadow==='soft'?'selected':''}>Soft</option>
          <option value="strong" ${s.text_shadow==='strong'?'selected':''}>Strong</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Auto-refresh display <span class="info-btn" onclick="showInfoPopup('autorefresh-help')">ⓘ</span></label>
        <select class="form-input" id="s-display-refresh">
          <option value="0"    ${(!s.display_refresh_min||s.display_refresh_min==='0')?'selected':''}>Off</option>
          <option value="15"   ${s.display_refresh_min==='15'?'selected':''}>Every 15 minutes</option>
          <option value="30"   ${s.display_refresh_min==='30'?'selected':''}>Every 30 minutes</option>
          <option value="60"   ${s.display_refresh_min==='60'?'selected':''}>Every hour</option>
          <option value="180"  ${s.display_refresh_min==='180'?'selected':''}>Every 3 hours</option>
          <option value="360"  ${s.display_refresh_min==='360'?'selected':''}>Every 6 hours</option>
          <option value="720"  ${s.display_refresh_min==='720'?'selected':''}>Every 12 hours</option>
          <option value="1440" ${s.display_refresh_min==='1440'?'selected':''}>Once a day</option>
        </select>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Force real display mode <span class="info-btn" onclick="showInfoPopup('force-real-display-help')">ⓘ</span></label>
        <input type="checkbox" id="s-force-real-display" ${s.force_real_display==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <p style="font-size:11px;color:var(--muted);margin-top:6px">A legacy safety net — shouldn't normally be needed. Only turn this on if Live Editing (tap-to-edit on the wall display itself) is ever unexpectedly unavailable on a real screen.</p>
      <div class="settings-row">
        <label>Language</label>
        <select class="form-input" id="s-ui-language" translate="no">
          <option value="en" ${(s.ui_language||'en')==='en'?'selected':''}>English</option>
          <option value="de" ${s.ui_language==='de'?'selected':''}>Deutsch</option>
          <option value="fr" ${s.ui_language==='fr'?'selected':''}>Français</option>
          <option value="es" ${s.ui_language==='es'?'selected':''}>Español</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Currency</label>
        <select class="form-input" id="s-currency">
          <option value="" ${!s.currency?'selected':''}>Follow the language</option>
          <option value="USD" ${s.currency==='USD'?'selected':''}>US dollar ($)</option>
          <option value="EUR" ${s.currency==='EUR'?'selected':''}>Euro (€)</option>
          <option value="GBP" ${s.currency==='GBP'?'selected':''}>British pound (£)</option>
          <option value="CHF" ${s.currency==='CHF'?'selected':''}>Swiss franc (CHF)</option>
          <option value="CAD" ${s.currency==='CAD'?'selected':''}>Canadian dollar ($)</option>
          <option value="AUD" ${s.currency==='AUD'?'selected':''}>Australian dollar ($)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Week starts on</label>
        <select class="form-input" id="s-week-start">
          <option value="0" ${(s.week_start_day||'0')==='0'?'selected':''}>Sunday</option>
          <option value="1" ${s.week_start_day==='1'?'selected':''}>Monday</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Time format</label>
        <select class="form-input" id="s-time-format">
          <option value="12" ${(s.time_format||'12')==='12'?'selected':''}>12-hour (2:30 PM)</option>
          <option value="24" ${s.time_format==='24'?'selected':''}>24-hour (14:30)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>AM/PM style</label>
        <select class="form-input" id="s-ampm-case">
          <option value="lower" ${(s.ampm_case||'lower')==='lower'?'selected':''}>Lowercase (2:30 pm)</option>
          <option value="upper" ${s.ampm_case==='upper'?'selected':''}>Uppercase (2:30 PM)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Date format <span class="info-btn" onclick="showInfoPopup('date-format-help')">ⓘ</span></label>
        <select class="form-input" id="s-date-format">
          <option value="locale"     ${s.date_format==='locale'?'selected':''}>Follow the language</option>
          <option value="us_long"    ${(s.date_format||'us_long')==='us_long'?'selected':''}>August 5, 2026 (US)</option>
          <option value="intl_long"  ${s.date_format==='intl_long'?'selected':''}>5 August 2026 (International)</option>
          <option value="iso"        ${s.date_format==='iso'?'selected':''}>2026-08-05 (ISO)</option>
          <option value="us_short"   ${s.date_format==='us_short'?'selected':''}>08/05/2026 (US numeric)</option>
          <option value="intl_short" ${s.date_format==='intl_short'?'selected':''}>05/08/2026 (International numeric)</option>
          <option value="us_ordinal" ${s.date_format==='us_ordinal'?'selected':''}>August 5th, 2026 (Ordinal)</option>
          <option value="intl_ordinal" ${s.date_format==='intl_ordinal'?'selected':''}>5th of August 2026 (International Ordinal)</option>
        </select>
      </div>
      <div class="settings-row">
        <label>Getting started tour</label>
        <button type="button" class="ghost small" id="s-replay-tour" style="margin-top:4px">↻ Show tour again</button>
      </div>
      <div class="settings-row">
        <label>Getting started checklist</label>
        <button type="button" class="ghost small" id="s-replay-checklist" style="margin-top:4px">↻ Show checklist again</button>
      </div>
      <div class="settings-row">
        <label>Timezone <span class="info-btn" onclick="showInfoPopup('timezone-help')">ⓘ</span></label>
        <select class="form-input" id="s-timezone">
          ${tzOptions.map(([tz,label]) => `<option value="${tz}" ${((s.timezone_override||'')===tz)?'selected':''}>${label}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="section-header">Photo Widget Defaults</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 10px">The starting values any Photo widget or screen's ambient mode uses unless it has its own override set (Layout tab / Devices tab). <span class="info-btn" onclick="showInfoPopup('photo-defaults-help')">ⓘ</span></p>
      <div class="settings-row">
        <label>Brightness</label>
        <div class="range-row">
          <input type="range" id="s-ps-brightness" min="5" max="100" value="${ps.brightness||40}">
          <span class="range-val" id="s-brightness-val">${ps.brightness||40}%</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Opacity</label>
        <div class="range-row">
          <input type="range" id="s-ps-opacity" min="1" max="100" value="${ps.opacity??100}">
          <span class="range-val" id="s-opacity-val">${ps.opacity??100}%</span>
        </div>
      </div>
      <div class="settings-row">
        <label>Slideshow</label>
        <select class="form-input" id="s-ps-slideshow">
          <option value="0" ${ps.slideshow==='0'?'selected':''}>Off — show one photo</option>
          <option value="1" ${ps.slideshow==='1'?'selected':''}>On — rotate through all</option>
        </select>
      </div>
      <div class="settings-row" id="s-interval-row" style="${ps.slideshow==='1'?'':'opacity:.4;pointer-events:none'}">
        <label>Slide Interval</label>
        <select class="form-input" id="s-ps-interval">
          <option value="15"  ${ps.slideshow_interval==='15' ?'selected':''}>15 seconds</option>
          <option value="30"  ${ps.slideshow_interval==='30' ?'selected':''}>30 seconds</option>
          <option value="60"  ${ps.slideshow_interval==='60' ?'selected':''}>1 minute</option>
          <option value="300" ${ps.slideshow_interval==='300'?'selected':''}>5 minutes</option>
          <option value="900" ${ps.slideshow_interval==='900'?'selected':''}>15 minutes</option>
        </select>
      </div>
    </div>

    <div class="section-header">Calendar Sync</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>iCal Sync Frequency ${infoBtn("How often Google/Apple subscribed calendars auto-refresh. You can also tap 🔄 on a calendar in the Calendars tab to sync it instantly.")}</label>
        <select class="form-input" id="s-sync-interval">
          <option value="15"  ${s.ical_sync_minutes==='15' ?'selected':''}>Every 15 minutes</option>
          <option value="30"  ${(s.ical_sync_minutes==='30'||!s.ical_sync_minutes)?'selected':''}>Every 30 minutes</option>
          <option value="60"  ${s.ical_sync_minutes==='60' ?'selected':''}>Every hour</option>
          <option value="180" ${s.ical_sync_minutes==='180'?'selected':''}>Every 3 hours</option>
          <option value="360" ${s.ical_sync_minutes==='360'?'selected':''}>Every 6 hours</option>
        </select>
      </div>
    </div>

    <div class="section-header">Push to iCloud Calendar</div>
    <div class="settings-card">
      <div class="settings-row">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="s-icloud-enabled" ${cs.icloud_push_enabled==='1'?'checked':''} style="width:18px;height:18px;flex:0 0 auto">
          <span>Push events created here to Apple Calendar ${infoBtn("Events you add in Piazza HQ get written to one of your iCloud calendars via CalDAV, so they show up in Apple Calendar on your other devices. One-way: changes you make in Apple Calendar don't flow back here. Subscribed iCal feeds are unaffected.")}</span>
        </label>
      </div>
      <div class="settings-row">
        <label>Apple ID</label>
        <input class="form-input" id="s-icloud-user" type="email" value="${(cs.icloud_username||'').replace(/"/g,'&quot;')}" placeholder="you@icloud.com" autocomplete="off">
      </div>
      <div class="settings-row">
        <label>App-Specific Password ${infoBtn("Generate one at <strong>appleid.apple.com</strong> → Sign-In and Security → App-Specific Passwords. This is NOT your regular Apple ID password. iCloud requires it for third-party calendar access on accounts with two-factor auth.")}</label>
        <input class="form-input" id="s-icloud-pass" type="password" placeholder="${cs.icloud_app_password_set ? '•••••••••••••••• (saved — leave blank to keep)' : 'xxxx-xxxx-xxxx-xxxx'}" autocomplete="off">
      </div>
      <div class="settings-row" style="display:flex;align-items:center;gap:10px">
        <button id="s-icloud-discover-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">🔍 Find my calendars</button>
        <span id="s-icloud-discover-status" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div class="settings-row" id="s-icloud-calendar-row" style="${(cs.icloud_calendar_url||'') ? '' : 'display:none'}">
        <label>Default calendar to push into ${infoBtn("New events default to this calendar. When you add an event on the wall display you can pick a different one per event — every calendar found here shows up in that picker.")}</label>
        <select class="form-input" id="s-icloud-calendar">
          ${(() => {
            const list = Array.isArray(cs.icloud_calendars) && cs.icloud_calendars.length
              ? cs.icloud_calendars
              : ((cs.icloud_calendar_url||'') ? [{url: cs.icloud_calendar_url, name: cs.icloud_calendar_name || cs.icloud_calendar_url}] : []);
            window.__icloudCals = list;
            return list.map(c => `<option value="${String(c.url).replace(/"/g,'&quot;')}" ${c.url===cs.icloud_calendar_url?'selected':''}>${String(c.name||c.url).replace(/</g,'&lt;')}</option>`).join('');
          })()}
        </select>
      </div>
      <div class="settings-row">
        <button id="s-icloud-save-btn" class="settings-save" type="button">Save iCloud settings</button>
        <div id="s-icloud-save-status" style="font-size:12px;color:var(--muted);margin-top:6px;min-height:16px">${(cs.icloud_calendar_url||'') ? 'Connected to: ' + (cs.icloud_calendar_name||cs.icloud_calendar_url).replace(/</g,'&lt;') : ''}</div>
      </div>
    </div>

    <div class="section-header">Push to Google Calendar</div>
    <div class="settings-card">
      ${!gs.google_client_configured ? `
      <div class="settings-row">
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">This server doesn't have a Google OAuth client configured yet. Paste the Client ID and Secret from your Google Cloud project (APIs &amp; Services &rarr; Credentials &rarr; a "TVs and Limited Input devices" OAuth client), or set <code>GOOGLE_OAUTH_CLIENT_ID</code> / <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in the environment.</div>
        <label>OAuth Client ID</label>
        <input class="form-input" id="s-google-client-id" value="" placeholder="xxxxx.apps.googleusercontent.com" autocomplete="off">
        <label style="margin-top:8px">OAuth Client Secret</label>
        <input class="form-input" id="s-google-client-secret" type="password" value="" placeholder="GOCSPX-..." autocomplete="off">
        <button id="s-google-client-save-btn" class="settings-save" type="button" style="margin-top:10px">Save client credentials</button>
      </div>
      ` : `
      <div class="settings-row">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="s-google-enabled" ${gs.google_push_enabled==='1'?'checked':''} style="width:18px;height:18px;flex:0 0 auto">
          <span>Push events created here to Google Calendar ${infoBtn("One-way: events you add in Piazza HQ get written to your Google Calendar. Changes made on Google's side don't flow back. Subscribed iCal feeds are unaffected.")}</span>
        </label>
      </div>
      <div class="settings-row" id="s-google-connect-row" style="${gs.google_connected ? 'display:none' : ''}">
        <button id="s-google-connect-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer">Connect Google account</button>
        <div id="s-google-connect-status" style="font-size:12px;color:var(--muted);margin-top:8px;min-height:16px"></div>
      </div>
      <div class="settings-row" id="s-google-connected-row" style="${gs.google_connected ? '' : 'display:none'}">
        <div style="font-size:13px;color:var(--text)">Connected as <strong id="s-google-email">${(gs.google_account_email||'').replace(/</g,'&lt;')}</strong>
          <button id="s-google-disconnect-btn" type="button" style="margin-left:8px;background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline">Disconnect</button>
        </div>
      </div>
      <div class="settings-row" id="s-google-calendar-row" style="${gs.google_connected ? '' : 'display:none'}">
        <label>Calendar ID ${infoBtn("Leave blank to use your primary calendar. To push into a different one, get its ID from Google Calendar &rarr; that calendar's Settings &rarr; \"Integrate calendar\" &rarr; Calendar ID (looks like an email address).")}</label>
        <input class="form-input" id="s-google-calendar" value="${(gs.google_calendar_id && gs.google_calendar_id !== 'primary') ? gs.google_calendar_id.replace(/"/g,'&quot;') : ''}" placeholder="(your primary calendar)" autocomplete="off">
      </div>
      <div class="settings-row">
        <button id="s-google-save-btn" class="settings-save" type="button">Save Google settings</button>
        <div id="s-google-save-status" style="font-size:12px;color:var(--muted);margin-top:6px;min-height:16px">${gs.google_calendar_id ? 'Pushing to: ' + (gs.google_calendar_name||gs.google_calendar_id).replace(/</g,'&lt;') : ''}</div>
      </div>
      `}
    </div>

    <div class="section-header">Handwriting input</div>
    <div class="settings-card">
      <div class="settings-row">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="s-hw-enabled" ${hs.handwriting_enabled==='1'?'checked':''} style="width:18px;height:18px;flex:0 0 auto">
          <span>Let the display add events by handwriting ${infoBtn("On the wall display, long-press a day on a calendar widget to add an event. With this on, that sheet also gets a ✍️ button to print the title by hand. Strokes are sent to MyScript for recognition; the typed field always still works.")}</span>
        </label>
      </div>
      <div class="settings-row">
        <label>MyScript application key ${infoBtn("Free keys at developer.myscript.com (2,000 recognitions/month). One key covers every display on this account.")}</label>
        <input class="form-input" id="s-hw-appkey" value="${(hs.myscript_app_key||'').replace(/"/g,'&quot;')}" placeholder="MyScript application key" autocomplete="off">
        <label style="margin-top:8px">MyScript HMAC key</label>
        <input class="form-input" id="s-hw-hmac" type="password" value="" placeholder="${hs.myscript_hmac_key_set ? '•••• (saved — leave blank to keep)' : 'MyScript HMAC key'}" autocomplete="off">
      </div>
      <div class="settings-row">
        <button id="s-hw-save-btn" class="settings-save" type="button">Save handwriting settings</button>
        <div id="s-hw-save-status" style="font-size:12px;color:var(--muted);margin-top:6px;min-height:16px"></div>
      </div>
    </div>

    <div class="section-header">Todoist</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>API Token ${infoBtn("Find your token at todoist.com → Settings → Integrations → Developer. Tasks show read-only on the display's Tasks widget.")}</label>
        <input class="form-input" id="s-todoist" type="password" value="${s.todoist_token||''}" placeholder="Paste your Todoist API token" autocomplete="off">
      </div>
    </div>

    <div class="section-header">Home Assistant</div>
    <div class="settings-card">
      <div class="settings-row" style="display:flex;align-items:center;gap:10px">
        <button id="s-ha-detect-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">🔍 Detect automatically</button>
        <span id="s-ha-detect-status" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div id="s-ha-detect-results" style="display:none;margin:2px 0 12px;flex-direction:column;gap:6px"></div>
      <div class="settings-row">
        <label>Base URL ${infoBtn("Detect scans this machine, <code>homeassistant.local</code>, its own local network, and (if the <code>tailscale</code> command is installed here) its Tailscale peers — it won't find every setup, but covers the common ones without needing to already know the address.")}</label>
        <input class="form-input" id="s-ha-url" value="${(s.ha_base_url||'').replace(/"/g,'&quot;')}" placeholder="e.g. http://homeassistant.local:8123" autocomplete="off">
      </div>
      <div class="settings-row">
        <label>Long-Lived Access Token ${infoBtn("In Home Assistant: your profile (bottom-left) → Security tab → Long-Lived Access Tokens → Create Token. Used only by this server to read entity states for the Entity Status widget — never sent to the display or anywhere else.")}</label>
        <input class="form-input" id="s-ha-token" type="password" value="${s.ha_token||''}" placeholder="Paste your access token" autocomplete="off">
        <a id="s-ha-token-link" href="#" target="_blank" rel="noopener" style="display:none;font-size:13px;color:var(--accent);text-decoration:none;margin-top:8px">
          → Open Home Assistant's Security page to create one
        </a>
      </div>
      <div class="settings-row" style="display:flex;align-items:center;gap:10px">
        <button id="s-ha-test-btn" type="button" style="background:var(--accent);border:none;border-radius:9px;color:#fff;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Test Connection</button>
        <span id="s-ha-test-result" style="font-size:13px"></span>
      </div>

      <div class="settings-row" style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="s-phone-alerts" ${(phoneAlerts && phoneAlerts.enabled === '1') ? 'checked' : ''} style="width:18px;height:18px;flex:0 0 auto">
          <span>Also send alerts to my phone ${infoBtn("When an alert fires, push a notification to phones you've enabled below. The notification is relayed through piazzahq.com (the app on the Pi has no HTTPS of its own for push), so its title and text pass through that server in transit.")}</span>
        </label>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <button id="s-phone-alerts-setup" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer"${(phoneAlerts && phoneAlerts.setup_url) ? '' : ' disabled'}>📱 Enable on this phone</button>
          <span style="font-size:12px;color:var(--muted)">${(phoneAlerts && phoneAlerts.setup_url) ? 'Opens a one-time permission page.' : 'This device has no license key yet.'}</span>
        </div>
      </div>

      <div class="settings-row" style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label>Notification delivery ${infoBtn("Choose where each kind of notification goes. 📺 = the banner on the wall display. 📱 = a push to phones you've enabled above. A per-alert override lives on each alert rule below.")}</label>
        <div id="s-notifprefs" style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
          ${notifKinds.length ? notifKinds.map(k => {
            const p = notifPrefs[k.id] || { screen: true, phone: true };
            return `<div class="s-notifpref-row" data-kind="${(k.id||'').replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:8px 12px">
              <span style="flex:1;font-size:12.5px;font-weight:600">${escapeHtml(k.label || k.id)}</span>
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer"><input type="checkbox" class="s-np-screen" ${p.screen !== false ? 'checked' : ''} style="width:15px;height:15px">📺 Screen</label>
              <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer"><input type="checkbox" class="s-np-phone" ${p.phone !== false ? 'checked' : ''} style="width:15px;height:15px">📱 Phone</label>
            </div>`;
          }).join('') : `<div style="font-size:12px;color:var(--muted)">No notification types yet.</div>`}
        </div>
        <div id="s-notifprefs-status" style="font-size:12px;color:var(--muted);margin-top:6px;min-height:14px"></div>
      </div>

      <div class="settings-row" style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label>Alerts ${infoBtn("Raise a banner on the display when an entity's state matches a condition for a set time — e.g. a garage door open for 15 minutes, a freezer above 10°. Evaluated every 2 minutes on the host. An alert fires once, then re-arms only after the condition clears.")}</label>
        <div id="s-haalert-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
          ${haAlerts.length ? haAlerts.map(a => {
            const opText = a.op === 'eq' ? `is "${a.value}"` : a.op === 'above' ? `> ${a.value}` : `< ${a.value}`;
            return `<div class="s-haalert-row" data-id="${(a.id||'').replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:8px 10px">
              <input type="checkbox" class="s-haalert-enabled" ${a.enabled!==false?'checked':''} style="width:16px;height:16px;flex:0 0 auto">
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.name || a.entityId)} · ${escapeHtml(opText)}${a.dwellMin ? ` for ${a.dwellMin}m` : ''}</div>
                <div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.entityId || '')}${a.message ? ' · ' + escapeHtml(a.message) : ''}</div>
              </div>
              <label title="Show on the display" style="flex:0 0 auto;cursor:pointer;font-size:13px"><input type="checkbox" class="s-haalert-screen" ${a.screen!==false?'checked':''} style="width:14px;height:14px;vertical-align:middle">📺</label>
              <label title="Send to phone" style="flex:0 0 auto;cursor:pointer;font-size:13px"><input type="checkbox" class="s-haalert-phone" ${a.phone!==false?'checked':''} style="width:14px;height:14px;vertical-align:middle">📱</label>
              <button type="button" class="s-haalert-edit" title="Edit this alert" style="flex:0 0 auto;background:none;border:none;color:var(--muted);font-size:14px;cursor:pointer">✎</button>
              <button type="button" class="s-haalert-del" title="Delete this alert" style="flex:0 0 auto;background:none;border:none;color:var(--danger,#e85454);font-size:16px;cursor:pointer">✕</button>
            </div>`;
          }).join('') : `<div style="font-size:12px;color:var(--muted)">No alerts yet.</div>`}
        </div>
        <div id="s-haalert-form" style="display:none;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:10px;margin-bottom:10px">
          <button type="button" class="form-input" id="s-haalert-entity-btn" style="text-align:left;cursor:pointer;margin-bottom:8px;color:var(--muted)">Choose an entity…</button>
          <input type="hidden" id="s-haalert-entity">
          <div style="display:flex;gap:8px;margin-bottom:6px">
            <select class="form-input" id="s-haalert-op" style="flex:0 0 44%">
              <option value="eq">state is</option><option value="above">above</option><option value="below">below</option>
            </select>
            <div id="s-haalert-value-wrap" style="flex:1"></div>
          </div>
          <div id="s-haalert-cur" style="font-size:11px;color:var(--muted);margin-bottom:8px;min-height:13px"></div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input class="form-input" id="s-haalert-dwell" type="number" min="0" max="1440" value="0" placeholder="minutes" style="flex:0 0 44%">
            <span style="font-size:12px;color:var(--muted);align-self:center">minutes it must hold</span>
          </div>
          <input class="form-input" id="s-haalert-msg" placeholder="Banner message (optional)" style="margin-bottom:8px">
          <div style="display:flex;gap:8px">
            <button id="s-haalert-add-confirm" class="settings-save" type="button" style="flex:1">Add alert</button>
            <button id="s-haalert-add-cancel" type="button" style="flex:0 0 auto;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:0 14px">Cancel</button>
          </div>
        </div>
        <button id="s-haalert-add-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer">+ Add alert</button>
        <div id="s-haalert-status" style="font-size:12px;color:var(--muted);margin-top:8px;min-height:16px"></div>
      </div>
    </div>

    <div class="section-header">Home Assistant Control</div>
    <div class="settings-card">
      <p style="font-size:13px;color:var(--muted);margin:0 0 14px">The reverse direction from the Home Assistant card above: let Home Assistant (or any automation tool that can make an HTTP request) trigger actions here — turn a TV/monitor on or off, or switch a display to a saved layout (which also switches its light/dark theme, since each saved layout stores its own). Generates a long-lived token; wire it into Home Assistant's <code>rest_command:</code> once.</p>
      ${s.device_role === 'slave' ? `<p style="font-size:12px;color:#e0a339;margin:0 0 14px;background:var(--card);border:1px solid var(--border);border-radius:9px;padding:10px 12px">You're viewing Settings on a <b>mirror</b>. Point Home Assistant at your <b>host</b> Pi's address instead of this one's — these actions read and write the host's own data.</p>` : ''}
      <div class="settings-row">
        <label>Automation Token ${infoBtn("Regenerating immediately breaks any Home Assistant automation already using the old token — update it there too. This token only allows TV/monitor power and layout switching; it can't read data or change any other setting.")}</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input class="form-input" id="s-automation-token" type="password" value="${s.automation_token||''}" placeholder="Not generated yet" readonly style="opacity:.8">
          <button id="s-automation-token-show-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px 16px;font-size:13px;cursor:pointer;white-space:nowrap">👁</button>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button id="s-automation-token-gen-btn" type="button" style="background:var(--accent);border:none;border-radius:10px;color:#fff;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">${s.automation_token ? 'Regenerate' : 'Generate Token'}</button>
          ${s.automation_token ? `<button id="s-automation-token-revoke-btn" type="button" style="background:transparent;border:1px solid var(--danger,#e85454);color:var(--danger,#e85454);border-radius:10px;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Revoke</button>` : ''}
        </div>
      </div>
      <div class="settings-row" id="s-automation-instructions" style="display:${s.automation_token ? 'block' : 'none'}">
        <div class="acc-section" data-acc="ha-rest-setup">
          <button class="acc-head" data-acc-toggle="ha-rest-setup">
            <span class="acc-ic">📋</span>
            <span class="acc-text"><span class="acc-label">Setting this up in Home Assistant</span><span class="acc-sub">4 steps — rest_command: YAML</span></span>
            <span class="acc-caret">▸</span>
          </button>
          <div class="acc-body" data-acc-body="ha-rest-setup" style="display:none">
            <div style="font-size:13px;color:var(--text);line-height:1.8;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px">
              <p style="margin:0 0 6px"><b>1.</b> Add a <code>rest_command:</code> block like this to Home Assistant's <code>configuration.yaml</code> (replace <code>&lt;host-pi-ip&gt;</code> with your host Pi's actual LAN address — this page's own address only works if you're viewing it from the host itself). No easy way to open that file yet? The <b>File Editor</b> or <b>Studio Code Server</b> add-on (Settings → Add-ons → Add-on Store) gives you one:</p>
              <div style="background:var(--bg,#0f1420);border-radius:8px;padding:10px 12px;margin:10px 0;white-space:pre;overflow-x:auto;font-family:monospace;font-size:12px">rest_command:
  piazzahq_screen_off:
    url: "http://&lt;host-pi-ip&gt;:${escapeHtml(window.location.port || '3000')}/api/screens/${escapeHtml(s.screen_device_id_cache||'YOUR_DEVICE_ID')}/tv/power-off"
    method: POST
    headers:
      Authorization: "Bearer ${escapeHtml(s.automation_token||'YOUR_TOKEN')}"
  piazzahq_screen_on:
    url: "http://&lt;host-pi-ip&gt;:${escapeHtml(window.location.port || '3000')}/api/screens/${escapeHtml(s.screen_device_id_cache||'YOUR_DEVICE_ID')}/tv/power-on"
    method: POST
    headers:
      Authorization: "Bearer ${escapeHtml(s.automation_token||'YOUR_TOKEN')}"</div>
              <p style="margin:14px 0 6px"><b>2.</b> Call it from any automation — a Person entity leaving home, a sleep-tracker sensor, a time trigger — via the <code>rest_command.piazzahq_screen_off</code> / <code>_on</code> action. This example targets <b>this screen</b> (device id shown below); use a different screen's own device id from Settings → Multi-Device to target it instead.</p>
              <p style="margin:14px 0 6px"><b>3.</b> To switch layouts (and theme) instead: same idea, but POST to <code>/api/saved-layouts/&lt;layout-id&gt;/apply</code> with a JSON body of <code>{"display": "&lt;display-slug&gt;"}</code> and the same Authorization header. Find each saved layout's id and a display's slug from the Layout tab's Layout Library and Multi-Device screen list.</p>
              <p style="margin:14px 0 6px"><b>4.</b> Restart Home Assistant (Settings → System → Restart) — a new <code>rest_command:</code> block doesn't take effect until it does.</p>
              <p style="margin:14px 0 0;font-size:12px;color:var(--muted)">This screen's own device id (used in the example above): <code>${escapeHtml(s.screen_device_id_cache||'(not set yet)')}</code></p>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-row" style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="s-mqtt-enabled" ${s.mqtt_enabled==='1'?'checked':''} style="width:18px;height:18px;flex:0 0 auto">
          <span>MQTT (no YAML, entities auto-appear) ${infoBtn("An alternative to the rest_command setup above, for households that already run an MQTT broker (the Mosquitto add-on is the common one). Piazza HQ connects to it directly and publishes Home Assistant MQTT Discovery entities — a Power switch per screen with TV control set up, and a Layout select per display — so nothing needs to be typed into Home Assistant's YAML at all. Both doors can be on at once if you want; they don't conflict.")}</span>
        </label>
        <div id="s-mqtt-fields" style="display:${s.mqtt_enabled==='1'?'flex':'none'};flex-direction:column;gap:12px;margin-top:12px">
          <div>
            <label>Broker URL ${infoBtn("e.g. mqtt://homeassistant.local:1883 for the Mosquitto broker add-on, or mqtts://… for a TLS broker on port 8883.")}</label>
            <input class="form-input" id="s-mqtt-url" value="${(s.mqtt_broker_url||'').replace(/"/g,'&quot;')}" placeholder="mqtt://homeassistant.local:1883" autocomplete="off">
          </div>
          <div style="display:flex;gap:12px">
            <div style="flex:1">
              <label>Username <span style="color:var(--muted);font-weight:400">(optional)</span></label>
              <input class="form-input" id="s-mqtt-username" value="${(s.mqtt_username||'').replace(/"/g,'&quot;')}" autocomplete="off">
            </div>
            <div style="flex:1">
              <label>Password <span style="color:var(--muted);font-weight:400">(optional)</span></label>
              <input class="form-input" id="s-mqtt-password" type="password" value="${(s.mqtt_password||'').replace(/"/g,'&quot;')}" autocomplete="off">
            </div>
          </div>
          <div>
            <label>Discovery prefix ${infoBtn("Only needs changing if Home Assistant's own MQTT integration is set to something other than its default.")}</label>
            <input class="form-input" id="s-mqtt-prefix" value="${(s.mqtt_discovery_prefix||'').replace(/"/g,'&quot;')}" placeholder="homeassistant" autocomplete="off">
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <button id="s-mqtt-test-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:9px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Test Connection</button>
            <button id="s-mqtt-save-btn" type="button" style="background:var(--accent);border:none;border-radius:9px;color:#fff;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Save</button>
            <span id="s-mqtt-status" style="font-size:13px"></span>
          </div>
          <div class="acc-section" data-acc="ha-mqtt-setup">
            <button class="acc-head" data-acc-toggle="ha-mqtt-setup">
              <span class="acc-ic">💡</span>
              <span class="acc-text"><span class="acc-label">Setup tips</span><span class="acc-sub">getting a broker, finding the entities</span></span>
              <span class="acc-caret">▸</span>
            </button>
            <div class="acc-body" data-acc-body="ha-mqtt-setup" style="display:none">
              <p style="font-size:12px;color:var(--muted);margin:0 0 6px">Don't have a broker yet? Settings → Add-ons → Add-on Store → search "Mosquitto broker" is the easiest way to get one — free, official, a few clicks to install.</p>
              <p style="font-size:12px;color:var(--muted);margin:0">Once connected, a Power switch (per screen with TV control set up) and a Layout select (per display) appear in Home Assistant on their own — no restart needed there, MQTT Discovery picks them up automatically. Look under Settings → Devices & Services → MQTT if you don't see them right away. Same honest limitation as the rest_command door above: these can tell a screen to turn on/off or switch layouts, but can't reliably report whether a TV is actually currently on (most TV remotes have no "are you on" signal to ask).</p>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-row" style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label>Native Integration (HACS) ${infoBtn("A third way to connect, alongside rest_command and MQTT above — a real Home Assistant integration with its own setup screen: enter this device's address and the automation token above, click connect, done. Same two actions (TV/monitor power, saved-layout apply) as the other two doors — don't run more than one door for the same device at once, or you'll get duplicate entities.")}</label>
        <p style="font-size:12px;color:var(--muted);margin:8px 0 12px">No YAML, no broker — installed through HACS, Home Assistant's community add-on store. Needs HACS itself installed in Home Assistant first (<a href="https://hacs.xyz" target="_blank" rel="noopener" style="color:var(--accent)">hacs.xyz</a>).</p>
        <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=jlauty21&repository=piazzahq-homeassistant&category=integration" target="_blank" rel="noopener" style="display:inline-block;text-decoration:none;background:var(--accent);border:none;border-radius:10px;color:#fff;padding:12px 18px;font-size:13px;font-weight:600;white-space:nowrap">Add to Home Assistant</a>
        <p style="font-size:11px;color:var(--muted);margin:10px 0 0">Opens Home Assistant's own site, which hands off to your instance's HACS to add the repository. You'll still generate an automation token above and enter it when Home Assistant asks for it.</p>
      </div>
    </div>

    <div class="section-header">Severe Weather Alerts</div>
    <div class="settings-card">
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:0">Severe weather alerts ${infoBtn("Uses the free US National Weather Service — no key, but US-only. Polls your weather location every 10 minutes for active warnings/watches and fires through the same banner + phone alert system as Home Assistant alerts above (set delivery there in Notification delivery).")}</label>
        </div>
        <input type="checkbox" id="s-wxalert-enabled" ${s.severe_weather_alerts_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto">
      </div>
      <div class="settings-row" id="s-wxalert-severity-row" style="${s.severe_weather_alerts_enabled==='1'?'':'display:none'}">
        <label>Minimum severity ${infoBtn("NWS rates every alert Extreme/Severe/Moderate/Minor. Moderate and up covers real warnings and watches while skipping routine advisories (Frost Advisory, Small Craft Advisory, etc).")}</label>
        <select class="form-input" id="s-wxalert-severity">
          <option value="Extreme"  ${s.severe_weather_min_severity==='Extreme'?'selected':''}>Extreme only</option>
          <option value="Severe"   ${s.severe_weather_min_severity==='Severe'?'selected':''}>Severe and up</option>
          <option value="Moderate" ${(!s.severe_weather_min_severity||s.severe_weather_min_severity==='Moderate')?'selected':''}>Moderate and up</option>
          <option value="Minor"    ${s.severe_weather_min_severity==='Minor'?'selected':''}>Minor and up (everything)</option>
        </select>
      </div>
      <div class="settings-row" id="s-wxalert-types-row" style="${s.severe_weather_alerts_enabled==='1'?'':'display:none'}">
        <label>Alert types ${infoBtn("Turn off the kinds of alert you don't want. A type that is off never alerts you, whatever its severity - useful for things like Flood Warnings, which the Weather Service rates Severe and re-issues all day. Snooze quiets one type for a while instead. Both apply right away; you don't need to press Save.")}</label>
        <div id="wx-types-box" style="font-size:13px;color:var(--muted)">Loading…</div>
      </div>
    </div>

    <div class="section-header">Voice Control (Siri Shortcuts)</div>
    <div class="settings-card">
      <p style="font-size:13px;color:var(--muted);margin:0 0 14px">Lets Siri (via the iOS Shortcuts app) add items to your shopping list or a To-Do list by voice — "Hey Siri, add milk to the shopping list." This generates a long-lived token; the actual Shortcut is built once in Apple's Shortcuts app using it.</p>
      <div class="settings-row">
        <label>Voice Token ${infoBtn("Regenerating immediately breaks any Shortcut already built with the old token — you'd need to update it there too. Only grants adding items, not reading or deleting anything, or any other access to this app.")}</label>
        <div style="display:flex;gap:10px;align-items:center">
          <input class="form-input" id="s-voice-token" type="password" value="${s.voice_token||''}" placeholder="Not generated yet" readonly style="opacity:.8">
          <button id="s-voice-token-show-btn" type="button" style="background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px 16px;font-size:13px;cursor:pointer;white-space:nowrap">👁</button>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button id="s-voice-token-gen-btn" type="button" style="background:var(--accent);border:none;border-radius:10px;color:#fff;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">${s.voice_token ? 'Regenerate' : 'Generate Token'}</button>
          ${s.voice_token ? `<button id="s-voice-token-revoke-btn" type="button" style="background:transparent;border:1px solid var(--danger,#e85454);color:var(--danger,#e85454);border-radius:10px;padding:12px 18px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Revoke</button>` : ''}
        </div>
      </div>
      <div class="settings-row" id="s-voice-instructions" style="display:${s.voice_token ? 'block' : 'none'}">
        <label>Setting up the Shortcut — just one field to build</label>
        <div style="font-size:13px;color:var(--text);line-height:1.8;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px">

          <p style="margin:0 0 6px"><b>1.</b> Open the <b>Shortcuts</b> app → tap <b>+</b> (top right) to start a new Shortcut.</p>

          <p style="margin:14px 0 6px"><b>2.</b> Tap <b>Add Action</b>, search for <b>"Ask for Input"</b>, add it. Leave the type as <b>Text</b>.</p>

          <p style="margin:14px 0 6px"><b>3.</b> Tap <b>Add Action</b> again, search for <b>"Get Contents of URL"</b>, add it. Nothing else needs configuring on this action — no Method, no Headers, no Body — everything goes in the URL itself.</p>

          <p style="margin:14px 0 4px"><b>4.</b> Tap the URL field. Copy and paste this into it exactly as-is (it already has your token in it — this whole line is private, treat it like a password):</p>
          <div style="background:var(--bg,#0f1420);border-radius:8px;padding:10px 12px;margin:0 0 10px;word-break:break-all;font-family:monospace;font-size:12px">${window.location.origin}/api/voice/add-item?token=${s.voice_token||'YOUR_TOKEN'}&list=shopping&text=</div>

          <p style="margin:14px 0 6px"><b>5.</b> Before touching that URL field again — tap <b>Add Action</b> and add <b>"Replace Text"</b> first, <i>above</i> "Get Contents of URL" in the list. Set it up as: Find = a single space (tap the spacebar once), Replace = <code>%20</code>, and for the "In" field, insert the <b>"Ask for Input"</b> variable (tap the variable-picker icon above the keyboard). This step matters — without it, anything you say with more than one word (like "paper towels") gets silently cut off at the first space and only "paper" would be added. One word items would've worked fine without this, which is exactly why it's easy to miss during testing.</p>

          <p style="margin:14px 0 4px"><b>6.</b> Now go back to the URL field from step 4. Your cursor should be right after <code>text=</code> at the very end. Tap the variable-picker icon and choose the <b>result of "Replace Text"</b> (not "Ask for Input" directly this time — you want the encoded version). It should drop in as a gray rounded chip right there in the URL.</p>

          <p style="margin:14px 0 6px"><b>7.</b> Tap the ▶ play button at the bottom of the screen to test it right now — answer with something that has a space in it, like "paper towels," specifically to confirm step 5 actually worked. Check your real shopping list for the full phrase, not just the first word. Fix anything that errors before moving on.</p>

          <p style="margin:14px 0 0"><b>8.</b> Tap the Shortcut's name/settings at the top → <b>Add to Siri</b> → record a trigger phrase, e.g. "add to shopping list." When Siri asks what to add, answering with just the item name (not a full sentence) keeps your list entries clean — whatever you say is exactly what gets added, word for word.</p>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:14px">
          Want a different list? Change <code>list=shopping</code> in step 4 to the exact name of
          another Shopping list (like Costco) or a To-Do list instead. Alexa also works, using the same underlying
          endpoint but a separate setup — needs its own public HTTPS endpoint and an
          Alexa Developer Console skill (endpoint: <code style="word-break:break-all">${window.location.origin}/api/alexa</code>).
        </p>
      </div>
    </div>

    <div class="section-header">Stocks</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>Market Indices ${infoBtn("Uncheck any index you don't want shown on the display or in the briefing email.")}</label>
        <div id="stock-indices" style="display:flex;flex-direction:column;gap:2px">
          ${[['^DJI','Dow Jones'],['^IXIC','Nasdaq'],['^GSPC','S&P 500']].map(([sym,lbl]) => {
            const disabled = (s.stock_indices_disabled||'').split(',').map(x=>x.trim()).includes(sym);
            return `<label style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;cursor:pointer">
              <span>${lbl}</span>
              <input type="checkbox" class="stock-index-cb" data-sym="${sym}" ${disabled?'':'checked'} style="width:20px;height:20px;accent-color:var(--accent)">
            </label>`;
          }).join('')}
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:10px">Individual tickers (AAPL, BTC-USD, etc.) are now tracked per Stock widget — open a Stock widget's own settings from the Layout editor to add its list.</p>
      </div>
    </div>

    <div class="section-header">News</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 14px">Turn on any combination of sources. Tap the ★ to mark a source as <b>priority</b> — priority sources get guaranteed slots so they can't be crowded out. Headlines appear grouped by source on the display.</p>

      <div class="news-src" data-src="world">
        <div class="news-src-head">
          <label class="news-src-name">World <span style="color:var(--muted);font-weight:400">· Global headlines</span></label>
          <button type="button" class="news-star ${s.news_world_priority==='1'?'on':''}" id="news-world-priority-btn" title="Priority">★</button>
          <input type="checkbox" id="news-world-enabled" ${s.news_world_enabled==='1'?'checked':''} class="news-toggle">
        </div>
      </div>

      <div class="news-src" data-src="national">
        <div class="news-src-head">
          <label class="news-src-name">National <span style="color:var(--muted);font-weight:400">· Top Stories</span></label>
          <button type="button" class="news-star ${s.news_national_priority==='1'?'on':''}" id="news-national-priority-btn" title="Priority">★</button>
          <input type="checkbox" id="news-national-enabled" ${s.news_national_enabled==='1'?'checked':''} class="news-toggle">
        </div>
      </div>

      <div class="news-src" data-src="local">
        <div class="news-src-head">
          <label class="news-src-name">Local</label>
          <button type="button" class="news-star ${s.news_local_priority==='1'?'on':''}" id="news-local-priority-btn" title="Priority">★</button>
          <input type="checkbox" id="news-local-enabled" ${s.news_local_enabled==='1'?'checked':''} class="news-toggle">
        </div>
        <input class="form-input news-src-extra" id="news-local-location" value="${(s.news_local_location||'').replace(/"/g,'&quot;')}" placeholder="City or region, e.g. Columbus, OH" autocomplete="off" style="margin-top:8px">
      </div>

      <div class="news-src" data-src="keywords">
        <div class="news-src-head">
          <label class="news-src-name">Keywords / Topics</label>
          <button type="button" class="news-star ${s.news_keywords_priority==='1'?'on':''}" id="news-keywords-priority-btn" title="Priority">★</button>
          <input type="checkbox" id="news-keywords-enabled" ${s.news_keywords_enabled==='1'?'checked':''} class="news-toggle">
        </div>
        <input class="form-input news-src-extra" id="news-keywords" value="${(s.news_keywords||'').replace(/"/g,'&quot;')}" placeholder="Comma-separated, e.g. space launch, Chiefs, AI" autocomplete="off" style="margin-top:8px">
        <p style="font-size:11px;color:var(--muted);margin-top:6px">Each term becomes its own group, labeled with the term.</p>
      </div>
    </div>

    <div class="section-header">Daily Briefing</div>
    <div class="settings-card" id="briefing-card">
      <div id="briefing-slave-note" style="display:none;background:#222;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:var(--muted)">
        📡 The daily email is sent by your host device, so it's disabled here to avoid duplicate emails. Manage the briefing on the host.
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Enable Daily Email</label>
        <input type="checkbox" id="bf-enabled" ${bs.briefing_enabled==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
      </div>
      <div id="bf-fields" style="${bs.briefing_enabled==='1'?'':'opacity:.4;pointer-events:none'}">
        <div class="accordion" id="briefing-accordion" style="margin-top:10px">

          <!-- Schedule & Recipients -->
          <div class="acc-section open" data-acc="bf-schedule">
            <button class="acc-head" data-acc-toggle="bf-schedule">
              <span class="acc-ic">🕗</span>
              <span class="acc-text"><span class="acc-label">Schedule &amp; Recipients</span></span>
              <span class="acc-caret">▾</span>
            </button>
            <div class="acc-body" data-acc-body="bf-schedule">
              <div class="settings-row">
                <label>Send Time</label>
                <input class="form-input" id="bf-time" type="time" value="${bs.briefing_time||'07:00'}">
              </div>
              <div class="settings-row">
                <label>Recipients ${infoBtn("Each person gets their own email, personalized with their name and a time-of-day greeting.")}</label>
                <div id="bf-recipient-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px"></div>
                <div style="display:flex;gap:8px;margin-top:10px">
                  <input class="form-input" id="bf-new-name" type="text" placeholder="Name" style="flex:1" autocomplete="off">
                  <input class="form-input" id="bf-new-email" type="email" placeholder="Email address" style="flex:1.4" autocomplete="off">
                  <button id="bf-add-recipient-btn" style="background:var(--accent);border:none;border-radius:10px;padding:0 16px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">Add</button>
                </div>
              </div>
            </div>
          </div>

          <!-- What to Include -->
          <div class="acc-section" data-acc="bf-content">
            <button class="acc-head" data-acc-toggle="bf-content">
              <span class="acc-ic">📋</span>
              <span class="acc-text"><span class="acc-label">What to Include</span></span>
              <span class="acc-caret">▸</span>
            </button>
            <div class="acc-body" data-acc-body="bf-content" style="display:none">
              <div class="settings-row">
                <label>Which Tasks to Include <span class="info-btn" onclick="showInfoPopup('bf-task-scope-help')">ⓘ</span></label>
                <select class="form-input" id="bf-task-scope">
                  <option value="all" ${bs.briefing_task_scope!=='today'?'selected':''}>All tasks (any due date)</option>
                  <option value="today" ${bs.briefing_task_scope==='today'?'selected':''}>Only tasks due today</option>
                </select>
              </div>
              <div class="settings-row">
                <label>Weather Detail ${infoBtn("How the day's weather is broken down in the email. Both include the current temp and the day's high/low.")}</label>
                <select class="form-input" id="bf-weather-format">
                  <option value="summary" ${bs.briefing_weather_format!=='hourly'?'selected':''}>Morning / Afternoon / Evening</option>
                  <option value="hourly"  ${bs.briefing_weather_format==='hourly'?'selected':''}>Hourly (every 3 hours)</option>
                </select>
              </div>
              <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
                <label style="margin-bottom:0">Include News</label>
                <input type="checkbox" id="bf-include-news" ${bs.briefing_include_news!=='0'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
              </div>
              <div class="settings-row">
                <label>Max Articles per Section <span class="info-btn" onclick="showInfoPopup('bf-news-per-section-help')">ⓘ</span></label>
                <select class="form-input" id="bf-news-per-section">
                  ${[1,2,3,4,5,6,8,10].map(n => `<option value="${n}" ${String(bs.briefing_news_per_section||'3')===String(n)?'selected':''}>${n} article${n>1?'s':''}</option>`).join('')}
                </select>
              </div>
              <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
                <label style="margin-bottom:0">Include Markets (prev. close)</label>
                <input type="checkbox" id="bf-include-stocks" ${bs.briefing_include_stocks==='1'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
              </div>
              <p style="font-size:11px;color:var(--muted);margin-top:-4px">Adds a markets summary (the indices, plus any tickers tracked across your Stock widgets) with the previous close and change.</p>
              <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
                <label style="margin-bottom:0">Include Reminders</label>
                <input type="checkbox" id="bf-include-reminders" ${bs.briefing_include_reminders!=='0'?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
              </div>
              <p style="font-size:11px;color:var(--muted);margin-top:-4px">Anything due today from your Reminders (trash day, recycling, etc.) — same schedule the Reminders widget and calendar badges read from. Only shows up in the email on days something's actually due.</p>
              <div class="settings-row">
                <label>Todoist Projects to Include ${infoBtn("Choose which Todoist projects' tasks show up in the email. Leave everything checked to include all projects.")}</label>
                <div id="bf-project-list" style="display:flex;flex-direction:column;gap:8px;margin-top:4px"></div>
              </div>
            </div>
          </div>

          <!-- Email Account -->
          <div class="acc-section" data-acc="bf-account">
            <button class="acc-head" data-acc-toggle="bf-account">
              <span class="acc-ic">✉️</span>
              <span class="acc-text"><span class="acc-label">Email Account</span></span>
              <span class="acc-caret">▸</span>
            </button>
            <div class="acc-body" data-acc-body="bf-account" style="display:none">
              <div class="settings-row">
                <label>Sending Account ${infoBtn("More providers (Outlook, custom SMTP) can be added later.")}</label>
                <select class="form-input" id="bf-provider">
                  <option value="gmail" ${bs.briefing_provider==='gmail'?'selected':''}>Gmail</option>
                </select>
              </div>
              <div class="settings-row">
                <label>Gmail Address</label>
                <input class="form-input" id="bf-email-user" type="email" placeholder="you@gmail.com" value="${bs.briefing_email_user||''}" autocomplete="off">
              </div>
              <div class="settings-row">
                <label>Gmail App Password ${infoBtn("Generate one at <strong>myaccount.google.com/apppasswords</strong> (requires 2-Step Verification on the Gmail account). This is not your regular Gmail password.")}</label>
                <input class="form-input" id="bf-email-pass" type="password" placeholder="${bs.briefing_email_pass_set ? '•••••••••••••••• (saved — leave blank to keep)' : '16-character app password'}" autocomplete="off">
              </div>
            </div>
          </div>

          <!-- Test & Preview -->
          <div class="acc-section" data-acc="bf-test">
            <button class="acc-head" data-acc-toggle="bf-test">
              <span class="acc-ic">🧪</span>
              <span class="acc-text"><span class="acc-label">Test &amp; Preview</span></span>
              <span class="acc-caret">▸</span>
            </button>
            <div class="acc-body" data-acc-body="bf-test" style="display:none">
              <div class="settings-row">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                  <button class="icon-btn" id="bf-preview-btn" style="width:100%;font-size:13px;padding:10px;display:flex;align-items:center;justify-content:center;gap:6px">
                    👁️ Preview
                  </button>
                  <button class="icon-btn" id="bf-send-now-btn" style="width:100%;font-size:13px;padding:10px;display:flex;align-items:center;justify-content:center;gap:6px">
                    📤 Send Now
                  </button>
                </div>
                <div style="display:flex;gap:8px;margin-top:8px">
                  <input class="form-input" id="bf-test-email" type="email" placeholder="Send a test to…" style="flex:1" autocomplete="off">
                  <button id="bf-test-btn" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:0 16px;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">Send Test</button>
                </div>
                ${bs.briefing_last_sent ? `<p style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center">Last sent: ${bs.briefing_last_sent}</p>` : ''}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <div class="section-header">Family profiles</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>Family profiles ${infoBtn("Give each person in the household their own view of this app — hide the tabs and features they don't use. It's a persona picker, not a login: switching profiles is instant, and an optional PIN is only a gentle gate, not a lock. With no profiles set up, the app works exactly as it always has.")}</label>
        <p style="font-size:12px;color:var(--muted);margin:2px 0 10px">Personalize which tabs and features each household member sees. Managers can edit everyone; everyone can tailor their own view.</p>
        <div id="profiles-settings-body"><div style="font-size:12px;color:var(--muted)">Loading…</div></div>
      </div>
    </div>

    <div class="section-header">Security</div>
    <div class="settings-card">
      <div class="settings-row">
        <label>App PIN ${infoBtn("Set a PIN to protect the app when accessed remotely. The display is always public.")}</label>
        <input class="form-input" id="s-pin" type="password" inputmode="numeric"
          placeholder="${s.app_pin ? 'PIN is set — leave blank to keep it' : 'No PIN set — leave blank for none'}" autocomplete="new-password">
        <input class="form-input" id="s-pin-confirm" type="password" inputmode="numeric"
          placeholder="Confirm PIN" autocomplete="new-password" style="margin-top:8px;display:none">
        <div id="s-pin-hint" style="font-size:12px;color:var(--muted);margin-top:6px"></div>
        <button type="button" class="btn btn-primary" id="s-pin-save-btn" style="display:none;margin-top:8px">Set PIN</button>
        ${s.app_pin ? `<button type="button" id="s-pin-remove-btn" style="background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;padding:6px 0;margin-top:2px">Remove PIN protection</button>` : ''}
      </div>
      <div class="settings-row">
        <label>Remote access login ${infoBtn("A separate password that is only asked for when someone reaches this device from outside your home network, for example through a remote-access link. Your home network and this screen never ask for it, so setting it changes nothing for anyone at home. Signing in with it also covers the App PIN.")}</label>
        <div id="ra-body"><div style="font-size:12px;color:var(--muted)">Loading…</div></div>
      </div>
      <div class="settings-row">
        <label>Remote access link ${infoBtn("A private web address (like brave-otter-4821.piazzahq.com) that opens this calendar from anywhere, protected by your remote password. It works through a secure connection this device makes out to Cloudflare, so nothing is opened on your router. Only your main (host) device turns it on. Camera video, backups and software updates stay available only on your home network.")}</label>
        <div id="rl-body"><div style="font-size:12px;color:var(--muted)">Loading…</div></div>
      </div>
    </div>

    <div class="section-header">Feedback &amp; Ideas</div>
    <div class="settings-card">
      <div id="fb-replies" style="display:none;margin-bottom:16px"></div>
      <div class="settings-row">
        <label>Send feedback, a bug report, or an idea ${infoBtn("Your note is sent to the team. Thanks for helping make this better.")}</label>
        <select class="form-input" id="fb-kind" style="margin-bottom:8px">
          <option value="feedback">💬 General feedback</option>
          <option value="bug">🐞 Something's broken</option>
          <option value="feature">💡 Feature idea</option>
        </select>
        <textarea class="form-input" id="fb-message" rows="4" placeholder="Tell us what's on your mind…" style="resize:vertical"></textarea>
        <input type="file" id="fb-image" accept="image/*" style="display:none">
        <button type="button" class="btn" id="fb-photo-btn" style="background:var(--card);border:1px solid var(--border);margin-top:8px;width:100%">📷 Add a photo (optional)</button>
        <div id="fb-image-preview" style="margin-top:8px"></div>
        <button class="settings-save" id="fb-submit-btn" style="margin-top:10px">Send</button>
        <div id="fb-status" style="font-size:13px;margin-top:8px"></div>
      </div>
      <div class="settings-row" id="fb-admin-config" style="display:none;border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="fb-digest-enabled" style="width:18px;height:18px;accent-color:var(--accent)">
          Send a daily digest of submissions to the developer
        </label>
        <p style="font-size:11px;color:var(--muted);margin:6px 0 10px">Bug reports and ideas you submit are emailed once a day to the app's developer so they can be fixed and improved. Uses this device's email account (the same one as the Daily Briefing) and only sends if there's at least one new submission that day.</p>
        <div id="fb-digest-fields" style="display:none">
          <label style="font-size:12px;color:var(--muted)">Send at</label>
          <input class="form-input" id="fb-time" type="time" style="margin-bottom:4px">
        </div>
      </div>
      <div class="settings-row" style="display:none;border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
        <label>Central server (optional) ${infoBtn("If set, each submission is also sent in real time to a central server.")}</label>
        <input class="form-input" id="fb-central-url" placeholder="https://your-server.ts.net" style="margin-bottom:8px">
        <input class="form-input" id="fb-central-key" placeholder="Feedback key (shared secret)" autocomplete="off">
      </div>
    </div>

    ${hasSupportLinks ? `
    <div class="section-header">Support the Project</div>
    <div class="settings-card" id="support-card">
      <div class="settings-row">
        <label>Support the Project ${infoBtn("Piazza HQ is free to use. If it's useful to your family, a one-time coffee is always appreciated — never required.")}</label>
        <div id="support-links-buttons" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">${supportButtonsHtml}</div>
      </div>
    </div>
    ` : ''}

    <div class="section-header">Multi-Device</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 12px">Run more than one display from a single set of calendars and photos. One device is the <b>host</b> (the source of truth). Other devices are <b>displays</b> that mirror the host's content but keep their own layout. Edit content on the host; each display still controls its own look.</p>
      <div class="settings-row">
        <label>This Device's Role</label>
        <select class="form-input" id="md-role">
          <option value="host"  ${s.device_role!=='slave'?'selected':''}>Host — the main device (source of truth)</option>
          <option value="slave" ${s.device_role==='slave'?'selected':''}>Display — mirrors a host</option>
        </select>
      </div>

      <div id="md-slave-fields" style="${s.device_role==='slave'?'':'display:none'}">
        <div class="settings-row">
          <label>Host Tailscale Address  ${infoBtn("If both devices are on Tailscale, this is used first so it works from any network.")}<span style="color:var(--muted);font-weight:400">(preferred)</span></label>
          <input class="form-input" id="md-host-ts" value="${(s.host_ts_address||'').replace(/"/g,'&quot;')}" placeholder="e.g. 100.115.65.87" autocomplete="off">
        </div>
        <div class="settings-row">
          <label>Host LAN Address <span style="color:var(--muted);font-weight:400">(fallback)</span></label>
          <input class="form-input" id="md-host-lan" value="${(s.host_lan_address||'').replace(/"/g,'&quot;')}" placeholder="e.g. 192.168.1.50" autocomplete="off">
        </div>
        <p style="font-size:11px;color:var(--muted);margin:-4px 0 4px">If the host has a PIN, this device's own App PIN (Security section below) needs to match it — one shared PIN for the household, not a separate one per screen.</p>
        <div class="settings-row" style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label>Host Port</label>
            <input class="form-input" id="md-host-port" value="${s.host_port||'3000'}" placeholder="3000" autocomplete="off">
          </div>
          <div style="flex:1">
            <label>Sync Every</label>
            <select class="form-input" id="md-sync-interval">
              ${[1,2,5,10,15,30].map(n=>`<option value="${n}" ${String(s.sync_interval_min||'5')===String(n)?'selected':''}>${n} min</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="settings-save" id="md-test-btn" style="flex:1;background:var(--card);border:1px solid var(--border);color:var(--text)">Test Connection</button>
          <button class="settings-save" id="md-sync-now-btn" style="flex:1">Sync Now</button>
        </div>
        <div id="md-sync-status" style="font-size:12px;color:var(--muted);margin-top:10px;min-height:18px">
          ${s.last_sync_status ? ('Last sync: ' + s.last_sync_status + (s.last_sync_at ? ' · ' + new Date(s.last_sync_at).toLocaleString() : '')) : 'Not synced yet.'}
        </div>
        <div style="border-top:1px solid var(--border);margin-top:14px;padding-top:14px">
          <p style="font-size:11px;color:var(--muted);margin:0 0 8px"><b>If the host device fails:</b> promote this display to become the new host. It will serve its last-synced content. Then point your other displays at this device's address.</p>
          <button class="settings-save" id="md-promote-btn" style="background:#7a2020;border:1px solid #a33;color:#fff">Promote This Display to Host</button>
        </div>
      </div>

      <div id="md-host-info" style="${s.device_role==='slave'?'display:none':''}">
        <div class="settings-row" style="display:none;justify-content:space-between;align-items:center">
          <label style="margin-bottom:0">Auto-push updates to displays</label>
          <input type="checkbox" id="md-auto-push" checked style="width:20px;height:20px;accent-color:var(--accent)">
        </div>
        <p style="font-size:11px;color:var(--muted);margin-top:6px;cursor:pointer" onclick="showInfoPopup('autopush-help')">
          How update push works ⓘ
        </p>
        <p style="font-size:11px;color:var(--muted);margin-top:10px;border-top:1px solid var(--border);padding-top:10px;padding-bottom:14px">This device is the host. Connected displays appear in the <b>Devices</b> tab, where you can assign each one a layout profile.</p>
      </div>

      <div style="border-top:1px solid var(--border);margin-top:4px">
        <div style="font-size:13px;font-weight:600;padding:14px 16px 0">Other devices on this license</div>
        <p style="font-size:11px;color:var(--muted);padding:6px 16px 0;margin:0 0 12px">Every device that has ever checked in with this household's license key — not just displays running right now. Useful for spotting old hardware still holding a slot, or two devices both claiming to be the host.</p>
        <div id="md-other-devices-body" style="padding:0 16px 14px">Loading…</div>
      </div>
    </div>

    <div class="section-header">App Preferences</div>
    <div class="settings-card">
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:2px">Default tab ${infoBtn("Which tab the app opens to. Favorites by default.")}</label>
        </div>
        <select class="form-input" id="s-default-tab" style="width:auto">
          ${['favorites','calendars','photos','layout','displays','family','settings'].map(v => {
            const labels = { favorites:'Favorites', calendars:'Calendar', photos:'Photos', layout:'Layout', displays:'Devices', family:'Family Hub', settings:'Settings' };
            return `<option value="${v}" ${getDefaultTab()===v?'selected':''}>${labels[v]}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:2px">Auto-hide tab bar when scrolling ${infoBtn("Hides the top tabs on scroll-down, reveals them on scroll-up. Off by default — tabs stay pinned in place.")}</label>
        </div>
        <input type="checkbox" id="s-tabs-autohide" ${tabsAutohideEnabled() ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:2px">Pull down to refresh ${infoBtn("Pull down at the top of the page to reload — useful in standalone/home-screen mode, where the browser's own pull-to-refresh doesn't exist. Off by default.")}</label>
        </div>
        <input type="checkbox" id="s-pull-refresh" ${pullRefreshEnabled() ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent);flex-shrink:0">
      </div>
      <p style="font-size:11px;color:var(--muted);margin:10px 0 0">These are preferences for THIS browser only — they don't sync to other devices or the wall display.</p>
    </div>

    <div class="section-header">Version &amp; License</div>
    <div class="settings-card">
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center">
        <label style="margin-bottom:0">Current version</label>
        <span id="app-version" style="font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums">…</span>
      </div>
      <div class="settings-row" id="license-status-row" style="display:none">
        <label>Account status</label>
        <div id="license-status-info" style="font-size:13px;color:var(--text)"></div>
      </div>
      <div class="settings-row">
        <label>License key ${infoBtn("Set automatically during setup. Only edit this if you're changing to a different license's key.")}</label>
        <input class="form-input" id="update-license-key" placeholder="PICAL-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" style="font-family:monospace;letter-spacing:0.5px">
      </div>
      <div class="settings-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
        <div style="flex:1;padding-right:12px">
          <label style="margin-bottom:2px">Update timing ${infoBtn("Immediate (default) installs a new version as soon as one is found, in the background. Scheduled instead waits until a specific time each day — useful if you'd rather it not restart mid-use — and adds a manual Check/Update button here for anytime you don't want to wait.")}</label>
        </div>
        <select class="form-input" id="update-schedule-mode" style="width:auto">
          <option value="immediate">Immediately</option>
          <option value="scheduled">At a scheduled time</option>
        </select>
      </div>
      <div class="settings-row" id="update-schedule-time-row" style="display:none;margin-top:14px">
        <label>Daily install time</label>
        <input type="time" class="form-input" id="update-schedule-time" style="width:auto">
      </div>
      <div id="update-manual-row" style="display:none;gap:8px;margin-top:14px">
        <button class="btn" id="update-check-btn" type="button" style="flex:1;background:var(--card);border:1px solid var(--border)">Check for Updates</button>
        <button class="btn" id="update-now-btn" type="button" style="flex:1;display:none;background:var(--accent);color:#fff">Update Now</button>
      </div>
      <p id="update-help-text" style="font-size:11px;color:var(--muted);margin:10px 0 0">Updates install automatically in the background — there's nothing to manage here.</p>
      <div id="update-status" style="margin-top:12px;font-size:13px"></div>
    </div>

    <div class="section-header">Update Backups</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 10px">Kept automatically every time an update is applied — the last 10 (for rollback) plus one per calendar month for the first stable release, kept indefinitely as longer-term history. Download any of these as a zip (the same format as any other build), or restore straight to one.</p>
      <div id="update-backups-list" style="padding:0 16px 16px">
        <p style="font-size:12px;color:var(--muted)">Loading…</p>
      </div>
    </div>

    ${isBeta ? `
    <div class="section-header">Beta Checklist</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 10px">Live view of BETA_CHECKLIST.md straight from this device — tap an item to check it off. Everything here is worth checking on real hardware before this beta cycle is safe to promote to stable.</p>
      <div id="beta-checklist-content" translate="no" style="padding:0 16px 14px;font-size:13px;line-height:1.6"><p style="color:var(--muted)">Loading…</p></div>
    </div>
    ` : ''}

    <div class="section-header">Backup</div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 12px">A complete download of everything on this device — every event, layout, chore, photo, and setting. <span class="info-btn" onclick="showInfoPopup('backup-help')">ⓘ</span></p>
      <div style="padding:0 16px 14px">
        <button type="button" id="backup-download-btn" class="settings-save">⬇️ Download Backup</button>
        <div id="backup-status" style="margin-top:10px;font-size:13px;color:var(--muted)"></div>
      </div>
    </div>
    <div class="settings-card">
      <p style="font-size:11px;color:var(--muted);padding:14px 16px 0;margin:0 0 12px">Restore a backup downloaded from here (or another Piazza HQ device) — <b>this replaces everything currently on this device</b> with what's in the backup. A safety copy of your current data is kept automatically in case you need to undo it, but treat this as a real, mostly-irreversible-in-the-app action.</p>
      <div style="padding:0 16px 14px">
        <input type="file" id="restore-file-input" accept=".zip" style="display:none">
        <button type="button" id="restore-pick-btn" class="settings-save" style="background:var(--card);border:1px solid var(--border);color:var(--text)">⬆️ Choose Backup File…</button>
        <div id="restore-filename" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
        <button type="button" id="restore-go-btn" class="settings-save" style="margin-top:10px;display:none;background:#d9534f">🔄 Restore This Backup</button>
        <div id="restore-status" style="margin-top:10px;font-size:13px;color:var(--muted)"></div>
      </div>
    </div>

    <button class="settings-save" id="settings-save-btn">Save Settings</button>
    <button class="settings-save" id="logout-btn"
      style="background:var(--card);border:1px solid var(--border);color:var(--muted);margin-top:10px">
      Sign Out
    </button>
    <p style="text-align:center;font-size:11px;color:var(--muted);opacity:0.6;margin:22px 0 4px">
      Piazza HQ · © <span id="copyright-year"></span>
    </p>
  `;
}
