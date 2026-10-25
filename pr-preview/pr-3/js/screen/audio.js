// @ts-check
// ============================================================
// audio — Timber Tandem's sound (PLAN §4.5, §4.9)
// ============================================================
//
// Web Audio only, everything synthesized: no sample files.
//
//   master: volume → compressor/limiter → destination
//   buses:  song (4 stems, crossfaded by intensity) · saw voice · one-shots
//
// The work song is an original reel ("Old Misery's Reel", D major, AABB,
// 8 bars each) with an oom-pah bass and a boot stomp. One saw stroke per
// beat. Stems: 0 stomp/shaker/bass · 1 fiddle · 2 concertina · 3 goose choir.
//
// Time: callers speak performance.now() ms. ctxTimeForPerf() maps a moment
// the player should HEAR to the AudioContext time to schedule it at, using
// getOutputTimestamp() when the browser gives one (which already includes the
// output latency), else currentTime minus outputLatency.
// ============================================================

/** @typedef {'bite'|'chatter'|'tantrum'|'tok'|'chip'|'clang'|'notch-done'|'creak'|'timber'|'thud'|'ui-ok'|'ui-back'|'join'|'star'|'tut'|'honk'|'crack'|'boom'|'smash'|'clatter'|'whistle'} SfxName */

/** @type {readonly SfxName[]} */
export const SFX_NAMES = Object.freeze(['bite', 'chatter', 'tantrum', 'tok', 'chip', 'clang', 'notch-done', 'creak', 'timber', 'thud', 'ui-ok', 'ui-back', 'join', 'star', 'tut', 'honk', 'crack', 'boom', 'smash', 'clatter', 'whistle']);

const LOOKAHEAD_MS = 120;
const TICK_MS = 25;
const MAX_MASTER = 0.85;

/** MIDI note → Hz */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------- the reel ----------
// Eighth notes, 8 per bar (one bar = 4 beats = 4 saw strokes).
// Note names with octave; '-' holds the previous note; '.' is a rest.
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
/** @param {string} n e.g. "F#5" */
function nameToMidi(n) {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
}

const PART_A = [
  'A4 D5 F#5 D5 A4 D5 F#5 A5',
  'G5 F#5 E5 D5 F#5 E5 D5 C#5',
  'B4 D5 G5 F#5 G5 B4 D5 G5',
  'A4 C#5 E5 C#5 A4 B4 C#5 E5',
  'F#5 A5 F#5 D5 A4 D5 F#5 D5',
  'G5 F#5 E5 D5 B4 D5 G5 B4',
  'A4 C#5 E5 G5 F#5 E5 D5 C#5',
  'D5 A4 F#4 A4 D5 - D5 .',
];
const PART_B = [
  'B5 A5 G5 F#5 G5 D5 B4 D5',
  'A5 F#5 D5 F#5 A5 F#5 D5 F#5',
  'E5 C#5 A4 C#5 E5 F#5 G5 E5',
  'F#5 D5 A4 D5 F#5 A5 F#5 D5',
  'G5 B5 G5 D5 B4 D5 G5 A5',
  'F#5 E5 D5 F#5 A5 F#5 D5 F#5',
  'E5 G5 C#5 E5 A4 C#5 E5 C#5',
  'D5 F#5 A5 F#5 D5 - D5 .',
];
const CHORDS_A = ['D', 'D', 'G', 'A', 'D', 'G', 'A', 'D'];
const CHORDS_B = ['G', 'D', 'A', 'D', 'G', 'D', 'A7', 'D'];
/** Chord tones (concertina voicing, around middle C) and bass roots/fifths. */
const CHORD = {
  D: { tones: [62, 66, 69], root: 38, fifth: 45 },
  G: { tones: [62, 67, 71], root: 43, fifth: 38 },
  A: { tones: [61, 64, 69], root: 45, fifth: 40 },
  A7: { tones: [61, 64, 67], root: 45, fifth: 40 },
};

/**
 * Pre-parse the 32-bar form (A A B B) into per-bar note events.
 * @returns {{chord: string, notes: {step:number, midi:number, len:number}[]}[]}
 */
function buildForm() {
  const bars = [];
  const parts = [[PART_A, CHORDS_A], [PART_A, CHORDS_A], [PART_B, CHORDS_B], [PART_B, CHORDS_B]];
  for (const [mel, chords] of parts) {
    mel.forEach((line, i) => {
      const toks = line.trim().split(/\s+/);
      /** @type {{step:number, midi:number, len:number}[]} */
      const notes = [];
      toks.forEach((tok, step) => {
        if (tok === '-') { if (notes.length) notes[notes.length - 1].len++; return; }
        if (tok === '.') return;
        notes.push({ step, midi: nameToMidi(tok), len: 1 });
      });
      bars.push({ chord: chords[i], notes });
    });
  }
  return bars;
}
const FORM = buildForm();

