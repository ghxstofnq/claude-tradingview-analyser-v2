import fs from "node:fs";
const base="state/backtest";
const dirs=fs.readdirSync(base).filter(d=>/^2026.*am-2026/.test(d)).sort();
const acc=[];
console.log("=== ACCEPTED days: distance of the chosen primary_draw from 09:30 price ===");
console.log("date       | price  | draw ce | dist | %     | tf/kind/state");
for(const d of dirs){
  const sd=base+"/"+d+"/ny-am";
  let p,b;
  try{p=JSON.parse(fs.readFileSync(sd+"/brief-payloads.json"));}catch(e){continue;}
  const lead=Array.isArray(p)?p[0]:p;
  const draw=lead?.primary_draw;
  if(!draw)continue; // skip no-draw days
  try{b=JSON.parse(fs.readFileSync(sd+"/brief-bundle.json"));}catch(e){continue;}
  const date=d.match(/am-(2026-\d\d-\d\d)/)[1];
  const price=b?.quote?.last ?? b?.pair?.symbols?.["MNQ1!"]?.quote?.last;
  const ce=draw.ce;
  const dist=Math.abs(ce-price);const pct=dist/Math.abs(price);
  acc.push(pct);
  console.log(date,"| "+String(price).padStart(6)+" |",String(ce).padStart(7),"|",String(dist.toFixed(0)).padStart(4),"|",(pct*100).toFixed(2)+"%","|",draw.tf+" "+draw.kind+" "+draw.state);
}
acc.sort((a,b)=>a-b);
const pctile=q=>acc.length?acc[Math.min(acc.length-1,Math.floor(q*acc.length))]:null;
console.log("\\nACCEPTED draw-distance distribution (n="+acc.length+"):");
console.log("  min "+(acc[0]*100).toFixed(2)+"%  median "+(pctile(0.5)*100).toFixed(2)+"%  p90 "+(pctile(0.9)*100).toFixed(2)+"%  max "+(acc[acc.length-1]*100).toFixed(2)+"%");
console.log("  (current band = 0.30%)");
