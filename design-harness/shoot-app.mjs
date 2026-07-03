import { chromium } from "playwright";

const APP = "http://localhost:5173";
const OUT = "/private/tmp/claude-501/-Users-anasqatanani-Documents-claude-tradingview-analyser-v2/bf03a9a2-633f-4830-b070-ea6bf4461521/scratchpad";
const which = process.argv[2] || "all";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERR: " + e.message));
await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 20000 }).catch((e) => errs.push("goto " + e.message));
await page.waitForTimeout(2500);
const rendered = await page.evaluate(() => !!document.querySelector('.app.shell, [class*="cmd-"], [class*="shell"]')).catch(() => false);
console.log("app rendered shell:", rendered, "| errs:", errs.slice(0, 4));

async function shot(n) { await page.screenshot({ path: `${OUT}/app-${n}.png` }); }
async function esc() { await page.keyboard.press("Escape"); await page.waitForTimeout(250); }

await shot("01-default");
await page.keyboard.press("Meta+k"); await page.waitForTimeout(500); await shot("02-palette"); await esc();
for (const [k, name] of [["1", "briefing"], ["2", "live"], ["3", "review"], ["4", "backtest"], ["5", "agent"], ["6", "settings"], ["7", "system"]]) {
  await page.keyboard.press(`Meta+${k}`); await page.waitForTimeout(500); await shot(`pg-${name}`); await esc();
}
await browser.close();
console.log("done");
