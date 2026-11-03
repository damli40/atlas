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
//
// R10 (D72), the open example: with no code (or a code that no longer works), a request may also reach the few routes in
// EXAMPLE_ROUTES, which the first screen's example uses. It then runs as the "example" principal (context.ts), and those
// routes accept only the example itself, checked against content the server holds (server/access/example-lane.ts). The
// ledger refuses that principal every model call and EVM run. Every other route still needs a code, including new ones.

import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { clientIpHeaderFromEnv, clientIpOf, trustProxyFromEnv, trustedHopsFromEnv } from "../client-ip";
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
  { method: "GET", path: /^\/proofs\/[^/]+$/, why: "a public proof card (.atlas.json), read only" },
  { method: "GET", path: /^\/proofs\/[^/]+\/machine$/, why: "a shared card's machine: parts' names and lines, only once its maker has made a public link; read only" },
  { method: "GET", path: /^\/proofs\/[^/]+\/viewer$/, why: "whether a card's reader placed its bets, and whether this server keeps cards: read only" },
  { method: "GET", path: /^\/moonwell\/saved$/, why: "the saved Moonwell result, a public proof card, read only" },
  { method: "GET", path: /^\/outline\/jobs\/[^/]+(?:\/outline|\/atlas|\/parts\/[^/]+)?$/, why: "an outline job's result, read only" },
  { method: "GET", path: /^\/invite(?:\/status)?$/, why: "the invite page and who you are signed in as" },
  { method: "POST", path: /^\/invite(?:\/forget)?$/, why: "enter or forget an invite code" },
];

export const isOpenRoute = (method: string, path: string): boolean => OPEN_ROUTES.some((r) => r.method === method && r.path.test(path));

/**
 * R10 (D72): routes a visitor with NO code may reach, as the "example" principal, because the first screen's example uses them.
 * Being on this list opens nothing by itself: each route refuses (401) anything that is not the example, checked against what the
 * server holds, before any model is asked or anything runs. Keep it short; a new route stays closed unless added here on purpose.
 */
export const EXAMPLE_ROUTES: readonly { method: string; path: RegExp; why: string }[] = [
  { method: "POST", path: /^\/paste$/, why: "reads a file only when its bytes are the example's exactly (sha256); plain code, no model" },
  { method: "POST", path: /^\/paste\/labels$/, why: "plain code's labels, for the example's file only" },
  { method: "POST", path: /^\/paste\/names$/, why: "the example's names, recorded once; no call; any other file is refused" },
  { method: "POST", path: /^\/paste\/summary$/, why: "the example's summary, recorded once; no call; any other file is refused" },
  { method: "POST", path: /^\/paste\/proposals$/, why: "Muse Wonder's recorded tests for the example's one function; refused if the recording is missing" },
  { method: "POST", path: /^\/experiments$/, why: "only the example's default question, and only if every AI's recorded answer replays for its exact prompt" },
  { method: "POST", path: /^\/experiments\/[^/]+\/model-bets$/, why: "waits for the recorded answers of an open-example round; other rounds refused" },
  { method: "POST", path: /^\/bets$/, why: "seals the visitor's own bet on an open-example round (no cost); other rounds refused" },
  { method: "POST", path: /^\/runs$/, why: "runs an open-example round in the sandbox: the example's code and test only; per-address and hourly caps" },
  { method: "POST", path: /^\/paste\/claim$/, why: "shows the kept sentence of the example's recorded tests (no call); other rounds refused" },
  { method: "GET", path: /^\/runs\/[^/]+\/helpers$/, why: "the steps of a run this session made, read only" },
  { method: "GET", path: /^\/track-record$/, why: "this browser's record, kept in memory apart from invited people's; read only" },
  { method: "GET", path: /^\/remember$/, why: "this browser's last ending, from the same record; read only" },
  { method: "GET", path: /^\/events\/[^/]+$/, why: "the live log of this session's round; streams capped per address and in total" },
];
export const isExampleRoute = (method: string, path: string): boolean => EXAMPLE_ROUTES.some((r) => r.method === method && r.path.test(path));

// DAMI: placeholder wording. The facts it must keep: nothing ran, no AI was asked; the example needs no code.
export const NEEDS_INVITE = "Your own code, and anything beyond the example, needs an invite code, so nothing was run and no AI was asked.";

/**
 * R10 (D72): ATLAS_WAITLIST_URL, the external waitlist form (Dami's Tally or Google Form). Atlas only links to it and stores no
 * email. Unset or empty: no link is shown. Anything else must be a plain https address, or the server does not start.
 */
