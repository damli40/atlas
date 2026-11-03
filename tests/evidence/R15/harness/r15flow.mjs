import { chromium, webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const BASE=process.env.BASE||"http://localhost:8851";
const OUT=process.env.OUT; mkdirSync(OUT,{recursive:true});
const cfgs=[
 ["iphone13",webkit,{...devices["iPhone 13"]}],
 ["iphoneSE",webkit,{...devices["iPhone SE"]}],
 ["pixel7",chromium,{...devices["Pixel 7"]}],
 ["landscape",webkit,{...devices["iPhone 13 landscape"]}],
 ["xinapp",webkit,{...devices["iPhone 13"],viewport:{width:390,height:560},screen:{width:390,height:844}}],
];
const only=process.argv[2];
const all={};
for(const [name,eng,opts] of cfgs){
 if(only&&only!==name)continue;
 const out={name};
 const b=await eng.launch();
 const ctx=await b.newContext(opts);
 const p=await ctx.newPage();
 const shot=async n=>p.screenshot({path:`${OUT}/${name}-${n}.png`}).catch(e=>{});
 const ov=async()=>p.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth}));
 const inView=(sel)=>p.evaluate((sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return{top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height),ih:innerHeight,visible:r.top>=0&&r.bottom<=innerHeight}},sel);
 try{
 await p.goto(BASE,{waitUntil:"domcontentloaded"});
 await p.waitForSelector('[data-testid="file-summary-text"]',{timeout:60000});
 await p.waitForSelector('[data-testid^="opt-"]',{timeout:60000});
 await p.waitForTimeout(1500);
 await shot("1-load");
 out.overflow1=await ov();
 out.fonts=await p.evaluate(()=>{const fs=s=>{const e=document.querySelector(s);return e?getComputedStyle(e).fontSize:null};return{sum:fs('[data-testid="file-summary-text"]'),sumK:fs('.m-summary-k'),test:fs('[data-testid="u1-test"]'),q:fs('.u1-q'),opt:fs('[data-testid^="opt-"]')}});
 out.targets=await p.evaluate(()=>[...document.querySelectorAll('.u1-foot .u1-link,.u1-foot summary,[data-testid="u1-seal"]')].map(e=>{const r=e.getBoundingClientRect();return (e.getAttribute("data-testid")||e.textContent.trim().slice(0,14))+":"+Math.round(r.width)+"x"+Math.round(r.height)}));
 out.footPos=await p.evaluate(()=>{const f=document.querySelector(".u1-foot");return f&&getComputedStyle(f).position});
 await p.locator('[data-testid^="opt-"]').first().tap();
 await p.waitForTimeout(900);
 await shot("2-picked");
 out.sealAfterPick=await inView('[data-testid="u1-seal"]');
 const seal=p.locator('[data-testid="u1-seal"]');
 await seal.scrollIntoViewIfNeeded();
 await seal.tap();
 await p.waitForTimeout(1500); await shot("3a-running");
 out.machineDuringRun=await inView('[data-testid="machine-region"]');
 out.svgDuringRun=await inView('[data-testid="machine-region"] svg');
 await p.waitForTimeout(2500); await shot("3-running");
 out.svgDuringRun2=await inView('[data-testid="machine-region"] svg');
 await p.waitForFunction(()=>/Share proof card/.test(document.body.innerText),null,{timeout:120000});
 await p.waitForTimeout(3000); await shot("4-verdict");
 out.overflowVerdict=await ov();
 out.verdict=await inView('.m-verdict');
 out.timerText=await p.evaluate(()=>document.querySelector('[data-testid="b-seal-time"]')?.textContent??null);
 const share=p.getByText("Share proof card").first();
 await share.scrollIntoViewIfNeeded(); await share.tap();
 await p.waitForSelector('[data-testid="proof-card"]',{timeout:30000});
 await p.waitForTimeout(2000); await shot("5-proof");
 out.overflowProof=await ov();
 }catch(e){out.err=String(e).slice(0,300);await shot("err");}
 try{
 const p2=await ctx.newPage();
 await p2.goto(BASE,{waitUntil:"domcontentloaded"});
 await p2.waitForSelector('[data-testid="u1-own"]',{timeout:60000});
 await p2.waitForTimeout(1500);
 const own=p2.locator('[data-testid="u1-own"]'); await own.scrollIntoViewIfNeeded(); await own.tap();
 await p2.waitForTimeout(2000);
 await p2.screenshot({path:`${OUT}/${name}-6-own.png`});
 out.waitlistLine=await p2.evaluate(()=>(document.querySelector('.e-needs-code')?.textContent)??null);
 out.overflowOwn=await p2.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth}));
 const ta=p2.locator("textarea").first();
 if(await ta.count()){out.pasteFs=await ta.evaluate(e=>getComputedStyle(e).fontSize)}
 // earlier screens open
 const sum=p2.locator('.u1-foot .u1-earlier>summary');
 if(await sum.count()){await p2.goto(BASE,{waitUntil:"domcontentloaded"});await p2.waitForSelector('[data-testid^="opt-"]',{timeout:60000});await p2.waitForTimeout(1000);
   const s2=p2.locator('.u1-foot .u1-earlier>summary'); await s2.scrollIntoViewIfNeeded(); await s2.tap(); await p2.waitForTimeout(600);
   await p2.screenshot({path:`${OUT}/${name}-9-earlier.png`});
   out.earlier=await p2.evaluate(()=>{const u=document.querySelector('.u1-foot .u1-earlier ul');if(!u)return null;const r=u.getBoundingClientRect();return{left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),iw:innerWidth,ih:innerHeight,sw:document.documentElement.scrollWidth}});}
 }catch(e){out.err2=String(e).slice(0,300)}
 all[name]=out;
 console.log(JSON.stringify(out));
 await b.close();
}
writeFileSync(`${OUT}/results${only?"-"+only:""}.json`,JSON.stringify(all,null,1));
