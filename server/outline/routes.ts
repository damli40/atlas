// X1: the explorer's server routes (X2 draws the UI on them).
//
// Routes (server/app.ts registers them; every route needs the x-atlas-session header):
// - POST /outline/jobs {repo, ref?, subfolder?} | {files: [{path, text}]} → 202 {jobId, status}. Starts one outline
//   job: read the codebase (server/outline/intake.ts), build the code map (plain code), ask Muse Wonder for an
//   outline (one call, one repair at most), check it (plain code), seal the outline section. Limited per client
//   address an hour, per session (count and one at a time), and by the shared model budget.
// - GET /outline/jobs/:id → the job's status ("reading", "mapping", "asking-wonder", "checking", "done",
//   "failed"), with counts when done and the reason when failed.
// - GET /outline/jobs/:id/outline → the verified outline, the code map, the file list (paths, sizes, hashes,
//   no text), what was skipped and why, Wonder's model id, attempts and usage.
// - GET /outline/jobs/:id/parts/:partId → one part: its real lines (confirmed spans only), the definitions in them
//   with parameters and return types read from the code, imports, edges in and out, joins (src/outline/details.ts).
// - GET /outline/jobs/:id/atlas → the outline-only .atlas.json (it holds the code: built in memory, never
//   written to disk; src/outline/section.ts verifyOutlineFile checks it without any model).
// A job belongs to the session that started it: any other session gets 404, as if it did not exist.
// Jobs live in memory only (the oldest are dropped first); the code is never written to disk or logged.

import type { Context, Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { buildCodeMap } from "../../src/outline/codemap";
import { partDetails } from "../../src/outline/details";
import { codebaseSha256, makeOutlineSection, MAX_OUTLINE_FILE_BYTES } from "../../src/outline/section";
import type { OutlineAtlasFile, OutlineSection } from "../../src/outline/types";
import { plural } from "../../src/words";
import { oneLine, sessionEmitter, type AgentLog } from "../log/agentlog";
import { BAD_SESSION, sessionIdOf } from "../log/sse";
import type { ModelBudget } from "../meta/budget";
import type { ChatArgs, ChatResult } from "../meta/client";
import { OUTLINER_MODEL, runOutliner } from "../meta/roles/outliner";
import { intakeGithub, intakeUpload, MAX_UPLOAD_ENTRIES, OutlineIntakeError, parseRepoRequest, type Codebase, type RepoRequest } from "./intake";

/** POST /outline/jobs may carry up to 300 KB of code escaped as JSON, plus paths. */
export const OUTLINE_BODY_BYTES = 1024 * 1024;
/** Outline jobs one session may start (each may be 1–2 paid Wonder calls). */
export const MAX_OUTLINE_JOBS_PER_SESSION = 5;
/** Jobs kept in memory, across all sessions (each holds up to 300 KB of code); the oldest drop first. */
export const MAX_OUTLINE_JOBS = 100;
/** Outline jobs one client address may start an hour (env ATLAS_OUTLINES_PER_IP_PER_HOUR). */
export const DEFAULT_OUTLINES_PER_IP_PER_HOUR = 10;

export interface OutlineOptions {
  /** Muse Wonder for the outline. Absent: no model is asked; the job still builds the code map and says so. */
  outliner?: { chat: (args: ChatArgs) => Promise<ChatResult>; model?: string; /** The shared model budget (server/app.ts uses the first one any role gives). */ budget?: ModelBudget };
  /** Reads a GitHub repo (default server/outline/intake.ts intakeGithub). Tests pass a stand-in. */
  readGithub?: (req: RepoRequest) => Promise<Codebase>;
  now?: () => Date;
}

export interface OutlineDeps {
  agentLog: AgentLog;
  budget?: ModelBudget;
  /** Per-address limit on outline jobs. */
  takeOutline: (c: Context) => { ok: true } | { ok: false; reason: string };
  /** Per-address model-round limit, shared with the other model features. */
  takeModelRound: (c: Context) => { ok: true } | { ok: false; reason: string };
}

export type JobStatus = "reading" | "mapping" | "asking-wonder" | "checking" | "done" | "failed";

interface Job {
  id: string;
  sessionId: string;
  status: JobStatus;
  createdAt: string;
  what: string;
  error?: string;
  section?: OutlineSection;
  /** Why Wonder was not asked (set before the job runs). */
  notAsked?: string;
}

const fileEntry = z.strictObject({ path: z.string().min(1).max(1000), text: z.string().max(MAX_OUTLINE_FILE_BYTES * 4) });
const jobBody = z.union([
  z.strictObject({ repo: z.string().min(1).max(300), ref: z.string().min(1).max(200).optional(), subfolder: z.string().max(300).optional() }),
  z.strictObject({ files: z.array(fileEntry).min(1).max(MAX_UPLOAD_ENTRIES) }),
]);

const reasonOf = (err: z.ZodError) =>
  err.issues
    .slice(0, 3)
    .map((i) => `${i.path.length ? i.path.join(".") : "body"}: ${i.message}`)
    .join("; ");

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false };
  }
}

