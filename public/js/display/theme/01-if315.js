function applyTheme_if315(_c) {
  const { fx, el, rnd, fxScale, rndSize, densify } = _c;
    // Real fireworks: bigger bursts with more/longer rays and a bright glowing
    // core, plus a mix of large "main" bursts and smaller secondary sparkles
    // for visual depth — meant to actually read as fireworks against a night
    // sky, not the smaller/subtler starburst used for New Year's/birthdays.
    const palette = ['#ff5d5d','#ffffff','#5d8bff','#ffd166'];
    for (let i = 0; i < densify(9); i++) {
      const top = rnd(6, 60), left = rnd(6, 94), dur = rnd(2.6, 4.4), delay = rnd(-4.4, 0);
      const color = palette[i % palette.length];
      const isMain = i % 3 !== 2; // 2 out of every 3 are big; the rest are smaller secondary sparkles
      const rayCount = isMain ? 16 : 10;
      const rayLen = isMain ? rndSize(34, 54) : rndSize(16, 26);
      const rays = [];
      for (let a = 0; a < rayCount; a++) {
        // Gradient runs transparent-to-color (not the reverse) so each ray is
        // brightest at its outer tip, like an actual spark, with a small
        // glowing dot right at the tip for extra sparkle.
        rays.push(`<span style="position:absolute;left:50%;top:50%;width:2px;height:${rayLen}px;`
          + `background:linear-gradient(transparent,${color});transform:rotate(${a*(360/rayCount)}deg);transform-origin:top center;border-radius:2px;">`
          + `<span style="position:absolute;left:50%;bottom:0;width:4px;height:4px;margin-left:-2px;border-radius:50%;`
          + `background:#fff;box-shadow:0 0 4px 1px ${color};"></span></span>`);
      }
      const flashSize = (isMain ? 13 : 8) * fxScale;
      const glow = (isMain ? 24 : 12) * fxScale;
      // Glow stays a plain blurred circle (box-shadow is cheap to render, even on
      // a Pi) — the sharp star shape sits on TOP of it as a separate layer, since
      // clip-path on the same element would clip off its own box-shadow too.
      const flash = `<span style="position:absolute;left:50%;top:50%;width:${glow}px;height:${glow}px;`
        + `margin:${-glow/2}px 0 0 ${-glow/2}px;border-radius:50%;background:${color};opacity:0.5;`
        + `box-shadow:0 0 ${(glow*0.6).toFixed(1)}px ${Math.round(glow/4)}px ${color};"></span>`
        + `<span style="position:absolute;left:50%;top:50%;width:${flashSize}px;height:${flashSize}px;`
        + `margin:${-flashSize/2}px 0 0 ${-flashSize/2}px;background:#fff;`
        + `clip-path:polygon(50% 0%, 61% 35%, 100% 50%, 61% 65%, 50% 100%, 39% 65%, 0% 50%, 39% 35%);"></span>`;
      fx.appendChild(el(flash + rays.join(''), `top:${top}%;left:${left}%;width:0;height:0;`
        + `animation:fx-burst ${dur}s ease-out ${delay}s infinite;`));

      // A shower of falling sparks from each main burst — shares the burst's
      // exact duration/delay so it stays synced with it on every loop.
      if (isMain) {
        for (let e = 0; e < 6; e++) {
          const esize = rndSize(2, 4);
          fx.appendChild(el('', `top:${top}%;left:${left}%;width:${esize}px;height:${esize}px;border-radius:50%;`
            + `background:${color};--edrift:${rnd(-16,16)}px;box-shadow:0 0 3px 1px ${color};`
            + `animation:fx-ember-fall ${dur}s ease-in ${delay}s infinite;`));
        }
      }
    }
}

