// G1 (D33, D34): the spend ledger. Every model call, sandbox run and EVM fork run asks it first, and tells it after.
//
// Plain words. Before anything that costs money starts, Atlas "reserves" the most it could cost (its worst case).
// The ledger says yes only when that worst case still fits every budget it falls under:
// - the invite code's own budget: $3 a UTC day by default (D34), and an optional lifetime total;
// - the invite code's "at once" limit (how many spends it may have running together);
// - the shared money: invited developers may only use the global ceiling MINUS the owner's reserve ($20, D34), so
//   Dami's own code ("owner") always has that $20 left for filming;
// - Modal's daily caps (sandbox starts and sandbox-seconds per UTC day), now kept on disk.
// When the call ends, the reservation is "settled": the worst case is replaced by the real cost (the usage the Meta
// or Baseten API reported; for Modal, the measured seconds at the capped rate). Because every check and every
// reservation happens in one synchronous step, requests arriving at the same moment cannot both squeeze in.
//
// Everything is kept in one file on disk (spend.json, mode 600, outside the repo) and written on every reserve and
// settle, so a restart does not reset any counter. A reservation that was still open when the server stopped is
// counted at its worst case when the server starts again (it may have been billed; Atlas cannot tell).
//
// Each settle (and each refusal) adds one line to spend-log.jsonl: time, the code's LABEL (never the code), route,
// model or executor, dollars. tools/invites.ts summarises it.
//
// A spend of $0 (a run on the local executor, an EVM fork run, which has no dollar price here) is never refused for
// money, only for an invite that was revoked or is at its "at once" limit, or for EVM runs over the daily count.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { currentPrincipal, type Principal } from "./context";
import { ensureDir, writePrivate, type InviteStore } from "./store";

export const DEFAULT_OWNER_RESERVE_USD = 20; // D34
/** EVM fork runs (paid RPC reads, no dollar figure here) per invite per UTC day, for "dev" codes. */
export const DEFAULT_EVM_RUNS_PER_DAY = 10;
/**
 * The smallest worst case of one model call's first try: a bet (muse-spark-1.3: 4,000 output tokens at $20 per 1M =
 * $0.08, G1 review M7) plus a small prompt. Below this much left, an experiment does not ask the model at all
 * ("not asked"), instead of asking and being refused mid-round.
 */
export const DEFAULT_MIN_CALL_USD = 0.1;
/**
 * Modal sandbox price at the executor's caps (1 physical core, 1 GiB): $0.00003942 per core-second plus $0.00000667
 * per GiB-second (modal.com/pricing, "Modal Sandbox pricing", read 2026-10-28). An upper bound: Modal bills
 * max(reserved, used), and the executor reserves 0.5 core and 0.5 GiB with the caps at 1 and 1.
 */
export const MODAL_USD_PER_SECOND_AT_CAPS = 0.00003942 + 0.00000667;
/** Modal's own lifetime limit for a sandbox: startup (120 s) + the run's wall clock + 30 s (runners/executor/modal.ts). */
export const modalWorstCaseUsd = (wallClockMs: number): number => ((120_000 + Math.max(0, wallClockMs) + 30_000) / 1000) * MODAL_USD_PER_SECOND_AT_CAPS;

export type SpendKind = "model" | "sandbox" | "evm";

interface CodeDay { usd: number; modelUsd: number; sandboxUsd: number; calls: number; sandboxes: number; evmRuns: number; /** G1 review B3 */ modalSeconds?: number }
interface GlobalDay extends CodeDay { modalStarts: number; modalSeconds: number; /** G1 review B3: the part used by dev codes. */ devModalStarts?: number; devModalSeconds?: number }
interface Pending { who: string; label: string; role?: string; kind: SpendKind; usd: number; day: string; at: string; route: string; what: string; modal?: boolean }
interface LedgerFile {
  version: 1;
  days: Record<string, { global: GlobalDay; codes: Record<string, CodeDay> }>;
  totals: { global: { usd: number; modelUsd: number; sandboxUsd: number }; codes: Record<string, number> };
  pending: Record<string, Pending>;
}

