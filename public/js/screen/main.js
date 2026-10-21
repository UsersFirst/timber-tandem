// @ts-check
// ============================================================
// main — the screen: title → host a game here, or join another home
// ============================================================

import '../../lib/ui/index.js';
import { RoomHost } from '../net/room-host.js';
import { RelayClient } from '../net/relay-client.js';
import { ClockSync } from '../core/clock-sync.js';
import { normalizeCode } from '../core/protocol.js';
import { Game } from './game.js';
import { Presenter } from './presenter.js';

const params = new URLSearchParams(location.search);
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('scene'));

/** @type {Presenter|null} */
let presenter = null;

// Browsers only start audio after a gesture: unlock on the first tap or key.
const unlockOnce = () => { presenter?.unlockAudio(); };
window.addEventListener('pointerdown', unlockOnce, { once: true });
window.addEventListener('keydown', unlockOnce, { once: true });

function boot() {
  const join = params.get('join');
  if (join) return startGuest(join);
  if (params.has('host')) return startHost();
  $('title').hidden = false;
}

// Title buttons.
$('title').addEventListener('click', (ev) => {
  const a = /** @type {HTMLElement} */ (ev.target)?.closest?.('[data-title]')?.getAttribute('data-title');
  if (a === 'host') startHost();
  if (a === 'join') { $('title-main').hidden = true; $('title-join').hidden = false; setTimeout(() => /** @type {any} */ ($('join-code')).focus?.(), 50); }
  if (a === 'join-back') { $('title-main').hidden = false; $('title-join').hidden = true; }
});
$('join-code').addEventListener('complete', (ev) => {
  const code = normalizeCode(/** @type {any} */ (ev).detail?.code);
  if (code) startGuest(code);
});
$('join-keypad').addEventListener('key', (ev) => {
  const key = /** @type {any} */ (ev).detail?.key;
  const jc = /** @type {any} */ ($('join-code'));
  if (key === 'done') { const c = normalizeCode(jc.value); if (c) startGuest(c); }
});

// ---------------- host ----------------

async function startHost() {
  $('title').hidden = true;
  document.documentElement.dataset.role = 'host';
  /** @type {Game} */
  let game;
  const room = new RoomHost({
    onSamples: (seat, s, at) => game.onSamples(seat, s, at),
    onPadMsg: (seat, m) => game.onPadMsg(seat, m),
    onPadJoined: (seat) => game.onPadJoined(seat),
    onPadLeft: (seat) => game.onPadLeft(seat),
    onScreenJoined: (id) => game.onScreenJoined(id),
    onScreenLeft: (id) => game.onScreenLeft(id),
    onScreenMsg: () => {},
    onState: (s) => { $('net').textContent = s === 'open' ? '' : s === 'connecting' ? 'Connecting to the room…' : 'Reconnecting…'; if (s === 'open') game?.refreshLinks(); },
  }, { relayBase: params.get('relay') || undefined });

  presenter = new Presenter({
    canvas, role: 'host', toLocal: (h) => h, quality: params.get('quality') || undefined, noScene: params.has('noscene'),
    onAction: (a, arg) => hostAction(game, a, arg),
  });
  game = new Game({ room, emit: (ev) => presenter?.event(ev), params });
  /** @type {any} */ (window).__game = game;
  await presenter.unlockAudio();
  room.open();
  presenter.event({ k: 'cast', cast: { A: game.seats.A.goose, B: game.seats.B.goose } });
  presenter.event({ k: 'camera', mode: 'intro' });
  presenter.event({ k: 'tree', def: { kind: 'small', targetDeg: 8 }, name: '' });
  presenter.event({ k: 'phase', phase: 'lobby' });
  bindKeys(game);
  runLoop(() => {
    const now = performance.now();
    const v = game.frame(now);
    presenter?.frame(v, now);
  });
}

/**
 * requestAnimationFrame, plus a timer when the tab is hidden: the host is the
 * one copy of the saw, so its game must keep running even if someone switches
 * tabs on the laptop driving the TV.
 * @param {() => void} tick
 */
