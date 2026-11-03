# R12 (D73): what blocked a brand-new user, fixed

A new-user review (Nov 3) played Atlas the way a judge would and wrote down every place a new person got stuck, saw
something false, or paid for nothing. This round fixes those findings in the order Dami set, and then runs the
reviewer's own harness on the fixed build for the kinds of file the review never reached.

Where to look: **the table under "Every finding"** says what happened to each finding. **"Every kind of file"** is the
input-to-outcome table. Shots are in `shots/`, the page text of every harness run is in `notes/`, the harness in `harness/`.

## Every finding → what happened

| # | Finding (from the review) | What happened | Test |
|---|---|---|---|
| 1 | **Blocker.** A judge enters the code with no file pasted (README step 1): "this session has no proposal …", no question, no paste box. | **Fixed.** The page kept the example's test from the example's copy of the app; after sign-in the server answers from the invited copy, which never saw it. Now a successful sign-in drops every kept test, clears the session id (the next request starts a fresh one) and lands on the paste box with the three samples. README "Test me" says exactly that. "Back to the example" then plays in the invited copy with no error. | `tests/unit/r12-studio.test.tsx` "lands on the paste box…" (fails on the old code: it times out on the stuck page) |
| 2 | **Blocker.** A failed call (`TypeError: fetch failed`, no response) was settled at its worst case (~$0.34): 8 failures charged $2.68 while Meta reported $0.29. | **Fixed (narrowed in review round 1).** $0, no hourly call used, and one automatic retry ONLY when the connection never opened: the error code (on the error, its `cause`, or every inner error of a happy-eyeballs `AggregateError`) is ENOTFOUND, EAI_AGAIN, EAI_NONAME, EAI_FAIL, ECONNREFUSED, ENETUNREACH, EHOSTUNREACH, UND_ERR_CONNECT_TIMEOUT, ERR_TLS_CERT_ALTNAME_INVALID, UNABLE_TO_VERIFY_LEAF_SIGNATURE, UNABLE_TO_GET_ISSUER_CERT(_LOCALLY), SELF_SIGNED_CERT_IN_CHAIN, DEPTH_ZERO_SELF_SIGNED_CERT or any CERT_*. Anything after connecting (ECONNRESET, UND_ERR_SOCKET "other side closed", a headers timeout, an unknown or missing code), a timeout, a cut-off body or an answer with no usage stays at its worst case with no retry. Words (placeholder): "Meta's AI didn't answer (network error). Try again." The outline call's own timeout is now 290 s, so it always fires before Node's 300 s wait for response headers. | `tests/unit/r12-newuser.test.ts` finding 2 (7 tests, two with a real local socket: a closed port → $0 and one retry; a server that reads the whole request then hangs up → worst case, exactly 1 request) |
| 3 | **Major.** A code gets 15 model calls an hour (~3 files). | **Fixed.** `fly.toml` sets `ATLAS_MODEL_CALLS_PER_HOUR = "400"` (100 an hour per code) with a comment. The limit now says when it frees up ("The next one frees up in about 50 min"). **Found:** a per-address cap of 20 "model rounds" and 60 pastes an hour still binds first for one judge on one network (my harness hit both). Not changed. | finding 3 tests |
| 4 | **Major.** Syntax errors found only after the paid summary, test and bets; prose triggered 2 paid calls. | **Fixed.** `src/paste-precheck.ts` reads the file before any model is asked. JS/TS: the TypeScript parser Atlas already uses (syntax errors only). Python: a small local check (no Python on the hosted server): unclosed string or bracket, a missing ":" on a block line, a block with nothing indented under it. The parser's line, column and message are shown; the file goes back in the box. | finding 4 tests + studio test "a syntax error, then prose … 0 model calls" |
| 5 | **Major.** Wrong advice for `export class Counter`; Java read as pasted.js after a paid call; Solidity and Bash "has none". | **Fixed.** Java, Solidity, Bash, Kotlin, Swift, C/C++, Go, Rust, JSON, a web address, Markdown and JSX are named before any call. A class-only file says "Atlas calls exported functions; this file exports a class (Counter). Export a function that uses it." (placeholder) and asks no summary or names. | finding 5 tests + studio "exports only a class" |
| 6 | **Major.** The proof card printed Muse Spark's seal as the person's (`file.bets[0]`). | **Fixed.** `personSealHash` picks the bet whose `who` is `human`; no human bet, no seal. | finding 6 test |
| 7 | **Major.** Shared proof links 404 after a redeploy. | **Fixed the small, safe way.** The kept path already existed (`POST /proofs/:id/keep` → `kept/` on the volume, 30 days, caps 50 per client / 500 in all). "Share proof card" now opens with the public-link question already up, with the same consent words, so the link people copy is the kept one. Saying "Not now" still works; that link now says it lasts up to 2 hours "and not after the server restarts". No-code visitors are not asked (keeping needs a code). | studio "finding 7" (2 tests) |
| 8a | Phone: the fixed foot covers "Not live." and the card's foot. | **Fixed** (room under the bet, the card panel and the entry). Measured at 390×844: "Not live." ends at y=564, the foot starts at 826; the card's last line ends at 689. | `shots/phone-1-question-end.png`, `phone-4-proof-card-end.png`, `notes/phone.txt` |
| 8b | Upload while locked: invite line twice, language picker opens. | **Fixed.** The file waits in the box; nothing is sent. | studio "an upload with no invite code" |
| 8c | "Earlier screens → The retry machine" stuck on 401 with no code. | **Fixed.** The fold checks the code when opened and says "These earlier screens need an invite code." with the waitlist links. | not unit-tested (manual) |
| 8d | Non-code input labelled "A drawing of pasted.js". | **Fixed.** Non-code never reaches the drawing now; a file with 0 parts reads "The pasted file: plain code found no function or class in it to draw." | harness `in-minified-js` |
| 8e | Markdown with a fenced function. | **Fixed.** "Use the code inside the fence" draws just the fenced code; with no readable fence it says "Paste just the code." | studio "Markdown with a fenced function" |
| log | Repo outline draws nothing for jonschlinkert/is-odd; reload mid-run loses the verdict; blank page 8–11 s on a slow network; consent line on the no-call example. | **Logged, not fixed** (as asked). | – |

