// @ts-check
// ============================================================
// clock-sync — NTP-style offset to the host clock (PLAN §6.3)
// ============================================================
// Pure. A client sends ping {id, c0} (its own clock), the host answers
// {id, c0, h} (host clock when answering). On receipt at c1:
//   rtt = c1 - c0,  offset = h - (c0 + c1)/2      (host = local + offset)
// Keep the lowest-RTT samples of the last N; the offset is their median.
// ============================================================

export class ClockSync {
  /** @param {number} [keep] */
  constructor(keep = 20) {
    this.keep = keep;
    /** @type {{rtt:number, offset:number}[]} */
    this.samples = [];
    this.offset = 0;
    this.rtt = NaN;
    this.synced = false;
  }

  /** @param {number} c0 @param {number} h @param {number} c1 */
  add(c0, h, c1) {
    const rtt = c1 - c0;
    if (!(rtt >= 0) || rtt > 5000) return;
    this.samples.push({ rtt, offset: h - (c0 + c1) / 2 });
    if (this.samples.length > this.keep) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(3, Math.ceil(this.samples.length / 3)));
    const offs = best.map((s) => s.offset).sort((a, b) => a - b);
    this.offset = offs[Math.floor(offs.length / 2)];
    this.rtt = best[0].rtt;
    this.synced = this.samples.length >= 5;
  }

  /** @param {number} local */
  toHost(local) { return local + this.offset; }
  /** @param {number} host */
  toLocal(host) { return host - this.offset; }
}
