# L1: the Meta retry loop in the Atlas Muse plugin (D57)

Date: 2026-10-31 (WAT) · Muse Code 1.4.14 (R7309.1) · Node 25.8.1

## The one thing to know first

**The loop has never completed inside real Muse Code. It has run live only over the plugin's real MCP program, with scripted
edits. That is the limit of the claim until Dami's filmed take.** Two attempts in real Muse failed, and the second went over its limit:

1. At the $2.00 limit, Muse reached the offer ("type: my answers are what I want") and waited, without choosing for the person.
2. The coordinator then raised the limit to $2.55 to finish in the same session. The choice was typed, and Muse called
   `atlas_choose_target` as it should. **The plugin's MCP program had died during the 32 idle minutes**, so the call failed with
   `Broken pipe (os error 32)`. Muse tried again, checked `atlas_status`, reported the error and **did not edit the file**. That
   was the right behaviour, and it spent the money. The cause is still unknown; see "Why the plugin was gone".

**The spend reached $2.5923 at the upper-bound price, $0.04 over the $2.55 hard stop.** The meter pressed Esc at $2.40 and killed
tmux at $2.52, but it reads logs every 3 s, and the calls that had already started finished after that. No fresh run was started.

The loop itself ran live over the plugin's real MCP program, against a real Atlas server with real Muse Wonder and Muse Spark, and
**the edits in that part were written by the build agent's script, not by Muse.** Nobody has seen Muse Code do the edit and the
re-run.

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
- Tests: `tests/unit/l1-loop.test.ts` (25), output in [test-output.txt](test-output.txt), and `tests/unit/l1-restart.test.ts` (9).
- The saved rounds and the log: `plugins/muse-atlas/mcp/round-store.ts`, `watchProcess` in `mcp/server.ts`.
- Film text frames, real Muse: [live/muse-frames/](live/muse-frames/). `02-round.txt` ends at the offer.
  `04-choice-typed.txt` is the choice being typed. **`04-choice-from-session-log.txt` is not a screen capture:** the meter killed
  tmux before the capture ran, so that text is Muse's own session log.
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
| Muse Code, 20 calls (attempt 0: 7; attempt 1: 8; the choice after the limit was raised: 5, reminder child runs included) | 596,178 in (469,806 cached), 5,841 out | $2.5015 | $0.6223 |
| Atlas: Muse Wonder + Muse Spark, 2 rounds | see `atlas-usage.jsonl` | $0.0907 | $0.0907 |
| **Total** | | **≤ $2.59** (limit $2.55; **$0.04 over**) | **≈ $0.71 + whatever Meta charges for cached tokens** |

Meta has not published a price for cached tokens, so the real bill lies between the two figures. Part 1 stopped at ≤ $1.94; the
last 5 calls cost $0.65 and produced no edit.

To finish in real Muse now takes a fresh session: about 12 calls, about $1.60 at the upper bound. No more Muse spend was approved for
L1, so this waits for Dami's filmed take. Keep the time between the offer and the choice short, and read `last-error.log` if it fails.

## Why the plugin was gone

**The cause is still unknown. I can only say what it was not.** The Muse session's logs hold no exit reason, the program's stderr was
not kept, and I killed that tmux before looking at the process. All tests below cost $0.

| Test | Result | What it rules out |
|---|---|---|
| The program as it was (before the changes below), real stdio, whole round with mocked models, 33 minutes idle, then the choice ([idle/run.log](idle/run.log)) | **Alive; the choice worked**; stderr empty | The program dying by itself from idling after a round |
| Muse on the free echo provider, no tool run, 35 minutes idle | Child alive | Muse ending an unused plugin for idling |
| Same Muse during two full-suite runs and `muse plugins validate` | Child alive | My test runs, or validating in the same HOME |
| Muse on echo with a 15 s reply: Esc mid-reply, then Esc at the prompt | Child alive | Esc as such. My meter did press Esc in the real session. |

**What is not ruled out:** something only real Muse does with a child that has run tools (reminder child runs end, a real model
turn is cancelled), or something outside Muse on this machine. Testing that needs a real provider, which is why it stops here.

**What the code reading found** (`mcp/server.ts`, `tools.ts`, `atlas-client.ts`): the program has no watchdog. E5's M1 is a timer per
request, cleared when the request ends, and nothing else in it runs on a timer. It ends only when stdin closes, or on a crash. One real
defect turned up, and it is fixed: if writing an answer failed, the tool chain stayed rejected for good, and the rejection
was unhandled. **Nothing shows that this is what happened on Oct 31:** it needs a write that failed, and the program being gone
already looks the same from Muse's side.

