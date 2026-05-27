// RISK page — reference 1:1 port (2026-05-27).
// Mirrors ai-trading-agent/apps/trading-terminal/workstation/risk.jsx.
// Single panel: day's loss-limit state + R$ editor.

import React, { useState } from "react";
import { Panel } from "./Shared.jsx";

function RiskPage() {
  const r = (typeof window !== "undefined" && window.GOFNQ_DATA)?.risk || {};
  const [rValue, setRValue] = useState(r.rDollars || 100);

  const limit = rValue * 2; // -2R hard rule
  const pnl = r.todayPnL ?? null;
  const remaining = pnl != null ? Math.max(0, limit + pnl) : null;
  const fmt = (v) => v == null ? "—" : (v < 0 ? "- $" : "$ ") + Math.abs(v);

  const cells = [
    { k: "1 R",          v: "$ " + rValue, sub: "user-set" },
    { k: "DAILY LIMIT",  v: "- $ " + limit, sub: "-2 R · hard stop", cls: "red" },
    { k: "TODAY P&L",    v: fmt(pnl), sub: pnl != null ? (pnl / rValue).toFixed(2) + " R" : "—",
      cls: pnl == null ? "" : pnl < 0 ? "warn" : "green" },
    { k: "REMAINING",    v: fmt(remaining), sub: pnl != null ? "to limit" : "—",
      cls: remaining == null ? "" : remaining > 0 ? "green" : "red" },
  ];

  return (
    <div className="work-scroll" style={{ width: "100%" }}>
      <Panel title="RISK · TODAY" meta="resets 09:30 ET">
        <div className="live-grid">
          {cells.map((c) => (
            <div className="lcell" key={c.k}>
              <span className="k">{c.k}</span>
              <span className={"v " + (c.cls || "")}>{c.v}</span>
              <span className="sub">{c.sub}</span>
            </div>
          ))}
        </div>
        <div className="risk-config">
          <span className="k">R size</span>
          <span className="v">1 R = $</span>
          <input className="risk-input"
                 type="number"
                 value={rValue}
                 onChange={(e) => setRValue(Math.max(0, Number(e.target.value) || 0))} />
        </div>
      </Panel>
    </div>
  );
}

export { RiskPage };
