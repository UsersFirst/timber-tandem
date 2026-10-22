#!/usr/bin/env node
// A real-time-rate video of tantrums (silent), rendered frame-exact from the
// scene lab in manual mode. Needs: node scripts/serve.mjs 8792, and ffmpeg.
// Usage: node scripts/dev-tantrum-clip.mjs [name] [castB]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [name = 'tantrums', castB = 'victoria'] = process.argv.slice(2);
const base = process.env.BASE || 'http://localhost:8792';
const dir = path.resolve('scripts/out/tantrum/clip-' + name);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const FPS = 30, DT = 1000 / FPS;
const b = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 540 });
await p.goto(`${base}/dev/scene.html?nopanel&manual&castB=${castB}`); await p.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
await p.evaluate(() => { Object.assign(window.__view, { phase: 'saw', cutFrac: 0.35 }); window.__autoSaw = true; window.__scene.setCamera('saw'); window.__step(16.67, 240); });
// The script: [seconds of plain sawing, then a tantrum (blame, kind)].
const beats = [[1.2, 'B', 'push'], [2.4, null, 'tug'], [2.4, 'A', 'push'], [2.6, null, null]];
let n = 0;
const frame = async () => { await p.evaluate((dt) => window.__step(dt, 1), DT); await p.screenshot({ path: path.join(dir, String(n++).padStart(4, '0') + '.png') }); };
for (const [sec, blame, kind] of beats) {
  const frames = Math.round(sec * FPS);
  for (let i = 0; i < frames; i++) {
    // The strain builds over the last 8 frames before a tantrum.
    const left = frames - i;
    const e = kind && left <= 8 ? (kind === 'tug' ? 1 : -1) * 0.9 * (9 - left) / 8 : 0;
    await p.evaluate((x, bl) => Object.assign(window.__view, { e: x, zone: Math.abs(x) > 0.8 ? 'red' : Math.abs(x) > 0.4 ? 'amber' : 'green', blame: Math.abs(x) > 0.4 ? bl : null }), e, blame);
    await frame();
  }
  if (kind) await p.evaluate((bl, k) => { window.__scene.tantrum(bl, k); Object.assign(window.__view, { e: 0, zone: 'green', blame: null }); }, blame, kind);
}
await b.close();
const out = path.resolve('scripts/out/tantrum', name + '.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
console.log(out, n, 'frames');
