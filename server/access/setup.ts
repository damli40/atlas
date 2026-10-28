// G1 (D33, D34): everything server/index.ts needs for invite codes and per-code budgets, built from the environment.
//
// Env (all optional unless hosted):
// - ATLAS_REQUIRE_INVITE: "1" on the hosted server; unset or "0" locally. Any other value stops the server.
// - ATLAS_INVITES_DIR: where invites.json, pepper, spend.json and spend-log.jsonl live (default ~/.config/atlas/).
// - ATLAS_INVITE_PEPPER: the secret the code fingerprints are keyed with (else the `pepper` file there).
// - ATLAS_OWNER_RESERVE_USD (default 20): kept for "owner" codes; dev codes stop at ceiling minus this.
// - ATLAS_INVITE_EVM_RUNS_PER_DAY (default 10): EVM fork runs per dev code per UTC day.
// - ATLAS_INVITE_COOKIE_SECURE: "1" always marks the cookie Secure, "0" never; unset = when the request was HTTPS.

import { envNumber } from "../meta/budget";
import { requireInviteFromEnv } from "./gate";
import { DEFAULT_EVM_RUNS_PER_DAY, DEFAULT_OWNER_RESERVE_USD, openLedger, type Ledger } from "./ledger";
import { defaultAccessDir, loadPepper, openInviteStore, type InviteStore } from "./store";

export interface Access {
  dir: string;
  require: boolean;
  store: InviteStore;
  ledger: Ledger;
  secureCookie: "auto" | boolean;
  /** Plain notes for the startup log (no secrets, no codes). */
  notes: string[];
}

const whole = (raw: string | undefined, fallback: number, max: number) => (raw !== undefined && /^\d{1,7}$/.test(raw.trim()) ? Math.min(Number(raw.trim()), max) : fallback);

export function accessFromEnv(env: Record<string, string | undefined>, deps: { ceilingUsd: number; modelSpentUsd: () => number }): Access {
  const require = requireInviteFromEnv(env);
  const dir = defaultAccessDir(env);
  const store = openInviteStore(dir, { env, createPepper: false });
  const notes: string[] = [];
  if (require) {
    // Fail closed and loud: a hosted server with no way to check a code would refuse everyone without saying why.
    if (!loadPepper(dir, env, false)) throw new Error("ATLAS_REQUIRE_INVITE=1 but there is no invite pepper (ATLAS_INVITE_PEPPER or the pepper file in ATLAS_INVITES_DIR); make a code with tools/invites.ts first");
    const active = store.list().filter((i) => !i.revokedAt);
    if (active.length === 0) throw new Error("ATLAS_REQUIRE_INVITE=1 but no invite code is active; make one with: pnpm tsx tools/invites.ts create --name <who>");
    notes.push(`invite codes required: ${active.length} active (${active.filter((i) => i.role === "owner").length} owner)`);
  } else if (env.ATLAS_EXECUTOR?.trim() === "modal") {
    notes.push("ATLAS_EXECUTOR=modal but ATLAS_REQUIRE_INVITE is not 1: anyone who can reach this server can spend its credits");
  }
  const ownerReserveUsd = envNumber(env.ATLAS_OWNER_RESERVE_USD, DEFAULT_OWNER_RESERVE_USD);
  const ledger = openLedger({
    dir,
    store,
    requireInvite: require,
    ceilingUsd: deps.ceilingUsd,
    ownerReserveUsd,
    modelSpentUsd: deps.modelSpentUsd,
    evmRunsPerDay: whole(env.ATLAS_INVITE_EVM_RUNS_PER_DAY, DEFAULT_EVM_RUNS_PER_DAY, 1000),
    // The same caps the Modal executor keeps in memory (runners/executor/select.ts), now also kept on disk.
    modalStartsPerDay: whole(env.ATLAS_MODAL_MAX_SANDBOXES_PER_DAY, 2_000, 1_000_000),
    modalSecondsPerDay: whole(env.ATLAS_MODAL_MAX_SANDBOX_SECONDS_PER_DAY, 7_200, 1_000_000),
  });
  const rawSecure = env.ATLAS_INVITE_COOKIE_SECURE?.trim();
  const secureCookie = rawSecure === "1" ? true : rawSecure === "0" ? false : "auto";
  notes.push(`spend ledger kept on disk (per invite per UTC day; owner reserve $${ownerReserveUsd} of the $${deps.ceilingUsd} ceiling)`);
  return { dir, require, store, ledger, secureCookie, notes };
}