### Also fixed while running the harness (small, blocker-class for a new user)

- **JSX** (`component.jsx`): the runner's own scanner said "a regular expression on line 8 is never closed" (false). Now: "This file has JSX (a tag like `<div>` in the code, line 6). Atlas runs plain JavaScript, TypeScript or Python with no packages…". A TS generic arrow, a `<string>x` assertion and comparisons are not taken for JSX (tested).
- **Two reasons at once** on a dead end (minified bundle: "has no function" AND "uses CommonJS"): the dead end now shows the code's own reason once.
- **TypeScript with no TypeScript sign** (`new Set<string>()`) was guessed as JavaScript; a file only the TS parser reads is now TypeScript.
- **"No summary this time: Meta's AI was slow…"** was shown when a spend limit stopped the call. Now: "wasn't asked (a limit was reached), was slow, or its words didn't pass Atlas's checks."
- A per-address limit sentence ran into the next one ("…about 42 min You can…"); it now ends with a full stop.

### Found, not fixed (report)

- **Per-address caps bound before the per-code one** (defaults: 20 model rounds, 60 pastes an hour per address). **Review round 1 (decided):** `fly.toml` now sets `ATLAS_MODEL_ROUNDS_PER_IP_PER_HOUR = "60"` and `ATLAS_PASTES_PER_IP_PER_HOUR = "150"` (a judging panel may share one office address; the $ ledger still caps money).
- **Small daily budgets refuse calls while others are in flight.** The ledger holds each call's worst case (~$0.33 for a pasted file) until it settles, so three calls at once hold ~$1. With my $1 ceiling, `many.ts`, `big2000ok.js` and `unicode.js` got "spend limit reached ($0.82 of $1.00)" while real spend was $0.50. **Review round 1 (decided):** `tools/fly-setup.md` now makes the judge code with `--daily-usd 10` and says why.
- **Python `input()`** is called "the network/files (builtins.input)": true that it's refused, wrong about what it is. The wording is shared with recorded proof files, so not changed here.
- **Names and summary are still asked** for a file that can't run (needs `fs` or a package): about $0.01–0.015 each (`fsread.js`, `imports.ts`).
- **"Re-run it"** on a no-code visitor's proof card is offered and would answer 401.
- **Residual risk of fix 2 (after review round 1):** only a connection that never opened is $0. If a resolver or proxy ever reported a never-connected code after a request was sent, it would be booked $0; none of the listed codes can come from a socket that already carried the request.
- The Python check is partial on purpose: any Python error it misses is still reported by Python at run time (as before).

## Review round 1 (coordinator, on 8fe92f1)

1. Money: narrowed fix 2 to connections that never opened (above), dropped "nothing was charged", outline timeout 290 s.
2. No local paths: the harness finds Playwright through `PLAYWRIGHT_FROM` (a folder whose `node_modules` has it; default the current folder) and its scratch folder through `R12_SCRATCH` (`judge.mjs`/`phone.mjs` take it as their argument). `vitest.txt` is regenerated from the final commit with the repo folder written as `<repo>`.
3. The language picker shows after a parser refusal; choosing Python reads the file as Python (studio test).
4. The shell check reads the block words with strings and comments blanked (a JS template literal holding `then`/`fi` is not Bash; test).
5. `fly.toml` per-address caps and the $10 judge code (above).

## Every kind of file (the reviewer's harness, on this build)

Run against a local server built from this branch (`ATLAS_REQUIRE_INVITE=1`, a throwaway dev code in a scratch store,
local sandbox, `ATLAS_SPEND_CEILING_USD=1.00`). "precheck" = answered by plain code before any model call ($0).
Spend per row is the real Meta usage the run added.

