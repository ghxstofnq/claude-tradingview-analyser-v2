import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const PROTO = "file:///Users/anasqatanani/Downloads/design_handoff_command_shell/prototypes/Command%20Shell%20Prototype.dc.html";
const OUT = "/private/tmp/claude-501/-Users-anasqatanani-Documents-claude-tradingview-analyser-v2/bf03a9a2-633f-4830-b070-ea6bf4461521/scratchpad";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));

await page.goto(PROTO, { waitUntil: "networkidle", timeout: 30000 }).catch((e) => errs.push("goto: " + e.message));
await page.waitForTimeout(2500);

// Is anything rendered?
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
const hasShell = await page.evaluate(() => !!document.querySelector('[class*="topbar"],[class*="shell"],[class*="strip"]') || document.body.children.length > 1).catch(() => false);
console.log("errs:", errs.slice(0, 5));
console.log("bodyTextSample:", JSON.stringify(bodyText.slice(0, 120)));
console.log("hasShell:", hasShell);

await page.screenshot({ path: OUT + "/proto-01-default.png" });

// Try opening the palette (Cmd+K) and a page (Cmd+1)
await page.keyboard.press("Meta+k").catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "/proto-02-palette.png" });
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(300);
await page.keyboard.press("Meta+2").catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "/proto-03-live.png" });

await browser.close();
console.log("done");
