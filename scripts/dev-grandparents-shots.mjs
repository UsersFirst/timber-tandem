#!/usr/bin/env node
// Stills of Grandpa's chair and Grandma watching beside it, from the game
// cameras and a close-up. Needs: node scripts/serve.mjs 8792.
// Usage: node scripts/dev-grandparents-shots.mjs [name] [castB]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [name = 'gp', castB = 'victoria'] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:8792';
const root = path.resolve('scripts/out/grandparents/' + name);
fs.mkdirSync(root, { recursive: true });
const b = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 540 });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto(`${base}/dev/scene.html?nopanel&manual&castB=${castB}`); await p.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
await p.waitForFunction(() => window.__scene._debug.grandpa.goose && (!window.__scene._debug.nana.on || window.__scene._debug.nana.goose), { timeout: 120000 });
// SPOT=x,z tries another place for Grandma (she faces the saw like Grandpa).
if (process.env.SPOT) await p.evaluate((xz) => { const [x, z] = xz.split(',').map(Number); const n = window.__scene._debug.nana; n.group.position.set(x, 0, z); n.group.rotation.y = Math.atan2(-0.4 - x, 1.4 - z); }, process.env.SPOT);
const shots = [];
const shot = async (n, fn, arg) => {
  await p.evaluate(fn, arg);
  const f = path.join(root, n + '.jpg');
  await p.screenshot({ path: f, type: 'jpeg', quality: 88 });
  shots.push(f);
};
await shot('saw', () => {
  Object.assign(window.__view, { phase: 'saw', cutFrac: 0.35, e: 0, zone: 'green', blame: null });
  window.__autoSaw = true; window.__scene.setCamera('saw'); window.__step(16.67, 120);
});
await shot('close', () => { window.__scene._debug.lockCam([-1.2, 1.3, 1.6], [-2.6, 0.75, -1.0], 40); window.__step(16.67, 2); });
await shot('tantrum', () => { window.__scene.tantrum('A', 'push'); window.__step(16.67, 16); });
await shot('clap', () => { const d = window.__scene._debug; d.nana.landed(1e9 * 0, false); d.nana.clapUntil = 1e9; d.grandpa.landed(0); d.grandpa.cheerUntil = 1e9; window.__step(16.67, 20); });
await shot('gasp', () => { const d = window.__scene._debug; d.nana.clapUntil = -1; d.grandpa.cheerUntil = -1; d.nana.fallStarts(); d.grandpa.fallStarts(); window.__step(16.67, 30); });
await shot('intro', () => { const d = window.__scene._debug; d.nana.reset(); d.grandpa.reset(); window.__scene.setCamera('intro'); window.__step(16.67, 200); });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...shots.flatMap((f) => ['-i', f]), '-filter_complex', `${shots.map((_, i) => `[${i}]scale=640:-1[s${i}]`).join(';')};${shots.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${shots.length}:layout=0_0|w0_0|0_h0|w0_h0|0_h0+h1|w0_h0+h1`, path.join(root, 'sheet.jpg')]);
console.log(path.join(root, 'sheet.jpg'));
await b.close();
