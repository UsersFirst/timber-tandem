// @ts-check
// ============================================================
// phone-app — the phone as a saw handle and a hatchet
// ============================================================
// Joins the room as pad-N with the secret from the QR link (#CODE.SEAT.SECRET),
// syncs its clock to the host, tracks strokes and chops on the phone, and
// streams timestamped samples. The phone's screen isn't watched while it's a
// tool (PLAN §1, lesson 1): the TV teaches; the phone only shows a big seat
// color and one line of text, plus the touch pad when there's no motion.
// ============================================================

import { RelayClient } from '../net/relay-client.js';
import { ClockSync } from '../core/clock-sync.js';
import { StrokeTracker, defaultProfile, tempoOf } from '../core/stroke-tracker.js';
import { HatchetDetector, CHOP } from '../core/hatchet.js';
import { HoldPull } from '../core/input-buffer.js';
import { encodeSamples, parsePairFragment, FLAG_VALID, FLAG_HELD } from '../core/protocol.js';
import { restGravity, pullDirection, strokeAxis, rollSignFrom, chopPeak } from '../core/calibration.js';
import { motionSupport, inAppBrowser, requestMotion, startMotion, keepAwake, buzz } from './motion.js';
import { SimSawyer } from './sim.js';

/** @typedef {import('./motion.js').RawMotion} RawMotion */

const params = new URLSearchParams(location.search);
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const ui = {
  root: document.documentElement,
  seat: $('seat'),
  line: $('line'),
  sub: $('sub'),
  start: /** @type {HTMLButtonElement} */ ($('start')),
  touchBtn: /** @type {HTMLButtonElement} */ ($('use-touch')),
  pad: $('pad'),
  status: $('status'),
};

const pair = parsePairFragment(location.hash);
const app = {
  seat: pair?.seat ?? 0,
  mode: 'lobby',
  /** @type {any} */
  modeInfo: {},
  clock: new ClockSync(),
  tracker: new StrokeTracker(),
  hatchet: new HatchetDetector({ peak: CHOP.DEFAULT_PEAK }),
  profile: { ...defaultProfile(), chopPeak: CHOP.DEFAULT_PEAK },
  /** @type {'motion'|'touch'|null} */
  input: null,
  seq: 0,
  /** @type {import('../core/protocol.js').StrokeSample[]} */
  outbox: [],
  spike: params.has('spike'),
  /** @type {number[][]} */
  rawOut: [],
  hold: new HoldPull(),
  held: false,
  touchRoll: 0,
  lastTouchT: 0,
  /** @type {SimSawyer|null} */
  sim: null,
  calib: /** @type {any} */ ({}),
  /** @type {RelayClient} */
  relay: /** @type {any} */ (null),
  /** @type {any} */
  motion: null,
  _lastPing: 0,
  _pingId: 0,
  _touchX0: 0,
  _downT: 0,
};

if (!pair) {
  setScreen('Scan the code on the TV', 'This page needs the link from the QR code.');
  ui.start.hidden = true;
} else {
  connect();
}

function connect() {
  const relay = new RelayClient({
    code: pair.code,
    role: 'pad-' + pair.seat,
    key: pair.secret,
    base: params.get('relay') || undefined,
    onState: (s, info) => {
      if (s === 'open') ui.status.textContent = 'Connected';
      else if (s === 'refused') { ui.status.textContent = info?.code === 4001 ? 'A new link replaced this one — scan again' : 'This link has expired — scan the TV again'; }
      else if (s === 'closed') ui.status.textContent = 'Reconnecting…';
    },
    onJson: onHostMessage,
  });
  app.relay = relay;
  relay.connect();
  setScreen('Tap to pick up the saw', 'Hold your phone in a firm fist, like a saw handle.');
  setInterval(pingHost, 700);
}

function pingHost() {
  if (!app.relay?.open) return;
  // Ping fast until synced, then every few seconds to follow drift.
  const now = performance.now();
  if (app.clock.synced && now - (app._lastPing || 0) < 3000) return;
  app._lastPing = now;
  app.relay.send({ t: 'ping', id: (app._pingId = (app._pingId || 0) + 1), c0: now });
}

