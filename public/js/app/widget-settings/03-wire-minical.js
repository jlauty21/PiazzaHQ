function drawWidgetSettingsPanel_Wire_minical(_c) {
  const { w } = _c;
    wireAccordion('minical-settings-acc');
    $('cal-layout-select').addEventListener('change', (e) => {
      w.calLayout = e.target.value;
      _calSettingsOpenSection = 'layout'; // stay open in the section the control that triggered this redraw lives in
      drawWidgetSettingsPanel(); // re-render so the right sub-settings show for the chosen layout
    });
    $('cal-color-coding-toggle').addEventListener('change', (e) => {
      w.calColorCoding = e.target.checked; // stored as false only when explicitly off — matches the !== false check used at render time
      // Full-Day Event Style's row visibility depends on this.
      _calSettingsOpenSection = 'colors';
      drawWidgetSettingsPanel();
    });
    $('cal-view-select').addEventListener('change', (e) => {
      w.calView = e.target.value;
    });
    $('cal-week-start-select').addEventListener('change', (e) => {
      w.calWeekStart = e.target.value; // 'default' | '0' | '1'
    });
    $('cal-date-format-select').addEventListener('change', (e) => {
      w.calDateFormat = e.target.value;
    });
    if ($('cal-ampm-case-select')) {
      $('cal-ampm-case-select').addEventListener('change', (e) => {
        w.calAmpmCase = e.target.value;
      });
    }
    $('cal-multiday-style-select').addEventListener('change', (e) => {
      w.calMultiDayStyle = e.target.value; // 'bar' | 'dot' | 'line' | 'stripe'
    });
    if ($('cal-fullday-style-select')) {
      $('cal-fullday-style-select').addEventListener('change', (e) => {
        w.calFullDayColorStyle = e.target.value; // 'highlight' | 'dot' | 'none'
      });
    }
    if ($('cal-today-style-select')) {
      $('cal-today-style-select').addEventListener('change', (e) => {
        w.calTodayStyle = e.target.value; // 'circle' | 'outline' | 'fill' | 'underline' | 'text' | 'none'
      });
    }
    if ($('cal-today-color-swatches')) {
      renderColorSwatches('cal-today-color-swatches', 'cal-today-color-custom', w.calTodayColor, (val) => {
        w.calTodayColor = val;
        autoSaveLayout(); // swatches are buttons, not native inputs — see the audit note by panelExpandBtn above
        _calSettingsOpenSection = 'colors'; // safe by construction (only reachable while Colors & Style is open) but set explicitly
        drawWidgetSettingsPanel(); // re-render so "Use Theme Default" appears and label updates
      });
      $('cal-today-color-custom').addEventListener('input', (e) => {
        w.calTodayColor = e.target.value;
      });
      $('cal-today-color-custom').addEventListener('change', () => {
        _calSettingsOpenSection = 'colors';
        drawWidgetSettingsPanel(); // commit re-render once the picker closes, avoids redrawing mid-drag
      });
    }
    if ($('cal-today-color-reset-btn')) {
      $('cal-today-color-reset-btn').addEventListener('click', () => {
        delete w.calTodayColor;
        autoSaveLayout();
        _calSettingsOpenSection = 'colors';
        drawWidgetSettingsPanel();
      });
    }
    $('cal-font-range').addEventListener('input', (e) => {
      w.calFontPx = parseInt(e.target.value);
      $('cal-font-val').textContent = w.calFontPx + 'px';
    });
    if ($('cal-wrap-mode')) {
      $('cal-wrap-mode').addEventListener('change', (e) => {
        w.calWrap = e.target.value; // 'off' | 'on' | 'clamp2'
        // Adaptive Font Sizing's checkbox is enabled/disabled based on wrap
        // mode — that only gets recomputed by re-rendering this settings
        // panel, so (unlike most fields here) this one needs an explicit
        // redraw rather than relying on the panel's general autosave.
        _calSettingsOpenSection = 'layout'; // safe by construction (this control only exists in the DOM while Layout is already open) but set explicitly rather than relying on that
        drawWidgetSettingsPanel();
      });
    }
    if ($('cal-adaptive-font-toggle')) {
      $('cal-adaptive-font-toggle').addEventListener('change', (e) => {
        w.calAdaptiveFontSizing = e.target.checked;
      });
    }
    if ($('cal-dim-past-toggle')) {
      $('cal-dim-past-toggle').addEventListener('change', (e) => {
        w.calDimPast = e.target.checked;
      });
    }
    if ($('cal-show-end-time-toggle')) {
      $('cal-show-end-time-toggle').addEventListener('change', (e) => {
        w.calShowEndTime = e.target.checked;
      });
    }
    if ($('cal-decor-select')) {
      $('cal-decor-select').addEventListener('change', (e) => {
        w.calDecor = e.target.value;
      });
    }
    if ($('cal-show-stickers-toggle')) {
      $('cal-show-stickers-toggle').addEventListener('change', (e) => {
        w.calShowStickers = e.target.checked;
        // Badge Position's row visibility depends on this.
        _calSettingsOpenSection = 'stickers';
        drawWidgetSettingsPanel();
      });
    }
    if ($('cal-sticker-position-select')) {
      $('cal-sticker-position-select').addEventListener('change', (e) => {
        w.calStickerPosition = e.target.value;
      });
    }
    if ($('cal-sticker-size-range')) {
      $('cal-sticker-size-range').addEventListener('input', (e) => {
        w.calStickerSizePx = parseInt(e.target.value, 10);
        $('cal-sticker-size-val').textContent = w.calStickerSizePx + 'px';
      });
    }
    if ($('cal-show-weather-toggle')) {
      $('cal-show-weather-toggle').addEventListener('change', (e) => {
        w.calShowWeather = e.target.checked;
        // Style/Position/Size rows' visibility depends on this.
        _calSettingsOpenSection = 'weather';
        drawWidgetSettingsPanel();
      });
    }
    if ($('cal-weather-style-select')) {
      $('cal-weather-style-select').addEventListener('change', (e) => {
        w.calWeatherStyle = e.target.value;
      });
    }
    if ($('cal-weather-position-select')) {
      $('cal-weather-position-select').addEventListener('change', (e) => {
        w.calWeatherPosition = e.target.value;
      });
    }
    if ($('cal-weather-size-range')) {
      $('cal-weather-size-range').addEventListener('input', (e) => {
        w.calWeatherSizePx = parseInt(e.target.value, 10);
        $('cal-weather-size-val').textContent = w.calWeatherSizePx + 'px';
      });
    }
    if ($('cal-show-reminders-toggle')) {
      $('cal-show-reminders-toggle').addEventListener('change', (e) => {
        w.calShowReminders = e.target.checked;
        // Badge Position/Size rows' visibility depends on this.
        _calSettingsOpenSection = 'reminders';
        drawWidgetSettingsPanel();
      });
    }
    if ($('cal-reminder-position-select')) {
      $('cal-reminder-position-select').addEventListener('change', (e) => {
        w.calReminderPosition = e.target.value;
      });
    }
    if ($('cal-reminder-size-range')) {
      $('cal-reminder-size-range').addEventListener('input', (e) => {
        w.calReminderSizePx = parseInt(e.target.value, 10);
        $('cal-reminder-size-val').textContent = w.calReminderSizePx + 'px';
      });
    }
    if ($('cal-reminder-textsize-range')) {
      $('cal-reminder-textsize-range').addEventListener('input', (e) => {
        w.calReminderTextSizePct = parseInt(e.target.value, 10);
        $('cal-reminder-textsize-val').textContent = w.calReminderTextSizePct + '%';
      });
    }
    if ($('cal-past-events-select')) {
      $('cal-past-events-select').addEventListener('change', (e) => {
        w.pastEvents = e.target.value;
      });
    }
    if ($('cal-max-events-range')) {
      $('cal-max-events-range').addEventListener('input', (e) => {
        w.calMaxEventsPerDay = parseInt(e.target.value);
        $('cal-max-events-val').textContent = w.calMaxEventsPerDay === 0 ? 'Auto' : w.calMaxEventsPerDay;
      });
    }
    if ($('cal-max-lines-range')) {
      $('cal-max-lines-range').addEventListener('input', (e) => {
        w.calMaxLines = parseInt(e.target.value);
        $('cal-max-lines-val').textContent = w.calMaxLines === 0 ? 'Auto' : w.calMaxLines;
      });
    }
    if ($('cal-agenda-days-range')) {
      $('cal-agenda-days-range').addEventListener('input', (e) => {
        w.calAgendaDays = parseInt(e.target.value);
        $('cal-agenda-days-val').textContent = w.calAgendaDays;
      });
    }
    if ($('cal-strip-days-range')) {
      $('cal-strip-days-range').addEventListener('input', (e) => {
        w.calStripDays = parseInt(e.target.value);
        $('cal-strip-days-val').textContent = w.calStripDays;
      });
    }
}

