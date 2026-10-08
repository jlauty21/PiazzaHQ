// ── Formatting ────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function fmtTime(t) {
  if (!t) return 'All day';
  const [h, m] = t.split(':').map(Number);
  if (window.i18n && i18n.lang !== 'en') return `${pad(h)}:${pad(m)}`;   // 24-hour in other languages
  return `${h%12||12}:${pad(m)} ${h>=12?'pm':'am'}`;
}
function fmtDate(s) {
  const d = new Date(s + 'T00:00:00');
  if (window.i18n && i18n.lang !== 'en') return i18n.date(d, 'weekdayShort');   // the language's own order
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
let sessionToken = localStorage.getItem('pi_cal_token') || null;
// Incremented every time a NEW session is established (a fresh login, or
// setting a PIN and immediately authenticating with it — see the
// settings-save-btn handler below). apiFetch() snapshots this at request
// time and only acts on a 401 if no newer login has happened since that
// specific request was sent. Without this, a request already in flight
// when a PIN gets set (using the old, now-invalid, or entirely absent
// token) can resolve with a 401 AFTER a fresh, successful login and wipe
// out that brand-new valid session — confirmed as the real cause of a
// reported bug where setting a PIN for the first time led to repeated
// kick-out loops even after entering the correct PIN.
let authGeneration = 0;

async function apiFetch(path, opts={}) {
  const headers = { 'Content-Type': 'application/json' };
  const requestGeneration = authGeneration;
  if (sessionToken) headers['x-session-token'] = sessionToken;
  // For FormData (file upload) don't set Content-Type — let browser set it
  if (opts.body instanceof FormData) delete headers['Content-Type'];
  let res;
  try {
    res = await fetch(path, { ...opts, headers: {...headers, ...(opts.headers||{})} });
  } catch (e) {
    // A genuine network-level failure — the fetch itself never completed at
    // all (e.g. this device's connection dropped mid-request, or the
    // server is between an old process exiting and a new one binding the
    // port during a restart). Deliberately NOT treated as a 401 anymore:
    // "couldn't reach the server at all" and "the server explicitly
    // rejected this session" are different things, and conflating them
    // here was a real, confirmed bug — every self-update polls
    // /api/version in a tight loop while the server restarts (see
    // installUpdateFromBanner()), and that loop's own retry logic already
    // correctly treats a failed tick as "still restarting, try again."
    // But apiFetch() itself was ALSO calling showPinScreen() on every one
    // of those same transient failures, regardless of whether a PIN was
    // even configured — surfacing a PIN prompt during a completely normal
    // restart on a device that's never had a PIN set at all. A genuine
    // auth problem (session token invalid/expired) will still correctly
    // surface via the 401 branch below the moment the server is actually
    // reachable again — nothing here was relying on this branch also
    // showing the PIN screen (confirmed: no caller distinguishes
    // __networkError from a real 401 in its own follow-up logic, so this
    // was pure unwanted side effect, not depended-on behavior).
    return { __authFailed: true, __networkError: true };
  }
  if (res.status === 401) {
    // The remote sign-in session ended (expired, or signed out from another
    // device): go to the sign-in page. The PIN screen would be the wrong
    // thing to show — there is no PIN to enter for this.
    try {
      const b401 = await res.clone().json();
      if (b401 && b401.code === 'REMOTE_AUTH_REQUIRED') {
        window.location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
        return { __authFailed: true };
      }
    } catch (e) { /* not JSON — fall through to the normal PIN handling */ }
    if (requestGeneration === authGeneration) showPinScreen();
    // Marked distinctly from a genuinely empty successful response — see
    // init()'s own comment for why this distinction is the fix for a real
    // reported bug (a 401 here used to look identical to "this device has
    // never been set up," incorrectly launching the first-run wizard).
    return { __authFailed: true };
  }
  try {
    return await res.json();
  } catch (e) {
    // A non-401 response (500, etc.) whose body isn't valid JSON — a
    // genuinely different failure from either case above, handled the
    // same way rather than throwing all the way up to whatever called
    // apiFetch().
    return { __authFailed: false, __parseError: true };
  }
}

function showPinScreen() {
  sessionToken = null;
  localStorage.removeItem('pi_cal_token');
  $('pin-screen').style.display = 'flex';
  document.querySelector('.app').style.visibility = 'hidden';
  // Real, confirmed bug fixed here: the onboarding tour's overlay elements
  // (#tour-blocker/#tour-spotlight/#tour-callout) live OUTSIDE .app — so
  // the line above never hides them. At the time this was fixed,
  // #tour-blocker's z-index (997) was higher than the PIN screen's z-index
  // then (500), so an active/re-triggering tour could render ON TOP of the
  // PIN screen — which looked exactly like "the PIN screen flashed away"
  // even though it never actually closed underneath. #pin-screen's own
  // z-index has since been raised to 99999 (see its static HTML), well
  // above every other overlay in this file, so that specific conflict can
  // no longer recur on its own — but force-closing the tour here is kept
  // in place as harmless belt-and-suspenders, and because a stack of
  // overlays covering the whole screen is confusing regardless of which
  // one technically wins the z-index fight.
  ['tour-blocker', 'tour-spotlight', 'tour-callout'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  setTimeout(() => $('pin-input').focus(), 100);
}

function hidePinScreen() {
  $('pin-screen').style.display = 'none';
  document.querySelector('.app').style.visibility = 'visible';
}

async function checkAuth(isRetry = false, attempt = 0) {
  try {
    const res = await fetch('/api/auth/status', {
      headers: sessionToken ? { 'x-session-token': sessionToken } : {}
    });
    const data = await res.json();
    if (!data.pin_set || data.authenticated) {
      hidePinScreen();
      return true;
    }
    // A genuinely fresh/first-ever request right after a device boots can
    // transiently fail or return a stale/incomplete answer before the
    // server has fully settled — retrying once, after a short delay,
    // rather than committing to "a PIN is genuinely needed" on the very
    // first attempt catches that window instead of falsely showing the
    // PIN screen on a device that was never actually configured with one.
    // The server EXPLICITLY responded here and confirmed a PIN is required
    // and this session isn't authenticated — a real, legitimate signal,
    // unlike the network-error branch below.
    if (!isRetry) {
      await new Promise(r => setTimeout(r, 1200));
      return checkAuth(true, attempt + 1);
    }
    showPinScreen();
    return false;
  } catch (e) {
    // A network-level failure — couldn't reach the server AT ALL, not "the
    // server said no." Real, confirmed bug fixed here: this used to show
    // the PIN screen after exhausting retries here too, the same mistake
    // already fixed in apiFetch()'s own network-error handling — conflating
    // "couldn't reach the server" with "you need to log in." Now known to
    // matter well beyond initial boot: updates install fully automatically
    // in the background now (periodicUpdateCheck() on a timer, zero client
    // coordination — see server.js), so a page load/reload can land right
    // in the middle of one of those restarts at any time, not just once at
    // first boot. Retries a few times with the same 1.2s spacing (widened
    // from a single retry to better cover a real restart, which can take a
    // few seconds) before simply giving up WITHOUT showing the PIN screen —
    // a pure connectivity gap isn't evidence a PIN is needed, and the app's
    // own default state (visible, not hidden behind the PIN overlay) is a
    // far better failure mode than a login prompt nobody can answer
    // correctly on a PIN-less device. Whatever normal request eventually
    // succeeds once the server's back will surface a REAL 401 then, if one
    // is actually warranted.
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1200));
      return checkAuth(true, attempt + 1);
    }
    return false;
  }
}

// PIN submit
$('pin-submit').addEventListener('click', async () => {
  const pin = $('pin-input').value.trim();
  // Deliberately NOT bailing out here just because pin is empty — the
  // server already correctly handles this itself: it accepts ANY
  // submission (including empty) when no PIN is actually configured, and
  // only rejects a genuinely wrong one when a real PIN exists. A
  // client-side guard that silently refused to even try an empty
  // submission blocked the exact recovery path that should work if this
  // screen ever shows up when it shouldn't have (e.g. a boot-timing race
  // right after first flashing a device) — someone stuck here had no way
  // to just tap through, even though the server would have let them.
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  const data = await res.json();
  if (data.ok) {
    sessionToken = data.token;
    authGeneration++; // any request already in flight from before this point gets ignored on 401 — see apiFetch()'s own comment
    if (sessionToken) localStorage.setItem('pi_cal_token', sessionToken);
    hidePinScreen();
    // Re-render whichever tab is actually showing, not just Calendar — the
    // PIN screen can interrupt any tab, and only refreshing events left
    // Photos/Layout/Devices/Family Hub/Settings stale after logging back in.
    renderTab();
  } else {
    // Real bug fixed here: this used to always show a hardcoded "Incorrect
    // PIN — try again," even when the actual response was a 429 rate-limit
    // ("Too many attempts, try again in N minutes") — a real, distinct
    // server message that was being silently discarded. Someone genuinely
    // rate-limited (5 attempts/10min — easy to hit by accident during the
    // earlier kick-out-loop bug, which forced repeated re-entry) would see
    // "Incorrect PIN" on their CORRECT pin, with no indication they just
    // needed to wait rather than keep retrying — confirmed as a real,
    // separate contributor to a report that looked like a hard lockout.
    $('pin-error').textContent = (res.status === 429 && data.error) ? data.error : 'Incorrect PIN — try again';
    $('pin-input').value = '';
    $('pin-input').focus();
  }
});
$('pin-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('pin-submit').click(); });

// ── API ───────────────────────────────────────────────────────────────────────
async function loadEvents() {
  const from = todayStr();
  const to = (() => { const d = new Date(); d.setDate(d.getDate()+90); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; })();
  allEvents = await apiFetch(`/api/events?from=${from}&to=${to}`);
  renderTab();
}

// ── Color picker ──────────────────────────────────────────────────────────────
function buildColorPicker() {
  const cp = $('color-picker');
  cp.innerHTML = COLORS.map(c => `
    <div class="color-swatch${c===selectedColor?' selected':''}"
         style="background:${c}"
         data-color="${c}"></div>
  `).join('');
  cp.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      selectedColor = sw.dataset.color;
      buildColorPicker();
    });
  });
  const customInput = $('color-custom-input');
  if (customInput) {
    customInput.value = selectedColor;
    // Wired once (guarded, since buildColorPicker() itself re-runs on every
    // swatch click and modal open, but this native input isn't recreated —
    // it's the same persistent element each time, so re-attaching here would
    // stack duplicate listeners).
    if (!customInput._wired) {
      customInput._wired = true;
      customInput.addEventListener('input', (e) => { selectedColor = e.target.value; });
      // Refresh swatch highlighting once the picker closes (not on every
      // 'input' tick while dragging) — a genuinely custom color correctly
      // shows no swatch selected, matching the widget text color picker's
      // same input/change split elsewhere in this file.
      customInput.addEventListener('change', () => { buildColorPicker(); });
    }
  }
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(event = null) {
  editingId = event ? event.id : null;
  $('modal-title').textContent = event ? 'Edit Event' : 'New Event';
  $('f-title').value  = event?.title      || '';
  $('f-date').value   = event?.date       || todayStr();
  $('f-start').value  = event?.start_time || '';
  $('f-end').value    = event?.end_time   || '';
  $('f-notes').value  = event?.notes      || '';
  selectedColor       = event?.color      || COLORS[0];
  $('delete-btn').style.display = event ? 'block' : 'none';

  const isMultiDay = !!(event && event.end_date);
  $('f-multiday').checked = isMultiDay;
  $('f-enddate').value = event?.end_date || '';
  $('f-enddate-group').style.display = isMultiDay ? 'block' : 'none';
  $('f-time-group').style.display = isMultiDay ? 'none' : 'block';

  buildColorPicker();
  $('modal-overlay').classList.add('open');
  setTimeout(() => $('f-title').focus(), 100);
}

