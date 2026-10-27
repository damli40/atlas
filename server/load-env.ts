// Final review S3: the server reads the repo's .env file itself, before anything else reads process.env.
//
// Plain words: .env.example says "copy to .env and fill in". Before this file, nothing read .env, so a fresh
// clone that followed the instruction got "BASE_RPC_URL is not set". server/index.ts imports this module
// FIRST (ES modules run their imports in order), so every later module sees the values.
//
// Rules: a variable already set in the environment wins (the file never overrides it); an empty value
// ("META_API_KEY=") is skipped, so it never hides the key-file fallbacks (~/.config/...); nothing is printed
// here, and what this returns holds key NAMES only, never a value.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface DotEnvResult {
  found: boolean;
  /** The names of the variables this call set (never their values). */
  loaded: string[];
}

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/;

/** Read KEY=VALUE lines from `path` into `env` (comments, blank lines and empty values skipped; no overrides). */
export function loadDotEnv(path: string, env: Record<string, string | undefined> = process.env): DotEnvResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { found: false, loaded: [] };
  }
  const loaded: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const m = LINE.exec(raw);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, ""); // an unquoted value may carry a trailing comment
    if (value === "" || env[key] !== undefined) continue;
    env[key] = value;
    loaded.push(key);
  }
  return { found: true, loaded };
}

/** The repo's .env (next to package.json). */
export const DOT_ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

/** Loaded once, when server/index.ts imports this module. index.ts prints the key names (never values). */
export const dotEnv = loadDotEnv(DOT_ENV_PATH);
