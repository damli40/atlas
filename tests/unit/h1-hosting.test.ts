// H1 (D52): the hosted server on Fly.io. One origin for the page and the API, the startup refusals, setup mode, the
// Fly-Client-IP rule, the fixer on a machine without sandbox-exec, and the deploy files (Dockerfile, fly.toml,
// .dockerignore, tools/fly-secrets.sh) checked against the server's own rules. Mocked models; no network; $0.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIpHeaderFromEnv, clientIpOf, describeClientRule } from "../../server/client-ip";
import { DEFAULT_VOLUME_DIR, SAFETY_HEADERS, SETUP_MESSAGE, executorProblem, hostedFromEnv, hostedProblems, hostedSummary, servePage, setupApp, setupLine, setupNeeded, type HostFacts } from "../../server/hosting";
import { openInviteStore } from "../../server/access/store";
import { runFixer } from "../../server/meta/roles/fixer";
import { MODAL_IMAGE } from "../../runners/executor/modal";
import { tsChangeContext } from "../../runners/change";
import type { Experiment } from "../../src/types";
import { build, client, pastedRound, PEPPER } from "../tools/g1-fixtures";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const ORIGIN = "https://atlas-dami.fly.dev";

/** The [env] table of fly.toml (simple `KEY = "value"` lines), so the tests read what Fly will set. */
function flyEnv(): Record<string, string> {
  const text = read("fly.toml");
  const env: Record<string, string> = {};
  let inEnv = false;
  for (const line of text.split("\n")) {
    if (/^\s*\[/.test(line)) inEnv = /^\s*\[env\]\s*$/.test(line);
    const m = inEnv ? /^\s*([A-Z_]+)\s*=\s*"([^"]*)"\s*$/.exec(line) : null;
    if (m) env[m[1]!] = m[2]!;
  }
  return env;
}
const flyApp = () => /^app\s*=\s*"([^"]+)"/m.exec(read("fly.toml"))![1]!;

const okFacts: HostFacts = { platform: "linux", sandboxExec: false, isMountPoint: (p) => p === "/data", exists: () => true };
/** A hosted env that passes every check (as on the Fly machine: fly.toml's [env] plus the secrets and Fly's own vars). */
const goodEnv = (): Record<string, string | undefined> => ({
  ...flyEnv(),
  FLY_APP_NAME: flyApp(),
  FLY_REGION: "lhr",
  MODAL_TOKEN_ID: "ak-SECRETMARKERID",
  MODAL_TOKEN_SECRET: "as-SECRETMARKERSECRET",
  ATLAS_INVITE_PEPPER: PEPPER,
  META_API_KEY: "SECRETMARKERMETA",
  BASE_RPC_URL: "https://rpc.example/SECRETMARKERRPC",
});

