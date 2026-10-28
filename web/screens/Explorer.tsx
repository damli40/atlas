// X2: the code explorer screen. A person gives a public GitHub folder (or uploads files); Atlas starts an outline
// job (X1: plain code maps the code, Muse Wonder proposes parts and joins, plain code checks them), the page shows
// each step, then draws the machine from the job's verified outline. Picking a function on a part's card opens the
// paste flow (E3) with that file and that function: the same routes, the same gate, the same sealed bets.
//
// Trust, as everywhere: names and purposes are Muse Wonder's words, labelled; "lines confirmed" never means "purpose
// confirmed"; can't map / can't check / no outline draw nothing and say why. The code text is read only for the
// hand-off, from the job's own outline file, and never kept by this page.

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type Api, type LabelsAnswer, type OutlineJob, type OutlineRequest } from "../api";
import { ErrorNotice } from "./ErrorNotice";
import { ExplorerMachine } from "../machines/explorer/ExplorerMachine";
import { explorerModel, type BetChoice, type Box } from "../machines/explorer/model";
import type { OutlineView } from "../machines/explorer/outline-data";

/** What the explorer hands to the paste flow: one file's text and the function picked. */
export interface BetHandoff {
  code: string;
  language: "js" | "ts" | "py";
  exportName: string;
  /** "server/meta/redact-secret.ts in damli40/atlas at 058ab2a", for the paste screen's note. */
  from: string;
  /** Changes on every hand-off, so the same function picked twice starts again. */
  nonce: number;
}

const STEPS: { status: OutlineJob["status"]; words: string }[] = [
  { status: "reading", words: "Reading the files (pinned to one commit)" },
  { status: "mapping", words: "Plain code maps the code: definitions, imports, calls" },
  { status: "asking-wonder", words: "Muse Wonder proposes parts and joins" },
  { status: "checking", words: "Plain code checks every part and join against the files" },
];
const POLL_MS = 1000;
/** Review M4: a job the server no longer holds (30-minute expiry, or dropped for a newer one). */
export const EXPIRED_NOTE = "This outline expired (outlines are kept 30 minutes). Run it again.";
export const SAVED_NOTE = "This is the saved outline of Atlas's own server/meta (no model call). It holds no code on this server, so betting needs a live outline: start one above.";

async function readFiles(list: FileList): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    out.push({ path: rel, text: await f.text() });
  }
  // A picked folder arrives as "folder/a.ts": drop the one top folder all paths share.
  const tops = new Set(out.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
  if (tops.size === 1 && !tops.has("")) for (const f of out) f.path = f.path.slice(f.path.indexOf("/") + 1);
  return out;
}

