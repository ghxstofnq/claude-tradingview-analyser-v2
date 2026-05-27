// SYSTEM page — reference 1:1 port (2026-05-27).
// Mirrors ai-trading-agent/apps/trading-terminal/workstation/system.jsx.
// Supervisor controls + execution mode + latches + build.

import React from "react";
import { Panel, Row } from "./Shared.jsx";

function action(name) {
  return () => {
    if (typeof window[name] === "function") window[name]();
    else console.log("[stub] " + name);
  };
}

function SystemPage() {
  const s = (typeof window !== "undefined" && window.GOFNQ_DATA)?.system || {};
  const sup = s.supervisor || {};
  const ex  = s.execution  || {};
  const lat = s.latches    || {};
  const bld = s.build      || {};
  return (
    <div className="work-scroll" style={{ width: "100%" }}>
      <Panel title="SUPERVISOR" meta="ny-session-supervisor">
        <div className="row-act">
          <Row k="Process"
               v={sup.process
                   ? `${sup.process.status} · pid ${sup.process.pid || "—"} · uptime ${sup.process.uptime || "—"}`
                   : "—"} />
          <div className="row-act-btns">
            <button className="btn red"   onClick={action("GOFNQ_supervisorStop")}>STOP</button>
            <button className="btn amber" onClick={action("GOFNQ_supervisorRestart")}>RESTART</button>
          </div>
        </div>
        <Row k="Last cycle" v={sup.lastCycle || "—"} />
        <Row k="Last bar"   v={sup.lastBar   || "—"} />
        <Row k="Capture loop"
             v={sup.captureLoop
                 ? `${sup.captureLoop.status} · interval ${sup.captureLoop.interval || "—"} · ${sup.captureLoop.missesLastHour ?? "—"} misses last hour`
                 : "—"} />
      </Panel>

      <Panel title="EXECUTION MODE" meta="safety.execution_mode">
        <Row k="Mode"          v={ex.mode || "MANUAL_ONLY"} tone={ex.mode === "BROKER_WRITES" ? "warn" : ""} />
        <Row k="Broker writes" v={ex.brokerWrites ? "enabled" : "disabled"} tone={ex.brokerWrites ? "warn" : ""} />
        <div className="row-act">
          <Row k="Tradovate" v={ex.tradovate || "not connected"} tone={typeof ex.tradovate === "string" && ex.tradovate.startsWith("connected") ? "ok" : "bad"} />
          <div className="row-act-btns">
            <button className="btn" onClick={action("GOFNQ_tradovateConnect")}>CONNECT</button>
          </div>
        </div>
      </Panel>

      <Panel title="LATCHES" meta="leadership + price_quality">
        <div className="row-act">
          <Row k="Leader latch"
               v={lat.leader ? `${lat.leader.focus} · locked ${lat.leader.lockedAt || "—"}` : "—"}
               tone={lat.leader ? "warn" : ""} />
          <div className="row-act-btns">
            <button className="btn" onClick={action("GOFNQ_resetLeaderLatch")}>RESET</button>
          </div>
        </div>
        <div className="row-act">
          <Row k="P2 latch"
               v={lat.p2 ? `${lat.p2.tier} · locked since cycle ${lat.p2.lockedAt || "—"}` : "—"}
               tone={lat.p2 ? "warn" : ""} />
          <div className="row-act-btns">
            <button className="btn" onClick={action("GOFNQ_resetP2Latch")}>RESET</button>
          </div>
        </div>
      </Panel>

      <Panel title="BUILD" meta="read-only">
        <Row k="Cockpit"   v={bld.cockpit   || "workstation 0.4.1"} />
        <Row k="Brain"     v={bld.brain     || "—"} />
        <Row k="Indicator" v={bld.indicator || "ict-engine.pine · schema v1"} />
      </Panel>
    </div>
  );
}

export { SystemPage };
