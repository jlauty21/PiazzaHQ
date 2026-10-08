function loadScreens_renderScreenCard(_c, s) {
  const { displayOptions } = _c;
    const dot = s.online
      ? `<span title="Online" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#34c759;margin-right:7px;vertical-align:middle"></span>`
      : `<span title="Offline" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#8b93a7;margin-right:7px;vertical-align:middle"></span>`;
    const displayName = s.name || 'Unnamed display';
    const nameStyle = s.name ? '' : 'font-style:italic;color:var(--muted)';
    const remoteBadge = s.is_remote
      ? `<span title="A networked display (slave)" style="font-size:10px;font-weight:700;color:#7c5cff;border:1px solid #7c5cff;border-radius:6px;padding:1px 5px;margin-left:6px;vertical-align:middle">REMOTE</span>`
      : '';
    const isBehind = s.is_remote && s.online && s.screen_version && window._hostVersion && s.screen_version !== window._hostVersion;
    return `
      <div class="swipe-wrap screen-swipe" data-id="${s.device_id}" data-name="${(s.name||'this screen').replace(/"/g,'&quot;')}">
        <div class="swipe-bg swipe-bg-delonly"><span class="swipe-bg-del">Forget 🗑️</span></div>
        <div class="event-card swipe-card" style="flex-direction:column;align-items:stretch;gap:10px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="flex:1;min-width:0">
            <div class="event-card-title" style="${nameStyle}">${dot}${displayName}${remoteBadge}</div>
            <div class="event-card-sub">${s.online ? 'Online' : 'Offline'}${s.assigned_display_name ? ' · showing ' + s.assigned_display_name : ''}${
              s.screen_version
                ? ` · v${s.screen_version}` + (isBehind
                    ? ` <span style="color:#ffb020;font-weight:700">⚠ host is v${window._hostVersion}</span>`
                    : '')
                : (s.is_remote ? ' · version unknown (update to see this)' : '')
            }</div>
            ${(s.remote_addr || s.last_seen) ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${
              [s.remote_addr, s.last_seen ? 'last seen ' + new Date(s.last_seen).toLocaleString() : ''].filter(Boolean).join(' · ')
            }</div>` : ''}
          </div>
          ${isBehind ? `<button class="icon-btn screen-push-btn" data-id="${s.device_id}" data-name="${(s.name||'').replace(/"/g,'&quot;')}" title="Push update to this screen">⬆️</button>` : ''}
          <button class="icon-btn screen-rename-btn" data-id="${s.device_id}" data-name="${(s.name||'').replace(/"/g,'&quot;')}" title="Rename">✏️</button>
          <button class="icon-btn del screen-del-btn" data-id="${s.device_id}" title="Forget this screen">🗑️</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="font-size:12px;color:var(--muted)">Show profile</label>
          <select class="form-input screen-assign" data-id="${s.device_id}" style="flex:1;min-width:140px">
            <option value="">Default display</option>
            ${displayOptions(s.assigned_display_slug)}
          </select>
          <button class="icon-btn screen-editlayout-btn" data-slug="${s.assigned_display_slug || ''}" title="Edit this screen's layout">🎛️</button>
        </div>
        <div class="acc-section${openScreenAccordions.has(s.device_id) ? ' open' : ''}" data-acc="tvsettings-${s.device_id}">
          <button class="acc-head" data-acc-toggle="tvsettings-${s.device_id}">
            <span class="acc-ic">⚙️</span>
            <span class="acc-text"><span class="acc-label">Screen Settings</span><span class="acc-sub">${[
              s.screen_orientation ? 'custom orientation' : '',
              s.ambient_mode === 'photo' ? 'Photo mode' : s.ambient_mode === 'photo_datetime' ? 'Photo + time mode' : '',
              s.tv_control_type ? `TV: ${s.tv_control_type}` : '',
            ].filter(Boolean).join(' · ') || 'Orientation, screensaver, TV control…'}</span></span>
            <span class="acc-caret">${openScreenAccordions.has(s.device_id) ? '▾' : '▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="tvsettings-${s.device_id}" style="${openScreenAccordions.has(s.device_id) ? '' : 'display:none'}">

        <div class="acc-section${openScreenSubAccordions.has(s.device_id+':display')?' open':''}" data-acc="screensub-${s.device_id}-display">
          <button class="acc-head" data-acc-toggle="screensub-${s.device_id}-display">
            <span class="acc-ic">🖥️</span>
            <span class="acc-text"><span class="acc-label">Display</span></span>
            <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':display')?'▾':'▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="screensub-${s.device_id}-display" style="${openScreenSubAccordions.has(s.device_id+':display')?'':'display:none'}">
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Orientation</label>
            <select class="form-input screen-orientation" data-id="${s.device_id}">
              <option value=""          ${!s.screen_orientation?'selected':''}>Use profile's</option>
              <option value="auto"      ${s.screen_orientation==='auto'?'selected':''}>Auto (detect)</option>
              <option value="landscape" ${s.screen_orientation==='landscape'?'selected':''}>Landscape</option>
              <option value="portrait"  ${s.screen_orientation==='portrait'?'selected':''}>Portrait</option>
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Rotate view</label>
            <select class="form-input screen-rotation" data-id="${s.device_id}">
              <option value="-1"  ${(s.screen_rotation===undefined||s.screen_rotation===null||s.screen_rotation<0)?'selected':''}>Use profile's</option>
              <option value="0"   ${s.screen_rotation===0?'selected':''}>0° (normal)</option>
              <option value="90"  ${s.screen_rotation===90?'selected':''}>90° clockwise</option>
              <option value="180" ${s.screen_rotation===180?'selected':''}>180°</option>
              <option value="270" ${s.screen_rotation===270?'selected':''}>270° clockwise</option>
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Control-URL badge</label>
            <select class="form-input screen-info-corner" data-id="${s.device_id}">
              <option value=""   ${!s.info_corner?'selected':''}>Hidden</option>
              <option value="tl" ${s.info_corner==='tl'?'selected':''}>Top-left</option>
              <option value="tr" ${s.info_corner==='tr'?'selected':''}>Top-right</option>
              <option value="bl" ${s.info_corner==='bl'?'selected':''}>Bottom-left</option>
              <option value="br" ${s.info_corner==='br'?'selected':''}>Bottom-right</option>
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Animation Size <span class="info-btn" onclick="showInfoPopup('fx-scale-help')">ⓘ</span></label>
            <select class="form-input screen-fx-scale" data-id="${s.device_id}">
              <option value="0.75" ${(s.fx_scale||'1')==='0.75'?'selected':''}>Smaller</option>
              <option value="1"    ${!s.fx_scale||(s.fx_scale||'1')==='1'?'selected':''}>Default</option>
              <option value="1.5"  ${(s.fx_scale||'1')==='1.5'?'selected':''}>Larger</option>
              <option value="2"    ${(s.fx_scale||'1')==='2'?'selected':''}>Much larger</option>
              <option value="3"    ${(s.fx_scale||'1')==='3'?'selected':''}>Huge</option>
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Animation Density <span class="info-btn" onclick="showInfoPopup('fx-density-help')">ⓘ</span></label>
            <select class="form-input screen-fx-density" data-id="${s.device_id}">
              <option value="0"    ${(s.fx_density||'1')==='0'?'selected':''}>Off</option>
              <option value="0.4"  ${(s.fx_density||'1')==='0.4'?'selected':''}>Occasional</option>
              <option value="1"    ${!s.fx_density||(s.fx_density||'1')==='1'?'selected':''}>Default</option>
              <option value="1.75" ${(s.fx_density||'1')==='1.75'?'selected':''}>Lots</option>
              <option value="2.5"  ${(s.fx_density||'1')==='2.5'?'selected':''}>Tons</option>
            </select>
          </div>
        </div>

        <p style="font-size:11px;color:var(--muted);margin:14px 0 8px;border-top:1px solid var(--border);padding-top:12px">
          Home Assistant alert banner <span class="info-btn" onclick="showInfoPopup('alert-banner-help')">ⓘ</span>
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:120px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Position</label>
            <select class="form-input screen-alert-position" data-id="${s.device_id}">
              <option value="top"    ${(s.alert_banner_position||'top')==='top'?'selected':''}>Top</option>
              <option value="bottom" ${(s.alert_banner_position||'top')==='bottom'?'selected':''}>Bottom</option>
              <option value="center" ${(s.alert_banner_position||'top')==='center'?'selected':''}>Center (card)</option>
            </select>
          </div>
          <div style="flex:1;min-width:120px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Text size</label>
            <select class="form-input screen-alert-size" data-id="${s.device_id}">
              <option value="s"   ${(s.alert_banner_size||'m')==='s'?'selected':''}>Small</option>
              <option value="m"   ${(s.alert_banner_size||'m')==='m'?'selected':''}>Medium</option>
              <option value="l"   ${(s.alert_banner_size||'m')==='l'?'selected':''}>Large</option>
              <option value="xl"  ${(s.alert_banner_size||'m')==='xl'?'selected':''}>Extra large</option>
              <option value="xxl" ${(s.alert_banner_size||'m')==='xxl'?'selected':''}>Huge</option>
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Style</label>
            <select class="form-input screen-alert-style" data-id="${s.device_id}">
              <option value="solid"   ${(s.alert_banner_style||'solid')==='solid'?'selected':''}>Solid red bar</option>
              <option value="strong"  ${(s.alert_banner_style||'solid')==='strong'?'selected':''}>Solid red, bold</option>
              <option value="amber"   ${(s.alert_banner_style||'solid')==='amber'?'selected':''}>Solid amber</option>
              <option value="bar"     ${(s.alert_banner_style||'solid')==='bar'?'selected':''}>Dark w/ red edge</option>
              <option value="outline" ${(s.alert_banner_style||'solid')==='outline'?'selected':''}>Dark outline</option>
              <option value="toast"   ${(s.alert_banner_style||'solid')==='toast'?'selected':''}>Corner toast</option>
            </select>
          </div>
        </div>

          </div>
        </div>

        <div class="acc-section${openScreenSubAccordions.has(s.device_id+':ambient')?' open':''}" data-acc="screensub-${s.device_id}-ambient">
          <button class="acc-head" data-acc-toggle="screensub-${s.device_id}-ambient">
            <span class="acc-ic">🖼️</span>
            <span class="acc-text"><span class="acc-label">Ambient Mode</span></span>
            <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':ambient')?'▾':'▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="screensub-${s.device_id}-ambient" style="${openScreenSubAccordions.has(s.device_id+':ambient')?'':'display:none'}">
          <p style="font-size:11px;color:var(--muted);margin:0 0 8px">
            Ambient Mode <span class="info-btn" onclick="showInfoPopup('screen-settings-help')">ⓘ</span>
          </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Screensaver Source</label>
            <select class="form-input screen-screensaver-mode" data-id="${s.device_id}">
              <option value="tag"   ${!s.screensaver_photo_id?'selected':''}>Tag (slideshow)</option>
              <option value="photo" ${s.screensaver_photo_id?'selected':''}>One specific photo</option>
            </select>
          </div>
          <div class="screensaver-tag-row" data-id="${s.device_id}" style="flex:1;min-width:130px;${s.screensaver_photo_id?'display:none':''}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Tag</label>
            <select class="form-input screen-screensaver" data-id="${s.device_id}">
              <option value="" ${!s.screensaver_tag?'selected':''}>All photos</option>
              ${(window._photoTags||[]).map(t=>`<option value="${t}" ${s.screensaver_tag===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="screensaver-photo-row" data-id="${s.device_id}" style="flex:1;min-width:130px;${s.screensaver_photo_id?'':'display:none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Photo</label>
            <select class="form-input screen-screensaver-photo" data-id="${s.device_id}">
              ${(window._photosList||[]).map(p=>`<option value="${p.id}" ${Number(s.screensaver_photo_id)===p.id?'selected':''}>${p.label||p.filename}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;min-width:130px">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Display Mode</label>
            <select class="form-input screen-ambient-mode" data-id="${s.device_id}">
              <option value=""               ${!s.ambient_mode?'selected':''}>Normal (full layout)</option>
              <option value="photo"          ${s.ambient_mode==='photo'?'selected':''}>Photo only</option>
              <option value="photo_datetime" ${s.ambient_mode==='photo_datetime'?'selected':''}>Photo + time</option>
            </select>
          </div>
          <div class="ambient-fit-row" data-id="${s.device_id}" style="flex:1;min-width:130px;${s.ambient_mode?'':'display:none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Photo Fit</label>
            <select class="form-input screen-ambient-fit" data-id="${s.device_id}">
              <option value="cover"  ${(s.ambient_photo_fit||'cover')==='cover'?'selected':''}>Fill (crop to fill, no gaps)</option>
              <option value="width"  ${s.ambient_photo_fit==='width'?'selected':''}>Fit to width (whole width shown)</option>
              <option value="height" ${s.ambient_photo_fit==='height'?'selected':''}>Fit to height (whole height shown)</option>
              <option value="auto"   ${s.ambient_photo_fit==='auto'?'selected':''}>Auto (best fit per photo)</option>
            </select>
          </div>
          <div class="ambient-interval-row" data-id="${s.device_id}" style="flex:1;min-width:130px;${s.ambient_mode?'':'display:none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Slide Interval</label>
            <select class="form-input screen-ambient-interval" data-id="${s.device_id}">
              <option value=""    ${!s.ambient_photo_interval?'selected':''}>Use global setting</option>
              <option value="5"   ${s.ambient_photo_interval=='5'?'selected':''}>5 seconds</option>
              <option value="10"  ${s.ambient_photo_interval=='10'?'selected':''}>10 seconds</option>
              <option value="20"  ${s.ambient_photo_interval=='20'?'selected':''}>20 seconds</option>
              <option value="30"  ${s.ambient_photo_interval=='30'?'selected':''}>30 seconds</option>
              <option value="60"  ${s.ambient_photo_interval=='60'?'selected':''}>1 minute</option>
              <option value="300" ${s.ambient_photo_interval=='300'?'selected':''}>5 minutes</option>
            </select>
          </div>
          <div class="ambient-corner-row" data-id="${s.device_id}" style="flex:1;min-width:130px;${s.ambient_mode==='photo_datetime'?'':'display:none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Clock/Date Corner</label>
            <select class="form-input screen-ambient-corner" data-id="${s.device_id}">
              <option value="tl" ${(s.ambient_clock_corner||'bl')==='tl'?'selected':''}>Top-left</option>
              <option value="tr" ${(s.ambient_clock_corner||'bl')==='tr'?'selected':''}>Top-right</option>
              <option value="bl" ${(s.ambient_clock_corner||'bl')==='bl'?'selected':''}>Bottom-left</option>
              <option value="br" ${(s.ambient_clock_corner||'bl')==='br'?'selected':''}>Bottom-right</option>
            </select>
          </div>
          <div class="ambient-fade-row" data-id="${s.device_id}" style="flex:1;min-width:130px;display:${s.ambient_mode?'flex':'none'};justify-content:space-between;align-items:center;padding-top:4px">
            <label style="font-size:11px;color:var(--muted);margin-bottom:0">Fade between photos</label>
            <input type="checkbox" class="screen-ambient-fade" data-id="${s.device_id}" ${s.ambient_fade_transition!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
          </div>
          <div class="ambient-fadeduration-row" data-id="${s.device_id}" style="flex:1;min-width:130px;display:${s.ambient_mode&&s.ambient_fade_transition!==false?'':'none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Fade Duration</label>
            <select class="form-input screen-ambient-fadeduration" data-id="${s.device_id}">
              <option value="1" ${(s.ambient_fade_duration||'2')=='1'?'selected':''}>1 second (quick)</option>
              <option value="2" ${!s.ambient_fade_duration||(s.ambient_fade_duration||'2')=='2'?'selected':''}>2 seconds (default)</option>
              <option value="3" ${(s.ambient_fade_duration||'2')=='3'?'selected':''}>3 seconds</option>
              <option value="4" ${(s.ambient_fade_duration||'2')=='4'?'selected':''}>4 seconds</option>
              <option value="5" ${(s.ambient_fade_duration||'2')=='5'?'selected':''}>5 seconds (slow)</option>
              <option value="8" ${(s.ambient_fade_duration||'2')=='8'?'selected':''}>8 seconds (very slow)</option>
            </select>
          </div>
          <div class="ambient-blurbg-row" data-id="${s.device_id}" style="flex:1;min-width:130px;display:${s.ambient_mode&&s.ambient_photo_fit==='auto'?'flex':'none'};justify-content:space-between;align-items:center;padding-top:4px">
            <label style="font-size:11px;color:var(--muted);margin-bottom:0">Blurred background behind mismatched photos</label>
            <input type="checkbox" class="screen-ambient-blurbg" data-id="${s.device_id}" ${s.ambient_blur_bg!==false?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
          </div>
        </div>

          </div>
        </div>

        <div class="acc-section${openScreenSubAccordions.has(s.device_id+':tv')?' open':''}" data-acc="screensub-${s.device_id}-tv">
          <button class="acc-head" data-acc-toggle="screensub-${s.device_id}-tv">
            <span class="acc-ic">📺</span>
            <span class="acc-text"><span class="acc-label">TV Control</span></span>
            <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':tv')?'▾':'▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="screensub-${s.device_id}-tv" style="${openScreenSubAccordions.has(s.device_id+':tv')?'':'display:none'}">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <div style="flex:1;min-width:150px">
              <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Control Method</label>
              <select class="form-input tv-control-type" data-id="${s.device_id}">
                <option value=""        ${!s.tv_control_type?'selected':''}>Off (no TV control)</option>
                <option value="cec"          ${s.tv_control_type==='cec'?'selected':''}>HDMI-CEC (same cable)</option>
                <option value="hdmi-signal"  ${s.tv_control_type==='hdmi-signal'?'selected':''}>Cut HDMI Signal (for monitors, no CEC)</option>
                <option value="roku"    ${s.tv_control_type==='roku'?'selected':''}>Roku</option>
                <option value="samsung" ${s.tv_control_type==='samsung'?'selected':''}>Samsung</option>
              </select>
            </div>
            <div class="tv-ip-row" data-id="${s.device_id}" style="flex:1;min-width:150px;${(s.tv_control_type==='roku'||s.tv_control_type==='samsung')?'':'display:none'}">
              <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">TV IP Address</label>
              <input class="form-input tv-ip-input" data-id="${s.device_id}" value="${s.tv_ip||''}" placeholder="192.168.1.50">
            </div>
          </div>
          <div class="tv-samsung-pair-row" data-id="${s.device_id}" style="display:${s.tv_control_type==='samsung'?'flex':'none'};align-items:center;gap:8px;margin-bottom:8px">
            <button class="btn-mini tv-pair-btn" data-id="${s.device_id}">🔗 Pair with TV</button>
            <span class="tv-pair-status" data-id="${s.device_id}" style="font-size:12px;color:${s.tv_paired?'#4ade80':'var(--muted)'}">${s.tv_paired ? 'Paired ✓' : 'Not paired yet'}</span>
          </div>
          <div class="tv-test-row" data-id="${s.device_id}" style="display:${s.tv_control_type?'flex':'none'};gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            <button class="btn-mini tv-action-btn" data-id="${s.device_id}" data-action="power-on">Power On</button>
            <button class="btn-mini tv-action-btn" data-id="${s.device_id}" data-action="power-off">Power Off</button>
            <input class="form-input tv-input-value" data-id="${s.device_id}" placeholder="1" style="width:56px" title="HDMI number, e.g. 1">
            <button class="btn-mini tv-action-btn" data-id="${s.device_id}" data-action="input">Switch Input</button>
          </div>
          <div class="tv-schedule-row" data-id="${s.device_id}" style="display:${s.tv_control_type?'block':'none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Schedule</label>
            <div class="tv-schedule-slots" data-id="${s.device_id}" style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
              ${(s.tv_schedule_slots || []).map(slot => `
                <div style="display:flex;gap:6px;align-items:center" data-slot-id="${slot.id}">
                  <input type="time" class="form-input tv-slot-time" data-slot-id="${slot.id}" value="${slot.time}" style="flex:1">
                  <select class="form-input tv-slot-action" data-slot-id="${slot.id}" style="width:100px;flex:0 0 auto">
                    <option value="on"  ${slot.action==='on'?'selected':''}>Power on</option>
                    <option value="off" ${slot.action==='off'?'selected':''}>Power off</option>
                  </select>
                  <button type="button" class="icon-btn del tv-slot-del" data-slot-id="${slot.id}" title="Remove this time">🗑️</button>
                </div>
              `).join('') || '<p style="font-size:12px;color:var(--muted);margin:0">No scheduled times yet.</p>'}
            </div>
            <button type="button" class="btn-mini tv-slot-add-btn" data-id="${s.device_id}">+ Add Time Slot</button>
          </div>
          <p style="font-size:11px;color:var(--muted);margin:8px 0 0;cursor:pointer" onclick="showInfoPopup('tv-control-help')">
            How TV Control works ⓘ
          </p>
          </div>
        </div>

        <div class="acc-section${openScreenSubAccordions.has(s.device_id+':fls')?' open':''}" data-acc="screensub-${s.device_id}-fls">
          <button class="acc-head" data-acc-toggle="screensub-${s.device_id}-fls">
            <span class="acc-ic">🔀</span>
            <span class="acc-text"><span class="acc-label">Screen Switcher</span></span>
            <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':fls')?'▾':'▸'}</span>
          </button>
          <div class="acc-body" data-acc-body="screensub-${s.device_id}-fls" style="${openScreenSubAccordions.has(s.device_id+':fls')?'':'display:none'}">
          <div class="acc-section${openScreenSubAccordions.has(s.device_id+':fls-toggle')?' open':''}" data-acc="flssub-${s.device_id}-toggle">
            <button class="acc-head" data-acc-toggle="flssub-${s.device_id}-toggle">
              <span class="acc-text"><span class="acc-label">Show Screen Switcher</span></span>
              <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':fls-toggle')?'▾':'▸'}</span>
            </button>
            <div class="acc-body" data-acc-body="flssub-${s.device_id}-toggle" style="${openScreenSubAccordions.has(s.device_id+':fls-toggle')?'':'display:none'}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <label style="margin-bottom:0">Show screen switcher</label>
            <input type="checkbox" class="screen-fls-toggle" data-id="${s.device_id}" ${s.floating_switcher_enabled?'checked':''} style="width:20px;height:20px;accent-color:var(--accent)">
          </div>
          <p style="font-size:11px;color:var(--muted);margin:0 0 10px">An always-present button on top of whatever layout is showing — lets you switch layouts on this screen even when the current one has no Layout Switcher widget of its own.</p>
          <div class="screen-fls-presets" data-id="${s.device_id}" style="${s.floating_switcher_enabled?'':'display:none'}">
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Position</label>
            <div class="screen-fls-edge-picker" data-id="${s.device_id}" style="display:flex;gap:6px;margin-bottom:12px">
              ${['top','bottom','left','right'].map(edge => `
                <button type="button" class="screen-fls-edge-btn${(s.floating_switcher_edge||'bottom')===edge?' active':''}" data-id="${s.device_id}" data-edge="${edge}"
                  style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:12px;font-weight:600;text-transform:capitalize;
                    background:${(s.floating_switcher_edge||'bottom')===edge?'rgba(74,144,217,0.3)':'var(--card)'};color:${(s.floating_switcher_edge||'bottom')===edge?'#fff':'var(--muted)'}">${edge}</button>
              `).join('')}
            </div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Style</label>
            <div class="screen-fls-style-picker" data-id="${s.device_id}" style="display:flex;gap:6px;margin-bottom:12px">
              ${['circles','bar'].map(st => `
                <button type="button" class="screen-fls-style-btn${(s.floating_switcher_style||'circles')===st?' active':''}" data-id="${s.device_id}" data-style="${st}"
                  style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:12px;font-weight:600;text-transform:capitalize;
                    background:${(s.floating_switcher_style||'circles')===st?'rgba(74,144,217,0.3)':'var(--card)'};color:${(s.floating_switcher_style||'circles')===st?'#fff':'var(--muted)'}">${st === 'circles' ? 'Circles' : 'Bar'}</button>
              `).join('')}
            </div>
            <div class="screen-fls-barmode-row" data-id="${s.device_id}" style="${(s.floating_switcher_style||'circles')==='bar'?'':'display:none'};margin-bottom:12px">
              <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Display</label>
              <div class="screen-fls-barmode-picker" data-id="${s.device_id}" style="display:flex;gap:6px">
                ${['icons','names'].map(m => `
                  <button type="button" class="screen-fls-barmode-btn${(s.floating_switcher_bar_mode||'icons')===m?' active':''}" data-id="${s.device_id}" data-barmode="${m}"
                    style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:12px;font-weight:600;text-transform:capitalize;
                      background:${(s.floating_switcher_bar_mode||'icons')===m?'rgba(74,144,217,0.3)':'var(--card)'};color:${(s.floating_switcher_bar_mode||'icons')===m?'#fff':'var(--muted)'}">${m === 'icons' ? 'Icons' : 'Names'}</button>
                `).join('')}
              </div>
            </div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Visibility</label>
            <div class="screen-fls-reveal-picker" data-id="${s.device_id}" style="display:flex;gap:6px;margin-bottom:12px">
              ${['always','tap'].map(r => `
                <button type="button" class="screen-fls-reveal-btn${(s.floating_switcher_reveal||'always')===r?' active':''}" data-id="${s.device_id}" data-reveal="${r}"
                  style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:12px;font-weight:600;
                    background:${(s.floating_switcher_reveal||'always')===r?'rgba(74,144,217,0.3)':'var(--card)'};color:${(s.floating_switcher_reveal||'always')===r?'#fff':'var(--muted)'}">${r === 'always' ? 'Always visible' : 'Tap to reveal'}</button>
              `).join('')}
            </div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Bar Color</label>
            <div style="margin-bottom:14px">
              <input type="color" class="screen-fls-color" data-id="${s.device_id}" value="${s.floating_switcher_color||'#0a0e1a'}" style="width:60px;height:44px;padding:2px;border-radius:8px;border:1px solid var(--border);background:var(--card)">
            </div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Live Displays</label>
            <div class="screen-fls-display-list" data-id="${s.device_id}" style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
              <div style="font-size:12px;color:var(--muted)">Loading…</div>
            </div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Saved Templates</label>
            <div class="screen-fls-preset-list" data-id="${s.device_id}" style="display:flex;flex-direction:column;gap:6px">
              <div style="font-size:12px;color:var(--muted)">Loading…</div>
            </div>
          </div>
            </div>
          </div>
          <div class="acc-section${openScreenSubAccordions.has(s.device_id+':fls-schedule')?' open':''}" data-acc="flssub-${s.device_id}-schedule">
            <button class="acc-head" data-acc-toggle="flssub-${s.device_id}-schedule">
              <span class="acc-text"><span class="acc-label">Schedule</span></span>
              <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':fls-schedule')?'▾':'▸'}</span>
            </button>
            <div class="acc-body" data-acc-body="flssub-${s.device_id}-schedule" style="${openScreenSubAccordions.has(s.device_id+':fls-schedule')?'':'display:none'}">
          <p style="font-size:11px;color:var(--muted);margin:0 0 8px">Automatically switch at set times, whether or not the screen switcher button above is turned on.</p>
            <div class="screen-fls-schedule-list" data-id="${s.device_id}" style="display:flex;flex-direction:column;gap:10px"></div>
            <button type="button" class="btn screen-fls-schedule-add-btn" data-id="${s.device_id}" style="width:100%;margin-top:8px;background:var(--card);border:1px solid var(--border)">+ Add a scheduled switch</button>
            </div>
          </div>
          <div class="acc-section${openScreenSubAccordions.has(s.device_id+':fls-editbar')?' open':''}" data-acc="flssub-${s.device_id}-editbar">
            <button class="acc-head" data-acc-toggle="flssub-${s.device_id}-editbar">
              <span class="acc-text"><span class="acc-label">Edit Bar</span></span>
              <span class="acc-caret">${openScreenSubAccordions.has(s.device_id+':fls-editbar')?'▾':'▸'}</span>
            </button>
            <div class="acc-body" data-acc-body="flssub-${s.device_id}-editbar" style="${openScreenSubAccordions.has(s.device_id+':fls-editbar')?'':'display:none'}">
          <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px">Position</label>
          <div class="screen-editbar-position-picker" data-id="${s.device_id}" style="display:flex;gap:6px">
            ${['top','bottom'].map(pos => `
              <button type="button" class="screen-editbar-position-btn${(s.edit_bar_position||'top')===pos?' active':''}" data-id="${s.device_id}" data-position="${pos}"
                style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);font-size:12px;font-weight:600;text-transform:capitalize;
                  background:${(s.edit_bar_position||'top')===pos?'rgba(74,144,217,0.3)':'var(--card)'};color:${(s.edit_bar_position||'top')===pos?'#fff':'var(--muted)'}">${pos}</button>
            `).join('')}
          </div>
          <p style="font-size:11px;color:var(--muted);margin:8px 0 0">Where the "Live Editing" bar sits on this screen while editing a layout. It can also be minimized down to a small button at any time by tapping the – on the bar itself, if a widget near that edge is still in the way.</p>
            </div>
          </div>
          </div>
        </div>

          </div>
        </div>
        </div>
      </div>`;
}

function loadScreens_if572Etc(_c) {
  const { list, unnamed } = _c;
  if (unnamed && !loadScreens._prompted.has(unnamed.device_id)) {
    loadScreens._prompted.add(unnamed.device_id);
    setTimeout(async () => {
      const name = prompt('A new display connected. Name it (e.g. "Living Room TV"):', '');
      if (name && name.trim()) {
        await apiFetch(`/api/screens/${unnamed.device_id}`, { method:'PUT', body: JSON.stringify({ name: name.trim() }) });
        loadScreens();
      }
    }, 300);
  }

  list.querySelectorAll('.screen-assign').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}/assign`, {
        method:'POST', body: JSON.stringify({ display: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      showToast(r.delivered ? 'Display switched ✓' : 'Saved — will apply when the display is online');
      // Keep the button's remembered slug in sync with whatever was just assigned.
      const editBtn = sel.closest('.swipe-wrap.screen-swipe')?.querySelector('.screen-editlayout-btn');
      if (editBtn) editBtn.dataset.slug = sel.value;
    });
  });

  list.querySelectorAll('.screen-editlayout-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      let slug = btn.dataset.slug;
      if (!slug) {
        // "Default display" — fall back to the first profile that exists, same as the
        // Layout tab's own fallback, so this always lands somewhere useful.
        const all = await getDisplaysList().catch(() => []);
        slug = all[0] ? all[0].slug : null;
        if (!slug) { showToast('No profiles exist yet — add one below first'); return; }
      }
      currentDisplaySlug = slug;
      try { localStorage.setItem('lastEditedDisplay', slug); } catch {}
      const layoutTab = document.querySelector('.tab[data-tab="layout"]');
      if (layoutTab) layoutTab.click();
    });
  });

  list.querySelectorAll('.screen-info-corner').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ info_corner: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-fx-scale').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ fx_scale: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-fx-density').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ fx_density: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
}