export function waitlistUrlFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.ATLAS_WAITLIST_URL?.trim();
  if (raw === undefined || raw === "") return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("ATLAS_WAITLIST_URL is not a web address; set it to the waitlist form's https:// address, or leave it unset");
  }
  if (u.protocol !== "https:") throw new Error("ATLAS_WAITLIST_URL must start with https://");
  if (u.username !== "" || u.password !== "") throw new Error("ATLAS_WAITLIST_URL must not carry a user name or password");
  if (raw.length > 500 || /[\s"'<>`]/.test(raw)) throw new Error("ATLAS_WAITLIST_URL must be a plain address of at most 500 characters (no spaces or quotes)");
  return u.toString();
}

export interface GateOptions {
  store: InviteStore;
  /** ATLAS_REQUIRE_INVITE=1. */
  require: boolean;
  ledger?: Ledger;
  /** Cookie `Secure` flag: "auto" (when the request came over HTTPS, directly or per X-Forwarded-Proto), or forced. */
  secureCookie?: "auto" | boolean;
  trustProxy?: boolean;
  /**
   * G1 review B5: the origin the page AND the API are served from (ATLAS_PUBLIC_ORIGIN, e.g. "https://atlas.example").
   * A cookie-signed request that changes something must come from it: `Sec-Fetch-Site: same-origin`, or an `Origin`
   * header equal to this. When it is https, the cookie is always Secure (review m4).
   */
  publicOrigin?: string;
  /**
   * G1 review round 2: a second copy of the app, used ONLY for the owner's code. Every in-memory capacity of an app
   * (sessions, pastes, caches, kept runs and outline jobs, the live log) is then the owner's alone, so no dev can fill
   * it. Money, sandboxes, GitHub and RPC are shared objects with their own owner shares.
   */
  ownerInner?: InnerApp;
  /** G1 review round 2: live-log streams (GET /events) open at once: per dev code, and all dev codes together. */
  streams?: { perDev: number; devsTotal: number };
  /** R10 (D72): the waitlist form's address (ATLAS_WAITLIST_URL, checked by waitlistUrlFromEnv). Absent: no link. */
  waitlistUrl?: string;
  /**
   * R10 (D72): a separate copy of the app for visitors with no code on the open example, so their sessions and pastes can
   * never push an invited developer's out of memory. Absent: they use the developers' copy.
   */
  exampleInner?: InnerApp;
  /** R10 (D72): live-log streams for visitors with no code: per address, and all of them together. */
  exampleStreams?: { perAddress: number; total: number };
}

/** G1 review B5: refused, because a cookie alone cannot prove the request came from Atlas's own page. */
export const CROSS_SITE = "Atlas refused this request: it carried the invite cookie but did not come from Atlas's own page (cross-site requests cannot spend an invite's budget). Nothing was run.";

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
  const ipHeader = clientIpHeaderFromEnv(); // H1: Fly-Client-IP on Fly.io
  // G1 review M4: only FAILED tries are limited, per address and across the server; a correct code is never refused.
  const failedByIp = createHourlyLimit(30, "invite code tries");
  const failedAll = createHourlyLimit(300, "invite code tries");
  const httpsOrigin = o.publicOrigin?.startsWith("https://") === true;
  /** G1 review B5: the request came from Atlas's own page (same origin), as the browser reports it. */
  const fromOwnPage = (c: Context): boolean => {
    if (c.req.header("sec-fetch-site") === "same-origin") return true;
    const origin = c.req.header("origin");
    return origin !== undefined && o.publicOrigin !== undefined && origin === o.publicOrigin;
  };

  const codeOf = (c: Context): string | undefined => c.req.header(INVITE_HEADER)?.trim() || getCookie(c, INVITE_COOKIE)?.trim() || undefined;
  const principalOf = (c: Context): { p: Principal } | { reason: string } | undefined => {
    const code = codeOf(c);
    if (!code) return undefined;
    const v = o.store.verify(code);
    if (!v.ok) return { reason: v.reason };
    return { p: { kind: "invite", id: v.invite.id, label: v.invite.label, role: v.invite.role, route: `${c.req.method} ${c.req.path}` } };
  };
  const secure = (c: Context) => {
    if (httpsOrigin) return true;
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
    return c.html(page("Atlas invite", `<h1>Enter your invite code</h1><p>The hosted Atlas spends real money on Meta models and sandboxes, so it asks for the code Dami gave you. It is kept in a cookie on this browser only.</p><form method="post" action="invite"><input name="code" autocomplete="off" spellcheck="false" placeholder="atlas_..." aria-label="Invite code" required><button>Use this code</button></form>${o.waitlistUrl ? `<p>No code? <a href="${esc(o.waitlistUrl)}" rel="noopener noreferrer" target="_blank">Join the waitlist</a>. The example on Atlas's first screen needs no code.</p>` : ""}`));
  });
  outer.get("/invite/status", (c) => {
    const who = principalOf(c);
    if (!who || !("p" in who) || who.p.kind !== "invite") return c.json({ required: o.require, signedIn: false, waitlist: o.waitlistUrl ?? null, ...(who && "reason" in who ? { reason: who.reason } : {}) });
    const inv = o.store.byId(who.p.id);
    return c.json({ required: o.require, signedIn: true, waitlist: o.waitlistUrl ?? null, label: who.p.label, role: who.p.role, dailyUsd: inv?.dailyUsd ?? null, today: o.ledger?.today(who.p.id) ?? null });
  });
  outer.post("/invite", async (c) => {
    // G1 review m3: signing in is only from Atlas's own page (a cross-site form cannot plant a code in a browser).
    if (!fromOwnPage(c)) return c.json({ error: CROSS_SITE }, 403);
    const ip = clientIpOf(c, trustProxy, hops, ipHeader);
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
      // G1 review M4: checked after the code, so a correct code is never refused by someone else's failures.
      const room = failedByIp.check(ip).ok && failedAll.check("all").ok;
      failedByIp.take(ip);
      failedAll.take("all");
      if (!room) return c.json({ error: "too many invite codes that did not work came in the last hour; try again later" }, 429);
      return json ? c.json({ error: v.reason }, 401) : c.html(page("Atlas invite", `<h1>That code did not work</h1><p>${esc(v.reason)}.</p><p><a href="invite">Try again</a></p>`), 401);
    }
    setCookie(c, INVITE_COOKIE, code.trim(), { httpOnly: true, sameSite: "Strict", path: "/", secure: secure(c), maxAge: COOKIE_DAYS * 24 * 3600 });
    return json ? c.json({ ok: true, label: v.invite.label, role: v.invite.role, dailyUsd: v.invite.dailyUsd }) : c.html(page("Atlas invite", `<h1>You're in as ${esc(v.invite.label)}</h1><p>Go back to Atlas and carry on.</p>`));
  });
  outer.post("/invite/forget", (c) => {
    if (!fromOwnPage(c)) return c.json({ error: CROSS_SITE }, 403); // review m3: a cross-site form cannot sign anyone out
    deleteCookie(c, INVITE_COOKIE, { path: "/", secure: secure(c) });
    return c.html(page("Atlas invite", "<h1>Forgotten</h1><p>This browser no longer holds an invite code.</p>"));
  });

  // G1 review round 2: live-log streams held open at once, per dev code and for all dev codes together (the owner's
  // streams are not counted). A stream is counted until the client goes away or the stream ends.
  const streamCaps = o.streams ?? { perDev: 4, devsTotal: 40 };
  // R10 (D72): visitors with no code get their own pool, so they can never use up the developers' streams.
  const exampleCaps = o.exampleStreams ?? { perAddress: 4, total: 40 };
  const pools = {
    dev: { per: streamCaps.perDev, total: streamCaps.devsTotal, open: 0, mine: (n: number) => `this invite already has ${n} live-log streams open (its limit is ${streamCaps.perDev}); close a tab`, all: (n: number) => `invited developers already have ${n} live-log streams open; try again later` },
    example: { per: exampleCaps.perAddress, total: exampleCaps.total, open: 0, mine: (n: number) => `this address already has ${n} live-log streams open (its limit is ${exampleCaps.perAddress}); close a tab`, all: (n: number) => `visitors without a code already have ${n} live-log streams open; try again later` },
  };
  const openStreams = new Map<string, number>();
  const streamCounted = async (id: string, pass: () => Promise<Response>, pool: (typeof pools)["dev"] = pools.dev): Promise<Response> => {
    const mine = openStreams.get(id) ?? 0;
    if (mine >= pool.per) return new Response(JSON.stringify({ error: pool.mine(mine) }), { status: 429, headers: { "content-type": "application/json" } });
    if (pool.open >= pool.total) return new Response(JSON.stringify({ error: pool.all(pool.open) }), { status: 429, headers: { "content-type": "application/json" } });
    openStreams.set(id, mine + 1);
    pool.open++;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      pool.open--;
      const n = (openStreams.get(id) ?? 1) - 1;
      if (n <= 0) openStreams.delete(id);
      else openStreams.set(id, n);
    };
    let res: Response;
    try {
      res = await pass();
    } catch (e) {
      end();
      throw e;
    }
    if (!res.body) {
      end();
      return res;
    }
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done: d, value } = await reader.read();
          if (d) {
            end();
            ctrl.close();
          } else ctrl.enqueue(value);
        } catch (e) {
          end();
          ctrl.error(e);
        }
      },
      cancel(reason) {
        end();
        return reader.cancel(reason);
      },
    });
    return new Response(body, { status: res.status, headers: res.headers });
  };

  outer.all("*", async (c): Promise<Response> => {
    const who = principalOf(c);
    const owner = who !== undefined && "p" in who && who.p.kind === "invite" && who.p.role === "owner";
    const target = owner && o.ownerInner ? o.ownerInner : inner;
    const open = isOpenRoute(c.req.method, c.req.path);
    const exampleRoute = isExampleRoute(c.req.method, c.req.path);
    const pass = async (via: InnerApp = target): Promise<Response> => {
      const res = await via.fetch(c.req.raw, c.env);
      // A public read with no code (a proof card, an outline result) may live in the owner's copy of the app.
      // R10 review: never for the open example's own routes (a no-code visitor's record, steps or log are never the owner's).
      if (!who && !exampleRoute && res.status === 404 && c.req.method === "GET" && o.ownerInner && via !== o.ownerInner) {
        const other = await o.ownerInner.fetch(c.req.raw, c.env);
        if (other.status !== 404 || !o.exampleInner || !open) return other;
      }
      // R10 (D72): a public read (a proof card of an example someone played with no code) may live in the open example's copy.
      if (res.status === 404 && c.req.method === "GET" && open && o.exampleInner && via !== o.exampleInner) return o.exampleInner.fetch(c.req.raw, c.env);
      return res;
    };
    // R10 review (D72): a valid code with no money left still plays the example; that is decided where the run starts
    // (server/app.ts POST /runs), so the code keeps everything else it may do at $0 (G1).
    if (who && "p" in who) {
      // G1 review B5: a cookie is sent by the browser on its own, so a cookie-signed request that can change or spend
      // anything must come from Atlas's own page. The header (x-atlas-invite) cannot be set cross-origin without a
      // CORS preflight, which this server never grants, so it needs no such check.
      const byCookie = !c.req.header(INVITE_HEADER);
      // Review r2 m12: a GET the person started themselves (a typed URL or a bookmark: `Sec-Fetch-Site: none`, which no
      // other page can produce) may replay; a link from another site may not.
      const typedGet = c.req.method === "GET" && c.req.header("sec-fetch-site") === "none";
      if (byCookie && (c.req.method !== "GET" || /^\/replay\//.test(c.req.path)) && !fromOwnPage(c) && !typedGet) return c.json({ error: CROSS_SITE }, 403);
      // G1 review B5: a spending POST must be JSON (a cross-origin JSON request needs a preflight; a form or text/plain does not).
      if (!open && c.req.method === "POST" && !/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "send the request as JSON (content-type: application/json); nothing was run" }, 415);
      if (/^\/events\//.test(c.req.path) && who.p.kind === "invite" && !owner) return runAs(who.p, () => streamCounted(who.p.kind === "invite" ? who.p.id : "", pass));
      return runAs(who.p, pass);
    }
    if (!o.require || open) return pass();
    // R10 (D72): the open example. No code (or one that no longer works): only the example's routes, as the "example" principal.
    // The routes themselves accept nothing but the example; this only lets the request reach them.
    if (exampleRoute) {
      // Like a spending request with a code: JSON only, so another site cannot send a "simple" form post from a visitor's browser.
      if (c.req.method === "POST" && !/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "send the request as JSON (content-type: application/json); nothing was run" }, 415);
      const ip = clientIpOf(c, trustProxy, hops, ipHeader);
      const p: Principal = { kind: "example", label: "the open example (no invite code)", route: `${c.req.method} ${c.req.path}`, ip, ...(who && "reason" in who ? { codeProblem: who.reason } : {}) };
      const via = o.exampleInner ?? inner;
      if (/^\/events\//.test(c.req.path)) return runAs(p, () => streamCounted(`ip:${ip}`, () => pass(via), pools.example));
      return runAs(p, () => pass(via));
    }
    return c.json({ error: who && "reason" in who ? `${NEEDS_INVITE} (${who.reason})` : NEEDS_INVITE, invite: { required: true, page: "/invite" }, ...(o.waitlistUrl ? { waitlist: o.waitlistUrl } : {}) }, 401);
  });
  return outer;
}
