# D05-01 · The Anatomy kit, copied in, and the scoreboard drawn as the Atlas mark

**What this is, in plain words.** The verdict screen now opens with the Atlas logo, redrawn once per question from that round's verdicts. The logo has a dot for each bettor at the top (solid = you, ring = the model), a leaning line from each dot, and one bar at the bottom. Each verdict changes the mark in one way:

| Verdict | Dot | Line |
|---|---|---|
| matched | filled (a model keeps its ring and fills its centre, so you can still tell it is the model) | runs all the way down onto the bar |
| didn't match | keeps its own look (yours solid, the model's a ring) | stops short of the bar, with a clear gap |
| can't check | an outline with a short level dash inside, like a gauge showing no reading | dashed and faint, stopping short. It never reaches the bar |
| no judged bet | a faint outline | no line |

The mark adds no new words. Its only text is the screen-reader label, built from the words the table already uses ("matched", "didn't match", "can't check").

**Files.** `web/machines/iso/` holds the Anatomy kit files Atlas uses (`iso-kit.ts`, `iso.css`, `react/draw.tsx`, `react/live.tsx`). They are copied verbatim, and Anatomy's MIT `LICENSE` sits beside them (PRE-EXISTING.md already lists the kit). `web/machines/scoreboard/marks.ts` is the pure function from verdicts to the state of each part. `Scoreboard.tsx` draws it. Wiring: one line in `web/screens/Verdict.tsx`, which both flows use (the withRpcRetry fixture and Moonwell). `web/main.tsx` also imports `web/machines/machines.css`.

## What this proves
- `test-output.txt` (`tests/unit/machines-scoreboard.test.tsx`, 5 tests):
  - **{person: didn't match, model: matched}**: the model's ring fills, its line reaches the bar, and the person's line stops more than 10 units short. Exactly one line in the markup carries `data-reaches-bar`. A snapshot is stored.
  - **{person: matched, model: can't check}**: the person's line lands on the bar. The model gets an outline, the level dash, and a dashed faint line that does not reach the bar. A snapshot is stored.
  - **Reduced motion**: with `prefers-reduced-motion: reduce`, the first paint is the end state and has no `sb-grow`, `sb-fade`, `sb-fill` or `animation-delay`. A control run without the setting does animate, so this check can fail.
  - **Drawn from verdicts only**: a bettor with no judged bet gets a faint outline and no line, and no verdicts means no marks.
  - **Wired in**: rendering the real `VerdictScreen` with the real D04-04 round (you and Muse Spark 1.3 on S3) gives 3 marks. On the wait question you bet 15,000 ms (didn't match) and Spark bet 12,000 ms (matched).
- `scoreboard*.png` (desktop and 390 px, dark and light) show the two acceptance cases, then marks from real rounds: S3, S6 and S2, played through the real server by `tests/tools/machine-pages.tsx` (person only, no model called), and the D04-04 round with both bettors.

## What this does not prove
- The two acceptance cases are written by hand as `Verdict` objects (in `tests/tools/scoreboard-cases.ts`), because no real round so far has you matching while the model can't check. Every other mark on the page comes from a real run.
- No line-end check here. `lines.mjs` checks isometric `.iso-line` texture lines, and the mark is a flat logo with none of them. A line that stops short is the message here, not a fault.
- The proof card and the film's end frame (plan section 6) do not exist yet, so they do not use this component yet.
- The pages are static end states. The grow-and-fill animation was looked at only in the live harness for D05-02, not filmed frame by frame.

Rebuild the pages: `npx tsx tests/tools/machine-pages.tsx` (it writes D05-01 and D05-02 together; run ids change on every rebuild).