/** @param {any} m */
function onHostMessage(m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'host-ready':
      sendHello();
      break;
    case 'host-left':
      ui.status.textContent = 'The TV went away — waiting…';
      break;
    case 'pong':
      app.clock.add(m.c0, m.h, performance.now());
      break;
    case 'seat':
      ui.root.style.setProperty('--seat', m.color || '#e8743b');
      ui.seat.textContent = m.label || '';
      break;
    case 'mode':
      setMode(m.mode, m);
      break;
    case 'turn':
      if (m.seat === app.seat) { buzz(25); app.sim?.myTurn(); }
      break;
    case 'cue':
      cue(m.kind);
      break;
    default:
  }
}

function sendHello() {
  app.relay.send({
    t: 'hello',
    ua: navigator.userAgent.slice(0, 160),
    motion: app.input === 'touch' ? 'touch' : app.input === 'motion' ? 'ok' : 'pending',
    rateHz: app.motion?.rateHz?.() || 0,
    calibrated: !!app.calib.done,
    sim: app.sim ? app.sim.kind : null,
  });
}

// ---------- start: permission, wake lock, motion or touch ----------

ui.start.addEventListener('click', async () => {
  ui.start.disabled = true;
  try { /** @type {any} */ (navigator).audioSession && (/** @type {any} */ (navigator).audioSession.type = 'playback'); } catch { /* old Safari */ }
  keepAwake();
  if (params.get('sim')) return startSim();
  if (inAppBrowser()) {
    setScreen('Open this in Safari or Chrome', 'This app’s browser blocks motion. Use the ⋯ menu → Open in browser.');
  }
  const res = await requestMotion();
  if (res !== 'granted') return startTouch(res === 'denied' ? 'Motion was blocked. To allow it: Settings → Safari → Motion & Orientation, then reload. Or saw by touch:' : 'No motion sensors here — saw by touch:');
  const mot = startMotion(onMotion);
  app.motion = mot;
  const cap = await mot.capability;
  if (cap !== 'ok') { mot.stop(); return startTouch('This phone has no gyroscope, so it saws by touch:'); }
  app.input = 'motion';
  ui.start.hidden = true;
  ui.touchBtn.hidden = true;
  setScreen('Look at the TV', 'Keep a firm fist. Small strokes are plenty.');
  sendHello();
});

ui.touchBtn.addEventListener('click', () => startTouch('Saw by touch:'));

function startSim() {
  app.sim = new SimSawyer(params.get('sim') || 'good', params, app.seat);
  app.sim.toHost = (t) => app.clock.toHost(t);
  app.sim.start(onMotion);
  app.input = 'motion';
  ui.start.hidden = true;
  ui.touchBtn.hidden = true;
  setScreen('Simulated sawyer', params.get('sim') || 'good');
  sendHello();
}

/** @param {string} why */
function startTouch(why) {
  app.motion?.stop?.();
  app.input = 'touch';
  ui.start.hidden = true;
  ui.touchBtn.hidden = true;
  ui.pad.hidden = false;
  setScreen('Hold to pull', why + ' hold the pad while you pull, let go on your partner’s pull. Slide sideways to steer. Tap to chop.');
  const down = (ev) => {
    ev.preventDefault();
    app.held = true;
    app._touchX0 = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
    app._downT = performance.now();
    ui.pad.classList.add('held');
  };
  const move = (ev) => {
    const x = ev.clientX ?? ev.touches?.[0]?.clientX;
    if (app.held && typeof x === 'number') app.touchRoll = Math.max(-1, Math.min(1, (x - app._touchX0) / (window.innerWidth * 0.3)));
  };
  const up = () => {
    if (app.held && performance.now() - app._downT < 180 && app.mode === 'chop') sendHit(performance.now(), 'good', 400, [1, 0, 0]);
    app.held = false;
    ui.pad.classList.remove('held');
  };
  ui.pad.addEventListener('pointerdown', down);
  ui.pad.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  const tick = () => {
    const now = performance.now();
    const dt = app.lastTouchT ? now - app.lastTouchT : 16;
    app.lastTouchT = now;
    const beatMs = 60000 / (app.modeInfo?.song?.bpm || 96);
    const r = app.hold.step(Math.min(50, dt), app.held, beatMs);
    queueSample({ t: now, p: r.p, v: r.v, roll: app.touchRoll, flags: FLAG_VALID | FLAG_HELD });
  };
  setInterval(tick, 1000 / 60);
  sendHello();
}