function runLoop(tick) {
  let last = 0;
  const raf = () => { last = performance.now(); tick(); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  setInterval(() => { if (document.hidden || performance.now() - last > 120) { last = performance.now(); tick(); } }, 33);
}

/** @param {Game} game @param {string} a @param {any} arg */
function hostAction(game, a, arg) {
  switch (a) {
    case 'start': game.start(); break;
    case 'grandma': game.useGrandma(arg === 'on'); break;
    case 'invite': game.openInvite(!game.inviteOpen); game.refreshLinks(); break;
    case 'keys': game.setKind(arg, 'keys'); break;
    case 'next': game.next(); break;
    case 'again': game.toLobby(); break;
    case 'skip-calib': game.skipCalibration(); break;
    case 'skip-intro': game.skipIntro(); break;
    case 'spike-dl': download(`timber-spike-${Date.now()}.json`, JSON.stringify(game.spikeDump())); break;
    default:
  }
}

/** @param {Game} game */
function bindKeys(game) {
  const map = {
    KeyF: ['A', 'pull'], KeyD: ['A', 'chop'], KeyQ: ['A', 'left'], KeyW: ['A', 'right'],
    KeyJ: ['B', 'pull'], KeyK: ['B', 'chop'], KeyO: ['B', 'left'], KeyP: ['B', 'right'],
  };
  const on = (down) => (ev) => {
    if (ev.repeat) return;
    const m = map[ev.code];
    if (m) { game.key(m[0], m[1], down); ev.preventDefault(); }
    if (down && (ev.code === 'Enter' || ev.code === 'Space')) {
      if (game.phase === 'lobby') game.start();
      else if (game.phase === 'score' || game.phase === 'end') game.next();
      else if (game.phase === 'intro') game.skipIntro();
    }
  };
  window.addEventListener('keydown', on(true));
  window.addEventListener('keyup', on(false));
}

// ---------------- guest (a second home) ----------------

/** @param {string} codeIn */
async function startGuest(codeIn) {
  const code = normalizeCode(codeIn);
  if (!code) { $('title').hidden = false; return; }
  $('title').hidden = true;
  document.documentElement.dataset.role = 'guest';
  const clock = new ClockSync();
  /** @type {any} */
  let view = null;
  const id = Math.random().toString(36).slice(2, 12);
  presenter = new Presenter({ canvas, role: 'guest', toLocal: (h) => clock.toLocal(h), onAction: () => {}, quality: params.get('quality') || undefined, noScene: params.has('noscene') });
  await presenter.unlockAudio();
  /** @type {any[]} */
  const early = [];
  const relay = new RelayClient({
    code, role: 'screen', id, base: params.get('relay') || undefined,
    onState: (s, info) => {
      $('net').textContent = s === 'open' ? '' : s === 'refused' ? 'Couldn’t join that home — check the code.' : 'Connecting to the other home…';
      void info;
    },
    onJson: (m) => {
      switch (m.t) {
        case 'pong': clock.add(m.c0, m.h, performance.now()); break;
        case 'welcome':
          presenter?.event({ k: 'cast', cast: m.cast });
          if (m.song) early.push({ k: 'song', ...m.song });
          break;
        case 'pair': if (presenter) presenter.hud.guestLink = m.link; presenter && (presenter.hud.lastLobby = ''); break;
        case 'state': view = m.v; break;
        case 'ev':
          // Song/click times need the clock; hold them until it's synced.
          if (!clock.synced && (m.ev.k === 'song' || m.ev.k === 'clicks')) early.push(m.ev);
          else presenter?.event(m.ev);
          break;
        case 'host-left': $('net').textContent = 'The other home’s screen went away — waiting…'; break;
        default:
      }
    },
  });
  relay.connect();
  let pid = 0;
  setInterval(() => {
    if (!relay.open) return;
    if (clock.synced && pid % 5 !== 0) { pid++; return; }
    relay.send({ t: 'ping', id: ++pid, c0: performance.now() });
  }, 400);
  presenter.event({ k: 'camera', mode: 'intro' });
  presenter.event({ k: 'tree', def: { kind: 'small', targetDeg: 8 }, name: '' });
  runLoop(() => {
    if (clock.synced && early.length) for (const ev of early.splice(0)) presenter?.event(ev);
    if (view) {
      if (view.phase !== presenter?.hud._lastPhase) { presenter?.event({ k: 'phase', phase: view.phase }); if (presenter) presenter.hud._lastPhase = view.phase; }
      presenter?.frame(view, clock.toHost(performance.now()));
    }
  });
  /** @type {any} */ (window).__guest = { clock, relay, get view() { return view; } };
}

/** @param {string} name @param {string} text */
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

boot();
