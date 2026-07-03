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

function HRow({ tone, name, value, action }) {
  return (
    <div className="cmd-sys-hrow">
      <span className={"dot-inline " + (tone || "ok")} />
      <span className="name">{name}</span>
      <span className="val">{value}</span>
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
    <div className="cmd-sys">
      <div className="cmd-sys-grid">
        <div className="cmd-sys-card">
          <span className="cmd-sys-cap">HEALTH</span>
          <HRow tone={loopTone} name="Agent loop" value={loopVal} />
          <HRow tone="ok" name="IPC bridge" value="ok" />
          <HRow tone={calTone} name="Calendar feed" value={calN > 0 ? `${calN} events` : "no feed"}
                action={calN === 0 ? <span className="cmd-sys-linkchip amber" {...clickable(retryCal, { label: "retry calendar" })}>RETRY</span> : null} />
          <HRow tone={loopTone} name="Bar-close engine" value={loopVal} />
          <HRow tone={exec?.connected ? "ok" : "warn"} name="Broker feed" value={exec?.connected ? "connected" : exec?.loading ? "checking…" : "not connected"} />
        </div>
        <div className="cmd-sys-card">
          <span className="cmd-sys-cap">VERSIONS</span>
          <div className="cmd-sys-vgrid">
            <span className="k">Running</span><span className="v">{version?.sha || "—"}</span>
            <span className="k">Booted</span><span className="v">{version?.boot_sha || "—"}</span>
            <span className="k">Status</span><span className={"v " + verState.tone}>{verState.t}</span>
          </div>
          <div className="cmd-sys-note">Red RESTART = disk is ahead of this boot.</div>
        </div>
      </div>

      <div className="cmd-sys-card cmd-sys-strip actions">
        <span className="cmd-sys-cap">ACTIONS</span>
        <div className="cmd-sys-actgrp">
          <span className="lbl">Supervisor</span>
          <span className="cmd-sys-linkchip red" {...clickable(supStop, { label: "stop supervisor" })}>STOP</span>
          <span className="cmd-sys-linkchip amber" {...clickable(supRestart, { label: "restart supervisor" })}>RESTART</span>
        </div>
        <div className="cmd-sys-actgrp">
          <span className="lbl">Leader latch</span>
          <span className="cmd-sys-linkchip" {...clickable(resetLeader, { label: "reset leader latch" })}>RESET</span>
        </div>
        <div className="cmd-sys-actgrp">
          <span className={"dot-inline " + (exec?.connected ? "ok" : "warn")} />
          <span className="lbl">Broker</span>
          <span className="val-dim">{exec?.connected ? "connected" : "log in to Tradovate in the chart"}</span>
        </div>
      </div>

      <div className="cmd-sys-card">
        <div className="cmd-sys-fxhd">
          <span className="cmd-sys-cap">FIXTURES</span>
          <span className="sp" style={{ flex: 1 }} />
          <span className="cmd-sys-linkchip green" {...clickable(runAllFx, { label: "run all fixtures" })}>{fx.busy ? "RUNNING…" : "RUN ALL"}</span>
        </div>
        {fx.fixtures.length
          ? fx.fixtures.map((f) => (
              <div key={f.id} className="cmd-sys-fxrow">
                <span className="nm">{f.name}</span>
                {fx.status[f.id] && <span className={"fxst " + fx.status[f.id]}>{fx.status[f.id]}</span>}
                <span className="cmd-sys-linkchip" {...clickable(() => fx.run(f.id), { label: "run fixture" })}>RUN</span>
                {f.hasExpected && <span className="cmd-sys-linkchip" {...clickable(() => reviewFx(f.id), { label: "review expected" })}>REVIEW</span>}
              </div>
            ))
          : <span className="val-dim">no fixtures</span>}
      </div>

      <div className="cmd-sys-card cmd-sys-strip files">
        <span className="cmd-sys-cap">SESSION FILES{mmdd ? ` · ${mmdd}` : ""}</span>
        {shownFiles.length
          ? shownFiles.map((f) => (
              <span key={f.path} className="cmd-sys-filepill">
                <span className="name">{f.label || f.path.split("/").pop()}</span>
                <span className="open" {...clickable(() => openFile(f), { label: "open file" })}>OPEN</span>
                <span className="reveal" {...clickable(() => revealFile(f), { label: "reveal file" })}>REVEAL</span>
              </span>
            ))
          : <span className="val-dim">no session files yet</span>}
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
