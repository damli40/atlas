// U2 (D53): the scripted fake network. When pasted code calls the network (global `fetch` in JavaScript/TypeScript;
// `requests`, `urllib.request` or `httpx` in Python), a test may carry ONE fake for that library. Atlas installs it in
// the sandbox in place of the library; the real network stays blocked, and any network use the fake does not cover
// stays "can't check" for the whole run.
//
// Plain words:
// - The fake has the same contract as a stand-in: a list of scripted answers used in call order (answer with an HTTP
//   status and a JSON body, throw a named network error, or never answer), then repeat the last one or throw.
// - Its calls are counted like a stand-in's, as `calls:<library>` (so "how many times does it call fetch?" is a
//   question, and the fake is a device with a lamp on the drawing).
// - Every bettor reads the same sentence about what the fake does (D19), written here by plain code.
// - `networkUse` reads the code's TEXT (no run) to say which library it calls, so Atlas can tell before running that a
//   test without the right fake would end as "can't check" (and never offers such a test).
//
// No I/O, no clock, no model. Safe to load in the browser.

import type { JsonValue, NetworkFake, NetworkLibrary, NetworkStep } from "./types";

export const NETWORK_LIBRARIES: readonly NetworkLibrary[] = ["fetch", "requests", "urllib", "httpx"];
/** Which language each library belongs to. */
export const LIBRARY_LANGUAGE: Record<NetworkLibrary, "js" | "py"> = { fetch: "js", requests: "py", urllib: "py", httpx: "py" };

/**
 * The named network errors a fake may throw, per library: the names the real library uses, so code that catches
 * that class catches the fake's error. (fetch: a failed request is a TypeError; an aborted one an AbortError.)
 */
export const NETWORK_ERRORS: Record<NetworkLibrary, readonly string[]> = {
  fetch: ["TypeError", "AbortError", "TimeoutError"],
  requests: ["ConnectionError", "Timeout", "ConnectTimeout", "ReadTimeout", "HTTPError", "TooManyRedirects", "RequestException"],
  urllib: ["URLError", "TimeoutError"],
  httpx: ["ConnectError", "ConnectTimeout", "ReadTimeout", "TimeoutException", "NetworkError", "ReadError", "RemoteProtocolError"],
};

/** What the library is called in the sentences bettors read. */
export const LIBRARY_WORDS: Record<NetworkLibrary, string> = {
  fetch: "fetch",
  requests: "requests",
  urllib: "urllib.request",
  httpx: "httpx",
};

/**
 * How a "never answers" step ends, per library, in the words every bettor reads. Each is what the real library does
 * when the server never answers: fetch has no timeout of its own (only the code's AbortSignal ends the wait); requests
 * and urllib wait forever unless the code passed `timeout=`; httpx gives up after its timeout, 5 s unless the code set
 * another.
 */
export const NEVER_ANSWER_WORDS: Record<NetworkLibrary, string> = {
  fetch: "A call that never answers waits until the code aborts it (an AbortSignal, then fetch throws AbortError); fetch has no timeout of its own.",
  requests: "A call that never answers waits forever, unless the code passed timeout=, which ends the wait with requests' ReadTimeout.",
  urllib: "A call that never answers waits forever, unless the code passed timeout=, which ends the wait with TimeoutError.",
  httpx: "A call that never answers ends with httpx's ReadTimeout after the timeout (5 s unless the code set another).",
};

