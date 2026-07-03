// UtilPages — the remaining palette-only util pages. Health + Fixtures folded
// into the native System page (⌘7); Risk and workstation Preferences stay here,
// reachable via ⌘K search ("risk" / "preferences"). No ⌘-number.

import React from "react";
import { Page } from "./Page.jsx";
import { RiskPage } from "../../Risk.jsx";
import { SettingsPage as WorkstationPrefs } from "../../Settings.jsx";

export function RiskShellPage({ onClose }) {
  return <Page icon="⚠" tint="amber" title="Risk" hosted onClose={onClose}><RiskPage /></Page>;
}
// The old #settings hash page — workstation preferences (default R$, default
// symbol, sound toggles), distinct from the ACCOUNT/EXECUTION Settings (⌘6).
export function PrefsShellPage({ onClose }) {
  return <Page icon="◐" tint="mute" title="Preferences" hosted onClose={onClose}><WorkstationPrefs /></Page>;
}
