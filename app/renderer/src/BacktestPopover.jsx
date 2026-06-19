// app/renderer/src/BacktestPopover.jsx
// Topbar BACKTEST cell + anchored popover. Six bodies switch by state.ui.
// Logic + IPC bridge live in hooks/useBacktest.js; this file is presentation.

import React, { useState } from "react";
import { useBacktest } from "./hooks/useBacktest.js";
import { useAnalytics } from "./hooks/useAnalytics.js";
import Analytics from "./Analytics.jsx";
import {
  aggregateRuns, filterRuns, formatRunForRow,
  formatClockEt, recordClockEt, outcomeMeta, runGrade, displayGrade,
  weekdaysBetween, expandStudy, todayET,
} from "./Backtest.helpers.js";

// Header state-switcher (designer's NEW/RUN/PAUSE/DONE/ANALYTICS). Internal
// reducer states map: IDLE→NEW, AUTO_RUNNING→RUN, PAUSE_AWAITING→PAUSE,
// DONE→DONE, LIBRARY→ANALYTICS. NEW + ANALYTICS are always navigable; the
// engine-driven states only light up when the run is in them.
const BT_SWITCHER = [
  ["IDLE", "NEW"], ["AUTO_RUNNING", "RUN"], ["PAUSE_AWAITING", "PAUSE"],
  ["DONE", "DONE"], ["LIBRARY", "ANALYTICS"],
];

