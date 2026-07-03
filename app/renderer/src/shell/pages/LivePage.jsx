// LivePage — ⌘2. Native LIVE page: the segmented FEED | POSITIONS body lives in
// LiveBody; the page frame supplies the green-tinted header, the FLATTEN control,
// and the unified footer. Still `hosted` because LiveBody renders inside a
// `.bt-popover.embedded` (every existing LIVE style applies).

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { LiveBody } from "../../LivePopover.jsx";

export function LivePage({ symbol, guards, onFlatten, onClose }) {
  return (
    <Page icon={PAGE_ICONS.live} tint="green" title="Live" page="live" hosted narrow className="narrow" onClose={onClose}
          hint="⇧⌘F flattens · esc"
          right={<span className="pill red interactive" onClick={onFlatten} title="⇧⌘F flattens anywhere">FLATTEN</span>}>
      <LiveBody guards={guards} symbol={symbol} />
    </Page>
  );
}