const zeroDay = (): CodeDay => ({ usd: 0, modelUsd: 0, sandboxUsd: 0, calls: 0, sandboxes: 0, evmRuns: 0 });
const zeroGlobal = (): GlobalDay => ({ ...zeroDay(), modalStarts: 0, modalSeconds: 0 });
const emptyFile = (): LedgerFile => ({ version: 1, days: {}, totals: { global: { usd: 0, modelUsd: 0, sandboxUsd: 0 }, codes: {} }, pending: {} });
const usd = (n: number) => `$${n.toFixed(2)}`;
const KEEP_DAYS = 40;

export interface LedgerOptions {
  dir: string;
  store: InviteStore;
  /** ATLAS_REQUIRE_INVITE=1: a spend with no invite code (and not the server itself) is refused. */
  requireInvite: boolean;
  /** The global spend ceiling (ATLAS_SPEND_CEILING_USD, default $100). */
  ceilingUsd: number;
  ownerReserveUsd?: number;
  /** Model dollars spent so far, all time (the model budget's own number: usage.jsonl at start plus since). */
  modelSpentUsd: () => number;
  evmRunsPerDay?: number;
  minCallUsd?: number;
  /** Modal's daily caps (ATLAS_MODAL_MAX_SANDBOXES_PER_DAY / _SECONDS_PER_DAY; defaults 2,000 and 7,200). */
  modalStartsPerDay?: number;
  modalSecondsPerDay?: number;
  /** G1 review B3: Modal starts and sandbox-seconds ONE dev code may use per UTC day (defaults 150 and 900 = 15 min). */
  devModalStartsPerDay?: number;
  devModalSecondsPerDay?: number;
  /** G1 review B3: dev codes together may use only this share of Modal's daily caps (default 0.8); the rest is the owner's. */
  devModalShare?: number;
  /** G1 review B3: sandboxes ALL dev codes may hold at once (default 3, one less than the Modal executor's 4). */
  devSandboxesAtOnce?: number;
  now?: () => number;
}

export type Reservation = { ok: true; id: string; settle(actualUsd: number | undefined, extra?: { seconds?: number; what?: string; unknown?: boolean }): void; cancel(): void } | { ok: false; reason: string };

export interface Ledger {
  /** Asks for the worst case `usd` of one spend for the current principal. */
  reserve(r: { kind: SpendKind; usd: number; what: string; modal?: boolean }): Reservation;
  /** Is there room for at least one model call for the current principal? (Counts nothing.) */
  precheck(): { ok: true } | { ok: false; reason: string };
  /** One code's numbers today (UTC). */
  today(inviteId: string): { spentUsd: number; heldUsd: number; running: number; evmRuns: number };
  /** Model dollars the ledger has settled, all time (used at startup next to usage.jsonl). */
  modelUsdAllTime(): number;
  /** Modal's starts and seconds today, as kept on disk. */
  modalToday(): { day: string; starts: number; seconds: number };
  readonly path: string;
  readonly logPath: string;
}

