import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
await p.keyboard.press("Meta+4"); await p.waitForTimeout(700);
const mono = await p.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll(".shell-page.cs-agent, .shell-page *, .bt-popover *")) {
    if (e.children.length) continue;
    const t = e.textContent.trim(); if (!t) continue;
    const s = getComputedStyle(e);
    const isMono = /mono/i.test(s.fontFamily);
    // flag mono text that is NOT purely numeric/price/date data
    const isData = /^[\$\-\+\d.,%RrKk:→\/\s]+$|^\d{4}-\d\d-\d\d|\dR$|^\$|^[\d.]+%?$/.test(t);
    if (isMono && !isData) out.push({ t: t.slice(0, 30), font: s.fontFamily.split(",")[0].replace(/"/g,"") });
  }
  return out;
});
console.log("MONO text that looks like a label (should likely be sans):");
console.log(JSON.stringify(mono, null, 1));
await b.close();