describe("H1: when the server refuses to start", () => {
  it("ATLAS_HOSTED: only 1 means hosted; a Fly machine without it is refused; any other value throws", () => {
    expect(hostedFromEnv({ ATLAS_HOSTED: "1" })).toBe(true);
    expect(hostedFromEnv({})).toBe(false);
    expect(hostedFromEnv({ ATLAS_HOSTED: "0" })).toBe(false);
    expect(() => hostedFromEnv({ ATLAS_HOSTED: "yes" })).toThrow(/ATLAS_HOSTED must be/);
    expect(() => hostedFromEnv({ FLY_APP_NAME: "atlas-dami" })).toThrow(/FLY_APP_NAME is set/);
    expect(() => hostedFromEnv({ FLY_APP_NAME: "atlas-dami", ATLAS_HOSTED: "0" })).toThrow(/FLY_APP_NAME is set/);
  });

  it("a machine without macOS sandbox-exec must send every pasted run to Modal", () => {
    expect(executorProblem({}, { platform: "darwin", sandboxExec: true })).toBeNull();
    expect(executorProblem({ ATLAS_EXECUTOR: "modal" }, { platform: "linux", sandboxExec: false })).toBeNull();
    expect(executorProblem({}, { platform: "linux", sandboxExec: false })).toMatch(/set ATLAS_EXECUTOR=modal/);
    expect(executorProblem({ ATLAS_EXECUTOR: "local" }, { platform: "linux", sandboxExec: false })).toMatch(/no macOS sandbox-exec/);
    expect(executorProblem({ ATLAS_EXECUTOR: "local" }, { platform: "darwin", sandboxExec: false })).toMatch(/no macOS sandbox-exec/);
  });

  it("fly.toml's own [env], with the secrets set, passes every hosted check", () => {
    expect(hostedProblems(goodEnv(), okFacts)).toEqual([]);
    expect(executorProblem(goodEnv(), okFacts)).toBeNull();
  });

  const cases: [string, (e: Record<string, string | undefined>) => void, RegExp, Partial<HostFacts>?][] = [
    ["invites off", (e) => delete e.ATLAS_REQUIRE_INVITE, /invite codes are off/],
    ["invites 0", (e) => (e.ATLAS_REQUIRE_INVITE = "0"), /invite codes are off/],
    ["no public origin", (e) => delete e.ATLAS_PUBLIC_ORIGIN, /ATLAS_PUBLIC_ORIGIN is not set/],
    ["an http public origin", (e) => (e.ATLAS_PUBLIC_ORIGIN = "http://atlas-dami.fly.dev"), /must start with https/],
    ["another app's fly.dev origin", (e) => (e.ATLAS_PUBLIC_ORIGIN = "https://someone-else.fly.dev"), /whose address is https:\/\/atlas-dami\.fly\.dev/],
    ["local executor", (e) => (e.ATLAS_EXECUTOR = "local"), /ATLAS_EXECUTOR is not modal/],
    ["no Modal token secret", (e) => delete e.MODAL_TOKEN_SECRET, /Modal token is missing/],
    ["an empty Modal token id", (e) => (e.MODAL_TOKEN_ID = " "), /Modal token is missing/],
    ["no volume mounted", () => {}, /nothing is mounted at \/data/, { isMountPoint: () => false }],
    ["no store folder", (e) => delete e.ATLAS_INVITES_DIR, /ATLAS_INVITES_DIR is not set/],
    ["store off the volume", (e) => (e.ATLAS_INVITES_DIR = "/srv/atlas-store"), /not a folder inside the volume/],
    ["store is the volume itself", (e) => (e.ATLAS_INVITES_DIR = "/data"), /not a folder inside the volume/],
    ["store escapes with ..", (e) => (e.ATLAS_INVITES_DIR = "/data/../etc"), /not a folder inside the volume/],
    ["usage log off the volume", (e) => (e.ATLAS_USAGE_PATH = "/app/tests/evidence/usage/usage.jsonl"), /ATLAS_USAGE_PATH must be a file on the volume/],
    ["Fly without the Fly-Client-IP rule", (e) => delete e.ATLAS_CLIENT_IP_HEADER, /Fly-Client-IP|Fly's own header/],
    ["Fly without trust proxy", (e) => (e.ATLAS_TRUST_PROXY = "0"), /Fly's own header/],
    ["no built page", () => {}, /the built page is missing/, { exists: () => false }],
  ];
  for (const [what, change, msg, facts] of cases) {
    it(`refuses: ${what}`, () => {
      const env = goodEnv();
      change(env);
      const problems = hostedProblems(env, { ...okFacts, ...facts });
      expect(problems.some((p) => msg.test(p))).toBe(true);
      // Never a secret's value in what is printed.
      expect(problems.join("\n")).not.toMatch(/SECRETMARKER/);
    });
  }

  it("all problems are listed at once, not one per restart", () => {
    const problems = hostedProblems({ FLY_APP_NAME: "atlas-dami" }, { ...okFacts, isMountPoint: () => false, exists: () => false });
    expect(problems.length).toBeGreaterThanOrEqual(8);
  });

  it("the container entry reads .env first, like server/index.ts", () => {
    expect(read("server/host.ts").split("\n").find((l) => l.startsWith("import "))).toBe('import "./load-env";');
  });

  it("the store lock still refuses a second server on the same store (G1 M5), unchanged", async () => {
    const { acquireStoreLock } = await import("../../server/access/store");
    const dir = mkdtempSync(join(tmpdir(), "atlas-h1-lock-"));
    const release = acquireStoreLock(dir);
    expect(() => acquireStoreLock(dir)).toThrow(/already using the invite store/);
    release();
  });
});

describe("H1: setup mode (first deploy, no invite code yet)", () => {
  const storeEnv = () => {
    const vol = mkdtempSync(join(tmpdir(), "atlas-h1-vol-"));
    return { ...goodEnv(), ATLAS_VOLUME_DIR: vol, ATLAS_INVITES_DIR: join(vol, "atlas"), ATLAS_USAGE_PATH: join(vol, "usage.jsonl") };
  };
  const facts = (env: Record<string, string | undefined>): HostFacts => ({ ...okFacts, isMountPoint: (p) => p === env.ATLAS_VOLUME_DIR });

  it("is chosen only when hosted, every check passes, the pepper is set and no code is active", () => {
    const env = storeEnv();
    expect(setupNeeded(env, facts(env))).toBe(true);
    expect(setupNeeded({ ...env, ATLAS_HOSTED: "0", FLY_APP_NAME: undefined }, facts(env))).toBe(false);
    expect(setupNeeded({ ...env, ATLAS_EXECUTOR: "local" }, facts(env))).toBe(false); // the full server refuses and says why
    expect(setupNeeded({ ...env, ATLAS_INVITE_PEPPER: undefined }, facts(env))).toBe(false);
    const store = openInviteStore(env.ATLAS_INVITES_DIR, { env, createPepper: false });
    const made = store.create({ label: "dami", role: "owner" });
    expect(setupNeeded(env, facts(env))).toBe(false);
    store.revoke(made.invite.id);
    expect(setupNeeded(env, facts(env))).toBe(true); // a revoked code does not count
  });

  it("answers /health (so Fly's check passes and ssh works) and refuses everything else with 503", async () => {
    const app = setupApp();
    const h = await app.request("/health");
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ ok: false, setup: true });
    for (const [m, p] of [["GET", "/"], ["POST", "/api/paste"], ["GET", "/api/invite"], ["POST", "/api/runs"]] as const) {
      const r = await app.request(p, { method: m, headers: { "content-type": "application/json" }, ...(m === "POST" ? { body: "{}" } : {}) });
      expect(r.status).toBe(503);
      expect(((await r.json()) as { error: string }).error).toBe(SETUP_MESSAGE);
    }
  });

  it("its startup line names the exact next two commands", () => {
    const line = setupLine(8080, "atlas-dami");
    expect(line).toContain('fly ssh console --app atlas-dami -C "/usr/local/bin/atlas-invites create --name dami --owner"');
    expect(line).toContain("fly apps restart atlas-dami");
  });
});

