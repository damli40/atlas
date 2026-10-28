# E5: the Atlas plugin for Muse Code (D26: bet on Muse's own edit before you accept it)

Date: 2026-10-28 (WAT) · Muse Code 1.4.14 (R7309.1) · Node 25.8.1 · live spend: see "Cost" (both figures).

## What this is, in plain words

Muse Code is Meta's coding agent. Users run it in a terminal as the `muse` command. A Muse **plugin** is a folder
Muse installs that can add slash commands, hooks and an **MCP server**. An MCP server is a small program that gives
the agent extra tools, over the Model Context Protocol (JSON messages on stdin/stdout).

The Atlas plugin (`plugins/muse-atlas/`) lets a developer type `/atlas` right after Muse edits a JavaScript,
TypeScript or Python file. The flow is the same Atlas round as the paste page:

1. Atlas's plain code lists the file's exported functions.
2. Muse Wonder proposes tests, and Atlas's gate allows or refuses each one.
3. The person types their bets. Muse Spark bets on its own, from the same text.
4. The bets are sealed. Atlas runs the code in its sandbox, and its plain-code judge says for each bet:
   matched, didn't match, or can't check.
5. The person gets a proof card link.

The one rule holds. The plugin never judges, never bets for the person, and never presents a model's guess as a
result. It only carries messages between Muse and the Atlas server.

## Where to look

- The plugin: `plugins/muse-atlas/`
  - `.muse-plugin/plugin.json`: the manifest.
  - `commands/atlas.md`: the `/atlas` command.
  - `mcp/`: the MCP server, with no dependencies beyond Node.
  - `hooks/remind-before-edit.mjs`: an optional reminder, off by default.
- The tests: `tests/unit/e5-muse-plugin.test.ts`. 23 tests, output in [test-output.txt](test-output.txt).
- Muse's own validator: [validate-output.json](validate-output.json). It reports `valid: true` with zero diagnostics.
- The hook, run through Muse's own `muse plugins hook test`: [hook-test-output.txt](hook-test-output.txt).
- **The live run inside Muse Code:** [live/](live/). The film frames are `live/frames/00…09`, the full tool result
  is [live/atlas-run-tool-result.txt](live/atlas-run-tool-result.txt), and the proof file is
  [live/proof-Ehs2a0hAe8.atlas.json](live/proof-Ehs2a0hAe8.atlas.json).
- Full suite three times: [full-suite-1.txt](full-suite-1.txt), [-2](full-suite-2.txt), [-3](full-suite-3.txt):
  1,421 passed, 35 skipped each time (1,397 before E5). `tsc`: [tsc-output.txt](tsc-output.txt), exit 0.

## How a developer installs it

You need Node 22.18 or later, because the MCP server's `.ts` files run directly with type stripping. You also need
Muse Code and an Atlas server: a local one (`pnpm server` in this repo) or the hosted one. On a server that
requires invites, you need an invite code too.

```sh
muse plugins install <atlas repo>/plugins/muse-atlas
muse plugins approve atlas            # Muse requires review before a plugin's MCP server and hook may run
export ATLAS_URL=http://127.0.0.1:8787          # or the hosted https address
export ATLAS_INVITE=<your invite code>          # from the person who runs the server
export ATLAS_WEB_URL=http://127.0.0.1:5173      # optional: where the proof card page lives
muse --model muse-spark-1.3 --contributor-mode off
```

Then, after Muse edits a file, type `/atlas retry.ts retryWithBackoff` (the file, and optionally the function).

- **Configuration.** Muse passes a plugin's MCP server only the variables its manifest names. The manifest names
  `ATLAS_URL`, `ATLAS_INVITE`, `ATLAS_WEB_URL` and `ATLAS_CLAIMANT`. Unset variables are not passed. I checked this
  on Muse 1.4.14: a variable outside that list never reached the server.
- **Config file instead of variables.** `config.json` in Muse's data folder for the plugin
  (`~/.local/share/muse/plugins/data/atlas/`) works too. It must be mode 600, or the plugin refuses it.
