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
  scenariosMeta, stripCitations, humanizeToken,
} from "../../Prep.helpers.js";
import { useSessionBrief } from "../../hooks/useSessionBrief.js";
import { useOpenReaction } from "../../hooks/useOpenReaction.js";
import { useAiPrep } from "../../hooks/useAiPrep.js";
import { useCalendar } from "../../hooks/useCalendar.js";
import {
  armAlertReal, disarmAlertReal, normalizeArmed, useAlertStateListener, useAlertFiredListener,
} from "../../hooks/useAlerts.js";

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
  // Unison row grammar: label left · one-line value right (ellipsis, full text
  // in the tooltip) · optional muted sub-line under the row for long detail.
  return rows.map((r) => (
    <React.Fragment key={r.k}>
      <div className="brf-row" title={r.tip || (r.note ? `${r.v} ${r.note}` : r.v)}>
        <span className="k">{r.k}</span>
        <span className={"v " + toneCls(r.tone) + (r.prose ? " prose" : "")}>
          {r.v}
          {r.note ? <span className="note"> {stripCitations(r.note)}</span> : null}
        </span>
      </div>
      {r.sub ? <div className="brf-rowsub">{r.sub}</div> : null}
    </React.Fragment>
  ));
}

// AI Prep section body — prose once the section has streamed in (caret while
// it's the one being written), a dim placeholder before the turn reaches it.
// Citations stay in the saved record; display strips them (constraint #6).
function AiProse({ ai }) {
  if (!ai) return null;
  if (ai.text) {
    return (
      <p className="cs-bias-prose">
        {stripCitations(ai.text)}
        {ai.caret && <span className="brf-caret" />}
      </p>
    );
  }
  return <div className="brf-empty">writing…</div>;
}

// ── CALENDAR (today's USD events) ──────────────────────────────────────
function CalendarCard({ events, ai }) {
  const now = Date.now();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
  const rows = (events || []).filter((e) => {
    const d = new Date(e?.ts); if (!Number.isFinite(d.getTime())) return false;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d) === today;
  }).slice(0, 6);
  const t = (ts) => new Date(ts).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  if (ai) return <Card title="CALENDAR · ET"><AiProse ai={ai} /></Card>;
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
            <span className={"imp " + imp}>{imp === "medium" ? "MED" : (e.impact || "").toUpperCase().slice(0, 4)}</span>
          </div>
        );
      })}
      {rows.length > 0 && <div className="brf-cal-rule">no entries ±10 min around HIGH impact</div>}
    </Card>
  );
}

// ── OVERNIGHT ──────────────────────────────────────────────────────────
function OvernightCard({ brief, ai }) {
  const rows = overnightHeaderRows(brief);
  const ob = brief?.overnight_block || {};
  if (ai) return <Card title="OVERNIGHT" meta="Asia + London"><AiProse ai={ai} /></Card>;
  return (
    <Card title="OVERNIGHT" meta="Asia + London">
      <RowList rows={rows} />
      {ob.path_to_destination && <div className="brf-row"><span className="k">Path</span><span className="v">{humanizeToken(stripCitations(String(ob.path_to_destination)))}</span></div>}
    </Card>
  );
}

// ── BIAS ───────────────────────────────────────────────────────────────
function BiasCard({ brief, ai }) {
  const vote = drawBiasVoteRows(brief);
  const struct = htfBiasToRowsDesigner(brief);
  if (ai) return <Card title="BIAS" meta={`${vote.cast}/3 components`}><AiProse ai={ai} /></Card>;
  return (
    <Card title="BIAS" meta={`${vote.cast}/3 components`}>
      <RowList rows={vote.rows} />
      {struct.length > 0 && <div className="brf-subhd">STRUCTURE · D / 4H / 1H</div>}
      <RowList rows={struct} />
    </Card>
  );
}

