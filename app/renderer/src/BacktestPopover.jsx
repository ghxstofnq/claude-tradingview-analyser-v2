// app/renderer/src/BacktestPopover.jsx
// Topbar BACKTEST cell + anchored popover. Six bodies switch by state.ui.
// Logic + IPC bridge live in hooks/useBacktest.js; this file is presentation.

import React, { useState, useMemo } from "react";
import { clickable } from "./a11y.js";
import { useFloat } from "./hooks/useFloat.js";
import { useBacktest } from "./hooks/useBacktest.js";
import { useBaseline } from "./hooks/useBaseline.js";
import { useTests } from "./hooks/useTests.js";
import Analytics from "./Analytics.jsx";
import { buildAnalytics } from "../../../cli/lib/backtest-analytics.js";
import { verdictFromBaseline, verdictTone } from "../../../cli/lib/backtest-verdict.js";
import {
  aggregateRuns, filterRuns, formatRunForRow,
  formatClockEt, recordClockEt, outcomeMeta, runGrade, displayGrade,
  weekdaysBetween, expandStudy, todayET, parseGateInput,
} from "./Backtest.helpers.js";

// Three workflow modes the panel walks: RECORD a corpus → measure it
// (BASELINE) → COMPARE a fix. The transient engine states (running / pause /
// done) live INSIDE record; DETAIL is a drill-in, not a mode.
const BT_MODES = [["RECORD", "RECORD"], ["BASELINE", "BASELINE"], ["COMPARE", "COMPARE"]];
const RECORD_UIS = new Set(["IDLE", "AUTO_RUNNING", "PAUSE_AWAITING", "DONE"]);
function modeForUi(ui) {
  if (RECORD_UIS.has(ui)) return "RECORD";
  if (ui === "LIBRARY") return "BASELINE";
  if (ui === "TESTS") return "COMPARE";
  return null; // DETAIL — a drill-in, no mode highlighted
}

