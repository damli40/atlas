// Final review S3: plain notes the server prints at startup about this machine.
//
// Plain words: the TypeScript sandbox runs the code under test with `node --permission`, which exists from
// Node 22.13 (package.json "engines" says so). On an older Node every TypeScript run would fail its
// known-case check, so every verdict would be "can't check"; the server says so once, at startup, instead of
// leaving a person to find out from the verdicts. Muse Code (`muse exec`) runs only inside macOS's
// sandbox-exec; elsewhere Atlas asks for changes through the muse-spark-1.3 chat (no file access).

import { osSandbox } from "./meta/roles/fixer";

export const MIN_NODE = { major: 22, minor: 13 } as const;

export interface MachineFacts {
  /** process.versions.node, e.g. "25.8.1". */
  version: string;
  /** Whether this Node accepts --permission. */
  hasPermission: boolean;
  platform: string;
  /** Whether macOS sandbox-exec is available (server/meta/roles/fixer.ts osSandbox). */
  sandboxExec: boolean;
}

const older = (version: string) => {
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  return major < MIN_NODE.major || (major === MIN_NODE.major && minor < MIN_NODE.minor);
};

/** One plain sentence per problem; empty when this machine runs everything. */
export function startupNotes(m: MachineFacts): string[] {
  const out: string[] = [];
  const min = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  if (older(m.version)) {
    out.push(`Node ${m.version} is older than ${min}: the sandbox runs the code under test with "node --permission", which this Node lacks, so every TypeScript run would fail its known-case check and every verdict would be "can't check". Install Node ${min} or newer.`);
  } else if (!m.hasPermission) {
    out.push(`This Node (${m.version}) does not accept --permission, which the sandbox needs: every TypeScript run would fail its known-case check and every verdict would be "can't check".`);
  }
  if (m.platform !== "darwin" || !m.sandboxExec) {
    out.push("Muse Code (muse exec) runs only inside sandbox-exec, which is macOS only and not on this machine: Atlas asks for changes through the muse-spark-1.3 chat instead (no file access).");
  }
  return out;
}

/** The notes for the machine this server runs on. */
export const currentStartupNotes = (): string[] =>
  startupNotes({
    version: process.versions.node,
    hasPermission: process.allowedNodeEnvironmentFlags.has("--permission"),
    platform: process.platform,
    sandboxExec: osSandbox() !== null,
  });
