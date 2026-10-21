#!/usr/bin/env node
// Screenshots of the scene lab (public/dev/scene.html) in every key state.
// Needs a static server: node scripts/serve.mjs 8792
// Usage: node scripts/dev-scene-shots.mjs [baseUrl] [only-shot-name]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'scripts/out/scene');
fs.mkdirSync(out, { recursive: true });
const base = process.argv[2] || 'http://localhost:8792';
const only = process.argv[3] || '';

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(query = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto(`${base}/dev/scene.html?nopanel${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
  return page;
}

/** Set view fields + camera, let it settle for `ms`, screenshot. */
async function shot(page, name, view, cam, ms = 2500, extra) {
  if (only && !name.includes(only)) return;
  await page.evaluate((v, c) => { Object.assign(window.__view, v); if (c) window.__scene.setCamera(c); }, view, cam);
  if (extra) await page.evaluate(extra);
  await new Promise((r) => setTimeout(r, ms));
  await page.screenshot({ path: path.join(out, name + '.png') });
  const info = await page.evaluate(() => window.__scene.info);
  console.log(name, JSON.stringify(info));
}

const p = await open();
await shot(p, '01-intro', { phase: 'idle' }, 'intro', 4000);
await shot(p, '02-saw-s0', { phase: 'saw', s: 0, e: 0, zone: 'green', cutFrac: 0.3 }, 'saw', 4500);
await shot(p, '03-saw-s+1', { s: 1 }, null, 1500);
await shot(p, '04-saw-s-1', { s: -1 }, null, 1500);
await shot(p, '05-bow', { s: 0, e: -0.6, zone: 'amber', blame: 'B' }, null, 1500);
await shot(p, '06-lean+1', { e: 0, zone: 'green', blame: null, lean: 1 }, null, 1500);
await shot(p, '07-lean-1', { lean: -1 }, null, 1500);
await shot(p, '08-notch', { phase: 'notch', lean: 0, notchFrac: 0.5, litFace: 'A' }, 'notch', 4500);
await shot(p, '09-notch-chop', {}, null, 230, () => window.__scene.hit('A', 'tok'));
if (!only || 'fall'.includes(only) || only.startsWith('1')) {
  await p.evaluate(() => { Object.assign(window.__view, { phase: 'saw', notchFrac: 1, litFace: null, cutFrac: 1 }); window.__scene.setCamera('saw'); });
  await new Promise((r) => setTimeout(r, 2500));
  await p.evaluate(() => { window.__view.phase = 'fall'; window.__fallDone = false; window.__scene.fall(10).then(() => { window.__fallDone = true; }); });
  await new Promise((r) => setTimeout(r, 2600));
  await p.screenshot({ path: path.join(out, '10-mid-fall.png') });
  console.log('10-mid-fall');
  await p.waitForFunction(() => window.__fallDone, { timeout: 30000 });
  await p.evaluate(() => { window.__view.phase = 'done'; window.__scene.celebrate(); });
  await new Promise((r) => setTimeout(r, 1500));
  await p.screenshot({ path: path.join(out, '11-after-fall.png') });
  console.log('11-after-fall', JSON.stringify(await p.evaluate(() => window.__scene.info)));
}
await p.close();

if (!only || only.includes('grandma')) {
  const g = await open('&castB=grandma');
  await shot(g, '12-grandma', { phase: 'saw', s: 0.4, cutFrac: 0.2 }, 'saw', 4500);
  await g.close();
}

await browser.close();
const uniq = [...new Set(errors)].filter((e) => !/favicon|GPU stall|ReadPixels|WebGL-/.test(e));
console.log(uniq.length ? 'CONSOLE:\n' + uniq.join('\n') : 'no console errors');
