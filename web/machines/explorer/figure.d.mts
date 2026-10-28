// Types for figure.mjs (the drawing is plain ESM so the same file runs in Node for the audit and in the browser).
import type { ExplorerModel } from "./model";

export interface Figure {
  svg: string;
  /** The audit's recorder and projection (kit/audit.mjs). */
  R: unknown;
  P: unknown;
  /** The name each box's plate shows (fitted to the plate; the card shows the full name). */
  names: Record<string, string>;
  stats: { solids: number; items: number; lines: number; runs: number; trays: number; files: number; decks: number; boxes: number; levels: number };
}

export const W: number;
export const ROUTER_BUDGET: number;
export const MAX_DRAWN_LINES: number;
export const MAX_DRAWN_PARTS: number;
export const MAX_LEVELS: number;
export class TooManyToDraw extends Error {}
export const H: number;
export function widthOf(lines: number): number;
export function fitName(text: string, width: number, size?: number): string;
export function buildFigure(model: ExplorerModel): Figure;
export function auditFigure(fig: Figure): { passed: boolean; problems: number; report: string };
