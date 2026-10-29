# U2: fixes from the cold first-time-user walkthrough (D53)

Date: 2026-10-29 (WAT) · branch `u2-journey` from main 6b8c5ca · live spend **$0.417** (4 live walkthroughs, real models, cap $0.50) · Node 25.8.1, Python 3.14.7, local executors.

## Where to look first

1. **The scores, before and after** (next section). This is the result.
2. **The run playing on the drawing**: `screens/film-ts-light-play-600ms.png` → `-2000ms` → `-5000ms` → `-5-marked.png`. The same in a headed (windowed) Chromium: `screens/headed-ts-light-play-*.png` and the video `screens/headed-ts-light.webm`.
3. **The live walkthrough** with the walkthrough's own two files and real Muse Wonder / Muse Spark / Muse Spark Open: `live/ts-*.png`, `live/py-*.png`, and the step-by-step logs `live/ts-walk-log.txt` and `live/py-walk-log.txt`.
4. **Review round 1** (an adversarial reviewer) found 5 majors. All are fixed, each with a test. See "Review round 1" below.

## Scores: same files, same five steps

The persona is a TypeScript/Python developer with 5 minutes and no explanation. The two files are `inputs/code1.ts` (`fetchWithRetry`) and `inputs/code2.py` (`RateLimiter`/`run_all`). The "after" run used the final code (after review round 1), real models, and a fresh session for each file.

| Step | Before | After | Why it moved (or did not) |
|---|---|---|---|
| Start | 4/5 | **4/5** | Unchanged. The drawing still appears in under 1 s. "Draw it" still looks disabled before you paste, and the lower slab still says nothing on hover. Neither was in this batch. |
| Predict | 2/5 | **4/5** | The bet now opens on a test worth betting on. TS: Wonder's tests carry a fake `fetch`; the live default was "never answers", or "500, 500, then 200". Python: `run_all([1..5], 2)`. Every term has a one-sentence explanation (simulated clock, the seed, time zone, watch limit, fake network). The AIs are introduced by role with their Meta names, above "Seal my answers". **Still weak:** when nothing in the test scripts a wait, the time question offers only "0 ms / more than 0 ms". For the rate limiter, the time is always "can't check" (D45: the code times its own work). |
| Explore | 2/5 | **4/5** | After sealing, the run plays for about 8 s. Atlas calls the function, each fetch call lights the fetch device with its scripted answer, each wait lights the waiting parts and moves the needle, and the ending shows on the function. "Play the run again" plays it all again. "Proof card" opens a panel in place. **Still weak:** the lit parts are subtle (a darker lid and edges), and a loop's iterations show only as waits, not as a counter. |
| Compare | 3/5 | **4/5** | A large headline, e.g. "You matched 0 of 3 checkable answers. Muse Spark 1.3 matched 3, Muse Spark Open 3." The marks use a tick, a cross and a dashed "?", always with words beside them. The measured number is shown with its option ("4 times (2 or more times)", "[2,4,6] (another value)"). The thrown value is said plainly ("throws AbortError: This operation was aborted"). A reason every answer shares is said once. |
| Continue | 2/5 | **4/5** | Live, Python: Wonder's sentence after the run was "…a low rate such as 0.5 … hangs forever". "Test this claim" (8 s) opened `run_all([1,2,3], 0.5)`, which was still running at 10,000 ms, and the time bet "more than 0 ms" matched. Live, TS: the claim "returns null for a 404" led to a 404 test. The "found in this code" labels are listed as next things to try. **Still weak:** each new test waits 8–20 s for Wonder. |

These scores are mine, the builder's. The walkthrough was cold in the sense that it used the same files and the same steps with no setup, but I wrote the fixes, so my eye is not a stranger's. A real first-time user is the honest next test.

## What changed, in plain words

### 1. Network fakes (D53)

Before, both of the walkthrough's TypeScript tests ended "can't check" for the whole run, because the code calls `fetch` and Atlas blocks the network.

Now a test may carry one **network fake**: a scripted stand-in for the library the code calls. That is the global `fetch` in JS/TS, and `requests`, `urllib.request` or `httpx` in Python. It has the same contract as a stand-in:

- each call does one scripted step, in order: answer with `{status, body}`, throw one of the library's own network errors by name, or never answer;
- after the last step, it repeats the last step or throws.

Atlas installs it in the sandbox in place of the library. The real network stays blocked, and any network use the fake does not cover is still "can't check" for the whole run.

