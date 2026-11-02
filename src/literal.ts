// U3 item 3: a JSON value as the code's own language writes it, for every sentence a bettor reads.
//
// Why: a test's arguments travel as JSON, and Atlas loads them as the language's own values (JSON.parse in JavaScript,
// json.loads in Python). Written as JSON in a Python call sentence, `get_user_plan(true)` reads as code that would not
// even run, while Atlas really passes Python's True. So every sentence shows the value as the target language writes
// it: Python gets True / False / None; JavaScript and TypeScript keep JSON's spelling (JSON is valid JavaScript).
// Both the page and the betting models read these same sentences (D19).
//
// Pure, no I/O.

import { canonicalJson } from "./seal";
import type { JsonValue } from "./types";
import { cutValue } from "./cut-value";

export { cutValue };

export type CodeLanguage = "js" | "ts" | "py";

/**
 * Why a JSON value cannot be written in the language exactly as Atlas passes it (null when it can). JSON text loaded
 * by json.loads is always a Python literal, so this refuses only values plain code could not read back the same way:
 * a number that is not finite.
 */
export function literalProblem(v: JsonValue, language: CodeLanguage | undefined): string | null {
  const stack: JsonValue[] = [v];
  while (stack.length) {
    const x = stack.pop()!;
    if (typeof x === "number" && !Number.isFinite(x)) return `the value ${String(x)} has no ${language === "py" ? "Python" : "JavaScript"} literal that JSON can carry`;
    if (Array.isArray(x)) stack.push(...x);
    else if (x && typeof x === "object") stack.push(...Object.values(x));
  }
  return null;
}

/**
 * The value as the language writes it. JavaScript/TypeScript (and no language): canonical JSON. Python: the same text
 * with true/false/null as True/False/None (strings, numbers, lists and dicts are written the same in both).
 */
export function literal(v: JsonValue, language: CodeLanguage | undefined): string {
  if (language !== "py") return canonicalJson(v);
  return py(v);
}

function py(v: JsonValue): string {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number" || typeof v === "string") return canonicalJson(v);
  if (Array.isArray(v)) return `[${v.map(py).join(", ")}]`;
  // canonicalJson sorts keys; the same order here.
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${canonicalJson(k)}: ${py(v[k]!)}`).join(", ")}}`;
}

/** A literal cut for a sentence (the full value is in the test's JSON line). */
export function shortLiteral(v: JsonValue, language: CodeLanguage | undefined, max = 60): string {
  return cutValue(literal(v, language), max);
}


/** A value the runner stored as canonical JSON text, as the language writes it (display only; never judged). */
export function literalOfJsonText(json: string, language: CodeLanguage | undefined): string {
  if (language !== "py") return json;
  try {
    return py(JSON.parse(json) as JsonValue);
  } catch {
    return json;
  }
}

/**
 * U3 item 4: a value a person types as their answer. JSON always works; for a Python file Python's own spelling works
 * too (True / False / None, 'single quotes', a trailing comma), read by a small plain-code parser of literals only
 * (never evaluated). Null when the text is neither.
 */
export function parseTyped(text: string, language: CodeLanguage | undefined): { value: JsonValue } | null {
  const t = text.trim();
  if (t === "") return null;
  try {
    return { value: JSON.parse(t) as JsonValue };
  } catch {
    if (language !== "py") return null;
  }
  let i = 0;
  const ws = () => {
    while (i < t.length && /\s/.test(t[i]!)) i++;
  };
  const fail = (): never => {
    throw new Error("not a literal");
  };
  const value = (depth: number): JsonValue => {
    if (depth > 20) fail();
    ws();
    const c = t[i];
    if (c === "[" || c === "{") {
      const close = c === "[" ? "]" : "}";
      i++;
      const arr: JsonValue[] = [];
      const obj: Record<string, JsonValue> = {};
      ws();
      while (t[i] !== close) {
        if (c === "[") arr.push(value(depth + 1));
        else {
          const k = value(depth + 1);
          if (typeof k !== "string" || k === "__proto__") fail();
          ws();
          if (t[i] !== ":") fail();
          i++;
          obj[k as string] = value(depth + 1);
        }
        ws();
        if (t[i] === ",") {
          i++;
          ws();
        } else if (t[i] !== close) fail();
      }
      i++;
      return c === "[" ? arr : obj;
    }
    if (c === '"' || c === "'") {
      let out = "";
      i++;
      while (i < t.length && t[i] !== c) {
        if (t[i] === "\\") {
          const n = t[i + 1];
          const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', "0": "\0" };
          if (n === undefined || !(n in map)) fail();
          out += map[n!];
          i += 2;
          continue;
        }
        out += t[i];
        i++;
      }
      if (t[i] !== c) fail();
      i++;
      return out;
    }
    const m = /^(True|False|None|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(t.slice(i));
    if (!m) fail();
    i += m![0].length;
    return m![0] === "True" ? true : m![0] === "False" ? false : m![0] === "None" ? null : Number(m![0]);
  };
  try {
    const v = value(0);
    ws();
    if (i !== t.length) return null;
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    return { value: v };
  } catch {
    return null;
  }
}
