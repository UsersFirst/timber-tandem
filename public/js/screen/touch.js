// @ts-check
// ============================================================
// touch — Solo on just your phone (docs/TOUCH-SOLO.md)
// ============================================================
// Thumbs on the saw. The pads drive seat A exactly like the keyboard does
// (game.key → HoldPull), plus analog steering (game.touchSteer). Sideways only.
//   left thumb   the saw pad: hold to pull, let go when Grandma pulls;
//                in the notch, tap to chop on your turn
//   right thumb  the steer pad: hold the knob on the target against the
//                tree's pull (§4a); lift and it slides off to the pull side
// The pad's edge shows the beat (the thumb hides the middle); the beat
// tracks up top show each pull as an oval. Also: the rotate card, haptics (Android), Wake Lock, fullscreen +
// landscape lock (Android), and iPhone audio through the silent switch.
// ============================================================

import { MAX_FALL_DEG, PRIVY_DEG } from '../core/tree.js';

/** Does this device play by touch (a phone or tablet, no mouse)? */
export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches;
}

/** A lean of -1..1 → 0..100% along the steer track. @param {number} lean */
const pct = (lean) => ((Math.max(-1, Math.min(1, lean)) + 1) / 2) * 100;

const HTML = `
  <div id="tp-saw" class="tp-pad" role="button" aria-label="Saw: hold to pull">
    <svg class="tp-ring" preserveAspectRatio="none"><rect pathLength="100" rx="22" ry="22"/></svg>
    <div class="tp-glyph">W</div>
    <div class="tp-big"></div>
    <div class="tp-sub"></div>
  </div>
  <div id="tp-steer" class="tp-pad" role="slider" aria-label="Steer">
    <div class="tp-lbl"></div>
    <div class="tp-track"><i class="tp-privy"></i><div class="tp-band"></div><div class="tp-knob"></div></div>
    <div class="tp-pullarrow"></div>
    <div class="tp-ends"><span></span><span>privy ›</span></div>
  </div>
  <div id="tp-coach"></div>`;

