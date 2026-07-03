// BriefingPage — ⌘1. PR1 hosts the proven PREP body inside the page frame;
// PR2 re-lays-out to the prototype's calendar / bias / overnight columns.

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS, PAGE_FOOT } from "../shell.constants.js";
import { PrepWorkstation as PrepBody } from "../../PrepPopover.jsx";

export function BriefingPage({ symbol, currentPrice, onClose }) {
  return (
    <Page icon={PAGE_ICONS.briefing} tint="blue" title="Brief" wide hosted
          onClose={onClose} foot={<><span>{PAGE_FOOT}</span><span className="sp" /><span>chart stays live behind — esc returns</span></>}>
      <PrepBody symbol={symbol} currentPrice={currentPrice} />
    </Page>
  );
}
