// Readiness.jsx — the ONE readiness card (Task C1). Rendered identically in
// System (full), Backtest hero (compact), and Settings (compact). All three read
// the same readiness object via useReadiness → readinessView; no page invents its
// own "ready". Direct actions fire only where a real backend action exists.

import React from "react";
import { clickable } from "./a11y.js";
import { useValueTick } from "./hooks/useValueTick.js";
import { readinessView, readinessBadge, formatAge, READINESS_ACTIONS } from "./Readiness.helpers.js";

const MODE_LABEL = {
  auto_ready: "ARM-READY",
  paper_manual: "PAPER / MANUAL ONLY",
  locked: "LOCKED",
};

// Map a row action token → a real backend call + toast. Returns null when no
// real action exists, so the button never renders a dead control.
function runAction(token, pushToast) {
  const done = (r, okMsg, tone = "green") => {
    if (r?.ok) pushToast?.(okMsg, tone);
    else pushToast?.(`Action failed — ${r?.error || r?.reason || r?.code || "unknown"}`, "red");
  };
  switch (token) {
    case "restart_detector":
      pushToast?.("Restarting detector…", "amber");
      return window.api?.detector?.start?.().then((r) => done(r, "Detector armed", "amber")).catch(() => pushToast?.("Restart failed", "red"));
    case "retry_reconcile":
      pushToast?.("Re-reading broker…", "amber");
      return window.api?.execution?.reconcile?.({ action: "retry" }).then((r) => done(r, `Reconcile → ${r?.state || "done"}`, "blue")).catch(() => pushToast?.("Reconcile failed", "red"));
    case "revert_sim":
      return window.api?.execution?.account?.revertSim?.().then((r) => done(r, r?.warned ? "Reverted — LIVE POSITION STILL OPEN" : "Routing → SIM", r?.warned ? "red" : "blue")).catch(() => pushToast?.("Revert failed", "red"));
    default:
      return null;
  }
}

function Row({ row, pushToast }) {
  const dot = " is-" + row.tone;
  const age = formatAge(row.age_s);
  const actLabel = row.action ? READINESS_ACTIONS[row.action] : null;
  return (
    <div className="cs-rdy-row">
      <span className={"cs-rdy-dot" + dot} />
      <span className="cs-rdy-name">{row.label}</span>
      <span className={"cs-rdy-status" + dot}>{row.status}</span>
      <span className="cs-rdy-reason" title={row.reason}>{row.reason}</span>
      {age && <span className="cs-rdy-age" title={row.source || ""}>{age}</span>}
      {actLabel && (
        <span className="cs-rdy-act" {...clickable(() => runAction(row.action, pushToast), { label: actLabel + " " + row.label })}>{actLabel}</span>
      )}
    </div>
  );
}

export function ReadinessCard({ readiness, pushToast, variant = "full", loading = false }) {
  const view = readinessView(readiness);
  const badge = readinessBadge(view);
  const { summary, rows } = view;
  // Value tick (motion v1) — pulse when the readiness verdict flips (READY ↔
  // BLOCKED …). Never while loading or on the dim placeholder (pending states).
  const badgeTickRef = useValueTick(badge.text, !(loading && !readiness) && badge.tone !== "dim");

  if (loading && !readiness) {
    return (
      <div className="cs-rdy is-loading">
        <div className="cs-rdy-head"><span className="cs-rdy-badge is-dim">READINESS</span><span className="cs-rdy-reason-head">reading…</span></div>
      </div>
    );
  }

  // Compact (hero / settings): badge + reason + only the rows that aren't green.
  const shown = variant === "compact" ? rows.filter((r) => r.status !== "pass") : rows;
  const greenCount = rows.filter((r) => r.status === "pass").length;

  return (
    <div className={"cs-rdy" + (variant === "compact" ? " is-compact" : "")}>
      <div className="cs-rdy-head">
        <span ref={badgeTickRef} className={"cs-rdy-badge value-tick is-" + badge.tone}>{badge.text}</span>
        <span className={"cs-rdy-mode is-" + summary.worst}>{MODE_LABEL[summary.mode] || summary.mode}</span>
        <span className="cs-rdy-reason-head" title={summary.reason}>{summary.reason}</span>
      </div>
      <div className="cs-rdy-rows">
        {shown.length
          ? shown.map((row) => <Row key={row.id} row={row} pushToast={pushToast} />)
          : <div className="cs-rdy-allgreen">All {greenCount} readiness gates green.</div>}
      </div>
      {variant === "compact" && shown.length > 0 && (
        <div className="cs-rdy-foot">{greenCount}/{rows.length} gates green · open System for the full readiness truth.</div>
      )}
    </div>
  );
}
