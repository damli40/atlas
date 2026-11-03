// U1 (D47/D48): the drawing-first screen. One entry (paste, upload or a GitHub folder) → a full-screen drawing of how
// the code is built → an optional "Bet on your understanding" pop-up with a quiz → the run plays on the same drawing
// and every answer is marked there.
//
// Plain words on trust, as on every screen:
// - The drawing before betting comes from plain code's outline of the file and, once a test is chosen, from the test
//   itself (its stand-ins and their scripted answers). It never shows a run result: no run exists until the bets are
//   sealed, and the stage is given run data only after that (BenchStage's `after`).
// - The quiz options are plain code's (src/quiz.ts), the same for the person and every model (D19: the "what every
//   bettor sees" text lists them, and the models' prompt is that text).
// - Muse Wonder's test is a proposal: the gate decides. Its claim sentence is shown only after the run (D18).
// - Verdicts are plain code's (src/judge.ts): matched / didn't match / can't check.

import { describeCall, visibleText } from "../../src/gate";
import { endingFacts, momentOf, reachNote, runEnding } from "../../src/moment";
import { countChange, weakestWords, type Weakest } from "../../src/remember";
import { questionTypeOf } from "../../src/track-record";
import { notShownAsFact } from "../../src/trust";
import type { JsonValue } from "../../src/types";
import { PASTE_WORDS } from "../../src/paste-words";
import EXAMPLE_OUTLINE from "../u1-example-outline.json";
import { betView } from "../../renderer/authors/bet-view";
import { Drawing } from "../drawing/Drawing";
import { waitingPartsOf } from "../../src/call-sites";
import type { HelperAnswer } from "../api";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import type { Question } from "../../src/gate";
import { shortQuestionFor, pinsLineOf } from "../../src/paste-context";
import { CANT_TELL, timeOptions } from "../../src/quiz";
import { literal, parseTyped } from "../../src/literal";
import { WONDER_DISPLAY, BET_WORDS, RESULT_WORDS, STAGE_WORDS, betterByRole } from "../../src/paste-words";
import type { Mark } from "../machines/bench/play";
import { foreignLanguage } from "../../src/paste-language";
import { keptState, type CodeContext } from "../../src/code-facts";
import { LIBRARY_WORDS } from "../../src/network-fake";
import { CALL_DEFAULT_WATCH_LIMIT_MS } from "../../src/gate";
import { ProofCardPage } from "./ProofCard";
import type { ClaimantMode } from "../../src/claimants";
import { didNotFinish, type Api, type ExperimentAnswer, type HumanAnswer, type PasteAnswer, type ProposalsAnswer, type RunAnswer, type ShownBet } from "../api";
import { absentBettors, useModelSlots } from "./Claimant";
import { ErrorNotice, InviteLinks, noteWaitlist } from "./ErrorNotice";
import { MachineSheet, machineFirst, useFontsIn } from "../drawing/MachineView";
import { drawMachine, machineParts } from "../../renderer/authors/machine";
import type { PartPanel } from "../../renderer/authors/part-panel";
import { PartFacts } from "../drawing/PartFacts";
import { EXAMPLE_NAMES } from "../../src/example-names";
import type { FileSummary } from "../../src/file-summary";
import { SAMPLE_FILES, SAMPLE_WORDS } from "../sample-files";
import { Segments, TestForm, emptyForm, formFromParams, type TestFormState } from "./TestForm";
import { BenchStage, type After } from "../machines/bench/BenchStage";
import { benchModel, dialFullMs, type CallTest } from "../machines/bench/model";
import { marksOf, playScript } from "../machines/bench/play";
import type { FileOutline } from "../../src/file-outline";
import { U1_EXAMPLE } from "../u1-example";
import { plural } from "../../src/words";
import type { BetHandoff } from "./Explorer";
import type { PasteLabelsAnswer } from "../api";
import { lineSpan } from "../../src/words";
import type { Confidence } from "../../src/types";
import { FeltRecord, FeltRoundLine, HowSurePicker } from "./FeltPanel";
import { FELT_WORDS, SIMPLE_WORDS, shortModelName } from "../../src/paste-words";

type Lang = "js" | "ts" | "py";
const EXAMPLE_FUNCTION_NAME = "fetchWithRetry";
const CONSENT_LINE = "Your code goes to Meta's AI as soon as Atlas draws it, so a test is ready when you bet.";
// R10 (D72): DAMI: placeholder wording. Said when someone with no code reaches past the example (the server says the same).
const OWN_CODE_LINE = "Your own code, and anything beyond the example, needs an invite code, so nothing was run and no AI was asked.";
const FILE_NAME: Record<Lang, string> = { js: "pasted.js", ts: "pasted.ts", py: "pasted.py" };

/** The function drawn as "under test" by default: the exported function with the most calls out, then the first. */
export function defaultFunction(outline: FileOutline | undefined, exports: readonly { name: string }[]): string | null {
  const names = new Set(exports.map((e) => e.name));
  const fns = (outline?.parts ?? []).filter((p) => p.kind === "function" && names.has(p.name));
  // A file with an outline and no exported function has nothing to call: no bet is offered on a constant.
  if (fns.length === 0) return outline ? null : (exports[0]?.name ?? null);
  const out = (n: string) => outline!.joins.filter((j) => j.from === n).length;
  return [...fns].sort((a, b) => out(b.name) - out(a.name) || a.lineStart - b.lineStart)[0]!.name;
}

/** The test a round opens on, or undefined. */
export function defaultProposal<P extends { gate: { allowed: boolean }; params: unknown }>(proposals: readonly P[]): P | undefined {
  // Wonder's first allowed test: it is asked to make that one show the flaw its sentence names, so the person's first bet can fail. Every bettor gets the same test (D19).
  return proposals.find((p) => p.gate.allowed);
}

/**
 * U3: the test a "Test this claim" round opens on: Wonder's first allowed test (the one aimed at the sentence), except
 * that on code keeping state between calls a single call cannot show the state working, so a two-call test comes first.
 */
/** D60: the example's real drawing, drawing itself on the first screen: the same parser's output, kept in the page (a test holds them equal). */
/** D60: the code beside the drawing. Clicking a part on the drawing jumps here. R6: and says what that part is, from the machine's own facts, above its lines. */
function CodeDrawer({ source, lines, onClose, coversResult = false, part = null }: { source: string; lines: [number, number] | null; onClose: () => void; coversResult?: boolean; part?: PartPanel | null }) {
  const host = useRef<HTMLDivElement | null>(null);
  // A newline at the end of a file ends its last line: it does not start another.
  const all = useMemo(() => source.replace(/(?:\r\n|\r|\n)$/, "").split(/\r\n|\r|\n/), [source]);
  useEffect(() => {
    if (lines) host.current?.querySelector<HTMLElement>(`[data-line="${lines[0]}"]`)?.scrollIntoView({ block: "center" });
  }, [lines]);
  return (
    <aside className="c-drawer" aria-label={part ? `About ${part.title}` : "Your code"} data-testid="c-drawer" data-part={part?.id}>
      <div className="c-head">
        <span>{part ? "This part" : "Your code"}</span>
        <button type="button" className="u1-close" onClick={onClose} aria-label={part ? "Close this panel" : "Close the code"}>
          ×
        </button>
      </div>
      {coversResult && <p className="c-covers" role="note" data-testid="c-covers">{`Your result is under this panel. ${part ? "Esc" : "C"} closes it.`}</p>}
      {part && <PartFacts part={part} />}
      {part && !lines ? null : (
      <div className="c-body" ref={host} tabIndex={0}>
        {all.map((text, i) => {
          const n = i + 1;
          return (
            <div className="c-line" key={n} data-line={n} data-on={lines && n >= lines[0] && n <= lines[1] ? "" : undefined}>
              <span className="c-n">{n}</span>
              <span className="c-t">{text || " "}</span>
            </div>
          );
        })}
      </div>
      )}
    </aside>
  );
}

function ExampleDrawing() {
  // The first thing anyone sees: the example's machine, pencilling itself in. Plain code's own parts, kept in the page (a test holds them equal to the parser's). On a phone, or if it can't be drawn clearly, the chart.
  const outline = EXAMPLE_OUTLINE as unknown as FileOutline;
  const fontsIn = useFontsIn();
  const drawn = useMemo(() => {
    if (!fontsIn || !machineFirst()) return null;
    const model = benchModel({ fileName: "example.ts", outline, test: null, source: U1_EXAMPLE, language: "ts" });
    // R6: the example's natural names are kept in the page (recorded once from a real call), so they cost nothing here.
    const parts = machineParts({ ...model, tested: EXAMPLE_FUNCTION_NAME }, outline, U1_EXAMPLE, "ts");
    const named = { ...parts, housings: parts.housings.map((h) => (EXAMPLE_NAMES[h.id] ? { ...h, natural: EXAMPLE_NAMES[h.id]! } : h)) };
    const d = drawMachine(named, { seed: "machine:example", nameLines: true });
    return d.tooMany || d.problems.length > 0 ? null : d;
  }, [outline, fontsIn]);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  const spec = useMemo(() => {
    const s = betView({ fileName: "example.ts", outline, source: U1_EXAMPLE, language: "ts", test: null, tested: EXAMPLE_FUNCTION_NAME });
    return { ...s, title: undefined, kicker: undefined, subtitle: undefined, captions: [] } as typeof s;
  }, [outline]);
  const wide = typeof window === "undefined" || window.innerWidth >= 760;
  return (
    <div className="e-right" aria-hidden="true" inert data-testid="e-drawing">
      {!fontsIn && wide && machineFirst() ? null : drawn && wide ? (
        <MachineSheet drawn={drawn} reduced={reduced} penKey="example" testid="e-machine" />
      ) : (
        <Drawing
          spec={spec}
          theme="light"
          className="e-sheet"
          maxScale={1}
          hover={false}
          onMount={(m) => {
            if (m?.player && !m.player.reduced) void m.player.entrance();
          }}
        />
      )}
    </div>
  );
}

// The code with comments and spaces taken out (src/code-fingerprint.ts): kept exported here for the page's older importers.
export { codeFingerprint } from "../../src/code-fingerprint";
import { codeFingerprint } from "../../src/code-fingerprint";

const HELPER_WAIT_MS = 2500;
const HELPER_TOO_SLOW = "Helper order is not shown: the separate traced run took too long.";
export const CHANGE_WORDS = {
  open: "Change the code and bet again",
  pickTitle: "Bet on another test",
  pickKeeps: "This result stays until you choose.",
  explain: "Same test, same questions. Your new answers are sealed before anything runs, and the new run is judged the same way.",
  go: "Draw the change and bet again",
  sameTest: "The same test, on your changed code. Bet again: nothing about this code has run yet.",
  foreign: (name: string) => `This looks like ${name}. Atlas reads JavaScript, TypeScript and Python, so it can't draw this file.`,
  nothingToDraw: "Atlas draws functions and classes, and this has none. Paste a JavaScript, TypeScript or Python file with at least one function.",
  nothingToCall: "Atlas bets on what a function does when it is called, and it can't see one in this file that can be called from outside. It can call one exported by name, like export function f.",
  claimantAsks: "Changing who bets asks them again: paid AI calls. Your answers stay.",
  sameCode: "Same code as a run you've already seen, apart from spaces or comments, so you may already know the answer.",
  pickUsed: "The tests that came with Muse Wonder's sentence can't be used now that the sentence is shown. Ask for a new one, or write your own.",
  noOtherRan: "Every test ready for this function has already run here, so its answer is known. Ask for a new one, or write your own.",
  noOtherYet: "No other test is ready for this function. Ask for one, or write your own.",
  /** R11: what an open bet says when nothing is being asked, so it is never a blank panel. */
  idle: (fn: string) => `No test is being written for ${fn} yet. Ask Muse Wonder for one, or write your own.`,
  claimAsking: "Asking Muse Wonder for a new test…",
  claimNoNew: "Muse Wonder's tests for this sentence are ones that have already run here, so there is nothing new to bet on.",
  paidWonder: "Asks Muse Wonder and the AI bettors: paid AI calls.",
  earlyWonder: "Muse Wonder is writing a test for this code: a paid AI call.",
  earlyDone: "Muse Wonder wrote a test for this code: a paid AI call, already made. Betting adds the AI bettors: paid AI calls.",
  paidAgain: "The first two start paid AI calls.",
  paidBets: "The AI bettors answer too. Each is a paid AI call, from your invite's budget where you have one.",
} as const;

/** The test's values too long for its one sentence, in full: "show the whole test" must show them whole. */
export function longValues(params: unknown, language: Lang | undefined): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, key));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "value" || k === "body") {
        const text = visibleText(literal(x as JsonValue, language));
        if (text.length > 60 && !out.includes(text)) out.push(text);
      } else walk(x, k);
    }
  };
  walk(params, "");
  return out;
}

