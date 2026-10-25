# Touch solo: play on just your phone

**Status:** Pete answered the questions on 2026-10-25 (§9). Nothing is built yet.

**Goal:** someone with only a phone opens timber.housetandem.com, taps **Solo**, turns the phone sideways and saws with Grandma using their thumbs. No TV, no second phone and no QR code.

**Not in scope:** motion on the same phone you're watching (you can't read a screen you're shaking); couch play on a phone; portrait play; new verbs (wedge, limbing, heave, plant aren't built yet, and §13.2 of the plan already maps them to touch for later).

---

## 1. What happens today on a phone

The phone shows the TV page, laid out for a TV:

| | |
|---|---|
| ![Today: the saw HUD on a phone](mockups/touch-solo/today/saw-landscape.png) | ![Today: the lobby on a phone](mockups/touch-solo/today/lobby-landscape.png) |

- **Solo means "phone remote or keyboard".** The lobby asks you to scan a QR code with your phone, which is the device you're already holding. On a phone there's no keyboard.
- **The saw panel covers the scene.** At 844×390 the blade, the beat strip, the stroke sliders and the aim dial cover almost the whole screen, and the TANTRUM! banner sits on top of Old Misery's caption.
- **Grandpa's bubble already copes:** it docks when he's off-screen, so it needs no change.

The screenshots were taken at 844×390 from `feat/grandpa-tales` (Grandpa's bubble isn't on main yet) with `scripts/dev-phone-shots.mjs`. The mockups are drawn over them by `scripts/dev-touch-mockups.mjs` from `docs/mockups/touch-solo/mockups.html`.

## 2. The idea in one line

**A touch seat is a keyboard seat with thumbs.** The touch pads call the same `game.key('A', 'pull' | 'chop' | 'left' | 'right', down)` the keyboard does. The saw model, Grandma's bot, scoring and the phases don't change. The same `HoldPull` already drives both the keyboard and the phone remote's "saw by touch" mode, so a touch score means the same as a keyboard score.

The one new thing in the game logic is **analog steering**. Keys give a roll of −1, 0 or +1; the steer pad gives any value in between (`s.keys.roll`, used in place of `left/right` when set).

## 3. Getting in

- **Which devices count as a phone:** `matchMedia('(pointer: coarse) and (hover: none)')` and no physical keyboard used yet. A tablet counts too. The first real key press switches back to the keyboard layout.
- **Main menu on a phone** (upright is fine here):
  - **Solo — on this phone** goes straight to the game: seat A = touch, seat B = Grandma. The QR lobby is skipped because there's nothing to pair.
  - **Online duo** stays. Touch there is a later follow-up (§9).
  - **Two players — one screen** (local multiplayer) is shown greyed out, labelled "Needs a TV or laptop".
- **The safety card is skipped** for touch, because nothing is swung. Same for the lesson (calibration), which keyboard seats already skip.
- **Turn sideways.** If the phone is upright during a game, a full-screen card says "Turn your phone sideways — Grandma's already holding her end." The game pauses behind it.
- **Tapping Solo** is the user gesture that unlocks audio, takes the Wake Lock, and on Android asks for fullscreen plus `screen.orientation.lock('landscape')`. iPhone Safari has no fullscreen for pages, so the safe-area insets do the work there. Add to Home Screen (a manifest with `display: fullscreen`) gives a clean full screen.

![Main menu and rotate card](mockups/touch-solo/menu.png)

## 4. The layout while sawing

Sideways, two thumbs. The scene stays visible in the middle.

![Saw with touch pads](mockups/touch-solo/saw.png)

