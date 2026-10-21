// ============================================================
// Timber Tandem Worker: the static site + the room relay
// ============================================================
//
// One Durable Object (TimberRoom) per room code. Roles:
//   host     the screen that runs the saw (claims the room with ?k=<host key>)
//   screen   a second home's screen (online duo), joins with the code
//   pad-1..4 phones, paired with a per-seat secret the host registers
//
// Routing (pure, routeMessage):
//   pad    -> host    binary sample frames, prefixed with the seat byte;
//                     JSON wrapped {t:'from-pad', seat, msg}
//   screen -> host    JSON wrapped {t:'from-screen', id, msg}
//   host   -> pads    {t:'to-pad', seat?, msg}          (no seat = every pad)
//   host   -> screens {t:'to-screen', id?, msg}         (no id = every screen)
//   relay  -> host    {t:'pad-joined'|'pad-left', seat} · {t:'screen-joined'|'screen-left', id}
//   relay  -> others  {t:'host-ready'|'host-left'|'waiting'}
//
// Pairing follows Tandemonium's pad relay (#421): the host registers
// SHA-256(secret) per seat with {t:'allow', seat, hash}; the secret travels in
// the link's #fragment, never to the site.
// ============================================================

import { parseRole, seatOfRole, isValidCode, sha256hex, MAX_SEATS } from '../public/js/core/protocol.js';

const ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_FRAME_BYTES = 128;
const MAX_TEXT = 4096;
const MAX_SCREENS = 3;
/** Per socket, per second. Phones send ~30 frames/s; the host ~35 state + cues. */
const MSG_RATE = 160;
const MSG_BURST = 320;
const ALARM_REFRESH_MS = 60 * 1000;

/**
 * Where a message from `role` goes. Pure; exported for tests.
 * @param {string} role  'host' | 'screen:<id>' | 'pad-N'
 * @param {string|ArrayBuffer|Uint8Array} message
 */
export function routeMessage(role, message) {
  if (role === 'host') {
    if (typeof message !== 'string') return null;
    let m;
    try { m = JSON.parse(message); } catch { return null; }
    if (!m || typeof m !== 'object') return null;
    if (m.t === 'allow') {
      const seat = Number(m.seat);
      if (!(seat >= 1 && seat <= MAX_SEATS) || typeof m.hash !== 'string' || !/^[0-9a-f]{64}$/.test(m.hash)) return null;
      return { allow: { seat, hash: m.hash } };
    }
    if (m.t === 'to-pad') {
      const seats = m.seat ? [Number(m.seat)] : [1, 2, 3, 4];
      return { to: seats.filter((s) => s >= 1 && s <= MAX_SEATS).map((s) => 'pad-' + s), data: JSON.stringify(m.msg ?? null) };
    }
    if (m.t === 'to-screen') {
      return { toScreens: typeof m.id === 'string' ? m.id : '*', data: JSON.stringify(m.msg ?? null) };
    }
    if (m.t === 'kick-screen' && typeof m.id === 'string') return { kick: m.id };
    return null;
  }
  if (role.startsWith('screen:')) {
    if (typeof message !== 'string' || message.length > MAX_TEXT) return null;
    let msg;
    try { msg = JSON.parse(message); } catch { return null; }
    return { to: ['host'], data: JSON.stringify({ t: 'from-screen', id: role.slice(7), msg }) };
  }
  const seat = seatOfRole(role);
  if (!seat) return null;
  if (typeof message === 'string') {
    if (message.length > MAX_TEXT) return null;
    let msg;
    try { msg = JSON.parse(message); } catch { return null; }
    return { to: ['host'], data: JSON.stringify({ t: 'from-pad', seat, msg }) };
  }
  const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
  if (bytes.length === 0 || bytes.length > MAX_FRAME_BYTES) return null;
  const out = new Uint8Array(bytes.length + 1);
  out[0] = seat;
  out.set(bytes, 1);
  return { to: ['host'], data: out };
}

/** Does `secret` match the hash the host registered? Pure; exported for tests. */
export async function secretMatches(secret, allowedHash) {
  if (!allowedHash || typeof secret !== 'string' || !/^[0-9a-f]{32}$/.test(secret)) return false;
  return (await sha256hex(secret)) === allowedHash;
}

