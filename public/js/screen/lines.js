// @ts-check
// Captions for Grandma and Old Misery (PLAN §8.1). Shown on the TV; voice later.
// Each key is a moment; lines rotate so repeats don't nag.

export const LINES = {
  coldOpen: [
    ['Grandma', 'Lovely to see you both. Now — the woodpile.'],
    ['Old Misery', '…Hrrmph. Who woke me?'],
    ['Grandma', 'It only sings for two. Pull to you, then let your partner pull it back.'],
  ],
  calibrate: ['Grandma', 'Show me how you hold it, dears. Firm fist.'],
  notchStart: [
    ['Grandma', 'Notch first, so she knows which way to fall. Take turns — your side glows.'],
    ['Grandma', 'Same as before: notch, turn and turn about.'],
  ],
  notchChip: [['Old Misery', 'Oi. Wait your turn.'], ['Grandma', 'Patience — it’s their go.']],
  notchChipSolo: [['Grandma', 'My turn, dear. Watch how it’s done.'], ['Old Misery', 'Oi. Let Grandma have her go.']],
  notchClang: [['Old Misery', 'CLANG. Lovely. Very musical.'], ['Grandma', 'Not both at once, dears!']],
  notchGlance: [['Grandma', 'Right on the glowing face, dear. Small and square.']],
  sawStart: [
    ['Grandma', 'Watch under your goose, dears: BACK, then FORWARD. When one goes back, the other goes forward.'],
    ['Old Misery', 'Pull to ya… now let ’er go…'],
    ['Old Misery', 'Bigger tree. Same rhythm. Don’t rush me.'],
  ],
  steerHint: ['Grandma', 'Twist your fists together to aim for the skid.'],
  push: [['Old Misery', 'Don’t PUSH me! Let ’er go!'], ['Old Misery', 'Now I’m cross… cut!'], ['Grandma', 'Only pull, dear. Never push.']],
  tug: [['Old Misery', 'You’re BOTH pulling! I’m not a wishbone!'], ['Grandma', 'Take turns, dears. One pulls, one lets go.']],
  tugSolo: [['Grandma', 'Let go when I pull, dear. I’ve had fifty years’ practice.'], ['Old Misery', 'She’s pulling, you’re pulling. I’m not a wishbone!']],
  pushSolo: [['Grandma', 'No pushing, dear — I’ll bring it back to you.'], ['Old Misery', 'Don’t PUSH me! Grandma’s got the other end.']],
  chatter: [['Grandma', 'Slow down — let the teeth bite.'], ['Old Misery', 'Faster isn’t sharper, you know.']],
  bindPush: [['Grandma', 'Easy on the forward stroke.']],
  bindTug: [['Grandma', 'Let go sooner on your partner’s pull.']],
  streak: [['Old Misery', 'Ahh… that’s the stuff.'], ['Old Misery', 'Now we’re singing.'], ['Grandma', 'Lovely rhythm, dears.']],
  timber: [['Everyone', 'TIMBER!']],
  landSkid: [['Grandma', 'Right on the skid. Your grandfather never managed that.']],
  landClose: [['Grandma', 'Near enough. I’ve seen worse.']],
  landWide: [['Grandma', 'Down it comes! …Not quite where I asked, but it’s firewood all the same.']],
  landPrivy: [['Grandma', 'My privy! …Temper, dears.']],
  scoreHigh: [['Old Misery', 'Well-tempered. I could get used to you two.']],
  scoreMid: [['Grandma', 'Temper, dears. But not bad at all.']],
  scoreLow: [['Old Misery', 'Hrrmph. I’ve had gentler days at the steam mill.'], ['Grandma', 'A lively one. We’ll make sawyers of you yet.']],
  pullAgain: [['Grandma', 'Once more, dear: one slow pull toward your belly, then hold it there.']],
  flippedAuto: [['Grandma', 'One of you had your handle back to front — I’ve turned it round. Watch your dot.']],
  flipped: [['Grandma', 'There — I’ve turned your handle round. Back is back now.']],
  partnerGone: [['Old Misery', 'Hold up… where’d they go?']],
  end: [['Grandma', 'That’s the woodpile started. Same time tomorrow?']],
};

/** Picks lines in rotation. */
export class LinePicker {
  constructor() { /** @type {Record<string, number>} */ this.i = {}; }
  /**
   * @param {keyof typeof LINES} key
   * @param {boolean} [solo] prefer the solo-with-Grandma variant when there is one
   * @returns {[string, string]}
   */
  pick(key, solo = false) {
    if (solo && /** @type {any} */ (LINES)[key + 'Solo']) key = /** @type {any} */ (key + 'Solo');
    const set = LINES[key];
    if (!Array.isArray(set[0])) return /** @type {[string,string]} */ (set);
    const n = (this.i[key] = ((this.i[key] ?? -1) + 1));
    return /** @type {[string,string]} */ (set[n % set.length]);
  }
}