// ── PRICE QUALITY ──────────────────────────────────────────────────────
function QualityCard({ brief, ai }) {
  const pillar2 = selectPillar(brief?.pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  const verdict = brief?.pillar2_verdict;
  const vTone = verdict === "good" ? "green" : verdict === "marginal" ? "amber" : verdict === "poor" ? "red" : "dim";
  return (
    <Card title="PRICE QUALITY" right={verdict ? <span className={"brf-chip " + vTone}>{verdict.toUpperCase()}</span> : null}>
      {ai ? <AiProse ai={ai} /> : <RowList rows={rows} />}
    </Card>
  );
}

// ── LEVELS IN PLAY (with alert bells) ──────────────────────────────────
function LevelRow({ level, armed, fired, onArm, onDisarm }) {
  const isArmed = armed.has(Number(level.price));
  const isFired = fired.has(Number(level.price));
  const bell = "◈";
  const cls = isFired ? "bell fired" : isArmed ? "bell armed" : "bell";
  const title = isFired ? "alert fired" : isArmed ? "armed — click to disarm" : "click to arm alert";
  const toggle = () => (isArmed ? onDisarm(level) : onArm(level));
  return (
    <div className="brf-lvl">
      {/* display in the engine's dotted form (NYPM_H is the citation-safe key) */}
      <span className="name">{String(level.name || "").replace(/_/g, ".")}</span>
      <span className="price">{level.price}</span>
      <span className={cls} title={title} {...clickable(toggle, { label: title })}>{bell}</span>
    </div>
  );
}

// ── OPEN REACTION ──────────────────────────────────────────────────────
function OpenReactionCard({ brief, session, ai }) {
  const { latest, ltf } = useOpenReaction(session);
  const orv = openReactionVerdict(latest, brief, ltf);
  return (
    <Card title="OPEN REACTION" right={<span className={"brf-chip " + orv.verdictTone}>{orv.verdict}</span>}>
      {ai ? <AiProse ai={ai} /> : (
        <>
          <RowList rows={orv.rows} />
          {orv.note && <div className="brf-note">{orv.note}</div>}
        </>
      )}
    </Card>
  );
}

// ── SCENARIOS (IF / THEN) ──────────────────────────────────────────────
function ScenariosCard({ brief, ai }) {
  const scenarios = brief?.scenarios || [];
  if (ai) return <Card title="SCENARIOS" meta={scenariosMeta(brief)}><AiProse ai={ai} /></Card>;
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
          {s.action && <div className="act">↳ {stripCitations(s.action)}</div>}
          {s.target && <div className="tgt">→ {stripCitations(String(s.target))}</div>}
        </div>
      ))}
    </Card>
  );
}

// ── PLAN — anchored target / structural stop / sizing (the old PLAN tail) ──
function PlanCard({ brief, ai }) {
  if (!ai && !brief?.anchored_target && !brief?.anchored_stop && !brief?.sizing_note) return null;
  return (
    <Card title="PLAN" meta="anchored">
      {/* the numbers stay deterministic in BOTH modes — the AI only narrates */}
      {brief?.anchored_target && <div className="brf-row"><span className="k">Target</span><span className="v ok">{stripCitations(brief.anchored_target)}</span></div>}
      {brief?.anchored_stop && <div className="brf-row"><span className="k">Stop</span><span className="v bad">{stripCitations(brief.anchored_stop)}</span></div>}
      {brief?.sizing_note && <div className="brf-row"><span className="k">Sizing</span><span className="v">{stripCitations(brief.sizing_note)}</span></div>}
      {ai && <AiProse ai={ai} />}
    </Card>
  );
}

