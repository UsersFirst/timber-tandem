// @ts-check
// ============================================================
// hud — everything drawn over the 3D scene (PLAN §4.8)
// ============================================================
// The blade widget: A's handle on the left, B's on the right, in their seat
// colors; the blade slides with s and bows with e; the green and red lines
// are drawn on it; the blamed handle glows. Under it: the two-lane beat strip
// (A lands pulled on odd beats, B on even), the cut-depth bar, the steering
// dial. Plus captions, toasts, the lobby, calibration and the score card.
// Renders only from the view + events, so host and guest screens match.
// ============================================================

import { SAW, targetS } from '../core/saw-model.js';
import { SEATS, CODE_PREFIX } from '../core/protocol.js';
import { MAX_FALL_DEG } from '../core/tree.js';

const COLOR = { A: SEATS[0].color, B: SEATS[1].color };
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

export class Hud {
  /** @param {{onAction:(a:string, arg?:any)=>void, role:'host'|'guest'}} o */
  constructor(o) {
    this.onAction = o.onAction;
    this.role = o.role;
    this.blade = /** @type {HTMLCanvasElement} */ ($('blade'));
    this.beat = /** @type {HTMLCanvasElement} */ ($('beats'));
    this.hands = /** @type {HTMLCanvasElement} */ ($('hands'));
    this.calibHands = /** @type {HTMLCanvasElement} */ ($('calib-hands'));
    this.bctx = /** @type {CanvasRenderingContext2D} */ (this.blade.getContext('2d'));
    this.sctx = /** @type {CanvasRenderingContext2D} */ (this.beat.getContext('2d'));
    /** @type {{seat:'A'|'B', at:number}[]} */
    this.revs = [];
    this.flash = { A: 0, B: 0, bite: 0, tantrum: 0 };
    this.lastLobby = '';
    this.lastCalib = '';
    this.toastTimer = 0;
    /** A guest screen's own phone link for seat B. */
    this.guestLink = '';
    /** Goose names by seat, from the view. */
    this.names = { A: 'Sir Winston', B: 'Lady Victoria' };
    this._lastPhase = '';
    this.captionTimer = 0;
    document.addEventListener('click', (ev) => {
      const el = /** @type {HTMLElement} */ (ev.target)?.closest?.('[data-action]');
      if (el) this.onAction(/** @type {string} */ (el.getAttribute('data-action')), el.getAttribute('data-arg'));
    });
  }

  // ---------------- events ----------------

  /** @param {any} ev */
  event(ev) {
    switch (ev.k) {
      case 'rev':
        // Only the pull end (the hand reaching the belly) marks the strip: in
        // perfect alternation A's pull end and B's forward end coincide, and
        // drawing both would read as "you both pulled at once".
        if (ev.end === 1) { this.revs.push({ seat: ev.seat, at: ev.at }); if (this.revs.length > 40) this.revs.shift(); }
        break;
      case 'turn': {
        const name = this.names[ev.seat] || ev.seat;
        this.toast(name + ' — chop!', 'turn', COLOR[ev.seat]);
        break;
      }
      case 'bite': this.flash.bite = 1; break;
      case 'tantrum':
        this.flash.tantrum = 1;
        if (ev.blame) this.flash[ev.blame] = 1;
        // High and smaller: Old Misery's curse bubble owns the middle of the shot.
        this.toast('TANTRUM!', document.documentElement.dataset.noscene ? 'bad' : 'tantrum');
        this.logoTantrum();
        break;
      case 'chatter': this.toast('chatter…', 'soft'); break;
      case 'caption': this.showCaption(ev.who, ev.text, ev.holdMs); break;
      case 'fall': setTimeout(() => this.toast('TIMBER!', 'big'), 900); break;
      case 'score': this.showScore(ev.score, ev.last); break;
      case 'end': this.showEnd(ev.scores); break;
      case 'phase':
        document.documentElement.dataset.phase = ev.phase;
        if (ev.phase !== 'score') $('score').hidden = true;
        if (ev.phase !== 'end') $('end').hidden = true;
        break;
      case 'tree': if (ev.name) this.toast(ev.name, 'title'); break;
      case 'hit':
        if (ev.result === 'chip') this.toast('chip — not your turn', 'soft');
        if (ev.result === 'clang') this.toast('CLANG!', 'bad');
        if (ev.result === 'glance') this.toast('glancing — chop right on the glowing face', 'soft');
        break;
      case 'paused': $('paused').hidden = !ev.on; break;
      default:
    }
  }