/** U1: "owner/repo", or a GitHub link (…/owner/repo/tree/<ref>/<folder>), as the explorer's three fields. */
export function parseRepoInput(input: string): { repo: string; ref: string; subfolder: string } {
  const t = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+\/[^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?$/.exec(t);
  if (m) return { repo: m[1]!, ref: m[2] ?? "", subfolder: m[3] ?? "" };
  const [owner, name, ...rest] = t.split("/");
  return { repo: owner && name ? `${owner}/${name}` : t, ref: "", subfolder: rest.join("/") };
}

export function ExplorerFlow({ api, onBet, saved, initialRepo, initialFiles, visible = true }: { api: Api; onBet: (h: BetHandoff) => void; saved?: () => Promise<OutlineView>; initialRepo?: string; initialFiles?: FileList; /** X3: the screen is shown (labels are read again when it is). */ visible?: boolean }) {
  const first = initialRepo ? parseRepoInput(initialRepo) : null;
  const [repo, setRepo] = useState(first?.repo ?? "damli40/atlas");
  const [subfolder, setSubfolder] = useState(first ? first.subfolder : "server/meta");
  const [ref, setRef] = useState(first?.ref ?? "");
  const [files, setFiles] = useState<FileList | null>(null);
  const [job, setJob] = useState<OutlineJob | null>(null);
  const [view, setView] = useState<OutlineView | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [betBusy, setBetBusy] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const lastRequest = useRef<OutlineRequest | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Poll the job until it is done or failed, then read the outline.
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const t = setTimeout(async () => {
      try {
        const next = await api.outlineJob(job.jobId);
        if (!live.current) return;
        setJob(next);
        if (next.status === "done") setView(await api.outline(next.jobId));
      } catch (e) {
        if (!live.current) return;
        if (e instanceof ApiError && e.status === 404) setExpired(true);
        else setError((e as Error).message);
      }
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [job, api]);

  // U1: opened from the drawing-first screen with a folder or files: start at once (one click there, none here).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
      void start(true, initialFiles);
    } else if (first) void start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (useFiles: boolean | "again", given?: FileList) => {
    setBusy(true);
    setError(null);
    setView(null);
    setLabels(null);
    setIsSaved(false);
    setJob(null);
    setExpired(false);
    try {
      const req: OutlineRequest =
        useFiles === "again" && lastRequest.current
          ? lastRequest.current
          : useFiles === true && (given ?? files)
            ? { files: await readFiles((given ?? files)!) }
            : { repo: repo.trim(), ...(ref.trim() ? { ref: ref.trim() } : {}), ...(subfolder.trim() ? { subfolder: subfolder.trim() } : {}) };
      lastRequest.current = req;
      const j = await api.startOutline(req);
      setJob(j);
      if (j.status === "done") setView(await api.outline(j.jobId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openSaved = async () => {
    if (!saved) return;
    setError(null);
    setJob(null);
    try {
      setView(await saved());
      setIsSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const model = useMemo(() => (view ? explorerModel(view) : null), [view]);

  // X3 (D28): plain code's common-failure labels per part, read when the outline arrives and each time the screen is
  // shown again (a round run from "Bet on this part" can turn a label into "reproduced").
  const [labels, setLabels] = useState<Record<string, LabelsAnswer> | null>(null);
  useEffect(() => {
    if (!view || isSaved || !visible) return;
    let on = true;
    api.outlineLabels(view.jobId).then(
      (a) => on && setLabels(a.parts),
      () => on && setLabels(null),
    );
    return () => {
      on = false;
    };
  }, [api, view, isSaved, visible]);

  const bet = async (c: BetChoice, _box: Box) => {
    if (!view || isSaved) return;
    setBetBusy(`Reading ${c.path} from the outline job…`);
    try {
      const file = await api.outlineAtlas(view.jobId);
      const f = file.outline.files.find((x) => x.path === c.path);
      if (!f) throw new Error(`the outline job no longer holds ${c.path}`);
      const where = view.source.kind === "github" ? `${view.source.subfolder ? `${view.source.subfolder}/` : ""}${c.path} in ${view.source.repo} at ${view.source.commit.slice(0, 7)}` : `${c.path} (uploaded)`;
      onBet({ code: f.text, language: c.language, exportName: c.name, from: where, nonce: Date.now() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setExpired(true);
      else setError(`The hand-off could not read the file: ${(e as Error).message}`);
    } finally {
      if (live.current) setBetBusy(null);
    }
  };

  const running = job !== null && job.status !== "done" && job.status !== "failed";
  const at = job ? STEPS.findIndex((s) => s.status === job.status) : -1;
  return (
    <>
      <section className="card" aria-label="choose a codebase">
        <h2>Explore a codebase</h2>
        <p className="muted">
          Atlas reads a small codebase (at most 50 JavaScript, TypeScript or Python files, 300 KB), plain code maps it, Muse Wonder proposes its parts and how they join, and plain code checks every part and join against the
          files. The machine draws only what plain code confirmed.
        </p>
        <div className="ex-form">
          <label>
            GitHub repo <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" disabled={running || busy} data-testid="outline-repo" />
          </label>
          <label>
            Folder <input value={subfolder} onChange={(e) => setSubfolder(e.target.value)} placeholder="(the whole repo)" disabled={running || busy} data-testid="outline-subfolder" />
          </label>
          <label>
            Branch, tag or commit <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="(the default branch)" disabled={running || busy} data-testid="outline-ref" />
          </label>
          <button type="button" onClick={() => start(false)} disabled={running || busy || repo.trim() === ""} data-testid="outline-start">
            Outline this folder
          </button>
        </div>
        <div className="ex-form">
          <label>
            Or upload files <input type="file" multiple onChange={(e) => setFiles(e.target.files)} disabled={running || busy} data-testid="outline-files" />
          </label>
          <button type="button" onClick={() => start(true)} disabled={running || busy || !files || files.length === 0} data-testid="outline-upload">
            Outline these files
          </button>
          {saved ? (
            <button type="button" className="secondary" onClick={openSaved} disabled={running || busy} data-testid="outline-saved">
              Show the saved server/meta outline (no model call)
            </button>
          ) : null}
        </div>
        {job ? (
          <ol className="ex-steps" aria-label="outline progress" data-testid="outline-progress">
            {STEPS.map((s, i) => (
              <li key={s.status} data-state={job.status === "failed" ? (i <= Math.max(at, 0) ? "failed" : "todo") : job.status === "done" || i < at ? "done" : i === at ? "now" : "todo"}>
                {s.words}
              </li>
            ))}
            <li data-state={job.status === "done" ? "done" : job.status === "failed" ? "failed" : "todo"}>
              {job.status === "failed" ? `Stopped: ${job.error ?? "the job failed"}` : job.status === "done" ? `Done: ${job.counts ? `${job.counts.confirmedParts} of ${job.counts.confirmedParts + job.counts.unconfirmedParts} parts with lines confirmed` : "no outline to check"}` : "Done"}
            </li>
          </ol>
        ) : null}
        {error ? <ErrorNotice message={error} /> : null}
        {expired ? (
          <p className="notice" role="alert" data-testid="outline-expired">
            {EXPIRED_NOTE}{" "}
            <button type="button" onClick={() => start("again")} disabled={busy || !lastRequest.current} data-testid="outline-again">
              Run it again
            </button>
          </p>
        ) : null}
      </section>
      {model ? (
        <section aria-label="explorer" data-testid="explorer">
          {isSaved ? <p className="muted">{SAVED_NOTE}</p> : null}
          <ExplorerMachine model={model} {...(isSaved ? { betUnavailable: SAVED_NOTE } : expired ? { betUnavailable: EXPIRED_NOTE } : { onBet: bet })} betBusy={betBusy} labels={isSaved ? null : labels} />
        </section>
      ) : null}
    </>
  );
}
