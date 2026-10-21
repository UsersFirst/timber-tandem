# Timber Tandem — Game Plan (v5)

> **One saw. Two handles. Keep your temper.**

**Status:** draft for Pete's design review, 2026-10-20.
- **v5 changes:** headset-free multiplayer, local and online (§10).
- **v4 changes:** Pete's feedback added small hatchet swings, removed the dates, locked the Victorian geese and Grandma, asked for an Overcooked lens, and added VR.
- **Earlier reviews:** the plan went through two review rounds before v4 (§19).
- **Signed off by Pete:** D1–D5 in §17, marked ✅. They cover the name, the Victorian geese, the Grandma continuation, small hatchet swings, and no dates.
- **Still proposals:** all other gameplay, until Pete signs it off.

**The name.** *Timber Tandem* sounds like *temper tantrum*, and the joke runs through the whole game:
- Old Misery, the crosscut saw, has a **temper**.
- If you fight it, it throws a **tantrum**.
- If you saw smoothly, the steel stays **well-tempered** and sings.
- **Temper** is also the crew's score (§4.9).

Kids get the joke, and it explains the core mechanic at the same time.

---

## 0. TL;DR

Timber Tandem is the next chapter of the Royal House of Geese Chaos. Sir Winston and Lady Victoria have finally pedalled the wobbly tandem to **Grandma's**, and Grandma needs her woodpile filled before winter. She takes **Old Misery** off the wall: a two-person crosscut saw with a famously short temper.

It's a motion-controlled party game about lumberjacking **as a pair**. You hold your phone (or a gyro pad, or a VR controller) like the tool.

The headline verb is the **two-person crosscut saw**: one virtual saw, two people on its handles, driven by both bodies at once.
- **Alternate cleanly:** the blade travels and the saw hums.
- **Both pull at once:** it's a tug-of-war.
- **Push:** the blade bows and Old Misery throws a tantrum.

Around the saw sit small-swing **hatchet** work, wedges, heaving and planting. Later, Overcooked-style **Shifts** fill Grandma's orders before the kettle boils.

- **What's new vs. earlier lumberjack motion games:** you can't waggle it. One bite of wood per clean, shared stroke; sawing faster doesn't cut faster.
- **Platforms:**
  - **Web-first:** housetandem.com click-to-play, with one big screen and phones as controllers (the Jackbox model).
  - **Gyro pads:** desktop Chromium, through the controller-lab.
  - **VR:** Quest, via WebXR/IWSDK (§11), the same stack as SandQuest and Tandemonium VR.
  - **Discord Activity:** using the phone-in-its-own-browser pairing.
- **Players:** 2 is the core. 3–4 play in Shifts.
- **Multiplayer without a headset (§10):** couch co-op, plus online duo across two homes using Tandemonium's captain/stoker model, both from the first toy. Then couch versus, ghost races (async versus), online crew vs. crew and online Shifts.
- **Business role:** a House Tandem brand extension and source of clips, sharing Tandemonium's geese and Grandma. Revenue only if it reaches Steam (§14).
- **Pace:** gates, not dates. The cheap tests start now.

---

## 1. Why this game, why House Tandem

**The studio promise.** House Tandem makes *cooperation you feel in your body*. Tandemonium is two riders on one bike; Timber Tandem is two sawyers on one saw. Same geese, same Grandma, next chapter.

**Reuse.** The hard plumbing already exists:

