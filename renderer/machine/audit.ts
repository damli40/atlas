// D65: the machine's own check. Run on every drawing, and again on the real page with measured boxes (tests/evidence/R4). A failure means the
// machine is not shown: the page says so and shows the chart. If you can't see where a pipe goes, the picture would claim something it does not show.
import type { Pt } from "../hand";
import { inside, rectsOverlap, sample, solidHitsRect, type Rect, type Solid } from "./geometry";
import { PIPE_R } from "./route";

export interface MachineFacts {
  owners: { part: string; solid: Solid }[];
  routes: { id: string; from: string; to: string; page: Pt[]; chevrons: number; endsAtParts: boolean; nearEnds: [Pt, Pt] }[];
  labels: { part: string; text: string; rect: Rect; unplaced?: boolean }[];
}

/** Every way the drawing breaks its promises, in plain words. Empty: it keeps them. */
export function auditMachine(f: MachineFacts): string[] {
  const out: string[] = [];
  for (const r of f.routes) {
    if (r.chevrons < 1) out.push(`pipe ${r.id} does not show which way it flows`);
    if (!r.endsAtParts) out.push(`pipe ${r.id} ends on nothing`);
    for (const p of sample(r.page, 6)) {
      for (const o of f.owners) {
        const own = o.part === r.from || o.part === r.to;
        if (!inside(o.solid, p, PIPE_R)) continue;
        // A pipe may be covered by, or cover, its own two ends only close to where it joins them.
        if (own && (Math.hypot(p[0] - r.nearEnds[0][0], p[1] - r.nearEnds[0][1]) < 110 || Math.hypot(p[0] - r.nearEnds[1][0], p[1] - r.nearEnds[1][1]) < 110)) continue;
        out.push(`pipe ${r.id} passes ${own ? "over its own part" : "a part it does not join"}: ${o.part}`);
        break;
      }
    }
  }
  for (let i = 0; i < f.labels.length; i++) {
    const a = f.labels[i]!;
    if (a.unplaced) {
      out.push(`no clear place for the words "${a.text}"`);
      continue;
    }
    for (let j = i + 1; j < f.labels.length; j++) if (!f.labels[j]!.unplaced && rectsOverlap(a.rect, f.labels[j]!.rect)) out.push(`words overlap: "${a.text}" and "${f.labels[j]!.text}"`);
    for (const o of f.owners) if (solidHitsRect(o.solid, a.rect)) out.push(`words "${a.text}" sit on the part ${o.part}`);
    for (const r of f.routes) if (sample(r.page, 6).some((p) => p[0] > a.rect.x0 && p[0] < a.rect.x1 && p[1] > a.rect.y0 && p[1] < a.rect.y1)) out.push(`words "${a.text}" sit on pipe ${r.id}`);
  }
  return [...new Set(out)];
}
