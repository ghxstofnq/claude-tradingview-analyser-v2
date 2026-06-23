// Headless visual + computed-style probe for app.css.
// Replaces computer-use: real PNGs (no JPEG warm-cast) + exact computed hex/fonts.
//   node shoot.mjs            -> writes shot-full.png + shot-popover.png, prints report
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const harness = "file://" + path.join(dir, "harness.html");

// name -> CSS selector to probe (first match)
const SAMPLES = [
  ["body",             "body"],
  ["topbar",           ".topbar"],
  ["statusline",       ".statusline"],
  ["popover head",     ".bt-popover .head"],
  ["popover head .t",  ".bt-popover .head .t"],
  ["panel",            ".panel"],
  ["panel title",      ".panel-head .title"],
  ["lv-box (nested)",  ".lv-box"],
  ["row .k (label)",   ".row .k"],
  ["row .v (value)",   ".row .v"],
  ["pill.primary",     ".pill.primary"],
  ["grade-pill.green", ".grade-pill.green"],
];

// design.md expected anchors, for eyeball-diffing the printed report
const EXPECT = {
  canvas:    "rgb(10, 10, 10)",   // --surface-0
  card:      "rgb(26, 26, 26)",   // --surface-2
  elevated:  "rgb(36, 36, 36)",   // --surface-3
  primary:   "rgb(250, 255, 105)",// --primary (electric yellow)
  label:     "rgb(154, 154, 154)",// --label
  green:     "rgb(34, 197, 94)",  // --green
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1200 }, deviceScaleFactor: 2 });
await page.goto(harness, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const interLoaded = await page.evaluate(() => document.fonts.check('16px "Inter"'));
const monoLoaded  = await page.evaluate(() => document.fonts.check('16px "JetBrains Mono"'));

const report = [];
for (const [name, sel] of SAMPLES) {
  const data = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      cls: el.className || el.tagName.toLowerCase(),
      bg: s.backgroundColor,
      color: s.color,
      font: (s.fontFamily.split(",")[0] || "").replace(/['"]/g, ""),
      size: s.fontSize,
      radius: s.borderTopLeftRadius,
    };
  }, sel);
  report.push({ name, ...(data || { bg: "— MISSING —" }) });
}

console.log("\nFonts loaded ->  Inter:", interLoaded, "| JetBrains Mono:", monoLoaded);
console.log("design.md anchors:", JSON.stringify(EXPECT, null, 0), "\n");
console.table(report);

await page.screenshot({ path: path.join(dir, "shot-full.png"), fullPage: true });
const pop = await page.$(".bt-popover");
if (pop) await pop.screenshot({ path: path.join(dir, "shot-popover.png") });
await browser.close();
console.log("\nwrote shot-full.png + shot-popover.png");