- **Counted like a stand-in:** its calls are `calls:fetch` (or `calls:requests`, …). That is a quiz question, and the fake is a device with a lamp on the drawing.
- **In every bettor's text (D19):** what the fake does, how a never-answer ends, and that the network is blocked. The page's text and both models' prompts are byte-identical (server test).
- **Quiz (D48):** call counts come from its steps, values from its 2xx bodies, and time marks from its answer delays.
- **Gate:** it checks the library against the file's language, the error names against the library's own, the status range, and that no stand-in shares its name. Its texts count toward the same 4 KB budget as the arguments.
- **What the fakes do, like the real libraries (fixed in review round 1):**
  - fetch:
    - a Response-like answer whose body can be read once;
    - `text()` and `json()` agree, because the body on the wire is the body's compact JSON;
    - the code's `AbortSignal` (including `AbortSignal.timeout`) ends a never-answer with the abort reason;
    - with no abort, Node's own fetch gives up at 300,000 ms with "TypeError: fetch failed".
  - requests:
    - `status_code`, `json()`, `raise_for_status()` ("503 Server Error: Service Unavailable for url: …");
    - exceptions in the real hierarchy (Timeout, ConnectionError, HTTPError, …);
    - `timeout=` (a number or a `(connect, read)` pair) ends a never-answer with ReadTimeout;
    - with no timeout, a call that never answers is still running at the watch limit.
  - httpx:
    - sync and async clients;
    - the 5 s default timeout, and `timeout=None` means wait forever;
    - `raise_for_status()` raises for anything that is not 2xx.
  - urllib.request:
    - `urlopen` raises `HTTPError` for a status of 400 or more;
    - `urllib.error` and `urllib.parse` still work.
- **Never offered if it can't run:**
  - plain code reads the file's text for network use (`src/network-fake.ts networkUse`);
  - a Wonder proposal without the fake the code needs is refused with that reason (`server/meta/roles/proposer.ts`);
  - the picker shows only allowed tests, plus a quiet "N tests Atlas couldn't run were left out".
- **Python packages:** `requests` and `httpx` no longer make the whole paste "can't check". A test without their fake is refused before running, with the network reason.
- **Trust:**
  - JS: the fake lives in the harness closure and is removed after each run.
  - Python: the fake modules are in `exposed.py`, which is assumed hostile. Each call goes through a harness-owned generator (`network_gen`) that holds the count. Changing `_NET` is caught as tampering.

### 2. The default test (`src/default-test.ts`)

Among the allowed proposals, the bet opens on the highest score. A tie keeps Wonder's order.

| Points | When |
|---|---|
| +3 | a stand-in or the fake fails at least once and then answers (the retry path) |
| +2 | something never answers |
| +1 | any failure at all |
| +1 | any scripted wait |
| +1 | it uses any device |
| +1 | the test sets its own watch limit |
| −5 | a negative number anywhere in the arguments |
| −2 | a whole argument that is 0 or empty |

Exception: "Test this claim" opens on Wonder's first allowed test, which is the one aimed at the sentence. The scoring rule would steer away from a zero that the sentence is about.

Wonder's prompt now asks for retries, failures, waits and hangs, with realistic arguments, and says that a network fake is required when the code calls the network.

### 3. The run plays visibly

- **What plays:** the harnesses record where the virtual clock jumped (one `clock_moves` event; display only, never judged).
- **The sequence:**
  1. "Atlas calls f";
  2. each call lights its device with the scripted answer;
  3. each wait lights the parts whose own lines wait (plain code: `setTimeout` / `sleep` / …), and a late answer lights its device instead;
  4. the needle follows the clock;
  5. the ending shows on the function.
- **Pace:** about 6 s of steps plus an intro and an outro. At most 40 steps; waits are thinned and every call is kept.
- **The dial:** when the run goes past the test's dial, the dial rescales to a round number above it and the clock chip says so ("· dial now 0–25,000 ms"). A call still running is drawn at the watch limit.
- **Measured:** 7.7–8.5 s per play, headless and headed. The replay plays again visibly. Reduced motion shows the end state at once.

### 4. Plain words in the bet panel

All new strings are in `src/paste-words.ts` (`BET_WORDS`, `STAGE_WORDS`, `RESULT_WORDS`). The wording lint passes; the lint itself caught "fixed" and I reworded it to "pinned to one seed".

