import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/node_modules/");
const { loadImage, createCanvas } = require("@napi-rs/canvas");
const [a,b]=process.argv.slice(2);
const ia=await loadImage(a), ib=await loadImage(b);
if (ia.width!==ib.width||ia.height!==ib.height){console.log("SIZE DIFFERS",ia.width,ia.height,ib.width,ib.height);process.exit(0)}
const g=(i)=>{const c=createCanvas(i.width,i.height);const x=c.getContext("2d");x.drawImage(i,0,0);return x.getImageData(0,0,i.width,i.height).data};
const da=g(ia), db=g(ib); let n=0,x0=1e9,y0=1e9,x1=0,y1=0;
for(let i=0;i<da.length;i+=4){if(Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2])>24){n++;const p=i/4,x=p%ia.width,y=(p-x)/ia.width;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}}
console.log(`${b.split("/").pop()}: ${n} of ${ia.width*ia.height} pixels differ (${(100*n/(ia.width*ia.height)).toFixed(3)}%) box ${x0},${y0}-${x1},${y1}`);
