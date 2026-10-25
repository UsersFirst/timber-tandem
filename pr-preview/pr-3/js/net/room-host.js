// @ts-check
// ============================================================
// room-host — the hosting screen's side of the room
// ============================================================
// Opens (or resumes) a room, registers phone pairing secrets per seat,
// answers clock pings at once, decodes phone sample frames, and forwards
// everything else to the game. Guest screens (a second home) join the same
// room; the host is the one copy of the saw (Tandemonium's captain model).
// ============================================================

import { RelayClient } from './relay-client.js';
import { makeCode, makeSecret, sha256hex, pairFragment, decodeSamples } from '../core/protocol.js';

const STORE = 'timber.host.v1';

/**
 * @typedef {object} HostHandlers
 * @property {(seat:number, samples: import('../core/protocol.js').StrokeSample[], arrivedAt:number) => void} onSamples
 * @property {(seat:number, msg:any) => void} onPadMsg
 * @property {(seat:number) => void} onPadJoined
 * @property {(seat:number) => void} onPadLeft
 * @property {(id:string) => void} onScreenJoined
 * @property {(id:string) => void} onScreenLeft
 * @property {(id:string, msg:any) => void} onScreenMsg
 * @property {(state:string) => void} [onState]
 */

export class RoomHost {
  /** @param {HostHandlers} h @param {{relayBase?: string}} [opts] */
  constructor(h, opts = {}) {
    this.h = h;
    this.base = opts.relayBase;
    /** @type {Map<number, string>} seat → secret */
    this.secrets = new Map();
    this.code = '';
    this.key = '';
    /** @type {RelayClient|null} */
    this.relay = null;
    /** Changes on every page load: clients reset their clock sync when it does. */
    this.boot = Math.random().toString(36).slice(2, 10);
    /** @type {boolean|undefined} the last invite state asked for */
    this.invite = undefined;
  }

  /** Let a second home's screen join (online duo), or stop letting them. @param {boolean} open */
  setInvite(open) { this.invite = open; this.relay?.send({ t: 'invite', open }); }

  /** Resume this tab's room after a reload, else make a new one. */
  open({ fresh = false } = {}) {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { /* blocked */ }
    if (!fresh && saved?.code && saved?.key) {
      this.code = saved.code; this.key = saved.key;
      for (const [s, sec] of Object.entries(saved.secrets || {})) this.secrets.set(Number(s), sec);
    } else {
      this.code = makeCode();
      this.key = makeSecret();
    }
    this._save();
    this.relay = new RelayClient({
      code: this.code, role: 'host', key: this.key, base: this.base,
      onState: (s) => {
        this.h.onState?.(s);
        if (s === 'open') {
          for (const [seat, sec] of this.secrets) this._allow(seat, sec);
          // The invite may have been set before the socket opened (or across a reconnect).
          if (this.invite !== undefined) this.relay?.send({ t: 'invite', open: this.invite });
        }
        // Only a real refusal (another host owns this code) starts a new room.
        if (s === 'refused') { this.relay?.close(); this.secrets.clear(); this.open({ fresh: true }); }
      },
      onJson: (m) => this._json(m),
      onBinary: (b) => this._binary(b),
    });
    this.relay.connect();
  }

  _save() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ code: this.code, key: this.key, secrets: Object.fromEntries(this.secrets) }));
    } catch { /* blocked */ }
  }

  /**
   * The phone link for a seat (a new secret each call drops the old phone).
   * @param {number} seat @param {{newLink?: boolean, query?: string}} [o]
   */
  async phoneLink(seat, o = {}) {
    let sec = this.secrets.get(seat);
    if (!sec || o.newLink) {
      sec = makeSecret();
      this.secrets.set(seat, sec);
      this._save();
    }
    await this._allow(seat, sec);
    const q = o.query ? '?' + o.query : '';
    // Relative to this page, so a preview in a subfolder links its own phone page.
    return new URL(`phone/${q}`, location.href).href + pairFragment(this.code, seat, sec);
  }

  async _allow(seat, sec) {
    this.relay?.send({ t: 'allow', seat, hash: await sha256hex(sec) });
  }

  /** @param {number|null} seat @param {any} msg */
  toPad(seat, msg) {
    this.relay?.send(seat ? { t: 'to-pad', seat, msg } : { t: 'to-pad', msg });
  }

  /** @param {any} msg @param {string} [id] */
  toScreens(msg, id) {
    this.relay?.send(id ? { t: 'to-screen', id, msg } : { t: 'to-screen', msg });
  }

  /** @param {string} id */
  kickScreen(id) { this.relay?.send({ t: 'kick-screen', id }); }

  /** @param {any} m */
  _json(m) {
    const now = performance.now();
    switch (m.t) {
      case 'from-pad':
        if (m.msg?.t === 'ping') { this.toPad(m.seat, { t: 'pong', id: m.msg.id, c0: m.msg.c0, h: performance.now(), hb: this.boot }); return; }
        this.h.onPadMsg(m.seat, m.msg);
        return;
      case 'from-screen':
        if (m.msg?.t === 'ping') { this.toScreens({ t: 'pong', id: m.msg.id, c0: m.msg.c0, h: performance.now(), hb: this.boot }, m.id); return; }
        this.h.onScreenMsg(m.id, m.msg);
        return;
      case 'pad-joined': this.h.onPadJoined(m.seat); return;
      case 'pad-left': this.h.onPadLeft(m.seat); return;
      case 'screen-joined': this.h.onScreenJoined(m.id); return;
      case 'screen-left': this.h.onScreenLeft(m.id); return;
      default: void now;
    }
  }

  /** @param {Uint8Array} b */
  _binary(b) {
    const seat = b[0];
    const d = decodeSamples(b, 1);
    if (d) this.h.onSamples(seat, d.samples, performance.now());
  }
}
