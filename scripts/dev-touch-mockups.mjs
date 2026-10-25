#!/usr/bin/env node
// Renders docs/mockups/touch-solo/mockups.html to one PNG per frame.
// Backdrops come from scripts/dev-phone-shots.mjs. No server needed.
// node scripts/dev-touch-mockups.mjs
import puppeteer from 'puppeteer';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = path.resolve('docs/mockups/touch-solo');
const b = await puppeteer.launch({ headless: true });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 2400, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(path.join(dir, 'mockups.html')).href, { waitUntil: 'networkidle0' });
for (const id of ['saw', 'short', 'notch', 'coach', 'drag', 'menu']) {
  const el = await p.$('#' + id);
  await el.screenshot({ path: path.join(dir, id + '.png') });
  console.log(path.join(dir, id + '.png'));
}
await b.close();
