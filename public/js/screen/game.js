// @ts-check
// ============================================================
// game — the host's game: seats, lobby, calibration, the tree (notch → back
// cut → TIMBER → score), Grandma, and what every screen shows
// ============================================================
// Runs only on the hosting screen (the one copy of the saw, Tandemonium's
// captain model). Each frame it produces one `view` object and a stream of
// `events`; the local presenter and any guest screens render exactly those,
// so two homes see the same saw.
// ============================================================

import { createSaw, stepSaw, temperOf, zoneOf, targetS, grandmaHandle, SAW } from '../core/saw-model.js';
import { SeatBuffer, matchedTime, HoldPull } from '../core/input-buffer.js';
import { createNotch, notchHit, notchFrac } from '../core/notch.js';
import { TREES, createCut, cutBite, fallAngle, cutFrac, landing, steerLean } from '../core/tree.js';
import { lagToBeat, songTempo, pullParity } from '../core/calibration.js';
import { SEATS } from '../core/protocol.js';
import { menuFor, isMode, seatBChangesHome, remoteMenu, hostOnly } from '../core/modes.js';
import { LinePicker, LINES } from './lines.js';
import { SpikeStore } from './spike-store.js';

/** @typedef {'A'|'B'} SeatId */
/** @typedef {'open'|'phone'|'grandma'|'keys'|'bot'} SeatKind */

const CALIB_STEPS = /** @type {const} */ (['rest', 'pull', 'saw', 'twist', 'chop']);
const CALIB_TEXT = {
  rest: ['Hold still, fist forward', 'Grip your phone in a firm fist, like a saw handle, top of the phone pointing along your stroke. Hold it out in front of you.'],
  pull: ['One pull', 'From where you are, pull slowly to your belly — and hold it there.'],
  saw: ['Saw the air', 'Small, smooth strokes at a speed that feels easy: back to you, then forward. Your dot below should go back when you pull — if it goes the wrong way, tap “My hand goes the wrong way” on that phone.'],
  'saw-clicks': ['Now on the clicks', 'Keep sawing — follow BACK and FORWARD, one stroke per click. When one hand goes back, the other goes forward.'],
  twist: ['Twist toward the TV’s right', 'Roll your fist like turning a key. That’s how you steer the fall.'],
  chop: ['Three small chops', 'Below your shoulders, wrist and forearm. Like notching a log at your waist.'],
};
const CALIB_TIMEOUT_MS = 20000;
const CLICK_BPM = 96;
const CLICKS = 8;
const BROADCAST_MS = 33;
/** The saw is stepped at 120 Hz whatever the render rate. */
const SAW_STEP_MS = 1000 / 120;
/** The most lag calibration will compensate, ms. */
const MAX_LAG_COMP_MS = 220;

const GOOSE_NAMES = { winston: 'Sir Winston', victoria: 'Lady Victoria', grandma: 'Grandma' };

/**
 * @typedef {object} SeatSlot
 * @property {SeatId} id
 * @property {number} num            relay seat number (1 = A, 2 = B)
 * @property {SeatKind} kind
 * @property {'winston'|'victoria'|'grandma'} goose
 * @property {SeatBuffer} buffer
 * @property {{joined:boolean, motion:string, calibrated:boolean, rateHz:number, sim:string|null, ua:string, flipped:boolean, keys:boolean}} phone
 * @property {'here'|string} home    'here' or 'guest:<id>'
 * @property {HoldPull} hold
 * @property {{pull:boolean, left:boolean, right:boolean}} keys
 * @property {number} botLag
 * @property {string} link           pairing URL for this seat's phone (host only)
 * @property {Record<string,string>} calib  step → 'wait'|'ok'|'fail'|'skip'
 * @property {number|null} tempo
 * @property {number} lastRoll
 */

export class Game {
  /**
   * @param {{room: import('../net/room-host.js').RoomHost|null, emit:(ev:any)=>void, params:URLSearchParams}} o
   */
  constructor(o) {
    this.room = o.room;
    this.emitLocal = o.emit;
    this.params = o.params;
    this.lines = new LinePicker();
    /** @type {Record<SeatId, SeatSlot>} */
    this.seats = { A: this._slot('A', 1, 'winston'), B: this._slot('B', 2, 'victoria') };
    this.phase = 'lobby';
    this.phaseAt = performance.now();
    /** How this screen is playing (core/modes.js). @type {import('../core/modes.js').Mode} */
    this.mode = 'couch';
    /** @type {{bpm:number, startH:number}|null} */
    this.song = null;
    this.treeIdx = 0;
    this.tree = TREES[0];
    this.saw = createSaw();
    this.cut = createCut(this.tree.bites);
    this.notch = createNotch(this.tree.notchSteps);
    /** @type {any[]} */
    this.scores = [];
    this.calib = { idx: 0, stage: '', at: 0, beat0: 0, pullRetried: false, revs: /** @type {Record<SeatId, number[]>} */ ({ A: [], B: [] }), pulls: /** @type {Record<SeatId, number[]>} */ ({ A: [], B: [] }) };
    this.paused = false;
    this.lastBroadcast = 0;
    this.lastFrame = performance.now();
    this.caption = { who: '', text: '', until: 0 };
    this.hintAt = { push: -1e9, tug: -1e9, chatter: -1e9, bind: -1e9 };
    this.grandmaChopAt = 0;
    this.botChopAt = { A: 0, B: 0 };
    this.guests = /** @type {Set<string>} */ (new Set());
    this.inviteOpen = false;
    // The test log: events, phone messages and saw frames are always logged
    // and saved to IndexedDB every 2 s, so closing the tab never loses a
    // session. ?spike adds the phones' raw sensor stream.
    this.spike = o.params.has('spike');
    this.log = new SpikeStore();
    this.lastLogFrame = 0;
    setInterval(() => this.log.flush(this._logHeader()), 2000);
    addEventListener('pagehide', () => this.log.flush(this._logHeader()));
    /** A player paused the game (menu); `paused` is a dropped phone. */
    this.held = false;
    /** The host's 3D scene reports the landing (score waits for it). */
    this.sceneLands = false;
    /** @type {null | (() => void)} */
    this._onLanded = null;
    this.view = /** @type {any} */ ({});
    this._applyDevParams();
  }

