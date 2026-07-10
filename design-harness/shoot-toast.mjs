// shoot-toast.mjs — capture the toast surface as visual evidence for motion v1.
// Spawns a fresh Vite from this tree (no Electron/TV/LLM), injects the manual-
// setup fixture (its activeSetup fires the auto-surface "New setup …" toast on
// open), opens Live, and screenshots the toast. Save path via SHOOT_OUT.
//
// Run:  node design-harness/shoot-toast.mjs

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");
const appDir = path.join(repoRoot, "app");
const OUT = process.env.SHOOT_OUT || path.join(dir, "shots");
mkdirSync(OUT, { recursive: true });

const FIXTURES = JSON.parse(readFileSync(path.join(dir, "fixtures", "command-shell-state.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ping = (url) => new Promise((res) => {
  const req = http.get(url, (r) => { r.resume(); res(true); });
  req.on("error", () => res(false));
  req.setTimeout(800, () => { req.destroy(); res(false); });
});
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); });
});

async function main() {
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const child = spawn(process.execPath, [path.join(appDir, "node_modules", "vite", "bin", "vite.js"), "--port", String(port), "--strictPort"],
    { cwd: appDir, stdio: "ignore", env: { ...process.env } });
  try {
    for (let i = 0; i < 60; i++) { if (await ping(base)) break; await sleep(500); }
    const scenario = FIXTURES.scenarios["manual-setup"];
    const sentinel = { __isGofnqFixtureHarness: true, title: scenario.title, crashPage: null, state: scenario.state || {} };
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await ctx.addInitScript((fx) => { window.__GOFNQ_FIXTURE__ = fx; }, sentinel);
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForSelector(".app.shell", { timeout: 12000 });
    await page.keyboard.press("Meta+2"); // open Live → auto-surface fires a toast
    await page.waitForSelector(".cs-toast", { timeout: 6000 });
    await sleep(300); // let the toast entrance settle
    await page.screenshot({ path: path.join(OUT, "cs-toast.png") });
    console.log(`saved ${path.join(OUT, "cs-toast.png")}`);
    await browser.close();
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((e) => { console.error("shoot-toast crashed:", e); process.exit(1); });
