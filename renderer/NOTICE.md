# What the renderer reuses, and whose it is

The look and the pencil engine come from statechart-art by Kevin T. Ngo (MIT), through the fork
github.com/damli40/statechart-art, upstream commit 09c959c79e25767cc34a5beddf3df234b085636e. Licence text:
`renderer/LICENSE-statechart-art`. Technique only: none of its pictures, characters, boba scene, TLA+ models or "Kevin" fonts
are in this folder, and there is no TLA+ and no model anywhere in it.

| File here | From statechart-art | What was taken |
|---|---|---|
| `renderer/hand.ts` | `tools/kit/hand.js`, `tools/kit/util.js` | ported to SVG: follower, wander, seeded generator |
| `renderer/layout.ts` | `tools/lib/layout.js`, `tools/lib/tagchart.js` | reading pele's SVG back; the "words beside the line" search |
| `renderer/live/svg.ts` | `tools/lib/tagchart.js`, `tools/lib/draw.js`, `tools/kit/shapes.js` | the ticket, pin, arrow and hatching recipes, redrawn as SVG |
| `renderer/export/engine/kit/*`, `renderer/export/engine/lib/*` | `tools/kit/*`, `tools/lib/{classic,draw,letter,mask,storybook}.js` | the pencil engine, copied; `letter.js` changed to load Besley instead of Kevin fonts |
| `renderer/export/plate.ts` | `tools/lib/tagchart.js`, `business/art/order.js` | the same recipes, drawing a Scene in pencil |

Other third-party parts:
- pele 1.12.0 (MIT, kepano), pinned exactly, for layout. 1.13.0 was published today; 1.12.0 has been out for five days.
- Besley (SIL OFL 1.1), `renderer/fonts/`, with `OFL.txt`. Fonts come from @fontsource/besley 5.3.0.
- @napi-rs/canvas 1.0.13 (MIT), for exported images only, as a dev dependency: not in the production image.
- Anatomy's craft rules (MIT) informed the checks in `renderer/check.ts` (every line ends on something). No Anatomy code is copied here.