  /** @param {SeatId} id @param {number} num @param {'winston'|'victoria'|'grandma'} goose @returns {SeatSlot} */
  _slot(id, num, goose) {
    return {
      id, num, kind: 'open', goose, buffer: new SeatBuffer(),
      phone: { joined: false, motion: 'pending', calibrated: false, rateHz: 0, sim: null, ua: '', flipped: false, keys: false },
      home: 'here', hold: new HoldPull(), keys: { pull: false, left: false, right: false }, botLag: 0, link: '',
      calib: {}, tempo: null, lastRoll: 0,
    };
  }

  _applyDevParams() {
    // ?bots=A:good,B:lag:120   ?keys=A,B   ?grandma
    const bots = this.params.get('bots');
    if (bots) for (const part of bots.split(',')) {
      const [id, kind, arg] = part.split(':');
      const s = this.seats[/** @type {SeatId} */ (id)];
      if (s) { s.kind = 'bot'; s.botLag = kind === 'lag' ? Number(arg) || 120 : 0; }
    }
    const keys = this.params.get('keys');
    if (keys) for (const id of keys.split(',')) { const s = this.seats[/** @type {SeatId} */ (id)]; if (s) s.kind = 'keys'; }
    if (this.params.has('grandma')) { this.mode = 'solo'; this.useGrandma(true); }
  }

  // ---------------- emit ----------------

  /** @param {any} ev */
  emit(ev) {
    if (ev.k === 'tree') this.lastTreeDef = ev.def;
    if (ev.k === 'camera') this.lastCamera = ev.mode;
    this.emitLocal(ev);
    if (this.guests.size) this.room?.toScreens({ t: 'ev', ev });
    this.log.push({ h: Math.round(performance.now()), ev });
  }

  /** @param {keyof typeof LINES} key @param {number} [holdMs] */
  say(key, holdMs = 3800) {
    const solo = this.seats.A.kind === 'grandma' || this.seats.B.kind === 'grandma';
    const [who, text] = this.lines.pick(key, solo);
    this.caption = { who, text, until: performance.now() + holdMs };
    this.emit({ k: 'caption', who, text, holdMs });
  }

  // ---------------- lobby ----------------

  /** Seat B goes to Grandma (solo), or back to open. @param {boolean} on */
  useGrandma(on) {
    const B = this.seats.B;
    if (on) { B.kind = 'grandma'; B.goose = 'grandma'; B.home = 'here'; }
    else { B.kind = B.phone.joined ? 'phone' : 'open'; B.goose = 'victoria'; }
    this._castChanged();
  }

  /** @param {SeatId} id @param {SeatKind} kind */
  setKind(id, kind) {
    const s = this.seats[id];
    s.kind = kind;
    if (id === 'B') s.goose = kind === 'grandma' ? 'grandma' : 'victoria';
    this._castChanged();
  }

  _castChanged() {
    this.emit({ k: 'cast', cast: { A: this.seats.A.goose, B: this.seats.B.goose } });
  }

  /**
   * Choose how to play (from the main menu, the lobby, or a phone). Only
   * before a game starts. Seat A stays as it is; seat B follows the mode.
   * @param {import('../core/modes.js').Mode} mode
   */
  setMode(mode) {
    if (!isMode(mode) || (this.phase !== 'lobby' && this.phase !== 'title')) return false;
    const from = this.mode;
    this.mode = mode;
    const B = this.seats.B;
    if (mode !== 'online') {
      if (this.inviteOpen) this.openInvite(false);
      this._endOnline();
      B.home = 'here';
    }
    // A link (and any phone on it) for one home must not carry over to the
    // other: a fresh seat-B link drops it (the relay closes the old socket).
    if (seatBChangesHome(from, mode)) {
      if (B.kind === 'phone') B.kind = 'open';
      B.phone.joined = false;
      B.phone.motion = 'pending';
      B.phone.calibrated = false;
      B.phone.keys = false;
      if (this.room) this.room.phoneLink(B.num, { newLink: true }).then(() => this.refreshLinks());
    }
    if (mode === 'solo') this.useGrandma(true);
    else if (B.kind === 'grandma' || B.goose === 'grandma' || (mode === 'online' && B.kind === 'keys')) { B.kind = 'open'; this.useGrandma(false); }
    if (mode === 'online') this.openInvite(true);
    if (this.phase === 'title') this._setPhase('lobby');
    this._menuKey = '';
    this.emit({ k: 'mode', mode });
    return true;
  }

  /** Is this seat played from the other home? @param {SeatSlot} s */
  _remote(s) { return this.mode === 'online' && s.id === 'B'; }

  /** Leave online play: tell the other home's screen, and forget it. */
  _endOnline() {
    if (!this.guests.size) return;
    this.room?.toScreens({ t: 'online-ended' });
    for (const id of [...this.guests]) this.onScreenLeft(id);
  }

  /** Back to the main menu (from the lobby, the pause menu or the results). */
  toTitle() {
    this.toLobby();
    this._setPhase('title');
  }

  /** Open seat B to a second home (online duo). */
  openInvite(on = true) {
    this.inviteOpen = on;
    this.room?.setInvite(on);
    if (on && this.seats.B.kind === 'grandma' && this.phase === 'lobby') this.useGrandma(false);
  }

  async refreshLinks() {
    if (!this.room) return;
    // Phones inherit the relay override, and raw-sensor logging in spike mode.
    const qs = new URLSearchParams();
    if (this.params.get('relay')) qs.set('relay', this.params.get('relay') || '');
    if (this.spike) qs.set('spike', '1');
    const q = qs.toString();
    for (const s of Object.values(this.seats)) s.link = await this.room.phoneLink(s.num, { query: q });
    // A guest home gets seat B's link to show its own phone.
    for (const id of this.guests) this.room.toScreens({ t: 'pair', seat: 2, link: this.seats.B.link }, id);
  }

  /** @param {SeatSlot} s */
  seatState(s) {
    if (s.kind === 'grandma' || s.kind === 'bot' || s.kind === 'keys') return 'ready';
    if (s.kind === 'open') return s.phone.joined ? 'joined' : 'open';
    if (!s.phone.joined) return 'open';
    if (s.phone.motion === 'pending') return 'joined';
    return 'ready';
  }

  canStart() {
    return this.phase === 'lobby' && this.seatState(this.seats.A) === 'ready' && this.seatState(this.seats.B) === 'ready';
  }

