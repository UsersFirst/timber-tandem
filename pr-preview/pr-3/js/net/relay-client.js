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
    this.lastRx = 0;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.open && performance.now() - this.lastRx > 6000) this._drop();
      });
    }
  }

  url() {
    const o = this.opts;
    // A PR preview on GitHub Pages has no relay of its own: it sets
    // window.__TIMBER_RELAY to the live site and uses that one.
    const base = o.base || /** @type {any} */ (globalThis).__TIMBER_RELAY || location.origin;
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
      this.lastRx = performance.now();
      clearInterval(this._keepalive);
      this._keepalive = /** @type {any} */ (setInterval(() => {
        this.sendRaw('ping');
        // A socket can sit "open" but dead after a phone wakes or Wi-Fi
        // roams: nothing heard for 12 s means reconnect.
        if (performance.now() - this.lastRx > 12000) this._drop();
      }, 5000));
    };
    ws.onmessage = (ev) => {
      this.lastRx = performance.now();
      if (typeof ev.data === 'string') {
        if (ev.data === 'pong') return;
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.opts.onJson?.(m);
      } else {
        this.opts.onBinary?.(new Uint8Array(ev.data));
      }
    };
    ws.onclose = async (ev) => {
      this.open = false;
      clearInterval(this._keepalive);
      if (this.ws !== ws) return;
      // Closed on purpose by the relay: a new link (4001), replaced by another
      // phone on the same link (4002), removed by the host (4003). Final.
      if (ev.code === 4001 || ev.code === 4002 || ev.code === 4003) {
        this.opts.onState?.('refused', { code: ev.code, reason: ev.reason });
        return;
      }
      if (this.closedByUs) return;
      // A browser can't see why an upgrade failed, so a run of failures asks
      // the relay over plain HTTP: 403/404/409 is a real refusal; anything
      // else (offline, a blip) just keeps retrying the same room.
      if (!opened.v && this.attempt >= 2) {
        const status = await this.probe();
        if (status === 403 || status === 404 || status === 409) {
          this.opts.onState?.('refused', { code: status, reason: 'http ' + status });
          return;
        }
      }
      this.opts.onState?.('closed', { code: ev.code });
      if (this.closedByUs) return;
      this.attempt++;
      const wait = Math.min(8000, 400 * 2 ** Math.min(this.attempt, 5));
      clearTimeout(this._timer);
      this._timer = /** @type {any} */ (setTimeout(() => this.connect(), wait));
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  /** Close a dead socket so onclose reconnects. */
  _drop() {
    try { this.ws?.close(4000, 'stale'); } catch { /* closed */ }
  }

  /** Why can't we connect? The relay answers the same checks over plain HTTP. @returns {Promise<number>} */
  async probe() {
    try {
      const u = new URL(this.url());
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      const r = await fetch(u.toString(), { cache: 'no-store' });
      return r.status;
    } catch {
      return 0;
    }
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