- **Who bets besides the person.** `ATLAS_CLAIMANT` chooses this. Unset: the server's default, Muse Spark 1.3 only.
  `both` or `spark-open` also sends the code to Baseten for Muse Spark Open.
- **The reminder hook.** It stays silent until the file `remind-before-edit` exists in that same data folder. When on,
  it shows "after this edit you can type /atlas <file> …" and never blocks the edit. Muse's `hook test` confirmed
  both the on and off states (`should_block: false`; `system_message` set only when on).

## The live run inside Muse Code (`live/`)

**Setup.** A real Muse Code 1.4.14 TUI (the terminal interface) ran in a private tmux session.
- It used an isolated HOME (a scratch folder), so Dami's real Muse setup was never touched.
- Flags: `--model muse-spark-1.3 --contributor-mode off --reasoning-effort low --approval-mode never`.
- The plugin was installed and approved in that HOME.
- A local Atlas server ran with `ATLAS_REQUIRE_INVITE=1`, an owner invite code made into a scratch store,
  `ATLAS_SPARK_OPEN=off`, the local sandbox, and a model ceiling of $0.50.
- The web app ran for the proof card link.

**Who "the person" was.** The person at the keyboard was the build agent (Claude), typing through tmux. It had
read the edited code, and it typed what it expected: `threw`, `skip`, `700`, `3`.

| Frame | What it shows |
|---|---|
| `01-edit-typed` | The request: "In retry.ts, change retryWithBackoff so the wait doubles after each failure…" |
| `02-edit-done` | Muse Code's edit (`baseMs` → `baseMs * 2 ** i`, [live/retry-after-muse-edit.ts](live/retry-after-muse-edit.ts)). Muse then wrote its own throwaway probe and expected waits `[100, 200]` for 3 failing attempts. It ran the probe, said "my probe's expectation was off by one wait", and changed the expectation to `[100, 200, 400]`. **Muse Code's own first guess did not match its own code:** the extra wait after the last failure. That is the exact moment Atlas exists for. |
| `03-atlas-typed` | `/atlas retry.ts retryWithBackoff` (the command autocompletes with its description) |
| `04-proposals` | Two Atlas tool calls. Muse Wonder 1.0 proposed 3 tests and the gate allowed all 3. Muse listed them with their ids. |
| `05-questions` | The person typed the id. The bettor text appears exactly as the server wrote it (D19), then the four questions. |
| `06-bet-typed` | The person's reply: `1) threw  2) skip  3) 700  4) 3` |
| `08-tool-results-expanded` | `atlas_seal_bet` received the typed words verbatim (`"typed":"threw"`, `"700"`, `"3"`; the skipped question was left out). `atlas_run` returned the verdicts and the proof link. |

**The result** (the full text is in [live/atlas-run-tool-result.txt](live/atlas-run-tool-result.txt)).

- **The test:** Atlas calls `retryWithBackoff(fetchIt, 3, 100)`, and `fetchIt` always throws `Error("boom")`.
- **The run measured:** `outcome = threw`, `virtualMs = 700`, `calls:fetchIt = 3`. The control check matched.
- **Who matched:**
  - The person: matched on all three bets.
  - Muse Spark 1.3: matched on all three of the same questions. It declined the "what does it return" question,
    which Atlas records as can't check.
- **Muse Wonder's sentence**, shown only after the run and labelled as its own words: "the code does wait another
  full backoff after the final failure before throwing".
- **Proof card:** run `Ehs2a0hAe8`. The `.atlas.json` is in `live/`.

**What did not happen.** Muse's own closing summary was cut off. The hard spend stop (below) interrupted Muse while
it was writing it. This was after both Atlas tool calls had finished and their results were on screen (frame 08).
So the verdict reached the person through the tool result, not through Muse's summary.

## Cost (Dami's cap for E5 was $2.00, raised by the coordinator to a $3.50 hard stop for the full run)

