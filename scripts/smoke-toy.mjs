#!/usr/bin/env node
// ============================================================
// smoke-toy — the toy end to end, in real pages, over the real relay
// ============================================================
// Needs `npm run dev` (wrangler dev on :8787) running. Usage:
//   node scripts/smoke-toy.mjs [scenario ...] [--base http://localhost:8787] [--shots]
// Scenarios: bots, phones, reversed, lag, waggle, grandma, online, menus, menu-solo, menu-online, touch   (default: all)
// Phones are real /phone/ pages driven by ?sim= (synthetic devicemotion
// through the real stroke tracker, calibration, clock sync and relay).
// ============================================================

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a, i) => args[i - 1] === '--base')) || 'http://localhost:8787';
const shots = args.includes('--shots');
const wanted = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--base');
const ALL = ['bots', 'phones', 'reversed', 'lag', 'waggle', 'grandma', 'online', 'menus', 'menu-solo', 'menu-online', 'touch'];
const scenarios = wanted.length ? wanted : ALL;
const outDir = path.resolve('scripts/out');
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--use-gl=angle', '--use-angle=swiftshader',
    '--window-size=1280,720'],
});

let failures = 0;
/** @param {boolean} ok @param {string} msg */
function check(ok, msg) {
  console.log(`  ${ok ? '✔' : '✖'} ${msg}`);
  if (!ok) failures++;
}

async function page(url, label, errors) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 720 });
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}

/** A phone held sideways: touch, mobile, landscape. */
async function phonePage(url, label, errors, width = 844, height = 390) {
  const p = await browser.newPage();
  await p.setViewport({ width, height, isMobile: true, hasTouch: true, isLandscape: width > height });
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}

/** A real touch tap on an element's centre. */
async function touchTap(p, sel) {
  await p.bringToFront();
  await p.waitForSelector(sel, { visible: true, timeout: 10000 });
  const b = await (await p.$(sel)).boundingBox();
  await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

/**
 * Plays the touch pads from inside the page, as thumbs would: chop on your
 * turn; on the saw, hold from Grandma's beat to yours and let go; steer by
 * holding the knob against the tree's pull. Pointer events on the real pads.
 */
function touchDriver() {
  const w = /** @type {any} */ (window);
  const g = w.__game;
  const saw = document.getElementById('tp-saw');
  const steer = document.getElementById('tp-steer');
  const track = steer.querySelector('.tp-track');
  const ev = (el, type, x, y, id) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y }));
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const st = w.__touchStats = { coachSeen: false, coachGone: false, maxPull: 0, chops: 0, holds: 0, steerOn: 0, steerFrames: 0 };
  let sawHeld = false, steerHeld = false, lastChop = 0;
  const tick = () => {
    const v = g.view;
    if (!v) return requestAnimationFrame(tick);
    const now = performance.now();
    if (v.phase === 'notch' && v.litFace === 'A' && now - lastChop > 450) {
      const [x, y] = centre(saw);
      ev(saw, 'pointerdown', x, y, 1); ev(saw, 'pointerup', x, y, 1);
      lastChop = now; st.chops++;
    }
    if (v.phase === 'saw' && v.song) {
      const beatMs = 60000 / v.song.bpm;
      const bp = (now - v.song.startH) / beatMs;
      const hold = bp >= 0 && Math.floor(bp) % 2 === 0;
      const [x, y] = centre(saw);
      if (hold && !sawHeld) { ev(saw, 'pointerdown', x, y, 1); sawHeld = true; st.holds++; }
      if (!hold && sawHeld) { ev(saw, 'pointerup', x, y, 1); sawHeld = false; }
      // Steer: the thumb sits at target − pull (a player correcting as it drifts).
      const r = track.getBoundingClientRect();
      const thumb = Math.max(-1, Math.min(1, v.targetDeg / 25 - (g.pullNow || 0)));
      const tx = r.left + ((thumb + 1) / 2) * r.width, ty = r.top + r.height / 2;
      if (!v.coach) {
        if (!steerHeld) { ev(steer, 'pointerdown', tx, ty, 2); steerHeld = true; } else ev(steer, 'pointermove', tx, ty, 2);
        st.steerFrames++; if (v.aimGrade === 'skid') st.steerOn++;
      }
      if (v.coach) st.coachSeen = true; else if (st.coachSeen) st.coachGone = true;
      st.maxPull = Math.max(st.maxPull, Math.abs(g.pullNow || 0));
    } else {
      if (v.phase === 'fall' && !st.fall) st.fall = { recent: g.cut.recent, angle: v.fallPreview, target: v.targetDeg, roll: v.rolls.A, pull: g.pullNow, thumb: g.seats.A.keys.thumb };
      if (sawHeld) { const [x, y] = centre(saw); ev(saw, 'pointerup', x, y, 1); sawHeld = false; }
      if (steerHeld) { ev(steer, 'pointerup', 0, 0, 2); steerHeld = false; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Poll a page expression until truthy. */
async function waitFor(p, fn, { timeout = 60000, label = '' } = {}, ...a) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await p.evaluate(fn, ...a); if (v) return v; } catch { /* navigating */ }
    await sleep(250);
  }
  throw new Error('timeout: ' + label);
}

