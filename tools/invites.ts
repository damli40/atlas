// G1 (D33): the operator's tool for invite codes. Run on the machine (or host) that runs the server.
//
//   pnpm tsx tools/invites.ts create --name <who> [--daily-usd 3] [--total-usd N] [--owner] [--max-concurrent 4]
//   pnpm tsx tools/invites.ts list
//   pnpm tsx tools/invites.ts revoke <id or name>
//   pnpm tsx tools/invites.ts usage [--day YYYY-MM-DD] [--name <who>]
//
// The store lives in ATLAS_INVITES_DIR (default ~/.config/atlas/), or --dir <folder>. `create` prints the new code ONCE;
// only its fingerprint is kept, so a lost code cannot be shown again (revoke it and make a new one). Nothing here ever
// prints a fingerprint, the pepper or an old code. A revoke takes effect on the server's next request, no restart.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readLedgerFile } from "../server/access/ledger";
import { defaultAccessDir, openInviteStore, type Invite } from "../server/access/store";

const HELP = `Atlas invite codes

  create --name <who> [--daily-usd 3] [--total-usd N] [--owner] [--max-concurrent 4]
      Make a code. Dev codes default to $3 a UTC day (D34). --owner makes Dami's own code: no daily cap unless
      given, and it may use the owner reserve that dev codes cannot touch. The code is printed once.
  list                      Every code: id, name, role, budgets, today's spend, revoked or not.
  revoke <id or name>       Stop a code. The server refuses it from its next request on.
  usage [--day YYYY-MM-DD] [--name <who>]
                            What each code spent (from spend-log.jsonl): today (or --day), in all, by route and model.

  --dir <folder>            The store folder (default: ATLAS_INVITES_DIR, else ~/.config/atlas/).
`;

type Args = { cmd: string; pos: string[]; flags: Record<string, string | true> };
function parse(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const k = a.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--") && !["owner"].includes(k)) {
      flags[k] = next;
      i++;
    } else flags[k] = true;
  }
  return { cmd, pos, flags };
}

const money = (v: number | null) => (v === null ? "none" : `$${v.toFixed(2)}`);
const num = (v: string | true | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v === true || !Number.isFinite(n)) throw new Error(`${name} needs a number`);
  return n;
};

interface LogLine { ts: string; invite?: string; inviteId?: string; route?: string; kind?: string; what?: string; usd?: number; refused?: string; note?: string }

export function main(argv: string[], out: (line: string) => void = (l) => console.log(l), env: Record<string, string | undefined> = process.env): number {
  const a = parse(argv);
  const dir = typeof a.flags.dir === "string" ? a.flags.dir : defaultAccessDir(env);
  const store = openInviteStore(dir, { env, createPepper: true });
  const today = new Date().toISOString().slice(0, 10);

  switch (a.cmd) {
    case "create": {
      if (typeof a.flags.name !== "string") throw new Error("create needs --name <who>");
      const owner = a.flags.owner === true;
      const daily = num(a.flags["daily-usd"], "--daily-usd");
      const total = num(a.flags["total-usd"], "--total-usd");
      const conc = num(a.flags["max-concurrent"], "--max-concurrent");
      const { code, invite } = store.create({ label: a.flags.name, role: owner ? "owner" : "dev", ...(daily !== undefined ? { dailyUsd: daily } : {}), ...(total !== undefined ? { totalUsd: total } : {}), ...(conc !== undefined ? { maxConcurrent: conc } : {}) });
      out(`Made ${invite.role} code ${invite.id} for "${invite.label}": ${money(invite.dailyUsd)} a UTC day, ${money(invite.totalUsd)} in all, ${invite.maxConcurrent} at once.`);
      out("The code (shown once; Atlas keeps only its fingerprint; send it privately):");
      out(code);
      return 0;
    }
    case "list": {
      const ledger = readLedgerFile(dir);
      const rows = store.list();
      if (rows.length === 0) {
        out(`No invite codes in ${dir}.`);
        return 0;
      }
      for (const i of rows) {
        const spent = ledger?.days[today]?.codes[i.id]?.usd ?? 0;
        const all = ledger?.totals.codes[i.id] ?? 0;
        out(`${i.id}  ${i.label.padEnd(20)} ${i.role.padEnd(5)} daily ${money(i.dailyUsd).padEnd(7)} total ${money(i.totalUsd).padEnd(7)} today $${spent.toFixed(4)}  all $${all.toFixed(4)}  ${i.revokedAt ? `REVOKED ${i.revokedAt}` : "active"}`);
      }
      return 0;
    }
    case "revoke": {
      const who = a.pos[0];
      if (!who) throw new Error("revoke needs an id or name");
      const done = store.revoke(who);
      if (done.length === 0) {
        out(`No active code with id or name "${who}".`);
        return 1;
      }
      for (const i of done) out(`Revoked ${i.id} ("${i.label}") at ${i.revokedAt}. The server refuses it from its next request.`);
      return 0;
    }
    case "usage": {
      const day = typeof a.flags.day === "string" ? a.flags.day : today;
      const only = typeof a.flags.name === "string" ? a.flags.name : undefined;
      const path = join(dir, "spend-log.jsonl");
      const lines: LogLine[] = existsSync(path)
        ? readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((l) => {
            try {
              return [JSON.parse(l) as LogLine];
            } catch {
              return [];
            }
          })
        : [];
      const byLabel = new Map<string, { day: number; all: number; spends: number; refused: number; routes: Map<string, number>; whats: Map<string, number> }>();
      for (const l of lines) {
        const label = l.invite ?? "unknown";
        if (only && label !== only) continue;
        const r = byLabel.get(label) ?? { day: 0, all: 0, spends: 0, refused: 0, routes: new Map(), whats: new Map() };
        byLabel.set(label, r);
        if (l.refused) {
          if (l.ts.startsWith(day)) r.refused++;
          continue;
        }
        const u = typeof l.usd === "number" ? l.usd : 0;
        r.all += u;
        if (l.ts.startsWith(day)) {
          r.day += u;
          r.spends++;
          const route = l.route || "(no route)";
          r.routes.set(route, (r.routes.get(route) ?? 0) + u);
          const what = l.what ?? l.kind ?? "?";
          r.whats.set(what, (r.whats.get(what) ?? 0) + u);
        }
      }
      if (byLabel.size === 0) {
        out(`No spend logged in ${path}${only ? ` for "${only}"` : ""}.`);
        return 0;
      }
      const invites = new Map<string, Invite>(store.list().map((i) => [i.label, i]));
      out(`Spend on ${day} (UTC), from ${path}:`);
      for (const [label, r] of [...byLabel.entries()].sort((x, y) => y[1].day - x[1].day)) {
        const inv = invites.get(label);
        out(`- ${label}${inv ? ` (${inv.role}, daily ${money(inv.dailyUsd)})` : ""}: $${r.day.toFixed(4)} on ${day} in ${r.spends} spends, ${r.refused} refused; $${r.all.toFixed(4)} in all`);
        for (const [route, u] of [...r.routes.entries()].sort((x, y) => y[1] - x[1])) out(`    route ${route}: $${u.toFixed(4)}`);
        for (const [what, u] of [...r.whats.entries()].sort((x, y) => y[1] - x[1])) out(`    ${what}: $${u.toFixed(4)}`);
      }
      return 0;
    }
    default:
      out(HELP);
      return a.cmd === "help" || a.cmd === "--help" ? 0 : 1;
  }
}

const isMain = process.argv[1] !== undefined && /tools[\\/]invites\.ts$/.test(process.argv[1]);
if (isMain) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`invites: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}