Muse Code sends a fixed system prompt and tool list of about 28,000 tokens with every model call. Turning off web,
shell and reminders, or switching presets, did not shrink it (27.8K–29.7K measured). One edit took Muse 14 calls,
because it wrote and ran its own probe script.

| | Tokens | At the upper-bound price | Uncached tokens only |
|---|---|---|---|
| Muse Code, 32 calls (3 probe calls to measure this + the film session + reminder child runs) | 852,354 in (666,708 reported as cached), 8,732 out | **$3.584** | $0.917 |
| Atlas server: Muse Wonder (proposals) + Muse Spark 1.3 (bets) | 743 + 1,065; 1,098 + 1,137 | $0.051 | $0.051 |
| **Total** | | **≤ $3.64** | **≈ $0.97 + whatever Meta charges for cached tokens** |

- **Upper bound.** Every token, cached ones included, at $4 in / $20 out per 1M. Muse Spark's price is not
  published, so Atlas assumes Muse Wonder's price for it (`src/cost.ts`).
- **Uncached only.** Cached tokens left out entirely. **Meta has not published a price for cached tokens**, so the
  real bill lies somewhere between the two figures, and I cannot narrow it.
- **The hard stop overshot by $0.14.** The meter (`muse-meter.txt`, read from Muse's session logs every 3 s) passed
  $3.50 when one model step and a reminder child run finished together. I pressed Esc at $3.64.
- **Probes vs the film.** The 3 probe calls cost $0.39 at the upper bound. The film session cost about $3.19 of the
  Muse figure.

## Where pasted or edited code goes when the plugin is active

| Path | Who sends it | Contributor model? |
|---|---|---|
| Muse Code → its own model | Muse itself. It read and edited the file, so its model sees the file anyway, and the plugin's tool results (the bettor text holds the numbered file) go to the same model. | Not by the plugin's choice. Muse must be started with `--model muse-spark-1.3 --contributor-mode off`. On Oct 27, `--contributor-mode off` alone still answered as `muse-spark-1.3-contributor` (D06-01). **In this run every model call in the session logs, reminder child runs included, was `muse-spark-1.3`** (`muse-meter.txt`). |
| Plugin → Atlas server (`ATLAS_URL`) | `atlas_read_file_function`. Only the one file named, only inside the workspace, only `.js .mjs .cjs .ts .mts .cts .py`, at most 64 KB. Otherwise nothing is sent (tested). | n/a |
| Atlas server → Muse Wonder, Muse Spark 1.3 (Meta API) | The server, as in E3 | Refused for pasted code by `server/meta/pasted-guard.ts`, even with `ATLAS_ALLOW_CONTRIBUTOR=1` |
| Atlas server → Baseten (Muse Spark Open) | Only with `ATLAS_CLAIMANT=both` or `spark-open` | n/a; Baseten is a third party hosting Meta's open weights. Off in the live run. |

- The plugin itself contacts only `ATLAS_URL`. A test checks the MCP server's source: one `fetch`, to
  `config.url + path`, and no `http`, `net` or `child_process` import.
- The invite code travels only in the `x-atlas-invite` header, and only over https or to this machine. It is
  scrubbed from every error and never logged. Tests check that it never appears in a URL, a body or an answer.
  `grep` finds no code in any evidence file.

## What the tests prove (23, models mocked, $0)

They run against the **real** Atlas app. The invite tests use G1's real gate and ledger.

- **A whole round** (read → Wonder's tests → round → the person's typed bet → run):
  - The bettor text in the tool's answer is byte for byte in Muse Spark's prompt (D19).
  - Wonder's claim is absent until after the run (D18).
  - The body sent to `POST /bets` is exactly the parsed typed words.
  - The verdict lines say matched / didn't match and never right / wrong.
  - The person is listed first, and the proof link is given.
- **Typed words read by plain code:** options by name or number, numbers with their unit, JSON, and "skip".
  "three", "about 3" and "it probably throws" are refused, and nothing is sealed. An answer object the agent makes
  up is rejected.
- **Refused files, nothing sent** (0 requests): not JS/TS/Python, outside the workspace (absolute path and `../`),
  over 64 KB, or missing.
- **A file with an import:** "Can't check: … axios" is shown at read time, and no model is asked.
- **Invites (G1 gate):**
  - No code: plain "how to get a code" and nothing spent.
  - A dev code: the round works, and the code appears only in the header.
  - Budget used up: "your invite's budget is used up", and Wonder is never called.
  - A wrong code: refused, and the code is not echoed.
  - Server unreachable: "did not answer (… ECONNREFUSED …). Is it running?", with the code scrubbed.
- **The MCP program over real stdio:** stdout holds only JSON-RPC, the 6 tools are listed, a not-set-up or
  unreachable server is reported plainly, and the invite never appears on stdout or stderr.
- **The package:** manifest ids and paths, `${VAR}` for every env value, no code in the manifest; Muse's own
  `muse plugins validate --json` with an isolated HOME gives valid with 0 diagnostics; the hook is off by default and
  only reminds when on.
- **Do the tests bite?** Taking out the invite scrub fails "a wrong invite and an unreachable server". Re-run, then
  restored. A first flaky failure (a proposal id with a `-` was skipped by the test's regex) was fixed in the test,
  and the file passed 5 runs in a row.

## What the plugin cannot do (known limits)

1. **It cannot prove the person typed the bet.** Muse's MCP client (`tbh`) declares no "elicitation" capability, so
   the plugin cannot ask the person directly. Without it, the coding agent passes the words along. What exists:
   - The tool takes only `typed` strings, never answer objects.
   - Its description and the `/atlas` command forbid inventing or correcting a bet.
   - Plain code refuses anything it would have to interpret.
   - The answer echoes "they typed X → sealed as Y", so the person can check.

   A misbehaving agent could still type words the person never typed. In the live run the words matched
   (frame 08 vs frame 06).
2. **One file, one exported function, no imports.** This is Atlas's runner limit (E1–E4). A file that imports
   anything gets the whole-run "can't check" reason up front.
3. **Rounds live in the MCP server's memory.** Restarting Muse starts a new Atlas session, and an open round can no
   longer be run from Muse. Its proof card, once run, stays on the server.
4. **Muse Code's own cost dominates.** About 28K tokens per call, and Muse may wander. The edit took 14 calls.
   One `/atlas` round from Muse is about 6–8 calls. Atlas's own models cost about $0.05.
5. **Muse is free to run its own code while editing.** In the live run it wrote `/tmp/retry-probe.mts` and ran it
   with `node`, outside the workspace, under Muse's sandbox and `--approval-mode never`. That is Muse's behaviour,
   not the plugin's. Developers who want to prevent it should keep Muse's default approval mode.
6. **The person's verdict summary depends on Muse.** The tool result holds the facts. Muse is told to show them
   as they are, but the plugin cannot force how Muse words its final reply.
7. **Python files are read as Python by extension.** Whether the server can run them depends on that server's
   runners (the hosted server runs Python since E4).
8. **The manifest's `env` field is not in Muse's published contract.** The validator accepts it, does not echo it,
   and Muse 1.4.14 honours it (tested). A future Muse could change that. The config file is the fallback.
9. **No screenshots.** The film frames are text captures of the tmux pane (`tmux capture-pane`). Each frame is the
   whole scrollback at that moment.

## Decisions I made (Dami can change any)

1. **Six tools, not four.** `atlas_start_round` was added, because the questions only exist once a test is picked.
   `atlas_status` was added for set-up problems.
2. **The bettor text is returned inside marked lines**, and the command tells Muse to show it unchanged (D19).
3. **https or this machine only** for `ATLAS_URL`, because the invite is a password.
4. **Muse Spark 1.3 is the only model bettor by default.** Spark Open is opt-in, because it sends the code to
   Baseten.
5. **The hook is shipped but silent** until a flag file exists ("off by default").
