# R14: Muse Wonder talks about one part of the drawing, and aims at what you miss

Dami asked for four things, plus "the learning remembers what you get wrong". All four are built on branch `r14-interactive`.
Each new piece of Muse Wonder's text (Meta's AI) works the way R6's names and R9's summary do:

- it is its own call;
- plain code checks every word, and drops anything that fails;
- each has its own hourly limit per person, and all of it shares the one model budget;
- on screen it is in the AI's grey italic ink and labelled "Muse Wonder's words (Meta's AI), not a check";
- none of it is on the proof picture or in the proof file;
- a visitor with no invite code gets none of it (the server answers 401 with the waitlist line, and no model is asked).

**Where to look first:** `live/` (one real session, real Meta calls): `live/8-sample-pick.png` (the pick), `live/11-sample-verdict-steps.png` (captions in the step list and the record line), `live/5-example-ask.png` (an answer after the lock). Then `shots/2-act-with-caption.png` (a caption under the act while it plays, models mocked) and `nocode/G1-panel-getPrice-nocode.png` (what a visitor with no code sees).

## Review round 2 (an independent review of c37cd8b), read this first

The coordinator's decisions, all built. Where this section and the ones below disagree, this one is current.

| Finding | What changed |
|---|---|
| **M-A, parity:** answers were kept by the file's exact bytes, so one extra comment line made a new fingerprint: the AIs lost the answer while the person kept it. | Answers are kept by person and **part name**. Any later round by that person on a file with a part of that name carries them to every bettor, whatever else changed. The "asked since this round was written" refusal (round 1's M1) counts by the same key. Cap: 5 answers per person and part. Test "M-A". |
| **M-B, parity:** Muse's free-text pick reason could still describe behaviour ("keeps waiting on a source that stays silent") that the AIs never saw. | Muse now names only WHICH part (checked against the parts Atlas can call). The words on screen are plain code's: "You often miss <kind>." plus the part's already-checked summary line (the words every bettor sees), or its natural name. The legend says "Muse Wonder chose the part from your record; the words below are Atlas's." |
| **M-C:** 8 wrong captions passed (success on a throw, a timeout on a return…); a step whose words began "steps N" skipped all checks; present-tense "returns" passed on not-yet steps. | Muse never captions the ending: the run's ending, a sequence call's ending and everything after show plain code's words only, and are not even in Muse's prompt. Every other caption must pass a broad outcome word list (return, gets, gives, value, result, succeeds, works, fails, throws, raises, rejects, times out, gives up, done, finished, ends, hangs, never, stalls, forever, completes and their forms; "failure" as a noun stays allowed). A folded step must have the fold's own shape and a field the act writes; nothing but "after the end" fields may follow the ending. The reviewer's captions were not handed over, so the test holds 8 made in the same shapes (all refused) and 5 honest middle captions (all pass). |
| **M-D:** an ask on the example changed its bettor text, so its recorded AI answers stopped replaying (every later example round live and paid; the spent-code fallback broken). | No asking on the example: the panel says "Ask works on your own code" and the server refuses (409). Answers are never put into the example's rounds, even about a part of the same name elsewhere. Test: example rounds stay recorded after an ask. |
| Minor 1: two asks at once could pass the 5-cap. | A slot is reserved before the model call and released after. Test: 10 at once, at most 5. |
| Minor 2: without a browser id (the plugin) answers are keyed by session. | Logged in Limits. With an invite code they are per code. |
| Minor 3: record page wording. | "What you ask is kept" is not shown to a visitor with no code; the first line no longer says answers are never kept, and a line says questions about a part and Muse's answers ARE kept and passed to the AIs. |
| Minor 4–6 | Question box at 16 px (no phone zoom); the panel's buttons and box sit outside its live region; the picked box gets a starred label "★ Muse Wonder's pick for you", not only a tint. |
| Bet timer | The "locked in … s" timer under the bet stops when the run answers (a result or a refusal). |

## Review round 1 (an adversarial review of the first build)

