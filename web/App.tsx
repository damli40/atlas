// One flow on the withRpcRetry fixture: pick a scenario → answer the plain-code questions → the
// server seals the bets (hashes on screen) → "Break it" runs the real code → verdicts + the
// browser's own seal check.
// D02-06: as soon as the experiment exists, the server asks Muse Spark for its bets on the SAME
// questions. The page shows only "has sealed N bets" + hashes until the run, then both columns.
// D04-04: a target switcher (the withRpcRetry fixture, or a pull request link: Moonwell PR #578 on
// the EVM runner), and a findings panel (the Investigator's places, checked against the file).
// D07-01: a toggle picks who bets with the person: Muse Spark, Muse Spark Open (open weights, via
// Baseten) or both, each sealing its own bets on the same experiment.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Question } from "../src/gate";
import type { Target } from "../src/types";
import { PASTE_SESSION_KEY, createApi, didNotFinish, storeSession, storedSession, type Api, type ClaimantMode, type HumanAnswer, type RunAnswer, type ShownBet } from "./api";
import { targetName } from "../src/target-name";
import { ClaimantToggle, useModelSlots, verdictColumns } from "./screens/Claimant";
import { DEFAULT_SCENARIO, FIXTURE_REF, SCENARIOS } from "./scenarios";
import { Bets, TargetCard } from "./screens/Bets";
import { RunScreen } from "./screens/Run";
import { VerdictScreen } from "./screens/Verdict";
import { ModelSlotCard } from "./screens/ModelPanel";
import { FindingsPanel } from "./screens/Findings";
import { MoonwellFlow } from "./screens/Moonwell";
import { ChangePanel } from "./screens/Change";
import { AdversaryPanel } from "./screens/Adversary";
import { LogStrip, useAgentEvents } from "./logstrip/LogStrip";
import { modelTextsOf, WhyDroppedContext, WhyScreen } from "./screens/Why";
import { ScaleScreen } from "./screens/Scale";
import { ProofCardPage, ProofLink } from "./screens/ProofCard";
import type { Finding } from "../src/types";
import { PasteFlow } from "./screens/Paste";
import { ExplorerFlow, type BetHandoff } from "./screens/Explorer";
import { Studio } from "./screens/Studio";
import { useDarkScheme } from "./machines/bench/BenchStage";
import type { OutlineView } from "./machines/explorer/outline-data";

/** X2: the saved outline of Atlas's own server/meta at 058ab2a (no code text), loaded only when asked for. */
const savedOutline = () => import("../tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json").then((m) => m.default as unknown as OutlineView);
import { PASTE_WORDS } from "../src/paste-words";

type Mode = "fixture" | "pr" | "scale" | "paste" | "explore";
type RoundMode = Exclude<Mode, "scale" | "explore">;