// ── HTF BIAS (prototype col-2: symbol ⇄ · LONG · prose · levels) ──
// The per-card DET/AI toggle moved to the page level (AI Prep) — its ## HTF
// READ section is this card's AI body; one analysis consumer per page.
function HtfBiasCard({ brief, symbol, setSymbol, session, currentPrice, armed, fired, onArm, onDisarm, ai, aiTs }) {
  const d = decisionLine(brief);
  const bias = d.biasTone === "ok" ? "LONG" : d.biasTone === "bad" ? "SHORT" : "NEUTRAL";
  const badgeTone = d.biasTone === "ok" ? "long" : d.biasTone === "bad" ? "short" : "neutral";
  const untaken = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const grp = groupLevelsByPrice(untaken, currentPrice);
  const levels = [...(grp.above || []), ...(grp.below || []), ...(grp.all || [])];
  const toggleSym = () => setSymbol(symbol === "MNQ1!" ? "MES1!" : "MNQ1!");
  const detProse = brief?.prose_summary || "Deterministic prep — read the panels; AI Prep writes the readable pass.";
  const ts = aiTs ? new Date(aiTs).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) + " ET" : null;
  return (
    <div className="brf-card cs-bias-card">
      <div className="brf-card-hd cs-bias-hd">
        <span className="t">HTF BIAS</span>
        <span className="cs-brief-sym" {...clickable(toggleSym, { label: "toggle symbol" })}>{symbol}<span className="x"> ⇄</span></span>
        <span className={"cs-bias-badge " + badgeTone}>{bias}</span>
      </div>
      {ai ? <AiProse ai={ai} /> : <p className="cs-bias-prose">{stripCitations(detProse)}</p>}
      {ai && ts && <div className="brf-note">claude · {ts}</div>}
      {levels.length > 0 && <div className="brf-subhd">LEVELS · UNTAKEN · ◈ ARMS AN ALERT</div>}
      <div className="cs-levels">
        {levels.length > 0
          ? levels.map((lv) => (
              <LevelRow key={`${lv.name}-${lv.price}`} level={lv} armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm} />
            ))
          : <div className="brf-empty">no untaken levels in play</div>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
export function BriefingPage({ symbol, currentPrice, onStartPrep, onClose }) {
  const { brief, selectedSymbol, setSelectedSymbol, session, status, statusReason, refresh } = useSessionBrief();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (symbol === "MNQ1!" || symbol === "MES1!") setSelectedSymbol(symbol);
  }, [symbol, setSelectedSymbol]);

  // Alert ring state for the LEVELS bells (armed price→id map + fired set).
  const [armed, setArmed] = useState(new Map());
  const [fired, setFired] = useState(new Set());
  useAlertStateListener((ev) => setArmed(new Map(normalizeArmed(ev).map((a) => [Number(a.price), a.id]))));
  useAlertFiredListener((ev) => { const p = Number(ev?.price); if (Number.isFinite(p)) setFired((s) => new Set(s).add(p)); });
  // Optimistic arm/disarm so a clicked bell reacts immediately (the alerts:state
  // listener reconciles the real id); guards against double-arming.
  const onArm = async (lvl) => {
    const p = Number(lvl.price);
    if (armed.has(p)) return;
    setArmed((m) => new Map(m).set(p, "pending"));
    const r = await armAlertReal(lvl.price, lvl.name);
    if (!r?.ok) setArmed((m) => { const n = new Map(m); n.delete(p); return n; });
  };
  const onDisarm = async (lvl) => {
    const p = Number(lvl.price);
    const id = armed.get(p);
    setArmed((m) => { const n = new Map(m); n.delete(p); return n; });
    if (id != null && id !== "pending") await disarmAlertReal(id);
  };

  const events = useCalendar();
  const onRefresh = async () => { setRefreshing(true); try { await refresh?.(); } finally { setRefreshing(false); } };

  // AI Prep — run-once page mode. The saved record hydrates per symbol;
  // pressing the button with a record present only switches the view.
  const aiPrep = useAiPrep({ symbol: selectedSymbol || symbol, session, brief });
  const [mode, setMode] = useState("det");
  const aiOn = mode === "ai";
  const onAiPrep = () => {
    if (aiPrep.running) return;
    setMode("ai");
    if (!aiPrep.exists) aiPrep.run();
  };
  const onRegenerate = () => { if (!aiPrep.running) aiPrep.run(); };
  // Per-card AI body: null → the card renders its deterministic content
  // (missing section on an old record, or det mode).
  const aiSec = (marker) => {
    if (!aiOn) return null;
    const text = aiPrep.sections[marker] || null;
    if (!text && !aiPrep.running) return null;
    return { text, caret: aiPrep.running && aiPrep.active === marker };
  };

  const tabs = (
    <>
      {(aiPrep.exists || aiPrep.running) && (
        <span className="cs-brief-seg cs-seg-track">
          <span className={"cs-segpill" + (!aiOn ? " is-on" : "")} {...clickable(() => setMode("det"), { label: "deterministic view" })}>DET</span>
          <span className={"cs-segpill" + (aiOn ? " is-on" : "")} {...clickable(() => setMode("ai"), { label: "AI prep view" })}>AI</span>
        </span>
      )}
      {aiOn && aiPrep.stale && !aiPrep.running && (
        <span className="brf-chip amber interactive" {...clickable(onRegenerate, { label: "regenerate AI prep" })}
              title="the deterministic brief changed after this AI prep was written">
          brief updated · regenerate
        </span>
      )}
      {refreshing
        ? <span className="cs-brief-refresh dim" aria-hidden>↻</span>
        : <span className="cs-brief-refresh interactive" {...clickable(onRefresh, { label: "refresh brief" })}>↻</span>}
      {brief && (
        aiPrep.running
          ? <span className="cs-btn-ghost-sm dim">Writing…</span>
          : <span className="cs-btn-ghost-sm interactive" {...clickable(onAiPrep, { label: "AI prep" })}
                  title={aiPrep.exists ? "show the saved AI prep (regenerate only when the brief updates)" : "one AI turn writes this brief as readable prose — runs once, then persists"}>
              AI Prep
            </span>
      )}
      {onStartPrep && <span className="cs-btn-primary-sm interactive" {...clickable(onStartPrep, { label: "start prep session" })}>Start prep</span>}
    </>
  );

  const grade = brief ? decisionLine(brief).grade : null;
  return (
    <Page className="cs-brief" icon={PAGE_ICONS.briefing} tint="blue" title="Brief"
          sub={brief ? `${brief.date ?? ""} · ${sessionShort(brief.session)}${grade ? ` · ${grade}` : ""}` : (status === "running" ? "preparing…" : "no brief")}
          wide tabs={tabs} onClose={onClose}
          foot={<><span>chart stays live behind — esc returns</span></>}>
      {!brief ? (
        <div className="brf-empty" style={{ margin: "auto", padding: 40 }}>
          {status === "running" ? "Preparing the brief… (2–5 min)"
            : status === "error" ? `Brief failed${statusReason ? " — " + statusReason : ""} — ↻ retries.`
            : status === "skipped" ? `Brief skipped${statusReason ? " — " + statusReason : ""}.`
            : "No brief yet for this session — ↻ or Start prep builds one."}
        </div>
      ) : (
        <div className="brf-dash">
          {aiOn && aiPrep.error && (
            <div className="brf-ai-error">{aiPrep.error}</div>
          )}
          <div className="brf-grid">
            <div className="brf-col">
              <CalendarCard events={events} ai={aiSec("CALENDAR")} />
              <OvernightCard brief={brief} ai={aiSec("OVERNIGHT")} />
              <QualityCard brief={brief} ai={aiSec("PRICE QUALITY")} />
            </div>
            <div className="brf-col">
              <HtfBiasCard brief={brief} symbol={selectedSymbol || symbol} setSymbol={setSelectedSymbol}
                           session={session} currentPrice={currentPrice}
                           armed={armed} fired={fired} onArm={onArm} onDisarm={onDisarm}
                           ai={aiSec("HTF READ")} aiTs={aiOn && !aiPrep.running ? aiPrep.ts : null} />
              <BiasCard brief={brief} ai={aiSec("BIAS")} />
            </div>
            <div className="brf-col">
              <OpenReactionCard brief={brief} session={session} ai={aiSec("OPEN REACTION")} />
              <ScenariosCard brief={brief} ai={aiSec("SCENARIOS")} />
              <PlanCard brief={brief} ai={aiSec("PLAN")} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
