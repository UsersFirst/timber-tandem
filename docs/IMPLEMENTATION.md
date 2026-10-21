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

One Cloudflare Worker serves the static site (`public/`) and the relay (`/relay`). `npm run dev` runs it locally (wrangler dev), and `npm run deploy` puts it on workers.dev for real phones. Phones need HTTPS for motion sensors.

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

## Tests

- **Unit:** saw model, stroke tracker (synthetic strokes, half strokes, noise, solo binds, waggle chatter), hatchet detector, notch, tree and steering, clock sync, protocol round-trips, relay routing.
- **Smoke:** the screen and two simulated phone pages over a local wrangler dev, driven through a full tree, plus Grandma solo and an online duo with a guest screen.
