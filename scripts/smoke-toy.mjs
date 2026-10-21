#!/usr/bin/env node
// ============================================================
// smoke-toy — the toy end to end, in real pages, over the real relay
// ============================================================
// Needs `npm run dev` (wrangler dev on :8787) running. Usage:
//   node scripts/smoke-toy.mjs [scenario ...] [--base http://localhost:8787] [--shots]
// Scenarios: bots, phones, lag, grandma, online   (default: all)
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
const ALL = ['bots', 'phones', 'lag', 'waggle', 'grandma', 'online'];
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

    if (name === 'phones' || name === 'lag' || name === 'waggle') {
      const host = await page(`${base}/?host&spike${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.seats.A.link && window.__game?.seats.B.link, { label: 'links' });
      const links = await host.evaluate(() => [window.__game.seats.A.link, window.__game.seats.B.link]);
      if (shots) { await sleep(1500); await host.screenshot({ path: path.join(outDir, `smoke-${name}-lobby.png`) }); }
      const pa = await phone(links[0], name === 'waggle' ? 'fast' : 'good', 'phoneA', errors); pages.push(pa);
      if (shots) { await pa.setViewport({ width: 390, height: 780 }); await sleep(800); await pa.screenshot({ path: path.join(outDir, 'smoke-phone.png') }); }
      const pb = await phone(links[1], name === 'lag' ? 'late:260' : name === 'waggle' ? 'fast' : 'good', 'phoneB', errors); pages.push(pb);
      await waitFor(host, () => window.__game?.canStart(), { label: 'both ready' });
      await host.evaluate(() => { window.__game.start(); window.__game.safetyOk(); window.__game.skipIntro(); });
      if (shots) { await sleep(1500); await host.screenshot({ path: path.join(outDir, `smoke-${name}-calib.png`) }); }
      await waitFor(host, () => ['notch', 'saw'].includes(window.__game.phase), { timeout: 120000, label: 'calibration done' });
      const cal = await host.evaluate(() => Object.values(window.__game.seats).map((s) => ({ id: s.id, calib: s.calib, lag: s.buffer.lagMs, tempo: s.tempo })));
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
      else check(s.temper < 75 || s.tantrums >= 1, `a partner 260 ms late in play is felt: temper ${s.temper}, tantrums ${s.tantrums}`);
      const evalLag = await host.evaluate(() => window.__game.view.evalLagMs);
      check(evalLag < 250, `matched-time lag behind now: ${evalLag} ms`);
      const dump = await host.evaluate(() => JSON.stringify(window.__game.spikeDump()));
      fs.writeFileSync(path.join(outDir, `spike-${name}.json`), dump);
      check(JSON.parse(dump).log.length > 20, 'spike log recorded');
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
      const host = await page(`${base}/?host${shots ? '' : '&noscene'}`, 'host', errors); pages.push(host);
      await waitFor(host, () => window.__game?.seats.A.link && window.__game?.room?.relay?.open, { label: 'host up' });
      const code = await host.evaluate(() => window.__game.room.code);
      await host.evaluate(() => window.__game.openInvite(true));
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