  /** @param {string} text @param {'bad'|'soft'|'big'|'title'|'turn'|'tantrum'} kind @param {string} [color] */
  toast(text, kind, color) {
    const el = $('toast');
    el.textContent = text;
    el.style.color = color || '';
    el.className = 'toast show ' + kind;
    clearTimeout(this.toastTimer);
    this.toastTimer = /** @type {any} */ (setTimeout(() => { el.className = 'toast ' + kind; }, kind === 'big' ? 2200 : kind === 'title' ? 1800 : 1100));
  }

  logoTantrum() {
    const el = $('logo-word');
    el.textContent = 'TANTRUM';
    el.classList.add('tantrum');
    setTimeout(() => { el.textContent = 'TANDEM'; el.classList.remove('tantrum'); }, 1200);
  }

  /** @param {string} who @param {string} text @param {number} holdMs */
  showCaption(who, text, holdMs = 3500) {
    const el = $('caption');
    $('caption-who').textContent = who;
    $('caption-text').textContent = text;
    el.classList.add('show');
    clearTimeout(this.captionTimer);
    this.captionTimer = /** @type {any} */ (setTimeout(() => el.classList.remove('show'), holdMs));
  }

  // ---------------- per frame ----------------

  /** @param {any} v the view @param {number} nowH host-clock now @param {number} dtMs */
  frame(v, nowH, dtMs) {
    if (!v || !v.phase) return;
    for (const s of v.seats || []) this.names[s.id] = s.name;
    $('safety').hidden = v.phase !== 'safety';
    /** @type {any} */ ($('safety-ok')).hidden = this.role !== 'host';
    const playing = v.phase === 'notch' || v.phase === 'saw' || v.phase === 'notch-done';
    $('hud').hidden = !(playing || v.phase === 'fall');
    const falling = v.phase === 'fall';
    for (const sel of ['.bottom', '.dial', '.temper']) /** @type {HTMLElement} */ (document.querySelector(sel)).style.visibility = falling ? 'hidden' : 'visible';
    if (v.phase === 'lobby' && v.lobby) this.renderLobby(v.lobby);
    $('lobby').hidden = v.phase !== 'lobby';
    if (v.phase === 'calibrate' && v.calib) this.renderCalib(v.calib);
    $('calib').hidden = v.phase !== 'calibrate';
    const lessonSaw = v.phase === 'calibrate' && v.calib?.step === 'saw';
    this.calibHands.hidden = !lessonSaw;
    if (lessonSaw) this.drawHands(this.calibHands, v);
    $('held').hidden = !v.held;
    if (v.held) this.renderHeld(v.menu || []);
    /** @type {any} */ ($('pause-btn')).hidden = this.role !== 'host' || v.held || !(v.phase === 'notch' || v.phase === 'saw');
    $('intro-skip').hidden = v.phase !== 'intro' || this.role !== 'host';
    if (!playing && v.phase !== 'fall') return;

    $('tree-name').textContent = `${v.tree} · ${v.phase === 'notch' ? 'Notch' : v.phase === 'saw' ? 'Back cut' : v.phase === 'fall' ? 'TIMBER!' : 'Notch done'}`;
    $('temper').textContent = String(v.temper);
    /** @type {HTMLElement} */ ($('temper-bar')).style.width = v.temper + '%';
    $('tantrums').textContent = String(v.tantrums);
    $('streak').textContent = v.streak > 2 ? `${v.streak} clean strokes in a row` : '';
    /** @type {HTMLElement} */ ($('cut-fill')).style.height = Math.round((v.phase === 'notch' || v.phase === 'notch-done' ? v.notchFrac : v.cutFrac) * 100) + '%';
    $('cut-label').textContent = v.phase === 'notch' ? `notch ${Math.round(v.notchFrac * 100)}%` : `${v.bites}/${v.bitesNeeded}`;
    $('turn').textContent = v.phase === 'notch' && v.litFace ? `${v.seats.find((s) => s.id === v.litFace)?.name}’s turn` : '';
    /** @type {HTMLElement} */ ($('turn')).style.color = v.litFace ? COLOR[v.litFace] : '';

    for (const k of /** @type {const} */ (['A', 'B', 'bite', 'tantrum'])) this.flash[k] = Math.max(0, this.flash[k] - dtMs / 450);
    /** @type {HTMLElement} */ ($('beats')).style.visibility = v.phase === 'saw' && !v.silentSong ? 'visible' : 'hidden';
    if (v.phase === 'saw') this.drawBlade(v); else this.drawNotch(v);
    this.hands.style.display = v.phase === 'saw' ? 'block' : 'none';
    if (v.phase === 'saw') this.drawHands(this.hands, v);
    this.drawBeats(v, nowH);
    this.drawDial(v);
  }

