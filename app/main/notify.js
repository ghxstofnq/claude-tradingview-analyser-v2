// System-level notifications from the main process.
//
// The supervisor (and anything else that detects a blocked state) must reach
// the trader even when the app window is hidden — the June 2026 failure mode
// was a dead detector plus a renderer-only health pill nobody was watching.
// Electron is imported lazily so unit tests and CLI contexts (plain node,
// no electron binary) can import consumers of this module without crashing.

export async function notifySystem({ title, body }) {
  try {
    const { Notification } = await import("electron");
    if (Notification?.isSupported?.()) {
      new Notification({ title, body }).show();
    }
  } catch {
    // not running inside electron (tests, CLI) — in-app channel still fires
  }
}
