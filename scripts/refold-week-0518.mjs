import fs from "node:fs"; import path from "node:path"; import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
function findRun(date,session){const tag=`-${session.replace("ny-","")}-${date}`;return fs.readdirSync("state/backtest").filter(d=>d.includes(tag)).sort().pop();}
async function fold(date,session){const run=findRun(date,session);if(!run)return null;const dir=`state/backtest/${run}/${session}`;if(!fs.existsSync(path.join(dir,"tape.json")))return null;
  const tape=JSON.parse(fs.readFileSync(path.join(dir,"tape.json"),"utf8"));const payloads=JSON.parse(fs.readFileSync(path.join(dir,"brief-payloads.json"),"utf8"));
  let surf=0,booked=0,adds=0,opened=0; const bus=new EventEmitter();const sm=new Map();
  bus.on("backtest:event",e=>{if(e.type==="setup_surfaced"){surf++;sm.set(e.setup.id,e.setup);}else if(e.type==="setup_accepted")opened++;else if(e.type==="setup_outcome"){booked++;const s=sm.get(e.setupId);if(s?.scale_in_add)adds++;}else if(e.type==="paused")bus.emit("backtest:command",{type:"decision",choice:"accept"});});
  const deps={recordEntries:async()=>({entries:tape.entries,warnings:[]}),loadDayContext:async()=>null,runDirectBrief:async()=>contextFromBriefPayloads({session,payloads}),truthFn:bc.buildDeterministicPacketTruthFromInputs,gradeFn:gradeOpenTrade};
  const {summary,runId}=await runBacktest({date:tape.date,session,mode:"auto",bus,stateDir:"state/backtest-refold",deps});
  let rows=[];try{rows=fs.readFileSync(`state/backtest-refold/backtest/${runId}/${session}/setups.jsonl`,"utf8").trim().split("\n").map(JSON.parse);}catch{}
  const opens=rows.filter(r=>r.type==="open").length;
  return {r:summary.total_r,surf,opens,booked,unresolved:opens-booked};}
let week=0;const mode=process.env.TV_SCALEIN==="0"?"ONE-POS":"ADD";
console.log(`\n===== MAY 18-22 (${mode}) =====`);
console.log("session        R     surf opens booked open@end");
for(const date of ["2026-05-18","2026-05-19","2026-05-20","2026-05-21","2026-05-22"]){for(const s of ["ny-am","ny-pm"]){const x=await fold(date,s);if(!x)continue;week+=Number(x.r)||0;console.log(`${date} ${s.padEnd(5)} ${String(x.r).padStart(6)}   ${String(x.surf).padStart(3)}  ${String(x.opens).padStart(4)}  ${String(x.booked).padStart(5)}  ${String(x.unresolved).padStart(6)}`);}}
console.log(`-----\nWEEK (${mode}): ${week.toFixed(2)}R`);
