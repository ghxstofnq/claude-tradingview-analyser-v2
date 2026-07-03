// BacktestPage — ⌘4. Hosts the BACKTEST body (RECORD / BASELINE / COMPARE). The
// body already implements every state; the page frame supplies neutral chrome +
// the unified footer. Batch C balances RECORD/DONE into 1:1 columns (in the body).

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { BacktestBody } from "../../BacktestPopover.jsx";

export function BacktestPage({ onClose }) {
  return (
    <Page icon={PAGE_ICONS.backtest} tint="mute" title="Backtest" sub="record · fold · compare"
          page="backtest" hosted hint="records from the chart" onClose={onClose}>
      <BacktestBody onClose={onClose} />
    </Page>
  );
}