export function createOutlineRoutes(opts: OutlineOptions, deps: OutlineDeps) {
  const now = opts.now ?? (() => new Date());
  const model = opts.outliner?.model ?? OUTLINER_MODEL;
  // The role adds the code guard in front of this (refused ids are never counted or sent).
  const outlinerChat = opts.outliner && deps.budget ? deps.budget.wrap(opts.outliner.chat) : undefined;
  const readGithub = opts.readGithub ?? ((req: RepoRequest) => intakeGithub(req));
  const jobs = new Map<string, Job>();
  const started = new Map<string, number>();

  const keep = (job: Job) => {
    jobs.set(job.id, job);
    while (jobs.size > MAX_OUTLINE_JOBS) jobs.delete(jobs.keys().next().value!);
  };
  const say = (sessionId: string, role: "human" | "gate", action: string, ref?: string) => {
    try {
      deps.agentLog.emit(sessionId, { role, action: oneLine(action), ...(ref ? { ref: { kind: "target" as const, id: ref } } : {}) });
    } catch {
      // a refused log line never stops a job
    }
  };
  const mine = (c: Context): { job: Job } | { res: Response } => {
    const sessionId = sessionIdOf(c);
    if (sessionId === null) return { res: c.json({ error: BAD_SESSION }, 400) };
    const job = jobs.get(c.req.param("id") ?? "");
    if (!job || job.sessionId !== sessionId) return { res: c.json({ error: "this session has no outline job with that id" }, 404) };
    return { job };
  };

  async function run(job: Job, read: () => Promise<Codebase> | Codebase): Promise<void> {
    try {
      job.status = "reading";
      const codebase = await read();
      job.status = "mapping";
      const kb = Math.ceil(codebase.files.reduce((n, f) => n + f.bytes, 0) / 1024);
      const label = codebase.source.kind === "github" ? `${codebase.source.repo}@${codebase.source.commit.slice(0, 12)}${codebase.source.subfolder ? ` (${codebase.source.subfolder})` : ""}` : "uploaded files";
      const codeMap = buildCodeMap(codebase.files);
      // The fingerprint is computed by the section below; this log line names the files only by count and size.
      say(job.sessionId, "gate", `reads ${plural(codebase.files.length, "source file")} (${kb} KB) from ${label}; skips ${codebase.skipped.length}; maps ${plural(codeMap.edges.length, "edge")}`);
      job.status = "asking-wonder";
      let wonder: OutlineSection["wonder"];
      if (job.notAsked !== undefined || !outlinerChat) {
        wonder = { model, outline: null, attempts: [], failure: `not asked (${job.notAsked ?? "this server asks no Meta model for outlines"})` };
      } else {
        const files = [...codebase.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        const r = await runOutliner({ files, codeMap, label, codeSha256: codebaseSha256(files), model }, { chat: outlinerChat, log: sessionEmitter(deps.agentLog, job.sessionId) });
        wonder = r.ok ? { model: r.model, outline: r.outline, attempts: r.attempts } : { model: r.model, outline: null, attempts: r.attempts, failure: oneLine(r.reason, 600) };
      }
      job.status = "checking";
      const section = makeOutlineSection({ source: codebase.source, files: codebase.files, skipped: codebase.skipped, codeMap, wonder });
      if (section.verified) {
        const n = section.verified.counts;
        say(job.sessionId, "gate", `checks ${model}'s outline: ${n.confirmedParts} of ${n.confirmedParts + n.unconfirmedParts} parts confirmed; joins ${n.confirmedJoins} confirmed, ${n.modelOnlyJoins} model-only, ${n.codeOnlyJoins} found by plain code`, section.codeSha256);
      }
      job.section = section;
      job.status = "done";
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof OutlineIntakeError ? e.message : `the outline job stopped: ${oneLine(e instanceof Error ? e.message : String(e), 300)}`;
      say(job.sessionId, "gate", `outline job failed: ${job.error}`);
    }
  }

  const view = (job: Job) => ({
    jobId: job.id,
    status: job.status,
    what: job.what,
    createdAt: job.createdAt,
    ...(job.error ? { error: job.error } : {}),
    ...(job.section
      ? {
          codeSha256: job.section.codeSha256,
          files: job.section.files.length,
          skipped: job.section.skipped.length,
          counts: job.section.verified?.counts ?? null,
          ...(job.section.wonder.failure ? { wonderFailure: job.section.wonder.failure } : {}),
        }
      : {}),
  });

  function register(app: Hono) {
    app.post("/outline/jobs", async (c) => {
      const sessionId = sessionIdOf(c);
      if (sessionId === null) return c.json({ error: BAD_SESSION }, 400);
      const raw = await readJson(c.req.raw);
      if (!raw.ok) return c.json({ error: "the request body is not JSON" }, 400);
      const parsed = jobBody.safeParse(raw.body);
      if (!parsed.success) return c.json({ error: reasonOf(parsed.error) }, 400);
      let read: () => Promise<Codebase> | Codebase;
      let what: string;
      if ("repo" in parsed.data) {
        let req: RepoRequest;
        try {
          req = parseRepoRequest(parsed.data);
        } catch (e) {
          return c.json({ error: e instanceof Error ? e.message : "bad repo" }, 400);
        }
        what = `${req.owner}/${req.repo}${req.ref ? `@${req.ref}` : ""}${req.subfolder ? ` (${req.subfolder})` : ""}`;
        read = () => readGithub(req);
      } else {
        // Uploads are checked before the job starts, so a bad upload is a plain 400/413 now, not a failed job later.
        let codebase: Codebase;
        try {
          codebase = intakeUpload(parsed.data.files);
        } catch (e) {
          const err = e instanceof OutlineIntakeError ? e : new OutlineIntakeError("bad_input", "the files could not be read");
          return c.json({ error: err.message }, err.kind === "too_large" || err.kind === "too_many" ? 413 : 400);
        }
        what = `uploaded files (${plural(codebase.files.length, "source file")})`;
        read = () => codebase;
      }
      const sessionJobs = [...jobs.values()].filter((j) => j.sessionId === sessionId);
      if (sessionJobs.some((j) => j.status !== "done" && j.status !== "failed")) return c.json({ error: "this session already has an outline job running; wait for it to finish" }, 409);
      const count = started.get(sessionId) ?? 0;
      if (count >= MAX_OUTLINE_JOBS_PER_SESSION) return c.json({ error: `a session may start at most ${MAX_OUTLINE_JOBS_PER_SESSION} outline jobs; start a new session` }, 429);
      const byIp = deps.takeOutline(c);
      if (!byIp.ok) return c.json({ error: `outline not started: ${byIp.reason}` }, 429);
      started.set(sessionId, count + 1);
      while (started.size > 1000) started.delete(started.keys().next().value!);
      // Wonder is asked only when this server has it and the client's model-round allowance is not used up.
      let notAsked: string | undefined;
      if (outlinerChat) {
        const round = deps.takeModelRound(c);
        if (!round.ok) notAsked = round.reason;
      }
      const job: Job = { id: `ol_${nanoid(10)}`, sessionId, status: "reading", createdAt: now().toISOString(), what, ...(notAsked !== undefined ? { notAsked } : {}) };
      keep(job);
      say(sessionId, "human", `asks for an outline of ${what}`);
      void run(job, read);
      return c.json(view(job), 202);
    });

    app.get("/outline/jobs/:id", (c) => {
      const m = mine(c);
      return "res" in m ? m.res : c.json(view(m.job));
    });

    const done = (c: Context): { job: Job; section: OutlineSection } | { res: Response } => {
      const m = mine(c);
      if ("res" in m) return m;
      if (m.job.status === "failed") return { res: c.json({ error: m.job.error ?? "the job failed", status: "failed" }, 409) };
      if (!m.job.section) return { res: c.json({ error: `the job is not done yet (${m.job.status})`, status: m.job.status }, 409) };
      return { job: m.job, section: m.job.section };
    };

    app.get("/outline/jobs/:id/outline", (c) => {
      const d = done(c);
      if ("res" in d) return d.res;
      const s = d.section;
      return c.json({
        jobId: d.job.id,
        source: s.source,
        codeSha256: s.codeSha256,
        files: s.files.map((f) => ({ path: f.path, language: f.language, bytes: f.bytes, sha256: f.sha256 })),
        skipped: s.skipped,
        codeMap: s.codeMap,
        verified: s.verified,
        wonder: { model: s.wonder.model, attempts: s.wonder.attempts, ...(s.wonder.failure ? { failure: s.wonder.failure } : {}) },
        usage: s.usage,
        labels: {
          parts: `Parts, names, purposes and patterns: ${s.wonder.model}'s words. Plain code checked every file and line.`,
          joins: "confirmed: Wonder said it and plain code found the import or call. model-only: Wonder says; the code doesn't show it. code-only: found by plain code; Wonder did not say it.",
        },
      });
    });

    app.get("/outline/jobs/:id/parts/:partId", (c) => {
      const d = done(c);
      if ("res" in d) return d.res;
      if (!d.section.verified) return c.json({ error: "there is no outline to open: Muse Wonder gave none" }, 404);
      const details = partDetails(d.section.files, d.section.codeMap, d.section.verified, c.req.param("partId"));
      if (!details) return c.json({ error: "the outline has no part with that id" }, 404);
      return c.json(details);
    });

    app.get("/outline/jobs/:id/atlas", (c) => {
      const d = done(c);
      if ("res" in d) return d.res;
      const file: OutlineAtlasFile = { version: 1, kind: "outline", outline: d.section, createdAt: d.job.createdAt };
      return c.json(file);
    });
  }

  return { register, jobOf: (id: string) => jobs.get(id) };
}
