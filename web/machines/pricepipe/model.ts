// The price pipe's model. A pure function from { run, bets, verdicts } to the state of every part
// that depends on the run, and to the words the card prints. It reads ONLY the run (its measured
// values, its references and its trace), the bets and the verdicts. Its only imports are the input
// types and the one USD formatter in src/units.ts (tests/unit/machines-pricepipe.test.tsx checks that).
//
// The machine, in one sentence: price feeds stand at the inlets, their pipes meet in a gear slot,
// and a gauge shows the price that came out; a multiply gear sits in the slot only when the run's
// call trace counted two price sources.
//
// What decides the gear (and nothing else does):
// - measured `priceSources:<symbol>` === 2  -> the multiply gear is drawn in the slot;
// - measured `priceSources:<symbol>` === 1  -> no gear; the slot shows a DASHED empty outline when
//   bets were placed on a USD price. The dashed outline is the bettors' expectation, drawn from
//   Bet[]; it says nothing about the code;
// - the count was not measured             -> the slot is drawn plain, with "not measured" under it.

import type { Bet, Run, Verdict } from "../../../src/types";
import { formatUsd1e18 } from "../../../src/units";

export interface PipeInput {
  run: Run;
  bets: Bet[];
  verdicts: Verdict[];
}

/** One inlet: a feed the price read actually came through, or an inlet this read did not use. */
export interface Inlet {
  /** "read": a price source of this read; "blank": the trace counted fewer sources, so it is blanked;
   *  "unknown": the source count was not measured, so nothing is said about it. */
  state: "read" | "blank" | "unknown";
  /** The label engraved on the inlet duct's top (null when nothing was read through it). */
  label: string | null;
  /** Where the label came from. */
  labelFrom: "feedDescription" | "reference input" | "address" | null;
}

export type SlotState =
  | { kind: "gear" }
  | { kind: "ghost"; who: string[] }
  | { kind: "empty" }
  | { kind: "not_measured"; reason: string };

export interface Needle {
  usd1e18: string;
  text: string;
  /** Dial position, 0 (start of the scale) … 1 (end). */
  at: number;
  offScale: boolean;
}

export interface GhostMark {
  who: string;
  kind: "person" | "model";
  usd: number;
  at: number;
  offScale: boolean;
  outcome: Verdict["outcome"] | null;
}

export type Step = { kind: "inlets" | "ports" | "slot" | "outlet" | "needles"; dur: number };

export interface PipeModel {
  symbol: string;
  /** The measured price-source count, or null when it was not measured. */
  count: number | null;
  countReason: string | null;
  controlPassed: boolean;
  controlReason: string | null;
  inlets: [Inlet, Inlet];
  slot: SlotState;
  /** The price the oracle reported (null when not read or when the control failed). */
  price: Needle | null;
  /** Raw Chainlink at the same block (null when not computed or when the control failed). */
  reference: Needle | null;
  /** Text for the price whether or not a needle is drawn ("not read" when absent). */
  priceText: string;
  referenceText: string;
  ghosts: GhostMark[];
  /** Bettors who declined: no mark, the caption says "declined". */
  declined: string[];
  /** Which level of Moonwell run this is, read from the trace: "level2" when the proposal's feed
   *  actions were applied (feed_set events), "level1" for a plain price read. */
  level: "level2" | "level1" | null;
  forkBlock: number | null;
  steps: Step[];
  total: number;
  readout: string;
  /** The engraving on the dial face: the scale, or "can't check" when the control failed. */
  engraving: string;
}

/** The dial is logarithmic: $0.01 at the start, $10,000 at the end (six decades). */
export const DIAL_MIN_EXP = -2;
export const DIAL_MAX_EXP = 4;

/** Names the plain-code reference (runners/evm) gives its raw Chainlink inputs, as symbol pairs. */
const REFERENCE_PAIRS: Record<string, string> = { ethUsd: "ETH / USD", cbEthEth: "cbETH / ETH" };

const DUR = { inlets: 0.9, ports: 0.6, slot: 1.1, outlet: 0.6, needles: 1.5 } as const;

const asRecord = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const isUint = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** USD 1e18 (as text) → a JS number of dollars, for placing marks only (never printed). */
function dollars(v: string): number {
  const big = BigInt(v);
  const whole = big / 10n ** 18n;
  const frac = big % 10n ** 18n;
  return Number(whole) + Number(frac / 10n ** 6n) / 1e12;
}

/** Position on the log dial, 0 … 1, and whether the value was off the scale. */
export function dialAt(usd: number): { at: number; offScale: boolean } {
  if (!(usd > 0)) return { at: 0, offScale: true };
  const raw = (Math.log10(usd) - DIAL_MIN_EXP) / (DIAL_MAX_EXP - DIAL_MIN_EXP);
  return { at: Math.max(0, Math.min(1, raw)), offScale: raw < 0 || raw > 1 };
}

