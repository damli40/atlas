// X2: the explorer's only input, the answer of GET /outline/jobs/:id/outline (server/outline/routes.ts
// outlineAnswerOf). Types only.
//
// Plain words: X1 read a small codebase, plain code built its code map, Muse Wonder proposed named parts and joins,
// and plain code checked every one against the bytes. This answer carries all of that except the code text.
// tests/unit/x2-explorer.test.ts checks that the route's answer type fits this one.

import type { CodeMap, OutlineAttempt, OutlineLanguage, OutlineSource, SkippedFile, VerifiedOutline } from "../../../src/outline/types";

export interface OutlineView {
  jobId: string;
  source: OutlineSource;
  codeSha256: string;
  files: { path: string; language: OutlineLanguage; bytes: number; sha256: string }[];
  skipped: SkippedFile[];
  codeMap: CodeMap;
  /** null when Wonder gave no usable outline (then `wonder.failure` says why). */
  verified: VerifiedOutline | null;
  wonder: { model: string; attempts: OutlineAttempt[]; failure?: string };
  usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number; usd: number } | null;
  labels: { parts: string; joins: string };
}
