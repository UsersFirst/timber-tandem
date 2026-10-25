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
  menu: $('menu'),
  pause: /** @type {HTMLButtonElement} */ ($('pause')),
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
  /** @type {import('../core/stroke-tracker.js').StrokeProfile & {chopPeak:number, pullDir?: import('../core/vec.js').Vec3|null, flipped?: boolean}} */
  profile: { ...defaultProfile(), chopPeak: CHOP.DEFAULT_PEAK, pullDir: null },
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
  /** @type {{id:string, label:string, primary?:boolean, local?:boolean}[]} */
  menu: [],
};

if (!pair) {
  setScreen('Scan the code on the TV', 'This page needs the link from the QR code.');
  ui.start.hidden = true;
} else {
  restoreProfile();
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
      else if (s === 'refused') {
        ui.status.textContent = info?.code === 4001 ? 'A new link replaced this one — scan again'
          : info?.code === 4002 ? 'Another phone took this handle'
          : 'This link has expired — scan the TV again';
        setScreen(info?.code === 4002 ? 'Another phone took this handle' : 'Scan the TV again', 'Each handle needs its own phone.');
      }
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
      // The host may have reloaded: its clock started over.
      app.clock.reset();
      sendHello();
      break;
    case 'host-left':
      ui.status.textContent = 'The TV went away — waiting…';
      break;
    case 'pong':
      app.clock.add(m.c0, m.h, performance.now(), m.hb);
      break;
    case 'seat':
      ui.root.style.setProperty('--seat', m.color || '#e8743b');
      ui.seat.textContent = m.label || '';
      break;
    case 'mode':
      setMode(m.mode, m);
      break;
    case 'menu':
      renderMenu(m.items || []);
      break;
    case 'flip':
      // The lesson found this phone's pull backwards.
      localAction('flip');
      buzz([30, 40, 30]);
      break;
    case 'turn':
      if (m.seat === app.seat) { buzz(25); app.sim?.myTurn(); }
      break;
    case 'cue':
      cue(m.kind);
      break;
    case 'aim':
      drawAim(m);
      break;
    default:
  }
}

/**
 * The aim while sawing: the same fan as the TV's aim map, from above (up =
 * away from you, toward the fall). A glance cue: the phone is in your fist.
 * @param {{deg:number, target:number, grade:string}} m
 */
function drawAim(m) {
  const SPREAD = 2.4, R = 95, MAX = 25;
  const pt = (deg, r) => { const a = (deg * SPREAD * Math.PI) / 180; return [Math.sin(a) * r, -Math.cos(a) * r]; };
  const sector = (d0, d1) => { const [x0, y0] = pt(d0, R), [x1, y1] = pt(d1, R); return `M0 0 L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`; };
  const $ = (id) => /** @type {SVGElement} */ (/** @type {unknown} */ (document.getElementById(id)));
  $('aim-fan').setAttribute('d', sector(-MAX, MAX));
  $('aim-close').setAttribute('d', sector(m.target - 10, m.target + 10));
  $('aim-skid').setAttribute('d', sector(m.target - 4, m.target + 4));
  const [x, y] = pt(m.deg, 88);
  const col = m.grade === 'skid' ? '#7ee08a' : m.grade === 'close' ? '#f2b24c' : m.grade === 'privy' ? '#ff5a4a' : '#fff2c4';
  const arrow = $('aim-arrow');
  arrow.setAttribute('x2', x.toFixed(1)); arrow.setAttribute('y2', y.toFixed(1)); arrow.setAttribute('stroke', col);
  const word = /** @type {HTMLElement} */ (document.getElementById('aim-word'));
  word.textContent = m.grade === 'skid' ? 'On the skid — hold it' : m.grade === 'close' ? 'Close — twist a little' : m.grade === 'privy' ? 'That’s the privy!' : 'Twist to aim';
  word.style.color = col;
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
  lockPortrait();
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
      if (app.mode === 'calib-chop') { app.calib.chops.push(hit.peak); app.relay.send({ t: 'calib-progress', step: 'chop', n: app.calib.chops.length, of: 3 }); }
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
  const changed = mode !== app.mode;
  app.mode = mode;
  app.modeInfo = info || {};
  if (changed || info?.song) app.sim?.setMode(mode, info);
  // The host re-sends the same mode (e.g. the saw step's click stage): keep going.
  if (mode.startsWith('calib-') && (changed || info?.again)) beginCalib(mode);
  const text = {
    lobby: ['Look at the TV', 'Waiting for everyone.'],
    'calib-rest': ['Hold still', 'Firm fist, phone like a saw handle.'],
    'calib-pull': ['Pull to your belly', 'One slow pull, then hold it there.'],
    'calib-saw': ['Saw the air', 'Back to you, then forward. Watch your hand on the TV.'],
    'calib-twist': ['Twist your fist →', 'Toward the right side of the TV.'],
    'calib-chop': ['Three small chops', 'Below your shoulders. Wrist and forearm.'],
    safety: ['Safety first', 'Read the card on the TV, then tap Got it.'],
    between: ['Timber!', 'What next?'],
    held: ['Paused', 'Old Misery waits.'],
    saw: ['Saw!', 'Back, then forward. Follow the cue under your goose.'],
    chop: ['Chop on your turn', 'Your side glows on the TV.'],
    idle: ['Look at the TV', ''],
  }[mode] || ['Look at the TV', ''];
  // The TV is on its main menu: the phone can pick the game too.
  const shown = mode === 'lobby' && info?.menu === 'title' ? ['Pick a game', 'On the TV, or right here.'] : text;
  if (app.input !== 'touch') setScreen(shown[0], shown[1]);
  ui.root.dataset.mode = mode;
  renderMenu(app.menu);
}