function needleOf(v: string): Needle {
  const { at, offScale } = dialAt(dollars(v));
  return { usd1e18: v, text: formatUsd1e18(BigInt(v)), at, offScale };
}

/** The market the card is about: the one the bets ask about, else the one with a reference. */
function symbolOf(run: Run, bets: Bet[]): string {
  for (const b of bets) {
    const m = /^priceUsd1e18:(.+)$/.exec(b.measures);
    if (m && b.experimentId === run.experimentId) return m[1]!;
  }
  for (const k of Object.keys(run.result.references ?? {})) {
    const m = /^refUsd1e18:(.+)$/.exec(k);
    if (m) return m[1]!;
  }
  const s = Object.keys(run.result.measured).map((k) => /^priceSources:(.+)$/.exec(k)?.[1]).find(Boolean);
  return s ?? "cbETH";
}

/** Labels for the read's price sources, from its call trace and the reference's recorded inputs. */
function sourceLabels(run: Run, count: number): { label: string; from: Inlet["labelFrom"] }[] | null {
  const traces = run.trace.filter((e) => e.event === "call_trace").map((e) => asRecord(e.data));
  const tr = traces.find((d) => d.phase === "post-apply") ?? (traces.length === 1 ? traces[0] : undefined);
  if (!tr || tr.count !== count || !Array.isArray(tr.sources)) return null;
  const callees = Array.isArray(tr.latestRoundDataCallees) ? tr.latestRoundDataCallees.map((c) => String(c).toLowerCase()) : [];
  const ref = run.trace.find((e) => e.event === "reference");
  const inputs = asRecord(asRecord(ref?.data).inputs);
  const byAddress = new Map<string, string>();
  for (const [key, val] of Object.entries(inputs)) {
    const a = str(asRecord(val).address);
    if (a) byAddress.set(a.toLowerCase(), key);
  }
  return tr.sources.map((s) => {
    const src = String(s).toLowerCase();
    // A Chainlink proxy passes the call to its aggregator: the callee just before the source.
    const i = callees.indexOf(src);
    const proxy = i > 0 ? callees[i - 1]! : null;
    const key = byAddress.get(src) ?? (proxy ? byAddress.get(proxy) : undefined);
    if (key) return { label: REFERENCE_PAIRS[key] ?? key, from: "reference input" as const };
    return { label: short(String(s)), from: "address" as const };
  });
}

function sourcesText(count: number | null): string {
  if (count === null) return "price sources not measured";
  return `${count} price ${count === 1 ? "source" : "sources"}`;
}

