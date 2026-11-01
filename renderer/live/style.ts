// R3: the drawing's stylesheet, as text, so a Worker-built SVG, a preview page and a saved SVG all share it.
// One palette: ink, paper, one red, two pencils (ochre, slate blue). Dark mode is the same drawing on dark paper.
import { TRACKING } from "../words";

/** The self-hosted font pair (Besley, SIL OFL 1.1; renderer/fonts). Pass URLs your bundler gives you. */
export function fontFaceCss(regularUrl: string, italicUrl: string): string {
  return `@font-face{font-family:"Atlas Besley";src:url("${regularUrl}") format("woff2");font-style:normal;font-weight:400;font-display:block}
@font-face{font-family:"Atlas Besley";src:url("${italicUrl}") format("woff2");font-style:italic;font-weight:400;font-display:block}`;
}

export const RENDERER_CSS = `
.rr-host{--rr-paper:#f5f1e7;--rr-ink:#1f1b1d;--rr-soft:#5d5650;--rr-card:#fdfaf2;--rr-red:#a8443b;--rr-red-pen:#b93a30;--rr-ochre:#d9a441;--rr-blue:#5f8fb0;
--rr-pencil-cream:#dcc594;--rr-pencil-blue:#8fb2c9;--rr-pencil-ochre:#d6ab59;--rr-tick:#4d4448;--rr-fibre:#b9ab92;--rr-speck:#a4977f;--rr-tape:#e9e1c4;--rr-pin-paper:#fdfaf2;--rr-glint:#fff8ea;--rr-thread-off:#2c2628;
position:relative;overflow:hidden;background:var(--rr-paper);touch-action:none;user-select:none;-webkit-user-select:none;contain:content}
.rr-host[data-theme="dark"]{--rr-paper:#211d1a;--rr-ink:#ece4d4;--rr-soft:#a79d8e;--rr-card:#2b2622;--rr-red:#e0695a;--rr-red-pen:#ea7263;--rr-ochre:#d9a441;--rr-blue:#7fb0d0;
--rr-pencil-cream:#5a4c35;--rr-pencil-blue:#3f6079;--rr-pencil-ochre:#8f6f33;--rr-tick:#7b7064;--rr-fibre:#3a332c;--rr-speck:#463e35;--rr-tape:#4a4234;--rr-pin-paper:#2b2622;--rr-glint:#f5ead6;--rr-thread-off:#cfc6b6}
.rr{display:block;font-family:"Atlas Besley",Georgia,serif;font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision;cursor:grab;width:100%;height:100%}
.rr:active{cursor:grabbing}
.rr-t{fill:var(--rr-ink);direction:ltr;unicode-bidi:isolate;white-space:pre;pointer-events:none}
.rr-r{font-style:normal;letter-spacing:${TRACKING.regular}em}
.rr-i{font-style:italic;letter-spacing:${TRACKING.italic}em}
.rr-small{fill:var(--rr-red)}
.rr-soft,.rr-kicker,.rr-caption{fill:var(--rr-soft)}
.rr-sheet{fill:var(--rr-paper)}
.rr-fibre{fill:none;stroke:var(--rr-fibre);stroke-width:.5;opacity:.17}
.rr-speck{fill:none;stroke:var(--rr-speck);stroke-width:.7;opacity:.3}
.rr-ink,.rr-ink-fill{fill:var(--rr-ink)}
.rr-card{fill:var(--rr-card)}
.rr-tick{fill:none;stroke:var(--rr-tick);stroke-width:.62;stroke-linecap:round;opacity:.9}
.rr-pencil{fill:none;stroke-linecap:round;stroke-width:1.15;opacity:.62}
.rr-pencil-cream{stroke:var(--rr-pencil-cream);opacity:.85}
.rr-pencil-blue{stroke:var(--rr-pencil-blue);opacity:.5}
.rr-pencil-ochre{stroke:var(--rr-pencil-ochre);opacity:.72}
.rr-rule{fill:var(--rr-red);opacity:.85}
.rr-pin-paper{fill:var(--rr-pin-paper)}
.rr-pin-red{fill:var(--rr-red-pen)}
.rr-pin-ochre{fill:var(--rr-ochre)}
.rr-pin-blue{fill:var(--rr-blue)}
.rr-pin-shade{fill:none;stroke:#1f1b1d;stroke-width:.55;opacity:.28;stroke-linecap:round}
.rr-pin-glint{fill:var(--rr-glint);opacity:.95}
.rr-screw{fill:var(--rr-ink);opacity:.75}
.rr-lamp-base{fill:var(--rr-card)}
.rr-lamp{fill:var(--rr-paper);transition:fill .12s linear}
.rr-node.rr-lit .rr-lamp{fill:var(--rr-red-pen)}
.rr-node[data-lamp="ok"] .rr-lamp{fill:var(--rr-ochre)}
.rr-dial{fill:none;stroke:var(--rr-ink);stroke-width:.9;stroke-linecap:round}
.rr-hand-line{fill:none;stroke:var(--rr-ink);stroke-width:1.7;stroke-linecap:round}
.rr-line,.rr-head{fill:var(--rr-thread-off)}
.rr-on-path .rr-line,.rr-on-path .rr-head{fill:var(--rr-red)}
.rr-spine{fill:none;stroke:transparent;stroke-width:14;pointer-events:stroke}
.rr-dash{fill:none;stroke:var(--rr-soft);stroke-width:1.15;stroke-dasharray:1.5 6.5;stroke-linecap:round}
.rr-missing{fill:none;stroke:var(--rr-red);stroke-width:1.5;stroke-dasharray:7 6;stroke-linecap:round}
.rr-tape{fill:var(--rr-tape);opacity:.9;stroke:var(--rr-tick);stroke-width:.4}
.rr-region-line{fill:var(--rr-soft);opacity:.72}
.rr-node{cursor:pointer;outline:none}
.rr-node:focus-visible .rr-settle{filter:drop-shadow(0 0 3px var(--rr-red))}
.rr-settle{transform-box:view-box}
.rr-mark-tick{fill:var(--rr-blue)}
.rr-mark-ring{fill:var(--rr-red-pen)}
.rr-mark-cant{fill:none;stroke:var(--rr-soft);stroke-width:1.4;stroke-dasharray:5 6;stroke-linecap:round}
.rr-mark-spine{fill:none;stroke:none}
.rr-spark{fill:none;stroke:var(--rr-blue);stroke-width:1.15;stroke-linecap:round}
.rr-mark-words{fill:var(--rr-ink)}
.rr-mark-didnt-match .rr-mark-words{fill:var(--rr-red)}
.rr-dim{opacity:.26;transition:opacity .35s ease}
.rr-undim{opacity:1;transition:opacity .35s ease}
.rr-calm .rr-settle>*:not(text),.rr-calm .rr-line,.rr-calm .rr-head{opacity:.38;transition:opacity .7s ease}
.rr-calm .rr-t{fill:var(--rr-soft);transition:fill .7s ease}
.rr-hover .rr-edge:not(.rr-near),.rr-hover .rr-node:not(.rr-near),.rr-hover .rr-label:not(.rr-near){opacity:.28;transition:opacity .16s linear}
.rr-tag-words{fill:#8a6420}
.rr-host[data-theme="dark"] .rr-tag-words{fill:#d9b264}
.rr-quiet .rr-edge{opacity:.3;transition:opacity .18s linear}
.rr-quiet .rr-label{opacity:.55;transition:opacity .18s linear}
.rr-quiet.rr-hover .rr-edge.rr-near,.rr-quiet.rr-hover .rr-label.rr-near{opacity:1}
.rr-quiet.rr-hover .rr-edge:not(.rr-near){opacity:.1}
.rr-quiet.rr-hover .rr-label:not(.rr-near){opacity:.12}
.rr-pending{visibility:hidden}
.rr-nib{fill:var(--rr-red);pointer-events:none}
.rr-edge:not(.rr-on-path) .rr-nib{fill:var(--rr-thread-off)}
.rr-list{padding:28px;font:16px/1.5 "Atlas Besley",Georgia,serif;color:var(--rr-ink);overflow:auto;height:100%;box-sizing:border-box;user-select:text;-webkit-user-select:text;touch-action:auto}
.rr-list h2{font-weight:400;font-size:24px;margin:0 0 4px}
.rr-list p{font-style:italic;color:var(--rr-soft);margin:0 0 16px}
.rr-list ul{margin:0;padding-left:20px}
@media (prefers-reduced-motion:reduce){.rr-dim,.rr-undim,.rr-calm *,.rr-lamp{transition:none}}
`;

