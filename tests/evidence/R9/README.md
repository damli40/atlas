# R9: a plain-English summary of the file, before the bet, and sample files for judges

Dami asked for a "full summary of what code does", in the app, for the pasted file, shown **before** the bet, and seen by the AI bettors too. And: "how will a judge test to see the full value... it should be dead simple".

**After the review (round 1), read this first:** the "Review round 1" section below. The summary no longer has an "in and out" sentence, and plain code now refuses any line that says how a call ends or holds a number. The sections after it describe the first build (dcdcb58); where they disagree with "Review round 1", the review section is current.

**Where to look first:** `shots/1-first-screen-1280x800.png` and `shots/1-first-screen-1440x900.png` (the summary above the drawing, "Lock in my bet" on screen), `shots/3-part-panel-1280x800.png` (a part's line in its panel), `shots/4-samples-1280x800.png` (the sample buttons), then the live round in `live/` (`2-drawn-with-summary.png` → `3-bet-question.png` → `4-verdict.png`).


## Review round 1 (coordinator's review of dcdcb58)

| Finding | What changed |
|---|---|
| **Blocker:** `vitest.txt` held a home-folder path (`no-local-paths.test.ts` failed) | The run header is written as `<repo>`, as earlier evidence files do. |
| **Major (coordinator's decision): the summary must not answer the bet** | The "in and out" sentence is gone (any such field in an answer is ignored). `src/file-summary.ts` refuses words about how a call ends or what it gives back (nothing, undefined, null, none, empty, return/returns, raise, reject, result, finish, timeout and their forms; "gives up", "stops after", "times out", "runs out", "gives back", "comes back"), numbers written as words (zero to twenty, thirty to ninety, hundred, thousand, million, half, quarter, once, twice, thrice, dozen, single, double, triple, second to fifth, tenth) and time units (second, millisecond, ms, minute, hour). The prompt now asks for each part's role "as if describing one machine part to a colleague" and never what happens at the end or in a failure case. |
| "failure": role or outcome? | Allowed in a summary line as a noun ("Tries the request again after each failure" says when a part acts, not how a run ends). "fail", "fails", "failed", "failing" stay refused. |
| Minor 1: praise words | Added to the names' list too: stems accura, dependab, trustworth, flawless; whole words sound, soundly, solid, solidly, proper, properly. "solid", "sound" and "proper" are whole words, not stems, so "property" and "soundtrack" still pass. |
| Minor 2: the summary cache | Keyed by the hash of the whole text, comments included: a copy that differs only in comments is asked again (test). **Names were not changed:** they still share one call across copies that differ only in comments. The same change for names is one line in `server/paste.ts` plus flipping R6's test "review m5"; I left it because the brief allowed it only with tests unchanged. A name is 1 to 4 checked words, so the room for a comment to leak is small, but not zero. |
| Minor 3: eviction | Reading a session's summary or names record (when a round's text is written) now touches the session, like the routes do. Not covered by a test (it would need 200 sessions). |
| Minor 5: no summary | One muted line in the summary's place: "No summary this time: Meta's AI was slow or its words didn't pass Atlas's checks." (placeholder for Dami). Shown when the summary was refused, closed as late, limited or failed; not when the server asks no model or the file has no parts. The README "Test me" says "usually". |
| Label | The legend now reads "Summary: Muse Wonder's words (Meta's AI). Its reading can repeat the code's own comments; the run is the check" (placeholder for Dami). |

**Re-recorded under the new rules (real calls, Nov 2):**
- The example's summary: "This file fetches a price from a flaky source while waiting longer between tries." Part lines: backoffMs "Calculates a growing wait before another try.", sleep "Pauses the program for a requested wait.", fetchWithRetry "Tries fetching again while pausing between attempts.", getPrice "Fetches a price using the retry helper." 0 lines refused. $0.0103.
- Both AI answers from the text with that summary: Muse Spark 1.3 and Muse Spark Open both answered "throws". $0.0156.
- `server/example-round.json` now keeps 4 answers: the R7 pair (for a round written before the summary was asked) and this pair. The pair recorded with the first summary was dropped: no text the page writes can match it. Verify still refuses a stripped label (test).

**The new checker on every summary line recorded so far** (`count-lines.mts`, `count-lines.txt`):

| Summary | Pass | Refused |
|---|---|---|
| Example, first recording (dcdcb58) | 4 | 2: the "in and out" sentence ("returns the fetched value…") and fetchWithRetry's "…then gives up." |
| Live sample getJson (dcdcb58) | 2 | 1: "…returns the parsed data or nothing." (the line that answered the bet) |
| Example, re-recorded under the new rules | 5 | 0 |

The unit tests add the reviewer's six probes plus ten more (all refused) and nine ordinary role lines (all pass).

**Suite after the review:** `tsc` clean. Full run (`vitest.txt`): 2,728 passed, 2 failed, 35 skipped, with the machine's load average about 55. The 2 failures were time limits in files R9 doesn't touch (x2-review1 B4, 2,064 ms against 2,000; x3-failure-labels M3, 71 ms against 50). Run alone they passed 3 times out of 4 (`vitest-timing-rerun.txt`). `no-local-paths.test.ts` passes.

**Spend in this round:** $0.0259 (1 summary call, 2 bet calls). **R9 total: $0.0959** ($0.070 before the review).

**Page checks:** 26 of 26 pass (`shots.txt`). New: `shots/6-no-summary-1280x800.png`, the muted line when the summary request fails. `shots/1-first-screen-1280x800.png` and `1-first-screen-1440x900.png` show the new summary and legend, with "Lock in my bet" at the same place.

**Not re-run:** the live round in `live/`. It shows the first build (with the "in and out" sentence that answered the bet). It was not repeated, to save spend.

**Known limits, from the review, not fixed:**
- **M2: a summary can repeat the code's own comments, including misleading ones.** That is shown, not hidden: the legend says so.
- **Minor 4 and minor 7 of the review** were skipped by the coordinator's decision.
- **The word lists can still be beaten:** a summary can describe an ending in words not on the lists. The label is the defence, as with the names.

## What was built, in plain words (first build, dcdcb58)

1. **Muse Wonder (Meta's AI) writes a short summary of the file, in its own call.** `POST /paste/summary` sends only the numbered code and the list of parts plain code drew (`server/meta/roles/summarizer.ts`). It never sees the test, the question or Wonder's sentence about the code, so it cannot leak the answer on purpose. A test checks the prompt for that even when the tests were written first.
2. **What it holds:** what the file is for (one sentence) and one short line per drawn part, keyed by the part's exact name. (The first build also had a "what goes in and comes out" sentence; the review removed it.)
3. **Plain code checks every line** (`src/file-summary.ts`):
   - Caps: at most 35 words or 220 characters per sentence, 60 words for the two together, and 15 words or 110 characters per part line. The prompt asks for about 25 + 25 words and 12 per part.
   - It refuses digits, quotes, dashes and code-like text such as `fetch(url)`.
   - It refuses the same banned word list as the natural names ("safe", "correct", "bug", "fixed", "secure", "throw", "error", "always", "never" and the rest, by their beginnings and after "un", "in" or "non").
   - It also refuses the on-screen phrases Atlas never uses ("first", "caught before shipping", "AI caused", "hangs forever", "re-proven", "research shows") and the name of the AI tool from the Moonwell story.
   - It refuses part lines for parts that were not drawn. A refused line is dropped. Without a usable "what it is for" sentence, there is no summary at all: the page shows nothing, never a stand-in text.
4. **On screen:** a strip at the top of the drawing's column, in the names' grey italic ink, labelled "★ Summary: Muse Wonder's words (Meta's AI), not a check". Under it, a fold opens "What each part does, in its words (n)". Each line names its part, and a click opens that part's panel. The panel itself also shows the line as "Meta's AI says this part: … (its words, not a check)". The drawing moves down by the strip's height, so nothing sits on it. The strip shows before the run only.
5. **Same text for every bettor (D19), with the R6 late rule:**
   - The page asks for the summary at the same time as the names.
   - A round's bettor text waits up to 1.5 s for both together, so the wait is one wait, not two.
   - A summary that arrives after that, or after a round's text was written without it, is closed for that file in that session. It is never shown later.
   - The person's page and both AIs' prompts carry the same lines, labelled as the model's words.
6. **Limits and spend:** each client gets 12 summary calls an hour (`ATLAS_SUMMARY_PER_CLIENT_PER_HOUR`), and the summary shares the model budget. Usage lines go to `tests/evidence/usage/usage.jsonl` through the same client as every other call. Copies of a file that differ only in comments share one call.
7. **Not on the shared proof picture or in the proof file.** A test renders the proof card of a real example run and checks that none of the summary's words appear.
8. **The example on the first screen:**
   - Its summary was recorded once from a real call (`record-summary.mts` → `example-summary-recorded.json`, $0.0133) and kept word for word in `src/example-summary.ts`. It is checked by the same plain code every time it is served.
   - Its recorded AI answers were made from a text without the summary, so they no longer matched the new text. They were **recorded again** with the summary in the prompt (`record-example.mts` → `example-recorded.json`, 2 real calls, $0.0160) and added to `server/example-round.json`.
   - The R7 answers stay too: they are replayed only for their own exact text (a round written before the summary was asked).
   - Both recordings are from Nov 2, so the label "recorded answer (Nov 2)" is true for either. Verify accepts any recorded answer of that model and still refuses a proof with the label stripped (tested on the new text).
9. **Task 2, the judge path:**
   - "Try your own code" now shows "No file handy? Try one of these:" with three short files written for this: "Fetch with retry" (JavaScript; worth a bet: what comes back when every try fails), "Price parser" (Python; what "19.99" becomes in cents) and "Cached lookup" (TypeScript; how often the slow lookup runs when two calls come together).
   - Each goes through the normal `POST /paste`, with live paid calls under the invite. Nothing is special-cased.
   - A placeholder line beside them says a sample goes to Meta's AI like any paste. At 1280×800 the page's own consent line is below the fold on that screen, so this line keeps the consent fact next to the click. Dami writes the final words.
   - README "Test me" is rewritten as a 3-minute path. It is marked `<!-- DAMI: draft wording -->` for /stop-slop and /copywriting.

## Results

| Check | Result | File |
|---|---|---|
| `tsc --noEmit` | clean | `tsc.txt` |
| full vitest suite | **2,727 passed, 35 skipped, 0 failed** (main: 2,704) on the first full run. The final full run, after the last edit, took 299 s under load (the first took 119 s) and had 3 time-limit tests over their limits (sweep 5,116 ms against 5,000; an X2 outline job; X3 labels 125 ms against 50). Those 3 files then passed alone, 30 of 30. None touch R9 code. | `vitest.txt` (final run), `vitest-timing-rerun.txt` |
| new unit tests | 23 in `tests/unit/r9-summary.test.ts`: checker caps and refusals (42 attack lines), the prompt holds no test or sentence, D19 parity in both AIs' prompts, pending → shown, late → closed (fake timers), round-before-ask → closed with no call, refused summary shows nothing, hourly limit, no-model server, the example's kept summary and recorded answers (0 model calls, labelled recorded), the recording's text hash equals the page's, verify refuses a stripped label, proof card and proof file hold none of the summary, the panel line, all 3 samples paste as runnable | |
| page checks at 1280×800, 1440×900, 390×844 (models mocked, $0) | **25 of 25 pass**: summary shown before the bet and labelled; "Lock in my bet" fully on screen and not covered, with the part lines folded and unfolded; the strip does not sit on the drawing; one line per part; a line opens its part's panel; recorded labels intact; samples under the paste box with their consent line on screen; a sample goes through `POST /paste` | `shots.txt`, `shots/checks.json`, `shots/` |
| live round, real Meta calls | sample "Fetch with retry" → summary shown 4.4 s after the click → Wonder's test → one question → bet "returns a value" → Muse Spark 1.3 and Muse Spark Open also bet → the sandbox run returned nothing at 1,500 ms after 3 calls to fetch → **all three matched**. The bettors' text held the summary (`live/bettor-text.txt`). | `live/` |

"Lock in my bet" sits at y = 533–575 of 800 and 526–568 of 900, the same place as before R9, because the summary is in the drawing's column, not the bet's.

## Spend (real calls, all in `tests/evidence/usage/usage.jsonl`)

| What | Calls | $ |
|---|---|---|
| The example's summary, recorded once | 1 (Muse Wonder) | 0.0133 |
| The example's AI answers, recorded again with the summary | 2 (Muse Spark 1.3, Muse Spark Open) | 0.0160 |
| One live round on a sample file | 5 (names, summary, tests, 2 bets) | 0.0407 |
| **Total** | 8 | **0.0700** (cap was $0.50) |

## Limits and what was not done

- **The summary can make the bet easier, or point the wrong way.**
  - On the live sample, it said the file "returns the parsed data or nothing", which is the answer to the ending question. Every bettor, person and AIs, saw it (D19 holds), and all three matched.
  - On the example, it says the file "returns the fetched value after trying up to a set number of times". With the example's test, the run throws.
  - That is the point of a check, and it is labelled as the AI's words, but Dami should know a summary can tip or mislead the bet.
- **"Then gives up"** is in the example's line for fetchWithRetry. The banned list has no word for it. Like the R6 names, the list can be beaten; the label is the defence.
- **The checker forbids digits,** so a summary can never state a count or a time. That is on purpose: those are what the bets ask.
- **Phones:** the strip shows above the chart (max 22% of the height, scrolls inside) and squeezes the chart. Checked at 390×844 only.
- **Two legends** now sit above the drawing ("Summary: …" and "names: …"). They were not merged.
- **Files with more than 8 parts** get a summary too (the names do not). On those, the chart shows instead of the machine. The strip sits above the chart and its note, which was not checked in a browser.
- **Before R9, the R7 recording stays replayable** for a round written before the summary was asked. A test covers it.
- **The hosted Fly deploy was not touched.** Nothing was run against it.

## How to run it again

The page for the drivers is `tests/evidence/U3/mock-server.ts` (every model mocked, $0; now with a mock summary that says it is a mock), started as `PORT=18961 ATLAS_SUMMARY_PER_CLIENT_PER_HOUR=1000 ATLAS_NAMES_PER_CLIENT_PER_HOUR=1000 pnpm exec tsx tests/evidence/U3/mock-server.ts`, plus `ATLAS_API_PORT=18961 pnpm exec vite --port 18962`.

| File | What | Run |
|---|---|---|
| `shots.mjs` | the page checks and screenshots | `PW=… CHROME=… BASE=http://localhost:18962 node tests/evidence/R9/shots.mjs tests/evidence/R9/shots` |
| `live-flow.mjs` | one live round on a sample (real calls, about $0.04) | real server `ATLAS_INVITES_DIR=<empty dir> PORT=18971 pnpm exec tsx server/index.ts`, vite on 18972, then `BASE=http://localhost:18972 node tests/evidence/R9/live-flow.mjs <out> fetch-retry` |
| `record-summary.mts` | records the example's summary (1 real call) | `pnpm exec tsx tests/evidence/R9/record-summary.mts <out.json>` |
| `record-example.mts` | records the example's AI answers from the text with the summary (2 real calls) | `pnpm exec tsx tests/evidence/R9/record-example.mts <out.json>` |
