// X2: the explorer's saved demo page (no server, no model): the machine drawn from one saved outline answer.
// The live explorer screen (web/screens/Explorer.tsx) draws the same figure with the same code (figure.mjs) from a
// job's outline; this page is the fixture-driven demo and the place the Anatomy checks run.
//
// Run (tsx, because model.ts is TypeScript):
//   pnpm tsx web/machines/explorer/build.mjs            writes explorer.html (dark) and explorer-light.html
//   pnpm tsx web/machines/explorer/build.mjs --audit    also proves the geometry (Anatomy kit/audit.mjs)
//   X2_OUTLINE=<outline answer .json> pnpm tsx web/machines/explorer/build.mjs   draws another saved answer

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../iso/iso-kit.mjs";
import { buildFigure, auditFigure } from "./figure.mjs";
import { explorerModel, authorOf, joinWords, spanText, CHALK_WORDS, NO_LINK_WORDS } from "./model.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE = resolve(HERE, "../../../tests/fixtures/outline/atlas-server-meta-058ab2a.outline.json");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Builds the demo page for one outline answer. Returns { M, html, fig } (fig null when nothing may be drawn). */
export function buildExplorer(view, { theme = "dark" } = {}) {
  const M = explorerModel(view);
  if (M.notShown !== null) return { M, html: notShownPage(M, theme), fig: null };
  let fig;
  try {
    fig = buildFigure(M);
  } catch (e) {
    return { M, html: notShownPage({ ...M, notShown: `The machine could not be drawn: ${e instanceof Error ? e.message : String(e)}. The parts and joins are listed below.` }, theme, M), fig: null };
  }
  return { M, html: page(M, fig, theme), fig };
}

function cardData(M) {
  const names = Object.fromEntries(M.boxes.map((b) => [b.id, b.name.text]));
  return {
    model: M.model,
    boxes: M.boxes.map((b) => ({
      id: b.id,
      name: b.name.text,
      by: authorOf(b.name.by),
      purposeBy: authorOf(b.purpose.by),
      purpose: b.purpose.text,
      spans: b.spans.map(spanText),
      lines: b.lines,
      joins: b.joins.map((j) => ({ ...j, words: joinWords(j), otherName: names[j.other] ?? j.other })),
      bets: b.bets,
    })),
    source: M.source,
    commit: M.commit,
  };
}

function captionOf(M) {
  const codeOnly = M.lines.filter((l) => l.status === "code-only").length;
  const typeOnly = M.lines.filter((l) => l.typeOnly).length;
  return `Drawn only from Atlas's checked outline of ${M.source}${M.commit ? ` at commit ${M.commit.slice(0, 7)}` : ""} (${M.files.length} files). Muse Wonder (${M.model}) proposed the parts and joins and wrote every name and purpose; plain code checked them against the files. A box stands for a part whose lines plain code confirmed; it is as tall as the lines it covers (7 units plus 1 per 45 lines), and its plate shows Wonder's name for it. A steel line is a join plain code found: thick for calls, thin for imports and uses, braided for type-only imports (${typeOnly}, no link at run time); two tag collars mark the ${codeOnly} that Wonder did not name. "Lines confirmed" means the lines exist where Wonder said; it does not mean Wonder's sentence about a part is true.`;
}

function listsHtml(M) {
  const names = new Map(M.boxes.map((b) => [b.id, b.name.text]));
  const nameOf = (id) => names.get(id) ?? id;
  const chalk = M.chalk
    .map((c) => `<li class="ex-chalk" data-chalk="${esc(c.id)}"><span class="ex-chalk-tag">${esc(nameOf(c.from))} → ${esc(nameOf(c.to))} · ${esc(c.kind)}</span> <span class="ex-chalk-words">${esc(c.words)}.${c.reason && c.reason !== c.words ? ` ${esc(c.reason)}` : ""}</span></li>`)
    .join("");
  const unconf = M.unconfirmed.map((u) => `<li>${esc(u.name.text)} <span class="ex-by">(name by ${esc(authorOf(u.name.by))})</span>: ${esc(u.reasons.join("; "))}</li>`).join("");
  return (
    `<section class="ex-side" aria-label="joins not drawn"><h2>Not drawn as lines</h2><p class="ex-muted">Joins only Muse Wonder (${esc(M.model)}) states, with the parts named in its words. A chalk tag is not a connection.</p><ul class="ex-chalks">${chalk || `<li class="ex-muted">None: plain code found every join Wonder named.</li>`}</ul>` +
    (unconf ? `<h2>Parts not confirmed (not drawn)</h2><ul>${unconf}</ul>` : "") +
    (M.notInAnyPart.length ? `<h2>Files in no part</h2><p class="ex-muted">${M.notInAnyPart.map(esc).join(", ")}: an empty tray each.</p>` : "") +
    (M.skipped.length ? `<h2>Files Atlas did not read</h2><ul>${M.skipped.map((s) => `<li>${esc(s.path)}: ${esc(s.reason)}</li>`).join("")}</ul>` : "") +
    `</section>`
  );
}

