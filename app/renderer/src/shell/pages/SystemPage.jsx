// SystemShellPage — ⌘7. Native ops page (Batch C regroup): HEALTH | VERSIONS
// two-col, then ACTIONS + SESSION FILES bands. Folds the old Health util page in.
// Real hooks only — useHealth / useVersion / useCalendar / useFiles / the files
// IPC + FileViewer. The prototype's FIXTURES card and Tradovate-CONNECT / latch
// RESET actions have NO backend IPC, so they are omitted rather than faked;
// Supervisor STOP/RESTART proxy to the real detector start/stop.

import React, { useState } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { clickable } from "../../a11y.js";
import { useHealth } from "../../hooks/useHealth.js";
import { useVersion } from "../../hooks/useVersion.js";
import { useFiles } from "../../hooks/useFiles.js";
import { useFixtures } from "../../hooks/useFixtures.js";
import { useExecutionState } from "../../hooks/useExecutionState.js";
import { useCalendar } from "../../hooks/useCalendar.js";
import { FileViewer } from "../../FileViewer.jsx";

function HRow({ tone, name, value, valWarn, action }) {
  const dotMod = tone === "warn" ? " is-warn" : tone === "bad" ? " is-bad" : "";
  return (
    <div className="cs-health-row">
      <span className={"cs-health-dot" + dotMod} />
      <span className="cs-health-name">{name}</span>
      <span className={"cs-health-val" + (valWarn ? " is-warn" : "")}>{value}</span>
      {action}
    </div>
  );
}

