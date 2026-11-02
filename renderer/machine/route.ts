// D65: pipes that are honest. A pipe runs along the floor of the drawing on a grid, and may not go where a part other than its two ends
// would cover it on the page, or it would cover that part: if you can't see where a pipe goes, you can't tell who it joins. Pure.
import type { Pt } from "../hand";
import { inside, type Solid } from "./geometry";
import { iso, type Plan, type W } from "./pencil";

const CELL = 13;
export const PIPE_Z = 24;
export const PIPE_R = 6.2;

export interface Job {
  id: string;
  from: string;
  to: string;
  start: [number, number];
  goal: [number, number];
  /** Near its own ends a pipe may touch its own part: plans it may run in, for each end. */
  near: Plan[];
}
export interface Owner {
  part: string;
  solid: Solid;
}

type Occupied = Map<number, number>; // cell → axes used (1 x, 2 y)

export function routeAll(jobs: readonly Job[], owners: readonly Owner[], bounds: Plan): Map<string, W[]> | { failed: string } {
  const cols = Math.ceil(bounds.w / CELL);
  const rows = Math.ceil(bounds.d / CELL);
  const key = (c: number, r: number) => r * cols + c;
  const worldX = (c: number) => bounds.x + c * CELL;
  const worldY = (r: number) => bounds.y + r * CELL;
  // Which parts would hide, or be hidden by, a pipe in each cell.
  const blockers: (string[] | undefined)[] = new Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p: Pt = iso([worldX(c), worldY(r), PIPE_Z]);
      for (const o of owners) if (inside(o.solid, p, PIPE_R + 4)) (blockers[key(c, r)] ??= []).push(o.part);
    }
  }
  const taken: Occupied = new Map();
  const out = new Map<string, W[]>();
  for (const job of jobs) {
    const sc = Math.round((job.start[0] - bounds.x) / CELL);
    const sr = Math.round((job.start[1] - bounds.y) / CELL);
    const gc = Math.round((job.goal[0] - bounds.x) / CELL);
    const gr = Math.round((job.goal[1] - bounds.y) / CELL);
    const allowed = (c: number, r: number) => {
      const b = blockers[key(c, r)];
      if (!b) return true;
      const x = worldX(c);
      const y = worldY(r);
      for (const part of b) {
        if (part !== job.from && part !== job.to) return false;
        if (!job.near.some((n) => x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.d)) return false;
      }
      return true;
    };
    const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const best = new Map<number, number>();
    const prev = new Map<number, number>();
    // A small heap: cost, state. State = cell * 4 + direction.
    const heap: [number, number][] = [];
    const push = (cost: number, st: number) => {
      heap.push([cost, st]);
      let i = heap.length - 1;
      while (i > 0) {
        const up = (i - 1) >> 1;
        if (heap[up]![0] <= heap[i]![0]) break;
        [heap[up], heap[i]] = [heap[i]!, heap[up]!];
        i = up;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const a = 2 * i + 1;
          const b = a + 1;
          let m = i;
          if (a < heap.length && heap[a]![0] < heap[m]![0]) m = a;
          if (b < heap.length && heap[b]![0] < heap[m]![0]) m = b;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    const startState = key(sc, sr) * 4;
    best.set(startState, 0);
    push(0, startState);
    let end: number | null = null;
    while (heap.length) {
      const [cost, st] = pop();
      if (cost > (best.get(st) ?? Infinity)) continue;
      const cell = st >> 2;
      const d = st & 3;
      const c = cell % cols;
      const r = (cell - c) / cols;
      if (c === gc && r === gr && d === 0) {
        end = st;
        break;
      }
      for (let nd = 0; nd < 4; nd++) {
        if ((nd + 2) % 4 === d) continue;
        // A pipe leaves its port square: it goes straight out before it may turn.
        if (st === startState && nd !== 0) continue;
        const nc = c + dirs[nd]![0];
        const nr = r + dirs[nd]![1];
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        if (!allowed(nc, nr)) continue;
        const axis = nd % 2 === 0 ? 1 : 2;
        const used = taken.get(key(nc, nr)) ?? 0;
        if (used & axis) continue; // never along another pipe
        // Beside another pipe costs a little, so they spread out when there is room and can still run side by side when there isn't.
        const axisOf = nd % 2 === 0 ? 1 : 2;
        const beside = axisOf === 1 ? (taken.get(key(nc, nr + 1)) ?? 0) | (nr > 0 ? taken.get(key(nc, nr - 1)) ?? 0 : 0) : (taken.get(key(nc + 1, nr)) ?? 0) | (nc > 0 ? taken.get(key(nc - 1, nr)) ?? 0 : 0);
        const nextCost = cost + 1 + (nd === d ? 0 : 7) + (used ? 22 : 0) + (beside & axisOf ? 4 : 0);
        const ns = key(nc, nr) * 4 + nd;
        if (nextCost < (best.get(ns) ?? Infinity)) {
          best.set(ns, nextCost);
          prev.set(ns, st);
          push(nextCost, ns);
        }
      }
    }
    if (end === null) return { failed: `no clear route for the pipe ${job.id}` };
    const path: [number, number, number][] = [];
    for (let st: number | undefined = end; st !== undefined; st = prev.get(st)) {
      const cell = st >> 2;
      const c = cell % cols;
      path.unshift([c, (cell - c) / cols, st & 3]);
    }
    const route: W[] = [[job.start[0], job.start[1], PIPE_Z]];
    for (let i = 1; i < path.length; i++) {
      const [c, r, d] = path[i]!;
      const axis = d % 2 === 0 ? 1 : 2;
      const k = key(c, r);
      taken.set(k, (taken.get(k) ?? 0) | axis);
      const turn = i + 1 < path.length && path[i + 1]![2] !== d;
      if (turn) route.push([worldX(c), worldY(r), PIPE_Z]);
    }
    route.push([job.goal[0], job.goal[1], PIPE_Z]);
    // the first leg must leave square from the port: both ends snap to the port's own line
    if (route.length > 2) {
      route[1] = [route[1]![0], route[0]![1], PIPE_Z];
      route[route.length - 2] = [route[route.length - 2]![0], route[route.length - 1]![1], PIPE_Z];
    }
    out.set(job.id, route);
  }
  return out;
}