export function pipeModel({ run, bets, verdicts }: PipeInput): PipeModel {
  const symbol = symbolOf(run, bets);
  const m = run.result.measured;
  const nm = run.result.notMeasured;
  const controlPassed = run.controlPassed === true;
  const controlReason = controlPassed ? null : nm.control ?? "the known-case control did not pass";

  // The source count: measured, or not measured (with the runner's reason when it gave one).
  const rawCount = m[`priceSources:${symbol}`];
  const count = typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount > 0 ? rawCount : null;
  const countReason = count !== null ? null : nm[`priceSources:${symbol}`] ?? "this run did not trace where its price came from";

  // Inlets: labelled from the feeds the run read.
  const desc = str(m[`feedDescription:${symbol}`]);
  const feedAddr = str(m[`feedAddress:${symbol}`]);
  const blank: Inlet = { state: "blank", label: null, labelFrom: null };
  const unknown: Inlet = { state: "unknown", label: null, labelFrom: null };
  let inlets: [Inlet, Inlet];
  if (count === null) {
    const label = desc ?? (feedAddr ? short(feedAddr) : null);
    inlets = [label ? { state: "read", label, labelFrom: desc ? "feedDescription" : "address" } : unknown, unknown];
  } else {
    const labels = sourceLabels(run, count);
    const one = (i: number): Inlet => {
      if (count === 1 && i === 0 && desc) return { state: "read", label: desc, labelFrom: "feedDescription" };
      const l = labels?.[i];
      return l ? { state: "read", label: l.label, labelFrom: l.from } : { state: "read", label: i === 0 && feedAddr ? short(feedAddr) : `source ${i + 1}`, labelFrom: "address" };
    };
    inlets = [one(0), count >= 2 ? one(1) : blank];
  }

  // The slot.
  const usdBets = bets.filter((b) => b.experimentId === run.experimentId && b.measures === `priceUsd1e18:${symbol}`);
  let slot: SlotState;
  if (count === null) slot = { kind: "not_measured", reason: countReason! };
  else if (count === 2) slot = { kind: "gear" };
  else if (count === 1 && usdBets.length > 0) slot = { kind: "ghost", who: usdBets.map((b) => b.who) };
  else slot = { kind: "empty" };

  // The gauge.
  const priceRaw = m[`priceUsd1e18:${symbol}`];
  const refRaw = run.result.references?.[`refUsd1e18:${symbol}`]?.value;
  const priceText = isUint(priceRaw) ? formatUsd1e18(BigInt(priceRaw)) : "not read";
  const referenceText = isUint(refRaw) ? formatUsd1e18(BigInt(refRaw)) : "not computed";
  const price = controlPassed && isUint(priceRaw) ? needleOf(priceRaw) : null;
  const reference = controlPassed && isUint(refRaw) ? needleOf(refRaw) : null;

  // Ghost bet marks: from Bet[] only. A declined bet leaves no mark.
  const verdictOf = (id: string) => verdicts.find((v) => v.betId === id && v.runId === run.id) ?? verdicts.find((v) => v.betId === id);
  const ghosts: GhostMark[] = [];
  const declined: string[] = [];
  for (const b of usdBets) {
    if (b.answer.kind === "declined") {
      declined.push(b.who);
      continue;
    }
    if (b.answer.kind !== "number" && b.answer.kind !== "integer") continue;
    const usd = b.answer.value;
    const { at, offScale } = dialAt(usd);
    ghosts.push({ who: b.who, kind: b.who === "human" ? "person" : "model", usd, at, offScale, outcome: verdictOf(b.id)?.outcome ?? null });
  }
  ghosts.sort((a, b) => (a.kind === b.kind ? a.who.localeCompare(b.who) : a.kind === "person" ? -1 : 1));

  const level = run.trace.some((e) => e.event === "feed_set") ? "level2" : run.runner === "evm" ? "level1" : null;

  const steps: Step[] = [
    { kind: "inlets", dur: DUR.inlets },
    { kind: "ports", dur: DUR.ports },
    { kind: "slot", dur: DUR.slot },
    { kind: "outlet", dur: DUR.outlet },
    { kind: "needles", dur: DUR.needles },
  ];
  const total = steps.reduce((a, s) => a + s.dur, 0);

  const readout = controlPassed
    ? `${symbol} read ${priceText} · reference ${referenceText} · ${sourcesText(count)}`
    : `${symbol}: can't check (the control did not pass) · ${sourcesText(count)}`;
  const engraving = controlPassed ? "USD · log" : "can't check";

  return {
    symbol,
    count,
    countReason,
    controlPassed,
    controlReason,
    inlets,
    slot,
    price,
    reference,
    priceText,
    referenceText,
    ghosts,
    declined,
    level,
    forkBlock: run.forkBlock ?? null,
    steps,
    total,
    readout,
    engraving,
  };
}

// ---- the pose at one moment of the story ----

export interface Pose {
  /** The part lit now: the step running (at the end, the price needle, or nothing on can't check). */
  lit: Step["kind"] | null;
  /** Progress of the flow bead along the current pipe, 0 … 1 (null when no bead is moving). */
  bead: { on: "inlets" | "ports" | "outlet"; p: number } | null;
  /** Gear turn so far, in turns. */
  gearTurn: number;
  /** Needle travel, 0 (rest at the start of the scale) … 1 (at its value). */
  needles: number;
  readout: string;
  done: boolean;
}

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The pose at story time `s` (seconds). At or past `model.total` it is the end state. */
export function poseAt(model: PipeModel, s: number): Pose {
  if (s >= model.total) return { lit: model.price ? "needles" : null, bead: null, gearTurn: model.slot.kind === "gear" ? 1 / 3 : 0, needles: 1, readout: model.readout, done: true };
  let clock = 0;
  let lit: Pose["lit"] = null;
  let bead: Pose["bead"] = null;
  let gearTurn = 0;
  let needles = 0;
  for (const st of model.steps) {
    const p = clamp01((s - clock) / st.dur);
    const running = s >= clock && s < clock + st.dur;
    clock += st.dur;
    if (st.kind === "slot" && model.slot.kind === "gear") gearTurn = ease(p) / 3;
    if (st.kind === "needles") needles = ease(p);
    if (running) {
      lit = st.kind;
      if (st.kind === "inlets" || st.kind === "ports" || st.kind === "outlet") bead = { on: st.kind, p: ease(p) };
    }
  }
  return { lit, bead, gearTurn, needles, readout: `${model.symbol} reading · ${sourcesText(model.count)}`, done: false };
}
