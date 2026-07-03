// SettingsPage — ⌘6. Hosts the ACCOUNT & EXECUTION settings body (guardrails,
// PAPER⇄LIVE arming). float=null → static; page-host CSS neutralizes its frame.

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { SettingsPopover } from "../../SettingsPopover.jsx";

export function SettingsPage({ guards, setGuards, onClose }) {
  return (
    <Page icon={PAGE_ICONS.settings} tint="mute" title="Settings" hosted onClose={onClose}>
      <SettingsPopover guards={guards} setGuards={setGuards} onClose={onClose} float={null} />
    </Page>
  );
}
