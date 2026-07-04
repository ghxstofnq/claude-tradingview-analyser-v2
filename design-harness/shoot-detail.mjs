import { chromium } from "playwright";
const OUT = "/private/tmp/claude-501/-Users-anasqatanani-Documents-claude-tradingview-analyser-v2/bf03a9a2-633f-4830-b070-ea6bf4461521/scratchpad";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3500);
await p.keyboard.press("Meta+4"); await p.waitForTimeout(700);
// click BASELINE mode pill
for (const e of await p.$$('.bt-mode')) { if ((await e.textContent()).trim()==="BASELINE"){ await e.click(); break; } }
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/app-bt-baseline2.png` });
// click the first library table row (opens DETAIL)
const row = await p.$('.lib-table tbody tr') || await p.$('.lib-row') || (await p.$$('tbody tr'))[0];
if (row) { await row.click(); await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/app-bt-detail.png` }); console.log("detail captured"); }
else console.log("no run row found");
await b.close();
