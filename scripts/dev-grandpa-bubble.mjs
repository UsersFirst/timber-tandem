#!/usr/bin/env node
// Screenshots of Grandpa's speech bubble in the real game (bots on the saw):
// a heckle while sawing, his call as the tree lands, and the tall tale over
// the score card. Needs `npm run dev` (or wrangler dev on --base).
// node scripts/dev-grandpa-bubble.mjs [--base http://localhost:8795] [--solo]
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://localhost:8787');
const solo = process.argv.includes('--solo');
const out = path.resolve('scripts/out/grandparents/bubble' + (solo ? '-solo' : '')); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
const shot = (n) => p.screenshot({ path: path.join(out, n + '.png') });
const until = async (fn, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return; await sleep(300); } throw new Error('timeout ' + fn); };
await p.goto(`${base}/?host&${solo ? 'grandma&bots=A:good' : 'bots=A:good,B:good'}`); await sleep(4000);
await p.evaluate(() => { const g = window.__game, o = g.emit.bind(g); window.__evs = []; g.emit = (ev) => { if (['gp', 'caption', 'phase'].includes(ev.k)) window.__evs.push([Math.round(performance.now()), ev.k, ev.phase || ev.text]); o(ev); }; });
await p.evaluate(() => window.__game.start()); await sleep(1500);
await p.evaluate(() => window.__game.safetyOk()); await sleep(1500);
await p.evaluate(() => window.__game.skipIntro());
await until(() => window.__game.phase === 'notch'); await sleep(6400); await shot('1-notch-intro');
await until(() => window.__game.phase === 'saw'); await sleep(3000);
await p.evaluate(() => window.__game.gp('push', { force: true })); await sleep(700); await shot('2-saw-heckle');
await until(() => window.__game.phase === 'fall');
await sleep(2200); await shot('3-fall');
await until(() => window.__game.phase === 'score'); await sleep(8200 + 1500); await shot('4-score-tale');
await until(() => document.getElementById('caption-text').textContent.includes('dear') && document.getElementById('caption').classList.contains('show'), 20000).catch(() => console.log('no reply seen')); // Screenshots take seconds in software GL: hold the caption up while one is taken.
await p.evaluate(() => { const c = document.getElementById('caption'); new MutationObserver(() => { if (!c.classList.contains('show')) c.classList.add('show'); }).observe(c, { attributes: true }); });
await shot('5-score-reply');
const log = await p.evaluate(() => window.__evs);
for (const l of log) console.log(l.join(' '));
console.log(out); await b.close();
