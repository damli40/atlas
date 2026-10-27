// Secret scan for files about to be committed. Run by .githooks/pre-commit.
//
// What it blocks, in plain words:
// 1. The REAL Meta API key, the REAL Base RPC URL and the REAL Baseten key, loaded at run time from the environment or
//    from their config files (~/.config/meta-model-api/env, ~/.config/atlas/rpc.env, ~/.config/baseten/env). Their values
//    are never printed: a hit is reported as "<file>: contains a secret (<which one>)".
//    Added E4: the REAL Modal token id and token secret of every profile in ~/.modal.toml (or MODAL_CONFIG_PATH), and
//    MODAL_TOKEN_ID / MODAL_TOKEN_SECRET from the environment.
// 2. Generic shapes of secrets: sk-... API keys, Bearer tokens, QuickNode URLs with a token,
//    Alchemy /v2/ keys, Infura /v3/ keys.
// A line may opt out of the generic shapes (never of the real values) with the comment
// "secret-scan: allow" when it holds an obviously fake value, for example in a test.
//
// Usage:
//   node tests/tools/secret-scan.mjs --staged     scan the staged version of every staged file
//   node tests/tools/secret-scan.mjs <file>...    scan files on disk
// Exit code 1 when anything is found, 0 otherwise.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOW = "secret-scan: allow";

/** Generic secret shapes. Each pattern must not match its own source text. */
export const GENERIC_PATTERNS = [
  { what: "an sk- style API key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { what: "a Bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { what: "a QuickNode URL with a token", re: /[a-z0-9.-]*\.(?:quiknode|quicknode)\.pro\/[A-Za-z0-9]{8,}/i },
  { what: "an Alchemy key URL", re: /alchemy\.com\/v2\/[A-Za-z0-9_-]{8,}/i },
  { what: "an Infura key URL", re: /infura\.io\/v3\/[0-9a-f]{16,}/i },
];

/** Values of KEY=VALUE lines in a config file (no printing). */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\s#]+)/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * E4: token_id / token_secret values of every [profile] in a Modal config file (TOML). Only `key = "value"` lines
 * are read, which is the shape Modal's CLI writes. Values are returned, never printed.
 */
export function readModalToml(path) {
  if (!existsSync(path)) return [];
  const out = [];
  let profile = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const sec = line.match(/^\s*\[\s*([^\]]*?)\s*\]\s*$/);
    if (sec) {
      profile = sec[1].replace(/^["']|["']$/g, "");
      continue;
    }
    const m = line.match(/^\s*(token_id|token_secret)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/);
    if (m) out.push({ profile, key: m[1], value: m[2] ?? m[3] ?? m[4] });
  }
  return out;
}

/** The real secret values on this machine, by a name that is safe to print. */
export function loadRealSecrets(opts = {}) {
  const meta = readEnvFile(join(homedir(), ".config", "meta-model-api", "env"));
  const rpc = readEnvFile(join(homedir(), ".config", "atlas", "rpc.env"));
  const baseten = readEnvFile(join(homedir(), ".config", "baseten", "env"));
  const metaName = "META_" + "API_KEY";
  const rpcName = "BASE_" + "RPC_URL";
  const basetenName = "BASETEN_" + "API_KEY";
  const found = [
    { what: "the real Meta API key", value: process.env[metaName] || meta[metaName] },
    { what: "the real Base RPC URL", value: process.env[rpcName] || rpc[rpcName] },
    { what: "the real Baseten API key", value: process.env[basetenName] || baseten[basetenName] },
    { what: "the real Modal token id", value: process.env["MODAL_" + "TOKEN_ID"] },
    { what: "the real Modal token secret", value: process.env["MODAL_" + "TOKEN_SECRET"] },
  ];
  const modalPath = opts.modalTomlPath ?? process.env.MODAL_CONFIG_PATH ?? join(homedir(), ".modal.toml");
  for (const t of readModalToml(modalPath)) {
    found.push({ what: t.key === "token_id" ? "the real Modal token id" : "the real Modal token secret", value: t.value });
  }
  const secrets = found.filter((s) => typeof s.value === "string" && s.value.length >= 12);
  // An RPC URL's token is often the path after the host; block the path on its own too.
  for (const s of [...secrets]) {
    if (s.what.includes("RPC URL")) {
      try {
        const path = new URL(s.value).pathname.replace(/^\/+|\/+$/g, "");
        if (path.length >= 12) secrets.push({ what: "the real Base RPC URL's token", value: path });
      } catch {
        /* not a URL: the full value is still checked */
      }
    }
  }
  return secrets;
}

/** Names of what was found in `text` (never the values). */
export function scanText(text, realSecrets) {
  const hits = new Set();
  for (const s of realSecrets) if (text.includes(s.value)) hits.add(s.what);
  for (const line of text.split("\n")) {
    if (line.includes(ALLOW)) continue;
    for (const p of GENERIC_PATTERNS) if (p.re.test(line)) hits.add(p.what);
  }
  return [...hits];
}

function stagedFiles() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

function stagedContent(path) {
  return execFileSync("git", ["show", `:${path}`], { encoding: "latin1", maxBuffer: 256 * 1024 * 1024 });
}

function main(argv) {
  const staged = argv[0] === "--staged";
  const files = staged ? stagedFiles() : argv;
  const secrets = loadRealSecrets();
  let bad = 0;
  for (const f of files) {
    let text;
    try {
      text = staged ? stagedContent(f) : readFileSync(f, "latin1");
    } catch {
      continue; // deleted or unreadable: nothing to publish
    }
    const hits = scanText(text, secrets);
    if (hits.length) {
      bad++;
      console.error(`${f}: contains a secret (${hits.join(", ")})`);
    }
  }
  if (bad) {
    console.error(`secret scan: ${bad} file(s) blocked. Remove the secret, or mark an obviously fake value with "${ALLOW}".`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
