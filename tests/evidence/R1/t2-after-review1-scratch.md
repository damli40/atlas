# Bench truth-2 result, 2026-10-28

Sample: **22 tests run** of 22 in the corpus (21 fact tests, 1 can't-check traps), 8 case files. One run each. No general claim follows from this sample (PASS-RULE.md).

- Executor: local (Node --permission for JS/TS; macOS sandbox-exec for Python)
- Node v25.8.1; Python 3.14.7; darwin arm64
- Git commit: `0952ed64f44fde44699b5c7fa827890780e119fb`
- expected.json SHA-256: `acc033bb728a5576a6e6d8b22dfd5b44097ddb83f8ce6e16f6a24147fe4bb972`
- Wall time: 24.7 s · cost $0 (no model call)
- Fields compared: **75** (68 correct, 7 FALSE)

## Counts

| Classification | All | JS/TS | Python |
|---|---|---|---|
| correct fact | 11 | 6 | 5 |
| **FALSE FACT** | 7 | 5 | 2 |
| correct can't-check | 4 | 4 | 0 |
| can't-check, wrong reason | 0 | 0 | 0 |
| wrong can't-check (over-refusal) | 0 | 0 | 0 |
| missed can't-check | 0 | 0 | 0 |

## Tests that are not correct facts or correct can't-checks

### h01a (cases/h01-cpu-elapsed.js, `timeWork`): FALSE FACT

- Expected: returned, json {"dependsOn":"clock"}, 0 ms
- Measured: returned, json {"dateMs":0,"perfMsOver1":false,"x":409…, 0 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"clock"}, measured {"dateMs":0,"perfMsOver1":false,"x":4095}

### h03b (cases/h03-order.js, `tickVsPromise`): FALSE FACT

- Expected: returned, json {"dependsOn":"scheduling"}, 1 ms
- Measured: returned, json ["promise","nextTick"], 1 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"scheduling"}, measured ["promise","nextTick"]

### h04a (cases/h04-env.js, `localHour`): FALSE FACT

- Expected: returned, json {"dependsOn":"host"}, 0 ms
- Measured: returned, json {"hour":0,"offset":0,"tz":"UTC"}, 0 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"host"}, measured {"hour":0,"offset":0,"tz":"UTC"}

### h04b (cases/h04-env.js, `coin`): FALSE FACT

- Expected: returned, json {"dependsOn":"randomness"}, 0 ms
- Measured: returned, json "tails", 0 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"randomness"}, measured "tails"

### h04c (cases/h04-env.js, `uuidPrefix`): FALSE FACT

- Expected: returned, json {"dependsOn":"randomness"}, 0 ms
- Measured: returned, json "b6cb50a1", 0 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"randomness"}, measured "b6cb50a1"

### q01a (cases/p01-set-order.py, `fruit_list`): FALSE FACT

- Expected: returned, json {"dependsOn":"randomness"}, 0 ms
- Measured: returned, json ["cherry","date","banana","grape","fig"…, 0 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"randomness"}, measured ["cherry","date","banana","grape","fig","elder","apple"]

### q02c (cases/p02-timing.py, `cpu_elapsed`): FALSE FACT

- Expected: returned, json {"dependsOn":"clock"}, 0 ms
- Measured: returned, json false, 0 ms
- Field `returnedJson`: FALSE; expected {"dependsOn":"clock"}, measured false

## Every test

| Test | Lang | Category | Expected (written before the run) | Measured by Atlas | Classification |
|---|---|---|---|---|---|
| h01a | js | cpu timing | returned, json {"dependsOn":"clock"}, 0 ms | returned, json {"dateMs":0,"perfMsOver1":false,"x":409…, 0 ms | FALSE FACT |
| h01b | js | cpu timing | can't check | can't check: the code ran past Atlas's 10000 ms limit of REAL time (it m… | correct can't-check |
| h02a | js | unref | outcome depends on process-lifetime | outcome not measured: the call was waiting only on an unref'd timer, which does n… | correct can't-check |
| h02b | js | unref | outcome depends on process-lifetime | outcome not measured: the call was waiting only on an unref'd timer, which does n… | correct can't-check |
| h03a | js | order | returned, json {"dependsOn":"scheduling"}, 5 ms | outcome not measured: the code queued callbacks whose order Node leaves open (a 0… | correct can't-check |
| h03b | js | order | returned, json {"dependsOn":"scheduling"}, 1 ms | returned, json ["promise","nextTick"], 1 ms | FALSE FACT |
| h04a | js | env | returned, json {"dependsOn":"host"}, 0 ms | returned, json {"hour":0,"offset":0,"tz":"UTC"}, 0 ms | FALSE FACT |
| h04b | js | env | returned, json {"dependsOn":"randomness"}, 0 ms | returned, json "tails", 0 ms | FALSE FACT |
| h04c | js | env | returned, json {"dependsOn":"randomness"}, 0 ms | returned, json "b6cb50a1", 0 ms | FALSE FACT |
| h05a | js | interval | returned, json 3, 3 ms, cb×3 | returned, json 3, 3 ms, cb×3 | correct fact |
| h05b | js | interval | returned, json 160, 160 ms | returned, json 160, 160 ms | correct fact |
| q01a | py | py values | returned, json {"dependsOn":"randomness"}, 0 ms | returned, json ["cherry","date","banana","grape","fig"…, 0 ms | FALSE FACT |
| q01b | py | py values | returned, not JSON (object), 0 ms | returned, not JSON (object), 0 ms | correct fact |
| q01c | py | py values | returned, not JSON (array), 0 ms | returned, not JSON (array), 0 ms | correct fact |
| q01d | py | py values | returned, json 2, 0 ms | returned, json 2, 0 ms | correct fact |
| q02a | py | py timing | returned, json ["v",500], 500 ms, fetch×1 | returned, json ["v",500], 500 ms, fetch×1 | correct fact |
| q02b | py | py timing | returned, json "timed out", 100 ms, fetch×1 | returned, json "timed out", 100 ms, fetch×1 | correct fact |
| q02c | py | py timing | returned, json {"dependsOn":"clock"}, 0 ms | returned, json false, 0 ms | FALSE FACT |
| h06a | js | inner type | returned, not JSON (array), 0 ms | returned, not JSON (array), 0 ms | correct fact |
| h06b | js | inner type | returned, not JSON (array), 0 ms | returned, not JSON (array), 0 ms | correct fact |
| h06c | js | inner type | returned, not JSON (object), 0 ms | returned, not JSON (object), 0 ms | correct fact |
| h06d | js | inner type | returned, not JSON (object), 0 ms | returned, not JSON (object), 0 ms | correct fact |
