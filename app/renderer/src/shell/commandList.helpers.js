// commandList — build the ⌘K root command rows + filter them. Pure.
//
// Rows carry serializable `action` descriptors ({type, ...}); CommandShell
// maps descriptors to the real hooks/IPC so this stays node --test-able.
// tint is a semantic token name (resolved by .cmd-row-icon.tint-* CSS).

import { PAGE_ORDER, PAGE_TITLES } from "./shell.constants.js";

export function buildCommands(ctx = {}) {
  const {
    tripped = false,
    levels = [],            // [{name, price}] untaken brief levels, best first
    hasPosition = false,
    detectorRunning = false,
    automationMode = "manual",
    symbol = "MNQ1!",
  } = ctx;

  const rows = [];

  if (tripped) {
    rows.push({ id: "review-trip", icon: "✳", tint: "blue", root: true,
      label: "Review stop-out with Claude",
      action: { type: "ask", q: "why did the daily-loss guard trip today?" } });
  } else {
    rows.push({ id: "open:briefing", icon: "◔", tint: "blue", root: true, kbd: "⌘1",
      label: "Open briefing", action: { type: "page", page: "briefing" } });
  }

  rows.push({ id: "start-prep", icon: "◔", tint: "blue", root: true,
    label: "Start prep session", detail: "4-step pre-session checklist",
    action: { type: "startPrep" } });

  for (const l of levels.slice(0, 2)) {
    rows.push({ id: `arm:${l.name}`, icon: "◈", tint: "amber", root: true,
      label: `Arm alert at ${l.name}`, detail: String(l.price),
      action: { type: "arm", name: l.name, price: l.price } });
  }

  if (hasPosition) {
    rows.push({ id: "be", icon: "⇲", tint: "green", root: true,
      label: "Move stop to breakeven", action: { type: "be" } });
    rows.push({ id: "trail", icon: "⇝", tint: "green", root: true,
      label: "Trail stop", action: { type: "trail" } });
  }
  rows.push({ id: "flatten", icon: "◱", tint: hasPosition ? "red" : "mute", root: hasPosition,
    label: hasPosition ? "Flatten position" : "Flatten (you're flat)", kbd: "⇧⌘F",
    action: { type: "flatten" } });

  rows.push({ id: "sym", icon: "▦", tint: "mute", root: true,
    label: `Switch to ${symbol === "MNQ1!" ? "MES1!" : "MNQ1!"}`,
    action: { type: "switch-symbol" } });

  rows.push({ id: "detector", icon: "◉", tint: detectorRunning ? "red" : "green", root: false,
    label: detectorRunning ? "Stop detector" : "Start detector",
    detail: detectorRunning ? "no scheduled turns until restarted" : "next turn on bar close",
    action: { type: "detector" } });

  // The modes the execution engine recognizes (config.js: manual | suggest | auto).
  for (const m of ["manual", "suggest", "auto"]) {
    rows.push({ id: `auto:${m}`, icon: "⚙", tint: "amber", root: false,
      label: `Automation → ${m.toUpperCase()}`,
      detail: automationMode === m ? "current" : `currently ${automationMode.toUpperCase()}`,
      action: { type: "automation", mode: m } });
  }

  for (let i = 1; i < PAGE_ORDER.length; i++) {
    const p = PAGE_ORDER[i];
    rows.push({ id: `open:${p}`, icon: "›", tint: "mute", root: false, kbd: `⌘${i + 1}`,
      label: `Open ${PAGE_TITLES[p].toLowerCase()}`, action: { type: "page", page: p } });
  }

  for (const [p, label] of [["prefs", "preferences"], ["risk", "risk"]]) {
    rows.push({ id: `open:${p}`, icon: "⌗", tint: "mute", root: false,
      label: `Open ${label}`, action: { type: "page", page: p } });
  }
  // "health" and "fixtures" were folded away: health now lives in System (⌘7),
  // fixtures/fold-tests in Backtest (⌘4). Keep a "health" alias so the search
  // still lands somewhere useful.
  rows.push({ id: "open:health", icon: "✚", tint: "green", root: false,
    label: "Open health", action: { type: "page", page: "system" } });

  rows.push({ id: "theme", icon: "◐", tint: "mute", root: false,
    label: "Toggle light / dark theme", action: { type: "theme" } });

  return rows;
}

// Verb shortcuts — a typed verb jumps straight to its command even when the
// label wouldn't substring-match (prototype behavior: "be", "fla", "trail").
const VERB_SHORTCUTS = [
  [/^fla/, (c) => c.id === "flatten"],
  [/^be\b|^break/, (c) => c.id === "be"],
  [/^trail/, (c) => c.id === "trail"],
  [/^arm\b/, (c) => c.id.startsWith("arm:")],
  [/^(manual|auto)\b/, (c, m) => c.id === `auto:${m[1]}`],
  [/^(detector|start|stop)\b/, (c) => c.id === "detector"],
];

export function visibleRows(all, qRaw) {
  const q = String(qRaw ?? "").trim().toLowerCase();
  if (!q) return all.filter((c) => c.root !== false).slice(0, 8);
  for (const [re, match] of VERB_SHORTCUTS) {
    const m = q.match(re);
    if (m) {
      const hits = all.filter((c) => match(c, m));
      if (hits.length) return hits;
    }
  }
  return all.filter((c) => c.label.toLowerCase().includes(q));
}
