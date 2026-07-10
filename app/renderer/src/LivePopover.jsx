// LIVE workstation — v2 designer port (HUNT / TICKET / IN-TRADE / ADD).
// Faithful to ~/Downloads/Dashboard Location (4)/assets/pop-prep-live.jsx
// (LIVE section). MOCK swapped for real hooks; the order ticket sizes in $
// risk via Sizing.helpers.sizeOrder and fires through executionAdapter
// (currently a stub — no broker writes per CLAUDE.md #2 until the
// execution-engine spec lands). Tabs let the trader preview each view; the
// default view follows the data (activeTrade → IN-TRADE, else HUNT).

import React, { useState, useEffect, useRef } from "react";
import { clickable } from "./a11y.js";
import { Panel, Row } from "./Shared.jsx";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  modelLabel,
  normalizeSide,
  entryConfirmationVerdict,
  explainNoTradeReason,
  liveGuardBudgets,
  fillChips,
  walkerHuntRows,
  pnlDisplay,
} from "./Live.helpers.js";
import { useWalkers } from "./hooks/useWalkers.js";
import { stripCitations, openReactionVerdict } from "./Prep.helpers.js";
import { foldIntentChain, deriveTimeline, brokerVsJournal, sourceAgeChips, pnlGate } from "./LiveTimeline.helpers.js";
import { realAccountView } from "./Account.helpers.js";
import { walkerTruthToProse } from "./Brain.helpers.js";
import { useBrokerAccount } from "./hooks/useBrokerAccount.js";
import { useDeterministicBrain } from "./hooks/useDeterministicBrain.js";
import { sizeOrder } from "./Sizing.helpers.js";
import { executionAdapter } from "./execution/executionAdapter.js";
import { buildOrderRequest } from "./execution/orderRequest.js";
import { useTrades } from "./hooks/useTrades.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { noTradeStatusLabel } from "./hooks/useActiveSetup.helpers.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useHealth } from "./hooks/useHealth.js";
import { useChat } from "./hooks/useChat.js";
import { useBacktestRunning } from "./hooks/useBacktest.js";
import { useExecutionState } from "./hooks/useExecutionState.js";
import { useFills } from "./hooks/useFills.js";
import { useSessionBrief } from "./hooks/useSessionBrief.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";

// ── Price with hover data-source tooltip (designer's Px) ─────────────────
function Px({ v, children, src, tone, big }) {
  const text = v != null ? v : children;
  return (
    <span className={"px-h" + (tone ? " " + tone : "") + (big ? " big" : "")}
          data-src={src || "data source · attached"} tabIndex={0}>{text}</span>
  );
}

// Point value per micro contract: MNQ $2/pt, MES $5/pt.
function pointValueFor(symbol) {
  return String(symbol || "").startsWith("MES") ? 5 : 2;
}
function sizeLabel(s) {
  if (!s) return "—";
  return s.label || (s.contracts != null ? `${s.contracts}c` : "—");
}

// ── Order-ticket localStorage (remembers last $ risk) ────────────────────
const RISK_KEY = "workstation:lastRisk";
function loadRiskOr(d) { try { const v = localStorage.getItem(RISK_KEY); return v ? +v : d; } catch { return d; } }
function saveRisk(v) { try { localStorage.setItem(RISK_KEY, String(v)); } catch { /* ignore */ } }

// Pull the latest Claude reply / bar-read prose, citation-stripped.
function latestReadText(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && (m.type === "reply" || m.type === "bar-read") && m.body) {
      return { t: m.t, text: stripCitations(m.body.replace(/<[^>]+>/g, " ")) };
    }
  }
  return null;
}

// ── OPEN REACTION (live) — Lanto's third bias component resolving in-session.
// Reuses the same deterministic verdict logic as PREP; pre-open shows PENDING,
// then flips to CONFIRMS / FLIPS / NOT YET once the resolver writes a read.
const OR_PILL = { ok: "green", green: "green", warn: "amber", amber: "amber", bad: "red", red: "red", dim: "dim" };

// LTF BIAS strip — the live, per-bar resolver output (depth-2). Shows the working
// bias the chain is acting on RIGHT NOW: side · alignment · grade-cap · entry model.
// RESOLVING… until the open earns a direction; on a stand-aside open this is the
// only thing that moves while the minute-14 snapshot sits PENDING. getOpenReaction
// normalizes the source (ltf-bias-live.json → ltf-bias.json snapshot).
function LtfBiasStrip({ ltf }) {
  const bias = String(ltf?.bias ?? "").toLowerCase();
  const side = bias.startsWith("bull") ? { t: "LONG", c: "green" }
             : bias.startsWith("bear") ? { t: "SHORT", c: "red" }
             : { t: "—", c: "dim" };
  const align = String(ltf?.htf_ltf_alignment ?? "").toLowerCase();
  const hasSide = side.t !== "—";
  const hasAlign = align !== "" && align !== "unclear";
  const resolving = !ltf || (!hasSide && !hasAlign);
  return (
    <div className="ltf-strip">
      <span className="ltf-k">LTF BIAS</span>
      {resolving ? (
        <span className="pill dim">RESOLVING…</span>
      ) : (
        <>
          <span className={"pill " + side.c}>{side.t}</span>
          {align ? <span className="ltf-meta">{align}</span> : null}
          {ltf.grade_cap ? <span className="ltf-meta">cap {ltf.grade_cap}</span> : null}
          {ltf.entry_model_priority && ltf.entry_model_priority !== "undecided"
            ? <span className="ltf-meta">{String(ltf.entry_model_priority).toLowerCase()}</span> : null}
        </>
      )}
    </div>
  );
}

