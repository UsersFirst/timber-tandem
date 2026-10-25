// @ts-check
// ============================================================
// main — the screen: the main menu → host a game here, or join another home
// ============================================================
// Main menu: Solo (you + Grandma), Two players (one screen), Online duo
// (host here, or join with a code), How to play. Picking a mode starts
// hosting on this screen; the room opens once and stays open, so going back
// to the menu and picking again keeps every paired phone.
// URL shortcuts: ?host[=solo|couch|online] hosts straight away (plain ?host
// is the couch lobby, as before); ?join=CODE joins another home.
// ============================================================

import '../../lib/ui/index.js';
import { RoomHost } from '../net/room-host.js';
import { RelayClient } from '../net/relay-client.js';
import { ClockSync } from '../core/clock-sync.js';
import { normalizeCode, CODE_PREFIX } from '../core/protocol.js';
import { isMode } from '../core/modes.js';
import { Game } from './game.js';
import { Presenter } from './presenter.js';
import { GuestKeys } from './guest-keys.js';
import { TouchPads, isTouchDevice } from './touch.js';
import { ScreenNav } from './nav.js';

const params = new URLSearchParams(location.search);

// Which build is this? version.json is written at deploy (scripts/stamp-version.mjs);
// local dev has none, and the label stays hidden.
fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((v) => {
  const el = document.getElementById('build');
  if (!v || !el) return;
  el.textContent = `v.${v.sha} · ${v.time}${v.pr ? ` · PR #${v.pr}` : ''}${v.dirty ? ' · local changes' : ''}`;
  el.hidden = false;
}).catch(() => {});
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($('scene'));

/** @type {Presenter|null} */
let presenter = null;
/** @type {Game|null} */
let game = null;
/** @type {'menu'|'host'|'guest'} */
let role = 'menu';

// Solo on just your phone (docs/TOUCH-SOLO.md). ?touch forces it on a desktop.
const touchDevice = isTouchDevice() || params.has('touch');
let touchWanted = params.has('touch') && params.get('host') === 'solo';
/** @type {TouchPads|null} */
let touch = null;
if (touchDevice) {
  // The main menu on a phone: Solo plays right here; two players on one
  // screen needs a TV or a laptop (online play by touch comes later).
  const solo = /** @type {any} */ (document.querySelector('[data-title="solo"]'));
  const couch = /** @type {any} */ (document.querySelector('[data-title="couch"]'));
  if (solo) { solo.label = 'Solo — on this phone'; solo.sub = 'Your thumbs on the saw · Grandma on the other end'; }
  if (couch) { couch.disabled = true; couch.sub = 'Needs a TV or laptop'; }
}

/** Start (or restart) touch play on this game. @param {Game} g */
function beginTouch(g) {
  if (!touch) touch = new TouchPads({ game: g });
  touch.game = g;
  touch.start();
  g.touchSolo();
}

// Browsers only start audio after a gesture: unlock on the first tap or key.
const unlockOnce = () => { presenter?.unlockAudio(); };
window.addEventListener('pointerdown', unlockOnce, { once: true });
window.addEventListener('keydown', unlockOnce, { once: true });

function boot() {
  const join = params.get('join');
  if (join) return startGuest(join);
  if (params.has('host')) {
    const m = params.get('host');
    return startHost(isMode(m) ? m : params.has('grandma') ? 'solo' : 'couch');
  }
  showTitle('main');
}

// ---------------- the main menu ----------------

// The pages are a <uf-flow> of <uf-step>s: [data-flow-go] / [data-flow-back]
// buttons navigate on their own; this only starts games.
const flow = /** @type {any} */ ($('title-flow'));
// Below the first page the logo shrinks (CSS on #title[data-page]).
flow.addEventListener('uf-flow:change', (/** @type {any} */ e) => { $('title').dataset.page = String(e.detail.to).replace(/^title-/, ''); });

/**
 * Show the main menu on a page (a fresh visit starts at the top, with no history).
 * @param {'main'|'online'|'join'|'how'} page
 */
function showTitle(page) {
  $('title').hidden = false;
  flow.reset();
  flow.current = 'title-' + page;
  $('title').dataset.page = page;
}

$('title').addEventListener('click', (ev) => {
  const a = /** @type {HTMLElement} */ (ev.target)?.closest?.('[data-title]')?.getAttribute('data-title');
  if (!a) return;
  presenter?.audio?.ready && presenter.audio.play('ui-ok');
  if (a === 'solo' && touchDevice) startTouchSolo();
  else if (a === 'solo') pickMode('solo');
  if (a === 'couch') pickMode('couch');
  if (a === 'online-host') pickMode('online');
});

