// shell.constants — Command Shell page order + shared constants.
//
// Keyboard caveat: window-level keydown does NOT fire while the TradingView
// <webview> has DOM focus (same limitation the old statusline hotkeys had).
// PR1 mitigation: every shell affordance is mouse-operable and clicking any
// chrome refocuses the renderer window. The real fix (main-process
// before-input-event forwarding from the webview guest) is scoped to PR3.

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