function SystemBody({ pushToast }) {
  const health = useHealth();
  const version = useVersion();
  const exec = useExecutionState();
  const events = useCalendar();
  const { date, files } = useFiles();
  // listSessionFiles returns every candidate path incl. exists:false phantoms
  // (fresh day). Only surface files that actually exist — OPEN/REVEAL on a
  // missing path is a no-op / "file not found".
  const shownFiles = (files || []).filter((f) => f.exists);
  const [viewFile, setViewFile] = useState(null);

  const loop = health?.loop; // healthy | stale | off
  const loopTone = loop === "healthy" ? "ok" : loop === "stale" ? "warn" : "bad";
  const loopVal = loop === "healthy" ? "running" : loop === "stale" ? "stale" : "stopped";
  const calN = (events || []).length;
  const calTone = calN > 0 ? "ok" : "warn";
  const retryCal = () => { window.api?.calendar?.thisWeek?.().catch(() => {}); pushToast?.("Calendar feed refreshed", "green"); };

  const verState = version?.restart_needed ? { t: `RESTART`, tone: "bad" }
    : version?.pull_needed ? { t: `PULL −${version?.behind ?? "?"}`, tone: "warn" }
    : { t: "current", tone: "ok" };

  const supStop = () => { window.api?.detector?.stop?.().catch(() => {}); pushToast?.("Supervisor stopped", "red"); };
  // RESTART must recover a detector that STOP just latched off: detector.start()
  // clears the manual-stop latch (noteManualStart) + starts the detector, THEN
  // the supervisor nudge re-runs the watchdog. Nudge alone no-ops on the
  // manual_stop latch, so supervision would stay down while claiming to resume.
  const supRestart = async () => {
    const r = await window.api?.detector?.start?.().catch(() => ({ ok: false }));
    window.api?.supervisor?.nudge?.().catch(() => {});
    pushToast?.(r?.ok ? "Supervisor restarted — detector armed" : "Restart failed", r?.ok ? "amber" : "red");
  };
  const resetLeader = async () => {
    const r = await window.api?.prep?.resetPairDecision?.().catch((e) => ({ ok: false, error: String(e) }));
    pushToast?.(r?.ok ? (r.deleted ? "Leader latch cleared — re-picks next bar" : "No leader latch set") : `Reset failed: ${r?.error || ""}`, r?.ok ? "amber" : "red");
  };

  const fx = useFixtures();
  const runAllFx = async () => {
    const r = await fx.runAll();
    pushToast?.(r?.ok ? `Fixtures ${r.passed}/${r.total} pass` : `Fixtures failed${r?.total != null ? ` (${r.passed}/${r.total})` : ""}`, r?.ok ? "green" : "red");
  };
  const reviewFx = async (id) => {
    const r = await window.api?.fixtures?.expected?.(id).catch(() => null);
    if (r?.ok) setViewFile({ label: `${id}.expected.md`, content: r.content });
    else pushToast?.("No expected.md for this fixture", "amber");
  };

  const openFile = (f) => setViewFile(f);
  const revealFile = (f) => { window.api?.files?.reveal?.(f.path).catch(() => {}); };
  const mmdd = date ? String(date).slice(5) : "";

  return (
    <div className="cs-sys">
      <div className="cs-sys-grid">
        <div className="cs-card">
          <span className="cs-card-label-lg">HEALTH</span>
          <div className="cs-health-list">
            <HRow tone={loopTone} name="Agent loop" value={loopVal} />
            <HRow tone="ok" name="IPC bridge" value="ok" />
            <HRow tone={calTone} name="Calendar feed" value={calN > 0 ? `${calN} events` : "no feed"} valWarn={calN === 0}
                  action={calN === 0 ? <span className="cs-health-retry" {...clickable(retryCal, { label: "retry calendar" })}>RETRY</span> : null} />
            <HRow tone={loopTone} name="Bar-close engine" value={loopVal} />
            <HRow tone={exec?.connected ? "ok" : "warn"} name="Broker feed" value={exec?.connected ? "connected" : exec?.loading ? "checking…" : "not connected"} />
          </div>
        </div>
        <div className="cs-card">
          <span className="cs-card-label-lg">VERSIONS</span>
          <div className="cs-ver-grid">
            <span className="k">Running</span><span className="v">{version?.sha || "—"}</span>
            <span className="k">Booted</span><span className="v">{version?.boot_sha || "—"}</span>
            <span className="k">Status</span><span className={"v " + verState.tone}>{verState.t}</span>
          </div>
          <div className="cs-card-foot-note">Red RESTART = disk is ahead of this boot.</div>
        </div>

        <div className="cs-card is-full">
          <div className="cs-fx-head">
            <span className="cs-card-label">FIXTURES</span>
            <span className="sp" style={{ flex: 1 }} />
            <span className="cs-fx-runall" {...clickable(runAllFx, { label: "run all fixtures" })}>{fx.busy ? "RUNNING…" : "RUN ALL"}</span>
          </div>
          {fx.fixtures.length
            ? fx.fixtures.map((f) => (
                <div key={f.id} className="cs-fx-row">
                  <span className="cs-fx-name">{f.name}</span>
                  {fx.status[f.id] && <span className={"cs-fx-status " + fx.status[f.id]}>{fx.status[f.id]}</span>}
                  <span className="cs-fx-chip" {...clickable(() => fx.run(f.id), { label: "run fixture" })}>RUN</span>
                  {f.hasExpected && <span className="cs-fx-chip" {...clickable(() => reviewFx(f.id), { label: "review expected" })}>REVIEW</span>}
                </div>
              ))
            : <span className="cs-sys-empty">no fixtures</span>}
          <div className="cs-card-foot-note">Fixtures replay into Backtest, never live.</div>
        </div>
      </div>

      <div className="cs-sys-actions">
        <span className="cs-actions-label">ACTIONS</span>
        <div className="cs-action-group">
          <span className="cs-action-lbl">Supervisor</span>
          <span className="cs-action-chip stop" {...clickable(supStop, { label: "stop supervisor" })}>STOP</span>
          <span className="cs-action-chip restart" {...clickable(supRestart, { label: "restart supervisor" })}>RESTART</span>
        </div>
        <div className="cs-action-group">
          <span className="cs-action-lbl">Leader latch</span>
          <span className="cs-action-chip" {...clickable(resetLeader, { label: "reset leader latch" })}>RESET</span>
        </div>
        <div className="cs-action-group">
          <span className={"cs-action-dot" + (exec?.connected ? " ok" : "")} />
          <span className="cs-action-lbl">Broker</span>
          <span className="cs-action-val">{exec?.connected ? "connected" : "log in to Tradovate in the chart"}</span>
        </div>
      </div>

      <div className="cs-sys-files">
        <span className="cs-files-label">SESSION FILES{mmdd ? ` · ${mmdd}` : ""}</span>
        {shownFiles.length
          ? shownFiles.map((f) => (
              <span key={f.path} className="cs-file-pill">
                <span className="cs-file-name">{f.label || f.path.split("/").pop()}</span>
                <span className="cs-file-open" {...clickable(() => openFile(f), { label: "open file" })}>OPEN</span>
                <span className="cs-file-reveal" {...clickable(() => revealFile(f), { label: "reveal file" })}>REVEAL</span>
              </span>
            ))
          : <span className="cs-sys-empty">no session files yet</span>}
      </div>

      {viewFile && <FileViewer file={viewFile} onClose={() => setViewFile(null)} />}
    </div>
  );
}

export function SystemShellPage({ onClose, pushToast }) {
  return (
    <Page icon={PAGE_ICONS.system} tint="mute" title="System" page="system"
          sub="health · versions · files" hint="ops & diagnostics" onClose={onClose}>
      <SystemBody pushToast={pushToast} />
    </Page>
  );
}