function drawWidgetSettingsPanel_Wire_radar(_c) {
  const { w } = _c;
    if ($('radar-title')) $('radar-title').addEventListener('input', (e) => { w.radarTitle = e.target.value; });
    const radarOvToggle = $('radar-loc-override');
    if (radarOvToggle) {
      radarOvToggle.addEventListener('change', (e) => {
        const fields = $('radar-loc-override-fields');
        if (e.target.checked) {
          fields.style.display = '';
        } else {
          fields.style.display = 'none';
          delete w.radarLat; delete w.radarLon;
          showToast('Using global weather location');
        }
      });
    }
    if ($('radar-loc-lookup')) {
      $('radar-loc-lookup').addEventListener('click', async () => {
        const zip = $('radar-loc-zip').value.trim();
        if (!zip) { $('radar-loc-status').textContent = 'Enter a ZIP/postal code first.'; return; }
        $('radar-loc-status').textContent = 'Looking up…';
        try {
          const r = await apiFetch(`/api/geocode?save=0&zip=${encodeURIComponent(zip)}`);
          if (r && r.ambiguous && Array.isArray(r.candidates)) {
            const statusEl = $('radar-loc-status');
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
                w.radarLat = String(c.lat); w.radarLon = String(c.lon);
                statusEl.textContent = `📍 ${c.label || (c.lat + ', ' + c.lon)}`;
                showToast('Location set — Save Layout to keep it');
              });
              statusEl.appendChild(btn);
            }
          } else if (r && r.lat && r.lon) {
            w.radarLat = String(r.lat); w.radarLon = String(r.lon);
            $('radar-loc-status').textContent = `📍 ${r.label || (r.lat + ', ' + r.lon)}`;
            showToast('Location set — Save Layout to keep it');
          } else {
            $('radar-loc-status').textContent = r && r.error ? r.error : 'Could not find that location.';
          }
        } catch {
          $('radar-loc-status').textContent = 'Lookup failed — check your connection.';
        }
      });
    }
    if ($('radar-zoom-range')) $('radar-zoom-range').addEventListener('input', (e) => {
      w.radarZoom = parseInt(e.target.value);
      $('radar-zoom-val').textContent = w.radarZoom;
    });
    if ($('radar-opacity-range')) $('radar-opacity-range').addEventListener('input', (e) => {
      w.radarOpacity = parseInt(e.target.value);
      $('radar-opacity-val').textContent = w.radarOpacity + '%';
    });
    if ($('radar-show-time')) $('radar-show-time').addEventListener('change', (e) => { w.radarShowTime = e.target.checked; });
    if ($('radar-animate')) $('radar-animate').addEventListener('change', (e) => {
      w.radarAnimate = e.target.checked;
      if ($('radar-frames-row')) $('radar-frames-row').style.display = w.radarAnimate ? 'block' : 'none';
    });
    if ($('radar-frames-range')) $('radar-frames-range').addEventListener('input', (e) => {
      w.radarFrameCount = parseInt(e.target.value);
      $('radar-frames-val').textContent = w.radarFrameCount;
    });
    if ($('radar-font-range')) $('radar-font-range').addEventListener('input', (e) => {
      w.radarFontPx = parseInt(e.target.value);
      $('radar-font-val').textContent = w.radarFontPx + 'px';
    });
}