  start() {
    if (!this.canStart()) return false;
    this.emit({ k: 'ui', sfx: 'ui-ok' });
    if (!this.safetySeen) this._setPhase('safety');
    else this._enterIntro();
    return true;
  }

  /** The first-run safety card was read (TV button, Enter, or a phone tap). */
  safetyOk() {
    if (this.phase !== 'safety') return;
    this.safetySeen = true;
    this.emit({ k: 'ui', sfx: 'ui-ok' });
    this._enterIntro();
  }

  /** After the cold open: Grandma's lesson (calibration) if any phone needs it, then the tree. */
  _afterIntro() {
    const needs = Object.values(this.seats).some((s) => s.kind === 'phone' && s.phone.motion === 'ok' && !s.phone.calibrated);
    if (needs) this._enterCalibrate();
    else this._startTree();
  }

  // ---------------- phone and screen messages ----------------

  /** @param {number} num */
  seatByNum(num) {
    return num === 1 ? this.seats.A : num === 2 ? this.seats.B : null;
  }

  /** @param {number} num */
  onPadJoined(num) {
    const s = this.seatByNum(num);
    if (!s) return;
    s.phone.joined = true;
    // A new device on this seat (or the same one back) says what it is in its
    // hello: until then it isn't ready, even if a keyboard held the seat before.
    s.phone.motion = 'pending';
    s.phone.keys = false;
    // Solo keeps Grandma on the right handle whatever scans.
    if (s.kind === 'open' || (s.kind === 'grandma' && this.phase === 'lobby' && this.mode !== 'solo')) {
      s.kind = 'phone';
      if (s.id === 'B') s.goose = 'victoria';
      this._castChanged();
    }
    const info = SEATS[num - 1];
    this.room?.toPad(num, { t: 'seat', seat: num, color: info.color, label: `${GOOSE_NAMES[s.goose]} · ${info.label}` });
    this._sendMode(s);
    this._menuKey = '';
    this.emit({ k: 'ui', sfx: 'join' });
  }

  /** @param {number} num */
  onPadLeft(num) {
    const s = this.seatByNum(num);
    if (!s) return;
    s.phone.joined = false;
    if ((this.phase === 'lobby' || this.phase === 'title') && s.kind === 'phone') { s.kind = 'open'; s.phone.motion = 'pending'; s.phone.keys = false; }
  }

  /** @param {number} num @param {any} m */
  onPadMsg(num, m) {
    const s = this.seatByNum(num);
    if (!s || !m) return;
    const now = performance.now();
    if (m.t !== 'raw' && m.t !== 'ping') this.log.push({ h: Math.round(now), seat: s.id, m });
    switch (m.t) {
      case 'hello':
        s.phone.joined = true;
        s.phone.motion = m.motion || 'pending';
        s.phone.calibrated = !!m.calibrated;
        s.phone.rateHz = m.rateHz || 0;
        s.phone.sim = m.sim || null;
        s.phone.ua = m.ua || '';
        s.phone.keys = !!m.keys;
        if (s.kind === 'open') s.kind = 'phone';
        this._sendMode(s);
        this._menuKey = '';
        break;
      case 'calib': this._onCalib(s, m); break;
      case 'rev':
        if (this.phase === 'calibrate' && this.calib.stage === 'clicks') {
          this.calib.revs[s.id].push(m.at);
          if (m.end > 0) this.calib.pulls[s.id].push(m.at);
        }
        this.emit({ k: 'rev', seat: s.id, at: m.at - s.buffer.lagMs, end: m.end });
        break;
      case 'hit': this._onHit(s.id, m.at - s.buffer.lagMs, m.grade); break;
      case 'ok': this.safetyOk(); break;
      case 'next': if (this.phase === 'score' || this.phase === 'end') this.more(); break;
      case 'calib-progress': s.calib.progress = m.n + '/' + m.of; break;
      case 'raw': if (this.spike) this.log.push({ h: Math.round(now), seat: s.id, raw: m.s }); break;
      case 'menu': this.menu(m.id, s); break;
      // The phone flipped its own stroke direction (its "wrong way" button).
      case 'flipped': s.phone.flipped = !!m.on; this.say('flipped', 3000); break;
      default:
    }
  }

  /** @param {number} num @param {any[]} samples @param {number} at */
  onSamples(num, samples, at) {
    const s = this.seatByNum(num);
    if (!s || s.kind !== 'phone') return;
    // A sample stamped well in the future means that phone's clock estimate
    // is stale (we reloaded, or it slept): drop it until it re-syncs.
    for (const x of samples) if (x.t <= at + 150) s.buffer.push(x, at);
  }

  /** @param {string} id */
  onScreenJoined(id) {
    // One other home per game, and only in online mode: anyone else is turned away.
    if (this.mode !== 'online' && !this.inviteOpen) { this.room?.toScreens({ t: 'online-ended' }, id); return; }
    const other = [...this.guests].find((g) => g !== id);
    if (other) { this.room?.kickScreen(id); return; }
    this.guests.add(id);
    // A reconnect mid-game just gets the picture back; the seats only change in the lobby.
    if (this.phase === 'lobby' || this.phase === 'title') {
      if (this.seats.B.kind === 'grandma') this.useGrandma(false);
      this.seats.B.home = 'guest:' + id;
    }
    this.room?.toScreens({
      t: 'welcome', cast: { A: this.seats.A.goose, B: this.seats.B.goose }, song: this.song, phase: this.phase,
      tree: this.lastTreeDef || null, camera: this.lastCamera || 'intro',
    }, id);
    this.refreshLinks();
    this.emit({ k: 'ui', sfx: 'join' });
  }

  /** @param {string} id */
  onScreenLeft(id) {
    this.guests.delete(id);
    if (this.seats.B.home === 'guest:' + id) this.seats.B.home = 'here';
  }

  // ---------------- keyboard seats ----------------

  /** @param {SeatId} id @param {'pull'|'chop'|'left'|'right'} what @param {boolean} down */
  key(id, what, down) {
    const s = this.seats[id];
    if (s.kind !== 'keys') return;
    if (what === 'chop') { if (down) this._onHit(id, performance.now(), 'good'); return; }
    s.keys[what] = down;
  }

  // ---------------- phase: calibrate ----------------

  _calibSeats() {
    return Object.values(this.seats).filter((s) => s.kind === 'phone' && s.phone.motion === 'ok' && !s.phone.calibrated);
  }

