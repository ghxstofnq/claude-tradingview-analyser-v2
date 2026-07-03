// BacktestPage — ⌘4. Hosts the BACKTEST body (RECORD / BASELINE / COMPARE).

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { BacktestBody } from "../../BacktestPopover.jsx";

export function BacktestPage({ onClose }) {
  return (
    <Page icon={PAGE_ICONS.backtest} tint="mute" title="Backtest" wide hosted onClose={onClose}>
      <BacktestBody onClose={onClose} />
    </Page>
  );
}