| Finding | What changed |
|---|---|
| **M1, parity:** the ask only checked that THIS round's bet was sealed. With round A done and round B open on the same file (a second tab, or the API with A's id), a person could ask, then bet on B, whose AIs never saw the answer. | Each round remembers how many of the person's answers its bettor text holds. A bet is refused (409, "start a new round… and everyone gets it") if they asked more since. A new round carries the answer. Test "M1". |
| **M2, parity:** only the latest 5 answers were kept, so a 6th dropped the 1st from the AIs' text while the person still knew it. | Nothing is dropped: past 5 answers on a file, no more asks ("You have asked the most questions Atlas keeps for this file"). Test "M2". Still open: answers live in memory, so a restart drops them while the person remembers (see Limits). |
| **M3, parity:** the pick's reason (Muse's words about a part, never in the AIs' text) stayed on screen while a round was open. | Shown only while no round is open. On the example, whose bet opens by itself, the pick is therefore not on screen until a round ends. |
| **M4:** the checker refused underscores, backticks, curly quotes and dashes, so most Python answers failed. | Backticks are dropped, dashes read as commas, underscores and quotes allowed. Test "M4/M5". |
| **M5:** the contradiction check missed "fails with an error" on a returned call and "answers with the price" on a throw, and refused honest lines like "getPrice never returns" or "waits for it to return". | Wider word lists; a word after "never", "not", "no", "without"… is not a claim; on a step where nothing happened yet only a past tense counts. On a run that returned, "fails" is allowed (an earlier try can fail) unless the step is one call's own answer. |
| Minor: endings written "returns"/"throws"; folded steps read by their first step's field. | Both classified from the words. |
| Minor: the record page said "never the question's words" and "the AIs are never told", now untrue for asks; storage line shown when unknown. | A sentence says asks are kept in memory and given to the AIs in later rounds on that file; "never told your record"; no storage line when the server doesn't say. |
| Minor 4 (asks can push a near-cap file's bettor text over the prompt cap: 413 on later rounds), minor 6 (refused picks and captions are not cached, so a reload pays again within the hourly limits; fold and helper step words are not checked against the server's own fold) | Not fixed; listed in Limits. |

## What a person sees

| # | Feature | What a person sees | Where it lives |
|---|---|---|---|
| 1 | **Bet on this part** | Click (or Enter on) any box. Its panel now ends with **Bet on this part**. Pressing it starts a new round on that function: Muse Wonder writes a test for it, one question, and the run plays on that box. A part Atlas can't call (not exported) says so. The bet counts in the record like any other. | `web/screens/Studio.tsx` `betOnPart`, `partActions` (reuses R11's path: a new round with the bet open, then Wonder is asked) |
| 2 | **Captions for the run** | After the run (all bets sealed), one call asks Muse Wonder for one short caption per step. The act never waits: it starts with plain code's words, and Muse's line appears under them when it arrives. After the run, the step list ("What the run did, step by step, with Muse Wonder's words") holds both, folded. With reduced motion the list is open. | `POST /paste/captions` in `server/part-talk.ts`; checks in `src/part-talk.ts`; shown in `web/machines/bench/BenchStage.tsx` |
| 3 | **Ask about this part** | A question box in each part's panel. Before the bet is locked it says "Ask after you lock your bet. Before that, everyone bets on the same words." After the lock: type a question, get up to 60 words about that part, labelled. Off-topic questions get "Muse Wonder answers questions about this part only." | `POST /paste/ask` |
| 4 | **Muse picks a part from what you miss** | Before the bet, a line above the drawing: "Muse Wonder's pick for you: <part>. Its words (Meta's AI), from your record. Not a check." then its reason, e.g. "You often miss questions on how a call ends; this part fetches data with repeated attempts and pauses". The picked box is tinted on the machine. **Bet on this part** accepts; **Pick another part** says to click any box. With no record: "No record yet, so Muse Wonder's usual choice is used…" (no call, $0). On the example, a visitor with no code sees only "Play a few rounds with your own code and Atlas aims at what you miss." | `POST /paste/pick` |
| 5 | **The record** | The verdict adds "Your record: ending questions 1 of 3 matched" once a kind of question has 3 or more bets. The record page now says what Atlas keeps (kind of question, matched or not, whether the test made something fail; never code, question words or answers), where (on disk for an invite code; in memory for a browser with no code, cleared by a restart), and how Muse Wonder uses it (told only the kinds you miss most, with counts; the AI bettors are never told). | `web/screens/TrackRecord.tsx`, `src/part-talk.ts` `REMEMBER_WORDS` |

The pick is shown only while no round is open (review M3). All on-screen sentences are placeholders for Dami (`PART_TALK_WORDS`, `REMEMBER_WORDS` in `src/part-talk.ts`).

## How the parity rule (D19) holds

D19: every bettor, the person and the AIs, bets on the same words.