| Need | Already built | Where |
|---|---|---|
| Phone as controller, QR pairing, relay (~34 ms measured) | Pad relay Worker + Durable Object; **moving into the controller lab** as a package with game plugins (§10.7) | Tandemonium #421/#422 (`worker/pad-relay.js`, `js/remote/*`) → lab |
| Online co-op across homes: rooms, peer-to-peer with relay fallback, host authority, jitter buffer | `RoomTransport` + captain/stoker model; room and join logic **moving into the controller lab** | Tandemonium (`js/net/room-transport.js`, `shared-pedal-controller.js`, #318, #390) → lab |
| Per-phone motion calibration and soft/good/strong grading | `MotionProfile`, `/calibrate` | discord-activity-roulette (`src/input/profile.ts`) |
| Eyes-free teaching: voice coach, tones, demo animations | `/practice`, `coach.ts`, `feedback.ts` | discord-activity-roulette |
| Gyro gamepads, player slots, device identity, drift-free gravity roll | `@usersfirst/controller-core` (`manager.js`, `device-identity.js`, `gravity-roll.js`), WebHID drivers | tandemonium-controller-lab |
| WebXR on Quest: hands, controllers, grab, emulator testing | IWSDK app patterns, hand grab, multiplayer relay | SandQuest; Tandemonium `/vr/` (#425/#426) |
| Victorian geese, outfits, Grandma's | Goose models and outfits, the Grandma's level | Tandemonium, tandemonium-claude-3d |
| Lobby, seat select, UI kit | `@usersfirst/ui` (`uf-flow`, `uf-step`, `uf-seat`), seat-select navigator | tandemonium-controller-lab (being upgraded in the current UI review) |
| Discord Activity shell | Worker + Discord SDK | discord-activity-dice / -roulette |
| Device identity without accounts | D1 `device_id` | Tandemonium |

**Lessons from earlier projects, built in:**
1. **You can't look at the phone while it's a tool.** Teach with sound and the TV, not the phone screen (roulette `/practice`).
2. **iPhone web has no Vibration API.** A switch-checkbox haptic hack exists (Safari 17.4+), but it's fragile and needs a user gesture. The main cue channel is the big screen's speakers; phone haptics are a bonus.
3. **iOS Silent Mode mutes web audio.** `navigator.audioSession.type = "playback"` (Safari 16.4+) may fix that. Check it on a device.
4. **Discord Activity iframes block motion sensors.** Phones pair by QR code and run in their own browser.
5. **iOS Shake-to-Undo** pops up on hard motion if a text field had focus. Only ask for text when no more motion is coming, or reload afterwards (the roulette fix).
6. **In-app browsers** (Instagram, some QR scanners) can block motion. Detect them and tell the player to open the page in Safari or Chrome.
7. **Stickiness is the open question for Tandemonium.** A novel verb gets one laugh. §12 has to answer "why play a second night?"
8. **The simplest literal input wins** (Pete, Slingshot). No hidden timers, and no thresholds the player can't see.
9. **Electron/Steam builds have no WebXR** (Tandemonium VR finding). VR ships through Quest Browser on the web.

---

## 2. Competitive landscape

| What exists | What it teaches us |
|---|---|
| **Go Play Lumberjacks** (Wii, 2009) | Nintendo World Report: 3.5/10, "all you have to do is shake the Wii Remote." Waggle killed the genre's credibility. **Our answer: you can't shake your way through a two-person saw.** |
| **Mario Party 2 "Looney Lumberjacks"** | A 2v2 button saw: one player pulls (A), the other pushes (B), and it stalls if both pull. Two-person sawing is a proven minigame. We go further with real motion, pull-only strokes and a literal shared saw. |
| **Overcooked** (Ghost Town Games) | The family co-op benchmark, and a household favorite of Pete's family. What we borrow and what we don't: §9. |
| **Phone-as-controller party platforms**: AirConsole, Jackbox (touch), Movecade (Jan 2026, motion minigames), Playcade, Tchin | "Phones as tools" is crowded and cheap. It is **not** our moat. |
| **Lumberjack games without motion**: Timberman, Lumberjack's Dynasty, Timberborn | The theme has an audience; "timber" searches are noisy. |
| **VR wood-chopping and crafting toys** (various Quest titles and minigames) | Solo VR chopping exists. **Two people on one saw, including VR + phone cross-play, doesn't.** |
| **Everybody 1-2-Switch!** | Reportedly read as "tedious" with families. Novel motion alone doesn't carry a party night. |

**Positioning:**
> Not waggle. In Timber Tandem, wood only cuts when two people lock a rhythm. When someone pushes, the blade bows and Old Misery loses its temper.

---

## 3. Pillars

1. **Physical honesty.** Every verb is a real motion with the real tool, scaled down to be safe. If it feels like waving a remote, cut it.
2. **Coupled, not parallel.** Your motion *changes what your partner can do*. You drive one object together; you don't each play your own rhythm game.
3. **Literal and visible.** When something fails, you can see why: a bowed blade, a tilting log, a wobbling wedge.
4. **Satisfying wood.** Chips, sawdust, the blade's song when it locks, and a big fall at the end of every tree.
5. **The players are the show.** Two geese-fans sawing air together is the funniest thing in the room. Design for spectators and clips.
6. **Tall tale, warm tone.** Grounded motions in an exaggerated Victorian world: giant trees, a saw with a temper, rival beavers with a steam mill.

### 3.1 Appeal and attractiveness

**The hook image:** two people with phones in their fists sawing air in perfect alternation. Behind them on screen, two Victorian geese in waistcoats fell a giant pine, and someone in the room yells "TIMBER!"

**Why people will want it:**
- **Fun to watch.** People film friends sawing air. That's House Tandem's growth bet: short clips of real people playing.
- **Characters people already know.** Sir Winston, Lady Victoria and Grandma carry over from Tandemonium, so clips for one game advertise the other.
- **No extra gear beyond phones and a screen.** One QR scan, and one permission tap per iPhone. A headset is a bonus (§11).
- **Legible in a GIF.** A two-person saw explains itself.
- **Sound.** The hum when the saw locks in and the crack of wood carry across a room.
- **The pun.** *Timber Tandem* / *temper tantrum*, plus a saw that throws fits, gives kids and parents an instant handle.
- **One claim we test rather than assert: "kids to grandparents."** Everybody 1-2-Switch! shows why.

**Art direction.**
- Chunky low-poly with a warm autumn palette.
- Victorian costume silhouettes that read from the couch.
- Exaggerated chips and sawdust, and cartoon-physics falls.
- Must run on a 720p TV and Google TV-class hardware. Tandemonium's TV lesson applies: keep draw calls low.

**Clip moments to design for:**
- the TIMBER fall, with an automatic slow-mo replay;
- a tree landing on Grandma's privy;
- a tantrum;
- the wedge popping out;
- the log rolling off during a heave;
- the kettle boiling over in a Shift;
- Sir Winston's top hat full of sawdust;
- the birling dunk.

**Real-world hooks.** Never write "Timbersports" in our copy; STIHL owns that trademark.
- **Events:** the Double Buck and Jack & Jill event names, plus collegiate woodsmen's meets.
- **Paul Bunyan Show:** run by the Ohio Forestry Association. It has moved from Hocking College to the Guernsey County Fairgrounds and is held on the first weekend of October.
- **Lumberjack World Championships:** held in Hayward, WI, in mid-July.
- **Clip idea:** real sawyers vs. players on the same tree.

---

## 4. The headline verb: the two-person crosscut saw

### 4.1 The real thing

Two sawyers work opposite ends of a long saw, the "misery whip." Sawyer lore says each person **pulls** toward themselves, then lets the partner pull it back. Pushing bends or binds the blade and wears out your partner.

In lumberjack contests, the two-person crosscut race is **Double Buck**, or **Jack & Jill** when the pair is mixed. Those are our event names.

Crosscut felling saws were the working tool of the Victorian-era woods, so the period fits.

### 4.2 The motion

- **Grip:** a **firm fist** around the phone, as if it were the saw handle, with the top pointing along the stroke.
- **Stroke:** pull toward your belly, then move forward smoothly as your partner pulls.
- **Size:** half strokes (about ±12 cm) count the same as big ones after calibration.
- **Steering:** twist your fist (§4.4).

### 4.3 The saw model: literal and coupled

**For each player i** (on their device, using their calibrated stroke axis and sign):
- **Velocity vᵢ:** band-pass (~0.3–4 Hz) and leaky-integrate the linear acceleration. In VR, use the tracked controller position directly.
- **Stroke position pᵢ ∈ [−1, +1]:**
  - Integrate vᵢ and divide by the calibrated amplitude. +1 means pulled to the belly.
  - Snap pᵢ to ±1 whenever vᵢ changes sign; this kills drift. Half strokes still reach ±1.

**The rigid blade.** A real blade forces p_A = −p_B in body frames: when A's hand is at A's belly, B's hand is fully forward.
- **Saw position s = (p_A − p_B) / 2.** This is what's drawn.
- **Blade strain e = (p_A + p_B) / 2.** This measures how much the two bodies disagree. Perfect alternation gives e = 0.
  - **e < 0 is compression.** Both hands are forward of where the saw allows. **That's a push.** The blade bows and the hum turns into a groan.
  - **e > 0 is tension.** Both players are pulling, so it's a tug-of-war, and the blade buzzes.
  - **Out of phase:** a pair that's out of phase swings between the two states every half stroke. Pushing early gives compression; pulling early gives tension.

**Blame.** The bow is drawn at the end of whichever player's hand is moving in the direction that makes |e| bigger (sign vᵢ = sign e). With the song on, a reversal that lands off the beat is also marked on that handle. Phones sense timing, not force, so an active shove and a lazy follow look the same: both just arrive early.

**Cutting.**
- **One bite per stroke:** each **completed saw stroke** (each time s reverses) bites one fixed amount of kerf, but only if |e| stayed under the **green line** drawn on the blade for the whole stroke.
- **Chatter:** strokes faster than the beat make the teeth visibly skip, and they don't bite. **Sawing faster never cuts faster.** That's the anti-waggle rule, and it means mastery never means sore arms.
- **No solo sawing:** the green line sits below 0.5, so one person sawing alone always binds. If B stands still, A's full strokes push e to ±0.5 at each end.

**Tantrum.** When the bow crosses the **red line** drawn on the blade, Old Misery throws a tantrum at once, in full view:
- the blade bucks, the wood squeals, sawdust spits, and the saw grumbles a line;
- you lose that stroke. That's the only cost; no points are taken.

**Why this model works:**
- **Literal.** A push is your hand moving forward ahead of your partner's pull, and you can see it as the bow.
- **Coupled.** Neither player can cut alone.
- **Robust.**
  - A 60 Hz signal on each player's calibrated axis is enough.
  - No phase-locked loop is needed.
  - In VR, positions are exact.
- **Skew correction.** Each device timestamps its samples on the synced clock (§6.3). The host compares p_A and p_B at the same timestamp, after subtracting each device's measured pipeline delay. Without this, 70 ms of skew between devices at 0.83 Hz adds about 0.12 of false strain. That's a quarter of the margin under the green line, and it matters most for iPhone vs. Android, and for VR vs. phone.

### 4.4 Steering cut

**Twist your fist toward where the tree should fall.**
- Each device's roll angle comes from gravity (or from the controller pose in VR), so it doesn't drift.
- The blade leans by the *average* of the two twists. If you twist the same way, the tree steers; opposite twists cancel.
- The lean and the target (the skid, not Grandma's privy) are drawn on screen.
- The pair has to talk: "twist left with me."
- Button fallback: the d-pad leans the blade.

### 4.5 The work song

The song is a **guide and a tempo**; the saw does the judging.
- **Beat strip:** a two-lane strip shows A arriving pulled on odd beats and B on even beats.
- **Tempo:** the song plays at the pair's averaged comfortable tempo (80–110 BPM).
- **Stems:** the song is authored in stems so it can change tempo, and stems layer in as the streak grows: fiddle, then concertina, then the goose choir.
- **Style:** Victorian music-hall ditties crossed with lumber-camp fiddle reels, which fits Tandemonium's vaudeville trailer voice.
- **Online:** the song stays on and helps both players lock up; the host runs the saw, as in Tandemonium (§10.4).

### 4.6 Staging (open: decide from test footage)

| Staging | Pros | Cons |
|---|---|---|
| **Side by side, facing the screen**, about 1.5 m apart | Natural for watching the TV; a camera behind the TV frames both faces | Arms pumping in alternation may read as "pistons" |
| **Face to face**, screen side-on between them | Reads instantly as sawing, and eye contact helps sync | Harder to see the screen |

The math is identical either way. **Film both in the broomstick test** (§13).

In co-located VR, the question goes away: you face each other across a real log (§11).

### 4.7 Other inputs

- **Gyro pad:** the pad's accelerometer over WebHID (DualSense, Joy-Con, Switch Pro).
  - A single Joy-Con needs its IMU-enable subcommand. It sends ~67 reports/s, with 3 IMU samples each (~200 Hz).
  - **WebHID only works in Chromium on desktop**, so gamepads are a desktop extra.
- **VR controllers:** tracked 6-DoF position, so p comes from real distance and not from integration. See §11.
- **Button path** (accessibility, Steam Deck, phones without a gyro): every slice verb has a mapping (§13.2). For the saw, press on your pull; the strain model is the same.

### 4.8 What the screen shows

- **Camera:** a side-on close shot of the trunk with the saw horizontal. A's handle is on screen-left and B's on screen-right, each tinted in that player's color.
- **Under the trunk:**
  - the blade, with its live bow and the green and red lines;
  - a cut-depth bar;
  - the steering lean arrow and the fall target;
  - the two-lane beat strip.
- **At TIMBER!:** the camera pulls wide and goes slow-mo, then a replay auto-saves.
- **Shifts mode:** uses a different camera (§9.3).

### 4.9 Audio and Temper

| State | Sound |
|---|---|
| \|e\| under the green line | Steady hum, pitch climbing with the streak |
| Compression (push) | Detuned groan |
| Tension (tug) | Buzz |
| Chatter (too fast) | Teeth skittering |
| Each bite | Wood rasp + sawdust puff |
| Tantrum | Squeal + Old Misery's grumble |
| Hatchet hit | Crisp *tok* + chip spray; double-hit = comic *clang* |

Every cue sounds the same with or without the song, so the game is playable by ear. The hum and the rasp are scheduled at the predicted beat to hide latency (§6.2).

**Temper (0–100)** = the % of this tree's saw travel spent inside the green line. Tantrums are counted separately.

Score card: **TEMPER 94 · TANTRUMS 2**.

---

## 5. The hatchet: small swings

A **small hatchet**, not a felling axe. Short, fast chops from the wrist and forearm, about a 20–40 cm arc, below shoulder height. This is the second core verb and it's in the slice.

**Motion.** Firm fist, chop down and across at a spot in front of your chest, as if notching a log at waist height.

**Sensing:**
- **Swing:** a peak in gyro magnitude. Small wrist chops reach 300–600 °/s.
- **Hit time:** when the gyro magnitude falls below ~40% of its peak after the peak, minus the calibrated offset.
- **No double hits:** a ~250 ms refractory window plus a check of the rotation sign, so the recoil doesn't count as a second hit.
- **Aim:** two faces (left and right of the notch), chosen by the swing plane. Calibrate it with "show me left, show me right."
- **Grading:** soft/good/strong, against the player's own calibration.
  - **Soft** is a glancing tap: a small chip, a smaller spray, and no notch progress.
  - **Good and strong** score the same and sound the same, so nothing rewards a big wind-up.
- **Clipping:** some Android gyros clip at ±1000 °/s. That's fine for detection.

**Uses:**

| Use | Players | What |
|---|---|---|
| ★ **Notch** | 2, alternating | Before the back cut, both chop the notch from opposite faces. **Turns alternate, and the lit face is the one that bites.** A hit on your lit face opens the notch one step and lights your partner's face. A second hit before your partner's only chips: you see it, but there's no progress. Hitting at the same moment makes a comic *clang*. You can't spam it. |
| ★ **Limbing** | 2, side by side | After the fall, the branches on your side glow one at a time, on the song's beat. One hit on the glowing branch drops it; extra hits glance off. The log can be heaved once both sides are clear. A shared finish, not a race. |
| Kindling | 3rd/4th player (Shifts) | Split small rounds into kindling for Grandma's stove. |
| Shingle riving | 1–2 (Shifts) | Tap a froe (a splitting blade) with the hatchet to split roof shingles. Precise little taps. |

**Safety specifics.** Below the shoulders, wrist and forearm only, never overhead. Recommend a firm grip or a case strap. In VR, the controller straps go on (§11.6).

---

## 6. Sensing and feel

### 6.1 Signals and devices

- **Plan for 60 Hz with jitter and gaps.** Chrome on Android fires `devicemotion` at about 60 Hz, and so does iOS Safari. Use `event.timeStamp`.
- **`acceleration` (gravity removed) needs a gyro.** Budget Androids without one return `null`, and the `accelerationIncludingGravity` fallback picks up wrist tilt (a 20° pitch leaks about 3.4 m/s²). **Phones without a gyro use the button path** unless the spike shows otherwise. The hatchet uses rotation rate, which also needs a gyro.
- **Signal size.** At 100 BPM with alternating pulls, each body cycles at 0.83 Hz. A ±12 cm stroke peaks at about 3.3 m/s², which is well above sensor noise.
- **What drives what:**
  - Steering, Heave, the wedge band and Plant use **tilt read from gravity**, which doesn't drift.
  - Knocks and hatchet hits use **spikes**.
- **Calibration** stores axis, sign, amplitude, comfortable tempo and the hatchet swing planes for each player.
- **Choose the signal from data.** The spike logs raw readings and replays different detectors offline.

### 6.2 Latency

Motion → detect (30–80 ms) → relay (~34 ms) → big-screen audio = **100–400 ms**. The audio leg alone is about 20 ms on a laptop, 50–150 ms on a TV or soundbar, and 150–300 ms over Bluetooth.

Fixes:
1. **End-to-end tap-along calibration:** the player strokes on 8–12 clicks and the game takes the median offset.
2. **Predicted sounds for rhythmic hits:** play them on the predicted beat, then correct quietly.
3. **An on-screen note:** "Use TV or laptop speakers — Bluetooth is too slow."
4. **Separate video-offset calibration**, plus a recommendation to turn on the TV's game mode.

In VR, audio is local to the headset, so this problem mostly disappears (§11).

### 6.3 Clock sync

NTP-style ping-pong over the existing Durable Object:
- take 15–20 samples and keep the lowest-RTT ones;
- re-sync every ~10 s, using `performance.timeOrigin + performance.now()`.

Expect ±5–15 ms.

### 6.4 Device housekeeping

- **Motion permission:** `DeviceMotionEvent.requestPermission()` must run on the first tap, over HTTPS. A denial persists for the session, so show how to recover.
- **Wake Lock:** works in Safari tabs since iOS 16.4 and in home-screen apps since iOS 18.4. Re-acquire it on `visibilitychange`.
- **Orientation:** iOS can't lock screen orientation, so the phone UI has to survive rotation.

### 6.5 Safety, fatigue, accessibility (non-negotiable)

People will be moving phones near TVs, lamps and friends. Nintendo faced Wii-strap lawsuits over broken TVs in 2006–2008.

- **Motion envelope:**
  - The saw stays close to the body.
  - Hatchet chops are **small, below the shoulders, wrist and forearm only**.
  - Knocks, tilts and holding still are all low-risk.
  - **No overhead swings, no throws**, and no verb that loosens your grip.
- **Coaching:** **"firm fist, smooth forward; small chops."**
- **Scoring:** nothing rewards bigger motion. Clean strokes and hits are judged by timing and strain, never by size.
- **First-run card:** clear space, a firm grip or a case strap, small motions work, play at your own risk.
- **Fatigue:**
  - Continuous sawing is capped at 60–90 s, then a non-saw verb follows (hatchet, wedge, heave, plant).
  - In Shifts, players rotate stations naturally.
- **Accessibility:** a **seated mode**, half strokes, and a first-class button path.

---

## 7. Supporting verbs

Listed in the order they ship. ★ = in the vertical slice. The hatchet verbs are in §5.

| Verb | Players | Motion (literal) | Why it's here |
|---|---|---|---|
| ★ **Pinch & Wedge** | 2, asymmetric | The saw binds mid-cut. One player **holds still** with the phone level as the wedge; the TV shows a 2° band to stay inside. The other gives **three knocks: rap the base of the phone into the free palm**. If the holder is outside the band when a knock lands, the wedge pops out. Then the roles swap. | Asymmetric roles, a forced "ready? …now," and a rest for the sawing arms |
| ★ **TIMBER!** | everyone | No input. When the cut meets the hinge, everyone just yells; the camera does the rest. | The money shot |
| ★ **Heave** | 2 (3–4 in Shifts) | Both tip their fists up like a peavey (a log-rolling lever) to roll the log onto the skid. Pitch comes from gravity. The log rises by the **smaller** tilt and rolls toward the lower side. | Literal unison with funny failures |
| ★ **Plant** | 2, unison | Point the phone down and both hold still, and the sapling grows | A 10-second breather: fell one, plant two |
| Hatchet split | 1 (Shifts) | A small downward chop, below the shoulders, onto a round on the block; read the crack | A solo station job |
| Bull of the Woods | 3–4 | One player sets the tempo with their strokes; the caller rotates each tree | A leader role |
| Springboard climb | 2 | On a giant tree: chop a slot (hatchet), the partner sets a board, both step up, repeat | Tall-tale spectacle |
| Cross-haul | 2 | Two ropes roll a log up skids; uneven pulls skew it | Coupled, literal |
| Log drive | 2 | Both stand on one floating log; balance = the sum of both tilts | Co-op cousin of birling; Tandemonium's DNA |
| Birling | 2, versus | Tilt to balance; rock to throw your opponent | Versus clips |
| Saw filing | 1 | Small wrist strokes to sharpen the teeth; sharper teeth help the next cut | Ownership of Old Misery |
| Owl! | everyone | Everyone freezes mid-stroke; any motion spooks the owl | Comic group stillness |
| Night Job | 2 | A lantern-dark screen; saw by ear | Eyes-free special |

**Parked:** the hot saw (revving by shaking is waggle).

---

## 8. Story and world (✅ Victorian geese + Grandma, signed off by Pete)

### 8.1 Premise: "Old Misery" at Grandma's

**Continuity.** Tandemonium's journey ends at **Grandma's**: "YOU BOTH MADE IT!" Timber Tandem starts on her doorstep.

**Cold open (first 30 seconds).**
1. The wobbly tandem crunches up the lane to Grandma's cottage at **Goose Hollow**, deep in the northern woods.
2. Grandma: *"Lovely to see you both. Now — the woodpile."* She lifts Old Misery off the wall. The saw grumbles awake.
3. *"It only sings for two."* Your first pull *is* the calibration.

**Cast:**
- **Sir Winston Chaos III and Lady Victoria Chaos**, the Royal House of Geese Chaos, in tweed, waistcoats, bustles and a top hat that keeps getting sawdust in it. With 3–4 players, more Chaos cousins join in.
- **Grandma**, Grandma Chaos. Sharp, warm, unhurried. She ran this timber camp for fifty years. She's your **solo partner**: she takes the far handle, pulls exactly on the beat and never pushes, so any strain is always yours. She's a patient teacher and a little smug.
- **Grandpa Chaos** has retired to the armchair by the stove. His knees are done. He heckles through the window and tells the tall tales that the tree cookies (§12) prove true.
- **Old Misery**, the saw, is the comic heart and the in-world coach. Creaky, proud, quick to throw a tantrum, quietly delighted when you lock in. *"Pull to ya… now let 'er go…"*
- **The Dam Bros. Steam Mill Co.** are a beaver syndicate with a smoke-belching Victorian steam mill, and they want to buy the whole valley.
  - *"Teeth vs. teeth."* They chew by hand and mill by steam.
  - They keep turning up at woodsmen's shows with a boiler, getting disqualified, and throwing spectacular tantrums.

**The conflict is Victorian at heart:** handcraft and partnership against steam and industry. Grandma's camp proves two geese in rhythm beat a machine.

**Fell one, plant two.** Planting is a verb. The valley visibly regrows, while the Dam Bros. clear-cut theirs. That's the meaning, without a lecture.

**Escalation:**
1. Pines.
2. Iron-banded oak, as hard as a Dam Bros. boiler.
3. A redwood "taller than the church" (springboards).
4. The finale: the **Thousand-Year Pine** behind the Dam Bros.' mill, with every verb and every player.

**Tone.** A Victorian tall tale in a northern wood: lantern light, tea on a stump, autumn color, a music-hall-meets-fiddle soundtrack. Comic, never cynical.

**Where the pun shows up:**
- Old Misery's tantrum barks ("Now I'm *cross*… cut!").
- The TEMPER / TANTRUMS score card.
- The logo's TANDEM flipping to TANTRUM during a tantrum.
- The Dam Bros. sulking.
- Grandma: *"Temper, dears."*

**Cast presentation.** Wings holding saw handles is a cartoon solve; Tandemonium's geese already grip handlebars. The goose outfits pipeline (tandemonium-claude-3d) supplies lumber-camp variants: a Victorian work apron, rolled sleeves on a waistcoat, Lady Victoria's walking skirt hitched for the woods.

---

## 9. Overcooked: what to borrow

**Pete's question: should we take inspiration from Overcooked?**

**Yes, for structure and pacing. No, for its core input.**

Overcooked's fun is running around a kitchen and ferrying ingredients between stations with a stick and buttons. A phone held as a tool can't double as a joystick. And if players spend most of a level walking, the motion verbs, our whole identity, get thin. So we borrow the frame Overcooked puts around its verbs, and we keep our verbs.

### 9.1 Borrow

| Overcooked does | Timber Tandem version |
|---|---|
| Short levels (~3–5 min) with **1–3 stars** | **Shifts** of ~3–4 min, rated 1–3 stars on orders filled and Temper |
| An **order ticket queue** with visible timers | **Grandma's order board**: tickets like "6 split logs, 2 planks, a bundle of kindling." **Each ticket has its own kettle** that visibly heats up. The Shift ends when **Grandma's mantel clock**, on screen the whole time, strikes. Every timer is visible and literal. |
| A **station chain**: chop → cook → plate → serve | **Fell → buck (saw) → split (hatchet) → stack or load the wagon (heave)**. Wood flows along a chain, and bottlenecks force players to swap roles. |
| **Every level has a gimmick** that changes the layout | River camp (stations drift apart on rafts), windstorm (trees sway and timing shifts), ice camp (the log slides), the Dam Bros.' mill (a conveyor and steam bursts), a logging railway (stations on moving flatcars), night shift (lanterns) |
| A **world map** of levels | A map of the valley that **regrows** as you clear Shifts |
| **Shouting is the fun** | Built in already: "twist left with me," "ready — knock!" |
| Couch 1–4, and online later | Couch 1–4 and online Shifts (§10.6) |
| Readable, toy-like art | Same, with chunky Victorian geese |

### 9.2 Don't borrow

| Overcooked does | Why not |
|---|---|
| Free stick movement and item carrying | Phones are tools, not sticks. See §9.3. |
| Brutally tight timers and fail states | Overcooked is famous for real household arguments. Our pun makes tantrums funny, so we **fail funny**: a missed order makes Grandma tut and the kettle boil over. The shift continues, and no one is singled out on the results screen. |
| Blame-heavy results | Strain blame shows only live on the blade. Results credit the crew, never an individual. |

### 9.3 Moving between stations ("station hop")

- **Phone:** stations sit in a ring around the clearing.
  - **Touch is ignored while you're working a station**, because a fist grip covers the screen.
  - **To hop**, turn the phone face-up toward you. The game reads this from gravity, and on the TV your goose looks up. Two big arrows appear on the phone; tap one and your goose waddles to the next station.
  - Turn the phone back into your grip and it's a tool again. The mode switch is your pose, so it's literal, visible, and needs no timer.
- **Gamepad:** the left stick moves, and the gyro is the tool. This is Overcooked's grammar, so an Overcooked family can pick up pads and play.
- **VR:** the stations are around you, so you turn your body. A short teleport is optional (§11).
- **Camera:** a wide 3/4 view of the camp. TIMBER! still cuts to the cinematic.
- **Blade widget:** each active two-person station gets a fixed 2D blade widget in a screen corner, laid out exactly as in §4.8 (A left, B right, green and red lines) whatever the world angle, so blame always reads the same way. It stays readable at 720p.
- **Two-person stations** (the saw, the wedge, heave) only start when two geese are there. That's the interdependence point, and the reason to yell "I need you on the saw!"

### 9.4 Where Shifts fit

- The **vertical slice** stays pure Old Misery, the coupled saw (§13.2). If the core verb isn't fun, Shifts can't save it.
- **With 2 players**, the solo stations (split, kindling, shingles) are where you split up. Design every Shift so a lone player always has a solo job, or two-player Shifts collapse into "always together."
- **Shifts are the campaign structure and the 3–4 player mode** after the slice. They're the answer to retention (§12) and to "what do players 3 and 4 do."
- **Test them cheaply first:** one gray-box Shift (fell → buck → split → stack, one gimmick) played by Pete's family, the Overcooked fans. That's the right panel for this test.

---

## 10. Multiplayer without a headset: local and online

**Pete's ask:** multiplayer that needs no VR headset, both in one room and online.

**Tandemonium already does this in production.** The captain and stoker can be in different homes, answering each other's pedal beats on one shared crank. Two sawyers alternating on one saw is the same shape: two people, one shared object, alternating on a beat. So Timber Tandem **copies Tandemonium's online model** instead of inventing a new one, and online play is in from the first toy.

### 10.1 Where the pieces come from: the controller lab

**The controller lab (`tandemonium-controller-lab`) is the home** for controllers, and more and more for the room and join logic too. Timber Tandem is a **customer of the lab, not a second copy of Tandemonium.** Anything shared lands in the lab first. Tandemonium is where the online model was proven.

| Piece | Home | Timber Tandem use |
|---|---|---|
| Player slots, claim and reconnect | Lab `@usersfirst/controller-core` (`manager.js`) | Saw handles A/B and Shift seats |
| Device identity, controller inventory | Lab `controller-core` (`device-identity.js`, `controller-inventory.js`) | Rejoining the same seat after a drop-out |
| Drift-free roll from gravity | Lab `controller-core` (`gravity-roll.js`) | Steering twist (§4.4), Heave and the wedge band |
| Gyro pads over WebHID | Lab `controller-core` drivers | The pad path (§4.7) |
| Lobby, seats, screen flow | Lab `@usersfirst/ui` (`uf-flow`, `uf-step`, `uf-seat`, `uf-button`), plus the seat-select navigator | Lobby, seat select, Room step |
| Rooms, join by code and QR, peer-to-peer with relay fallback, fast lane and jitter buffer | `RoomTransport` (the `@usersfirst/room` seam, #318, #390), **moving from Tandemonium into the lab** | Online duo, crew vs. crew, online Shifts |
| One host simulation | Tandemonium's captain/stoker model (`SharedPedalController`) | The host runs the saw; the partner sends strokes |
| Timing tolerance | Tandemonium's 250 ms beat window | Green line and stroke timing tuned the same way, from play |
| Sync pings (SPRINT plus four emotes) | Tandemonium | SPRINT becomes *"Together — pull!"*; the emotes stay |
| **Phone as controller** | Tandemonium phone remote (#421), **going into the lab** as a package with game plugins (§10.7) | Every player's phone |
| Couch versus split screen | Tandemonium (#351, TeamRig) | Couch versus |

**No in-game video or audio calls.** Pete is taking them out of Tandemonium as overkill. Players who want to talk use their own call (Discord, FaceTime, a phone call). In the same room, they just talk. Sync pings cover "now, together" without a call.

**Timber Tandem's own new work:** the saw codec, the Timber phone plugin (§10.7), a second-tree race view and ghost recordings (§10.5).

### 10.2 Modes

| Mode | Where | Players | What crosses the network |
|---|---|---|---|
| ★ **L1 Couch co-op** | One room, one screen | 2 on the saw; 3–4 in Shifts | Phones → screen |
| ★ **O1 Online duo** | Two homes, one player each | 2 | Stroke samples in, saw state out (Tandemonium's captain and stoker model) |
| **L2 Couch versus** | One room, split screen | 2v2 crews, or 1v1 with each player sawing alongside their own Grandma | Phones → screen |
| **A1 Ghost race (async versus)** | Anywhere, any time | A crew vs. a recorded crew | A replay file |
| **O2 Online crew vs. crew** | Two homes | 2 per home | Race progress only |
| **O3 Online Shifts** | 2–4 homes, best as 2 + 2 | 3–4 | Shift state from the host; stroke samples at two-person stations |

**Build order:** L1 and O1 together, because the toy runs on `RoomTransport` (from the lab once it moves) from the start, just as Tandemonium does. Then L2, A1 and O2, then O3. A couch pair plus a remote cousin is just O3.

### 10.3 Local play

- **Seats.** Handle color = seat. Join order sets A (screen-left) and B (screen-right), and players can swap in the lobby. Reuse the controller-lab seat-select navigator.
- **Mixed devices.** A phone and a pad can share one saw: after calibration both give p on the same scale (§4.3).
- **Co-op needs no split screen,** because the crew works one tree. Split screen is only for versus (L2).
- **Drop-outs.** If a phone locks or switches tabs, that handle goes slack. Old Misery says *"Hold up…"* and the duo pauses. Reopening the tab rejoins the same seat (by `device_id`). In Shifts, the dropped goose sits on a stump and the Shift carries on.
- **Spectators** are just the room. Clips and replays are made for them (§3.1).

### 10.4 Online duo (O1)

- **The host runs the saw.** The room creator's screen runs the saw model, like Tandemonium's captain. The partner's device sends stroke samples on the fast lane with `sendTime`, and the host jitter-buffers them. Both screens draw the saw state the host sends out.
- **Tolerance absorbs the delay,** as Tandemonium's beat window does. The green line and the stroke rules are tuned in the online toy with real home-to-home pairs, not from theory.
- **If the host's player gets an edge** from having no delay, the fix is already in the plan: the partner's samples carry timestamps on the synced clock (§6.3), so the host can compare both players at the same moment (the skew rule in §4.3). Use it only if play shows it's needed.
- **The song helps both players lock up,** in the room and online. It's on by default, but nothing depends on it, because Tandemonium online works on feel.
- **Disconnects** use Tandemonium's reconnect and backoff. Old Misery waits (*"Hold up…"*).

**The other verbs online:**

| Verb | Online rule |
|---|---|
| Steering | The host averages both twists |
| Pinch & Wedge | The holder's band is checked at the knock's timestamp, so a late packet can't pop the wedge |
| Hatchet notch | Turn-based; latency only delays the face lighting up by one trip |
| Limbing | Each player has their own side, so hits feel local |
| Heave | The smaller tilt (§7) |
| Plant | Both hold still; nothing is time-critical |
| TIMBER! | Everyone yells; online, over their own call if they have one |

### 10.5 Ghost races (A1, async versus) and crew vs. crew (O2)

- **Ghost race** (Pete likes this as async versus). On Giant of the Day (§12), every crew gets the same tree. The game records each crew's cut-depth timeline, and a later crew races that crew's ghost on a second trunk beside theirs. There's no live connection, so it works on bad Wi-Fi, across time zones, or against your own best. Friends' and family crews' ghosts come first.
- **Crew vs. crew online.** Each crew's saw runs on its own screen. Only progress crosses the network: cut depth about 10 times a second, plus tantrums and TIMBER. The other crew's tree stands across the clearing (the Double Buck race), or it's the Dam Bros.' lane. Both crews start from a shared countdown, and finish times are compared on the synced clock.

### 10.6 Online Shifts (O3)

- The host runs the order board, kettles and mantel clock. Every screen renders the same camp from the same 3/4 camera, with your own goose highlighted.
- Two-person stations with a remote partner use the online duo rules.
- **Sweet spot: 2 + 2 across two homes**, so each home can pair up at a station while the other home covers the rest of the chain.
- **Joining mid-Shift:** a cousin walks in from the woodshed. **Dropping:** the goose sits on a stump.

### 10.7 Phone as controller: a lab package with game plugins

**Pete's direction:** move phone-as-controller into the controller lab, with a plugin architecture for how each game uses it. Pete owns that design. It sits inside the current Tandemonium UI review, which is also upgrading the lab's controller UI components. **This section only lists what Timber Tandem will ask of it,** as input to that design.

**A possible split** (for Pete's design, not decided):
- **Lab package (shared by every game):** pairing by QR and room code; the phone's join, seat and reconnect lifecycle on `controller-core` slots; motion permission (iOS `requestPermission`), Wake Lock, the in-app-browser check, audio session; streaming 60 Hz motion with timestamps on the fast lane; clock sync; per-phone calibration storage (roulette's `MotionProfile`); the haptics helper; the phone shell built from `@usersfirst/ui`.
- **Game plugin (one per game):** what the phone does *during play*. For Timber Tandem: stroke and chop detection on the phone (or raw samples to the screen), the calibration steps ("show me a pull, show me a chop"), the face-up station-hop arrows, the touch fallback (§13.2), and the phone's screen while it's a tool (dark, with one big seat color).
- **Tandemonium's plugin** would be the pedal and lean remote it already has.

**What Timber Tandem needs that Tandemonium's remote doesn't do yet:**
1. **A second phone joining the same screen**, and up to 4 for Shifts, each claiming its own seat. This is the part Pete hasn't designed yet, and Timber needs it from the first toy.
2. **Phones in an online room.** Each home's phones pair to *their own* screen, and the screens share the room.
3. **Raw motion streaming** with timestamps at 60 Hz, not just button-like events, so the saw can be judged on the screen or the host.
4. **Calibration that persists** per phone and per player.
5. **Pose-switched UI:** the phone is a tool while gripped, and shows touch arrows only when turned face-up (§9.3).
6. **Mixed seats:** a phone and a gyro pad on the same saw, through the same slot model.

**Where the lab is now** (lab PR #125, step 1 of the TV components plan, #124, `docs/UI-KIT-TV-COMPONENTS.md`):
- **Fits Timber Tandem as is:**
  - `controllerRoster()` gives every controller one row, with states `connected → joined → seated → ready`. That's the lobby flow for 2–4 sawyers.
  - The app supplies seats through `seatOf`, so Timber can define its own.
  - `shortName`, glyph family and `connection` label each player's device in the Shifts lobby.
- **Gaps to raise when phones come in:**
  1. **Phones aren't in the roster yet** (row kinds are `slot | pool | pad | keyboard`). Pete: the phone might **replace** a controller or **augment** one, and it could be either.
     - **Replace:** the phone is the seat's only input. This is Timber Tandem's main case, because a fist around the phone leaves no hand for a pad.
     - **Augment:** the phone adds motion to a pad without a gyro, a private second screen, or touch for typing codes. That's mostly Tandemonium's case.
     - **A shape for both** (input to Pete's design): the phone is a roster row with the same states, plus `attachedTo: slotId | null`. `null` = replace; a slot id = augment. Games ask a seat for **capabilities** (motion, buttons, touch, screen), not devices. Timber's saw asks for "this seat's motion source" and gets a pad gyro or a phone the same way.
  2. **Seat `role` is typed `'captain' | 'stoker'`** in core. Timber Tandem needs saw handles A/B and Shift seats, so `role` would be better as a string the game defines.
  3. **The TV components doc** still lists "room / relay / phone-remote logic" under "stays in Tandemonium." That conflicts with moving the phone controller and room/join logic into the lab, and the doc should be updated when that move is designed.

**How Timber Tandem keeps moving meanwhile.** Nothing waits on the lab. The phone sensing spike (§13.1) uses a throwaway `/spike` page. Its pairing and seat code is written to be thrown away, and its detection code is written as the first draft of the Timber plugin. When the lab package lands, the toy swaps the throwaway pairing for it. The spike's results (sample rates, permissions, multi-phone join pain) go back to the lab design as evidence.

---

## 11. VR design

### 11.1 Why VR fits this game unusually well

- **Sensing becomes simple.** Controllers are tracked in 6-DoF, so the hatchet hits a real place in space with no integration or drift.
  - p = hand displacement along the saw axis ÷ a fixed handle travel of ±20 cm.
  - That puts VR and phone p on the same scale for cross-play.
- **Feel gets better.** Each bite and each chatter is a controller haptic pulse right in your hand. Audio is local to the headset, so the TV/Bluetooth latency problem goes away.
- **Staging is solved.** You face your partner across a real log.
- **Grandma is life-size.** In solo VR she's a full-size Victorian goose on the far handle, pulling with you. That's the strongest emotional moment the format offers.

### 11.2 Platform

Quest, through **Quest Browser + WebXR, built on IWSDK**. It's the same stack as SandQuest and Tandemonium's `/vr/` app, which gives us patterns for grabbing, hands, controllers, the emulator and the relay. It's web-only, because Electron/Steam has no WebXR. Quest is the target first; other WebXR headsets are a bonus.

### 11.3 VR modes (in priority order)

| Mode | Players | Description | Why |
|---|---|---|---|
| **VR-1 Solo with Grandma** | 1 | You hold your handle, Grandma holds hers. Saw, hatchet notch, wedge (Grandma knocks while you hold still), TIMBER!, plant. | Cheapest: no networking. The best showcase and the onboarding. |
| **VR-2 Cross-play: headset + phone** | 2–4 | The VR player takes one handle and a phone player the other, while the TV shows the shared scene to the room. Same relay, same strain model. The headset plays the song delayed by the TV's calibrated offset, so everyone in the room hears one beat. Scoring runs in song time. | Most homes have **one** headset. This turns the headset owner's party trick into a party game. |
| **VR-3 Co-located mixed reality** | 2 headsets, one room | Passthrough: a virtual log lies on your real floor between you, and you physically face each other on the saw. | The purest form of the fantasy |
| **VR-4 Remote VR** | 2 headsets, two homes | Same as VR-3, online, using the online duo rules (§10.4) | Long-distance pairs (the Tandemonium persona) |

### 11.4 Input in VR

- **Controllers by default:** haptics, solid tracking during fast hatchet swings, and a wrist strap.
- **Haptics:** `gamepad.hapticActuators[0].pulse()`, feature-detected.
- **Hand tracking is optional**, for the saw and planting only.
  - It loses track in fast swings and has no haptics. Use SandQuest's four-finger-curl grab detection.
  - Quest WebXR can't track hands and controllers at the same time, so switching modes means a menu toggle.
  - Hands-only play covers the saw and planting only.
- **The saw handle snaps** into your grip. p comes from your hand's position along the saw axis.
- **No physical resistance, and no ghost hand.**
  - Each handle stays locked to its owner's real controller. The blade between them **bends** to take up e, and that bend *is* the strain readout.
  - The cut advances with s.
  - Hands never separate from their handles, which avoids the hand-position mismatch that feels wrong in VR. A resistance buzz plays while you're past the green line.
- **Hatchet:** a real swing with a real hit point on the notch face. Same safety envelope: small swings, below the shoulders (§11.6).

### 11.5 Aligning two headsets (VR-3)

Use **"fist-bump calibration."** Both players touch their controllers together at two points, one at each end of where the log will lie, at least 1.5 m apart.

- **Why two points are enough:** both headsets' `local-floor` spaces already share gravity. That leaves yaw plus 3-D translation (4 degrees of freedom), and two points solve it. A 2 cm touch error gives about 1° of yaw.
- **Capturing a point:** each headset records its controller tip at the moment both triggers are held still together. The samples are matched on the synced clock.
- **Keeping it aligned:** re-bump on the reference space's `reset` event (recentering or tracking loss).
- **No anchors:** WebXR has no shared spatial anchors today, so don't plan on them.

The two saw handles then sit exactly between the two real people.

### 11.6 Comfort and safety

- **Stationary play.** No artificial locomotion in the core. In Shifts, stations surround you, and you turn or take one optional short teleport.
- **Seated mode.** Plus a "standing area check" before swinging.
- **Swing envelope:** the hatchet below shoulder height, on the guardian-aware side, and controller straps on.
- **Shared space (VR-3):**
  - `immersive-ar` gives compositor passthrough with no camera access needed.
  - Never draw opaque geometry between the players. Use WebXR depth-sensing occlusion where Quest Browser exposes it.
  - Players stand on marked spots at least 1.8 m apart, and strokes never cross the midpoint.
  - Trees always fall *away* from both players.

### 11.7 VR scope

- **VR-1 is the cheapest meaningful slice:** one player, local, and it reuses the saw model.
- **It can run in parallel with the phone spike.** It shares the saw code; only the input adapter differs.
- **VR-2 reuses the phone relay.**
- **VR-3/4 come after the flat demo proves the fun.**

---

## 12. Octalysis lens and retention

**What Octalysis is.** A framework of eight core drives that make people want to play. We use it to find weak spots, and each drive must be delivered by a mechanic.

**White hat vs. black hat.**
- **White-hat drives** feel good: meaning, accomplishment, creativity.
- **Black-hat drives** (scarcity, unpredictability, loss) are used only *inside* a Shift or job, for tension. Never as streaks or fear of missing out.

| Core drive | Mechanic | Strength |
|---|---|---|
| 1. Epic meaning | Fill Grandma's woodpile; save Goose Hollow from the steam mill; regrow the valley | Medium-High |
| 2. Accomplishment | Temper, unbroken streaks, clean drops, Shift stars, crew ranks | **High** |
| 3. Creativity & feedback | Steering cut; the camp built from your own logs (crooked cuts, crooked porch) | Medium-High |
| 4. Ownership | Old Misery's handle carved with your crew's name; the tree-cookie wall; sharpening and re-tempering; goose outfits | Medium |
| 5. Social influence | The coupled saw itself; crew history; spectators; cross-play with the headset owner | **Highest** |
| 6. Scarcity | **Giant of the Day:** the same tree for every crew, one try per night | Low, on purpose |
| 7. Unpredictability | **Tree cookies:** each felled tree drops a cross-section whose rings tell one of Grandpa's tall tales ("1906: scorched, the year Grandpa outran the fire"). Some hold a horseshoe, an arrowhead, or a love letter from Grandma to Grandpa. | Medium |
| 8. Loss avoidance | Binding, tantrums, the wedge popping out, the kettle boiling over. All in-job, all comic. | Low, in-job only |

**Why a second night?**
1. **Mastery is Temper, not speed.** Faster strokes chatter (§4.3). Harder wood makes you adapt.
2. **Shifts:** stars to earn, a new gimmick in each level, a map that regrows. Overcooked's proven pull.
3. **The camp is the pair's shared creation,** built from *your* logs.
4. **Solo feeds duo.** Solo with Grandma (flat or VR) earns repair parts that only *install* in a duo job.
5. **Crew ghost** on Giant of the Day.
6. **Show Circuit** (versus) for groups. **Double Buck:** two crews race, or two players race the Dam Bros. **Heave Relay**, **Birling**.
7. **The tree-cookie wall** fills up.

---

## 13. Plan of work (gates, not dates)

**House Tandem is moving fast on all fronts, so this plan sets no calendar.** Each step starts as soon as someone is free. Each step only depends on its gate. **Tracks can run in parallel.**

```
Broomstick test ─┐
Clip test ───────┴─► Phone sensing spike ─► Toy ─┬─► Vertical slice ─► Shift test ─► Demo
                     (online duo from day one)   │                                   ▲
                                                 └─► Online step (ghosts, crew vs. crew) ┤
VR-1 spike (any time, in parallel) ──────────────────────────────────────────────────┘
```

**Online is tested early:** the toy runs on `RoomTransport` from the start, so online duo is tested at the same time as couch co-op.

The saw model is one pure module, shared by phone, pad and VR. Whichever track gets there first writes it.

| Step | Size | What | Gate |
|---|---|---|---|
| **A. Broomstick test** | 1 evening | Two people, a broom handle as the saw, pull-only, a work song on a speaker. Then without the stick (air sawing), plus a few small hatchet chops in the air. Try both stagings. | Pass: 5 min stays fun; air sawing still feels like *together*; one staging wins. Fail: park the game. |
| **B. Clip test** | ≤2 days | A throwaway page with two phones, a saw bar, a hum that rises with sync and a TIMBER sound. Film 5–8 real pairs (family, COGG, GDG Columbus). Post 3 clips on the same accounts as the Tandemonium clips. Cheapest version: air sawing with the sound added in editing. | Saw clips beat the median for Tandemonium clips; comments ask "where can I play?" The footage feeds House Tandem's channels either way. |
| **C. Phone sensing spike** | ~2 weeks | §13.1 | §13.1 thresholds |
| **V. VR-1 spike** | ~1–2 weeks, in parallel | Grandma on the far handle in IWSDK, saw and hatchet notch, controller haptics, run in the emulator, then on Quest | 5 testers: ≥4 say sawing with Grandma "felt like sawing"; ≥72 fps on the lowest-end target headset (Quest 2/3S), measured with OVR Metrics Tool |
| **D. Toy** | ~2 weeks | Saw + strain + steering + hatchet notch + TIMBER on a gray-box tree; one song. Couch co-op **and online duo** over `RoomTransport` (§10) | Players ask for "one more tree" unprompted, including at least 3 remote pairs in two homes |
| **E. Vertical slice** | ~6–8 weeks | §13.2 | 3 playtests (§13.3) |
| **F. Shift test** | ~2 weeks | One gray-box Shift (fell → buck → split → stack, one gimmick), 3–4 players, played by Pete's family | They ask for the next Shift; 2 stars or more on a second try |
| **O. Online step** | ~1–2 weeks, in parallel with the slice | Ghost races on Giant of the Day (A1) and online crew vs. crew (O2) (§10.5) | Two crews finish a race with matching results; players race a ghost twice in a row |
| **G. Demo** | ~8 weeks | Shifts ×3, Show Circuit ×3 events, camp v0, solo with Grandma (flat + VR-1), couch versus (L2), online duo (O1), ghost races (A1) and online crew vs. crew (O2), VR-2 cross-play | Steam decision from wishlists or sign-ups |

### 13.1 Phone sensing spike

**Build:**
1. **Phone `/spike` page.**
   - Runs clock sync.
   - Logs raw `acceleration`, `accelerationIncludingGravity`, `rotationRate`, orientation and `timeStamp`.
   - Sends 50 ms batches through the Durable Object relay.
   - Runs the on-device detector alongside, so it can be compared with the offline results.
2. **TV page.** A click track and the song through Web Audio, tap-along calibration, a live s/e saw bar with hum and strain audio, and hatchet-hit sounds. Everything is recorded to JSON.
3. **Offline notebook.** Replays the logs through detector variants, so the choice of signal comes from data.
4. **Ground truth.** 240 fps video with a TV flash for alignment, plus a phone-mic recording for audio latency.

**Pass thresholds:**

| Metric | Pass |
|---|---|
| Sample rate / jitter per device | median ≥ 55 Hz; p95 interval ≤ 35 ms; gaps > 100 ms ≤ 1/min |
| `acceleration` non-null | Reported per device; a rule for budget Android decided |
| Stroke reversals: full and half strokes, 0.6–1.2 Hz, 3 grips, both hands | Recall and precision ≥ 95% |
| Reversal timing vs. video | SD ≤ 25 ms; detection latency ≤ 80 ms |
| Clock-sync error between two phones | p95 ≤ 15 ms |
| Tap-along calibration repeatability (TV, soundbar, laptop, BT) | SD ≤ 15 ms |
| Motion → feedback sound, with prediction | ≤ 120 ms on TV/laptop speakers |
| First-time pairs "in sync" within 60 s (8 straight strokes under the green line) | **≥ 8/10 passes; 5–7 means one redesign round; under 5, kill.** Also run once without the song. |
| Scripted push trials | Hit rate ≥ 90%; false positives ≤ 10% |
| Small hatchet chops: detection / face classification / no double hits | ≥ 95% / ≥ 90% / ≥ 98% |
| Knocks while the holder stays still | ≥ 95% |
| Fatigue: 3 × 90 s saw sessions | Perceived exertion ≤ 5/10 |

**Devices:**
- **iPhones:** an SE 2/11-era model and a 15/16 (Safari).
- **Androids:** a Pixel 7/8, a Galaxy A-series and a budget model without a gyro (Chrome).
- **Pads:** a DualSense and a Joy-Con on desktop Chrome.
- **Display and audio:** a laptop to an HDMI TV (game mode on and off), Google TV, a soundbar over ARC, and a Bluetooth speaker.

**Kill rule.** If pairs can't sync with the song on, the phone verb is dead. VR-1 could still stand alone as a smaller VR game, but that's a separate decision for Pete.

### 13.2 Vertical slice

**Goal:** prove the loop is fun for two strangers and that they want another tree.

**Content:**
- **Where:** the Goose Hollow clearing behind Grandma's cottage.
- **Trees:** a small pine, then a big one.
- **Verbs:** hatchet notch, saw with steering, Pinch & Wedge, TIMBER!, limbing, Heave, Plant.
- **Music:** one work song in stems (80–110 BPM).
- **Voice:** Old Misery has about 10 lines plus tantrum barks; Grandma has about 8.
- **Cast:** Sir Winston and Lady Victoria. Two players; phones first, with gamepads and buttons also supported.

**Non-motion mappings** (gamepad without motion, and phones without a gyro):

| Verb | Gamepad | Phone touch |
|---|---|---|
| Saw | Press on your pull | Tap on your pull |
| Steer | D-pad | Drag left/right |
| Hatchet | Press on your turn (your face is lit); the d-pad picks the face | Tap the left/right half on your turn |
| Wedge | Hold A steady (letting go = wobble) | Keep your thumb down |
| Knock | Press | Tap |
| Heave | Analog trigger depth | Drag up (how far = how high) |
| Plant | Hold both shoulder buttons | Two thumbs down |
| Limbing | Press on the glowing branch | Tap on the glowing branch |

**The loop (~11 min):**

| Step | Time |
|---|---|
| 1. Pair phones by QR | ≤60 s |
| 2. Permission tap, safety card, 8-click tap-along | 40 s |
| 3. Cold open at Grandma's (§8.1) | 30 s |
| 4. "Show me a pull, show me a chop." Calibration *is* the first strokes on the small pine. | 30 s |
| 5. Hatchet notch, alternating | 30 s |
| 6. Back cut in rhythm, steering toward the skid | 60–90 s |
| 7. Saw binds → Pinch & Wedge, roles swap | 45 s |
| 8. Finish → **TIMBER!** with slow-mo and replay | 20 s |
| 9. Limbing (shared finish) | 30 s |
| 10. Heave onto the skid | 20 s |
| 11. Plant two saplings | 15 s |
| 12. Big pine: steps 5–11 again, with a longer cut and a harder steer | ~4 min |
| 13. Score card (TEMPER · TANTRUMS · landing accuracy), clip saved; Grandma: *"Temper, dears."* | — |
| 14. Crew name entered last; page reloads before the next run | — |

**Out of the slice:** hatchet split, Shifts, 3–4 players, campaign, camp, versus, Discord, cosmetics, accounts. Online is its own parallel step (O), and so is VR-1. The slice is couch co-op (L1).

### 13.3 Playtest questions

**Watch first, then ask three questions:**
1. What was that like?
2. When did you feel in sync?
3. Would you do another tree right now?

**Measure:**
- time to first lock;
- tantrums per tree;
- an unprompted "again?";
- spectators laughing;
- phones out filming.

A wishlist or sign-up request is the measure of interest.

---

## 14. Business model

- **Web and Discord earn about nothing.** Discord bans ads in Activities, and web ads pay about 0.45¢ a session.
- **Timber Tandem is a House Tandem brand extension and a clip engine first.** It shares the geese, Grandma and the audience with Tandemonium, so the clips build on each other. Until it's proven, it's a free web toy with a wishlist CTA.
- **Steam only if the demo earns it.** That needs gamepad play plus joining by phone.
- **VR is a separate opportunity.** Quest Browser is free to ship; a store listing comes later. Meta's VR developer programs, where SandQuest already has a toe in, are a possible channel.
- **Data:** reuse Tandemonium's D1 `device_id`. No accounts in the slice.

---

## 15. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Air sawing isn't fun past 90 s | Medium | Broomstick test first; rotate verbs every 60–90 s |
| Parallel projects thin out attention | Medium | Small, gated steps; reuse existing code; any step can pause at its gate |
| Phone sensing too noisy across devices | Medium | Spike thresholds; no-gyro phones use buttons; signal chosen from data |
| The saw is less forgiving of delay than Tandemonium's pedal beats | Low–Medium | Same host-authority model and tolerance tuning as Tandemonium; compare at matched timestamps if needed (§10.4); online duo is in the toy, so we find out early |
| Bad home Wi-Fi or long distance | Medium | Tandemonium's reconnect and ping display; ghost races need no live connection |
| Feedback latency (TV/BT audio) | High | Tap-along calibration, predicted sounds, a "no Bluetooth" prompt; VR avoids it |
| Phones thrown, TVs broken | Medium | Small chops below the shoulders, no overhead, firm-grip coaching, no amplitude reward, a first-run card |
| VR swing collisions | Medium | Guardian-aware swing envelope, straps, a seated mode, passthrough partner |
| Shifts turn into Overcooked-style real arguments | Medium | Fail funny, crew-only results, kettle-not-cliff timers |
| Fatigue / accessibility | Medium | Caps, no speed reward, seated mode, half strokes, button path |
| "Phones as tools" is crowded | High | Position on the coupled saw and the geese |
| Novelty wears off | High | Temper, Shifts, the camp, solo feeding duo, Show Circuit |
| Trademark ("Timbersports") | Low if followed | Use "woodsmen's show" and event names only |
| WebHID reach | Certain | Gamepads are a desktop extra |
| WebXR on Quest only (no Steam VR via Electron) | Certain | Ship VR on the web; revisit native later |

---

## 16. Overcooked answer

See §9. In short: borrow the structure, keep our verbs. Prove the coupled saw first, then test one Shift with Pete's family.

---

## 17. Decisions for Pete

✅ = Pete decided. The rest are recommendations.

| # | Decision | Status / Recommendation |
|---|---|---|
| D1 | Name: *Timber Tandem* (temper-tantrum pun) | ✅ |
| D2 | Cast: Victorian geese (Sir Winston, Lady Victoria, Chaos cousins) | ✅ |
| D3 | Continue from Tandemonium's Grandma | ✅ |
| D4 | Small hatchet swings are allowed (below the shoulders). Putting them in the slice is part of D13. | ✅ |
| D5 | No dates; gated steps, parallel tracks, tests start now | ✅ |
| D6 | Premise: Old Misery, Grandpa by the stove (new canon: check it against Tandemonium's Grandma's), the Dam Bros. Steam Mill Co. | Recommended |
| D7 | Headline verb: two-person crosscut, pull-only, rigid-saw model | Recommended |
| D8 | Cut rule: one bite per clean stroke; fast strokes chatter | Recommended |
| D9 | Push: visible bow, tantrum past the red line, costs a stroke | Recommended |
| D10 | Steering by fist twist | Recommended |
| D11 | Staging: decide from the broomstick-test footage | Recommended |
| D12 | Song: guide and tempo; the saw judges | Recommended |
| D13 | Slice verbs: hatchet notch, saw, Pinch & Wedge, TIMBER!, limbing, Heave, Plant | Recommended |
| D14 | Overcooked-style Shifts as the campaign and 3–4 player mode, after the slice | Recommended |
| D15 | Station hop: thumb tap halves on the phone, stick on a pad, body turn in VR | Recommended |
| D16 | Fail-funny Shifts (kettle boils over, the shift continues; crew-only results) | Recommended |
| D17 | VR: Quest/WebXR/IWSDK; VR-1 solo with Grandma first, in parallel; VR-2 headset + phone cross-play next | Recommended |
| D18 | VR input: controllers by default, hand tracking optional for saw and plant | Recommended |
| D19 | Solo partner: Grandma (flat and VR) | Recommended |
| D20 | Skill stat: **Temper** 0–100 + tantrums | Recommended |
| D21 | Engine: three.js; IWSDK (super-three) for VR, sharing the saw model | Recommended |
| D22 | Headset-free multiplayer: couch co-op and online duo first, then couch versus, ghost races, online crew vs. crew, online Shifts (§10) | Recommended |
| D23 | Online model: copy Tandemonium (`RoomTransport`, peer-to-peer with relay fallback, one host simulation like the captain's) | Recommended |
| D24 | Online duo is in the toy from day one, tuned with real remote pairs | Recommended |
| D25 | Ghost races on Giant of the Day as async versus | ✅ Pete likes it |
| D26 | No in-game video or audio. Sync pings in game; players use their own call (Discord, FaceTime, phone) | Following Pete's call to remove calls from Tandemonium |
| D27 | Shared pieces (controllers, slots, rooms and join, phone as controller) come from the controller lab. Timber Tandem adds only a game plugin and its own codec | Recommended; the lab's phone package design is Pete's (§10.7) |

---

## 18. Glossary

- **Kerf:** the slot a saw cuts.
- **Notch / back cut / hinge:** how a tree is felled. The notch goes on the side it should fall toward, the back cut comes from behind, and the hinge left between them steers the fall.
- **Bucking:** cutting a felled tree into lengths.
- **Limbing:** trimming the branches off a felled tree.
- **Peavey:** a log-rolling lever.
- **Froe:** a blade for splitting shingles.
- **Birling:** log rolling.
- **Misery whip:** a two-person crosscut saw.
- **Bull of the Woods:** the camp boss.
- **s / e:** saw position and blade strain (§4.3).
- **Green line / red line:** the strain limits drawn on the blade. Below the green line the saw cuts; past the red line, it throws a tantrum.
- **Temper:** the crew's smoothness score.
- **Shift:** an Overcooked-style order level (§9).
- **Station hop:** moving between stations in a Shift.
- **Host:** the screen that runs the one copy of the saw (Tandemonium's captain role). Partners send their strokes to it.
- **L1/L2, O1–O3, A1:** the headset-free multiplayer modes (§10.2).
- **Ghost race:** racing a recording of another crew on the same tree (async versus).

---

## 19. Revision history

**v1 (2026-10-20):** first draft.

**v2 (2026-10-20):** three specialist reviews.
- **Design:** the saw became one shared object instead of two parallel rhythm games. Added the steering cut, the wedge, Heave and Plant. Mastery became smoothness, and Octalysis got real mechanics.
- **Sensing:** the rigid-saw strain model replaced "push = phase lead," which was physically meaningless. The PLL was dropped, the 60 Hz web rates corrected, and the latency budget and calibration added.
- **Market and scope:** a test-first plan, factual fixes, the trademark issue, the competitor landscape and an honest business model.
- **Pete:** the temper-tantrum pun became the game's tone and its skill stat.

**v3 (2026-10-20):** cold final review.
- **Saw:** waggling no longer pays (one bite per stroke, plus chatter). Steering became a fist twist, because normalized strokes can't carry "longer pulls." A blame rule was added, and solo sawing now binds.
- **Verbs:** palm knocks replaced the sledge swing. Tilt-based Heave and Plant replaced height sensing, which drifts.
- **Specs and story:** a fuller slice timeline, plus specs for the screen, audio and Temper. Grandma became the solo partner, and the cold open was written.

**v4 (2026-10-20):** Pete's feedback.
- **Hatchet:** small hatchet swings are in, with the notch and limbing added to the slice.
- **Schedule:** dates removed; the plan now uses gated steps and parallel tracks.
- **Cast:** the Victorian geese are locked, and Grandma's continues straight from Tandemonium's finish line.
- **Overcooked:** an Overcooked lens was added, with Shifts, the kettle order board, station hopping and failing funny.
- **VR:** a full VR design (§11).
- **v4 review pass:** hatchet turns and glowing branches (no spamming), hatchet split replaces the maul, phone-touch fallbacks, cross-device skew correction, face-up station hop, a fixed blade widget in Shifts, per-ticket kettles plus a mantel clock, bending blade in VR (no ghost hand), fist-bump alignment math, VR-2 shared beat, iron-banded oak.

**v5 (2026-10-20):** Pete asked for multiplayer without VR headsets, local and online. Added §10: couch co-op and versus, online crew vs. crew, online duo and online Shifts, with a Durable Object referee, the song as the shared clock, and the C2 blind-partner test and step O. Later sections moved up by one number.

**v5.1 (2026-10-20):** Pete pointed out that Tandemonium already runs online captain and stoker. §10 now copies that model (`RoomTransport`, host authority, tolerance tuned from play, room calls and sync pings). The Durable Object referee, the mandatory song and the blind-partner test were dropped, and online duo moved into the toy. Ghost races are signed off as async versus.

**v5.2 (2026-10-20):** Pete: the controller lab is the home for controllers and room/join logic; in-game video and audio are coming out of Tandemonium; phone as controller is moving into the lab with game plugins, and the second-player phone join isn't designed yet. §10.1 now points at lab packages, calls were removed, and §10.7 lists what Timber Tandem needs from the lab phone package without waiting on it.

### Sources

- Looney Lumberjacks: https://www.mariowiki.com/Looney_Lumberjacks
- Go Play Lumberjacks review: https://www.nintendoworldreport.com/review/19068
- Two-man saw: https://en.wikipedia.org/wiki/Two-man_saw
- USDA crosscut saw manual, ch. 5: https://www.fs.usda.gov/t-d/pubs/pdfpubs/pdf06672804/ch05.pdf
- Lumberjack World Championship: https://en.wikipedia.org/wiki/Lumberjack_World_Championship
- Paul Bunyan Show: https://thepaulbunyanshow.com
- STIHL Timbersports: https://en.wikipedia.org/wiki/Stihl_Timbersports_Series
- Everybody 1-2-Switch!: https://en.wikipedia.org/wiki/Everybody_1-2-Switch!
- ios-haptics: https://npmjs.com/package/ios-haptics
- WebKit device-motion bug: https://bugs.webkit.org/show_bug.cgi?id=285120
- Device motion in JS: https://yal.cc/js-device-motion/
- Wii strap lawsuit: https://www.theregister.co.uk/2008/12/12/wii_strap_lawsuit/
