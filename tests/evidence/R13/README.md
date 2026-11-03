# R13: the Muse Code plugin draws a picture of a file

Date: 2026-11-03 (WAT) · Muse Code 1.4.14 (R7309.1) · branch `r13-plugin-draw` from main f876f43

## The one thing to know first

**Yes: pointed at a file, the plugin now makes a picture of it.** The person types `/atlas-draw <file> [function]` in Muse Code
(or asks for "a picture of <file> with Atlas"). The new `atlas_draw` tool sends that one file to the Atlas server. The server
draws it with the same plain code as the web page and sends back the picture. The plugin writes it into the project at
`.atlas/drawings/<file>[-<function>].svg` and `.png`, and returns the path, the caption and the PNG as MCP image content.

**What Muse Code shows: a "1 image" line, not the picture.** Muse 1.4.14's terminal screen marks the tool call
`✓ · 1 image` and, expanded, `[MCP image content: media_type=image/png, bytes=428836]`. It draws no pixels in the terminal (seen
through tmux; a terminal with an image protocol was not tried). **Muse does pass the image to its model:** the model's request
holds an `input_image` with the PNG. In the live run, Muse Spark 1.3 described the picture correctly: 4 boxes, the funnel
marked "starts here", red pipes from the middle box to the other three, and the line labels. Those details are only in the
image, not in the tool's words. To see the picture, the person opens the `.png` path the tool prints.