// Saw hum climbs D major pentatonic with the streak.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class TimberAudio {
  /** @param {{ volume?: number, context?: BaseAudioContext }} [opts] */
  constructor(opts = {}) {
    this._volume = clamp(opts.volume ?? 0.8, 0, 1);
    this._muted = false;
    /** @type {BaseAudioContext|null} */
    this.ctx = null;
    this._ctxOpt = opts.context || null;
    /** perf ms → ctx seconds offset (ctx = perf/1000 + offset) */
    this._mapOffset = NaN;
    this._song = null;
    this._intensity = 0;
    this._timer = 0;
    this._sawTargets = { hum: -1, groan: -1, buzz: -1, squeal: -1, rasp: -1, humMidi: -1 };
    this._prevFiddle = 0;
  }

  /** Create/resume the AudioContext. Call from a user gesture. */
  async unlock() {
    if (!this.ctx) {
      if (this._ctxOpt) this.ctx = this._ctxOpt;
      else {
        const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
      }
      this._build();
    }
    const c = /** @type {AudioContext} */ (this.ctx);
    if (typeof c.resume === 'function' && c.state === 'suspended' && !(typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext)) {
      try { await c.resume(); } catch { /* blocked */ }
    }
    // getOutputTimestamp() reads zero until output actually starts; the
    // currentTime fallback can be 100+ ms off. Wait (briefly) for the real one
    // so the first mapping is right.
    for (let i = 0; i < 20 && !this._hasOutputTimestamp(); i++) await new Promise((r) => setTimeout(r, 25));
    this._refreshMap(true);
  }

  _hasOutputTimestamp() {
    const c = /** @type {AudioContext} */ (this.ctx);
    if (!c || typeof c.getOutputTimestamp !== 'function' || c.state !== 'running') return true; // nothing to wait for
    const ts = c.getOutputTimestamp();
    return !!(ts && ts.performanceTime > 0 && ts.contextTime > 0);
  }

  get ready() {
    return !!this.ctx && /** @type {AudioContext} */ (this.ctx).state === 'running';
  }

  get outputLatencyMs() {
    const c = /** @type {AudioContext|null} */ (this.ctx);
    if (!c) return 0;
    const o = (c.outputLatency || 0) + (c.baseLatency || 0);
    return Number.isFinite(o) ? o * 1000 : 0;
  }

  /**
   * The AudioContext time to schedule at so a sound is HEARD at perfMs.
   * @param {number} perfMs
   */
  ctxTimeForPerf(perfMs) {
    if (!this.ctx) return 0;
    if (!Number.isFinite(this._mapOffset)) this._refreshMap(true);
    return perfMs / 1000 + this._mapOffset;
  }

  /** Re-estimate the perf→ctx mapping (smoothed: getOutputTimestamp jitters). */
  _refreshMap(force = false) {
    const c = /** @type {AudioContext} */ (this.ctx);
    if (!c) return;
    let off = NaN;
    if (typeof c.getOutputTimestamp === 'function') {
      const ts = c.getOutputTimestamp();
      if (ts && ts.performanceTime && ts.performanceTime > 0 && ts.contextTime && ts.contextTime > 0) {
        off = ts.contextTime - ts.performanceTime / 1000;
      }
    }
    if (!Number.isFinite(off)) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      off = c.currentTime - now / 1000 - this.outputLatencyMs / 1000;
    }
    if (force || !Number.isFinite(this._mapOffset) || Math.abs(off - this._mapOffset) > 0.05) this._mapOffset = off;
    else this._mapOffset += (off - this._mapOffset) * 0.05;
  }

  /** Never schedule in the past. */
  _when(atPerfMs) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    if (typeof atPerfMs !== 'number' || !Number.isFinite(atPerfMs)) return c.currentTime + 0.005;
    return Math.max(c.currentTime + 0.003, this.ctxTimeForPerf(atPerfMs));
  }

  // ------------------------------------------------------------
  // graph
  // ------------------------------------------------------------

  _build() {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    this.master = c.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume * MAX_MASTER;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 6;
    this.comp.ratio.value = 10;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.18;
    this.master.connect(this.comp).connect(c.destination);

    // The world filter: wide open, except in slow motion, when every sound
    // effect is muffled (the fall's "time slows down" feel).
    this.worldLp = c.createBiquadFilter(); this.worldLp.type = 'lowpass'; this.worldLp.frequency.value = 20000; this.worldLp.Q.value = 0.7;
    this.worldLp.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.worldLp);
    this.sawBus = c.createGain(); this.sawBus.gain.value = 0.8; this.sawBus.connect(this.master);
    this.songBus = c.createGain(); this.songBus.gain.value = 0.55; this.songBus.connect(this.master);
    /** @type {GainNode[]} */
    this.stems = [0, 1, 2, 3].map((i) => {
      const g = c.createGain();
      g.gain.value = i <= this._intensity ? 1 : 0;
      g.connect(this.songBus);
      return g;
    });

    // Shared noise (2 s white) for every noisy sound.
    const len = Math.floor(c.sampleRate * 2);
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1; }

    // Shared fiddle vibrato.
    this.vib = c.createOscillator(); this.vib.frequency.value = 5.6;
    this.vibDepth = c.createGain(); this.vibDepth.gain.value = 11; // cents
    this.vib.connect(this.vibDepth);
    this.vib.start();

    this._buildSawVoice();
    this._buildFallVoice();
  }

  /** The falling tree's continuous voice: hinge creak, air rush, leaves, and a sub "whoom" in slow motion. */
  _buildFallVoice() {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const bus = /** @type {GainNode} */ (this.sfxBus);
    const now = c.currentTime;
    const g0 = () => { const g = c.createGain(); g.gain.value = 0; return g; };
    // Creak: a strained sawtooth through a resonant band, stuttering like fibres tearing.
    this.fcOsc = c.createOscillator(); this.fcOsc.type = 'sawtooth'; this.fcOsc.frequency.value = 62; this.fcOsc.start(now);
    const cbp = c.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 900; cbp.Q.value = 9;
    this.fcBp = cbp;
    const am = c.createGain(); am.gain.value = 0.5;
    const jit = c.createOscillator(); jit.type = 'square'; jit.frequency.value = 21; jit.start(now);
    const jd = c.createGain(); jd.gain.value = 0.5; jit.connect(jd).connect(am.gain);
    this.fcGain = g0();
    this.fcOsc.connect(cbp).connect(am).connect(this.fcGain).connect(bus);
    // Rush: the crown tearing through the air.
    const rn = c.createBufferSource(); rn.buffer = this.noise; rn.loop = true; rn.start(now, 0.7);
    this.frBp = c.createBiquadFilter(); this.frBp.type = 'bandpass'; this.frBp.frequency.value = 300; this.frBp.Q.value = 0.8;
    this.frGain = g0();
    rn.connect(this.frBp).connect(this.frGain).connect(bus);
    // Leaves: high rustle.
    const ln = c.createBufferSource(); ln.buffer = this.noise; ln.loop = true; ln.start(now, 1.3);
    const lhp = c.createBiquadFilter(); lhp.type = 'highpass'; lhp.frequency.value = 4800;
    this.flGain = g0();
    ln.connect(lhp).connect(this.flGain).connect(bus);
    // Whoom: a sub swell under the slow motion.
    this.fwOsc = c.createOscillator(); this.fwOsc.type = 'sine'; this.fwOsc.frequency.value = 44; this.fwOsc.start(now);
    this.fwGain = g0();
    this.fwOsc.connect(this.fwGain).connect(this.master);
  }

  /**
   * Drive the fall voice (call every frame while a tree falls).
   * @param {{creak?:number, rush?:number, slow?:boolean}} v 0..1 levels
   * @param {number} [at] AudioContext time (offline renders); default now
   */
  setFallVoice(v, at) {
    if (!this.ctx || !this.fcGain) return;
    const t = at ?? this.ctx.currentTime;
    const cr = clamp(v.creak ?? 0, 0, 1), ru = clamp(v.rush ?? 0, 0, 1), slow = v.slow ? 1 : 0;
    this.fcGain.gain.setTargetAtTime(0.42 * cr, t, 0.04);
    this.fcOsc.frequency.setTargetAtTime(58 + 46 * cr, t, 0.08);
    this.fcBp.frequency.setTargetAtTime(700 + 700 * cr, t, 0.08);
    // In slow motion the rush drops an octave and a half and swells.
    this.frGain.gain.setTargetAtTime(0.34 * ru * (slow ? 1.25 : 1), t, 0.05);
    this.frBp.frequency.setTargetAtTime((350 + 1500 * ru) * (slow ? 0.35 : 1), t, 0.12);
    this.flGain.gain.setTargetAtTime(0.1 * ru * (slow ? 0.6 : 1), t, 0.08);
    this.fwGain.gain.setTargetAtTime(0.28 * ru * slow, t, 0.15);
  }

  /**
   * Slow motion: muffle the sound effects and duck the song.
   * @param {boolean} on @param {number} [at] AudioContext time
   */
  setSlowMo(on, at) {
    if (!this.ctx || !this.worldLp) return;
    const t = at ?? this.ctx.currentTime;
    this.worldLp.frequency.cancelScheduledValues(t);
    this.worldLp.frequency.setTargetAtTime(on ? 1100 : 20000, t, on ? 0.12 : 0.05);
    this.songBus?.gain.setTargetAtTime(on ? 0.12 : 0.55, t, 0.2);
  }

  _buildSawVoice() {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const bus = /** @type {GainNode} */ (this.sawBus);
    const now = c.currentTime;
    const mk = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(now); return o; };
    const g0 = () => { const g = c.createGain(); g.gain.value = 0; return g; };

    // Hum: the steel singing. Fundamental + octave + an inharmonic plate partial.
    const f0 = mtof(50);
    this.humOsc = [mk('sine', f0), mk('sine', f0 * 2.003), mk('sine', f0 * 2.76)];
    const humMix = c.createGain(); humMix.gain.value = 1;
    [0.6, 0.22, 0.1].forEach((amp, i) => { const g = c.createGain(); g.gain.value = amp; this.humOsc[i].connect(g).connect(humMix); });
    // Tremolo on its own stage (gain 1 ± 0.08), BEFORE the level: wired into
    // the level itself it kept the hum pulsing even at zero (a constant whine).
    const trem = mk('sine', 4.2); const tremD = c.createGain(); tremD.gain.value = 0.08; trem.connect(tremD);
    const tremStage = c.createGain(); tremStage.gain.value = 1;
    tremD.connect(tremStage.gain);
    this.humGain = g0();
    const humLp = c.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 2800;
    humMix.connect(humLp).connect(tremStage).connect(this.humGain).connect(bus);

    // Groan: compression, detuned low saws.
    const ga = mk('sawtooth', 68), gb = mk('sawtooth', 71.3);
    const wob = mk('sine', 2.7); const wobD = c.createGain(); wobD.gain.value = 5; wob.connect(wobD); wobD.connect(ga.frequency); wobD.connect(gb.frequency);
    const glp = c.createBiquadFilter(); glp.type = 'lowpass'; glp.frequency.value = 420; glp.Q.value = 5;
    this.groanGain = g0();
    ga.connect(glp); gb.connect(glp); glp.connect(this.groanGain).connect(bus);

    // Buzz: tension, a chopped square.
    const bz = mk('square', 118);
    const bbp = c.createBiquadFilter(); bbp.type = 'bandpass'; bbp.frequency.value = 1100; bbp.Q.value = 2;
    const chop = c.createGain(); chop.gain.value = 0.5;
    const chopLfo = mk('square', 27); const chopD = c.createGain(); chopD.gain.value = 0.5; chopLfo.connect(chopD).connect(chop.gain);
    this.buzzGain = g0();
    bz.connect(bbp).connect(chop).connect(this.buzzGain).connect(bus);

    // Squeal: past the red line.
    const sq = mk('sine', 1900);
    const sqL = mk('sine', 14); const sqD = c.createGain(); sqD.gain.value = 130; sqL.connect(sqD).connect(sq.frequency);
    this.squealGain = g0();
    sq.connect(this.squealGain).connect(bus);

    // Rasp: the teeth in the wood, under everything while the blade moves.
    const rn = c.createBufferSource(); rn.buffer = this.noise; rn.loop = true; rn.start(now);
    const rbp = c.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 2600; rbp.Q.value = 0.9;
    this.raspGain = g0();
    rn.connect(rbp).connect(this.raspGain).connect(bus);
  }

  // ------------------------------------------------------------
  // volume
  // ------------------------------------------------------------

  /** @param {number} v 0..1 */
  setVolume(v) {
    this._volume = clamp(v, 0, 1);
    this._applyMaster();
  }

  /** @param {boolean} on */
  mute(on) {
    this._muted = !!on;
    this._applyMaster();
  }

  _applyMaster() {
    if (!this.ctx || !this.master) return;
    const target = this._muted ? 0 : this._volume * MAX_MASTER;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
  }

  // ------------------------------------------------------------
  // the song
  // ------------------------------------------------------------

  /**
   * Beat 0 is heard at startPerfMs.
   * @param {{bpm:number, startPerfMs:number, countIn?: number}} opts  countIn: stick clicks on the beats before 0
   */
  startSong(opts) {
    if (!this.ctx) return;
    this.stopSong(0);
    const bpm = clamp(opts.bpm, 40, 200);
    const now = performance.now();
    this._song = {
      segs: [{ perf: opts.startPerfMs, beat: 0, msPerBeat: 60000 / bpm }],
      pendingBpm: 0,
      nextStep: 0,
      countIn: Math.max(0, Math.floor(opts.countIn || 0)),
    };
    const startBeat = this.beatAt(now);
    const first = -2 * this._song.countIn;
    this._song.nextStep = Math.max(first, Math.ceil(startBeat * 2));
    // Undo any fade from a previous stop.
    const sb = /** @type {GainNode} */ (this.songBus);
    sb.gain.cancelScheduledValues(this.ctx.currentTime);
    sb.gain.setValueAtTime(0.55, this.ctx.currentTime);
    this._prevFiddle = 0;
    this._tick();
    this._timer = /** @type {any} */ (setInterval(() => this._tick(), TICK_MS));
  }

  /** @param {number} bpm  takes effect from the next bar */
  setBpm(bpm) {
    if (this._song) this._song.pendingBpm = clamp(bpm, 40, 200);
  }

  /** @param {number} [fadeMs] */
  stopSong(fadeMs = 300) {
    if (this._timer) { clearInterval(this._timer); this._timer = 0; }
    if (!this._song || !this.ctx) { this._song = null; return; }
    this._song = null;
    const sb = /** @type {GainNode} */ (this.songBus);
    const t = this.ctx.currentTime;
    sb.gain.cancelScheduledValues(t);
    sb.gain.setValueAtTime(sb.gain.value, t);
    if (fadeMs > 0) sb.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
    else sb.gain.setValueAtTime(0, t);
    // Restore the bus level after the already-scheduled notes have died away.
    sb.gain.setValueAtTime(0.55, t + fadeMs / 1000 + LOOKAHEAD_MS / 1000 + 1.2);
  }

  /** @param {0|1|2|3} level */
  setIntensity(level) {
    this._intensity = clamp(Math.round(level), 0, 3);
    if (!this.ctx || !this.stems) return;
    const t = this.ctx.currentTime;
    this.stems.forEach((g, i) => g.gain.setTargetAtTime(i <= this._intensity ? 1 : 0, t, 0.25));
  }

  /**
   * Fractional beats since the song started (negative before beat 0). NaN with no song.
   * @param {number} perfMs
   */
  beatAt(perfMs) {
    if (!this._song) return NaN;
    const segs = this._song.segs;
    let s = segs[0];
    for (let i = segs.length - 1; i >= 0; i--) if (perfMs >= segs[i].perf) { s = segs[i]; break; }
    return s.beat + (perfMs - s.perf) / s.msPerBeat;
  }

  /** @param {number} beat */
  _perfOfBeat(beat) {
    const segs = /** @type {any} */ (this._song).segs;
    let s = segs[0];
    for (let i = segs.length - 1; i >= 0; i--) if (beat >= segs[i].beat) { s = segs[i]; break; }
    return s.perf + (beat - s.beat) * s.msPerBeat;
  }

  _msPerBeatAt(beat) {
    const segs = /** @type {any} */ (this._song).segs;
    let s = segs[0];
    for (let i = segs.length - 1; i >= 0; i--) if (beat >= segs[i].beat) { s = segs[i]; break; }
    return s.msPerBeat;
  }

  _tick() {
    const song = this._song;
    if (!song || !this.ctx) return;
    this._refreshMap();
    const now = performance.now();
    const horizon = now + LOOKAHEAD_MS;
    let guard = 0;
    while (guard++ < 64) {
      const step = song.nextStep;
      const beat = step / 2;
      // Tempo changes land on bar lines.
      if (song.pendingBpm && step >= 0 && step % 8 === 0) {
        const perf = this._perfOfBeat(beat);
        song.segs.push({ perf, beat, msPerBeat: 60000 / song.pendingBpm });
        if (song.segs.length > 6) song.segs.shift();
        song.pendingBpm = 0;
      }
      const perf = this._perfOfBeat(beat);
      if (perf > horizon) break;
      if (perf >= now - 15) this._scheduleStep(step, this.ctxTimeForPerf(perf));
      song.nextStep++;
    }
  }

  /**
   * One eighth-note step of the song.
   * @param {number} step  eighths since beat 0 (negative = count-in)
   * @param {number} t     ctx time
   */
  _scheduleStep(step, t) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    if (t < c.currentTime) return;
    const beat = step / 2;
    const spb = this._msPerBeatAt(beat) / 1000;
    const eighth = spb / 2;
    if (step < 0) {
      if (step % 2 === 0) this._stick(t, step === -2);
      return;
    }
    const barIdx = Math.floor(step / 8) % FORM.length;
    const inBar = step % 8;
    const bar = FORM[barIdx];
    const ch = CHORD[bar.chord];
    const live = (i) => i <= this._intensity || (this.stems && this.stems[i].gain.value > 0.01);

    // Stem 0: stomp on beats, shaker on the off-eighths, oom-pah bass.
    if (inBar % 2 === 0) {
      this._stomp(t, inBar === 0 || inBar === 4);
      if (inBar === 0 || inBar === 4) this._bass(t, inBar === 0 ? ch.root : ch.fifth, spb * 0.9);
    } else {
      this._shaker(t);
    }
    // Stem 1: fiddle.
    if (live(1)) {
      for (const n of bar.notes) {
        if (n.step === inBar) {
          this._fiddle(t, n.midi, n.len * eighth, inBar % 4 === 0);
        }
      }
    }
    // Stem 2: concertina "pah" on beats 2 and 4, a soft held chord at the bar.
    if (live(2)) {
      if (inBar === 2 || inBar === 6) this._concertina(t, ch.tones, spb * 0.45, 0.9);
      if (inBar === 0) this._concertina(t, ch.tones.map((m) => m - 12), spb * 3.6, 0.35);
    }
    // Stem 3: goose choir sings the chord on every other bar.
    if (live(3) && inBar === 0 && barIdx % 2 === 0) this._choir(t, ch.tones, spb * 7.4);
  }

  // --- song voices ---

  _stick(t, accent) {
    this._wood(t, accent ? 1900 : 1450, 0.22, /** @type {GainNode} */ (this.sfxBus));
  }

  _stomp(t, accent) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const dst = this.stems[0];
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(accent ? 92 : 80, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = c.createGain();
    env(g.gain, t, 0.004, accent ? 0.55 : 0.38, 0.16);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + 0.2);
    // Boot on floorboard.
    this._noiseBurst(t, 0.05, 'lowpass', 520, 1, accent ? 0.22 : 0.15, dst);
  }

  _shaker(t) {
    this._noiseBurst(t, 0.04, 'highpass', 6500, 0.7, 0.05, this.stems[0]);
  }

  _bass(t, midi, dur) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(midi);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.08, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); o2.connect(g); g.connect(this.stems[0]);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  _fiddle(t, midi, dur, accent) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const f = mtof(midi);
    const prev = this._prevFiddle;
    this._prevFiddle = f;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.detune.value = 6;
    for (const o of [o1, o2]) {
      if (prev && Math.abs(prev / f - 1) < 0.35) {
        o.frequency.setValueAtTime(prev, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.028);
      } else {
        o.frequency.setValueAtTime(f, t);
      }
      this.vibDepth.connect(o.detune);
    }
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 2400; body.Q.value = 1.4; body.gain.value = 5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800; lp.Q.value = 0.6;
    const g = c.createGain();
    const peak = accent ? 0.13 : 0.105;
    const end = t + Math.max(0.06, dur * 0.94);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.022);           // bow bite
    g.gain.linearRampToValueAtTime(peak * 0.72, t + 0.09);      // settle
    g.gain.setValueAtTime(peak * 0.72, end - 0.04);
    g.gain.linearRampToValueAtTime(0, end + 0.03);
    o1.connect(hp); o2.connect(hp);
    hp.connect(body).connect(lp).connect(g).connect(this.stems[1]);
    o1.start(t); o2.start(t);
    o1.stop(end + 0.05); o2.stop(end + 0.05);
    o1.onended = () => { try { this.vibDepth.disconnect(o1.detune); this.vibDepth.disconnect(o2.detune); } catch { /* gone */ } };
  }

  _concertina(t, tones, dur, level) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const g = c.createGain();
    const peak = 0.05 * level;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.03);
    g.gain.setValueAtTime(peak * 0.85, t + Math.max(0.04, dur - 0.05));
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1900; lp.Q.value = 0.8;
    lp.connect(g).connect(this.stems[2]);
    for (const m of tones) {
      for (const det of [-5, 5]) {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp);
        o.start(t); o.stop(t + dur + 0.02);
      }
    }
  }

  _choir(t, tones, dur) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.05, t + 0.12);
    out.gain.setValueAtTime(0.045, t + dur * 0.7);
    out.gain.linearRampToValueAtTime(0, t + dur);
    // "Honk-ah" vowel: two formants.
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 5;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1180; f2.Q.value = 6;
    const mix = c.createGain(); mix.gain.value = 2.2;
    f1.connect(mix); f2.connect(mix); mix.connect(out).connect(this.stems[3]);
    tones.forEach((m, i) => {
      const o = c.createOscillator(); o.type = 'sawtooth';
      const f = mtof(m);
      // Honk onset: scoop up from a little flat.
      o.frequency.setValueAtTime(f * 0.89, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
      o.detune.value = (i - 1) * 7;
      o.connect(f1); o.connect(f2);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }

  /** @param {number} atPerfMs @param {boolean} [accent] */
  click(atPerfMs, accent = false) {
    if (!this.ctx) return;
    this._wood(this._when(atPerfMs), accent ? 1800 : 1250, accent ? 0.4 : 0.3, /** @type {GainNode} */ (this.sfxBus));
  }

  /** A woodblock: a pitched ping plus a click of noise. */
  _wood(t, f, level, dst) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.86, t + 0.06);
    const g = c.createGain(); env(g.gain, t, 0.002, level, 0.07);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + 0.1);
    this._noiseBurst(t, 0.012, 'highpass', 3000, 1, level * 0.4, dst);
  }

  // ------------------------------------------------------------
  // the saw voice
  // ------------------------------------------------------------

  /**
   * Call every frame.
   * @param {{speed:number, zone:'green'|'amber'|'red', strainSign:-1|0|1, streak:number}} v
   */
  setSawVoice(v) {
    if (!this.ctx || !this.humGain) return;
    const s = clamp(Number(v.speed) || 0, 0, 1);
    const sp = Math.sqrt(s);
    let hum = 0, groan = 0, buzz = 0, squeal = 0;
    if (v.zone === 'green') hum = 0.2 * sp;
    else if (v.zone === 'amber') {
      hum = 0.04 * sp;
      if (v.strainSign < 0) groan = 0.15 * sp;
      else if (v.strainSign > 0) buzz = 0.11 * sp;
      else groan = 0.08 * sp;
    } else {
      squeal = 0.1 * Math.max(sp, 0.4);
      if (v.strainSign < 0) groan = 0.16 * Math.max(sp, 0.4);
      else buzz = 0.12 * Math.max(sp, 0.4);
    }
    const rasp = 0.07 * sp;
    const idx = Math.min(PENTA.length - 1, Math.floor(Math.max(0, v.streak || 0) / 2));
    const humMidi = 50 + PENTA[idx];
    const t = this.ctx.currentTime;
    const T = this._sawTargets;
    const set = (key, node, val, tc = 0.05) => {
      if (Math.abs(T[key] - val) < 0.004) return;
      T[key] = val;
      node.gain.setTargetAtTime(val, t, tc);
    };
    set('hum', this.humGain, hum);
    set('groan', this.groanGain, groan);
    set('buzz', this.buzzGain, buzz);
    set('squeal', this.squealGain, squeal, 0.03);
    set('rasp', this.raspGain, rasp);
    if (T.humMidi !== humMidi) {
      T.humMidi = humMidi;
      const f = mtof(humMidi);
      [1, 2.003, 2.76].forEach((k, i) => this.humOsc[i].frequency.setTargetAtTime(f * k, t, 0.06));
    }
  }

  // ------------------------------------------------------------
  // one-shots
  // ------------------------------------------------------------

  /**
   * @param {SfxName} name
   * @param {{pan?:number, gain?:number, atPerfMs?:number, atCtx?:number}} [opts]
   */
  play(name, opts = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = typeof opts.atCtx === 'number' ? opts.atCtx : this._when(opts.atPerfMs);
    const out = c.createGain();
    out.gain.value = clamp(opts.gain ?? 1, 0, 2);
    let node = /** @type {AudioNode} */ (out);
    if (typeof c.createStereoPanner === 'function' && opts.pan) {
      const p = c.createStereoPanner(); p.pan.value = clamp(opts.pan, -1, 1);
      out.connect(p); node = p;
    }
    node.connect(/** @type {GainNode} */ (this.sfxBus));
    const fn = SFX[name];
    if (!fn) return;
    const dur = fn.call(this, t, out) || 1;
    // Let the per-shot nodes go.
    setTimeout(() => { try { out.disconnect(); node.disconnect(); } catch { /* gone */ } }, (t - c.currentTime + dur + 0.5) * 1000);
  }

  // --- building blocks ---

  /**
   * A burst of filtered noise.
   * @returns {GainNode}
   */
  _noiseBurst(t, dur, type, freq, q, level, dst, attack = 0.002) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    env(g.gain, t, attack, level, dur);
    src.connect(f).connect(g).connect(dst);
    const off = Math.random() * 1.5;
    src.start(t, off, dur + 0.05);
    return g;
  }

  /** A pitched blip with a pitch glide. */
  _tone(t, type, f0, f1, dur, level, dst, attack = 0.003) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); env(g.gain, t, attack, level, dur);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  /** Inharmonic metal partials. */
  _metal(t, partials, dur, level, dst, beat = 3) {
    for (let i = 0; i < partials.length; i++) {
      const f = partials[i];
      this._tone(t, 'sine', f, f * 0.995, dur * (1 - i * 0.12), level / (1 + i * 0.6), dst, 0.001);
      this._tone(t, 'sine', f + beat, f + beat, dur * (1 - i * 0.12), level / (2 + i), dst, 0.001);
    }
  }
}

