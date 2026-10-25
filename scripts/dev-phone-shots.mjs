#!/usr/bin/env node
// Screenshots of the game as it looks today on a phone held sideways (and the
// menu upright), for the touch-solo design mockups. Solo with Grandma, keys on A.
// Needs `npm run dev` (or wrangler dev on --base).
// node scripts/dev-phone-shots.mjs [--base http://localhost:8795]
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://localhost:8787');
const out = path.resolve('docs/mockups/touch-solo/today'); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
const shot = (n) => p.screenshot({ path: path.join(out, n + '.png') });
// The scene alone (HUD hidden), as the backdrop for the mockups.
const clean = async (n) => { await p.addStyleTag({ content: '#hud,#caption,#gp-bubble,#pause-btn,#leave-btn,#toast{opacity:0!important}' }); await shot(n); await p.evaluate(() => document.querySelectorAll('style').forEach((x) => x.textContent.startsWith('#hud,#caption') && x.remove())); };
const until = async (fn, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return; await sleep(300); } throw new Error('timeout ' + fn); };

// Upright: the main menu.
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await p.goto(`${base}/`); await sleep(5000); await shot('menu-portrait');
// Sideways: a solo game with Grandma.
await p.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
await p.goto(`${base}/?host&grandma&keys=A`); await sleep(5000);
await shot('lobby-landscape');
await p.evaluate(() => window.__game.start()); await sleep(1500);
await p.evaluate(() => window.__game.safetyOk?.()); await sleep(1200);
await shot('safety-landscape');
await p.evaluate(() => window.__game.skipIntro?.());
await until(() => window.__game.phase === 'notch'); await sleep(6500); await shot('notch-landscape'); await clean('notch-clean');
// Chop on our turn until the saw starts.
for (let i = 0; i < 80; i++) {
  if (await p.evaluate(() => window.__game.phase) === 'saw') break;
  await p.evaluate(() => window.__game.key('A', 'chop', true)); await sleep(700);
}
await until(() => window.__game.phase === 'saw');
// Hold-to-pull on the beat for a few seconds so the blade is live.
const beat = await p.evaluate(() => window.__game.song?.beatMs || 625);
for (let i = 0; i < 8; i++) { await p.evaluate(() => window.__game.key('A', 'pull', true)); await sleep(beat); await p.evaluate(() => window.__game.key('A', 'pull', false)); await sleep(beat); }
await shot('saw-landscape'); await clean('saw-clean');
console.log(out); await b.close();