**Spend: Muse Code ≤ $1.11 (upper bound; $0.32 if cached tokens are free), Atlas $0.** No Atlas model call happened (the
scratch server's usage log was never created). The meter's stop line was $1.10; it crossed it on the last call, after the
answer was complete (see "Spend").

## What a person types and sees

```
❯ /atlas-draw backend/src/services/score.ts
◆ atlas_draw(backend/src/services/score.ts) · plugin:atlas:atlas · ✓ · 1 image · 0.2s
◆ Picture: .atlas/drawings/backend_src_services_score.ts.png
  Caption, as written:
  score.ts: Atlas's machine of 1 part
  Drawn by Atlas's plain code from the file's syntax alone. Nothing ran, and no AI drew it.
```

(from [muse-live/01-atlas-draw.txt](muse-live/01-atlas-draw.txt))

## The pictures

All in [drawings/](drawings/), made through the plugin's real MCP server (stdio) against a scratch Atlas server:

| File | What came out |
|---|---|
| Atlas's example `example.ts`, function `fetchWithRetry` | machine, 4 parts: [png](drawings/example.ts-fetchWithRetry.png), [svg](drawings/example.ts-fetchWithRetry.svg) |
| `example.ts` with `names: true` | machine with Muse Wonder's names on 2 lids, starred, legend in the caption: [png](drawings/example.ts.png). These are the example's recorded names, so no call was made |
| oft-sentinel `backend/src/services/score.ts` | machine, 1 part: [png](drawings/backend_src_services_score.ts.png) |
| oft-sentinel `backend/src/services/attestor.ts` | machine, 4 parts: [png](drawings/backend_src_services_attestor.ts.png) |
| oft-sentinel `backend/src/services/orchestrator.ts` | 10 parts, so the box chart, saying why: [png](drawings/backend_src_services_orchestrator.ts.png) |

oft-sentinel files are from github.com/damli40/oft-sentinel at commit 2927212ab1c0, copied into a scratch folder.

The SVG files stand alone. Every element carries its colours as attributes, and the fonts are embedded. They open in a browser and in
macOS Quick Look (checked with `qlmanage` on attestor.ts). The PNG was made from that same SVG by `@napi-rs/canvas` (Skia).

## How it works, in plain words

1. **The plugin** (`plugins/muse-atlas/mcp/tools.ts`, `draw`) reads the one file the agent names. It uses the same checks as
   `atlas_read_file_function`: inside the workspace, JS/TS/Python only, 64 KB at most, never the home folder. It sends the file
   with `POST /paste`, then asks `POST /paste/drawing`. It talks only to `ATLAS_URL`.
2. **The server** (`server/paste.ts` route, `server/drawing.ts`) looks up the pasted file in this session. It draws with
   `renderer/authors/file-picture.ts`, the page's code: `benchModel` → `machineParts` → `drawMachine`. Past 8 parts it uses
   `benchSpec` → `drawSpec`, the box chart. Past 16 parts it gives the parts as words and no picture. No model is asked and
   nothing runs. The route is behind the invite gate like every other `/paste` route.
3. **The picture file** (`renderer/standalone.ts`): the page styles the drawing with a stylesheet. A file on its own has none,
   so each class's resting look is written onto its element. The fonts go inside, and a caption band is added underneath.
4. **PNG** only where `@napi-rs/canvas` is installed. It is a dev dependency, so a local server has it and the production image
   does not. Without it the answer says so in words and the SVG is the picture. A PNG over 700 KB is redrawn at 1x so the
   answer stays under the plugin's 2 MB limit.
5. **Writing**: only into `<workspace>/.atlas/drawings/`. A `.atlas` or `drawings` folder that is a link is refused, and so is
   a picture file that is a link. The file name is made from safe characters only. The plugin refuses a server answer whose SVG
   holds a script, a link out, an outside URL or an event handler. It also drops a "PNG" that does not start with the PNG
   signature.

## Natural names

Names follow the page's rules exactly. The drawing carries Muse Wonder's names only when this session already got them through
`POST /paste/names` (state "shown"). The plugin asks for them only with `names: true`. The lids get the page's star mark, and the
caption gets the page's legend: "names: Muse Wonder's words (Meta's AI), not a check (model)". Plain code checks every name
(`src/natural-names.ts`). Names never appear on the chart, as on the page.

## Tests

- `tests/unit/r13-plugin-draw.test.ts`, 12 tests. They cover: the output files and the image content shape over MCP; path
  safety (outside the workspace, `../`, absolute, other file kinds, empty) with nothing sent and nothing written; an unknown
  function; `.atlas` or `drawings` as a link out; a picture file that is a link; no invite (401, nothing written); with an
  invite; hostile server answers (script, `<image href>`, outside `url()`, `onload`, not SVG, fake PNG); the route's
  session and function checks; the names legend and star; chart past 8 and words past 16; no PNG converter.
- Changed tests: E5's tool list (9 tools now). E5's "no other web address in the plugin" check now allows the SVG namespace
  string `http://www.w3.org/2000/svg`. That is a name the safety check compares against, not an address anything is sent to.
  G1's route table lists `/paste/drawing` as closed by default and spending nothing.
- Counts: see [vitest.txt](vitest.txt) and [tsc.txt](tsc.txt).

## The Muse runs

- **$0 run** ([muse-zero-cost/](muse-zero-cost/)): real Muse Code with the real plugin, and the L2 puppet model in place of
  Meta's (it never forwards anything; dummy key). `CALL …atlas_draw` drew example.ts and score.ts.
  [04-ctrl-o.txt](muse-zero-cost/04-ctrl-o.txt) is the expanded tool result.
  [what-the-model-received.txt](muse-zero-cost/what-the-model-received.txt) shows each result reached the model as
  `input_text, input_text, input_image` (`data:image/png;base64,…`).
- **Live run** ([muse-live/](muse-live/)): Muse Spark 1.3, low effort, isolated HOME, the same scratch Atlas server.
  1. `/atlas-draw backend/src/services/score.ts`: one tool call; Muse gave the path and the caption as written.
  2. "Can you make a picture of example.ts with Atlas, starting at fetchWithRetry, and tell me what you see in it?": Muse's own
     file search found nothing (`Searched "^" (no matches)`), and it asked which file. That is a Muse search miss, not the
     plugin; the file was there.
  3. "It is example.ts at the top of this folder…": Muse found it, called `atlas_draw` with `fetchWithRetry`, and described the
     picture correctly from the image. It ended with "Atlas's plain code drew it from the file's syntax; nothing ran."
- Scripts: [tools/](tools/) (`.txt`, so nothing runs from the repo). The L2 meter and step driver were reused unchanged.

## Spend

| | Calls | Tokens | Upper bound | Uncached only |
|---|---|---|---|---|
| Muse Code (live run) | 12 | 255,440 in (196,134 cached), 4,230 out | $1.1064 | $0.3218 |
| Atlas (Meta models) | 0 | | $0 | $0 |

The meter ([muse-live/muse-meter.txt](muse-live/muse-meter.txt)) pressed Esc at $1.10, after the third answer had finished.
Nothing new was typed after that. The task's caps were $1.50 for Muse and $1.00 for other paid calls; Atlas made none.

## Limits, said plainly

- **Muse shows no pixels** in its terminal (1.4.14, through tmux). The person opens the file. Whether a terminal with an inline
  image protocol (iTerm2, Kitty) would show it was not tried.
- **The image costs model tokens** in a paid Muse session, because Muse passes it to its model. Measured here only as part of
  the 12 calls; not separated out.
- **No web link to the drawing.** The web page draws a file when you paste it there. There is no route that opens one pasted
  file's drawing by link, so none was added. After a run, the proof card link still works as before.
- **The production server makes no PNG** (no `@napi-rs/canvas` in the image), so there the answer is SVG plus a sentence, and
  Muse gets no image content. Only the local scratch server was tested; the hosted Fly app was not touched.
- **One judgement call:** the renderer boundary test allows only one door from the server to `renderer/export` (the pencil
  engine). `server/drawing.ts` loads `@napi-rs/canvas` itself, guarded and on first request. It does not use the pencil engine,
  and one picture takes tens of milliseconds, so it runs on the server thread and not in a worker. If Dami wants the "no canvas
  in the server" rule kept strictly, the PNG step can move into the pencil worker.
- One live run, one person-substitute (the build agent typing). Muse could word things differently on another run.
