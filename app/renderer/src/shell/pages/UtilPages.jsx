// UtilPages — the former hash-routed dev/diagnostic pages (health / risk /
// fixtures), now hosted in the page frame. Reachable via the palette (search
// "health", "risk", "fixtures"); no ⌘-number so they stay out of the way.

import React from "react";
import { Page } from "./Page.jsx";
import { HealthPage } from "../../Health.jsx";
import { RiskPage } from "../../Risk.jsx";
import { FixturesPage } from "../../Fixtures.jsx";
import { SettingsPage as WorkstationPrefs } from "../../Settings.jsx";

export function HealthShellPage({ onClose }) {
  return <Page icon="✚" tint="green" title="Health" wide hosted onClose={onClose}><HealthPage /></Page>;
}
export function RiskShellPage({ onClose }) {
  return <Page icon="⚠" tint="amber" title="Risk" wide hosted onClose={onClose}><RiskPage /></Page>;
}
export function FixturesShellPage({ onClose }) {
  return <Page icon="▤" tint="mute" title="Fixtures" wide hosted onClose={onClose}><FixturesPage /></Page>;
}
// The old #settings hash page — workstation preferences (default R$, default
// symbol, sound toggles), distinct from the ACCOUNT/EXECUTION Settings (⌘6).
export function PrefsShellPage({ onClose }) {
  return <Page icon="◐" tint="mute" title="Preferences" wide hosted onClose={onClose}><WorkstationPrefs /></Page>;
}
