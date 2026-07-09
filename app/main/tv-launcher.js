// app/main/tv-launcher.js
// Relaunch TradingView Desktop with the CDP debug flag (CLAUDE.md hard
// constraint #1 recipe). The whole system is blind when TV Desktop runs
// without --remote-debugging-port=9225 — which happens whenever TV is
// reopened normally from the Dock (2026-07-07→09: three silent days whose
// only symptom was an unlabeled "75h ago" chip).
//
// All side effects (exec, probe, sleep) are injectable so the flow is
// unit-testable without touching the real app.

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execP = promisify(exec);

export const CDP_PORT = 9225;
const CDP_VERSION_URL = `http://127.0.0.1:${CDP_PORT}/json/version`;

// Plain HTTP probe — never attaches a CDP driver (a second driver wedges TV).
export async function probeCdp({ fetchFn = fetch, timeoutMs = 1500 } = {}) {
  try {
    const res = await fetchFn(CDP_VERSION_URL, { signal: AbortSignal.timeout(timeoutMs) });
    return !!res?.ok;
  } catch { return false; }
}

// -x matches the main binary exactly; helpers are "TradingView Helper …".
async function tvRunning() {
  try { const { stdout } = await execP("pgrep -x TradingView"); return stdout.trim().length > 0; }
  catch { return false; } // pgrep exits 1 on no match
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let _busy = false;

// Quit TV Desktop if it's running (without the flag, or CDP would answer),
// reopen it with the flag, and wait until CDP answers. Attempt counts instead
// of wall-clock deadlines so tests with a no-op sleep terminate.
export async function relaunchTvWithCdp(deps = {}) {
  const d = {
    probeCdp, tvRunning, run: execP, sleep,
    quitAttempts: 30, // × 500ms = 15s for TV to exit
    cdpAttempts: 60,  // × 500ms = 30s for CDP to answer after launch
    ...deps,
  };
  if (_busy) return { ok: false, error: "relaunch already in progress" };
  _busy = true;
  try {
    if (await d.probeCdp()) return { ok: true, already: true };

    if (await d.tvRunning()) {
      await d.run(`osascript -e 'quit app "TradingView"'`).catch(() => {});
      let gone = false;
      for (let i = 0; i < d.quitAttempts; i++) {
        if (!(await d.tvRunning())) { gone = true; break; }
        await d.sleep(500);
      }
      if (!gone) {
        return { ok: false, error: "TradingView didn't quit (a dialog may be blocking it) — close it manually and retry" };
      }
    }

    await d.run(`open -a TradingView --args --remote-debugging-port=${CDP_PORT}`);
    for (let i = 0; i < d.cdpAttempts; i++) {
      if (await d.probeCdp()) return { ok: true };
      await d.sleep(500);
    }
    return { ok: false, error: `TradingView launched but CDP ${CDP_PORT} didn't answer — is it signed in and past the splash?` };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    _busy = false;
  }
}
