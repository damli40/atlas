// D07-01: who places the model's sealed bets in a round. Shared by the server and the page.
//
// Plain words:
// - "spark" (the default): Muse Spark 1.3 on Meta's API, as before.
// - "spark-open": Muse Spark Open, Meta's open-weights model, served by Baseten.
// - "both": each of the two places its own sealed bets on the same experiment before the run. Each
//   sees exactly the same prompt (D18, D19), and neither sees the other's bets.
// The page picks the mode with the x-atlas-claimant header on POST /experiments. Any other value
// is refused with a plain reason. Nothing here says one model is better: the screens show counts.

export const CLAIMANT_HEADER = "x-atlas-claimant";

export const SPARK_MODEL = "muse-spark-1.3";
/** Baseten's id for Muse Spark Open (GET https://inference.baseten.co/v1/models lists it; checked 2026-10-27). */
export const SPARK_OPEN_MODEL = "meta-models/muse-spark-open-1026";

export const CLAIMANT_MODES = ["spark", "spark-open", "both"] as const;
export type ClaimantMode = (typeof CLAIMANT_MODES)[number];
export const DEFAULT_CLAIMANT_MODE: ClaimantMode = "spark";

/** How the screens name each model: its product name AND its id (D10), and who serves an open-weights one. */
export const MODEL_DISPLAY: Record<string, string> = {
  [SPARK_MODEL]: "Muse Spark 1.3 (muse-spark-1.3)",
  [SPARK_OPEN_MODEL]: `Muse Spark Open (${SPARK_OPEN_MODEL}) · via Baseten`,
};
export const modelDisplay = (model: string): string => MODEL_DISPLAY[model] ?? model;

/**
 * Model bettors ("model:<id>") in a fixed column order: Muse Spark, then Muse Spark Open, then any other id
 * as first seen. The order never depends on which model answered first.
 */
export function orderModelBettors(whos: readonly string[]): string[] {
  const rank = (w: string) => {
    const i = [SPARK_MODEL, SPARK_OPEN_MODEL].indexOf(w.replace(/^model:/, ""));
    return i === -1 ? 2 : i;
  };
  return [...new Set(whos)].map((w, i) => ({ w, i })).sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i).map((x) => x.w);
}

/** The models a mode asks, in column order (Muse Spark first). */
export function modelsFor(mode: ClaimantMode): string[] {
  if (mode === "spark-open") return [SPARK_OPEN_MODEL];
  if (mode === "both") return [SPARK_MODEL, SPARK_OPEN_MODEL];
  return [SPARK_MODEL];
}

/** The header's value as a mode. Absent or empty → the default. Anything else → a plain refusal. */
export function parseClaimantMode(raw: string | undefined): { ok: true; mode: ClaimantMode } | { ok: false; reason: string } {
  const v = raw?.trim().toLowerCase() ?? "";
  if (v === "") return { ok: true, mode: DEFAULT_CLAIMANT_MODE };
  if ((CLAIMANT_MODES as readonly string[]).includes(v)) return { ok: true, mode: v as ClaimantMode };
  return { ok: false, reason: `${CLAIMANT_HEADER} must be one of ${CLAIMANT_MODES.join(", ")}` };
}

/** What GET /claimants answers: whether this server can ask Muse Spark Open, and if not, why. */
export interface ClaimantsInfo {
  default: ClaimantMode;
  modes: readonly ClaimantMode[];
  sparkOpen: { model: string; display: string; available: true } | { model: string; display: string; available: false; reason: string };
}

/** The toggle's words when Muse Spark Open cannot be asked. Never a score. */
export const sparkOpenUnavailableText = (reason: string) => `Muse Spark Open: not available (${reason})`;
