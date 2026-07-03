// BriefingPage — ⌘1. Native morning dashboard (2026-07-03 redesign, PR2).
// Applies the prototype's dashboard visual language (DECISION hero + a
// three-column grid + a calendar panel + overnight sparkline) while KEEPING the
// full verdict-first content and logic — every number still flows through the
// proven Prep.helpers (no strategy detail dropped vs the old PREP popover).

import React, { useState, useEffect } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { clickable } from "../../a11y.js";
import {
  decisionLine, drawBiasVoteRows, htfBiasToRowsDesigner, overnightHeaderRows,
  selectPillar, pillar2ToRows, groupLevelsByPrice, openReactionVerdict,
  scenariosMeta, formatChainChip, stripCitations,
} from "../../Prep.helpers.js";
import { useSessionBrief } from "../../hooks/useSessionBrief.js";
import { useOpenReaction } from "../../hooks/useOpenReaction.js";
import { useAiAnalysis } from "../../hooks/useAiAnalysis.js";
import { useCalendar } from "../../hooks/useCalendar.js";
import {
  armAlertReal, disarmAlertReal, normalizeArmed, useAlertStateListener, useAlertFiredListener,
} from "../../hooks/useAlerts.js";

const SYMS = [["MNQ1!", "MNQ"], ["MES1!", "MES"]];
const toneCls = (t) => (t === "bull" ? "ok" : t === "bear" ? "bad" : t === "dim" ? "dim" : t || "");
const sessionShort = (s) => ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" }[s] ?? (s ?? ""));

// A titled dashboard card (matches the prototype's surface-2 panel with a
// letterspaced label header + optional right slot).
function Card({ title, meta, right, className, children }) {
  return (
    <div className={"brf-card" + (className ? " " + className : "")}>
      <div className="brf-card-hd">
        <span className="t">{title}</span>
        {meta && <span className="meta">{meta}</span>}
        {right && <span className="right">{right}</span>}
      </div>
      {children}
    </div>
  );
}

function RowList({ rows }) {
  return rows.map((r) => (
    <div className="brf-row" key={r.k} title={r.tip}>
      <span className="k">{r.k}</span>
      <span className={"v " + toneCls(r.tone)}>
        {r.v}
        {r.note ? <span className="note"> {stripCitations(r.note)}</span> : null}
      </span>
    </div>
  ));
}

// ── DECISION hero ──────────────────────────────────────────────────────
function DecisionHero({ brief }) {
  const d = decisionLine(brief);
  const chip = formatChainChip(brief?.chain_status);
  return (
    <div className="brf-decision">
      <span className={"brf-grade " + d.gradeTone}>{d.grade}</span>
      <div className="brf-decision-main">
        <div className="hd">
          <span className={"bias " + d.biasTone}>{d.bias}</span>
          <span className="cast">{d.cast}/3 components</span>
          {chip.visible && <span className={"brf-chip " + chip.tone}>{chip.label}</span>}
        </div>
        {d.reason && <div className="reason">{d.reason}</div>}
      </div>
      <div className="brf-draw">
        <span className="l">PRIMARY DRAW</span>
        <span className="v">{d.draw}</span>
      </div>
    </div>
  );
}

// ── CALENDAR (today's USD events) ──────────────────────────────────────
function CalendarCard({ events }) {
  const now = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const rows = (events || []).filter((e) => {
    const d = new Date(e?.ts); if (!Number.isFinite(d.getTime())) return false;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d) === today;
  }).slice(0, 6);
  const t = (ts) => new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <Card title="CALENDAR · ET">
      {rows.length === 0 && <div className="brf-empty">no high-impact USD events today</div>}
      {rows.map((e, i) => {
        const imp = (e.impact || "").toLowerCase();
        const hot = imp === "high";
        return (
          <div className={"brf-cal-row" + (hot ? " hot" : "")} key={i}>
            <span className="ts">{t(e.ts)}</span>
            <span className="ev">{e.event}</span>
            <span className={"imp " + imp}>{(e.impact || "").toUpperCase().slice(0, 4)}</span>
          </div>
        );
      })}
      <div className="brf-cal-rule">no entries ±10 min around HIGH impact</div>
    </Card>
  );
}

