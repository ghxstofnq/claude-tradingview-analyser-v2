// command-shell-smoke.mjs — deterministic, fixture-driven Command Shell workflow
// harness (docs/plans/2026-07-09 Task D1 + the D2 keyboard/a11y scenario).
//
// It runs the REAL renderer (Vite dev server) under Playwright with NO Electron,
// broker, TradingView, or LLM: a test-only fixture adapter injected via
// addInitScript supplies window.api from design-harness/fixtures/command-shell-
// state.json. Each of the 11 scenarios drives real keyboard/click interactions
// and asserts semantic state + key text (screenshots are saved as evidence only).
//
// Run:  npm run test:ui         (from repo root — spawns Vite, headless)
// Deterministic: no network, fixed 1440×900 viewport + one 760×1200 pass. The
// only wall-clock dependence is the "stale-feed" scenario, which waits out the
// >6s exec-stale timer.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");
const appDir = path.join(repoRoot, "app");
const OUT = process.env.SHOOT_OUT || path.join(dir, "shots");
mkdirSync(OUT, { recursive: true });

const BASE = "http://localhost:5173";
const FIXTURES = JSON.parse(readFileSync(path.join(dir, "fixtures", "command-shell-state.json"), "utf8"));
const V = { wide: { width: 1440, height: 900 }, narrow: { width: 760, height: 1200 } };

// ── tiny assertion helpers (throw on failure; the runner records them) ────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textOf(page, selector) {
  const el = await page.$(selector);
  return el ? (await el.textContent()) || "" : null;
}
async function assertVisible(page, selector, { timeout = 6000 } = {}) {
  try { await page.waitForSelector(selector, { state: "visible", timeout }); }
  catch { throw new Error(`expected element ${selector} to be visible`); }
}
async function assertText(page, selector, needle, { timeout = 6000 } = {}) {
  try {
    await page.waitForFunction(
      ([sel, sub]) => {
        const els = Array.from(document.querySelectorAll(sel));
        return els.some((e) => (e.textContent || "").includes(sub));
      },
      [selector, needle],
      { timeout },
    );
  } catch {
    const got = await textOf(page, selector);
    throw new Error(`expected ${selector} to contain "${needle}"; got "${(got || "<none>").trim().slice(0, 120)}"`);
  }
}
async function assertBodyText(page, needle, { timeout = 6000 } = {}) {
  try {
    await page.waitForFunction((sub) => (document.body.innerText || "").includes(sub), needle, { timeout });
  } catch { throw new Error(`expected page to show text "${needle}"`); }
}
async function assertNotVisible(page, selector) {
  const el = await page.$(selector);
  if (el && (await el.isVisible())) throw new Error(`expected ${selector} NOT to be visible`);
}

// ── keyboard nav ──────────────────────────────────────────────────────────────
const PAGE_KEY = { briefing: "1", live: "2", review: "3", backtest: "4", agent: "5", settings: "6", system: "7" };
async function openPage(page, name) {
  await page.keyboard.press(`Meta+${PAGE_KEY[name]}`);
  await assertVisible(page, ".shell-page, .bt-popover");
  await sleep(250);
}
async function esc(page) { await page.keyboard.press("Escape"); await sleep(200); }

// ── vite dev server (spawn unless one is already answering) ─────────────────────
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(true); });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}
async function ensureVite() {
  if (await ping(BASE)) return { stop: async () => {} }; // reuse a running dev server
  const viteBin = path.join(appDir, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "--port", "5173"], {
    cwd: appDir, stdio: "ignore", env: { ...process.env },
  });
  for (let i = 0; i < 60; i++) { if (await ping(BASE)) break; await sleep(500); }
  if (!(await ping(BASE))) { child.kill("SIGTERM"); throw new Error("vite dev server did not come up on :5173"); }
  return { stop: async () => { child.kill("SIGTERM"); } };
}