  _enterCalibrate() {
    this._setPhase('calibrate');
    this.calib.idx = 0;
    this.calib.pullRetried = false;
    for (const s of Object.values(this.seats)) s.calib = {};
    this.say('calibrate');
    this._calibStep();
  }

  _calibStep() {
    const step = CALIB_STEPS[this.calib.idx];
    for (const s of Object.values(this.seats)) s.calib.progress = '';
    this.calib.stage = step === 'saw' ? 'free' : step;
    this.calib.at = performance.now();
    for (const s of this._calibSeats()) s.calib[step] = 'wait';
    for (const s of Object.values(this.seats)) this._sendMode(s);
  }

  /** @param {SeatSlot} s @param {any} m */
  _onCalib(s, m) {
    if (this.phase !== 'calibrate') return;
    const step = CALIB_STEPS[this.calib.idx];
    if (m.step === 'saw-axis') { s.calib.axis = m.ok ? 'ok' : 'fail'; return; }
    if (m.step === 'saw-tempo') { s.tempo = m.bpm; s.calib.tempo = 'ok'; return; }
    if (m.touch) { for (const st of CALIB_STEPS) s.calib[st] = 'skip'; s.phone.calibrated = true; return; }
    if (m.step !== step) return;
    s.calib[step] = m.ok ? 'ok' : 'fail';
    if (step === 'chop' && m.ok) s.phone.calibrated = true;
  }

  _calibUpdate(now) {
    const step = CALIB_STEPS[this.calib.idx];
    const seats = this._calibSeats().filter((s) => !Object.values(s.calib).every((v) => v === 'skip'));
    const timedOut = now - this.calib.at > CALIB_TIMEOUT_MS;
    if (step === 'saw') {
      if (this.calib.stage === 'free') {
        const ready = seats.every((s) => s.calib.tempo === 'ok');
        if (ready || timedOut) {
          // Strokes on the clicks: measures each phone's lag to the beat.
          this.calib.stage = 'clicks';
          this.calib.beat0 = now + 900;
          this.calib.revs = { A: [], B: [] };
          this.calib.pulls = { A: [], B: [] };
          this.calib.at = now;
          const beatMs = 60000 / CLICK_BPM;
          this.song = null;
          this.emit({ k: 'clicks', startH: this.calib.beat0, bpm: CLICK_BPM, count: CLICKS });
          for (const s of Object.values(this.seats)) this._sendMode(s, { song: { startH: this.calib.beat0, bpm: CLICK_BPM } });
          void beatMs;
        }
        return;
      }
      const beatMs = 60000 / CLICK_BPM;
      if (now > this.calib.beat0 + (CLICKS + 0.5) * beatMs) {
        for (const s of seats) {
          // Skip the first two clicks while people find the beat.
          const revs = this.calib.revs[s.id].filter((t) => t > this.calib.beat0 + 1.5 * beatMs);
          const lag = lagToBeat(revs, this.calib.beat0, beatMs);
          // Device + speaker + perception lag, within reason: calibration
          // must never hide a partner who is half a beat out.
          s.buffer.lagMs = Math.max(-MAX_LAG_COMP_MS, Math.min(MAX_LAG_COMP_MS, lag ?? 0));
          s.calib.saw = lag === null ? 'fail' : 'ok';
          s.calib.lagMs = String(Math.round(lag ?? 0));
          // A phone whose pulled ends land on its partner's clicks is the
          // wrong way round: turn it (the phone flips itself and says so).
          const pulls = this.calib.pulls[s.id].filter((t) => t > this.calib.beat0 + 1.5 * beatMs);
          const par = pullParity(pulls, this.calib.beat0, beatMs, lag ?? 0, s.id);
          s.calib.parity = par ? par.score.toFixed(2) : 'n/a';
          if (par?.reversed) {
            this.room?.toPad(s.num, { t: 'flip' });
            s.calib.autoFlipped = 'yes';
            this.say('flippedAuto', 4500);
          }
        }
        this._nextCalib();
      }
      return;
    }
    const done = seats.every((s) => s.calib[step] === 'ok' || s.calib[step] === 'fail');
    if (done || timedOut) {
      for (const s of seats) if (s.calib[step] === 'wait') s.calib[step] = 'fail';
      // The pull sets which way is "toward you": never guess it. Once more
      // for any phone that missed it.
      const missed = seats.filter((s) => s.calib[step] === 'fail');
      if (step === 'pull' && missed.length && !this.calib.pullRetried) {
        this.calib.pullRetried = true;
        this.calib.at = now;
        this.say('pullAgain', 4500);
        for (const s of missed) { s.calib.pull = 'wait'; this._sendMode(s, { again: true }); }
        return;
      }
      this._nextCalib();
    }
  }

  _nextCalib() {
    this.calib.idx++;
    if (this.calib.idx >= CALIB_STEPS.length) {
      for (const s of this._calibSeats()) s.phone.calibrated = true;
      this._startTree();
    } else this._calibStep();
  }

  /** Skip the rest of calibration (the TV's skip button). */
  skipCalibration() {
    if (this.phase !== 'calibrate') return;
    for (const s of this._calibSeats()) s.phone.calibrated = true;
    this._startTree();
  }

  // ---------------- phase: intro, tree ----------------

  _enterIntro() {
    this._setPhase('intro');
    this.emit({ k: 'camera', mode: 'intro' });
    const lines = LINES.coldOpen;
    lines.forEach(([who, text], i) => this._later(400 + i * 3300, () => {
      this.caption = { who, text, until: performance.now() + 3200 };
      this.emit({ k: 'caption', who, text, holdMs: 3200 });
    }));
    this.introEnd = performance.now() + 400 + lines.length * 3300;
  }

  skipIntro() {
    if (this.phase === 'intro') this.introEnd = 0;
  }

  _startTree() {
    this.tree = TREES[this.treeIdx];
    this.saw = createSaw();
    this.cut = createCut(this.tree.bites);
    this.notch = createNotch(this.tree.notchSteps, 'A');
    this.emit({ k: 'tree', def: { kind: this.tree.kind, targetDeg: this.tree.targetDeg }, name: this.tree.name });
    // The work song, at the pair's comfortable tempo.
    const tempos = Object.values(this.seats).map((s) => s.tempo).filter((x) => x !== null);
    const bpm = songTempo(/** @type {number[]} */ (tempos));
    this.song = { bpm, startH: performance.now() + 1200 };
    // ?nosong: the beat still runs (Grandma needs it) but nothing plays or shows (PLAN §13.1 trial).
    this.emit({ k: 'song', ...this.song, silent: this.params.has('nosong') });
    this._enterNotch();
  }

