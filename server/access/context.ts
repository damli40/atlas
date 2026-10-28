// G1 (D33): who is spending, for the length of one request and everything it starts.
//
// Plain words: when a request arrives with a valid invite code, the gate (server/access/gate.ts) runs the rest of the
// request "inside" that code. Anything the request starts later (a model bet that finishes after the answer was sent,
// an outline job in the background, a sandbox run) still knows which code it is spending for. Node's
// AsyncLocalStorage carries it through every await and promise; nothing has to pass it by hand.
//
// Three kinds of spender:
// - "invite": a person's invite code (role "dev" or "owner"). Budgets apply.
// - "system": the server itself (the Modal warm-up at startup, D32). Counted in the global totals, no invite budget.
// - none: a request with no code. When invites are required, every spending point refuses it.

import { AsyncLocalStorage } from "node:async_hooks";

export type InviteRole = "dev" | "owner";

export type Principal =
  | { kind: "invite"; id: string; label: string; role: InviteRole; /** e.g. "POST /experiments": where the spend started. */ route: string }
  | { kind: "system"; label: string; route: string };

const store = new AsyncLocalStorage<Principal>();

/** The spender of the code running now, or undefined (no code, or outside any request). */
export const currentPrincipal = (): Principal | undefined => store.getStore();

/** Runs `fn` as this spender: everything it awaits or starts sees the same principal. */
export const runAs = <T>(p: Principal, fn: () => T): T => store.run(p, fn);

/** The key the per-address limits count under when a code is present (server/app.ts clientOf): the code, not the address. */
export const principalClientKey = (): string | undefined => {
  const p = store.getStore();
  return p?.kind === "invite" ? `invite:${p.id}` : undefined;
};

/**
 * G1 review B2/B6: who a shared counter counts this for. The owner's code has its own counters (devs can never use them
 * up); each dev code has its own share; requests without a code (a local server) and the server itself share one.
 */
export function spenderOf(): { kind: "owner" | "dev" | "other"; key: string } {
  const p = store.getStore();
  if (p?.kind === "invite") return p.role === "owner" ? { kind: "owner", key: `owner:${p.id}` } : { kind: "dev", key: `dev:${p.id}` };
  return { kind: "other", key: p?.kind === "system" ? "system" : "anonymous" };
}