describe("H1: the visitor's address behind Fly's proxy", () => {
  it("ATLAS_CLIENT_IP_HEADER needs ATLAS_TRUST_PROXY=1 and a plain one-value header name", () => {
    expect(clientIpHeaderFromEnv({})).toBeUndefined();
    expect(clientIpHeaderFromEnv({ ATLAS_TRUST_PROXY: "1", ATLAS_CLIENT_IP_HEADER: "Fly-Client-IP" })).toBe("fly-client-ip");
    expect(() => clientIpHeaderFromEnv({ ATLAS_CLIENT_IP_HEADER: "fly-client-ip" })).toThrow(/ATLAS_TRUST_PROXY is not 1/);
    expect(() => clientIpHeaderFromEnv({ ATLAS_TRUST_PROXY: "1", ATLAS_CLIENT_IP_HEADER: "x-forwarded-for" })).toThrow(/not a one-value header/);
    expect(() => clientIpHeaderFromEnv({ ATLAS_TRUST_PROXY: "1", ATLAS_CLIENT_IP_HEADER: "bad header!" })).toThrow(/must be a header name/);
  });

  const ipApp = () => {
    const app = new Hono();
    app.get("/ip", (c) => c.text(clientIpOf(c, true, 1, "fly-client-ip")));
    return app;
  };
  it("reads Fly-Client-IP and ignores X-Forwarded-For (whose right-most entry on Fly is the app itself)", async () => {
    const app = ipApp();
    const ask = async (h: Record<string, string>) => (await app.request("/ip", { headers: h })).text();
    expect(await ask({ "fly-client-ip": "41.58.1.2", "x-forwarded-for": "6.6.6.6, 41.58.1.2, 137.66.0.1" })).toBe("41.58.1.2");
    expect(await ask({ "fly-client-ip": "41.58.1.2", "x-forwarded-for": "9.9.9.9" })).toBe("41.58.1.2");
    // A visitor's own copy of the header, followed by the proxy's: the proxy's (last) value counts.
    expect(await ask({ "fly-client-ip": "1.1.1.1, 41.58.1.2" })).toBe("41.58.1.2");
    expect(await ask({ "fly-client-ip": "2a02:c7c:1234:5678:9abc::1" })).toBe("2a02:c7c:1234:5678::/64");
    // Without the header: the socket address, which an in-process request does not have ("unknown", shared: stricter).
    expect(await ask({ "x-forwarded-for": "9.9.9.9" })).toBe("unknown");
  });

  it("the startup line says which rule is in use", () => {
    expect(describeClientRule(true, 1, "fly-client-ip")).toMatch(/fly-client-ip header/);
    expect(describeClientRule(true, 1)).toMatch(/right-most address in X-Forwarded-For/);
  });
});

