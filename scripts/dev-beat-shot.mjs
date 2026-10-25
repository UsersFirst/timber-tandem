#!/usr/bin/env node
// A close look at the beat tracks while sawing, on the TV and on a phone.
// Needs `npm run dev` (or wrangler dev on --base).
// node scripts/dev-beat-shot.mjs [--base http://localhost:8795]
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const base = arg('--base', 'http://localhost:8787');
const out = path.resolve('scripts/out'); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
for (const [name, vp, url] of [
  ['tv', { width: 1280, height: 720 }, '/?host&bots=A:good,B:good'],
  ['phone', { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true }, '/?host=solo&touch&bots=A:good'],
]) {
  const p = await b.newPage(); await p.setViewport(vp);
  p.on('pageerror', (e) => console.log(name, 'PAGE ERROR', e.message));
  await p.goto(base + url); await sleep(3000);
  await p.evaluate(() => { const g = window.__game; g.start?.(); g.safetyOk?.(); g.skipIntro?.(); });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && await p.evaluate(() => window.__game.phase) !== 'saw') await sleep(500);
  await sleep(5000);
  await p.screenshot({ path: path.join(out, `beats-${name}.png`) });
  console.log(path.join(out, `beats-${name}.png`));
  await p.close();
}
await b.close();
