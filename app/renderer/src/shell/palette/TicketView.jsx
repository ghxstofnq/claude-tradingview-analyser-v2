// TicketView — palette order ticket. Hosts the real OrdersBody (same
// structure+risk flow, guardrails, and confirmed-account routing as the ORDERS
// popover) seeded with the side parsed from "long/short …".

import React from "react";
import { clickable } from "../../a11y.js";
import { OrdersBody } from "../../OrdersPopover.jsx";

export function TicketView({ seed, onToast, onClose }) {
  return (
    <>
      <div className="cmd-pal-input">
        <span className={"cmd-tside " + seed.side}>{seed.dir}</span>
        <span style={{ fontSize: 14, color: "var(--value-strong)", flex: 1 }}>
          {seed.symbol}{seed.qtyHint ? ` · ${seed.qtyHint} contract${seed.qtyHint > 1 ? "s" : ""} requested` : ""}
        </span>
        <span className="cmd-kbd" {...clickable(onClose)}>esc</span>
      </div>
      <div className="bt-popover embedded orders-pop" style={{ maxHeight: "56vh" }}>
        <OrdersBody symbol={seed.symbol} initialSide={seed.side} onToast={onToast} />
      </div>
    </>
  );
}
