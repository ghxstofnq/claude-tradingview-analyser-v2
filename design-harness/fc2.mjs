import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
await p.keyboard.press("Meta+4"); await p.waitForTimeout(700);
const r = await p.evaluate(() => {
  const all = [...document.querySelectorAll(".bt-popover *")].filter((e) => e.children.length === 0 && e.textContent.trim());
  const grab = (txt) => { const e = all.find((x) => x.textContent.trim() === txt); if (!e) return null; const s = getComputedStyle(e); return `${s.fontFamily.split(",")[0].replace(/"/g,'')} ${s.fontSize} w${s.fontWeight} ${s.color}`; };
  return {
    title: grab("Backtest"),
    sub: grab("record · fold · compare"),
    clickHint: grab("click a run for detail"),
    footerHint: grab("records from the chart"),
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