function loadScreens_wireAlertBannerFieldEtc(_c) {
  const { list, wireAlertBannerField } = _c;
  wireAlertBannerField('.screen-alert-position', 'alert_banner_position');
  wireAlertBannerField('.screen-alert-size', 'alert_banner_size');
  wireAlertBannerField('.screen-alert-style', 'alert_banner_style');

  list.querySelectorAll('.screen-orientation').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ screen_orientation: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-rotation').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ screen_rotation: parseInt(sel.value, 10) }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-screensaver').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ screensaver_tag: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
}

function loadScreens_listQuerySelectorAll(_c) {
  const { list } = _c;
  list.querySelectorAll('.screen-screensaver-mode').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id;
      const tagRow = list.querySelector(`.screensaver-tag-row[data-id="${id}"]`);
      const photoRow = list.querySelector(`.screensaver-photo-row[data-id="${id}"]`);
      if (sel.value === 'photo') {
        if (tagRow) tagRow.style.display = 'none';
        if (photoRow) photoRow.style.display = '';
        // Switching TO photo mode: apply whatever photo is currently selected in
        // that dropdown (defaults to the first one) right away.
        const photoSel = list.querySelector(`.screen-screensaver-photo[data-id="${id}"]`);
        if (photoSel && photoSel.value) {
          const r = await apiFetch(`/api/screens/${id}`, {
            method:'PUT', body: JSON.stringify({ screensaver_photo_id: photoSel.value }),
          });
          if (r && r.error) { showToast('❌ ' + r.error); return; }
        }
      } else {
        if (tagRow) tagRow.style.display = '';
        if (photoRow) photoRow.style.display = 'none';
        const r = await apiFetch(`/api/screens/${id}`, {
          method:'PUT', body: JSON.stringify({ screensaver_photo_id: '' }),
        });
        if (r && r.error) { showToast('❌ ' + r.error); return; }
      }
    });
  });
}