// Arrows, Enter, Esc and a gamepad over every menu (the lab's FocusController).
const nav = new ScreenNav({
  flow, titleEl: $('title'),
  scopes: () => [
    { name: 'notice', el: $('notice') },
    { name: 'held', el: $('held'), back: () => game?.resume() },
    { name: 'end', el: $('end') },
    { name: 'score', el: $('score') },
    { name: 'safety', el: $('safety') },
    { name: 'lobby', el: $('lobby'), back: () => { if (game?.phase === 'lobby') game.toTitle(); } },
  ],
});
/** @type {any} */ (window).__nav = nav;
$('join-code').addEventListener('complete', (ev) => {
  const code = normalizeCode(/** @type {any} */ (ev).detail?.code);
  if (code) joinFromMenu(code);
});
// Enter (or the keypad's JOIN) on a full code joins, e.g. after a wrong code was fixed.
$('join-code').addEventListener('submit', (ev) => {
  const code = normalizeCode(/** @type {any} */ (ev).detail?.code);
  if (code) joinFromMenu(code);
});
$('join-keypad').addEventListener('key', () => { /** @type {any} */ ($('join-code')).focus?.(); });

/** @param {import('../core/modes.js').Mode} mode */
function pickMode(mode) {
  // Remember it, so a reload resumes the same room in the same mode (only
  // when the menu owns the URL: dev links with their own params are kept).
  if (menuOwnsUrl) history.replaceState(null, '', `?host=${mode}`);
  if (role === 'host' && game) { game.setMode(mode); $('title').hidden = true; return; }
  startHost(mode);
}
/** The page opened on the bare main menu (no params), so the menu may rewrite the URL. */
const menuOwnsUrl = !location.search || /^\?host=(solo|couch|online)(&touch)?$/.test(location.search) || location.search === '?touch';

/** Solo on this phone: straight into the game, no lobby. */
function startTouchSolo() {
  if (menuOwnsUrl) history.replaceState(null, '', '?host=solo&touch');
  touchWanted = true;
  if (role === 'host' && game) { $('title').hidden = true; beginTouch(game); return; }
  startHost('solo');
}

/** @param {string} code */
function joinFromMenu(code) {
  // This screen was hosting: joining someone else starts over as their guest.
  if (role === 'host') { location.href = `./?join=${code}`; return; }
  history.replaceState(null, '', `?join=${code}`);
  startGuest(code);
}

// ---------------- host ----------------