/** How one test differs from another, by the values a person would recognise, so two tests can be told apart. Never the test's internal words. */
export function whatDiffers(a: unknown, b: unknown, other = "the last"): string {
  const leaves = (v: unknown, path: string, out: Map<string, unknown>) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) leaves(x, `${path}/${k}`, out);
    else out.set(path, v);
    return out;
  };
  const x = leaves(a, "", new Map());
  const y = leaves(b, "", new Map());
  const changed = [...new Set([...x.keys(), ...y.keys()])].filter((k) => x.get(k) !== y.get(k));
  if (changed.length === 0) return `The same as ${other} test.`;
  const isValue = (k: string) => /\/(value|body|status|message|errorName|afterMs|waitMs|name)$/.test(k) || /\/value\//.test(k) || /\/body\//.test(k);
  const shown = changed
    .filter((k) => x.has(k) && y.has(k) && isValue(k))
    .slice(0, 3)
    .map((k) => `${JSON.stringify(x.get(k))} where ${other} test has ${JSON.stringify(y.get(k))}`);
  if (shown.length === 0) return `Differs from ${other} test in what its fakes do.`;
  const more = changed.filter(isValue).length - shown.length;
  return `This test has ${visibleText(shown.join(", "))}${more > 0 ? `, and ${more} more` : ""}.`;
}

