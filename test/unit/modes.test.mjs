import test from 'node:test';
import assert from 'node:assert/strict';
import { menuFor, isMode, seatBChangesHome, TITLE_ITEMS, remoteMenu, hostOnly } from '../../public/js/core/modes.js';

const base = { phase: 'lobby', held: false, mode: /** @type {const} */ ('couch'), lastTree: false, canStart: false, onePhone: false, bOpen: true };
const ids = (s) => menuFor({ ...base, ...s }).map((i) => i.id);

test('modes are solo, couch and online', () => {
  assert.ok(isMode('solo') && isMode('couch') && isMode('online'));
  assert.ok(!isMode('versus') && !isMode(undefined));
});

test('the main menu offers every mode on phones too', () => {
  assert.deepEqual(ids({ phase: 'title' }), TITLE_ITEMS.map((i) => i.id));
  assert.deepEqual(ids({ phase: 'title' }), ['mode-solo', 'mode-couch', 'mode-online']);
});

test('the lobby menu follows the mode, and always leads back to the main menu', () => {
  assert.deepEqual(ids({}), ['title']);
  assert.deepEqual(ids({ canStart: true }), ['start', 'title']);
  // Couch with one phone and an open right handle: offer Grandma (= solo).
  assert.deepEqual(ids({ onePhone: true }), ['solo', 'title']);
  assert.deepEqual(ids({ onePhone: true, bOpen: false }), ['title']);
  assert.deepEqual(ids({ mode: 'solo', canStart: true }), ['start', 'duo', 'title']);
  // Online: no Grandma toggle; seat B belongs to the other home.
  assert.deepEqual(ids({ mode: 'online', onePhone: true }), ['title']);
  assert.equal(menuFor({ ...base, canStart: true }).find((i) => i.id === 'start')?.primary, true);
});

test('pause, score and end screens can go to the main menu', () => {
  assert.ok(ids({ phase: 'saw', held: true }).includes('title'));
  assert.deepEqual(ids({ phase: 'saw' }), ['pause']);
  assert.ok(ids({ phase: 'score' }).includes('title'));
  assert.ok(ids({ phase: 'score', lastTree: true }).includes('finish'));
  assert.deepEqual(ids({ phase: 'end' }), ['more', 'lobby', 'title']);
  assert.deepEqual(ids({ phase: 'fall' }), []);
});

test('the main menu items are copies (a caller can’t change the menu)', () => {
  const a = menuFor({ ...base, phase: 'title' });
  a[0].label = 'x';
  assert.notEqual(menuFor({ ...base, phase: 'title' })[0].label, 'x');
});

test("the other home's phone runs the tree but can't navigate the host's screen", () => {
  const held = menuFor({ ...base, phase: 'saw', held: true });
  assert.deepEqual(remoteMenu(held).map((i) => i.id), ['resume', 'flip']);
  assert.deepEqual(remoteMenu(menuFor({ ...base, phase: 'title' })), []);
  assert.deepEqual(remoteMenu(menuFor({ ...base, canStart: true })).map((i) => i.id), ['start']);
  assert.deepEqual(remoteMenu(menuFor({ ...base, phase: 'score' })).map((i) => i.id), ['next']);
  for (const id of ['title', 'mode-solo', 'mode-online', 'solo', 'duo', 'lobby', 'restart']) assert.ok(hostOnly(id), id);
  for (const id of ['start', 'pause', 'resume', 'next', 'more', 'finish', 'safety-ok']) assert.ok(!hostOnly(id), id);
});

test("seat B's phone changes home only across online", () => {
  assert.equal(seatBChangesHome('couch', 'online'), true);
  assert.equal(seatBChangesHome('online', 'solo'), true);
  assert.equal(seatBChangesHome('couch', 'solo'), false);
  assert.equal(seatBChangesHome('online', 'online'), false);
});