export function openLedger(o: LedgerOptions): Ledger {
  ensureDir(o.dir);
  const path = join(o.dir, "spend.json");
  const logPath = join(o.dir, "spend-log.jsonl");
  const now = o.now ?? Date.now;
  const reserve$ = o.ownerReserveUsd ?? DEFAULT_OWNER_RESERVE_USD;
  const evmPerDay = o.evmRunsPerDay ?? DEFAULT_EVM_RUNS_PER_DAY;
  const minCall = o.minCallUsd ?? DEFAULT_MIN_CALL_USD;
  const modalStarts = o.modalStartsPerDay ?? 2_000;
  const modalSeconds = o.modalSecondsPerDay ?? 7_200;
  const devModalStarts = o.devModalStartsPerDay ?? 150;
  const devModalSeconds = o.devModalSecondsPerDay ?? 900;
  const devShare = o.devModalShare ?? 0.8;
  const devSandboxesAtOnce = o.devSandboxesAtOnce ?? 3;
  const dayOf = () => new Date(now()).toISOString().slice(0, 10);
  const iso = () => new Date(now()).toISOString();

  const log = (line: Record<string, unknown>) => {
    try {
      appendFileSync(logPath, `${JSON.stringify({ ts: iso(), ...line })}\n`, { mode: 0o600 });
    } catch {
      // The ledger (spend.json) is the record that enforces; a lost log line never lets a spend through.
    }
  };

  // G1 review m6: a store that already has codes but no ledger means the ledger was deleted or the store copied: refuse
  // rather than restart every counter from zero. tools/invites.ts makes the ledger with the first code.
  if (!existsSync(path) && o.store.list().length > 0) {
    throw new Error(`${path} is missing but ${o.dir} already holds invite codes; the spend counters would restart from zero. If that is really intended, run: pnpm tsx tools/invites.ts ledger-init`);
  }
  let f: LedgerFile = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as LedgerFile) : emptyFile();
  if (f.version !== 1 || typeof f.days !== "object" || typeof f.totals !== "object" || typeof f.pending !== "object") throw new Error(`${path} is not an Atlas spend ledger`);
  const save = () => writePrivate(path, JSON.stringify(f));
  const dayRec = (d: string) => (f.days[d] ??= { global: zeroGlobal(), codes: {} });
  const codeDay = (d: string, id: string) => (dayRec(d).codes[id] ??= zeroDay());

  const book = (p: Pending, cost: number, seconds = 0) => {
    const d = dayRec(p.day);
    const add = (r: CodeDay) => {
      r.usd += cost;
      if (p.kind === "model") {
        r.modelUsd += cost;
        r.calls++;
      } else if (p.kind === "sandbox") {
        r.sandboxUsd += cost;
        r.sandboxes++;
      } else r.evmRuns++;
    };
    add(d.global);
    if (p.kind === "sandbox" && p.modal) {
      d.global.modalSeconds += seconds;
      if (p.role === "dev") d.global.devModalSeconds = (d.global.devModalSeconds ?? 0) + seconds;
    }
    if (p.who.startsWith("inv_")) {
      add(codeDay(p.day, p.who));
      if (p.kind === "sandbox" && p.modal) codeDay(p.day, p.who).modalSeconds = (codeDay(p.day, p.who).modalSeconds ?? 0) + seconds;
      f.totals.codes[p.who] = (f.totals.codes[p.who] ?? 0) + cost;
    }
    f.totals.global.usd += cost;
    if (p.kind === "model") f.totals.global.modelUsd += cost;
    if (p.kind === "sandbox") f.totals.global.sandboxUsd += cost;
  };

  // A reservation still open from the last process: the server stopped mid-spend. Counted at its worst case.
  const stale = Object.entries(f.pending);
  if (stale.length > 0) {
    for (const [id, p] of stale) {
      book(p, p.usd);
      delete f.pending[id];
      log({ invite: p.label, inviteId: p.who.startsWith("inv_") ? p.who : undefined, route: p.route, kind: p.kind, what: p.what, usd: p.usd, note: "counted at its reserved worst case: the server stopped before this spend finished" });
    }
  }
  // Old days are dropped (totals keep their sums).
  for (const d of Object.keys(f.days).sort().slice(0, Math.max(0, Object.keys(f.days).length - KEEP_DAYS))) delete f.days[d];
  save();

  const pendingOf = (who: string, day?: string) => Object.values(f.pending).filter((p) => p.who === who && (day === undefined || p.day === day));
  const sum = (ps: Pending[]) => ps.reduce((n, p) => n + p.usd, 0);
  const sharedSpent = () => o.modelSpentUsd() + f.totals.global.sandboxUsd + sum(Object.values(f.pending));

  type Who = { who: string; label: string; role?: "dev" | "owner"; route: string; inviteId?: string };
  const whoNow = (): Who | { refuse: string } => {
    const p: Principal | undefined = currentPrincipal();
    if (!p) {
      if (o.requireInvite) return { refuse: "no invite code: this server needs one before it spends anything, so nothing was started" };
      return { who: "anonymous", label: "no code (invites not required)", route: "" };
    }
    if (p.kind === "system") return { who: "system", label: p.label, route: p.route };
    return { who: p.id, label: p.label, role: p.role, route: p.route, inviteId: p.id };
  };

  /** Why this principal may not spend `cost` now, or null. Pure check. */
  const why = (w: Who, kind: SpendKind, cost: number, modal: boolean): string | null => {
    const day = dayOf();
    if (w.inviteId) {
      const inv = o.store.byId(w.inviteId);
      if (!inv || inv.revokedAt) return "that invite code was revoked, so nothing was started";
      const running = pendingOf(w.inviteId).length;
      if (running >= inv.maxConcurrent) return `call limit reached: this invite already has ${running} spends running at once (its limit is ${inv.maxConcurrent}); try again when one finishes`;
      if (kind === "evm" && inv.role !== "owner") {
        const runs = codeDay(day, inv.id).evmRuns + pendingOf(inv.id, day).filter((p) => p.kind === "evm").length;
        if (runs >= evmPerDay) return `your invite's daily EVM fork runs are used up (${runs} of ${evmPerDay} today); they reset at 00:00 UTC`;
      }
      if (cost > 0) {
        if (inv.dailyUsd !== null) {
          const spent = f.days[day]?.codes[inv.id]?.usd ?? 0;
          const held = sum(pendingOf(inv.id, day));
          if (spent + held + cost > inv.dailyUsd) {
            return `your invite's daily budget is used up (spend limit reached: ${usd(spent)} spent and ${usd(held)} held for spends running, of ${usd(inv.dailyUsd)} today; this one could cost up to ${usd(cost)}); it resets at 00:00 UTC`;
          }
        }
        if (inv.totalUsd !== null) {
          const spent = f.totals.codes[inv.id] ?? 0;
          const held = sum(pendingOf(inv.id));
          if (spent + held + cost > inv.totalUsd) return `your invite's total budget is used up (spend limit reached: ${usd(spent)} spent and ${usd(held)} held, of ${usd(inv.totalUsd)} in all; this one could cost up to ${usd(cost)})`;
        }
      }
    }
    if (cost > 0) {
      const shared = sharedSpent();
      const cap = w.role === "owner" || w.who === "anonymous" || w.who === "system" ? o.ceilingUsd : Math.max(0, o.ceilingUsd - reserve$);
      if (shared + cost > cap) {
        return w.role === "dev"
          ? `spend limit reached: the money shared by invited developers is used up (${usd(shared)} of ${usd(cap)}; the last ${usd(reserve$)} of the ${usd(o.ceilingUsd)} ceiling is kept for the owner)`
          : `spend limit reached: ${usd(shared)} of the ${usd(o.ceilingUsd)} ceiling is used or held; this one could cost up to ${usd(cost)}`;
      }
    }
    if (kind === "sandbox" && w.role === "dev") {
      // G1 review B3: devs together never hold every sandbox slot, so the owner's run never waits behind them.
      const devRunning = Object.values(f.pending).filter((p) => p.kind === "sandbox" && p.role === "dev").length;
      // Review r2 m9: and one dev code holds at most 2 of them, so other devs are not shut out either.
      const mineRunning = w.inviteId ? pendingOf(w.inviteId).filter((p) => p.kind === "sandbox").length : 0;
      if (mineRunning >= 2) return `call limit reached: this invite already has ${mineRunning} sandboxes running at once (its limit is 2); try again in a few seconds`;
      if (devRunning >= devSandboxesAtOnce) return `call limit reached: invited developers already have ${devRunning} sandboxes running at once (their limit together is ${devSandboxesAtOnce}); try again in a few seconds`;
    }
    if (kind === "sandbox" && modal) {
      const g = f.days[day]?.global ?? zeroGlobal();
      const startsNow = g.modalStarts;
      if (startsNow >= modalStarts || g.modalSeconds >= modalSeconds) {
        return `Atlas's daily sandbox budget is used up (${startsNow} of ${modalStarts} sandboxes, ${Math.round(g.modalSeconds)} of ${modalSeconds} sandbox-seconds today); it resets at 00:00 UTC`;
      }
      if (w.role === "dev" && w.inviteId) {
        // G1 review B3: each dev code has its own daily share, and devs together stop at devShare of Modal's caps.
        const mine = f.days[day]?.codes[w.inviteId];
        const mySeconds = mine?.modalSeconds ?? 0;
        const myStarts = (mine?.sandboxes ?? 0) + pendingOf(w.inviteId, day).filter((p) => p.kind === "sandbox").length;
        if (myStarts >= devModalStarts || mySeconds >= devModalSeconds) return `your invite's daily sandbox share is used up (${myStarts} of ${devModalStarts} sandboxes, ${Math.round(mySeconds)} of ${devModalSeconds} sandbox-seconds today); it resets at 00:00 UTC`;
        const devStarts = g.devModalStarts ?? 0;
        const devSeconds = g.devModalSeconds ?? 0;
        if (devStarts >= modalStarts * devShare || devSeconds >= modalSeconds * devShare) return `the invited developers' share of today's sandboxes is used up (${devStarts} sandboxes, ${Math.round(devSeconds)} sandbox-seconds); the rest is kept for the owner; it resets at 00:00 UTC`;
      }
    }
    return null;
  };

  return {
    path,
    logPath,
    reserve({ kind, usd: cost, what, modal = false }) {
      const w = whoNow();
      if ("refuse" in w) {
        log({ invite: "no code", route: "", kind, what, usd: 0, refused: w.refuse });
        return { ok: false, reason: w.refuse };
      }
      const c = Number.isFinite(cost) && cost > 0 ? cost : 0;
      const no = why(w, kind, c, modal);
      if (no) {
        log({ invite: w.label, inviteId: w.inviteId, role: w.role, route: w.route, kind, what, usd: 0, refused: no });
        return { ok: false, reason: no };
      }
      const id = `r_${randomBytes(6).toString("hex")}`;
      const p: Pending = { who: w.who, label: w.label, ...(w.role ? { role: w.role } : {}), kind, usd: c, day: dayOf(), at: iso(), route: w.route, what, ...(modal ? { modal: true } : {}) };
      f.pending[id] = p;
      if (kind === "sandbox" && modal) {
        dayRec(p.day).global.modalStarts++; // counted at the start, like the executor's own cap
        if (p.role === "dev") dayRec(p.day).global.devModalStarts = (dayRec(p.day).global.devModalStarts ?? 0) + 1;
      }
      save();
      let done = false;
      return {
        ok: true,
        id,
        settle(actual, extra) {
          if (done) return;
          done = true;
          delete f.pending[id];
          const real = actual !== undefined && Number.isFinite(actual) && actual > 0 ? actual : 0;
          book(p, real, extra?.seconds ?? 0);
          save();
          log({ invite: p.label, inviteId: w.inviteId, role: p.role, route: p.route, kind, what: extra?.what ?? what, usd: real, reservedUsd: c, day: p.day, ...(extra?.unknown ? { note: "the cost was not reported (a timeout, an error after sending, or a killed run): counted at its worst case" } : {}) });
        },
        cancel() {
          if (done) return;
          done = true;
          delete f.pending[id];
          if (kind === "sandbox" && modal) {
            dayRec(p.day).global.modalStarts = Math.max(0, dayRec(p.day).global.modalStarts - 1);
            if (p.role === "dev") dayRec(p.day).global.devModalStarts = Math.max(0, (dayRec(p.day).global.devModalStarts ?? 0) - 1);
          }
          save();
        },
      };
    },
    precheck() {
      const w = whoNow();
      if ("refuse" in w) return { ok: false, reason: w.refuse };
      const no = why(w, "model", minCall, false);
      return no ? { ok: false, reason: no } : { ok: true };
    },
    today(inviteId) {
      const day = dayOf();
      const r = f.days[day]?.codes[inviteId] ?? zeroDay();
      const ps = pendingOf(inviteId, day);
      return { spentUsd: r.usd, heldUsd: sum(ps), running: pendingOf(inviteId).length, evmRuns: r.evmRuns };
    },
    modelUsdAllTime: () => f.totals.global.modelUsd,
    modalToday() {
      const day = dayOf();
      const g = f.days[day]?.global ?? zeroGlobal();
      return { day, starts: g.modalStarts, seconds: Math.round(g.modalSeconds) };
    },
  };
}

/** Reads the ledger file without opening it for writing (tools/invites.ts). */
export function readLedgerFile(dir: string): LedgerFile | undefined {
  const p = join(dir, "spend.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as LedgerFile) : undefined;
}
