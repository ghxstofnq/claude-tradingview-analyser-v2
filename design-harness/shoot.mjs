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
  ["decision strip",   ".prep-decision"],
  ["decision grade",   ".prep-decision .grade-lg"],
  ["decision bias",    ".prep-decision .bias"],
  ["decision draw b",  ".prep-decision .draw b"],
  ["or-note",          ".or-note"],
  ["ai prose",         ".prep-ai .prose"],
  ["row .k (label)",   ".row .k"],
  ["row .v (value)",   ".row .v"],
  ["pill.primary",     ".pill.primary"],
  ["grade-pill.green", ".grade-pill.green"],
];

// Raycast DESIGN.md expected anchors, for eyeball-diffing the printed report
const EXPECT = {
  canvas:    "rgb(7, 8, 10)",      // --surface-0 (Raycast canvas)
  card:      "rgb(16, 17, 17)",    // --surface-2 (surface-elevated, panels)
  elevated:  "rgb(18, 18, 18)",    // --surface-3 (surface-card, nested)
  primary:   "rgb(255, 255, 255)", // --primary (white CTA pill)
  label:     "rgb(156, 156, 157)", // --label (mute)
  green:     "rgb(89, 212, 153)",  // --green (Raycast accent-green)
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

// light theme pass — flip data-theme and re-probe + shoot
await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
await new Promise((r) => setTimeout(r, 120));
const lightRows = [];
for (const [name, sel] of SAMPLES) {
  const d = await page.evaluate((sel) => {
    const el = document.querySelector(sel); if (!el) return null;
    const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color };
  }, sel);
  lightRows.push({ name, ...(d || {}) });
}
console.log("\n=== LIGHT THEME ===");
console.table(lightRows);
await page.screenshot({ path: path.join(dir, "shot-light.png"), fullPage: true });
const popL = await page.$(".bt-popover");
if (popL) await popL.screenshot({ path: path.join(dir, "shot-popover-light.png") });

await browser.close();
console.log("\nwrote shot-full.png + shot-popover.png + shot-light.png + shot-popover-light.png");
