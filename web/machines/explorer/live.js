// X2 prototype, live layer: pick a box (hover, click, Tab, arrows) and light it with its lines; the card under
// the figure shows the part in the model's words, its real line ranges and its joins with their status.
// Every model sentence is written with textContent, never as HTML. Idle tour: one box every 4 s until the
// reader touches the figure; none under reduced motion, and none while the figure is offscreen.
const D = __DATA__;
const root = document.querySelector(".ex");
const stage = root.querySelector(".ex-stage");
const card = root.querySelector("[data-card]");
const readout = root.querySelector("[data-readout]");
const items = [...root.querySelectorAll(".ex-skid > .it")];
const hits = [...root.querySelectorAll(".ex-hit")];
const order = D.boxes.map((b) => b.id);
const byId = new Map(D.boxes.map((b) => [b.id, b]));
const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const total = readout.textContent;
let picked = null;
let touched = false;

const STATUS = {
  confirmed: "confirmed: Wonder named it and plain code found it",
  "code-only": "found by plain code; Wonder did not name it",
  "model-only": D.chalkWords,
};

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function rangeText(s) {
  return s.wholeFile ? `${s.path} · whole file, lines ${s.lineStart}–${s.lineEnd}` : `${s.path} · lines ${s.lineStart}–${s.lineEnd}`;
}

function show(id) {
  picked = id;
  const box = id ? byId.get(id) : null;
  const lit = new Set(box ? box.joins.filter((j) => j.drawn).map((j) => j.id) : []);
  for (const it of items) {
    const of = it.getAttribute("data-of");
    const line = it.getAttribute("data-line");
    const on = Boolean(box) && ((of === id && !line) || (line && lit.has(line)));
    it.classList.toggle("on", on);
  }
  for (const h of hits) h.setAttribute("aria-pressed", String(h.getAttribute("data-hit") === id));
  if (box) root.setAttribute("data-picked", id);
  else root.removeAttribute("data-picked");
  card.replaceChildren();
  if (!box) {
    readout.textContent = total;
    card.append(el("p", "Pick a box", { class: "ex-card-label" }), el("p", `Hover, click or Tab to a box to see its part: the name and purpose sentence Muse Wonder (${D.model}) wrote, the real file lines plain code confirmed, and every join with its status.`, { class: "ex-muted" }));
    return;
  }
  const drawn = box.joins.filter((j) => j.drawn).length;
  readout.textContent = `${box.name} · ${drawn} ${drawn === 1 ? "line" : "lines"}`;
  card.append(el("p", "Part · confirmed: these lines exist", { class: "ex-card-label" }));
  const h = el("h3", box.name);
  card.append(h, el("p", `Name by ${box.by}`, { class: "ex-by" }));
  card.append(el("blockquote", box.purpose, { class: "ex-quote", "data-by": `${box.by} says what this part is for:` }));
  card.append(el("p", "Plain code checked that these lines exist. It did not check the sentence above.", { class: "ex-muted" }));
  card.append(el("p", `Real lines (${box.lines})`, { class: "ex-card-label" }));
  const ul = el("ul", null, { class: "ex-ranges" });
  for (const s of box.spans) ul.append(el("li", rangeText(s)));
  card.append(ul);
  card.append(el("p", `Joins (${box.joins.length})`, { class: "ex-card-label" }));
  const jl = el("ul", null, { class: "ex-joins" });
  for (const j of box.joins) {
    const li = el("li");
    const other = D.names[j.other] ?? j.other;
    const btn = el("button", other, { class: "ex-join-btn", type: "button" });
    if (byId.has(j.other)) btn.addEventListener("click", () => { touched = true; show(j.other); });
    li.append(el("span", j.dir === "out" ? `${j.kind} → ` : `${j.kind} ← `), btn, el("span", " "), el("span", j.drawn ? (j.status === "code-only" ? "line with tag collars" : "steel line") : "no line", { class: "ex-status", "data-s": j.status }), el("span", ` ${STATUS[j.status]}${j.codeEdges ? ` (${j.codeEdges} code ${j.codeEdges === 1 ? "link" : "links"})` : ""}.`, { class: "ex-muted" }));
    if (j.note) li.append(el("span", ` Plain code's note: ${j.note}.`, { class: "ex-muted" }));
    jl.append(li);
  }
  card.append(jl);
}

for (const h of hits) {
  const id = h.getAttribute("data-hit");
  h.addEventListener("pointerenter", () => { touched = true; show(id); });
  h.addEventListener("click", () => { touched = true; show(id); });
}
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    touched = true;
    const i = picked ? order.indexOf(picked) : -1;
    const n = order.length;
    show(order[(i + (e.key === "ArrowRight" ? 1 : n - 1) + (i < 0 && e.key === "ArrowLeft" ? 1 : 0)) % n]);
  } else if (e.key === "Escape") {
    touched = true;
    show(null);
  }
});
stage.addEventListener("focus", () => { if (!picked) { touched = true; show(order[0]); } });

// idle tour: only while visible, never under reduced motion
let visible = false;
if ("IntersectionObserver" in window) new IntersectionObserver((entries) => { visible = Boolean(entries.at(-1)?.isIntersecting); }).observe(stage);
if (!still) {
  let i = 0;
  setInterval(() => {
    if (touched || !visible) return;
    show(order[i++ % order.length]);
  }, 4000);
}
show(null);
