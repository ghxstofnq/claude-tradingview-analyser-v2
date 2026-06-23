// PREP workstation — essentialist re-add (2026-05-27).
// 5 panels: SESSION BRIEF · STEP 1 HTF BIAS · STEP 2 OVERNIGHT + LEVELS ·
// STEP 3 PRICE QUALITY · SCENARIOS. Reads hooks directly.

import React, { useState, useEffect } from "react";
import { clickable } from "./a11y.js";
import { Panel, Row, Grade, ScenarioCard } from "./Shared.jsx";
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
  htfBiasToRowsDesigner,
  drawBiasVoteRows,
  overnightHeaderRows,
  scenariosMeta,
  stripCitations,
} from "./Prep.helpers.js";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { armAlertReal, disarmAlertReal, normalizeArmed, useAlertStateListener, useAlertFiredListener } from "./hooks/useAlerts.js";
import { useBacktestRunning } from "./hooks/useBacktest.js";

// ───────────────────────────────────────────────────────────────────────
// SESSION BRIEF panel — prose blob + status + tabs.
// Fixed tab list — both MNQ and MES always render, regardless of which
// symbol has a brief on disk yet. The active tab follows selectedSymbol.
// If the user picks a symbol with no brief, the panel body shows "no
// brief yet" instead of disappearing the tab.
const SYMBOL_TABS = [
  { sym: "MNQ1!", label: "MNQ" },
  { sym: "MES1!", label: "MES" },
];

function SessionBriefPanel({ brief, session, ageMs, status, chainStatus, selectedSymbol, setSelectedSymbol, onRefresh, pillarGrade }) {
  const chain = formatChainChip(chainStatus);
  const meta = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--label)", fontSize: 10 }}>{formatAge(ageMs)}</span>
      {chain.visible && (
        <span className={"pill " + (chain.tone === "stale" ? "red" : "amber")}>{chain.label}</span>
      )}
      <Grade value={pillarGrade || "—"} />
    </span>
  );
  return (
    <Panel title={`SESSION BRIEF · ${(session || "—").toUpperCase()}`} right={meta}>
      <div style={{ color: "var(--prose)", fontSize: 12, lineHeight: 1.6,
                     whiteSpace: "pre-wrap", padding: "6px 0 12px 0",
                     overflowWrap: "anywhere" }}>
        {brief?.brief ? stripCitations(brief.brief) :
         (status === "running" ? "preparing brief…" : "no brief yet")}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, paddingTop: 8, borderTop: "1px dashed var(--label-dim)" }}>
        {SYMBOL_TABS.map((t) => (
          <span key={t.sym}
                className={"pill interactive" + (t.sym === selectedSymbol ? " active" : "")}
                onClick={() => setSelectedSymbol(t.sym)}>
            {t.label}
          </span>
        ))}
        <span className="pill interactive primary" style={{ marginLeft: 8 }} onClick={onRefresh}>REFRESH</span>
      </div>
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 1 · HTF BIAS — four concise rows with strategy-doc tooltips.
function Step1Panel({ brief }) {
  const rows = htfBiasToRowsDesigner(brief);
  const vote = drawBiasVoteRows(brief);
  const toneCls = (t) => (t === "bull" ? "ok" : t === "bear" ? "bad" : t === "neutral" ? "warn" : "");
  return (
    <Panel title="STEP 1 · DRAW & BIAS" meta={`${vote.cast}/3 components`}>
      {/* 3-component vote (daily-bias §1) — drives the pre-session grade */}
      {vote.rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className={"v " + toneCls(r.tone)}>{r.v}</span>
        </div>
      ))}
      {rows.length > 0 && <div className="sect-hd" style={{ marginTop: 12 }}>STRUCTURE · D / 4H / 1H</div>}
      {rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">
            <span className={"v " + toneCls(r.tone)}>{r.v}</span>
            {r.note ? <span style={{ color: "var(--label)" }}>  {r.note}</span> : null}
          </span>
        </div>
      ))}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 2 · OVERNIGHT + LEVELS — Asia/London + sub-sections of untaken levels.