function applyTheme_if362(_c) {
  const { fx, make, el, rnd, fxScale, rndSize, densify } = _c;
    // Firework / sparkle bursts at random points, plus twinkling stars
    const palette = ['#ffd700','#fff3b0','#ffffff'];
    for (let i = 0; i < densify(10); i++) {
      const top = rnd(8, 70), left = rnd(8, 92), dur = rnd(2.2, 4), delay = rnd(-4, 0);
      const color = palette[i % palette.length];
      const rayLen = 26 * fxScale;
      const rays = [];
      for (let a = 0; a < 12; a++) {
        rays.push(`<span style="position:absolute;left:50%;top:50%;width:2px;height:${rayLen}px;`
          + `background:linear-gradient(transparent,${color});transform:rotate(${a*30}deg);transform-origin:top center;">`
          + `<span style="position:absolute;left:50%;bottom:0;width:3px;height:3px;margin-left:-1.5px;border-radius:50%;`
          + `background:#fff;box-shadow:0 0 3px 1px ${color};"></span></span>`);
      }
      const glow = 14 * fxScale, flashSize = 8 * fxScale;
      const flash = `<span style="position:absolute;left:50%;top:50%;width:${glow}px;height:${glow}px;`
        + `margin:${-glow/2}px 0 0 ${-glow/2}px;border-radius:50%;background:${color};opacity:0.5;`
        + `box-shadow:0 0 ${(glow*0.6).toFixed(1)}px ${Math.round(glow/4)}px ${color};"></span>`
        + `<span style="position:absolute;left:50%;top:50%;width:${flashSize}px;height:${flashSize}px;`
        + `margin:${-flashSize/2}px 0 0 ${-flashSize/2}px;background:#fff;`
        + `clip-path:polygon(50% 0%, 61% 35%, 100% 50%, 61% 65%, 50% 100%, 39% 65%, 0% 50%, 39% 35%);"></span>`;
      fx.appendChild(el(flash + rays.join(''), `top:${top}%;left:${left}%;width:0;height:0;`
        + `animation:fx-burst ${dur}s ease-out ${delay}s infinite;`));

      // A smaller ember shower on about half the bursts, matching New Year's
      // subtler style — same synced-timing approach as July4's.
      if (i % 2 === 0) {
        for (let e = 0; e < 4; e++) {
          const esize = rndSize(2, 3);
          fx.appendChild(el('', `top:${top}%;left:${left}%;width:${esize}px;height:${esize}px;border-radius:50%;`
            + `background:${color};--edrift:${rnd(-12,12)}px;box-shadow:0 0 2px 1px ${color};`
            + `animation:fx-ember-fall ${dur}s ease-in ${delay}s infinite;`));
        }
      }
    }
    // Twinkling stars — an actual star shape (clip-path), not a plain dot,
    // matching the firework bursts' own flash cores above.
    make(26, () => {
      const size = rndSize(7, 13), top = rnd(0, 100), left = rnd(0, 100), dur = rnd(2, 5), delay = rnd(-5, 0);
      return el('', `top:${top}%;left:${left}%;width:${size}px;height:${size}px;background:#fff3b0;`
        + `clip-path:polygon(50% 0%, 61% 35%, 100% 50%, 61% 65%, 50% 100%, 39% 65%, 0% 50%, 39% 35%);`
        + `animation:fx-twinkle ${dur}s ease-in-out ${delay}s infinite;`);
    });
}

function applyTheme_if466(_c) {
  const { make, el, rnd, rndSize } = _c;
    // Planes flying at a mix of angles, each correctly oriented to face its
    // actual direction of travel. Uses real plane artwork (provided assets,
    // not a hand-derived shape) — each image is nose-up in its own file, so
    // the rotation needed to face the actual travel direction is still an
    // exact calculation, same as the SVG version before it, just with real
    // detail instead of an approximated silhouette.
    // Three distinct aircraft — not the same image at different sizes —
    // matching how Christmas uses different snowflake glyphs.
    const planeImages = [
      { src:'/assets/planes/small-prop.png', aspect: 1508/1062 }, // small prop plane
      { src:'/assets/planes/jet.png',        aspect: 1555/1064 }, // medium business jet
      { src:'/assets/planes/wide-body.png',  aspect: 1555/1064 }, // large wide-body
    ];
    const paths = [
      { x0:-15, y0: rnd(10,65), x1:115, y1: rnd(10,65) },   // W to E, roughly level
      { x0:115, y0: rnd(10,65), x1:-15, y1: rnd(10,65) },   // E to W, roughly level
      { x0:-15, y0: rnd(-5,15), x1:115, y1: rnd(55,80) },   // NW to SE, descending
      { x0:-15, y0: rnd(55,80), x1:115, y1: rnd(-5,15) },   // SW to NE, climbing
      { x0:115, y0: rnd(-5,15), x1:-15, y1: rnd(55,80) },   // NE to SW, descending
      { x0:115, y0: rnd(55,80), x1:-15, y1: rnd(-5,15) },   // SE to NW, climbing
    ];
    make(7, (i) => {
      const path = paths[i % paths.length];
      const plane = planeImages[i % planeImages.length];
      const w = rndSize(20, 30), h = (w * plane.aspect).toFixed(1);
      const dur = rnd(15, 30), delay = rnd(-30, 0);
      const dx = path.x1 - path.x0, dy = path.y1 - path.y0;
      // Images are nose-up by default, so the rotation needed to align with
      // the travel vector (dx,dy) is simply that vector's angle measured
      // from "up" — no correction factor needed.
      const face = (Math.atan2(dx, -dy) * (180 / Math.PI)).toFixed(1);
      const img = `<img src="${plane.src}" draggable="false" style="width:100%;height:100%;object-fit:contain;` +
        `filter:drop-shadow(0 0 3px rgba(0,0,0,0.4));">`;
      return el(img, `--x0:${path.x0}vw;--y0:${path.y0}vh;--x1:${path.x1}vw;--y1:${path.y1}vh;--face:${face}deg;`
        + `width:${w}px;height:${h}px;animation:fx-flypath ${dur}s linear ${delay}s infinite;`);
    });
}