// ---------- one-shot recipes (this = TimberAudio; return duration s) ----------

/** @type {Record<SfxName, (this: TimberAudio, t: number, out: GainNode) => number>} */
const SFX = {
  bite(t, out) {
    // Rasp: a quick train of tooth scrapes.
    for (let i = 0; i < 4; i++) this._noiseBurst(t + i * 0.022, 0.03, 'bandpass', 1700 + i * 180, 1.4, 0.62, out);
    // Body of the wood.
    this._tone(t, 'triangle', 190, 140, 0.09, 0.34, out);
    // Sawdust puff.
    this._noiseBurst(t + 0.05, 0.32, 'lowpass', 650, 0.7, 0.18, out, 0.05);
    return 0.45;
  },
  chatter(t, out) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const tt = t + i * (0.022 + 0.01 * Math.random());
      this._noiseBurst(tt, 0.009, 'highpass', 3200, 1, 0.22, out);
      this._tone(tt, 'sine', 3100 + 400 * Math.random(), 2600, 0.02, 0.06, out, 0.001);
    }
    return 0.25;
  },
  tantrum(t, out) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    // Bent-steel squeal.
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.linearRampToValueAtTime(2500, t + 0.25);
    o.frequency.linearRampToValueAtTime(1300, t + 0.6);
    const lfo = c.createOscillator(); lfo.frequency.value = 17;
    const ld = c.createGain(); ld.gain.value = 90; lfo.connect(ld).connect(o.frequency);
    const g = c.createGain(); env(g.gain, t, 0.01, 0.16, 0.6);
    o.connect(g).connect(out);
    o.start(t); lfo.start(t); o.stop(t + 0.7); lfo.stop(t + 0.7);
    // The blade "boing".
    this._metal(t, [610, 1490, 2230], 0.7, 0.12, out, 5);
    // Old Misery's grumble: "grr-mm-mm".
    const gr = c.createOscillator(); gr.type = 'sawtooth';
    gr.frequency.setValueAtTime(130, t + 0.35);
    gr.frequency.exponentialRampToValueAtTime(72, t + 1.25);
    const fm = c.createBiquadFilter(); fm.type = 'bandpass'; fm.frequency.value = 520; fm.Q.value = 3;
    const am = c.createGain(); am.gain.value = 0.5;
    const syl = c.createOscillator(); syl.frequency.value = 6.5;
    const sd = c.createGain(); sd.gain.value = 0.5; syl.connect(sd).connect(am.gain);
    const gg = c.createGain();
    gg.gain.setValueAtTime(0, t + 0.35);
    gg.gain.linearRampToValueAtTime(0.32, t + 0.42);
    gg.gain.linearRampToValueAtTime(0.25, t + 1.05);
    gg.gain.linearRampToValueAtTime(0, t + 1.3);
    gr.connect(fm).connect(am).connect(gg).connect(out);
    gr.start(t + 0.35); syl.start(t + 0.35); gr.stop(t + 1.35); syl.stop(t + 1.35);
    return 1.4;
  },
  tok(t, out) {
    this._noiseBurst(t, 0.016, 'bandpass', 2500, 1.2, 0.8, out);
    this._tone(t, 'triangle', 440, 250, 0.07, 0.6, out, 0.001);
    this._tone(t, 'sine', 125, 90, 0.06, 0.5, out, 0.001);
    this._noiseBurst(t + 0.02, 0.12, 'bandpass', 4200, 2, 0.05, out); // chips flying
    return 0.25;
  },
  chip(t, out) {
    this._noiseBurst(t, 0.012, 'highpass', 3600, 1, 0.32, out);
    this._tone(t, 'triangle', 900, 680, 0.035, 0.2, out, 0.001);
    return 0.15;
  },
  clang(t, out) {
    this._metal(t, [523, 1231, 1873, 2690], 0.8, 0.18, out, 4);
    SFX.tok.call(this, t, out);
    this._tone(t + 0.05, 'square', 330, 300, 0.18, 0.03, out);
    return 0.9;
  },
  'notch-done'(t, out) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const soft = c.createGain(); soft.gain.value = 0.55; soft.connect(out);
    SFX.tok.call(this, t, soft);
    SFX.tok.call(this, t + 0.12, soft);
    [62, 66, 69, 74].forEach((m, i) => this._tone(t + 0.25 + i * 0.08, 'sine', mtof(m + 12), mtof(m + 12), 0.25, 0.08, out, 0.002));
    return 0.8;
  },
  creak(t, out) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(62, t);
    o.frequency.linearRampToValueAtTime(88, t + 0.5);
    o.frequency.linearRampToValueAtTime(70, t + 0.9);
    o.frequency.linearRampToValueAtTime(95, t + 1.3);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1300, t + 0.6);
    bp.frequency.linearRampToValueAtTime(900, t + 1.3);
    const am = c.createGain(); am.gain.value = 0.5;
    const jit = c.createOscillator(); jit.type = 'square'; jit.frequency.setValueAtTime(18, t); jit.frequency.linearRampToValueAtTime(30, t + 1.3);
    const jd = c.createGain(); jd.gain.value = 0.5; jit.connect(jd).connect(am.gain);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.15);
    g.gain.setValueAtTime(0.4, t + 1.15);
    g.gain.linearRampToValueAtTime(0, t + 1.4);
    o.connect(bp).connect(am).connect(g).connect(out);
    o.start(t); jit.start(t); o.stop(t + 1.45); jit.stop(t + 1.45);
    return 1.5;
  },
  timber(t, out) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    // The crack: one big snap and splinters.
    this._noiseBurst(t, 0.05, 'highpass', 1200, 0.7, 0.5, out);
    this._tone(t, 'triangle', 160, 70, 0.12, 0.35, out, 0.001);
    for (let i = 0; i < 5; i++) this._noiseBurst(t + 0.04 + i * (0.025 + Math.random() * 0.03), 0.015, 'bandpass', 2000 + Math.random() * 2500, 2, 0.25, out);
    // The long rush of the fall.
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t + 0.2);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 1.8);
    bp.frequency.exponentialRampToValueAtTime(450, t + 2.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t + 0.15);
    g.gain.linearRampToValueAtTime(0.05, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.32, t + 2.2);
    g.gain.linearRampToValueAtTime(0, t + 2.75);
    src.connect(bp).connect(g).connect(out);
    src.start(t + 0.15); src.stop(t + 2.8);
    // Leaves rushing.
    const lv = c.createBufferSource(); lv.buffer = this.noise; lv.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t + 1.0);
    lg.gain.linearRampToValueAtTime(0.09, t + 2.2);
    lg.gain.linearRampToValueAtTime(0, t + 2.7);
    lv.connect(hp).connect(lg).connect(out);
    lv.start(t + 1.0, 0.3); lv.stop(t + 2.8);
    return 2.9;
  },
  /** The hinge lets go: one big snap, splinters, a groan. */
  crack(t, out) {
    this._noiseBurst(t, 0.06, 'highpass', 1400, 0.7, 0.75, out, 0.001);
    this._noiseBurst(t, 0.18, 'bandpass', 600, 1.2, 0.45, out, 0.001);
    this._tone(t, 'triangle', 190, 60, 0.16, 0.5, out, 0.001);
    for (let i = 0; i < 9; i++) this._noiseBurst(t + 0.03 + i * (0.02 + Math.random() * 0.035), 0.014, 'bandpass', 1800 + Math.random() * 3000, 2, 0.32 * (1 - i / 12), out);
    return 0.6;
  },
  /** The tree hits the ground: a sub thump, a woody crunch, branches, needles. */
  boom(t, out) {
    this._tone(t, 'sine', 70, 28, 1.3, 1.0, out, 0.002);
    this._tone(t, 'sine', 46, 30, 0.9, 0.6, out, 0.004);
    this._tone(t, 'triangle', 120, 50, 0.3, 0.4, out, 0.002);
    this._noiseBurst(t, 0.6, 'lowpass', 380, 0.8, 0.8, out, 0.003);
    this._noiseBurst(t + 0.01, 0.25, 'bandpass', 900, 0.9, 0.35, out, 0.002);
    // Branches snapping and needles hissing as the crown crushes.
    for (let i = 0; i < 16; i++) {
      const tt = t + 0.03 + Math.random() * 0.5;
      this._noiseBurst(tt, 0.01 + Math.random() * 0.02, 'bandpass', 1200 + Math.random() * 3500, 1.6, 0.12 + Math.random() * 0.12, out);
    }
    this._noiseBurst(t + 0.05, 1.4, 'highpass', 5000, 0.7, 0.12, out, 0.05);
    // A dull echo off the woods.
    this._tone(t + 0.32, 'sine', 62, 34, 0.7, 0.22, out, 0.01);
    this._noiseBurst(t + 0.32, 0.4, 'lowpass', 260, 0.8, 0.18, out, 0.01);
    return 2.0;
  },
  /** The privy goes: a splintering crash and a crunch of planks. */
  smash(t, out) {
    this._noiseBurst(t, 0.09, 'highpass', 900, 0.7, 0.9, out, 0.001);
    this._noiseBurst(t, 0.5, 'bandpass', 520, 0.9, 0.7, out, 0.002);
    this._tone(t, 'triangle', 210, 70, 0.25, 0.55, out, 0.001);
    this._tone(t, 'sine', 90, 40, 0.5, 0.5, out, 0.002);
    for (let i = 0; i < 22; i++) {
      const tt = t + 0.01 + Math.random() * 0.45;
      this._noiseBurst(tt, 0.008 + Math.random() * 0.03, 'bandpass', 700 + Math.random() * 3800, 2, 0.15 + Math.random() * 0.2, out);
    }
    return 1.0;
  },
  /** Planks landing and knocking about. */
  clatter(t, out) {
    for (let i = 0; i < 14; i++) {
      const tt = t + Math.pow(i / 14, 1.4) * 1.3 + Math.random() * 0.04;
      const f = 260 + Math.random() * 380;
      this._tone(tt, 'triangle', f, f * 0.8, 0.07, 0.22 * (1 - i / 18), out, 0.001);
      this._noiseBurst(tt, 0.03, 'bandpass', 1400 + Math.random() * 1200, 3, 0.12, out, 0.001);
    }
    return 1.6;
  },
  /** The comic slide whistle down (the toilet roll's trip). */
  whistle(t, out) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1900, t);
    o.frequency.exponentialRampToValueAtTime(380, t + 0.85);
    const vib = c.createOscillator(); vib.frequency.value = 7; const vd = c.createGain(); vd.gain.value = 18; vib.connect(vd).connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.04);
    g.gain.setValueAtTime(0.2, t + 0.75); g.gain.linearRampToValueAtTime(0, t + 0.9);
    o.connect(g).connect(out);
    o.start(t); vib.start(t); o.stop(t + 0.95); vib.stop(t + 0.95);
    return 1.0;
  },
  thud(t, out) {
    this._tone(t, 'sine', 58, 33, 0.7, 0.8, out, 0.002);
    this._tone(t, 'triangle', 90, 45, 0.25, 0.3, out, 0.002);
    this._noiseBurst(t, 0.45, 'lowpass', 320, 0.8, 0.5, out, 0.004);
    for (let i = 0; i < 10; i++) {
      const tt = t + 0.08 + Math.random() * 0.7;
      this._noiseBurst(tt, 0.012, 'bandpass', 1500 + Math.random() * 3000, 1.5, 0.08 + Math.random() * 0.07, out);
    }
    return 1.0;
  },
  'ui-ok'(t, out) {
    this._tone(t, 'triangle', 880, 880, 0.07, 0.18, out);
    this._tone(t + 0.065, 'triangle', 1320, 1320, 0.1, 0.18, out);
    return 0.25;
  },
  'ui-back'(t, out) {
    this._tone(t, 'triangle', 660, 660, 0.07, 0.16, out);
    this._tone(t + 0.065, 'triangle', 440, 440, 0.1, 0.16, out);
    return 0.25;
  },
  join(t, out) {
    [74, 78, 81].forEach((m, i) => this._tone(t + i * 0.07, 'triangle', mtof(m), mtof(m), 0.14, 0.17, out));
    SFX.honk.call(this, t + 0.28, out);
    return 0.7;
  },
  star(t, out) {
    [86, 90, 93, 98].forEach((m, i) => {
      this._tone(t + i * 0.06, 'sine', mtof(m), mtof(m), 0.4, 0.12, out, 0.002);
      this._tone(t + i * 0.06, 'sine', mtof(m) * 2.01, mtof(m) * 2.01, 0.25, 0.04, out, 0.002);
    });
    return 0.8;
  },
  tut(t, out) {
    for (const dt of [0, 0.16]) {
      this._noiseBurst(t + dt, 0.007, 'bandpass', 2100, 4, 0.5, out, 0.001);
      this._tone(t + dt, 'sine', 1150, 900, 0.025, 0.12, out, 0.001);
    }
    return 0.35;
  },
  honk(t, out) {
    const c = /** @type {BaseAudioContext} */ (this.ctx);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(330, t);
    o.frequency.linearRampToValueAtTime(400, t + 0.05);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.26);
    const rough = c.createOscillator(); rough.frequency.value = 31;
    const rd = c.createGain(); rd.gain.value = 25; rough.connect(rd).connect(o.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 950; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2400; f2.Q.value = 5;
    const mix = c.createGain(); mix.gain.value = 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.setValueAtTime(0.45, t + 0.2);
    g.gain.linearRampToValueAtTime(0, t + 0.28);
    o.connect(f1); o.connect(f2); f1.connect(mix); f2.connect(mix);
    mix.connect(g).connect(out);
    o.start(t); rough.start(t); o.stop(t + 0.3); rough.stop(t + 0.3);
    return 0.35;
  },
};

/** Attack/decay envelope on a gain param (decay is exponential to near silence). */
function env(param, t, attack, peak, decay) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(Math.max(peak * 0.001, 1e-4), t + attack + decay);
  param.setValueAtTime(0, t + attack + decay + 0.001);
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}
