#!/usr/bin/env node
// How close does a felled tree come to points on the ground? Fells the tree
// at each angle in the scene lab, then reports the nearest piece of the
// fallen tree (below head height) to each point. Needs: node scripts/serve.mjs 8792.
// Usage: node scripts/dev-fall-reach.mjs  (edit POINTS / FALLS below)
import puppeteer from 'puppeteer';

const POINTS = {
  grandpa: [-2.9, -1.3],
  'L -2.3,-1.6': [-2.3, -1.6],
  'L -2.25,-1.4': [-2.25, -1.4],
  'L -2.35,-1.25': [-2.35, -1.25],
  'L -2.15,-1.2': [-2.15, -1.2],
};
const FALLS = [['big', -25], ['big', -12], ['small', -25]];
const base = process.env.BASE || 'http://localhost:8792';
const b = await puppeteer.launch({ headless: 'new', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.setViewport({ width: 480, height: 270 });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto(`${base}/dev/scene.html?nopanel&manual`); await p.waitForFunction(() => document.title === 'READY', { timeout: 120000 });
for (const [kind, deg] of FALLS) {
  const r = await p.evaluate(async (kind, deg, POINTS) => {
    const sc = window.__scene, d = sc._debug;
    sc.setTree({ kind, targetDeg: 0 });
    window.__step(16.67, 5);
    sc.fall(deg, 'wide');
    for (let i = 0; i < 900 && !d.tree.landed; i++) window.__step(16.67, 1);
    window.__step(16.67, 120);
    const THREE = d.scene.constructor; // not needed; use matrices directly
    const out = {};
    for (const [n, [px, pz]] of Object.entries(POINTS)) out[n] = Infinity;
    const v = { x: 0, y: 0, z: 0 };
    d.tree.group.updateMatrixWorld(true);
    d.tree.group.traverse((o) => {
      if (!o.isMesh || o === d.tree.stump) return;
      const pos = o.geometry.attributes.position, m = o.matrixWorld.elements;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        v.x = m[0] * x + m[4] * y + m[8] * z + m[12];
        v.y = m[1] * x + m[5] * y + m[9] * z + m[13];
        v.z = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (v.y > 1.6) continue;
        for (const [n, [px, pz]] of Object.entries(POINTS)) out[n] = Math.min(out[n], Math.hypot(v.x - px, v.z - pz));
      }
    });
    return out;
  }, kind, deg, POINTS);
  console.log(kind, deg, Object.entries(r).map(([n, d]) => `${n}: ${d.toFixed(2)} m`).join(' | '));
}
await b.close();