function applyTheme_if523(_c) {
  const { make, el, rnd, rndSize } = _c;
    // User-uploaded decorations, up to 3, each with its own behavior chosen in
    // Settings. Falls back to nothing spawned if none are configured — a
    // background-only custom theme (or none at all yet) is a valid state, not
    // an error. Behaviors reuse the SAME keyframes every other theme already
    // uses (fx-fall for top, fx-egg-rise for bottom, fx-flypath for sides) —
    // no new animation primitives needed, just different parameters.
    const bg = (displayConfig.customBg || '').trim();
    const bgEl = document.getElementById('theme-bg');
    if (bgEl) bgEl.style.backgroundImage = bg ? `url(${bg})` : '';

    const decos = [
      { src: displayConfig.customDeco1, behavior: displayConfig.customDeco1Behavior },
      { src: displayConfig.customDeco2, behavior: displayConfig.customDeco2Behavior },
      { src: displayConfig.customDeco3, behavior: displayConfig.customDeco3Behavior },
    ].filter(d => d.src);

    decos.forEach((deco) => {
      let behavior = deco.behavior || 'random';
      make(4, () => {
        const size = rndSize(40, 70);
        const img = `<img src="${deco.src}" draggable="false" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35))">`;
        const b = behavior === 'random' ? ['top','bottom','left','right'][Math.floor(Math.random() * 4)] : behavior;
        const dur = rnd(10, 20), delay = rnd(-20, 0);
        if (b === 'top') {
          const left = rnd(0, 100);
          return el(img, `left:${left}%;width:${size}px;height:${size}px;--drift:${rnd(-40,40)}px;`
            + `animation:fx-fall ${dur}s linear ${delay}s infinite;`);
        } else if (b === 'bottom') {
          const left = rnd(0, 100);
          return el(img, `left:${left}%;width:${size}px;height:${size}px;--drift:${rnd(-30,30)}px;`
            + `animation:fx-egg-rise ${dur}s ease-in-out ${delay}s infinite;`);
        } else {
          const goingRight = b === 'right';
          const y = rnd(10, 85);
          const x0 = goingRight ? -10 : 110, x1 = goingRight ? 110 : -10;
          return el(img, `--x0:${x0}vw;--y0:${y}vh;--x1:${x1}vw;--y1:${y}vh;--face:0deg;`
            + `width:${size}px;height:${size}px;animation:fx-flypath ${rnd(18,32)}s linear ${delay}s infinite;`);
        }
      });
    });
}

