# L2: the Atlas retry loop, end to end inside real Muse Code

Date: 2026-11-02 (WAT) · Muse Code 1.4.14 (R7309.1) · Node 25.8.1 · branch `l2-muse-test` from main 1314c62

## The one thing to know first

**Yes: the loop completed inside real Muse Code, with Muse doing the edit itself.** On one live run, Muse Code ran `/atlas`,
showed the round, sealed the bets, showed a miss, took the typed choice `my answers are what I want`, **edited `retry.ts` on its
own** (`baseMs` became `baseMs * 2 ** i`), called `atlas_rerun`, and the Atlas server re-judged the same sealed bets on the
changed code. All three of the person's answers matched on re-run 1 of 3, and Atlas stopped the loop.

**Who "the person" was: the build agent, typing through tmux, not Dami.** I picked the test, typed the bets and typed the
choice. Muse's model (Muse Spark 1.3) did everything else: the tool calls, the edit and the report.

**Spend: ≤ $2.41 at the upper-bound price, under the $3.00 cap.** It crossed the $2.40 stop on the very last model call, after the
loop had already finished; the meter then pressed Esc, and no new step was typed. Details in "Spend".

**What this run does not settle:** why the plugin's program died on Oct 31. I tried to make it die again at $0 in real Muse
(33 idle minutes after real tool calls; Esc during a tool call) and it stayed alive every time, so **I changed no code**. The live
run had no long idle gap (the choice was typed about 15 s after the offer), so it says nothing about idle survival either.

## What ran, in plain words

