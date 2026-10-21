#!/usr/bin/env node
// Headless check of the audio engine (public/js/screen/audio.js) via
// public/dev/audio.html: loads, unlocks, exercises every API call, checks the
// song clock rate, and renders every one-shot offline to measure peak level.
//   node scripts/dev-audio-check.mjs [port]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8791);
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), String(port)], { stdio: 'ignore' });
const fail = (msg) => { console.error('FAIL ' + msg); process.exitCode = 1; };

try {
  await new Promise((r) => setTimeout(r, 500));
  const browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${port}/dev/audio.html`, { waitUntil: 'load' });
  await page.click('#unlock');
  await page.waitForFunction(() => document.getElementById("state").textContent !== "locked"); // unlock() resolved

  const res = await page.evaluate(async () => {
    const a = window.__audio;
    const out = { state: a.ctx.state, latency: a.outputLatencyMs };
    for (const n of ['bite', 'chatter', 'tantrum', 'tok', 'chip', 'clang', 'notch-done', 'creak', 'timber', 'thud', 'ui-ok', 'ui-back', 'join', 'star', 'tut', 'honk']) {
      a.play(n, { pan: -0.5, gain: 0.8, atPerfMs: performance.now() + 50 });
    }
    a.click(performance.now() + 100, true);
    a.setIntensity(3);
    const start = performance.now() + 200;
    a.startSong({ bpm: 100, startPerfMs: start, countIn: 2 });
    for (const zone of ['green', 'amber', 'red']) for (const s of [-1, 0, 1]) a.setSawVoice({ speed: 0.7, zone, strainSign: s, streak: 9 });
    const off0 = a.ctxTimeForPerf(0);
    await new Promise((r) => setTimeout(r, 300));
    const t0 = performance.now(); const b0 = a.beatAt(t0);
    await new Promise((r) => setTimeout(r, 5000));
    const t1 = performance.now(); const b1 = a.beatAt(t1);
    out.rate = (b1 - b0) / ((t1 - t0) / 600);
    out.b1 = b1;
    // ctx mapping should advance in step with perf.
    out.mapDriftMs = +((a.ctxTimeForPerf(0) - off0) * 1000).toFixed(2); // perf→ctx offset change over ~5 s
    a.setBpm(90);
    await new Promise((r) => setTimeout(r, 3500));
    const t2 = performance.now(); const b2 = a.beatAt(t2);
    await new Promise((r) => setTimeout(r, 2000));
    const t3 = performance.now(); const b3 = a.beatAt(t3);
    out.rate90 = (b3 - b2) / ((t3 - t2) / (60000 / 90));
    a.stopSong(200);
    out.afterStop = String(a.beatAt(performance.now()));
    a.setVolume(0.5); a.mute(true); a.mute(false);
    a.setSawVoice({ speed: 0, zone: 'green', strainSign: 0, streak: 0 });

    // Offline render: peak of each one-shot through the full master chain.
    const { TimberAudio, SFX_NAMES } = await import('/js/screen/audio.js');
    out.peaks = {};
    for (const n of SFX_NAMES) {
      const off = new OfflineAudioContext(2, 44100 * 3.2, 44100);
      const oa = new TimberAudio({ context: off });
      await oa.unlock();
      oa.play(n);
      const buf = await off.startRendering();
      let peak = 0;
      for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
      out.peaks[n] = +peak.toFixed(3);
    }
    // Saw voice at full tilt in each zone.
    out.sawPeaks = {};
    for (const [zone, sign] of [['green', 0], ['amber', -1], ['amber', 1], ['red', 1]]) {
      const off = new OfflineAudioContext(2, 44100, 44100);
      const oa = new TimberAudio({ context: off });
      await oa.unlock();
      oa.setSawVoice({ speed: 1, zone, strainSign: sign, streak: 20 });
      const buf = await off.startRendering();
      let peak = 0;
      const d = buf.getChannelData(0); for (let i = 22050; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      out.sawPeaks[zone + (sign < 0 ? '-push' : sign > 0 ? '-tug' : '')] = +peak.toFixed(3);
    }
    return out;
  });

  console.log(JSON.stringify(res, null, 2));
  if (res.state !== 'running') fail('context not running: ' + res.state);
  if (!(Math.abs(res.rate - 1) < 0.02)) fail('beat rate at 100 BPM off: ' + res.rate);
  if (!(Math.abs(res.rate90 - 1) < 0.02)) fail('beat rate after setBpm(90) off: ' + res.rate90);
  if (res.afterStop !== 'NaN') fail('beatAt after stop should be NaN, got ' + res.afterStop);
  for (const [n, p] of Object.entries(res.peaks)) {
    if (p <= 0.01) fail(`${n} is silent (${p})`);
    if (p >= 1) fail(`${n} clips (${p})`);
  }
  for (const [n, p] of Object.entries(res.sawPeaks)) {
    if (p <= 0.005) fail(`saw ${n} is silent (${p})`);
    if (p >= 1) fail(`saw ${n} clips (${p})`);
  }
  if (errors.length) fail('console errors:\n' + errors.join('\n'));
  await browser.close();
  if (!process.exitCode) console.log('OK audio');
} finally {
  server.kill();
}