/** @param {import('../core/modes.js').Mode} mode */
async function startHost(mode) {
  $('title').hidden = true;
  role = 'host';
  document.documentElement.dataset.role = 'host';
  const room = new RoomHost({
    onSamples: (seat, s, at) => g.onSamples(seat, s, at),
    onPadMsg: (seat, m) => g.onPadMsg(seat, m),
    onPadJoined: (seat) => g.onPadJoined(seat),
    onPadLeft: (seat) => g.onPadLeft(seat),
    onScreenJoined: (id) => g.onScreenJoined(id),
    onScreenLeft: (id) => g.onScreenLeft(id),
    onScreenMsg: () => {},
    onState: (s) => { $('net').textContent = s === 'open' ? '' : s === 'connecting' ? 'Connecting to the room…' : 'Reconnecting…'; if (s === 'open') g?.refreshLinks(); },
  }, { relayBase: params.get('relay') || undefined });

  presenter = new Presenter({
    // Phones start at medium quality (no shadow maps, pixel ratio 1.5).
    canvas, role: 'host', toLocal: (h) => h, quality: params.get('quality') || (touchDevice ? 'medium' : undefined), noScene: params.has('noscene'),
    onAction: (a, arg) => hostAction(g, a, arg),
    onLand: () => g.landed(),
  });
  const g = new Game({ room, emit: (ev) => { presenter?.event(ev); touch?.event(ev); }, params });
  presenter.sceneReady.then((ok) => { g.sceneLands = !!ok; });
  game = g;
  /** @type {any} */ (window).__game = g;
  await presenter.unlockAudio();
  room.open();
  presenter.event({ k: 'cast', cast: { A: g.seats.A.goose, B: g.seats.B.goose } });
  presenter.event({ k: 'camera', mode: 'intro' });
  presenter.event({ k: 'tree', def: { kind: 'small', targetDeg: 8 }, name: '' });
  presenter.event({ k: 'phase', phase: 'lobby' });
  g.setMode(mode);
  bindKeys(g);
  if (touchWanted) beginTouch(g);
  let lastPhase = '';
  let lastMode = g.mode;
  runLoop(() => {
    const now = performance.now();
    const v = g.frame(now);
    presenter?.frame(v, now);
    if (touch?.on) {
      touch.frame(v, now);
      // There's no lobby on a phone: "play again" goes straight to a new game.
      if (v.phase === 'lobby') g.touchSolo();
    }
    // A mode change from the lobby or a phone keeps the URL in step for reloads.
    if (g.mode !== lastMode) { lastMode = g.mode; if (menuOwnsUrl) history.replaceState(null, '', `?host=${g.mode}`); }
    if (v.phase !== lastPhase) {
      if (v.phase === 'title') { showTitle('main'); if (touch?.on) { touch.stop(); g.endTouch(); touchWanted = false; } }
      else if (lastPhase === 'title') $('title').hidden = true;
      lastPhase = v.phase;
    }
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
    case 'menu': game.menu(arg); break;
    case 'grandma': game.setMode(arg === 'on' ? 'solo' : 'couch'); break;
    case 'invite': game.setMode('online'); game.refreshLinks(); break;
    case 'keys': game.setKind(arg, 'keys'); break;
    case 'unkeys': if (game.phase === 'lobby') game.setKind(arg, 'open'); break;
    case 'title': if (game.phase === 'lobby') game.toTitle(); else game.menu('title'); break;
    case 'next': game.next(); break;
    case 'more': game.more(); break;
    case 'finish': game.finish(); break;
    case 'safety-ok': game.safetyOk(); break;
    case 'again': game.toLobby(); break;
    case 'skip-calib': game.skipCalibration(); break;
    case 'skip-intro': game.skipIntro(); break;
    case 'spike-dl': game.spikeDump().then((d) => download(`timber-log-${Date.now()}.json`, JSON.stringify(d))); break;
    default:
  }
}

/** A key aimed at a focused button or the code entry belongs to it, not the game. @param {KeyboardEvent} ev */
function forWidget(ev) {
  const t = /** @type {HTMLElement|null} */ (ev.target);
  return !!t?.closest?.('uf-button, uf-join-code, uf-keypad, input, button');
}

/** @param {Game} game */
function bindKeys(game) {
  const map = {
    KeyF: ['A', 'pull'], KeyD: ['A', 'chop'], KeyQ: ['A', 'left'], KeyW: ['A', 'right'],
    KeyJ: ['B', 'pull'], KeyK: ['B', 'chop'], KeyO: ['B', 'left'], KeyP: ['B', 'right'],
  };
  const on = (down) => (ev) => {
    if (ev.repeat) return;
    if (game.phase === 'title') return; // the menu handles its own keys
    const m = map[ev.code];
    if (m) { game.key(m[0], m[1], down); ev.preventDefault(); }
    if (down && (ev.code === 'Enter' || ev.code === 'Space') && !forWidget(ev)) {
      if (game.phase === 'lobby') game.start();
      else if (game.phase === 'safety') game.safetyOk();
      else if (game.phase === 'score' || game.phase === 'end') game.next();
      else if (game.phase === 'intro') game.skipIntro();
      else if (game.held) game.resume();
    }
    if (down && ev.code === 'Escape') {
      if (game.phase === 'lobby') game.toTitle();
      else if (game.held) game.resume();
      else game.pause();
    }
  };
  window.addEventListener('keydown', on(true));
  window.addEventListener('keyup', on(false));
}

// ---------------- guest (a second home) ----------------

/** @param {string} codeIn */
async function startGuest(codeIn) {
  const code = normalizeCode(codeIn);
  if (!code) { showTitle('join'); return; }
  $('title').hidden = true;
  role = 'guest';
  document.documentElement.dataset.role = 'guest';
  const clock = new ClockSync();
  /** @type {any} */
  let view = null;
  const id = Math.random().toString(36).slice(2, 12);
  /** @type {GuestKeys|null} */
  let keys = null;
  /** What the guest is told when it isn't simply following the game. */
  const notice = { ended: false, refused: '', hostGone: false };
  presenter = new Presenter({ canvas, role: 'guest', toLocal: (h) => clock.toLocal(h), onAction: (a) => guestAction(a), quality: params.get('quality') || undefined, noScene: params.has('noscene') });
  presenter.hud.guestCode = code;
  await presenter.unlockAudio();
  /** @type {any[]} */
  const early = [];
  const relay = new RelayClient({
    code, role: 'screen', id, base: params.get('relay') || undefined,
    onState: (s, info) => {
      $('net').textContent = s === 'open' || s === 'refused' ? '' : 'Connecting to the other home…';
      if (s === 'refused') {
        notice.refused = info?.code === 404 ? `There’s no game with the code ${CODE_PREFIX}${code}. Check it on the other home’s screen.`
          : info?.code === 403 ? 'That home isn’t taking guests right now. They choose Online duo → Host an online game.'
          : info?.code === 409 ? 'That game already has a second home.'
          : 'Couldn’t join that home.';
      }
    },
    onJson: (m) => {
      switch (m.t) {
        case 'pong': clock.add(m.c0, m.h, performance.now(), m.hb); break;
        case 'host-ready': clock.reset(); notice.hostGone = false; break;
        case 'welcome':
          presenter?.event({ k: 'cast', cast: m.cast });
          if (m.tree) presenter?.event({ k: 'tree', def: m.tree, name: '' });
          if (m.camera) presenter?.event({ k: 'camera', mode: m.camera });
          if (m.song) early.push({ k: 'song', ...m.song });
          break;
        case 'pair':
          if (presenter) {
            // A new link for seat B (the host changed modes): a keyboard on the old one stops.
            if (presenter.hud.guestLink && presenter.hud.guestLink !== m.link && keys) { keys.stop(); keys = null; presenter.hud.guestKeys = 'off'; }
            presenter.hud.guestLink = m.link;
            presenter.hud.lastLobby = '';
          }
          break;
        case 'state': view = m.v; notice.hostGone = false; break;
        case 'ev':
          // Until the clock is synced, hold every event (in order), so a
          // song-stop can never overtake the song it stops.
          if (!clock.synced || early.length) early.push(m.ev);
          else presenter?.event(m.ev);
          break;
        case 'host-left': notice.hostGone = true; break;
        case 'online-ended':
          notice.ended = true;
          keys?.stop();
          relay.close();
          presenter?.audio.stopSong(300);
          break;
        default:
      }
    },
  });
  relay.connect();

  /** @param {string} a */
  function guestAction(a) {
    if (a === 'leave') { keys?.stop(); relay.close(); location.href = './'; return; }
    if (a === 'guest-keys' && presenter?.hud.guestLink && !keys) {
      keys = new GuestKeys({
        link: presenter.hud.guestLink, clock, base: params.get('relay') || undefined,
        onState: (s, why) => {
          if (!presenter) return;
          if (s !== 'on') { keys = null; if (why) $('net').textContent = why; setTimeout(() => { if ($('net').textContent === why) $('net').textContent = ''; }, 5000); }
          presenter.hud.guestKeys = s;
          presenter.hud.lastLobby = '';
        },
      });
      keys.start();
      presenter.hud.guestKeys = 'on';
      presenter.hud.lastLobby = '';
    }
    if (a === 'guest-unkeys' && keys) {
      keys.stop(); keys = null;
      if (presenter) { presenter.hud.guestKeys = 'off'; presenter.hud.lastLobby = ''; }
    }
  }

  const keyMap = { KeyJ: 'pull', KeyK: 'chop', KeyO: 'left', KeyP: 'right' };
  const onKey = (down) => (/** @type {KeyboardEvent} */ ev) => {
    if (ev.repeat) return;
    const k = keyMap[ev.code];
    if (k && keys) { keys.key(/** @type {any} */ (k), down); ev.preventDefault(); }
  };
  window.addEventListener('keydown', onKey(true));
  window.addEventListener('keyup', onKey(false));

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
    if (view && !notice.ended) {
      if (view.phase !== presenter?.hud._lastPhase) { presenter?.event({ k: 'phase', phase: view.phase }); if (presenter) presenter.hud._lastPhase = view.phase; }
      presenter?.frame(view, clock.toHost(performance.now()));
    }
    renderNotice(notice, view, code);
  });
  /** @type {any} */ (window).__guest = { clock, relay, get view() { return view; }, get keys() { return keys; }, notice };
}

