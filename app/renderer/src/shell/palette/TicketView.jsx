// TicketView — palette order ticket. Hosts the real OrdersBody (same
// structure+risk flow, guardrails, and confirmed-account routing as the ORDERS
// popover) seeded with the side parsed from "long/short …". A packetSeed
// (plan 2026-07-09 Task 4) overrides: side + the packet's exact stop/tp1 land
// as the ticket's typed values, and the header names the packet.

import React from "react";
import { clickable } from "../../a11y.js";
import { OrdersBody } from "../../OrdersPopover.jsx";

export function TicketView({ seed, packetSeed, onToast, onClose }) {
  const side = packetSeed?.side ?? seed.side;
  const dir = packetSeed ? (side === "buy" ? "LONG" : "SHORT") : seed.dir;
  return (
    <>
      <div className="cmd-pal-input">
        <span className={"cmd-tside " + side}>{dir}</span>
        <span style={{ fontSize: 14, color: "var(--value-strong)", flex: 1 }}>
          {seed.symbol}{packetSeed?.label ? ` · packet: ${packetSeed.label}` : seed.qtyHint ? ` · ${seed.qtyHint} contract${seed.qtyHint > 1 ? "s" : ""} requested` : ""}
        </span>
        <span className="cmd-kbd" {...clickable(onClose)}>esc</span>
      </div>
      <div className="bt-popover embedded orders-pop" style={{ maxHeight: "56vh" }}>
        <OrdersBody symbol={seed.symbol} initialSide={side}
                    initialStop={packetSeed?.stop ?? ""} initialTp={packetSeed?.tp ?? ""}
                    onToast={onToast} />
      </div>
    </>
  );
}
