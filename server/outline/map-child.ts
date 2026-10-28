// X1 review round 2 (B2): the code map and the outline check run here, in a separate Node process, never on the
// server's event loop. One hostile upload can then slow only its own job: the server keeps answering everyone else,
// and a wall-clock limit (server/outline/offloop.ts) kills this process if the counted work budgets ever fail.
//
// Reads one JSON request on stdin, writes one JSON answer on stdout:
//   {op: "map", files, configFiles}           → {ok: true, codeMap}
//   {op: "section", input}                     → {ok: true, section}   (src/outline/section.ts makeOutlineSection)
// Any error → {ok: false, reason}. No network, no files written, no model.

import { buildCodeMap } from "../../src/outline/codemap";
import { makeOutlineSection, type OutlineSectionInput } from "../../src/outline/section";
import type { ConfigFile, OutlineFile } from "../../src/outline/types";

type Request = { op: "map"; files: OutlineFile[]; configFiles: ConfigFile[]; skippedPaths?: string[] } | { op: "section"; input: OutlineSectionInput };

const chunks: Buffer[] = [];
process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  let out: unknown;
  try {
    const req = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Request;
    out = req.op === "map" ? { ok: true, codeMap: buildCodeMap(req.files, req.configFiles, req.skippedPaths ?? []) } : { ok: true, section: makeOutlineSection(req.input) };
  } catch (e) {
    out = { ok: false, reason: e instanceof Error ? e.message.slice(0, 500) : "the check stopped" };
  }
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
});