/** The guest's message panel: refused, ended, the host away or choosing. */
let lastNotice = '';
function renderNotice(n, view, code) {
  let title = '', text = '';
  if (n.refused) { title = 'Couldn’t join'; text = n.refused; }
  else if (n.ended) { title = 'The online game is over'; text = 'The other home went back to playing on their own screen.'; }
  else if (n.hostGone) { title = 'Hold up…'; text = 'The other home’s screen went away. Old Misery waits for it to come back.'; }
  else if (view?.phase === 'title') { title = 'The other home is choosing'; text = 'They’re on their main menu. Stay here: you’ll be back in their lobby when they pick Online duo again.'; }
  else if (!view) { title = `Joining ${CODE_PREFIX}${code}…`; text = 'Connecting to the other home.'; }
  // The notice has its own way out.
  if (title) /** @type {any} */ ($('leave-btn')).hidden = true;
  const key = title + text;
  if (key === lastNotice) return;
  lastNotice = key;
  $('notice').hidden = !title;
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  // Over the game for "hold up"; on its own (everything else hidden) for the rest.
  const over = n.hostGone && !!view && view.phase !== 'lobby' && view.phase !== 'title';
  $('notice').classList.toggle('over', over);
  if (title && !over) document.documentElement.dataset.notice = '1';
  else delete document.documentElement.dataset.notice;
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