function LevelBlock({ level, armed, fired, onArm, onDisarm }) {
  const isArmed = armed?.has(level.price);
  const isFired = fired?.has(level.price);
  const bell = isFired ? "◉" : isArmed ? "●" : "○";
  const bellTitle = isFired ? "alert fired" : isArmed ? "alert armed — click to disarm" : "click to arm alert";
  const bellCls = isFired ? "bell fired" : isArmed ? "bell armed" : "bell";
  const toggle = () => {
    if (isArmed && onDisarm) return onDisarm(level);
    if (!isArmed && onArm) return onArm(level);
  };
  const taken = level.state && level.state !== "untaken";
  return (
    <div className="lvl">
      <span className="marker">─</span>
      <span className="name">{level.name}</span>
      <span className="price">{level.price}</span>
      <span className={"state" + (taken ? " taken" : "")}>{(level.state || "untaken").toUpperCase()}</span>
      <span className={bellCls} title={bellTitle} onClick={toggle}>{bell}</span>
    </div>
  );
}

function Step2Panel({ brief, currentPrice, armed, fired, onArm, onDisarm }) {
  const rows = overnightHeaderRows(brief);
  // Filter to untaken levels only; the section is "untaken liquidity".
  const untaken = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const { above, below } = groupLevelsByPrice(untaken, currentPrice);
  return (
    <Panel title="STEP 2 · OVERNIGHT + LEVELS" meta="Asia + London">
      {rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">{r.v}</span>
        </div>
      ))}
      {above && above.length > 0 && (
        <>
          <div className="sect-hd" style={{ marginTop: 12 }}>UNTAKEN ABOVE</div>
          {above.map((lv) => (
            <LevelBlock key={lv.name} level={lv}
                        armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
          ))}
        </>
      )}
      {below && below.length > 0 && (
        <>
          <div className="sect-hd" style={{ marginTop: 12 }}>UNTAKEN BELOW</div>
          {below.map((lv) => (
            <LevelBlock key={lv.name} level={lv}
                        armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
          ))}
        </>
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 3 · PRICE QUALITY — three concise rows wired to brief.pillars[1].
function Step3Panel({ brief }) {
  const pillar2 = selectPillar(brief?.pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  const tips = {
    "3h range": "3-hour range acceptable (not tiny / choppy)",
    "4H/1H displacement": "4H / 1H candles show real displacement and decent PD array size",
    "15m/5m candles": "15m / 5m candles mainly engulfing, not doji / wick dominated",
  };
  return (
    <Panel title="STEP 3 · PRICE QUALITY">
      {rows.map((r) => (
        <div className="row" key={r.k} title={tips[r.k] || ""}>
          <span className="k">{r.k}</span>
          <span className={"v " + (r.tone || "")}>{r.v}</span>
        </div>
      ))}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// BRIEF · DETERMINISTIC — free-form prose summary surfaced by the prep path
// into brief.prose_summary (added 2026-05-28). Renders nothing if absent
// (legacy briefs that pre-date the schema field).
function BriefProseSection({ brief }) {
  const prose = brief?.prose_summary;
  if (!prose || typeof prose !== "string" || prose.trim().length === 0) return null;
  const ts = brief?.ts ? new Date(brief.ts).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York",
  }) : null;
  const grade = brief?.pillar_grade;
  return (
    <Panel title="BRIEF · DETERMINISTIC">
      <div className="brief-prose">
        {(ts || grade) && (
          <span className="ts">
            {ts ? `${ts} ET` : ""}{ts && grade ? " · " : ""}{grade ? `${grade} pre-session` : ""}
          </span>
        )}
        {prose}
      </div>
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SCENARIOS panel.
function ScenariosPanel({ brief }) {
  const scenarios = brief?.scenarios || [];
  return (
    <Panel title="SCENARIOS · IF / THEN" meta={scenariosMeta(brief)}>
      {scenarios.length === 0 ? (
        <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
          no scenarios yet — deterministic engine will surface once HTF + pillars are read
        </div>
      ) : (
        scenarios.map((s) => <ScenarioCard key={s.id || s.condition} scenario={s} />)
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
function PrepBody({ symbol, currentPrice }) {
  // All hooks first — we conditionally render the backtest placeholder below.
  const backtest = useBacktestRunning();
  const {
    brief,
    selectedSymbol, setSelectedSymbol,
    session, ageMs, status, refresh,
  } = useSessionBrief();

  // Auto-select the App symbol when the user switches symbols at the top.
  // We pin to MNQ or MES even when that symbol has no brief on disk yet —
  // the tab still renders, and the panel body shows the empty state.
  useEffect(() => {
    if (symbol === "MNQ1!" || symbol === "MES1!") setSelectedSymbol(symbol);
  }, [symbol, setSelectedSymbol]);

  // Alert armed / fired state — wire the TV alert ring so the bell icons in
  // STEP 2 reflect the actual armed/fired set. `armed` is a Map price→id so we
  // can disarm by id (the IPC deletes by id); `fired` is a Set of prices.
  const [armed, setArmed] = useState(new Map());
  const [fired, setFired] = useState(new Set());
  useAlertStateListener((ev) => {
    setArmed(new Map(normalizeArmed(ev).map((a) => [a.price, a.id])));
  });
  useAlertFiredListener((ev) => {
    const price = Number(ev?.price);
    if (Number.isFinite(price)) setFired((s) => new Set([...s, price]));
  });

  const onArm = async (level) => {
    // armAlertReal takes positional (price, label) — passing an object made the
    // price NaN and silently no-op'd. Only mark armed on a confirmed create.
    const r = await armAlertReal(level.price, level.name);
    if (r?.ok) {
      setArmed((s) => new Map(s).set(level.price, r.id ?? null));
    } else {
      // eslint-disable-next-line no-console
      console.warn("[prep] arm failed", r?.error || "unknown");
    }
  };
  const onDisarm = async (level) => {
    const id = armed.get(level.price);
    if (id != null) await disarmAlertReal(id);   // deletes the real TV alert
    setArmed((s) => { const next = new Map(s); next.delete(level.price); return next; });
  };

  const pillarGrade = brief?.pillar_grade;
  const chainStatus = brief?.chain_status;

  // Backtest exclusive mode: live data is meaningless while a run is in flight.
  // (All hooks above have run; this is just conditional rendering.)
  if (backtest.running) {
    return <BacktestRunningPlaceholder session={backtest.session} />;
  }

  return (
    <div className="work-scroll">
      <SessionBriefPanel
        brief={brief}
        session={session}
        ageMs={ageMs}
        status={status}
        chainStatus={chainStatus}
        selectedSymbol={selectedSymbol}
        setSelectedSymbol={setSelectedSymbol}
        onRefresh={refresh}
        pillarGrade={pillarGrade}
      />
      <Step1Panel brief={brief} />
      <Step2Panel brief={brief} currentPrice={currentPrice}
                  armed={armed} fired={fired}
                  onArm={onArm} onDisarm={onDisarm} />
      <Step3Panel brief={brief} />
      <BriefProseSection brief={brief} />
      <ScenariosPanel brief={brief} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// PrepCell — topbar cell + anchored popover wrapper around PrepBody.
// Same recipe as BacktestCell (open/close on click, click outside closes,
// badge shows pre-session grade or "—").
function PrepCell({ symbol, currentPrice }) {
  const [open, setOpen] = useState(false);
  const { brief } = useSessionBrief();
  const hasBrief = !!brief;

  // Keyboard hotkey: "1" opens / Esc closes (wired via App.jsx CustomEvent)
  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.which === "prep") setOpen((o) => !o);
      if (e.detail?.which === "all-close") setOpen(false);
    };
    window.addEventListener("topbar:open-cell", onOpen);
    return () => window.removeEventListener("topbar:open-cell", onOpen);
  }, []);

  const onCellClick = (e) => {
    if (e.target.closest(".bt-popover")) return;
    setOpen((o) => !o);
  };

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} {...clickable(onCellClick)}>
      <span className="k">PREP</span>
      <span className={"dot " + (hasBrief ? "" : "dim")} />
      {open && (
        <div className="bt-popover w-660" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">PREP</span>
            <span className="sub">{brief?.date ?? "—"} · {sessionShort(brief?.session) ?? ""}</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <PrepBody symbol={symbol} currentPrice={currentPrice} />
          </div>
        </div>
      )}
    </div>
  );
}

function BacktestRunningPlaceholder({ session }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", color: "var(--label)", gap: 10,
    }}>
      <div style={{ letterSpacing: "0.22em", fontSize: "12px" }}>
        BACKTEST RUNNING{session ? ` · ${sessionShort(session)}` : ""}
      </div>
      <div style={{ fontSize: "10.5px", color: "var(--label-dim)" }}>
        LIVE DATA UNAVAILABLE — CHART IS IN REPLAY
      </div>
    </div>
  );
}

function sessionShort(s) {
  return ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" })[s] ?? (s ?? "");
}

export { PrepCell };
// Legacy export — App.jsx still imports PrepWorkstation until the topbar
// rewire lands; alias keeps that build path working until Task 11.
export { PrepBody as PrepWorkstation };
