// LivePage — ⌘2. Hosts the LIVE body (detector, HUNT/TICKET/IN-TRADE).

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { LiveBody } from "../../LivePopover.jsx";

export function LivePage({ symbol, guards, onFlatten, onClose }) {
  return (
    <Page icon={PAGE_ICONS.live} tint="green" title="Live" hosted onClose={onClose}
          tabs={<span className="pill red interactive" onClick={onFlatten} title="⇧⌘F flattens anywhere">FLATTEN</span>}
          foot={<><span>fires only after your accept</span><span className="sp" /><span>⇧⌘F flattens anywhere · esc</span></>}>
      <LiveBody guards={guards} symbol={symbol} />
    </Page>
  );
}
