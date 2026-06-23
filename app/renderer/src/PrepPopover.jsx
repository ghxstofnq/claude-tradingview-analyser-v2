// PREP workstation — verdict-first redesign (2026-06-23).
// Built from Lanto's own pre-open process (class transcripts, not the derived
// strategy docs): a DECISION strip (grade + bias + 3-component count + draw)
// over the supporting reads — BIAS, OVERNIGHT, PRICE QUALITY, LEVELS IN PLAY,
// OPEN REACTION (computation + verdict), PLAN. A DET ⇄ AI toggle flips the
// supporting body between the deterministic view and a fresh in-depth AI pass.
// Reads hooks directly; numbers are always deterministic (CLAUDE.md #7).

import React, { useState, useEffect } from "react";
import { clickable } from "./a11y.js";
import { Panel, Row, ScenarioCard } from "./Shared.jsx";
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  htfBiasToRowsDesigner,
  drawBiasVoteRows,
  overnightHeaderRows,
  scenariosMeta,
  stripCitations,
  decisionLine,
  openReactionVerdict,
} from "./Prep.helpers.js";
import { useSessionBrief } from "./hooks/useSessionBrief.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useAiAnalysis } from "./hooks/useAiAnalysis.js";
import { armAlertReal, disarmAlertReal, normalizeArmed, useAlertStateListener, useAlertFiredListener } from "./hooks/useAlerts.js";
import { useBacktestRunning } from "./hooks/useBacktest.js";

const SYMBOL_TABS = [
  { sym: "MNQ1!", label: "MNQ" },
  { sym: "MES1!", label: "MES" },
];

// vote/structure tone → .row .v.<class>
const toneCls = (t) =>
  t === "bull" ? "ok" : t === "bear" ? "bad" : t === "neutral" ? "warn" : t === "dim" ? "dim" : (t || "");

// ───────────────────────────────────────────────────────────────────────
// DECISION strip — the one thing you open PREP to learn, up top.
function DecisionStrip({ brief, view, onView, selectedSymbol, setSelectedSymbol, onRefresh }) {
  const d = decisionLine(brief);
  return (
    <div className="prep-decision">
      <div className="top">
        <span className={"grade-pill grade-lg " + d.gradeTone}>{d.grade}</span>
        <span className={"bias " + d.biasTone}>{d.bias}</span>
        <span className="count">{d.cast}/3{d.cast >= 3 ? "" : " · NY open pending"}</span>
        <span className="seg">
          <span className={"pill interactive" + (view === "det" ? " active" : "")} {...clickable(() => onView("det"))}>DET</span>
          <span className={"pill interactive" + (view === "ai" ? " active" : "")} {...clickable(() => onView("ai"))}>AI</span>
        </span>
      </div>
      <div className="draw">→ DRAW <b>{d.draw}</b></div>
      {d.reason ? <div className="reason">{d.reason}</div> : null}
      <div className="ctl">
        {SYMBOL_TABS.map((t) => (
          <span key={t.sym}
                className={"pill interactive" + (t.sym === selectedSymbol ? " active" : "")}
                {...clickable(() => setSelectedSymbol(t.sym))}>{t.label}</span>
        ))}
        <span className="pill interactive primary" {...clickable(onRefresh)}>REFRESH</span>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// BIAS — the 3-component vote (daily-bias) + D/4H/1H structure + primary draw.
function BiasPanel({ brief }) {
  const vote = drawBiasVoteRows(brief);
  const struct = htfBiasToRowsDesigner(brief);
  return (
    <Panel title="BIAS" meta={`${vote.cast}/3 components`}>
      {vote.rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className={"v " + toneCls(r.tone)}>{r.v}</span>
        </div>
      ))}
      {struct.length > 0 && <div className="sect-hd">STRUCTURE · D / 4H / 1H</div>}
      {struct.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">
            <span className={toneCls(r.tone)}>{r.v}</span>
            {r.note ? <span style={{ color: "var(--label)" }}>  {r.note}</span> : null}
          </span>
        </div>
      ))}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// OVERNIGHT — Asia/London H/L + the overnight verdict (recency read).
function OvernightPanel({ brief }) {
  const rows = overnightHeaderRows(brief);
  const ob = brief?.overnight_block || {};
  return (
    <Panel title="OVERNIGHT" meta="Asia + London">
      {rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">{r.v}</span>
        </div>
      ))}
      {ob.path_to_destination ? <Row k="Path" v={ob.path_to_destination} /> : null}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// PRICE QUALITY — "you can never outrade bad price." verdict + 3 reads.
