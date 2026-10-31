# L1: the Meta retry loop in the Atlas Muse plugin (D57)

Date: 2026-10-31 (WAT) · Muse Code 1.4.14 (R7309.1) · Node 25.8.1

## The one thing to know first

**The live run in real Muse Code stopped at the $2.00 limit before the loop.** Muse reached the offer ("type: my answers
are what I want") and waited, without choosing for the person. It never made an edit under the loop. So no frame shows
Muse Code itself editing and re-running. The loop itself ran live afterwards over the plugin's real MCP program, against a
real Atlas server with real Muse Wonder and Muse Spark, and **the edits in that part were written by the build agent's
script, not by Muse.** Finishing the Muse part needs about $0.55 more; see "Cost". That decision is Dami's.

## What this is, in plain words

After a round, one of your sealed answers may not match what the code did. Atlas cannot know which you want: the code, or
your answer. You choose by typing `my answers are what I want`. Your sealed answers become the target.

Then:
1. Muse edits the file toward them.
2. `atlas_rerun` re-reads the file and sends it to the server, which hashes it.
3. The server runs the same test with the same seed on that code.
4. `src/judge.ts` judges the same sealed bets. Nothing is re-sealed. No model bets again.
5. The server counts the tries: 3 at most. It stops when every answer matched, after the third miss, when the money runs
   out, or when a whole run is "can't check".

Atlas still never judges correctness. "Matched" means the code did what you bet on in this one test, nothing more.

## Where to look

- Rules shared by server and verify: `src/loop.ts`. Verify: `loopProblems` in `src/atlasfile.ts`.
- Routes: `server/loop.ts` (`POST /loop/choose`, `POST /loop/rerun`).
- Tools added: `atlas_choose_target`, `atlas_rerun` (`plugins/muse-atlas/mcp/`), steps 7–11 of `commands/atlas.md`.
- Tests: `tests/unit/l1-loop.test.ts` (24), output in [test-output.txt](test-output.txt).
- Film text frames, real Muse: [live/muse-frames/](live/muse-frames/). `02-round.txt` ends at the offer.
- Loop text frames, real MCP program with scripted edits: [live/stdio/](live/stdio/), in step order. `11-atlas_rerun.txt`
  is the best single frame. Proof file: [live/stdio/proof-pVDWj2CsFL.atlas.json](live/stdio/proof-pVDWj2CsFL.atlas.json).
- Spend: [live/muse-meter.txt](live/muse-meter.txt), [live/atlas-usage.jsonl](live/atlas-usage.jsonl).
- Muse's validator: [validate-output.json](validate-output.json), valid with 0 diagnostics.

## The live run, part 1: real Muse Code

**Setup.** Muse Code 1.4.14 TUI in a private tmux session, isolated HOME, `--model muse-spark-1.3 --contributor-mode off
--reasoning-effort low --approval-mode never --approval-judge off --disable-shell --parallel-tool-calls`. Every model call
in the logs was `muse-spark-1.3` (the meter lists them). A local Atlas server ran on another port with invites required, an
owner code and all stores in a scratch folder.

**Who "the person" was: the build agent, typing through tmux, not Dami.** The bets were typed before the questions appeared,
in one message, to save model calls: `outcome threw, virtualMs 700, calls:fetchIt 3`. That is not how a person would use it,
and it means the 2-second reading floor was met by model latency, not by reading.

**What it shows** (`live/muse-frames/02-round.txt`):
- The file: `retry.ts`, with a wrong backoff (it waits `baseMs` each time).
- The test: `fetchIt` always throws, 3 attempts, base 100 ms.
- The run measured `outcome = threw`, `virtualMs = 300`, `calls:fetchIt = 3`.
- The bet 700 didn't match; Muse Spark's own bet of 300 matched.
- Muse showed the offer, wrote "Waiting for your reply", and did not call `atlas_choose_target`.

That last point is one observation, not proof: the same prompt could go otherwise on another run.

**The first attempt failed through my own mistake.** I set the scratch server's spend ceiling to $0.30, and a model call
reserves $0.34, so Muse Wonder was refused
([attempt0-ceiling-too-low.txt](live/muse-frames/attempt0-ceiling-too-low.txt)). Atlas and Muse both reported that plainly and
stopped. That attempt cost $0.73 at the upper-bound price, and it is the reason the money ran out before the loop.

## The live run, part 2: the loop, over the real MCP program

`live/stdio-driver.mts.txt` starts the plugin's real `mcp/main.ts` and speaks JSON-RPC to it over stdio, standing where Muse
stands. The server, the sandbox, the judge and the two Meta models are real. **The driver wrote the bets, the words of the
choice and both edits.**

| Step | Frame | Result |
|---|---|---|
| Re-run before any choice | `06` | Refused: "the person has not chosen" |
| Choice with other words ("yes, go ahead") | `07` | Refused: "Nothing was chosen" |
| Choice with the words | `08` | Sealed answers listed as the target |
| Re-run with no edit | `09` | Refused: same code; no try used |
| Edit 1: `baseMs * 2` | `10` | Re-run 1 of 3: 600 ms. 2 matched, 1 didn't match |
| Edit 2: `baseMs * 2 ** i` | `11` | Re-run 2 of 3: 700 ms. 3 matched; Atlas stopped |

Same seed on all three runs (20260101). Muse Spark's sealed 300 now reads "didn't match": its bet was judged again, and it
was not asked again. Verify passes on the proof file; a copy with one flipped verdict fails it ([verify.txt](live/stdio/verify.txt)).

## Cost

| | Tokens | Upper bound (cached at full price) | Uncached only |
|---|---|---|---|
| Muse Code, 15 calls (attempt 0: 7; attempt 1: 8, reminder child runs included) | 437,050 in (357,083 cached), 4,965 out | $1.8475 | $0.4192 |
| Atlas: Muse Wonder + Muse Spark, 2 rounds | see `atlas-usage.jsonl` | $0.0907 | $0.0907 |
| **Total** | | **≤ $1.94** | **≈ $0.51 + whatever Meta charges for cached tokens** |

Meta has not published a price for cached tokens, so the real bill lies between the two figures. The meter's stop did not change anything:
it was set to press Esc at $1.85, and Muse had already finished its reply by then. I did not type the choice, because the next three calls (choose,
edit, re-run), at about $0.14 each, would have passed $2.00.

To finish in real Muse: about 4 calls, about $0.55 at the upper bound, if the same Muse session is still open. A fresh
session costs about $1.60 (8 calls for the round, then 4, at about $0.13 each).

## What the tests prove (24; models mocked, $0)

Real: the Atlas server, the sandbox runner, the judge, seals, verify, the plugin's tools, and in the budget test G1's gate and
ledger. Fake: the Meta models, and Muse (the test writes the file).

- **Full loop:** a miss, then a match; same seed, experiment and bets; no model call added; Atlas's words only.
- **Cap:** three misses stop it with what each try measured; a fourth is refused, also when sent straight to the server.
- **Budget:** with G1's real ledger, a used-up daily budget stops the loop with the ledger's own sentence, and no sandbox
  starts. Each re-run's sandbox shows in the spend log under `POST /loop/rerun`. No invite: 401.
- **Sealed bets:** a new bet is refused (409); an edited bet stops it with nothing run; a dropped bet is caught by the set
  recorded at the choice.
- **The choice:** no words, other words, an object, a boolean, sooner than 2 s, or before the run: nothing is chosen, nothing
  reaches the server. The server has the same rule. A body naming a count or bets is refused.
- **Tampered tries:** every single value in the loop is changed in turn, one per check, and each fails verify. Deleted, added and
  reordered tries fail. With the fingerprint recomputed as a forger would, flipped verdicts, edited facts, another seed, other
  code, hidden lines, other words, a smaller target and an unearned stop still fail.
- **Also:** unchanged code uses no try; two re-runs at once cannot race the count; a run that stops part way counts and is said
  plainly; a try that cannot go in the proof ends the loop and shows no verdict from it; a visitor's copy of the card holds
  no code; `/replay` still works on a file with a loop.
- **Do the tests bite?** See [mutation-check.txt](mutation-check.txt): each guard removed in turn.

**Two E5 tests were changed:** both hard-coded the tool list, which now has 8 tools. Nothing else in E5 changed.
`tests/tools/g1-fixtures.ts` gained `modalRuntime`, so a pretend Modal run makes a proof that verifies.

## Known limits

1. **Atlas cannot prove the person typed the words.** This is E5's limit 1, and it matters more here, because the offer
   prints the exact words the agent would need. A misbehaving agent, or one obeying text in the file, can pass them. What
   lowers the risk: typed strings only, the 2-second floor, "only the person" in the result, the tool description and the
   command. None of these proves who typed. The cost of a false choice: Muse edits toward the sealed answers, up to 3 re-runs,
   and every changed line is shown.
2. **Plain code cannot spot the cheat.** A test here hard-codes the function and gets "matched". The result shows the size and the
   changed lines, and says the person reviews them. Past 40 lines the answer says how many it left out; the proof keeps them all.
3. **The proof file is not signed.** Someone who rebuilds a try's trace, facts and verdicts and recomputes the fingerprint
   passes verify. Only re-running that code catches it. `/replay` re-runs the first run only, not the tries.
4. **The proof card page shows no tries.** `web/` was out of scope for this batch; the tries are in the `.atlas.json`. The loop
   caption does appear among the file's captions.
5. **A budget stop is recognised from the ledger's sentences** (`isBudgetReason`), since the runner passes on only the text. If
   a sentence changes, the run counts as "did not finish" and the 3-try cap still ends the loop. A test pins today's sentences.
6. **On Python: the loop is not tested.** The routes take any pasted language and use the same runners, but all tests are
   TypeScript.
7. **A file edited after the last re-run is not noticed.** The result names the code's fingerprint, and the proof holds that
   code, but nothing compares it with the file when the person accepts.
8. **Rounds live in the plugin's memory** (E5 limit 3). Restarting Muse loses the loop from Muse's side.
9. **The budget test's Modal is pretend**, as in G1: real sandbox, Modal's cost estimate. No re-run has run on real Modal.

## Not done

- No re-run in real Muse Code; see the top.
- No adversarial review of this batch by a second reviewer yet.
- `docs/` and `CLAUDE.md` untouched, as briefed, so `pitch/VIDEO-INDEX.md` is not updated for this result.