**What changed, whatever the cause:**
- `last-error.log` in Muse's data folder for the plugin: start, stop (with the reason) and every stray error, 40 lines at most, mode
  600, invite removed, no environment and no code. A "started" with no "stopped" after it means a hard kill. **So the next time this
  happens in real Muse, the file should say which kind of end it was.** `atlas_status` shows the last problem.
- A stray error or rejected promise is written down and the program stays up. A closed stdout or a signal is written down, then it exits.
- Rounds and the session id are saved per workspace in the same folder (mode 600, no code, no invite). They hold the questions and
  the person's answers that didn't match. A restarted program carries on with the same round on the server.
- A lost round says so: what was lost, that nothing ran, and to start again with /atlas. Both cases have their own sentence: the
  program lost it, or the server lost it.
- `/atlas` now tells Muse what to do on "Broken pipe": do not edit, try once, ask the person to restart Muse in the folder.

**Not tested in real Muse:** Muse did not restart the dead program by itself on Oct 31 (three calls failed the same way), so the
person must restart Muse. That Muse then passes the same data folder and working folder is what the saved rounds rely on; it is
shown only on 1.4.14 for the data folder (E5 limit 8), and the restart itself ran over real stdio in the tests, not in Muse.

## What the tests prove (25; models mocked, $0)

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

- **Two-call tests (U3):** the same two calls run again on the changed code; the proof verifies, and a tampered fact fails it.

- **Restart (`l1-restart.test.ts`, real program over real stdio):** stopped with SIGTERM or killed with SIGKILL, a new program carries on
  with the same round through the choice, the edit and the re-run, and the proof verifies. The saved files are mode 600 and hold no code.
  With no data folder, or a server that lost the round, the tool says so. Stray errors keep the program up; a closed stdout or a
  signal is written down first; the log holds no invite.

**Two E5 tests were changed:** both hard-coded the tool list, which now has 8 tools. Nothing else in E5 changed.
`tests/tools/g1-fixtures.ts` gained `modalRuntime`, so a pretend Modal run makes a proof that verifies.

## Suite

Full suite after the rebase onto main d453655, twice: three runs: [1](full-suite-1.txt) 0 failed, 2,241 passed; [2](full-suite-2-one-timing-failure.txt) **1 failed**, 2,240 passed; [3](full-suite-3.txt) 0 failed, 2,241 passed; 35 skipped each.
The one failure is `x3-server.test.ts` "answers in under 50 ms", which measured 66 ms. It is an existing test that L1 does not touch, and it passed 3 times of 3 alone. It looks load-related, but I did not prove that. `tsc`: [tsc-output.txt](tsc-output.txt), exit 0. `no-local-paths` passes.

**An earlier full run had 7 failures.** Four were mine and are fixed: the two new routes were missing from G1's route table, the
live proof changed the refusal index (2 tests; now 25 rows), and one count sentence skipped `plural()`. The other 3 were existing
timing tests (`call-function`, `call-function-review1`, `x3-failure-labels`) that failed in that one run and passed alone and in
both later full runs. They look load-related, but I did not prove that.

**The refusal index grew by 3 rows for one sealed bet:** Muse Spark declined one question, and the index lists it once per run
(the first run and two re-runs). The generator was not changed.

## Known limits

0. **The plugin's program can be gone when the person replies**, for an unknown reason. It happened once in real Muse. The person
   must then restart Muse, and that restart has not been tested in real Muse; see "Why the plugin was gone".
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
8. **Rounds need the plugin's data folder to survive a restart.** With no `MUSE_PLUGIN_DATA_DIR` they stay in memory (E5 limit 3), and
   the tool says the round is lost. They also end when the Atlas server restarts or its 2 hours for pasted code run out.
9. **The budget test's Modal is pretend**, as in G1: real sandbox, Modal's cost estimate. No re-run has run on real Modal.

## Not done

- No re-run in real Muse Code; see the top.
- The cause of the plugin's death in real Muse; see "Why the plugin was gone".
- U3's two-call tests: supported, with no code change needed, because they are the same test shape and the same runner. One test
  covers it through the server routes, not through the plugin's tools or real Muse.
- No adversarial review of this batch by a second reviewer yet.
- `docs/` and `CLAUDE.md` untouched, as briefed, so `pitch/VIDEO-INDEX.md` is not updated for this result.