function LiveOpenReactionPanel({ latest, brief, ltf }) {
  const orv = openReactionVerdict(latest, brief, ltf);
  return (
    <Panel title="OPEN REACTION" right={<span className={"pill " + (OR_PILL[orv.verdictTone] || "dim")}>{orv.verdict}</span>}>
      <LtfBiasStrip ltf={ltf} />
      {orv.rows.map((r) => <Row key={r.k} k={r.k} v={r.v} tone={r.tone} />)}
      <div className="or-note">{orv.note}</div>
    </Panel>
  );
}

// ── ORDER TICKET — type $ risk → computed micros → accepting fires ───────
function TicketView({ setup, account, guards, symbol, onFire, onCancel }) {
  const G = guards || { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 };
  const [risk, setRisk] = useState(() => loadRiskOr(G.defaultRisk));
  const [type, setType] = useState("market");
  const [focus, setFocus] = useState(false);
  const pointValue = pointValueFor(symbol);
  const stopPts = setup ? Math.abs(setup.entry - setup.stop) : 0;
  const hasStop = setup?.stop != null && Number.isFinite(stopPts) && stopPts > 0;
  const sized = hasStop
    ? sizeOrder({ riskUsd: risk, stopPts, pointValue, perTradeMax: G.perTradeMax })
    : { contracts: 0, actualRisk: 0, withinTolerance: false, blockReason: "bad_stop" };
  const perContract = stopPts * pointValue;
  const { contracts, actualRisk, pctOfMax } = sized;

  let block = null;
  if (!hasStop) block = { code: "NO STOP", msg: "Setup has no valid stop — can't compute size. Reject and wait for the next candidate." };
  else if (actualRisk > G.perTradeMax) block = { code: "OVER PER-TRADE MAX", msg: `Computed risk $${actualRisk.toFixed(0)} exceeds the $${G.perTradeMax} per-trade ceiling. Lower the $ risk to send.` };
  else if (contracts < 1) block = { code: "SIZE MISMATCH", msg: `No whole micro-contract size could be computed for this stop.` };

  const fire = () => {
    if (block) return;
    saveRisk(risk);
    onFire({ type, riskUsd: risk, sizing: sized });
  };
  const sideCls = setup.side === "long" ? "l" : "s";

  return (
    <div className="work-scroll">
      <Panel title="ORDER TICKET"
        right={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span className={"pill " + (setup.side === "long" ? "green" : "red")}>{setup.side.toUpperCase()}</span>
          <span style={{ color: "var(--label)", fontSize: 10 }}>{setup.model}</span>
        </span>}>

        <div className="ticket-banner">
          <span className={"side " + sideCls}>{setup.side.toUpperCase()}</span>
          <span className="model">{setup.model}</span>
          <span>{symbol} · {type === "market" ? "MARKET" : "LIMIT"}</span>
          <span className="spacer" />
          <span className={"acct " + (account === "live" ? "live" : "paper")}>{account === "live" ? "● LIVE" : "PAPER"}</span>
        </div>

        <div className={"risk-field" + (focus ? " focus" : "")}>
          <span className="lbl">$ RISK<b>this trade</b></span>
          <div style={{ textAlign: "right" }}>
            <div className="input-wrap">
              <span className="cur">$</span>
              <input type="text" inputMode="numeric" value={risk}
                onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                onChange={(e) => { const n = e.target.value.replace(/[^0-9]/g, ""); setRisk(n ? +n : 0); }}
                onKeyDown={(e) => { if (e.key === "Enter") fire(); }} />
            </div>
            <div className="last">remembers last · default ${G.defaultRisk}</div>
          </div>
        </div>

        <div className="tk-type">
          <span className="k">TYPE</span>
          <div className="seg">
            <div className={"s" + (type === "market" ? " on" : "")} onClick={() => setType("market")}>MARKET</div>
            <div className={"s" + (type === "limit" ? " on" : "")} onClick={() => setType("limit")}>LIMIT</div>
          </div>
        </div>

        <div className="tk-compute">
          <div className="tk-contracts">
            <span className="v">{contracts}</span>
            <span className="u">MICRO {contracts === 1 ? "CONTRACT" : "CONTRACTS"}</span>
            <span className="note">${perContract.toFixed(0)} risk / contract<br />at {stopPts.toFixed(1)} pt stop</span>
          </div>
          <Row k="Entry" v={<Px v={setup.entry + (type === "limit" ? " LMT" : " MKT")} />} />
          <Row k="Stop" v={<Px v={setup.stop} tone="red" />} />
          <Row k="Take-profit" v={<Px v={setup.tp1} tone="green" />} />
          <div className="row"><span className="k">Actual $ risk</span><span className="v actual"><Px v={"$" + actualRisk.toFixed(0)} /> · {pctOfMax != null ? pctOfMax : 0}% of max</span></div>
        </div>

        {block ? (
          <>
            <div className="order-block">
              <div className="hd"><span className="x" />ORDER BLOCKED<span className="code">{block.code}</span></div>
              <div className="msg">{block.msg}</div>
            </div>
            <button className="tk-fire locked" disabled>▸ CAN'T SEND — {block.code}</button>
          </>
        ) : (
          <button className="tk-fire" onClick={fire}>
            ▸ ACCEPT — SENDS {type.toUpperCase()} ORDER
          </button>
        )}
        <button className="tk-cancel" onClick={onCancel}>CANCEL · BACK</button>
      </Panel>
    </div>
  );
}