// ---------- the stream ----------

/** @param {RawMotion} m */
function onMotion(m) {
  if (app.spike) app.rawOut.push([Math.round(app.clock.toHost(m.t) * 10) / 10, ...m.a.map(r3), ...(m.g || [0, 0, 0]).map(r3), ...m.r.map(r1)]);
  calibrate(m);
  const rev = app.tracker.push({ t: m.t, a: m.a, g: m.g });
  if (app._lastM && m.t - app._lastM > 60) app.gaps = (app.gaps || 0) + 1;
  app._lastM = m.t;
  if (rev && app.clock.synced) app.relay.send({ t: 'rev', at: app.clock.toHost(rev.t), end: rev.end, travel: rev.travel, ms: Math.round(rev.ms) });
  if (app.mode === 'chop' || app.mode === 'calib-chop') {
    const hit = app.hatchet.push({ t: m.t, r: m.r });
    if (hit) {
      if (app.mode === 'calib-chop') app.calib.chops.push(hit.peak);
      else sendHit(hit.t, hit.grade, hit.peak, hit.axis);
    }
  }
  queueSample({ t: m.t, p: app.tracker.p, v: app.tracker.pv, roll: app.tracker.roll, flags: FLAG_VALID });
  if (app.spike && app.rawOut.length >= 6) {
    app.relay.send({ t: 'raw', s: app.rawOut });
    app.rawOut = [];
  }
}

/** @param {import('../core/protocol.js').StrokeSample} s */
function queueSample(s) {
  if (!app.clock.synced) return;
  app.outbox.push({ ...s, t: app.clock.toHost(s.t) });
  if (app.outbox.length >= 2) {
    app.relay.sendRaw(encodeSamples(app.seq++, app.outbox));
    app.outbox = [];
  }
}

function sendHit(t, grade, peak, axis) {
  if (!app.clock.synced) return;
  app.relay.send({ t: 'hit', at: app.clock.toHost(t), grade, peak: Math.round(peak), axis: axis.map(r3) });
}

// ---------- modes and calibration ----------

/** @param {string} mode @param {any} info */
function setMode(mode, info) {
  app.mode = mode;
  app.modeInfo = info || {};
  app.sim?.setMode(mode, info);
  if (mode.startsWith('calib-')) beginCalib(mode);
  const text = {
    lobby: ['Look at the TV', 'Waiting for everyone.'],
    'calib-rest': ['Hold still', 'Firm fist, phone like a saw handle.'],
    'calib-pull': ['Pull to your belly', 'One slow pull, then stop.'],
    'calib-saw': ['Saw the air', 'Small smooth strokes. Pull, then let go.'],
    'calib-twist': ['Twist your fist →', 'Toward the right side of the TV.'],
    'calib-chop': ['Three small chops', 'Below your shoulders. Wrist and forearm.'],
    saw: ['Saw!', 'Pull to you, let your partner pull it back.'],
    chop: ['Chop on your turn', 'Your side glows on the TV.'],
    idle: ['Look at the TV', ''],
  }[mode] || ['Look at the TV', ''];
  if (app.input !== 'touch') setScreen(text[0], text[1]);
  ui.root.dataset.mode = mode;
}

/** @param {string} mode */
function beginCalib(mode) {
  const c = app.calib;
  c.step = mode;
  c.t0 = performance.now();
  if (app.input === 'touch') return reportCalib(mode.slice(6), true, { touch: true });
  if (mode === 'calib-rest') { c.gs = []; c.quiet = 0; }
  if (mode === 'calib-pull') { c.pull = []; }
  if (mode === 'calib-saw') { c.accs = []; c.axisSet = false; app.tracker.reversals.length = 0; }
  if (mode === 'calib-twist') { c.rolls = []; app.tracker.setProfile({ ...app.tracker.profile, rollSign: 1 }); }
  if (mode === 'calib-chop') { c.chops = []; app.hatchet.reset(); }
}

