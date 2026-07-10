// Renders the real renderer (Vite dev @5173) and captures System / Settings /
// Live so the C1 readiness card + C2 copy can be eyeballed. Probes computed
// styles of .cs-rdy against the Raycast DESIGN.md anchors. window.api is absent
// (no Electron) so the card renders its fail-closed unavailable state — which is
// exactly the "no fabricated pass" behaviour we want to verify.
import { chromium } from "playwright";

const APP = "http://localhost:5173";
const OUT = process.env.SHOOT_OUT || ".";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERR: " + e.message));
await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 20000 }).catch((e) => errs.push("goto " + e.message));
await page.waitForTimeout(1500);
const shell = await page.evaluate(() => !!document.querySelector('[class*="cmd-"], [class*="cs-"], [class*="shell"]')).catch(() => false);
console.log("app shell rendered:", shell, "| pageerrors:", errs.slice(0, 4));

async function openAndShot(key, name) {
  await page.keyboard.press(`Meta+${key}`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/rdy-${name}.png` });
  const probe = await page.evaluate(() => {
    const el = document.querySelector(".cs-rdy");
    if (!el) return { present: false };
    const s = getComputedStyle(el);
    const badge = document.querySelector(".cs-rdy-badge");
    const bs = badge ? getComputedStyle(badge) : null;
    const dot = document.querySelector(".cs-rdy-dot");
    const ds = dot ? getComputedStyle(dot) : null;
    const rows = document.querySelectorAll(".cs-rdy-row").length;
    return {
      present: true, rows,
      cardBg: s.backgroundColor, cardBorder: s.borderTopColor, cardRadius: s.borderTopLeftRadius,
      badgeText: badge ? badge.textContent : null, badgeColor: bs ? bs.color : null,
      dotColor: ds ? ds.backgroundColor : null,
    };
  });
  console.log(`\n[${name}]`, JSON.stringify(probe));
  return probe;
}

await openAndShot("7", "system");
await page.keyboard.press("Escape"); await page.waitForTimeout(250);
await openAndShot("6", "settings");
await page.keyboard.press("Escape"); await page.waitForTimeout(250);
// Live footer copy (C2-c): probe the footer text for the mode-aware string.
await page.keyboard.press("Meta+2"); await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/rdy-live.png` });
const foot = await page.evaluate(() => {
  const spans = [...document.querySelectorAll(".shell-page .foot span, .head + * .foot span, [class*='foot'] span")];
  return spans.map((s) => s.textContent).filter(Boolean).slice(0, 6);
});
console.log("\n[live footer spans]", JSON.stringify(foot));

console.log("\nDESIGN.md anchors — surface-2 rgb(16,17,17), border rgb(36,39,40), green rgb(89,212,153), amber rgb(255,197,51), red rgb(255,97,97)");
await browser.close();
console.log("\nwrote rdy-system.png, rdy-settings.png, rdy-live.png to", OUT);