describe("H1: one origin (the built page and the API from one server)", () => {
  const dist = () => {
    const d = mkdtempSync(join(tmpdir(), "atlas-h1-dist-"));
    mkdirSync(join(d, "assets"));
    writeFileSync(join(d, "index.html"), '<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc.js"></script>');
    writeFileSync(join(d, "assets", "index-abc.js"), "console.log(1)");
    writeFileSync(join(d, ".hidden"), "secret-ish");
    return d;
  };
  const echoApi = () => {
    const seen: { method: string; path: string; query: string; body: string; cookie: string | null; site: string | null }[] = [];
    const api = new Hono();
    api.all("*", async (c) => {
      seen.push({ method: c.req.method, path: c.req.path, query: new URL(c.req.url).search, body: c.req.method === "POST" ? await c.req.text() : "", cookie: c.req.header("cookie") ?? null, site: c.req.header("sec-fetch-site") ?? null });
      return c.json({ path: c.req.path });
    });
    return { api, seen };
  };

  it("/api/x is the API's /x (query, body, cookie and Sec-Fetch-Site pass through); /health too", async () => {
    const { api, seen } = echoApi();
    const page = servePage(api, dist());
    await page.request("/api/paste/languages?x=1");
    await page.request("/api/paste", { method: "POST", headers: { "content-type": "application/json", cookie: "atlas_invite=abc", "sec-fetch-site": "same-origin" }, body: '{"code":"x"}' });
    await page.request("/api");
    await page.request("/health");
    expect(seen.map((s) => [s.method, s.path, s.query])).toEqual([["GET", "/paste/languages", "?x=1"], ["POST", "/paste", ""], ["GET", "/", ""], ["GET", "/health", ""]]);
    expect(seen[1]).toMatchObject({ body: '{"code":"x"}', cookie: "atlas_invite=abc", site: "same-origin" });
  });

  it("serves the page, its assets (cached, hashed names) and the page's own paths; nothing outside dist/", async () => {
    const { api, seen } = echoApi();
    const page = servePage(api, dist());
    const get = (p: string, m = "GET") => page.request(p, { method: m });
    const root = await get("/");
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toMatch(/text\/html/);
    expect(root.headers.get("cache-control")).toBe("no-cache");
    const js = await get("/assets/index-abc.js");
    expect(js.headers.get("content-type")).toMatch(/text\/javascript/);
    expect(js.headers.get("cache-control")).toMatch(/immutable/);
    expect((await get("/anatomy/part/3")).status).toBe(200); // a page path: the page
    for (const p of ["/assets/missing.js", "/.hidden", "/.env", "/.git/config", "/assets/%2e%2e/%2e%2e/package.json", "/%2e%2e/package.json", "/..%2fpackage.json"]) {
      const r = await get(p);
      expect([p, r.status]).toEqual([p, 404]);
      expect(await r.text()).not.toContain("secret-ish");
    }
    expect((await get("/", "POST")).status).toBe(404); // a POST outside /api never reaches the app
    expect((await get("/", "HEAD")).status).toBe(200);
    expect(seen).toHaveLength(0);
  });

  it("review m1: a symbolic link inside dist/ never serves a file or folder outside it", async () => {
    const { api } = echoApi();
    const d = dist();
    const outside = mkdtempSync(join(tmpdir(), "atlas-h1-outside-"));
    writeFileSync(join(outside, "secret.txt"), "OUTSIDE-SECRET");
    symlinkSync(join(outside, "secret.txt"), join(d, "assets", "link.txt"));
    symlinkSync(outside, join(d, "linkdir"));
    writeFileSync(join(d, "assets", "inside.txt"), "inside");
    symlinkSync(join(d, "assets", "inside.txt"), join(d, "assets", "ok-link.txt"));
    const page = servePage(api, d);
    for (const p of ["/assets/link.txt", "/linkdir/secret.txt"]) {
      const r = await page.request(p);
      expect([p, r.status]).toEqual([p, 404]);
      expect(await r.text()).not.toContain("OUTSIDE-SECRET");
    }
    expect(await (await page.request("/assets/ok-link.txt")).text()).toBe("inside"); // a link that stays inside is fine
  });

  it("review m2: TRACE and other unusual methods get 405 on /api, /health and page paths, never a 500", async () => {
    const { api, seen } = echoApi();
    const page = servePage(api, dist());
    const server = serve({ fetch: page.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as AddressInfo).port;
    const ask = (method: string, path: string) =>
      new Promise<{ status: number; body: string; allow: string | undefined }>((res, rej) => {
        const req = httpRequest({ host: "127.0.0.1", port, method, path }, (r) => {
          let body = "";
          r.on("data", (c) => (body += c));
          r.on("end", () => res({ status: r.statusCode ?? 0, body, allow: r.headers.allow as string | undefined }));
        });
        req.on("error", rej);
        req.end();
      });
    try {
      for (const [m, p] of [["TRACE", "/api/paste"], ["TRACE", "/health"], ["TRACE", "/"], ["TRACE", "/assets/index-abc.js"], ["PROPFIND", "/api/runs"]] as const) {
        const r = await ask(m, p);
        expect([m, p, r.status]).toEqual([m, p, 405]);
        expect(r.body).not.toMatch(/at |TypeError|stack/);
        expect(r.allow).toContain("GET");
      }
      expect((await ask("GET", "/api/x")).status).toBe(200);
      expect(seen.map((s) => s.path)).toEqual(["/x"]); // the refused ones never reached the API
    } finally {
      server.close();
    }
  });

  it("every answer (page, API, 404) says no other site may frame it", async () => {
    const { api } = echoApi();
    const page = servePage(api, dist());
    for (const p of ["/", "/assets/index-abc.js", "/api/paste/languages", "/assets/missing.js", "/health"]) {
      const r = await page.request(p);
      for (const [k, v] of Object.entries(SAFETY_HEADERS)) expect([p, k, r.headers.get(k)]).toEqual([p, k, v]);
    }
  });

  it("with the real invite gate: 401 without a code, the invite page and sign-in under /api, Secure cookie, cross-site refused, a whole round through /api", async () => {
    const b = build({ publicOrigin: ORIGIN });
    const page = servePage(b.app, dist());
    const no = await page.request("/api/paste", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(no.status).toBe(401);
    const inv = await page.request("/api/invite");
    expect(inv.status).toBe(200);
    expect(await inv.text()).toContain('action="invite"'); // relative: posts to /api/invite on this origin
    const signIn = await page.request("/api/invite", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ code: b.codes.dev }) });
    expect(signIn.status).toBe(200);
    const set = signIn.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/; Secure/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    const cookie = set.split(";")[0]!;
    const cross = await page.request("/api/paste", { method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: "{}" });
    expect(cross.status).toBe(403);
    const sameSiteOther = await page.request("/api/paste", { method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://other.fly.dev", "sec-fetch-site": "same-site" }, body: "{}" });
    expect(sameSiteOther.status).toBe(403);
    // A whole pasted round (mocked models) through the /api prefix, as the browser on Atlas's own page sends it.
    const viaApi = { request: (p: string, init?: RequestInit) => page.request(`/api${p}`, init) } as unknown as Parameters<typeof client>[0];
    const c = client(viaApi, undefined, undefined, { cookie, origin: ORIGIN, "sec-fetch-site": "same-origin" });
    const round = await pastedRound(c);
    expect(round.r.status).toBe(200);
    expect(round.r.json.run.controlPassed).toBe(true);
    const proof = await c.get(`/proofs/${round.r.json.run.id}`);
    expect(proof.status).toBe(200);
  });
});

describe("H1: the startup summary", () => {
  it("one line, no secret values, honest about Muse Code on Linux", () => {
    const line = hostedSummary({ env: goodEnv(), activeCodes: 3, ownerCodes: 1, clientRule: describeClientRule(true, 1, "fly-client-ip"), museExec: false, metaKey: true, basetenKey: false });
    expect(line).not.toContain("\n");
    expect(line).not.toMatch(/SECRETMARKER|test-pepper/);
    expect(line).toMatch(/Muse Code: not on this machine \(no macOS sandbox-exec\); the fixer asks the muse-spark-1\.3 chat instead/);
    expect(line).toMatch(/invite codes required \(3 active, 1 owner\)/);
    expect(line).toMatch(/Meta yes, Baseten NO, Base RPC yes, Modal yes, invite pepper yes/);
    expect(line).toContain(`page + API on ${ORIGIN}`);
  });
});

describe("H1: the fixer on a machine without sandbox-exec", () => {
  it("goes straight to the muse-spark-1.3 chat: no muse exec, no preflight, no 'Muse Code gave no answer' step", async () => {
    const asked: string[] = [];
    const held: string[] = [];
    const code = readFileSync(join(ROOT, "tests/fixtures/with-rpc-retry.ts"), "utf8");
    const ref = "tests/fixtures/with-rpc-retry.ts";
    const experiment: Experiment = { id: "exp-h1", target: { kind: "ts-fixture", ref, codeSha256: "x".repeat(64) }, runner: "ts", params: { shape: "retry-scenario", failTimes: "always", failure: "never_settles" }, proposedBy: { role: "human" }, gate: { allowed: true } };
    const r = await runFixer(
      { context: tsChangeContext(ref, code), finding: { file: ref, lineStart: 49, lineEnd: 66 }, toward: "- The person bet on \"q\" (outcome): throws. The run measured: pending.", experiment },
      {
        osSandbox: () => null,
        chat: async (a) => {
          asked.push(a.model);
          return { ok: true, content: "no diff here", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, reasoningTokens: null, usd: 0.0001, priceVerified: true } } as never;
        },
        guard: async (call, _refused, _r, info) => {
          if (info) held.push(info.what);
          return call();
        },
        usagePath: join(mkdtempSync(join(tmpdir(), "atlas-h1-fx-")), "usage.jsonl"),
      },
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set(["muse-spark-1.3"]));
    expect(held.some((w) => /muse exec|preflight|Muse Code/i.test(w) && !/fixer/.test(w))).toBe(false);
    expect(r.ok).toBe(false); // "no diff here" is not a diff
    expect(r.path).toBe("chat-fallback");
    if (!r.ok) expect(r.attempts.every((a) => a.path === "chat-fallback" && a.model === "muse-spark-1.3")).toBe(true);
  });
});

