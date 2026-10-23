#!/usr/bin/env node
// A frame-exact video of a tree falling, WITH its sound: the scene lab runs
// in manual mode at 30 fps, every scene event (sounds, the fall voice, slow
// motion, the landing) is logged at its exact time, then the same timeline is
// rendered offline through the game's own audio engine and muxed in.
// Letterbox bars and the TIMBER / landing call-outs are drawn as in the game.
// Needs: node scripts/serve.mjs 8792, and ffmpeg.
// Usage: node scripts/dev-fall-clip.mjs <name> <angleDeg> <skid|close|wide|privy> [small|big]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [name = 'fall', angleIn = '9', grade = 'skid', kind = 'small'] = process.argv.slice(2);
const angle = Number(angleIn);
const base = process.env.BASE || 'http://localhost:8792';
const dir = path.resolve('scripts/out/fall/' + name);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const FPS = 30, DT = 1000 / FPS, PRE = 1.6, POST = 3.2;

const b = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${base}/dev/scene.html?nopanel&manual`); await p.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
await p.evaluate((kind) => {
  // Game-like overlays: letterbox bars and the call-out toasts.
  document.head.insertAdjacentHTML('beforeend', `<style>
    #lb { position: fixed; inset: 0; pointer-events: none; z-index: 5; transition: box-shadow .5s; }
    #lb i { position: absolute; left: 0; right: 0; height: 11vh; background: #000; transform: scaleY(0); transition: transform .45s cubic-bezier(.2,.8,.2,1); }
    #lb i:first-child { top: 0; transform-origin: top; } #lb i:last-child { bottom: 0; transform-origin: bottom; }
    html[data-slowmo] #lb { box-shadow: inset 0 0 22vh 2vh rgba(0,0,0,.55); } html[data-slowmo] #lb i { transform: scaleY(1); }
    #toast { position: fixed; left: 50%; top: 30%; transform: translate(-50%,-50%); z-index: 6; font: 400 120px Georgia, serif; color: #fff; text-shadow: 0 6px 24px rgba(0,0,0,.6); opacity: 0; transition: opacity .2s; white-space: nowrap; }
    #toast.on { opacity: 1; } #toast.small { font-size: 72px; top: 22%; }
  </style>`);
  document.body.insertAdjacentHTML('beforeend', '<div id="lb"><i></i><i></i></div><div id="toast"></div>');
  // Animations run on page time; manual stepping is faster than real time, so skip CSS transitions.
  document.head.insertAdjacentHTML('beforeend', '<style>#lb, #lb i, #toast { transition: none !important; }</style>');
  window.__log = [];
  window.__simT = 0;
  window.__scene.onEvent((k, d) => window.__log.push({ t: window.__simT, k, d }));
  window.__scene.setTree({ kind, targetDeg: kind === 'big' ? -12 : 8 });
  Object.assign(window.__view, { phase: 'saw', cutFrac: 0.97, e: 0, zone: 'green', blame: null, aimDeg: 0, aimGrade: 'wide' });
  window.__autoSaw = true;
  window.__scene.setCamera('saw');
  window.__step(16.67, 120);
}, kind);

let n = 0;
const frame = async () => {
  await p.evaluate((dt) => { window.__step(dt, 1); window.__simT += dt / 1000; }, DT);
  await p.screenshot({ path: path.join(dir, String(n++).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 88 });
};
const overlays = async () => p.evaluate(() => {
  // Mirror the game's overlays from the scene's events so far.
  const L = window.__log;
  const slow = [...L].reverse().find((e) => e.k === 'slowmo');
  document.documentElement.toggleAttribute('data-slowmo', !!slow?.d.on);
  const t = window.__simT, f0 = window.__fallAt ?? Infinity;
  const land = L.find((e) => e.k === 'land');
  const el = document.getElementById('toast');
  let text = '', cls = '';
  if (land && t >= land.t && t < land.t + 2.2) {
    const say = { skid: ['ON THE SKID!', '#7ee08a'], close: ['Close!', '#f2b24c'], wide: ['Wide of the skid', '#f6ead8'], privy: ['GRANDMA’S PRIVY!', '#ff5a4a'] }[land.d.grade];
    if (say) { text = say[0]; el.style.color = say[1]; cls = 'small'; }
  } else if (t >= f0 + 0.9 && t < f0 + 3.1) { text = 'TIMBER!'; el.style.color = '#fff'; }
  el.textContent = text; el.className = text ? 'on ' + cls : '';
});

// Sawing, then the last bite and the fall.
for (let i = 0; i < Math.round(PRE * FPS); i++) await frame();
await p.evaluate((angle, grade) => {
  window.__fallAt = window.__simT;
  window.__view.phase = 'fall'; window.__autoSaw = false;
  window.__done = false;
  window.__scene.fall(angle, grade).then(() => { window.__done = true; window.__view.phase = 'done'; window.__scene.celebrate(); });
}, angle, grade);
let after = -1;
for (let i = 0; i < 30 * 20; i++) {
  await overlays();
  await frame();
  if (after < 0 && (await p.evaluate(() => window.__done))) after = 0;
  if (after >= 0 && ++after > POST * FPS) break;
}
const dur = n / FPS;

// The sound: the same timeline, offline, through the game's audio engine.
const wav = await p.evaluate(async (dur, pre) => {
  const { TimberAudio } = await import('/js/screen/audio.js');
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(sr * (dur + 0.5)), sr);
  const a = new TimberAudio({ context: off });
  await a.unlock();
  // The saw singing until the last bite.
  a.setSawVoice({ speed: 0.7, zone: 'green', strainSign: 0, streak: 12 });
  const fallAt = window.__fallAt;
  a.humGain.gain.setTargetAtTime(0, fallAt, 0.05); a.raspGain.gain.setTargetAtTime(0, fallAt, 0.05);
  a.play('bite', { atCtx: 0.35 }); a.play('bite', { atCtx: 0.98 });
  let lastVoice = -1;
  for (const e of window.__log) {
    if (e.k === 'sound') a.play(e.d.name, { atCtx: e.t + (e.d.delay || 0), gain: e.d.gain ?? 1 });
    if (e.k === 'voice' && e.t - lastVoice > 0.015) { a.setFallVoice(e.d, e.t); lastVoice = e.t; }
    if (e.k === 'slowmo') a.setSlowMo(e.d.on, e.t);
    if (e.k === 'land' && e.d.grade === 'privy') a.play('tut', { atCtx: e.t + 1.3 });
  }
  const buf = await off.startRendering();
  // 16-bit WAV.
  const L = buf.getChannelData(0), R = buf.getChannelData(1), N = L.length;
  const out = new DataView(new ArrayBuffer(44 + N * 4));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + N * 4, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, N * 4, true);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    for (const [ch, d] of [[0, L], [1, R]]) { const v = Math.max(-1, Math.min(1, d[i])); peak = Math.max(peak, Math.abs(v)); out.setInt16(44 + i * 4 + ch * 2, v * 32767, true); }
  }
  let s = ''; const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { b64: btoa(s), peak, events: window.__log.filter((e) => e.k !== 'voice').map((e) => `${e.t.toFixed(2)} ${e.k} ${JSON.stringify(e.d)}`) };
}, dur, PRE);
await b.close();
fs.writeFileSync(path.join(dir, 'audio.wav'), Buffer.from(wav.b64, 'base64'));
const mp4 = path.resolve('scripts/out/fall', name + '.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-i', path.join(dir, 'audio.wav'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-shortest', mp4]);
console.log(mp4, n, 'frames', dur.toFixed(1) + 's', 'audio peak', wav.peak.toFixed(2));
console.log(wav.events.join('\n'));
if (errs.length) console.log('PAGE ERRORS:', errs.join(' | '));