- **The intro line:** "Two AIs bet too, without seeing your answers: Muse Spark 1.3 (Meta) and Muse Spark Open (Meta, open weights)". This line and the who-bets picker sit above "Seal my answers".
- **"What every bettor sees"** wraps.
- **The deck plate** reads "stand-ins". It used to be "Atlas's stand-ins", which was cut off as "Atlas's st…".
- **The hover card:**
  - before a test, it says "Atlas tests this function when you bet";
  - Python functions say "top-level (Atlas can call it)", not "exported".

### 5. Compare

- the headline;
- distinct glyphs;
- one shared reason said once;
- a declined answer is said as "can't tell", never as "could not be checked".

### 6. Continue

"Test this claim" sends `/paste/proposals {claimOf: experimentId}`.

- The server looks up the sentence itself, and only after it was shown (404 before).
- The page never sends the text.
- The new tests are gate-checked as usual.
- The per-session cap is now 6 Wonder asks (it was 3).

### 7. Bugs

- **A call still running at the watch limit, for timing options:**
  - an option holding every time above the limit matched;
  - one holding none didn't match;
  - any other stays can't check (`src/judge.ts quizBeyondLimit`);
  - new proof files carry `rules.watchLimit: "u2"`, and older files are re-judged as before;
  - verify checks that the trace's watch limit is the experiment's.
- **A bug found by the walkthrough itself:** `run_all([1,2,3], 2)` times its own work, so its settle time is "can't check" (D45). Verify then refused the run's record, so **every** answer became "can't check".
  - Now a settle time the run does not report is not compared.
  - This only applies when the trace's own `clock_differs` / `twin_differs` event names it (tightened in review).
- **Overlaps from NOTES.md:**
  - the readout under the pop-up is hidden while it is open;
  - pins on devices and the clock sit beside the box;
  - chips wrap instead of being cut;
  - the bullets are aligned.
  - **Checked:** 0 HTML text overlaps, and 0 pins or chips over the drawing's engraved labels.
- **"Clicks by accessible name timed out":** the drive checks the element at the centre of every answer button.
  - 0 of 18 (TS) and 0 of 12 (Python) are covered, and every answer is clicked by its accessible name.
  - I could not reproduce a covering layer. The likely cause of the original timeout was answers below the pop-up's fold.

## Review round 1 (adversarial, Opus, read-only)

| Finding | What broke | Fix | Test |
|---|---|---|---|
| M1 | The replay crashed on a run that threw with no reported settle time | "at X ms" only when measured | `u2-network.test.ts` M1 |
| M2 | `fetch` + `AbortSignal.timeout` + never-answer ended "can't check" (only unref'd timers left) | an open fake request keeps the run alive | M2 (TimeoutError at 5,000 ms) |
| M3 | A body could be read twice; `arrayBuffer` was missing; fetch could throw synchronously | read-once, `arrayBuffer`/`bytes`, rejection | M3/M4 |
| M4 | A string body gave `text()` = `nope` and `json()` = `"nope"` | one wire text (compact JSON) in every fake | M3/M4 |
| M5 | httpx `timeout=None` timed out at 5 s | an explicit None waits forever | M5 |
| m1 | httpx `raise_for_status` ignored 3xx; error messages had no reason phrase | non-2xx raises; reason phrases | m1 (302) |
| m3 | A method named `fetch` read as a network call; a property named fetch hid calls; an unclosed quote shifted line numbers | definitions skipped; declarations only at top level; line kept | m3 |
| m5 | The abort reason's name was always "AbortError"; a late answer lit the code's waits | name from the reason; device lit | u2-ui |
| m6 | "fetch has no timeout of its own" is false in Node (300 s) | the 300 s give-up modelled and said | m6 |
| m7 | The verify relaxation accepted any reason | needs the differs event naming `virtualMs` | m7 |
| m8 | The judge read the watch limit from the trace only | verify checks it against the experiment | (verify) |

Not fixed, logged:

- **m2 (part):** `import json; import requests` on one line and `__import__("requests")` are not read as network use. The test then ends "can't check" (an honest verdict, but a wasted test).
- **m4:** a person's own or edited test gets no "you need a network fake" warning before betting. It ends "can't check" at run time, honestly.
- **m9:** after "Test this claim", the person has seen Wonder's earlier sentence and the models have not. This is allowed by D18 (the models never see Wonder's sentences), but it is asymmetric.

