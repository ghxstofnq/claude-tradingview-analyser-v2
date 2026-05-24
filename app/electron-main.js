import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initSdk } from "./main/sdk.js";
import { registerIpc } from "./main/ipc.js";
import { setSurfaceSink } from "./main/tools/surface.js";
import { startHealthMonitor } from "./main/health.js";
import { startAlertPolling } from "./main/alerts.js";
import { bootstrap as bootstrapSessionBrief } from "./main/session-brief.js";
import { bootstrap as bootstrapSessionWrap } from "./main/session-wrap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

app.whenReady().then(async () => {
  const win = createWindow();
  const ipc = registerIpc(win);
  setSurfaceSink(ipc.send);
  startHealthMonitor(ipc.send);
  startAlertPolling({ send: ipc.send });
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