export function BacktestCell() {
  const [open, setOpen] = useState(false);
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
    <div className={"cell pop-cell bt" + (open ? " open" : "")} onClick={onCellClick}>
      <span className="k">BACKTEST</span>
      <BadgeForState state={state} />
      {open && (
        <div
          className={"bt-popover " + (state.ui === "LIBRARY" ? "w-analytics" : "w-660 bt-fixed")}
          onClick={(e) => e.stopPropagation()}
        >
          <Header state={state} actions={actions} onClose={close} />
          {(state.ui === "IDLE" || state.ui === "LIBRARY") && (
            <div className="bt-sym-bar">
              <span className="bt-sym-label">INSTRUMENT</span>
              <Seg value={symbolView} onChange={setSymbolView} options={[["MNQ1!", "MNQ"], ["MES1!", "MES"]]} />
            </div>
          )}
          <div className="body">
            {state.ui === "IDLE" && <IdleBody state={state} actions={actions} symbolView={symbolView} />}
            {state.ui === "AUTO_RUNNING" && <RunningBody state={state} actions={actions} />}
            {state.ui === "PAUSE_AWAITING" && <PauseBody state={state} actions={actions} />}
            {state.ui === "DONE" && <DoneBody state={state} actions={actions} />}
            {state.ui === "LIBRARY" && <LibraryBody state={state} actions={actions} symbolView={symbolView} />}
            {state.ui === "DETAIL" && <DetailBody state={state} actions={actions} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Header — varies by state.ui
// ─────────────────────────────────────────────────────────────────────
function Header({ state, actions, onClose }) {
  if (state.ui === "DETAIL") {
    const run = state.detail?.entry;
    return (
      <div className="head">
        <span className="back" onClick={(e) => { e.stopPropagation(); actions.back(); }}>← LIBRARY</span>
        <span className="t">{run?.date ?? state.selectedRunId} · {sessionLabel(run?.session)}</span>
        {run && (
          <span className={"meta-pill " + (run.total_r >= 0 ? "" : "red")}>
            {run.total_r > 0 ? "+" : ""}{(run.total_r ?? 0).toFixed(1)}R
          </span>
        )}
        {run && <span className="meta-pill amber">{(run.mode ?? "").toUpperCase()}</span>}
        <span className="spacer" />
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
  }[state.ui] ?? { cls: "", x: "×", dismissable: true };

  // Navigate via the switcher: NEW resets to IDLE, ANALYTICS opens the
  // library; engine-driven states (RUN/PAUSE/DONE) aren't manually entered.
  const goState = (s) => {
    if (s === state.ui) return;
    if (s === "IDLE") actions.runAnother();
    else if (s === "LIBRARY") actions.viewAll();
  };

  return (
    <div className="head">
      <span className={"t " + cfg.cls}>
        {cfg.pulse && <span className="pulse" />}
        BACKTEST
      </span>
      <span className="live-tabs" style={{ marginLeft: 10 }} onClick={(e) => e.stopPropagation()}>
        {BT_SWITCHER.map(([s, l]) => (
          <span key={s}
                className={"tab" + (state.ui === s ? " on" : "") + (s === "IDLE" || s === "LIBRARY" ? "" : " dim")}
                onClick={() => goState(s)}>{l}</span>
        ))}
      </span>
      <span className="spacer" />
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
// IDLE body — configure a new run + recent 5
// ─────────────────────────────────────────────────────────────────────
function IdleBody({ state, actions, symbolView }) {
  const presets = presetRanges();
  const STUDY_PRESETS = [
    { id: "today", label: "TODAY", start: presets.today[0], end: presets.today[1] },
    { id: "week", label: "THIS WEEK", start: presets.week[0], end: presets.week[1] },
    { id: "lastweek", label: "LAST WEEK", start: presets.lastweek[0], end: presets.lastweek[1] },
    { id: "custom", label: "CUSTOM", start: null, end: null },
  ];
  const [symbol, setSymbol] = useState("both");
  const [preset, setPreset] = useState("lastweek");
  const [start, setStart] = useState(presets.lastweek[0]);
  const [end, setEnd] = useState(presets.lastweek[1]);
  const [sessions, setSessions] = useState({ "ny-am": true, "ny-pm": false, "london": true });
  const [mode, setMode] = useState("auto");
  const symRuns = filterRuns(state.library.runs, { symbol: symbolView });
  const agg = aggregateRuns(symRuns);
  const recent = symRuns.slice(0, 5);

  const applyPreset = (p) => { setPreset(p.id); if (p.start) { setStart(p.start); setEnd(p.end); } };
  const editDate = (which, v) => { setPreset("custom"); which === "start" ? setStart(v) : setEnd(v); };
  const toggleSession = (k) => setSessions((s) => ({ ...s, [k]: !s[k] }));

  const SESS = [["ny-am", "NY-AM"], ["ny-pm", "NY-PM"], ["london", "LONDON"]];
  const selected = SESS.filter(([k]) => sessions[k]);
  const symLabel = { mnq: "MNQ1!", mes: "MES1!", both: "MNQ1! + MES1!" }[symbol];
  const days = weekdaysBetween(start, end);
  // Jobs drop any (date, session) whose session hasn't closed yet, so the count
  // and the run reflect what's actually replayable — not future dates.
  const jobs = expandStudy({ symbol, start, end, sessions, mode });
  const recordings = jobs.length;
  const canRun = jobs.length > 0;
  const run = () => { if (canRun) actions.startStudy(jobs); };

  return (
    <>
      <div className="section">
        <div className="sect-hd"><span>CONFIGURE STUDY</span><span className="meta">RUNS ARE FREE</span></div>

        <div className="cfg-field">
          <div className="cfg-label">SYMBOL</div>
          <Seg value={symbol} onChange={setSymbol} options={[["mnq", "MNQ"], ["mes", "MES"], ["both", "BOTH"]]} />
        </div>

        <div className="cfg-field">
          <div className="cfg-label">DATE RANGE<span className="cfg-hint">{days} session day{days !== 1 ? "s" : ""}</span></div>
          <div className="cfg-presets">
            {STUDY_PRESETS.map((p) => (
              <div key={p.id} className={"cfg-preset" + (preset === p.id ? " on" : "")} onClick={() => applyPreset(p)}>{p.label}</div>
            ))}
          </div>
          <div className="cfg-dates">
            <label className="cfg-date"><span className="dk">START</span><input type="date" value={start} max={end} onChange={(e) => editDate("start", e.target.value)} /></label>
            <span className="arrow">→</span>
            <label className="cfg-date"><span className="dk">END</span><input type="date" value={end} min={start} max={todayET()} onChange={(e) => editDate("end", e.target.value)} /></label>
          </div>
        </div>

        <div className="cfg-field">
          <div className="cfg-label">SESSIONS<span className="cfg-hint">recorded from each day</span></div>
          <div className="cfg-multi">
            {SESS.map(([k, l]) => (
              <div key={k} className={"cfg-chip" + (sessions[k] ? " on" : "")} onClick={() => toggleSession(k)}>
                <span className="ck">{sessions[k] ? "✓" : ""}</span>{l}
              </div>
            ))}
          </div>
        </div>

        <div className="cfg-field">
          <div className="cfg-label">MODE</div>
          <Seg value={mode} onChange={setMode} options={[["auto", "AUTO"], ["pause", "PAUSE ON SETUP"]]} />
        </div>

        <div className="cfg-summary">
          {canRun
            ? <>▸ Records <b>{symLabel}</b> across <b>{selected.map((s) => s[1]).join(" + ")}</b> · <b>{start} → {end}</b> · {days} day{days !== 1 ? "s" : ""} → <b>{recordings}</b> session{recordings !== 1 ? "s" : ""} aggregated into ANALYTICS</>
            : <span style={{ color: "var(--red)" }}>▸ Pick at least one session and a valid date range to run.</span>}
        </div>

        <button className="start-btn" disabled={!canRun} onClick={run}>▶  START RUN</button>
      </div>

      <div className="section">
        <div className="sect-hd"><span>RECENT</span><span className="meta">{agg.total_runs} RUNS</span></div>
        <div className="recent-summary">
          A+ <b className="green">{pct(agg.aplus_hit_rate)}</b>
          {" · "}B <b>{pct(agg.b_hit_rate)}</b>
          {" · "}CUM <b className={agg.cum_r >= 0 ? "green" : "red"}>{agg.cum_r > 0 ? "+" : ""}{agg.cum_r.toFixed(1)}R</b>
        </div>
        {recent.length === 0 && (
          <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>no runs yet</div>
        )}
        {recent.map((r) => (
          <RunRow key={r.run_id} run={r} onClick={() => actions.rowClick(r.run_id)} />
        ))}
        <div className="view-all" onClick={actions.viewAll}>
          VIEW ANALYTICS · {symRuns.length} RUNS  →
        </div>
      </div>
    </>
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
  const winRate = s.setups > 0 ? Math.round((100 * s.wins) / s.setups) : 0;
  const runId = state.currentRun?.runId;
  const reRun = () => actions.start({ date: s.date, session: s.session, mode: s.mode });
  const discard = async () => { if (runId) await actions.deleteRun(runId); actions.runAnother(); };
  return (
    <>
      <div className="section">
        <div className="sect-hd">
          <span>{s.date} · {sessionLabel(s.session)} · {(s.mode ?? "").toUpperCase()}</span>
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
          <button className="btn primary full" onClick={actions.viewAll}>▤  VIEW IN ANALYTICS</button>
          <button className="btn secondary" onClick={reRun}>↻ RE-RUN</button>
          {runId && <button className="btn secondary" onClick={() => actions.openDetail(runId)}>▸ OPEN DETAIL</button>}
          <button className="btn danger" onClick={discard}>DISCARD</button>
        </div>
      </div>

      {(state.currentRun?.setups?.length ?? 0) > 0 && (
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
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// LIBRARY body — aggregate dashboard + filters + sortable table
// ─────────────────────────────────────────────────────────────────────
function LibraryBody({ state, actions, symbolView }) {
  const [sessionFilter, setSessionFilter] = useState(null);
  const [modeFilter, setModeFilter] = useState(null);
  const [gradeFilter, setGradeFilter] = useState(null);
  const [query, setQuery] = useState("");

  // Scope everything to the active instrument first; the table filters narrow
  // within it. Analytics + aggregate read only this symbol's runs.
  const symRuns = filterRuns(state.library.runs, { symbol: symbolView });
  const filtered = filterRuns(symRuns, {
    session: sessionFilter, mode: modeFilter, grade: gradeFilter, query,
  });
  const agg = aggregateRuns(symRuns);
  const { A, loading } = useAnalytics(symRuns, true);
  const agreementPct = (() => {
    const a = agg.agreement;
    const total = (a?.agreed ?? 0) + (a?.disagreed ?? 0);
    return total === 0 ? "—" : `${Math.round((100 * a.agreed) / total)}%`;
  })();

  return (
    <>
      <Analytics A={A} loading={loading} />

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
            <span className="k">A+ HIT-RATE</span>
            <span className="v green">{pct(agg.aplus_hit_rate)}</span>
            <span className="sub">{agg.aplus_hit_rate.numerator}/{agg.aplus_hit_rate.denominator}</span>
          </div>
          <div className="lcell">
            <span className="k">B HIT-RATE</span>
            <span className="v">{pct(agg.b_hit_rate)}</span>
            <span className="sub">{agg.b_hit_rate.numerator}/{agg.b_hit_rate.denominator}</span>
          </div>
          <div className="lcell">
            <span className="k">CUM P&amp;L</span>
            <span className={"v " + (agg.cum_r >= 0 ? "green" : "red")}>
              {agg.cum_r > 0 ? "+" : ""}{agg.cum_r.toFixed(1)}R
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
          <div className="search-wrap">
            <input
              type="text" placeholder="date / run id..."
              value={query} onChange={(e) => setQuery(e.target.value)}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name={`bt-lib-q-${Math.random().toString(36).slice(2, 8)}`}
            />
          </div>
          <button className="btn-add" title="new run" onClick={actions.dismiss}>+</button>
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
          <button className="btn secondary full" onClick={actions.back}>← LIBRARY</button>
        </div>
      </div>
    );
  }

  const openEvents = setups.filter((s) => s.type === "open");
  const outcomes = setups.filter((s) => s.type === "outcome");
  const winRate = entry.setups > 0 ? Math.round((100 * entry.wins) / entry.setups) : 0;
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
          <button className="btn secondary" onClick={() => actions.start({ date: entry.date, session: entry.session, mode: entry.mode })}>↻ RE-RUN</button>
          <div className="spacer" />
          <button className="btn danger" onClick={() => {
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
      <div className="seg">
        {options.map(([v, lbl]) => (
          <div
            key={String(v)}
            className={"s" + (value === v ? " on" : "")}
            onClick={() => onChange(v)}
          >{lbl}</div>
        ))}
      </div>
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

function RunRow({ run, onClick }) {
  const f = formatRunForRow(run);
  const grade = runGrade(run);
  const rDisp = `${run.total_r > 0 ? "+" : ""}${(run.total_r ?? 0).toFixed(1)}R`;
  return (
    <div className="run-row" onClick={onClick}>
      <span className="date">{(run.date ?? "").slice(5)}</span>
      <span className="ses">{f.session_short}</span>
      <span><span className={"gp " + gradeClass(grade)}>{grade}</span></span>
      <span className={"pnl " + (run.total_r > 0 ? "green" : run.total_r < 0 ? "red" : "dim")}>
        {(run.total_r ?? 0) === 0 ? "—" : rDisp}
      </span>
      <span className="arr">▸</span>
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
        <span className={"side " + sideClass(setup.side)}>{(setup.side ?? "").toUpperCase()}</span>
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