  _enterNotch() {
    this._setPhase('notch');
    this.emit({ k: 'camera', mode: 'notch' });
    this.say('notchStart', 5000);
    this._turn();
  }

  _turn() {
    const lit = this.notch.lit;
    const s = this.seats[lit];
    this.room?.toPad(s.num, { t: 'turn', seat: s.num });
    this.emit({ k: 'turn', seat: lit });
    if (s.kind === 'grandma') this.grandmaChopAt = performance.now() + 650;
    if (s.kind === 'bot') this.botChopAt[lit] = performance.now() + 450 + s.botLag;
  }

  /** @param {SeatId} id @param {number} at @param {'soft'|'good'|'strong'} grade */
  _onHit(id, at, grade) {
    if (this.phase !== 'notch' || this.held) return;
    const r = notchHit(this.notch, id, at, grade);
    const kind = r.kind === 'open' || r.kind === 'done' ? 'tok' : r.kind === 'clang' ? 'clang' : 'chip';
    this.emit({ k: 'hit', seat: id, kind, result: r.kind, notch: notchFrac(this.notch), lit: r.lit });
    if (r.kind === 'chip' && Math.random() < 0.5) this.say('notchChip', 2200);
    if (r.kind === 'clang') this.say('notchClang', 2200);
    if (r.kind === 'glance') this.say('notchGlance', 2200);
    if (r.kind === 'open') this._turn();
    // A clang, chip or glance leaves the turn where it was: cue the lit
    // player again (their phone buzzes; Grandma and bots chop again).
    if (r.kind === 'clang' || r.kind === 'glance' || (r.kind === 'chip' && id !== this.notch.lit)) {
      clearTimeout(this._recue);
      this._recue = this._later(700, () => this._turn());
    }
    if (r.kind === 'done') {
      this.emit({ k: 'notch-done' });
      this._setPhase('notch-done');
      this._later(1300, () => this._enterSaw());
    }
  }

  _enterSaw() {
    this._setPhase('saw');
    this.emit({ k: 'camera', mode: 'saw' });
    this.say('sawStart', 4200);
    this.steerHinted = false;
    this.maxLean = 0;
  }

  _enterFall() {
    const angle = fallAngle(this.cut, this.cut.lean);
    this._setPhase('fall');
    const land = landing(angle, this.tree.targetDeg);
    this.emit({ k: 'fall', angle, landing: land });
    this.room?.toPad(null, { t: 'cue', kind: 'timber' });
    // (No TIMBER caption: the big TIMBER! on screen says it.)
    if (this.song) { this.emit({ k: 'song-stop' }); this.song = null; }
    const score = {
      tree: this.tree.name,
      temper: temperOf(this.saw),
      tantrums: this.saw.tantrums,
      bites: this.saw.bites,
      bestStreak: this.saw.bestStreak,
      chatters: this.saw.chatters,
      fallDeg: Math.round(angle),
      targetDeg: this.tree.targetDeg,
      landing: land,
      notchChips: this.notch.chips,
    };
    this.scores.push(score);
    // The score card waits for the tree to land (the host's scene reports it,
    // landed()) and the call-out to be read; without a scene, on a timer.
    // Capped, so a stalled scene can never hold the game.
    const epoch = this.epoch;
    let shown = false;
    const showScore = () => {
      if (shown || this.epoch !== epoch) return;
      shown = true;
      this._setPhase('score');
      this.emit({ k: 'score', score, last: this.treeIdx >= TREES.length - 1 });
      const key = land.grade === 'privy' ? 'landPrivy' : land.grade === 'skid' ? 'landSkid' : land.grade === 'close' ? 'landClose' : 'landWide';
      this.say(key, 3500);
      this._later(3600, () => this.say(score.temper >= 85 ? 'scoreHigh' : score.temper >= 60 ? 'scoreMid' : 'scoreLow', 4000));
    };
    this._onLanded = () => setTimeout(showScore, 2600);
    setTimeout(showScore, this.sceneLands ? 12000 : 7000);
  }

  /** The host's scene saw the tree hit the ground. */
  landed() {
    const f = this._onLanded;
    this._onLanded = null;
    if (f && this.phase === 'fall') f();
  }

  /** From the score card: the next tree; after the last one, the summary. */
  next() {
    if (this.phase === 'end') { this.more(); return; }
    if (this.phase !== 'score') return;
    if (this.treeIdx < TREES.length - 1) { this.treeIdx++; this._startTree(); }
    else this.finish();
  }

  /** One more tree, straight away: no lobby, no cold open, no calibration. */
  more() {
    if (this.phase !== 'score' && this.phase !== 'end') return;
    this.treeIdx = (this.treeIdx + 1) % TREES.length;
    this._startTree();
  }

  /** The summary of this session's trees. */
  finish() {
    if (this.phase !== 'score') return;
    this._setPhase('end');
    this.emit({ k: 'end', scores: this.scores });
    this.say('end', 6000);
  }

  toLobby() {
    this.treeIdx = 0;
    this.scores = [];
    this.song = null;
    this.held = false;
    this.emit({ k: 'held', on: false });
    this.emit({ k: 'song-stop' });
    // A phone that went away mid-game frees its seat in the lobby.
    for (const s of Object.values(this.seats)) if (s.kind === 'phone' && !s.phone.joined) { s.kind = 'open'; s.phone.motion = 'pending'; s.phone.keys = false; }
    this._setPhase('lobby');
    this.emit({ k: 'camera', mode: 'intro' });
  }

  // ---------------- pause and menus ----------------

  /** Pause the tree (TV button, Esc, or a phone). Only while chopping or sawing. */
  pause() {
    if (this.held || (this.phase !== 'notch' && this.phase !== 'saw')) return;
    this.held = true;
    this.emit({ k: 'held', on: true });
    this.emit({ k: 'ui', sfx: 'ui-ok' });
    if (this.song) this.emit({ k: 'song-stop' });
    for (const s of Object.values(this.seats)) this._sendMode(s);
  }

