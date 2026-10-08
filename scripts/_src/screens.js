'use strict';
// Screens manager: the list of screens, per-screen settings, assigning a profile, a screen checking in / fetching its config, forgetting a screen and deleting a profile.
// Moved out of server.js (part of the split, see TODO.md). Behavior is unchanged: the code runs at the same point in server.js as before (route
// order matters in Express), and everything it uses comes in through the one object below. Covered by test/api/screens-displays.test.js.
module.exports = function registerScreens({ getReachableAddresses, app, PORT, IS_DEMO, db, broadcastUpdate, sendScreenCommand, SCREEN_ONLINE_MS, DEVICE_ID, getSetting, isSlave, resolveDisplay, previewScreenName, updateSetting }) {
  // Physical Pi screens register themselves (see /api/live and /api/screen-config).
  // The app lists them, names them, and assigns each a display profile — switching
  // it live over SSE.

  // List all known screens with online status and resolved profile name.
  app.get('/api/screens', (req, res) => {
    const now = Date.now();
    const rows = db.prepare(`SELECT * FROM screens ORDER BY created_at ASC`).all();
    const screens = rows.map(s => {
      const disp = s.assigned_display_slug ? resolveDisplay(s.assigned_display_slug) : null;
      return {
        device_id: s.device_id,
        name: s.name || '',
        assigned_display_slug: s.assigned_display_slug || '',
        assigned_display_name: disp ? disp.name : '',
        info_corner: s.info_corner || '',
        // Per-screen overrides — must be included here or the app's dropdowns can never
        // reflect a saved value and will always fall back to their defaults on redraw.
        screen_orientation: s.screen_orientation || '',
        screen_rotation: (s.screen_rotation === null || s.screen_rotation === undefined) ? -1 : s.screen_rotation,
        screensaver_tag: s.screensaver_tag || '',
        screensaver_photo_id: s.screensaver_photo_id || null,
        ambient_clock_corner: s.ambient_clock_corner || 'bl',
        ambient_photo_fit: s.ambient_photo_fit || 'cover',
        ambient_fade_transition: s.ambient_fade_transition !== '0',
        ambient_photo_interval: s.ambient_photo_interval || '',
        ambient_blur_bg: s.ambient_blur_bg !== '0',
        ambient_fade_duration: s.ambient_fade_duration || '2',
        fx_scale: s.fx_scale || '1',
        fx_density: s.fx_density || '1',
        tv_control_type: s.tv_control_type || '',
        tv_ip: s.tv_ip || '',
        tv_paired: !!s.tv_samsung_token,
        tv_schedule_slots: db.prepare(`SELECT id, time, action FROM tv_schedule_slots WHERE device_id = ? ORDER BY time`).all(s.device_id),
        ambient_mode: s.ambient_mode || '',
        screen_version: s.screen_version || '',
        floating_switcher_enabled: !!s.floating_switcher_enabled,
        floating_switcher_presets: (() => { try { return JSON.parse(s.floating_switcher_presets || '[]'); } catch { return []; } })(),
        floating_switcher_schedule: (() => { try { return JSON.parse(s.floating_switcher_schedule || '[]'); } catch { return []; } })(),
        floating_switcher_edge: s.floating_switcher_edge || 'bottom',
        floating_switcher_icon: s.floating_switcher_icon || '🔀',
        floating_switcher_color: s.floating_switcher_color || '#0a0e1a',
        floating_switcher_style: s.floating_switcher_style || 'circles',
        floating_switcher_bar_mode: s.floating_switcher_bar_mode || 'icons',
        floating_switcher_reveal: s.floating_switcher_reveal || 'always',
        alert_banner_position: s.alert_banner_position || 'top',
        alert_banner_size: s.alert_banner_size || 'm',
        alert_banner_style: s.alert_banner_style || 'solid',
        online: (now - (s.last_seen || 0)) < SCREEN_ONLINE_MS,
        last_seen: s.last_seen || 0,
        is_remote: !!s.is_remote,
        // Self-reported by a slave during its own check-in (see
        // /api/screen-checkin) — never set for the host's own local screen,
        // since that check-in never has a meaningful "address" to report
        // (it's this same process talking to itself). Captured a while ago
        // but never actually shown anywhere; real feedback (#32) asked for
        // exactly this kind of "which physical box is this" identifier.
        remote_addr: s.remote_addr || '',
      };
    });
    res.json(screens);
  });

  // Rename a screen (also used to set its name the first time).
  app.put('/api/screens/:deviceId', (req, res) => {
    const { name, info_corner, screen_orientation, screen_rotation, screensaver_tag, screensaver_photo_id, ambient_mode, ambient_clock_corner, ambient_photo_fit, ambient_fade_transition, ambient_fade_duration, ambient_photo_interval, ambient_blur_bg, fx_scale, fx_density, tv_control_type, tv_ip, floating_switcher_enabled, floating_switcher_presets, floating_switcher_schedule, floating_switcher_edge, floating_switcher_icon, floating_switcher_color, floating_switcher_style, floating_switcher_bar_mode, floating_switcher_reveal, alert_banner_position, alert_banner_size, alert_banner_style } = req.body;
    const existing = db.prepare(`SELECT device_id FROM screens WHERE device_id = ?`).get(req.params.deviceId);
    if (!existing) return res.status(404).json({ error: 'Screen not found' });
    if (name !== undefined) {
      db.prepare(`UPDATE screens SET name = ? WHERE device_id = ?`).run(String(name).trim(), req.params.deviceId);
    }
    if (info_corner !== undefined) {
      const valid = ['', 'tl', 'tr', 'bl', 'br'];
      const corner = valid.includes(info_corner) ? info_corner : '';
      db.prepare(`UPDATE screens SET info_corner = ? WHERE device_id = ?`).run(corner, req.params.deviceId);
      // Push the change live so the overlay appears/moves without a reload.
      sendScreenCommand(req.params.deviceId, 'set-info-corner', { corner });
    }
    let orientationChanged = false;
    if (screen_orientation !== undefined) {
      const valid = ['', 'auto', 'landscape', 'portrait'];
      const o = valid.includes(screen_orientation) ? screen_orientation : '';
      db.prepare(`UPDATE screens SET screen_orientation = ? WHERE device_id = ?`).run(o, req.params.deviceId);
      orientationChanged = true;
    }
    if (screen_rotation !== undefined) {
      const valid = [-1, 0, 90, 180, 270];
      const r = valid.includes(Number(screen_rotation)) ? Number(screen_rotation) : -1;
      db.prepare(`UPDATE screens SET screen_rotation = ? WHERE device_id = ?`).run(r, req.params.deviceId);
      orientationChanged = true;
    }
    let screensaverChanged = false;
    if (screensaver_tag !== undefined) {
      db.prepare(`UPDATE screens SET screensaver_tag = ? WHERE device_id = ?`)
        .run(String(screensaver_tag || '').trim(), req.params.deviceId);
      screensaverChanged = true;
    }
    if (screensaver_photo_id !== undefined) {
      // Empty/null = go back to tag-based slideshow. Set = show just this one photo.
      const pid = (screensaver_photo_id === '' || screensaver_photo_id === null) ? null : Number(screensaver_photo_id);
      db.prepare(`UPDATE screens SET screensaver_photo_id = ? WHERE device_id = ?`).run(pid, req.params.deviceId);
      screensaverChanged = true;
    }
    if (ambient_mode !== undefined) {
      const valid = ['', 'photo', 'photo_datetime'];
      const m = valid.includes(ambient_mode) ? ambient_mode : '';
      db.prepare(`UPDATE screens SET ambient_mode = ? WHERE device_id = ?`).run(m, req.params.deviceId);
      // Instant, no reload needed — same lightweight live-command pattern as the
      // info-corner toggle above, since this is meant to be flipped casually
      // (e.g. "photo mode for tonight") without the display blinking through a
      // full page reload each time.
      sendScreenCommand(req.params.deviceId, 'set-ambient-mode', { mode: m });
    }
    if (ambient_clock_corner !== undefined) {
      const valid = ['tl', 'tr', 'bl', 'br'];
      const c = valid.includes(ambient_clock_corner) ? ambient_clock_corner : 'bl';
      db.prepare(`UPDATE screens SET ambient_clock_corner = ? WHERE device_id = ?`).run(c, req.params.deviceId);
      // Live-rebuilds the ambient layout if it's currently showing (see the
      // refresh-photos handler on the display side, reused here rather than
      // adding a near-identical third command for this one setting).
      sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    }
    if (ambient_photo_fit !== undefined) {
      const valid = ['cover', 'width', 'height', 'auto'];
      const f = valid.includes(ambient_photo_fit) ? ambient_photo_fit : 'cover';
      db.prepare(`UPDATE screens SET ambient_photo_fit = ? WHERE device_id = ?`).run(f, req.params.deviceId);
      sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    }
    if (ambient_fade_transition !== undefined) {
      db.prepare(`UPDATE screens SET ambient_fade_transition = ? WHERE device_id = ?`)
        .run(ambient_fade_transition ? '1' : '0', req.params.deviceId);
      sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    }
    if (ambient_fade_duration !== undefined) {
      const d = parseFloat(ambient_fade_duration);
      if (!isNaN(d) && d >= 0.5 && d <= 10) {
        db.prepare(`UPDATE screens SET ambient_fade_duration = ? WHERE device_id = ?`).run(String(d), req.params.deviceId);
        sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
      }
    }
    if (ambient_photo_interval !== undefined) {
      const iv = String(ambient_photo_interval || '').trim();
      if (iv === '' || /^\d+$/.test(iv)) {
        db.prepare(`UPDATE screens SET ambient_photo_interval = ? WHERE device_id = ?`).run(iv, req.params.deviceId);
        sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
      }
    }
    if (ambient_blur_bg !== undefined) {
      db.prepare(`UPDATE screens SET ambient_blur_bg = ? WHERE device_id = ?`)
        .run(ambient_blur_bg ? '1' : '0', req.params.deviceId);
      sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    }
    if (fx_scale !== undefined) {
      const f = parseFloat(fx_scale);
      if (!isNaN(f) && f >= 0.5 && f <= 3) {
        db.prepare(`UPDATE screens SET fx_scale = ? WHERE device_id = ?`).run(String(f), req.params.deviceId);
        broadcastUpdate('displays'); // triggers applyTheme() live on that screen, no full reload needed
      }
    }
    if (fx_density !== undefined) {
      const f = parseFloat(fx_density);
      if (!isNaN(f) && f >= 0 && f <= 3) {
        db.prepare(`UPDATE screens SET fx_density = ? WHERE device_id = ?`).run(String(f), req.params.deviceId);
        broadcastUpdate('displays');
      }
    }
    if (tv_control_type !== undefined) {
      const valid = ['', 'cec', 'hdmi-signal', 'roku', 'samsung'];
      const t = valid.includes(tv_control_type) ? tv_control_type : '';
      // Changing away from Samsung (or clearing control entirely) invalidates any
      // stored pairing token — it's meaningless for anything else.
      if (t !== 'samsung') {
        db.prepare(`UPDATE screens SET tv_control_type = ?, tv_samsung_token = '' WHERE device_id = ?`).run(t, req.params.deviceId);
      } else {
        db.prepare(`UPDATE screens SET tv_control_type = ? WHERE device_id = ?`).run(t, req.params.deviceId);
      }
    }
    if (tv_ip !== undefined) {
      // A changed IP means a different (or freshly-reset) device — the old
      // Samsung pairing token, if any, would be for whatever was at the old
      // address and needs to be re-paired.
      db.prepare(`UPDATE screens SET tv_ip = ?, tv_samsung_token = '' WHERE device_id = ?`)
        .run(String(tv_ip || '').trim(), req.params.deviceId);
    }
    // Orientation/rotation are read at page load, so reload the screen to apply them.
    if (orientationChanged) sendScreenCommand(req.params.deviceId, 'reload', {});
    // The screensaver filter is read live from cached state, so a lighter refresh works.
    if (screensaverChanged) sendScreenCommand(req.params.deviceId, 'refresh-photos', {});
    if (floating_switcher_enabled !== undefined) {
      db.prepare(`UPDATE screens SET floating_switcher_enabled = ? WHERE device_id = ?`)
        .run(floating_switcher_enabled ? 1 : 0, req.params.deviceId);
    }
    if (floating_switcher_presets !== undefined) {
      // Accepts either shape: a bare number/numeric-string (legacy — always
      // meant a saved_layout id, kept working for anything already saved
      // during the beta before this expansion) or the newer
      // {type:'saved'|'display', id, icon} object (id is a saved_layout id
      // for 'saved', a display slug for 'display'; icon is an optional
      // per-target emoji/character the person picked, capped defensively the
      // same way the old single floating_switcher_icon field was). Never
      // trust the client's own 'type' framing without re-validating the
      // shape of 'id' matches it.
      const sanitizeIcon = (icon) => (typeof icon === 'string' && icon.trim()) ? icon.trim().slice(0, 8) : '';
      const targets = Array.isArray(floating_switcher_presets) ? floating_switcher_presets.map(t => {
        if (typeof t === 'number' || (typeof t === 'string' && /^\d+$/.test(t))) return { type: 'saved', id: Number(t) };
        if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id), icon: sanitizeIcon(t.icon) };
        if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id, icon: sanitizeIcon(t.icon) };
        return null;
      }).filter(Boolean) : [];
      db.prepare(`UPDATE screens SET floating_switcher_presets = ? WHERE device_id = ?`)
        .run(JSON.stringify(targets), req.params.deviceId);
    }
    if (floating_switcher_schedule !== undefined) {
      // Each rule's ACTIVE mode is ONE OF: 'time' (needs time), 'interval'
      // (needs intervalValue/intervalUnit + target), or 'rotation' (needs
      // intervalValue/intervalUnit + targets, 2+). mode defaults to 'time'
      // for anything saved before 'interval'/'rotation' existed — those rows
      // have no mode field at all, and should keep meaning exactly what
      // they always meant.
      //
      // Every other field a rule might ALSO be carrying (from a mode it was
      // in before, but currently isn't) is preserved here if it's present
      // and independently valid, not discarded just because it isn't the
      // active mode's own field. Found from a real, reproducible incident,
      // not a hypothetical: the previous version of this validation only
      // ever returned the active mode's own fields — so switching a
      // rotation rule to "At a time" and saving permanently discarded its
      // targets array server-side; the client's own in-memory state still
      // remembered it until the next re-fetch, at which point switching
      // back to Rotate only recovered a single carried-forward target, not
      // the original list, looking exactly like "my settings didn't save."
      // Reuses the exact same target validation as floating_switcher_presets
      // above — a schedule rule's target follows the identical shape rules.
      const validTarget = (t) => {
        if (t && t.type === 'saved' && Number.isInteger(Number(t.id))) return { type: 'saved', id: Number(t.id) };
        if (t && t.type === 'display' && typeof t.id === 'string' && t.id) return { type: 'display', id: t.id };
        return null;
      };
      // Shared by both interval and rotation modes — same clamp-up-to-floor
      // reasoning either way (see interval's own inline comment below for
      // the full rationale): the check loop can't fire more precisely than
      // every 5s regardless of what shorter value was configured, so losing
      // an entire rule over too-fast a number would be a confusing surprise
      // rather than a helpful validation.
      const clampInterval = (value, unit) => {
        const msPerUnit = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
        const ms = Math.max(value * msPerUnit, 5000);
        return ms / msPerUnit;
      };
      const rules = Array.isArray(floating_switcher_schedule) ? floating_switcher_schedule.map(r => {
        if (!r) return null;
        const days = Array.isArray(r.daysOfWeek) ? [...new Set(r.daysOfWeek.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
        if (!days.length) return null;
        const mode = ['interval', 'rotation'].includes(r.mode) ? r.mode : 'time';
        // Every field validated independently of which mode is currently
        // active — carried through whenever it's present and valid, so a
        // mode this rule isn't in right now doesn't lose its own data.
        const target = validTarget(r.target); // null if absent/invalid — fine for dormant preservation, required only if this IS the active single-target mode
        const targets = Array.isArray(r.targets) ? r.targets.map(validTarget).filter(Boolean) : [];
        const time = (typeof r.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) ? r.time : null;
        const intervalValueRaw = Number(r.intervalValue);
        const hasValidInterval = Number.isFinite(intervalValueRaw) && intervalValueRaw > 0;
        const intervalUnit = ['seconds', 'minutes', 'hours'].includes(r.intervalUnit) ? r.intervalUnit : 'minutes';
        const intervalValue = hasValidInterval ? clampInterval(intervalValueRaw, intervalUnit) : null;
        // The active mode's own requirement is what can reject the WHOLE
        // rule — everything else above is preserved if valid, regardless.
        if (mode === 'rotation' && targets.length < 2) return null; // need at least 2 distinct, valid targets to rotate between at all
        if (mode === 'rotation' && !hasValidInterval) return null;
        if (mode === 'interval' && (!target || !hasValidInterval)) return null;
        if (mode === 'time' && (!target || !time)) return null;
        const out = { mode, daysOfWeek: days };
        if (target) out.target = target;
        if (targets.length) out.targets = targets;
        if (time) out.time = time;
        if (intervalValue !== null) { out.intervalValue = intervalValue; out.intervalUnit = intervalUnit; }
        // Explicit !== false, not a truthiness coercion — a rule with no
        // enabled field at all (anything saved before this feature existed)
        // should be treated as enabled, same as checkSchedules()'s own
        // client-side check does. Only writes the field at all when it's
        // actually false, keeping the common (enabled) case's stored shape
        // unchanged from before this feature existed.
        if (r.enabled === false) out.enabled = false;
        return out;
      }).filter(Boolean) : [];
      db.prepare(`UPDATE screens SET floating_switcher_schedule = ? WHERE device_id = ?`)
        .run(JSON.stringify(rules), req.params.deviceId);
    }
    if (floating_switcher_edge !== undefined) {
      const edge = ['top', 'bottom', 'left', 'right'].includes(floating_switcher_edge) ? floating_switcher_edge : 'bottom';
      db.prepare(`UPDATE screens SET floating_switcher_edge = ? WHERE device_id = ?`).run(edge, req.params.deviceId);
    }
    if (floating_switcher_icon !== undefined) {
      // A single emoji/character is the intent, but this doesn't strictly
      // enforce single-grapheme — just caps length defensively (an emoji
      // with modifiers/ZWJ sequences can be several UTF-16 code units) so an
      // unexpectedly long string can't get stored here.
      const icon = (typeof floating_switcher_icon === 'string' && floating_switcher_icon.trim()) ? floating_switcher_icon.trim().slice(0, 8) : '🔀';
      db.prepare(`UPDATE screens SET floating_switcher_icon = ? WHERE device_id = ?`).run(icon, req.params.deviceId);
    }
    if (floating_switcher_color !== undefined) {
      const color = (typeof floating_switcher_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(floating_switcher_color)) ? floating_switcher_color : '#0a0e1a';
      db.prepare(`UPDATE screens SET floating_switcher_color = ? WHERE device_id = ?`).run(color, req.params.deviceId);
    }
    if (floating_switcher_style !== undefined) {
      const style = ['circles', 'bar'].includes(floating_switcher_style) ? floating_switcher_style : 'circles';
      db.prepare(`UPDATE screens SET floating_switcher_style = ? WHERE device_id = ?`).run(style, req.params.deviceId);
    }
    if (floating_switcher_bar_mode !== undefined) {
      const barMode = ['icons', 'names'].includes(floating_switcher_bar_mode) ? floating_switcher_bar_mode : 'icons';
      db.prepare(`UPDATE screens SET floating_switcher_bar_mode = ? WHERE device_id = ?`).run(barMode, req.params.deviceId);
    }
    if (floating_switcher_reveal !== undefined) {
      const reveal = ['always', 'tap'].includes(floating_switcher_reveal) ? floating_switcher_reveal : 'always';
      db.prepare(`UPDATE screens SET floating_switcher_reveal = ? WHERE device_id = ?`).run(reveal, req.params.deviceId);
    }
    if (floating_switcher_enabled !== undefined || floating_switcher_presets !== undefined || floating_switcher_schedule !== undefined || floating_switcher_edge !== undefined || floating_switcher_icon !== undefined || floating_switcher_color !== undefined || floating_switcher_style !== undefined || floating_switcher_bar_mode !== undefined || floating_switcher_reveal !== undefined) {
      // Instant show/hide/reconfigure, no reload — same lightweight live-command
      // pattern as info_corner/ambient_mode above, since this is meant to be
      // toggled casually from the app while looking at the screen.
      sendScreenCommand(req.params.deviceId, 'refresh-floating-switcher', {});
    }
    if (alert_banner_position !== undefined) {
      const v = ['top', 'bottom', 'center'].includes(alert_banner_position) ? alert_banner_position : 'top';
      db.prepare(`UPDATE screens SET alert_banner_position = ? WHERE device_id = ?`).run(v, req.params.deviceId);
    }
    if (alert_banner_size !== undefined) {
      const v = ['s', 'm', 'l', 'xl', 'xxl'].includes(alert_banner_size) ? alert_banner_size : 'm';
      db.prepare(`UPDATE screens SET alert_banner_size = ? WHERE device_id = ?`).run(v, req.params.deviceId);
    }
    if (alert_banner_style !== undefined) {
      const v = ['solid', 'bar', 'toast', 'outline', 'amber', 'strong'].includes(alert_banner_style) ? alert_banner_style : 'solid';
      db.prepare(`UPDATE screens SET alert_banner_style = ? WHERE device_id = ?`).run(v, req.params.deviceId);
    }
    if (alert_banner_position !== undefined || alert_banner_size !== undefined || alert_banner_style !== undefined) {
      sendScreenCommand(req.params.deviceId, 'refresh-alert-banner', {});
    }
    broadcastUpdate('screens');
    res.json({ ok: true });
  });

  // Assign a display profile to a screen and switch it live. The assignment is
  // remembered (survives reboot); the live command makes the change immediate.
  app.post('/api/screens/:deviceId/assign', (req, res) => {
    const { display, selfInitiated } = req.body; // a display slug, or '' for the default
    const existing = db.prepare(`SELECT device_id FROM screens WHERE device_id = ?`).get(req.params.deviceId);
    if (!existing) return res.status(404).json({ error: 'Screen not found' });

    let slug = '';
    if (display) {
      const disp = resolveDisplay(display);
      if (!disp) return res.status(404).json({ error: 'Display profile not found' });
      slug = disp.slug;
    }
    db.prepare(`UPDATE screens SET assigned_display_slug = ? WHERE device_id = ?`).run(slug, req.params.deviceId);

    // Push the switch to the screen now (if it's connected) — UNLESS the
    // screen assigned itself (the Layout Switcher's own pointer-reassignment
    // persist step, see switchToLayoutTarget() in display.html). In that
    // case it's already showing the target's content live, applied locally
    // and instantly the moment it was tapped — pushing switch-profile back
    // to the same screen that just called this would only trigger a
    // redundant, visible reload of content it's already correctly
    // displaying. Screens management's normal usage (reassigning some OTHER
    // screen from the app) never sends this flag and gets the exact same
    // push-and-reload behavior as before.
    const delivered = selfInitiated ? false : sendScreenCommand(req.params.deviceId, 'switch-profile', { display: slug });
    broadcastUpdate('screens');
    res.json({ ok: true, delivered });
  });

  // Forget a screen (e.g. a Pi that's gone). It will re-register if it reconnects.
  app.delete('/api/screens/:deviceId', (req, res) => {
    db.prepare(`DELETE FROM screens WHERE device_id = ?`).run(req.params.deviceId);
    broadcastUpdate('screens');
    res.json({ ok: true });
  });

  // Called by a screen on boot to learn which profile it should show. Also registers
  // the screen if it's new and refreshes last_seen. Returns the assigned slug ('' =
  // default display).
  // Lightweight check-in: the display calls this on a timer as a backstop so a screen
  // stays "online" even if its SSE connection is briefly dropped or throttled (common
  // over remote/Tailscale or when a tab is backgrounded). Cheap and idempotent.
  app.post('/api/screen-checkin', (req, res) => {
    const screenId = req.query.screen ? String(req.query.screen) : (req.body && req.body.screen);
    if (!screenId) return res.json({ ok: false });
    const now = Date.now();
    // A slave registering with its host marks itself remote and may send a friendly
    // default name + its reachable address (so the host could reach back if needed).
    const isRemote = req.query.remote === '1' ? 1 : 0;
    const remoteAddr = req.query.addr ? String(req.query.addr).slice(0, 100) : '';
    const defaultName = req.query.name ? String(req.query.name).slice(0, 60) : '';
    const reportedVersion = req.query.version ? String(req.query.version).slice(0, 20) : '';

    const existing = db.prepare(`SELECT device_id, name FROM screens WHERE device_id = ?`).get(screenId);

    // Enforce the device limit for non-active (trial/lapsed/unlicensed) accounts —
    // only blocks registering a genuinely NEW screen; a screen that's already
    // registered can always keep checking in, so this can't retroactively lock
    // someone out of a screen they had before a limit ever applied to them.
    if (!existing) {
      try {
        const limitsRaw = updateSetting('limits_cache', '');
        const limits = limitsRaw ? JSON.parse(limitsRaw) : null;
        if (limits && typeof limits.maxDevices === 'number') {
          const currentCount = db.prepare(`SELECT COUNT(*) AS n FROM screens`).get().n;
          if (currentCount >= limits.maxDevices) {
            return res.status(403).json({
              ok: false,
              error: `This account is limited to ${limits.maxDevices} screen${limits.maxDevices === 1 ? '' : 's'}.`,
            });
          }
        }
      } catch { /* if the cache is missing/malformed, fail open rather than block a legitimate registration */ }
    }

    if (existing) {
      db.prepare(`UPDATE screens SET last_seen = ?, is_remote = ?, remote_addr = ?, screen_version = ? WHERE device_id = ?`)
        .run(now, isRemote, remoteAddr, reportedVersion, screenId);
      // For a REMOTE screen, the slave owns its own name — keep the host's copy in sync
      // when the slave sends a real name and it differs (fixes "Home" vs "Mirror" drift).
      if (isRemote && defaultName && defaultName !== existing.name) {
        db.prepare(`UPDATE screens SET name = ? WHERE device_id = ?`).run(defaultName, screenId);
        broadcastUpdate('screens');
      }
    } else {
      db.prepare(`INSERT INTO screens (device_id, name, last_seen, is_remote, remote_addr, screen_version) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(screenId, previewScreenName(screenId) || defaultName, now, isRemote, remoteAddr, reportedVersion);
      broadcastUpdate('screens');
    }
    // Physical resolution: only the device's OWN server should store its resolution
    // setting. A remote check-in must NOT overwrite the host's local display_res.
    const sw = parseInt(req.query.sw), sh = parseInt(req.query.sh);
    if (!isRemote && sw > 0 && sh > 0) {
      const upsert = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
      upsert.run('display_res_w', String(sw));
      upsert.run('display_res_h', String(sh));
    }
    // Return this screen's full per-screen config (not just the assigned profile) —
    // a remote slave's own local database otherwise never learns about ANY setting
    // changed via the app (ambient mode, screensaver source, TV control, corner,
    // orientation...) since this check-in is the only sync channel a slave has back
    // to the host. Previously only assigned_display_slug came back here, which
    // meant every other per-screen setting silently never reached a slave's own
    // local database at all — invisible during earlier testing because that mostly
    // exercised the host's own screen, where no cross-device sync is needed.
    const full = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(screenId);
    res.json({
      ok: true,
      assigned_display_slug: full ? (full.assigned_display_slug || '') : '',
      config: full ? {
        info_corner: full.info_corner || '',
        screen_orientation: full.screen_orientation || '',
        screen_rotation: (full.screen_rotation === null || full.screen_rotation === undefined) ? -1 : full.screen_rotation,
        screensaver_tag: full.screensaver_tag || '',
        screensaver_photo_id: full.screensaver_photo_id || null,
        ambient_mode: full.ambient_mode || '',
        ambient_clock_corner: full.ambient_clock_corner || 'bl',
        ambient_photo_fit: full.ambient_photo_fit || 'cover',
        tv_control_type: full.tv_control_type || '',
        tv_ip: full.tv_ip || '',
        tv_schedule_on: full.tv_schedule_on || '',
        tv_schedule_off: full.tv_schedule_off || '',
      } : null,
    });
  });

  // In demo mode every visitor's screen is fresh and unconfigured, so
  // synthesize a "flip between layouts" switcher from the seeded profiles —
  // this is the demo's layout picker. Returns null (no override) outside demo
  // or if there's only one profile. Icons are a best-effort per-template map.
  const DEMO_SWITCHER_ICONS = { 'home-hub': '🏠', 'summer-days': '☀️', 'aviation': '✈️', 'command-center': '🎛️', 'daily-digest': '📋', 'minimalist': '▫️', 'modern-dark': '🌙', 'photo-frame': '🖼️' };
  function demoSwitcherOverride() {
    if (!IS_DEMO) return null;
    const rows = db.prepare(`SELECT slug FROM displays ORDER BY sort_order ASC, id ASC`).all();
    if (rows.length < 2) return null;
    return {
      floating_switcher_enabled: true,
      floating_switcher_presets: rows.map(r => ({ type: 'display', id: r.slug, icon: DEMO_SWITCHER_ICONS[r.slug] || '🖥️' })),
      floating_switcher_schedule: [],
      floating_switcher_edge: 'bottom',
      floating_switcher_icon: '🔀',
      floating_switcher_color: '#0a0e1a',
      floating_switcher_style: 'bar',
      floating_switcher_bar_mode: 'names',
      floating_switcher_reveal: 'always',
    };
  }

  app.get('/api/screen-config', (req, res) => {
    const screenId = req.query.screen ? String(req.query.screen) : null;
    const addrs = getReachableAddresses();
    const port = PORT;
    // The canonical, server-persisted identity of THIS Pi. The display adopts this
    // so it stays the same screen across cache wipes, URL changes, and updates.
    const canonicalId = DEVICE_ID;
    // Real TV resolution (reported by the Pi) so previews can render at true size.
    const resRow = db.prepare(`SELECT key, value FROM settings WHERE key IN ('display_res_w','display_res_h')`).all();
    const resMap = Object.fromEntries(resRow.map(r => [r.key, r.value]));
    const displayRes = (resMap.display_res_w && resMap.display_res_h)
      ? { w: parseInt(resMap.display_res_w), h: parseInt(resMap.display_res_h) } : null;
    if (!screenId) {
      // Even without a screen param, a SLAVE has exactly one identity, so it can still
      // report the profile the host assigned it. (A host with multiple screens needs
      // the id to disambiguate, so it still returns empty here.)
      if (isSlave()) {
        let slug = getSetting('assigned_display_slug_remote') || '';
        return res.json({ assigned_display_slug: slug, addresses: addrs, port, canonicalId, displayRes, role: 'slave' });
      }
      return res.json({ assigned_display_slug: '', addresses: addrs, port, canonicalId, displayRes });
    }
    const now = Date.now();

    // (There used to be a "self-heal" sweep here that deleted unnamed local screen rows whenever this Pi's own display checked in. Its SQL was invalid, the error
    // was swallowed, and so it never actually ran. It is removed rather than repaired: switching it on would delete rows (a second browser pointed at this Pi
    // looks exactly like a stray) that no customer has ever had deleted. Stray unnamed rows are removed by hand from the Devices list.)

    const existing = db.prepare(`SELECT * FROM screens WHERE device_id = ?`).get(screenId);
    // On a SLAVE, the profile is assigned by the HOST (synced into this setting). It
    // overrides any local screens-table value so the host has full control.
    const remoteSlug = isSlave() ? (getSetting('assigned_display_slug_remote') || '') : null;
    if (existing) {
      db.prepare(`UPDATE screens SET last_seen = ? WHERE device_id = ?`).run(now, screenId);
      // If the assigned profile no longer exists, fall back to default — but on a SLAVE
      // keep the host's assigned slug even if its profile row hasn't synced yet (the
      // display will resolve it once the next data sync lands the profile).
      let slug = (remoteSlug !== null ? remoteSlug : (existing.assigned_display_slug || ''));
      if (slug && remoteSlug === null && !resolveDisplay(slug)) slug = '';
      // Demo: every visitor's browser is a fresh, unassigned screen — point it
      // at the sole seeded profile so widget edits have a slug to save against
      // (without this the display refuses every layout save as "no display
      // selected"). Harmless outside demo; only fills an otherwise-empty slug.
      if (IS_DEMO && !slug) { const d0 = db.prepare(`SELECT slug FROM displays ORDER BY sort_order ASC, id ASC LIMIT 1`).get(); if (d0) slug = d0.slug; }
      let switcherPresets = [];
      try { switcherPresets = JSON.parse(existing.floating_switcher_presets || '[]'); } catch {}
      let switcherSchedule = [];
      try { switcherSchedule = JSON.parse(existing.floating_switcher_schedule || '[]'); } catch {}
      res.json({ assigned_display_slug: slug, named: !!existing.name, info_corner: existing.info_corner || '', addresses: addrs, port, canonicalId, displayRes,
        floating_switcher_enabled: !!existing.floating_switcher_enabled, floating_switcher_presets: switcherPresets, floating_switcher_schedule: switcherSchedule,
        floating_switcher_edge: existing.floating_switcher_edge || 'bottom', floating_switcher_icon: existing.floating_switcher_icon || '🔀', floating_switcher_color: existing.floating_switcher_color || '#0a0e1a',
        floating_switcher_style: existing.floating_switcher_style || 'circles', floating_switcher_bar_mode: existing.floating_switcher_bar_mode || 'icons',
        floating_switcher_reveal: existing.floating_switcher_reveal || 'always',
        alert_banner_position: existing.alert_banner_position || 'top', alert_banner_size: existing.alert_banner_size || 'm', alert_banner_style: existing.alert_banner_style || 'solid',
        ...(demoSwitcherOverride() || {}) });
    } else {
      db.prepare(`INSERT INTO screens (device_id, name, last_seen) VALUES (?, ?, ?)`).run(screenId, previewScreenName(screenId), now);
      broadcastUpdate('screens');
      let slug = (remoteSlug !== null ? remoteSlug : '');
      if (slug && remoteSlug === null && !resolveDisplay(slug)) slug = '';
      if (IS_DEMO && !slug) { const d0 = db.prepare(`SELECT slug FROM displays ORDER BY sort_order ASC, id ASC LIMIT 1`).get(); if (d0) slug = d0.slug; }
      res.json({ assigned_display_slug: slug, named: false, info_corner: '', addresses: addrs, port, canonicalId, displayRes,
        floating_switcher_enabled: false, floating_switcher_presets: [], floating_switcher_schedule: [],
        floating_switcher_edge: 'bottom', floating_switcher_icon: '🔀', floating_switcher_color: '#0a0e1a',
        floating_switcher_style: 'circles', floating_switcher_bar_mode: 'icons', floating_switcher_reveal: 'always',
        alert_banner_position: 'top', alert_banner_size: 'm', alert_banner_style: 'solid',
        ...(demoSwitcherOverride() || {}) });
    }
  });

  app.delete('/api/displays/:id', (req, res) => {
    const count = db.prepare(`SELECT COUNT(*) as c FROM displays`).get().c;
    if (count <= 1) return res.status(400).json({ error: 'At least one display must exist' });
    const result = db.prepare(`DELETE FROM displays WHERE id = ?`).run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Display not found' });
    db.prepare(`DELETE FROM layouts WHERE display_id = ?`).run(req.params.id);
    broadcastUpdate('displays');
    res.json({ ok: true });
  });
};
