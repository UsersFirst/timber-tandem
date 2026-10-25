import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TreePull, PULL, keysRoll } from '../../public/js/core/tree-pull.js';

test('the pull eases in from nothing and stays within its strength range', () => {
  const p = new TreePull(42);
  assert.equal(p.value, 0);
  let max = 0;
  for (let i = 0; i < 60 * 120; i++) { const v = p.step(1000 / 60); max = Math.max(max, Math.abs(v)); }
  assert.ok(max >= PULL.MIN, `reached ${max}`);
  assert.ok(max <= PULL.MAX + 1e-9, `stayed under MAX: ${max}`);
});

test('with no input, the steering drifts to the pull side', () => {
  const p = new TreePull(7);
  for (let i = 0; i < 120; i++) p.step(1000 / 60); // 2 s: fully eased
  const roll = keysRoll(0, p.value);
  assert.ok(Math.abs(roll) >= PULL.MIN, `drifted to ${roll}`);
  assert.equal(Math.sign(roll), p.side);
});

test('holding against the pull keeps the steering on target', () => {
  const p = new TreePull(3);
  const target = 0.32; // the small pine's skid: 8° of 25°
  for (let i = 0; i < 60 * 60; i++) {
    const pull = p.step(1000 / 60);
    const thumb = target - pull; // a player correcting every frame
    assert.ok(Math.abs(keysRoll(thumb, pull) - target) < 1e-9);
  }
});

test('the pull changes over time and the same seed repeats', () => {
  const run = (seed) => { const p = new TreePull(seed); const out = []; for (let i = 0; i < 60 * 60; i++) out.push(p.step(1000 / 60)); return out; };
  const a = run(11), b = run(11);
  assert.deepEqual(a, b);
  const distinct = new Set(a.filter((_, i) => i % 600 === 599).map((v) => v.toFixed(3)));
  assert.ok(distinct.size >= 3, `pull changed: ${[...distinct]}`);
});

test('keysRoll clamps to full steer', () => {
  assert.equal(keysRoll(1, 0.5), 1);
  assert.equal(keysRoll(-1, -0.5), -1);
  assert.equal(keysRoll(1, -0.4), 0.6);
});
