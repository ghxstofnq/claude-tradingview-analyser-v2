// OrdersView — palette working-orders view. Live orders from the execution
// engine. The execution:cancel IPC cancels ALL working orders (it ignores an
// id), so the control is an honest "cancel all" rather than a per-row button.

import React from "react";
import { clickable } from "../../a11y.js";

export function OrdersView({ symbol, orders = [], onCancelAll }) {
  return (
    <div className="cmd-orders">
      <div className="cmd-pal-sect">
        ORDERS · {symbol}
        {orders.length > 0 && (
          <span className="cmd-ocancel" style={{ float: "right" }} {...clickable(onCancelAll)}>CANCEL ALL</span>
        )}
      </div>
      {orders.length === 0 && (
        <div className="none">no working orders — type "long 2 mnq" to open a ticket</div>
      )}
      {orders.map((o, i) => {
        const status = (o.status || o.state || "working").toLowerCase();
        const filled = status.includes("fill");
        return (
          <div key={o.id ?? i} className="cmd-orow">
            <span className={"chip " + (filled ? "filled" : "working")}>{filled ? "FILLED" : "WORKING"}</span>
            <span className="txt">{o.text || o.txt || `${(o.side || "").toUpperCase()} ${o.qty ?? ""} ${o.type || ""} ${o.price ?? ""}`.trim()}</span>
            <span className="time">{o.time || ""}</span>
          </div>
        );
      })}
    </div>
  );
}
