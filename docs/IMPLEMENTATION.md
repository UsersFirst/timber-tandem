# Timber Tandem — first implementation (the toy + the phone spike)

Scope: PLAN.md §13 steps **C (phone sensing spike)** and **D (toy)**, built so the slice (E) grows from it.

**In:**
- the two-person saw: strain, bites, chatter, tantrums, Temper;
- steering by fist twist;
- the alternating hatchet notch;
- TIMBER!;
- a gray-box clearing at Grandma's, with two trees (a small pine, then a big one);
- one work song;
- Grandma as the solo partner;
- couch co-op with 2 phones;
- online duo (two screens, one room, the host runs the saw);
- the hold-to-pull button path (keyboard and touch);
- spike logging.

**Out (slice and later):** Pinch & Wedge, limbing, Heave, Plant, Shifts, gamepads, VR.

## Layout

One Cloudflare Worker serves the static site (`public/`) and the relay (`/relay`). `npm run dev` runs it locally (wrangler dev), and `npm run deploy` puts it live at https://timber.housetandem.com (and workers.dev) for real phones. Phones need HTTPS for motion sensors.

```
public/index.html          the screen (TV/laptop): host or guest
public/phone/index.html    the phone controller
public/js/core/*.js        pure logic, no DOM: node-tested, shared by the browser and the worker
public/js/net/*.js         relay client, clock sync, input buffers
public/js/screen/*.js      three.js scene, HUD, audio, game flow
public/js/phone/*.js       motion capture, calibration, the phone UI
public/lib/ui, lib/core    vendored @usersfirst/ui and controller-core (npm run sync-lab)
worker/index.js            assets + the TimberRoom Durable Object
test/unit/*.test.mjs       node:test
scripts/smoke-*.mjs        puppeteer smokes: real pages, simulated phones
```

## Conventions

- **Time:** milliseconds on the **host clock** (`performance.now()` on the hosting screen). Phones and guest screens estimate an offset to it by ping-pong (`core/clock-sync.js`).
- **Stroke position p:** p ∈ [−1, +1], where +1 means pulled to the belly. Seat A is screen-left, seat B is screen-right.
- **Saw values:**
  - **Saw position:** s = (pA − pB)/2.
  - **Strain:** e = (pA + pB)/2. e < 0 is compression (a push); e > 0 is tension (a tug-of-war).
- **Beat:** one saw stroke per beat. With alternation, A arrives pulled on odd beats and B on even beats.
- **Grandma's target path:** the target saw path is s\*(t) = −cos(π · beatPos). Grandma follows pB = −s\*(t).

## Who computes what

| Where | Computes |
|---|---|
| Phone | Raw `devicemotion` → stroke tracker → p, v, roll (`core/stroke-tracker.js`); hatchet hits (`core/hatchet.js`); calibration. It sends samples timestamped on the host clock, about 30 times a second in batches of two. |
| Host screen | Per-seat input buffers, then **evaluates the saw at one matched time** t_eval = the newest time every active seat has reached (`net/input-buffer.js`). Runs `core/saw-model.js`, `core/notch.js`, `core/tree.js` and `core/game-flow.js`. Renders, plays audio, and broadcasts state to guest screens at about 30 Hz. |
| Guest screen | Renders the host's state and plays the song locked to the host clock. Its phones talk to the host directly through the room. |

A seat's samples have the calibrated saw offset subtracted (`sawLagMs`, measured during warm-up against the beat), so devices with different sensing lag are compared fairly (PLAN §4.3, skew rule).

## Wire protocol (`core/protocol.js`)

