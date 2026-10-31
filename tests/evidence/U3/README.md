# U3: fixes from the independent cold walkthrough

Date: 2026-10-31 (WAT) · branch `u3-journey` from main 5f238cd · live spend **$0.288** of the $0.50 cap · Node 25.8.1, local executors only

## Where to look first

1. **The trust bug, fixed:** `tests/unit/u3-wiring.test.ts`, then `live/ts/3-quiz.png`: the fake `fetch` is wired to `fetchPage`, whose own line 4 calls it, no longer to `fetchAllOrders`.
2. **The scores** (next section). They are mine, the builder's, so they are not comparable with the independent tester's.
3. **The real-model walkthrough:** `live/ts/walk-log.txt` and `live/py/walk-log.txt`, each step with a screenshot beside it.
4. **Known limits** near the end. Two of them matter before hosting: sequences are untested on Modal, and no adversarial review ran on this batch.

## Scores

| Step | Tester after U2 (independent) | U3 (self-score) | Why, and what still falls short |
|---|---|---|---|
| Start | 4 | **4** | "bet" is on the landing page and the paste box has a code font. "Draw it" still looks disabled before you paste. |
| Predict | 3 | **4** | The default test now hits an edge. Live: the cache opens on an expiry test, paging on a test that reaches the retry limit. Every answer fits without scrolling. Short: a long test sentence is cut to three lines, and time options stay coarse when nothing scripts a wait. |
| Explore | 3 | **4** | Cables are true and the whole call path lights. Clicking a box pins its card, which now says why a helper can't be tested. Short: lit parts are subtle, and a self-call appears on the card, not as a loop on the drawing. |
| Compare | 4 | **4** | Labels clear the cables and boxes. Short: at 1366×768 the judged list needs scrolling. |
| Continue | 3 | **4** | The claim sits beside the measured facts under "you decide", and the first test takes 6 to 8 s. Short: a claim with two parts gets a test of one part (TS: only the page limit, not the 429 limit), and Atlas doesn't say so. |

These come from one run by me with the walkthrough-style code and real models, not from a stranger. The tester's own code was not saved, so `inputs/` is a reconstruction. A real first-time user is the honest next test.

## What changed, by item

### 1. The drawing shows only cables the code has (done and tested)

- **The bug:** every device was wired to the function under test, so `fetch` looked as if `fetchAllOrders` called it.
- **The fix:** plain code (`src/call-sites.ts`) reads which functions' own lines make the call. A stand-in handed on to a helper (`helper(x, param)`) is followed, up to 4 hand-offs. No call site found means no cable, and the card says why.
- **Decorators** are drawn as wraps, not calls. Calling `get_user_plan` lights `cached` too.
- **Playback** lights every function certainly on the path. With two possible callers it lights only what they share, and the step says "plain code can't tell whether A or B made this call".
- **Cards** list self-calls and calls to fakes.
- **The test:** every cable over 135 files, plus the U1, U2 and walkthrough-style code, is checked against its box's own text by a separate, simpler reading. The test also proves it catches the old false cable. In the browser, the cables are compared id by id.

### 2. A default test someone can get wrong

- **New test shape:** `calls` makes 2 or 3 calls on one loaded file, gate-checked. The last entry must be the experiment's own call. Same-named stand-ins are one stand-in. The waits must fit inside the watch limit.
- **What is measured:** the last call's ending, its value and its own time, while counts are totals over all calls. An earlier throw is noted and the next call is still made. An earlier call that never ends leaves everything unreported.
- **Every run is guarded:** new control cases run first (2 in TS, 3 in Python). If one differs, every verdict is "can't check".
- **The default rule** (`src/default-test.ts`, documented at its top) adds points for edges read from the file's text: a second call on kept state +4, a wait between calls +2, reaching the code's retry limit +4, a fake that keeps saying there is another page +2. It never reads Wonder's sentence (D18).
- **Wonder** is asked for edges and, on code that keeps state, for at least one two-call test.

### 3. Values in the code's own language