function page(M, fig, theme) {
  const css = readFileSync(join(HERE, "explorer.css"), "utf8");
  const live = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(cardData(M)).replace(/</g, "\\u003c"));
  const codeOnly = M.lines.filter((l) => l.status === "code-only").length;
  const plate = k.plateHtml({
    fig: "Fig X2",
    title: `${M.source}${M.commit ? ` @ ${M.commit.slice(0, 7)}` : ""}`,
    hint: "hover a box · Tab, then ← → · Esc",
    readout: `${M.boxes.length} parts · ${M.lines.length} lines`,
    keys: [
      { mark: "raised", label: "A box: a part whose lines plain code confirmed. Taller box = more lines" },
      { mark: "edge", label: `A steel line: plain code found an import, call or use (${M.lines.length - codeOnly} that Wonder named too)` },
      { mark: "dotted", label: `Two tag collars: found by plain code only, Wonder did not name it (${codeOnly})` },
      { mark: "lit", label: "The part you picked and its lines; the rest steps back" },
    ],
    caption: captionOf(M),
    body: `<div class="iso-stage ex-stage" tabindex="0" role="group" aria-label="Code explorer machine. Use left and right arrows to pick a part; Escape clears.">${fig.svg}</div>`,
  });
  const body =
    `<style>${css}</style><div class="ex-wrap"><div class="ex ex-page"><div class="ex-main">${plate}</div><div class="ex-aside">` +
    `<section class="ex-card" aria-live="polite" data-card><p class="ex-card-label">Pick a box</p><p class="ex-muted">Hover, click or Tab to a box to see its part.</p></section>` +
    listsHtml(M) +
    `</div></div></div>`;
  return k.pageHtml({ title: "Code explorer", theme, body, script: live, width: 1480 });
}

function notShownPage(M, theme, full = null) {
  const body = `<div class="ex"><div class="iso-plate ex-notice" role="note"><p>Fig X2 · not drawn</p><p>${esc(M.notShown)}</p></div>${full ? listsHtml(full) : ""}</div>`;
  return k.pageHtml({ title: "Code explorer", theme, body, width: 760 });
}

export { CHALK_WORDS, NO_LINK_WORDS };

// ---- CLI ----
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const view = JSON.parse(readFileSync(process.env.X2_OUTLINE ?? FIXTURE, "utf8"));
  let fig = null;
  for (const theme of ["dark", "light"]) {
    const out = buildExplorer(view, { theme });
    const name = theme === "light" ? "explorer-light.html" : "explorer.html";
    writeFileSync(join(HERE, name), out.html);
    console.log("wrote", name, `${(out.html.length / 1024).toFixed(0)} KB`, out.fig ? JSON.stringify(out.fig.stats) : `not drawn: ${out.M.notShown}`);
    fig = out.fig;
  }
  if (fig && process.argv.includes("--audit")) {
    const t = Date.now();
    const a = auditFigure(fig);
    console.log(a.report);
    console.log(`audit · ${fig.stats.runs} tube runs · ${fig.stats.solids} solids · ${fig.stats.items} items · ${((Date.now() - t) / 1000).toFixed(1)} s`);
    console.log(a.passed ? "audit passed" : `audit failed: ${a.problems} problems`);
    if (!a.passed) process.exitCode = 1;
  }
}
