import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE=process.env.BASE||"http://localhost:8851"; const OUT=process.env.OUT; mkdirSync(OUT,{recursive:true});
for (const [w,h] of [[1280,800],[1440,900]]) {
  const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:w,height:h}})).newPage();
  await p.goto(BASE,{waitUntil:"domcontentloaded"}); await p.waitForSelector('[data-testid^="opt-"]',{timeout:60000}); await p.waitForTimeout(2500);
  await p.screenshot({path:`${OUT}/desk${w}-1-load.png`});
  await p.locator('[data-testid^="opt-"]').first().click(); await p.waitForTimeout(800);
  await p.screenshot({path:`${OUT}/desk${w}-2-picked.png`});
  await p.click('[data-testid="u1-seal"]');
  await p.waitForFunction(()=>/Share proof card/.test(document.body.innerText),null,{timeout:120000}); await p.waitForTimeout(6000);
  await p.screenshot({path:`${OUT}/desk${w}-4-verdict.png`});
  console.log(w, await p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,sh:document.documentElement.scrollHeight,ih:innerHeight})));
  await b.close();
}