// ── IN-TRADE — live grid + risk plan + manage + brain ───────────────────
// TradeProgress — the prototype's stop→target position bar. Purely visual;
// derives everything from values already in scope, no money-path logic.
// Renders nothing unless entry/stop/tp1/price are all finite and the stop is on
// the correct side of the target.
function TradeProgress({ side, entry, stop, tp1, price, tp1Hit }) {
  const nums = [entry, stop, tp1, price].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [e, s, tp, p] = nums;
  const isLong = side === "long";
  const range = isLong ? tp - s : s - tp;
  if (!(range > 0)) return null;
  const frac = (v) => Math.max(0, Math.min(1, (isLong ? v - s : s - v) / range));
  const pricePct = frac(p) * 100;
  const entryPct = frac(e) * 100;
  return (
    <div title="position between stop and target">
      <div className="cs-pos-bar">
        <span className="cs-pos-bar__fill" style={{ width: pricePct + "%" }} />
        <span className="cs-pos-bar__entry" style={{ left: entryPct + "%" }} title="entry" />
        <span className="cs-pos-bar__marker" style={{ left: pricePct + "%" }} />
      </div>
      <div className="cs-pos-legend">
        <span className="stop mono">STOP {stop}</span>
        <span className="now">{tp1Hit ? "TP1 ✓" : "NOW"} <span className="mono">{price}</span></span>
        <span className="target mono">TARGET {tp1}</span>
      </div>
    </div>
  );
}