// ── run one scenario in an isolated context with its own injected fixture ───────
async function runScenario(browser, key, viewport, fn) {
  const scenario = FIXTURES.scenarios[key];
  if (!scenario) throw new Error(`unknown scenario "${key}"`);
  const sentinel = { __isGofnqFixtureHarness: true, title: scenario.title, crashPage: scenario.crashPage || null, state: scenario.state || {} };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message || e)));
  await context.addInitScript((fx) => { window.__GOFNQ_FIXTURE__ = fx; }, sentinel);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
  await assertVisible(page, ".app.shell", { timeout: 12000 });
  // The fixture adapter must have installed a fake window.api.
  const hasApi = await page.evaluate(() => typeof window.api === "object" && !!window.api.__fixtureCalls);
  if (!hasApi) throw new Error("fixture adapter did not install window.api (sentinel guard?)");
  try {
    await fn(page);
    await page.screenshot({ path: path.join(OUT, `cs-${key}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  // A render error anywhere but the deliberately-crashed page is a failure.
  const unexpected = pageErrors.filter((m) => !/fixture-injected crash/.test(m));
  if (unexpected.length) throw new Error(`unexpected page errors: ${unexpected.slice(0, 3).join(" | ")}`);
}

// ── the scenarios ───────────────────────────────────────────────────────────────
const SCENARIOS = [
  ["1 briefing · grade/draw/quality", "briefing", async (page) => {
    await openPage(page, "briefing");
    await assertVisible(page, ".shell-page.cs-brief");
    await assertText(page, ".shell-page .head .sub", "B");            // grade in the header sub
    await assertBodyText(page, "PRICE QUALITY");
    await assertBodyText(page, "MARGINAL");                            // quality verdict
    await assertBodyText(page, "2/3 components");                     // draw & bias vote
    await assertBodyText(page, "21620");                              // draw / anchored target
  }],

  ["2 setup surfaced in MANUAL; accept operates", "manual-setup", async (page) => {
    await openPage(page, "live");
    await assertVisible(page, ".cs-prop-card");
    await assertBodyText(page, "PROPOSED");
    await assertVisible(page, ".cs-btn-accept");
    await assertVisible(page, ".cs-btn-reject");
    await assertText(page, ".cs-grade", "B");
    await assertBodyText(page, "MANUAL");                             // footer copy for manual mode
    await page.click(".cs-btn-accept");                              // accept operates → ticket
    await assertBodyText(page, "ORDER TICKET");
  }],

  ["3 AUTO copy + readiness blockers", "auto-blocked", async (page) => {
    await openPage(page, "live");
    await assertVisible(page, ".cs-live-foot-auto");
    await assertText(page, ".cs-live-foot-auto", "AUTO");
    await esc(page);
    await openPage(page, "system");
    await assertText(page, ".cs-rdy-badge", "BLOCKED");
    await assertBodyText(page, "bar-close heartbeat stale");         // the detector blocker
    // at least one readiness row is in the fail tone
    const failRows = await page.$$eval(".cs-rdy-status.is-bad", (els) => els.length);
    if (failRows < 1) throw new Error("expected a failing readiness row");
  }],

  ["4 pending order shows PENDING (no P&L)", "pending-order", async (page) => {
    await openPage(page, "live");
    await assertVisible(page, ".cs-pos-hero__pnl");
    await assertText(page, ".cs-pos-hero__pnl", "PENDING");
    await assertNotVisible(page, ".cs-pnl-stale");                   // not stale, just pending
  }],

  ["5 filled + stop → COVERED (protected)", "filled-protected", async (page) => {
    await openPage(page, "live");
    await assertVisible(page, ".cs-bvj-verdict.green");
    await assertText(page, ".cs-bvj-verdict", "COVERED");
    await assertBodyText(page, "STOP WORKING");
  }],

  ["6 filled, no stop → CRITICAL recovery", "filled-critical", async (page) => {
    await openPage(page, "live");
    await assertVisible(page, ".cs-oltl-recovery__msg");
    await assertText(page, ".cs-oltl-recovery__msg", "NO protective stop");
    const verbs = await page.$$eval(".cs-oltl-recovery__btn", (els) => els.map((e) => (e.textContent || "").trim()));
    if (!verbs.includes("PROTECT") || !verbs.includes("FLATTEN")) {
      throw new Error(`expected PROTECT + FLATTEN recovery verbs; got ${JSON.stringify(verbs)}`);
    }
  }],

  ["7 feed goes stale while a position exists", "stale-feed", async (page) => {
    await openPage(page, "live");
    await assertVisible(page, ".cs-pos-card");                       // position still shown
    // exec-stale trips after >6s with no fresh read — wait it out, then assert STALE.
    await assertVisible(page, ".cs-pnl-stale", { timeout: 12000 });
    await assertText(page, ".cs-pnl-stale", "STALE");
  }],

  ["8 Review distinguishes JOURNAL vs EXECUTED", "review-domains", async (page) => {
    await openPage(page, "review");
    await assertVisible(page, ".cs-domain-banner.d-journal");        // default JOURNAL tab
    await assertText(page, ".cs-domain-banner.d-journal", "SIMULATED");
    // switch to EXECUTED domain via the tab
    await page.click('[role="tab"][aria-label="EXECUTED"]');
    await assertVisible(page, ".cs-domain-banner.d-executed");
    await assertText(page, ".cs-domain-banner.d-executed", "broker fills");
  }],

  ["9 Backtest certification fails one gate → BLOCKED", "backtest-blocked", async (page) => {
    await openPage(page, "backtest");
    await assertText(page, ".bt-verdict-head", "BLOCKED");
    await assertVisible(page, ".bt-gate.is-fail");
    await assertText(page, ".bt-gate.is-fail", "Corpus");
  }],

  ["10 one page throws; Live stays usable", "page-crash", async (page) => {
    // Agent is the crashPage — its <Page> never renders (FixtureCrashGuard throws
    // inside the boundary), so assert the ErrorBoundary fallback, not .shell-page.
    await page.keyboard.press("Meta+5");
    await assertBodyText(page, "CRASHED");                            // ErrorBoundary fallback
    await assertBodyText(page, "RETRY");
    await esc(page);
    await openPage(page, "live");                                     // Live is still usable
    await assertVisible(page, ".cs-btn-flatten");
    await page.keyboard.press("Shift+Meta+F");                       // emergency flatten from anywhere
    await assertVisible(page, ".cs-flatten");
    await assertText(page, ".cs-flatten", "Flatten all positions");
    // do NOT complete the 400ms hold — asserting the confirm appears is enough.
    const flattenCalls = await page.evaluate(() => window.api.__fixtureCalls.flatten.length);
    if (flattenCalls !== 0) throw new Error("flatten should not have fired without the hold");
  }],

  ["11 keyboard-only nav + focus trap/restoration", "keyboard", async (page) => {
    // Focus a stable topbar control as the "opener".
    await page.evaluate(() => document.querySelector(".cmd-k-btn")?.focus());
    const openerOk = await page.evaluate(() => document.activeElement?.classList.contains("cmd-k-btn"));
    if (!openerOk) throw new Error("could not focus the ⌘K topbar opener");
    // ⌘K opens the palette and moves focus inside; Esc returns focus to the opener.
    await page.keyboard.press("Meta+k");
    await assertVisible(page, ".cmd-palette");
    const inPalette = await page.evaluate(() => !!document.activeElement?.closest(".cmd-palette"));
    if (!inPalette) throw new Error("palette did not receive focus on open");
    await esc(page);
    await assertNotVisible(page, ".cmd-palette");
    const backToOpener = await page.evaluate(() => document.activeElement?.classList.contains("cmd-k-btn"));
    if (!backToOpener) throw new Error("focus did not return to the opener after closing the palette");
    // ⌘2 opens Live via keyboard; focus lands inside the page; Esc restores it.
    await page.keyboard.press("Meta+2");
    await assertVisible(page, ".shell-page");
    const inPage = await page.evaluate(() => !!document.activeElement?.closest(".shell-page"));
    if (!inPage) throw new Error("page did not receive focus on open");
    // Tablist arrow nav: focus the selected FEED tab, ArrowRight → POSITIONS selected.
    await page.evaluate(() => document.querySelector('[role="tablist"][aria-label="live view"] [role="tab"][aria-selected="true"]')?.focus());
    await page.keyboard.press("ArrowRight");
    await sleep(200);
    const selected = await page.evaluate(() => document.querySelector('[role="tablist"][aria-label="live view"] [role="tab"][aria-selected="true"]')?.textContent?.trim());
    if (selected !== "POSITIONS") throw new Error(`arrow-key tab nav failed; selected="${selected}"`);
    await esc(page);
    await assertNotVisible(page, ".shell-page");
    const restored = await page.evaluate(() => document.activeElement?.classList.contains("cmd-k-btn"));
    if (!restored) throw new Error("focus did not return to the opener after closing the page");
  }],
];

// ── driver ────────────────────────────────────────────────────────────────────
async function main() {
  const vite = await ensureVite();
  const browser = await chromium.launch();
  const results = [];
  try {
    // Full suite at the fixed 1440×900 viewport.
    for (const [label, key, fn] of SCENARIOS) {
      const t0 = Date.now();
      try { await runScenario(browser, key, V.wide, fn); results.push({ label, ok: true, ms: Date.now() - t0 }); }
      catch (e) { results.push({ label, ok: false, ms: Date.now() - t0, err: String(e?.message || e) }); }
    }
    // One narrow 760×1200 pass — briefing + live render without horizontal page scroll.
    try {
      const t0 = Date.now();
      await runScenario(browser, "briefing", V.narrow, async (page) => {
        await openPage(page, "briefing");
        await assertVisible(page, ".shell-page.cs-brief");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 2) throw new Error(`page overflows horizontally by ${overflow}px at 760w`);
        await esc(page);
        await openPage(page, "live");
        await assertVisible(page, ".shell-page");
      });
      results.push({ label: "12 narrow 760×1200 render (briefing + live)", ok: true, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ label: "12 narrow 760×1200 render (briefing + live)", ok: false, err: String(e?.message || e) });
    }
  } finally {
    await browser.close();
    await vite.stop();
  }

  const pass = results.filter((r) => r.ok).length;
  console.log("\n── Command Shell workflow harness ──");
  for (const r of results) console.log(`${r.ok ? "  PASS" : "  FAIL"}  ${r.label}${r.ms != null ? `  (${r.ms}ms)` : ""}${r.err ? `\n         → ${r.err}` : ""}`);
  console.log(`\n${pass}/${results.length} scenarios passed. Shots in ${OUT}\n`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => { console.error("harness crashed:", e); process.exit(1); });