// ---------- menus: the TV's choices, on the phone ----------

/**
 * The host sends the buttons that make sense right now; the phone shows them
 * so a game can be run from the couch. While the phone is a tool (chopping,
 * sawing) the only one is Pause, small and press-and-hold, so a fist can't
 * pause by accident.
 * @param {{id:string, label:string, primary?:boolean, local?:boolean}[]} items
 */
function renderMenu(items) {
  app.menu = items;
  const tool = app.mode === 'saw' || app.mode === 'chop';
  const pause = items.find((i) => i.id === 'pause');
  ui.pause.hidden = !(tool && pause);
  const list = tool ? [] : items;
  ui.menu.innerHTML = '';
  for (const it of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.className = it.primary ? 'primary' : '';
    b.dataset.id = it.id;
    b.addEventListener('click', () => {
      buzz(15);
      if (it.local) return localAction(it.id);
      app.relay?.send({ t: 'menu', id: it.id });
    });
    ui.menu.appendChild(b);
  }
  ui.menu.hidden = !list.length;
}

// Pause while sawing: press and hold for half a second.
{
  let timer = 0;
  const cancel = () => { clearTimeout(timer); ui.pause.classList.remove('arming'); };
  ui.pause.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    ui.pause.classList.add('arming');
    timer = window.setTimeout(() => { cancel(); buzz(30); app.relay?.send({ t: 'menu', id: 'pause' }); }, 550);
  });
  for (const e of ['pointerup', 'pointercancel', 'pointerleave']) ui.pause.addEventListener(e, cancel);
}

/** @param {string} id */
function localAction(id) {
  if (id === 'flip') {
    // "My hand goes the wrong way": turn this phone's stroke direction round.
    const p = app.profile;
    p.axis = /** @type {any} */ (p.axis.map((x) => -x));
    if (p.pullDir) p.pullDir = /** @type {any} */ (p.pullDir.map((x) => -x));
    p.flipped = !p.flipped;
    app.tracker.setProfile({ ...app.tracker.profile, axis: p.axis });
    app.tracker.reset({ keepLearned: true });
    saveProfile();
    app.relay?.send({ t: 'flipped', on: !!p.flipped });
  }
}

/** Android rotates the page on a quick twist, and Chrome pauses motion while it does: hold portrait. */
function lockPortrait() {
  try {
    const el = /** @type {any} */ (document.documentElement);
    const orient = /** @type {any} */ (screen).orientation;
    if (!el.requestFullscreen || !orient?.lock) return;
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => orient.lock('portrait'))
      .catch(() => { /* not allowed here: the tip covers it */ });
  } catch { /* old browser */ }
}

/** @param {string} mode */
function beginCalib(mode) {
  const c = app.calib;
  c.step = mode;
  c.t0 = performance.now();
  c.reported = '';
  c.tempoSent = false;
  c.lastRevN = -1;
  c.lastMove = 0;
  if (app.input === 'touch') return reportCalib(mode.slice(6), true, { touch: true });
  if (mode === 'calib-rest') { c.gs = []; c.quiet = 0; }
  if (mode === 'calib-pull') { c.pull = []; c.peak = 0; c.peakT = 0; }
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
    const mag = Math.hypot(...m.a);
    if (mag > c.peak) { c.peak = mag; c.peakT = m.t; }
    const moved = c.peak > 1.2;
    // A hand held in the air is never still: the pull is over once the hand
    // has settled well below its peak for 250 ms (or time is nearly up).
    if (mag > Math.max(0.6, 0.25 * c.peak)) c.lastMove = m.t;
    const settled = moved && m.t - c.lastMove > 250;
    const late = moved && since > 5600;
    if (settled || late) {
      // Just the move: from before it started to when it settled.
      const end = settled ? m.t : c.peakT + 700;
      const d = pullDirection(c.pull.filter((x) => x.t >= c.peakT - 1200 && x.t <= end));
      if (d) { app.profile.pullDir = d; reportCalib('pull', true); }
      else if (late) reportCalib('pull', false, { why: 'unclear pull', peak: Math.round(c.peak * 10) / 10 });
    }
    if (since > 6500) reportCalib('pull', false, { why: moved ? 'unclear pull' : 'no pull seen', peak: Math.round(c.peak * 10) / 10 });
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
    } else if (app.tracker.reversals.length !== c.lastRevN && !c.tempoSent) {
      c.lastRevN = app.tracker.reversals.length;
      app.relay.send({ t: 'calib-progress', step: 'saw', n: Math.min(6, c.lastRevN), of: 6 });
    }
    if (c.axisSet && app.tracker.reversals.length >= 6 && !c.tempoSent) {
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
  if (step === 'chop') {
    app.calib.done = true;
    app.profile.halfTravel = app.tracker.halfTravel;
    saveProfile();
  }
  app.relay.send({ t: 'calib', step, ok, ...extra });
  if (ok) buzz(15);
}

/** @param {string} kind */
function cue(kind) {
  const pattern = { bite: 8, tantrum: [40, 30, 60], turn: 25, timber: [80, 40, 120], ok: 15 }[kind];
  if (pattern) buzz(pattern);
}

const PROFILE_KEY = pair ? `timber.profile.${pair.code}.${pair.seat}` : '';

/** Keep this phone's calibration if the page reloads (iOS drops background tabs). */
function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(app.profile)); } catch { /* blocked */ }
}

function restoreProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && Array.isArray(p.axis)) {
      app.profile = p;
      app.tracker.setProfile({ ...app.tracker.profile, ...p });
      app.hatchet = new HatchetDetector({ peak: p.chopPeak || CHOP.DEFAULT_PEAK });
      app.calib.done = true;
    }
  } catch { /* blocked */ }
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