  resume() {
    if (!this.held) return;
    this.held = false;
    this.emit({ k: 'held', on: false });
    // The song starts again on a fresh downbeat; the stroke in progress is dropped.
    if (this.song) {
      this.song = { bpm: this.song.bpm, startH: performance.now() + 1200 };
      this.emit({ k: 'song', ...this.song, silent: this.params.has('nosong') });
    }
    this.saw.dir = 0;
    this.saw.lastT = NaN;
    this.saw.overSince = NaN;
    for (const s of Object.values(this.seats)) this._sendMode(s);
    if (this.phase === 'notch') this._later(600, () => this._turn());
  }

  /** Start this tree again from the notch. */
  restartTree() {
    if (!this.held) return;
    this.held = false;
    this.emit({ k: 'held', on: false });
    this.emit({ k: 'song-stop' });
    this._startTree();
  }

  /**
   * The buttons that make sense right now, for the TV and every phone, so a
   * game can be run entirely from a phone. `local` items act on the phone.
   * @returns {{id:string, label:string, primary?:boolean, local?:boolean}[]}
   */
  menuItems() {
    return menuFor({
      phase: this.phase, held: this.held, mode: this.mode, lastTree: this.treeIdx >= TREES.length - 1,
      canStart: this.canStart(),
      onePhone: this.seats.A.kind === 'phone' && this.seats.B.kind !== 'phone',
      bOpen: this.seats.B.kind === 'open',
    });
  }

  /**
   * A menu choice from a phone (or the TV). Only choices on the current menu
   * count, so a stale tap can't do something else.
   * @param {string} id @param {SeatSlot} [from]
   */
  menu(id, from) {
    if (!this.menuItems().some((i) => i.id === id)) return;
    // A phone only speaks for a seat it holds, and the other home's can't navigate this screen.
    if (from && (from.kind !== 'phone' || (this._remote(from) && hostOnly(id)))) return;
    switch (id) {
      case 'start': this.start(); break;
      case 'solo': case 'mode-solo': this.setMode('solo'); break;
      case 'duo': case 'mode-couch': this.setMode('couch'); break;
      case 'mode-online': this.setMode('online'); break;
      case 'title': this.toTitle(); break;
      case 'safety-ok': this.safetyOk(); break;
      case 'skip-intro': this.skipIntro(); break;
      case 'skip-calib': this.skipCalibration(); break;
      case 'pause': this.pause(); break;
      case 'resume': this.resume(); break;
      case 'restart': this.restartTree(); break;
      case 'next': this.next(); break;
      case 'more': this.more(); break;
      case 'finish': this.finish(); break;
      case 'lobby': this.toLobby(); break;
      default:
    }
  }

  /** Phones get the menu whenever it changes. */
  _syncMenu() {
    const items = this.menuItems();
    const key = this.phase + this.mode + JSON.stringify(items);
    if (key === this._menuKey) return;
    this._menuKey = key;
    // The other home's phone gets the tree's buttons, not the host's navigation.
    for (const s of Object.values(this.seats)) this.room?.toPad(s.num, { t: 'menu', items: this._remote(s) ? remoteMenu(items) : items });
  }

  /**
   * The beat for the hand cues: the song's while sawing, the clicks' in the
   * lesson's click stage, none otherwise.
   * @param {number} tEval @param {number} bp
   */
  _handBeat(tEval, bp) {
    if (this.phase === 'saw' && Number.isFinite(bp)) return r4(bp);
    if (this.phase === 'calibrate' && this.calib.stage === 'clicks') return r4((tEval - this.calib.beat0) / (60000 / CLICK_BPM));
    return null;
  }

  /**
   * setTimeout that only fires if the game is still in the phase it was
   * scheduled in (a restart or "back to lobby" cancels it).
   * @param {number} ms @param {() => void} fn
   */
  _later(ms, fn) {
    const epoch = this.epoch;
    return setTimeout(() => { if (this.epoch === epoch) fn(); }, ms);
  }

  /** @param {string} p */
  _setPhase(p) {
    this.epoch = (this.epoch || 0) + 1;
    this.phase = p;
    this.phaseAt = performance.now();
    this.emit({ k: 'phase', phase: p });
    for (const s of Object.values(this.seats)) this._sendMode(s);
  }

  /** What each phone should be doing now. @param {SeatSlot} s @param {any} [extra] */
  _sendMode(s, extra = {}) {
    if (!this.room || s.kind !== 'phone') return;
    let mode = 'idle';
    if (this.phase === 'lobby' || this.phase === 'title') mode = 'lobby';
    else if (this.phase === 'calibrate') {
      const step = CALIB_STEPS[this.calib.idx];
      const mine = s.calib[step] !== undefined && s.phone.motion === 'ok';
      mode = mine ? 'calib-' + step : 'idle';
    } else if (this.held) mode = 'held';
    else if (this.phase === 'notch') mode = 'chop';
    else if (this.phase === 'saw') mode = 'saw';
    else if (this.phase === 'safety') mode = 'safety';
    else if (this.phase === 'score' || this.phase === 'end') mode = 'between';
    if (this.phase === 'title') extra = { menu: 'title', ...extra };
    this.room.toPad(s.num, { t: 'mode', mode, song: this.song, ...extra });
  }

  // ---------------- the frame ----------------

