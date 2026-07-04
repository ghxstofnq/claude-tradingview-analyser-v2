import { chromium } from "playwright";
const OUT = "/private/tmp/claude-501/-Users-anasqatanani-Documents-claude-tradingview-analyser-v2/bf03a9a2-633f-4830-b070-ea6bf4461521/scratchpad";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3500);
await p.keyboard.press("Meta+4"); await p.waitForTimeout(700);
async function clickMode(label){ const el = await p.$(`.bt-mode:has-text("${label}")`) || (await p.$$('.bt-mode')).find(async e=>await e.textContent()===label); const els=await p.$$('.bt-mode'); for(const e of els){ if((await e.textContent()).trim()===label){ await e.click(); return true; } } return false; }
await clickMode("BASELINE"); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/app-bt-baseline.png` });
await clickMode("COMPARE"); await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}/app-bt-compare.png` });
await b.close(); console.log("done");