function closeModal() { $('modal-overlay').classList.remove('open'); }

// Global pull-to-refresh prevention. overscroll-behavior (set on .content,
// html/body, and the Editing Layout dropdown) contains the visual rubber-
// band bounce, but on iOS Safari that alone doesn't reliably stop the
// NATIVE pull-to-refresh/reload gesture underneath it — WebKit's actual
// support for overscroll-behavior blocking that specific browser behavior
// (as opposed to just the bounce animation) has been inconsistent across
// versions. Confirmed on real hardware: the bounce stayed contained inside
// the list, but the page still reloaded. This is the standard, more
// reliable fallback — intercept the raw touch directly and preventDefault()
// at the exact moment a pull-to-refresh gesture would begin: a downward
// drag while the nearest actually-scrollable ancestor of the touch (or the
// page itself, if there isn't one) is already at its topmost scroll
// position.
//
// A version of this briefly removed that document-level fallback entirely,
// worried it could preventDefault() over drag surfaces like the Layout
// Editor canvas (which uses touch-action:none for raw pointer control on
// its resize handles) — confirmed as a real regression the OTHER
// direction: it made the actual reported bug (pull-to-refresh triggering)
// noticeably easier to hit again, everywhere the fallback used to catch
// it. That worry turned out to be overstated: preventDefault() on a
// touchmove event suppresses the browser's own default action (scroll,
// pull-to-refresh) but does NOT stop pointermove events from firing —
// they're independent, so it was never actually going to interfere with
// this codebase's pointer-based widget dragging in the first place, and
// suppressing the page's own scroll WHILE a widget drag is in progress is
// exactly what you'd want anyway. Fallback restored. The one exclusion
// that IS genuinely worth keeping: the walk up the tree still backs off
// entirely — doing nothing at all, not even checking scrollTop — the
// moment it crosses any element explicitly marked touch-action:none,
// since that's this codebase's own deliberate signal that something needs
// completely unblocked, raw touch control (the resize handles specifically),
// and this guard should never second-guess that.
(function preventPullToRefresh() {
  let startX = 0, startY = 0, scroller = null;
  function findScrollableAncestor(el) {
    while (el && el !== document.body) {
      const style = getComputedStyle(el);
      if (style.touchAction === 'none') return null; // explicit "hands off" signal — never intervene
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return document.scrollingElement;
  }
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    // Resolved once here, not on every touchmove tick — the touched
    // element doesn't change meaningfully over the course of one drag, and
    // this walk (getComputedStyle up the tree) isn't worth repeating at
    // 60fps for the length of a long scroll.
    scroller = findScrollableAncestor(e.target);
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) return; // not a downward pull
    // CONFIRMED REGRESSION, fixed here: real-world touches are never
    // perfectly axis-aligned, so a horizontal swipe (the top tab bar in
    // particular, which scrolls horizontally by design when there are more
    // tabs than fit — see .tabs's own CSS comment) almost always has some
    // small incidental vertical component too. Checking dy in isolation
    // was enough to mistake that wobble for a downward pull and cancel the
    // touch entirely, silently breaking horizontal scrolling anywhere it
    // happened, tabs included. Requiring the vertical component to
    // genuinely DOMINATE the horizontal one is what a real pull-to-refresh
    // attempt actually looks like, and is enough to stop misfiring on a
    // gesture that's mostly sideways.
    if (Math.abs(dy) <= Math.abs(dx)) return;
    if (scroller && scroller.scrollTop <= 0) e.preventDefault();
  }, { passive: false });
})();

$('add-btn').addEventListener('click', () => openModal());
$('modal-close').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', e => { if (e.target === $('modal-overlay')) closeModal(); });