/** How many arguments a function needs, from its signature: a default, a ? or a * makes one optional. Null when it can't be told. */
export function requiredArgs(signature: string | undefined): string[] | null {
  if (!signature) return null;
  const open = signature.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  let cur = "";
  const out: string[] = [];
  for (let i = open; i < signature.length; i++) {
    const c = signature[i]!;
    if ("([{<".includes(c)) {
      if (depth++ > 0) cur += c;
    } else if (")]}>".includes(c) && !(c === ">" && signature[i - 1] === "=")) {
      if (--depth === 0) {
        out.push(cur);
        break;
      }
      cur += c;
    } else if (c === "," && depth === 1) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  return out.map((p) => p.trim()).filter((p) => p !== "" && p !== "self" && p !== "cls" && !/[=?]|^\*|^\.\.\./.test(p.split(":")[0]!) && !/=(?!>)/.test(p)).map((p) => p.split(":")[0]!.trim());
}

/** A plain-code label on the drawing. "found in this code" is what the code matched, not what it has. */
export const labelMarkWords = (label: string, name: string, lines: string | null): string => `${label === "found in this code" ? "could fail" : label}: ${name}${lines ? `, ${lines}` : ""}${label === "found in this code" ? " (read, not run)" : ""}`;

/** What this invite code has left today, when the server says. */
const leftOf = (st: { dailyUsd?: number | null; today?: { spentUsd: number; heldUsd: number } | null }) => (typeof st.dailyUsd === "number" && st.today ? st.dailyUsd - st.today.spentUsd - st.today.heldUsd : null);

const EARLY_KEY = "atlas-early-tests";
const EARLY_PER_HOUR = 2;
/** D63: 2 early test-writings per tab an hour. The example's kept tests cost nothing, so they do not count. */
function takeEarlySlot(source: string): boolean {
  if (source === U1_EXAMPLE) return true;
  try {
    const now = Date.now();
    const seen = (JSON.parse(sessionStorage.getItem(EARLY_KEY) ?? "[]") as number[]).filter((t) => now - t < 3_600_000);
    if (seen.length >= EARLY_PER_HOUR) return false;
    sessionStorage.setItem(EARLY_KEY, JSON.stringify([...seen, now]));
    return true;
  } catch {
    return false;
  }
}

export function claimProposal<P extends { gate: { allowed: boolean }; params: unknown }>(proposals: readonly P[], code?: CodeContext): P | undefined {
  const allowed = proposals.filter((p) => p.gate.allowed);
  const twoCalls = code && keptState(code.source, code.language).length > 0 ? allowed.find((p) => Array.isArray((p.params as CallTest).calls)) : undefined;
  return twoCalls ?? allowed[0];
}

/** R3: tests compared by what they do, whatever order their keys came in. */
export const canonicalTest = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

/**
 * The answers the page sends: a tap is a quiz answer; U3: a typed value (on a question that takes one) is a json answer;
 * an untouched question or "can't tell" is declined. D64: text that isn't a value seals as that text, and the box says so as it is typed.
 */
export function answersToSend(questions: readonly Question[], picked: Record<string, string>, typed: Record<string, string> = {}, language?: Lang): { ok: true; answers: { measures: string; answer: HumanAnswer }[] } {
  const answers: { measures: string; answer: HumanAnswer }[] = [];
  for (const q of questions) {
    const t = (typed[q.measures] ?? "").trim();
    if (q.allowsTyped && t !== "") {
      // A parsed null is a value, not "no parse": `??` can't tell them apart.
      const read = parseTyped(t, language);
      answers.push({ measures: q.measures, answer: { kind: "json", value: read ? read.value : t } });
      continue;
    }
    const c = picked[q.measures];
    answers.push({ measures: q.measures, answer: c && c !== CANT_TELL ? { kind: "quiz", choice: c } : { kind: "declined", reason: CANT_TELL } });
  }
  return { ok: true, answers };
}

/** Studio stays mounted under the other screens: while one of them shows, its keys and paste do nothing. */
const offScreen = () => typeof document !== "undefined" && document.querySelector<HTMLElement>(".u1-fill")?.hidden === true;

export interface StudioProps {
  api: Api;
  /** "Upload files" with more than one file, or a GitHub folder: the code explorer (X2), full screen. */
  onExplore: (start?: { repo?: string; files?: FileList }) => void;
  /** From the explorer's "Bet on this part": the file and the function. */
  handoff?: BetHandoff | null;
  onHandoffUsed?: () => void;
  onRoundOpen?: (open: boolean) => void;
  claimant: ClaimantMode;
  onClaimant: (m: ClaimantMode) => void;
  /** R7 (D69): "Try the Moonwell bug" opens the saved Moonwell replay. */
  onMoonwell?: () => void;
}

export function Studio({ api, onExplore, handoff = null, onHandoffUsed, onRoundOpen, claimant, onClaimant, onMoonwell }: StudioProps) {
  // R7 (D69): one flow. One question by default (the server asks every bettor the same one); the rest waits in fine print.
  const [oneMode, setOneMode] = useState(true);
  const quizOpts = (one = oneMode) => ({ quiz: true as const, ...(one ? { one: true as const } : {}) });
  // Fine print that is opened: "Details" (code, box chart, paid-call lines), "More options for this bet", the result's "More".
  const [details, setDetails] = useState(false);
  const [betMore, setBetMore] = useState(false);
  const [more, setMore] = useState(false);
  // The paste box, Upload and GitHub: shown on the first screen only after "Try your own code".
  const [ownOpen, setOwnOpen] = useState(false);
  const autoExample = useRef(false);
  const autoBet = useRef<string | null>(null);
  const [code, setCode] = useState("");
  const [lang, setLang] = useState<Lang | "auto">("auto");
  const [pasted, setPasted] = useState<PasteAnswer | null>(null);
  const [fn, setFn] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [proposals, setProposals] = useState<ProposalsAnswer | null>(null);
  const [exp, setExp] = useState<ExperimentAnswer | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [wholeTest, setWholeTest] = useState(false);
  // "show the whole test" only when some of it is really cut.
  const testLine = useRef<HTMLParagraphElement | null>(null);
  const [testCut, setTestCut] = useState(false);
  useEffect(() => {
    const el = testLine.current;
    if (el && !wholeTest) setTestCut(el.scrollHeight > el.clientHeight + 1);
  });
  const [sealed, setSealed] = useState<ShownBet[]>([]);
  const [result, setResult] = useState<RunAnswer | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [form, setForm] = useState<{ initial: TestFormState; editedFrom?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plays, setPlays] = useState(0);
  // U3 item 7: how many replays have finished (the button says "again" only after the first one ended).
  const [played, setPlayed] = useState(0);
  // U3 item 5: a round opened by "Test this claim": the sentence it tests (the person's screen only; D18 keeps it from
  // the betting models). Its result is shown beside the run's measured facts, never judged.
  const [claimRound, setClaimRound] = useState<{ sentence: string; closeness?: string; lastEnding?: string | null } | null>(null);
  // U3 item 6: while Muse Wonder writes tests: when it started and what is happening now (real steps, not a guess).
  const [wonderWait, setWonderWait] = useState<{ started: number; phase: string; claim?: string } | null>(null);
  const ownTest = useRef(false);
  const [repo, setRepo] = useState("");
  const models = useModelSlots(api);
  const runStarted = useRef(false);
  // Review M1: every async answer belongs to one round. reset() starts a new round, and a late answer from an older one
  // (Wonder's tests, an experiment, a run) is dropped instead of landing on the new drawing.
  const gen = useRef(0);
  const [runTry, setRunTry] = useState(0);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [readText, setReadText] = useState("");
  // R3: "Change the code and bet again": the code being edited. The test stays the one just run.
  const [editing, setEditing] = useState<string | null>(null);
  const drawStart = useRef(0);
  const [drawnMs, setDrawnMs] = useState<number | null>(null);
  // D60: the code drawer. Closed on the drawing, open during the bet on a wide screen, because the AIs read the code and you should too.
  const [drawerChoice, setDrawer] = useState<boolean | null>(null);
  const [drawerLines, setDrawerLines] = useState<[number, number] | null>(null);
  // R6: the part the panel is about: its id only. The panel's words are worked out again on every render from the current code and run
  // (BenchStage hands them back), so they can never describe an older file or run. C opens the plain code.
  const [partId, setPartId] = useState<string | null>(null);
  const [partPanel, setPartPanel] = useState<PartPanel | null>(null);
  const wide = typeof window !== "undefined" && window.innerWidth >= 1400;
  // D60: the bet is one question at a time. All of them stay in the page (D19); CSS shows the current one.
  const [step, setStep] = useState(0);
  // R3: "Test this claim": asking Wonder, and whether it had nothing new (the button then goes away).
  const [claimAsking, setClaimAsking] = useState(false);
  const [claimNoNew, setClaimNoNew] = useState(false);
  // The code and test pairs already run here, whatever the spaces and comments: only for the label on a changed round (M3).
  const ranCodes = useRef(new Set<string>());
  /** This test has already run on this code, whatever its keys' order and the code's spaces. Offering it again would show its answer. */
  const alreadyRan = (params: unknown) => ranCodes.current.has(`${codeFingerprint(readText, pasted?.target.language ?? undefined)}|${canonicalTest(params)}`);
  const [beforeChange, setBeforeChange] = useState<string | null>(null);
  // The server's word that this round repeats a test: the person is told what the bettors are told (D19).
  const [repeatNote, setRepeatNote] = useState<string | null>(null);
  // R3 review B7: "Bet on another test" opens a list first. It wipes nothing and spends nothing until something is chosen.
  const [picking, setPicking] = useState(false);
  // Changing who bets asks them again, so it is said first, and answers stay.
  const [pendingClaimant, setPendingClaimant] = useState<ClaimantMode | null>(null);
  // R3: the code's own steps for the drawing (a third run made after the sealed ones). Arrives with the result, or not at all.
  const [helpers, setHelpers] = useState<HelperAnswer | null>(null);
  const [helpersIn, setHelpersIn] = useState(false);
  useEffect(() => onRoundOpen?.(exp !== null && result === null), [exp, result, onRoundOpen]);

  const target = pasted?.runnable ? pasted.target : null;
  const test = exp?.experiment.gate.allowed ? (exp.experiment.params as CallTest) : null;
  const marks = useMemo(() => (test ? timeOptions(test).flatMap((o) => (o.match.kind === "ms" && o.match.min > 0 ? [o.match.min] : o.match.kind === "ms" && o.match.max ? [o.match.max] : [])) : []), [test]);
  const fullMs = useMemo(() => dialFullMs(marks), [marks]);
  const model = useMemo(
    () => (pasted?.outline ? benchModel({ fileName: FILE_NAME[pasted.target.language ?? "ts"], outline: pasted.outline, test: test ? test : null, dial: { marks: [...new Set(marks)], fullMs }, source: readText, language: pasted.target.language ?? pasted.language.chosen }) : null),
    [pasted, test, marks, fullMs, readText],
  );
  // Mark the function under test even before a test exists (it is lit on the drawing).
  const shownModel = useMemo(() => (model && !model.tested && fn ? { ...model, tested: fn } : model), [model, fn]);

  // X3 (D28) + review round 2 (D50): plain code's failure labels for the function, drawn on the parts BEFORE betting
  // (every bettor's text carries the same labels). Read again after each run (a run can reproduce one). Only labels
  // plain code claims ("found in this code", "reproduced", "inconclusive") become marks; "common pattern" ones stay in
  // the bettor text, where they are said to be Atlas's list only.
  const [labels, setLabels] = useState<PasteLabelsAnswer | null>(null);
  useEffect(() => {
    if (!target || !fn) {
      setLabels(null);
      return;
    }
    let live = true;
    Promise.resolve()
      .then(() => api.pasteLabels(target, fn))
      .then(
        (a) => live && setLabels(a),
        () => live && setLabels(null),
      );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, target?.codeSha256, fn, result?.run.id]);
  const labelMarks = useMemo(() => {
    if (!labels || !pasted?.outline) return [];
    const partAt = (line: number) => pasted.outline!.parts.find((p) => p.lineStart <= line && line <= p.lineEnd)?.name ?? fn ?? "";
    return labels.labels
      .filter((l) => l.label !== "common pattern")
      // "found in this code: timeout" read as if a timeout exists. It means the code could fail that way, from reading it.
      .map((l) => ({ anchor: partAt(l.lines?.[0]?.lineStart ?? 0), text: labelMarkWords(l.label, l.name, l.lines?.[0] ? lineSpan(l.lines[0].lineStart, l.lines[0].lineEnd) : null) }));
  }, [labels, pasted, fn]);

  // R4: the test the change round uses. Choosing any other drops "before" and "after", which would credit the code with the new test.
  const changeTest = useRef<string | null>(null);
  const reset = () => {
    changeTest.current = null;
    // R6: a new round starts with no part panel open.
    setPartId(null);
    setDrawer(null);
    setProposals(null);
    setExp(null);
    setPicked({});
    setTyped({});
    setConfidence(null);
    setSealed([]);
    setResult(null);
    setClaim(null);
    setChanging(false);
    setForm(null);
    setError(null);
    setProofOpen(false);
    setPlayed(0);
    setClaimRound(null);
    setWonderWait(null);
    setEditing(null);
    setPicking(false);
    setBeforeChange(null);
    setPendingClaimant(null);
    setRepeatNote(null);
    setStep(0);
    setClaimNoNew(false);
    setHelpers(null);
    setHelpersIn(false);
    setBetMore(false);
    setMore(false);
    ownTest.current = false;
    runStarted.current = false;
    gen.current++;
  };

  /**
   * U3 item 6: asks Muse Wonder for tests with real progress on screen (elapsed time, what is happening), and the
   * person may write their own test at once; if they do, Wonder's answer never replaces it.
   */
  const askWonder = async (opts: { claimOf?: string; claim?: string; pick: "default" | "first" | "list" }) => {
    if (!target || !fn) return;
    const g = gen.current;
    ownTest.current = false;
    setWonderWait({ started: Date.now(), phase: BET_WORDS.waitAsking, ...(opts.claim ? { claim: opts.claim } : {}) });
    setError(null);
    try {
      // D60: the test-writing that began when the drawing finished, if it is for this file and function.
      const ready = !opts.claimOf && opts.pick !== "list" ? early.current.get(`${target.codeSha256}|${fn}`) : undefined;
      const p = (ready ? await ready : null) ?? (await api.proposals(target, fn, opts.claimOf ? { claimOf: opts.claimOf } : undefined));
      if (g !== gen.current) return;
      setProposals(p);
      const allowedN = p.proposals.filter((x) => x.gate.allowed).length;
      setWonderWait((w) => (w ? { ...w, phase: BET_WORDS.waitChecked(allowedN, p.proposals.length) } : w));
      if (ownTest.current) return; // the person is writing their own test: Wonder's tests wait in the list
      const lang = pasted?.target.language ?? pasted?.language.chosen;
      // The default is Wonder's first allowed test; "Test this claim" too, except on code that keeps state (claimProposal).
      // A test that has already run on this code is not offered again: its answer is known.
      // R10 review (D72): with no code, going back to the example plays the same question again (the only one open to them);
      // the server gives a fresh round and counts it once on their record. Skipping it would land on a question that needs a code.
      const replayExample = locked && readText === U1_EXAMPLE;
      const offered = p.proposals.filter((x) => replayExample || !alreadyRan(x.params));
      const first = opts.pick === "list" ? undefined : opts.pick === "first" ? claimProposal(offered, lang ? { source: readText, language: lang } : undefined) : defaultProposal(offered);
      if (first) await start(() => api.experimentFromProposal(target, first.id, quizOpts()));
      else setChanging(true);
    } catch (e) {
      if (g === gen.current) {
        setError((e as Error).message);
        // One sentence and one way on: the person can write their own test without paying again.
        setChanging(true);
      }
    } finally {
      if (g === gen.current) setWonderWait(null);
    }
  };
  // D60, D63: Muse Wonder starts writing a test when the drawing is done, so the wait is spent on the drawing. Only for 2 pastes per tab
  // an hour, never with under $1 left, and never on a Change round, which already has its test. Otherwise it starts on the Bet click.
  // Answers are kept per file and function, so going back to one does not pay twice.
  const early = useRef(new Map<string, Promise<ProposalsAnswer | null>>());
  const skipEarly = useRef(false);
  const [earlyState, setEarlyState] = useState<"idle" | "busy" | "done">("idle");
  useEffect(() => {
    setEarlyState("idle");
    // J1: read() clears the file first, so this runs once with no target. The flag has to last until the changed file is here.
    if (!target || !fn) return;
    const skip = skipEarly.current;
    skipEarly.current = false;
    if (skip || pasted?.cantCheck || !api.proposals) return;
    const key = `${target.codeSha256}|${fn}`;
    const kept = early.current.get(key);
    if (kept) {
      setEarlyState("done");
      return;
    }
    if (exp || proposals) return;
    if (invite?.left !== undefined && invite.left !== null && invite.left < 1) return;
    if (!takeEarlySlot(readText)) return;
    setEarlyState("busy");
    const answer = Promise.resolve()
      .then(() => api.proposals(target, fn, { early: true }))
      .then((p) => (p.ok ? p : null))
      .catch(() => null);
    early.current.set(key, answer);
    void answer.then((p) => {
      if (!p) early.current.delete(key);
      if (key === `${targetKey.current}`) setEarlyState(p ? "done" : "idle");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.codeSha256, fn]);
  const targetKey = useRef("");
  targetKey.current = target && fn ? `${target.codeSha256}|${fn}` : "";
  // R6: the parts' natural names, asked once per drawn file. The machine draws at once with split names; these arrive later or not at all.
  const [natural, setNatural] = useState<{ sha: string; model: string; names: Record<string, string> } | { sha: string; reason: string } | null>(null);
  useEffect(() => {
    if (!target || !api.names || !pasted?.outline || pasted.outline.parts.length === 0) return;
    const sha = target.codeSha256;
    let live = true;
    void api.names(target).then(
      (r) => live && setNatural(r.ok ? { sha, model: r.model, names: r.names } : { sha, reason: r.reason ?? "no answer" }),
      () => live && setNatural({ sha, reason: "the request failed" }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.codeSha256, pasted?.outline]);
  // R9: the file's summary, asked at the same time as the names, once per drawn file. Shown before the bet in the AI's ink; none on failure.
  const [summ, setSumm] = useState<{ sha: string; model: string; summary: FileSummary } | { sha: string; reason: string } | null>(null);
  useEffect(() => {
    if (!target || !api.summary || !pasted?.outline || pasted.outline.parts.length === 0) return;
    const sha = target.codeSha256;
    let live = true;
    void api.summary(target).then(
      (r) => live && setSumm(r.ok && r.summary ? { sha, model: r.model, summary: r.summary } : { sha, reason: r.reason ?? "no answer" }),
      () => live && setSumm({ sha, reason: "the request failed" }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.codeSha256, pasted?.outline]);
  const writeOwn = () => {
    if (needsCode()) return;
    ownTest.current = true;
    setChanging(true);
    setForm({ initial: emptyForm() });
  };

  const read = useCallback(
    async (text: string, language?: Lang, want?: string, from?: string) => {
      if (text.trim() === "") return null;
      reset();
      // R11: a new file starts with the bet closed. The example opens its bet by itself (R7), and reset() keeps `open`, so a file
      // handed over from the repo outline (or pasted over the example) landed in an open bet with nothing in it, and no way out.
      setOpen(false);
      const g = gen.current;
      setPasted(null);
      setHandoffNote(null);
      drawStart.current = performance.now();
      setDrawnMs(null);
      setSource(from ?? null);
      setBusy("Reading your code…");
      setReadText(text);
      try {
        const r = await api.paste(text, language);
        if (g !== gen.current) return null;
        setPasted(r);
        // A real timer from the click to the frame. Reading a file calls no AI (server/paste.ts).
        requestAnimationFrame(() => requestAnimationFrame(() => setDrawnMs(Math.round(performance.now() - drawStart.current))));
        // Review M4: a function the explorer named that this file does not export is said plainly, never swapped silently.
        if (want && !r.exports.some((e) => e.name === want)) {
          setHandoffNote(`${want} can't be called from outside this file, and Atlas can only call functions that can. Pick one on the drawing.`);
          setFn(null);
        } else setFn(want ?? defaultFunction(r.outline, r.exports));
        return r;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api],
  );

  // X2's "Bet on this part": the explorer hands one file and one function to this screen.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!handoff || handled.current === handoff.nonce) return;
    handled.current = handoff.nonce;
    onHandoffUsed?.();
    setCode(handoff.code);
    setLang(handoff.language);
    void read(handoff.code, handoff.language, handoff.exportName, handoff.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff?.nonce]);

  // ---- D60: the invite on the first screen. A link can carry the code in its fragment, which never reaches a server's logs.
  const [invite, setInvite] = useState<{ required: boolean; signedIn: boolean; error?: string; busy?: boolean; left?: number | null } | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  // R10 (D72): no code on a server that needs one. The example still plays (the server lets it through, recorded answers only);
  // everything beyond it says the one line and offers the waitlist and "I have a code".
  const locked = Boolean(invite?.required && !invite.signedIn);
  const needsCode = () => {
    if (!locked) return false;
    setError(OWN_CODE_LINE);
    return true;
  };
  // R7: the first screen waits for the server's word on invites (or its silence) before drawing the example.
  const [inviteChecked, setInviteChecked] = useState(false);
  // D66: what this person's own record says. A first-time visitor gets nothing, so nothing shows.
  const [remember, setRemember] = useState<{ last: string | null; weakest: Weakest | null } | null>(null);
  const betFor = exp?.experiment.params.shape === "call-function" ? exp.experiment.params.exportName : undefined;
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.remember(betFor, pasted?.target.codeSha256))
      .then((a) => live && setRemember(a), () => live && setRemember(null));
    return () => {
      live = false;
    };
    // Read again on a new bet, and when a round has been counted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, betFor, plays, invite?.signedIn]);

  const useCode = async (typed: string) => {
    setInvite((v) => (v ? { ...v, busy: true } : v));
    const a = await api.signIn(typed);
    if ("error" in a) {
      // Only the words: whether a code is needed, and whether this browser holds one, stay the status answer's to say.
      setInvite((v) => ({ required: v?.required ?? false, signedIn: v?.signedIn ?? false, busy: false, error: a.error }));
      return false;
    }
    setInvite({ required: true, signedIn: true });
    return true;
  };
  useEffect(() => {
    let live = true;
    void (async () => {
      const carried = typeof location !== "undefined" ? /^#(?:invite|code)=(.+)$/.exec(location.hash)?.[1] : undefined;
      if (carried) {
        history.replaceState(null, "", location.pathname + location.search);
        const ok = await Promise.resolve()
          .then(() => useCode(decodeURIComponent(carried)))
          .catch(() => {
            setInvite((v) => ({ required: v?.required ?? false, signedIn: v?.signedIn ?? false, error: "The code in that link could not be read." }));
            return false;
          });
        if (ok || !live) {
          const st = await Promise.resolve().then(() => api.inviteStatus()).catch(() => null);
          noteWaitlist(st?.waitlist);
          if (live && st) setInvite((v) => ({ required: st.required, signedIn: st.signedIn, left: leftOf(st), ...(v?.error ? { error: v.error } : {}) }));
          if (live) setInviteChecked(true);
          return;
        }
      }
      const st = await Promise.resolve().then(() => api.inviteStatus()).catch(() => null);
      noteWaitlist(st?.waitlist);
      // A code carried by the link may land first: a status read before it never undoes it.
      if (live && st) setInvite((v) => (v?.signedIn ? { ...v, required: st.required, left: leftOf(st) } : { required: st.required, signedIn: st.signedIn, left: leftOf(st), ...(v?.error ? { error: v.error } : {}) }));
      if (live) setInviteChecked(true);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const submitInvite = async (e: FormEvent) => {
    e.preventDefault();
    // Whatever was pasted stays in its box: the code only opens the door.
    const ok = await useCode(inviteCode.trim());
    if (ok && code.trim() !== "") void read(code, lang === "auto" ? undefined : lang);
    else if (ok) {
      // R10 review (D72): a code entered with no file pasted (a judge, first thing) goes back to the example, now on their own budget.
      autoExample.current = true;
      setOwnOpen(false);
      autoBet.current = null;
      void read(U1_EXAMPLE, "ts");
    }
  };
  // D60: paste anywhere on the first screen draws at once. R7: the first screen is the example, so pasting there draws your code too.
  const onExample = pasted !== null && readText === U1_EXAMPLE;
  useEffect(() => {
    if (pasted && !(onExample && !(sealed.length > 0 && !result))) return;
    const onDocPaste = (e: globalThis.ClipboardEvent) => {
      if (offScreen()) return;
      // R7 review B1: pasted code goes to Meta's AI at once, so paste-anywhere works only while the consent line is on the page.
      if (![...document.querySelectorAll<HTMLElement>('[data-testid="e-consent"]')].some((c) => c.offsetParent !== null)) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      const text = e.clipboardData?.getData("text") ?? "";
      if (text.trim() === "") return;
      e.preventDefault();
      if (locked) {
        // R10 (D72): their own code needs a code: the paste box opens with their text in it and the invite line.
        tryOwn();
        setCode(text);
        return;
      }
      setCode(text);
      void read(text, lang === "auto" ? undefined : lang);
    };
    document.addEventListener("paste", onDocPaste);
    return () => document.removeEventListener("paste", onDocPaste);
  });

  // R7 (D69): the first screen is the example, drawn, with its one question ready. Once per page: "Try your own code" never brings it back by itself.
  useEffect(() => {
    // R10 (D72): with or without an invite code: the example needs none.
    if (autoExample.current || pasted || busy !== null || handoff || !inviteChecked || ownOpen) return;
    autoExample.current = true;
    void read(U1_EXAMPLE, "ts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteChecked, pasted, handoff, ownOpen]);
  const tryOwn = () => {
    // reset() starts a new round, so an example still being read or bet on is dropped when it answers.
    reset();
    setBusy(null);
    setPasted(null);
    setCode("");
    setFn(null);
    setOpen(false);
    setOwnOpen(true);
    autoExample.current = true;
  };
  const backToExample = () => {
    setCode("");
    setOwnOpen(false);
    autoBet.current = null;
    void read(U1_EXAMPLE, "ts");
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    // The drawing comes first: pasted code is read at once (no button to press).
    const text = e.clipboardData.getData("text");
    if (text.trim() === "" || code.trim() !== "") return;
    e.preventDefault();
    setCode(text);
    if (!locked) void read(text, lang === "auto" ? undefined : lang);
  };

  // ---- the bet pop-up ----
  const start = async (make: () => Promise<ExperimentAnswer>, o: { keepAnswers?: boolean } = {}) => {
    const g = gen.current;
    setBusy("Getting the questions ready…");
    setError(null);
    try {
      const out = await make();
      if (g !== gen.current) return;
      setExp(out);
      // R3: answers belong to one test, and a value typed for one can never seal on another.
      if (!o.keepAnswers) {
        setPicked({});
        setTyped({});
        setConfidence(null);
        setStep(0);
      }
      if (changeTest.current !== null && canonicalTest(out.experiment.params) !== changeTest.current) {
        changeTest.current = null;
        setBeforeChange(null);
        setHandoffNote(null);
      }
      setRepeatNote(out.repeatOf ? PASTE_WORDS.repeatNote(out.repeatOf) : null);
      setChanging(false);
      setForm(null);
      models.fromExperiment(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  /**
   * The same test, asked again: a change of who bets (review m7), or R7's one question / every question. Every bettor is asked
   * again on the new text (D19), so it is a paid step, said beside the control. Your answers stay where they still apply.
   */
  const askAgain = (o: { claimant?: ClaimantMode; one?: boolean }) => {
    if (!exp || !target || needsCode()) return;
    const savedPicked = picked;
    const savedTyped = typed;
    const savedStep = step;
    const savedSure = confidence;
    const savedBefore = beforeChange;
    const savedNote = handoffNote;
    const savedTest = changeTest.current;
    const keep = proposals;
    if (o.claimant) onClaimant(o.claimant);
    const one = o.one ?? oneMode;
    if (o.one !== undefined) setOneMode(o.one);
    const same = (keep?.proposals ?? []).find((p) => p.gate.allowed && JSON.stringify(p.params) === JSON.stringify(exp.experiment.params));
    const params = exp.experiment.params;
    const editedFrom = exp.experiment.proposedBy.editedFrom?.proposalId;
    const byWonder = exp.experiment.proposedBy.role === "investigator";
    reset();
    setOpen(true);
    setPicked(savedPicked);
    setTyped(savedTyped);
    setStep(o.one === undefined ? savedStep : 0);
    setConfidence(savedSure);
    setBeforeChange(savedBefore);
    setHandoffNote(savedNote);
    changeTest.current = savedTest;
    if (same && byWonder) void start(() => api.experimentFromProposal(target, same.id, quizOpts(one)), { keepAnswers: true });
    else void start(() => api.experiment(target, params, undefined, editedFrom, quizOpts(one)), { keepAnswers: true });
    setProposals(keep);
  };
  const openBet = async () => {
    const next = !open;
    setOpen(next);
    if (next && proposals && !exp) setChanging(true); // proposals came back but no test is in use: show the list
    if (!next || !target || !fn || exp || proposals || wonderWait) return;
    await askWonder({ pick: "default" });
  };
  // R7 (D69): on the example, the bet opens by itself on Atlas's default test, once its names (R9: and its summary) are in (so the bettors' text and the
  // drawing carry the same names, D19). Its tests and the AIs' answers are recorded, so this spends nothing (server/example-round.ts).
  const namesIn = (!api.names || (pasted !== null && natural !== null && natural.sha === pasted.target.codeSha256)) && (!api.summary || (pasted !== null && summ !== null && summ.sha === pasted.target.codeSha256));
  useEffect(() => {
    if (!onExample || !target || !fn || open || exp || proposals || wonderWait || result || !namesIn || pasted?.cantCheck) return;
    if (autoBet.current === target.codeSha256) return;
    autoBet.current = target.codeSha256;
    void openBet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExample, target?.codeSha256, fn, namesIn, exp, proposals]);
  const chooseFunction = (name: string) => {
    if (sealed.length > 0) return;
    reset();
    setOpen(false); // the next "Bet on your understanding" asks Wonder about the new function
    setFn(name);
  };

  const seal = async (sure: Confidence | null = confidence) => {
    if (!exp) return;
    setBusy("Sealing your answers…");
    setError(null);
    try {
      const lang = exp.experiment.target.language;
      const out = answersToSend(exp.questions, picked, typed, lang);
      setSealed(await api.bets(exp.experiment.id, out.answers, sure));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // After sealing: wait for the models' sealed answers, then run (no extra click).
  useEffect(() => {
    if (!exp || sealed.length === 0 || result || models.thinking || runStarted.current) return;
    runStarted.current = true;
    const g = gen.current;
    setBusy("Running the test…");
    api.run(exp.experiment.id).then(
      async (r) => {
        if (g !== gen.current) return;
        ranCodes.current.add(`${codeFingerprint(readText, pasted?.target.language ?? undefined)}|${canonicalTest(exp.experiment.params)}`);
        // R3: the third run started when the sealed runs ended. The verdict never waits for it. Its steps join the drawing when they come, and a page without them still
        // shows everything that was measured.
        void Promise.race<HelperAnswer | null>([
          Promise.resolve()
            .then(() => api.helpers(r.run.id))
            .catch(() => null),
          new Promise<HelperAnswer>((done) => setTimeout(() => done({ none: HELPER_TOO_SLOW }), HELPER_WAIT_MS)),
        ]).then((steps) => {
          if (g === gen.current) {
            setHelpers(steps);
            setHelpersIn(true);
          }
        });
        // These notes were about the moment before the run. They would be false now.
        setHandoffNote(null);
        setRepeatNote(null);
        models.fromRun(r);
        setResult(r);
        // The tests of a set whose sentence is shown can no longer be used, and the answer is not to be reused.
        early.current.delete(`${exp.experiment.target.codeSha256}|${fn}`);
        setPlays((n) => n + 1);
        setOpen(false);
        setBusy(null);
      },
      (e: Error) => {
        if (g !== gen.current) return;
        runStarted.current = false;
        setBusy(null);
        setError(didNotFinish(e) ? `The run did not finish: ${e.message}` : e.message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp, sealed, result, models.thinking, runTry, claimRound]);

  // U3 item 5 + R7 (D69): Wonder's sentence is asked for only when "More" is opened after the run. Until then the other tests of its set
  // stay usable, so "Try another question" needs no new test. A "Test this claim" round shows the sentence it tested, not a new one.
  const claimAsked = useRef<string | null>(null);
  useEffect(() => {
    if (!more || !result || !exp || claimRound || claimAsked.current === exp.experiment.id) return;
    if (!(exp.experiment.proposedBy.role === "investigator" || exp.experiment.proposedBy.editedFrom)) return;
    claimAsked.current = exp.experiment.id;
    const g = gen.current;
    api.claim(exp.experiment.id).then((c) => g === gen.current && setClaim(c.claim), () => g === gen.current && setClaim(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more, result, exp, claimRound]);
  // R7 (D69): "Try another question": the next test of this set that has not run here, one question, the same for every bettor. With none, the list.
  const tryAnother = () => {
    if (needsCode()) return;
    const keep = proposals;
    const next = claim === null ? (keep?.proposals ?? []).find((p) => p.gate.allowed && !alreadyRan(p.params)) : undefined;
    if (!next || !target) {
      setPicking(true);
      return;
    }
    reset();
    setProposals(keep);
    setOpen(true);
    void start(() => api.experimentFromProposal(target, next.id, quizOpts()));
  };
  // Which bettor's answer was recorded, and on what day (server/example-round.ts): the result must say so.
  const recordedBy = useMemo(() => Object.fromEntries(models.slots.flatMap((s) => (s.recorded ? [[s.who, s.recorded]] : []))) as Record<string, string>, [models.slots]);

  const after: After | null = useMemo(() => {
    // D47: run data only after the bets are sealed, and only the run of THIS round's test (review M1).
    if (!result || !exp || !test || sealed.length === 0 || result.run.experimentId !== exp.experiment.id) return null;
    const tested = model?.tested ?? null;
    const callers = Object.fromEntries(Object.entries(model?.parts ?? {}).flatMap(([id, p]) => (p.kind === "device" ? [[id, (p.calledBy ?? []).map((c) => c.part)]] : [])));
    const language = pasted?.target.language ?? pasted?.language.chosen;
    const wiring = pasted?.outline ? { outline: pasted.outline, callers, ...(language ? { language } : {}) } : undefined;
    return { token: plays, script: playScript(result.run, test, tested, pasted?.outline ? waitingPartsOf(pasted.outline) : [], wiring), marks: marksOf(exp.questions, result.bets, result.verdicts, result.run, tested, language), absent: absentBettors(models.slots.filter((s) => s.status !== "off"), result.bets), helpersPending: !helpersIn, dialFullMs: fullMs, ...(helpers ? { helpers } : {}), run: result.run, experiment: exp.experiment, bets: result.bets, verdicts: result.verdicts };
  }, [result, exp, test, sealed, plays, model, fullMs, readText, pasted, helpers, helpersIn, models.slots]);

  // U2 (D53, "Test this claim"): Muse Wonder writes tests aimed at its own sentence (shown only after this run, D18); the gate
  // checks them as usual. R3: the round opens only on a test that is really different from what has already run here, compared
  // whatever order its keys came in. The same test again would show its answer. With nothing new, the button goes away.
  const testClaim = async () => {
    if (!target || !fn || !exp || !claim || needsCode()) return;
    const g = gen.current;
    const from = exp.experiment.id;
    const sentence = claim;
    setClaimAsking(true);
    setError(null);
    try {
      const p = await api.proposals(target, fn, { claimOf: from });
      if (g !== gen.current) return;
      const lang = pasted?.target.language ?? pasted?.language.chosen;
      const fresh = p.proposals.filter((x) => x.gate.allowed && !alreadyRan(x.params));
      const first = claimProposal(fresh, lang ? { source: readText, language: lang } : undefined);
      if (!first) {
        setClaimNoNew(true);
        return;
      }
      const lastParams = exp.experiment.params;
      const lastEnding = result ? (endingFacts(result.run, lang)?.what ?? null) : null;
      reset();
      setClaimRound({ sentence, closeness: whatDiffers(first.params, lastParams), lastEnding });
      setProposals(p);
      setOpen(true);
      await start(() => api.experimentFromProposal(target, first.id, quizOpts()));
    } catch (e) {
      if (g === gen.current) setError((e as Error).message);
    } finally {
      setClaimAsking(false);
    }
  };
  // R3: the same test on changed code, judged the same way: the bets are sealed first, then the two runs.
  const changeAndBet = async () => {
    if (editing === null || !exp || needsCode()) return;
    const params = exp.experiment.params;
    const language = pasted?.target.language ?? undefined;
    const want = fn ?? undefined;
    const text = editing;
    setCode(text);
    // What the last run did, for "before" and "after" once the changed code has run. Measured facts only.
    const before = result && notShownAsFact(result.run) === null ? runEnding(result.run, language) : null;
    // D63: this round already has its test, so Wonder is not asked for one.
    skipEarly.current = true;
    const r = await read(text, language, want);
    if (!r?.runnable || (want && !r.exports.some((x) => x.name === want))) {
      skipEarly.current = false;
      return;
    }
    changeTest.current = canonicalTest(params);
    // What the note says must match what the bettors are told (D19): the server knows when this exact code and test already ran.
    const seen = ranCodes.current.has(`${codeFingerprint(text, language)}|${canonicalTest(params)}`);
    setOpen(true);
    setBeforeChange(before);
    await start(async () => {
      const out = await api.experiment(r.target, params, undefined, undefined, quizOpts());
      setHandoffNote(out.repeatOf ? null : seen ? CHANGE_WORDS.sameCode : CHANGE_WORDS.sameTest);
      return out;
    });
  };
  const anotherTest = async () => {
    if (needsCode()) return;
    reset();
    setOpen(true);
    if (!target || !fn) return;
    setChanging(true);
    await askWonder({ pick: "list" });
  };
  // The result is the payoff: when it arrives the code panel closes, once, whatever the width. C opens it again.
  const resultRunId = result?.run.id;
  useEffect(() => {
    if (resultRunId) setDrawer((d) => (d === null ? d : false));
  }, [resultRunId]);
  // R6: a part panel belongs to one file and one run: a new one of either closes it.
  const fileSha = pasted?.target.codeSha256;
  useEffect(() => setPartId(null), [fileSha, resultRunId]);
  // The bet button shows Enter: so when the drawing comes up, the keys go to it (unless something else already has them).
  const toggleFor = pasted && fn && !exp && !result ? `${pasted.target.codeSha256}|${fn}` : null;
  useEffect(() => {
    if (!toggleFor) return;
    const t = document.activeElement;
    if (t === null || t === document.body || t.closest?.(".u1-head, header")) document.querySelector<HTMLElement>('[data-testid="u1-bet-toggle"]')?.focus({ preventScroll: true });
  }, [toggleFor]);
  // The result column's end must clear the pinned action bar: its real height, whatever wraps.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('[data-testid="u1-actions"]');
    if (!bar || typeof ResizeObserver !== "function") return;
    const set = () => document.documentElement.style.setProperty("--actions-h", `${bar.offsetHeight}px`);
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    set();
    return () => ro.disconnect();
  });
  // An error on the first screen can land below a short window: it comes into view.
  useEffect(() => {
    if (error) document.querySelector('.e-left [role="alert"]')?.scrollIntoView({ block: "nearest" });
  }, [error]);
  // D60: when the questions arrive, the keys belong to them, not to the button that opened the bet.
  const expId = exp?.experiment.id;
  useEffect(() => {
    if (expId && open) document.querySelector<HTMLElement>('[data-testid="u1-pop"]')?.focus({ preventScroll: true });
  }, [expId, open]);
  // D60: the bet's keys: 1 to 9 answer the question showing, the left arrow goes back, Enter seals on the last step.
  // Round 4: keys and typing are separate. The box never takes the keys by itself: it is clicked, or T opens it, and Esc leaves it. A digit
  // with no option of its own, on a question with an empty box, starts the typed value instead of being lost.
  useEffect(() => {
    if (!exp || !open || sealed.length > 0 || changing) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (offScreen() || e.metaKey || e.ctrlKey || e.altKey || e.repeat || t?.closest?.("input, textarea, select")) return;
      // R6: while a part panel covers the questions, the bet's keys answer nothing.
      if (document.querySelector('[data-testid="part-panel"]')) return;
      // R7: one question stays on screen; Enter locks the bet once it has an answer.
      const single = exp.questions.length === 1;
      // R7 review minor 3: Enter also locks it from the answer already picked (Tab to it, Space, Enter). On an answer not picked yet, Enter picks it.
      const onPickedAnswer = t?.matches?.('.u1-opt[aria-checked="true"]') === true;
      if (single && e.key === "Enter" && (onPickedAnswer || !t?.closest?.("button, a, summary")) && busy === null) {
        const q = exp.questions[0]!;
        if ((picked[q.measures] ?? "") !== "" || (typed[q.measures] ?? "").trim() !== "") {
          e.preventDefault();
          void seal();
        }
        return;
      }
      if (single && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (e.key === "ArrowLeft") {
        setStep((n) => Math.max(0, n - 1));
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setStep((n) => Math.min(exp.questions.length, n + 1));
        e.preventDefault();
      } else if (e.key === "Enter" && step >= exp.questions.length && !t?.closest?.("button, a, summary") && busy === null) {
        e.preventDefault();
        void seal();
      } else if (/^[1-9]$/.test(e.key) && step < exp.questions.length) {
        const q = exp.questions[step]!;
        const ids = [...(q.quiz ?? []).map((o) => o.id), CANT_TELL];
        const id = ids[Number(e.key) - 1];
        e.preventDefault();
        if (id !== undefined) document.querySelector<HTMLElement>(`[data-testid="opt-${q.measures}-${id}"]`)?.click();
        else if (q.allowsTyped && (typed[q.measures] ?? "") === "") {
          setTyped((v) => ({ ...v, [q.measures]: e.key }));
          document.getElementById(`typed-${q.measures}`)?.focus({ preventScroll: true });
        }
      } else if (e.key.toLowerCase() === "t" && step < exp.questions.length && exp.questions[step]!.allowsTyped) {
        e.preventDefault();
        document.getElementById(`typed-${exp.questions[step]!.measures}`)?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // D60: the keys. Never while typing, and never with a modifier. The bet's own keys live in the bet.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (offScreen() || e.metaKey || e.ctrlKey || e.altKey || t?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") {
        // Only the top-most thing closes: a panel, then a pinned card (the stage closes that one), then the code panel.
        if (editing !== null || proofOpen || picking) {
          setEditing(null);
          setProofOpen(false);
          setPicking(false);
        } else if (!e.defaultPrevented) {
          setDrawer(false);
          setPartId(null);
        }
        return;
      }
      // R7: a key never opens what its control hides: C only while "Details" shows the Code button.
      if (e.key.toLowerCase() === "c" && pasted && details) {
        setPartId(null);
        setDrawer((d) => !(d ?? (wide && open && exp !== null && !result && !machineFirst())));
        e.preventDefault();
        return;
      }
      // Enter opens the bet, a paid step, only when nothing that takes keys has focus: a part or a box has its own Enter.
      if (e.key === "Enter" && !e.repeat && !e.defaultPrevented && (t === document.body || t === document.documentElement || t === null) && pasted && fn && !pasted.cantCheck && pasted.runnable && !result && !open && !exp && !proposals) {
        e.preventDefault();
        void openBet();
        return;
      }
      // Only once the verdict has landed and nothing is playing. While a run plays, keys only skip.
      if (!result || played === 0 || e.repeat || document.querySelector('[data-testid="bench-stage"][data-phase="playing"]')) return;
      const k = e.key.toLowerCase();
      const unshown = notShownAsFact(result.run) !== null;
      // R7: R, B and E belong to controls under "More"; they answer only while it is open. P is the visible "Share proof card".
      if (k === "r" && !unshown && more) setPlays((n) => n + 1);
      else if (k === "b" && more) setPicking(true);
      else if (k === "p" && result.proof?.ok && !unshown) setProofOpen((o) => !o);
      else if (k === "e" && exp && more) setEditing((x) => (x === null ? readText : null));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const nextTries = (labels?.labels ?? []).filter((l) => l.label === "found in this code" || l.label === "reproduced");

  // ---- entry ----
  // R7 (D69): this shows while the example is being read, behind an invite, or after "Try your own code". The paste box, Upload and
  // GitHub stay in the fine print until asked for.
  if (!pasted) {
    // R10 (D72): the example plays with no code, so the paste box shows only when asked for.
    const ownBox = ownOpen;
    return (
      <section className="u1-entry" aria-labelledby="u1-entry-h" data-testid="u1-entry" data-own={ownBox ? "" : undefined}>
        <div className="e-left">
        <h1 id="u1-entry-h">{SIMPLE_WORDS.headline}</h1>
        {ownBox && <p className="u1-lede">Paste a file and Atlas draws it as a machine. Bet on what it will do. Meta's AI bets too, then Atlas runs it in a sandbox and shows whose bet matched.</p>}
        {ownBox && locked && invite && (
          <p className="e-needs-code" data-testid="e-needs-code">
            {OWN_CODE_LINE} <InviteLinks />
          </p>
        )}
        {ownBox && locked && invite && (
          <form className="e-invite" onSubmit={(e) => void submitInvite(e)} data-testid="e-invite">
            <label htmlFor="e-invite-code">Your invite code</label>
            <div className="e-invite-row">
              <input id="e-invite-code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} autoComplete="off" spellCheck={false} data-testid="e-invite-code" />
              <button type="submit" className="u1-btn" disabled={inviteCode.trim() === "" || invite.busy === true} data-testid="e-invite-go">
                Use this code
              </button>
            </div>
            {invite.error && <p className="e-invite-error" role="alert" data-testid="e-invite-error">{invite.error}</p>}
          </form>
        )}
        {busy && (
          <p className="u1-status" role="status">
            {busy}
          </p>
        )}
        {error && <ErrorNotice message={error} />}
        {ownBox && (
          <div className="e-own" data-testid="e-own">
            <span className="u1-sub e-or">Paste your own file anywhere on this page, or here:</span>
            <label htmlFor="u1-code" className="u1-sr">
              Your code
            </label>
            <textarea
              id="u1-code"
              className="u1-code"
              data-testid="u1-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onPaste={onPaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && code.trim() !== "" && !locked) {
                  e.preventDefault();
                  void read(code, lang === "auto" ? undefined : lang);
                }
              }}
              placeholder="Paste a JavaScript, TypeScript or Python file here"
              spellCheck={false}
            />
            <div className="u1-entry-row">
              <button type="button" className="u1-btn u1-primary" onClick={() => read(code, lang === "auto" ? undefined : lang)} disabled={busy !== null || code.trim() === "" || locked} data-testid="u1-draw">
                Draw my code
                <kbd className="k">⌘↵</kbd>
              </button>
              {/* The language is guessed. The choice appears only if a guess did not work. */}
              {error && (
                <Segments label="Language" value={lang} onChange={(v) => setLang(v as Lang | "auto")} testid="u1-lang" options={[["auto", "Guess the language"], ["ts", "TypeScript"], ["js", "JavaScript"], ["py", "Python"]]} />
              )}
            </div>
            {/* R9: one-click sample files for anyone with no file at hand. The normal paste flow: same consent line, same paid calls. */}
            <div className="e-samples" data-testid="e-samples">
              <span className="u1-sub">{SAMPLE_WORDS.heading}</span>
              <ul>
                {SAMPLE_FILES.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="u1-btn"
                      disabled={busy !== null || locked}
                      data-testid={`e-sample-${f.id}`}
                      onClick={() => {
                        setCode(f.code);
                        void read(f.code, f.language);
                      }}
                    >
                      {f.label}
                    </button>
                    <span className="u1-sub">{SAMPLE_WORDS.about(f)}</span>
                  </li>
                ))}
              </ul>
              <span className="u1-sub" data-testid="e-samples-consent">{SAMPLE_WORDS.consent}</span>
            </div>
            <div className="u1-entry-or">
              <label className="u1-file">
                <span>Upload files</span>
                <input
                  type="file"
                  multiple
                  accept=".js,.mjs,.cjs,.jsx,.ts,.tsx,.mts,.cts,.py,.json"
                  data-testid="u1-upload"
                  onChange={async (e) => {
                    const list = e.target.files;
                    if (!list || list.length === 0) return;
                    if (list.length === 1) {
                      const text = await list[0]!.text();
                      setCode(text);
                      void read(text, /\.py$/.test(list[0]!.name) ? "py" : /\.(m|c)?jsx?$/.test(list[0]!.name) ? "js" : /\.(m|c)?tsx?$/.test(list[0]!.name) ? "ts" : undefined);
                    } else onExplore({ files: list });
                  }}
                />
              </label>
              <form
                className="u1-gh"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (repo.trim() !== "") onExplore({ repo: repo.trim() });
                }}
              >
                <label htmlFor="u1-repo">Or a GitHub repo</label>
                <input id="u1-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" data-testid="u1-repo" />
                <button type="submit" className="u1-btn" disabled={repo.trim() === ""}>
                  Draw the repo (a paid AI call)
                </button>
              </form>
            </div>
          </div>
        )}
        <div className="u1-fine" data-testid="u1-fine">
          {/* PLACEHOLDER: Dami's final words go here. The fact it must keep: pasted code goes to a paid model at once, before any other click. */}
          <p className="e-consent" data-testid="e-consent">{CONSENT_LINE}</p>
          <p className="u1-fine-links">
            {!ownBox && (
              <button type="button" className="u1-link" onClick={tryOwn} data-testid="u1-own">
                {SIMPLE_WORDS.tryOwn}
              </button>
            )}
            {ownBox && (
              <button type="button" className="u1-link" onClick={backToExample} disabled={busy !== null} data-testid="u1-example">
                {SIMPLE_WORDS.tryExample}
              </button>
            )}
          </p>
          {remember?.last && <p className="u1-remember" data-testid="remember-last">{remember.last}</p>}
        </div>
        </div>
        <ExampleDrawing />
      </section>
    );
  }

  // ---- the drawing ----
  // Beside the machine, the code panel opens only when asked (the Code button, C or a click): it would squeeze the machine under its reading size.
  const drawerOpen = drawerChoice ?? (wide && open && exp !== null && !after && !machineFirst());
  // Before a run the panel is the code drawer; once a result is up it sits under the verdict instead (BenchStage), so it never covers the result.
  // The layout follows the part's id at once; its words follow one render later. Deciding the layout from the words briefly squeezed the machine.
  // R7 (D69): "Details" holds the code panel, the new-code link and the paid-call lines. The box chart's switch shows on the drawing while it is open.
  const detailsFold = (
    <details className="u1-more u1-details" open={details} data-testid="u1-details">
      {/* Opened by the page's own state (not the toggle event), so the screen and the keys always agree on what is shown. */}
      <summary aria-label="Details: the code, the box chart and what costs money" onClick={(e) => { e.preventDefault(); setDetails((d) => !d); }}>ⓘ {SIMPLE_WORDS.details}</summary>
      <div className="u1-more-body">
        <div className="u1-linkrow">
          <button
            type="button"
            className="u1-link u1-code-toggle"
            aria-pressed={drawerOpen}
            onClick={() => {
              setPartId(null);
              setDrawer(!drawerOpen);
            }}
            data-testid="u1-code-toggle"
          >
            Code
            <kbd className="k">C</kbd>
          </button>
          <button type="button" className="u1-link" onClick={tryOwn} data-testid="u1-new">
            New code
          </button>
        </div>
        <p className="u1-sub">The box chart switch is on the drawing (M).</p>
        <p className="u1-sub u1-paid" data-testid="u1-paid-bet">{earlyState === "busy" ? CHANGE_WORDS.earlyWonder : earlyState === "done" ? CHANGE_WORDS.earlyDone : CHANGE_WORDS.paidWonder}</p>
        <p className="u1-sub u1-paid">{CHANGE_WORDS.paidBets}</p>
        {after && <p className="u1-sub u1-paid" data-testid="u1-paid-another">{SIMPLE_WORDS.anotherPaid}</p>}
      </div>
    </details>
  );
  const partMode = drawerOpen && partId !== null && !after;
  const partShown = partMode && partPanel?.id === partId ? partPanel : null;
  const noFunction = pasted.runnable && !fn && pasted.outline !== undefined;
  // A language Atlas doesn't read: one message, the one that says so. "Needs a package" would be about a JavaScript reading of it.
  const foreign = pasted.outline?.parts.length === 0 ? foreignLanguage(readText) : null;
  const notRunnable = !pasted.runnable ? (pasted.reason ?? "Atlas cannot run this language here yet.") : pasted.cantCheck;
  const allowed = proposals?.proposals.filter((p) => p.gate.allowed) ?? [];
  const chosenSays = exp ? allowed.find((p) => p.params && JSON.stringify(p.params) === JSON.stringify(exp.experiment.params))?.says : undefined;
  // J5: this code has already run here, on some test: the top bar must not say nothing has run.
  const fingerprint = `${codeFingerprint(readText, pasted.target.language ?? undefined)}|`;
  const codeRanHere = [...ranCodes.current].some((k) => k.startsWith(fingerprint));
  // D66: the count that moved. Once, at the verdict, for this person only.
  const leadMeasures = after ? momentOf(after.marks, after.run, pasted.target.language ?? undefined)?.measures : null;
  const leadType = leadMeasures ? questionTypeOf(leadMeasures) : null;
  const loopLine = result?.track && !("error" in result.track) ? countChange(result.track.before, result.track.after, leadType) : null;
  // C4: a run Atlas could not check has nothing to play and no card to show, so neither is offered.
  const nothingShown = result !== null && notShownAsFact(result.run) !== null;
  const offeredTests = (proposals?.proposals ?? []).filter((p) => p.gate.allowed && !alreadyRan(p.params));
  const title = `${source ?? (pasted.outline?.parts.length === 0 ? "pasted file" : FILE_NAME[pasted.target.language ?? "ts"])} · ${plural(pasted.lines, "line")}${drawnMs !== null ? ` · drawn in ${drawnMs} ms` : ""}`;
  return (
    <div className="u1-studio" data-drawer={drawerOpen && !partMode ? "" : undefined} data-drawer-part={partMode ? "" : undefined} data-simple="">
      {shownModel && pasted.outline ? (
        <BenchStage
          wontRun={Boolean(notRunnable)}
          model={shownModel}
          source={readText}
          language={pasted.target.language ?? pasted.language.chosen ?? "ts"}
          outline={pasted.outline}
          fileName={pasted.outline.parts.length === 0 ? "pasted file" : FILE_NAME[pasted.target.language ?? "ts"]}
          after={after}
          loop={more ? loopLine : null}
          viewToggle={details}
          traceNote={more}
          recorded={recordedBy}
          seenBefore={repeatNote !== null || handoffNote === CHANGE_WORDS.sameCode}
          codeRan={codeRanHere}
          extraMarks={labelMarks}
          title={title}
          side={open}
          onPlayed={() => setPlayed((n) => n + 1)}
          picked={partId}
          onPanel={setPartPanel}
          onClosePart={() => setPartId(null)}
          naturalNames={natural && natural.sha === pasted.target.codeSha256 && "names" in natural ? natural.names : null}
          namesNote={natural && natural.sha === pasted.target.codeSha256 && "reason" in natural ? natural.reason : null}
          fileSummary={!after && summ && summ.sha === pasted.target.codeSha256 && "summary" in summ ? summ.summary : null}
          partLines={summ && summ.sha === pasted.target.codeSha256 && "summary" in summ ? summ.summary.parts : null}
          summaryMissing={Boolean(summ && summ.sha === pasted.target.codeSha256 && "reason" in summ && !/asks no Meta model|no parts|could not list the parts/.test(summ.reason))}
          onPart={(name, panel) => {
            const part = pasted.outline?.parts.find((p) => p.name === name);
            if (!part && !panel) return;
            setDrawerLines(panel ? panel.lines : [part!.lineStart, part!.lineEnd]);
            setPartId(panel ? name : null);
            // After a run the panel opens under the verdict, not as a drawer: C still shows the code at these lines.
            if (!after) setDrawer(true);
          }}
          headnote={
            // R7 (D69): the round's extra lines (before and after a change, how sure, a claim's facts) are under "More".
            after && result ? (
              <>
                {/* R7 review: "More"'s buttons sit at the top of the result column, so the pinned bar stays short. In the page while folded (hidden), as before. */}
                <div className="u1-more-body u1-linkrow u1-more-actions" data-testid="u1-more-actions" hidden={!more}>
                  {exp && (
                    <button type="button" className="u1-btn" onClick={() => setEditing((t) => (t === null ? readText : null))} aria-expanded={editing !== null} data-testid="u1-change">
                      {CHANGE_WORDS.open}
                      <kbd className="k">E</kbd>
                    </button>
                  )}
                  <button type="button" className="u1-btn" onClick={() => setPicking(true)} data-testid="u1-again">
                    Bet on another test
                    <kbd className="k">B</kbd>
                  </button>
                  {!nothingShown && (
                    <button type="button" className="u1-btn u1-quiet" onClick={() => setPlays((n) => n + 1)} disabled={played === 0} data-testid="u1-replay">
                      {played === 0 ? STAGE_WORDS.playing : STAGE_WORDS.playAgain}
                      <kbd className="k">R</kbd>
                    </button>
                  )}
                  <span className="u1-sub u1-paid" data-testid="u1-paid-again">{CHANGE_WORDS.paidAgain}</span>
                </div>
                {more && (
                <>

                {beforeChange && notShownAsFact(result.run) === null && (
                  <p className="b-beforeafter" data-testid="u1-before-after">
                    <span className="m-k">Before your change</span>
                    <span>{beforeChange}</span>
                    <span className="m-k">After</span>
                    <span>{runEnding(result.run, pasted?.target.language ?? undefined) ?? "not measured"}</span>
                  </p>
                )}
                <FeltRoundLine bets={result.bets} verdicts={result.verdicts} />
                {claimRound && <ClaimFacts sentence={claimRound.sentence} marks={after.marks} reach={notShownAsFact(result.run) === null ? reachNote(result.run, claimRound.lastEnding ?? null, pasted?.target.language ?? undefined) : null} />}
                </>
                )}
              </>
            ) : null
          }
          footnote={
            !more ? null : <>
            {claimRound ? null : claim || nextTries.length ? (
              <>
                {claim && (
                  <div className="u1-claim" data-testid="u1-claim">
                    <p>
                      <span className="u1-k">{`${WONDER_DISPLAY} said, before the run:`}</span> <q>{claim}</q>
                    </p>
                    {claimNoNew ? (
                      <p className="u1-sub" data-testid="u1-claim-none">{CHANGE_WORDS.claimNoNew}</p>
                    ) : (
                      <>
                        <button type="button" className="u1-btn" onClick={testClaim} disabled={busy !== null || claimAsking} data-testid="u1-test-claim">
                          {claimAsking ? CHANGE_WORDS.claimAsking : RESULT_WORDS.testClaim}
                        </button>
                        <span className="u1-sub u1-paid" data-testid="u1-paid-claim">{CHANGE_WORDS.paidWonder}</span>
                      </>
                    )}
                  </div>
                )}
                {nextTries.length > 0 && (
                  <div className="u1-next" data-testid="u1-next">
                    <p className="u1-k">{RESULT_WORDS.nextTry}</p>
                    <ul>
                      {nextTries.map((l, i) => (
                        <li key={i}>{`${l.name}${l.lines?.[0] ? `, ${lineSpan(l.lines[0].lineStart, l.lines[0].lineEnd)}` : ""}`}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : null}
            {result?.track && ("error" in result.track ? <p className="u1-sub">{FELT_WORDS.recordNotSaved(result.track.error)}</p> : <FeltRecord record={result.track.after} />)}
            </>
          }
          {...(!sealed.length ? { onTestFunction: chooseFunction } : {})}
        >
          {after && (
            <div className="u1-actions" data-testid="u1-actions" data-simple="">
              {/* R7 (D69): one button, three text links; everything else under "More". */}
              {nothingShown ? null : result?.proof?.ok ? (
                <button type="button" className="u1-btn u1-primary" aria-expanded={proofOpen} onClick={() => setProofOpen((o) => !o)} data-testid="u1-proof">
                  {SIMPLE_WORDS.share}
                  <kbd className="k">P</kbd>
                </button>
              ) : result?.proof ? (
                <span className="u1-sub">{`No proof card: ${result.proof.ok ? "" : result.proof.reason}`}</span>
              ) : null}
              {/* R7 review B1: pasting here draws your code too, so the consent line is here too. */}
              <p className="u1-sub e-consent u1-consent-result" data-testid="e-consent">{CONSENT_LINE}</p>
              <p className="u1-textlinks">
                <button type="button" className="u1-link" onClick={tryAnother} disabled={busy !== null} data-testid="u1-try-another">
                  {SIMPLE_WORDS.tryAnother} <span className="u1-paid-tag">{SIMPLE_WORDS.paidTag}</span>
                </button>
                <button type="button" className="u1-link" onClick={tryOwn} data-testid="u1-own">
                  {SIMPLE_WORDS.tryOwn}
                </button>
                {onMoonwell && (
                  <button type="button" className="u1-link" onClick={onMoonwell} data-testid="u1-try-moonwell">
                    {SIMPLE_WORDS.tryMoonwell}
                  </button>
                )}
              </p>
              <details className="u1-more" open={more} data-testid="u1-result-more">
                <summary onClick={(e) => { e.preventDefault(); setMore((m) => !m); }}>{SIMPLE_WORDS.more}</summary>
              </details>
              {detailsFold}
            </div>
          )}
        </BenchStage>
      ) : null}
      {drawerOpen && (
        <CodeDrawer source={readText} lines={drawerLines} part={partShown} onClose={() => {
          setDrawer(false);
          setPartId(null);
        }} coversResult={after !== null && typeof window !== "undefined" && window.innerWidth >= 761 && (partShown !== null || window.innerWidth < 1800)} />
      )}
      {after && picking && (
        <section className="u1-proof u1-picking" role="dialog" aria-modal="false" aria-label={CHANGE_WORDS.pickTitle} data-testid="u1-pick-panel">
          <div className="u1-proof-head">
            <h2>{CHANGE_WORDS.pickTitle}</h2>
            <button type="button" className="u1-close" onClick={() => setPicking(false)} aria-label="Close and keep this result">
              ×
            </button>
          </div>
          <p className="u1-sub">{CHANGE_WORDS.pickKeeps}</p>
          {(claim !== null || offeredTests.length === 0) && <p className="u1-sub" data-testid="u1-pick-none">{claim !== null ? CHANGE_WORDS.pickUsed : proposals ? CHANGE_WORDS.noOtherRan : CHANGE_WORDS.noOtherYet}</p>}
          <ul className="u1-testlist" data-testid="u1-pick-list">
            {claim === null &&
              (proposals?.proposals ?? [])
                .filter((p) => p.gate.allowed && !alreadyRan(p.params))
                .map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.says}
                      {exp && <small className="b-differs" data-testid="u1-pick-differs">{whatDiffers(p.params, exp.experiment.params)}</small>}
                    </span>{" "}
                    <button
                      type="button"
                      className="u1-btn"
                      onClick={() => {
                        const keep = proposals;
                        reset();
                        setProposals(keep);
                        setOpen(true);
                        if (target) void start(() => api.experimentFromProposal(target, p.id, quizOpts()));
                      }}
                      data-testid={`u1-pick-${p.id}`}
                    >
                      Bet on this test
                    </button>
                  </li>
                ))}
          </ul>
          <div className="u1-entry-row">
            <button type="button" className="u1-btn" onClick={() => void anotherTest()} data-testid="u1-pick-ask">
              Ask Muse Wonder for a new test
            </button>
            <span className="u1-sub u1-paid">{CHANGE_WORDS.paidWonder}</span>
            <button
              type="button"
              className="u1-btn u1-quiet"
              onClick={() => {
                reset();
                setOpen(true);
                writeOwn();
              }}
              data-testid="u1-pick-own"
            >
              Write your own
            </button>
          </div>
        </section>
      )}
      {after && editing !== null && (
        <section className="u1-proof u1-changing" role="dialog" aria-modal="false" aria-label={CHANGE_WORDS.open} data-testid="u1-change-panel">
          <div className="u1-proof-head">
            <h2>{CHANGE_WORDS.open}</h2>
            <button type="button" className="u1-close" onClick={() => setEditing(null)} aria-label="Close without changing">
              ×
            </button>
          </div>
          <p className="u1-sub">{CHANGE_WORDS.explain}</p>
          <textarea className="u1-code" aria-label="Your code" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} data-testid="u1-change-code" />
          <div className="u1-entry-row">
            <button type="button" className="u1-btn u1-primary" onClick={() => void changeAndBet()} disabled={busy !== null || editing.trim() === "" || editing === readText} data-testid="u1-change-go">
              {CHANGE_WORDS.go}
            </button>
            <span className="u1-sub u1-paid" data-testid="u1-paid-change">{CHANGE_WORDS.paidBets}</span>
          </div>
        </section>
      )}
      {proofOpen && result?.proof?.ok && (
        <section className="u1-proof" role="dialog" aria-modal="false" aria-label={RESULT_WORDS.proofTitle} data-testid="u1-proof-panel">
          <div className="u1-proof-head">
            <h2>{RESULT_WORDS.proofTitle}</h2>
            <a className="u1-link" href={`?proof=${encodeURIComponent(result.proof.runId)}`}>
              Open on its own page
            </a>
            <button type="button" className="u1-close" onClick={() => setProofOpen(false)} aria-label={RESULT_WORDS.closeProof}>
              ×
            </button>
          </div>
          <ProofCardPage api={api} runId={result.proof.runId} embedded />
        </section>
      )}


      {(shownModel?.notShown || noFunction) && !exp && (
        <div className="e-dead" data-testid="u1-dead-end">
          <p data-testid="u1-nothing-why">{shownModel?.notShown ? (foreignLanguage(readText) ? CHANGE_WORDS.foreign(foreignLanguage(readText)!) : CHANGE_WORDS.nothingToDraw) : CHANGE_WORDS.nothingToCall}</p>
          <button
            type="button"
            className="u1-btn u1-primary"
            onClick={() => {
              reset();
              setPasted(null);
              setCode("");
              setFn(null);
              setOpen(false);
            }}
            data-testid="u1-dead-new"
          >
            Paste another file
          </button>
        </div>
      )}
      {repeatNote && !after && (
        <p className="u1-handoff u1-repeat" role="note" data-testid="repeat-note">
          {repeatNote}
        </p>
      )}
      {handoffNote && (
        <p className="u1-banner" role="note" data-testid="u1-handoff-note">
          {handoffNote}
        </p>
      )}
      {notRunnable && !foreign && (
        <p className="u1-banner" role="note" data-testid="u1-cant-run">
          {notRunnable}
        </p>
      )}
      {notRunnable && !foreign && !shownModel?.notShown && (
        <div className="u1-cant-next" data-testid="u1-cant-run-next">
          <p>The drawing is still true of this code. To bet on it, Atlas needs a file that runs on its own: take that dependency out, or paste another file.</p>
          <button
            type="button"
            className="u1-btn u1-primary"
            onClick={() => {
              reset();
              setPasted(null);
              setCode(readText);
              setFn(null);
              setOpen(false);
            }}
            data-testid="u1-cant-run-edit"
          >
            Edit this file
          </button>
        </div>
      )}

      {!notRunnable && fn && !after && (
        <div className="u1-bet">
          {/* R7 (D69): one button. Once the bet is open it is the screen, so there is no "Hide the bet". */}
          {!open && (
            <button type="button" className="u1-btn u1-primary u1-toggle" aria-expanded={open} aria-controls="u1-pop" onClick={openBet} data-testid="u1-bet-toggle">
              Bet on what it does
              <kbd className="k" aria-hidden="true">Enter</kbd>
            </button>
          )}
          {/* R7 review M2: a control that starts paid AI calls says so beside it. */}
          {!open && <span className="u1-sub u1-paid u1-paid-beside" data-testid="u1-paid-bet-beside">{earlyState === "busy" ? CHANGE_WORDS.earlyWonder : earlyState === "done" ? CHANGE_WORDS.earlyDone : CHANGE_WORDS.paidWonder}</span>}
          {!open && (
            <div className="u1-fine u1-fine-rest" data-testid="u1-fine">
              <p className="e-consent" data-testid="e-consent">{CONSENT_LINE}</p>
              <p className="u1-fine-links">
                <button type="button" className="u1-link" onClick={tryOwn} data-testid="u1-own">
                  {SIMPLE_WORDS.tryOwn}
                </button>
              </p>
              {detailsFold}
            </div>
          )}
          {open && (
            <section id="u1-pop" className="u1-pop" tabIndex={-1} aria-label="Bet on what it does" data-testid="u1-pop">
              {wonderWait && !exp && <WonderWaiting wait={wonderWait} fn={fn} onOwn={changing ? null : writeOwn} />}
              {!exp && !changing && busy && !wonderWait && (
                <p className="u1-status" role="status">
                  {busy}
                </p>
              )}
              {exp && !changing && (
                <>
                  {/* R7 (D69): the headline stays on the first screen, over the one question. */}
                  {onExample && sealed.length === 0 && <h1 className="u1-pop-h" data-testid="u1-pop-headline">{SIMPLE_WORDS.headline}</h1>}
                  {claimRound && (
                    <p className="u1-sub u1-claim-tested" data-testid="u1-claim-tested">
                      {RESULT_WORDS.testingSentence(claimRound.sentence)}
                      {claimRound.closeness && <small className="b-differs" data-testid="u1-claim-closeness">{claimRound.closeness}</small>}
                    </p>
                  )}
                  <p ref={testLine} className={`u1-test${wholeTest ? "" : " u1-test-clamp"}`} data-testid="u1-test">
                    <span className="u1-k">{BET_WORDS.testIs}</span> {chosenSays ?? (exp.experiment.params.shape === "call-function" ? describeCall(exp.experiment.params, exp.experiment.target.language) : "")}
                  </p>
                  {wholeTest && longValues(exp.experiment.params, exp.experiment.target.language ?? undefined).length > 0 && (
                    <ul className="u1-whole" data-testid="u1-whole-values">
                      {longValues(exp.experiment.params, exp.experiment.target.language ?? undefined).map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  )}
                  {(wholeTest || testCut || longValues(exp.experiment.params, exp.experiment.target.language ?? undefined).length > 0) && (
                    <div className="u1-testrow">
                      <button type="button" className="u1-link" aria-expanded={wholeTest} onClick={() => setWholeTest((w) => !w)} data-testid="u1-whole-test">
                        {wholeTest ? BET_WORDS.testShort : BET_WORDS.testWhole}
                      </button>
                    </div>
                  )}
                  {sealed.length === 0 && exp.questions.length > 1 && (
                    <div className="b-head" data-testid="b-head">
                      <button type="button" className="b-back" onClick={() => setStep((n) => Math.max(0, n - 1))} disabled={step === 0} aria-label="Back to the question before" data-testid="b-back">
                        ←
                      </button>
                      <span className="b-progress" data-testid="b-progress">{step < exp.questions.length ? `${step + 1} of ${exp.questions.length}` : `${exp.questions.length} of ${exp.questions.length}`}</span>
                      <span className="b-dots" aria-hidden="true">
                        {exp.questions.map((q, i) => (
                          <i key={q.measures} data-on={i <= step ? "" : undefined} />
                        ))}
                      </span>
                    </div>
                  )}
                  <ol className="u1-quiz" data-sealed={sealed.length > 0 ? "" : undefined} data-single={exp.questions.length === 1 ? "" : undefined}>
                    {exp.questions.map((q, qi) => (
                      <li key={q.measures} data-active={qi === step || exp.questions.length === 1 ? "" : undefined}>
                        <p className="u1-q" id={`q-${q.measures}`}>
                          {shortQuestionFor(q.text, exp.experiment.params, exp.experiment.target.language)}
                        </p>
                        <div className="u1-opts" role="radiogroup" aria-labelledby={`q-${q.measures}`}>
                          {[...(q.quiz ?? []).map((o) => ({ id: o.id, label: o.label })), { id: CANT_TELL, label: CANT_TELL }].map((o) => (
                            <button
                              type="button"
                              role="radio"
                              key={o.id}
                              className="u1-opt"
                              aria-checked={(typed[q.measures] ?? "").trim() === "" && (picked[q.measures] ?? "") === o.id}
                              disabled={sealed.length > 0 || busy !== null}
                              onClick={() => {
                                setPicked((p) => ({ ...p, [q.measures]: o.id }));
                                setTyped((t) => ({ ...t, [q.measures]: "" }));
                                // A moment to see the choice land, then the next question. R7: one question stays put, so the choice is seen.
                                if (exp.questions.length > 1) window.setTimeout(() => setStep((n) => (n === qi ? n + 1 : n)), 130);
                              }}
                              data-testid={`opt-${q.measures}-${o.id}`}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                        {q.allowsTyped && (
                          <TypedValue
                            id={`typed-${q.measures}`}
                            value={typed[q.measures] ?? ""}
                            {...(exp.experiment.target.language ? { language: exp.experiment.target.language } : {})}
                            disabled={sealed.length > 0 || busy !== null}
                            onChange={(v) => setTyped((t) => ({ ...t, [q.measures]: v }))}
                            onEnter={() => (exp.questions.length === 1 ? void seal() : setStep((n) => (n === qi ? n + 1 : n)))}
                          />
                        )}
                        {/* D66: the person's own counts, beside the question, never in it: every bettor reads the same question (D19). R7: fine print, under "More options". */}
                        {betMore && sealed.length === 0 && remember?.weakest && questionTypeOf(q.measures) === remember.weakest.type && <p className="u1-weakest" data-testid="remember-weakest">{weakestWords(remember.weakest)}</p>}
                      </li>
                    ))}
                  </ol>
                  {sealed.length === 0 && exp.questions.length > 1 && step >= exp.questions.length && (
                    <ol className="b-review" data-testid="b-review">
                      {exp.questions.map((q, qi) => {
                        const t = (typed[q.measures] ?? "").trim();
                        const read = t !== "" ? parseTyped(t, exp.experiment.target.language) : null;
                        const label = t !== "" ? literal(read ? read.value : t, exp.experiment.target.language) : (q.quiz ?? []).find((o) => o.id === picked[q.measures])?.label ?? CANT_TELL;
                        return (
                          <li key={q.measures}>
                            <button type="button" onClick={() => setStep(qi)} data-testid={`b-review-${qi}`}>
                              <span className="b-n">{qi + 1}</span>
                              <span className="b-a">{label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {sealed.length === 0 ? (
                    <div className="u1-sealbar" data-last={step >= exp.questions.length || exp.questions.length === 1 ? "" : undefined}>
                      <button type="button" className="u1-btn u1-primary" onClick={() => void seal()} disabled={busy !== null} data-testid="u1-seal">
                        {SIMPLE_WORDS.lock}
                        {(step >= exp.questions.length || exp.questions.length === 1) && <kbd className="k">↵</kbd>}
                      </button>
                      <AisLine slots={models.slots} />
                    </div>
                  ) : (
                    <>
                      <p className="u1-status" role="status" data-testid="u1-sealed">
                        {`${SIMPLE_WORDS.locked} ${confidence ? `${FELT_WORDS.sealedSaid(confidence)} ` : ""}${busy ?? (models.thinking ? "Waiting for the AIs to lock in theirs…" : "")}`}
                      </p>
                      <SealTags sealed={sealed} slots={models.slots} />
                    </>
                  )}
                  {sealed.length > 0 && !result && error && !busy && (
                    <button type="button" className="u1-btn" onClick={() => setRunTry((n) => n + 1)} data-testid="u1-run-again">
                      Run it again
                    </button>
                  )}
                  {pendingClaimant !== null && sealed.length === 0 && (
                    <div className="b-confirm" role="group" aria-label="Change who bets" data-testid="b-claimant-confirm">
                      <p>{CHANGE_WORDS.claimantAsks}</p>
                      <button
                        type="button"
                        className="u1-btn"
                        data-testid="b-claimant-yes"
                        onClick={() => pendingClaimant !== null && askAgain({ claimant: pendingClaimant })}
                      >
                        Ask them again
                      </button>
                      <button type="button" className="u1-btn u1-quiet" onClick={() => setPendingClaimant(null)} data-testid="b-claimant-no">
                        Keep as it is
                      </button>
                    </div>
                  )}
                  {/* R7 (D69): fine print. Everything else about this bet is one fold away; nothing here is removed. */}
                  <div className="u1-fine" data-testid="u1-fine">
                    <p className="e-consent" data-testid="e-consent">{CONSENT_LINE}</p>
                    <p className="u1-fine-links">
                      <button type="button" className="u1-link" onClick={tryOwn} data-testid="u1-own">
                        {SIMPLE_WORDS.tryOwn}
                      </button>
                    </p>
                    {sealed.length === 0 && (
                      <details className="u1-more" open={betMore} data-testid="u1-bet-more">
                        <summary onClick={(e) => { e.preventDefault(); setBetMore((m) => !m); }}>{SIMPLE_WORDS.moreBet}</summary>
                        <div className="u1-more-body">
                          {remember?.last && <p className="u1-remember u1-remember-bet" data-testid="remember-last-bet">{`${SIMPLE_WORDS.lastTime} ${remember.last}`}</p>}
                          <div className="u1-linkrow">
                            <button type="button" className="u1-link" onClick={() => setChanging(true)} data-testid="u1-change">
                              {SIMPLE_WORDS.pickTest}
                            </button>
                            <button type="button" className="u1-link" onClick={() => void anotherTest()} data-testid="u1-more-ask">
                              {SIMPLE_WORDS.askWonder}
                            </button>
                            <button type="button" className="u1-link" onClick={() => { setChanging(true); setForm({ initial: emptyForm() }); }} data-testid="u1-more-own">
                              {SIMPLE_WORDS.writeOwn}
                            </button>
                            <button type="button" className="u1-link" onClick={() => askAgain({ one: exp.questions.length === 1 ? false : true })} disabled={busy !== null} data-testid="u1-more-questions">
                              {exp.questions.length === 1 ? SIMPLE_WORDS.allQuestions : SIMPLE_WORDS.oneQuestion}
                            </button>
                          </div>
                          <p className="u1-sub u1-paid" data-testid="u1-paid-more">{`${CHANGE_WORDS.paidWonder} ${SIMPLE_WORDS.askAgainPaid}`}</p>
                          <ModelsLine slots={models.slots} claimant={claimant} locked={busy !== null} onClaimant={setPendingClaimant} />
                          <div className="u1-howsure">
                            <HowSurePicker value={confidence} onChange={setConfidence} disabled={busy !== null} hint={false} onEnter={(level) => {
                                setConfidence(level);
                                void seal(level);
                              }} />
                            <p className="u1-sub">{`${BET_WORDS.untapped} ${FELT_WORDS.pickerHint}`}</p>
                          </div>
                          <details className="u1-seen u1-how" data-testid="u1-how">
                            <summary>{BET_WORDS.howRuns}</summary>
                            <ul className="u1-explain" data-testid="u1-explain">
                              {test?.network && <li>{BET_WORDS.network(LIBRARY_WORDS[test.network.replaces])}</li>}
                              <li>{BET_WORDS.clock}</li>
                              <li>{BET_WORDS.random}</li>
                              <li>{BET_WORDS.zone(exp.experiment.target.language ?? "js")}</li>
                              <li>{BET_WORDS.watch(test?.watchLimitMs ?? CALL_DEFAULT_WATCH_LIMIT_MS, test?.watchLimitMs !== undefined)}</li>
                            </ul>
                          </details>
                          {exp.seenContext && (
                            <details className="u1-seen">
                              <summary>{BET_WORDS.seen}</summary>
                              <p className="u1-pins-line">{pinsLineOf(exp.seenContext, exp.experiment.target.language ?? "js")}</p>
                              <pre tabIndex={0} aria-label="What every bettor sees">
                                {exp.seenContext}
                              </pre>
                            </details>
                          )}
                        </div>
                      </details>
                    )}
                    {detailsFold}
                  </div>
                </>
              )}
              {changing && target && fn && (
                <div data-testid="u1-tests">
                  <p className="u1-k">{BET_WORDS.pickFor(fn)}</p>
                  {proposals && !proposals.ok && proposals.reason && (
                    <p className="u1-sub" role="note" data-testid="u1-no-tests">
                      {BET_WORDS.noTests(proposals.reason)}
                    </p>
                  )}
                  {busy && (
                    <p className="u1-status" role="status">
                      {busy}
                    </p>
                  )}
                  {offeredTests.length === 0 && !wonderWait && !busy && (
                    <div className="u1-none" data-testid="u1-no-offer">
                      <p className="u1-sub">{proposals && (proposals.proposals ?? []).some((p) => p.gate.allowed) ? CHANGE_WORDS.noOtherRan : CHANGE_WORDS.noOtherYet}</p>
                      <button type="button" className="u1-btn" onClick={() => void askWonder({ pick: "list" })} data-testid="u1-no-offer-ask">
                        Ask Muse Wonder for a new test
                      </button>
                      <span className="u1-sub u1-paid">{CHANGE_WORDS.paidWonder}</span>
                    </div>
                  )}
                  <ul className="u1-testlist">
                    {offeredTests
                      .map((p, i) => (
                        <li key={p.id}>
                          <span>
                            {p.says}
                            {offeredTests[i + 1] && <small className="b-differs">{whatDiffers(p.params, offeredTests[i + 1]!.params, "the next")}</small>}
                          </span>{" "}
                          <button type="button" className="u1-link" onClick={() => start(() => api.experimentFromProposal(target, p.id, quizOpts()))} disabled={busy !== null} data-testid={`u1-use-${i}`}>
                            Use this test
                          </button>{" "}
                          <button type="button" className="u1-link" onClick={() => setForm({ initial: formFromParams(p.params), editedFrom: p.id })}>
                            Edit
                          </button>
                        </li>
                      ))}
                  </ul>
                  {(() => {
                    // U2 (D53): a test the gate or the sandbox would refuse is never offered; it is only counted, quietly.
                    const out = (proposals?.proposals ?? []).filter((p) => !p.gate.allowed).length;
                    return out > 0 ? (
                      <p className="u1-sub" data-testid="u1-left-out">
                        {BET_WORDS.leftOut(out)}
                      </p>
                    ) : null;
                  })()}
                  <div className="u1-linkrow">
                  <button type="button" className="u1-link" onClick={() => setForm({ initial: emptyForm() })} data-testid="u1-own">
                    Write your own test
                  </button>
                  {form && <TestForm key={JSON.stringify(form.initial)} exportName={fn} required={requiredArgs(pasted.outline?.parts.find((x) => x.name === fn)?.signature)} initial={form.initial} busy={busy !== null} onSubmit={(params) => start(() => api.experiment(target, params, undefined, form.editedFrom, quizOpts()))} />}
                  {exp && (
                    <button type="button" className="u1-link" onClick={() => setChanging(false)}>
                      Back to the quiz
                    </button>
                  )}
                  </div>
                </div>
              )}
              {/* R11: an open bet with nothing above to show says so, with a way on. Never a blank panel. */}
              {!wonderWait && !busy && !exp && !changing && !error && (
                <div className="u1-none" data-testid="u1-pop-idle">
                  <p className="u1-sub">{CHANGE_WORDS.idle(fn)}</p>
                  <button type="button" className="u1-btn u1-primary" onClick={() => void askWonder({ pick: "default" })} data-testid="u1-pop-idle-ask">
                    Ask Muse Wonder for a test
                  </button>
                  <button type="button" className="u1-link" onClick={writeOwn} data-testid="u1-pop-idle-own">
                    {SIMPLE_WORDS.writeOwn}
                  </button>
                  <span className="u1-sub u1-paid">{earlyState === "done" ? CHANGE_WORDS.earlyDone : CHANGE_WORDS.paidWonder}</span>
                </div>
              )}
              {error && <ErrorNotice message={error} />}
            </section>
          )}
        </div>
      )}
      {after === null && result === null && busy && !open && (
        <p className="u1-toast" role="status">
          {busy}
        </p>
      )}
      {!open && error && (
        <div className="u1-toast">
          <ErrorNotice message={error} />
        </div>
      )}
    </div>
  );
}

/** D60: after sealing, each bettor's sealed tag with its real short hash, and a real seconds counter. Answers stay hidden. */
function SealTags({ sealed, slots }: { sealed: readonly { sealedHash?: string }[]; slots: ReturnType<typeof useModelSlots>["slots"] }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const short = (list: readonly { sealedHash?: string }[]) => (list[0]?.sealedHash ? list[0].sealedHash.slice(0, 8) : "");
  const on = slots.filter((s) => s.status !== "off");
  return (
    <ul className="b-seals" data-testid="b-seals">
      <li>
        <span className="b-seal-who">You</span>
        <span className="b-seal-v">{`locked in ${short(sealed)}`}</span>
      </li>
      {on.map((s) => (
        <li key={s.who} data-state={s.status}>
          <span className="b-seal-who">{betterByRole(s.model)}</span>
          <span className="b-seal-v">{s.status === "sealed" ? `locked in ${short((s as { sealed?: { sealedHash?: string }[] }).sealed ?? [])}` : s.status === "thinking" ? "answering" : s.status === "no_usable_answer" ? "no usable answer" : s.status}</span>
        </li>
      ))}
      <li className="b-seal-time" data-testid="b-seal-time">{`${((now - started) / 1000).toFixed(1)} s`}</li>
    </ul>
  );
}

/** R7 (D69): who bets beside you, in one line. A recorded answer says so, with its day: never shown as live. */
function AisLine({ slots }: { slots: ReturnType<typeof useModelSlots>["slots"] }) {
  const on = slots.filter((s) => s.status !== "off");
  const names = on.map((s) => (s.recorded ? SIMPLE_WORDS.recordedName(shortModelName(s.model), s.recorded) : shortModelName(s.model)));
  const day = on.find((s) => s.recorded)?.recorded;
  return (
    <p className="u1-sub u1-ais" data-testid="u1-ais">
      {SIMPLE_WORDS.aisToo(names)}
      {day ? ` ${SIMPLE_WORDS.recordedNote(day)}` : ""}
    </p>
  );
}

function ModelsLine({ slots, claimant, onClaimant, locked }: { slots: ReturnType<typeof useModelSlots>["slots"]; claimant: ClaimantMode; onClaimant: (m: ClaimantMode) => void; locked: boolean }) {
  const on = slots.filter((s) => s.status !== "off");
  const off = slots.filter((s) => s.status === "off");
  const say = (st: string) => (st === "thinking" ? "answering" : st === "sealed" ? "locked in" : st === "no_usable_answer" ? "no usable answer" : st);
  return (
    <div className="u1-models" data-testid="u1-models">
      <p>{BET_WORDS.ais(on.map((s) => betterByRole(s.model)))}</p>
      {on.length > 0 && <p className="u1-sub">{on.map((s) => BET_WORDS.aiStatus(betterByRole(s.model), say(s.status))).join(" · ")}</p>}
      {[...new Set(off.map((s) => s.reason ?? "no reason given"))].map((why) => (
        <p className="u1-sub" key={why} data-testid={`u1-model-off-${off.find((s) => (s.reason ?? "no reason given") === why)!.who}`}>{BET_WORDS.aiOff(off.filter((s) => (s.reason ?? "no reason given") === why).map((s) => betterByRole(s.model)).join(" and "), why)}</p>
      ))}
      {!locked && (
        <div className="u1-who" role="radiogroup" aria-label={BET_WORDS.whoBets}>
          <span>{BET_WORDS.whoBets}</span>
          {(
            [
              ["spark", "Muse Spark 1.3"],
              ["spark-open", "Muse Spark Open"],
              ["both", "Both"],
            ] as const
          ).map(([value, words]) => (
            <button type="button" role="radio" key={value} className="u1-seg" aria-checked={claimant === value} onClick={() => claimant !== value && onClaimant(value)} data-testid={`who-${value}`}>
              {words}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** U3 item 4: the typed returned value, next to the options. It says how Atlas reads it, in the code's own spelling. */
function TypedValue({ id, value, language, disabled, onChange, onEnter }: { id: string; value: string; language?: Lang; disabled: boolean; onChange: (v: string) => void; onEnter?: () => void }) {
  const py = language === "py";
  const t = value.trim();
  const read = t === "" ? null : parseTyped(t, language);
  const [focused, setFocused] = useState(false);
  return (
    <div className="u1-typed">
      <label htmlFor={id}>
        {BET_WORDS.typedLabel}
        {!focused && <kbd className="k">T</kbd>}
      </label>
      <input id={id} className="u1-typed-in" value={value} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter?.(); } else if (e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); document.querySelector<HTMLElement>('[data-testid="u1-pop"]')?.focus({ preventScroll: true }); } }} onChange={(e) => onChange(e.target.value)} disabled={disabled} spellCheck={false} autoComplete="off" placeholder={py ? 'e.g. "pro", 42, True, None' : 'e.g. "pro", 42, true, null'} aria-describedby={`${id}-hint`} data-testid={id} />
      <p className="u1-sub" id={`${id}-hint`} aria-live="polite">
        {t === "" ? (focused ? BET_WORDS.typedKeys : "") : read ? BET_WORDS.typedReads(literal(read.value, language)) : BET_WORDS.typedText(literal(t, language))}
      </p>
    </div>
  );
}

/** U3 item 6: Muse Wonder is writing tests: the seconds so far, what is happening, and "write my own test" at once. */
function WonderWaiting({ wait, fn, onOwn }: { wait: { started: number; phase: string; claim?: string }; fn: string; onOwn: (() => void) | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((now - wait.started) / 1000));
  return (
    <div className="u1-wait" data-testid="u1-wait">
      {wait.claim && <p className="u1-sub u1-claim-tested">{RESULT_WORDS.testingSentence(wait.claim)}</p>}
      <p className="u1-status" role="status" aria-live="polite">
        {BET_WORDS.waitHead(fn, s)}
      </p>
      <p className="u1-sub">{wait.phase}</p>
      <p className="u1-sub">{BET_WORDS.waitExplore}</p>
      {onOwn && (
        <button type="button" className="u1-btn" onClick={onOwn} data-testid="u1-own-now">
          {BET_WORDS.writeOwnNow}
        </button>
      )}
    </div>
  );
}

/**
 * U3 item 5: after a "Test this claim" run, Wonder's sentence beside the run's measured facts that bear on it. Neither a
 * model nor plain code says whether the sentence holds: the person decides.
 */
function ClaimFacts({ sentence, marks, reach }: { sentence: string; marks: readonly Mark[]; reach: string | null }) {
  return (
    <section className="u1-claimfacts" aria-labelledby="u1-claimfacts-h" data-testid="u1-claim-facts">
      <h3 id="u1-claimfacts-h">{RESULT_WORDS.claimFactsHeading}</h3>
      {reach && <p className="u1-reach" data-testid="u1-claim-reach">{reach}</p>}
      <div className="u1-claimfacts-cols">
        <div>
          <p className="u1-k">{RESULT_WORDS.claimSaid}</p>
          <q>{sentence}</q>
        </div>
        <div>
          <p className="u1-k">{RESULT_WORDS.claimMeasured}</p>
          <ul>
            {marks.map((m) => (
              <li key={m.measures}>
                <span className="u1-k">{`${m.question}:`}</span> {m.measured}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="u1-sub">{RESULT_WORDS.claimYouDecide}</p>
    </section>
  );
}
