// PREP workstation — essentialist re-add (2026-05-27).
// 5 panels: SESSION BRIEF · STEP 1 HTF BIAS · STEP 2 OVERNIGHT + LEVELS ·
// STEP 3 PRICE QUALITY · SCENARIOS. Reads hooks directly.

import React, { useState, useEffect } from "react";
import { Panel, Row, Grade, ScenarioCard } from "./Shared.jsx";
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
  htfBiasToRowsConcise,
  overnightHeaderRows,
  scenariosMeta,
  stripCitations,
} from "./Prep.helpers.js";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { armAlertReal, useAlertStateListener } from "./hooks/useAlerts.js";

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
        <span className="pill interactive amber" style={{ marginLeft: 8 }} onClick={onRefresh}>REFRESH</span>
      </div>
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
// STEP 1 · HTF BIAS — four concise rows with strategy-doc tooltips.
function Step1Panel({ brief }) {
  const rows = htfBiasToRowsConcise(brief);
  return (
    <Panel title="STEP 1 · HTF BIAS" meta="D / 4H / 1H">
      {rows.map((r) => (
        <div className="row" key={r.k} title={r.tip}>
          <span className="k">{r.k}</span>
          <span className="v">{r.v}</span>
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
// SCENARIOS panel.
function ScenariosPanel({ brief }) {
  const scenarios = brief?.scenarios || [];
  return (
    <Panel title="SCENARIOS · IF / THEN" meta={scenariosMeta(brief)}>
      {scenarios.length === 0 ? (
        <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
          no scenarios yet — Claude will propose once HTF + pillars are read
        </div>
      ) : (
        scenarios.map((s) => <ScenarioCard key={s.id || s.condition} scenario={s} />)
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────────────────────────────────
function PrepWorkstation({ symbol, currentPrice }) {
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
  // STEP 2 reflect the actual armed/fired set.
  const [armed, setArmed] = useState(new Set());
  const [fired] = useState(new Set());
  useAlertStateListener((ev) => {
    setArmed(new Set((ev?.armed || []).map((a) => a.price)));
  });

  const onArm = async (level) => {
    try {
      await armAlertReal({ price: level.price, label: level.name });
      setArmed((s) => new Set([...s, level.price]));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[prep] arm failed", err?.message || err);
    }
  };
  const onDisarm = async (level) => {
    // Disarm is by id in the alerts wiring; we don't have it from the level.
    // Best correct behavior here: pop the price from the renderer's set;
    // main resyncs the armed set on the next alerts:state push.
    setArmed((s) => {
      const next = new Set(s);
      next.delete(level.price);
      return next;
    });
  };

  const pillarGrade = brief?.pillar_grade;
  const chainStatus = brief?.chain_status;

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
      <ScenariosPanel brief={brief} />
    </div>
  );
}

export { PrepWorkstation };
