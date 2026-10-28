// G1 (D33): the invite gate in front of the whole server.
//
// Plain words: with ATLAS_REQUIRE_INVITE=1 (set on the hosted server), a request reaches anything that can spend money
// or start a sandbox only with a valid invite code. The code comes in the `x-atlas-invite` header, or in a cookie that
// the small page at /invite sets after the person types their code. Without one the answer is 401 with a plain
// sentence, and nothing is spent and nothing is started: the request never reaches the app.
//
// The gate is an ALLOW-LIST of the few read-only routes that stay open (health, the claimant list, the paste
// languages, the live log, public proof cards, outline results, the invite page itself). Every other route needs a
// code, including any route added later: a new route is closed until someone opens it here on purpose.
//
// With a valid code, the rest of the request (and everything it starts later) runs as that code
// (server/access/context.ts), so the ledger charges it and the per-address limits count it by code, not by address.
// Without ATLAS_REQUIRE_INVITE=1 (local development) nothing is refused here; a valid code is still used if sent.

import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { clientIpOf, trustProxyFromEnv, trustedHopsFromEnv } from "../client-ip";
import { createHourlyLimit } from "../replay-limits";
import { runAs, type Principal } from "./context";
import type { Ledger } from "./ledger";
import type { InviteStore } from "./store";

export const INVITE_HEADER = "x-atlas-invite";
export const INVITE_COOKIE = "atlas_invite";
const COOKIE_DAYS = 30;

/** Read-only routes that stay open without a code (method, exact path shape). Everything else needs one. */
export const OPEN_ROUTES: readonly { method: string; path: RegExp; why: string }[] = [
  { method: "GET", path: /^\/health$/, why: "is the server up" },
  { method: "GET", path: /^\/claimants$/, why: "which models the page can offer (known at startup, no call)" },
  { method: "GET", path: /^\/paste\/languages$/, why: "which languages can be pasted (no call)" },
  { method: "GET", path: /^\/events\/[^/]+$/, why: "the live agent log of a session (reads memory)" },
  { method: "GET", path: /^\/proofs\/[^/]+$/, why: "a public proof card (.atlas.json), read only" },
  { method: "GET", path: /^\/outline\/jobs\/[^/]+(?:\/outline|\/atlas|\/parts\/[^/]+)?$/, why: "an outline job's result, read only" },
  { method: "GET", path: /^\/invite(?:\/status)?$/, why: "the invite page and who you are signed in as" },
  { method: "POST", path: /^\/invite(?:\/forget)?$/, why: "enter or forget an invite code" },
];

export const isOpenRoute = (method: string, path: string): boolean => OPEN_ROUTES.some((r) => r.method === method && r.path.test(path));

export const NEEDS_INVITE = "Atlas needs an invite code for this, so nothing was run and no model was asked. Enter your code at /invite (or send it in the x-atlas-invite header).";

export interface GateOptions {
  store: InviteStore;
  /** ATLAS_REQUIRE_INVITE=1. */
  require: boolean;
  ledger?: Ledger;
  /** Cookie `Secure` flag: "auto" (when the request came over HTTPS, directly or per X-Forwarded-Proto), or forced. */
  secureCookie?: "auto" | boolean;
  trustProxy?: boolean;
}

/** Reads ATLAS_REQUIRE_INVITE: unset or "0" is off, "1" is on, anything else stops the server (a typo must not mean "off"). */
export function requireInviteFromEnv(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.ATLAS_REQUIRE_INVITE;
  if (raw === undefined || raw.trim() === "0") return false;
  if (raw.trim() === "1") return true;
  throw new Error(`ATLAS_REQUIRE_INVITE must be "1" (invite codes required) or "0" / unset (not required); got ${JSON.stringify(raw.slice(0, 20))}`);
}

