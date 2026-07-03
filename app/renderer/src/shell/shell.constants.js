// shell.constants — Command Shell page order + shared constants.
//
// Keyboard note: window-level keydown does not fire while the TradingView
// <webview> holds DOM focus, so main forwards the global chord set from the
// guest's before-input-event to the renderer as `shell:key` (see
// app/main/shell-keys.js + CommandShell's onShellKey). Clicking chrome also
// refocuses the window as a belt-and-suspenders fallback.

export const PAGE_ORDER = [
  "briefing", "live", "review", "backtest", "agent", "settings", "system",
];

export const PAGE_TITLES = {
  briefing: "Brief",
  live: "Live",
  review: "Review",
  backtest: "Backtest",
  agent: "Agent",
  settings: "Settings",
  system: "System",
};

export const PAGE_ICONS = {
  briefing: "◔", live: "◉", review: "◑", backtest: "⧗",
  agent: "✳", settings: "⚙", system: "⌗",
};

export const PAGE_FOOT =
  "⌘1 briefing · ⌘2 live · ⌘3 review · ⌘4 backtest · ⌘5 agent · ⌘6 settings · ⌘7 system";
