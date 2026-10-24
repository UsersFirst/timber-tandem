import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRANDPA, GrandpaPicker } from '../../public/js/screen/lines.js';

test('heckles are short enough to read mid-stroke', () => {
  for (const [key, set] of Object.entries(GRANDPA)) {
    if (key === 'tale') continue;
    for (const [text] of set) assert.ok(text.length <= 40, `${key}: "${text}" is ${text.length} chars`);
  }
});

test('tall tales fit the bubble, and replies are one line', () => {
  for (const [tale, reply] of GRANDPA.tale) {
    assert.ok(tale.length <= 110, `tale too long (${tale.length}): ${tale}`);
    if (reply) assert.ok(reply.length <= 50, `reply too long: ${reply}`);
  }
});

test('the picker rotates through every tale before repeating', () => {
  const p = new GrandpaPicker();
  const seen = new Set();
  for (let i = 0; i < GRANDPA.tale.length; i++) seen.add(p.pick('tale')[0]);
  assert.equal(seen.size, GRANDPA.tale.length);
  assert.equal(p.pick('tale')[0], GRANDPA.tale[0][0]);
});
