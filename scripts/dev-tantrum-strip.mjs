#!/usr/bin/env node
// Frame-exact contact sheets of a tantrum, from the scene lab in manual mode.
// Needs: node scripts/serve.mjs 8792
// Usage: node scripts/dev-tantrum-strip.mjs [tag] [blame A|B|-] [kind push|tug] [cam saw|close]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const [tag = 'cur', blameIn = 'B', kind = 'push', camIn = 'saw', castB = 'victoria'] = process.argv.slice(2);
const blame = blameIn === '-' ? null : blameIn;
const base = process.env.BASE || 'http://localhost:8792';
const out = path.resolve('scripts/out/tantrum'); fs.mkdirSync(out, { recursive: true });
const FRAMES = [0, 50, 100, 150, 200, 280, 360, 450, 550, 650, 800, 1000, 1200, 1500, 1800, 2200];
const W = 1280, H = 720;
const b = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`${base}/dev/scene.html?nopanel&manual&castB=${castB}`); await p.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
await p.evaluate((cam) => { Object.assign(window.__view, { phase: 'saw', cutFrac: 0.35, e: 0, zone: 'green', blame: null }); window.__autoSaw = true; window.__scene.setCamera(['close', 'A', 'B'].includes(cam) ? 'saw' : cam); }, camIn);
await p.evaluate(() => window.__step(16.67, 240));
// Strain builds over ~250 ms before the red line is crossed (the real saw does this).
const e = kind === 'tug' ? 0.85 : -0.85;
for (let i = 0; i < 15; i++) await p.evaluate((x, bl) => { Object.assign(window.__view, { e: x, zone: Math.abs(x) > 0.8 ? 'red' : Math.abs(x) > 0.4 ? 'amber' : 'green', blame: Math.abs(x) > 0.4 ? bl : null }); window.__step(16.67, 1); }, e * (i + 1) / 15, blame);
await p.evaluate((bl, k) => { window.__scene.tantrum(bl, k); }, blame, kind);
const shots = [];
let t = 0;
for (const f of FRAMES) {
  const steps = Math.round((f - t) / 16.67);
  if (steps > 0) await p.evaluate((n) => window.__step(16.67, n), steps);
  t += steps * 16.67;
  // Strain releases after the buck, as the real saw resets the stroke.
  if (f >= 100) await p.evaluate(() => Object.assign(window.__view, { e: window.__view.e * 0.6, zone: 'green', blame: null }));
  const CROPS = { close: { x: 240, y: 120, width: 800, height: 450 }, A: { x: 140, y: 60, width: 560, height: 560 }, B: { x: 580, y: 60, width: 560, height: 560 } };
  const clip = CROPS[camIn];
  const buf = await p.screenshot({ type: 'jpeg', quality: 80, clip });
  shots.push({ f, data: buf.toString('base64') });
}
const cols = 4;
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px">${shots.map((s) => `<div style="position:relative"><img style="width:100%;display:block" src="data:image/jpeg;base64,${s.data}"><b style="position:absolute;left:6px;top:4px;color:#ff0;font:bold 22px sans-serif;text-shadow:0 0 4px #000">${s.f}ms</b></div>`).join('')}</body>`;
const q = await b.newPage(); await q.setViewport({ width: 1600, height: 900 }); await q.setContent(html);
await new Promise((r) => setTimeout(r, 300));
const file = path.join(out, `${tag}-${blameIn}-${kind}-${camIn}.jpg`);
await q.screenshot({ path: file, type: 'jpeg', quality: 85, fullPage: true });
console.log(file, errs.length ? 'ERRORS: ' + errs.join(' | ') : '');
await b.close();
