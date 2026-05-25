import { app, BrowserWindow, powerMonitor } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initSdk } from "./main/sdk.js";
import { registerIpc } from "./main/ipc.js";
import { setSurfaceSink } from "./main/tools/surface.js";
import { startHealthMonitor } from "./main/health.js";
import { startAlertPolling } from "./main/alerts.js";
import { bindDetectorToMode } from "./main/bar-close.js";
import { bootstrap as bootstrapSessionBrief, rearmScheduler as rearmBrief } from "./main/session-brief.js";
import { bootstrap as bootstrapSessionWrap, rearmScheduler as rearmWrap } from "./main/session-wrap.js";
import { sweepOldSessions } from "./main/state-retention.js";
import { startMetricsSummary, rotateMetricsFile } from "./main/metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: "#0a0c10",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
    show: false,
  });
  win.once("ready-to-show", () => win.show());

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "dist/renderer/index.html"));
  }
  return win;
}

// Single-instance lock. Running `npm run dev` twice (or double-clicking
// the packaged app) would spawn two main processes — two detectors, two
// schedulers, two competing tv subprocesses, and two writers to the same
// state files. Now: the second instance silently quits, and we focus
// the existing window so the user sees their existing app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const all = BrowserWindow.getAllWindows();
    if (all.length === 0) return;
    const win = all[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

app.whenReady().then(async () => {
  const win = createWindow();
  const ipc = registerIpc(win);
  setSurfaceSink(ipc.send);
  startHealthMonitor(ipc.send);
  startAlertPolling({ send: ipc.send });
  // Detector lifecycle is now driven by mode changes — see app/main/mode.js.
  // ipc.mode:switch sets mode; bar-close subscribes and start/stops itself.
  bindDetectorToMode({ send: ipc.send });
  try {
    await initSdk();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sdk] init failed", err);
    // Don't crash the app — the chat will just fail; the chart still works.
  }
  // Session brief: app-open check + boundary scheduler (02:00 / 09:00 / 13:00 ET).
  bootstrapSessionBrief({ send: ipc.send }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[session-brief] bootstrap failed", err);
  });
  // Session wrap: app-open catch-up + boundary scheduler (06:05 / 12:05 / 16:05 ET).
  bootstrapSessionWrap({ send: ipc.send }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[session-wrap] bootstrap failed", err);
  });

  // Retention sweep: delete state/session/<date>/ folders older than 30
  // days. Runs once on boot AND every 24h afterward — long-running apps
  // (left open across many trading days) used to never sweep because the
  // boot-only sweep had already run weeks ago.
  const runRetentionSweep = () => sweepOldSessions(REPO_ROOT).then((r) => {
    // eslint-disable-next-line no-console
    console.log(`[retention] swept ${r.deleted} old session folders, kept ${r.kept}`);
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[retention] sweep failed", err?.message || err);
  });
  runRetentionSweep();
  setInterval(runRetentionSweep, 24 * 60 * 60 * 1000);

  // Rotate metrics.jsonl on boot — yesterday's file becomes
  // metrics-<YYYY-MM-DD>.jsonl, rotated files older than 30d are swept.
  // Was: unbounded growth, MBs after months.
  rotateMetricsFile().catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[metrics] rotation failed", err?.message || err);
  });

  // Hourly metrics summary to the console — one line aggregating
  // brief/wrap/bar-close/chat events from state/metrics.jsonl. The
  // detailed per-event log is appended as JSONL; this is the digest.
  startMetricsSummary();

  // Power-sleep rearm. setTimeout doesn't fire while the laptop is asleep
  // — the brief/wrap schedulers go silent on wake until rearmed. On
  // 'resume', re-pick the next trigger; if today's brief is missing
  // (slept through the trigger), the rearm path catches it up.
  powerMonitor.on("resume", () => {
    // eslint-disable-next-line no-console
    console.log("[power] system resumed — rearming schedulers");
    rearmBrief().catch((err) => console.warn("[brief] rearm failed", err?.message || err));
    rearmWrap().catch((err) => console.warn("[wrap] rearm failed", err?.message || err));
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
