// H1 (D52): the after-deploy smoke test for the hosted Atlas. Dami (or Claude) runs it from the repo on a Mac:
//
//   ATLAS_SMOKE_INVITE=atlas_... pnpm exec tsx tools/smoke-hosted.ts https://atlas-dami.fly.dev
//
// The invite code comes ONLY from the environment and is never printed (any text this prints has the code cut out).
// Use the owner code or a dev code with at least $0.20 left today. It spends real money once: one pasted round with
// real models (Muse Wonder proposes the tests, Muse Spark 1.3 bets), run in Modal sandboxes. About $0.05; the test
// fails if the code's spend grew by more than $0.10.
//
// What it checks, in order (one PASS/FAIL line each; exit 1 if any failed):
//  1. /health answers ok (not setup mode).
//  2. The page: / is the built page, its script loads, and no other site may frame it.
//  3. Without a code, a spending request gets 401 and nothing runs.
//  4. The invite page loads.
//  5. Signing in from Atlas's own page works, and the cookie is Secure, HttpOnly and SameSite=Strict.
//  6. A cookie-signed POST from another site is refused (403).
//  7. Pasted runs go to Modal.
//  8. One pasted round with real models: Wonder's proposal, a sealed person's bet, Muse Spark's sealed bets, a run on
//     Modal whose known-case check passed.
//  9. The round's proof card (.atlas.json) verifies.
// 10. What the round cost this code (from /api/invite/status) is under $0.10.
// 11. Only with ATLAS_SMOKE_FORGE_CHECK=1: a visitor cannot forge Fly-Client-IP. It sends 30 wrong codes claiming one
//     address, then one more claiming another. If Fly replaces the header, all 31 count against your real address and
//     the last is refused (429): PASS. If the forged value were believed, the last would get 401: FAIL. Side effect: your
//     address cannot try a WRONG code for an hour (a correct code is never refused, G1 M4).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAtlasFile } from "../src/atlasfile";

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
const code = process.env.ATLAS_SMOKE_INVITE?.trim() ?? "";
// A local trial of the script itself (no hosted server): ATLAS_SMOKE_ALLOW_HTTP=1 accepts http://127.0.0.1:<port> only.
const localTrial = process.env.ATLAS_SMOKE_ALLOW_HTTP === "1" && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base);
if (!/^https:\/\/[^/]+$/.test(base) && !localTrial) {
  console.error("usage: ATLAS_SMOKE_INVITE=<code> pnpm exec tsx tools/smoke-hosted.ts https://<app>.fly.dev");
  process.exit(2);
}
if (!code) {
  console.error("ATLAS_SMOKE_INVITE is not set (the invite code to test with; it is never printed)");
  process.exit(2);
}
const origin = new URL(base).origin;
const hide = (s: string) => s.split(code).join("<code>");
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail: hide(detail) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` (${hide(detail)})` : ""}`);
};

let cookie = "";
let session: string | null = null;
/** A request as Atlas's own page sends it: same origin, the invite cookie, the session. */
async function own(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { origin, "sec-fetch-site": "same-origin" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  if (session) headers["x-atlas-session"] = session;
  const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  session ??= res.headers.get("x-atlas-session");
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}
const errOf = (r: { status: number; json: any }) => `HTTP ${r.status}${typeof r.json === "object" && r.json?.error ? `: ${String(r.json.error).slice(0, 200)}` : ""}`;

async function main() {
  // 1
  const h = await fetch(`${base}/health`);
  const hj = (await h.json().catch(() => ({}))) as { ok?: boolean; setup?: boolean };
  check("health answers ok", h.status === 200 && hj.ok === true, hj.setup ? "SETUP MODE: no invite code exists yet" : `HTTP ${h.status}`);

  // 2
  const page = await fetch(`${base}/`);
  const html = await page.text();
  const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const js = script ? await fetch(`${base}${script}`) : undefined;
  check("the page is served from the same origin", page.status === 200 && html.includes('id="root"') && js?.status === 200 && (js.headers.get("content-type") ?? "").includes("javascript"), `page HTTP ${page.status}, script ${script ?? "missing"} HTTP ${js?.status ?? "-"}`);
  check("no other site may frame the page", page.headers.get("x-frame-options") === "DENY" && (page.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));

  // 3
  const no = await fetch(`${base}/api/paste`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "export const f = () => 1;" }) });
  const noj = (await no.json().catch(() => ({}))) as { invite?: { required?: boolean } };
  check("without a code a spending request gets 401", no.status === 401 && noj.invite?.required === true, `HTTP ${no.status}`);

  // 4
  const inv = await fetch(`${base}/api/invite`);
  const invHtml = await inv.text();
  check("the invite page loads", inv.status === 200 && invHtml.includes('name="code"'), `HTTP ${inv.status}`);

  // 5
  const signIn = await fetch(`${base}/api/invite`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin" }, body: JSON.stringify({ code }) });
  const setCookie = signIn.headers.getSetCookie().find((c) => c.startsWith("atlas_invite=")) ?? "";
  cookie = setCookie.split(";")[0] ?? "";
  const flags = setCookie.toLowerCase();
  check("signing in from Atlas's own page works", signIn.status === 200 && cookie !== "", `HTTP ${signIn.status}`);
  check("the invite cookie is Secure, HttpOnly, SameSite=Strict", flags.includes("; secure") && flags.includes("; httponly") && flags.includes("samesite=strict"));
  if (!cookie) return;

  // 6
  const cross = await fetch(`${base}/api/paste`, { method: "POST", headers: { "content-type": "application/json", cookie, origin: "https://evil.example", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ code: "export const f = () => 1;" }) });
  check("a cookie-signed POST from another site is refused", cross.status === 403, `HTTP ${cross.status}`);

  // 7
  const langs = await own("GET", "/api/paste/languages");
  check("pasted runs go to Modal", langs.status === 200 && langs.json?.executor === "modal", `executor ${JSON.stringify(langs.json?.executor)}`);

  // 8
  const before = await own("GET", "/api/invite/status");
  const spentBefore = Number(before.json?.today?.spentUsd ?? NaN);
  const example = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "web", "paste-example.ts"), "utf8").match(/`([\s\S]*)`;/)![1]!.replace(/\\`/g, "`");
  const paste = await own("POST", "/api/paste", { code: example });
  if (paste.status !== 200) return check("one pasted round with real models", false, `paste ${errOf(paste)}`);
  const props = await own("POST", "/api/paste/proposals", { target: paste.json.target, exportName: "retryWithBackoff" });
  const first = (props.json?.proposals ?? []).find((p: any) => p.gate?.allowed);
  if (!first) return check("one pasted round with real models", false, `no allowed proposal from Muse Wonder: ${errOf(props)} ${String(props.json?.reason ?? "").slice(0, 200)}`);
  const exp = await own("POST", "/api/experiments", { target: paste.json.target, proposalId: first.id });
  if (exp.status !== 200) return check("one pasted round with real models", false, `experiment ${errOf(exp)}`);
  const id = exp.json.experiment.id as string;
  const bet = await own("POST", "/api/bets", { experimentId: id, who: "human", bets: [{ measures: "outcome", answer: { kind: "enum", value: "returned" } }] });
  const slots = await own("POST", `/api/experiments/${encodeURIComponent(id)}/model-bets`, {});
  const sealed = (slots.json?.models ?? []).filter((m: any) => (m.sealed ?? []).length > 0).map((m: any) => m.display);
  const run = await own("POST", "/api/runs", { experimentId: id });
  const r = run.json?.run;
  check(
    "one pasted round with real models (Wonder proposed, Spark bet, run on Modal, known-case check passed)",
    bet.status === 200 && sealed.length > 0 && run.status === 200 && r?.executor === "modal" && r?.controlPassed === true,
    `bet HTTP ${bet.status}; model bets sealed by ${sealed.join(", ") || "none"}; run ${run.status === 200 ? `executor ${r?.executor}, control ${r?.controlPassed}` : errOf(run)}`,
  );
  if (run.status !== 200) return;

  // 9
  const proof = await own("GET", `/api/proofs/${encodeURIComponent(r.id)}`);
  const v = proof.status === 200 ? verifyAtlasFile(proof.json) : { ok: false as const, problems: [errOf(proof)] };
  check("the proof card verifies", v.ok, v.ok ? `run ${r.id}` : (v as { problems: string[] }).problems.join("; ").slice(0, 300));

  // 10
  const after = await own("GET", "/api/invite/status");
  const delta = Number(after.json?.today?.spentUsd ?? NaN) - spentBefore;
  check("the round cost this code under $0.10", Number.isFinite(delta) && delta < 0.1, Number.isFinite(delta) ? `$${delta.toFixed(4)}` : "spend not readable (crossed 00:00 UTC?)");
}

async function forgeCheck() {
  const wrong = JSON.stringify({ code: "atlas_" + "0".repeat(32) });
  const tryAs = (ip: string) => fetch(`${base}/api/invite`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", "fly-client-ip": ip }, body: wrong });
  for (let i = 0; i < 30; i++) await tryAs("203.0.113.7");
  const last = await tryAs("198.51.100.9");
  check("a visitor cannot forge Fly-Client-IP (the 31st wrong code from one real address is refused)", last.status === 429, `HTTP ${last.status}${last.status === 401 ? ": the forged address was believed" : ""}`);
}

try {
  await main();
  if (process.env.ATLAS_SMOKE_FORGE_CHECK === "1") await forgeCheck();
} catch (e) {
  check("the smoke test ran to the end", false, e instanceof Error ? e.message : String(e));
}
const failed = results.filter((x) => !x.ok).length;
console.log(failed === 0 ? `ALL ${results.length} PASSED` : `${failed} of ${results.length} FAILED`);
process.exit(failed === 0 ? 0 : 1);
