#!/usr/bin/env node
// Screenshots of the main screens for review (needs `npm run dev`).
// node scripts/shots.mjs [--base http://localhost:8787]
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8787';
const out = path.resolve('scripts/out/shots'); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const shot = (n) => p.screenshot({ path: path.join(out, n + '.png') });
const until = async (fn, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return; await sleep(300); } throw new Error('timeout'); };
await p.goto(`${base}/?host&bots=A:good,B:lag:190`); await sleep(4000);
await p.evaluate(() => window.__game.start()); await sleep(1500); await shot('1-safety');
await p.evaluate(() => { window.__game.safetyOk(); }); await sleep(3500); await shot('2-intro');
await p.evaluate(() => window.__game.skipIntro());
await until(() => window.__game.phase === 'notch'); await sleep(2000); await shot('3-notch');
await until(() => window.__game.phase === 'saw'); await sleep(5000); await shot('4-saw-lagged');
await until(() => window.__game.view.zone !== 'green', 30000); await shot('5-saw-strain');
console.log('ok'); await b.close();