describe("H1: the deploy files agree with the server's rules", () => {
  it("Dockerfile: pinned base by digest, Node the same as E4's Modal image (version and SHA-256), anvil and pnpm checked, server via host.ts, no Python", () => {
    const d = read("Dockerfile");
    expect(d).toMatch(/ARG DEBIAN_IMAGE=debian:trixie-\d{8}-slim@sha256:[0-9a-f]{64}/);
    expect(d).toContain(`ARG NODE_VERSION=${MODAL_IMAGE.nodeVersion}`);
    expect(d).toContain(`ARG NODE_SHA256=${MODAL_IMAGE.nodeSha256}`);
    expect(d).toMatch(/sha256sum -c -[\s\S]*FOUNDRY_SHA256=[0-9a-f]{64}/);
    expect(d).toMatch(/ARG FOUNDRY_SHA256=[0-9a-f]{64}/);
    expect(d).toMatch(/ARG PNPM_SHA512=\S{86}==/);
    expect(d).toMatch(/pnpm install --frozen-lockfile --prod/);
    expect(d).toMatch(/CMD \["node", "--import", "tsx", "server\/host\.ts"\]/);
    expect(d).not.toMatch(/apt-get install[^\n]*python/i);
    // Every FROM is the pinned image or an earlier stage.
    for (const m of d.matchAll(/^FROM (\S+)/gm)) expect(["${DEBIAN_IMAGE}", "node"]).toContain(m[1]);
  });

  it("the entrypoint drops to the non-root user for good; the invite wrapper refuses without the pepper", () => {
    const e = read("tools/fly-entrypoint.sh");
    const drop = "setpriv --reuid=atlas --regid=atlas --init-groups --no-new-privs --inh-caps=-all --bounding-set=-all";
    expect(e).toContain(`exec ${drop}`);
    // The image build runs the same drop once and checks the user id, so a wrong flag fails the build, not the start.
    expect(read("Dockerfile")).toContain(`test "$(${drop} id -u)" = "10001"`);
    const w = read("tools/atlas-invites.sh");
    expect(w).toMatch(/ATLAS_INVITE_PEPPER:-}" \]; then[\s\S]*exit 1/);
    expect(w).toMatch(/setpriv --reuid=atlas/);
    for (const f of ["tools/fly-entrypoint.sh", "tools/atlas-invites.sh", "tools/fly-secrets.sh"]) expect(spawnSync("sh", ["-n", join(ROOT, f)]).status).toBe(0);
  });

  it("the invite wrapper really refuses when the pepper or the store folder is missing", () => {
    const run = (env: Record<string, string>) => spawnSync("sh", [join(ROOT, "tools/atlas-invites.sh"), "list"], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });
    const noPepper = run({ ATLAS_INVITES_DIR: "/data/atlas" });
    expect(noPepper.status).toBe(1);
    expect(noPepper.stderr).toMatch(/ATLAS_INVITE_PEPPER is not set/);
    const noDir = run({ ATLAS_INVITE_PEPPER: PEPPER });
    expect(noDir.status).toBe(1);
    expect(noDir.stderr).toMatch(/ATLAS_INVITES_DIR is not set/);
  });

  it("fly.toml: one machine never stopped for idleness, health on /health, the volume where the store is, rolling deploys", () => {
    const t = read("fly.toml");
    const env = flyEnv();
    expect(env.ATLAS_PUBLIC_ORIGIN).toBe(`https://${flyApp()}.fly.dev`);
    expect(t).toMatch(/auto_stop_machines = "off"/);
    expect(t).toMatch(/min_machines_running = 1/);
    expect(t).toMatch(/strategy = "rolling"/);
    expect(t).toMatch(/path = "\/health"/);
    expect(t).toMatch(/force_https = true/);
    expect(t).toMatch(new RegExp(`destination = "${env.ATLAS_VOLUME_DIR ?? DEFAULT_VOLUME_DIR}"`));
    expect(Number(/internal_port = (\d+)/.exec(t)![1])).toBe(Number(env.PORT));
    // Refusal records go to the volume (the image's /app is read-only to the server's user).
    expect(env.ATLAS_PROOFS_DIR?.startsWith(`${env.ATLAS_VOLUME_DIR}/`)).toBe(true);
    expect(env.ATLAS_PUBLISH_PROOFS).toBeUndefined();
  });

  it(".dockerignore is an allow-list that keeps out docs/, pitch/, CLAUDE.md, .git, .env and the store files, and keeps what runs", () => {
    const lines = read(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    expect(lines[0]).toBe("*");
    for (const bad of ["!docs", "!pitch", "!CLAUDE.md", "!.git", "!.env", "!research", "!official"]) expect(lines.some((l) => l.startsWith(bad))).toBe(false);
    for (const need of ["!server", "!runners", "!src", "!web", "!contracts", "!proofs", "!tests/fixtures", "!tests/oracle", "!tools/invites.ts", "!tools/fly-entrypoint.sh", "!tools/atlas-invites.sh", "!PRE-EXISTING.md"]) expect(lines).toContain(need);
    for (const never of ["**/.env", "**/pepper", "**/invites.json", "**/spend.json", "**/server.lock"]) expect(lines).toContain(never);
  });
});

