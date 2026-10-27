// X1 test fixtures: a four-file TypeScript codebase, a correct Wonder outline for it (what a model could answer),
// and a sealed outline section. Used by the outline tests; never run as code.
import { buildCodeMap } from "../../src/outline/codemap";
import { makeOutlineSection, sha256Text, utf8Length } from "../../src/outline/section";
import type { OutlineFile, OutlineSection, WonderOutline } from "../../src/outline/types";

export const file = (path: string, text: string): OutlineFile => ({ path, text, language: path.endsWith(".py") ? "py" : "ts", sha256: sha256Text(text), bytes: utf8Length(text) });

export const FILES: OutlineFile[] = [
  file("src/api.ts", `import { fetchUser } from "./client";\n\nexport async function handler(id: string) {\n  const user = await fetchUser(id);\n  return { status: 200, user };\n}\n`),
  file("src/client.ts", `import { retry } from "./retry";\n\nexport function fetchUser(id: string) {\n  return retry(() => fetch("https://example.com/u/" + id), 3);\n}\n`),
  file("src/retry.ts", `export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {\n  let last: unknown;\n  for (let i = 0; i < attempts; i++) {\n    try {\n      return await fn();\n    } catch (e) {\n      last = e;\n    }\n  }\n  throw last;\n}\n`),
  file("src/log.ts", `export function log(message: string) {\n  console.log(message);\n}\n`),
];
export const MAP = buildCodeMap(FILES);
export const MODEL = "muse-wonder-1.0";

export const GOOD: WonderOutline = {
  parts: [
    { id: "api", name: "HTTP handler", purpose: "Answers a user request.", files: [{ path: "src/api.ts", lineStart: 1, lineEnd: 6, quotedSnippet: "export async function handler(id: string) {" }], patterns: ["rpc-call"] },
    { id: "client", name: "User client", purpose: "Fetches a user over the network.", files: [{ path: "src/client.ts", lineStart: 3, lineEnd: 5, quotedSnippet: "export function fetchUser(id: string) {\n  return retry(() => fetch(\"https://example.com/u/\" + id), 3);" }], patterns: ["network", "Retry"] },
    { id: "retry", name: "Retry helper", purpose: "Tries a call up to N times.", files: [{ path: "src/retry.ts", lineStart: 1, lineEnd: 11, quotedSnippet: "for (let i = 0; i < attempts; i++) {" }], patterns: ["retry", "backoff-ish free text"] },
  ],
  joins: [{ from: "api", to: "client", kind: "calls", evidence: { path: "src/api.ts", line: 4, quotedSnippet: "const user = await fetchUser(id);" } }],
};
export function goodSection(outline: WonderOutline | null = GOOD): OutlineSection {
  return makeOutlineSection({
    source: { kind: "upload" },
    files: FILES,
    skipped: [{ path: "README.md", reason: "not a source file Atlas reads (.md)" }],
    wonder: outline
      ? { model: MODEL, outline, attempts: [{ attempt: 1, finishReason: "stop", usage: { promptTokens: 1000, completionTokens: 500, reasoningTokens: 100, usd: 0.014 } }] }
      : { model: MODEL, outline: null, attempts: [{ attempt: 1, error: "the answer is not valid JSON" }, { attempt: 2, error: "the answer is not valid JSON" }], failure: "the answer is not valid JSON" },
  });
}

