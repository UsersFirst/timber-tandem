// @ts-check
// ============================================================
// modes — the ways to play, and the menu each screen offers (pure)
// ============================================================
// solo:   you on the left handle, Grandma on the right (one phone or keys)
// couch:  two players, one screen, two phones
// online: two homes, one saw; this screen hosts, the other home has seat B
// The same menu goes to the TV and every phone, so a game can be run
// entirely from a phone.
// ============================================================

/** @typedef {'solo'|'couch'|'online'} Mode */
/** @typedef {{id:string, label:string, primary?:boolean, local?:boolean}} MenuItem */

export const MODES = /** @type {const} */ (['solo', 'couch', 'online']);

/** @param {any} m @returns {m is Mode} */
export function isMode(m) { return MODES.includes(m); }

/** The main menu's choices, as phone menu items. @type {ReadonlyArray<MenuItem>} */
export const TITLE_ITEMS = Object.freeze([
  { id: 'mode-solo', label: 'Solo — saw with Grandma' },
  { id: 'mode-couch', label: 'Two players — one screen' },
  { id: 'mode-online', label: 'Online duo — host it here' },
]);

/**
 * The buttons that make sense right now.
 * @param {{phase:string, held:boolean, mode:Mode, lastTree:boolean, canStart:boolean, onePhone:boolean, bOpen:boolean}} s
 * @returns {MenuItem[]}
 */
export function menuFor(s) {
  const title = { id: 'title', label: 'Main menu' };
  switch (s.phase) {
    case 'title': return TITLE_ITEMS.map((i) => ({ ...i }));
    case 'lobby': {
      /** @type {MenuItem[]} */
      const items = [];
      if (s.canStart) items.push({ id: 'start', label: 'Start', primary: true });
      if (s.mode === 'couch' && s.onePhone && s.bOpen) items.push({ id: 'solo', label: 'Saw with Grandma' });
      if (s.mode === 'solo') items.push({ id: 'duo', label: 'A partner instead' });
      items.push(title);
      return items;
    }
    case 'safety': return [{ id: 'safety-ok', label: 'Got it', primary: true }];
    case 'intro': return [{ id: 'skip-intro', label: 'Skip' }];
    case 'calibrate': return [{ id: 'flip', label: 'My hand goes the wrong way', local: true }, { id: 'skip-calib', label: 'Skip the lesson' }];
    case 'notch': case 'saw':
      return s.held
        ? [{ id: 'resume', label: 'Resume', primary: true }, { id: 'flip', label: 'My hand goes the wrong way', local: true }, { id: 'restart', label: 'Start this tree again' }, { id: 'lobby', label: 'Stop — back to the lobby' }, title]
        : [{ id: 'pause', label: 'Pause' }];
    case 'score':
      return s.lastTree
        ? [{ id: 'more', label: 'One more tree', primary: true }, { id: 'finish', label: 'Finish' }, { id: 'lobby', label: 'Back to the lobby' }, title]
        : [{ id: 'next', label: 'Next tree', primary: true }, { id: 'lobby', label: 'Back to the lobby' }, title];
    case 'end': return [{ id: 'more', label: 'One more tree', primary: true }, { id: 'lobby', label: 'Back to the lobby' }, title];
    default: return [];
  }
}

/**
 * The other home's phone may run the tree (start, pause, resume, next…) but
 * not navigate the host's screen: no main menu, no mode changes, no lobby.
 */
const HOST_ONLY = new Set(['title', 'mode-solo', 'mode-couch', 'mode-online', 'solo', 'duo', 'lobby', 'restart']);

/** @param {string} id */
export function hostOnly(id) { return HOST_ONLY.has(id); }

/** The menu for a phone in the other home. @param {MenuItem[]} items */
export function remoteMenu(items) { return items.filter((i) => !HOST_ONLY.has(i.id)); }

/**
 * Does moving between these modes change who owns seat B's phone link? A
 * phone paired for one home must not carry over to the other.
 * @param {Mode} from @param {Mode} to
 */
export function seatBChangesHome(from, to) {
  return (from === 'online') !== (to === 'online');
}
