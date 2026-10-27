import { readFileSync } from "node:fs";

// Reads a JSON config file from disk.
export function readConfig(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
