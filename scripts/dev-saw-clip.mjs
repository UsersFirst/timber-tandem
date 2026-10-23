#!/usr/bin/env node
// Frame-exact video of the geese sawing (silent), from the game camera and
// from low close-ups on each goose's legs, so footwork can be judged.
// Needs: node scripts/serve.mjs 8792, and ffmpeg.
// Usage: node scripts/dev-saw-clip.mjs [name] [castB] [seconds]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [name = 'saw', castB = 'victoria', secIn = '3.6'] = process.argv.slice(2);
const sec = Number(secIn);
const base = process.env.BASE || 'http://localhost:8792';
const root = path.resolve('scripts/out/saw/' + name);
fs.rmSync(root, { recursive: true, force: true });
const FPS = 30, DT = 1000 / FPS;
// Game camera, a low front three-quarter on both, and a side view of A's legs.
const VIEWS = {
  game: null,
  front: { pos: [0.4, 0.9, 3.2], at: [0, 0.6, 0], fov: 48 },
  sideA: { pos: [-1.9, 0.55, 2.4], at: [-1.3, 0.45, 0.3], fov: 40 },
};
const b = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 540 });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto(`${base}/dev/scene.html?nopanel&manual&castB=${castB}`); await p.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
for (const [vn, v] of Object.entries(VIEWS)) {
  const dir = path.join(root, vn); fs.mkdirSync(dir, { recursive: true });
  await p.evaluate((v) => {
    Object.assign(window.__view, { phase: 'saw', cutFrac: 0.35, e: 0, zone: 'green', blame: null });
    window.__autoSaw = true; window.__scene.setCamera('saw');
    window.__step(16.67, 90);
    if (v) window.__scene._debug.lockCam(v.pos, v.at, v.fov);
  }, v);
  for (let n = 0; n < Math.round(sec * FPS); n++) {
    await p.evaluate((dt) => window.__step(dt, 1), DT);
    await p.screenshot({ path: path.join(dir, String(n).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 85 });
  }
  const out = path.join(root, vn + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', out]);
  // A contact sheet of one stroke (every 3rd frame of the first 1.2 s).
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-vf', "select='not(mod(n\,3))',scale=480:-1,tile=4x3", '-frames:v', '1', path.join(root, vn + '-sheet.jpg')]);
  console.log(out);
}
await b.close();