## Checks

| Check | Result | Where |
|---|---|---|
| Browser click-through, headless, light + dark, both files: before-bet rule, hover card, answers reachable by name, AIs line above Seal, bettor text wraps, the run plays ≥ 4 s with lamps/parts/needle/chips changing, headline, replay plays again, proof card opens as a panel, "Test this claim" offered | **ALL CHECKS PASSED** (116 PASS lines) | `screens/browser-output.txt`, `screens/checks.json` |
| Same round in **headed** Chromium (a window), both files, light; video recorded | pass | `headed-*` and `headed-ts-light.webm` |
| axe-core (WCAG 2 A/AA + best practice): rest, bet open, marked, proof panel × 2 files × 2 themes | **0 violations** | same |
| Text overlap (HTML) on the stage, pop-up, mark list; pins/chips over engraved labels | **0** | same |
| 390 px: entry, rest, bet, marked, light + dark | no page scroll; mark list and pop-up overlap 0 | `phone-*.png` |
| Reduced motion | end state at once, no lamp lit | same |
| U2 unit tests (network fakes in both sandboxes, gate, D19 byte equality, quiz from the fake, judge rule, verify, default rule, Test this claim through the server, replay script, headline, words) | 25 + 12 pass | `tests/unit/u2-network.test.ts`, `tests/unit/u2-ui.test.ts` |
| Full suite ×3, tsc, no-local-paths | **2,053 passed, 0 failed ×3** (35 skipped); tsc exit 0 | `full-suite-1..3.txt`, `tsc-output.txt` |

## Live walkthrough spend

Usage is in `live/usage.jsonl`. It covers four walkthroughs: two before review round 1 (`live/*-before-review.txt`) and two after (`live/ts-*`, `live/py-*`). Each walkthrough is one bet and one "Test this claim".

| Model | Calls | Tokens in / out | Cost |
|---|---|---|---|
| Muse Wonder 1.0 (tests) | 8 | 10,042 / 8,577 | $0.212 |
| Muse Spark 1.3 (bets) | 8 | 12,488 / 6,196 | $0.174 |
| Muse Spark Open (bets, Baseten) | 8 | 13,552 / 3,967 | $0.032 |
| **Total** | 24 | | **$0.417** |

## What I did not do, and what I am unsure about

- **Time options stay coarse** when nothing in the test scripts a wait. The code's own `sleep`/backoff is not visible to the option builder (D48 builds options from the test only). A claim like "takes over 20 s" can only be bet as "more than 0 ms".
- **The rate-limiter file's time** is always "can't check" (D45). That is honest, but it makes the time question useless for that file.
- **The default rule's −2 for an empty argument** also hits `fetchWithRetry(url, {}, 3)`'s ordinary `{}` options. It hits every such test equally, so the ranking among them is unaffected.
- **The fakes cover the common surface only:**
  - not covered: `requests` adapters/urllib3 retries, streaming bodies, `fetch` `blob()`/`formData()`, aiohttp;
  - code that uses them gets an `AttributeError` or `TypeError` as a measured fact. That is a difference from the real library, though it only happens in code paths the fake does not model.
- **Item 7's invisible layer** could not be reproduced (see above).
- **"Draw it" looks disabled before you paste, and the unlabelled slab:** not touched.
- **The headed check** ran on this Mac's display. The video is 1280×720 (Playwright's recording), and the screenshots are 1920×1080.

## How to run

```
PORT=18851 ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR=1000 pnpm exec tsx tests/evidence/U2/mock-server.ts
ATLAS_API_PORT=18851 pnpm exec vite --port 18852 --strictPort
PLAYWRIGHT_CORE=<playwright-core> AXE=<axe.min.js> ATLAS_PAGE_URL=http://localhost:18852/ [HEADED=1 HEADED_EXE=<chrome>] \
  node tests/evidence/U2/drive.mjs <chromium headless shell> tests/evidence/U2/screens
```

Live:

```
PORT=18861 ATLAS_USAGE_PATH=<scratch> U2_SPEND_CAP=0.5 pnpm exec tsx tests/evidence/U2/live-server.ts
ATLAS_API_PORT=18861 pnpm exec vite --port 18862 --strictPort
PW=<playwright> node tests/evidence/U2/walk.cjs http://localhost:18862/ tests/evidence/U2/inputs/code1.ts ts <out>
```