$('f-multiday').addEventListener('change', (e) => {
  const on = e.target.checked;
  $('f-enddate-group').style.display = on ? 'block' : 'none';
  $('f-time-group').style.display = on ? 'none' : 'block';
  if (on && !$('f-enddate').value) {
    // Default end date to the day after the start date
    const d = new Date(($('f-date').value || todayStr()) + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    $('f-enddate').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
});

$('save-btn').addEventListener('click', async () => {
  const title = $('f-title').value.trim();
  const date  = $('f-date').value;
  if (!title || !date) { showToast('Title and date are required'); return; }

  const isMultiDay = $('f-multiday').checked;
  if (isMultiDay && (!$('f-enddate').value || $('f-enddate').value <= date)) {
    showToast('End date must be after the start date');
    return;
  }

  const body = {
    title, date,
    end_date:   isMultiDay ? $('f-enddate').value : null,
    start_time: isMultiDay ? null : ($('f-start').value || null),
    end_time:   isMultiDay ? null : ($('f-end').value   || null),
    color:      selectedColor,
    notes:      $('f-notes').value.trim(),
  };

  if (editingId) {
    await apiFetch(`/api/events/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
    showToast('Event updated');
  } else {
    await apiFetch('/api/events', { method: 'POST', body: JSON.stringify(body) });
    showToast('Event added');
  }
  closeModal();
  loadEvents();
});

$('delete-btn').addEventListener('click', async () => {
  if (!confirm('Delete this event?')) return;
  await apiFetch(`/api/events/${editingId}`, { method: 'DELETE' });
  showToast('Event deleted');
  closeModal();
  loadEvents();
});

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Always start a freshly-switched tab with the header visible — without
    // this, switching tabs while the header happens to be scrolled-away
    // (only possible when the auto-hide preference is on) would leave it
    // hidden on the new tab too, which reads as broken rather than
    // intentional.
    const headerEl = document.getElementById('app-header');
    if (headerEl) headerEl.classList.remove('header-hidden');
    // Flush any pending debounced settings save BEFORE switching away — see
    // the comment on window._flushSettingsAutoSave for why this matters:
    // otherwise a save that fires later, after this tab's content has
    // already replaced Settings' own fields in the DOM, silently reverts
    // whatever was just changed instead of saving it.
    if (currentTab === 'settings' && tab.dataset.tab !== 'settings' && window._flushSettingsAutoSave) {
      window._flushSettingsAutoSave();
      window._flushSettingsAutoSave = null;
    }
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // Keep the chosen tab fully visible in the scrollable bar.
    tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    currentTab = tab.dataset.tab;
    // Clear this tab's notification dot now that the user has seen it — the next
    // periodic check will re-add it if the underlying condition is still true.
    if (currentTab === 'displays') { const d = document.getElementById('displays-tab-dot'); if (d) d.classList.remove('show'); }
    if (currentTab === 'settings') { const d = document.getElementById('settings-tab-dot'); if (d) d.classList.remove('show'); }
    renderTab();
  });
});

// Per-browser preference for whether the tab bar auto-hides on scroll — not
// synced across devices or to the wall display, since this is purely about
// how this one browser/instance of the control app behaves for whoever's
// using it here. Same localStorage-preference pattern already used above
// for things like lastEditedDisplay/lastEditedOrientation. Defaults to OFF
// (pinned) — the safer, less-surprising default for anyone who hasn't
// explicitly opted into the scroll-hide behavior.
function tabsAutohideEnabled() {
  try { return localStorage.getItem('tabs_autohide') === '1'; } catch { return false; }
}

// ── Hide the header on scroll-down, reveal on scroll-up (opt-in) ────────────
// #content is the actual scrolling element (overflow-y:auto), not window —
// each tab's render function fully replaces #content's innerHTML, which
// resets scrollTop to 0 on every tab switch, so lastScrollTop tracking here
// doesn't need its own reset logic tied to tab changes (the header-visible
// reset in the tab-click handler above handles the visual state; this just
// naturally starts fresh since there's nothing to have scrolled yet).
// Checks tabsAutohideEnabled() live on every scroll event, rather than only
// once at setup, so flipping the Settings toggle takes effect immediately —
// no reload needed, and no separate attach/detach wiring to keep in sync
// with the checkbox.
(function () {
  const header = document.getElementById('app-header');
  const scrollEl = document.getElementById('content');
  if (!header || !scrollEl) return;
  let lastScrollTop = 0;
  const JITTER_THRESHOLD = 8;  // ignore tiny/inertial scroll noise, react to real intent
  const TOP_BUFFER = 40;       // don't hide while still near the very top of the content
  // Hiding/showing the header resizes the sibling #content element as it
  // animates (grid-template-rows transitioning) — that's what lets tabs
  // actually reclaim the space rather than just fading in place. That
  // resize can itself nudge scrollTop mid-transition, firing a NEW scroll
  // event that re-triggers this listener and flips the header right back —
  // a feedback loop between the header's own transition and this listener,
  // not genuine new scroll intent. ignoreScrollUntil silences the listener
  // for the transition's duration (300ms, +50ms buffer) whenever WE cause
  // the toggle, breaking that loop at its source. Only guards a toggle that
  // actually changes state — re-arming an already-matching state has no
  // transition to run, so nothing to guard against.
  let ignoreScrollUntil = 0;
  function setHeaderHidden(hide) {
    if (header.classList.contains('header-hidden') === hide) return;
    header.classList.toggle('header-hidden', hide);
    ignoreScrollUntil = Date.now() + 350;
  }
  scrollEl.addEventListener('scroll', () => {
    if (Date.now() < ignoreScrollUntil) return;
    // Clamping matters here too: iOS's elastic overscroll can briefly
    // report a scrollTop beyond the real scrollable range (past the
    // bottom, or below 0 at the top) while it rubber-bands back into
    // place. Without this, that bounce reads as genuine scroll movement
    // and flips the header's state the same way the transition feedback
    // above did.
    const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
    const st = Math.max(0, Math.min(scrollEl.scrollTop, maxScroll));
    if (!tabsAutohideEnabled()) {
      // Preference is off (pinned) — make sure nothing's left hidden from
      // before the person switched the setting mid-scroll, then bail.
      setHeaderHidden(false);
      lastScrollTop = st;
      return;
    }
    if (Math.abs(st - lastScrollTop) < JITTER_THRESHOLD) return;
    setHeaderHidden(st > lastScrollTop && st > TOP_BUFFER);
    lastScrollTop = st;
  }, { passive: true });
})();

// Per-browser preference for whether pull-to-refresh is enabled at all — same
// localStorage pattern as tabs_autohide above. Defaults to OFF: unlike the
// tab-autohide preference, an accidental pull-triggered reload is more
// disruptive (loses in-progress state, however briefly) than a header
// staying visible, so this stays opt-in rather than on by default.
function pullRefreshEnabled() {
  try { return localStorage.getItem('pull_refresh_enabled') === '1'; } catch { return false; }
}

// ── Pull-to-refresh (for standalone/home-screen mode, opt-in) ────────────────
// iOS Safari's native pull-to-refresh gesture doesn't exist at all once the
// app is added to the home screen and running full-screen (standalone
// display mode strips out browser chrome entirely, and that gesture lives in
// the chrome, not the page) — so there's normally no way to force-refresh
// short of fully closing and reopening the app. This rebuilds the same
// gesture manually against #content, the actual scrolling element.
(function () {
  const scrollEl = document.getElementById('content');
  if (!scrollEl) return;
  const PULL_THRESHOLD = 70;  // px pulled before releasing triggers a refresh
  const MAX_PULL = 100;       // visual cap so the indicator doesn't grow without bound
  let startY = null, pulling = false;

  const indicator = document.createElement('div');
  indicator.id = 'pull-refresh-indicator';
  indicator.style.cssText = `
    position:fixed; top:0; left:0; right:0; z-index:500; pointer-events:none;
    display:flex; align-items:center; justify-content:center; height:0; overflow:hidden;
    color:var(--muted); font-size:13px; font-weight:600; background:var(--bg);
  `;
  indicator.textContent = '↓ Pull to refresh';
  document.body.appendChild(indicator);

  scrollEl.addEventListener('touchstart', (e) => {
    if (!pullRefreshEnabled()) { startY = null; pulling = false; return; }
    // Only start tracking if already at the very top — otherwise this is
    // just a normal scroll gesture partway down the page, not a pull
    // attempt, and shouldn't be treated as one. Also bail on the specific
    // elements that actually conflict: a widget itself (.editor-widget,
    // .ft-selected — two different rendering paths for the same kind of
    // thing) and its resize handles all move things VERTICALLY using
    // pointerdown/pointermove, which fires as a SEPARATE, PARALLEL event
    // stream from touch events — their own stopPropagation() has no effect
    // on this listener at all. Deliberately NOT excluding the whole Layout
    // tab or swipe-cards (.swipe-card/.screen-swipe, used heavily on
    // Devices): swipe cards track HORIZONTAL movement, a different axis
    // from this listener's vertical dy, so they don't actually conflict —
    // excluding them here just meant pull-to-refresh silently never worked
    // almost anywhere on Devices, a real regression from being too cautious.
    if (e.target.closest('.editor-widget, .ft-selected, .resize-handle')) {
      startY = null; pulling = false; return;
    }
    if (scrollEl.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    } else {
      startY = null;
      pulling = false;
    }
  }, { passive: true });

  scrollEl.addEventListener('touchmove', (e) => {
    if (!pulling || startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { pulling = false; indicator.style.height = '0px'; return; }
    const height = Math.min(dy, MAX_PULL);
    indicator.style.height = height + 'px';
    indicator.textContent = height >= PULL_THRESHOLD ? '↻ Release to refresh' : '↓ Pull to refresh';
  }, { passive: true });

  scrollEl.addEventListener('touchend', () => {
    if (!pulling || startY == null) { pulling = false; startY = null; return; }
    const height = parseInt(indicator.style.height) || 0;
    pulling = false; startY = null;
    if (height >= PULL_THRESHOLD) {
      indicator.textContent = '↻ Refreshing…';
      // Remember which tab this reload was triggered from, so init() can
      // return there instead of always landing back on Calendar (the
      // default a plain page load starts on). One-time: read and cleared
      // by init() on the very next load, not a standing "always open to
      // this tab" preference.
      try { localStorage.setItem('pull_refresh_return_tab', currentTab); } catch {}
      window.location.reload();
    } else {
      indicator.style.height = '0px';
    }
  }, { passive: true });
})();

function renderTab() {
  if (currentTab === 'favorites') renderFavoritesTab();
  else if (currentTab === 'calendars') renderCalendarTab();
  else if (currentTab === 'photos') renderPhotos();
  else if (currentTab === 'layout') renderLayoutTab();
  else if (currentTab === 'displays') renderDisplaysTab();
  else if (currentTab === 'family') renderFamilyHubTab();
  else renderSettings();
}

// Without this, the app only ever shows what it fetched at the last real
// page load — switching tabs re-fetches (each render*Tab() above is its own
// independent fetch-and-render), but just leaving the SAME tab open and
// backgrounding the app/browser tab never does, so returning to it later
// (a phone bringing it back from the background, a laptop waking up) shows
// stale data until you force-close and reopen. renderTab() is already safe
// to call again any time — it's exactly what a tab click already does —
// so re-running it whenever the page becomes visible again catches it back
// up for free. Skipped while the PIN lock screen is showing (nothing real
// to refresh behind it yet).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('pin-screen').style.display !== 'flex') renderTab();
});

// ── Favorites tab ────────────────────────────────────────────────────────────
// The new landing tab, ahead of Calendar. A personally-curated set of
// quick-action and at-a-glance cards, picked from the fixed catalog below via
// a "+" picker — not free-form user content. Cards are stored server-side
// (one shared list for the household, same as everything else in this app),
// so the tab looks the same regardless of which device/browser opens it.
//
// Each entry in this catalog is a self-contained recipe: which shared data
// source(s) it needs (so renderFavoritesTab only fetches what's actually in
// use, not everything every time), how to render its body, and how to wire
// its interactivity. `configField` marks card types that need a one-time
// choice at add-time (currently only 'kid' — which kid this card is about).
// Same WMO weather-code set display.html's WMO_DESC table covers, mapped to
// a single representative emoji each — the wall display uses full SVG
// artwork for its own weather widget, which is overkill for a compact
// Favorites card; an emoji reads fine at this size and needs no asset
// loading. Kept in sync by eye with WMO_DESC's own code list (no shared
// module system between the two files, same constraint as everything else
// duplicated across display.html/app.html/kids.html in this project).
const WMO_EMOJI = {
  0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️', 45:'🌫️', 48:'🌫️',
  51:'🌦️', 53:'🌦️', 55:'🌧️', 61:'🌧️', 63:'🌧️', 65:'🌧️',
  71:'🌨️', 73:'🌨️', 75:'❄️', 80:'🌦️', 81:'🌧️', 82:'⛈️',
  95:'⛈️', 96:'⛈️', 99:'⛈️',
};

const FAVORITE_CARD_DEFS = {
  give_sticker: {
    label: 'Give a Sticker', icon: '🏅', category: 'Quick actions', needs: ['kids'],
    render(card, data) {
      const kids = (data.chart && data.chart.kids) || [];
      if (!kids.length) return `<p style="font-size:12px;color:var(--muted);margin:0">Add a kid in the Chores tab first.</p>`;
      return `
        <div style="font-weight:600;font-size:12.5px;margin-bottom:6px">🏅 Give a Sticker</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${kids.map(k => `
            <button class="fav-give-sticker-btn" data-kid-id="${k.id}" data-kid-name="${escapeHtml(k.name)}"
              style="display:flex;align-items:center;gap:5px;background:var(--bg);border:1px solid var(--border);border-radius:18px;padding:4px 10px 4px 4px;cursor:pointer;color:var(--text);font-size:12.5px">
              ${stickerBadgeHtmlApp(k, 18)} ${escapeHtml(k.name)}
            </button>`).join('')}
        </div>
        <button class="fav-card-link" data-target-tab="family" data-subtab="chores" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:6px 0 0;text-align:left">Manage kids &amp; chores ›</button>`;
    },
    wire(card, data) {
      document.querySelectorAll('.fav-give-sticker-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const r = await apiFetch('/api/stickers', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ kid_id: parseInt(btn.dataset.kidId) }) });
          if (r && r.id) { showToast(`⭐ Sticker given to ${btn.dataset.kidName}!`); renderFavoritesTab(); }
          else showToast('❌ ' + ((r && r.error) || 'Could not save'));
        });
      });
    },
  },
  add_chore: {
    label: 'Add a Chore', icon: '📋', category: 'Quick actions', needs: ['kids'],
    render() { return `
      <div style="font-weight:600;font-size:12.5px;margin-bottom:6px">📋 Add a Chore</div>
      <button class="btn btn-primary fav-add-chore-btn" style="margin-top:0;padding:9px">+ Add Chore</button>
      <button class="fav-card-link" data-target-tab="family" data-subtab="chores" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:6px 0 0;text-align:left">View all chores ›</button>`; },
    wire(card, data) {
      document.querySelector('.fav-add-chore-btn').addEventListener('click', () => {
        _choreState.kids = (data.chart && data.chart.kids) || [];
        openChoreEditor(null);
      });
    },
  },
  add_shopping_item: {
    label: 'Add to Shopping List', icon: '🛒', category: 'Quick actions', needs: [],
    render() { return `
      <div style="font-weight:600;font-size:12.5px;margin-bottom:6px">🛒 Add to Shopping List</div>
      <div style="display:flex;gap:6px">
        <input class="form-input fav-shop-input" placeholder="e.g. Milk" style="flex:1;padding:8px 10px;font-size:13px">
        <button class="btn btn-primary fav-shop-add-btn" style="width:auto;margin-top:0;padding:0 14px">Add</button>
      </div>
      <button class="fav-card-link" data-target-tab="family" data-subtab="shopping" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:6px 0 0;text-align:left">View full list ›</button>`; },
    wire() {
      const input = document.querySelector('.fav-shop-input'), btn = document.querySelector('.fav-shop-add-btn');
      const submit = async () => {
        const text = input.value.trim();
        if (!text) return;
        const r = await apiFetch('/api/shopping-list', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text }) });
        if (r && r.id) { showToast(`🛒 Added "${text}"`); input.value = ''; }
        else showToast('❌ ' + ((r && r.error) || 'Could not add'));
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    },
  },
  redeem_reward: {
    label: 'Redeem a Reward', icon: '🎁', category: 'Quick actions', needs: ['kids', 'rewards'],
    render(card, data) {
      const kids = (data.chart && data.chart.kids) || [];
      const rewards = (data.rewards || []).filter(r => r.active);
      if (!kids.length || !rewards.length) return `<div style="font-weight:600;font-size:12.5px;margin-bottom:2px">🎁 Redeem a Reward</div><p style="font-size:12px;color:var(--muted);margin:0">Set up kids and rewards in the Chores tab first.</p>`;
      return `
        <div style="font-weight:600;font-size:12.5px;margin-bottom:6px">🎁 Redeem a Reward</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <select class="form-input fav-redeem-kid" style="flex:1;min-width:100px;padding:8px 8px;font-size:13px">${kids.map(k => `<option value="${k.id}">${escapeHtml(k.name)}</option>`).join('')}</select>
          <select class="form-input fav-redeem-reward" style="flex:1;min-width:130px;padding:8px 8px;font-size:13px">${rewards.map(r => `<option value="${r.id}" data-cost="${r.star_cost}" data-title="${escapeHtml(r.title)}">${r.icon} ${escapeHtml(r.title)} (⭐${r.star_cost})</option>`).join('')}</select>
        </div>
        <button class="btn btn-primary fav-redeem-btn" style="margin-top:8px;padding:9px">Redeem</button>
        <button class="fav-card-link" data-target-tab="family" data-subtab="chores" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:6px 0 0;text-align:left">Manage rewards ›</button>`;
    },
    wire() {
      const btn = document.querySelector('.fav-redeem-btn');
      if (!btn) return; // empty state (no kids/rewards set up yet) — see render() above, no button to wire
      btn.addEventListener('click', async () => {
        const kidSel = document.querySelector('.fav-redeem-kid');
        const rewardSel = document.querySelector('.fav-redeem-reward');
        const opt = rewardSel.selectedOptions[0];
        if (!confirm(`Redeem "${opt.dataset.title}" for ${opt.dataset.cost} stars?`)) return;
        const r = await apiFetch(`/api/rewards/${rewardSel.value}/redeem`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ kid_id: parseInt(kidSel.value) }) });
        if (r && r.ok) showToast('🎉 Redeemed!');
        else showToast('❌ ' + ((r && r.error) || 'Could not redeem'));
      });
    },
  },
  chores_progress: {
    label: "Today's Chores Progress", icon: '📆', category: 'At a glance', needs: ['kids'],
    render(card, data) {
      const kids = (data.chart && data.chart.kids) || [];
      const all = kids.flatMap(k => k.chores || []);
      const done = all.filter(c => c.done).length;
      const pct = all.length ? Math.round((done / all.length) * 100) : 0;
      return `
        <div class="fav-card-link" data-target-tab="family" data-subtab="chores" style="cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span style="font-weight:600;font-size:12.5px">📆 Today's Chores</span>
            <span style="font-size:18px;font-weight:800">${done}/${all.length}</span>
          </div>
          <div style="height:6px;background:var(--bg);border-radius:5px;overflow:hidden;margin-top:5px">
            <div style="height:100%;width:${pct}%;background:var(--accent)"></div>
          </div>
        </div>`;
    },
  },
  sticker_balances: {
    label: 'Sticker Balances', icon: '⭐', category: 'At a glance', needs: ['kids'],
    render(card, data) {
      const kids = (data.chart && data.chart.kids) || [];
      if (!kids.length) return `<p style="font-size:12px;color:var(--muted);margin:0">No kids set up yet.</p>`;
      return `
        <div class="fav-card-link" data-target-tab="family" data-subtab="chores" style="cursor:pointer">
          <div style="font-weight:600;font-size:12.5px;margin-bottom:5px">⭐ Sticker Balances</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${kids.map(k => `<div style="display:flex;align-items:center;gap:4px">${stickerBadgeHtmlApp(k, 16)} <span style="font-size:12px;color:${k.color}">${escapeHtml(k.name)}</span> <span style="font-weight:700;font-size:12px">${k.stickerBalance || 0}</span></div>`).join('')}
          </div>
        </div>`;
    },
  },
  weather_today: {
    label: 'Weather', icon: '🌤️', category: 'At a glance', needs: ['weather'],
    render(card, data) {
      const w = data.weather;
      if (!w || !w.current) return `<div class="fav-card-link" data-target-tab="settings" style="cursor:pointer"><p style="font-size:12px;color:var(--muted);margin:0">Set a location in Settings → Weather. <span style="color:var(--muted)">›</span></p></div>`;
      // Every provider (Open-Meteo default, OpenWeatherMap, NWS) normalizes
      // to this same field shape server-side (see getWeatherOWM/getWeatherNWS
      // in server.js) — including hourly/daily, not just current — so this
      // doesn't need to branch per-provider or fetch anything extra. The
      // data for a real forecast, not just today's temperature, was already
      // being pulled into this card the whole time; it just wasn't being
      // shown.
      const temp = Math.round(w.current.temperature_2m);
      const icon = WMO_EMOJI[w.current.weather_code] ?? '🌡️';
      const daily = w.daily || {};
      const todayHigh = daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[0]) : null;
      const todayLow = daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[0]) : null;
      const dayAbbr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const dayStrip = (daily.time || []).slice(0, 4).map((t, i) => {
        const d = new Date(t + 'T00:00:00');
        const label = i === 0 ? 'Today' : dayAbbr[d.getDay()];
        const hi = Math.round(daily.temperature_2m_max[i]);
        const lo = Math.round(daily.temperature_2m_min[i]);
        const ic = WMO_EMOJI[daily.weather_code[i]] ?? '🌡️';
        return `<div style="flex:1;text-align:center;min-width:0">
          <div style="font-size:9.5px;color:var(--muted)">${label}</div>
          <div style="font-size:15px;line-height:1.3">${ic}</div>
          <div style="font-size:10.5px">${hi}°<span style="color:var(--muted)">/${lo}°</span></div>
        </div>`;
      }).join('');
      return `
        <div class="fav-card-link" data-target-tab="settings" style="cursor:pointer">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:20px;line-height:1">${icon}</span>
              <span style="font-size:19px;font-weight:800">${temp}°</span>
            </div>
            ${todayHigh!=null ? `<span style="font-size:11px;color:var(--muted)">H:${todayHigh}° L:${todayLow}°</span>` : '<span style="color:var(--muted)">›</span>'}
          </div>
          ${dayStrip ? `<div style="display:flex;gap:2px;border-top:1px solid var(--border);margin-top:5px;padding-top:5px">${dayStrip}</div>` : ''}
        </div>`;
    },
  },
  shopping_count: {
    label: 'Shopping List Count', icon: '🛍️', category: 'At a glance', needs: ['shopping'],
    render(card, data) {
      const items = (data.shopping || []).filter(i => !i.done);
      return `<div class="fav-card-link" data-target-tab="family" data-subtab="shopping" style="cursor:pointer"><div style="font-weight:600;font-size:13px;margin-bottom:4px">🛍️ Shopping List <span style="float:right;color:var(--muted);font-weight:400">›</span></div><div style="font-size:28px;font-weight:800">${items.length}</div><div style="font-size:12px;color:var(--muted)">item${items.length===1?'':'s'} to buy</div></div>`;
    },
  },
  screens_status: {
    label: 'Screens Online', icon: '🖥️', category: 'At a glance', needs: ['screens'],
    render(card, data) {
      const screens = data.screens || [];
      const online = screens.filter(s => s.online).length;
      return `<div class="fav-card-link" data-target-tab="displays" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between"><span style="font-weight:600;font-size:12.5px">🖥️ Screens</span><span style="font-size:16px;font-weight:800">${online}/${screens.length} <span style="font-size:11px;font-weight:400;color:var(--muted)">online</span></span></div>`;
    },
  },
  kid_shortcut: {
    label: "Kid's Stickers", icon: '🧒', category: 'Shortcuts', needs: ['kids'], configField: 'kid',
    render(card, data) {
      const kid = ((data.chart && data.chart.kids) || []).find(k => k.id === card.config.kid_id);
      if (!kid) return `<p style="font-size:12px;color:var(--muted);margin:0">That kid no longer exists — remove this card.</p>`;
      return `
        <button class="fav-kid-shortcut-btn" data-kid-id="${kid.id}" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px">
          <span style="font-size:24px">${kid.avatar||'🙂'}</span>
          <div>
            <div style="font-weight:600;font-size:13px;color:${kid.color}">${escapeHtml(kid.name)}</div>
            <div style="font-size:11px;color:var(--muted)">${stickerBadgeHtmlApp(kid, 12)} ${kid.stickerBalance||0} · 🔥${kid.streak||0}</div>
          </div>
        </button>`;
    },
    wire(card, data) {
      const btn = document.querySelector('.fav-kid-shortcut-btn');
      if (!btn) return; // empty state (kid no longer exists) — see render() above, no button to wire
      btn.addEventListener('click', () => {
        const kid = ((data.chart && data.chart.kids) || []).find(k => k.id === card.config.kid_id);
        if (kid) openStickerSheet(kid);
      });
    },
  },
  family_hub_qr: {
    label: 'Family Hub QR', icon: '🏠', category: 'Shortcuts', needs: [],
    render() { return `
      <div style="display:flex;align-items:center;gap:10px">
        <div id="fav-hub-qr" style="background:#fff;padding:5px;border-radius:6px;width:60px;height:60px;flex-shrink:0"></div>
        <div>
          <div style="font-weight:600;font-size:12.5px">🏠 Family Hub</div>
          <button class="fav-card-link" data-target-tab="family" data-subtab="chores" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:4px 0 0;text-align:left">Open Family Hub ›</button>
        </div>
      </div>`; },
    wire() {
      const hubUrl = `${window.location.origin}/hub`;
      const el = document.getElementById('fav-hub-qr');
      function draw() {
        if (typeof QRCode === 'undefined') { setTimeout(draw, 200); return; }
        el.innerHTML = '';
        try { new QRCode(el, { text: hubUrl, width: 50, height: 50, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M }); } catch {}
      }
      draw();
      el.addEventListener('click', () => copyToClipboard(hubUrl));
    },
  },
  copy_kids_link: {
    label: 'Copy /kids Link', icon: '📋', category: 'Utility', needs: [],
    render() { return `<button class="fav-copy-kids-btn" data-url="${window.location.origin}/kids" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:600;font-size:12.5px">📋 Copy /kids Link</span></button>`; },
    wire() { document.querySelector('.fav-copy-kids-btn').addEventListener('click', (e) => copyToClipboard(e.currentTarget.dataset.url)); },
  },
  copy_hub_link: {
    label: 'Copy /hub Link', icon: '📋', category: 'Utility', needs: [],
    render() { return `<button class="fav-copy-hub-btn" data-url="${window.location.origin}/hub" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-weight:600;font-size:12.5px">📋 Copy /hub Link</span></button>`; },
    wire() { document.querySelector('.fav-copy-hub-btn').addEventListener('click', (e) => copyToClipboard(e.currentTarget.dataset.url)); },
  },
  ha_entity_toggle: {
    label: 'Light/Switch Toggle', icon: '💡', category: 'Home Assistant', needs: ['ha_entities'], configField: 'ha_entity',
    render(card, data) {
      const ent = (data.haEntities || []).find(e => e.entity_id === card.config.entity_id);
      if (!ent) return `<p style="font-size:12px;color:var(--muted);margin:0">Entity not found — check Home Assistant, or remove this card.</p>`;
      const on = ent.state === 'on';
      return `
        <button class="fav-ha-toggle-btn" data-entity-id="${ent.entity_id}" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${on?'💡':'🔌'} ${escapeHtml(ent.friendly_name)}</span>
          <span style="flex-shrink:0;width:34px;height:19px;border-radius:10px;background:${on?'var(--accent)':'var(--border)'};position:relative;transition:background .15s"><span style="position:absolute;top:2px;left:${on?'17px':'2px'};width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s"></span></span>
        </button>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      const btn = root && root.querySelector('.fav-ha-toggle-btn');
      if (!btn) return; // empty state (entity not found) — see render() above, no button to wire
      btn.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.style.opacity = '.5';
        const r = await apiFetch('/api/ha/call-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityId: btn.dataset.entityId, action: 'toggle' }) });
        if (r && r.ok) renderFavoritesTab();
        else { btn.style.opacity = ''; showToast('❌ ' + ((r && r.error) || 'Could not toggle')); }
      });
    },
  },
  ha_group_toggle: {
    label: 'Room/Group Toggle', icon: '🏠', category: 'Home Assistant', needs: ['ha_entities'], configField: 'ha_group',
    render(card, data) {
      const ids = card.config.entity_ids || [];
      const members = (data.haEntities || []).filter(e => ids.includes(e.entity_id));
      if (!members.length) return `<p style="font-size:12px;color:var(--muted);margin:0">No entities found for "${escapeHtml(card.config.name||'this group')}" — remove this card.</p>`;
      const anyOn = members.some(e => e.state === 'on');
      return `
        <button class="fav-ha-group-btn" data-ids="${escapeHtml(JSON.stringify(ids))}" style="width:100%;background:none;border:none;padding:0;text-align:left;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🏠 ${escapeHtml(card.config.name || 'Group')} <span style="color:var(--muted);font-weight:400">(${members.length})</span></span>
          <span style="flex-shrink:0;width:34px;height:19px;border-radius:10px;background:${anyOn?'var(--accent)':'var(--border)'};position:relative;transition:background .15s"><span style="position:absolute;top:2px;left:${anyOn?'17px':'2px'};width:15px;height:15px;border-radius:50%;background:#fff;transition:left .15s"></span></span>
        </button>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      const btn = root && root.querySelector('.fav-ha-group-btn');
      if (!btn) return; // empty state (no entities found for this group) — see render() above, no button to wire
      btn.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const ids = JSON.parse(btn.dataset.ids);
        // Same "client decides based on current state" split already used by
        // the wall display's own Group Control widget — if anything in the
        // group is on, this sends turn_off; only if everything's off does it
        // send turn_on. HA's own group toggle service can't do this (it
        // toggles each member independently off its OWN state, which for a
        // mixed group does the opposite of "one clear group action").
        const wasAnyOn = btn.querySelector('span[style*="var(--accent)"]');
        btn.style.opacity = '.5';
        const r = await apiFetch('/api/ha/call-group-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityIds: ids, action: wasAnyOn ? 'turn_off' : 'turn_on' }) });
        if (r && r.ok) renderFavoritesTab();
        else { btn.style.opacity = ''; showToast('❌ ' + ((r && r.error) || 'Could not toggle')); }
      });
    },
  },
  ha_scene_trigger: {
    label: 'Scene/Script Button', icon: '🎬', category: 'Home Assistant', needs: ['ha_entities'], configField: 'ha_scene',
    render(card, data) {
      const ent = (data.haEntities || []).find(e => e.entity_id === card.config.entity_id);
      if (!ent) return `<p style="font-size:12px;color:var(--muted);margin:0">Scene/script not found — check Home Assistant, or remove this card.</p>`;
      const isScript = ent.entity_id.startsWith('script.');
      return `<button class="btn btn-primary fav-ha-trigger-btn" data-entity-id="${ent.entity_id}" style="margin-top:0;padding:10px;width:100%">${isScript?'📜':'🎬'} ${escapeHtml(ent.friendly_name)}</button>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      const triggerBtn = root && root.querySelector('.fav-ha-trigger-btn');
      if (!triggerBtn) return; // empty state (scene/script not found) — see render() above, no button to wire
      triggerBtn.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const r = await apiFetch('/api/ha/call-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityId: btn.dataset.entityId, action: 'trigger' }) });
        btn.disabled = false;
        if (r && r.ok) showToast(`✓ ${btn.textContent.trim()} triggered`);
        else showToast('❌ ' + ((r && r.error) || 'Could not trigger'));
      });
    },
  },
  ha_cover: {
    label: 'Garage / Blind / Cover', icon: '🪟', category: 'Home Assistant', needs: ['ha_entities'], configField: 'ha_cover',
    render(card, data) {
      const ent = (data.haEntities || []).find(e => e.entity_id === card.config.entity_id);
      if (!ent) return `<p style="font-size:12px;color:var(--muted);margin:0">Cover not found — check Home Assistant, or remove this card.</p>`;
      const st = (ent.state || '').toLowerCase();
      const stText = st === 'open' ? 'Open' : st === 'closed' ? 'Closed' : st ? st.charAt(0).toUpperCase()+st.slice(1) : '—';
      const b = (act, glyph, aria) => `<button class="fav-cover-btn" data-act="${act}" data-entity-id="${ent.entity_id}" aria-label="${aria}" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:15px;cursor:pointer">${glyph}</button>`;
      return `
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">🪟 ${escapeHtml(ent.friendly_name)} <span style="color:var(--muted);font-weight:400">· ${stText}</span></div>
        <div style="display:flex;gap:6px">${b('open_cover','▲','Open')}${b('stop_cover','■','Stop')}${b('close_cover','▼','Close')}</div>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      if (!root) return;
      root.querySelectorAll('.fav-cover-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.style.opacity = '.5';
          const r = await apiFetch('/api/ha/call-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityId: btn.dataset.entityId, action: btn.dataset.act }) });
          if (r && r.ok) setTimeout(renderFavoritesTab, 700);
          else { btn.disabled = false; btn.style.opacity = ''; showToast('❌ ' + ((r && r.error) || 'Could not move it')); }
        });
      });
    },
  },
  ha_lock: {
    label: 'Lock', icon: '🔒', category: 'Home Assistant', needs: ['ha_entities'], configField: 'ha_lock',
    render(card, data) {
      const ent = (data.haEntities || []).find(e => e.entity_id === card.config.entity_id);
      if (!ent) return `<p style="font-size:12px;color:var(--muted);margin:0">Lock not found — check Home Assistant, or remove this card.</p>`;
      const locked = ent.state === 'locked';
      const stText = ent.state === 'unlocked' ? 'Unlocked' : locked ? 'Locked' : (ent.state || '—');
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-size:12.5px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${locked?'🔒':'🔓'} ${escapeHtml(ent.friendly_name)} <span style="color:var(--muted);font-weight:400">· ${stText}</span></span>
          <button class="btn btn-primary fav-lock-btn" data-entity-id="${ent.entity_id}" data-act="${locked?'unlock':'lock'}" style="margin-top:0;padding:8px 14px;flex-shrink:0">${locked?'Unlock':'Lock'}</button>
        </div>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      const btn = root && root.querySelector('.fav-lock-btn');
      if (!btn) return;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await apiFetch('/api/ha/call-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityId: btn.dataset.entityId, action: btn.dataset.act }) });
        if (r && r.ok) setTimeout(renderFavoritesTab, 700);
        else { btn.disabled = false; showToast('❌ ' + ((r && r.error) || 'Could not change the lock')); }
      });
    },
  },
  ha_media: {
    label: 'Media Player', icon: '📺', category: 'Home Assistant', needs: ['ha_entities'], configField: 'ha_media',
    render(card, data) {
      const ent = (data.haEntities || []).find(e => e.entity_id === card.config.entity_id);
      if (!ent) return `<p style="font-size:12px;color:var(--muted);margin:0">Media player not found — check Home Assistant, or remove this card.</p>`;
      const playing = ent.state === 'playing';
      const b = (act, glyph, aria) => `<button class="fav-media-btn" data-act="${act}" data-entity-id="${ent.entity_id}" aria-label="${aria}" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:15px;cursor:pointer">${glyph}</button>`;
      return `
        <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px">📺 ${escapeHtml(ent.friendly_name)} <span style="color:var(--muted);font-weight:400">· ${escapeHtml(ent.state||'—')}</span></div>
        <div style="display:flex;gap:6px">${b('media_previous_track','⏮','Previous')}${b('media_play_pause',playing?'⏸':'▶',playing?'Pause':'Play')}${b('media_next_track','⏭','Next')}</div>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      if (!root) return;
      root.querySelectorAll('.fav-media-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true; btn.style.opacity = '.5';
          const r = await apiFetch('/api/ha/call-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityId: btn.dataset.entityId, action: btn.dataset.act }) });
          if (r && r.ok) setTimeout(renderFavoritesTab, 700);
          else { btn.disabled = false; btn.style.opacity = ''; showToast('❌ ' + ((r && r.error) || 'Could not control playback')); }
        });
      });
    },
  },
  ha_thermostat: {
    label: 'Thermostat', icon: '🌡️', category: 'Home Assistant', needs: ['ha_entities', 'ha_thermostats'], configField: 'ha_thermostat',
    render(card, data) {
      const st = (data.haThermostats || {})[card.config.entity_id];
      if (!st) return `<p style="font-size:12px;color:var(--muted);margin:0">Thermostat not found — check Home Assistant, or remove this card.</p>`;
      const step = st.tempStep || 0.5;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="min-width:0">
            <div style="font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🌡️ ${escapeHtml(st.friendly_name)}</div>
            <div style="font-size:10.5px;color:var(--muted)">Now: ${st.currentTemp ?? '—'}°</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <button class="fav-thermo-btn" data-entity-id="${st.entity_id}" data-dir="-1" data-step="${step}" data-target="${st.targetTemp}" style="width:26px;height:26px;border-radius:50%;background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:15px;cursor:pointer">−</button>
            <span style="font-size:16px;font-weight:800;min-width:32px;text-align:center">${st.targetTemp ?? '—'}°</span>
            <button class="fav-thermo-btn" data-entity-id="${st.entity_id}" data-dir="1" data-step="${step}" data-target="${st.targetTemp}" style="width:26px;height:26px;border-radius:50%;background:var(--bg);border:1px solid var(--border);color:var(--text);font-size:15px;cursor:pointer">+</button>
          </div>
        </div>`;
    },
    wire(card) {
      const root = document.querySelector(`.fav-card[data-id="${card.id}"]`);
      (root ? root.querySelectorAll('.fav-thermo-btn') : []).forEach(btn => {
        btn.addEventListener('click', async () => {
          const step = parseFloat(btn.dataset.step) || 0.5;
          const target = parseFloat(btn.dataset.target) || 70;
          const newTemp = target + step * parseInt(btn.dataset.dir);
          const r = await apiFetch('/api/ha/call-action', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ entityId: btn.dataset.entityId, action: 'set_temperature', temperature: newTemp }) });
          if (r && r.ok) renderFavoritesTab();
          else showToast('❌ ' + ((r && r.error) || 'Could not adjust'));
        });
      });
    },
  },
  next_up: {
    label: 'Next Up (Calendar)', icon: '📅', category: 'At a glance', needs: ['events'],
    render(card, data) {
      const events = data.events || [];
      if (!events.length) return `<div class="fav-card-link" data-target-tab="calendars" style="cursor:pointer"><p style="font-size:12px;color:var(--muted);margin:0">Nothing on the calendar soon. <span style="color:var(--muted)">›</span></p></div>`;
      const ev = events[0];
      const evDate = new Date(ev.date + 'T00:00:00');
      const today = new Date(); today.setHours(0,0,0,0);
      const daysAway = Math.round((evDate - today) / 86400000);
      const when = daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`;
      const timeStr = ev.start_time ? ` · ${ev.start_time}` : '';
      return `
        <div class="fav-card-link" data-target-tab="calendars" style="cursor:pointer">
          <div style="font-weight:600;font-size:12.5px;margin-bottom:3px">📅 Next Up</div>
          <div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ev.title)}</div>
          <div style="font-size:11px;color:var(--muted)">${when}${timeStr}</div>
        </div>`;
    },
  },
  todo_count: {
    label: 'To-Do Count', icon: '✅', category: 'At a glance', needs: ['todos'],
    render(card, data) {
      const total = (data.todoLists || []).reduce((sum, l) => sum + (l.itemCount || 0), 0);
      return `<div class="fav-card-link" data-target-tab="family" data-subtab="todo" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between"><span style="font-weight:600;font-size:12.5px">✅ To-Do</span><span style="font-size:16px;font-weight:800">${total} <span style="font-size:11px;font-weight:400;color:var(--muted)">open</span></span></div>`;
    },
  },
  add_todo_item: {
    label: 'Add a To-Do Item', icon: '📝', category: 'Quick actions', needs: ['todos'],
    render(card, data) {
      const lists = data.todoLists || [];
      if (!lists.length) return `<div style="font-weight:600;font-size:12.5px;margin-bottom:2px">📝 Add a To-Do</div><p style="font-size:12px;color:var(--muted);margin:0">Add a list in Settings → Built-in To-Do Lists first.</p>`;
      return `
        <div style="font-weight:600;font-size:12.5px;margin-bottom:6px">📝 Add a To-Do</div>
        <div style="display:flex;gap:6px">
          <select class="form-input fav-todo-list-select" style="width:auto;padding:8px;font-size:13px">${lists.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('')}</select>
          <input class="form-input fav-todo-input" placeholder="e.g. Call the vet" style="flex:1;padding:8px 10px;font-size:13px">
        </div>
        <button class="btn btn-primary fav-todo-add-btn" style="margin-top:6px;padding:9px">Add</button>
        <button class="fav-card-link" data-target-tab="family" data-subtab="todo" style="background:none;border:none;color:var(--accent);font-size:11px;cursor:pointer;padding:6px 0 0;text-align:left">View lists ›</button>`;
    },
    wire() {
      const select = document.querySelector('.fav-todo-list-select');
      const input = document.querySelector('.fav-todo-input');
      const btn = document.querySelector('.fav-todo-add-btn');
      const submit = async () => {
        const text = input.value.trim();
        if (!text) return;
        const r = await apiFetch(`/api/todo-lists/${select.value}/items`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text }) });
        if (r && r.id) { showToast(`✅ Added "${text}"`); input.value = ''; }
        else showToast('❌ ' + ((r && r.error) || 'Could not add'));
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    },
  },
};

