// X2: random explorer models for the figure's stress tests: 6–17 files (about half under roles/), some files cut into
// two parts, 8–33 joins of every drawable kind. Deterministic from the seed. Plain data, no model.
import { decksOf, type Box, type ExplorerModel, type Line } from "../../web/machines/explorer/model";

export function randomModel(seedIn: number): ExplorerModel {
  let seed = seedIn;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nFiles = 6 + Math.floor(rnd() * 12);
  const files = Array.from({ length: nFiles }, (_, i) => (rnd() < 0.55 ? `roles/f${i}.ts` : `f${i}.ts`));
  const boxes: Box[] = [];
  for (const f of files) {
    const parts = rnd() < 0.3 ? 2 : 1;
    for (let p = 0; p < parts; p++) {
      const lines = 20 + Math.floor(rnd() * 400);
      const id = `${f.replace(/\W/g, "-")}-${p}`;
      boxes.push({ id, name: { text: `Part ${id} ${"x".repeat(Math.floor(rnd() * 14))}`, by: "model:test" }, purpose: { text: "test", by: "model:test" }, spans: [{ path: f, lineStart: p * 500 + 1, lineEnd: p * 500 + lines, wholeFile: parts === 1, lines }], lines, joins: [], bets: [] });
    }
  }
  const want = 8 + Math.floor(rnd() * 26);
  const lines: Line[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < want; i++) {
    const a = boxes[Math.floor(rnd() * boxes.length)]!;
    const b = boxes[Math.floor(rnd() * boxes.length)]!;
    if (a === b || seen.has(`${a.id}>${b.id}`)) continue;
    seen.add(`${a.id}>${b.id}`);
    lines.push({ id: `j${i}`, from: a.id, to: b.id, kind: rnd() < 0.6 ? "calls" : "imports", status: rnd() < 0.8 ? "confirmed" : "code-only", codeEdges: 1, typeOnly: rnd() < 0.1 });
  }
  return { notShown: null, model: "test", boxes, lines, chalk: [], unconfirmed: [], notDrawn: [], decks: decksOf(files, boxes), files, notInAnyPart: [], source: "random", rootFolder: "./", commit: null, codeSha256: "0".repeat(64), skipped: [] };
}
