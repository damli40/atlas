// The live server's options, built from the environment (E3 review M3: kept here, not inline in server/index.ts, so a
// test can build exactly what the real server builds and check that every role is wired, without opening a port).
//
// Plain words: every model role is on unless its switch says "off". The chat functions come from `makeChat` (the
// real Meta client in server/index.ts; a fake in tests), so building the options never calls a model.

import type { AppOptions } from "./app";
import type { ChatArgs, ChatResult } from "./meta/client";
import type { ModelBudget } from "./meta/budget";
import type { ProofStore } from "./evm-round";
import type { RefusalWriter } from "./proofs/refusals";

export interface WiringDeps {
  /** A chat function with the given timeout (ms); undefined = the client's default. */
  makeChat: (timeoutMs?: number) => (args: ChatArgs) => Promise<ChatResult>;
  budget: ModelBudget;
  sparkOpen: { available: true } | { available: false; reason: string };
  proofs: ProofStore;
  refusals: RefusalWriter;
}

/** Bets get a shorter deadline than the client's default, so a model that never answers cannot hold a run for minutes. */
export const BET_TIMEOUT_MS = 45_000;

export interface Switches {
  modelBets: boolean;
  investigator: boolean;
  /** E3: Muse Wonder's test proposals on pasted code (ATLAS_PROPOSER=off turns it off). */
  proposer: boolean;
  fixer: boolean;
  adversary: boolean;
}

export const switchesFromEnv = (env: Record<string, string | undefined> = process.env): Switches => ({
  modelBets: env.ATLAS_MODEL_BETS !== "off",
  investigator: env.ATLAS_INVESTIGATOR !== "off",
  proposer: env.ATLAS_PROPOSER !== "off",
  fixer: env.ATLAS_FIXER !== "off",
  adversary: env.ATLAS_ADVERSARY !== "off",
});

export function serverOptions(env: Record<string, string | undefined>, deps: WiringDeps): AppOptions {
  const on = switchesFromEnv(env);
  const { budget, sparkOpen } = deps;
  return {
    proofs: deps.proofs,
    ...(on.modelBets ? { modelBets: { chat: deps.makeChat(BET_TIMEOUT_MS), budget, sparkOpen } } : {}),
    // D04-03: the Investigator reads whole targets, so it gets the client's default time limit (120 s).
    ...(on.investigator ? { investigator: { chat: deps.makeChat(), budget } } : {}),
    // E3 review M3: Muse Wonder proposes tests for pasted code on the real server too (it was wired only in scripts).
    // E3 review r2 minor 1: with the shared budget, so a proposer-only server still keeps the spend ceiling.
    ...(on.proposer ? { paste: { proposer: { chat: deps.makeChat(), budget } } } : {}),
    // ATLAS_FIXER_REPAIR_WITH=chat: when Muse Code's diff is refused, the one repair try is the muse-spark-1.3 chat.
    ...(on.fixer ? { fixer: { chat: deps.makeChat(), budget, ...(env.ATLAS_FIXER_REPAIR_WITH === "chat" ? { repairWith: "chat-fallback" as const } : {}) } } : {}),
    ...(on.adversary ? { adversary: { chat: deps.makeChat(), budget } } : {}),
    refusals: deps.refusals,
  };
}
