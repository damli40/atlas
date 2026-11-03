// R15 review: short and wide phone screens. Per size: question + first answer visible on load; first pick scrolls Lock
// into view; a re-pick does not scroll; keyboard pick works; drawing on screen during the run; verdict; widths.
import { chromium, webkit, devices } from "playwright";
import { mkdirSync } from "node:fs";
const BASE=process.env.BASE||"http://localhost:8851"; const OUT=process.env.OUT; mkdirSync(OUT,{recursive:true});
const ip13=devices["iPhone 13"];
const mk=(w,h)=>({...ip13,viewport:{width:w,height:h},screen:{width:w,height:h}});
const cfgs=[["xinapp-390x560",webkit,mk(390,560)],["landscape-750x342",webkit,devices["iPhone 13 landscape"]],["narrow-280x653",webkit,mk(280,653)],
 ["landscape-915x412",chromium,{viewport:{width:915,height:412},isMobile:true,hasTouch:true,deviceScaleFactor:2.6}],
 ["landscape-932x430",webkit,mk(932,430)],["landscape-844x390",webkit,mk(844,390)]];
const only=process.argv[2];
for (const [name,eng,opts] of cfgs){
  if(only&&!name.startsWith(only))continue;
  const out={name}; const b=await eng.launch(); const ctx=await b.newContext(opts); const p=await ctx.newPage();
  const shot=n=>p.screenshot({path:`${OUT}/${name}-${n}.png`});
  const box=sel=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{top:Math.round(r.top),bottom:Math.round(r.bottom),ih:innerHeight,onScreen:r.top>=0&&r.bottom<=innerHeight+0.5}},sel);
  try{
    await p.goto(BASE,{waitUntil:"domcontentloaded"}); await p.waitForSelector('[data-testid^="opt-"]'); await p.waitForTimeout(1800);
    await shot("1-load");
    out.layout=await p.evaluate(()=>getComputedStyle(document.querySelector(".u1-shell")).position);
    out.qOnLoad=await box(".u1-q"); out.firstAnswerOnLoad=await box('[data-testid^="opt-"]');
    out.widthLoad=await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);
    await p.locator('[data-testid^="opt-"]').first().tap(); await p.waitForTimeout(1200);
    out.sealAfterFirstPick=await box('[data-testid="u1-seal"]');
    await shot("2-picked");
    // re-pick: scroll back up a bit, pick another; the page must not jump
    await p.evaluate(()=>window.scrollBy(0,-80)); await p.waitForTimeout(300);
    const y0=await p.evaluate(()=>scrollY);
    await p.locator('[data-testid^="opt-"]').nth(1).tap(); await p.waitForTimeout(1000);
    out.repickScroll=[y0,await p.evaluate(()=>scrollY)];
    const seal=p.locator('[data-testid="u1-seal"]'); await seal.scrollIntoViewIfNeeded(); await seal.tap();
    await p.waitForTimeout(1500); out.stageDuringRun=await box('[data-testid="bench-stage"]'); await shot("3-running");
    await p.waitForFunction(()=>/Share proof card/.test(document.body.innerText),null,{timeout:120000}); await p.waitForTimeout(4000);
    await shot("4-verdict");
    out.verdict=await box(".m-verdict"); out.widthVerdict=await p.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);
    out.cutRight=await p.evaluate(()=>[...document.querySelectorAll(".u1-marks *, .u1-actions *, .m-act-step, .r-step, .r-skip, .m-loop")].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(e).position!=="fixed"}).slice(0,6).map(e=>(e.className||e.tagName)+":"+Math.round(e.getBoundingClientRect().right)));
    await p.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight)); await p.waitForTimeout(400); await shot("5-end");
  }catch(e){out.err=String(e).slice(0,300);await shot("err").catch(()=>{});}
  // keyboard pick on a fresh page (first pick by key still brings Lock into view)
  try{
    const k=await ctx.newPage(); await k.goto(BASE,{waitUntil:"domcontentloaded"}); await k.waitForSelector('[data-testid^="opt-"]'); await k.waitForTimeout(1500);
    await k.locator('[data-testid^="opt-"]').first().focus(); await k.keyboard.press("Space"); await k.waitForTimeout(1200);
    out.keyboardPick=await k.evaluate(()=>{const o=document.querySelector('[data-testid^="opt-"]');const s=document.querySelector('[data-testid="u1-seal"]').getBoundingClientRect();return{checked:o.getAttribute("aria-checked"),sealTop:Math.round(s.top),sealBottom:Math.round(s.bottom),ih:innerHeight}});
  }catch(e){out.errKey=String(e).slice(0,200)}
  console.log(JSON.stringify(out)); await b.close();
}