type InnerApp = { fetch: (req: Request, env?: unknown) => Response | Promise<Response> };

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:#f7f6f2;--fg:#1d1d1b;--muted:#5d5d58;--line:#cfcdc4;--accent:#2b5bd7}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#a3a29b;--line:#3a3935;--accent:#8fb0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:30rem;margin:12vh auto;padding:0 16px}
h1{font-size:1.4rem;margin:0 0 .5rem}p{color:var(--muted)}
input{width:100%;box-sizing:border-box;padding:.6rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg);font:inherit}
button{margin-top:.75rem;padding:.55rem 1rem;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;cursor:pointer}
</style></head><body><main>${body}</main></body></html>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function withInviteGate(inner: InnerApp, o: GateOptions): Hono {
  const outer = new Hono();
  const trustProxy = o.trustProxy ?? trustProxyFromEnv();
  const hops = trustedHopsFromEnv();
  const failedByIp = createHourlyLimit(30, "invite code tries");

  const codeOf = (c: Context): string | undefined => c.req.header(INVITE_HEADER)?.trim() || getCookie(c, INVITE_COOKIE)?.trim() || undefined;
  const principalOf = (c: Context): { p: Principal } | { reason: string } | undefined => {
    const code = codeOf(c);
    if (!code) return undefined;
    const v = o.store.verify(code);
    if (!v.ok) return { reason: v.reason };
    return { p: { kind: "invite", id: v.invite.id, label: v.invite.label, role: v.invite.role, route: `${c.req.method} ${c.req.path}` } };
  };
  const secure = (c: Context) => {
    if (o.secureCookie === true || o.secureCookie === false) return o.secureCookie;
    return new URL(c.req.url).protocol === "https:" || (trustProxy && c.req.header("x-forwarded-proto")?.split(",").pop()?.trim() === "https");
  };

  // The invite page. GET shows the form (or who you are); POST takes the code from a form or JSON.
  outer.get("/invite", (c) => {
    const who = principalOf(c);
    if (who && "p" in who && who.p.kind === "invite") {
      const t = o.ledger?.today(who.p.id);
      const inv = o.store.byId(who.p.id);
      const left = inv?.dailyUsd !== null && inv?.dailyUsd !== undefined && t ? `You have $${Math.max(0, inv.dailyUsd - t.spentUsd - t.heldUsd).toFixed(2)} of $${inv.dailyUsd.toFixed(2)} left today (resets 00:00 UTC).` : "";
      return c.html(page("Atlas invite", `<h1>You're in as ${esc(who.p.label)}</h1><p>${left}</p><form method="post" action="invite/forget"><button>Forget my code on this browser</button></form>`));
    }
    return c.html(page("Atlas invite", `<h1>Enter your invite code</h1><p>The hosted Atlas spends real money on Meta models and sandboxes, so it asks for the code Dami gave you. It is kept in a cookie on this browser only.</p><form method="post" action="invite"><input name="code" autocomplete="off" spellcheck="false" placeholder="atlas_..." aria-label="Invite code" required><button>Use this code</button></form>`));
  });
  outer.get("/invite/status", (c) => {
    const who = principalOf(c);
    if (!who || !("p" in who) || who.p.kind !== "invite") return c.json({ required: o.require, signedIn: false, ...(who && "reason" in who ? { reason: who.reason } : {}) });
    const inv = o.store.byId(who.p.id);
    return c.json({ required: o.require, signedIn: true, label: who.p.label, role: who.p.role, dailyUsd: inv?.dailyUsd ?? null, today: o.ledger?.today(who.p.id) ?? null });
  });
  outer.post("/invite", async (c) => {
    const ip = clientIpOf(c, trustProxy, hops);
    const room = failedByIp.check(ip);
    if (!room.ok) return c.json({ error: "too many invite codes that did not work came from this address in the last hour; try again later" }, 429);
    const json = (c.req.header("content-type") ?? "").includes("application/json");
    let code = "";
    try {
      if (json) code = String(((await c.req.json()) as { code?: unknown }).code ?? "");
      else code = String((await c.req.parseBody()).code ?? "");
    } catch {
      return c.json({ error: "send the code as a form field or JSON {\"code\": \"...\"}" }, 400);
    }
    const v = o.store.verify(code);
    if (!v.ok) {
      failedByIp.take(ip);
      return json ? c.json({ error: v.reason }, 401) : c.html(page("Atlas invite", `<h1>That code did not work</h1><p>${esc(v.reason)}.</p><p><a href="invite">Try again</a></p>`), 401);
    }
    setCookie(c, INVITE_COOKIE, code.trim(), { httpOnly: true, sameSite: "Strict", path: "/", secure: secure(c), maxAge: COOKIE_DAYS * 24 * 3600 });
    return json ? c.json({ ok: true, label: v.invite.label, role: v.invite.role, dailyUsd: v.invite.dailyUsd }) : c.html(page("Atlas invite", `<h1>You're in as ${esc(v.invite.label)}</h1><p>Go back to Atlas and carry on.</p>`));
  });
  outer.post("/invite/forget", (c) => {
    deleteCookie(c, INVITE_COOKIE, { path: "/" });
    return c.html(page("Atlas invite", "<h1>Forgotten</h1><p>This browser no longer holds an invite code.</p>"));
  });

  outer.all("*", (c) => {
    const pass = () => inner.fetch(c.req.raw, c.env);
    const who = principalOf(c);
    if (who && "p" in who) return runAs(who.p, pass);
    if (!o.require || isOpenRoute(c.req.method, c.req.path)) return pass();
    return c.json({ error: who ? `${NEEDS_INVITE} (${who.reason})` : NEEDS_INVITE, invite: { required: true, page: "/invite" } }, 401);
  });
  return outer;
}