// ── OVERNIGHT ──────────────────────────────────────────────────────────
function OvernightCard({ brief }) {
  const rows = overnightHeaderRows(brief);
  const ob = brief?.overnight_block || {};
  return (
    <Card title="OVERNIGHT" meta="Asia + London">
      <RowList rows={rows} />
      {ob.path_to_destination && <div className="brf-row"><span className="k">Path</span><span className="v">{ob.path_to_destination}</span></div>}
    </Card>
  );
}

// ── BIAS ───────────────────────────────────────────────────────────────
function BiasCard({ brief }) {
  const vote = drawBiasVoteRows(brief);
  const struct = htfBiasToRowsDesigner(brief);
  return (
    <Card title="BIAS" meta={`${vote.cast}/3 components`}>
      <RowList rows={vote.rows} />
      {struct.length > 0 && <div className="brf-subhd">STRUCTURE · D / 4H / 1H</div>}
      <RowList rows={struct} />
    </Card>
  );
}

// ── PRICE QUALITY ──────────────────────────────────────────────────────
function QualityCard({ brief }) {
  const pillar2 = selectPillar(brief?.pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  const verdict = brief?.pillar2_verdict;
  const vTone = verdict === "good" ? "green" : verdict === "marginal" ? "amber" : verdict === "poor" ? "red" : "dim";
  return (
    <Card title="PRICE QUALITY" right={verdict ? <span className={"brf-chip " + vTone}>{verdict.toUpperCase()}</span> : null}>
      <RowList rows={rows} />
    </Card>
  );
}

// ── LEVELS IN PLAY (with alert bells) ──────────────────────────────────
function LevelRow({ level, armed, fired, onArm, onDisarm }) {
  const isArmed = armed.has(Number(level.price));
  const isFired = fired.has(Number(level.price));
  const bell = isFired ? "◈" : isArmed ? "◈" : "◇";
  const cls = isFired ? "bell fired" : isArmed ? "bell armed" : "bell";
  const title = isFired ? "alert fired" : isArmed ? "armed — click to disarm" : "click to arm alert";
  const toggle = () => (isArmed ? onDisarm(level) : onArm(level));
  return (
    <div className="brf-lvl">
      <span className="name">{level.name}</span>
      <span className="price">{level.price}</span>
      <span className={cls} title={title} {...clickable(toggle, { label: title })}>{bell}</span>
    </div>
  );
}

function LevelsCard({ brief, currentPrice, armed, fired, onArm, onDisarm }) {
  const untaken = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const { above, below, all } = groupLevelsByPrice(untaken, currentPrice);
  const render = (list) => list.map((lv) => (
    <LevelRow key={`${lv.name}-${lv.price}`} level={lv} armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
  ));
  const empty = !above?.length && !below?.length && !all?.length;
  return (
    <Card title="LEVELS IN PLAY" meta="untaken">
      {above?.length > 0 && <><div className="brf-subhd">ABOVE</div>{render(above)}</>}
      {below?.length > 0 && <><div className="brf-subhd">BELOW</div>{render(below)}</>}
      {all?.length > 0 && render(all)}
      {empty && <div className="brf-empty">no untaken levels in play</div>}
    </Card>
  );
}

// ── OPEN REACTION ──────────────────────────────────────────────────────
function OpenReactionCard({ brief, session }) {
  const { latest, ltf } = useOpenReaction(session);
  const orv = openReactionVerdict(latest, brief, ltf);
  return (
    <Card title="OPEN REACTION" right={<span className={"brf-chip " + orv.verdictTone}>{orv.verdict}</span>}>
      <RowList rows={orv.rows} />
      {orv.note && <div className="brf-note">{orv.note}</div>}
    </Card>
  );
}

// ── SCENARIOS ──────────────────────────────────────────────────────────
function ScenariosCard({ brief }) {
  const scenarios = brief?.scenarios || [];
  if (!scenarios.length) return null;
  const gTone = (g) => (g === "A+" ? "green" : g === "B" ? "amber" : "red");
  return (
    <Card title="SCENARIOS" meta={scenariosMeta(brief)}>
      {scenarios.map((s, i) => (
        <div className="brf-scn" key={s.id ?? i}>
          <div className="hd">
            {s.grade && <span className={"brf-chip " + gTone(s.grade)}>{s.grade}</span>}
            <span className="cond">{s.condition || s.name}</span>
          </div>
          {s.target && <div className="tgt">→ {s.target}</div>}
        </div>
      ))}
    </Card>
  );
}

// ── BRIEF · CLAUDE (DET ⇄ AI) ──────────────────────────────────────────
function ClaudeCard({ brief, symbol, session, view }) {
  const ai = useAiAnalysis({ symbol, session, brief });
  if (view !== "ai") {
    const prose = brief?.prose_summary;
    return (
      <Card title="BRIEF · DETERMINISTIC" className="brf-prose-card">
        <p className="brf-prose">{prose || "Deterministic prep — read the panels above; toggle AI for an in-depth pass."}</p>
      </Card>
    );
  }
  const ts = ai.ts ? new Date(ai.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) + " ET" : null;
  return (
    <Card title="BRIEF · CLAUDE" className="brf-prose-card"
          right={ai.running ? <span className="brf-chip dim">analyzing…</span>
                            : <span className="brf-chip interactive" {...clickable(ai.run)}>↻ RE-ANALYZE</span>}>
      <p className="brf-prose">
        {ai.text || (ai.running ? "Running an in-depth pass… (~a few seconds; costs a turn)" : "No AI read yet — press RE-ANALYZE.")}
        {ai.running && <span className="brf-caret" />}
      </p>
      {ts && !ai.running && <div className="brf-note">claude · {ts}</div>}
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
export function BriefingPage({ symbol, currentPrice, onClose }) {
  const { brief, selectedSymbol, setSelectedSymbol, session, status, refresh } = useSessionBrief();
  const [view, setView] = useState("det");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (symbol === "MNQ1!" || symbol === "MES1!") setSelectedSymbol(symbol);
  }, [symbol, setSelectedSymbol]);

  // Alert ring state for the LEVELS bells (armed price→id map + fired set).
  const [armed, setArmed] = useState(new Map());
  const [fired, setFired] = useState(new Set());
  useAlertStateListener((ev) => setArmed(new Map(normalizeArmed(ev).map((a) => [Number(a.price), a.id]))));
  useAlertFiredListener((ev) => { const p = Number(ev?.price); if (Number.isFinite(p)) setFired((s) => new Set(s).add(p)); });
  const onArm = async (lvl) => { await armAlertReal(lvl.price, lvl.name); };
  const onDisarm = async (lvl) => { const id = armed.get(Number(lvl.price)); if (id != null) await disarmAlertReal(id); };

  const events = useCalendar();
  const onRefresh = async () => { setRefreshing(true); try { await refresh?.(); } finally { setRefreshing(false); } };

  const tabs = (
    <>
      <span className="page-syms">
        {SYMS.map(([s, l]) => (
          <span key={s} className={"pill interactive" + (s === selectedSymbol ? " active" : "")}
                {...clickable(() => setSelectedSymbol(s))}>{l}</span>
        ))}
      </span>
      <span className="page-detai">
        <span className={"pill interactive" + (view === "det" ? " active" : "")} {...clickable(() => setView("det"))}>DET</span>
        <span className={"pill interactive" + (view === "ai" ? " active" : "")} {...clickable(() => setView("ai"))}>AI</span>
      </span>
      {refreshing
        ? <span className="pill dim">REFRESHING…</span>
        : <span className="pill interactive" {...clickable(onRefresh, { label: "refresh brief" })}>↻</span>}
    </>
  );

  return (
    <Page icon={PAGE_ICONS.briefing} tint="blue" title="Brief"
          sub={brief ? `${brief.date ?? ""} · ${sessionShort(brief.session)}` : (status || "no brief")}
          wide tabs={tabs} onClose={onClose}
          foot={<><span>chart stays live behind — esc returns</span></>}>
      {!brief ? (
        <div className="brf-empty" style={{ margin: "auto", padding: 40 }}>
          {status ? status : "No brief yet for this session."}
        </div>
      ) : (
        <div className="brf-dash">
          <DecisionHero brief={brief} />
          <div className="brf-grid">
            <div className="brf-col">
              <CalendarCard events={events} />
              <OvernightCard brief={brief} />
            </div>
            <div className="brf-col">
              <BiasCard brief={brief} />
              <QualityCard brief={brief} />
            </div>
            <div className="brf-col">
              <LevelsCard brief={brief} currentPrice={currentPrice} armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
              <OpenReactionCard brief={brief} session={session} />
              <ScenariosCard brief={brief} />
            </div>
          </div>
          <ClaudeCard brief={brief} symbol={selectedSymbol || symbol} session={session} view={view} />
        </div>
      )}
    </Page>
  );
}
