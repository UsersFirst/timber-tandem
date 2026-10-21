// @ts-check
// ============================================================
// relay-client — one WebSocket to the room, with reconnect and keepalive
// ============================================================
// Browser only. The relay is the same origin as the page (/relay). Text
// messages are JSON; binary frames are Uint8Array. "ping" text is answered by
// the Durable Object itself without waking it.
// ============================================================

/**
 * @typedef {object} RelayOptions
 * @property {string} code
 * @property {'host'|'screen'|string} role   'host' | 'screen' | 'pad-N'
 * @property {string} [key]                   host key or pad secret
 * @property {string} [id]                    screen id
 * @property {string} [base]                  relay origin override (?relay=)
 * @property {(msg:any) => void} [onJson]
 * @property {(bytes:Uint8Array) => void} [onBinary]
 * @property {(state:'connecting'|'open'|'closed'|'refused', info?:any) => void} [onState]
 */

export class RelayClient {
  /** @param {RelayOptions} opts */
  constructor(opts) {
    this.opts = opts;
    /** @type {WebSocket|null} */
    this.ws = null;
    this.open = false;
    this.closedByUs = false;
    this.attempt = 0;
    this._keepalive = 0;
    this._timer = 0;
  }

  url() {
    const o = this.opts;
    const base = o.base || location.origin;
    const u = new URL('/relay', base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.searchParams.set('code', o.code);
    u.searchParams.set('role', o.role);
    if (o.key) u.searchParams.set('k', o.key);
    if (o.id) u.searchParams.set('id', o.id);
    return u.toString();
  }

  connect() {
    this.closedByUs = false;
    this.opts.onState?.('connecting');
    const ws = new WebSocket(this.url());
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    const opened = { v: false };
    ws.onopen = () => {
      opened.v = true;
      this.open = true;
      this.attempt = 0;
      this.opts.onState?.('open');
      clearInterval(this._keepalive);
      this._keepalive = /** @type {any} */ (setInterval(() => this.sendRaw('ping'), 5000));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        if (ev.data === 'pong') return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.opts.onJson?.(m);
      } else {
        this.opts.onBinary?.(new Uint8Array(ev.data));
      }
    };
    ws.onclose = (ev) => {
      this.open = false;
      clearInterval(this._keepalive);
      if (this.ws !== ws) return;
      // 403/404/409 at upgrade arrive as a close without ever opening.
      const refused = !opened.v && this.attempt >= 2;
      if (ev.code === 4001 || ev.code === 4003 || refused) {
        this.opts.onState?.('refused', { code: ev.code, reason: ev.reason });
        if (ev.code === 4001 || ev.code === 4003) return;
      } else {
        this.opts.onState?.('closed', { code: ev.code });
      }
      if (this.closedByUs) return;
      this.attempt++;
      const wait = Math.min(8000, 400 * 2 ** Math.min(this.attempt, 5));
      clearTimeout(this._timer);
      this._timer = /** @type {any} */ (setTimeout(() => this.connect(), wait));
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  /** @param {any} obj */
  send(obj) {
    return this.sendRaw(JSON.stringify(obj));
  }

  /** @param {string|Uint8Array} data */
  sendRaw(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    // Drop if the socket is backing up: stale input is worse than none.
    if (this.ws.bufferedAmount > 64 * 1024) return false;
    this.ws.send(data);
    return true;
  }

  close() {
    this.closedByUs = true;
    clearInterval(this._keepalive);
    clearTimeout(this._timer);
    try { this.ws?.close(1000); } catch { /* closed */ }
    this.ws = null;
    this.open = false;
  }
}