| Input | Category | Outcome on screen | Model $ |
|---|---|---|---|
| syntax.js | syntax error (JS) | parser line 3, column 26: ')' expected; file back in the box | $0 |
| syntax.ts | syntax error (TS) | line 2, column 21: Expression expected | $0 |
| syntax.py | syntax error (Python) | line 1, column 17: expected ":" at the end of this `def` line | $0 |
| big2000.js | 2,000 lines, cut mid-function | line 2001: '}' expected (the reviewer's file is truncated) | $0 |
| prose.txt | prose | "This looks like plain text, not code." | $0 |
| data.json | JSON | "This looks like JSON data, not code." | $0 |
| url.txt | a URL | "This looks like a web address… use the GitHub box" | $0 |
| readme.md | Markdown + fenced function | "Markdown with JavaScript code in a ``` fence" + Use the code inside the fence | $0 |
| Main.java / token.sol / script.sh / main.go / lib.rs | other languages | "This looks like Java / Solidity / a shell script (Bash) / Go / Rust" | $0 |
| component.jsx | JSX | "This file has JSX (… line 6) … can't run a React component" | $0 |
| onlyclass.ts | class only | "Atlas calls exported functions; this file exports a class (Counter)…" | $0 |
| nofunc.js / noexports.js | nothing to call | "draws functions and classes, and this has none" / "can't see one … like export function f" | $0 |
| minified.js | minified bundle (IIFE + CommonJS) | one reason: uses CommonJS exports, write `export function` | $0 |
| imports.ts | npm imports | "the code needs lodash"; drawing kept, Edit this file | ~$0.003 (names) |
| fsread.js | fs / child_process / net | "the code needs Node's built-in module fs" | ~$0.014 (names, summary) |
| tiny.js | tiny function | question → verdict: returned true | ~$0.014 |
| many.ts | 12 functions (9+) | box chart ("more than the 8 the machine can draw"), summary + 12 part lines; test refused by my $1 ceiling's holds, page offers Write your own test | ~$0.019 |
| big2000ok.js | 1,995 valid lines | drawn in 96 ms, "399 functions… here are the first 40"; test refused by the $1 holds | $0 |
| async.ts | async | verdict: threw TypeError … after 1 call to fetchUser | ~$0.045 |
| generator.js | generator | verdict: returned 0 | ~$0.047 |
| recursion.py | recursion | fib(50): can't check, ran past 10,000 ms of real time | ~$0.033 |
| closure.js | closures | verdict: returned a function | ~$0.031 |
| defaultarrow.ts | default-exported arrow | `default([])` → verdict: returned NaN (first run hit the 20-rounds-per-address cap, re-run with the cap raised) | ~$0.031 |
| forever.js | forever loop | can't check: ran past 10,000 ms of real time, stopped | ~$0.045 |
| exit.js | process.exit | can't check: tried to end the process | ~$0.043 |
| env.ts | env vars | verdict: returned "none" (no env in the sandbox) | ~$0.037 |
| netfetch.ts | network fetch | Atlas's fake fetch (labelled) → returned the page's first 50 chars | ~$0.043 |
| pyinput.py | Python input() + requests | fake requests (labelled); can't check: input() refused (wording issue above) | ~$0.051 |
| unicode.js | unicode | drawn; test refused by the $1 holds | ~$0.004 |
| crlf.js | CRLF line endings | question ready (`add("2", 3)`) | ~$0.018 |
| tabs.js | tabs | question ready (`pad("hello", 3)`) | ~$0.032 |
| inject.js | prompt-injection comment | verdict: divide(1, "0") returned Infinity; no part named "safe"/"verified", summary neutral | ~$0.046 |

No run ended stuck or blank. The only screens that stopped short of a question did so with a sentence and a way on.

## Shots

- `judge-1-first-screen.png`, `judge-3-landed-on-paste-box.png` (1280×800 at 2×): a judge's sign-in with no file lands on the paste box with the samples enabled. The code is never in a shot (the typed-code shot was deleted).
- `phone-1-question-end.png` … `phone-4-proof-card-end.png` (390×844 at 2×, no code): "Not live." and the card's foot clear the fixed foot.
- `in-*-2-question.png` / `in-*-4-after-bet.png`: the precheck screens and a few runs from the table.

## Counts

- `tsc --noEmit`: clean (`tsc.txt`).
- `vitest run`: see `vitest.txt` (final commit; counts in the commit message). New: `tests/unit/r12-newuser.test.ts` and `tests/unit/r12-studio.test.tsx`. Changed expectations, on purpose: `g1-review1`, `limits` (the limit now says when it frees up), `r3-fix3` (the full stop).

## Spend

$0.5704 of real Meta usage (67 calls) on the throwaway code, all from the harness and shots above; unit tests are $0.
