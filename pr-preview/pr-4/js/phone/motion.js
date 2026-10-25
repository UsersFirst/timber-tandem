// @ts-check
// ============================================================
// motion — devicemotion capture on the phone (PLAN §6.1, §6.4)
// ============================================================
// Lessons carried over from Tandemonium's phone remote and the roulette:
// - iOS needs DeviceMotionEvent.requestPermission() on a tap, over HTTPS;
//   a denial sticks for the session.
// - `acceleration` (gravity removed) is null without a gyroscope; those
//   phones use the hold-to-pull touch path.
// - In-app browsers (Instagram, some QR scanners) can block motion.
// - Plan for ~60 Hz with jitter and gaps; use event.timeStamp.
// ============================================================

/** @typedef {import('../core/vec.js').Vec3} Vec3 */

/**
 * @typedef {object} RawMotion
 * @property {number} t      performance.now() ms of the reading
 * @property {Vec3} a        linear acceleration m/s²
 * @property {Vec3|null} g   gravity m/s² (with-gravity minus linear), if both exist
 * @property {Vec3} r        rotation rate deg/s about device x, y, z
 */

/** @returns {'needs-permission'|'available'|'unavailable'} */
export function motionSupport() {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unavailable';
  if (!window.isSecureContext) return 'unavailable';
  const DME = /** @type {any} */ (window.DeviceMotionEvent);
  const touch = navigator.maxTouchPoints > 0;
  if (typeof DME.requestPermission === 'function' && touch) return 'needs-permission';
  return touch ? 'available' : 'unavailable';
}

/** In-app browsers that are known to block or throttle motion. */
export function inAppBrowser() {
  const ua = navigator.userAgent || '';
  return /Instagram|FBAN|FBAV|Line\/|Snapchat|TikTok|; wv\)/i.test(ua);
}

/** Must be called from a tap. @returns {Promise<'granted'|'denied'|'unavailable'>} */
export async function requestMotion() {
  const sup = motionSupport();
  if (sup === 'unavailable') return 'unavailable';
  if (sup === 'needs-permission') {
    try {
      const r = await /** @type {any} */ (window.DeviceMotionEvent).requestPermission();
      return r === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted';
}

/**
 * Listen to devicemotion. Resolves the capability after the first readings:
 * 'ok' when gravity-free acceleration and rotation exist, 'no-gyro' when only
 * acceleration-with-gravity does, 'silent' when nothing arrives.
 * @param {(m: RawMotion) => void} onSample
 * @returns {{stop: () => void, capability: Promise<'ok'|'no-gyro'|'silent'>, rateHz: () => number}}
 */
export function startMotion(onSample) {
  let resolveCap;
  /** @type {Promise<'ok'|'no-gyro'|'silent'>} */
  const capability = new Promise((r) => { resolveCap = r; });
  let n = 0, firstT = 0, lastT = 0, decided = false;
  let tOffset = NaN; // event.timeStamp → performance.now() correction, if needed

  /** @param {DeviceMotionEvent} ev */
  const handler = (ev) => {
    const now = performance.now();
    let t = ev.timeStamp;
    // Some engines stamp in epoch ms or a different origin; map to perf time.
    if (!Number.isFinite(tOffset)) tOffset = Math.abs(t - now) > 1000 ? now - t : 0;
    t += tOffset;
    if (t > now + 5 || t < now - 500) t = now;

    const acc = ev.acceleration;
    const incl = ev.accelerationIncludingGravity;
    const rr = ev.rotationRate;
    const hasLin = !!acc && acc.x !== null && acc.y !== null && acc.z !== null;
    const hasIncl = !!incl && incl.x !== null;
    if (!decided && n >= 6) {
      decided = true;
      resolveCap(hasLin ? 'ok' : hasIncl ? 'no-gyro' : 'silent');
    }
    n++;
    if (!firstT) firstT = t;
    lastT = t;
    if (!hasLin) return;
    /** @type {Vec3} */
    const a = [acc.x || 0, acc.y || 0, acc.z || 0];
    /** @type {Vec3|null} */
    const g = hasIncl ? [(incl.x || 0) - a[0], (incl.y || 0) - a[1], (incl.z || 0) - a[2]] : null;
    /** @type {Vec3} */
    const r = [rr?.beta || 0, rr?.gamma || 0, rr?.alpha || 0];
    onSample({ t, a, g, r });
  };
  window.addEventListener('devicemotion', handler);
  const silentTimer = setTimeout(() => { if (!decided) { decided = true; resolveCap(n > 0 ? 'no-gyro' : 'silent'); } }, 1500);
  return {
    stop: () => { window.removeEventListener('devicemotion', handler); clearTimeout(silentTimer); },
    capability,
    rateHz: () => (n > 1 && lastT > firstT ? ((n - 1) * 1000) / (lastT - firstT) : 0),
  };
}

/** Keep the screen awake while playing (iOS 16.4+ tabs, 18.4+ home-screen apps). */
export async function keepAwake() {
  /** @type {any} */
  let lock = null;
  const get = async () => {
    try { lock = await /** @type {any} */ (navigator).wakeLock?.request('screen'); } catch { /* denied/unsupported */ }
  };
  await get();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') get(); });
  return () => { try { lock?.release(); } catch { /* released */ } };
}

/** Short buzzes where the Vibration API exists (not iOS Safari). @param {number|number[]} pattern */
export function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