function drawWidgetSettingsPanel_Wire_timer(_c) {
  const { w } = _c;
    if ($('tm-title')) $('tm-title').addEventListener('input', (e) => { w.timerTitle = e.target.value; });
    if ($('tm-minutes')) $('tm-minutes').addEventListener('input', (e) => { w.timerMinutes = parseInt(e.target.value) || 5; });
    if ($('tm-font-range')) $('tm-font-range').addEventListener('input', (e) => {
      w.timerFontPx = parseInt(e.target.value);
      $('tm-font-val').textContent = w.timerFontPx + 'px';
    });
    if ($('tm-start')) $('tm-start').addEventListener('click', () => {
      const mins = w.timerMinutes || 5;
      w.timerEndsAt = new Date(Date.now() + mins * 60000).toISOString();
      w.timerRemainingSec = null;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
    if ($('tm-pause')) $('tm-pause').addEventListener('click', () => {
      if (w.timerEndsAt) {
        w.timerRemainingSec = Math.max(0, Math.round((new Date(w.timerEndsAt).getTime() - Date.now()) / 1000));
      }
      w.timerEndsAt = null;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
    if ($('tm-resume')) $('tm-resume').addEventListener('click', () => {
      const remaining = typeof w.timerRemainingSec === 'number' ? w.timerRemainingSec : (w.timerMinutes || 5) * 60;
      w.timerEndsAt = new Date(Date.now() + remaining * 1000).toISOString();
      w.timerRemainingSec = null;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
    if ($('tm-reset')) $('tm-reset').addEventListener('click', () => {
      w.timerEndsAt = null;
      w.timerRemainingSec = null;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
}

function drawWidgetSettingsPanel_Wire_layoutswitcher(_c) {
  const { w } = _c;
    if ($('ls-font-range')) $('ls-font-range').addEventListener('input', (e) => {
      w.switcherFontPx = parseInt(e.target.value);
      $('ls-font-val').textContent = w.switcherFontPx + 'px';
    });
    // Same shape as display.html's own normalizeSwitcherTargets()/
    // switcherTargetKey() — duplicated here rather than shared, matching
    // this codebase's established convention for client-side logic that
    // needs to exist in both the app and the display (different runtime
    // contexts, no shared module between them). Reads either the new
    // switcherTargets field or the legacy switcherPresetIds (bare numbers,
    // always meant a saved_layout id, from before live displays could be a
    // target) so a widget saved before this expansion still shows its
    // existing selections correctly.
    const normTargets = (raw) => (Array.isArray(raw) ? raw : []).map(t => {
      if (typeof t === 'number' || (typeof t === 'string' && /^\d+$/.test(t))) return { type: 'saved', id: Number(t) };
      if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id) };
      if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id };
      return null;
    }).filter(Boolean);
    const targetKey = (t) => `${t.type}:${t.id}`;
    const currentTargets = () => new Map(normTargets(w.switcherTargets || w.switcherPresetIds).map(t => [targetKey(t), t]));
    const toggleTarget = (target, checked) => {
      const map = currentTargets();
      if (checked) map.set(targetKey(target), target); else map.delete(targetKey(target));
      w.switcherTargets = [...map.values()];
      delete w.switcherPresetIds; // fully migrated to the new field the moment this widget's selection is touched at all
      // Schedule rules' own target dropdowns are now filtered to only the
      // targets checked here — without this, toggling a checkbox wouldn't
      // update what the schedule offers until some unrelated schedule edit
      // happened to re-render it.
      renderScheduleRules();
    };
    (async () => {
      const assigned = currentTargets();

      const displayListEl = $('ls-display-list');
      if (displayListEl) {
        let displays = [];
        try { displays = await getDisplaysList(true); } catch {}
        const others = (displays || []).filter(d => d.slug !== currentDisplaySlug);
        if (!others.length) {
          displayListEl.innerHTML = `<div style="font-size:12px;color:var(--muted)">No other displays yet.</div>`;
        } else {
          displayListEl.innerHTML = others.map(d => `
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" class="ls-display-cb" data-id="${d.slug}" ${assigned.has(`display:${d.slug}`) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
              ${escapeHtml(d.name)}
            </label>
          `).join('');
          displayListEl.querySelectorAll('.ls-display-cb').forEach(cb => {
            cb.addEventListener('change', () => toggleTarget({ type: 'display', id: cb.dataset.id }, cb.checked));
          });
        }
      }

      let presets = [];
      try { presets = await apiFetch('/api/saved-layouts'); } catch {}
      const listEl = $('ls-preset-list');
      if (listEl) {
        if (!Array.isArray(presets) || !presets.length) {
          listEl.innerHTML = `<div style="font-size:12px;color:var(--muted)">No saved layouts yet — save one from the Layout tab first.</div>`;
        } else {
          listEl.innerHTML = presets.map(p => `
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" class="ls-preset-cb" data-id="${p.id}" ${assigned.has(`saved:${p.id}`) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
              ${escapeHtml(p.name)}
            </label>
          `).join('');
          listEl.querySelectorAll('.ls-preset-cb').forEach(cb => {
            cb.addEventListener('change', () => toggleTarget({ type: 'saved', id: Number(cb.dataset.id) }, cb.checked));
          });
        }
      }

      // Copy-to-another-layout target list — every OTHER display profile
      // (copying onto the one already showing this widget wouldn't do
      // anything useful, so it's excluded). Reuses the same "displays"
      // fetch as the Live Displays checklist above rather than fetching
      // twice.
      const targetEl = $('ls-copy-target');
      if (targetEl) {
        let displays = [];
        try { displays = await getDisplaysList(true); } catch {}
        const others = (displays || []).filter(d => d.slug !== currentDisplaySlug);
        targetEl.innerHTML = others.length
          ? others.map(d => `<option value="${d.slug}">${escapeHtml(d.name)}</option>`).join('')
          : `<option value="">No other layouts yet</option>`;
      }

      // Schedule rules — reuses the same displays/presets already fetched
      // above for the checklists, rather than a third fetch. Each rule is
      // {time, daysOfWeek, target}; the target here is single-select (a
      // dropdown, not a checklist) since a rule only ever switches to ONE
      // place, unlike the buttons above which offer several as options.
      let scheduleDisplays = [], schedulePresets = [];
      try { scheduleDisplays = await getDisplaysList(); } catch {}
      try { schedulePresets = await apiFetch('/api/saved-layouts'); } catch {}
      const dayNames = ['S','M','T','W','T','F','S'];
      const targetOptionsHtml = (selected) => {
        const selKey = selected ? `${selected.type}:${selected.id}` : '';
        // Restricted to only the targets currently checked in the "Live
        // Displays"/"Saved Templates" checklists above — by explicit
        // request. See display.html's identical fix for the full
        // reasoning, including why the currently-selected target is
        // always included even if it's since been unchecked.
        const checkedKeys = new Set(normTargets(w.switcherTargets || w.switcherPresetIds).map(t => `${t.type}:${t.id}`));
        // Also always includes the current display being edited
        // (currentDisplaySlug) — see display.html's identical fix for the
        // full reasoning: it's deliberately excluded from the switcher's
        // own checklist above (a manual button switching to where you
        // already are is pointless), so it was never checkable and
        // therefore never survived the restriction above either. A
        // rotation should still be able to cycle back to this display's
        // own native content.
        const dispOpts = (scheduleDisplays || []).filter(d => checkedKeys.has(`display:${d.slug}`) || selKey === `display:${d.slug}` || d.slug === currentDisplaySlug)
          .map(d => `<option value="display:${d.slug}" ${selKey === `display:${d.slug}` ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
        const presetOpts = (Array.isArray(schedulePresets) ? schedulePresets : []).filter(p => checkedKeys.has(`saved:${p.id}`) || selKey === `saved:${p.id}`)
          .map(p => `<option value="saved:${p.id}" ${selKey === `saved:${p.id}` ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
        return `<optgroup label="Live Displays">${dispOpts}</optgroup><optgroup label="Saved Templates">${presetOpts}</optgroup>`;
      };
      const targetLabel = (t) => {
        if (!t) return '(unknown)';
        if (t.type === 'display') {
          const d = (scheduleDisplays || []).find(d => d.slug === t.id);
          return d ? d.name : t.id;
        }
        const p = (Array.isArray(schedulePresets) ? schedulePresets : []).find(p => p.id === t.id);
        return p ? p.name : `Template #${t.id}`;
      };
      const renderScheduleRules = () => {
        const listEl = $('ls-schedule-list');
        if (!listEl) return;
        const rules = Array.isArray(w.switcherSchedule) ? w.switcherSchedule : [];
        if (!rules.length) {
          listEl.innerHTML = `<div style="font-size:12px;color:var(--muted)">No scheduled switches yet.</div>`;
          return;
        }
        const conflicted = scheduleConflictIndices(rules);
        listEl.innerHTML = rules.map((rule, idx) => {
          const mode = rule.mode === 'interval' ? 'interval' : rule.mode === 'rotation' ? 'rotation' : 'time';
          const intervalInputsHtml = `
               <input type="number" class="form-input ls-rule-interval-value" min="1" value="${rule.intervalValue || 30}" style="width:64px;flex-shrink:0">
               <select class="form-input ls-rule-interval-unit" style="width:96px;flex-shrink:0">
                 <option value="seconds"${rule.intervalUnit === 'seconds' ? ' selected' : ''}>Seconds</option>
                 <option value="minutes"${(rule.intervalUnit || 'minutes') === 'minutes' ? ' selected' : ''}>Minutes</option>
                 <option value="hours"${rule.intervalUnit === 'hours' ? ' selected' : ''}>Hours</option>
               </select>`;
          const timingRowHtml = mode === 'rotation'
            ? `<div class="ls-rule-timing-row" style="display:flex;gap:8px;align-items:center">
                 ${intervalInputsHtml}
                 <span style="font-size:11px;color:var(--muted)">per display</span>
               </div>
               <div class="ls-rotation-targets" style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
                 ${(Array.isArray(rule.targets) ? rule.targets : []).map((t, tIdx) => `
                   <div class="ls-rotation-target-row" data-tidx="${tIdx}" style="display:flex;gap:6px;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 8px">
                     <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(targetLabel(t))}</span>
                     <button type="button" class="ls-rot-move-up" aria-label="Move up" ${tIdx === 0 ? 'disabled' : ''} style="background:none;border:none;color:var(--muted);font-size:14px;padding:2px 6px;flex-shrink:0">↑</button>
                     <button type="button" class="ls-rot-move-down" aria-label="Move down" ${tIdx === (rule.targets.length - 1) ? 'disabled' : ''} style="background:none;border:none;color:var(--muted);font-size:14px;padding:2px 6px;flex-shrink:0">↓</button>
                     <button type="button" class="ls-rot-remove-target" aria-label="Remove" ${rule.targets.length <= 2 ? 'disabled' : ''} style="background:none;border:none;color:var(--muted);font-size:16px;padding:2px 6px;flex-shrink:0">✕</button>
                   </div>
                 `).join('')}
                 <select class="form-input ls-rot-add-target" style="margin-top:2px">
                   <option value="">+ Add a display or template…</option>
                   ${targetOptionsHtml(null)}
                 </select>
               </div>`
            : `<div class="ls-rule-timing-row" style="display:flex;gap:8px;align-items:center">
                 ${mode === 'interval' ? intervalInputsHtml : `<input type="time" class="form-input ls-rule-time" value="${rule.time || '08:00'}" style="width:110px;flex-shrink:0">`}
                 <select class="form-input ls-rule-target" style="flex:1">${targetOptionsHtml(rule.target)}</select>
               </div>`;
          const enabled = rule.enabled !== false;
          const hasConflict = conflicted.has(idx);
          return `
          <div class="ls-schedule-rule" data-idx="${idx}" style="border:1px solid ${hasConflict ? '#ffb020' : 'var(--border)'};border-radius:10px;padding:10px;opacity:${enabled ? '1' : '0.55'}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);flex:1;cursor:pointer">
                <input type="checkbox" class="ls-rule-enabled" ${enabled ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)">
                Enabled
              </label>
              <button type="button" class="ls-rule-remove" aria-label="Remove" style="background:none;border:none;color:var(--muted);font-size:18px;padding:4px 8px;flex-shrink:0">✕</button>
            </div>
            ${hasConflict ? `<div style="font-size:11px;color:#ffb020;background:rgba(255,176,32,0.12);border-radius:6px;padding:6px 8px;margin-bottom:10px">⚠️ Same time and day as another rule below — whichever fires last will win.</div>` : ''}
            <div style="display:flex;gap:6px;margin-bottom:8px">
              <button type="button" class="ls-rule-mode-btn${mode === 'time' ? ' active' : ''}" data-mode="time"
                style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:600;
                  background:${mode === 'time' ? 'rgba(74,144,217,0.3)' : 'var(--card)'};color:${mode === 'time' ? '#fff' : 'var(--muted)'}">At a time</button>
              <button type="button" class="ls-rule-mode-btn${mode === 'rotation' ? ' active' : ''}" data-mode="rotation"
                style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:600;
                  background:${mode === 'rotation' ? 'rgba(74,144,217,0.3)' : 'var(--card)'};color:${mode === 'rotation' ? '#fff' : 'var(--muted)'}">Rotate</button>
            </div>
            ${timingRowHtml}
            <div style="display:flex;gap:4px;margin-top:8px">
              ${dayNames.map((d, i) => `<button type="button" class="ls-rule-dow-btn${(rule.daysOfWeek || []).includes(i) ? ' active' : ''}" data-dow="${i}"
                style="flex:1;padding:7px 0;border-radius:6px;border:1px solid var(--border);font-size:11px;font-weight:700;
                  background:${(rule.daysOfWeek || []).includes(i) ? 'rgba(74,144,217,0.3)' : 'var(--card)'};
                  color:${(rule.daysOfWeek || []).includes(i) ? '#fff' : 'var(--muted)'}">${d}</button>`).join('')}
            </div>
          </div>
        `;
        }).join('');
        listEl.querySelectorAll('.ls-schedule-rule').forEach(rowEl => {
          const idx = Number(rowEl.dataset.idx);
          const enabledCheckbox = rowEl.querySelector('.ls-rule-enabled');
          if (enabledCheckbox) enabledCheckbox.addEventListener('change', (e) => {
            w.switcherSchedule[idx].enabled = e.target.checked;
            renderScheduleRules();
          });
          rowEl.querySelectorAll('.ls-rule-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const newMode = btn.dataset.mode;
              const current = w.switcherSchedule[idx].mode || 'time';
              if (current === newMode) return;
              w.switcherSchedule[idx].mode = newMode;
              // Seed sensible defaults the first time a rule switches INTO
              // a mode it's never used before, rather than leaving fields
              // from another mode lying around unused (harmless, but
              // confusing to find later) or leaving new fields undefined
              // (which the timing inputs above already fall back to
              // reasonable defaults for anyway — this just makes the
              // underlying data match what's shown rather than relying on
              // display-time fallbacks alone).
              if ((newMode === 'interval' || newMode === 'rotation') && !w.switcherSchedule[idx].intervalValue) {
                w.switcherSchedule[idx].intervalValue = 30;
                w.switcherSchedule[idx].intervalUnit = 'minutes';
              }
              if (newMode === 'time' && !w.switcherSchedule[idx].time) {
                w.switcherSchedule[idx].time = '08:00';
              }
              if (newMode === 'rotation' && !Array.isArray(w.switcherSchedule[idx].targets)) {
                // Carry the single target forward as rotation's first entry
                // when switching FROM a single-target mode — better than
                // starting from an empty list every time, since it's
                // usually the display someone was already about to pick
                // for the rule anyway.
                w.switcherSchedule[idx].targets = w.switcherSchedule[idx].target ? [w.switcherSchedule[idx].target] : [];
              }
              // The missing symmetric case — see display.html's identical
              // fix for the full reasoning (a real report, not a
              // hypothetical, though this surface doesn't auto-save so
              // isn't exposed to that specific race): leaving rotation mode
              // never set target (singular), which time/interval modes
              // require — without this, the rule would silently carry no
              // target at all and never fire, even once "Save Layout" runs.
              if (newMode !== 'rotation' && !w.switcherSchedule[idx].target && Array.isArray(w.switcherSchedule[idx].targets) && w.switcherSchedule[idx].targets.length) {
                w.switcherSchedule[idx].target = w.switcherSchedule[idx].targets[0];
              }
              renderScheduleRules();
            });
          });
          const timeInput = rowEl.querySelector('.ls-rule-time');
          if (timeInput) timeInput.addEventListener('change', (e) => {
            w.switcherSchedule[idx].time = e.target.value;
          });
          const intervalValueInput = rowEl.querySelector('.ls-rule-interval-value');
          if (intervalValueInput) intervalValueInput.addEventListener('change', (e) => {
            w.switcherSchedule[idx].intervalValue = Number(e.target.value) || 1;
          });
          const intervalUnitSelect = rowEl.querySelector('.ls-rule-interval-unit');
          if (intervalUnitSelect) intervalUnitSelect.addEventListener('change', (e) => {
            w.switcherSchedule[idx].intervalUnit = e.target.value;
          });
          const targetSelect = rowEl.querySelector('.ls-rule-target');
          if (targetSelect) targetSelect.addEventListener('change', (e) => {
            const [type, id] = e.target.value.split(/:(.+)/); // split on first ':' only — a display slug could itself contain one
            w.switcherSchedule[idx].target = { type, id: type === 'saved' ? Number(id) : id };
          });
          const addTargetSelect = rowEl.querySelector('.ls-rot-add-target');
          if (addTargetSelect) addTargetSelect.addEventListener('change', (e) => {
            if (!e.target.value) return;
            const [type, id] = e.target.value.split(/:(.+)/);
            if (!Array.isArray(w.switcherSchedule[idx].targets)) w.switcherSchedule[idx].targets = [];
            w.switcherSchedule[idx].targets.push({ type, id: type === 'saved' ? Number(id) : id });
            renderScheduleRules();
          });
          rowEl.querySelectorAll('.ls-rotation-target-row').forEach(trEl => {
            const tIdx = Number(trEl.dataset.tidx);
            const upBtn = trEl.querySelector('.ls-rot-move-up');
            if (upBtn) upBtn.addEventListener('click', () => {
              const targets = w.switcherSchedule[idx].targets;
              [targets[tIdx - 1], targets[tIdx]] = [targets[tIdx], targets[tIdx - 1]];
              renderScheduleRules();
            });
            const downBtn = trEl.querySelector('.ls-rot-move-down');
            if (downBtn) downBtn.addEventListener('click', () => {
              const targets = w.switcherSchedule[idx].targets;
              [targets[tIdx + 1], targets[tIdx]] = [targets[tIdx], targets[tIdx + 1]];
              renderScheduleRules();
            });
            trEl.querySelector('.ls-rot-remove-target').addEventListener('click', () => {
              // Mirrors the disabled state on this same button above —
              // rotation has a hard minimum of 2 targets, so removing down
              // to 1 is never a state worth reaching at all.
              if (w.switcherSchedule[idx].targets.length <= 2) return;
              w.switcherSchedule[idx].targets.splice(tIdx, 1);
              renderScheduleRules();
            });
          });
          rowEl.querySelectorAll('.ls-rule-dow-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const dow = Number(btn.dataset.dow);
              const days = new Set(w.switcherSchedule[idx].daysOfWeek || []);
              if (days.has(dow)) days.delete(dow); else days.add(dow);
              w.switcherSchedule[idx].daysOfWeek = [...days];
              renderScheduleRules(); // re-render this one row's button states
            });
          });
          const removeBtn = rowEl.querySelector('.ls-rule-remove');
          if (removeBtn) removeBtn.addEventListener('click', () => {
            w.switcherSchedule.splice(idx, 1);
            renderScheduleRules();
          });
        });
      };
      if (!Array.isArray(w.switcherSchedule)) w.switcherSchedule = [];
      renderScheduleRules();
      if ($('ls-schedule-add-btn')) $('ls-schedule-add-btn').addEventListener('click', () => {
        // Prefers the first CHECKED switcher target — see display.html's
        // identical fix for the full reasoning.
        const checkedTargets = normTargets(w.switcherTargets || w.switcherPresetIds);
        const defaultTarget = checkedTargets[0] || ((scheduleDisplays && scheduleDisplays[0]) ? { type: 'display', id: scheduleDisplays[0].slug }
          : (schedulePresets && schedulePresets[0]) ? { type: 'saved', id: schedulePresets[0].id } : null);
        if (!defaultTarget) { showToast('Add a display or save a layout first.'); return; }
        w.switcherSchedule.push({ mode: 'time', time: '08:00', daysOfWeek: [1, 2, 3, 4, 5], target: defaultTarget });
        renderScheduleRules();
      });
    })();
    if ($('ls-copy-btn')) $('ls-copy-btn').addEventListener('click', async () => {
      const target = $('ls-copy-target').value;
      if (!target) { showToast('No other layout to copy to yet.'); return; }
      const targetName = $('ls-copy-target').selectedOptions[0]?.textContent || target;
      // Historically included the raw target slug in parentheses here too,
      // as a diagnostic to isolate a "Copy" landing on the wrong display"
      // bug to the dropdown's own value/population rather than anything
      // after confirming — removed by explicit request once no longer
      // needed, along with every other leftover diagnostic from that era.
      if (!confirm(`Copy this Layout Switcher onto "${targetName}"?`)) return;
      try {
        for (const orientation of ['landscape', 'portrait']) {
          const existing = await apiFetch(`/api/layouts/${orientation}?display=${encodeURIComponent(target)}`);
          const widgets = Array.isArray(existing?.widgets) ? existing.widgets : [];
          // A proper deep copy, not a shallow one — {...w} alone would leave
          // nested arrays (switcherTargets, switcherSchedule, and the target
          // objects inside each schedule rule) shared BY REFERENCE between
          // the original and the copy, so editing either one's targets or
          // schedule would silently mutate the other too. Confirmed as a
          // real, reproducible bug, not a theoretical one: removing a
          // target from the copy removed it from the original as well,
          // since they were never actually two separate objects underneath
          // the top level. JSON round-trip is safe here — widget objects
          // are plain, fully JSON-serializable data, nothing that would
          // break this (no functions, no circular references, no Date
          // objects or similar).
          const copy = JSON.parse(JSON.stringify(w));
          copy.id = 'w_' + Math.random().toString(36).slice(2, 10);
          widgets.push(copy);
          await apiFetch(`/api/layouts/${orientation}?display=${encodeURIComponent(target)}`, {
            method: 'PUT', body: JSON.stringify({ widgets }),
          });
        }
        showToast(`Copied to ${targetName} (${target}) ✓`);
      } catch {
        showToast('❌ Could not copy — try again.');
      }
    });
}

function drawWidgetSettingsPanel_Wire_sports(_c) {
  const { w } = _c;
    if ($('sp-font-range')) $('sp-font-range').addEventListener('input', (e) => {
      w.spFontPx = parseInt(e.target.value);
      $('sp-font-val').textContent = w.spFontPx + 'px';
    });
    const renderResults = (teams) => {
      const box = $('sp-results');
      if (!box) return;
      if (!teams.length) { box.innerHTML = `<p style="font-size:12px;color:var(--muted)">No teams found — try a different spelling.</p>`; return; }
      box.innerHTML = teams.map(t => `
        <button type="button" class="sp-result-pick" data-id="${t.id}" data-name="${escapeHtml(t.name)}" data-badge="${escapeHtml(t.badge||'')}"
          style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 10px;cursor:pointer;text-align:left;width:100%">
          ${t.badge ? `<img src="${escapeHtml(t.badge)}" style="width:30px;height:30px;object-fit:contain">` : '<span style="width:30px"></span>'}
          <span style="flex:1"><b>${escapeHtml(t.name)}</b><br><span style="font-size:11px;color:var(--muted)">${escapeHtml(t.sport)}${t.league ? ' · ' + escapeHtml(t.league) : ''}</span></span>
        </button>`).join('');
      box.querySelectorAll('.sp-result-pick').forEach(btn => btn.addEventListener('click', () => {
        w.spTeamId = btn.dataset.id;
        w.spTeamName = btn.dataset.name;
        w.spTeamBadge = btn.dataset.badge || null;
        autoSaveLayout();
        drawWidgetSettingsPanel();
      }));
    };
    const doSearch = async () => {
      const q = $('sp-search-input').value.trim();
      if (!q) return;
      $('sp-results').innerHTML = `<p style="font-size:12px;color:var(--muted)">Searching…</p>`;
      try {
        const r = await apiFetch(`/api/sports/search-team?q=${encodeURIComponent(q)}`);
        renderResults(r.teams || []);
      } catch { $('sp-results').innerHTML = `<p style="font-size:12px;color:var(--muted)">❌ Search failed.</p>`; }
    };
    if ($('sp-search-btn')) $('sp-search-btn').addEventListener('click', doSearch);
    if ($('sp-search-input')) $('sp-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    if ($('sp-change-btn')) $('sp-change-btn').addEventListener('click', () => {
      w.spTeamId = null; w.spTeamName = null; w.spTeamBadge = null;
      autoSaveLayout();
      drawWidgetSettingsPanel();
    });
}

function drawWidgetSettingsPanel_Wire_stocks(_c) {
  const { w } = _c;
    $('stock-font-range').addEventListener('input', (e) => {
      w.stockFontPx = parseInt(e.target.value);
      $('stock-font-val').textContent = w.stockFontPx + 'px';
    });
    // Checkboxes are framed as "show", stored as "hide" (so the default of
    // undefined/false = shown, matching "shown by default").
    $('stock-show-dow').addEventListener('change', (e) => { w.hideDow = !e.target.checked; });
    $('stock-show-nasdaq').addEventListener('change', (e) => { w.hideNasdaq = !e.target.checked; });
    $('stock-show-sp').addEventListener('change', (e) => { w.hideSP = !e.target.checked; });

    // ── Ticker chips (per-widget — moved in from the old device-wide Data
    // Sources setting; see fetchStocks()/renderStocks() equivalents in
    // display.html for the fetch-union/render-filter halves of this) ───────
    if (!Array.isArray(w.stockTickers)) w.stockTickers = [];
    const renderWTickerChips = () => {
      const container = $('w-ticker-chips');
      if (!container) return;
      if (!w.stockTickers.length) {
        container.innerHTML = `<span style="font-size:12px;color:var(--muted)">No custom tickers added yet</span>`;
        return;
      }
      container.innerHTML = w.stockTickers.map(t => `
        <span style="display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);
          border-radius:20px;padding:6px 8px 6px 14px;font-size:13px;font-weight:500">
          ${t}
          <button class="w-ticker-remove-btn" data-ticker="${t}" style="background:none;border:none;color:var(--muted);
            font-size:16px;line-height:1;cursor:pointer;padding:0 4px">×</button>
        </span>
      `).join('');
      container.querySelectorAll('.w-ticker-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          w.stockTickers = w.stockTickers.filter(t => t !== btn.dataset.ticker);
          renderWTickerChips();
          autoSaveLayout(); // button click, not a native input/change event — see panel's delegated listener above
        });
      });
    };
    renderWTickerChips();
    const addWTicker = (val) => {
      val = (val || '').trim().toUpperCase();
      if (!val || w.stockTickers.includes(val)) return;
      w.stockTickers.push(val);
      renderWTickerChips();
      autoSaveLayout();
    };
    if ($('w-ticker-add-btn')) $('w-ticker-add-btn').addEventListener('click', () => {
      addWTicker($('w-ticker-input').value);
      $('w-ticker-input').value = '';
    });
    if ($('w-ticker-input')) $('w-ticker-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addWTicker($('w-ticker-input').value); $('w-ticker-input').value = ''; }
    });
    document.querySelectorAll('.w-crypto-quickadd').forEach(btn => {
      btn.addEventListener('click', () => addWTicker(btn.dataset.sym));
    });
}

function drawWidgetSettingsPanel_Wire_photo(_c) {
  const { w } = _c;
    const modeSel = $('photo-mode-select');
    if (modeSel) {
      modeSel.addEventListener('change', (e) => {
        w.photoMode = e.target.value;
        $('photo-pick-row').style.display = w.photoMode === 'selected' ? '' : 'none';
        if (w.photoMode === 'selected') loadPhotoPickGrid(w);
      });
    }
    if ($('photo-fullscreen-bg-toggle')) {
      $('photo-fullscreen-bg-toggle').addEventListener('change', (e) => {
        w.photoFullscreenBg = e.target.checked;
        // rebuildCanvas() re-renders every editor widget (picking up the new
        // position/z-index override from makeEditorWidget()) AND saves — a
        // plain 'change' event alone would save fine via the panel's own
        // delegated listener, but wouldn't visually reposition anything
        // without this.
        rebuildCanvas();
      });
    }
    if ($('photo-fit-select')) {
      $('photo-fit-select').addEventListener('change', (e) => {
        w.photoFit = e.target.value;
        const row = $('photo-autoblurbg-row');
        if (row) row.style.display = e.target.value === 'auto' ? 'flex' : 'none';
      });
    }
    if ($('photo-autoblurbg')) $('photo-autoblurbg').addEventListener('change', (e) => { w.photoAutoBlurBg = e.target.checked; });
    if ($('photo-fadetransition')) $('photo-fadetransition').addEventListener('change', (e) => {
      w.photoFadeTransition = e.target.checked;
      const row = $('photo-fadeduration-row');
      if (row) row.style.display = e.target.checked ? '' : 'none';
    });
    if ($('photo-fadeduration-select')) $('photo-fadeduration-select').addEventListener('change', (e) => { w.photoFadeDuration = parseFloat(e.target.value); });
    if ($('photo-tag-select')) {
      $('photo-tag-select').addEventListener('change', (e) => { w.photoTag = e.target.value; });
    }
    if ($('photo-interval-select')) {
      $('photo-interval-select').addEventListener('change', (e) => {
        w.photoInterval = e.target.value ? parseInt(e.target.value) : null;
      });
    }
    if ($('photo-shuffle')) {
      $('photo-shuffle').addEventListener('change', (e) => { w.photoShuffle = e.target.checked; });
    }
    ['top','bottom','left','right'].forEach(edge => {
      const el = $(`pw-fade-${edge}`);
      if (el) el.addEventListener('input', (e) => {
        const key = 'fade' + edge.charAt(0).toUpperCase() + edge.slice(1);
        w[key] = parseInt(e.target.value);
        $(`pw-fade-${edge}-val`).textContent = e.target.value + 'px';
      });
    });
    if ((w.photoMode || 'all') === 'selected') loadPhotoPickGrid(w);
}

function drawWidgetSettingsPanel_Wire_text(_c) {
  const { w } = _c;
    if ($('text-content')) {
      $('text-content').addEventListener('input', (e) => { w.textContent = e.target.value; });
    }
    if ($('text-preset')) {
      $('text-preset').addEventListener('change', (e) => {
        w.textPreset = e.target.value;
        // Apply sensible defaults for the chosen preset, then let the user tweak.
        if (w.textPreset === 'heading') { w.textFontPx = 48; w.textWeight = 'bold'; }
        else if (w.textPreset === 'label') { w.textFontPx = 16; w.textWeight = '500'; }
        else { w.textFontPx = 28; w.textWeight = 'normal'; }
        drawWidgetSettingsPanel(); // refresh the size/weight controls to match
      });
    }
    if ($('text-font-range')) {
      $('text-font-range').addEventListener('input', (e) => {
        w.textFontPx = parseInt(e.target.value);
        $('text-font-val').textContent = w.textFontPx + 'px';
      });
    }
    if ($('text-font-family')) {
      const applySample = () => {
        const sample = $('text-font-sample');
        if (sample) sample.style.fontFamily = cssFontStack(w.textFontFamily || 'Inter');
      };
      ensureWebFont(w.textFontFamily || 'Inter');
      applySample();
      $('text-font-family').addEventListener('change', (e) => {
        w.textFontFamily = e.target.value;
        ensureWebFont(w.textFontFamily);
        applySample();
      });
    }
    if ($('text-weight')) {
      $('text-weight').addEventListener('change', (e) => { w.textWeight = e.target.value; });
    }
    if ($('text-align')) {
      $('text-align').addEventListener('change', (e) => { w.textAlign = e.target.value; });
    }
}

function drawWidgetSettingsPanel_Wire_decoration(_c) {
  const { w } = _c;
    document.querySelectorAll('.decor-quickpick').forEach(btn => {
      btn.addEventListener('click', () => {
        w.decorEmoji = btn.dataset.emoji;
        autoSaveLayout(); // same missing-save class of bug found across this whole panel
        drawWidgetSettingsPanel(); // refresh so the picked button highlights and the text input updates
      });
    });
    if ($('decor-emoji-input')) {
      $('decor-emoji-input').addEventListener('input', (e) => { w.decorEmoji = e.target.value; });
    }
    if ($('decor-font-range')) {
      $('decor-font-range').addEventListener('input', (e) => {
        w.decorFontPx = parseInt(e.target.value);
        $('decor-font-val').textContent = w.decorFontPx + 'px';
      });
    }
    if ($('decor-opacity-range')) {
      $('decor-opacity-range').addEventListener('input', (e) => {
        w.decorOpacity = parseInt(e.target.value);
        $('decor-opacity-val').textContent = w.decorOpacity + '%';
      });
    }
    if ($('decor-rotation-range')) {
      $('decor-rotation-range').addEventListener('input', (e) => {
        w.decorRotation = parseInt(e.target.value);
        $('decor-rotation-val').textContent = w.decorRotation + '°';
      });
    }
}

function drawWidgetSettingsPanel_Wire_smarthomeDashboard(_c) {
  const { w } = _c;
    if ($('ha-dash-picker-btn')) {
      $('ha-dash-picker-btn').addEventListener('click', () => openEntityPickerMulti(w));
    }
    if ($('ha-dash-combo-add-btn')) {
      $('ha-dash-combo-add-btn').addEventListener('click', () => {
        if (!Array.isArray(w.haComboGroups)) w.haComboGroups = [];
        const combo = { id: 'combo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), name: 'New Group', entityIds: [], areaIds: [] };
        w.haComboGroups.push(combo);
        autoSaveLayout();
        openComboGroupPicker(w, combo);
      });
    }
    document.querySelectorAll('.ha-dash-combo-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const combo = w.haComboGroups.find(c => c.id === btn.dataset.id);
        if (combo) openComboGroupPicker(w, combo);
      });
    });
    document.querySelectorAll('.ha-dash-combo-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = w.haComboGroups.findIndex(c => c.id === btn.dataset.id);
        if (idx >= 0) {
          w.haComboGroups.splice(idx, 1);
          autoSaveLayout();
          drawWidgetSettingsPanel();
        }
      });
    });
    document.querySelectorAll('.ha-dash-room-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const i = parseInt(e.target.dataset.index);
        if (w.haEntityIds[i]) { w.haEntityIds[i].room = e.target.value; autoSaveLayout(); }
      });
    });
    document.querySelectorAll('.ha-dash-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.index);
        if (i >= 0 && i < w.haEntityIds.length) {
          w.haEntityIds.splice(i, 1);
          autoSaveLayout();
          drawWidgetSettingsPanel(); // refresh so the list/indices and count all stay correct
        }
      });
    });
    document.querySelectorAll('.ha-dash-area-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.index);
        if (i >= 0 && i < w.haAreaIds.length) {
          w.haAreaIds.splice(i, 1);
          autoSaveLayout();
          drawWidgetSettingsPanel();
        }
      });
    });
    if ($('ha-dash-group-toggle')) {
      $('ha-dash-group-toggle').addEventListener('change', (e) => { w.haGroupByRoom = e.target.checked; autoSaveLayout(); });
    }
    if ($('ha-dash-view-select')) {
      $('ha-dash-view-select').addEventListener('change', (e) => { w.haDashView = e.target.value; autoSaveLayout(); });
    }
    if ($('ha-dash-title-input')) {
      $('ha-dash-title-input').addEventListener('input', (e) => { w.haDashTitle = e.target.value; });
    }
    if ($('ha-dash-font-range')) {
      $('ha-dash-font-range').addEventListener('input', (e) => {
        w.haDashFontPx = parseInt(e.target.value);
        $('ha-dash-font-val').textContent = w.haDashFontPx + 'px';
      });
    }
}

function drawWidgetSettingsPanel_Wire_groupcontrol(_c) {
  const { w } = _c;
    if ($('ha-group-picker-btn')) {
      $('ha-group-picker-btn').addEventListener('click', () => openGroupEntityPicker(w));
    }
    document.querySelectorAll('.ha-group-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.index);
        if (i >= 0 && i < w.gcEntityIds.length) {
          w.gcEntityIds.splice(i, 1);
          autoSaveLayout();
          drawWidgetSettingsPanel();
        }
      });
    });
    document.querySelectorAll('.ha-group-area-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.index);
        if (i >= 0 && i < w.gcAreaIds.length) {
          w.gcAreaIds.splice(i, 1);
          autoSaveLayout();
          drawWidgetSettingsPanel();
        }
      });
    });
    if ($('ha-group-title-input')) {
      $('ha-group-title-input').addEventListener('input', (e) => { w.gcTitle = e.target.value; });
    }
    if ($('ha-group-font-range')) {
      $('ha-group-font-range').addEventListener('input', (e) => {
        w.gcFontPx = parseInt(e.target.value);
        $('ha-group-font-val').textContent = w.gcFontPx + 'px';
      });
    }
}