function loadScreens_listQuerySelectorAllEtc(_c) {
  const { list } = _c;
  list.querySelectorAll('.screen-screensaver-photo').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ screensaver_photo_id: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-ambient-mode').forEach(sel => {
    sel.addEventListener('change', async () => {
      const cornerRow = list.querySelector(`.ambient-corner-row[data-id="${sel.dataset.id}"]`);
      const fitRow = list.querySelector(`.ambient-fit-row[data-id="${sel.dataset.id}"]`);
      const intervalRow = list.querySelector(`.ambient-interval-row[data-id="${sel.dataset.id}"]`);
      const fadeRow = list.querySelector(`.ambient-fade-row[data-id="${sel.dataset.id}"]`);
      if (cornerRow) cornerRow.style.display = sel.value === 'photo_datetime' ? '' : 'none';
      if (fitRow) fitRow.style.display = sel.value ? '' : 'none';
      if (intervalRow) intervalRow.style.display = sel.value ? '' : 'none';
      if (fadeRow) fadeRow.style.display = sel.value ? 'flex' : 'none';
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_mode: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      const labels = { '': 'Normal layout', photo: 'Photo only', photo_datetime: 'Photo + time' };
    });
  });

  list.querySelectorAll('.screen-ambient-interval').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_photo_interval: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-ambient-fade').forEach(cb => {
    cb.addEventListener('change', async () => {
      const durRow = list.querySelector(`.ambient-fadeduration-row[data-id="${cb.dataset.id}"]`);
      if (durRow) durRow.style.display = cb.checked ? '' : 'none';
      const r = await apiFetch(`/api/screens/${cb.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_fade_transition: cb.checked }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-ambient-fadeduration').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_fade_duration: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-ambient-fit').forEach(sel => {
    sel.addEventListener('change', async () => {
      const blurRow = list.querySelector(`.ambient-blurbg-row[data-id="${sel.dataset.id}"]`);
      if (blurRow) blurRow.style.display = sel.value === 'auto' ? 'flex' : 'none';
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_photo_fit: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-ambient-blurbg').forEach(cb => {
    cb.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${cb.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_blur_bg: cb.checked }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.screen-ambient-corner').forEach(sel => {
    sel.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${sel.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ ambient_clock_corner: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.tv-control-type').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id;
      const ipRow = list.querySelector(`.tv-ip-row[data-id="${id}"]`);
      const pairRow = list.querySelector(`.tv-samsung-pair-row[data-id="${id}"]`);
      const testRow = list.querySelector(`.tv-test-row[data-id="${id}"]`);
      const schedRow = list.querySelector(`.tv-schedule-row[data-id="${id}"]`);
      const needsIp = sel.value === 'roku' || sel.value === 'samsung';
      if (ipRow) ipRow.style.display = needsIp ? '' : 'none';
      if (pairRow) pairRow.style.display = sel.value === 'samsung' ? 'flex' : 'none';
      if (testRow) testRow.style.display = sel.value ? 'flex' : 'none';
      if (schedRow) schedRow.style.display = sel.value ? 'block' : 'none';
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ tv_control_type: sel.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });

  list.querySelectorAll('.tv-ip-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${inp.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ tv_ip: inp.value.trim() }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
}

function loadScreens_listQuerySelectorAll2(_c) {
  const { list } = _c;
  list.querySelectorAll('.tv-pair-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const statusEl = list.querySelector(`.tv-pair-status[data-id="${id}"]`);
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = '⏳ Check the TV…';
      showToast('Look at the TV screen — accept the connection prompt that appears.');
      try {
        const r = await apiFetch(`/api/screens/${id}/tv/pair`, { method: 'POST' });
        if (r && r.error) { showToast('❌ ' + r.error); return; }
        showToast('Paired with TV ✓');
        if (statusEl) { statusEl.textContent = 'Paired ✓'; statusEl.style.color = '#4ade80'; }
      } catch (e) {
        showToast('❌ Pairing failed');
      } finally {
        btn.disabled = false;
        btn.textContent = prevText;
      }
    });
  });
}

function loadScreens_listQuerySelectorAll3(_c) {
  const { list } = _c;
  list.querySelectorAll('.tv-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id, action = btn.dataset.action;
      const body = {};
      if (action === 'input') {
        const inputVal = list.querySelector(`.tv-input-value[data-id="${id}"]`);
        body.input = inputVal ? inputVal.value.trim() : '';
      }
      btn.disabled = true;
      try {
        const r = await apiFetch(`/api/screens/${id}/tv/${action}`, { method: 'POST', body: JSON.stringify(body) });
        if (r && r.error) { showToast('❌ ' + r.error); return; }
        const labels = { 'power-on': 'Power on sent ✓', 'power-off': 'Power off sent ✓', input: 'Input switch sent ✓' };
        showToast(labels[action] || 'Sent ✓');
      } catch (e) {
        showToast('❌ Command failed');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function loadScreens_listQuerySelectorAllEtc2(_c) {
  const { list, wireTvScheduleSlotHandlers, refreshTvScheduleSlots } = _c;
  list.querySelectorAll('.tv-slot-add-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const r = await apiFetch(`/api/screens/${id}/tv-schedule`, { method: 'POST', body: JSON.stringify({ time: '08:00', action: 'on' }) });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      refreshTvScheduleSlots(id);
    });
  });
  // Wire up the slots already rendered in the initial HTML.
  list.querySelectorAll('.tv-schedule-slots').forEach(container => {
    wireTvScheduleSlotHandlers(container.dataset.id);
  });

  list.querySelectorAll('.screen-fls-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const presetsBox = list.querySelector(`.screen-fls-presets[data-id="${id}"]`);
      if (presetsBox) presetsBox.style.display = cb.checked ? '' : 'none';
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_enabled: cb.checked }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  list.querySelectorAll('.screen-fls-edge-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      list.querySelectorAll(`.screen-fls-edge-btn[data-id="${id}"]`).forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'var(--card)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_edge: btn.dataset.edge }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  list.querySelectorAll('.screen-editbar-position-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      list.querySelectorAll(`.screen-editbar-position-btn[data-id="${id}"]`).forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'var(--card)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ edit_bar_position: btn.dataset.position }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  list.querySelectorAll('.screen-fls-style-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      list.querySelectorAll(`.screen-fls-style-btn[data-id="${id}"]`).forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'var(--card)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      const barmodeRow = list.querySelector(`.screen-fls-barmode-row[data-id="${id}"]`);
      if (barmodeRow) barmodeRow.style.display = btn.dataset.style === 'bar' ? '' : 'none';
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_style: btn.dataset.style }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  list.querySelectorAll('.screen-fls-barmode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      list.querySelectorAll(`.screen-fls-barmode-btn[data-id="${id}"]`).forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'var(--card)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_bar_mode: btn.dataset.barmode }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  list.querySelectorAll('.screen-fls-reveal-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      list.querySelectorAll(`.screen-fls-reveal-btn[data-id="${id}"]`).forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(74,144,217,0.3)' : 'var(--card)';
        b.style.color = active ? '#fff' : 'var(--muted)';
      });
      const r = await apiFetch(`/api/screens/${id}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_reveal: btn.dataset.reveal }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
  list.querySelectorAll('.screen-fls-color').forEach(input => {
    input.addEventListener('change', async () => {
      const r = await apiFetch(`/api/screens/${input.dataset.id}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_color: input.value }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    });
  });
}

function loadScreens_block1021(_c) {
  const { list, onlineScreens } = _c;
  (async () => {
    const displayLists = list.querySelectorAll('.screen-fls-display-list');
    const presetLists = list.querySelectorAll('.screen-fls-preset-list');
    if (!displayLists.length && !presetLists.length) return;

    const readIcon = (checkboxEl) => {
      const iconEl = checkboxEl.closest('label').querySelector('.screen-fls-target-icon');
      return (iconEl && iconEl.value.trim()) || '';
    };
    const saveFlsTargets = async (screenId) => {
      const targets = [
        ...[...list.querySelectorAll(`.screen-fls-display-cb[data-id="${screenId}"]:checked`)].map(el => ({ type: 'display', id: el.dataset.targetId, icon: readIcon(el) })),
        ...[...list.querySelectorAll(`.screen-fls-preset-cb[data-id="${screenId}"]:checked`)].map(el => ({ type: 'saved', id: Number(el.dataset.targetId), icon: readIcon(el) })),
      ];
      const r = await apiFetch(`/api/screens/${screenId}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_presets: targets }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
      // Keep local state in sync — this previously only saved to the
      // server without updating the in-memory screen object at all, which
      // would have left the schedule's own target dropdowns (now filtered
      // by this list) reading stale data even after a successful save.
      const screen = onlineScreens.find(s => s.device_id === screenId);
      if (screen) screen.floating_switcher_presets = targets;
      renderFlsSchedule(screenId);
    };
    // Same shape as display.html's own normalizeSwitcherTargets() — see the
    // widget wiring's own copy of this comment for why it's duplicated
    // rather than shared.
    const normTargets = (raw) => (Array.isArray(raw) ? raw : []).map(t => {
      if (typeof t === 'number' || (typeof t === 'string' && /^\d+$/.test(t))) return { type: 'saved', id: Number(t), icon: '' };
      if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id), icon: (typeof t.icon === 'string' ? t.icon : '') };
      if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id, icon: (typeof t.icon === 'string' ? t.icon : '') };
      return null;
    }).filter(Boolean);

    let displays = [];
    if (displayLists.length) { try { displays = await getDisplaysList(true); } catch {} }
    displayLists.forEach(listEl => {
      const id = listEl.dataset.id;
      const screen = onlineScreens.find(s => s.device_id === id);
      const assigned = new Map(normTargets(screen && screen.floating_switcher_presets).filter(t => t.type === 'display').map(t => [t.id, t]));
      // Every display is offered here, none excluded — unlike the widget's
      // copy-target picker (which excludes the display it's currently on,
      // since copying onto yourself is meaningless), a screen switching to
      // whatever its OWN currently-assigned profile shows is a legitimate,
      // real use — e.g. "switch back to normal" after switching away.
      const others = displays || [];
      if (!others.length) {
        listEl.innerHTML = `<div style="font-size:12px;color:var(--muted)">No displays yet.</div>`;
        return;
      }
      listEl.innerHTML = others.map(d => {
        const existing = assigned.get(d.slug);
        return `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" class="screen-fls-display-cb" data-id="${id}" data-target-id="${d.slug}" ${existing ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          <input type="text" class="form-input screen-fls-target-icon" value="${escapeHtml(existing ? existing.icon || '' : '')}" maxlength="8" placeholder="icon" style="width:44px;text-align:center;font-size:15px;padding:6px">
          ${escapeHtml(d.name)}
        </label>
      `;
      }).join('');
      listEl.querySelectorAll('.screen-fls-display-cb, .screen-fls-target-icon').forEach(el => {
        el.addEventListener('change', () => saveFlsTargets(id));
      });
    });

    let presets = [];
    if (presetLists.length) { try { presets = await apiFetch('/api/saved-layouts'); } catch {} }
    presetLists.forEach(listEl => {
      const id = listEl.dataset.id;
      const screen = onlineScreens.find(s => s.device_id === id);
      const assigned = new Map(normTargets(screen && screen.floating_switcher_presets).filter(t => t.type === 'saved').map(t => [t.id, t]));
      if (!Array.isArray(presets) || !presets.length) {
        listEl.innerHTML = `<div style="font-size:12px;color:var(--muted)">No saved layouts yet — save one from the Layout tab first.</div>`;
        return;
      }
      listEl.innerHTML = presets.map(p => {
        const existing = assigned.get(Number(p.id));
        return `
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" class="screen-fls-preset-cb" data-id="${id}" data-target-id="${p.id}" ${existing ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
          <input type="text" class="form-input screen-fls-target-icon" value="${escapeHtml(existing ? existing.icon || '' : '')}" maxlength="8" placeholder="icon" style="width:44px;text-align:center;font-size:15px;padding:6px">
          ${escapeHtml(p.name)}
        </label>
      `;
      }).join('');
      listEl.querySelectorAll('.screen-fls-preset-cb, .screen-fls-target-icon').forEach(el => {
        el.addEventListener('change', () => saveFlsTargets(id));
      });
    });

    // Schedule — reuses the same displays/presets already fetched above.
    // Mirrors the widget's own renderScheduleRules() (see app.html's
    // layoutswitcher widget wiring), adapted to run once per screen card
    // instead of once for a single widget's own settings panel. Mutates
    // each screen's floating_switcher_schedule directly on the onlineScreens
    // array as the in-progress source of truth, saving to the server on
    // every change — there's no autosave mechanism here the way there is
    // for widgets, so every edit needs its own explicit PUT.
    const dayNames = ['S','M','T','W','T','F','S'];
    const targetOptionsHtml = (selected, checkedTargets, assignedDisplaySlug) => {
      const selKey = selected ? `${selected.type}:${selected.id}` : '';
      // Restricted to only the targets currently checked in the "Live
      // Displays"/"Saved Templates" list above — by explicit request. See
      // display.html's identical fix for the full reasoning, including
      // why the currently-selected target is always included even if it's
      // since been unchecked.
      const checkedKeys = new Set(normTargets(checkedTargets).map(t => `${t.type}:${t.id}`));
      // Also always includes the screen's currently ASSIGNED display — by
      // explicit request, confirmed as a real report: unlike the other two
      // schedule surfaces, this one's own checklist never structurally
      // excluded the assigned display (it was always a normal, checkable
      // option here), but it isn't checked by DEFAULT, so it wasn't
      // showing up as a schedulable option unless someone thought to check
      // it separately from just assigning it. Same underlying principle as
      // beta.55's identical fix elsewhere: the display a screen is
      // currently showing should always be available to schedule, not
      // conditional on an unrelated checkbox.
      const dispOpts = (displays || []).filter(d => checkedKeys.has(`display:${d.slug}`) || selKey === `display:${d.slug}` || d.slug === assignedDisplaySlug)
        .map(d => `<option value="display:${d.slug}" ${selKey === `display:${d.slug}` ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
      const presetOpts = (Array.isArray(presets) ? presets : []).filter(p => checkedKeys.has(`saved:${p.id}`) || selKey === `saved:${p.id}`)
        .map(p => `<option value="saved:${p.id}" ${selKey === `saved:${p.id}` ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
      return `<optgroup label="Live Displays">${dispOpts}</optgroup><optgroup label="Saved Templates">${presetOpts}</optgroup>`;
    };
    const targetLabel = (t) => {
      if (!t) return '(unknown)';
      if (t.type === 'display') {
        const d = (displays || []).find(d => d.slug === t.id);
        return d ? d.name : t.id;
      }
      const p = (Array.isArray(presets) ? presets : []).find(p => p.id === t.id);
      return p ? p.name : `Template #${t.id}`;
    };
    const saveFlsSchedule = async (screenId) => {
      const screen = onlineScreens.find(s => s.device_id === screenId);
      const rules = Array.isArray(screen && screen.floating_switcher_schedule) ? screen.floating_switcher_schedule : [];
      const r = await apiFetch(`/api/screens/${screenId}`, {
        method:'PUT', body: JSON.stringify({ floating_switcher_schedule: rules }),
      });
      if (r && r.error) { showToast('❌ ' + r.error); return; }
    };
    const renderFlsSchedule = (screenId) => {
      const listEl = list.querySelector(`.screen-fls-schedule-list[data-id="${screenId}"]`);
      if (!listEl) return;
      const screen = onlineScreens.find(s => s.device_id === screenId);
      if (screen && !Array.isArray(screen.floating_switcher_schedule)) screen.floating_switcher_schedule = [];
      const rules = (screen && screen.floating_switcher_schedule) || [];
      if (!rules.length) {
        listEl.innerHTML = `<div style="font-size:12px;color:var(--muted)">No scheduled switches yet.</div>`;
        return;
      }
      const conflicted = scheduleConflictIndices(rules);
      listEl.innerHTML = rules.map((rule, idx) => {
        const mode = rule.mode === 'interval' ? 'interval' : rule.mode === 'rotation' ? 'rotation' : 'time';
        const intervalInputsHtml = `
             <input type="number" class="form-input screen-fls-rule-interval-value" min="1" value="${rule.intervalValue || 30}" style="width:64px;flex-shrink:0">
             <select class="form-input screen-fls-rule-interval-unit" style="width:96px;flex-shrink:0">
               <option value="seconds"${rule.intervalUnit === 'seconds' ? ' selected' : ''}>Seconds</option>
               <option value="minutes"${(rule.intervalUnit || 'minutes') === 'minutes' ? ' selected' : ''}>Minutes</option>
               <option value="hours"${rule.intervalUnit === 'hours' ? ' selected' : ''}>Hours</option>
             </select>`;
        const timingRowHtml = mode === 'rotation'
          ? `<div style="display:flex;gap:8px;align-items:center">
               ${intervalInputsHtml}
               <span style="font-size:11px;color:var(--muted)">per display</span>
             </div>
             <div class="screen-fls-rotation-targets" style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
               ${(Array.isArray(rule.targets) ? rule.targets : []).map((t, tIdx) => `
                 <div class="screen-fls-rotation-target-row" data-tidx="${tIdx}" style="display:flex;gap:6px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 8px">
                   <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(targetLabel(t))}</span>
                   <button type="button" class="screen-fls-rot-move-up" aria-label="Move up" ${tIdx === 0 ? 'disabled' : ''} style="background:none;border:none;color:var(--muted);font-size:14px;padding:2px 6px;flex-shrink:0">↑</button>
                   <button type="button" class="screen-fls-rot-move-down" aria-label="Move down" ${tIdx === (rule.targets.length - 1) ? 'disabled' : ''} style="background:none;border:none;color:var(--muted);font-size:14px;padding:2px 6px;flex-shrink:0">↓</button>
                   <button type="button" class="screen-fls-rot-remove-target" aria-label="Remove" ${rule.targets.length <= 2 ? 'disabled' : ''} style="background:none;border:none;color:var(--muted);font-size:16px;padding:2px 6px;flex-shrink:0">✕</button>
                 </div>
               `).join('')}
               <select class="form-input screen-fls-rot-add-target" style="margin-top:2px">
                 <option value="">+ Add a display or template…</option>
                 ${targetOptionsHtml(null, screen && screen.floating_switcher_presets, screen && screen.assigned_display_slug)}
               </select>
             </div>`
          : `<div style="display:flex;gap:8px;align-items:center">
               ${mode === 'interval' ? intervalInputsHtml : `<input type="time" class="form-input screen-fls-rule-time" value="${rule.time || '08:00'}" style="width:110px;flex-shrink:0">`}
               <select class="form-input screen-fls-rule-target" style="flex:1">${targetOptionsHtml(rule.target, screen && screen.floating_switcher_presets, screen && screen.assigned_display_slug)}</select>
             </div>`;
        const enabled = rule.enabled !== false;
        const hasConflict = conflicted.has(idx);
        return `
        <div class="screen-fls-schedule-rule" data-id="${screenId}" data-idx="${idx}" style="border:1px solid ${hasConflict ? '#ffb020' : 'var(--border)'};border-radius:10px;padding:10px;opacity:${enabled ? '1' : '0.55'}">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);flex:1;cursor:pointer">
              <input type="checkbox" class="screen-fls-rule-enabled" ${enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
              Enabled
            </label>
            <button type="button" class="screen-fls-rule-remove" aria-label="Remove" style="background:none;border:none;color:var(--muted);font-size:18px;padding:4px 8px;flex-shrink:0">✕</button>
          </div>
          ${hasConflict ? `<div style="font-size:11px;color:#ffb020;background:rgba(255,176,32,0.12);border-radius:6px;padding:6px 8px;margin-bottom:10px">⚠️ Same time and day as another rule below — whichever fires last will win.</div>` : ''}
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <button type="button" class="screen-fls-rule-mode-btn${mode === 'time' ? ' active' : ''}" data-mode="time"
              style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:600;
                background:${mode === 'time' ? 'rgba(74,144,217,0.3)' : 'var(--card)'};color:${mode === 'time' ? '#fff' : 'var(--muted)'}">At a time</button>
            <button type="button" class="screen-fls-rule-mode-btn${mode === 'rotation' ? ' active' : ''}" data-mode="rotation"
              style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:600;
                background:${mode === 'rotation' ? 'rgba(74,144,217,0.3)' : 'var(--card)'};color:${mode === 'rotation' ? '#fff' : 'var(--muted)'}">Rotate</button>
          </div>
          ${timingRowHtml}
          <div style="display:flex;gap:4px;margin-top:8px">
            ${dayNames.map((d, i) => `<button type="button" class="screen-fls-rule-dow-btn${(rule.daysOfWeek || []).includes(i) ? ' active' : ''}" data-dow="${i}"
              style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:700;
                background:${(rule.daysOfWeek || []).includes(i) ? 'rgba(74,144,217,0.3)' : 'var(--card)'};
                color:${(rule.daysOfWeek || []).includes(i) ? '#fff' : 'var(--muted)'}">${d}</button>`).join('')}
          </div>
        </div>
      `;
      }).join('');
      listEl.querySelectorAll('.screen-fls-schedule-rule').forEach(rowEl => {
        const idx = Number(rowEl.dataset.idx);
        const enabledCheckbox = rowEl.querySelector('.screen-fls-rule-enabled');
        if (enabledCheckbox) enabledCheckbox.addEventListener('change', (e) => {
          screen.floating_switcher_schedule[idx].enabled = e.target.checked;
          renderFlsSchedule(screenId);
          saveFlsSchedule(screenId);
        });
        rowEl.querySelectorAll('.screen-fls-rule-mode-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const newMode = btn.dataset.mode;
            const current = screen.floating_switcher_schedule[idx].mode || 'time';
            if (current === newMode) return;
            screen.floating_switcher_schedule[idx].mode = newMode;
            // Same seeding as the widget's own mode-toggle handler — see
            // its own comment for why this matters beyond what the timing
            // inputs' display-time fallbacks alone would cover.
            if ((newMode === 'interval' || newMode === 'rotation') && !screen.floating_switcher_schedule[idx].intervalValue) {
              screen.floating_switcher_schedule[idx].intervalValue = 30;
              screen.floating_switcher_schedule[idx].intervalUnit = 'minutes';
            }
            if (newMode === 'time' && !screen.floating_switcher_schedule[idx].time) {
              screen.floating_switcher_schedule[idx].time = '08:00';
            }
            if (newMode === 'rotation' && !Array.isArray(screen.floating_switcher_schedule[idx].targets)) {
              screen.floating_switcher_schedule[idx].targets = screen.floating_switcher_schedule[idx].target ? [screen.floating_switcher_schedule[idx].target] : [];
            }
            // The missing symmetric case — see display.html's identical fix
            // for the full reasoning (a real report, not a hypothetical):
            // leaving rotation mode never set target (singular), which
            // time/interval modes require, and the server's own validation
            // drops the whole rule when it's missing.
            if (newMode !== 'rotation' && !screen.floating_switcher_schedule[idx].target && Array.isArray(screen.floating_switcher_schedule[idx].targets) && screen.floating_switcher_schedule[idx].targets.length) {
              screen.floating_switcher_schedule[idx].target = screen.floating_switcher_schedule[idx].targets[0];
            }
            renderFlsSchedule(screenId);
            // Skip the save specifically when switching INTO rotation mode
            // leaves fewer than 2 targets — see display.html's identical
            // fix for the full reasoning (a real report, not a
            // hypothetical): the server requires 2+ valid targets for a
            // rotation rule and silently drops the WHOLE rule otherwise,
            // which created a race between this doomed, 1-target save and
            // the very next one once a second target gets added.
            if (newMode === 'rotation' && (!screen.floating_switcher_schedule[idx].targets || screen.floating_switcher_schedule[idx].targets.length < 2)) return;
            saveFlsSchedule(screenId);
          });
        });
        const timeInput = rowEl.querySelector('.screen-fls-rule-time');
        if (timeInput) timeInput.addEventListener('change', (e) => {
          screen.floating_switcher_schedule[idx].time = e.target.value;
          saveFlsSchedule(screenId);
        });
        const intervalValueInput = rowEl.querySelector('.screen-fls-rule-interval-value');
        if (intervalValueInput) intervalValueInput.addEventListener('change', (e) => {
          screen.floating_switcher_schedule[idx].intervalValue = Number(e.target.value) || 1;
          saveFlsSchedule(screenId);
        });
        const intervalUnitSelect = rowEl.querySelector('.screen-fls-rule-interval-unit');
        if (intervalUnitSelect) intervalUnitSelect.addEventListener('change', (e) => {
          screen.floating_switcher_schedule[idx].intervalUnit = e.target.value;
          saveFlsSchedule(screenId);
        });
        const targetSelect = rowEl.querySelector('.screen-fls-rule-target');
        if (targetSelect) targetSelect.addEventListener('change', (e) => {
          const [type, id] = e.target.value.split(/:(.+)/);
          screen.floating_switcher_schedule[idx].target = { type, id: type === 'saved' ? Number(id) : id };
          saveFlsSchedule(screenId);
        });
        const addTargetSelect = rowEl.querySelector('.screen-fls-rot-add-target');
        if (addTargetSelect) addTargetSelect.addEventListener('change', (e) => {
          if (!e.target.value) return;
          const [type, id] = e.target.value.split(/:(.+)/);
          if (!Array.isArray(screen.floating_switcher_schedule[idx].targets)) screen.floating_switcher_schedule[idx].targets = [];
          screen.floating_switcher_schedule[idx].targets.push({ type, id: type === 'saved' ? Number(id) : id });
          renderFlsSchedule(screenId);
          // Same guard as display.html's identical handler — see its own
          // comment for the edge case this covers.
          if (screen.floating_switcher_schedule[idx].targets.length < 2) return;
          saveFlsSchedule(screenId);
        });
        rowEl.querySelectorAll('.screen-fls-rotation-target-row').forEach(trEl => {
          const tIdx = Number(trEl.dataset.tidx);
          const upBtn = trEl.querySelector('.screen-fls-rot-move-up');
          if (upBtn) upBtn.addEventListener('click', () => {
            const targets = screen.floating_switcher_schedule[idx].targets;
            [targets[tIdx - 1], targets[tIdx]] = [targets[tIdx], targets[tIdx - 1]];
            renderFlsSchedule(screenId);
            saveFlsSchedule(screenId);
          });
          const downBtn = trEl.querySelector('.screen-fls-rot-move-down');
          if (downBtn) downBtn.addEventListener('click', () => {
            const targets = screen.floating_switcher_schedule[idx].targets;
            [targets[tIdx + 1], targets[tIdx]] = [targets[tIdx], targets[tIdx + 1]];
            renderFlsSchedule(screenId);
            saveFlsSchedule(screenId);
          });
          trEl.querySelector('.screen-fls-rot-remove-target').addEventListener('click', () => {
            // Mirrors the disabled state on this same button above —
            // rotation has a hard minimum of 2 targets, so removing down to
            // 1 is never a state worth reaching at all.
            if (screen.floating_switcher_schedule[idx].targets.length <= 2) return;
            screen.floating_switcher_schedule[idx].targets.splice(tIdx, 1);
            renderFlsSchedule(screenId);
            saveFlsSchedule(screenId);
          });
        });
        rowEl.querySelectorAll('.screen-fls-rule-dow-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const dow = Number(btn.dataset.dow);
            const days = new Set(screen.floating_switcher_schedule[idx].daysOfWeek || []);
            if (days.has(dow)) days.delete(dow); else days.add(dow);
            screen.floating_switcher_schedule[idx].daysOfWeek = [...days];
            renderFlsSchedule(screenId);
            saveFlsSchedule(screenId);
          });
        });
        const removeBtn = rowEl.querySelector('.screen-fls-rule-remove');
        if (removeBtn) removeBtn.addEventListener('click', () => {
          screen.floating_switcher_schedule.splice(idx, 1);
          renderFlsSchedule(screenId);
          saveFlsSchedule(screenId);
        });
      });
    };
    list.querySelectorAll('.screen-fls-schedule-list').forEach(listEl => renderFlsSchedule(listEl.dataset.id));
    list.querySelectorAll('.screen-fls-schedule-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const screenId = btn.dataset.id;
        const screen = onlineScreens.find(s => s.device_id === screenId);
        if (!screen) return;
        // Prefers the first CHECKED switcher target — see display.html's
        // identical fix for the full reasoning.
        const checkedTargets = normTargets(screen.floating_switcher_presets);
        const defaultTarget = checkedTargets[0] || ((displays && displays[0]) ? { type: 'display', id: displays[0].slug }
          : (presets && presets[0]) ? { type: 'saved', id: presets[0].id } : null);
        if (!defaultTarget) { showToast('Add a display or save a layout first.'); return; }
        if (!Array.isArray(screen.floating_switcher_schedule)) screen.floating_switcher_schedule = [];
        screen.floating_switcher_schedule.push({ mode: 'time', time: '08:00', daysOfWeek: [1, 2, 3, 4, 5], target: defaultTarget });
        renderFlsSchedule(screenId);
        saveFlsSchedule(screenId);
      });
    });
  })();
}