`src/literal.ts` writes Python's `True` / `False` / `None` in every sentence a bettor reads, the same for all bettors (D19). Python's own parser confirms each literal equals what `json.loads` gives Atlas. JSON can carry nothing Python can't write, so the refusal path exists but no real value reaches it.

Two things keep older work valid:
- Proof files carry `rules.literals: "u3"`, so older files verify with their JSON words.
- Bench M keeps its frozen words (`wordsAsOf: "e3"`, D51), and its prompt-freeze test still passes.

### 4. Quiz tidy

- Questions come first, and the conditions fold into a closed "How Atlas runs it". The bettor text itself is unchanged.
- "any 4th or later call fails" replaces the internal error name.
- **Returned value:** plain code can't compute it without running the code, so bettors may type a value, matched only when exact. The person and both models get this in the same words. Live, both models used it. For Python files, typed text may use Python's spelling; it is parsed, never evaluated.
- **Fit:** every answer button is visible without scrolling at 1920×1080 and 1366×768, measured for both files.

### 5. "Test this claim"

- The sentence shows while the test is written.
- Afterwards it sits beside the measured facts under "What the run shows about this claim: you decide". Neither a model nor plain code declares it true.
- The button is not offered again.
- On code that keeps state, the round opens on a two-call test. This was added after the live run, which opened on a single call; it is covered by a unit test only.

### 6. Waiting

The pop-up shows the seconds so far and the real step, the drawing stays explorable, and "Write my own test instead" works at once (222 ms in the final browser run, `screens/browser-output.txt`). Wonder's later answer goes to the list and never replaces the person's form.

**First-test latency** (`latency.ts`, `live/latency.json`; one call per setting per file):

| Setting | `orders.ts` | `plan_cache.py` | Tests allowed (ts / py) | Tokens out | Cost |
|---|---|---|---|---|---|
| `low` (before) | 7.5 s | 9.3 s | 3 of 3 / 1 of 3 | 1,268 / 1,247 | $0.0615 |
| `minimal` (now) | 6.5 s | 5.1 s | 3 of 3 / 1 of 3 | 897 / 618 | $0.0415 |

So I switched Wonder to `minimal`: as many valid tests, about a third cheaper, and faster on these two calls. That is one sample each, so it is weak. In the walkthrough, with `minimal`, the first test appeared in 8.1 s and 6.1 s on screen, and claim tests in 4.3 s and 3.8 s. **I never saw the 60 s the tester reported**, so its cause is unknown. The page says "usually under a minute".

These runs also found a real bug: Wonder wrote expiry tests without raising the 30,000 ms watch limit, and the gate refused them. The prompt now asks for it. In the live Python walkthrough, the expiry test was allowed and became the default.

### 7. Small fixes

| Fix | How it is checked |
|---|---|
| A mouse click on a box pins its card; a helper's card says why it can't be tested | browser check |
| "Play the run again" appears only after the first play ended; the play starts after the pop-up closed | browser check |
| Labels clear cables, boxes and engraved text | a geometric check separate from the placement code |
| Spacing between "Write your own test" and "Back to the quiz" | measured in px |
| Plain screen-reader text, with no "skid" or "collars" | browser check |
| Proof card: plain words first; judge file, sha256 and seed folded | browser check |
| Code font in the paste box (`.u1-shell textarea` was overriding it) | computed style |
| "bet" on the landing page | browser check |
| Inline icon in `index.html` | **cause inferred**: see known limits |

## Checks

| Check | Result | Where |
|---|---|---|
| Browser click-through, final code, mocked models: 6 full rounds (TS and Python; light, dark, 1366×768), own-test-during-wait, 390 px, reduced motion | SUITE_BROWSER | `screens/browser-output.txt`, `screens/checks.json` |
| axe-core | SUITE_AXE | same |
| HTML text overlap; labels over the drawing | SUITE_OVERLAP | same |
| 390 px: no page scroll on entry, rest, bet, marked; light and dark | pass | same, `screens/phone-*.png` |
| Full suite ×3 | SUITE_FULL | `full-suite-1..3.txt` |
| tsc | SUITE_TSC | `tsc-output.txt` |
| no-local-paths | SUITE_PATHS | in the full suite |

