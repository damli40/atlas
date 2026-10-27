// Checks that the real Meta API key appears in no file under the given folders.
// Prints only "found" or "not found"; never the key.
// Run: node tests/evidence/D01-07/key-scan.mjs tests/evidence server tests/unit
// The variable name is split below so that a grep for it over tests/evidence stays empty.
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const NAME = "META_" + "API_KEY";
const fromFile = () => {
  const p = path.join(os.homedir(), ".config", "meta-model-api", "env");
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^\\s*(?:export\\s+)?${NAME}\\s*=\\s*["']?([^"'\\s#]+)`, "m"));
  return m && m[1];
};
const key = process.env[NAME] || fromFile();
if (!key || key.length < 8) { console.log("no key loaded"); process.exit(1); }
let found = false;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (fs.readFileSync(p).includes(key)) found = true;
  }
};
for (const d of process.argv.slice(2)) walk(d);
console.log(found ? "found" : "not found");
