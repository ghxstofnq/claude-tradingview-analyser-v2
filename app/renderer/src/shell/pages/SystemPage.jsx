// SystemShellPage — ⌘7. Hosts the SYSTEM util page (supervisor / execution
// mode / latches / build) inside the page frame.

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { SystemPage } from "../../System.jsx";

export function SystemShellPage({ onClose }) {
  return (
    <Page icon={PAGE_ICONS.system} tint="mute" title="System" wide hosted onClose={onClose}>
      <SystemPage />
    </Page>
  );
}
