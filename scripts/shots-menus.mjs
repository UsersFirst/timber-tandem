#!/usr/bin/env node
// Screenshots of the main menu, mode lobbies and the online guest screens, at
// TV (1280×720) and phone (390×844) sizes. Needs `npm run dev`.
// node scripts/shots-menus.mjs [--base http://localhost:8787] [--noscene]
import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
const args = process.argv.slice(2);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:8787';
const ns = args.includes('--noscene') ? '&noscene' : '';
const out = path.resolve('scripts/out/menus'); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [];
const SIZES = { tv: { width: 1280, height: 720 }, phone: { width: 390, height: 844 } };

async function open(url, size) {
  const p = await b.newPage();
  await p.setViewport(SIZES[size]);
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}
const click = (p, sel) => p.evaluate((s) => /** @type {HTMLElement} */ (document.querySelector(s)).click(), sel);

for (const size of /** @type {const} */ (['tv', 'phone'])) {
  const shot = async (p, n) => { await p.bringToFront(); await sleep(250); await p.screenshot({ path: path.join(out, `${size}-${n}.png`) }); };
  // The menu pages.
  const m = await open(`${base}/?x=1${ns}`, size); await sleep(1200);
  await shot(m, '1-title');
  await click(m, '[data-title="online"]'); await sleep(500); await shot(m, '2-online');
  await click(m, '#title-online [data-title="join"]'); await sleep(500); await shot(m, '3-join');
  await click(m, '#title-join [data-title="back"]'); await sleep(200); await click(m, '#title-online [data-title="back"]'); await sleep(200);
  await click(m, '[data-title="how"]'); await sleep(500); await shot(m, '4-how');
  await click(m, '#title-how [data-title="back"]'); await sleep(200);
  // Solo lobby, from the menu.
  await click(m, '[data-title="solo"]');
  await m.waitForFunction(() => window.__game?.seats.A.link, { timeout: 30000, polling: 250 }); await sleep(size === 'tv' && !ns ? 5000 : 1500);
  await shot(m, '5-lobby-solo');
  await m.keyboard.press('Escape'); await sleep(600); await shot(m, '6-title-again');
  await click(m, '[data-title="couch"]'); await sleep(1500); await shot(m, '7-lobby-couch');
  await m.evaluate(() => window.__game.toTitle()); await sleep(300);
  await click(m, '[data-title="online"]'); await sleep(200); await click(m, '[data-title="online-host"]');
  await sleep(1500); await shot(m, '8-lobby-online-host');
  const code = await m.evaluate(() => window.__game.room.code);
  // A guest joins and takes the keyboard.
  const g = await open(`${base}/?join=${code}${ns}`, size);
  await g.waitForFunction(() => document.querySelector('[data-action="guest-keys"]'), { timeout: 30000, polling: 250 }); await sleep(size === 'tv' && !ns ? 4000 : 1200);
  await shot(g, '9-guest-lobby');
  await click(g, '[data-action="guest-keys"]');
  await m.waitForFunction(() => window.__game.seats.B.phone.keys, { timeout: 15000, polling: 250 }).catch(async (e) => {
    console.log('guest', await g.evaluate(() => ({ keys: !!window.__guest.keys, open: window.__guest.keys?.relay?.open, net: document.getElementById('net').textContent })));
    console.log('host', await m.evaluate(() => JSON.stringify(window.__game.seats.B)));
    throw e;
  });
  await sleep(800);
  await shot(g, '10-guest-keys'); await shot(m, '11-host-with-guest');
  // The host goes back to the menu, then plays solo: the guest is told.
  await m.evaluate(() => window.__game.toTitle()); await sleep(1200); await shot(g, '12-guest-host-choosing');
  await m.evaluate(() => { document.querySelector('[data-title="solo"]').click(); }); await sleep(1500); await shot(g, '13-guest-ended');
  await g.close(); await m.close();
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors');
console.log('shots in', out);
await b.close();
