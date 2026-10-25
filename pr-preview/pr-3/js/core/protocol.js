// @ts-check
// ============================================================
// protocol — Timber Tandem wire format (docs/IMPLEMENTATION.md)
// ============================================================
// Pure: runs in the browser, node tests and the relay Worker.
//
// Relay roles: `host` (the screen that runs the saw), `screen` (a second
// home's screen), `pad-1`..`pad-4` (phones). Phones pair with a per-seat
// secret the host registers; screens join with the room code.
// ============================================================

export const MAX_SEATS = 4;
/** Room code alphabet: no 0/O, 1/I (matches the kit's uf-keypad default set). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export const CODE_PREFIX = 'TIMB-';

/** Seat colors and labels: A is screen-left, B screen-right. */
export const SEATS = Object.freeze([
  { seat: 1, id: 'A', color: '#e8743b', label: 'Left handle' },
  { seat: 2, id: 'B', color: '#3b9be8', label: 'Right handle' },
  { seat: 3, id: 'C', color: '#8fd14f', label: 'Third goose' },
  { seat: 4, id: 'D', color: '#d14fb4', label: 'Fourth goose' },
]);

export const PHONE_MODES = Object.freeze([
  'lobby', 'calib-rest', 'calib-pull', 'calib-saw', 'calib-twist', 'calib-chop', 'saw', 'chop', 'idle',
]);

// ---------- codes and secrets ----------

/** @param {() => number} [rand] */
export function makeCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

/** @param {unknown} code */
export function isValidCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Normalize what a person typed ("timb-abc2d", "ABC 2D") into a code, or null. */
export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  let s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('TIMB') && s.length === 4 + CODE_LENGTH) s = s.slice(4);
  return isValidCode(s) ? s : null;
}

/** 32 hex chars from crypto. */
export function makeSecret() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** @param {string} s */
export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** @param {unknown} role @returns {string|null} */
export function parseRole(role) {
  if (role === 'host' || role === 'screen') return role;
  if (typeof role === 'string' && /^pad-[1-4]$/.test(role)) return role;
  return null;
}

/** @param {string} role */
export function seatOfRole(role) {
  const m = /^pad-([1-4])$/.exec(role);
  return m ? Number(m[1]) : 0;
}

/**
 * The phone's pairing link fragment: #CODE.SEAT.SECRET
 * @param {string} code @param {number} seat @param {string} secret
 */
export function pairFragment(code, seat, secret) {
  return `#${code}.${seat}.${secret}`;
}

/** @param {string} hash @returns {{code:string, seat:number, secret:string}|null} */
export function parsePairFragment(hash) {
  const m = /^#?([A-Z0-9]{5})\.([1-4])\.([0-9a-f]{32})$/.exec(hash || '');
  if (!m || !isValidCode(m[1])) return null;
  return { code: m[1], seat: Number(m[2]), secret: m[3] };
}

// ---------- binary sample frames (phone → host) ----------

export const FRAME_SAMPLES = 0x54;
export const SAMPLE_BYTES = 11;
export const MAX_SAMPLES_PER_FRAME = 6;
export const FLAG_VALID = 1;
/** The sample came from the hold-to-pull button path, not motion. */
export const FLAG_HELD = 2;

/**
 * @typedef {object} StrokeSample
 * @property {number} t     host-clock ms (u32 on the wire)
 * @property {number} p     -1..1
 * @property {number} v     p per second
 * @property {number} roll  steer -1..1 (sent as degrees × 100 of ±30° full)
 * @property {number} flags
 */

/**
 * @param {number} seq @param {StrokeSample[]} samples
 * @returns {Uint8Array}
 */
export function encodeSamples(seq, samples) {
  const n = Math.min(samples.length, MAX_SAMPLES_PER_FRAME);
  const buf = new Uint8Array(3 + n * SAMPLE_BYTES);
  const dv = new DataView(buf.buffer);
  buf[0] = FRAME_SAMPLES;
  buf[1] = seq & 0xff;
  buf[2] = n;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const o = 3 + i * SAMPLE_BYTES;
    dv.setUint32(o, Math.max(0, Math.round(s.t)) >>> 0, true);
    dv.setInt16(o + 4, q(s.p, 10000), true);
    dv.setInt16(o + 6, q(s.v, 1000), true);
    dv.setInt16(o + 8, q(s.roll * 30, 100), true);
    buf[o + 10] = s.flags & 0xff;
  }
  return buf;
}

/**
 * @param {Uint8Array} buf @param {number} [offset]
 * @returns {{seq:number, samples: StrokeSample[]}|null}
 */
export function decodeSamples(buf, offset = 0) {
  if (!buf || buf.length < offset + 3 || buf[offset] !== FRAME_SAMPLES) return null;
  const n = buf[offset + 2];
  if (n > MAX_SAMPLES_PER_FRAME || buf.length < offset + 3 + n * SAMPLE_BYTES) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset + offset);
  /** @type {StrokeSample[]} */
  const samples = [];
  for (let i = 0; i < n; i++) {
    const o = 3 + i * SAMPLE_BYTES;
    samples.push({
      t: dv.getUint32(o, true),
      p: dv.getInt16(o + 4, true) / 10000,
      v: dv.getInt16(o + 6, true) / 1000,
      roll: dv.getInt16(o + 8, true) / 100 / 30,
      flags: dv.getUint8(o + 10),
    });
  }
  return { seq: buf[offset + 1], samples };
}

/** Clamp-quantize to i16. */
function q(x, k) {
  const v = Math.round((Number.isFinite(x) ? x : 0) * k);
  return Math.max(-32767, Math.min(32767, v));
}
