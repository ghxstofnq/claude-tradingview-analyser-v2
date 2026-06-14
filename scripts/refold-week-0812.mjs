import fs from "node:fs"; import path from "node:path"; import { EventEmitter } from "node:events";
import { runBacktest } from "../app/main/backtest-engine.js";
import { contextFromBriefPayloads } from "../app/main/backtest-context.js";
import { gradeOpenTrade } from "../app/main/backtest-grader.js";
import { __test as bc } from "../app/main/bar-close.js";
const PIN={"2026-06-09:ny-am":"20260612-212913-am-2026-06-09","2026-06-10:ny-am":"20260612-213101-am-2026-06-10","2026-06-11:ny-am":"20260612-213401-am-2026-06-11","2026-06-11:ny-pm":"20260612-213639-pm-2026-06-11"};
function findRun(date,session){const k=`${date}:${session}`;if(PIN[k])return PIN[k];const tag=`-${session.replace("ny-","")}-${date}`;return fs.readdirSync("state/backtest").filter(d=>d.includes(tag)).sort().pop();}
async function fold(date,session){const run=findRun(date,session);if(!run)return null;const dir=`state/backtest/${run}/${session}`;if(!fs.existsSync(path.join(dir,"tape.json")))return null;
  const tape=JSON.parse(fs.readFileSync(path.join(dir,"tape.json"),"utf8"));const payloads=JSON.parse(fs.readFileSync(path.join(dir,"brief-payloads.json"),"utf8"));
  const surfaced=new Map();const booked=[];const bus=new EventEmitter();
  bus.on("backtest:event",e=>{if(e.type==="setup_surfaced")surfaced.set(e.setup.id,e.setup);else if(e.type==="setup_outcome"){const s=surfaced.get(e.setupId)||{};const risk=Math.abs(s.entry-s.stop);const r=e.outcome==="tp1_hit"?Math.abs(e.exit-s.entry)/risk:e.outcome==="stop_hit"?-1:0;booked.push({add:!!s.scale_in_add,r:Number(r.toFixed(2))});}else if(e.type==="paused")bus.emit("backtest:command",{type:"decision",choice:"accept"});});
  const deps={recordEntries:async()=>({entries:tape.entries,warnings:[]}),loadDayContext:async()=>null,runDirectBrief:async()=>contextFromBriefPayloads({session,payloads}),truthFn:bc.buildDeterministicPacketTruthFromInputs,gradeFn:gradeOpenTrade};
  const {summary}=await runBacktest({date:tape.date,session,mode:"auto",bus,stateDir:"state/backtest-refold",deps});
  return {r:summary.total_r,booked};}
let week=0;const mode=process.env.TV_SCALEIN==="0"?"ONE-POSITION":"ADD SYSTEM";
console.log(`\n===== JUNE 8-12 (${mode}) =====`);
for(const date of ["2026-06-08","2026-06-09","2026-06-10","2026-06-11","2026-06-12"]){for(const session of ["ny-am","ny-pm"]){const x=await fold(date,session);if(!x)continue;week+=Number(x.r)||0;const adds=x.booked.filter(b=>b.add).length;console.log(`${date} ${session.padEnd(5)} ${String(x.r).padStart(7)}R  ${x.booked.length}tr${adds?` (${adds} adds)`:""}`);}}
console.log(`-----------------------------\nWEEK (${mode}): ${week.toFixed(2)}R`);