const phase = (p) => p.evaluate(() => window.__game?.phase);

/** A real click, on a page brought to the front first (the other page may be in front). */
async function tapOn(p, sel) {
  await p.bringToFront();
  await p.waitForSelector(sel, { visible: true, timeout: 10000 });
  await p.click(sel);
}

/** Open a phone page for a pairing link with ?sim=…, then tap start. */
async function phone(link, sim, label, errors) {
  const [front, frag] = link.split('#');
  const url = `${front}${front.includes('?') ? '&' : '?'}sim=${encodeURIComponent(sim)}#${frag}`;
  const p = await page(url, label, errors);
  await waitFor(p, () => window.__phone?.relay?.open, { label: label + ' relay open' });
  await p.click('#start');
  await waitFor(p, () => window.__phone?.clock?.synced, { label: label + ' clock synced' });
  return p;
}

/** Play one tree through to its score card; returns the score. */
async function playTree(host, label) {
  await waitFor(host, () => ['notch', 'saw'].includes(window.__game?.phase), { timeout: 90000, label: label + ' notch' });
  if (shots) { await sleep(2600); await host.screenshot({ path: path.join(outDir, `smoke-${label}-notch.png`) }); }
  await waitFor(host, () => window.__game?.phase === 'saw', { timeout: 60000, label: label + ' saw' });
  if (shots) { await sleep(2500); await host.screenshot({ path: path.join(outDir, `smoke-${label}-saw.png`) }); }
  await waitFor(host, () => ['fall', 'score'].includes(window.__game?.phase), { timeout: 90000, label: label + ' fall' });
  if (shots) { await sleep(1800); await host.screenshot({ path: path.join(outDir, `smoke-${label}-fall.png`) }); }
  await waitFor(host, () => window.__game?.phase === 'score', { timeout: 20000, label: label + ' score' });
  if (shots) await host.screenshot({ path: path.join(outDir, `smoke-${label}-score.png`) });
  return host.evaluate(() => window.__game.scores[window.__game.scores.length - 1]);
}

