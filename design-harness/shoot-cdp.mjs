import { chromium } from "playwright";

const OUT = "/private/tmp/claude-501/-Users-anasqatanani-Documents-claude-tradingview-analyser-v2/bf03a9a2-633f-4830-b070-ea6bf4461521/scratchpad";
const browser = await chromium.connectOverCDP("http://localhost:9223");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("localhost:5173"));
if (!page) { console.log("no renderer page"); process.exit(1); }
// Linked <link> CSS isn't hot-swapped by Vite — reload so CSS edits show.
await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(3500);

async function esc() { await page.keyboard.press("Escape"); await page.waitForTimeout(300); }
async function shot(n) { await page.screenshot({ path: `${OUT}/live-${n}.png` }); }

await esc();
for (const [k, name] of [["2", "live"], ["4", "backtest"], ["5", "agent"], ["1", "briefing"], ["3", "review"], ["7", "system"]]) {
  await page.keyboard.press(`Meta+${k}`); await page.waitForTimeout(700); await shot(`pg-${name}`); await esc();
}
await esc();
await browser.close();
console.log("done");
