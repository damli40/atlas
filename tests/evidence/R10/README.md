# R10 (D72): the example plays with no invite code

## What changed, in plain words

Before R10, the hosted site (ATLAS_REQUIRE_INVITE=1) showed an invite-code box and nothing else to anyone without a code.
Now anyone can play the first screen's example end to end: the drawing, Meta's AI's summary and names, the question, their
bet, the AIs' bets (recorded on Nov 2, labelled so), the sandbox run, the verdict and the proof card. The Moonwell replay
was already open (it is a saved file, no chain read). Everything else still needs a code: their own code, the sample files,
"Try another question", "Test this claim", changing who bets, the repo outline, a new Moonwell run, replays, keeping a
public link. There the page says one line and offers **Join the waitlist** (Dami's form, from `ATLAS_WAITLIST_URL`) and
**I have a code**.

How the server knows it is the example (the browser cannot claim it):
1. The gate (`server/access/gate.ts`, `EXAMPLE_ROUTES`) lets a request with no code (or a code that no longer works) reach
   only 14 routes, each listed with why it is safe. It runs the request as the "example" visitor. Any route not listed,
   including routes added later, still answers 401.
2. Each of those routes checks the content against what the server holds: the file's sha256 must be the example's exactly;
   only its one function; only Muse Wonder's recorded tests; only the default (first) question, asked as one quiz question;
   every AI bettor's recorded answer must fit the exact prompt it would get now (sha256 of the prompt). Then bets, the
   model wait, the run and the sentence are allowed only on rounds opened that way.
3. If the recordings do not fit (the example's text changed), the round is refused with a plain sentence (503). It never
   falls back to a live model call.
4. Behind all of that the ledger (`server/access/ledger.ts`) refuses the "example" visitor every model call and EVM run,
   and lets it hold at most 2 sandboxes at once. **Review round 1:** the example now has its OWN daily Modal allowance
   (600 starts and 3,600 sandbox-seconds per UTC day; `ATLAS_EXAMPLE_SANDBOX_STARTS_PER_DAY`,
   `ATLAS_EXAMPLE_SANDBOX_SECONDS_PER_DAY`). Its starts are never counted in Modal's daily caps (2,000 starts, 7,200 s)
   that the owner and developers share. Before, about 20 addresses could have used those up in a few hours and locked
   out the owner and the judges until 00:00 UTC. When the example's allowance runs out, no-code visitors get one
   sentence with the waitlist and "I have a code"; anyone with a code is not affected.
5. The example's runs are limited: 10 an hour per visitor address (Fly-Client-IP on Fly), 200 an hour for all no-code
   visitors together (`ATLAS_EXAMPLE_RUNS_PER_IP_PER_HOUR`, `ATLAS_EXAMPLE_RUNS_PER_HOUR`).
6. No-code visitors play in a third copy of the app (`exampleInner`), so they cannot push an invited developer's session
   out of memory, and their track records stay in memory, apart from the disk store (which deletes its oldest file past
   2,000 people: a flood of made-up browser ids could otherwise have pushed a judge's record off).

## What one example run costs

**Corrected in review round 1:** I first wrote 2 sandboxes per run; that was wrong. Counted in a test, one example run
starts **3** sandboxes (the first run after a server start, **4**: the known-case check runs too). E4 measured and checked
against Modal's bill about **$0.0001 per sandbox** (`tests/evidence/E4/README.md`, "Review round 1"), so about
**$0.0003 per example run**. The daily allowance of 600 starts is about 200 runs, so at most about **$0.06 a day**. The ledger holds
each sandbox's worst case first (Modal's lifetime limit at the capped rate) and books the measured seconds, as
"the open example (no invite code)", under the developers' share of the ceiling (never the owner's $20 reserve).
No model is called, so model spend for the example is $0.

## Results

- `tsc`: no errors (`tsc.txt`).
- Full vitest: 2,746 passed, 2 failed, 35 skipped (`vitest.txt`). The 2 failures are timing-only tests (a draw "within
  budget" and "under 50 ms"); run alone they pass, 37 of 37 (`vitest-timing-rerun.txt`).
- New tests, `tests/unit/r10-open-example.test.ts`: 18 passed (`r10-tests.txt`). They prove, with
  ATLAS_REQUIRE_INVITE on and every model a counting fake:
  - the example plays end to end with no code (default bettor and "both"), with 0 model calls and the sandbox run;
  - a stranger can open that run's proof card; the Moonwell replay is served with no code; a new Moonwell run is 401;
  - 16 other paid routes answer 401 with the waitlist address in the body;
  - own code, the example as JavaScript, Python, the example with one changed byte, a trailing newline: refused at /paste;
  - another question id, a made-up id, a test of one's own, an edited test, all questions, a finding, "Test this claim":
    refused; a forged "example" field (400) or header (401) changes nothing; a developer's round, reached with their
    session id and no code, is refused;
  - replay mismatch (bettor text without the names; a test writer with no recording): 503 with the plain sentence, no call;
  - review round 1: playing again in the same session (reload) or a new one gives a fresh playable round with the
    recorded text, and the record counts it once (earlier this was refused, a wall after one play);
  - the ledger refuses the example visitor a model call, a precheck and an EVM run, and caps its sandboxes at once;
  - the per-address and global hourly limits; an invite code is outside them;
  - no-code track records stay off the disk store; another browser does not see them;
  - `ATLAS_WAITLIST_URL`: unset/empty means no link; http, javascript:, data:, no scheme, user:password, quotes and over
    500 characters stop the server; /invite/status and the /invite page carry it;
  - local development (ATLAS_REQUIRE_INVITE unset) behaves as before;
  - review round 1: one example run starts 3 sandboxes (4 on a fresh server), all counted in the example's own allowance
    and none in Modal's shared caps; with the allowance used up, a no-code run gets the sentence and an owner run and a
    developer run still start; a code whose daily budget is spent still plays the example (its own code is refused with
    the reason); a 404 on an example route never falls back to the owner's copy.
- Four G1/H1 tests that said "no code: 401 on /paste, /events, …" now state the new rule (those routes refuse anything that
  is not the example), and still check that nothing is spent.
- Page checks and screenshots (`shots.txt`, `shots/`), on a local copy of the hosted set-up (`server.mts`: the real gate,
  the three app copies, the real ledger in a temp folder, models that count and fail), with no code: 11 of 11 pass, and the
  server counted 0 model calls. Review round 1 added "Back to the example" and a reload, each played again to a verdict:
  13 of 13 pass.
  - `shots/1-no-code-first-screen-1280x800.png`: the example, its question ready, the AIs' answers labelled recorded.
  - `shots/2-no-code-result-1280x800.png`, `shots/3-no-code-proof-card-1280x800.png`: the verdict and the proof card.
  - `shots/4-waitlist-prompt-try-another-1280x800.png`: "Try another question" with no code: the line, Join the waitlist, I have a code.
  - `shots/5-waitlist-prompt-own-code-1280x800.png`: "Try your own code" with no code: the same line, the code box, Draw and the samples off.
  - `shots/6-no-code-after-reload-1280x800.png`: after a reload, played again.
  - `shots/api-statuses.txt`: every API answer the page got (all 200, no 401 on the example path).

To repeat: `pnpm exec vite build && PORT=18970 pnpm exec tsx tests/evidence/R10/server.mts`, then
`PW=<playwright-core> CHROME=<headless shell> BASE=http://127.0.0.1:18970 node tests/evidence/R10/shots.mjs tests/evidence/R10/shots`.

## Limits (what this does not show)

- Not run on Fly or on real Modal. The cost figure is E4's measurement, not a new one.
- The words are placeholders for Dami (`DAMI:` comments in `server/access/example-lane.ts`, `server/access/gate.ts`,
  `web/screens/Studio.tsx`, `web/screens/ErrorNotice.tsx`). In the "Try your own code" box the line says "nothing was run",
  which reads oddly before anything was tried.
- The browser id for a no-code track record is the page's random id, sent by the browser. Anyone who knows it can read that
  record (example rounds only). Kept in memory: a restart clears it.
- Left closed with no code, on purpose: the proof card's "draw this in pencil" and "Run it again" (replay), keeping a public
  link. Each shows the server's sentence with the waitlist links.
- A replayed example round carries no "repeat" line for anyone (person or AIs), so the text stays the recorded one; the
  record counts the same code and test once.
- A no-code track record is not carried over when the visitor signs in with a code: the code starts its own record.
- Live-log streams for no-code visitors: at most 4 per address and 40 in total, apart from the developers' streams.
- Judges playing with no code behind one shared address (an office or conference NAT) share the 10-runs-an-hour limit.
  The README now tells judges to enter the judge code first.
- A code whose budget is spent plays the example in the open example's copy of the app. If it ran out in the middle of a
  round, that round's later steps land in the other copy and are refused ("unknown target"); starting again works.
- The no-code limits count by address. Many addresses can reach the 200-an-hour total and lock other no-code visitors out
  for the rest of that hour (invited people are not affected).
- An invalid `ATLAS_EXAMPLE_RUNS_*` value falls back to its default silently (as the other per-address limits do).