**Relay roles:** `host`, `screen` (guest screens), `pad-1`…`pad-4`.
- Pads join with the per-seat secret that the host registers (Tandemonium's pad-relay model).
- Screens join with the room code.

**Binary from a phone:** `SAMPLES` frame
```
[0] 0x54  [1] seq  [2] n   then n × 11 bytes:
   u32 tHost ms · i16 p×10000 · i16 v×1000 · i16 roll×100 (deg) · u8 flags (bit0 valid, bit1 held/touch path)
```

**JSON messages** (`{t: type, ...}`):

| Direction | Messages |
|---|---|
| phone → host | `hello` {name, ua, motion: 'ok'\|'denied'\|'none'}; `ping` {id, c0}; `calib` {profile}; `hit` {t, peak, grade, ax, ay, az}; `raw` {batch} (spike logging only) |
| host → phone | `pong` {id, c0, h}; `seat` {seat, color, label}; `mode` {mode, ...}; `cue` {kind} (haptic and sound hints) |
| host → screens | `state` {…snapshot}; `event` {…}; `song` {bpm, startH}; `pong` |
| screen → host | `hello`; `ping` |

**Phone modes:**
- `lobby`;
- `calib-rest`, `calib-pull`, `calib-saw`, `calib-chop`;
- `saw`, `chop`, `idle`.

## Core numbers (first pass; tuned from play)

**Saw (`SAW` constants):**

| Constant | Value |
|---|---|
| GREEN | 0.35 |
| RED | 0.80 |
| Stroke counts | When s reverses after ≥ 1.0 of travel |
| Chatter | Stroke shorter than 0.55 × beat |
| Tantrum cooldown | 900 ms |
| Bites to fell | Small pine 14, big pine 24 |

**Stroke tracker:**
- High-pass ~0.3 Hz, low-pass ~4 Hz, leaky velocity.
- Reversal = a velocity sign change with hysteresis (|v| ≥ 0.08 m/s) and at least 140 ms per half-stroke.
- The half-stroke travel is learned (an EMA), so half strokes still reach ±1.

**Hatchet:**
- A gyro peak ≥ max(150°/s, 0.45 × the calibrated peak).
- The hit is timed when the gyro falls below 40% of the peak.
- 250 ms refractory window.
- Soft = under 0.6 × the calibrated peak.

**Steering:** roll about the stroke axis from gravity (acceleration with gravity minus acceleration), relative to the calibrated rest pose. Full lean at ±30°.

## Game flow (toy)

`title → lobby → calibrate (each phone on its own) → cold open → [tree: notch → back cut → TIMBER → score] ×2 → end`

Grandma (solo), when chosen in the lobby, fills seat B and is drawn as the Georgian goose (a stand-in until her model exists).

## The tantrum (scene/tantrum.js)

About 1.2 s, built to read from the sofa and to stay funny when it happens a lot:

| Time | Beat |
|---|---|
| 0 | **Snap.** The blade buckles (push: a bow and an S) or twangs (tug: a fast plucked-string wave), jumps out of the kerf, kicks toward the blamed handle and glows ember-orange. Sawdust spits from both ends of the kerf, steam jets out like a kettle, and the camera punches in. |
| 0.04 s | **Curse.** Old Misery's grawlix bubble ("#@%!", rotating) pops over the blade, its tail pointing at whoever caused it, trembling as it calms. |
| 0–0.6 s | **Recoil.** Push: the pusher is kicked back (head whipped, a hop, the hat flies off and drops back, feathers up, a squawk, one wing thrown out and back). Tug: nobody lets go. Both are yanked in toward the trunk, then honk at each other. |
| 0.3 s | **The take.** The partner gives the camera a flat look. Grandma instead draws herself up and tuts over her spectacles (with her tut sound). |
| 0.5–0.9 s | **Shake it off.** The blamed goose shakes its head; a puff of steam from its head. |

- **Repeats are smaller.** A tantrum within 2.5 s of the last one gets a smaller take: no hat, no camera look, a shorter bubble.
- **How it works.** Each goose has spring channels layered on the clip (spine lean and twist, neck whip, head look and tilt, jaw, hop, shove, fluff, tail; scene/geese.js). The hats are re-skinned from Head onto HatSocket at load, so they can fly. The saw has spring bend modes plus jump, kick, roll and yaw (scene/saw.js).
- **On the HUD,** the TANTRUM! word sits high and smaller, so the bubble owns the middle of the shot.
- **Review tools** (`node scripts/serve.mjs 8792` first):
  - `node scripts/dev-tantrum-strip.mjs <tag> <A|B|-> <push|tug> <saw|close|A|B> [castB]` makes frame-exact contact sheets.
  - `node scripts/dev-tantrum-clip.mjs <name> [castB]` makes a 30 fps mp4.
  - Both write to scripts/out/tantrum/.

## Modes and screens (2026-10-22)

The screen opens on the **main menu** (arrow keys or a gamepad + Enter/A, mouse, touch; Esc/B goes back a page):

| Choice | What it does |
|---|---|
| **Solo — saw with Grandma** | Hosts here. Seat A is yours (phone QR or **Use keyboard**); Grandma holds seat B and stays there whatever scans. |
| **Two players — one screen** | Hosts here. Today's two-seat couch lobby. The right handle can still go to Grandma ("Saw with Grandma instead" = switch to Solo). |
| **Online duo → Host an online game** | Hosts here. Seat A is yours; seat B is the other home. The invite opens automatically and the code (with this site's address) is shown big in seat B's card. |
| **Online duo → Join with a code** | This screen becomes the guest (the old "Join a home"). |
| **How to play** | Five short rules in Old Misery's terms, plus the keyboard keys. |

- **Code:** `screen/nav.js` (menu navigation), `core/modes.js` (pure: the modes and the menu every screen and phone shows, unit-tested), `Game.mode`, `Game.setMode(mode)` (lobby or title only) and `Game.toTitle()`, which adds a `title` phase. The room opens once, on the first pick, and stays open, so going back to the menu keeps every paired phone. Phones show the main menu's choices too, so a game can still be run from a phone.
- **Main menu from anywhere:** the lobby (button or Esc), the pause sheet, the score card and the end screen all have **Main menu**.
- **URLs:** `?host` is still the couch lobby (smokes and dev links unchanged); `?host=solo|couch|online` hosts in that mode; `?join=CODE` joins. Picking from the bare menu rewrites the URL to `?host=<mode>`, so a reload resumes the same room in the same mode.
- **Seat B across homes:** moving into or out of Online gives seat B a fresh pairing link, so a phone paired for one home never carries over to the other (the relay closes the old phone's socket).
- **Leaving online:** if the host picks Solo or Two players, the invite closes and the guest screen is told "The online game is over" (`online-ended`). While the host is only on its main menu, the guest sees "The other home is choosing" and stays connected.
- **The guest screen:** "Joined TIMB-XXXXX" lobby, the host's handle shown as theirs (tagged *other home*), a **Leave** button (lobby foot, or top-left elsewhere), and a notice panel for refused codes (404 / not invited / full), the host's screen going away, and the end of online play.
- **Keyboard on the guest screen** (`screen/guest-keys.js`): **Use keyboard** on the guest's right-handle card joins the relay as seat B's pad with the pairing link the host already sends, exactly like a phone on the touch path, and streams hold-to-pull samples on the host clock (J pulls, K chops, O/P steer). Two laptops can now play online with no phones. **Rule:** a phone that scans seat B's code later takes the handle; the relay replaces the keyboard's socket (4002) and the guest says "A phone took the right handle." "A phone instead" on the card hands it back.
- **Built from the lab's `@usersfirst/ui` (PLAN §10.1), vendored unchanged:**
  - the menu pages are one `<uf-flow id="title-flow">` of `<uf-step>`s (`title-main`, `title-online`, `title-join`, `title-how`); `data-flow-go` / `data-flow-back` buttons navigate, and the flow's history is the Back path;
  - each lobby handle is a `<uf-seat>` (role, goose, status, `open|joined|ready`, `team-a|team-b`, an OTHER HOME badge), with what pairing needs (QR, room code, Use keyboard…) under it;
  - all menu navigation is the lab's `FocusController` (`screen/nav.js`): one controller, fed by `GamepadInput` merged with a `ManualInput` from the keyboard. The main menu uses `flow.attachFocus()`; the other panels (guest notice, pause, score, end, safety, lobby) get spatial scopes. Arrows / d-pad move, Enter / A confirms, Esc / B goes back on the menu (elsewhere Enter and Esc keep their game meanings: start, next, pause, main menu). Native focus follows the controller and Tab moves the controller, so the ring and Enter agree.
- **Lab gaps (worked around here, to fix in the lab first):**
  1. `<uf-seat>` renders its own DOM and has no slot for extra content, so the QR, room code and seat buttons sit in a wrapper (`.handle`) under the seat instead of inside it.
  2. `<uf-seat state="open">` is always focusable (`role=button`, `tabindex=0`), even when clicking it does nothing (here, scanning is how you join). Timber's nav builds its lobby scope from buttons only, so the controller skips it; Tab still stops on it.
  3. `FocusController` reads one input object. Keyboard and gamepad together need a small merge in the game (`nav.js`); a `MergedInput` (or a `KeyboardInput`) in `inputs.js` would remove that. Keyboard edges also have to be polled on keydown and keyup: a key can go down and up inside one frame, and `ManualInput` is level-based.
  4. `FocusController` has no "focus this element" call. Following Tab / clicks uses `setSpatial(items, el)`, which also re-arms the confirm latch.
  5. `<uf-step>`'s `prompt` style (bold sans) isn't the game's serif page title, so the pages keep their own `<h2>` instead of using `prompt`.
  6. `<uf-keypad>` and `<uf-join-code>` keep fixed key sizes and overflow a 390 px phone; Timber zooms them down under 480 px.
- **Fixed:** the invite was only sent if the host's socket was already open, so a host that opened straight into Online (`?host=online`, or a reload) could refuse guests with 403. `RoomHost` now remembers the invite and re-sends it whenever the socket opens.

## Tests

- **Unit:** saw model, stroke tracker (synthetic strokes, half strokes, noise, solo binds, waggle chatter), hatchet detector, notch, tree and steering, clock sync, protocol round-trips, relay routing, modes and menus.
- **Smoke:** the screen and two simulated phone pages over a local wrangler dev, driven through a full tree, plus Grandma solo and an online duo with a guest screen. `menu-solo`: main menu → Solo → keyboard → notch → a D chop lands → pause → Main menu → Two players. `menu-online`: two screens both through the menus (Host / Join with a typed code), both by keyboard, through the notch and 15 s of sawing (≥ 4 bites), then the host picks Solo and the guest is told. `menus` also goes to the main menu and picks Two players from the phone.
- **Screens:** `node scripts/shots-menus.mjs --base <dev url> [--noscene]` captures every menu page, each mode's lobby and the guest screens at 1280×720 and 390×844 into `scripts/out/menus/`.
- **Two dev servers on one port:** on Windows two `wrangler dev` processes can both listen on 127.0.0.1:8787; requests then split between two separate Durable Object stores, and the online smoke times out at "guest joined". Use one server per port.

## Status (2026-10-21)

Built and passing:
- 38 unit tests;
- type check (`npm run check`);
- 6 end-to-end smokes over the real relay with simulated phones (`npm run smoke`): bots, two phones, a partner late in play, waggle, Grandma solo, and online duo.

Three reviews have been applied: correctness (15 findings), design fidelity against PLAN, and a cross-model review from Gemini.

**Flow:** title → lobby → safety card (first time) → cold open → Grandma's lesson (calibration) → tree (notch → back cut → TIMBER → score) → next tree / one more tree.

### Built differently from the first draft (from review)

- **Saw:**
  - **Green line:** 0.40 (it was 0.35), which is about ±80 ms between partners at 96 BPM.
  - **Glitch filter:** strain has to stay past the green line for 50 ms before it spoils a stroke.
  - **Blame:** follows the plan's velocity rule. Being off the beat shows on the beat strip instead.
  - **Stepping:** the saw steps at 120 Hz up to the newest sample of every live hand, so the frame rate and a stalled phone can't cause false strain.
- **Tracker:**
  - The snap to ±1 at a reversal blends in over 80 ms.
  - Duplicate timestamps are skipped.
  - The learned stroke size survives gaps.
  - "Pull" is the last velocity lobe of the move, so reaching first doesn't flip the axis.
- **Trees:** the small pine takes 40 bites and the big pine 64. That lands a clean pair at about 25 s and 40 s of back cut; real pairs land nearer the plan's 60–90 s.
- **Aim:** comes from the lean over the last 4 bites plus the live lean, so a late twist counts.
- **Notch:**
  - The camera cuts to the far side and the picture is mirrored, so Sir Winston (orange, seat A) is on the left in every shot.
  - The TV announces each turn ("Sir Winston — chop!"), with a seat-panned sound.
  - Small chops never glance: soft is now 0.4 × your calibrated swing.
- **Online:**
  - A second home can only join while the host has **Invite another home** open, and only one home per game.
  - A network blip never makes a new room.
  - A host reload resets everyone's clock sync.

### First real-phone session (2026-10-21: iPhone + Android, one person, one phone in each hand)

Log: `~/Downloads/timber-spike-1792590647544.json` (140 s, raw sensors).

- **No bites in 50 s of sawing, 18 tantrums.** The two hands read *in step* (both "pulled" on the same beats), so every stroke was a push or a tug. Pete's timing was fine: one stroke per beat.
- **Cause: phone B's direction was backwards.** The pull step failed on both phones: it waited for the hand to be completely still for 350 ms, which a hand held in the air never is. Each phone then guessed its direction from the coached grip. Even when the pull is found, it can't be trusted: the grip changed between steps. B lay flat for "hold still", and both phones were on their sides while sawing, mirror images of each other.
- **Fixes:**
  - The pull step ends when the hand settles below its peak, and runs once more if a phone misses it.
  - The lesson's click stage scores each phone's pulled ends against its cue (A on odd clicks, B on even) and turns a backwards phone round (`pullParity`, tested on this session's numbers).
  - Each phone has a manual **My hand goes the wrong way** button.
- **Drops:** the Android phone's sensor stream stopped for 0.3–3 s, five times, each as the phone swung between portrait and landscape: auto-rotate. The phone now tries a portrait lock in full screen, and the playtest guide says to turn auto-rotate off.
- **Also added:**
  - **Hand cues:** under each goose, BACK / FORWARD, a ring where the hand should be and a dot where the phone is. They show in the lesson's saw step too.
  - **Pause:** Esc or the TV button; press-and-hold on a phone. From the pause menu: resume, restart the tree, or stop and go back to the lobby.
  - **Phone menus:** every TV choice is on the phones too (start, solo, safety, skip, next tree, one more, finish, back to lobby).
  - **The test log:** always on, saved in the browser every 2 s.

### Open for Pete (not in the plan; kept small, easy to change)

0. **The tantrum's gags** (above) are mine: the curse bubble, the hat flying off, the take to camera, and Grandma's tut. Any of them is easy to drop or change.

1. **Landing:** shown as degrees off the skid, with the words skid / close / wide / privy. There are no stars.
2. ✅ **Grandma follows your twist** (Pete, 2026-10-22): solo steers at full strength (`steerLean` in core/tree.js). With two players, the blade still leans by the average of the two twists (PLAN §4.4).
3. **The notch is seen from the far side, mirrored** (above).
4. **Calibration** is 5 short steps, with live progress and a visible countdown. PLAN wants it folded into the first strokes on the small pine. That's the next iteration if the steps feel slow.
5. **The Grandma stand-in** is the Georgian goose. She needs her own model (tandemonium-claude-3d pipeline).
6. **Menu wording and order** (Solo first, then Two players, Online duo, How to play) and the five How-to-play rules are my draft from PLAN §4–5.
7. **Online seat B is always the guest.** The host's home plays the left handle and the other home the right; there's no swap yet.
8. **A phone beats the keyboard** on the guest's right handle (latest connection wins). On the host, a keyboard seat stays a keyboard until "A phone instead".
9. **Back to the main menu while online** keeps the other home waiting ("choosing"); picking Solo or Two players ends online play for them.

### Not done yet (needs real hardware or Pete)

- **Real phones:** the spike and toy runs in `docs/PLAYTEST.md`.
- **Deploy:** live at https://timber.housetandem.com (also https://timber-tandem.pete-872.workers.dev; `npm run deploy`; Claude may run it per `.claude/settings.json`).
- **A real TV:** frame rate on a TV-class device. The laptop renders at 480–630 fps uncapped.
- **Voice:** recorded lines for Grandma and Old Misery (captions only for now).