- **The ask** is refused by the server (409) until the person's bet on that round is sealed. The page shows the "lock first" line instead of the box.
- **An answer is kept for the person and the file** (invite code, else browser). Every later round on that file puts the question and the answer into the text every AI bettor gets, labelled as Muse Wonder's words. So asking about a part after round 1 and then betting on it in round 2 gives the person nothing the AIs don't have. This holds across tabs and sessions (unit test "D19 across sessions").
- **Captions** are written only after the run has finished, when every bet is sealed and judged.
- **The pick is not in the AIs' text.** X3's rule is that betting models never see a person's record. The pick's reason passes the summary's checker (no word about how a call ends, no number), so it names a role, not an ending. This is a judgment call for Dami (see Limits).

## Plain code's checks

- **Pick reason:** the file summary's own checker (`checkSummaryLine`): no ending words ("returns", "throws", "gives up"…), no numbers as digits or words, no judgment words; up to 22 words. The part must be a function Atlas can call in that file.
- **Captions:** up to 12 words, no digits, no claim words ("safe", "correct", "works", "fixed", "bug", "first"…). Plain code also works out what each step was from its own copy of the run and refuses a caption that contradicts it: a return on a step that threw, a throw on a step that returned, an ending on a run that never ended, a return or throw on a wait. If the page's steps don't match the recorded run at all (a made-up call, an ending that differs), the request is refused before anything is asked.
- **Answers:** up to 60 words, no claim words. "Off topic" is the model's own flag.

## Results