/** @param {RawMotion} m */
function calibrate(m) {
  const c = app.calib;
  const mode = app.mode;
  if (!mode.startsWith('calib-') || c.reported === mode || app.input !== 'motion') return;
  const since = m.t - c.t0;
  if (mode === 'calib-rest') {
    const still = Math.hypot(...m.a) < 0.7 && Math.hypot(...m.r) < 40;
    if (still && m.g) { c.gs.push(m.g); c.quiet++; } else { c.gs = []; c.quiet = 0; }
    if (c.quiet >= 60) {
      const g = restGravity(c.gs);
      if (g) { app.profile.restG = g; app.tracker.setProfile({ ...app.tracker.profile, restG: g }); reportCalib('rest', true); }
    }
  } else if (mode === 'calib-pull') {
    c.pull.push({ t: m.t, a: m.a });
    const moved = c.pull.some((s) => Math.hypot(...s.a) > 1.2);
    if (moved && since > 900) {
      const d = pullDirection(c.pull);
      if (d) { app.profile.pullDir = d; reportCalib('pull', true); }
    }
    if (since > 6000) reportCalib('pull', false, { why: 'no pull seen' });
  } else if (mode === 'calib-saw') {
    if (!c.axisSet) {
      if (Math.hypot(...m.a) > 0.6) c.accs.push(m.a);
      if (c.accs.length >= 140) {
        const ax = strokeAxis(c.accs, app.profile.pullDir || null);
        if (ax) {
          app.profile.axis = ax.axis;
          app.tracker.setProfile({ ...app.tracker.profile, axis: ax.axis });
          app.tracker.reset();
          c.axisSet = true;
          app.relay.send({ t: 'calib', step: 'saw-axis', ok: ax.quality > 0.5, quality: Math.round(ax.quality * 100) / 100 });
        }
      }
    } else if (app.tracker.reversals.length >= 6 && !c.tempoSent) {
      c.tempoSent = true;
      app.relay.send({ t: 'calib', step: 'saw-tempo', ok: true, bpm: Math.round(tempoOf(app.tracker.reversals.slice(1)) || 96), halfTravel: Math.round(app.tracker.halfTravel * 1000) / 1000 });
    }
    // The host decides when the saw step ends (after strokes on the clicks).
  } else if (mode === 'calib-twist') {
    c.rolls.push(app.tracker.rollDeg);
    if (since > 2200) {
      const sign = rollSignFrom(c.rolls);
      if (sign) { app.profile.rollSign = sign; app.tracker.setProfile({ ...app.tracker.profile, rollSign: sign }); reportCalib('twist', true, { sign }); }
      else if (since > 7000) reportCalib('twist', false, { why: 'no twist seen' });
    }
  } else if (mode === 'calib-chop') {
    if (c.chops.length >= 3) {
      const peak = chopPeak(c.chops) || CHOP.DEFAULT_PEAK;
      app.profile.chopPeak = peak;
      app.hatchet = new HatchetDetector({ peak });
      reportCalib('chop', true, { peak: Math.round(peak) });
    }
  }
}

function reportCalib(step, ok, extra = {}) {
  app.calib.reported = 'calib-' + step;
  if (step === 'chop') app.calib.done = true;
  app.relay.send({ t: 'calib', step, ok, ...extra });
  if (ok) buzz(15);
}

/** @param {string} kind */
function cue(kind) {
  const pattern = { bite: 8, tantrum: [40, 30, 60], turn: 25, timber: [80, 40, 120], ok: 15 }[kind];
  if (pattern) buzz(pattern);
}

function setScreen(line, sub) {
  ui.line.textContent = line;
  ui.sub.textContent = sub || '';
}

const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

// Expose for smokes.
/** @type {any} */ (window).__phone = app;
// Mark motion support early for the page.
ui.root.dataset.support = motionSupport();
