// R3: the Scene: where everything goes, in px, before any ink. Both backends (live SVG, exported PNG) draw a Scene,
// and renderer/check.ts checks it. Types only.
import type { Pt } from "./hand";
import type { EdgeKind, MarkKind, NodeKind, Pin, Provenance } from "./spec";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TextLine {
  text: string;
  /** Left edge of the line and its baseline. */
  x: number;
  y: number;
  w: number;
}

export interface TextBlock {
  /** What the block is, for the checks and the player. */
  role: "node" | "small" | "edge" | "region" | "title" | "kicker" | "subtitle" | "caption" | "mark" | "tag";
  owner?: string;
  face: "regular" | "italic";
  size: number;
  lines: TextLine[];
  box: Box;
}

export interface SceneNode {
  id: string;
  kind: NodeKind;
  provenance: Provenance;
  box: Box;
  /** Resting tilt in degrees: a person never pins a ticket dead straight. */
  tilt: number;
  pin: Pin;
  /** Where the ticket is pinned; it swings round this point as it settles. */
  pivot: Pt;
  missing: boolean;
  sweep: number;
  text: TextBlock;
  small: TextBlock | null;
  /** The whole name, for the tooltip and the screen reader. */
  full: string;
  sourceWords: string;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  provenance: Provenance;
  onPath: boolean;
  /** The trimmed route the hand aims along. */
  pts: Pt[];
  /** The words beside it, or null when none fit on clean paper (then they stay in the tooltip and the list). */
  label: TextBlock | null;
  full: string;
  labelHidden: boolean;
  /** How many links in the code this line stands for. */
  weight: number;
}

export interface SceneRegion {
  id: string;
  kind: "folder" | "state";
  box: Box;
  label: TextBlock;
  depth: number;
}

export interface SceneMark {
  /** A didn't-match with no honest step: the words alone, no ring. */
  noStep?: boolean;
  on: string;
  kind: MarkKind;
  words: TextBlock;
}

export interface Scene {
  width: number;
  height: number;
  seed: string;
  nodes: SceneNode[];
  edges: SceneEdge[];
  regions: SceneRegion[];
  marks: SceneMark[];
  tags: TextBlock[];
  quiet: boolean;
  title: TextBlock | null;
  kicker: TextBlock | null;
  subtitle: TextBlock | null;
  captions: TextBlock[];
  /** How many edge words had no clean paper and stay in tooltips and the list. */
  hiddenLabels: number;
  /** The direction the chart reads in. */
  direction: "TD" | "LR";
}
