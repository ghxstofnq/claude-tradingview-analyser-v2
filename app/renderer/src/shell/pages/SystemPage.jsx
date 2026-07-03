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
  const supStart = () => { window.api?.detector?.start?.().catch(() => {}); pushToast?.("Supervisor restarting", "amber"); };

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
          <span className="cmd-sys-linkchip amber" {...clickable(supStart, { label: "restart supervisor" })}>RESTART</span>
        </div>
        <div className="cmd-sys-actgrp">
          <span className={"dot-inline " + (exec?.connected ? "ok" : "warn")} />
          <span className="lbl">Broker</span>
          <span className="val-dim">{exec?.connected ? "connected" : "not connected"}</span>
        </div>
      </div>

      <div className="cmd-sys-card cmd-sys-strip files">
        <span className="cmd-sys-cap">SESSION FILES{mmdd ? ` · ${mmdd}` : ""}</span>
        {files.length
          ? files.map((f) => (
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