function QualityPanel({ brief }) {
  const pillar2 = selectPillar(brief?.pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  const verdict = brief?.pillar2_verdict;
  const vt = verdict === "good" ? "green" : verdict === "marginal" ? "amber" : verdict === "poor" ? "red" : "dim";
  const tips = {
    "3h range": "3-hour range acceptable (not tiny / choppy)",
    "4H/1H displacement": "4H / 1H candles show real displacement and decent PD-array size",
    "15m/5m candles": "15m / 5m candles mainly engulfing, not doji / wick dominated",
  };
  return (
    <Panel title="PRICE QUALITY" right={verdict ? <span className={"pill " + vt}>{verdict.toUpperCase()}</span> : null}>
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
// LEVELS IN PLAY — untaken opposing/overnight liquidity the open will hunt.
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
      <span className={bellCls} title={bellTitle} {...clickable(toggle, { label: bellTitle })}>{bell}</span>
    </div>
  );
}

function LevelsPanel({ brief, currentPrice, armed, fired, onArm, onDisarm }) {
  const untaken = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const { above, below, all } = groupLevelsByPrice(untaken, currentPrice);
  const render = (list) =>
    list.map((lv) => (
      <LevelBlock key={`${lv.name}-${lv.price}`} level={lv} armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
    ));
  const empty = !above?.length && !below?.length && !all?.length;
  return (
    <Panel title="LEVELS IN PLAY" meta="untaken">
      {above && above.length > 0 && <><div className="sect-hd">ABOVE</div>{render(above)}</>}
      {below && below.length > 0 && <><div className="sect-hd">BELOW</div>{render(below)}</>}
      {all && all.length > 0 && render(all)}
      {empty && <div className="prep-empty">no untaken levels in play</div>}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// OPEN REACTION — Lanto's third bias component: the reaction (not the grab)
// after 09:30. PENDING pre-open; flips to CONFIRMS / FLIPS / NOT YET live.
function OpenReactionPanel({ brief, session }) {
  const { latest } = useOpenReaction(session);
  const orv = openReactionVerdict(latest, brief);
  return (
    <Panel title="OPEN REACTION" right={<span className={"pill " + orv.verdictTone}>{orv.verdict}</span>}>
      {orv.rows.map((r) => (
        <Row key={r.k} k={r.k} v={r.v} tone={r.tone} />
      ))}
      <div className="or-note">{orv.note}</div>
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// PLAN — the two scenarios + anchored target/stop + sizing.
function PlanPanel({ brief }) {
  const scenarios = brief?.scenarios || [];
  return (
    <Panel title="PLAN · IF / THEN" meta={scenariosMeta(brief)}>
      {scenarios.length === 0 ? (
        <div className="prep-empty">no scenarios yet — engine surfaces these once HTF + pillars read</div>
      ) : (
        scenarios.map((s) => <ScenarioCard key={s.id || s.condition} scenario={s} />)
      )}
      {brief?.anchored_target ? <Row k="Target" v={stripCitations(brief.anchored_target)} tone="ok" /> : null}
      {brief?.anchored_stop ? <Row k="Stop" v={stripCitations(brief.anchored_stop)} tone="bad" /> : null}
      {brief?.sizing_note ? <Row k="Sizing" v={stripCitations(brief.sizing_note)} /> : null}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// AI view — a fresh in-depth pass, re-run every time it's opened.
function AiView({ symbol, session, brief }) {
  const ai = useAiAnalysis({ symbol, session, brief });
  // Auto-run on open (user: always kick off a fresh analysis on click). Each
  // DET→AI flip remounts this, so each open is a fresh turn.
  useEffect(() => { ai.run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const tsLabel = ai.ts
    ? new Date(ai.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) + " ET"
    : null;
  return (
    <div className="prep-ai">
      <div className="meta">
        <span>AI IN-DEPTH · {symbol || "—"}</span>
        <span className="spacer" />
        {tsLabel && !ai.running ? <span className="ts">{tsLabel}</span> : null}
        {ai.running
          ? <span className="pill dim">analyzing…</span>
          : <span className="pill interactive" {...clickable(ai.run)}>RE-ANALYZE</span>}
      </div>
      <div className="prose">
        {ai.text
          ? ai.text
          : ai.running
          ? "Running a fresh in-depth pass… (~a few seconds; costs a turn)"
          : "No AI read yet."}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
function PrepBody({ symbol, currentPrice }) {
  const backtest = useBacktestRunning();
  const { brief, selectedSymbol, setSelectedSymbol, session, refresh } = useSessionBrief();
  const [view, setView] = useState("det");

  useEffect(() => {
    if (symbol === "MNQ1!" || symbol === "MES1!") setSelectedSymbol(symbol);
  }, [symbol, setSelectedSymbol]);

  // Alert armed / fired state — wire the TV alert ring so LEVELS bells reflect
  // the actual armed/fired set. `armed` is price→id (disarm deletes by id).
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
    const r = await armAlertReal(level.price, level.name);
    if (r?.ok) setArmed((s) => new Map(s).set(level.price, r.id ?? null));
    else console.warn("[prep] arm failed", r?.error || "unknown"); // eslint-disable-line no-console
  };
  const onDisarm = async (level) => {
    const id = armed.get(level.price);
    if (id != null) await disarmAlertReal(id);
    setArmed((s) => { const next = new Map(s); next.delete(level.price); return next; });
  };

  if (backtest.running) return <BacktestRunningPlaceholder session={backtest.session} />;

  return (
    <div className="work-scroll">
      <DecisionStrip
        brief={brief}
        view={view}
        onView={setView}
        selectedSymbol={selectedSymbol}
        setSelectedSymbol={setSelectedSymbol}
        onRefresh={refresh}
      />
      {view === "det" ? (
        <>
          <BiasPanel brief={brief} />
          <OvernightPanel brief={brief} />
          <QualityPanel brief={brief} />
          <LevelsPanel brief={brief} currentPrice={currentPrice} armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
          <OpenReactionPanel brief={brief} session={session} />
          <PlanPanel brief={brief} />
        </>
      ) : (
        <AiView symbol={selectedSymbol || symbol} session={session} brief={brief} />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
function PrepCell({ symbol, currentPrice }) {
  const [open, setOpen] = useState(false);
  const { brief } = useSessionBrief();
  const hasBrief = !!brief;
  const grade = brief?.pillar_grade;

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
            <span className="sub">{brief?.date ?? "—"} · {sessionShort(brief?.session) ?? ""}{grade ? ` · ${grade}` : ""}</span>
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
// Legacy export — App.jsx imports PrepWorkstation until the topbar rewire lands.
export { PrepBody as PrepWorkstation };