export function BacktestCell() {
  const [open, setOpen] = useState(false);
  const float = useFloat();
  const { state, actions } = useBacktest();
  // Instrument view — scopes the configure form's recents and the analytics to
  // one symbol. Persists while the popover is open; the configure SYMBOL
  // selector (mnq/mes/both) is a separate choice (what to RUN).
  const [symbolView, setSymbolView] = useState("MNQ1!");

  // Outside-click to close — same trick as the other pop-cells use via
  // .pop-cell onClick toggling. Children stopPropagation so clicks inside
  // the popover don't toggle the cell.
  const onCellClick = (e) => {
    // ignore clicks bubbled from inside the popover
    if (e.target.closest(".bt-popover")) return;
    setOpen((o) => !o);
  };

  const close = () => setOpen(false);

  return (
    <div className={"cell pop-cell bt" + (open ? " open" : "")} {...clickable(onCellClick)}>
      <span className="k">BACKTEST</span>
      <BadgeForState state={state} />
      {open && (
        <div
          className={"bt-popover " + (state.ui === "LIBRARY" || state.ui === "TESTS" ? "w-analytics" : "w-660 bt-fixed") + float.popoverClass}
          style={float.popoverStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <Header state={state} actions={actions} onClose={close} float={float} />
          {state.ui !== "DETAIL" && (
            <CorpusStatus runs={state.library.runs} symbolView={symbolView} />
          )}
          {state.ui === "LIBRARY" && (
            <div className="bt-sym-bar">
              <span className="bt-sym-label">INSTRUMENT</span>
              <SegPills value={symbolView} onChange={setSymbolView} options={[["MNQ1!", "MNQ"], ["MES1!", "MES"]]} />
            </div>
          )}
          <div className="body">
            {state.ui === "IDLE" && <IdleBody state={state} actions={actions} symbolView={symbolView} />}
            {state.ui === "AUTO_RUNNING" && <RunningBody state={state} actions={actions} />}
            {state.ui === "PAUSE_AWAITING" && <PauseBody state={state} actions={actions} />}
            {state.ui === "DONE" && <DoneBody state={state} actions={actions} />}
            {state.ui === "LIBRARY" && <LibraryBody state={state} actions={actions} symbolView={symbolView} />}
            {state.ui === "TESTS" && <TestsBody symbolView={symbolView} />}
            {state.ui === "DETAIL" && <DetailBody state={state} actions={actions} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BacktestBody — the BACKTEST view without cell/float chrome, for the
// Command Shell page frame (2026-07-03). Rendered inside `.bt-popover.embedded`
// so every existing backtest style applies. onClose closes the hosting page.
// PR1-transitional (shares useBacktest with BacktestCell; PR2 collapses).
export function BacktestBody({ onClose }) {
  const { state, actions } = useBacktest();
  const [symbolView, setSymbolView] = useState("MNQ1!");
  return (
    <div className="bt-popover embedded">
      <Header state={state} actions={actions} onClose={onClose || (() => {})} float={null} />
      {state.ui !== "DETAIL" && <CorpusStatus runs={state.library.runs} symbolView={symbolView} />}
      {state.ui === "LIBRARY" && (
        <div className="bt-sym-bar">
          <span className="bt-sym-label">INSTRUMENT</span>
          <SegPills value={symbolView} onChange={setSymbolView} options={[["MNQ1!", "MNQ"], ["MES1!", "MES"]]} />
        </div>
      )}
      <div className="body">
        {state.ui === "IDLE" && <IdleBody state={state} actions={actions} symbolView={symbolView} />}
        {state.ui === "AUTO_RUNNING" && <RunningBody state={state} actions={actions} />}
        {state.ui === "PAUSE_AWAITING" && <PauseBody state={state} actions={actions} />}
        {state.ui === "DONE" && <DoneBody state={state} actions={actions} />}
        {state.ui === "LIBRARY" && <LibraryBody state={state} actions={actions} symbolView={symbolView} />}
        {state.ui === "TESTS" && <TestsBody symbolView={symbolView} />}
        {state.ui === "DETAIL" && <DetailBody state={state} actions={actions} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Header — varies by state.ui
// ─────────────────────────────────────────────────────────────────────
function Header({ state, actions, onClose, float }) {
  const floatBtn = float ? (
    <span className={"float-btn" + (float.floating ? " on" : "")}
          title={float.floating ? "Dock window" : "Float — move & resize freely"}
          onClick={float.toggle}>⛶</span>
  ) : null;
  if (state.ui === "DETAIL") {
    const run = state.detail?.entry;
    return (
      <div className="head" onMouseDown={float?.onDragStart}>
        <span className="back" onClick={(e) => { e.stopPropagation(); actions.back(); }}>← BASELINE</span>
        <span className="t">{run?.date ?? state.selectedRunId} · {sessionLabel(run?.session)}</span>
        {run && (
          <span className={"cs-tag " + (run.total_r >= 0 ? "green" : "red")}>
            {run.total_r > 0 ? "+" : ""}{(run.total_r ?? 0).toFixed(1)}R
          </span>
        )}
        {run && <span className="cs-tag neutral">{(run.mode ?? "").toUpperCase()}</span>}
        <span className="spacer" />
        {floatBtn}
        <span className="x" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</span>
      </div>
    );
  }

  const cfg = {
    IDLE:           { cls: "",      x: "×",  dismissable: true },
    AUTO_RUNNING:   { cls: "",      x: "─",  dismissable: false, pulse: true },
    PAUSE_AWAITING: { cls: "pause", x: "─",  dismissable: false },
    DONE:           { cls: "done",  x: "×",  dismissable: true },
    LIBRARY:        { cls: "",      x: "×",  dismissable: true },
    TESTS:          { cls: "",      x: "×",  dismissable: true },
  }[state.ui] ?? { cls: "", x: "×", dismissable: true };

  // Navigate by workflow mode: RECORD resets to the configure form, BASELINE
  // opens the corpus analytics, COMPARE opens the fold-tests. The engine-driven
  // record sub-states (running / pause / done) aren't manually entered.
  const activeMode = modeForUi(state.ui);
  const recording = state.ui === "AUTO_RUNNING" || state.ui === "PAUSE_AWAITING";
  const goMode = (m) => {
    if (m === activeMode) return;
    if (recording) return;                 // don't navigate away mid-record
    if (m === "RECORD") actions.runAnother();
    else if (m === "BASELINE") actions.viewAll();
    else if (m === "COMPARE") actions.viewTests();
  };

  return (
    <div className="head" onMouseDown={float?.onDragStart}>
      <span className={"t " + cfg.cls}>
        {cfg.pulse && <span className="pulse" />}
        <span className="bt-title">BACKTEST</span>
      </span>
      <span className="bt-modes" onClick={(e) => e.stopPropagation()}>
        {BT_MODES.map(([m, l]) => (
          <button key={m} type="button"
                  className={"bt-mode" + (activeMode === m ? " on" : "") + (recording && m !== activeMode ? " locked" : "")}
                  onClick={() => goMode(m)}>{l}</button>
        ))}
      </span>
      <span className="spacer" />
      {floatBtn}
      <span
        className="x"
        onClick={(e) => {
          e.stopPropagation();
          if (cfg.dismissable) onClose();
        }}
      >{cfg.x}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Badge — what shows in the topbar cell beside the BACKTEST label
// ─────────────────────────────────────────────────────────────────────
function BadgeForState({ state }) {
  if (state.ui === "AUTO_RUNNING") {
    const p = state.currentRun?.progress;
    const pct = p ? Math.round((p.bar / Math.max(1, p.total)) * 100) : 0;
    return (
      <span className="llm-ind">
        <span className="dot" />
        <span className="pct">{pct}%</span>
      </span>
    );
  }
  if (state.ui === "PAUSE_AWAITING") {
    return (
      <span className="paused-ind">
        <span className="dot" />
        <span className="lbl">PAUSED</span>
      </span>
    );
  }
  if (state.ui === "DONE") {
    return (
      <span className="done-ind">
        <span className="check">✓</span>
        <span className="count green">{state.library.runs.length}</span>
      </span>
    );
  }
  return <span className="count">{state.library.runs.length}</span>;
}

// ─────────────────────────────────────────────────────────────────────
// Corpus status — the recorded sample the whole workflow folds over. Sits
// under the header in every mode; the loop is meaningless without it, and
// right now (post-wipe) it's empty, so the empty read points at RECORD.
// ─────────────────────────────────────────────────────────────────────
function CorpusStatus({ runs = [], symbolView }) {
  const sym = symbolView === "MES1!" ? "MES" : "MNQ";
  const mine = filterRuns(runs, { symbol: symbolView });
  const n = mine.length;
  const dates = mine.map((r) => r.date).filter(Boolean).sort();
  const span = n > 0 ? `${dates[0]} → ${dates[dates.length - 1]}` : null;
  return (
    <div className={"bt-corpus" + (n === 0 ? " empty" : "")}>
      <span className="cs-k">CORPUS</span>
      <span className="cs-sym">{sym}</span>
      {n === 0
        ? <span className="cs-empty">empty — record a sample to begin</span>
        : <span className="cs-v">{n} session{n === 1 ? "" : "s"} · {span}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// IDLE body — configure a new run + recent 5
// ─────────────────────────────────────────────────────────────────────
function IdleBody({ state, actions, symbolView }) {
  const presets = presetRanges();
  const STUDY_PRESETS = [
    { id: "today", label: "Today", start: presets.today[0], end: presets.today[1] },
    { id: "week", label: "This week", start: presets.week[0], end: presets.week[1] },
    { id: "lastweek", label: "Last week", start: presets.lastweek[0], end: presets.lastweek[1] },
    { id: "custom", label: "Custom", start: null, end: null },
  ];
  const [symbol, setSymbol] = useState("both");
  const [preset, setPreset] = useState("lastweek");
  const [start, setStart] = useState(presets.lastweek[0]);
  const [end, setEnd] = useState(presets.lastweek[1]);
  const [sessions, setSessions] = useState({ "ny-am": true, "ny-pm": false, "london": true, "eth": false });
  const [mode, setMode] = useState("auto");
  const symRuns = filterRuns(state.library.runs, { symbol: symbolView });
  const agg = aggregateRuns(symRuns);
  const recent = symRuns.slice(0, 5);

  const applyPreset = (p) => { setPreset(p.id); if (p.start) { setStart(p.start); setEnd(p.end); } };
  const editDate = (which, v) => { setPreset("custom"); which === "start" ? setStart(v) : setEnd(v); };
  const toggleSession = (k) => setSessions((s) => ({ ...s, [k]: !s[k] }));

  const SESS = [["ny-am", "AM"], ["ny-pm", "PM"], ["london", "LON"], ["eth", "ETH"]];
  const selected = SESS.filter(([k]) => sessions[k]);
  const symLabel = { mnq: "MNQ1!", mes: "MES1!", both: "MNQ1! + MES1!" }[symbol];
  const days = weekdaysBetween(start, end);
  // Jobs drop any (date, session) whose session hasn't closed yet, so the count
  // and the run reflect what's actually replayable — not future dates.
  const jobs = expandStudy({ symbol, start, end, sessions, mode });
  const recordings = jobs.length;
  const noPick = jobs.length === 0;
  const canRun = !noPick;
  const run = () => { if (canRun) actions.startStudy(jobs); };
  const sym = symbolView === "MES1!" ? "MES" : "MNQ";
  const cumR = (agg.cum_r > 0 ? "+" : "") + agg.cum_r.toFixed(1) + "R";

  return (
    <div className="bt-idle">
      <div className="bt-cols">
      <div className="section">
        <div className="sect-hd"><span>CONFIGURE RECORD</span><span className="meta">records from the chart</span></div>

        <div className="cfg-form">
          <div className="cfg-row">
            <span className="cfg-rk">SYMBOL</span>
            <Seg value={symbol} onChange={setSymbol} options={[["mnq", "MNQ"], ["mes", "MES"], ["both", "BOTH"]]} />
          </div>

          <div className="cfg-row">
            <span className="cfg-rk">RANGE</span>
            <div className="cfg-presets">
              {STUDY_PRESETS.map((p) => (
                <button key={p.id} type="button" className={"cfg-preset" + (preset === p.id ? " on" : "")} onClick={() => applyPreset(p)}>{p.label}</button>
              ))}
              <span className="cfg-range-hint">{days}d</span>
            </div>
          </div>

          {preset === "custom" && (
            <div className="cfg-row">
              <span className="cfg-rk" />
              <div className="cfg-dates">
                <label className="cfg-date"><span className="dk">START</span><input type="date" value={start} max={end} onChange={(e) => editDate("start", e.target.value)} /></label>
                <span className="arrow">→</span>
                <label className="cfg-date"><span className="dk">END</span><input type="date" value={end} min={start} max={todayET()} onChange={(e) => editDate("end", e.target.value)} /></label>
              </div>
            </div>
          )}

          <div className="cfg-row">
            <span className="cfg-rk">SESSIONS</span>
            <div className="cfg-multi">
              {SESS.map(([k, l]) => (
                <button key={k} type="button" className={"cfg-chip" + (sessions[k] ? " on" : "")} onClick={() => toggleSession(k)}>
                  <span className="ck">{sessions[k] ? "✓" : ""}</span>{l}
                </button>
              ))}
            </div>
          </div>

          <div className="cfg-row">
            <span className="cfg-rk">MODE</span>
            <Seg value={mode} onChange={setMode} options={[["auto", "AUTO"], ["pause", "PAUSE ON SETUP"]]} />
          </div>
        </div>

        <div className="cfg-plan">
          {noPick
            ? <span className="warn">Pick at least one session and a valid date range.</span>
            : <><span className="cfg-plan-arrow">▸</span> <b>{symLabel}</b> · <b>{selected.map((s) => s[1]).join(" + ")}</b> · <span className="cfg-plan-dates">{start} → {end}</span> → <b>{recordings}</b> session{recordings !== 1 ? "s" : ""} to record</>}
        </div>
        <div className="cfg-cost">
          pauses the live loop while recording, then re-arms
        </div>

        <div className="start-row">
          <button className="start-btn" disabled={!canRun} onClick={run}>
            <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true"><path d="M0 0l9 5-9 5z" fill="currentColor" /></svg>
            START RECORD
          </button>
          {mode === "pause" && <span className="cfg-hint">you grade in RECORD</span>}
        </div>
      </div>

      <div className="section bt-summary">
        <div className="sect-hd"><span>RECENT</span><span className="cs-tag neutral">{sym} · {agg.total_runs} RUN{agg.total_runs === 1 ? "" : "S"}</span></div>
        <div className="bt-metrics">
          <div className="bt-metric"><span className="ml">A+ HIT RATE</span><span className="mv green">{pct(agg.aplus_hit_rate)}</span></div>
          <div className="bt-metric"><span className="ml">B HIT RATE</span><span className="mv">{pct(agg.b_hit_rate)}</span></div>
          <div className="bt-metric"><span className="ml">CUMULATIVE R</span><span className={"mv " + (agg.cum_r >= 0 ? "green" : "red")}>{cumR}</span></div>
          <div className="bt-metric"><span className="ml">TOTAL RUNS</span><span className="mv">{agg.total_runs}</span></div>
        </div>
        <button type="button" className="bt-view-all-btn" onClick={actions.viewAll}>VIEW BASELINE · <span className="mono">{symRuns.length}</span> →</button>
      </div>
      </div>

      <div className="section bt-lib-preview">
        <div className="sect-hd">
          <span>LIBRARY <span className="bt-cnt">{recent.length} run{recent.length === 1 ? "" : "s"}</span></span>
          <span className="meta">click a run for detail</span>
        </div>
        {recent.length === 0
          ? <div className="bt-empty">no runs yet — record a session to begin</div>
          : (
            <table className="lib-table bt-lib-idle">
              <thead>
                <tr>
                  <th>DATE</th><th>SESSION</th><th>MODE</th><th>SETUPS</th>
                  <th>W / L</th><th>GRADE</th><th>P&amp;L</th><th>YOU</th><th>COST</th><th aria-label="open" />
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <LibRow key={r.run_id} run={r} onClick={() => actions.rowClick(r.run_id)} />
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

// Preset date ranges relative to today (Mon–Fri weeks).
function presetRanges() {
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today); monday.setDate(today.getDate() - ((dow + 6) % 7));
  const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
  const weekEnd = friday < today ? friday : today;
  const lastMon = new Date(monday); lastMon.setDate(monday.getDate() - 7);
  const lastFri = new Date(lastMon); lastFri.setDate(lastMon.getDate() + 4);
  return {
    today: [iso(today), iso(today)],
    week: [iso(monday), iso(weekEnd)],
    lastweek: [iso(lastMon), iso(lastFri)],
  };
}

// ─────────────────────────────────────────────────────────────────────
// AUTO RUNNING body — progress + surfaced setups
// ─────────────────────────────────────────────────────────────────────
function RunningBody({ state, actions }) {
  const cur = state.currentRun ?? {};
  const p = cur.progress ?? { bar: 0, total: 180, cost: 0, phase: "—" };
  const pctNum = Math.round((p.bar / Math.max(1, p.total)) * 100);
  return (
    <>
      <div className="section">
        <div className="sect-hd">
          <span>{cur.date} · {sessionLabel(cur.session)} · {(cur.mode ?? "").toUpperCase()}</span>
          <span className="cs-tag blue bt-hd-chip">RUNNING</span>
          <span className="meta">${(p.cost ?? 0).toFixed(2)}</span>
        </div>
        <div className="form-row"><span className="k">BAR</span><span className="v">{p.bar} / {p.total}</span></div>
        <div className="form-row"><span className="k">PHASE</span><span className="v">{p.phase}</span></div>
        <div className="progress"><div className="fill" style={{ width: pctNum + "%" }} /></div>
        <div className="progress-meta">
          <span>{pctNum}%</span>
          <span>{cur.setups?.length ?? 0} SETUP{(cur.setups?.length ?? 0) === 1 ? "" : "S"}</span>
        </div>
        <button className="stop-btn" onClick={actions.stop}>■  STOP RUN</button>
      </div>

      <div className="section">
        <div className="sect-hd">
          <span>SURFACED SETUPS</span>
          <span className="meta">{cur.setups?.length ?? 0}</span>
        </div>
        {(cur.setups?.length ?? 0) === 0 && (
          <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>
            no setups yet
          </div>
        )}
        {(cur.setups ?? []).map((s) => (
          <SetupCardReadOnly key={s.id} setup={s} />
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PAUSE AWAITING body — explicit decision UI
// ─────────────────────────────────────────────────────────────────────
function PauseBody({ state, actions }) {
  const setup = state.surfacedSetup;
  if (!setup) return <div className="section"><span className="meta">no surfaced setup</span></div>;
  const cur = state.currentRun ?? {};
  const p = cur.progress ?? {};
  return (
    <>
      <div className="section">
        <div className="sect-hd">
          <span>{cur.date} · {sessionLabel(cur.session)} · PAUSE</span>
          <span className="meta">BAR {p.bar}/{p.total} · ${(p.cost ?? 0).toFixed(2)}</span>
        </div>
        <button className="stop-btn" onClick={actions.stop}>■ STOP RUN</button>
      </div>

      <div className="section">
        <div className="pause-banner">
          <span className="ico" />
          <span>RUN PAUSED — DECIDE BEFORE CONTINUING</span>
        </div>
        <div className="setup-card live">
          <div className="hd">
            <span className={"gp " + gradeClass(setup.grade)}>{displayGrade(setup.grade)}</span>
            <span className={"side " + sideClass(setup.side)}>{(setup.side ?? "").toUpperCase()}</span>
            <span className="model">{setup.model ?? ""}</span>
            <span className="ts">{recordClockEt(setup)}</span>
          </div>
          <div className="lvls">
            <div className="lv"><span className="k">ENTRY</span><span className="v">{setup.entry}</span></div>
            <div className="lv"><span className="k">STOP</span><span className="v red">{setup.stop}</span></div>
            <div className="lv"><span className="k">TP1</span><span className="v green">{setup.tp1}</span></div>
            {setup.tp2 != null && (
              <div className="lv"><span className="k">TP2</span><span className="v green">{setup.tp2}</span></div>
            )}
          </div>
          {setup.rationale && (
            <div className="rationale-block">{setup.rationale}</div>
          )}
        </div>
        <div className="decide">
          <button className="btn accept" onClick={() => actions.accept(setup.id)}>✓ ACCEPT</button>
          <button className="btn reject" onClick={() => actions.reject(setup.id)}>✗ REJECT</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DONE body — summary stats + setup ledger + actions
// ─────────────────────────────────────────────────────────────────────
function DoneBody({ state, actions }) {
  const s = state.currentRun?.summary;
  if (!s) {
    return (
      <div className="section">
        <div className="sect-hd"><span>NO SUMMARY</span></div>
        <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>
          run finished without a summary
        </div>
        <div className="actions">
          <button className="btn primary full" onClick={actions.runAnother}>+ RUN ANOTHER</button>
        </div>
      </div>
    );
  }
  const decided = (s.wins ?? 0) + (s.losses ?? 0); // BE scratches excluded from win-rate
  const winRate = decided > 0 ? Math.round((100 * s.wins) / decided) : 0;
  const runId = state.currentRun?.runId;
  const reRun = () => actions.start({ date: s.date, session: s.session, mode: s.mode });
  const discard = async () => { if (runId) await actions.deleteRun(runId); actions.runAnother(); };
  const hasSetups = (state.currentRun?.setups?.length ?? 0) > 0;
  return (
    <div className={hasSetups ? "bt-cols" : ""}>
      <div className="section">
        <div className="sect-hd">
          <span>{s.date} · {sessionLabel(s.session)} · {(s.mode ?? "").toUpperCase()}</span>
          <span className="cs-tag green bt-hd-chip">DONE</span>
          <span className="meta">${(s.cost_usd ?? 0).toFixed(2)}</span>
        </div>
        <div className="done-grid cols-4">
          <div className="lcell">
            <span className="k">RESULT</span>
            <span className={"v " + (s.total_r > 0 ? "green" : s.total_r < 0 ? "red" : "")}>
              {s.total_r > 0 ? "+" : ""}{(s.total_r ?? 0).toFixed(1)}R
            </span>
            <span className="sub">{s.wins ?? 0}W · {s.losses ?? 0}L</span>
          </div>
          <div className="lcell">
            <span className="k">SETUPS</span>
            <span className="v">{s.setups ?? 0}</span>
            <span className="sub">{s.no_trades ? "no-trade" : ""}</span>
          </div>
          <div className="lcell">
            <span className="k">WIN-RATE</span>
            <span className="v green">{winRate}%</span>
          </div>
          <div className="lcell">
            <span className="k">AGREEMENT</span>
            <span className="v amber">{doneAgreementPct(s)}</span>
          </div>
        </div>
        <div className="actions">
          <button className="btn primary full" onClick={actions.viewAll}>▤  VIEW BASELINE</button>
          <button className="btn secondary" onClick={reRun}>↻ RE-RUN</button>
          {runId && <button className="btn secondary" onClick={() => actions.openDetail(runId)}>▸ OPEN DETAIL</button>}
          <button className="btn danger" onClick={discard}>DISCARD</button>
        </div>
      </div>

      {hasSetups && (
        <div className="section">
          <div className="sect-hd">
            <span>SETUPS</span>
            <span className="meta">{state.currentRun.setups.length}</span>
          </div>
          {state.currentRun.setups.map((s) => (
            <SetupCardReadOnly key={s.id} setup={s} />
          ))}
        </div>
      )}
    </div>
  );
}

// Signed R + folded-when formatters for the baseline panels.
const fmtR = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Number(n) || 0).toFixed(1) + "R";
const fmtFoldTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

// FAITHFUL BASELINE header — folded-when + sessions + sha + RE-FOLD button.
// The go-live VERDICT — the top-level answer the shape asked for. Renders the
// SAME object as `tv backtest verdict` (shared verdictFromBaseline), so the GUI
// headline and an agent read one source of truth.
const VERDICT_WORDS = { NET_POSITIVE: "NET-POSITIVE", NOT_READY: "NOT READY", NEEDS_MORE_DATA: "NEEDS MORE DATA", NO_CORPUS: "NO CORPUS" };
function BaselineVerdict({ baseline, loading, symbolView, onRefold, refolding, builtAt, sha }) {
  const v = verdictFromBaseline(baseline);
  const label = symbolView ? String(symbolView).replace("1!", "") : "";
  const refoldBtn = onRefold ? (
    <button className="cs-btn-ghost-sm bt-verdict-refold" onClick={onRefold} disabled={refolding}
      aria-label="re-fold the baseline">{refolding ? "RE-FOLDING…" : "RE-FOLD"}</button>
  ) : null;
  if (loading && !v) {
    return (
      <div className="bt-verdict is-dim">
        <span className="bt-verdict-dot" />
        <span className="bt-verdict-head" role="heading" aria-level={3}>folding baseline…</span>
        {refoldBtn}
      </div>
    );
  }
  const tone = v ? verdictTone(v.verdict) : "dim";
  const word = v ? (VERDICT_WORDS[v.verdict] || v.verdict) : "NO CORPUS";
  const foldedWhen = builtAt ? new Date(builtAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : null;
  return (
    <div className={"bt-verdict is-" + tone}>
      <span className="bt-verdict-dot" />
      <div className="bt-verdict-main">
        <div className="bt-verdict-line">
          <span className="bt-verdict-head" role="heading" aria-level={3}>{word}</span>
          {v && v.verdict !== "NO_CORPUS" && (
            <span className="bt-verdict-stat">{label ? label + " · " : ""}{v.cum_r >= 0 ? "+" : ""}{v.cum_r}R · {v.sessions} session{v.sessions === 1 ? "" : "s"}</span>
          )}
        </div>
        <span className="bt-verdict-sub">{v ? v.reason : "record a session to build the baseline"}{foldedWhen ? ` · folded ${foldedWhen}${sha ? " · " + sha : ""}` : ""}</span>
      </div>
      {refoldBtn}
    </div>
  );
}

function BaselineHeader({ baseline, loading, refolding, onRefold, symbolView }) {
  const sym = symbolView === "MES1!" ? "MES" : "MNQ";
  const meta = loading
    ? "loading…"
    : baseline
      ? `${baseline.corpus?.n_sessions ?? 0} sessions · folded ${fmtFoldTime(baseline.built_at)}${baseline.code_sha ? " · " + baseline.code_sha : ""}`
      : "not folded yet — hit RE-FOLD";
  return (
    <div className="section">
      <div className="sect-hd">
        <span>FAITHFUL BASELINE · {sym}</span>
        <span className="meta">{meta}</span>
      </div>
      <div className="bl-actions">
        <button className="cs-btn-ghost-sm" disabled={refolding} onClick={onRefold}>
          {refolding ? "RE-FOLDING…" : "RE-FOLD BASELINE"}
        </button>
        {baseline && (
          <span className={"bl-total cs-num " + (baseline.total_r >= 0 ? "up" : "down")}>{fmtR(baseline.total_r)}</span>
        )}
      </div>
    </div>
  );
}

// BASELINE HISTORY — prior accepted baselines, newest first, Δ vs current.
function BaselineHistory({ history = [], current }) {
  const [open, setOpen] = useState(false);
  if (!history.length) return null;
  const rows = history.slice().reverse();
  return (
    <div className="section">
      <div className="sect-hd" style={{ cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span>BASELINE HISTORY</span>
        <span className="meta">{history.length} prior · {open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <table className="lib-table">
          <thead>
            <tr><th>FOLDED</th><th>SESSIONS</th><th>TOTAL</th><th>Δ NOW</th><th>REASON</th></tr>
          </thead>
          <tbody>
            {rows.map((h, i) => {
              const delta = current != null ? Math.round((current - h.total_r) * 100) / 100 : null;
              return (
                <tr key={i}>
                  <td>{fmtFoldTime(h.built_at)}</td>
                  <td>{h.corpus_n ?? "—"}</td>
                  <td className={h.total_r >= 0 ? "green" : "red"}>{fmtR(h.total_r)}</td>
                  <td className={delta == null ? "" : delta >= 0 ? "green" : "red"}>{delta == null ? "—" : fmtR(delta)}</td>
                  <td className="meta">{h.reason ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const testStatusCls = (s) => (s === "accepted" ? "ok" : s === "rejected" ? "bad" : "pend");

// ─────────────────────────────────────────────────────────────────────
// TESTS body — fold-tests vs the accepted baseline, accept/reject + reason
// ─────────────────────────────────────────────────────────────────────
// COMPARE — fold a treatment over the corpus and diff it against the accepted
// baseline, right in the panel. Replaces the old CLI-only save-fold-test.mjs.
function FoldTestForm({ running, onRun }) {
  const [label, setLabel] = useState("");
  const [gate, setGate] = useState("");
  const submit = () => {
    if (running) return;
    onRun({ label: label.trim() || "untitled", env: parseGateInput(gate) });
  };
  return (
    <div className="ft-form">
      <input className="ft-in" placeholder="what change are you testing?"
             value={label} onChange={(e) => setLabel(e.target.value)}
             autoComplete="off" spellCheck="false" />
      <input className="ft-in ft-gate" placeholder="gate · GOFNQ_X=1 (blank = working tree)"
             value={gate} onChange={(e) => setGate(e.target.value)}
             autoComplete="off" spellCheck="false"
             onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <button className="cs-btn-primary-run" disabled={running} onClick={submit}>
        {running ? "FOLDING…" : "RUN FOLD TEST"}
      </button>
    </div>
  );
}

function TestsBody({ symbolView }) {
  const { tests, loading, running, lastError, setVerdict, getTest, removeTest, runFoldTest } = useTests(symbolView);
  // The accepted baseline supplies the "old" side of the baseline → candidate
  // metric diff (win-rate / expectancy / drawdown). Cum R comes off the test's
  // own matched-corpus totals.
  const { baseline } = useBaseline(symbolView);
  const sym = symbolView === "MES1!" ? "MES" : "MNQ";
  const [expandedId, setExpandedId] = useState(null);
  const [full, setFull] = useState(null);

  const toggle = async (id) => {
    if (expandedId === id) { setExpandedId(null); setFull(null); return; }
    setExpandedId(id); setFull(null);
    setFull(await getTest(id));
  };

  return (
    <div className="section bt-tests">
      <div className="ft-title">
        <span className="ft-title-l">
          <span className="ft-title-t">FOLD TESTS</span>
          <span className="ft-title-sym">{sym}</span>
        </span>
        <span className="ft-title-meta">
          {loading ? "loading…" : <><span className="mono">{tests.length}</span> · vs accepted baseline</>}
        </span>
      </div>

      <FoldTestForm running={running} onRun={runFoldTest} />
      <div className="ft-help">name a change, set its gate, RUN FOLD TEST — folds over the corpus vs baseline.</div>
      {lastError && <div className="ft-err">fold failed — {lastError}</div>}

      {!loading && tests.length === 0 && !running && (
        <div className="ft-empty">
          <div className="ft-empty-glyph">⊘</div>
          <div className="ft-empty-t">No fold tests yet</div>
          <div className="ft-empty-sub">name a change above to run your first fold against the baseline.</div>
        </div>
      )}

      {tests.length > 0 && (
        <div className="ft-list">
          {tests.map((t) => {
            const open = expandedId === t.id;
            return (
              <div className="ft-card" key={t.id}>
                <div className={"ft-row" + (open ? " open" : "")} onClick={() => toggle(t.id)}>
                  <div className="ft-row-main">
                    <div className="ft-row-name" title={t.label}>{t.label}</div>
                    <div className="ft-row-gate">
                      {t.code_sha || fmtFoldTime(t.created_at)}
                      {!t.corpus_match && <span className="ft-corpus-warn" title="folded set differs from the baseline — delta mixes code + corpus"> · corpus≠</span>}
                    </div>
                  </div>
                  <div className="ft-col">
                    <div className="ft-col-k">Δ VS BASE</div>
                    <div className={"ft-col-v cs-num " + (t.delta >= 0 ? "up" : "down")}>{fmtR(t.delta)}</div>
                  </div>
                  <div className="ft-col ft-col-sessions">
                    <div className="ft-col-k">SESSIONS</div>
                    <div className="ft-col-v cs-num">{t.per_day?.length ?? 0}</div>
                  </div>
                  <span className={"ft-chip " + testStatusCls(t.status)}>{String(t.status).toUpperCase()}</span>
                  <span className="ft-caret">{open ? "▾" : "▸"}</span>
                </div>

                {open && (
                  <FoldExpand
                    t={t} full={full} baseline={baseline}
                    onAccept={() => setVerdict(t.id, "accepted", null)}
                    onReject={() => setVerdict(t.id, "rejected", null)}
                    onPromote={() => setVerdict(t.id, "accepted", "promoted to baseline")}
                    onDelete={() => removeTest(t.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// COMPARE expand — the baseline → candidate diff on four metrics, then the
// accept / reject / promote decision. Cum R reads the test's matched-corpus
// totals; win-rate / expectancy / drawdown are computed by buildAnalytics over
// the baseline + treatment run_details (real data — no LLM arithmetic; the math
// lives in cli/lib/backtest-analytics.js).
function FoldExpand({ t, full, baseline, onAccept, onReject, onPromote, onDelete }) {
  const base = baseline?.run_details ? buildAnalytics(baseline.run_details) : null;
  const cand = full?.treatment_run_details ? buildAnalytics(full.treatment_run_details) : null;
  const n2 = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(2));
  const n1 = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(1));
  const signPts = (d) => (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(Math.round(d)) + "pts";
  const signR2 = (d) => (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(Number(d) || 0).toFixed(2) + "R";

  const rows = [
    { label: "Cum R", old: n2(t.baseline_total), neu: n2(t.treatment_total), imp: fmtR(t.delta), good: (t.delta ?? 0) >= 0 },
  ];
  if (base && cand) {
    const dWin = cand.win_pct - base.win_pct;
    const dExp = cand.expectancy - base.expectancy;
    const dDD = cand.max_drawdown_r - base.max_drawdown_r; // less-negative = improvement
    rows.push(
      { label: "Win rate", old: base.win_pct + "%", neu: cand.win_pct + "%", imp: signPts(dWin), good: dWin >= 0 },
      { label: "Expectancy", old: n2(base.expectancy) + "R", neu: n2(cand.expectancy) + "R", imp: signR2(dExp), good: dExp >= 0 },
      { label: "Max drawdown", old: n1(base.max_drawdown_r) + "R", neu: n1(cand.max_drawdown_r) + "R", imp: fmtR(dDD), good: dDD >= 0 },
    );
  }

  return (
    <div className="ft-expand" onClick={(e) => e.stopPropagation()}>
      <div className="ft-bc-hd">BASELINE → CANDIDATE</div>
      {rows.map((r, i) => (
        <div className="ft-metric" key={i}>
          <span className="ft-metric-l">{r.label}</span>
          <span className="ft-metric-old cs-num">{r.old}</span>
          <span className="ft-metric-arrow">→</span>
          <span className="ft-metric-new cs-num">{r.neu}</span>
          <span className={"ft-metric-imp cs-num " + (r.good ? "up" : "down")}>{r.imp}</span>
        </div>
      ))}
      {(!base || !cand) && <div className="ft-detail-loading">loading candidate detail…</div>}

      <div className="ft-actions">
        <button className="cs-btn-accept" onClick={onAccept}>✓ ACCEPT</button>
        <button className="cs-btn-reject" onClick={onReject}>✗ REJECT</button>
        <div className="ft-actions-sp" />
        <button className="ft-btn-promote" onClick={onPromote}>PROMOTE</button>
      </div>
      <div className="ft-foot">
        <span className="ft-foot-meta">folded {fmtFoldTime(t.created_at)}{t.code_sha ? " · " + t.code_sha : ""}</span>
        <button className="ft-link" onClick={onDelete}>delete</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LIBRARY body — aggregate dashboard + filters + sortable table
// ─────────────────────────────────────────────────────────────────────
function LibraryBody({ state, actions, symbolView }) {
  const [sessionFilter, setSessionFilter] = useState(null);
  const [modeFilter, setModeFilter] = useState(null);
  const [gradeFilter, setGradeFilter] = useState(null);

  // Scope everything to the active instrument first; the table filters narrow
  // within it. Analytics + aggregate read only this symbol's runs.
  const symRuns = filterRuns(state.library.runs, { symbol: symbolView });
  const filtered = filterRuns(symRuns, {
    session: sessionFilter, mode: modeFilter, grade: gradeFilter,
  });
  const agg = aggregateRuns(symRuns);
  // Dashboard reads the FAITHFUL fold-week baseline (regen + AM->PM carry), not
  // a live re-fold of raw setups.jsonl. Same Analytics component, honest data.
  const { baseline, history, loading, refolding, refold } = useBaseline(symbolView);
  const A = useMemo(() => buildAnalytics(baseline?.run_details ?? []), [baseline]);
  // Grade win% from the SAME faithful fold the dashboard uses (BE-excluded), so
  // the AGGREGATE grid agrees with the BY GRADE card — not the stale
  // generation-time setups_by_grade/wins_by_grade in the index.
  const gradeCut = (g) => (A.by_grade ?? []).find((r) => r.k === g) ?? null;
  const aplus = gradeCut("A+");
  const bCut = gradeCut("B");
  const agreementPct = (() => {
    const a = agg.agreement;
    const total = (a?.agreed ?? 0) + (a?.disagreed ?? 0);
    return total === 0 ? "—" : `${Math.round((100 * a.agreed) / total)}%`;
  })();

  return (
    <>
      {/* Lead with the verdict: it carries the fold status + the RE-FOLD action.
          The old FAITHFUL BASELINE card was redundant with it and is dropped;
          the empty PERFORMANCE card only shows once there's real data. */}
      <BaselineVerdict baseline={baseline} loading={loading || refolding} symbolView={symbolView}
        onRefold={() => refold()} refolding={refolding} builtAt={baseline?.built_at} sha={baseline?.code_sha} />

      {(A.n_trades > 0 || (baseline?.corpus?.n_sessions ?? 0) > 0) && (
        <Analytics A={A} loading={loading || refolding} />
      )}

      {history?.length > 0 && (
        <BaselineHistory history={history} current={baseline?.total_r ?? null} />
      )}

      <div className="section">
        <div className="sect-hd">
          <span>AGGREGATE</span>
          <span className="meta">{symbolView === "MES1!" ? "MES" : "MNQ"} · {agg.total_runs} RUNS</span>
        </div>
        <div className="agg-grid">
          <div className="lcell">
            <span className="k">TOTAL RUNS</span>
            <span className="v">{agg.total_runs}</span>
          </div>
          <div className="lcell">
            <span className="k">A+ WIN%</span>
            <span className="v green">{aplus ? aplus.win + "%" : "—"}</span>
            <span className="sub">{aplus ? "n=" + aplus.n : "—"}</span>
          </div>
          <div className="lcell">
            <span className="k">B WIN%</span>
            <span className="v">{bCut ? bCut.win + "%" : "—"}</span>
            <span className="sub">{bCut ? "n=" + bCut.n : "—"}</span>
          </div>
          <div className="lcell">
            <span className="k">CUM P&amp;L</span>
            <span className={"v " + (A.cum_r >= 0 ? "green" : "red")}>
              {A.cum_r > 0 ? "+" : ""}{A.cum_r.toFixed(1)}R
            </span>
          </div>
          <div className="lcell">
            <span className="k">AGREEMENT</span>
            <span className="v amber">{agreementPct}</span>
            <span className="sub">{agg.agreement.agreed} / {agg.agreement.agreed + agg.agreement.disagreed} graded</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="filters">
          <Filter label="SESSION" value={sessionFilter} onChange={setSessionFilter}
            options={[[null, "ALL"], ["ny-am", "AM"], ["ny-pm", "PM"], ["london", "LON"]]} />
          <Filter label="GRADE" value={gradeFilter} onChange={setGradeFilter}
            options={[[null, "ALL"], ["A+", "A+"], ["B", "B"], ["NO", "NO"]]} />
          <Filter label="MODE" value={modeFilter} onChange={setModeFilter}
            options={[[null, "ALL"], ["auto", "AUTO"], ["pause", "PAUSE"]]} />
          <button className="btn-add" title="add filter" aria-label="add filter" onClick={actions.dismiss}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M5.5 1.2v8.6M1.2 5.5h8.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>

      <div className="section" style={{ padding: 0 }}>
        <table className="lib-table">
          <thead>
            <tr>
              <th className="sorted">DATE <span className="arr">▼</span></th>
              <th>SESSION</th>
              <th>MODE</th>
              <th>SETUPS</th>
              <th>W / L</th>
              <th>GRADE</th>
              <th>P&amp;L</th>
              <th>YOU</th>
              <th>COST</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ color: "var(--label-dim)", textAlign: "center", padding: 20 }}>
                no runs match the current filters
              </td></tr>
            )}
            {filtered.map((r) => (
              <LibRow key={r.run_id} run={r} onClick={() => actions.rowClick(r.run_id)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DETAIL body — single-run deep dive
// ─────────────────────────────────────────────────────────────────────
function DetailBody({ state, actions }) {
  const detail = state.detail;
  if (!detail) {
    return (
      <div className="section">
        <div className="sect-hd"><span>LOADING</span></div>
        <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>
          fetching run data…
        </div>
      </div>
    );
  }
  const { entry, setups = [], activity = [] } = detail;
  if (!entry) {
    return (
      <div className="section">
        <div className="sect-hd"><span>NOT FOUND</span></div>
        <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>
          this run is no longer in the index
        </div>
        <div className="actions">
          <button className="btn secondary full" onClick={actions.back}>← BASELINE</button>
        </div>
      </div>
    );
  }

  const openEvents = setups.filter((s) => s.type === "open");
  const outcomes = setups.filter((s) => s.type === "outcome");
  const decided = (entry.wins ?? 0) + (entry.losses ?? 0); // BE scratches excluded from win-rate
  const winRate = decided > 0 ? Math.round((100 * entry.wins) / decided) : 0;
  const agreement = entry.your_agreement ?? { agreed: 0, disagreed: 0, ungraded: 0 };
  const agreementTotal = agreement.agreed + agreement.disagreed;
  const agreementPct = agreementTotal === 0 ? "—" : Math.round((100 * agreement.agreed) / agreementTotal) + "%";

  return (
    <>
      <div className="section">
        <div className="sect-hd">
          <span>SUMMARY</span>
          <span className="meta">${(entry.cost_usd ?? 0).toFixed(2)} · {formatElapsed(entry.elapsed_ms)}</span>
        </div>
        <div className="done-grid cols-4">
          <div className="lcell">
            <span className="k">RESULT</span>
            <span className={"v " + (entry.total_r > 0 ? "green" : entry.total_r < 0 ? "red" : "")}>
              {entry.total_r > 0 ? "+" : ""}{(entry.total_r ?? 0).toFixed(1)}R
            </span>
            <span className="sub">{entry.wins ?? 0}W · {entry.losses ?? 0}L</span>
          </div>
          <div className="lcell">
            <span className="k">SETUPS</span>
            <span className="v">{entry.setups ?? 0}</span>
          </div>
          <div className="lcell">
            <span className="k">WIN-RATE</span>
            <span className="v green">{winRate}%</span>
          </div>
          <div className="lcell">
            <span className="k">AGREEMENT</span>
            <span className="v amber">{agreementPct}</span>
          </div>
        </div>
      </div>

      {openEvents.length > 0 && (
        <div className="section">
          <div className="sect-hd">
            <span>SETUPS</span>
            <span className="meta">{openEvents.length}</span>
          </div>
          {openEvents.map((open) => {
            const outcome = outcomes.find((o) => o.setup_id === open.id);
            const setup = { ...open, outcome: outcome?.outcome, exit: outcome?.exit };
            return <SetupCardReadOnly key={open.id} setup={setup} />;
          })}
        </div>
      )}

      {activity.length > 0 && (
        <div className="section">
          <div className="sect-hd">
            <span>LLM ACTIVITY LOG</span>
            <span className="meta">{activity.length} TURNS</span>
          </div>
          <div className="log">
            {activity.map((a, i) => (
              <div key={i} className={"ln phase-" + (a.phase ?? "")}>
                <span className="t">{formatClockEt(a.ts)}</span>
                <span className="ph">{a.phase ?? a.purpose ?? ""}</span>
                <span className="msg">{a.message ?? a.summary_msg ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <div className="actions row">
          <button className="cs-btn-ghost-sm" onClick={() => actions.start({ date: entry.date, session: entry.session, mode: entry.mode })}>↻ RE-RUN</button>
          <div className="spacer" />
          <button className="cs-btn-ghost-sm danger" onClick={() => {
            if (confirm(`Delete run ${entry.run_id}? This removes the folder + summary.`)) {
              actions.deleteRun(entry.run_id);
              actions.back();
            }
          }}>DELETE RUN</button>
        </div>
      </div>
    </>
  );
}

function Filter({ label, value, onChange, options }) {
  return (
    <div className="filter">
      <span className="k">{label}</span>
      <SegPills value={value} onChange={onChange} options={options} />
    </div>
  );
}

function LibRow({ run, onClick }) {
  const grade = runGrade(run);
  const f = formatRunForRow(run);
  const ag = run.your_agreement ?? { agreed: 0, disagreed: 0 };
  return (
    <tr onClick={onClick}>
      <td>{run.date}</td>
      <td className="ses">{f.session_short}</td>
      <td className="dim">{(run.mode ?? "").toUpperCase()}</td>
      <td>{run.setups ?? 0}</td>
      <td className={
        (run.wins ?? 0) > (run.losses ?? 0) ? "green" :
        (run.losses ?? 0) > 0 ? "red" : "dim"
      }>
        {run.setups === 0 ? "—" : `${run.wins ?? 0} / ${run.losses ?? 0}`}
      </td>
      <td><span className={"pill " + gradeClass(grade)}>{grade}</span></td>
      <td className={run.total_r > 0 ? "green" : run.total_r < 0 ? "red" : "dim"}>
        {(run.total_r ?? 0) === 0 ? "—" :
          `${run.total_r > 0 ? "+" : ""}${(run.total_r ?? 0).toFixed(1)}R`}
      </td>
      <td>
        {agreementTotalLabel(ag)}
      </td>
      <td className="dim">${(run.cost_usd ?? 0).toFixed(2)}</td>
      <td className="arr">▸</td>
    </tr>
  );
}

function agreementTotalLabel(ag) {
  if (!ag || (ag.agreed === 0 && ag.disagreed === 0)) return <span className="dim">—</span>;
  return (
    <span className="agree-mark">
      {Array.from({ length: ag.agreed }, (_, i) => (<span key={"ok" + i} className="ok">✓</span>))}
      {Array.from({ length: ag.disagreed }, (_, i) => (<span key={"no" + i} className="no">✗</span>))}
    </span>
  );
}

function formatElapsed(ms) {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────
// Shared subcomponents
// ─────────────────────────────────────────────────────────────────────
function Seg({ value, onChange, options }) {
  return (
    <div className="seg">
      {options.map(([v, lbl]) => (
        <div
          key={v}
          className={"s" + (value === v ? " on" : "")}
          onClick={() => onChange(v)}
        >{lbl}</div>
      ))}
    </div>
  );
}

// Command-Shell segmented pills — detached .cs-segpill group (RECORD-page
// look). Drop-in for <Seg> where the redesign calls for pills, not boxes.
function SegPills({ value, onChange, options }) {
  return (
    <div className="bt-seg">
      {options.map(([v, lbl]) => (
        <button
          key={String(v)}
          type="button"
          className={"cs-segpill" + (value === v ? " is-on" : "")}
          onClick={() => onChange(v)}
        >{lbl}</button>
      ))}
    </div>
  );
}

function SetupCardReadOnly({ setup }) {
  const om = outcomeMeta(setup.outcome);
  const cls = om.cls;
  return (
    <div className={"setup-card " + cls}>
      <div className="hd">
        <span className={"gp " + gradeClass(setup.grade)}>{displayGrade(setup.grade)}</span>
        <span className={"cs-dir " + (setup.side ?? "").toLowerCase()}>{(setup.side ?? "").toUpperCase()}</span>
        <span className="model">{setup.model ?? ""}</span>
        <span className="ts">{recordClockEt(setup)}</span>
      </div>
      <div className="lvls">
        <div className="lv"><span className="k">ENTRY</span><span className="v">{setup.entry}</span></div>
        <div className="lv"><span className="k">STOP</span><span className="v red">{setup.stop}</span></div>
        <div className="lv"><span className="k">TP1</span><span className="v green">{setup.tp1}</span></div>
      </div>
      {setup.outcome && om.label && (
        <div className="outcome">
          <span className={"res " + om.cls}>
            <span className="ind" />
            {om.label} @ {setup.exit ?? "—"}
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (display-only)
// ─────────────────────────────────────────────────────────────────────
function sessionLabel(s) {
  return ({ "ny-am": "AM", "ny-pm": "PM", london: "LONDON" })[s] ?? (s ?? "");
}
function gradeClass(g) {
  if (g === "A+") return "green";
  if (g === "B") return "amber";
  return "dim";
}
function sideClass(side) {
  const s = (side ?? "").toLowerCase();
  if (s === "long") return "l";
  if (s === "short") return "s";
  return "";
}
function pct({ numerator, denominator }) {
  if (!denominator) return "—";
  return Math.round((100 * numerator) / denominator) + "%";
}
function pad(n) { return String(n).padStart(2, "0"); }
function doneAgreementPct(s) {
  const a = s?.your_agreement;
  if (!a) return "—";
  const total = (a.agreed ?? 0) + (a.disagreed ?? 0);
  return total === 0 ? "—" : `${Math.round((100 * a.agreed) / total)}%`;
}