let favoriteCards = [];
// Guards against overlapping renderFavoritesTab() calls clobbering each
// other's DOM/listeners. This function does several awaited fetches, so
// it's genuinely possible for a second call to start (the 15s auto-refresh
// firing, or the user tapping something that triggers another render)
// before a first one's fetches have resolved. Without this, whichever call
// happens to FINISH last wins and repaints the DOM/rewires listeners —
// even if it's the call that STARTED first and is now working from the
// most stale snapshot of the data. Same monotonic-counter pattern already
// used for authGeneration elsewhere in this file.
let favoritesRenderGeneration = 0;
async function renderFavoritesTab() {
  const myGeneration = ++favoritesRenderGeneration;
  const content = $('content');
  let cards = [];
  try { cards = await apiFetch('/api/favorite-cards'); } catch {}
  favoriteCards = Array.isArray(cards) ? cards : [];
  // Active profile has Home Assistant hidden — don't render HA cards here.
  if (typeof profileAllows === 'function' && !profileAllows('ha')) {
    favoriteCards = favoriteCards.filter(c => (FAVORITE_CARD_DEFS[c.type] || {}).category !== 'Home Assistant');
  }

  // Only fetch what this specific set of cards actually needs — a household
  // with just two quick-action cards shouldn't pay for a weather call it's
  // not using.
  const needs = new Set();
  favoriteCards.forEach(c => { const def = FAVORITE_CARD_DEFS[c.type]; if (def) def.needs.forEach(n => needs.add(n)); });
  const data = {};
  const fetches = [];
  if (needs.has('kids')) fetches.push(apiFetch('/api/chore-chart').then(r => data.chart = r).catch(() => { data.chart = null; }));
  if (needs.has('rewards')) fetches.push(apiFetch('/api/rewards').then(r => data.rewards = r).catch(() => { data.rewards = []; }));
  if (needs.has('screens')) fetches.push(apiFetch('/api/screens').then(r => data.screens = r).catch(() => { data.screens = []; }));
  if (needs.has('shopping')) fetches.push(apiFetch('/api/shopping-list?list=all').then(r => data.shopping = r).catch(() => { data.shopping = []; }));
  if (needs.has('weather')) fetches.push(apiFetch('/api/weather').then(r => data.weather = r).catch(() => { data.weather = null; }));
  if (needs.has('ha_entities')) fetches.push(apiFetch('/api/ha/entities').then(r => data.haEntities = Array.isArray(r) ? r : []).catch(() => { data.haEntities = []; }));
  if (needs.has('events')) {
    const from = todayStr();
    const to = (() => { const d = new Date(); d.setDate(d.getDate()+14); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; })();
    fetches.push(apiFetch(`/api/events?from=${from}&to=${to}`).then(r => data.events = Array.isArray(r) ? r : []).catch(() => { data.events = []; }));
  }
  if (needs.has('todos')) fetches.push(apiFetch('/api/todo-lists').then(r => data.todoLists = Array.isArray(r) ? r : []).catch(() => { data.todoLists = []; }));
  await Promise.all(fetches);

  // Thermostat cards need per-entity detail (target/current temp, safe
  // range/step) that the bulk /api/ha/entities list above doesn't carry —
  // that endpoint deliberately stays generic (works for any domain) rather
  // than including climate-only extras for every entity regardless of type.
  // Fetched as its own pass, after the entities list, and only for
  // whichever specific thermostats are actually configured on a card —
  // not every climate entity in the house.
  const thermoIds = [...new Set(favoriteCards.filter(c => c.type === 'ha_thermostat' && c.config.entity_id).map(c => c.config.entity_id))];
  if (thermoIds.length) {
    data.haThermostats = {};
    await Promise.all(thermoIds.map(id =>
      apiFetch(`/api/ha/state/${encodeURIComponent(id)}`).then(r => { if (r && !r.error) data.haThermostats[id] = r; }).catch(() => {})
    ));
  }

  // A NEWER call to this function has started since this one began (see the
  // generation comment above) — abandon this now-stale render rather than
  // overwrite whatever the newer call already painted (or is about to).
  // Also stop here if the person has since navigated off the tab entirely.
  if (myGeneration !== favoritesRenderGeneration || currentTab !== 'favorites') return;

  content.innerHTML = `
    <div style="padding:12px">
      ${!favoriteCards.length ? `<div class="empty-state"><div class="emoji">⭐</div><p>No favorite cards yet. Add quick actions and at-a-glance status below.</p></div>` : ''}
      <div id="favorites-grid" style="display:flex;flex-direction:column;gap:7px">
        ${favoriteCards.map((card, i) => {
          const def = FAVORITE_CARD_DEFS[card.type];
          const body = def ? def.render(card, data) : `<p style="font-size:12px;color:var(--muted);margin:0">Unknown card type.</p>`;
          return `
          <div class="settings-card fav-card" data-id="${card.id}" style="padding:10px 12px">
            <div style="display:flex;justify-content:space-between;gap:8px">
              <div style="flex:1;min-width:0">${body}</div>
              <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
                <button class="icon-btn fav-move-up" data-id="${card.id}" title="Move up" style="width:26px;height:26px;font-size:13px" ${i===0?'disabled style="opacity:.3;width:26px;height:26px;font-size:13px"':''}>▲</button>
                <button class="icon-btn fav-move-down" data-id="${card.id}" title="Move down" style="width:26px;height:26px;font-size:13px" ${i===favoriteCards.length-1?'disabled style="opacity:.3;width:26px;height:26px;font-size:13px"':''}>▼</button>
                <button class="icon-btn del fav-remove" data-id="${card.id}" title="Remove" style="width:26px;height:26px;font-size:13px">🗑️</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
      <button class="btn" id="fav-add-btn" style="background:var(--card);border:1px solid var(--border);margin-top:12px;padding:10px">+ Add a Card</button>
      <button class="btn" id="fav-request-card-btn" style="background:none;border:none;color:var(--muted);font-size:12px;margin-top:4px;padding:6px">💡 Request a New Card</button>
    </div>
  `;

  // Each card's wire() runs independently — one throwing (e.g. a future
  // card type making the same "empty-state render omits the button, but
  // wire() queries for it unconditionally" mistake five existing cards
  // just had) must never take down every OTHER card's listeners with it,
  // let alone the trash/Add a Card buttons wired further below this loop.
  // An uncaught throw inside .forEach() halts the whole loop immediately,
  // silently skipping everything after it — which is exactly what made a
  // single misconfigured Favorites card look like "nothing on the whole
  // tab responds to clicks anymore."
  favoriteCards.forEach(card => {
    const def = FAVORITE_CARD_DEFS[card.type];
    if (!def || !def.wire) return;
    try { def.wire(card, data); }
    catch (err) { console.error(`Favorites card "${card.type}" failed to wire:`, err); }
  });
  document.querySelectorAll('.fav-card-link').forEach(el => {
    el.addEventListener('click', () => {
      const subtab = el.dataset.subtab;
      if (subtab) { try { localStorage.setItem('family_hub_subtab', subtab); } catch {} }
      const btn = document.querySelector(`.tab[data-tab="${el.dataset.targetTab}"]`);
      if (btn) btn.click();
    });
  });
  document.querySelectorAll('.fav-move-up').forEach(b => b.addEventListener('click', () => moveFavoriteCard(b.dataset.id, 'up')));
  document.querySelectorAll('.fav-move-down').forEach(b => b.addEventListener('click', () => moveFavoriteCard(b.dataset.id, 'down')));
  document.querySelectorAll('.fav-remove').forEach(b => b.addEventListener('click', () => removeFavoriteCard(b.dataset.id)));
  $('fav-add-btn').addEventListener('click', openAddFavoriteCardPicker);
  $('fav-request-card-btn').addEventListener('click', openRequestCardSheet);
  startFavoritesAutoRefresh();
}

// Always-present, separate from the card catalog entirely (not something you
// add/remove/reorder — it's a standing button below "+ Add a Card", every
// time, regardless of what's on the tab). Reuses the exact same feedback
// pipeline as Settings → Feedback & Ideas (POST /api/feedback,
// kind:'feature') — this IS a feature idea, just reachable from a more
// convenient spot. Tagged with a "[Favorites card idea]" prefix so it's
// identifiable at a glance in the feedback inbox/digest without needing a
// new `kind` value or any server-side schema change.
function openRequestCardSheet() {
  showSheet(`
    <h3 style="margin:0 0 4px">💡 Request a New Card</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 10px">Have an idea for a card that's not in the picker? Send it straight to the developer.</p>
    <textarea class="form-input" id="fav-request-input" rows="4" placeholder="e.g. A card showing tomorrow's weather too" style="resize:vertical"></textarea>
    <div id="fav-request-status" style="font-size:12px;margin-top:8px"></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-primary" id="fav-request-submit" style="flex:1">Send Idea</button>
      <button class="btn" id="fav-request-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
    </div>
  `);
  $('fav-request-cancel').addEventListener('click', closeSheet);
  $('fav-request-submit').addEventListener('click', async () => {
    const input = $('fav-request-input');
    const status = $('fav-request-status');
    const text = input.value.trim();
    if (!text) { status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = 'Please describe the idea first.'; return; }
    const btn = $('fav-request-submit');
    btn.disabled = true;
    status.style.color = 'var(--muted)'; status.textContent = 'Sending…';
    try {
      const fd = new FormData();
      fd.append('kind', 'feature');
      fd.append('message', `[Favorites card idea] ${text}`);
      const r = await apiFetch('/api/feedback', { method:'POST', body: fd });
      if (r && r.ok) { showToast('✓ Thanks — sent!'); closeSheet(); }
      else { status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = (r && r.error) || 'Could not send.'; btn.disabled = false; }
    } catch { status.style.color = 'var(--danger,#ff5d5d)'; status.textContent = 'Could not send — check your connection.'; btn.disabled = false; }
  });
}

async function moveFavoriteCard(id, direction) {
  const r = await apiFetch(`/api/favorite-cards/${id}/move`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ direction }) });
  if (r && r.ok) renderFavoritesTab();
}
async function removeFavoriteCard(id) {
  if (!confirm('Remove this card from Favorites?')) return;
  const r = await apiFetch(`/api/favorite-cards/${id}`, { method:'DELETE' });
  if (r && r.ok) renderFavoritesTab();
}

function openAddFavoriteCardPicker() {
  const categories = {};
  Object.entries(FAVORITE_CARD_DEFS).forEach(([type, def]) => {
    (categories[def.category] = categories[def.category] || []).push({ type, ...def });
  });
  // Hide the whole Home Assistant category when the active profile has HA off.
  if (typeof profileAllows === 'function' && !profileAllows('ha')) delete categories['Home Assistant'];
  const listHtml = Object.entries(categories).map(([cat, defs]) => `
    <div class="section-header" style="font-size:12px;margin-top:14px">${cat}</div>
    ${defs.map(d => `
      <button class="fav-pick-btn" data-type="${d.type}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:6px;cursor:pointer;color:var(--text);font-size:14px">
        <span style="font-size:20px">${d.icon}</span> ${d.label}
      </button>`).join('')}
  `).join('');
  showSheet(`
    <h3 style="margin:0 0 4px">Add a Card</h3>
    <p style="font-size:12px;color:var(--muted);margin:0 0 4px">Pick what to add to Favorites.</p>
    <div style="max-height:60vh;overflow-y:auto">${listHtml}</div>
    <button class="btn" id="fav-pick-cancel" style="width:100%;margin-top:14px;background:var(--card);border:1px solid var(--border)">Cancel</button>
  `);
  $('fav-pick-cancel').addEventListener('click', closeSheet);
  document.querySelectorAll('.fav-pick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      const def = FAVORITE_CARD_DEFS[type];
      if (def.configField === 'kid') {
        closeSheet();
        openPickKidForFavoriteCard(type);
        return;
      }
      if (def.configField === 'ha_entity' || def.configField === 'ha_scene' || def.configField === 'ha_thermostat'
          || def.configField === 'ha_cover' || def.configField === 'ha_lock' || def.configField === 'ha_media') {
        closeSheet();
        openPickHaEntityForFavoriteCard(type, def.configField);
        return;
      }
      if (def.configField === 'ha_group') {
        closeSheet();
        openPickHaGroupForFavoriteCard(type);
        return;
      }
      const r = await apiFetch('/api/favorite-cards', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ type, config:{} }) });
      closeSheet();
      if (r && r.id) { showToast('Added ✓'); renderFavoritesTab(); }
      else showToast('❌ ' + ((r && r.error) || 'Could not add'));
    });
  });
}

// Domain filter per configField — a "Light/Switch Toggle" card picking a
// climate entity (or vice versa) would just be confusing, so each flavor
// only offers entities from domains that actually make sense for it.
const HA_DOMAIN_FILTERS = {
  ha_entity: ['light', 'switch', 'fan', 'input_boolean', 'cover', 'lock'],
  ha_scene: ['scene', 'script'],
  ha_thermostat: ['climate'],
  ha_cover: ['cover'],
  ha_lock: ['lock'],
  ha_media: ['media_player'],
};
async function openPickHaEntityForFavoriteCard(type, configField) {
  showSheet(`<h3 style="margin:0 0 10px">Loading…</h3>`);
  let entities = [];
  try { entities = await apiFetch('/api/ha/entities'); } catch {}
  if (!Array.isArray(entities) || !entities.length) {
    showSheet(`
      <h3 style="margin:0 0 10px">Home Assistant isn't set up</h3>
      <p style="font-size:13px;color:var(--muted)">Connect it first in Settings → Home Assistant, then come back and add this card.</p>
      <button class="btn" id="ha-pick-cancel" style="width:100%;margin-top:10px;background:var(--card);border:1px solid var(--border)">Close</button>
    `);
    $('ha-pick-cancel').addEventListener('click', closeSheet);
    return;
  }
  const domains = HA_DOMAIN_FILTERS[configField] || [];
  const filtered = domains.length ? entities.filter(e => domains.includes(e.entity_id.split('.')[0])) : entities;
  showSheet(`
    <h3 style="margin:0 0 4px">Which one?</h3>
    <input class="form-input" id="ha-pick-search" placeholder="Search…" style="margin-bottom:10px">
    <div id="ha-pick-list" style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px"></div>
    <button class="btn" id="ha-pick-cancel" style="width:100%;margin-top:14px;background:var(--card);border:1px solid var(--border)">Cancel</button>
  `);
  const renderList = (q) => {
    const ql = (q || '').toLowerCase();
    const shown = filtered.filter(e => !ql || e.friendly_name.toLowerCase().includes(ql) || e.entity_id.toLowerCase().includes(ql));
    $('ha-pick-list').innerHTML = shown.length ? shown.map(e => `
      <button class="ha-pick-item" data-entity-id="${e.entity_id}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--text);font-size:13.5px;text-align:left">
        <span style="min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.friendly_name)}</span><span style="font-size:11px;color:var(--muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.entity_id)}</span></span><span style="font-size:11px;color:var(--muted);flex:0 0 auto">${escapeHtml(e.state)}</span>
      </button>`).join('') : `<p style="font-size:12px;color:var(--muted)">No matches.</p>`;
    document.querySelectorAll('.ha-pick-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await apiFetch('/api/favorite-cards', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ type, config:{ entity_id: btn.dataset.entityId } }) });
        closeSheet();
        if (r && r.id) { showToast('Added ✓'); renderFavoritesTab(); }
        else showToast('❌ ' + ((r && r.error) || 'Could not add'));
      });
    });
  };
  renderList('');
  $('ha-pick-search').addEventListener('input', (e) => renderList(e.target.value));
  $('ha-pick-cancel').addEventListener('click', closeSheet);
}

async function openPickHaGroupForFavoriteCard(type) {
  showSheet(`<h3 style="margin:0 0 10px">Loading…</h3>`);
  let entities = [];
  try { entities = await apiFetch('/api/ha/entities'); } catch {}
  if (!Array.isArray(entities) || !entities.length) {
    showSheet(`
      <h3 style="margin:0 0 10px">Home Assistant isn't set up</h3>
      <p style="font-size:13px;color:var(--muted)">Connect it first in Settings → Home Assistant, then come back and add this card.</p>
      <button class="btn" id="ha-pick-cancel" style="width:100%;margin-top:10px;background:var(--card);border:1px solid var(--border)">Close</button>
    `);
    $('ha-pick-cancel').addEventListener('click', closeSheet);
    return;
  }
  const controllable = entities.filter(e => HA_DOMAIN_FILTERS.ha_entity.includes(e.entity_id.split('.')[0]));
  const selected = new Set();
  showSheet(`
    <h3 style="margin:0 0 10px">New Group</h3>
    <label class="lbl">Name</label>
    <input class="form-input" id="ha-group-name" placeholder="e.g. Downstairs" style="margin-bottom:10px">
    <label class="lbl">Members</label>
    <input class="form-input" id="ha-group-search" placeholder="Search…" style="margin:6px 0">
    <div id="ha-group-list" style="max-height:38vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px"></div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-primary" id="ha-group-save" style="flex:1">Add Group</button>
      <button class="btn" id="ha-group-cancel" style="flex:1;background:var(--card);border:1px solid var(--border)">Cancel</button>
    </div>
  `);
  const renderList = (q) => {
    const ql = (q || '').toLowerCase();
    const shown = controllable.filter(e => !ql || e.friendly_name.toLowerCase().includes(ql) || e.entity_id.toLowerCase().includes(ql));
    $('ha-group-list').innerHTML = shown.length ? shown.map(e => `
      <label style="display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;font-size:13.5px;cursor:pointer">
        <input type="checkbox" class="ha-group-check" data-entity-id="${e.entity_id}" ${selected.has(e.entity_id)?'checked':''} style="width:18px;height:18px;accent-color:var(--accent);flex:0 0 auto">
        <span style="min-width:0"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.friendly_name)}</span><span style="font-size:11px;color:var(--muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.entity_id)}</span></span>
      </label>`).join('') : `<p style="font-size:12px;color:var(--muted)">No matches.</p>`;
    document.querySelectorAll('.ha-group-check').forEach(cb => {
      cb.addEventListener('change', () => { if (cb.checked) selected.add(cb.dataset.entityId); else selected.delete(cb.dataset.entityId); });
    });
  };
  renderList('');
  $('ha-group-search').addEventListener('input', (e) => renderList(e.target.value));
  $('ha-group-cancel').addEventListener('click', closeSheet);
  $('ha-group-save').addEventListener('click', async () => {
    const name = $('ha-group-name').value.trim();
    if (!name) { showToast('Enter a name for the group'); return; }
    if (!selected.size) { showToast('Pick at least one entity'); return; }
    const r = await apiFetch('/api/favorite-cards', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ type, config:{ name, entity_ids: [...selected] } }) });
    closeSheet();
    if (r && r.id) { showToast('Added ✓'); renderFavoritesTab(); }
    else showToast('❌ ' + ((r && r.error) || 'Could not add'));
  });
}

async function openPickKidForFavoriteCard(type) {
  let kids = [];
  try { const chart = await apiFetch('/api/chore-chart'); kids = (chart && chart.kids) || []; } catch {}
  if (!kids.length) { showToast('Add a kid in the Chores tab first'); return; }
  showSheet(`
    <h3 style="margin:0 0 10px">Which kid?</h3>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${kids.map(k => `<button class="fav-kid-pick-btn" data-kid-id="${k.id}" style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--text);font-size:14px"><span style="font-size:22px">${k.avatar||'🙂'}</span> ${escapeHtml(k.name)}</button>`).join('')}
    </div>
    <button class="btn" id="fav-kid-pick-cancel" style="width:100%;margin-top:14px;background:var(--card);border:1px solid var(--border)">Cancel</button>
  `);
  $('fav-kid-pick-cancel').addEventListener('click', closeSheet);
  document.querySelectorAll('.fav-kid-pick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = await apiFetch('/api/favorite-cards', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ type, config:{ kid_id: parseInt(btn.dataset.kidId) } }) });
      closeSheet();
      if (r && r.id) { showToast('Added ✓'); renderFavoritesTab(); }
      else showToast('❌ ' + ((r && r.error) || 'Could not add'));
    });
  });
}

// Live refresh while the Favorites tab is open — same "poll every N seconds,
// stop if the tab changed" pattern already used for the Devices tab's screen
// list (startScreensAutoRefresh). A full re-render (not a partial DOM patch)
// since these cards are cheap to rebuild and this avoids maintaining two
// separate "build" and "update" code paths per card type.
let _favoritesRefreshTimer = null;
function startFavoritesAutoRefresh() {
  stopFavoritesAutoRefresh();
  _favoritesRefreshTimer = setInterval(() => {
    if (currentTab === 'favorites') renderFavoritesTab();
    else stopFavoritesAutoRefresh();
  }, 15000);
}
function stopFavoritesAutoRefresh() {
  if (_favoritesRefreshTimer) { clearInterval(_favoritesRefreshTimer); _favoritesRefreshTimer = null; }
}