async function run(name) {
  const errors = [];
  const pages = [];
  log(`▶ ${name}`);
  try {
    if (name === 'bots') {
      const host = await page(`${base}/?host&bots=A:good,B:good`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.canStart(), { label: 'can start' });
      await host.evaluate(() => { window.__game.start(); window.__game.safetyOk(); window.__game.skipIntro(); });
      await sleep(1500);
      const s1 = await playTree(host, 'bots');
      check(s1.temper >= 95 && s1.tantrums === 0, `perfect bots: temper ${s1.temper}, tantrums ${s1.tantrums}`);
      await host.evaluate(() => window.__game.next());
      const s2 = await playTree(host, 'bots-big');
      check(s2.tree === 'Big pine', 'second tree is the big pine');
      await host.evaluate(() => window.__game.finish());
      await waitFor(host, () => window.__game.phase === 'end', { label: 'end' });
      check(true, 'reached the end screen');
      await host.evaluate(() => window.__game.more());
      await waitFor(host, () => window.__game.phase === 'notch', { label: 'one more tree' });
      check(true, 'one more tree goes straight to the notch');
    }

    if (name === 'phones' || name === 'lag' || name === 'waggle' || name === 'reversed') {
      const host = await page(`${base}/?host&spike${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.seats.A.link && window.__game?.seats.B.link, { label: 'links' });
      const links = await host.evaluate(() => [window.__game.seats.A.link, window.__game.seats.B.link]);
      if (shots) { await sleep(1500); await host.screenshot({ path: path.join(outDir, `smoke-${name}-lobby.png`) }); }
      const pa = await phone(links[0], name === 'waggle' ? 'fast' : 'good', 'phoneA', errors); pages.push(pa);
      if (shots) { await pa.setViewport({ width: 390, height: 780 }); await sleep(800); await pa.screenshot({ path: path.join(outDir, 'smoke-phone.png') }); }
      const pb = await phone(links[1], name === 'lag' ? 'late:260' : name === 'waggle' ? 'fast' : name === 'reversed' ? 'reversed' : 'good', 'phoneB', errors); pages.push(pb);
      await waitFor(host, () => window.__game?.canStart(), { label: 'both ready' });
      await host.evaluate(() => { window.__game.start(); window.__game.safetyOk(); window.__game.skipIntro(); });
      if (shots) { await sleep(1500); await host.screenshot({ path: path.join(outDir, `smoke-${name}-calib.png`) }); }
      await waitFor(host, () => ['notch', 'saw'].includes(window.__game.phase), { timeout: 120000, label: 'calibration done' });
      const cal = await host.evaluate(() => Object.values(window.__game.seats).map((s) => ({ id: s.id, calib: s.calib, lag: s.buffer.lagMs, tempo: s.tempo })));
      if (name === 'reversed') {
        const flips = cal.map((c) => c.id + ':' + (c.calib.autoFlipped || 'no') + ' (parity ' + c.calib.parity + ')').join(', ');
        check(cal[0].calib.autoFlipped !== 'yes' && cal[1].calib.autoFlipped === 'yes', 'the lesson turns round only the backwards phone: ' + flips);
      }
      for (const c of cal) {
        const steps = ['rest', 'pull', 'saw', 'twist', 'chop'];
        check(steps.every((k) => c.calib[k] === 'ok'), `${c.id} calibrated: ${steps.map((k) => k + ':' + c.calib[k]).join(' ')} lag ${Math.round(c.lag)}ms tempo ${c.tempo}`);
      }
      if (name === 'lag') {
        await waitFor(host, () => window.__game.phase === 'saw', { timeout: 90000, label: 'saw' });
        await sleep(15000);
        const w = await host.evaluate(() => ({ bites: window.__game.saw.bites, binds: window.__game.saw.binds, tantrums: window.__game.saw.tantrums, temper: Math.round(100 * window.__game.saw.travelGood / Math.max(1e-6, window.__game.saw.travelAll)) }));
        check(w.bites <= 3 && w.binds >= 8, `a partner 260 ms late in play can't cut: ${w.bites} bites, ${w.binds} binds, temper ${w.temper}, ${w.tantrums} tantrums in 15 s`);
        return;
      }
      if (name === 'waggle') {
        await waitFor(host, () => window.__game.phase === 'saw', { timeout: 90000, label: 'saw' });
        await sleep(12000);
        const w = await host.evaluate(() => ({ bites: window.__game.saw.bites, chatters: window.__game.saw.chatters, strokes: window.__game.saw.strokes }));
        check(w.bites <= 3 && w.chatters >= 8, `waggling at double speed doesn't cut: ${w.bites} bites, ${w.chatters} chatters in 12 s (${w.strokes} strokes)`);
        return;
      }
      const s = await playTree(host, name);
      if (name === 'phones') check(s.temper >= 75 && s.tantrums <= 2, `two simulated phones: temper ${s.temper}, tantrums ${s.tantrums}, best streak ${s.bestStreak}`);
      else if (name === 'reversed') { check(s.temper >= 75 && s.tantrums <= 2, `after the flip, the backwards phone saws: temper ${s.temper}, tantrums ${s.tantrums}`); return; }
      else check(s.temper < 75 || s.tantrums >= 1, `a partner 260 ms late in play is felt: temper ${s.temper}, tantrums ${s.tantrums}`);
      const evalLag = await host.evaluate(() => window.__game.view.evalLagMs);
      check(evalLag < 250, `matched-time lag behind now: ${evalLag} ms`);
      const dump = await host.evaluate(async () => JSON.stringify(await window.__game.spikeDump()));
      fs.writeFileSync(path.join(outDir, `spike-${name}.json`), dump);
      check(JSON.parse(dump).log.length > 20, 'spike log recorded');
    }

    if (name === 'menus') {
      // A whole game run from a phone: start, safety, skip, pause, resume, stop.
      const host = await page(`${base}/?host&grandma&noscene`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.seats.A.link, { label: 'link' });
      const link = await host.evaluate(() => window.__game.seats.A.link);
      const pa = await phone(link, 'good', 'phoneA', errors); pages.push(pa);
      const tap = async (id) => {
        // Find and tap in one step: the menu can be re-rendered between a find and a click.
        await waitFor(pa, (i) => { const b = /** @type {HTMLElement|null} */ (document.querySelector(`#menu button[data-id="${i}"]`)); if (!b) return false; b.click(); return true; }, { label: 'phone shows ' + id }, id);
      };
      await tap('start');
      await waitFor(host, () => window.__game.phase === 'safety', { label: 'safety' });
      await tap('safety-ok');
      await waitFor(host, () => window.__game.phase === 'intro', { label: 'intro' });
      await tap('skip-intro');
      await waitFor(host, () => window.__game.phase === 'calibrate', { label: 'calibrate' });
      await tap('skip-calib');
      await waitFor(host, () => window.__game.phase === 'notch', { label: 'notch' });
      check(true, 'started, read the safety card, skipped the intro and the lesson — all from the phone');
      // Pause is press-and-hold on the phone.
      await waitFor(pa, () => !document.getElementById('pause').hidden, { label: 'pause button' });
      const box = await (await pa.$('#pause')).boundingBox();
      await pa.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await pa.mouse.down(); await sleep(150); await pa.mouse.up();
      await sleep(400);
      check(!(await host.evaluate(() => window.__game.held)), 'a quick tap on pause does nothing (a fist can’t pause by accident)');
      await pa.mouse.down(); await sleep(800); await pa.mouse.up();
      await waitFor(host, () => window.__game.held, { label: 'held' });
      check(await host.evaluate(() => !document.getElementById('held').hidden), 'holding pause pauses the game; the TV shows the pause sheet');
      await tap('resume');
      await waitFor(host, () => !window.__game.held, { label: 'resumed' });
      check(true, 'resume from the phone');
      await host.keyboard.press('Escape');
      await waitFor(host, () => window.__game.held, { label: 'esc pause' });
      await tap('lobby');
      await waitFor(host, () => window.__game.phase === 'lobby', { label: 'back to lobby' });
      check(true, 'Esc pauses on the TV; "Stop — back to the lobby" from the phone');
      await tap('title');
      await waitFor(host, () => window.__game.phase === 'title' && !document.getElementById('title').hidden, { label: 'main menu from the phone' });
      await tap('mode-couch');
      await waitFor(host, () => window.__game.phase === 'lobby' && window.__game.mode === 'couch' && document.getElementById('title').hidden, { label: 'couch from the phone' });
      check(true, 'the phone goes to the main menu and picks Two players');
    }

    if (name === 'menu-solo') {
      // The main menu → Solo → the keyboard → the notch, with real clicks and keys.
      const host = await page(`${base}/?from=menu${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => !document.getElementById('title').hidden, { label: 'main menu' });
      check(await host.evaluate(() => !window.__game), 'the main menu shows first, with no game yet');
      // Keyboard through the lab's FocusController: ↓ ↓ Enter opens Online duo; Esc comes back.
      await host.bringToFront();
      await sleep(400);
      await host.keyboard.press('ArrowDown'); await sleep(80);
      await host.keyboard.press('ArrowDown'); await sleep(80);
      await host.keyboard.press('Enter');
      await waitFor(host, () => document.getElementById('title-flow').current === 'title-online', { timeout: 5000, label: 'online page by keyboard' });
      await host.keyboard.press('Escape');
      await waitFor(host, () => document.getElementById('title-flow').current === 'title-main', { timeout: 5000, label: 'back by Esc' });
      check(true, 'arrows + Enter open Online duo; Esc goes back (FocusController over uf-flow)');
      await tapOn(host, '[data-title="solo"]');
      await waitFor(host, () => window.__game?.phase === 'lobby' && window.__game.seats.A.link, { label: 'solo lobby' });
      const m = await host.evaluate(() => ({ mode: window.__game.mode, b: window.__game.seats.B.kind, title: document.getElementById('lobby-title').textContent }));
      check(m.mode === 'solo' && m.b === 'grandma', `Solo: Grandma holds the right handle (${m.title})`);
      await tapOn(host, '[data-action="keys"][data-arg="A"]');
      await waitFor(host, () => window.__game.canStart(), { label: 'can start' });
      await tapOn(host, '#start-btn');
      await waitFor(host, () => window.__game.phase === 'safety', { label: 'safety' });
      await tapOn(host, '#safety-ok');
      await waitFor(host, () => window.__game.phase === 'intro', { label: 'intro' });
      await tapOn(host, '#intro-skip');
      await waitFor(host, () => window.__game.phase === 'notch', { timeout: 20000, label: 'notch' });
      check(true, 'main menu → Solo → keyboard → Start reaches the notch (no lesson for keys)');
      // Chop on A's turn with D until the notch opens a little.
      await waitFor(host, () => window.__game.notch.lit === 'A', { timeout: 15000, label: "A's turn" });
      await sleep(300);
      await host.keyboard.press('KeyD');
      await waitFor(host, () => window.__game.view.notchFrac > 0, { timeout: 5000, label: 'a chop lands' });
      check(true, 'D chops on your turn; Grandma takes hers');
      // Esc → pause → Main menu (via the pause sheet) → the menu is back, the game reset.
      await host.keyboard.press('Escape');
      await waitFor(host, () => window.__game.held, { label: 'paused' });
      await tapOn(host, '#held-actions [data-arg="title"]');
      await waitFor(host, () => window.__game.phase === 'title' && !document.getElementById('title').hidden, { label: 'main menu again' });
      check(true, 'the pause menu goes back to the main menu');
      await tapOn(host, '[data-title="couch"]');
      await waitFor(host, () => window.__game.phase === 'lobby' && window.__game.mode === 'couch', { label: 'couch lobby' });
      check(await host.evaluate(() => window.__game.seats.B.kind === 'open' && window.__game.seats.A.kind === 'keys'), 'picking Two players frees the right handle; the left keeps its keyboard');
    }

    if (name === 'menu-online') {
      // Two screens, both through the menus; both play by keyboard.
      const host = await page(`${base}/?from=menu${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => !document.getElementById('title').hidden, { label: 'host menu' });
      await tapOn(host, '[data-title="online"]');
      await tapOn(host, '[data-title="online-host"]');
      await waitFor(host, () => window.__game?.mode === 'online' && window.__game.inviteOpen && window.__game.room?.relay?.open, { label: 'hosting online' });
      const code = await host.evaluate(() => window.__game.room.code);
      const shown = await waitFor(host, () => document.querySelector('#lobby-seats uf-join-code')?.getAttribute('value'), { label: 'code shown' });
      check(shown === code, `the host's lobby shows the code ${code}`);
      await tapOn(host, '[data-action="keys"][data-arg="A"]');

      const guest = await page(`${base}/?from=menu${shots ? '' : '&noscene'}`, 'guest', errors); pages.push(guest);
      await waitFor(guest, () => !document.getElementById('title').hidden, { label: 'guest menu' });
      await tapOn(guest, '[data-title="online"]');
      await tapOn(guest, '#title-online [data-title="join"]');
      await sleep(300);
      await guest.focus('#join-code');
      await guest.keyboard.type(code, { delay: 40 });
      await guest.keyboard.press('Enter');
      await waitFor(guest, () => window.__guest?.clock?.synced, { label: 'guest joined' });
      await waitFor(host, () => window.__game.guests.size === 1, { label: 'host sees the guest' });
      const head = await waitFor(guest, () => !document.getElementById('lobby').hidden && document.getElementById('lobby-title').textContent, { label: 'guest lobby' });
      check(head.includes(code), `the guest's lobby says "${head}"`);
      await waitFor(guest, () => document.querySelector('[data-action="guest-keys"]'), { label: 'guest keyboard button' });
      await tapOn(guest, '[data-action="guest-keys"]');
      await waitFor(host, () => window.__game.seats.B.phone.keys && window.__game.canStart(), { label: 'both handles ready' });
      check(true, 'the other home takes the right handle by keyboard');
      // Both screens chop on their turn and pull on their beats, from the keyboard.
      const drive = (seat) => {
        const keys = seat === 'A' ? { pull: 'KeyF', chop: 'KeyD' } : { pull: 'KeyJ', chop: 'KeyK' };
        const fire = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
        let held = false, lastChop = 0;
        setInterval(() => {
          const v = seat === 'A' ? window.__game?.view : window.__guest?.view;
          const hNow = seat === 'A' ? performance.now() : window.__guest.clock.toHost(performance.now());
          if (!v) return;
          if (v.phase === 'notch' && v.litFace === seat && hNow - lastChop > 900) { lastChop = hNow; fire('keydown', keys.chop); fire('keyup', keys.chop); }
          let want = false;
          if (v.phase === 'saw' && v.song) {
            const bp = (hNow - v.song.startH) / (60000 / v.song.bpm);
            // A pulls through even beats (arriving pulled on odd), B through odd.
            want = bp >= 0 && (Math.floor(bp) % 2 === 0) === (seat === 'A');
          }
          if (want !== held) { held = want; fire(want ? 'keydown' : 'keyup', keys.pull); }
        }, 8);
      };
      await host.evaluate(drive, 'A');
      await guest.evaluate(drive, 'B');
      await tapOn(host, '#start-btn');
      await waitFor(host, () => window.__game.phase === 'safety', { label: 'safety' });
      await host.evaluate(() => { window.__game.safetyOk(); window.__game.skipIntro(); });
      await waitFor(host, () => window.__game.phase === 'saw', { timeout: 60000, label: 'notch done by keyboard' });
      check(true, 'both homes chopped the notch by keyboard');
      await sleep(15000);
      const w = await host.evaluate(() => ({ bites: window.__game.saw.bites, tantrums: window.__game.saw.tantrums, binds: window.__game.saw.binds }));
      check(w.bites >= 4, `online by keyboard, the saw cuts: ${w.bites} bites, ${w.binds} binds, ${w.tantrums} tantrums in 15 s`);
      const gp = await guest.evaluate(() => window.__guest.view?.phase);
      check(gp === 'saw' || gp === 'fall', `the guest screen follows (phase ${gp})`);
      // The host goes back to the menu and picks Solo: the guest is told the online game is over.
      await host.evaluate(() => { window.__game.pause(); window.__game.menu('title'); });
      await waitFor(guest, () => window.__guest.view?.phase === 'title' && !document.getElementById('notice').hidden, { label: 'guest sees the host choosing' });
      await tapOn(host, '[data-title="solo"]');
      await waitFor(guest, () => window.__guest.notice.ended && document.getElementById('notice-title').textContent.includes('over'), { label: 'guest told it ended' });
      check(await host.evaluate(() => window.__game.guests.size === 0 && !window.__game.inviteOpen), 'leaving online closes the invite and lets the guest go; the guest is told');
    }

    if (name === 'touch') {
      // Solo on just a phone held sideways: the menu, real taps, the pads.
      const host = await phonePage(`${base}/?touch${shots ? '' : '&noscene'}`, 'phone', errors); pages.push(host);
      await waitFor(host, () => !document.getElementById('title').hidden, { label: 'main menu' });
      const menu = await host.evaluate(() => ({ solo: document.querySelector('[data-title="solo"]').label, couch: document.querySelector('[data-title="couch"]').disabled }));
      check(menu.solo === 'Solo — on this phone' && menu.couch, `the phone's menu: "${menu.solo}", Two players greyed out`);
      await touchTap(host, '[data-title="solo"]');
      await waitFor(host, () => window.__game?.phase === 'intro', { timeout: 20000, label: 'straight to the cold open' });
      const st0 = await host.evaluate(() => ({ touch: document.documentElement.hasAttribute('data-touch'), a: window.__game.seats.A.kind, t: window.__game.seats.A.keys.touch, b: window.__game.seats.B.kind }));
      check(st0.touch && st0.a === 'keys' && st0.t && st0.b === 'grandma', 'one tap on Solo: no lobby, no safety card — thumbs on the left handle, Grandma on the right');
      await host.evaluate(`(${touchDriver.toString()})()`);
      await touchTap(host, '#intro-skip');
      await waitFor(host, () => window.__game.phase === 'saw', { timeout: 60000, label: 'notch by touch' });
      check(await host.evaluate(() => window.__touchStats.chops > 0), 'the hatchet pad chops on your turn');
      if (shots) { await sleep(2500); await host.screenshot({ path: path.join(outDir, 'smoke-touch-coach.png') }); }
      await waitFor(host, () => window.__touchStats.coachGone, { timeout: 30000, label: 'coach' });
      if (shots) { await sleep(6000); await host.screenshot({ path: path.join(outDir, 'smoke-touch-saw.png') }); }
      await waitFor(host, () => window.__game.phase === 'score', { timeout: 120000, label: 'the tree falls' });
      const sc = await host.evaluate(() => window.__game.scores[window.__game.scores.length - 1]);
      const ts = await host.evaluate(() => window.__touchStats);
      check(ts.coachSeen && ts.coachGone, 'the first-strokes coach shows, then goes');
      check(sc.temper >= 90, `a tree felled by thumbs: temper ${sc.temper}, tantrums ${sc.tantrums}`);
      check(ts.maxPull >= 0.2, `the tree pulls (up to ${ts.maxPull.toFixed(2)}) and the thumb holds against it: on target ${Math.round((100 * ts.steerOn) / Math.max(1, ts.steerFrames))}% of the time, landed ${sc.landing?.grade ?? sc.grade ?? '?'}`);
      // A short screen (small iPhone sideways, Safari bars): nothing overlaps or spills.
      for (const [w, h] of [[844, 390], [667, 320]]) {
        await host.setViewport({ width: w, height: h, isMobile: true, hasTouch: true, isLandscape: true });
        await host.evaluate(() => { const g = window.__game; g.view = { ...g.view }; });
        await sleep(400);
        const lay = await host.evaluate(() => {
          const box = (s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
          return { saw: box('#tp-saw'), steer: box('#tp-steer'), strip: box('#hud .bottom'), W: innerWidth, H: innerHeight };
        });
        const inside = (b) => b.l >= 0 && b.t >= 0 && b.r <= lay.W && b.b <= lay.H;
        const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
        check(inside(lay.saw) && inside(lay.steer) && apart(lay.saw, lay.steer) && apart(lay.strip, lay.saw) && apart(lay.strip, lay.steer), `${w}×${h}: pads on screen, apart, clear of the top strip`);
      }
      // Held upright mid-game: the rotate card, and the game pauses.
      await host.evaluate(() => window.__game.next());
      await waitFor(host, () => ['notch', 'intro'].includes(window.__game.phase), { timeout: 20000, label: 'next tree' });
      await host.evaluate(() => window.__game.skipIntro?.());
      await waitFor(host, () => window.__game.phase === 'notch', { timeout: 20000, label: 'next notch' });
      await host.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, isLandscape: false });
      await waitFor(host, () => getComputedStyle(document.getElementById('rotate')).display !== 'none' && window.__game.held, { timeout: 5000, label: 'rotate card' });
      check(true, 'held upright mid-game: "Turn your phone sideways", and the game pauses');
    }

    if (name === 'grandma') {
      const host = await page(`${base}/?host&grandma${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.seats.A.link, { label: 'link' });
      const link = await host.evaluate(() => window.__game.seats.A.link);
      const pa = await phone(link, 'good', 'phoneA', errors); pages.push(pa);
      await waitFor(host, () => window.__game?.canStart(), { label: 'ready' });
      check(await host.evaluate(() => window.__game.seats.B.kind === 'grandma'), 'Grandma holds the far handle');
      await host.evaluate(() => { window.__game.start(); window.__game.safetyOk(); window.__game.skipIntro(); });
      await waitFor(host, () => ['notch', 'saw'].includes(window.__game.phase), { timeout: 120000, label: 'calibration done' });
      const s = await playTree(host, 'grandma');
      check(s.temper >= 75, `solo with Grandma: temper ${s.temper}, tantrums ${s.tantrums}`);
    }

    if (name === 'online') {
      const host = await page(`${base}/?host=online${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.seats.A.link && window.__game?.room?.relay?.open, { label: 'host up' });
      const code = await host.evaluate(() => window.__game.room.code);
      const guest = await page(`${base}/?join=${code}${shots ? '' : '&noscene'}`, 'guest', errors); pages.push(guest);
      await waitFor(host, () => window.__game.guests.size === 1, { label: 'guest joined' });
      await waitFor(guest, () => window.__guest?.clock?.synced, { label: 'guest clock' });
      const guestLink = await waitFor(guest, () => document.querySelector('#lobby-seats uf-qr')?.getAttribute('value'), { label: 'guest QR' });
      check(/#\w{5}\.2\./.test(guestLink), 'guest screen shows its own phone QR for the right handle');
      const linkA = await host.evaluate(() => window.__game.seats.A.link);
      const pa = await phone(linkA, 'good', 'phoneA(host home)', errors); pages.push(pa);
      const pb = await phone(guestLink, 'good', 'phoneB(guest home)', errors); pages.push(pb);
      await waitFor(host, () => window.__game?.canStart(), { label: 'both ready' });
      await host.evaluate(() => { window.__game.start(); window.__game.safetyOk(); window.__game.skipIntro(); });
      await waitFor(host, () => ['notch', 'saw'].includes(window.__game.phase), { timeout: 120000, label: 'calibration done' });
      const s = await playTree(host, 'online');
      check(s.temper >= 70, `online duo: temper ${s.temper}, tantrums ${s.tantrums}`);
      const gv = await waitFor(guest, () => window.__guest.view?.phase === 'score' && 'score', { timeout: 3000, label: 'guest score' }).catch(() => guest.evaluate(() => window.__guest.view?.phase));
      check(gv === 'score', `guest screen follows the host (phase ${gv})`);
      if (shots) await guest.screenshot({ path: path.join(outDir, 'smoke-online-guest.png') });
    }
  } catch (err) {
    check(false, `${name}: ${err.message}`);
  } finally {
    const real = errors.filter((e) => !/favicon|ERR_FILE_NOT_FOUND|404/.test(e));
    check(real.length === 0, `no page errors${real.length ? ':\n    ' + real.slice(0, 8).join('\n    ') : ''}`);
    for (const p of pages) await p.close().catch(() => {});
  }
}

for (const s of scenarios) await run(s);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
