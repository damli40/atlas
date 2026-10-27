// D07-04: two small wording rules every screen and log line shares. Pure plain code.
//
// - A count says "1 answer", "3 answers": `plural(n, "answer")`.
// - A place in a file says "line 42" for one line and "lines 42–44" for more, never "lines 42–42":
//   `lineSpan(42, 42)` → "line 42"; `fileLines("a.sol", 42, 44)` → "a.sol lines 42–44".

/** "1 answer" / "2 answers". `many` for an irregular plural. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "line 42" or "lines 42–44". */
export const lineSpan = (from: number, to: number): string => (from === to ? `line ${from}` : `lines ${from}–${to}`);

/** "<file> line 42" or "<file> lines 42–44". */
export const fileLines = (file: string, from: number, to: number): string => `${file} ${lineSpan(from, to)}`;
