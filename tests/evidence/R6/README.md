# R6: natural names on the machine, and a panel for each part

Dami found the machine's function names confusing: the code was written by an AI, so its names were unfamiliar. R6 does two things.

1. **Natural names.** Meta's AI (Muse Wonder) gives each drawn part a short name for what it is for ("price lookup", "retrying fetch"), in one call per file. Plain code checks every name: 1 to 4 words, 16 characters at most, letters only, and no word that judges the code, claims trust or describes how it behaves or breaks ("verified", "secure", "tested", "throws", "forever", "failing"…, matched by word beginnings). Two parts may not share a name, and no name may read as another part's identifier. A refused name leaves that lid with plain code's own words (the identifier split at its capitals). The name sits on the lid in grey italic with a small star, over the exact name in code type, and a line above the machine says in words: "★ names: Muse Wonder's words (Meta's AI), not a check".
2. **A panel per part.** Clicking a part, or Enter on it, opens a panel: whose words the name is, the exact name, plain sentences from the machine's facts (loops, waits, throws, returns, calls, called by, lines), then the code. Before a run it is the code drawer over the left column; after a run it sits in the result column under the verdict, so it covers nothing, and the ringed part's panel adds what broke, in words the result already shows. Hover only marks a part.

Runs are on the real page with every model mocked ($0), except the two recording calls below. Numbers are from one machine.

**Where to look first:** `panel/3-panel-fetchWithRetry-1280.png` (the panel before a run), `panel/5-panel-ringed-example-1280.png` and `panel/7-panel-ringed-orders-1280.png` (after a run, under the verdict), `panel/8-after-change-1280.png` and `panel/9-panel-after-change-1280.png` (the review's B2 case, fixed), `panel/3-panel-fetchWithRetry-390.png` (the phone sheet), `panel/6-proof-1280.png` (the proof card: real names only).

| File | What it shows | How to run it again |
|---|---|---|
| `panel.mjs`, `panel.txt`, `panel/` | Lids and the names legend, the panel by click and by keyboard, Esc, hover, digit keys under the panel, the bettors' text, the ringed part, what an open panel may never cover, a change of code with the panel open, the phone sheet, the proof picture. Every "covers" line is measured from the page's own boxes | `PW=… CHROME=… BASE=… node tests/evidence/R6/panel.mjs <out>` |
| `truth.txt`, `truth/` | `tests/evidence/R5/truth.mjs` rerun with natural names present | `PW=… CHROME=… BASE=… node tests/evidence/R5/truth.mjs <out>` |
| `visual.txt`, `visual/` | `tests/evidence/R5/visual.mjs` rerun | same, `visual.mjs` |
| `ring-shots.txt`, `ring-shots/` | `tests/evidence/R5/ring-shots.mjs` rerun: the ring lands where it did in R5 | same, `ring-shots.mjs` |
| `review/drive1.txt`, `review/drive1/` | The reviewer's B2/B3 driver (`scratchpad/r6/drive1.mjs`, with their mock answering "audited fetch" / "verified total") rerun on the fixed code | their mock on 18981, vite on 18982 |
| `review/names-probe.txt` | The reviewer's list of attack names through the new check | `pnpm exec tsx <their names-probe.ts>` |

The page for my drivers: `tests/evidence/U3/mock-server.ts` on port 18971 (it also mocks the naming call with "mock … step" names) and `vite --port 18972` with `ATLAS_API_PORT=18971`, with the hourly limits raised as in `truth.mjs`.

## Results

- `panel.mjs`, `truth.mjs`, `visual.mjs`, `ring-shots.mjs`: see the counts at the end of each `.txt` (all pass on the final run; numbers are in the report).
- Reviewer's drive1 on the fixed code: the trust names are refused, so the lids keep plain code's words; after "Change the code and bet again" no panel is left on screen; in round 2 neither the lids nor the bettors' text have names.
- Reviewer's name probe: every trust, status and flaw name is refused. Still accepted: "ignore previous", "constructor", "toString", "hasOwnProperty". They are neutral words, not claims.
- Unit tests: `tests/unit/r6-panel.test.ts` and `tests/unit/r6-names.test.ts`: every attack word from the review, purpose names still kept ("retrying fetch", "back-off timer"), the 16-character cap, duplicate and look-alike names, a round made before names were asked (review B3), a comment-only copy reusing the names with no second call (review m5), a file with more than 8 parts asking for nothing, the honest bettor sentence, the proof picture unchanged.

## What changed after the adversarial review

- **B1:** the check matches word beginnings over a much larger list of judgment, trust, status and flaw words, also after "un", "in" or "non". A visible line above the machine now says whose names the starred ones are.
- **B2:** the page keeps only the part's id; the panel's words are worked out again on every render from the current code and run. A new round, a new file or a new run closes it.
- **B3:** if a round's bettor text is written before names were asked for, that file's names are closed for the session: the page is told they are unavailable and never draws them.
- **M1:** the bettors are told "Names … suggested for the parts… The person's drawing may show some of them. Its words, not a check." Names longer than 16 characters are refused (a lid could not show them). A file with more than 8 parts (the machine's limit) asks for no names.
- **M2:** a round waits at most 1.5 s for names on their way, then closes them.
- **M3:** after a run the panel is in the result column under the verdict, sized to the room left above the action bar. Measured at 1280 and 1100: it covers no verdict, answer list, action bar, ring or part, and "Change the code" still takes clicks.
- **m1:** with a part panel open, digit keys answer nothing. **m2:** "Has a throw (line N)" instead of "Can throw". **m4:** duplicate or look-alike names are refused. **m5:** names are shared by copies that differ only in comments or spaces (`src/code-fingerprint.ts`, moved from the page).

## The example's names, recorded

Two real `muse-wonder-1.0` calls on the built-in example (both lines are in `tests/evidence/usage/usage.jsonl`):

1. $0.0045 (497 tokens in, 125 out): "price lookup", "retry with waits", "growing wait calculation", "timed pause helper". Two were too long for a lid.
2. After the prompt asked for 16 characters or fewer: $0.0050 (519 in, 146 out): getPrice "price lookup", fetchWithRetry "retrying fetch", backoffMs "retry wait time", sleep "pause execution". Kept in `src/example-names.ts`; they pass the new check.

## Limits

- **A name can still mislead.** Plain code checks a name's form and its words, never whether it is true of the code. The screen says they are Meta's AI's words, not a check. A word list can't catch every judgment; and it also refuses some honest purposes ("input validation", "test helper", "error handler", "fixture loader").
- **After a run, on a short window or a long result column,** the panel needs room: when less than 140 px is left above the action bar, the column scrolls so the panel shows, and the top of the verdict can scroll out of view (it is never covered).
- **"Change the code and bet again" asks for names after the round is made,** so that round has no names on the lids or for the bettors (they match, but the person sees split names).
- **Phones show the box chart,** so its boxes keep their exact names, and after a run there is no ringed part to click on a phone.
- Review m3 (two top-level parts with one name share a panel and a name), m6 (names are lowercased, so "URL parser" reads "url parser") and m7 (failed or refused answers are not cached, so a new session may ask again, within the hourly limit and the budget) are left as they are.
- The old small card a click showed (R4's `machine.mjs` checks it) is gone where the panel takes the click; a pipe still shows it.
- Names arrive with no pencil-in animation.