  /** @param {number} now host ms @returns {any} the view */
  frame(now) {
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    const beatMs = this.song ? 60000 / this.song.bpm : 60000 / 96;
    const beatPosAt = (t) => (this.song ? (t - this.song.startH) / beatMs : NaN);

    if (this.phase === 'calibrate') this._calibUpdate(now);
    if (this.phase === 'intro' && now >= this.introEnd) this._afterIntro();

    // Keyboard seats write their own samples (hold to pull).
    for (const s of Object.values(this.seats)) {
      if (s.kind !== 'keys') continue;
      const r = s.hold.step(dt, s.keys.pull, beatMs);
      const roll = s.keys.left ? -1 : s.keys.right ? 1 : 0;
      s.buffer.push({ t: now, p: r.p, v: r.v, roll, flags: 3 }, now);
    }

    // One matched time for every live handle.
    const live = Object.values(this.seats).filter((s) => s.kind === 'phone' || s.kind === 'keys').map((s) => s.buffer);
    const tEval = live.length ? matchedTime(live, now) : now;
    const bp = beatPosAt(tEval);

    /** @type {Record<SeatId, {p:number, v:number, roll:number}>} */
    const h = /** @type {any} */ ({});
    for (const s of Object.values(this.seats)) h[s.id] = this._handle(s, tEval, bp, beatMs);
    // The blade leans by the average of the two twists (PLAN §4.4). Grandma
    // follows her partner's twist, so solo you steer at full strength.
    const gSeat = this.seats.A.kind === 'grandma' ? 'A' : this.seats.B.kind === 'grandma' ? 'B' : null;
    const lean = steerLean(h.A.roll, h.B.roll, gSeat);
    this.cut.lean = lean;

    // Grandma's and the bots' hatchets.
    if (this.phase === 'notch') {
      if (this.grandmaChopAt && now >= this.grandmaChopAt) { this.grandmaChopAt = 0; const g = this.seats.A.kind === 'grandma' ? 'A' : 'B'; this._onHit(g, now, 'good'); }
      for (const id of /** @type {SeatId[]} */ (['A', 'B'])) {
        if (this.botChopAt[id] && now >= this.botChopAt[id]) { this.botChopAt[id] = 0; this._onHit(id, now, 'good'); }
      }
    }

    // A dropped phone pauses the saw (Old Misery waits).
    const stale = Object.values(this.seats).some((s) => s.kind === 'phone' && s.buffer.isStale(now));
    if ((this.phase === 'saw' || this.phase === 'notch') && stale !== this.paused) {
      this.paused = stale;
      if (stale) this.say('partnerGone', 2500);
      else {
        // Resume: the stroke in progress started before the pause; start fresh.
        this.saw.dir = 0;
        this.saw.lastT = NaN;
        this.saw.overSince = NaN;
      }
      this.emit({ k: 'paused', on: stale });
    }

    if ((this.phase === 'saw' || this.phase === 'notch' || this.phase === 'calibrate') && now - this.lastLogFrame >= 16) {
      this.lastLogFrame = now;
      this.log.push({ h: Math.round(now), f: [Math.round(tEval), r4(h.A.p), r4(h.B.p), r4(this.saw.s), r4(this.saw.e), r4(bp)] });
    }
    if (this.phase === 'saw' && !this.paused && !this.held) {
      // Step the saw at a fixed rate from where it was to the matched time,
      // reading both handles at each step, so the cut never depends on how
      // fast this screen renders (a TV at 30 fps cuts like a laptop at 120).
      // Never step past the newest sample of a live hand: if one phone's
      // stream stalls, the saw waits for it rather than freezing that hand
      // while the other keeps sawing (which would read as a tantrum).
      const tSaw = live.length ? Math.min(tEval, ...live.map((b) => b.latestT)) : tEval;
      let t0 = this.saw.lastT;
      if (!Number.isFinite(t0) || tSaw - t0 > 300) t0 = tSaw - SAW_STEP_MS;
      let n = 0;
      for (let t = t0 + SAW_STEP_MS; t <= tSaw + 1e-6 && n < 60 && this.phase === 'saw'; t += SAW_STEP_MS, n++) {
        const b = beatPosAt(t);
        const a = this._handle(this.seats.A, t, b, beatMs), c = this._handle(this.seats.B, t, b, beatMs);
        const evs = stepSaw(this.saw, { t, pA: a.p, pB: c.p, vA: a.v, vB: c.v, beatMs, beatPos: b });
        for (const ev of evs) this._sawEvent(ev, now);
      }
    } else {
      // Outside the back cut the blade just follows the hands: no cutting,
      // and no strain shown (it only means something while sawing).
      if (this.phase !== 'saw') {
        this.saw.s = this.phase === 'lobby' || this.phase === 'title' || this.phase === 'calibrate' ? (h.A.p - h.B.p) / 2 : this.saw.s * 0.9;
        this.saw.e = 0;
      }
    }

    // Synthetic stroke dots for Grandma and bots on the beat strip.
    if (this.song && this.phase === 'saw') {
      const k = Math.floor(bp);
      if (k !== this._lastBeat && Number.isFinite(k)) {
        this._lastBeat = k;
        // Their pull ends land on their own beats: A on odd, B on even.
        for (const s of Object.values(this.seats)) {
          const mine = s.id === 'A' ? k % 2 === 1 : k % 2 === 0;
          if ((s.kind === 'grandma' || s.kind === 'bot') && mine) this.emit({ k: 'rev', seat: s.id, at: this.song.startH + (k + s.botLag / beatMs) * beatMs, end: 1 });
        }
      }
    }

    const zone = zoneOf(this.saw.e);
    const aimDeg = fallAngle(this.cut, lean);
    const view = {
      phase: this.phase,
      mode: this.mode,
      paused: this.paused,
      s: this.saw.s,
      e: this.saw.e,
      zone: this.held ? 'green' : zone,
      blame: zone === 'green' || this.held ? null : this._blame(h, bp),
      lean,
      cutFrac: cutFrac(this.cut),
      notchFrac: notchFrac(this.notch),
      notchSteps: this.notch.steps,
      silentSong: this.params.has('nosong'),
      litFace: this.phase === 'notch' ? this.notch.lit : null,
      fallPreview: aimDeg,
      targetDeg: this.tree.targetDeg,
      // Where the fall is heading right now: skid / close / wide / privy.
      aimGrade: landing(aimDeg, this.tree.targetDeg).grade,
      temper: temperOf(this.saw),
      tantrums: this.saw.tantrums,
      streak: this.saw.streak,
      bites: this.cut.bites,
      bitesNeeded: this.cut.needed,
      tree: this.tree.name,
      treeIdx: this.treeIdx,
      treeCount: TREES.length,
      song: this.song,
      speed: Math.min(1, Math.abs(h.A.v - h.B.v) / 4),
      caption: now < this.caption.until ? this.caption : null,
      lobby: this.phase === 'lobby' ? this._lobbyView() : null,
      calib: this.phase === 'calibrate' ? this._calibView(now) : null,
      evalLagMs: Math.round(now - tEval),
      // Each hand where its phone says it is (at the judged time) and the
      // beat there: the HUD draws them under each goose against where they
      // should be. In the lesson's click stage the clicks are the beat.
      hands: { A: r4(h.A.p), B: r4(h.B.p), bp: this.held ? null : this._handBeat(tEval, bp) },
      held: this.held,
      menu: this.menuItems(),
      seats: this._seatsView(),
    };
    this.view = view;
    this._syncMenu();
    // The phones show the aim too (a glance cue), a few times a second.
    if (this.phase === 'saw' && now - (this.lastAimSent || 0) >= 200) {
      this.lastAimSent = now;
      this.room?.toPad(null, { t: 'aim', deg: Math.round(aimDeg * 10) / 10, target: this.tree.targetDeg, grade: view.aimGrade });
    }
    if (this.guests.size && now - this.lastBroadcast >= BROADCAST_MS) {
      this.lastBroadcast = now;
      const { lobby, ...rest } = view;
      this.room?.toScreens({ t: 'state', h: now, v: { ...rest, lobby: lobby ? { ...lobby, seats: lobby.seats.map((x) => ({ ...x, link: '' })) } : null } });
    }
    return view;
  }

