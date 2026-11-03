// Final review S3: plain notes the server prints at startup about this machine.
//
// Plain words: the TypeScript sandbox runs the code under test with `node --permission`, which exists from
// Node 22.13. On an older Node every TypeScript run would fail its known-case check, so every verdict would be
// "can't check". R16 (review minor 8): Node 22.13 to 24 accept --permission but do NOT block network connections
// under it (checked by running: a connect to a local port succeeds on 22.13.0 and 24.11.0, and is refused with
// ERR_ACCESS_DENIED on 25.8.1), so the local sandbox needs Node 25 (package.json "engines" says so). The server
// says each of these once, at startup, instead of leaving a person to find out from the verdicts. Muse Code (`muse exec`) runs only inside macOS's
// sandbox-exec; elsewhere Atlas asks for changes through the muse-spark-1.3 chat (no file access).

import { osSandbox } from "./meta/roles/fixer";

/** The oldest Node with --permission at all. */
export const PERMISSION_NODE = { major: 22, minor: 13 } as const;
/** R16: the oldest Node whose --permission also blocks network connections (the local sandbox's promise). */
export const MIN_NODE = { major: 25, minor: 0 } as const;

export interface MachineFacts {
  /** process.versions.node, e.g. "25.8.1". */
  version: string;
  /** Whether this Node accepts --permission. */
  hasPermission: boolean;
  platform: string;
  /** Whether macOS sandbox-exec is available (server/meta/roles/fixer.ts osSandbox). */
  sandboxExec: boolean;
}

const olderThan = (version: string, min: { major: number; minor: number }) => {
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  return major < min.major || (major === min.major && minor < min.minor);
};
const older = (version: string) => olderThan(version, PERMISSION_NODE);

/** One plain sentence per problem; empty when this machine runs everything. */
export function startupNotes(m: MachineFacts): string[] {
  const out: string[] = [];
  const min = `${MIN_NODE.major}.${MIN_NODE.minor}`;
  const has = `${PERMISSION_NODE.major}.${PERMISSION_NODE.minor}`;
  if (older(m.version)) {
    out.push(`Node ${m.version} is older than ${has}: the sandbox runs the code under test with "node --permission", which this Node lacks, so every TypeScript run would fail its known-case check and every verdict would be "can't check". Install Node ${min} or newer.`);
  } else if (!m.hasPermission) {
    out.push(`This Node (${m.version}) does not accept --permission, which the sandbox needs: every TypeScript run would fail its known-case check and every verdict would be "can't check".`);
  } else if (olderThan(m.version, MIN_NODE)) {
    out.push(`Node ${m.version} is older than ${min}: its "node --permission" does not block network connections, so the local sandbox cannot stop the code under test from reaching the network. Install Node ${min} or newer.`);
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
