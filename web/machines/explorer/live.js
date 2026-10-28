// X2 demo page, live layer: pick a box (hover, click, Tab, arrows); it and its lines light up, the boxes at the
// other ends stay plain, everything else steps back. The card shows the part in the model's words, its real lines
// and its joins with their status. Every model sentence is written with textContent, never as HTML. Idle tour:
// one box every 4 s until the reader touches the figure; none under reduced motion or while offscreen.
// The shared picking rule is web/machines/explorer/pick.ts (the app screen); this file restates it for the
// standalone page, which has no bundler.
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

function el(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function show(id) {
  picked = id;
  const box = id ? byId.get(id) : null;
  const lit = new Set(box ? box.joins.filter((j) => j.drawn).map((j) => j.id) : []);
  const rel = new Set(box ? box.joins.filter((j) => j.drawn).map((j) => j.other) : []);
  for (const it of items) {
    const of = it.getAttribute("data-of");
    const line = it.getAttribute("data-line");
    const on = Boolean(box) && ((of === id && !line) || (line !== null && lit.has(line)));
    it.classList.toggle("on", on);
    it.classList.toggle("rel", Boolean(box) && !on && of !== null && !line && rel.has(of));
  }
  if (box) root.setAttribute("data-picked", id);
  else root.removeAttribute("data-picked");
  card.replaceChildren();
  if (!box) {
    readout.textContent = total;
    card.append(el("p", "Pick a box", { class: "ex-card-label" }), el("p", "Hover, click or Tab to a box to see its part.", { class: "ex-muted" }));
    return;
  }
  const drawn = box.joins.filter((j) => j.drawn).length;
  readout.textContent = `${box.name} · ${drawn} ${drawn === 1 ? "line" : "lines"}`;
  card.append(el("p", "Part · lines confirmed", { class: "ex-card-label" }), el("h3", box.name), el("p", `Name by ${box.by}`, { class: "ex-by" }));
  card.append(el("blockquote", box.purpose, { class: "ex-quote", "data-by": `${box.purposeBy} says what this part is for:` }));
  card.append(el("p", "Plain code checked that these lines exist, on whole definitions. It did not check the sentence above.", { class: "ex-muted" }));
  card.append(el("p", `Real lines (${box.lines})`, { class: "ex-card-label" }));
  const ul = el("ul", null, { class: "ex-ranges" });
  for (const s of box.spans) ul.append(el("li", s));
  card.append(ul);
  if (D.commit) card.append(el("p", `${D.source} at commit ${D.commit}`, { class: "ex-muted ex-commit" }));
  card.append(el("p", `Joins (${box.joins.length})`, { class: "ex-card-label" }));
  const jl = el("ul", null, { class: "ex-joins" });
  for (const j of box.joins) {
    const li = el("li");
    const btn = el("button", j.otherName, { class: "ex-join-btn", type: "button" });
    if (byId.has(j.other)) btn.addEventListener("click", () => { touched = true; show(j.other); });
    li.append(el("span", `${j.kind} ${j.dir === "out" ? "→" : "←"} `), btn, el("span", " "), el("span", j.drawn ? (j.status === "code-only" ? "line with tag collars" : j.typeOnly ? "braided line" : "steel line") : "no line", { class: "ex-status", "data-s": j.status }), el("span", ` ${j.words}${j.codeEdges ? ` (${j.codeEdges} code ${j.codeEdges === 1 ? "link" : "links"})` : ""}.`, { class: "ex-muted" }));
    if (j.note) li.append(el("span", ` Plain code's note: ${j.note}.`, { class: "ex-muted" }));
    jl.append(li);
  }
  card.append(jl);
  card.append(el("p", `Bet on a function (${box.bets.length})`, { class: "ex-card-label" }));
  if (box.bets.length === 0) card.append(el("p", "No exported function in these lines.", { class: "ex-muted" }));
  else {
    card.append(el("p", "This saved page has no server. In the Atlas app, a function here opens the paste flow with its file and the function picked.", { class: "ex-muted" }));
    const bl = el("ul", null, { class: "ex-joins" });
    for (const b of box.bets) bl.append(el("li", `${b.name} · ${b.path}:${b.line}${b.ok ? "" : ` (not offered: ${b.why})`}`));
    card.append(bl);
  }
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
    const next = i < 0 ? (e.key === "ArrowRight" ? 0 : n - 1) : (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
    show(order[next]);
  } else if (e.key === "Escape") {
    touched = true;
    show(null);
  }
});

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
