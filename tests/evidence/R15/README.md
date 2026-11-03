# R15: the live site on a phone, fixed

The live site got traffic from an X post, mostly phones. A phone check of the live build (f876f43) found six problems.
This round fixes them with a phone-only diff: CSS inside phone-only media queries (narrow, or at most 500 px tall: see
"Review round 1"), one small new script, and settings in `fly.toml`. A desktop window is not touched.

Where to look: **the table under "Every finding"**. Shots are in `before/` (this branch's base, f876f43, served locally),
`after/` (this branch), and `live-before/` (the original live check on atlas-dami.fly.dev). Measurements per device are
in `phone-results.txt`. The harness is in `harness/`.

## The one idea behind fixes 1, 2, 4 and 5

The studio was one fixed window made of layers stacked on top of each other: the drawing filled the window, and the bet
panel, the verdict and the foot links were pinned over it. On a desktop there is room beside the drawing. On a phone
there is not, so the panel covered most of the drawing, and the foot covered the button.

On a phone the studio is now an ordinary page that scrolls, top to bottom:
the bar (it stays at the top) → the AI's summary → the drawing at full width → the question and **Lock in my bet** →
the foot links. After the run: the drawing's end state → the verdict → **Share proof card** and the links → the foot.

Three moments scroll the page by themselves (`web/phone-scroll.ts`, phone widths only):
after you pick an answer, the Lock button comes into view; when you lock in and when the run starts, the drawing comes
into view; when the paste box opens, the page starts at its top.

## Every finding

| # | Finding | Before | After | Proof |
|---|---|---|---|---|
| 1 | **Broken.** The run is nearly invisible: after locking in, the drawing is a 105 px strip under the bet panel (30 px in landscape). | Drawing box 105 px tall on iPhone 13 while waiting for the run; the panel covers the rest. | Before the run the drawing gets 220–420 px of its own (36% of the screen, never less than 220 px). During the run it gets the whole screen under the bar (616 px on iPhone 13, 520 on SE, 791 on Pixel 7). In landscape it keeps 400 px and the page scrolls instead of squeezing. The verdict follows below the drawing. | `live-before/iphone13-3-running.png` vs `after/iphone13-3a-running.png`; `after/landscape-3a-running.png`, `after/*-4-verdict.png` |
| 2 | **Broken.** "Lock in my bet" sits under the fixed foot on iPhone 13, SE, the X in-app size and landscape. | Button bottom at 690 px on a 664 px screen (iPhone 13). | The foot is no longer pinned on the studio; after a pick the button is scrolled into view. Measured after picking: visible on all five sizes (iPhone 13 606–648 of 664; SE 510–552 of 568; X in-app 502–544 of 560; landscape 284–326 of 342; Pixel 7 781–823 of 839). | `before/xinapp-2-picked.png` vs `after/xinapp-2-picked.png`; `phone-results.txt` "sealAfterPick" |
| 3 | Summary and test line 12.5 px. | summary 12.5, test 12.5, answers 14, paste box 12.5 px. | summary 16, test 16, answers 16, question 20, paste box and every text input 16 px (iOS Safari zooms the page when you tap a box under 16 px). | `phone-results.txt` "fonts", "pasteFs" |
| 4 | "Earlier screens" clipped on SE. | The fold's list was pinned at the bottom, 300 px wide on a 320 px screen. | On the studio it opens in place, inside the foot, full width. On the other screens it is pinned above the foot within the screen's width. No page on any size is wider than the screen. | `after/iphoneSE-9-earlier.png` |
| 5 | Foot links 17–18 px high. | 94×17, 50×17, 101×17, 78×15. | 114×44, 61×44, 123×44, 94×44 (44 px is Apple's minimum tap size). On the other screens (Moonwell, record) the foot stays pinned: one 51 px row that scrolls sideways, and those screens now end with room for it. | `phone-results.txt` "targets"; `after/iphoneSE-8-moonwell-end.png` |
| 6a | Two phones on one address: "one client address runs at most 2 sandbox run(s) at once". | `ATLAS_SANDBOX_IP_MAX_CONCURRENT` was already a setting (default 2), just not set in `fly.toml`. | `fly.toml` [env] sets it to `"4"`, with a comment. Review round 1 also raised the server-wide cap to 12, Modal's runner to 12, and made the no-code example's own cap (a hard-coded 2) a setting, 8 on Fly: see "Review round 1". The per-session cap (2) and the hourly caps are unchanged. | `tests/unit/r15-phone.test.ts` |
| 6b | A timer read 123.5 s. | | **A display bug, not a real wait. Not fixed (report).** See below. | – |

Every phone size: `document.documentElement.scrollWidth` equals `innerWidth` on load, at the verdict, on the proof card
and on the paste box (390/390, 320/320, 412/412, 750/750, 390/390).

### Also fixed, found while checking

- The proof card opened at the top of the (now long) page; on a phone it is now pinned under the bar, whatever the page's scroll. `after/iphoneSE-5-proof.png`.
- "Try your own code" left the page scrolled to the bottom of the paste screen; it now opens at the top.
- On SE the invite box pushed "Use this code" off the right edge once the box was 16 px; the box now shrinks to fit.

## Desktop is unchanged

1280×800 and 1440×900, before vs after, load / picked / verdict: 0.01–0.21% of pixels differ, and every differing pixel is
inside one box in the top bar (x≈380–733, y 18–29). That box is the line "pasted.ts · 25 lines · drawn in N ms": the
drawing time changes on every load (two loads of the same build read 121 ms and 82 ms). Nothing else moved. Script:
`harness/pxdiff.mjs`. Every R15 rule is inside a phone-only media query, and a test checks that
(`tests/unit/r15-phone.test.ts`).

## Finding 6b: the 123.5 s timer

The seconds counter under "Your bet is locked in." (`SealTags` in `web/screens/Studio.tsx`) starts when you lock in and
ticks every 250 ms. It has no stop: nothing ends it when the run is refused, fails or finishes. So after the
"at most 2 sandbox runs at once" refusal, which comes back at once with nothing run, the counter kept going for as long as
the phone sat on that screen. 123.5 s means "123 s since you locked in", not "the run took 123 s". Fix (not made here,
because `Studio.tsx` is being changed on r14 and r13): stop the counter when the run answers, with a result or a refusal.

## What I did not do, and what is open

- **Sandboxes at once (changed in review round 1).** A run now waits on four caps: 4 per address, 8 for all no-code
  visitors together, 12 for the whole server, and 12 on Modal's runner. One play holds a slot for about 9 s on the live
  phones, so 8 example slots is roughly 50 example plays a minute; the 9th player at the same moment gets "visitors without
  a code already have 8 example runs going at once…; try again in a few seconds". Money stays capped by the example's own
  daily allowance (3,000 starts, 18,000 sandbox-seconds).
- The local server had no Muse Spark Open (no Baseten key) and a $0 ceiling, so the example played with one recorded AI,
  not two. The layout does not depend on that.
- Locally the run starts within a second, so the "waiting for the run" state was not photographed after the fix; its
  layout is the same as the picked state (drawing above, sealed list below). The live shot of that state is in `live-before/`.
- The waitlist link: the local server had no `ATLAS_WAITLIST_URL`, so "Try your own code" showed the invite line
  ("…needs an invite code… I have a code") without the "Join the waitlist" link. That link's code was not changed.
- Not tested on a real device; Playwright WebKit and Chromium device emulation only.
- "any key skips" under the playing drawing still says "key" on a phone.

## How it was checked

A local copy of this branch, built (`vite build`) and served by `server/index.ts` with invites required, a $0 spend
ceiling, the local sandbox and a scratch HOME (so no API key was found): `harness/start-local.sh`. The example's AI
answers are the recorded ones; no model was called and no usage log was written ($0). `harness/r15flow.mjs` plays the
example on five sizes (WebKit iPhone 13 390×664, iPhone SE 320×568, X in-app 390×560, iPhone 13 landscape 750×342;
Chromium Pixel 7 412×839): load, read fonts and tap sizes, pick, check Lock is on screen, lock in, check the drawing during
the run, the verdict, Share proof card, then "Try your own code" and the waitlist line. `harness/r15desk.mjs` takes the
desktop shots; `harness/r15own.mjs` the paste screen and the Moonwell screen's end.

## Checks

On the branch rebased onto main 406b589 (R13 plugin drawing merged), after review round 1:
- `tsc --noEmit`: clean (`tsc.txt`).
- `vitest run`: 173 files passed, 2 skipped; 2,806 tests passed, 35 skipped (`vitest.txt`). The R15 ones are in
  `tests/unit/r15-phone.test.ts` (9 tests).
- After the rebase, the 390×560 run and the 1280×800 / 1440×900 desktop diff were repeated on a fresh build: same
  numbers as above.

## Review round 1 (after the coordinator's review)

| # | Finding | What changed | Proof |
|---|---|---|---|
| 1 | **Major.** No-code visitors shared a hard-coded 2 sandboxes at once (`server/access/ledger.ts`), so the 3rd player anywhere was refused; Modal's runner ran 4 at once, so runs 5–12 queued and the queue time was booked as sandbox-seconds. | `ATLAS_EXAMPLE_MAX_CONCURRENT` (default 2, read in `server/access/setup.ts`), `"8"` in `fly.toml`. `ATLAS_MODAL_MAX_SANDBOXES = "12"`, the same as the server-wide 12. One comment in `fly.toml` explains all four caps together. The dev codes' 3 at once (`ledger.ts`) is left: it is still a safe share of 12. Modal's own account limits: the repo's executor docs (`tests/evidence/E4/README.md`, `runners/executor/modal.ts`) name only Atlas's caps, no Modal account limit; I did not check the Modal account itself (no call made). | `tests/unit/r15-phone.test.ts` "the no-code example's own cap": 8 players start, the 9th gets the plain sentence, one finishing frees a slot; no setting keeps 2; `fly.toml` values |
| 2 | **Major.** Phones on their side wider than 760 px got the desktop layout. | Every phone query in `web/tool.css`, `web/drawing/drawing.css` and `web/machines/bench/bench.css` is now "narrow **or** at most 500 px tall"; the desktop-only ones now also need a height over 500 px. `phone-scroll.ts` uses the same query. A desktop window under 500 px tall now gets the phone layout (accepted). | 915×412, 932×430, 844×390 below; desktop diff unchanged |
| 3 | Stale wording about the 4 cap. | `fly.toml` comment and this README rewritten for 4 / 8 / 12 / 12. | – |
| 4 | No answer visible on first load at 390×560, 750×342, 280 px. | On short phone screens: the summary's attribution line is 13 px, the drawing starts at 26% of the height (150–300 px), the bet's top gap is 12 px and its headline 20 px. Under 420 px tall the headline is dropped and the drawing starts at 120 px. On every phone the open bet's 46 px empty top gap is now 14 px. | below |
| 5 | At 280 px the note under the finished drawing ran off the right edge. | On a phone the drawing's notes wrap at 340 drawing units (`renderer/layout.ts`, narrow layout only), not at the drawing's full width. | `review/narrow-280x653-4-verdict.png` |
| 6 | Auto-scroll on every re-pick, and never on a keyboard pick. | `phone-scroll.ts` now watches the answers' checked state, so a keyboard pick counts, and scrolls to Lock only once per round (a round's Lock button is a new element each round). Lock-in is also detected from the sealed list appearing, so Enter works too. | below: "re-pick" and "keyboard" columns |

Measured on this branch (`harness/r15b.mjs`; y positions in CSS px, viewport height last):

| Size | Question / first answer on load | Lock after first pick | Re-pick moved the page? | Keyboard pick: Lock | Drawing during run | Width = screen |
|---|---|---|---|---|---|---|
| 390×560 (X in-app, WebKit) | 379–404 / 412–450 of 560 | 502–544 | no (94 → 94) | 502–544 | 48–560 | yes |
| 750×342 (landscape, WebKit) | 258–284 / 292–329 of 342 | 284–326 | no | 284–326 | 400 px, page scrolls | yes |
| 280×653 (WebKit) | 456–507 / 515–552 of 653 | 595–637 | no | 595–637 | 48–653 | yes |
| 915×412 (Chromium) | 258–284 / 292–329 of 412 | 354–396 | no | 354–396 | 400 px, page scrolls | yes |
| 932×430 (WebKit) | 316–342 / 350–388 of 430 | 372–414 | no | 372–414 | 400 px, page scrolls | yes |
| 844×390 (WebKit) | 258–284 / 292–329 of 390 | 332–374 | no | 332–374 | 400 px, page scrolls | yes |

Desktop after this round, before vs after: 1280×800 0.02–0.21%, 1440×900 0.02–0.18% of pixels differ, all inside the
"drawn in N ms" box in the top bar, as before. Shots: `review/` (390×560, 915×412, 844×390, 280×653, 1280×800).

Still open: at 280 px the drawing's side note beside the end box ("you said…") still runs off the right; it is laid
out by the renderer beside the box and needs a renderer change to move.