  /** @param {SeatSlot} s @param {number} t @param {number} bp @param {number} beatMs */
  _handle(s, t, bp, beatMs) {
    const sign = s.id === 'A' ? 1 : -1;
    if (s.kind === 'grandma') {
      if (!Number.isFinite(bp)) return { p: -1, v: 0, roll: 0 };
      const g = grandmaHandle(bp, beatMs);
      return s.id === 'B' ? { ...g, roll: 0 } : { p: -g.p, v: -g.v, roll: 0 };
    }
    if (s.kind === 'bot') {
      if (!Number.isFinite(bp)) return { p: -1, v: 0, roll: 0 };
      const b = bp - s.botLag / beatMs;
      return { p: sign * targetS(b), v: 0, roll: Number(this.params.get('steer') || 0) };
    }
    const x = s.buffer.at(t);
    return x ? { p: x.p, v: x.v, roll: x.roll } : { p: -1, v: 0, roll: 0 };
  }

  /** Who to mark on the blade: the handle furthest off its beat. */
  _blame(h, bp) {
    if (!Number.isFinite(bp)) return null;
    const ts = targetS(bp);
    const dA = Math.abs(h.A.p - ts), dB = Math.abs(h.B.p + ts);
    if (Math.abs(dA - dB) < 0.05) return null;
    return dA > dB ? 'A' : 'B';
  }

  /** @param {import('../core/saw-model.js').SawEvent} ev @param {number} now */
  _sawEvent(ev, now) {
    switch (ev.type) {
      case 'bite': {
        const felled = cutBite(this.cut, this.cut.lean);
        this.emit({ k: 'bite', streak: ev.streak, cut: cutFrac(this.cut) });
        this.room?.toPad(null, { t: 'cue', kind: 'bite' });
        if (ev.streak === 6 || ev.streak === 14) this.say('streak', 2500);
        this.maxLean = Math.max(this.maxLean || 0, Math.abs(this.cut.lean));
        if (!this.steerHinted && this.cut.bites >= 8 && this.maxLean < 0.15) { this.steerHinted = true; this.say('steerHint', 4500); }
        if (felled) this._enterFall();
        break;
      }
      case 'tantrum':
        this.emit({ k: 'tantrum', blame: ev.blame, kind: ev.kind });
        this.room?.toPad(null, { t: 'cue', kind: 'tantrum' });
        this.say(ev.kind === 'push' ? 'push' : 'tug', 3200);
        break;
      case 'chatter':
        this.emit({ k: 'chatter' });
        if (now - this.hintAt.chatter > 8000) { this.hintAt.chatter = now; this.say('chatter', 3000); }
        break;
      case 'bind':
        this.emit({ k: 'bind', kind: ev.kind });
        if (now - this.hintAt.bind > 9000) { this.hintAt.bind = now; this.say(ev.kind === 'push' ? 'bindPush' : 'bindTug', 3000); }
        break;
      default:
    }
  }

  _lobbyView() {
    return {
      seats: Object.values(this.seats).map((s) => ({
        id: s.id, kind: s.kind, goose: s.goose, name: GOOSE_NAMES[s.goose], state: this.seatState(s), link: s.link,
        home: s.home, motion: s.phone.motion, sim: s.phone.sim, keys: s.phone.keys,
      })),
      mode: this.mode,
      code: this.room?.code || '',
      guests: [...this.guests],
      invite: this.inviteOpen,
      canStart: this.canStart(),
    };
  }

  _calibView(now) {
    const step = CALIB_STEPS[this.calib.idx];
    const key = step === 'saw' && this.calib.stage === 'clicks' ? 'saw-clicks' : step;
    const [title, text] = CALIB_TEXT[key];
    return {
      step, idx: this.calib.idx, count: CALIB_STEPS.length, title, text,
      seats: Object.values(this.seats).map((s) => ({
        id: s.id, name: GOOSE_NAMES[s.goose], kind: s.kind, status: s.calib[step] || (s.kind === 'phone' ? 'skip' : 'n/a'), lagMs: s.calib.lagMs,
        progress: step === 'saw' && this.calib.stage === 'clicks' ? this.calib.revs[s.id].length + '/' + CLICKS
          : step === 'saw' ? (s.calib.tempo === 'ok' ? 'got it' : s.calib.progress || '') : s.calib.progress || '',
      })),
      left: Math.max(0, Math.round((CALIB_TIMEOUT_MS - (now - this.calib.at)) / 1000)),
    };
  }

  _seatsView() {
    return Object.values(this.seats).map((s) => ({ id: s.id, kind: s.kind, goose: s.goose, name: GOOSE_NAMES[s.goose], lagMs: Math.round(s.buffer.lagMs), stale: s.kind === 'phone' && s.buffer.isStale(performance.now()) }));
  }

  _logHeader() {
    return {
      at: new Date().toISOString(),
      spike: this.spike,
      seats: Object.values(this.seats).map((s) => ({ id: s.id, kind: s.kind, phone: s.phone, lagMs: s.buffer.lagMs, tempo: s.tempo, calib: s.calib })),
      scores: this.scores,
      saw: SAW,
      frameCols: ['tEval', 'pA', 'pB', 's', 'e', 'beatPos'],
    };
  }

  /** The test log (PLAN §13.1): this session, or the last saved one if this page is fresh. */
  spikeDump() { return this.log.dump(this._logHeader()); }
}

function r4(x) { return Math.round(x * 1e4) / 1e4; }
