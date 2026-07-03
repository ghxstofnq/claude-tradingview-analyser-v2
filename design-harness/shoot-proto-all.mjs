import { chromium } from "playwright";

const PROTO = "file:///Users/anasqatanani/Downloads/design_handoff_command_shell/prototypes/Command%20Shell%20Prototype.dc.html";
const OUT = "/private/tmp/claude-501/-Users-anasqatanani-Documents-claude-tradingview-analyser-v2/bf03a9a2-633f-4830-b070-ea6bf4461521/scratchpad";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(PROTO, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

async function shot(name) { await page.screenshot({ path: `${OUT}/proto-${name}.png` }); }
async function esc() { await page.keyboard.press("Escape"); await page.waitForTimeout(250); }

// pages ⌘1-7
const pages = [["1", "briefing"], ["2", "live"], ["3", "review"], ["4", "backtest"], ["5", "agent"], ["6", "settings"], ["7", "system"]];
for (const [k, name] of pages) {
  await page.keyboard.press(`Meta+${k}`); await page.waitForTimeout(600);
  await shot(`pg-${name}`); await esc();
}

// palette ticket: open ⌘K, type an order
await page.keyboard.press("Meta+k"); await page.waitForTimeout(400);
await page.keyboard.type("long 2 mnq", { delay: 20 }); await page.waitForTimeout(500);
await shot("ticket"); await esc(); await esc();

// prep wizard: open palette, type prep, run — fallback try the briefing Start-prep flow
await page.keyboard.press("Meta+k"); await page.waitForTimeout(300);
await page.keyboard.type("prep", { delay: 20 }); await page.waitForTimeout(300);
await page.keyboard.press("Enter"); await page.waitForTimeout(500);
await shot("prep"); await esc(); await esc();

// flatten overlay
await page.keyboard.press("Shift+Meta+f"); await page.waitForTimeout(500);
await shot("flatten"); await esc();

await browser.close();
console.log("done");