export class TimberRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    try { state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch { /* old runtime */ }
    this._buckets = new WeakMap();
    this._alarmAt = 0;
  }

  _withinRate(ws) {
    const now = Date.now();
    let b = this._buckets.get(ws);
    if (!b) { b = { t: MSG_BURST, at: now }; this._buckets.set(ws, b); }
    b.t = Math.min(MSG_BURST, b.t + ((now - b.at) * MSG_RATE) / 1000);
    b.at = now;
    if (b.t < 1) return false;
    b.t -= 1;
    return true;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = parseRole(url.searchParams.get('role'));
    if (!role) return new Response('Invalid role', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });

    let tag = role;
    if (role === 'host') {
      const key = url.searchParams.get('k');
      if (typeof key !== 'string' || !/^[0-9a-f]{32}$/.test(key)) return new Response('Host key required', { status: 403 });
      const keyHash = await sha256hex(key);
      const claimed = await this.state.storage.get('hostkey');
      if (!claimed) await this.state.storage.put('hostkey', keyHash);
      else if (claimed !== keyHash) return new Response("Not this room's host", { status: 403 });
    } else if (role === 'screen') {
      if (!(await this.state.storage.get('hostkey'))) return new Response('No such room', { status: 404 });
      const id = url.searchParams.get('id');
      if (typeof id !== 'string' || !/^[a-z0-9]{6,16}$/.test(id)) return new Response('Screen id required', { status: 400 });
      const others = this.state.getWebSockets().filter((w) => {
        const t = this.state.getTags(w)[0];
        return t.startsWith('screen:') && t !== 'screen:' + id;
      });
      if (others.length >= MAX_SCREENS) return new Response('Room is full', { status: 409 });
      if ((await this.state.storage.get('kicked:' + id))) return new Response('Removed by host', { status: 403 });
      tag = 'screen:' + id;
    } else {
      const allowed = await this.state.storage.get('allow:' + seatOfRole(role));
      if (!(await secretMatches(url.searchParams.get('k'), allowed))) return new Response('Not paired', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    for (const sock of this.state.getWebSockets(tag)) {
      try { sock.close(1000, 'replaced'); } catch { /* closed */ }
    }
    this.state.acceptWebSocket(server, [tag]);
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);

    if (tag === 'host') {
      for (const w of this.state.getWebSockets()) {
        const t = this.state.getTags(w)[0];
        if (t.startsWith('pad-')) { this._send(server, { t: 'pad-joined', seat: seatOfRole(t) }); this._send(w, { t: 'host-ready' }); }
        if (t.startsWith('screen:')) { this._send(server, { t: 'screen-joined', id: t.slice(7) }); this._send(w, { t: 'host-ready' }); }
      }
    } else {
      const hosts = this.state.getWebSockets('host');
      this._send(server, { t: hosts.length ? 'host-ready' : 'waiting' });
      const note = tag.startsWith('screen:') ? { t: 'screen-joined', id: tag.slice(7) } : { t: 'pad-joined', seat: seatOfRole(tag) };
      for (const h of hosts) this._send(h, note);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (!this._withinRate(ws)) return;
    const role = this.state.getTags(ws)[0];
    const r = routeMessage(role, message);
    if (!r) return;
    if (r.allow) {
      const key = 'allow:' + r.allow.seat;
      if ((await this.state.storage.get(key)) === r.allow.hash) return;
      await this.state.storage.put(key, r.allow.hash);
      for (const p of this.state.getWebSockets('pad-' + r.allow.seat)) {
        try { p.close(4001, 'new link'); } catch { /* closed */ }
      }
      return;
    }
    if (r.kick) {
      await this.state.storage.put('kicked:' + r.kick, true);
      for (const s of this.state.getWebSockets('screen:' + r.kick)) {
        try { s.close(4003, 'removed'); } catch { /* closed */ }
      }
      return;
    }
    if (r.toScreens) {
      for (const w of this.state.getWebSockets()) {
        const t = this.state.getTags(w)[0];
        if (t.startsWith('screen:') && (r.toScreens === '*' || t === 'screen:' + r.toScreens)) {
          try { w.send(r.data); } catch { /* closed */ }
        }
      }
    } else {
      for (const target of r.to) {
        for (const sock of this.state.getWebSockets(target)) {
          try { sock.send(r.data); } catch { /* closed */ }
        }
      }
    }
    if (typeof message === 'string' && Date.now() - this._alarmAt > ALARM_REFRESH_MS) {
      this._alarmAt = Date.now();
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000); } catch { /* already closed */ }
    const tag = this.state.getTags(ws)[0];
    if (this.state.getWebSockets(tag).some((s) => s !== ws)) return;
    if (tag === 'host') {
      for (const w of this.state.getWebSockets()) if (w !== ws) this._send(w, { t: 'host-left' });
    } else {
      const note = tag.startsWith('screen:') ? { t: 'screen-left', id: tag.slice(7) } : { t: 'pad-left', seat: seatOfRole(tag) };
      for (const h of this.state.getWebSockets('host')) this._send(h, note);
    }
  }

  async webSocketError(ws) {
    try { ws.close(); } catch { /* closed */ }
  }

  async alarm() {
    if (this.state.getWebSockets().length === 0) await this.state.storage.deleteAll();
    else await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  _send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch { /* closed */ }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/relay') {
      const code = (url.searchParams.get('code') || '').toUpperCase();
      if (!isValidCode(code)) return new Response('Invalid code', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }
    if (url.pathname === '/health') return new Response('Timber Tandem OK');
    return env.ASSETS.fetch(request);
  },
};