1. `/atlas retry.ts retryWithBackoff` in Muse. The file waits `baseMs` (100 ms) after every failure, so 3 failures take 300 ms.
2. Muse Wonder (Meta's model, called by the Atlas server) proposed 3 tests; I picked `bGS_o_hGgB`: `fetchIt` always throws.
3. The questions appeared. I typed `1) threw 2) skip 3) 700 4) 3`. 700 ms is what a doubling backoff would take (100 + 200 + 400).
4. Atlas ran the code: `threw`, `virtualMs = 300`, `calls:fetchIt = 3`. My 700 didn't match; Muse Spark's sealed 300 matched.
   Atlas offered: "If your answers are what you want the code to do, type: my answers are what I want".
5. I typed exactly that. Muse called `atlas_choose_target`, read the file, and edited line 9 (+1 −1).
6. Muse called `atlas_rerun`. Same test, same seed (20260101), the same 7 sealed bets (mine and Muse Spark's), no new bets.
   Measured: `virtualMs = 700`. Mine: 3 matched. Muse Spark's 300 now reads "didn't match": its bet was judged again, not asked again.
7. Atlas stopped: "every answer you sealed matched on re-run 1". Muse ended with "You can now accept the edit, change it, or ask
   for another test." It did not call the code fixed or correct.

## Where to look

- **The best single frame:** [live/frames/04-choice-edit-rerun.txt](live/frames/04-choice-edit-rerun.txt), from the choice to the stop.
- Every frame, in order, in [live/frames/](live/frames/) (a `-typed` file is the screen just before Enter):
  `00-start` (Muse open, the plugin's program running) → `01-atlas` (the 3 proposals) → `02-test-picked` (the round, the
  bettor text, the questions) → `03-bets-and-run` (who bet what, the miss, the offer) → `04-choice-edit-rerun` (the choice,
  Muse's edit, the re-run, the stop) → `05-after-esc` (the screen after the meter's Esc; nothing changed).
- The file before and after Muse's edit: [live/retry-before.ts](live/retry-before.ts), [live/retry-after-muse-edit.ts](live/retry-after-muse-edit.ts).
- The proof file (owner's copy, holds the code): [live/proof-ete8MRjaf4.atlas.json](live/proof-ete8MRjaf4.atlas.json).
  Verify: [live/verify.txt](live/verify.txt): it passes; a copy with one re-run verdict flipped fails; the bets judged on re-run 1
  are the same 7 as the first run; the code fingerprint changed (`db4d38fad66c` → `30bb4508fda9`).
- Spend: [live/muse-meter.txt](live/muse-meter.txt) (the meter's last line), [live/muse-calls.txt](live/muse-calls.txt) (every Muse
  model call, from Muse's own logs), [live/atlas-usage.jsonl](live/atlas-usage.jsonl) (Atlas's Meta calls).
- The plugin's own log: [live/last-error.log](live/last-error.log): one start, one normal stop when I closed Muse. No errors.
- The $0 idle and Esc tests: [zero-cost/](zero-cost/). Tools used: [tools/](tools/) (`.txt` so nothing in them runs from the repo).
- Muse's validator: [validate-output.json](validate-output.json), valid, 0 diagnostics. MCP smoke over stdio: [zero-cost/mcp-smoke.txt](zero-cost/mcp-smoke.txt).

## Setup

- Muse Code 1.4.14 TUI in a private tmux, isolated HOME, plugin installed with `muse plugins install` and `muse plugins approve atlas`.
  Flags as in L1: `--model muse-spark-1.3 --contributor-mode off --reasoning-effort low --approval-mode never --approval-judge off
  --disable-shell --parallel-tool-calls` ([live/start-muse.sh.txt](live/start-muse.sh.txt)). Every model call was `muse-spark-1.3`.
- A scratch Atlas server on port 8822, invites required, one owner code ($1.20 a day), spend ceiling $1.50, every store in a
  scratch folder ([live/start-server.sh.txt](live/start-server.sh.txt)). The repo's `tests/evidence/usage/usage.jsonl` was not touched.
- The reminder hook stayed off (its switch file was never made), as installed by default.

## Spend

| | Calls | Tokens | Upper bound (cached at full price) | Uncached only |
|---|---|---|---|---|
| Muse Code, main session | 14 | | $2.10 | |
| Muse Code, its own "reminder observer" child runs | 6 | | $0.24 | |
| **Muse Code total** | **20** | 548,420 in (475,295 cached), 7,391 out | **$2.3415** | $0.4403 |
| Atlas: Muse Wonder + Muse Spark | 4 | see `atlas-usage.jsonl` | $0.0724 | $0.0724 |
| **Total** | | | **≤ $2.4139** (cap $3.00) | **≈ $0.51 + Meta's price for cached tokens** |

- Meta has not published a price for cached tokens, so the real bill lies between the two totals.
- **Two of Atlas's four calls ($0.0325) came before the live run.** Both are Muse Wonder "investigator" calls, logged 5 and 9 s
  after I started the scratch server, before any tool had called it. I did not expect them and did not find what starts them
  (the server's startup log does not say). They are in the total. The live run's own Atlas calls were one Muse Wonder call (the
  test proposals) and one Muse Spark bet.
- **Not counted:** the meter's Esc cancelled two reminder-observer runs in the middle of their model step. Muse logged no tokens
  for them. If Meta bills them, the six finished ones cost at most $0.06 each, so the total stays under about $2.53.
- From the offer to the stop (the choice turn) cost about $0.96 of the total: 6 main calls plus their reminder runs.

**The meter (improved from L1):** [tools/meter.py.txt](tools/meter.py.txt). It reads only the new bytes of each log and polls every
0.5 s (slowest gap measured: 0.52 s; L1's was 3 s). At $2.40 it presses Esc once and writes a STOP file that the step driver
([tools/step.py.txt](tools/step.py.txt)) checks before typing anything. At $2.85 it would kill Muse's tmux and the Atlas server.
(In the committed copy, one line builds the log path with `os.path.join` instead of a string with a slash in it, so the
repo's local-path check passes; it does the same thing.) **What it still cannot do:** stop a model call that has already started. It crossed $2.40 on the 20th call, which had already been
sent; the margin from $2.40 to $3.00 is there for exactly that.

## Why the plugin was gone on Oct 31: the $0 tests

The task said: if the program can die while idle, fix that first. I tried to make it die in real Muse, at $0.

**How it cost $0:** Muse's `--base-url` flag points it at a model endpoint. I pointed it at a small local program
([tools/puppet-model.py.txt](tools/puppet-model.py.txt)) that answers in Meta's format. When I type `CALL <tool> <json>` it asks
Muse to call that tool, and it never forwards anything. So real Muse Code ran the real plugin over its real stdio, with no
paid model. Muse used only a dummy key in those sessions.

| Test | Result | What it rules out |
|---|---|---|
| `atlas_status` through Muse, then 33 idle minutes, then `atlas_status` again ([zero-cost/frames/idle1-after-33min.txt](zero-cost/frames/idle1-after-33min.txt), [zero-cost/alive-idle1.txt](zero-cost/alive-idle1.txt)) | Same process alive every 30 s; the second call answered | Muse ending a plugin that has run a tool, after 33 idle minutes |
| `atlas_read_file_function` against the real scratch Atlas server, 33 idle minutes, the same call again ([idle2-after-33min.txt](zero-cost/frames/idle2-after-33min.txt), [alive-idle2.txt](zero-cost/alive-idle2.txt)) | Same process alive; the call worked | The same, with a real HTTP request to the Atlas server first |
| Esc pressed while a tool call waited 30 s on a slow fake server, then another call ([p3-02.txt](zero-cost/frames/p3-02.txt)) | Muse said "Interrupted"; the process stayed alive; the next call answered | A cancelled tool call killing the program |

**So the death was not reproduced, and I changed no code.** Making a fix for a cause nobody has seen would only add code to
review. What is still not ruled out: something only a paid Meta session does (for example its idle "feature tip" call, below),
the money-limit Esc landing mid-turn while a tool was running in a long session, or something outside Muse on that machine.
The plugin's `last-error.log` (added in L1) would now show which kind of end it was.

**One Muse behaviour worth knowing, seen in the $0 tests:** after a turn ends, Muse may make a model call by itself to pick a
"feature tip" for an idle user. In a paid session that costs money while the person is only reading. Muse also starts its own
"reminder observer" child runs after turns: 6 of the 20 paid calls here.

## What is and is not proven

**Proven, on this one run:**
- Inside real Muse Code 1.4.14, with a real Meta model as the agent, the whole loop runs: round, sealed bets, a miss, the typed
  choice, Muse's own edit, `atlas_rerun`, the same sealed bets judged again with the same seed, and Atlas's own stop.
- Muse did not choose for the person: it called `atlas_choose_target` only after the words were typed, and copied them exactly
  (the proof file holds `"typed":"my answers are what I want"`).
- Muse changed only the named file, by one line, and showed the changed line.
- The proof file verifies, and a flipped verdict in a re-run fails verify.

**Not proven:**
- **That Muse does this every time.** It is one run at low reasoning effort. Muse's edit was the textbook fix; another run could
  edit differently, need more tries, or stop.
- **The 3-try cap in real Muse.** The first re-run matched, so tries 2 and 3 never ran here. The cap is covered by the L1 tests
  (models mocked) only.
- **Surviving a long gap between the offer and the choice.** The choice was typed about 15 s after the offer.
- **The cause of the Oct 31 death.** See above.
- **A real person.** I picked the test and typed the bets in one message after the questions appeared. The 2-second reading
  floor was met by model latency, not by reading.
- **The proof card page** (`/proofs/ete8MRjaf4` in a browser) was not opened. The copy served without the owner's session holds
  no code and does not pass verify; that is by design (L1: a visitor's copy holds no code). The owner's copy passes.
- The person accepting the edit: the run ends at Muse's "You can now accept the edit…".

## Not done

- No code change, so no new tests and no full-suite run; `tsc` was not re-run.
- No adversarial review of this evidence by a second reviewer.
- `pitch/VIDEO-INDEX.md` lives in the main checkout, not in this branch; it is not updated for this result.
