# D05-05: "Ask why", only sentences with run evidence

Date: 2026-10-27 (WAT) · no extra model call (the sentences come from the D05-04 live rounds).

## The rule, in plain words

After a run the person can press **Ask why**. Atlas then shows short sentences about what the run did. A
sentence is shown only if plain code (`src/why.ts`) finds the run evidence it points at:

- a **trace event**, written `trace #N`: N is the event's position in the run's trace (counting from 0) and
  must exist; or
- a **finding's lines**, written `lines A–B` (optionally after the file name): the range must sit inside a
  finding of this round that plain code verified.

If a sentence points at nothing, or at evidence that does not exist (trace #49 in a 49-event trace, lines
outside every finding, lines of the right numbers in another file), it is **dropped whole** and counted. The
log strip shows the count as "dropped: no run evidence (N sentences)". A model's sentence is never reworded.

Sentences come from two places:
- **plain code**, templated from the run's own trace (`templatedSentences`). Fixture: "it waited 4 times,
  3000 ms each (trace #4, #9, #14, #19)", "call 5 threw; no more attempts (trace #23)" (the second is
  written only if no call follows the throw). Moonwell: who chose which lines, the control, the cbETH feed
  change, cbETH's read ($1.12), and "after the change, cbETH's price read touched 1 price source (trace #48)".
- **a Meta model's own words**: Spark's bet rationale, and the Investigator's claim when its finding is the
  round's. Shown with the model's id in a separate panel marked "Not a verdict".

## Where to look first

- **The acceptance test**: `tests/unit/why.test.tsx`, "3 sentences, 1 unlinked → 2 rendered, 1 counted in the
  log strip": through the real `WhyScreen` and `LogStrip`, 2 sentences render and the strip's last line reads
  "dropped: no run evidence (1 sentence)". The same split is also tested on the linker alone.
- **Live Moonwell round** (in `../D05-04/strip-1080p.png`, left column): 6 sentences shown, all plain code;
  **1 dropped**: Spark's rationale ("Price requires on-chain oracle reading at a future block beyond cutoff,
  cannot be known in advance."), which points at no run evidence. The strip's last line counts it.
- **Live fixture round** ([`fixture-why-1080p.png`](fixture-why-1080p.png)): 2 shown; **3 dropped**: Spark's
  three rationales (for example "Defaults apply: attempts=5, so 5 failures exhaust the loop with 5 calls and
  no 6th answering call."). They describe the code correctly in words, but cite no trace event or lines, so
  the rule drops them.

## Tests

`tests/unit/why.test.tsx` (8 tests): the 3-sentence acceptance case (linker and screen); bad references
dropped even beside a good one; lines of an unverified finding are not evidence; the templated sentences of
both live runs, each checked against the trace event it names; Spark's real rationales dropped unchanged; a
model sentence with evidence shown in the model panel with its id, apart from the plain-code ones.
Commands and their outputs are in [`../D05-04/README.md`](../D05-04/README.md) (one test run covers both tasks).

## What this proves, and what it does not

- It proves no sentence reaches the screen without pointing at evidence that exists in this run.
- It does **not** prove a linked sentence is true. A model could cite a real trace event and still say
  something wrong about it. The link shows where to check; the sentence stays in the model panel, with the
  model's id, marked "Not a verdict". Plain-code sentences are templated from the event they cite.
- The page passes only the round's chosen finding to the linker. A model sentence citing the lines of
  another Investigator place is dropped, even though that place was verified.
- The plan's example said "call 5 threw (trace #9)". In the real trace the throw is event #23; the sentence
  uses the real index.