const shortJson = (v: JsonValue, canonical: (v: JsonValue) => string) => {
  const s = canonical(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

/** One step in words: "answers 503 with {"error":"busy"}", "throws ConnectionError", "never answers". */
export function networkStepWords(step: NetworkStep, canonical: (v: JsonValue) => string): string {
  switch (step.do) {
    case "respond":
      return `answers ${step.status} with ${shortJson(step.body, canonical)}${step.afterMs ? ` after ${step.afterMs} ms` : ""}`;
    case "throw":
      return `throws ${step.errorName}${step.message ? ` ("${step.message.length > 60 ? `${step.message.slice(0, 59)}…` : step.message}")` : ""}`;
    case "never_answer":
      return "never answers";
  }
}

/** "Atlas's fake fetch (in place of the network, which stays blocked) answers 503 … on calls 1–2, then …; every later call …" */
export function networkFakeWords(f: NetworkFake, canonical: (v: JsonValue) => string): string {
  const groups: { from: number; to: number; words: string }[] = [];
  f.calls.forEach((step, i) => {
    const words = networkStepWords(step, canonical);
    const last = groups[groups.length - 1];
    if (last && last.words === words) last.to = i + 1;
    else groups.push({ from: i + 1, to: i + 1, words });
  });
  const parts = groups.map((g) => `${g.words} on call${g.from === g.to ? ` ${g.from}` : `s ${g.from}–${g.to}`}`);
  const after = f.then === "repeat_last" ? `every later call ${groups[groups.length - 1]!.words} too` : "any later call throws AtlasStandInExhausted";
  const name = LIBRARY_WORDS[f.replaces];
  const never = f.calls.some((s) => s.do === "never_answer") ? ` ${NEVER_ANSWER_WORDS[f.replaces]}` : "";
  return `Atlas's fake ${name} (in place of the network, which stays blocked) ${parts.join(", then ")}; ${after}.${never}`;
}

/** The scripted step for call n (1-based), or undefined when the fake has none left (throw_exhausted). */
export function networkStepFor(f: NetworkFake, n: number): NetworkStep | undefined {
  return n <= f.calls.length ? f.calls[n - 1] : f.then === "repeat_last" ? f.calls[f.calls.length - 1] : undefined;
}

// ---------- reading the code's text ----------

export interface NetworkUse {
  library: NetworkLibrary;
  /** 1-based line of the first use found. */
  line: number;
}

/** Removes comments and string contents (keeps line breaks), so a word in a string or comment is not read as code. */
function codeOnly(src: string, language: "js" | "ts" | "py"): string {
  let out = "";
  let i = 0;
  const py = language === "py";
  while (i < src.length) {
    const c = src[i]!;
    if (!py && c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (!py && c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (py && c === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const triple = py && src.slice(i, i + 3) === c.repeat(3);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src.startsWith(q, j)) break;
        if (!triple && c !== "`" && src[j] === "\n") break;
        j++;
      }
      const stop = Math.min(src.length, j + q.length);
      out += q + src.slice(i + q.length, j).replace(/[^\n]/g, " ") + (src.startsWith(q, j) ? q : "");
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * Which network libraries the code calls, read from its text (comments and strings removed). JavaScript/TypeScript:
 * a call of the global `fetch` (`fetch(`, `globalThis.fetch`, `window.fetch`, `self.fetch`), unless the file declares
 * its own `fetch`. Python: an import of requests, httpx or urllib.request. One entry per library, first use first.
 */
export function networkUse(source: string, language: "js" | "ts" | "py"): NetworkUse[] {
  const code = codeOnly(source, language);
  const out: NetworkUse[] = [];
  if (language !== "py") {
    const declared = /\b(?:function|const|let|var|class)\s+fetch\b|\bimport\s*\{[^}]*\bfetch\b[^}]*\}/.test(code) || /[(,]\s*fetch\s*[,):=]/.test(code.replace(/\bfetch\s*\(/g, ""));
    const m = /(?:\b(?:globalThis|window|self)\s*\.\s*fetch\b)|(?:(?<![.\w$])fetch\s*\()/.exec(code);
    if (m && !declared) out.push({ library: "fetch", line: lineOf(code, m.index) });
    return out;
  }
  const add = (library: NetworkLibrary, index: number) => {
    if (!out.some((u) => u.library === library)) out.push({ library, line: lineOf(code, index) });
  };
  const re = /^[ \t]*(?:import[ \t]+([\w., \t]+)|from[ \t]+([\w.]+)[ \t]+import[ \t]+([\w., \t()*]+))/gm;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const mods = m[1] ? m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]!.trim()) : [m[2]!.trim()];
    const names = m[3] ? m[3].replace(/[()]/g, "").split(",").map((x) => x.trim().split(/\s+as\s+/)[0]!.trim()) : [];
    for (const mod of mods) {
      const top = mod.split(".")[0];
      if (top === "requests") add("requests", m.index);
      else if (top === "httpx") add("httpx", m.index);
      else if (mod === "urllib.request" || (mod === "urllib" && names.includes("request"))) add("urllib", m.index);
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Python top-level modules a fake for `library` makes importable in the sandbox. */
export const FAKE_PY_MODULES: Record<Exclude<NetworkLibrary, "fetch">, readonly string[]> = {
  requests: ["requests"],
  httpx: ["httpx"],
  urllib: ["urllib.request", "urllib.error"],
};

/**
 * U2 (D53): why plain code knows, before running, that this test would end "can't check" for the whole run because of
 * the network: the code calls a library the test has no fake for (null when every network use is covered).
 */
export function networkGap(source: string, language: "js" | "ts" | "py", fake: NetworkFake | undefined): string | null {
  const uses = networkUse(source, language);
  const missing = uses.filter((u) => u.library !== fake?.replaces);
  if (missing.length === 0) return null;
  const u = missing[0]!;
  return `the code calls ${LIBRARY_WORDS[u.library]} (line ${u.line}) and this test has no fake for it; Atlas blocks the real network, so nothing in this run can be checked`;
}