  /** The blade widget. */
  drawBlade(v) {
    const c = this.blade, g = this.bctx;
    const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = c.clientHeight * devicePixelRatio);
    g.clearRect(0, 0, W, H);
    const k = devicePixelRatio;
    const midY = H * 0.5, bladeLen = W * 0.62, travel = W * 0.09;
    const cx = W / 2 - v.s * travel; // s = +1 slides toward A (left)
    const x0 = cx - bladeLen / 2, x1 = cx + bladeLen / 2;
    const e = v.e;
    // Bow: compression bows the blade up; tension pulls it straight with a buzz.
    const bow = e < 0 ? Math.min(1, -e / SAW.RED) * H * 0.34 : 0;
    const buzz = e > SAW.GREEN ? Math.sin(performance.now() / 18) * Math.min(1, e / SAW.RED) * 3 * k : 0;
    const zoneCol = v.zone === 'green' ? '#7ee08a' : v.zone === 'amber' ? '#f2b24c' : '#ff5a4a';

    // Strain scale behind the blade: green band and red lines (|e| marks).
    g.save();
    g.globalAlpha = 0.9;
    const bandY = (frac) => midY - frac * H * 0.34;
    g.fillStyle = 'rgba(126,224,138,.10)';
    g.fillRect(x0, bandY(SAW.GREEN / SAW.RED), bladeLen, (SAW.GREEN / SAW.RED) * H * 0.34);
    g.setLineDash([6 * k, 6 * k]);
    g.lineWidth = 2 * k;
    g.strokeStyle = 'rgba(126,224,138,.9)';
    line(g, x0, bandY(SAW.GREEN / SAW.RED), x1, bandY(SAW.GREEN / SAW.RED));
    g.strokeStyle = 'rgba(255,90,74,.9)';
    line(g, x0, bandY(1), x1, bandY(1));
    g.setLineDash([]);
    g.restore();

    // Tension: the blade is pulled thin and red stops appear at both ends.
    const tension = e > 0 ? Math.min(1, e / SAW.RED) : 0;
    // The bow peaks toward the hand that's making it worse (PLAN §4.3).
    const peakAt = v.blame === 'A' ? 0.3 : v.blame === 'B' ? 0.7 : 0.5;
    // The blade: a steel band with teeth on the bottom edge.
    g.save();
    g.translate(0, buzz);
    const steps = 40;
    const bowShape = (u) => (u <= peakAt ? Math.sin((Math.PI / 2) * (u / peakAt)) : Math.sin((Math.PI / 2) * ((1 - u) / (1 - peakAt))));
    const yAt = (i) => midY - bowShape(i / steps) * bow;
    const thick = (1 - 0.55 * tension) * 7 * k;
    g.beginPath();
    for (let i = 0; i <= steps; i++) g.lineTo(x0 + (bladeLen * i) / steps, yAt(i) - thick);
    for (let i = steps; i >= 0; i--) {
      const x = x0 + (bladeLen * i) / steps;
      const tooth = i % 2 === 0 ? 9 * k : 4 * k;
      g.lineTo(x, yAt(i) + tooth);
    }
    g.closePath();
    const grad = g.createLinearGradient(0, midY - 10 * k, 0, midY + 10 * k);
    grad.addColorStop(0, '#e9eef2'); grad.addColorStop(1, '#8b97a1');
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 3 * k;
    g.strokeStyle = zoneCol;
    g.globalAlpha = 0.55 + 0.45 * Math.min(1, Math.abs(e) / SAW.GREEN);
    g.stroke();
    g.restore();
    if (tension > 0.3) {
      g.fillStyle = '#ff5a4a';
      g.globalAlpha = Math.min(1, (tension - 0.3) * 2);
      for (const x of [x0 + 6 * k, x1 - 10 * k]) g.fillRect(x, midY - 20 * k, 4 * k, 40 * k);
      g.globalAlpha = 1;
    }