// ── Order-lifecycle timeline (Task C3) — the 7-stage rail derived from the
// durable order-intent chain, forge-proofed against live broker truth. The
// current stage pulses; a failed / recovery stage turns red and carries a
// persistent recovery action whose verbs are pinned to the reconcile
// whitelist (retry / adopt / protect / flatten).
const STAGE_TAG = { done: "✓", current: "…", failed: "✕", pending: "" };
function OrderLifecycleTimeline({ timeline, onRecover }) {
  if (!timeline) return null;
  const { stages, recovery, corrupt } = timeline;
  return (
    <div className="cs-oltl">
      <div className="cs-oltl-hd">
        <span className="cs-oltl-hd__lbl">ORDER LIFECYCLE</span>
        {corrupt && <span className="cs-oltl-hd__corrupt">CORRUPT JOURNAL</span>}
      </div>
      <div className="cs-oltl-rail">
        {stages.map((s) => (
          <div key={s.key} className={"cs-oltl-step is-" + s.status + (s.badge ? " badge-" + s.badge : "")}>
            <span className="cs-oltl-node" aria-hidden="true" />
            <span className="cs-oltl-lbl">{s.label}</span>
            <span className="cs-oltl-tag">{STAGE_TAG[s.status] || ""}</span>
          </div>
        ))}
      </div>
      {recovery && (
        <div className="cs-oltl-recovery">
          <div className="cs-oltl-recovery__msg">⚠ {recovery.message}</div>
          <div className="cs-oltl-recovery__acts">
            {recovery.verbs.map((v) => (
              <button key={v} className="cs-oltl-recovery__btn" onClick={() => onRecover(v)}>{v.toUpperCase()}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const bvjFmt = (n) => (n == null ? "—" : String(n));
function BrokerVsJournalPanel({ v }) {
  if (!v) return null;
  const tone = v.verdict === "covered" ? "green" : v.verdict === "unknown" ? "amber" : "red";
  return (
    <div className="cs-bvj">
      <div className="cs-bvj-hd">
        <span className="cs-bvj-hd__lbl">BROKER vs JOURNAL</span>
        <span className={"cs-bvj-verdict " + tone}>{String(v.verdict).toUpperCase()}</span>
      </div>
      <div className="cs-bvj-grid">
        <div className="cs-bvj-cell"><span className="k">QTY</span><span className="mono">J {bvjFmt(v.qty.journal)} · B {bvjFmt(v.qty.broker)}</span></div>
        <div className="cs-bvj-cell"><span className="k">STOP</span><span className="mono">J {bvjFmt(v.stop.journal)} · B {bvjFmt(v.stop.broker)}</span></div>
      </div>
    </div>
  );
}

function SourceAgeChipsRow({ chips }) {
  if (!chips?.length) return null;
  return (
    <div className="cs-agechips">
      {chips.map((c) => (
        <span key={c.key} className={"cs-agechip" + (c.stale ? " stale" : "")}
              title={c.stale ? `${c.key} read is stale — do not trust` : `${c.key} fresh`}>
          {c.key} {c.age_s == null ? "—" : c.age_s + "s"}
        </span>
      ))}
    </div>
  );
}

function InTradeView({ position, trade, lastBar, price, symbol, workingOrders, brief, session, exec, orderIntent, health }) {
  // The live broker position (from execution.state / trading WS) is the source
  // of truth for entry/stop/tp/side/qty; the journal trade supplies model /
  // grade / id metadata when present.
  const t = trade || {};
  const live = !!position;
  const side = (position ? normalizeSide(position.side) : null) || t.side || "long";
  const entry = position?.avgFill ?? t.entry;
  // A Tradovate position carries no stop/tp on the position object — they live
  // in its working orders (the bracket). Pull Stop from the working stop order
  // and TP1 from the working limit order so the panel isn't blank.
  const stopOrder = (workingOrders || []).find((o) => o?.kind === "stop");
  const tpOrder = (workingOrders || []).find((o) => o?.kind === "limit");
  const stop = position?.sl ?? stopOrder?.price ?? t.stop;
  const tp1 = position?.tp ?? tpOrder?.price ?? t.tp1;
  const qty = position?.qty ?? t.size?.contracts ?? null;
  const sym = String(position?.symbol || symbol || "").replace("CME_MINI:", "");
  // Carry fill state so the P&L gate (audit C35) applies in the IN-TRADE panel:
  // a broker position present = filled; otherwise the trade's own state (a
  // pending_entry order shows PENDING, not a fabricated live R).
  const view = { side, entry, stop, tp1, tp2: t.tp2, r_realized: t.r_realized, tp1_hit: t.tp1_hit, state: position ? "filled" : t.state };
  const livePrice = (typeof price === "number" && Number.isFinite(price)) ? price : lastBar?.close;
  const grid = liveGridFromTrade(view, livePrice);
  const brain = useDeterministicBrain();
  const latestBrain = brain.length ? brain[brain.length - 1] : null;
  const grade = t.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  const pointValue = pointValueFor(sym);
  const dollarRisk = (entry != null && stop != null && qty != null)
    ? (Math.abs(entry - stop) * pointValue * qty).toFixed(0)
    : null;
  // Tradovate positions carry no stop on the position object, so the R-based
  // P&L above is null (blank). Fall back to the broker's unrealized $ (or pts ×
  // $/pt × qty) so the P&L cell shows a real number.
  if (grid.pnl.v === "—" && qty != null) {
    const usd = position?.uPnlUsd != null
      ? Number(position.uPnlUsd)
      : (Number.isFinite(entry) && Number.isFinite(livePrice))
        ? (side === "long" ? livePrice - entry : entry - livePrice) * pointValue * qty
        : null;
    if (usd != null && Number.isFinite(usd)) {
      const r = Math.round(usd);
      grid.pnl = { v: `${r >= 0 ? "+" : "−"}$${Math.abs(r).toLocaleString("en-US")}`, sub: "unrealized", tone: r > 0 ? "green" : r < 0 ? "red" : "" };
    }
  }
  // ── Order-lifecycle truth (Task C3). Re-derive the visible rail purely from
  // the raw durable order-intent chain + live broker truth — never trust a
  // record's claimed stage at face value (#233). The IN-TRADE panel is the one
  // place a live position renders, so this is where the trader sees whether the
  // order actually reached the broker, whether the stop is really working, and
  // whether the P&L number is a real fill or a hopeful simulation.
  const showLifecycle = orderIntent !== undefined;
  const execTruth = { position, workingOrders, read_at: exec?.read_at ?? null, connected: exec?.connected, price: livePrice };
  const chain = showLifecycle ? foldIntentChain(orderIntent?.records || [], { symbol: position?.symbol || symbol }).active : null;
  const timeline = showLifecycle
    ? deriveTimeline({ chain, trade: t, exec: execTruth, reconcile: orderIntent?.reconcile ?? null, dropped: orderIntent?.dropped ?? 0 })
    : null;
  const bvj = showLifecycle ? brokerVsJournal({ trade: t, exec: execTruth, reconcile: orderIntent?.reconcile ?? null }) : null;
  const ageChips = showLifecycle ? sourceAgeChips({ exec: execTruth, reconcile: orderIntent?.reconcile ?? null, health, lastBar, now: Date.now() }) : null;
  // P&L is a money number: gate it on a DURABLE fill (POSITION_CONFIRMED+). A
  // journal "filled" state alone is not enough — that can be simulated. Absent
  // the durable proof, show PENDING rather than a fabricated live R.
  const gate = showLifecycle ? pnlGate({ chain, trade: t, exec: execTruth, reconcile: orderIntent?.reconcile ?? null }) : { show: true };
  const gatedPnl = gate.show ? grid.pnl : { v: "PENDING", tone: "", sub: "awaiting durable fill" };
  // Broker-read outage (exec.stale) → last-known P&L renders greyed + STALE,
  // never live-green (Task C5). Only applies once the gate lets a number show.
  const pnlCell = gate.show ? pnlDisplay(gatedPnl, showLifecycle && exec?.stale) : gatedPnl;
  const onRecover = async (verb) => {
    try { await window.api?.execution?.reconcile?.({ action: verb }); } catch { /* surfaced via app:error */ }
  };

  // Trade-management actions await the broker ack and surface any failure
  // (audit C34) — a fire-and-forget FLATTEN that the broker rejects previously
  // looked successful while the position stayed open.
  const [mngMsg, setMngMsg] = useState(null);
  const mng = (fn, label) => async () => {
    setMngMsg(null);
    try {
      const r = await executionAdapter[fn]({ symbol: position?.symbol || symbol, tradeId: t.id });
      if (!r?.ok) setMngMsg(`${label} FAILED — ${r?.error || `broker rejected (status ${r?.status ?? "?"})`}`);
    } catch (e) { setMngMsg(`${label} FAILED — ${String(e?.message || e)}`); }
  };
  return (
    <div className="cs-pos-card">
      <div className="cs-pos-hd">
        <span className="cs-pos-hd__lbl">OPEN POSITION</span>
        {live && <span className="acct live">● LIVE</span>}
        {t.id && <span className="cs-pos-hd__meta">#{t.id}</span>}
        {grade !== "—" && <span className={"pill " + gradeTone}>{grade}</span>}
        {t.model && <span className="cs-pos-hd__meta">{t.model}</span>}
        <span className={"cs-pos-side" + (side === "long" ? "" : " short")}>{side.toUpperCase()}{qty ? ` ${qty}` : ""}</span>
      </div>

      <div className="cs-pos-hero">
        <span className="cs-pos-hero__sym">{sym}</span>
        <span className="cs-pos-hero__avg">avg {entry ?? "—"}</span>
        <span className={"cs-pos-hero__pnl " + (pnlCell.tone || "")}
              title={pnlCell.stale ? "broker read stale — last-known P&L, not live" : undefined}>
          {pnlCell.v}{pnlCell.stale ? <span className="cs-pnl-stale">STALE</span> : null}
        </span>
      </div>

      {showLifecycle && <OrderLifecycleTimeline timeline={timeline} onRecover={onRecover} />}
      {showLifecycle && <BrokerVsJournalPanel v={bvj} />}
      {showLifecycle && <SourceAgeChipsRow chips={ageChips} />}

      <TradeProgress side={side} entry={entry} stop={stop} tp1={tp1} price={livePrice} tp1Hit={t.tp1_hit} />

      <div className="cs-pos-tiles">
        <div className="cs-postile"><div className="cs-postile__k">RISK ON</div><div className="cs-postile__v">{dollarRisk != null ? "$" + dollarRisk : "—"}</div></div>
        <div className="cs-postile"><div className="cs-postile__k">→ TP1</div><div className={"cs-postile__v " + (grid.toTp1.tone || "")}>{grid.toTp1.v}</div></div>
        <div className="cs-postile"><div className="cs-postile__k">→ STOP</div><div className={"cs-postile__v " + (grid.toStop.tone || "")}>{grid.toStop.v}</div></div>
      </div>

      <div className="cs-pos-actions">
        <button className="cs-btn-flatten lg" onClick={mng("flatten", "FLATTEN")}>▣ FLATTEN</button>
        <button className={"cs-btn-be" + (t.tp1_hit ? " active" : "")} onClick={mng("moveStopToBE", "BE")}>⇲ BE</button>
        <button className="cs-btn-trail" onClick={mng("trail", "TRAIL")}>TRAIL</button>
        <span className="cs-pos-actions__hint">⌘K: “be” · “trail”</span>
      </div>
      {mngMsg && (
        <div className="cs-pos-fail" onClick={() => setMngMsg(null)}>⚠ {mngMsg} (tap to dismiss)</div>
      )}
      <div className="cs-pos-mng-note">
        {t.tp1_hit
          ? "Runner · no-trim — stop at break-even, trailing structurally to TP2 / structure-change exit."
          : "No-trim ride-the-trail — hold full size to TP1, then trail; never scaled."}
      </div>

      {latestBrain && (
        <div className="lv-box" style={{ marginTop: 12 }}>
          <div className="lv-box-hd">BRAIN · DETERMINISTIC</div>
          <div className="ai-prose">{walkerTruthToProse(latestBrain.truth)}</div>
        </div>
      )}
    </div>
  );
}

// ── ENTRY (verdict-first) — open-reaction verdict + entry model + 1m
// confirmation. Always structured; an in-card AI button runs a deeper read.
function EntryHuntView({ setup, lastBarPrice, chat, noTrade, noTradeReason, onAccept, onReject, openReaction, brief, session, symbol }) {
  const [showEv, setShowEv] = useState(false);
  const read = latestReadText(chat?.messages || []);
  const walkers = useWalkers();

  // ── no candidate: a clean feed of the latest brain read + why-no-trade ──
  if (!setup) {
    const ex = explainNoTradeReason(noTradeReason, { ltf: openReaction?.ltf, latest: openReaction?.latest });
    const sh = noTrade?.sourceHealth;
    const hunt = walkerHuntRows(walkers, lastBarPrice);
    return (
      <div className="cs-feed">
        {/* Hunt view (plan 2026-07-09 Task 2): what the chain is walking and
            what each walker waits for — instead of a blank stare. */}
        {hunt.length > 0 && (
          <div className="lv-box lv-hunt">
            <div className="lv-box-hd">WALKERS · {hunt.length}</div>
            {hunt.slice(0, 6).map((r) => (
              <div key={r.id} className="lv-hunt-row">
                <div className="lv-hunt-top">
                  <span className={"cs-dir " + (r.side === "long" ? "long" : "short")}>{r.side ?? "—"}</span>
                  <span className="lv-hunt-model">{r.model}</span>
                  <span className="lv-hunt-stage">{r.stageLabel}</span>
                  <span className="sp" />
                  <span className="lv-hunt-dist">{r.distText}</span>
                </div>
                <div className="lv-hunt-sub">
                  zone <span className="lv-hunt-zone">{r.zoneText}</span> · waiting for {r.waiting} · dies on <span className="lv-hunt-zone">{r.dies}</span>
                </div>
              </div>
            ))}
            {hunt.length > 6 ? <div className="lv-hunt-more">+{hunt.length - 6} more, further out</div> : null}
          </div>
        )}
        {read?.text && (
          <div className="cs-feed-row">
            <span className="cs-feed-row__ts">{read.t || ""}</span>
            <p className="cs-narr">{read.text}</p>
          </div>
        )}
        <div className="cs-feed-row">
          <span className="cs-feed-row__ts" />
          <div style={{ flex: 1 }}>
            <p className="cs-narr">{ex ? ex.text : (noTradeReason ? "No-trade — standing aside." : (hunt.length > 0 ? "Hunting — the chain advances on each bar close." : "No PD arrays being walked yet — the chain spawns walkers off a sweep + displacement into a fresh zone."))}</p>
            {ex?.sub ? <p className="cs-narr-sub">{ex.sub}</p> : null}
            {noTrade?.blockers?.length ? <p className="cs-narr-sub">blockers: {noTrade.blockers.join(", ")}</p> : null}
            {noTrade?.evidenceRefs?.length ? <p className="cs-narr-sub">evidence: {noTrade.evidenceRefs.join(", ")}</p> : null}
            {sh ? (
              <p className="cs-narr-sub">
                source: {sh.status || "unknown"}
                {sh.stale === true ? " · stale" : ""}
                {sh.schemaSupported === false ? " · unsupported schema" : ""}
                {sh.blockers?.length ? ` · ${sh.blockers.join(", ")}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ── candidate present: amber PROPOSED card in the feed ──
  const grade = setup.grade || "—";
  const side = (setup.side || "").toLowerCase();
  const sideText = (setup.side || "").toUpperCase();
  const confRows = pillar3ToConfirmationRows(selectPillar3(setup.pillar_breakdown));
  const confV = entryConfirmationVerdict(confRows);
  const mark = { pass: "✓", weak: "~", fail: "✗", missing: "·", pending: "·" };
  const stTxt = { pass: "yes", weak: "weak", fail: "fail", missing: "—", pending: "pending" };
  const gradeCls = grade === "A+" ? "a" : grade === "B" ? "b" : "c";

  return (
    <div className="cs-feed">
      <div className="cs-feed-row">
        <span className="cs-feed-row__ts">{read?.t || ""}</span>
        <div className="cs-prop-card">
          <div className="cs-prop-card__hd">
            <span className="cs-status proposed">PROPOSED · {sideText}</span>
            <span className="cs-tag muted">{modelLabel(setup)}</span>
            {grade !== "—" && <span className={"cs-grade " + gradeCls}>{grade}</span>}
            <span className="cs-evidence" {...clickable(() => setShowEv((v) => !v), { label: "toggle evidence" })}>evidence ›</span>
          </div>
          <div className="cs-levels">
            <span>E <span className="e">{setup.entry}</span></span>
            <span>S <span className="s">{setup.stop}</span></span>
            <span>T <span className="t">{setup.tp1}</span></span>
            {setup.rr ? <span>{setup.rr}</span> : null}
          </div>
          <div className="cs-prop-actions">
            <button className="cs-btn-accept" onClick={() => onAccept?.(setup)}>✓ ACCEPT</button>
            <button className="cs-btn-reject" onClick={() => onReject?.(setup)}>✗ REJECT</button>
            <span className="cs-prop-note">fires on next displacement</span>
          </div>
          {showEv && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={"pill " + confV.tone}>{confV.label}</span>
                <span style={{ color: "var(--label)", fontSize: 10 }}>{modelLabel(setup)} · {sideText} · {sizeLabel(setup.size)}</span>
              </div>
              {confRows.map((c) => (
                <div key={c.label} title={c.detail} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10 }}>
                  <span className={"mk " + c.status}>{mark[c.status] || "·"}</span>
                  <span style={{ flex: 1, color: "var(--label)" }}>{c.label}</span>
                  <span className={"st " + c.status}>{stTxt[c.status] || c.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {read?.text && (
        <div className="cs-feed-row">
          <span className="cs-feed-row__ts">{read.t || ""}</span>
          <p className="cs-narr">{read.text}</p>
        </div>
      )}
    </div>
  );
}

function BacktestRunningPlaceholder({ session }) {
  const sLabel = ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" })[session] ?? session ?? "";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--label)", gap: 10 }}>
      <div style={{ letterSpacing: "0.22em", fontSize: "12px" }}>BACKTEST RUNNING{sLabel ? ` · ${sLabel}` : ""}</div>
      <div style={{ fontSize: "10.5px", color: "var(--label-dim)" }}>LIVE DATA UNAVAILABLE — CHART IS IN REPLAY</div>
    </div>
  );
}

// Today's date (matches TopBar's guard-meter convention) for useFills.
const LIVE_TODAY = () => new Date().toISOString().slice(0, 10);

// NEXT-TURN detector strip (FEED only). The countdown is the seconds to the next
// 1m bar close — bars close on the minute and the chain fires on that close, so
// it's a real signal, not a fabricated ETA. Ticked locally so only this strip
// re-renders each second (never the live P&L above it).
function NextTurnStrip({ state, running, onToggle }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, []);
  const secs = 60 - (Math.floor(now / 1000) % 60);
  const val = running ? `bar close · ${secs}s` : state === "STALE" ? "detector stale" : "detector stopped";
  return (
    <div className="cs-nextturn">
      <span className="cs-nextturn__lbl">NEXT TURN</span>
      <span className={"cs-nextturn__val" + (running ? "" : " stopped")}>{val}</span>
      <span className={"cs-detector " + (running ? "stop" : "start")} {...clickable(onToggle, { label: running ? "stop detector" : "start detector" })}>
        {running ? "■ STOP DETECTOR" : "▶ START DETECTOR"}
      </span>
    </div>
  );
}

// SESSION GUARDS — one real budget bar (daily-loss vs the enforced dailyLimit) +
// plain counts for trades / consecutive losses. No fabricated "n/max" bars: the
// app enforces no max-trades / max-consec guard, so a ceiling would be a lie.
function SessionGuardsCard({ fills, guards }) {
  const b = liveGuardBudgets(fills, guards);
  const usd = (n) => Math.abs(n).toLocaleString("en-US");
  return (
    <div className="cs-guards">
      <div className="cs-guards__hd">SESSION GUARDS</div>
      <div>
        <div className="cs-guard-row">
          <span>Daily loss</span>
          <span className={"mono" + (b.dailyLoss.tripped ? " bad" : b.dailyLoss.pct >= 70 ? " warn" : "")}>
            −${usd(b.dailyLoss.used)}{b.dailyLoss.limit != null ? ` / −$${usd(b.dailyLoss.limit)}` : ""}
          </span>
        </div>
        {b.dailyLoss.limit != null && (
          <div className="cs-guard-track"><span className={"cs-guard-fill" + (b.dailyLoss.tripped ? " bad" : "")} style={{ width: `${b.dailyLoss.pct}%` }} /></div>
        )}
      </div>
      <div className="cs-guard-row"><span>Trades today</span><span className="mono">{b.trades}</span></div>
      <div className="cs-guard-row"><span>Consec. losses</span><span className={"mono" + (b.consecLosses >= 2 ? " warn" : "")}>{b.consecLosses}</span></div>
    </div>
  );
}

// TODAY'S FILLS — compact chips of the recorded fill tape (realized R / $).
function TodaysFillsCard({ fills }) {
  const chips = fillChips(fills);
  return (
    <div className="cs-fills">
      <div className="cs-fills__hd">TODAY'S FILLS</div>
      {chips.length
        ? chips.map((c, i) => (
            <span key={i} className="cs-fill-chip">{c.side}{c.qty ? ` ${c.qty}` : ""} · {c.r || c.usd || "—"}</span>
          ))
        : <span className="cs-fills__empty">No fills yet today.</span>}
    </div>
  );
}

function LiveFlatEmpty() {
  return (
    <div className="live-flat-empty cs-pos-flat">
      <div className="cs-pos-flat__t">FLAT — no open position</div>
      <div className="cs-pos-flat__s">⌘K → “long 2 mnq @ fvg” opens a ticket</div>
    </div>
  );
}

// ── LiveBody — the LIVE page (2026-07-03 Command Shell). One page, a segmented
// FEED | POSITIONS toggle (collapsing the old HUNT | TICKET | IN-TRADE tabs).
// FEED hosts the candidate hunt (+ the ticket sub-state on accept) and the
// detector strip; POSITIONS hosts the open-position card, session guards, and
// today's fills. Rendered inside `.bt-popover.embedded` so every existing LIVE
// style applies. Every order-flow handler is preserved verbatim.
function LiveBody({ guards, symbol, seg, setSeg, setUserPicked, orderIntent }) {
  // seg (effectiveSeg) + setSeg/setUserPicked are owned by LivePage, which renders
  // the FEED | POSITIONS toggle inline in the page header.
  const [ticketing, setTicketing] = useState(false); // ticket sub-state under FEED
  const [fireMsg, setFireMsg] = useState(null);
  const backtest = useBacktestRunning();
  const health = useHealth();
  const { activeTrade, accept } = useTrades();
  const { activeSetup, noTrade, noTradeReason } = useActiveSetup();
  const lastBar = useLastBar();
  const chat = useChat();
  const exec = useExecutionState();
  const { fills } = useFills(LIVE_TODAY());
  const { brief, session } = useSessionBrief();
  const openReaction = useOpenReaction(session);
  const { acct } = useBrokerAccount();
  const accountType = realAccountView(acct).type;

  const effectiveSeg = seg;

  // Snap to FEED when a fresh setup surfaces. Ref-guarded so it fires once per
  // setup id, never on unrelated re-renders.
  const lastSurfaced = useRef(null);
  useEffect(() => {
    const id = activeSetup?.id;
    if (id && id !== lastSurfaced.current) { lastSurfaced.current = id; setUserPicked(true); setSeg("feed"); setTicketing(false); }
    else if (!id) { lastSurfaced.current = null; }
  }, [activeSetup?.id]);

  const loopRunning = health?.loop === "healthy";
  const loopStale = health?.loop === "stale";
  const detState = loopRunning ? "RUNNING" : loopStale ? "STALE" : "STOPPED";
  const toggleDetector = async () => {
    try { if (loopRunning) await window.api?.detector?.stop?.(); else await window.api?.detector?.start?.(); } catch { /* best-effort */ }
  };

  const lastPrice = lastBar?.close;
  const ticketSetup = activeSetup;

  const onHuntAccept = () => { setUserPicked(true); setTicketing(true); };
  const onTicketFire = async (order) => {
    setFireMsg(null);
    try {
      if (ticketSetup) {
        const req = buildOrderRequest({ setup: ticketSetup, sizing: order.sizing, guards, account: accountType, symbol, type: order.type });
        // C4: thread the journal accept's decision_id into the order so the
        // order-intent chain and the journal trade share ONE exact join key
        // (the manual path used to derive two divergent ids → INTENT hop lost).
        const acc = await accept({ ...ticketSetup, symbol });
        const res = await executionAdapter.placeOrder({ ...req, decision_id: acc?.trade?.decision_id ?? null });
        if (!res?.ok) {
          const why = res?.blocked ? (res.code || res.reason || "blocked by guardrails")
            : (res?.error || res?.result?.body || "broker rejected the order");
          setFireMsg(`ORDER NOT PLACED — ${why}`);
          return;
        }
      }
    } catch (e) {
      setFireMsg(`ORDER NOT PLACED — ${String(e?.message || e)}`);
      return;
    }
    setUserPicked(true); setSeg("positions"); setTicketing(false);
  };

  let body;
  if (backtest.running) {
    body = <BacktestRunningPlaceholder session={backtest.session} />;
  } else if (effectiveSeg === "positions") {
    const guardTripped = liveGuardBudgets(fills, guards)?.dailyLoss?.tripped;
    body = (
      <div className="live-positions cs-positions">
        {guardTripped && (
          <div className="cs-guard-lock">
            <span className="cs-guard-lock__tag">LOCKED</span>
            <span className="cs-guard-lock__msg">Guard tripped — entries locked until tomorrow. FLATTEN stays live.</span>
          </div>
        )}
        {(exec.position || activeTrade)
          ? <InTradeView position={exec.position} trade={activeTrade} lastBar={lastBar} price={exec.price} symbol={symbol} workingOrders={exec.workingOrders}
                         brief={brief} session={session} exec={exec} orderIntent={orderIntent} health={health} />
          : <LiveFlatEmpty />}
        <SessionGuardsCard fills={fills} guards={guards} />
        <TodaysFillsCard fills={fills} />
      </div>
    );
  } else {
    body = (ticketing && ticketSetup)
      ? <TicketView setup={ticketSetup} account={accountType} guards={guards} symbol={symbol}
                    onFire={onTicketFire} onCancel={() => setTicketing(false)} />
      : <EntryHuntView setup={activeSetup} lastBarPrice={lastPrice} chat={chat}
                       noTrade={noTrade} noTradeReason={noTradeReason}
                       onAccept={onHuntAccept} onReject={() => setTicketing(false)}
                       openReaction={openReaction} brief={brief} session={session} symbol={symbol} />;
  }

  const showDetStrip = !backtest.running && effectiveSeg === "feed";

  return (
    <div className="bt-popover embedded">
      <div className="body">
        {!exec.connected && !exec.loading && (
          <div className="live-banner amber">⚠ PAPER TRADING NOT CONNECTED — connect it in TradingView to place orders</div>
        )}
        {fireMsg && (
          <div className="live-banner red" {...clickable(() => setFireMsg(null), { label: "dismiss error" })}>⚠ {fireMsg}</div>
        )}
        {showDetStrip && <NextTurnStrip state={detState} running={loopRunning} onToggle={toggleDetector} />}
        {body}
      </div>
    </div>
  );
}

export { LiveBody, TicketView, InTradeView, EntryHuntView };
