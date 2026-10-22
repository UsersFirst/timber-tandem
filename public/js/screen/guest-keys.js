// @ts-check
// ============================================================
// guest-keys — the other home's keyboard as the right-hand saw handle
// ============================================================
// Online duo without phones (two laptops): the guest screen joins the room
// as seat B's pad with the pairing link the host sent it, exactly as a phone
// would, and streams hold-to-pull samples (the phone's touch path) stamped on
// the host clock. J pulls, K chops, O/P steer.
// A phone that scans the same link later takes the handle: the relay closes
// this socket (4002) and the keyboard stops. That's the one rule.
// ============================================================

import { RelayClient } from '../net/relay-client.js';
import { HoldPull } from '../core/input-buffer.js';
import { encodeSamples, parsePairFragment, FLAG_VALID, FLAG_HELD } from '../core/protocol.js';

export class GuestKeys {
  /**
   * @param {{link:string, clock:{synced:boolean, toHost:(t:number)=>number}, base?:string, onState?:(s:'on'|'off'|'taken', why?:string)=>void}} o
   */
  constructor(o) {
    this.o = o;
    this.pair = parsePairFragment('#' + (o.link.split('#')[1] || ''));
    this.hold = new HoldPull();
    this.keys = { pull: false, left: false, right: false };
    this.mode = 'lobby';
    this.bpm = 96;
    this.seq = 0;
    /** @type {import('../core/protocol.js').StrokeSample[]} */
    this.out = [];
    this.lastT = 0;
    this.timer = 0;
    /** @type {RelayClient|null} */
    this.relay = null;
    this.active = false;
    this.helloSent = false;
  }

  start() {
    if (!this.pair || this.active) return false;
    this.active = true;
    const p = this.pair;
    this.relay = new RelayClient({
      code: p.code, role: 'pad-' + p.seat, key: p.secret, base: this.o.base,
      onState: (s, info) => {
        if (s === 'open') { this.helloSent = false; this.o.onState?.('on'); }
        if (s === 'refused') {
          this.stop();
          this.o.onState?.(info?.code === 4002 ? 'taken' : 'off', info?.code === 4002 ? 'A phone took the right handle.' : 'The handle’s link changed.');
        }
      },
      onJson: (m) => {
        if (!m) return;
        if (m.t === 'host-ready') this.helloSent = false;
        if (m.t === 'mode') { this.mode = m.mode; if (m.song?.bpm) this.bpm = m.song.bpm; }
      },
    });
    this.relay.connect();
    this.timer = /** @type {any} */ (setInterval(() => this._tick(), 1000 / 60));
    return true;
  }

  stop() {
    this.active = false;
    clearInterval(this.timer);
    this.relay?.close();
    this.relay = null;
  }

  _hello() {
    this.relay?.send({ t: 'hello', ua: 'keyboard (other home)', motion: 'touch', keys: true, rateHz: 60, calibrated: true, sim: null });
  }

  /** @param {'pull'|'chop'|'left'|'right'} what @param {boolean} down */
  key(what, down) {
    if (!this.active) return;
    if (what === 'chop') {
      if (down && this.o.clock.synced) this.relay?.send({ t: 'hit', at: this.o.clock.toHost(performance.now()), grade: 'good', peak: 400, axis: [1, 0, 0] });
      return;
    }
    this.keys[what] = down;
  }

  _tick() {
    const now = performance.now();
    const dt = this.lastT ? Math.min(50, now - this.lastT) : 16;
    this.lastT = now;
    const r = this.hold.step(dt, this.keys.pull, 60000 / this.bpm);
    if (!this.o.clock.synced || !this.relay?.open) return;
    // Say "ready" only once samples can be stamped on the host clock.
    if (!this.helloSent) { this.helloSent = true; this._hello(); }
    const roll = this.keys.left ? -1 : this.keys.right ? 1 : 0;
    this.out.push({ t: this.o.clock.toHost(now), p: r.p, v: r.v, roll, flags: FLAG_VALID | FLAG_HELD });
    if (this.out.length >= 2) {
      this.relay.sendRaw(encodeSamples(this.seq++ & 0xff, this.out));
      this.out = [];
    }
  }
}
