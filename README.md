# Timber Tandem

> One saw. Two handles. Keep your temper.

A House Tandem motion party game: two Victorian geese, Grandma's woodpile, and Old Misery — a two-person crosscut saw with a famously short temper. Phones are the saw handles. Design: [`PLAN.md`](PLAN.md). This build: [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md).

## Run it

```bash
npm install
npm run dev          # wrangler dev: site + room relay on http://localhost:8787
npm test             # unit tests (saw model, stroke tracker, hatchet, notch, clock, protocol, relay)
npm run smoke        # end to end in headless Chrome over the local relay (needs `npm run dev`)
```

Phones need HTTPS for motion sensors, so real-phone play needs a deploy: `npx wrangler login` once, then `npm run deploy` (→ `timber-tandem.<account>.workers.dev`). Open it on the TV/laptop, press **Play on this screen**, and scan each handle's QR code.

## Ways to play and test

| URL | What |
|---|---|
| `/` | Title: host a game on this screen, or join another home (online duo) |
| `/?host&grandma` | Solo: your phone + Grandma on the far handle |
| `/?host&keys=A,B` | Keyboard: hold **F** / **J** to pull, **D** / **K** chop, **Q W** / **O P** steer |
| `/?host&bots=A:good,B:lag:120` | Practice bots, no phones |
| `/?host&spike` | Phone sensing spike: logs everything; "Download spike log" bottom-left |
| `/?join=CODE` | A second home's screen (online duo) |
| `/phone/?sim=good#…` | A simulated sawyer (also `lag:150`, `late:260`, `fast`, `still`; `&steer=0.4`) |
| `/dev/scene.html`, `/dev/audio.html` | Scene and audio test benches |

Add `&noscene` to skip the 3D scene (logic only), `&quality=low|medium|high` for the renderer.

## Credits

- **Lowpoly Pine Tree** by [Citron Legacy](https://sketchfab.com/CitronLegacy) — [Sketchfab](https://sketchfab.com/3d-models/lowpoly-pine-tree-75c6b0a9b2fc4493a17a266f0f504fb4), licensed [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Used unmodified (`public/assets/landscape/lowpoly_pine_tree.glb`).
- **qrcode-generator** 1.4.4 by Kazuhiko Arase — MIT (`public/lib/ui/third_party/qrcode-generator.js`).
- The geese and the `@usersfirst/ui` kit are House Tandem's own, shared with [Tandemonium](https://github.com/petegordon/tandemonium).