/** D06-03: `?proof=<runId>` opens one round's proof card on its own (the end frame). */
export function proofIdFromLocation(search: string): string | null {
  const id = new URLSearchParams(search).get("proof");
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** U1 (D47): what opens first. "studio" is the drawing-first screen; the others are the earlier screens (demos). */
export type Start = "studio" | Mode;

export function App({ api: given, start = "studio" }: { api?: Api; start?: Start } = {}) {
  const proofId = typeof window === "undefined" ? null : proofIdFromLocation(window.location.search);
  if (proofId) return <ProofCardPage api={given ?? createApi(undefined, undefined, { session: storedSession(PASTE_SESSION_KEY) })} runId={proofId} />;
  if (start !== "studio") return <Rounds {...(given ? { api: given } : {})} initial={start} />;
  return <Shell {...(given ? { api: given } : {})} />;
}

const DEMOS: { mode: Mode; words: string; note: string }[] = [
  { mode: "fixture", words: "The retry machine", note: "withRpcRetry (pre-existing code), bets and the retry machine" },
  { mode: "pr", words: "The Moonwell pull request", note: "Solidity on a Base fork, the price pipe" },
  { mode: "scale", words: "Many callers at once", note: "the waves chart (a mechanism, not an outage)" },
  { mode: "paste", words: "The earlier paste screen", note: "forms and free answers, step by step" },
];

/**
 * U1 (D47): the shell. The drawing-first screen fills the window; the code explorer and the earlier screens open full
 * screen over it; the agent log is a collapsible edge.
 */
function Shell({ api: given }: { api?: Api }) {
  const studioApi = useMemo(() => given ?? createApi(undefined, undefined, { onSession: (s) => storeSession(PASTE_SESSION_KEY, s) }), [given]);
  const [view, setView] = useState<"studio" | "explore" | Mode>("studio");
  const [handoff, setHandoff] = useState<BetHandoff | null>(null);
  const [exploreStart, setExploreStart] = useState<{ repo?: string; files?: FileList } | null>(null);
  const [exploreKey, setExploreKey] = useState(0);
  const [explorerOpened, setExplorerOpened] = useState(false);
  useEffect(() => {
    if (view === "explore") setExplorerOpened(true);
  }, [view]);
  const [claimant, setClaimant] = useState<ClaimantMode>("spark");
  const [logOpen, setLogOpen] = useState(false);
  const [roundOpen, setRoundOpen] = useState(false);
  // Both Meta models bet by default when the server can ask Muse Spark Open (D07-01); otherwise Muse Spark alone.
  useEffect(() => {
    let live = true;
    studioApi.claimants().then(
      (i) => {
        if (!live || !i.sparkOpen.available) return;
        setClaimant("both");
        studioApi.setClaimant("both");
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [studioApi]);
  const pickClaimant = (m: ClaimantMode) => {
    setClaimant(m);
    studioApi.setClaimant(m);
  };
  const demo = DEMOS.find((d) => d.mode === view);
  const dark = useDarkScheme();
  return (
    <div className={`iso u1-shell${logOpen ? " u1-log-open" : ""}`} data-theme={dark ? undefined : "light"}>
      <header className="u1-bar">
        <button type="button" className="u1-mark" onClick={() => setView("studio")} aria-label="Atlas: back to your drawing">
          Atlas
        </button>
        <nav className="u1-nav" aria-label="more">
          <button type="button" className="u1-link" aria-pressed={view === "explore"} onClick={() => setView("explore")} data-testid="mode-explore">
            Draw a codebase
          </button>
          <details className="u1-menu">
            <summary data-testid="u1-demos">Demos</summary>
            <ul>
              {DEMOS.map((d) => (
                <li key={d.mode}>
                  <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; setView(d.mode); }} data-testid={`mode-${d.mode}`}>
                    <span>{d.words}</span>
                    <span className="u1-sub">{d.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <button type="button" className="u1-link" aria-expanded={logOpen} aria-controls="u1-log" onClick={() => setLogOpen((o) => !o)} data-testid="u1-log-toggle">
            {logOpen ? "Hide agent log" : "Agent log"}
          </button>
        </nav>
      </header>
      <main className="u1-main">
        <div hidden={view !== "studio"} className="u1-fill">
          <Studio api={studioApi} onExplore={(s) => { setExploreStart(s ?? null); setExploreKey((k) => k + 1); setView("explore"); }} handoff={handoff} onHandoffUsed={() => setHandoff(null)} onRoundOpen={setRoundOpen} claimant={claimant} onClaimant={pickClaimant} />
        </div>
        {/* Review m2: once opened, the explorer stays mounted (hidden), so coming back never re-runs an outline job. */}
        {(view === "explore" || explorerOpened) && (
          <section className="u1-sheet" aria-label="Draw a codebase" hidden={view !== "explore"}>
            <ExplorerFlow key={exploreKey} api={studioApi} saved={savedOutline} onBet={(h) => { setHandoff(h); setView("studio"); }} {...(exploreStart?.repo ? { initialRepo: exploreStart.repo } : {})} {...(exploreStart?.files ? { initialFiles: exploreStart.files } : {})} />
          </section>
        )}
        {demo && (
          <section className="u1-sheet" aria-label={demo.words}>
            <Rounds key={demo.mode} initial={demo.mode} embedded />
          </section>
        )}
      </main>
      <aside id="u1-log" className="u1-log" hidden={!logOpen} aria-label="Agent log">
        {logOpen && <LiveLogStrip api={studioApi} dropped={null} open onToggle={() => setLogOpen(false)} />}
      </aside>
      {roundOpen && <span hidden data-testid="u1-round-open" />}
    </div>
  );
}

function Rounds({ api: given, initial = "fixture", embedded = false }: { api?: Api; initial?: Mode; embedded?: boolean }) {
  const [mode, setMode] = useState<Mode>(initial);
  // One API client (one session) per target, so switching starts a clean round.
  const fixtureApi = useMemo(() => given ?? createApi(), [given]);
  const prApi = useMemo(() => given ?? createApi(), [given]);
  const scaleApi = useMemo(() => given ?? createApi(), [given]);
  const pasteApi = useMemo(() => given ?? createApi(undefined, undefined, { onSession: (s) => storeSession(PASTE_SESSION_KEY, s) }), [given]);
  // X2: the explorer shares the paste flow's session, so "Bet on this part" lands in the same session's paste flow.
  const apiOf = (m: Mode) => (m === "fixture" ? fixtureApi : m === "pr" ? prApi : m === "paste" || m === "explore" ? pasteApi : scaleApi);
  const [handoff, setHandoff] = useState<BetHandoff | null>(null);
  const betFromExplorer = useCallback((h: BetHandoff) => {
    setHandoff(h);
    setMode("paste");
  }, []);
  // D07-01: who bets with the person on the next experiment (sent as the x-atlas-claimant header).
  const [claimant, setClaimant] = useState<ClaimantMode>("spark");
  // M4 (day-7 review): while a round is open (its experiment exists, its run has not finished) the toggle is locked.
  const [roundOpen, setRoundOpen] = useState<Record<RoundMode, boolean>>({ fixture: false, pr: false, paste: false });
  const reportFixtureOpen = useCallback((open: boolean) => setRoundOpen((r) => (r.fixture === open ? r : { ...r, fixture: open })), []);
  const reportPrOpen = useCallback((open: boolean) => setRoundOpen((r) => (r.pr === open ? r : { ...r, pr: open })), []);
  const reportPasteOpen = useCallback((open: boolean) => setRoundOpen((r) => (r.paste === open ? r : { ...r, paste: open })), []);
  const pickClaimant = (m: ClaimantMode) => {
    setClaimant(m);
    fixtureApi.setClaimant(m);
    prApi.setClaimant(m);
    pasteApi.setClaimant(m);
  };
  // D05-04: the agent log strip. A side panel on a wide screen (toggled), under the flow on a phone.
  const [stripOpen, setStripOpen] = useState(true);
  // D05-05: how many "Ask why" sentences were dropped (no run evidence), per target, for the strip.
  const [dropped, setDropped] = useState<Record<RoundMode, { count: number; at: string } | null>>({ fixture: null, pr: null, paste: null });
  const reportDropped = useCallback(
    (count: number) => {
      if (mode === "scale" || mode === "explore") return; // no "Ask why" on the waves screen or the explorer
      setDropped((d) => (d[mode]?.count === count ? d : { ...d, [mode]: { count, at: new Date().toISOString() } }));
    },
    [mode],
  );
  return (
    <div className={`shell${stripOpen ? " with-strip" : ""}${mode === "explore" ? " explore" : ""}`}>
      <main>
        {!embedded && (
          <header>
            <h1>Atlas</h1>
            <p className="muted">Know what your AI-written code does before you trust it.</p>
          </header>
        )}
        <nav className="switch" aria-label="what to test">
          <button type="button" className={mode === "fixture" ? "on" : undefined} aria-pressed={mode === "fixture"} onClick={() => setMode("fixture")}>
            withRpcRetry (TypeScript)
          </button>
          <button type="button" className={mode === "pr" ? "on" : undefined} aria-pressed={mode === "pr"} onClick={() => setMode("pr")} data-testid="mode-pr">
            A pull request link (Solidity, Base fork)
          </button>
          <button type="button" className={mode === "scale" ? "on" : undefined} aria-pressed={mode === "scale"} onClick={() => setMode("scale")} data-testid="mode-scale">
            Many callers at once
          </button>
          <button type="button" className={mode === "paste" ? "on" : undefined} aria-pressed={mode === "paste"} onClick={() => setMode("paste")} data-testid="mode-paste">
            {PASTE_WORDS.modeButton}
          </button>
          <button type="button" className={mode === "explore" ? "on" : undefined} aria-pressed={mode === "explore"} onClick={() => setMode("explore")} data-testid="mode-explore">
            Explore a codebase
          </button>
        </nav>
        {mode !== "scale" && mode !== "explore" && <ClaimantToggle api={apiOf(mode)} mode={claimant} onMode={pickClaimant} locked={roundOpen[mode]} />}
        <WhyDroppedContext.Provider value={reportDropped}>
          {mode === "fixture" ? (
            <FixtureFlow api={fixtureApi} onRoundOpen={reportFixtureOpen} />
          ) : mode === "pr" ? (
            <MoonwellFlow api={prApi} onRoundOpen={reportPrOpen} />
          ) : mode === "paste" ? (
            <PasteFlow api={pasteApi} onRoundOpen={reportPasteOpen} handoff={handoff} onHandoffUsed={() => setHandoff(null)} />
          ) : mode === "explore" ? (
            <ExplorerFlow api={pasteApi} onBet={betFromExplorer} saved={savedOutline} />
          ) : (
            <ScaleScreen api={scaleApi} />
          )}
        </WhyDroppedContext.Provider>
      </main>
      <LiveLogStrip key={mode} api={apiOf(mode)} dropped={mode === "scale" || mode === "explore" ? null : dropped[mode]} open={stripOpen} onToggle={() => setStripOpen((o) => !o)} />
    </div>
  );
}

/** The strip for one API client's session (keyed per client by App, so a switch starts a fresh stream). */
function LiveLogStrip({ api, dropped, open, onToggle }: { api: Api; dropped: { count: number; at: string } | null; open: boolean; onToggle: () => void }) {
  const events = useAgentEvents(api.session);
  return <LogStrip events={events} dropped={dropped} open={open} onToggle={onToggle} />;
}

function FixtureFlow({ api, onRoundOpen }: { api: Api; onRoundOpen?: (open: boolean) => void }) {
  const [finding, setFinding] = useState<Finding | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const models = useModelSlots(api);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Final review S2: the last run attempt stopped before a result ("the run did not finish: …").
  const [runFailed, setRunFailed] = useState<string | null>(null);
  // M4 (day-7 review): a round is open from its experiment until its run has finished.
  useEffect(() => onRoundOpen?.(experimentId !== null && result === null), [experimentId, result, onRoundOpen]);

  useEffect(() => {
    let live = true;
    api.target(FIXTURE_REF).then(
      (t) => live && setTarget(t),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const step = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ask = () =>
    step(async () => {
      if (!target) return;
      const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
      const out = await api.experiment(target, scenario.params, finding?.id);
      setExperimentId(out.experiment.id);
      setQuestions(out.questions);
      models.fromExperiment(out); // the person bets while the model(s) think; only hashes come back
    });

  const seal = () =>
    step(async () => {
      if (!experimentId) return;
      // Check every answer here first, then send them all in ONE request: the server seals all or
      // none, so a half-sealed attempt cannot happen (S1).
      const toSend: { measures: string; answer: HumanAnswer }[] = [];
      for (const q of questions) {
        const raw = (answers[q.measures] ?? "").trim();
        if (q.kind === "enum") {
          toSend.push({ measures: q.measures, answer: { kind: "enum", value: raw } });
          continue;
        }
        const n = Number(raw);
        if (raw === "" || !Number.isSafeInteger(n) || n < 0) throw new Error(`"${q.text}" needs a whole number of 0 or more`);
        toSend.push({ measures: q.measures, answer: { kind: "integer", value: n } });
      }
      const set = await api.bets(experimentId, toSend);
      // The page shows exactly the set the server will judge: one sealed bet per question asked.
      const asked = new Set(questions.map((q) => q.measures));
      if (set.length !== asked.size || set.some((b) => !asked.has(b.measures))) {
        throw new Error(`the server holds ${set.length} sealed bets for you, not one per question; start a new experiment`);
      }
      setSealed(set);
    });

  const breakIt = async () => {
    if (!experimentId) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.run(experimentId);
      // After the run, the server's slots are the truth (useModelSlots.fromRun explains the rule).
      models.fromRun(r);
      setRunFailed(null);
      setResult(r);
    } catch (e) {
      if (didNotFinish(e)) setRunFailed((e as Error).message);
      else setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <TargetCard target={target} />
      <FindingsPanel api={api} target={target} chosen={finding} onChoose={setFinding} locked={experimentId !== null} />
      <Bets
        scenarioId={scenarioId}
        onScenario={setScenarioId}
        asked={experimentId !== null}
        onAsk={ask}
        questions={questions}
        answers={answers}
        onAnswer={(m, v) => setAnswers((a) => ({ ...a, [m]: v }))}
        sealed={sealed}
        onSeal={seal}
        busy={busy || !target}
      />
      {models.slots.map((slot) => (
        <ModelSlotCard key={slot.who} slot={slot} revealed={result ? result.bets.filter((b) => b.who === slot.who) : null} />
      ))}
      <RunScreen canRun={sealed.length > 0 && !busy && !models.thinking} running={running} result={result} onBreak={breakIt} failed={runFailed} {...(target ? { name: targetName(target) } : {})} />
      {result && <VerdictScreen shown={sealed} typed={answers} modelShown={[]} modelName={null} models={verdictColumns(models.slots)} result={result} />}
      {result && <WhyScreen run={result.run} finding={finding} modelTexts={modelTextsOf(result.bets, finding)} />}
      {result?.proof?.ok && <ProofLink runId={result.proof.runId} />}
      {result && experimentId && <ChangePanel api={api} result={result} experimentId={experimentId} />}
      {result && <AdversaryPanel api={api} runId={result.run.id} />}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
