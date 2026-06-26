import fs from "node:fs";
import { arrayVote } from "../cli/lib/pillar1-bias.js";
const base="state/backtest";
const dirs=fs.readdirSync(base).filter(d=>/^2026.*am-2026/.test(d)).sort();
console.log("date       | price  | nearest VOTABLE htf array (live vote + took_liq + significant) | dist |  %    | @0.3 0.5 0.7");
for(const d of dirs){
  const sd=base+"/"+d+"/ny-am";
  let s,b;
  try{s=JSON.parse(fs.readFileSync(sd+"/summary.json"));}catch(e){continue;}
  if(!String(s.chain_status||"").startsWith("no_context"))continue;
  try{b=JSON.parse(fs.readFileSync(sd+"/brief-bundle.json"));}catch(e){continue;}
  const date=d.match(/am-(2026-\d\d-\d\d)/)[1];
  const price=b?.quote?.last ?? b?.pair?.symbols?.["MNQ1!"]?.quote?.last;
  let best=null;
  for(const tf of ["daily","h4","h1"]){
    for(const f of (b?.engine_by_tf?.[tf]?.fvgs||[])){
      if(arrayVote(f).vote==="none")continue;
      if(f.took_liq!==true)continue;
      const dist=Math.abs(f.ce-price);
      if(best===null||dist<best.dist)best={tf,ce:f.ce,dist,kind:f.kind,state:f.state,pct:dist/Math.abs(price)};
    }
  }
  if(!best){console.log(date,"| "+String(price).padStart(6)+" | (NONE votable at ANY distance)");continue;}
  const q=p=>best.pct<=p?"Y":"-";
  console.log(date,"| "+String(price).padStart(6)+" |",(best.tf+" "+best.kind+" "+best.state).padEnd(22),"ce="+best.ce,"|",String(best.dist.toFixed(0)).padStart(5),"|",(best.pct*100).toFixed(2)+"%","| ",q(0.003)," ",q(0.005)," ",q(0.007));
}