| Check | Result | File |
|---|---|---|
| `tsc --noEmit` | clean | `tsc.txt` (empty) |
| Full vitest | after review round 1: 171 files passed, 1 failed, 2 skipped; **2,799 tests passed, 1 failed, 36 skipped**. The one failure is a time limit in a file R14 does not touch (x3-failure-labels M3: 78.7 ms against 50, under load); run alone it passed 3 of 3 (`vitest-timing-rerun.txt`). Before the review the full run was 2,798 passed, 0 failed. | `vitest.txt` |
| New unit tests | `tests/unit/r14-part-talk.test.ts`: 24 tests (checkers with attack lines; ask refused before the lock with 0 calls; answer refused for claim words; off topic; hourly limit; answers in the next round's bettor text and on the page, across sessions, and not for another person; pick with no record asks nothing; pick prompt holds kinds and counts only; outcome-leaking reasons refused; captions refused before the run and for steps that don't match; contradicting captions dropped; none of the three on the proof card or in the proof file; the record page's words) | |
| Changed test | `tests/unit/g1-invites.test.ts`: the three new routes added to its table of spending routes (each must answer 401 without a code) | |
| Page checks, models mocked ($0) | 21 of 21 (after round 2) | `shots.txt`, `shots/` |
| Page checks, no invite code ($0) | 9 of 9: no request to the three routes, waitlist lines in the panel, "Lock in my bet" above the fold at 1280×800, 1440×900, 390×844 | `nocode.txt`, `nocode/` |
| Live session, real Meta calls | all four features on the example file and on the "Fetch with retry" sample | `live/log.txt`, `live/answers.json`, `live/*.png` |

"Lock in my bet" stays where it was: y = 533–575 of 800 at 1280×800, 526–568 of 900 at 1440×900, 709–751 of 844 at 390×844 (the same numbers R9 measured), because the pick sits in the drawing's column.

### The live session (Nov 3, local server, invite codes on, a throwaway code made for this run)

1. Example, before any bet: pick says "No record yet" ($0, no call).
2. Example round: 14 captions came back, 0 refused (e.g. "Fetch attempt throws an error from flaky source", "Overall fetch throws the last error after waiting").
3. After the lock, asked about getPrice: "It hands the given fetchQuote function to fetchWithRetry, asking for up to three tries starting with a 100 millisecond wait that doubles each time, and returns whatever value fetchQuote eventually gives or the last error it throws." Then **Bet on this part** on getPrice: Wonder wrote a getPrice test; the run threw; 15 captions, 0 refused.
4. "Fetch with retry" sample: the record now had 2 misses on how a call ends. Pick: getJson, "You often miss questions on how a call ends; this part fetches data with repeated attempts and pauses". Accepted, bet, run returned nothing; 8 captions, 0 refused; the verdict said "Your record: ending questions 1 of 3 matched".
5. Asked about getJson ("Why does it wait after a failed try?"): "getJson pauses after each attempt that does not return data, waiting 250 milliseconds longer each round, so the next fetch starts a bit later instead of immediately, until the tries run out" (32 words).
6. Record page: "Kept for your invite code on this server, on disk: it is still here after a restart."

## Spend

| What | Calls | $ |
|---|---|---|
| Live session (3 caption calls, 2 answers, 1 pick, 2 Wonder test sets, the sample's names and summary, 4 AI bets) | 14 | 0.1364 |
| Page checks and unit tests (all mocked) | 0 | 0 |
| **Total** | 14 | **0.1364** (cap $2.00) |

All 14 lines are in `tests/evidence/usage/usage.jsonl` (appended by the server's client).

## Limits and what I did not do

- **The pick is shown to the person, not to the AI bettors.** Its reason passes the summary checker, so it says a role, not an ending, but it is still words about the code the AIs don't get. Giving it to them would tell betting models the person's record, which X3 forbids. Dami's call.
- **The pick changes what D67 said.** D67: "Atlas must not claim Wonder is aimed at you." The pick is the first place Wonder visibly aims at the person's record. The screen says "from your record" and "not a check"; it does not claim the pick is right.
- **Captions are checked against what plain code knows, not against the truth.** A caption can still be vague or slightly off on a step plain code can't classify (a helper step, a folded step). The label is the defence, as with the names.
- **Answers may contain numbers** (a wait in ms, a count). They come after the lock, but they can be wrong. The label says so.
- **A visitor with no code gets no captions** and no line saying captions exist.
- **"Bet on this part" on the example's getPrice** ends, after the run, on the box chart, not the machine, at 1280×800 and 1440×900 ("words would be under 11 px"). That is the R5 size rule on that drawing (getPrice + its stand-in), not R14; the act and its captions then play only in the step list.
- **In the live session the sample's run took about a minute in the local sandbox**, so the driver's 60 s wait for a caption under the act ran out; the captions were in the step list (`live/11-sample-verdict-steps.png`). The mocked run shows one under the act (`shots/2-act-with-caption.png`).
- **Not checked:** the hosted Fly app (not touched), phone layout of the part panel's new controls (390×844 was checked for the lock button only), Python files in the live run, a file with more than 8 parts in a browser (the panel was checked in code: `partPanel` answers for every part of a 10-function file).
- **Answers about parts live in the server's memory.** A restart (or more than about 1,000 people) drops them; a person who asked still remembers, and later rounds' AIs no longer get them. Storing them with the track record is the fix; not done.
- **Asks add up to about 3,500 characters to a file's bettor text.** On a file near the prompt cap, later rounds can be refused (413). Not checked when the ask is made.
- **Refused picks and captions are not cached**, so a reload asks again (within the hourly limits: 12 picks, 20 captions per person). The words of folded and helper steps the page sends are not checked against the server's own fold.
- **The live session and the screenshots in `live/` and `nocode/` are from the first build**, before review round 1. The mocked page checks (`shots/`) were run again after it: 19 of 19.
- **Without a browser id** (the Muse Code plugin, or no x-atlas-browser header) answers are kept per session; with an invite code they are per code.
- **The pick's starred label on the machine** can sit across a pipe on a crowded drawing (`shots/7-pick.png`).
- **After round 2,** the mocked page checks were run again: 21 of 21 (`shots.txt`) and 9 of 9 with no code (`nocode.txt`). The live session was not repeated (no spend in round 2); its captions on the ending and its free-text pick reason are from the earlier rules.
- **Words are placeholders** (`DAMI:` in `src/part-talk.ts`).

## How to run it again

- Mocked page: `PORT=18141 U3_WONDER_DELAY_MS=800 pnpm exec tsx tests/evidence/U3/mock-server.ts`, `ATLAS_API_PORT=18141 pnpm exec vite --port 18142`, then `PW=<playwright-core index.mjs> CHROME=<headless shell> BASE=http://localhost:18142 node tests/evidence/R14/shots.mjs <out>`.
- No code: start the mock with `U3_GATE_FILE=<file>` (the invite gate on), then the same with `GATED=1`.
- Live (real calls, about $0.14): make a throwaway code with `pnpm tsx tools/invites.ts create --name <x> --daily-usd 2 --dir <empty dir>` (its output holds the code: keep it in a file), start `ATLAS_INVITES_DIR=<dir> ATLAS_REQUIRE_INVITE=1 ATLAS_PUBLIC_ORIGIN=http://localhost:18152 PORT=18151 pnpm exec tsx server/index.ts` and `ATLAS_API_PORT=18151 pnpm exec vite --port 18152`, then `CODE_FILE=<file> … node tests/evidence/R14/live.mjs <out>`.
