import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
await p.keyboard.press("Meta+4"); await p.waitForTimeout(700);
const r = await p.evaluate(() => {
  const all=[...document.querySelectorAll(".bt-popover *")].filter(e=>e.children.length===0&&e.textContent.trim());
  const g=(t)=>{const e=all.find(x=>x.textContent.trim()===t);if(!e)return null;const s=getComputedStyle(e);return `${s.fontFamily.split(",")[0].replace(/"/g,'')} ${s.fontSize} ${s.color}`;};
  return { hint1:g("records from the chart"), hint2:g("click a run for detail"), corpusLabel:g("CORPUS"), footerMap:g("⌘4 Backtest") };
});
console.log(JSON.stringify(r,null,2));
await b.close();
