# D01-02: scaffold

Date: 2026-10-27 (WAT). Node 25.8.1, pnpm 12.4.1, TypeScript 7.0.2, Vitest 5.0.5, Vite 8.3.5.

## Commands and raw output

| Command | Output file | Result |
|---|---|---|
| `pnpm test` | `test-output.txt` | 1 test file, 1 test passed, exit 0 |
| `pnpm exec tsc --noEmit` | `tsc-output.txt` | no errors, exit 0 |
| `pnpm server` (in the background) | `server-start.txt` | listening on port 8787 |
| `curl -s -i localhost:8787/health` | `curl-health.txt` | `HTTP/1.1 200 OK`, body `{"ok":true}` |

The server was stopped after the curl.

## What it proves

- The one root package installs, and the test runner, type checker and server all start.
- `GET /health` answers `{"ok":true}` over real HTTP on port 8787, and the same route
  answers the same thing inside the test (`tests/unit/health.test.ts`).
- `src/types.ts` (the shared data shapes) type-checks under `strict`.

## What it does not prove

- Nothing about Atlas's real behaviour: there is no runner, judge or model call yet.
- The type check covers shapes only. It cannot tell whether the shapes are the right
  ones for later tasks.
- The web page was built once with `vite build` (it compiled), but nobody looked at
  it in a browser.
