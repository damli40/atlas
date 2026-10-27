import type { Server } from "node:http";

// fetch("https://example.com") is never called here, and require("fs") is only a comment.
export function describe(label: string): string {
  const note = 'call fetch() or import("x") yourself';
  type Unused = Server | null;
  const nothing: Unused = null;
  return `${label}: ${note.length}${nothing === null ? "" : "!"}`;
}