function applyTheme_if564(_c) {
  const { fx, rnd, densify } = _c;
    // A real (if simplified) TCAS simulation — not decorative colors. Each
    // contact flies its OWN independent straight-line heading through the
    // area (like a real aircraft, not aimed at ownship) — range and closure
    // rate are DERIVED from its actual position/velocity, not simulated
    // directly, so paths look like traffic genuinely passing through rather
    // than everything converging on ownship and bouncing off it. State is
    // likewise derived from those values using real TCAS thresholds:
    //   Other Traffic      — hollow diamond: out past the proximate range
    //   Proximate Traffic  — filled diamond: closer, but no threat
    //   Traffic Advisory   — filled amber circle: only when actually CLOSING
    //                         (negative range rate) AND near co-altitude
    //   Resolution Advisory — filled red square: rare, only escalates from an
    //                         active TA that keeps closing past a tight range
    // Ownship sits at a fixed reference point (bottom-center, as on a real
    // nav display) — a hollow chevron here; the range rings (labeled) and
    // track line centered on that same point live in the CSS background.
    const OWN_X = 50, OWN_Y = 88;      // ownship position, % of screen
    const RANGE_SCALE = 7.5;           // vh per nm (abstract unit) — matches the CSS ring spacing
    const MAX_RANGE = 10, PROXIMATE_RANGE = 5.5, TA_RANGE = 3, RA_RANGE = 1.4;

    // Ownship — 3x the previous size, hollow (white outline, transparent
    // fill) via SVG stroke rather than a filled CSS border-triangle, which
    // can't produce a true outline-only shape.
    const own = document.createElement('div');
    own.className = 'fx-particle';
    own.style.cssText = `left:${OWN_X}%;top:${OWN_Y}%;width:0;height:0;`;
    own.innerHTML = `<svg width="48" height="42" viewBox="0 0 48 42" style="display:block;margin:-42px 0 0 -24px;filter:drop-shadow(0 0 4px rgba(255,255,255,0.5));">` +
      `<polygon points="24,0 44,42 24,32 4,42" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    fx.appendChild(own);

    // Labeled range rings, matching the CSS background's ring spacing.
    [2.5, 5, 7.5, 10].forEach(r => {
      const label = document.createElement('div');
      label.className = 'fx-particle';
      label.style.cssText = `left:${OWN_X}%;top:calc(${OWN_Y}% - ${(r * RANGE_SCALE).toFixed(1)}vh);` +
        `transform:translate(6px,-50%);font-family:monospace;font-size:10px;color:rgba(142,202,230,0.55);white-space:nowrap;`;
      label.textContent = r;
      fx.appendChild(label);
    });

    function applyShapeForState(shapeEl, state) {
      if (state === 'other') {
        shapeEl.style.cssText = `width:100%;height:100%;background:transparent;border:2px solid #8ecae6;transform:rotate(45deg);border-radius:2px;`;
      } else if (state === 'ta') {
        shapeEl.style.cssText = `width:100%;height:100%;background:#ffd23f;border-radius:50%;box-shadow:0 0 6px #ffd23f;`;
      } else if (state === 'ra') {
        shapeEl.style.cssText = `width:100%;height:100%;background:#ff4444;border-radius:2px;box-shadow:0 0 8px #ff4444;animation:fx-ra-pulse 0.8s ease-in-out infinite;`;
      } else { // proximate
        shapeEl.style.cssText = `width:100%;height:100%;background:#e8f4ff;transform:rotate(45deg);border-radius:2px;`;
      }
    }
    const tagColor = { other:'#8ecae6', proximate:'#e8f4ff', ta:'#ffd23f', ra:'#ff4444' };

    // Spawns a contact at the edge of the range rings with a fully independent
    // random heading — NOT aimed at or away from ownship, matching how real
    // traffic actually behaves; most of it is just passing through the area
    // on its own course, not flying at each other.
    function spawnContact() {
      const bearing0 = rnd(-90, 90), range0 = rnd(6, MAX_RANGE);
      const rad0 = bearing0 * Math.PI / 180;
      const heading = rnd(0, 360), speed = rnd(0.12, 0.35);
      const hRad = heading * Math.PI / 180;
      return {
        x: range0 * Math.sin(rad0), y: -range0 * Math.cos(rad0),
        vx: speed * Math.sin(hRad), vy: -speed * Math.cos(hRad),
        alt: Math.round(rnd(-8, 8)), altStep: Math.random() < 0.5 ? -1 : 1,
        state: 'other',
      };
    }

    for (let i = 0; i < densify(5); i++) {
      const contactEl = document.createElement('div');
      contactEl.className = 'fx-particle';
      contactEl.style.cssText = `width:14px;height:14px;transition:left 1.6s linear, top 1.6s linear;`;
      contactEl.innerHTML = `<div class="tcas-shape" style="width:100%;height:100%"></div>` +
        `<div class="tcas-tag" style="position:absolute;top:100%;left:50%;transform:translateX(-50%);` +
        `font-family:monospace;font-size:10px;white-space:nowrap;margin-top:2px;font-weight:600"></div>`;
      fx.appendChild(contactEl);
      const shapeEl = contactEl.querySelector('.tcas-shape');
      const tagEl = contactEl.querySelector('.tcas-tag');
      let c = spawnContact();
      let lastTickAt = performance.now();

      const tick = () => {
        const now = performance.now();
        // Glide duration tracks the ACTUAL elapsed time since the last tick,
        // not a hardcoded 1.6s to match setInterval's nominal period. Real
        // hardware confirmed this matters: setInterval doesn't fire at an
        // exact, jitter-free 1600ms — if the page's main thread is briefly
        // busy with anything else (another widget refreshing, a DOM update
        // elsewhere), a tick can fire late, by which point the PREVIOUS
        // fixed-1.6s transition had already finished, leaving the contact
        // sitting motionless until the late tick finally arrives. That
        // stop-and-go is exactly the "goes fast, then halts, then slow
        // again" pattern reported — the halts were real dead time with
        // nothing animating, then the following transition (still fixed at
        // 1.6s for however far it had to go) reads as catching up.
        const elapsedSec = Math.max(0.05, Math.min(4, (now - lastTickAt) / 1000));
        lastTickAt = now;

        c.x += c.vx; c.y += c.vy;
        const range = Math.sqrt(c.x * c.x + c.y * c.y);
        // Flown well past the display, or too far to the side — give it a
        // fresh random spawn, like a new contact entering the area, rather
        // than tracking it forever as it recedes into the distance. This is
        // a genuinely NEW contact appearing, not the same one moving — snap
        // instantly to its new position instead of letting the CSS
        // transition visibly drag it there, which otherwise looked like the
        // contact suddenly flying at high speed across the whole display.
        let justRespawned = false;
        if (range > MAX_RANGE + 3) { c = spawnContact(); justRespawned = true; }
        // Radial closure rate computed from actual position/velocity — how
        // fast range is genuinely changing given this contact's real course,
        // not an independently-chosen number.
        const closureRate = range > 0.01 ? (c.x * c.vx + c.y * c.vy) / range : 0;

        c.alt += c.altStep;
        if (c.alt >= 9) { c.alt = 9; c.altStep = -1; }
        if (c.alt <= -9) { c.alt = -9; c.altStep = 1; }

        // Range + altitude alone decide TA/RA — deliberately NOT also
        // requiring "closing" here. A contact sampled once every 1.6s can
        // genuinely be very close and co-altitude at the exact moment its
        // radial closure rate reads near zero (right around its closest
        // point of approach on a grazing path, where closure rate crosses
        // through zero by definition) — real hardware confirmed contacts
        // visibly passing close to ownship without ever registering as a TA
        // or RA. If it's this close and co-altitude, it alerts, regardless
        // of which way it happens to be moving at the instant it's sampled.
        const coAltitude = Math.abs(c.alt) <= 3;
        if (range <= RA_RANGE && coAltitude) {
          c.state = 'ra';
        } else if (range <= TA_RANGE && coAltitude) {
          c.state = 'ta';
        } else if (range <= PROXIMATE_RANGE) {
          c.state = 'proximate';
        } else {
          c.state = 'other';
        }

        if (justRespawned) contactEl.style.transition = 'none';
        contactEl.style.left = `calc(${OWN_X}% + ${(c.x * RANGE_SCALE).toFixed(1)}vh)`;
        contactEl.style.top = `calc(${OWN_Y}% + ${(c.y * RANGE_SCALE).toFixed(1)}vh)`;
        if (justRespawned) {
          // Force the browser to apply the position change before restoring
          // the transition, or the "none" would never actually take effect —
          // reading offsetHeight forces a layout flush.
          void contactEl.offsetHeight;
          contactEl.style.transition = `left ${elapsedSec}s linear, top ${elapsedSec}s linear`;
        } else {
          contactEl.style.transitionDuration = `${elapsedSec}s`;
        }
        applyShapeForState(shapeEl, c.state);
        // Every contact shows its altitude now, not just proximate/TA/RA —
        // real TCAS traffic symbols always carry an altitude tag; only the
        // color (muted for ordinary traffic, escalating through amber/red)
        // should change with state, not whether the tag is there at all.
        tagEl.style.color = tagColor[c.state];
        tagEl.textContent = (c.alt >= 0 ? '+' : '-') + String(Math.abs(c.alt)).padStart(2,'0');
      };
      tick();
      _tcasIntervals.push(setInterval(tick, 1600));
    }
}
