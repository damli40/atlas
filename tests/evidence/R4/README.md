# The machine (D65)

The code drawn as a physical machine, the first thing after a paste, and the run moving through it. M swaps to the box chart.

**Where to look first:** `shots/orders-result-1440x900.png` (the ring on the chute), `shots/moonwell-1440x900.png` (the finale), `shots/branching-rest-1280x720.png` (the hardest routing), `hero-machine.mp4` (the film, with the machine).

## What each part means (plain code picks every one)

| On the drawing | Means | Where the fact comes from |
|---|---|---|
| A housing with its name on a plate | a function, with its lines | the outline |
| A pipe with arrow marks | this function calls that one, this way | the outline's joins and call sites |
| A wheel on a drum with a return pipe | a loop, or a function that calls itself | the source with comments and strings masked; the outline's self-calls |
| A dial on a stem | this function waits | `callFacts.waits` |
| A chute from the front | this function throws | masked source |
| A spout from the front | this function returns | masked source |
| A funnel with an arrow | where the call starts: the function Atlas calls | the chosen function |
| A small capped inlet | exported, so it can be called from outside | the outline |
| A blue block | an outside call faked by the test | the test |
| A grey block | an outside call, not run yet | the call sites |
| Red | only what the run did: the thread in a pipe, a lit lamp, the ring, the chute it ended in | the run's path |

Every function has one footprint, so size says nothing. A loop changes the body's shape, because the code has a loop, not because the code is long.

## What it checks

- **The audit** (`renderer/machine/audit.ts`) runs on every drawing: no pipe over a part it does not join, every pipe shows its direction and ends on a part, no words on words, parts or pipes. A drawing that fails is not shown: the page gives the reason in words and shows the chart. `tests/unit/r4-machine.test.ts` also feeds it broken pictures to prove it fails them.
- **`machine.mjs`** measures the real page in the real fonts: 74 checks. Paste to picture was 34 to 54 ms, median 36, six pastes on this machine against a local dev server, from the click to the frame after the machine is in the page.

## What the run shows

Only what the existing path says: a thread goes down a pipe only when plain code is certain of the route. Helper steps come from the third traced run under D61's limits, so names and order only, and D61's caption stays under the drawing.

## Limits

- **Past 8 parts:** words and the chart. A phone gets the chart.
- **Two functions that call each other:** today this falls back to the chart with the reason in words: the back pipe can't clear its own part. Never a hidden pipe.
- **Throws, returns and loops** are read from masked source line by line, not from a syntax tree. A `return` in a nested function counts for the function around it, which is why `cached` lists lines 12, 15, 16. It says "returns" where the code does, but not always whose return it is. A template string's `${…}` holding `throw` is not tested.
- **The wheel does not turn** in a run: no fact here says how many times a loop went round at that moment.
- **The proof card and its image keep their chart and marks.** The machine is on the live screens only.
- **Reference:** this film and these shots use mocked models. Numbers are from one machine.
