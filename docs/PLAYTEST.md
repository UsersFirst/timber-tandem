# Real-phone tests: spike (step C) and toy (step D)

The simulated phones prove the pipeline: sensors, then tracker, calibration, clock sync, relay and saw. Only real phones in real fists can answer the plan's questions (PLAN §13.1, §13.3).

## Setup (once)

1. The game is live at **https://timber.housetandem.com** (`npm run deploy` to update). Phones need HTTPS for motion.
2. Use a laptop on the TV over HDMI. Turn on the TV's **game mode**. Use the TV or laptop speakers, **not Bluetooth**.
3. Open the site on the laptop and press **Play on this screen**. Each phone scans its handle's QR in **Safari or Chrome**, not an in-app scanner browser.
4. **Android:** turn **auto-rotate off**. A quick twist otherwise rotates the page, and Chrome stops sending motion while it does (the 2026-10-21 drops). Tapping *Pick up the saw* also tries to lock portrait in full screen.
5. **One person, two phones** (solo testing) works: the hands go opposite ways, like pistons. The lesson checks each phone's direction on the clicks and turns a backwards one round.

**The test log** is always on now and survives closing the tab: it's saved in the browser every 2 s. Open `/?host&spike` to show the **Download spike log** button (bottom-left); on a fresh page it downloads the last session that has anything in it. `?spike` also adds the phones' raw sensor stream.

## Step C: phone sensing spike

Open `/?host&spike`. Every phone, saw frame and event is logged. Use **Download spike log** (bottom-left) after each run and name the file `device-device-scenario.json`.

**Is a phone backwards?** During sawing, the dot under each goose should go *back* when that hand pulls toward its belly. If it goes the wrong way: phone menu → **My hand goes the wrong way** (in the lesson, or after a press-and-hold **Pause**).

| Run | Who | What to do |
|---|---|---|
| C1 calibration | each phone | Follow the TV. Note which steps show ⚠︎ and the measured lag on the calibration card. |
| C2 full strokes | 2 people | One tree, full comfortable strokes |
| C3 half strokes | 2 people | One tree, tiny strokes (about ±5 cm) |
| C4 push trials | 2 people | Push on purpose every 4th stroke; count it. The blade should bow on the pusher's side. |
| C5 waggle | 2 people | Shake fast. Expect chatter and no faster cut. |
| C6 chops | each phone | Small chops on the notch; count real chops vs detected |
| C7 mixed devices | iPhone + Android | Repeat C2 |
| C8 no gyro | budget Android | Should fall back to touch ("saw by touch") |
| C9 latency | 1 phone | Film the TV and the phone at 240 fps; compare the stroke end with the bite sound |

Pass thresholds come from PLAN §13.1. The ones the log answers directly:
- **Sample rate:** at least 55 Hz median. Check the `hello.rateHz` value for each phone in the log.
- **Reversal detection:** compare `rev` events to the strokes you counted.
- **Time to sync:** first-time pairs reach 8 clean strokes in a row within 60 s, in at least 8 of 10 pairs. The log has `bite` events with `streak`.
- **Chops:** 95% detected, no double hits.

## Step D: toy

Play two trees with first-time pairs, both couch pairs and one online pair (the second home uses **Join a home**).

**Watch first, then ask three questions:**
1. What was that like?
2. When did you feel in sync?
3. Would you do another tree right now?

**Measure:**
- Time to first lock.
- Tantrums per tree: on the score card.
- Whether anyone says "again?" without prompting. That's the gate.
- Spectators laughing.
- Phones out filming.

## What to try if it feels wrong

| Feels like | Knob (file) |
|---|---|
| Too strict: binds when you feel in sync | `SAW.GREEN` up a little (0.35 → 0.42) in `core/saw-model.js` |
| Tantrums too easy | `SAW.RED` (0.8) |
| Slow strokes chatter | `SAW.CHATTER_FRAC` (0.55) |
| Strokes missed or doubled | `TRACK.V_MIN`, `V_FRAC`, `MIN_HALF_MS` in `core/stroke-tracker.js` |
| Chops missed | `CHOP.MIN_START`, `START_FRAC` in `core/hatchet.js` |
| Steering too twitchy | `TRACK.ROLL_FULL_DEG` (30°) |

Every knob is a constant with a comment. Change one at a time and keep the spike logs.