describe("H1: tools/fly-secrets.sh (fake config files, a fake flyctl; no real secret is read)", () => {
  const setup = (opts: { pepperExists?: boolean; dropBaseten?: boolean; noisy?: boolean } = {}) => {
    const t = mkdtempSync(join(tmpdir(), "atlas-h1-secrets-"));
    const home = join(t, "home");
    for (const d of [".config/meta-model-api", ".config/baseten", ".config/atlas"]) mkdirSync(join(home, d), { recursive: true });
    writeFileSync(join(home, ".config/meta-model-api/env"), 'export META_API_KEY="FAKEMETA111"\n');
    if (!opts.dropBaseten) writeFileSync(join(home, ".config/baseten/env"), "BASETEN_API_KEY='FAKEBASETEN222'\n");
    writeFileSync(join(home, ".config/atlas/rpc.env"), "# rpc\nBASE_RPC_URL=https://fake.rpc/k=FAKERPC333 # note\n");
    writeFileSync(join(home, ".modal.toml"), '[other]\ntoken_id = "ak-WRONG"\ntoken_secret = "as-WRONG"\n\n[damli40]\ntoken_id = "ak-FAKEID444"\n"token_secret" = \'as-FAKESECRET555\'\n');
    mkdirSync(join(t, "bin"));
    const log = join(t, "fly.log");
    writeFileSync(join(t, "bin", "fly"), `#!/bin/sh\necho "argv: $*" >> "${log}"\ncase "$1 $2" in\n  "secrets list") ${opts.pepperExists ? `echo '[{"name":"ATLAS_INVITE_PEPPER"}]'` : "echo '[]'"} ;;\n  "secrets import") echo "env-log-level: [\${LOG_LEVEL:-}\${FLY_LOG_LEVEL:-}]" >> "${log}"; while IFS= read -r l; do echo "stdin: $l" >> "${log}"; ${opts.noisy ? 'echo "DEBUG request body: $l" >&2;' : ""} done; ${opts.noisy ? "exit 3" : ":"} ;;\nesac\n`);
    chmodSync(join(t, "bin", "fly"), 0o755);
    const r = spawnSync("sh", [join(ROOT, "tools/fly-secrets.sh")], { env: { HOME: home, PATH: `${join(t, "bin")}:/usr/bin:/bin`, ...(opts.noisy ? { LOG_LEVEL: "debug", FLY_LOG_LEVEL: "debug" } : {}) }, encoding: "utf8" });
    let flyLog = "";
    try {
      flyLog = readFileSync(log, "utf8");
    } catch {}
    return { r, flyLog };
  };

  it("sends the five keys from the right files and profile through stdin only, plus a fresh pepper the first time; prints no value", () => {
    const { r, flyLog } = setup();
    expect(r.status).toBe(0);
    const sent = Object.fromEntries(flyLog.split("\n").filter((l) => l.startsWith("stdin: ")).map((l) => l.slice(7).split(/=(.*)/s).slice(0, 2)));
    expect(sent).toMatchObject({ META_API_KEY: "FAKEMETA111", BASETEN_API_KEY: "FAKEBASETEN222", BASE_RPC_URL: "https://fake.rpc/k=FAKERPC333", MODAL_TOKEN_ID: "ak-FAKEID444", MODAL_TOKEN_SECRET: "as-FAKESECRET555" });
    expect(sent.ATLAS_INVITE_PEPPER).toMatch(/^[0-9a-f]{64}$/);
    expect(flyLog).toMatch(/argv: secrets import --app atlas-dami --stage/);
    expect(flyLog).not.toMatch(/argv:.*FAKE/); // never on a command line
    expect(r.stdout + r.stderr).not.toMatch(/FAKE|ak-FAKE|as-FAKE|[0-9a-f]{64}/);
  });

  it("keeps the app's existing pepper (re-running never invalidates handed-out codes)", () => {
    const { r, flyLog } = setup({ pepperExists: true });
    expect(r.status).toBe(0);
    expect(flyLog).not.toMatch(/ATLAS_INVITE_PEPPER=/);
    expect(r.stdout).toMatch(/kept the app's existing ATLAS_INVITE_PEPPER/);
  });

  it("review m8: flyctl's debug switches are turned off, and its stderr never reaches the screen (a failure says so plainly)", () => {
    const { r, flyLog } = setup({ noisy: true });
    expect(flyLog).toContain("env-log-level: []");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/fly secrets import failed for app "atlas-dami"/);
    expect(r.stdout + r.stderr).not.toMatch(/FAKE|DEBUG request body/);
  });

  it("a missing file stops it before flyctl is called at all", () => {
    const { r, flyLog } = setup({ dropBaseten: true });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing .*\.config\/baseten\/env/);
    expect(flyLog).toBe("");
  });
});

describe("H1: tools/smoke-hosted.ts refuses before sending anything", () => {
  it("needs an https address and the code in the environment", () => {
    const tsx = resolve(ROOT, "node_modules/.bin/tsx");
    const noCode = spawnSync(tsx, [join(ROOT, "tools/smoke-hosted.ts"), "https://atlas-dami.fly.dev"], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" });
    expect(noCode.status).toBe(2);
    expect(noCode.stderr).toMatch(/ATLAS_SMOKE_INVITE is not set/);
    const http = spawnSync(tsx, [join(ROOT, "tools/smoke-hosted.ts"), "http://atlas-dami.fly.dev"], { env: { PATH: process.env.PATH ?? "", ATLAS_SMOKE_INVITE: "atlas_x" }, encoding: "utf8" });
    expect(http.status).toBe(2);
  }, 30_000);
});
