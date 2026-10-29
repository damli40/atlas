// U1: the Anatomy line-end check (scripts/lines via drive.mjs) on the live app in four states: rest, selected (test chosen),
// mid-run (a lamp lit, the needle turning, slowed 20x) and marked. Prints the actions JSON for one theme.
// Run: node tests/evidence/U1/lines-actions.mjs <dark|light> <out dir> > a.json; node ~/.claude/skills/anatomy/scripts/drive.mjs <url> --actions a.json --width 1920 --height 1080 --theme <t>

const theme = process.argv[2]; const dir = process.argv[3];
const q = (s) => `document.querySelector(${JSON.stringify(s)})`;
const a = [
  ["until", q('[data-testid="u1-example"]'), 20000],
  ["click", '[data-testid="u1-example"]'],
  ["until", q(".u1-svg svg"), 60000], ["wait", 600],
  ["lines", `${dir}/rest-${theme}.png`, ".u1-root"],
  ["click", '[data-testid="u1-bet-toggle"]'],
  ["until", `${q("[data-lamp]")} && ${q('[data-testid="u1-seal"]')}`, 60000], ["wait", 600],
  ["lines", `${dir}/selected-${theme}.png`, ".u1-root"],
  ["eval", `${q('[data-testid="opt-outcome-a"]')}.click()`], ["eval", `${q('[data-testid="opt-calls:fetchIt-c"]')}.click()`], ["eval", `${q('[data-testid="opt-virtualMs-d"]')}.click()`],
  ["eval", `${q('[data-testid="u1-seal"]')}.click()`],
  ["until", q("[data-lamp][data-on]"), 60000], ["slow", 0.05],
  ["lines", `${dir}/mid-${theme}.png`, ".u1-root"],
  ["until", `${q('[data-phase="marked"]')}`, 60000], ["wait", 400],
  ["lines", `${dir}/marked-${theme}.png`, ".u1-root"],
];
console.log(JSON.stringify(a));
