// @ts-check
// ============================================================
// presenter — turns the view + events into pictures and sound
// ============================================================
// Used by the hosting screen (fed by Game) and by a guest screen (fed from
// the network), so both homes render the same thing. Host-clock times are
// mapped to this page's performance.now() with `toLocal`.
// ============================================================

import { TimberAudio } from './audio.js';
import { Hud } from './hud.js';

export class Presenter {
  /**
   * @param {{canvas: HTMLCanvasElement, role:'host'|'guest', toLocal:(h:number)=>number, onAction:(a:string, arg?:any)=>void, quality?: string, noScene?: boolean}} o
   */
  constructor(o) {
    this.toLocal = o.toLocal;
    this.audio = new TimberAudio();
    this.hud = new Hud({ onAction: o.onAction, role: o.role });
    /** @type {any} */
    this.scene = null;
    this.sceneReady = o.noScene ? Promise.resolve(false) : this._loadScene(o.canvas, o.quality);
    if (o.noScene) document.documentElement.dataset.noscene = '1';
    this.cast = { A: 'winston', B: 'victoria' };
    this.lastFrame = performance.now();
    /** @type {any} */
    this.lastView = null;
    this.intensity = -1;
  }

  async _loadScene(canvas, quality) {
    try {
      const mod = await import('./scene.js');
      this.scene = await mod.createScene(canvas, { quality: /** @type {any} */ (quality || 'high') });
      await this.scene.setCast(this.cast);
      const resize = () => this.scene?.resize(window.innerWidth, window.innerHeight);
      window.addEventListener('resize', resize);
      resize();
      if (this._pendingTree) this.scene.setTree(this._pendingTree);
      if (this._pendingCamera) this.scene.setCamera(this._pendingCamera);
      return true;
    } catch (err) {
      console.error('Scene failed to load; HUD only.', err);
      document.documentElement.dataset.noscene = '1';
      return false;
    }
  }

  async unlockAudio() {
    try { await this.audio.unlock(); } catch (e) { console.warn('audio', e); }
  }

  /** @param {any} ev */
  event(ev) {
    this.hud.event(ev);
    const a = this.audio, sc = this.scene;
    const pan = (seat) => (seat === 'A' ? -0.5 : seat === 'B' ? 0.5 : 0);
    switch (ev.k) {
      case 'cast':
        this.cast = ev.cast;
        sc?.setCast(ev.cast);
        break;
      case 'tree':
        this._pendingTree = ev.def;
        sc?.setTree(ev.def);
        break;
      case 'camera':
        this._pendingCamera = ev.mode;
        sc?.setCamera(ev.mode);
        break;
      case 'song':
        if (a.ready) { a.startSong({ bpm: ev.bpm, startPerfMs: this.toLocal(ev.startH), countIn: 4 }); a.setIntensity(0); this.intensity = 0; }
        break;
      case 'song-stop':
        a.stopSong(900);
        break;
      case 'clicks': {
        const beatMs = 60000 / ev.bpm;
        for (let i = 0; i < ev.count; i++) a.click(this.toLocal(ev.startH + i * beatMs), i % 4 === 0);
        break;
      }
      case 'bite': sc?.bite(); a.play('bite', { gain: 0.9 }); break;
      case 'tantrum': sc?.tantrum(ev.blame); a.play('tantrum', { pan: pan(ev.blame) }); break;
      case 'chatter': sc?.chatter(); a.play('chatter'); break;
      case 'hit':
        sc?.hit(ev.seat, ev.kind);
        a.play(ev.kind === 'tok' ? 'tok' : ev.kind === 'clang' ? 'clang' : 'chip', { pan: pan(ev.seat), gain: ev.result === 'glance' ? 0.5 : 1 });
        break;
      case 'notch-done': a.play('notch-done'); break;
      case 'fall':
        a.play('creak');
        setTimeout(() => a.play('timber'), 700);
        setTimeout(() => a.play('thud'), 2900);
        sc?.fall(ev.angle).then(() => sc?.celebrate());
        break;
      case 'score':
        for (let i = 0; i < ev.score.landing.stars; i++) setTimeout(() => a.play('star'), 400 + i * 350);
        break;
      case 'caption':
        if (ev.who === 'Grandma' && /privy|Temper/.test(ev.text)) a.play('tut');
        break;
      case 'ui': a.play(ev.sfx); break;
      default:
    }
  }

  /** @param {any} v @param {number} nowH host-clock now */
  frame(v, nowH) {
    const now = performance.now();
    const dt = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    if (!v) return;
    this.lastView = v;
    if (this.scene) {
      const phase = v.phase === 'notch-done' ? 'notch' : v.phase === 'score' || v.phase === 'end' ? 'done' : ['notch', 'saw', 'fall'].includes(v.phase) ? v.phase : 'idle';
      this.scene.update(dt, {
        phase, s: v.s, e: v.e, zone: v.zone, blame: v.blame, lean: v.lean,
        cutFrac: v.cutFrac, notchFrac: v.notchFrac, litFace: v.litFace,
      });
    }
    if (this.audio.ready) {
      const sawing = v.phase === 'saw' && !v.paused;
      this.audio.setSawVoice({ speed: sawing ? v.speed : 0, zone: v.zone, strainSign: Math.abs(v.e) < 0.05 ? 0 : v.e < 0 ? -1 : 1, streak: v.streak });
      const level = v.phase === 'saw' ? (v.streak >= 12 ? 3 : v.streak >= 7 ? 2 : v.streak >= 3 ? 1 : 0) : v.phase === 'notch' ? 1 : 0;
      if (level !== this.intensity && v.song) { this.intensity = level; this.audio.setIntensity(/** @type {0|1|2|3} */ (level)); }
    }
    this.hud.frame(v, nowH, dt);
  }
}
