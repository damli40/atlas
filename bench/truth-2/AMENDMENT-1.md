# Bench T2, amendment 1 (written 2026-10-28, before the "after" run): labelled values and the double run

`PASS-RULE.md`, `expected.json` and `cases/` stay as registered. This amendment defines the label the pass rule
asks for ("Measured under Atlas's own rules, labelled"), and how Atlas's double run counts. Its text is the one
proposed in `tests/evidence/R1/README.md` ("T2 amendment 1, revised for review round 1"), followed by extensions for
the changes made in R1's review round 2, written out in full below. It is committed alone, before the "after" run.
The classifier change it needs is a separate, later commit, logged in `bench/TOOLING-CHANGES.md`.

## Where the label is

A run's `conditions` field (batch R1, `src/conditions.ts`): a list of `{ kind, says }`. Verify rechecks it against
the run's own trace: the `conditions` event, and the `twin_differs` event written by the double run. The run also
records `seed`, `timeZone`, `locale`, and its second run as `twin`.

## A measured field expected as `{ "dependsOn": C }` counts as "correct (labelled)"

only when the run's `conditions` holds a kind mapped to C below, and the run records the pin that kind needs:

| dependsOn | condition kind(s) that label it | what must be recorded |
|---|---|---|
| `randomness` | `randomness`, or `hash-seed` (Python set order of text or bytes) | `seed` 1..4294967295 |
| `randomness` (extension E1) | `memory-address` | nothing to pin; see E1 |
| `host` | `time-zone-or-locale` (time zone, locale) or `host` (a machine detail, named in the sentence) | `timeZone` = `UTC`, `locale` = `en-US` (JS) / `C` (Python) for the first; the read named in `says` for the second (extension E2) |
| `clock` | `timed-work` (the code read the clock two or more times at one simulated moment; the sentence says elapsed times read 0 ms) | none |
| `scheduling` | `tick-order` (process.nextTick next to promise callbacks; the sentence names Atlas's calling order) | none |

Not covered: `process-lifetime`, and `scheduling` for a 0 ms timer next to `setImmediate`. These stay as
registered: a measured value there is still a FALSE FACT. (R1 reports neither: it marks them not measured, with the
`unref-timer` and `timer-order` reasons.)

## The double run

A field that is not reported with the reason "this value changed between two identical runs" counts as
**correct can't-check** when the field's expectation is `{ "dependsOn": … }` (any category). When the expectation
is a plain fact, it counts as **wrong can't-check (over-refusal)**. The result counts double-run refusals on a line
of their own.

## Reproducibility

A labelled value counts only if the run's own twin measured the same value. Otherwise it is a FALSE FACT.

## Reporting

"Correct (labelled)" is its own line next to "correct fact", so a reader sees how many correct answers rest on
Atlas's pins or on a disclosed condition.

## Extensions for R1's review round 2 (checked against `tests/evidence/R1/README.md`, "Review round 2")

- **E1, `memory-address` (a new condition kind in round 2).** In pasted Python, `hash()`, `id()`, `set()` and
  `frozenset()` add it every time they meet an object hashed by its memory address. The round-1 text has no row for
  it. It is added as a label for `dependsOn: "randomness"`, because an address is a run-to-run value. No pin can be
  recorded for an address. So a value labelled only `memory-address` counts as "correct (labelled)" only if the
  twin measured the same value (the reproducibility rule above). The condition's own sentence says the second run
  catches "most values ..., not all". No T2 test uses objects hashed by address, so E1 changes no T2 count; it is
  written down so a later run cannot apply it silently.
- **E2, `host` notes (round 2: noted at run time through proxies, not by reading the code's text).** A `host`
  condition labels a `dependsOn: "host"` field only when its sentence names at least one read, that is, the text
  between the parentheses in "This code read details of the machine it runs on (…)" is not empty. Reads that round 2
  sorts as `time-zone-or-locale` (TZ, LANG, LC_*) count under that kind, with its pin rule. An `import.meta` mention
  found in the code's text is a disclosure like any other `host` note.
- **E3, the "None" wording.** When a run has no condition, the conditions line now reads "None of the conditions
  Atlas checks for (clock, randomness, time zone, locale, the machine details it watches); the second run matched."
  That is not a claim of a complete check. For this bench, a correct field on a run with no condition counts as
  "correct fact" (a plain fact). A correct field on a run whose conditions are not empty also counts as "correct
  fact", but the result additionally reports how many fact tests carried any condition, so plain and conditioned
  facts can be told apart. Only `{ dependsOn }` fields can be "correct (labelled)".
- **E4, kinds that withhold the result.** `unseeded-randomness` and `timer-order` mark the result not measured; so
  does `unref-timer` when only unref'd timers are left (`UNREF_REASON`). Their reasons must still match the
  registered reason category of the expectation (`randomness`, `scheduling`, `process-lifetime`), as the pass rule
  requires.
- **E5, the pin check.** A run whose pins could not be set is "can't check" for the whole run (R1's
  `PIN_FAILED_REASON`). For a test whose expectation allows a whole-run can't-check in category C, that reason counts
  only if it matches C's patterns. Otherwise it is an over-refusal or a wrong-reason can't-check, as the pass rule
  says.
