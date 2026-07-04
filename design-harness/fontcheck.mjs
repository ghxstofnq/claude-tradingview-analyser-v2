import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
await p.keyboard.press("Meta+4"); await p.waitForTimeout(700);
const r = await p.evaluate(() => {
  const find = (txt) => [...document.querySelectorAll(".bt-popover *")].find((e) => e.children.length === 0 && e.textContent.trim() === txt);
  const rep = (txt) => { const e = find(txt); if (!e) return { txt, missing: true }; const s = getComputedStyle(e); return { txt, font: s.fontFamily.split(",")[0], size: s.fontSize, ls: s.letterSpacing, color: s.color, weight: s.fontWeight }; };
  return {
    configure: rep("CONFIGURE RECORD"),
    symbol: rep("SYMBOL"),
    recordsHint: rep("records from the chart"),
    metricLabel: rep("A+ HIT RATE"),
    colHead: rep("DATE"),
    libLabel: rep("LIBRARY"),
    clickHint: rep("click a run for detail"),
  };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
