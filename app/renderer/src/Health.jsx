// HEALTH page — reference 1:1 port (2026-05-27).
// Mirrors ai-trading-agent/apps/trading-terminal/workstation/health.jsx.

import React from "react";
import { Panel } from "./Shared.jsx";

function dot(status) {
  const cls = status === "down"  ? "bad"
            : status === "stale" ? "warn"
            : status === "off"   ? "dim" : "ok";
  return <span className={"dot-inline " + cls}></span>;
}

function HealthRow({ status, name, detail, action: act }) {
  return (
    <div className="h-row">
      {dot(status)}
      <span className="name">{name}</span>
      <span className="detail">{detail}</span>
      {act && <span className="action" onClick={act.onClick}>{act.label}</span>}
    </div>
  );
}

function HealthPage() {
  const h = (typeof window !== "undefined" && window.GOFNQ_DATA)?.health || {};
  const di = h.dataIngest || {};
  const br = h.brain || {};
  const ex = h.execution || {};
  const st = h.storage || {};
  return (
    <div className="work-scroll" style={{ width: "100%" }}>
      <Panel title="OVERALL" meta="all subsystems">
        <div className="live-grid">
          <div className="lcell">
            <span className="k">STATUS</span>
            <span className={"v " + (h.status === "healthy" ? "green" : h.status === "down" ? "red" : "warn")}>
              {h.status || "—"}
            </span>
            <span className="sub">{h.statusSub || "—"}</span>
          </div>
          <div className="lcell">
            <span className="k">UPTIME</span>
            <span className="v">{h.uptime || "—"}</span>
            <span className="sub">{h.uptimeSub || "—"}</span>
          </div>
          <div className="lcell">
            <span className="k">CYCLES</span>
            <span className="v">{h.cyclesToday || "—"}</span>
            <span className="sub">today</span>
          </div>
          <div className="lcell">
            <span className="k">LAST OK</span>
            <span className="v">{h.lastOk || "—"}</span>
            <span className="sub">brain emit</span>
          </div>
        </div>
      </Panel>

      <Panel title="DATA INGEST" meta="TradingView → indicator → capture">
        <HealthRow status={di.tv?.status} name="TradingView session"
          detail={di.tv?.detail || "—"} />
        <HealthRow status={di.indicator?.status} name="Indicator emit"
          detail={di.indicator?.detail || "—"} />
        <HealthRow status={di.captureLoop?.status} name="Capture loop"
          detail={di.captureLoop?.detail || "—"} />
      </Panel>

      <Panel title="BRAIN" meta="strategy pipeline">
        <HealthRow status={br.pipeline?.status} name="Cycle pipeline"
          detail={br.pipeline?.detail || "—"} />
        <HealthRow status={br.leaderLatch?.status} name="Leader latch"
          detail={br.leaderLatch?.detail || "—"} />
        <HealthRow status={br.p2Latch?.status} name="P2 latch"
          detail={br.p2Latch?.detail || "—"} />
      </Panel>

      <Panel title="EXECUTION" meta="broker">
        <HealthRow status={ex.brokerWrites?.status} name="Broker writes"
          detail={ex.brokerWrites?.detail || "—"} />
        <HealthRow status={ex.tradovate?.status} name="Tradovate"
          detail={ex.tradovate?.detail || "—"} />
      </Panel>

      <Panel title="STORAGE" meta="disk">
        <HealthRow status="ok" name="Cycles (today)"
          detail={st.cyclesToday || "—"} />
        <HealthRow status="ok" name="Fixtures library"
          detail={st.fixtures || "—"} />
        <HealthRow status="ok" name="Sessions archive"
          detail={st.sessions || "—"} />
      </Panel>
    </div>
  );
}

export { HealthPage };