**One test fails on this branch on purpose until the merge:** `bench-order (h)`. Commit 7cb133e changed `bench/models/run.ts`, and its log entry is in the next commit, 09dcfc7, because a hook blocked `git commit --amend`. Fold those two into one commit at merge. SUITE_FOLD

## Live spend

| Calls | Wonder | Spark 1.3 | Spark Open | Total |
|---|---|---|---|---|
| Latency (`live/usage-latency.jsonl`) | 4, $0.1030 | | | $0.1030 |
| Walkthrough ×2 (`live/usage-walk.jsonl`) | 4, $0.0791 | 4, $0.0874 | 4, $0.0186 | $0.1851 |
| **Total** | | | | **$0.2881** |

The Spark price is an upper bound (Meta publishes none; `server/meta/client.ts` assumes Wonder's).

## Known limits, and what I did not do

**Matter before hosting:**
- **Sequences are untested on Modal.** Everything ran on local executors. The new control cases run first on Modal too, so a difference there makes every verdict "can't check": loud, not wrong. It would still block every round, so try one on the hosted server first.
- **No adversarial review ran on this batch** (cut for time). My own browser pass found a serious bug late: every Python sequence answer was judged "can't check" until the proof-file check learned about sequences. Other bugs of that kind may remain, so an independent read should come before strangers use it.

**Bugs a reader could hit:**
- A claim with two parts gets a test of one part, and the "you decide" panel does not say the rest went untested.
- The sentence "Atlas does not say whether the sentence holds" is true, but nothing maps each fact to a part of the sentence. The reader does that.

**Plain-code reading is text, so it can miss:**
- `const f = fetch; f()` gets no cable. That is honest, with the card saying so, but less helpful.
- A `requests.Session()` made in one function and used in another is wired to where the library's name appears, not to where `s.get` is called. **This is the one known way a cable can still be imprecise;** the test corpus does not contain it.
- Kept-state and limit detection use patterns. A miss only loses the default-test bonus, never a verdict.

**Sequences:**
- A person can edit a sequence's last call, but can't write a new sequence from the form.
- Python runs a sequence inside an event loop and hides it during each plain call so `asyncio.run` should still work. **No test covers that combination.**
- Questions are about the last call only; earlier calls show in the replay and are not judged.

**Not verified:**
- **The 404:** headless Chromium doesn't request icons, so "no 404" passing does not prove the fix. The page had no icon, which makes `/favicon.ico` the likely 404. I did not reproduce it in a headed browser.
- **No video or headed run this batch.** Screenshots are headless. The walkthrough ran before the last two small fixes (claim pick, proof-card wording); the browser checks ran after them.
- **Latency:** see above; one sample per setting.

**Left for the merging session:**
- `docs/build/DECISIONS.md` was not touched (the brief forbids committing `docs/`). These design calls need a D-number: the `calls` shape and last-call measuring, typed returned values for every bettor, Wonder on `minimal`, the edge scoring.
- `pitch/VIDEO-INDEX.md` is not updated, for the same reason. Older screenshots show the false cable and must not be used in the film.

## How to run

```
PORT=18951 ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U3/mock-server.ts
ATLAS_API_PORT=18951 pnpm exec vite --port 18952 --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=http://localhost:18952/ node tests/evidence/U3/drive.mjs <chromium> tests/evidence/U3/screens
```

Live (billed):

```
U3_EFFORTS=low,minimal U3_LATENCY_CAP=0.15 ATLAS_USAGE_PATH=<file> pnpm exec tsx tests/evidence/U3/latency.ts
PORT=18961 U3_SPEND_CAP=0.3 ATLAS_USAGE_PATH=<file> ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U3/live-server.ts
ATLAS_API_PORT=18961 pnpm exec vite --port 18962 --strictPort
PW=<playwright-core> node tests/evidence/U3/walk.cjs http://localhost:18962/ tests/evidence/U3/inputs/orders.ts ts <outDir> <chromium>
```
