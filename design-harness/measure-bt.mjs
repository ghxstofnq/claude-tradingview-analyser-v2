import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("localhost:5173"));
await page.keyboard.press("Escape"); await page.waitForTimeout(200);
await page.keyboard.press("Meta+4"); await page.waitForTimeout(600);
const m = await page.evaluate(() => {
  const cols = document.querySelector(".bt-cols");
  if (!cols) return { err: "no .bt-cols" };
  const kids = [...cols.children].map((c) => ({
    cls: c.className,
    h: Math.round(c.getBoundingClientRect().height),
  }));
  const sum = document.querySelector(".bt-summary");
  const metrics = document.querySelector(".bt-metrics");
  return {
    cols_align: getComputedStyle(cols).alignItems,
    kids,
    summary_h: sum ? Math.round(sum.getBoundingClientRect().height) : null,
    metrics_h: metrics ? Math.round(metrics.getBoundingClientRect().height) : null,
    metrics_justify: metrics ? getComputedStyle(metrics).justifyContent : null,
    metrics_flex: metrics ? getComputedStyle(metrics).flex : null,
  };
});
console.log(JSON.stringify(m, null, 2));
await browser.close();