    // Handles.
    for (const id of /** @type {const} */ (['A', 'B'])) {
      const x = id === 'A' ? x0 : x1;
      const y = midY - 0;
      const glow = this.flash[id];
      g.save();
      if (glow > 0) { g.shadowColor = '#ff5a4a'; g.shadowBlur = 26 * k * Math.min(1, glow); }
      g.fillStyle = COLOR[id];
      roundRect(g, x + (id === 'A' ? -46 * k : 0), y - 22 * k, 46 * k, 44 * k, 12 * k);
      g.fill();
      g.restore();
      g.fillStyle = '#1b1410';
      g.font = `800 ${24 * k}px Georgia, serif`;
      g.textAlign = 'center';
      g.fillText((this.names[id] || id).replace(/^(Sir|Lady) /, '')[0], x + (id === 'A' ? -23 * k : 23 * k), y + 9 * k);
    }

    // The word that matters, big enough for the couch.
    const label = v.zone === 'green' ? (v.streak > 2 ? 'singing' : '') : e < 0 ? 'PUSH — let it go' : 'TUG — both pulling';
    if (label) {
      g.font = `800 ${v.zone === 'green' ? 20 * k : 30 * k}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = v.zone === 'green' ? 'rgba(126,224,138,.9)' : zoneCol;
      g.fillText(label, W / 2, H - 4 * k);
    }
    if (this.flash.bite > 0) {
      g.globalAlpha = this.flash.bite;
      g.fillStyle = '#f6d28b';
      g.beginPath(); g.arc(W / 2, midY + 14 * k, (10 + 16 * (1 - this.flash.bite)) * k, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  }

  /**
   * The hand cues, one under each goose (A left, B right): the word for what
   * that hand should do now (BACK = pull to your belly, FORWARD = let it go
   * toward the tree), a ring where the hand should be on the beat, and a dot
   * where the phone says it is. The two hands always move opposite ways; on
   * the TV both dots slide the same way as the blade.
   * @param {HTMLCanvasElement} c @param {any} v
   */
  drawHands(c, v) {
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = c.clientHeight * devicePixelRatio);
    g.clearRect(0, 0, W, H);
    const hands = v.hands;
    if (!hands) return;
    const k = devicePixelRatio;
    const bp = hands.bp;
    const ts = bp === null || bp === undefined || bp < 0 ? null : targetS(bp);
    const R = W * 0.11, railY = H * 0.68;
    for (const id of /** @type {const} */ (['A', 'B'])) {
      const cx = id === 'A' ? W * 0.2 : W * 0.8;
      // Screen side of "back": A pulls toward the left, B toward the right.
      const backDir = id === 'A' ? -1 : 1;
      const xOf = (p) => cx + backDir * p * R;
      // Rail with its two ends named.
      g.strokeStyle = 'rgba(255,255,255,.25)';
      g.lineWidth = 3 * k;
      line(g, cx - R, railY, cx + R, railY);
      g.font = `600 ${11 * k}px system-ui, sans-serif`;
      g.fillStyle = 'rgba(246,234,216,.6)';
      g.textBaseline = 'middle';
      g.textAlign = backDir < 0 ? 'right' : 'left';
      g.fillText('back', cx + backDir * (R + 8 * k), railY);
      g.textAlign = backDir < 0 ? 'left' : 'right';
      g.fillText('fwd', cx - backDir * (R + 8 * k), railY);
      // Where this hand should be, and the word for where it's going.
      let word = '';
      if (ts !== null) {
        const want = id === 'A' ? ts : -ts;
        g.strokeStyle = '#fff';
        g.lineWidth = 2.5 * k;
        g.beginPath(); g.arc(xOf(want), railY, 12 * k, 0, Math.PI * 2); g.stroke();
        // A heads back on beats 2k→2k+1, B on 2k+1→2k+2.
        const phase = ((Math.floor(bp) % 2) + 2) % 2;
        const goingBack = id === 'A' ? phase === 0 : phase === 1;
        word = goingBack ? 'BACK' : 'FORWARD';
      }
      // Where the phone says the hand is.
      const p = Math.max(-1, Math.min(1, hands[id] ?? -1));
      g.fillStyle = COLOR[id];
      g.beginPath(); g.arc(xOf(p), railY, 8 * k, 0, Math.PI * 2); g.fill();
      if (word) {
        g.font = `900 ${22 * k}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.fillStyle = COLOR[id];
        const arrow = (word === 'BACK') === (backDir < 0) ? '← ' : '';
        const arrowR = arrow ? '' : ' →';
        g.fillText(arrow + word + arrowR, cx, H * 0.36);
      }
    }
    g.textBaseline = 'alphabetic';
  }

  /** The pause sheet on the TV: the same choices as the phones (minus the phone-only ones). @param {any[]} items */
  renderHeld(items) {
    const key = JSON.stringify(items) + this.role;
    if (key === this._heldKey) return;
    this._heldKey = key;
    $('held-actions').innerHTML = this.role !== 'host' ? '<div class="muted">Paused by the other home.</div>'
      : items.filter((i) => !i.local).map((i) => `<uf-button data-action="menu" data-arg="${esc(i.id)}" label="${esc(i.label)}" variant="${i.primary ? 'accent' : 'ghost'}" size="lg"></uf-button>`).join('');
  }

  /** The notch widget: two faces, the lit one glows in its player's color. */
  drawNotch(v) {
    const c = this.blade, g = this.bctx;
    const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = c.clientHeight * devicePixelRatio);
    g.clearRect(0, 0, W, H);
    if (v.phase === 'fall') return;
    const k = devicePixelRatio, cx = W / 2, cy = H * 0.5, r = H * 0.38;
    const open = v.notchFrac;
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 160);
    for (const id of /** @type {const} */ (['A', 'B'])) {
      const dir = id === 'A' ? -1 : 1;
      const lit = v.litFace === id;
      // A wedge face: the notch opens toward the middle as it deepens.
      g.beginPath();
      g.moveTo(cx + dir * 12 * k, cy);
      g.lineTo(cx + dir * (12 * k + r * 2.2), cy - r * (0.35 + 0.65 * open));
      g.lineTo(cx + dir * (12 * k + r * 2.2), cy + r * 0.2);
      g.closePath();
      g.fillStyle = lit ? COLOR[id] : 'rgba(246,234,216,.16)';
      g.globalAlpha = lit ? pulse : 1;
      g.fill();
      g.globalAlpha = 1;
      const name = v.seats?.find((s) => s.id === id)?.name || id;
      g.font = `700 ${15 * k}px system-ui, sans-serif`;
      g.textAlign = id === 'A' ? 'right' : 'left';
      g.fillStyle = lit ? '#fff' : 'rgba(246,234,216,.55)';
      g.fillText(lit ? name + ' — chop!' : name, cx + dir * (24 * k + r * 2.4), cy + 6 * k);
    }
    // Progress pips under the faces.
    const n = Math.max(1, Math.round(v.notchSteps || 6)), done = Math.round(open * n);
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(cx + (i - (n - 1) / 2) * 22 * k, H - 12 * k, 6 * k, 0, Math.PI * 2);
      g.fillStyle = i < done ? '#f2b24c' : 'rgba(246,234,216,.2)';
      g.fill();
    }
  }

  /** The two-lane beat strip: A pulls on odd beats, B on even; dots = actual pulls. */
  drawBeats(v, nowH) {
    const c = this.beat, g = this.sctx;
    const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = c.clientHeight * devicePixelRatio);
    g.clearRect(0, 0, W, H);
    if (!v.song) return;
    const k = devicePixelRatio;
    const beatMs = 60000 / v.song.bpm;
    const gutter = W * 0.15; // lane names live here
    const nowX = gutter + W * 0.12, pxPerMs = (W * 0.7) / (4 * beatMs);
    const bp = (nowH - v.song.startH) / beatMs;
    const lane = { A: H * 0.32, B: H * 0.72 };
    g.strokeStyle = 'rgba(255,255,255,.15)';
    g.lineWidth = 1 * k;
    for (const id of /** @type {const} */ (['A', 'B'])) line(g, gutter, lane[id], W, lane[id]);
    // Target beats: A's pull lands on odd beats (s* = +1), B's on even.
    for (let b = Math.floor(bp) - 2; b <= Math.ceil(bp) + 5; b++) {
      if (b < 0) continue;
      const x = nowX + (b - bp) * beatMs * pxPerMs;
      if (x < gutter) continue;
      const id = b % 2 === 1 ? 'A' : 'B';
      g.fillStyle = COLOR[id];
      g.globalAlpha = b < bp ? 0.25 : 0.9;
      g.beginPath(); g.arc(x, lane[id], 9 * k, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    // Actual pull ends from each handle.
    for (const r of this.revs) {
      const x = nowX + (r.at - nowH) * pxPerMs;
      if (x < gutter || x > W) continue;
      g.strokeStyle = '#fff';
      g.lineWidth = 2.5 * k;
      g.beginPath(); g.arc(x, lane[r.seat], 13 * k, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(nowX - 1.5 * k, 4 * k, 3 * k, H - 8 * k);
    g.font = `700 ${14 * k}px system-ui, sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const id of /** @type {const} */ (['A', 'B'])) {
      g.fillStyle = COLOR[id];
      g.fillText(this.names[id] || id, gutter - 8 * k, lane[id]);
    }
    g.textBaseline = 'alphabetic';
  }

  drawDial(v) {
    const el = $('dial-needle'), tgt = $('dial-target');
    const deg = v.phase === 'saw' || v.phase === 'fall' ? v.fallPreview : 0;
    el.style.transform = `rotate(${(deg / MAX_FALL_DEG) * 60}deg)`;
    tgt.style.transform = `rotate(${(v.targetDeg / MAX_FALL_DEG) * 60}deg)`;
  }

  // ---------------- lobby ----------------

  renderLobby(l) {
    const key = JSON.stringify(l);
    if (key === this.lastLobby) return;
    this.lastLobby = key;
    const host = this.role === 'host';
    const cards = l.seats.map((s) => {
      const color = COLOR[s.id];
      const remote = s.home !== 'here';
      let body = '';
      if (s.kind === 'grandma') body = `<div class="seat-big">👵 Grandma takes this handle</div><div class="muted">She pulls right on the beat and never pushes.</div>`;
      else if (s.kind === 'keys') body = `<div class="seat-big">⌨️ Keyboard</div><div class="muted">${s.id === 'A' ? 'Hold F to pull · D chops · Q/W steer' : 'Hold J to pull · K chops · O/P steer'}</div>`;
      else if (s.kind === 'bot') body = `<div class="seat-big">🤖 Practice bot</div>`;
      else if (s.state === 'ready') body = `<div class="seat-big">📱 Ready${s.sim ? ' (sim)' : ''}</div><div class="muted">${s.motion === 'touch' ? 'Sawing by touch' : 'Motion on'}</div>`;
      else if (s.state === 'joined') body = `<div class="seat-big">📱 Connected</div><div class="muted">Tap “Pick up the saw” on the phone.</div>`;
      else if (remote && host) body = `<div class="seat-big">🏡 The other home</div><div class="muted">Their phone scans the code on their screen.</div>`;
      else if (!host && s.id === 'B' && this.guestLink) body = qr(this.guestLink, 'Your phone: scan to take this handle');
      else if (host && s.link && !(s.id === 'B' && l.invite)) body = qr(s.link, 'Scan with your phone');
      else if (host && s.id === 'B' && l.invite) body = `<div class="seat-big">🏡 The other home</div><div class="muted">Waiting for them to join with the code below.</div>`;
      else body = `<div class="muted">Waiting…</div>`;
      const opts = host && s.id === 'B' && s.kind !== 'phone' ? `
        <div class="seat-opts">
          <uf-button data-action="grandma" data-arg="${s.kind === 'grandma' ? 'off' : 'on'}" label="${s.kind === 'grandma' ? 'A partner instead' : 'Saw with Grandma'}" variant="ghost" size="sm"></uf-button>
          <uf-button data-action="invite" label="Invite another home" variant="ghost" size="sm"></uf-button>
        </div>` : '';
      const keys = host && s.kind === 'open' ? `<uf-button data-action="keys" data-arg="${s.id}" label="Use keyboard" variant="ghost" size="xs"></uf-button>` : '';
      return `<section class="seat-card" style="--seat:${color}">
        <header><span class="dot"></span><b>${s.id === 'A' ? 'Left handle' : 'Right handle'}</b><span class="who">${esc(s.name)}</span></header>
        <div class="seat-body">${body}</div>${opts}${keys}
      </section>`;
    }).join('');
    const invite = host && l.invite ? `<div class="invite">
        <div class="muted">The other home opens <b>${esc(location.host)}</b>, chooses <b>Join a home</b>, and enters:</div>
        <uf-join-code mode="display" value="${esc(l.code)}" code-prefix="${CODE_PREFIX}" length="5"></uf-join-code>
        <div class="muted">${l.guests.length ? '✅ The other home is connected.' : 'Waiting for them…'}</div>
      </div>` : '';
    $('lobby-seats').innerHTML = cards;
    $('lobby-invite').innerHTML = invite;
    const start = /** @type {any} */ ($('start-btn'));
    if (start) { start.disabled = !l.canStart; start.hidden = !host; }
    $('guest-wait').hidden = host;
  }

  // ---------------- calibration ----------------

  renderCalib(c) {
    const key = JSON.stringify(c);
    if (key === this.lastCalib) return;
    this.lastCalib = key;
    $('calib-step').textContent = `Step ${c.idx + 1} of ${c.count}`;
    $('calib-title').textContent = c.title;
    $('calib-text').textContent = c.text;
    document.documentElement.dataset.calib = c.step;
    $('calib-seats').innerHTML = c.seats.map((s) => {
      const mark = { ok: '✓', fail: '⚠︎ using a default', wait: s.progress ? esc(s.progress) : 'watching…', skip: '—', 'n/a': '—' }[s.status] || '…';
      return `<div class="calib-seat" style="--seat:${COLOR[s.id]}"><span class="dot"></span>${esc(s.name)} <b>${mark}</b></div>`;
    }).join('');
    $('calib-left').textContent = c.seats.some((s) => s.status === 'wait') ? `moving on in ${c.left} s` : '';
    $('calib-skip').hidden = this.role !== 'host';
  }

  // ---------------- results ----------------

  showScore(s, last) {
    const grade = { skid: 'Right on the skid', close: 'Close to the skid', wide: 'Wide of the skid', privy: 'On Grandma’s privy' }[s.landing.grade];
    const off = Math.round(s.landing.offDeg);
    $('score-title').textContent = `${s.tree} — down!`;
    $('score-body').innerHTML = `
      <div class="score-big">TEMPER <b>${s.temper}</b> · TANTRUMS <b>${s.tantrums}</b></div>
      <div class="score-stats">
        <uf-stat variant="card" value="${off}°" label="${grade}" detail="off the skid" tone="gold"></uf-stat>
        <uf-stat variant="card" value="${s.bestStreak}" label="Best run of clean strokes"></uf-stat>
        <uf-stat variant="card" value="${s.fallDeg}°" label="Fell (target ${s.targetDeg}°)"></uf-stat>
      </div>`;
    const btn = /** @type {any} */ ($('score-next'));
    btn.label = last ? 'One more tree' : 'Next tree';
    btn.setAttribute('data-action', last ? 'more' : 'next');
    btn.hidden = this.role !== 'host';
    /** @type {any} */ ($('score-finish')).hidden = this.role !== 'host' || !last;
    $('score').hidden = false;
  }

  showEnd(scores) {
    $('end-body').innerHTML = scores.map((s) => `<div class="end-row"><b>${esc(s.tree)}</b> TEMPER ${s.temper} · TANTRUMS ${s.tantrums} · ${Math.round(s.landing.offDeg)}° off the skid</div>`).join('');
    /** @type {any} */ ($('end-again')).hidden = this.role !== 'host';
    /** @type {any} */ ($('end-more')).hidden = this.role !== 'host';
    $('score').hidden = true;
    $('end').hidden = false;
  }
}

/** @param {string} link @param {string} caption */
function qr(link, caption) {
  return `<uf-qr value="${esc(link)}" size="240" caption="${esc(caption)}" link="${esc(link.split('#')[0])}"></uf-qr>`;
}
function line(g, x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)); }
