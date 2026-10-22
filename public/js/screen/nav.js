// @ts-check
// ============================================================
// nav — arrow keys, Tab and a gamepad over the screen's menus
// ============================================================
// One FocusController (@usersfirst/ui) for the whole screen. Its input merges
// the first gamepad (GamepadInput) with the keyboard (a ManualInput fed from
// key events), so arrows/Enter/Esc and a d-pad/A/B drive the same engine.
//
// Scopes, first visible wins:
//   - the main menu: the <uf-flow>'s active step (flow.attachFocus); Enter
//     confirms, Esc / B goes back a page;
//   - any other panel (guest notice, pause, score, end, lobby, safety): its
//     buttons; arrows / d-pad move, A confirms. Enter and Esc keep their
//     game meanings there (Enter = start / next, Esc = pause / menu).
// Native focus follows the controller, and Tab (or a click) moves the
// controller, so the ring and Enter always agree.
// ============================================================

import { FocusController } from '../../lib/ui/focus-controller.js';
import { GamepadInput, ManualInput } from '../../lib/ui/inputs.js';

const KEY_TO_PAD = /** @type {const} */ ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'a', Space: 'a', Escape: 'b' });
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * @typedef {object} NavScope
 * @property {string} name
 * @property {HTMLElement} el
 * @property {() => void} [back]  gamepad B (and Esc where the scope owns it)
 */

export class ScreenNav {
  /**
   * @param {{flow: any, titleEl: HTMLElement, scopes: () => NavScope[], onTitleBack?: () => void}} o
   */
  constructor(o) {
    this.o = o;
    this.pad = new GamepadInput();
    this.keys = new ManualInput();
    const pad = this.pad, keys = this.keys;
    const input = {
      _gpSwapAB: false,
      gamepadConnected: true,
      getGamepadState() {
        const k = keys.getGamepadState();
        const g = pad.getGamepadState();
        if (!g) return k;
        return {
          buttons: k.buttons.map((b, i) => ({ pressed: b.pressed || !!g.buttons[i]?.pressed })),
          axes: [g.axes[0] || 0, g.axes[1] || 0, 0, 0],
        };
      },
    };
    /** @type {NavScope|null} */
    this.scope = null;
    this.fc = new FocusController({
      input,
      onBack: () => this._back(),
      onChange: (el) => { if (document.activeElement !== el) el.focus?.({ preventScroll: true }); },
    });
    // The title's pages: entering one focuses its first choice (the join page, its code).
    o.flow.addEventListener('uf-flow:change', () => this._focusTitleSoon());
    window.addEventListener('keydown', (ev) => this._key(ev, true), true);
    window.addEventListener('keyup', (ev) => this._key(ev, false), true);
    // Tab or a click moves the controller too.
    document.addEventListener('focusin', (ev) => {
      const el = /** @type {HTMLElement} */ (ev.target);
      if (this.scope && this.fc.items.includes(el) && this.fc.focused !== el) this.fc.setSpatial(this.fc.items, el);
    });
    const loop = () => { this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /** Which scope is showing now. @returns {NavScope|null} */
  _current() {
    if (!this.o.titleEl.hidden) return { name: 'title', el: this.o.titleEl, back: () => this.o.flow.back() };
    for (const s of this.o.scopes()) if (s.el && !s.el.hidden && s.el.getBoundingClientRect().width > 0) return s;
    return null;
  }

  frame() {
    const s = this._current();
    if (s?.name !== this.scope?.name || s?.el !== this.scope?.el) {
      this.scope = s;
      if (!s) this.fc.clear();
      else if (s.name === 'title') { this.o.flow.attachFocus(this.fc); this._focusTitleSoon(); }
      else this.fc.setSpatial(focusables(s.el), preferred(s.el));
    } else if (s && s.name !== 'title') {
      // Panels rebuild their buttons as the game changes (the lobby, the menus).
      this.fc.refreshSpatial(focusables(s.el));
    } else if (s) this.o.flow.refreshFocus();
    if (s) this.fc.poll();
  }

  _back() { this.scope?.back?.(); }

  _focusTitleSoon() {
    // The flow hands the controller its scope on the next frame; focus after that.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.o.titleEl.hidden) return;
      const step = this.o.flow.step(this.o.flow.current);
      this.o.titleEl.dataset.page = String(this.o.flow.current || '').replace(/^title-/, '');
      const code = step?.querySelector('uf-join-code');
      if (code) { code.clear?.(); code.focus?.(); return; }
      /** @type {HTMLElement|null} */ (this.fc.focused)?.focus({ preventScroll: true });
    }));
  }

  /** @param {KeyboardEvent} ev @param {boolean} down */
  _key(ev, down) {
    const k = KEY_TO_PAD[/** @type {keyof typeof KEY_TO_PAD} */ (ev.code)];
    const s = this.scope;
    if (!k || !s) return;
    const inCode = !!/** @type {HTMLElement} */ (ev.target)?.closest?.('uf-join-code');
    // The main menu owns Enter and Esc; elsewhere only the arrows are ours.
    // (The code entry keeps its own Enter.)
    const ours = ARROWS.has(ev.code) || (s.name === 'title' && (ev.code === 'Escape' || !inCode));
    if (!ours) return;
    if (ev.repeat) { ev.preventDefault(); ev.stopPropagation(); return; }
    ev.preventDefault();
    ev.stopPropagation();
    if (down) this.keys.press(k); else this.keys.release(k);
    // Poll at once: a key can go down and up inside one frame.
    this.fc.poll();
  }
}

/** The buttons a panel offers. @param {HTMLElement} el */
function focusables(el) {
  return /** @type {HTMLElement[]} */ (Array.from(el.querySelectorAll('uf-button, button'))).filter((b) => {
    if (b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true' || b.closest('[hidden]')) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** The panel's main choice, where focus starts. @param {HTMLElement} el */
function preferred(el) {
  return focusables(el).find((b) => b.getAttribute('variant') === 'accent') || null;
}
