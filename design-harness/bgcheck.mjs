import { chromium } from "playwright";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages().find((x) => x.url().includes("localhost:5173"));
await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForTimeout(3000);
await p.keyboard.press("Meta+5"); await p.waitForTimeout(700);
const r = await p.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).backgroundColor : "none"; };
  return { shellPage: q(".shell-page.cs-agent"), body: q(".shell-page.cs-agent .body"), csBody: q(".cs-agent-body"), claude: q(".cs-agent-body .claude"), feed: q(".cs-agent-body .claude-feed") };
});
console.log(JSON.stringify(r, null, 2));
await b.close();