export class TouchPads {
  /**
   * @param {{game: any, seat?: 'A'|'B', onPause?: () => void}} o
   */
  constructor(o) {
    this.game = o.game;
    this.seat = o.seat || 'A';
    this.on = false;
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.hidden = true;
    this.el.innerHTML = HTML;
    document.body.appendChild(this.el);
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (this.el.querySelector(s));
    this.saw = q('#tp-saw');
    this.steer = q('#tp-steer');
    this.track = q('.tp-track');
    this.knob = q('.tp-knob');
    this.band = q('.tp-band');
    this.privy = q('.tp-privy');
    this.ring = /** @type {SVGRectElement} */ (/** @type {unknown} */ (q('.tp-ring rect')));
    this.big = q('#tp-saw .tp-big');
    this.sub = q('#tp-saw .tp-sub');
    this.glyph = q('#tp-saw .tp-glyph');
    this.lbl = q('#tp-steer .tp-lbl');
    this.arrow = q('.tp-pullarrow');
    this.coach = q('#tp-coach');
    this.phase = '';
    this.sawDown = /** @type {number|null} */ (null);
    this.steerId = /** @type {number|null} */ (null);
    this.wake = /** @type {any} */ (null);
    this._bind();
    this.privy.style.left = pct(PRIVY_DEG / MAX_FALL_DEG) + '%';
    // The beat ring hugs the saw pad, whatever size the screen makes it.
    const fit = () => {
      const r = this.saw.getBoundingClientRect();
      const set = (/** @type {string} */ k, /** @type {number} */ val) => this.ring.setAttribute(k, String(Math.max(0, Math.round(val))));
      set('x', 3); set('y', 3); set('width', r.width + 10); set('height', r.height + 10);
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(this.saw);
  }

  /** Start touch play (call from the Solo tap: it's the user gesture). */
  start() {
    this.on = true;
    document.documentElement.dataset.touch = '';
    this.el.hidden = false;
    // iPhone: play through the silent switch, like a video (Safari 17+).
    try { const s = /** @type {any} */ (navigator).audioSession; if (s) s.type = 'playback'; } catch { /* older Safari */ }
    // Android: full screen, locked sideways. iPhone Safari has neither; the
    // rotate card and safe-area insets cover it.
    const de = /** @type {any} */ (document.documentElement);
    if (de.requestFullscreen && !document.fullscreenElement) {
      de.requestFullscreen({ navigationUI: 'hide' })
        .then(() => /** @type {any} */ (screen.orientation)?.lock?.('landscape'))
        .catch(() => { /* not allowed here */ });
    }
    this._wakeLock();
    // No Esc key on a phone.
    const pb = /** @type {any} */ (document.getElementById('pause-btn'));
    if (pb) { this._pauseSub = pb.sub; pb.sub = ''; }
  }

  stop() {
    this.on = false;
    delete document.documentElement.dataset.touch;
    this.el.hidden = true;
    this._release();
    const pb = /** @type {any} */ (document.getElementById('pause-btn'));
    if (pb && this._pauseSub !== undefined) pb.sub = this._pauseSub;
    try { this.wake?.release(); } catch { /* gone */ }
    this.wake = null;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }

  async _wakeLock() {
    try { this.wake = await /** @type {any} */ (navigator).wakeLock?.request('screen'); } catch { /* not allowed */ }
  }

  _bind() {
    // Saw pad: hold to pull (pointer capture: sliding off still counts as held).
    this.saw.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { this.saw.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
      this.sawDown = ev.pointerId;
      if (this.phase === 'notch') { this.game.key(this.seat, 'chop', true); this.saw.classList.add('down'); return; }
      this.game.key(this.seat, 'pull', true);
      this.saw.classList.add('down');
    });
    const sawUp = (/** @type {PointerEvent} */ ev) => {
      if (ev.pointerId !== this.sawDown) return;
      this.sawDown = null;
      this.saw.classList.remove('down');
      this.game.key(this.seat, 'pull', false);
    };
    this.saw.addEventListener('pointerup', sawUp);
    this.saw.addEventListener('pointercancel', sawUp);

    // Steer pad: the thumb's place along the track, -1..1.
    const steerAt = (/** @type {PointerEvent} */ ev) => {
      const r = this.track.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      this.game.touchSteer(this.seat, x);
    };
    this.steer.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try { this.steer.setPointerCapture(ev.pointerId); } catch { /* synthetic */ }
      this.steerId = ev.pointerId;
      this.steer.classList.add('down');
      steerAt(ev);
    });
    this.steer.addEventListener('pointermove', (ev) => { if (ev.pointerId === this.steerId) steerAt(ev); });
    const steerUp = (/** @type {PointerEvent} */ ev) => {
      if (ev.pointerId !== this.steerId) return;
      this.steerId = null;
      this.steer.classList.remove('down');
      this.game.touchSteer(this.seat, 0);
    };
    this.steer.addEventListener('pointerup', steerUp);
    this.steer.addEventListener('pointercancel', steerUp);
    // No long-press menu or text selection on the pads.
    this.el.addEventListener('contextmenu', (ev) => ev.preventDefault());

    this.portrait = matchMedia('(orientation: portrait)');
    this.wasPortrait = false;
    document.addEventListener('visibilitychange', () => {
      if (this.on && document.visibilityState === 'visible' && !this.wake) this._wakeLock();
      if (document.visibilityState === 'hidden') this._release();
    });
  }

  /** Let go of everything (a phase change, the tab hiding). */
  _release() {
    if (this.sawDown !== null) { this.sawDown = null; this.saw.classList.remove('down'); this.game.key(this.seat, 'pull', false); }
    if (this.steerId !== null) { this.steerId = null; this.steer.classList.remove('down'); this.game.touchSteer(this.seat, 0); }
  }

  /** Haptics on game events (Android; iPhone Safari has no vibration). @param {any} ev */
  event(ev) {
    if (!this.on || !navigator.vibrate) return;
    try {
      if (ev.k === 'bite') navigator.vibrate(10);
      else if (ev.k === 'tantrum') navigator.vibrate([40, 30, 40]);
      else if (ev.k === 'hit' && ev.seat === this.seat) navigator.vibrate(15);
    } catch { /* blocked */ }
  }

  /** @param {any} v the game view @param {number} nowH */
  frame(v, nowH) {
    if (!this.on || !v) return;
    if (v.phase !== this.phase) {
      if (this.phase === 'saw' || this.phase === 'notch') this._release();
      this.phase = v.phase;
      document.documentElement.dataset.tphase = v.phase;
    }
    // Turned upright mid-game: pause once (the rotate card says why).
    const upright = this.portrait.matches;
    if (upright && !this.wasPortrait && (v.phase === 'notch' || v.phase === 'saw') && !v.held) {
      this._release();
      this.game.pause();
      this.wasPortrait = true; // once per time it's upright: Resume works while still upright
    }
    if (!upright) this.wasPortrait = false;
    const notch = v.phase === 'notch';
    const saw = v.phase === 'saw';
    const live = (notch || saw) && !v.held;
    this.el.classList.toggle('live', live);
    this.saw.hidden = !(notch || saw || v.phase === 'notch-done');
    this.steer.hidden = !saw;

    // Saw pad: what to do now, from the beat. A's pull lands on odd beats, so
    // you hold from Grandma's beat (even) to yours (odd), then let go.
    const beatMs = v.song ? 60000 / v.song.bpm : 625;
    const bp = v.song ? (nowH - v.song.startH) / beatMs : NaN;
    const mineOdd = this.seat === 'A';
    const k = Math.floor(bp);
    const holdNow = Number.isFinite(bp) && bp >= 0 && (mineOdd ? k % 2 === 0 : k % 2 === 1);
    const frac = Number.isFinite(bp) && bp >= 0 ? bp - k : 0;
    if (notch) {
      const mine = v.litFace === this.seat;
      this.saw.classList.toggle('lit', mine);
      this.saw.classList.toggle('dim', !mine);
      this.glyph.textContent = '🪓';
      this.big.textContent = mine ? 'TAP to chop' : 'Grandma…';
      this.sub.textContent = mine ? 'your face is glowing' : 'her turn';
      this.ring.style.strokeDasharray = mine ? '100 0' : '0 100';
    } else {
      this.saw.classList.remove('lit', 'dim');
      this.glyph.textContent = 'W';
      const ready = saw && Number.isFinite(bp) && bp >= 0;
      this.big.textContent = !ready ? 'Get ready' : holdNow ? 'HOLD' : 'LET GO';
      this.sub.textContent = !ready ? 'hold to pull' : holdNow ? 'pull it to you' : 'Grandma pulls back';
      this.saw.classList.toggle('hold-now', ready && holdNow);
      // The edge fills through each beat of your hold.
      const p = ready && holdNow ? Math.round(frac * 100) : 0;
      this.ring.style.strokeDasharray = `${p} ${100 - p}`;
    }

    // Steer pad.
    if (saw) {
      const roll = v.rolls?.[this.seat] ?? 0;
      const target = (v.targetDeg ?? 0) / MAX_FALL_DEG;
      this.knob.style.left = pct(roll) + '%';
      this.band.style.left = pct(target) + '%';
      const onTarget = v.aimGrade === 'skid';
      const pullOn = Math.abs(v.pull || 0) > 0.02;
      this.steer.classList.toggle('on', onTarget && !v.coach);
      this.steer.classList.toggle('privy', v.aimGrade === 'privy');
      this.steer.classList.toggle('dim', !!v.coach);
      this.lbl.textContent = v.coach ? 'STEER · in a moment' : onTarget ? 'ON TARGET · hold it there' : v.aimGrade === 'privy' ? 'THE PRIVY! · steer away' : 'STEER · aim at the green';
      this.arrow.textContent = !pullOn ? '' : v.pull < 0 ? '◀◀ the tree pulls' : 'the tree pulls ▶▶';
      this.arrow.style.textAlign = v.pull < 0 ? 'left' : 'right';
    }

    // The first-strokes coach.
    this.coach.hidden = !v.coach;
    if (v.coach) this.coach.innerHTML = holdNow ? 'Hold… <small>for as long as your orange oval</small>' : '…then let go — <span>Grandma pulls back</span>. <small>Three strokes, then you steer.</small>';
  }
}