| Zone | What | Size |
|---|---|---|
| **Bottom left: the saw pad** | Your handle (orange **W**). **Hold to pull, let go when Grandma pulls.** The ring around the pad fills on your beat, so you can keep time without looking at the beat strip. The pad's whole area is live, and a thumb that slides off it still counts as held until it lifts. | ~210×170 pt, or about a quarter of the screen |
| **Bottom right: steer** | **You fight it.** The knob is always being pulled toward one side, as if the tree wants to lean that way, and you hold it on the target against that pull. Let go and it slides off to that side. The pull's side and strength drift now and then, so steering is managed the whole cut and never set once. The dashed box is where the tree should fall, and the red end is the privy. This replaces the TV's aim dial: the control shows its own target. | ~230×104 pt |
| **Bottom middle: beat strip** | The two-lane strip from the TV, small: your dots on odd beats, Grandma's on even ones. | 250×46 |
| **Top middle: blade strip** | The blade with its live bow and the green and red lines, the handle chips at each end, and the cut bar underneath. This is the TV's saw panel shrunk to one strip. The stroke sliders and FORWARD/BACK labels are dropped, because the pad shows your state. | 330×58 |
| **Top right** | Temper and tantrums. | chip |
| **Top left** | Pause button (a plain tap; there's no fist to guard against) and the tree name. | 44 pt |
| **Captions** | They move from the bottom (where the thumbs are) to under the blade strip, two lines at most. The big TANTRUM! word moves down to the middle of the scene so it never covers a caption. | |

Everything sits inside `env(safe-area-inset-*)`, so the camera cutout and home bar never cover a pad.

## 5. Each phase

| Phase | On a phone |
|---|---|
| Title | Menu as in §3 |
| Lobby | Skipped in touch solo |
| Safety card, lesson | Skipped (§3) |
| Cold open | Tap anywhere to skip, as the TV's skip button does now |
| **Notch** | The saw pad becomes the **hatchet pad: tap to chop** when your face glows. On Grandma's turn it dims and says "Grandma…". The steer pad is hidden. ![Notch](mockups/touch-solo/notch.png) |
| **Saw** | §4. **First strokes are coached** the first time: a ghost thumb pulses on the pad: "Hold… then let go — Grandma pulls back." After three clean strokes the coach goes away and steering lights up. This takes the lesson's place. ![First strokes](mockups/touch-solo/coach.png) |
| Fall | No input. Pads fade out, and Grandpa's call shows as it does now |
| Score, end | The existing buttons, at touch size (44 pt minimum). Grandpa's tale bubble stays over the card |
| Paused | The existing pause sheet; tap Resume |

## 6. Feel

- **Haptics (Android only):** a 10 ms tick when a stroke bites, a 15 ms tick on a chop, and a double buzz on a tantrum. iPhone Safari has no vibration API, so on iPhone the sounds do the work, as they already can (§4.9 of the plan: playable by ear).
- **Sound:** the same cues as on the TV. Phones play through their own speaker, so lower the music bed a notch on touch to keep the hum and rasp clear.
- **Latency:** a touch is felt instantly and the game runs on the phone, so there's no network or sensor delay. That's easier than the phone remote.

## 7. Performance

The scene must hold 60 fps on a mid-range phone.
- Phones start at `quality: 'medium'` (pixel ratio 1.5, no shadow maps).
- If frames take longer than 22 ms for 3 s, drop to `low` and keep that choice for the device.
- Measure on a real iPhone and a real mid-range Android before step T3 passes (§8).

## 8. Build steps (gates, not dates)

| Step | What | Done when |
|---|---|---|
| **T0** | Phone detection, the menu on a phone, Solo goes straight to touch seat A + Grandma, the rotate card | The smoke reaches the notch with an emulated iPhone |
| **T1** | Saw and hatchet pads, the steer pad with analog roll, the compact phone HUD (§4), captions moved | A new `touch` smoke scenario fells a tree with simulated touches: temper ≥ 90, no page errors. All 10 existing scenarios still pass |
| **T2** | The first-strokes coach | The coach shows once, then goes away after three clean strokes |
| **T3** | Haptics, fullscreen/orientation on Android, Wake Lock, the Add to Home Screen manifest, the quality drop | 60 fps on Pete's phones; Pete plays a tree on an iPhone and an Android |

## 9. Pete's answers (2026-10-25)

1. **Saw input: hold to pull (A)** for now. Drag-the-handle (B) stays on the shelf.
2. **Steering is actively managed:** a pull toward one side that you have to fight (§4). It doesn't simply spring back to the middle, and it doesn't stay where you leave it.
   - Still to settle while building T1: which way the pull goes. My proposal is toward the tree's own lean, which the TV game could show too. How strong it is and how often it changes get tuned in play.
3. **Two players (local multiplayer) on a phone:** greyed out. Online multiplayer is coming soon.
4. **Online duo by touch:** later.
5. **Landscape only**, with the rotate card.

<details><summary>The original questions</summary>

1. Hold to pull (A) or drag the handle (B)? ![Option B](mockups/touch-solo/drag.png)
2. Spring-back steering or a knob that stays put?
3. Two players on a phone: grey out or hide?
4. Online duo by touch now or later?
5. Landscape only?

</details>
