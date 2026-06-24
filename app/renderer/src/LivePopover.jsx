// LIVE workstation — v2 designer port (HUNT / TICKET / IN-TRADE / ADD).
// Faithful to ~/Downloads/Dashboard Location (4)/assets/pop-prep-live.jsx
// (LIVE section). MOCK swapped for real hooks; the order ticket sizes in $
// risk via Sizing.helpers.sizeOrder and fires through executionAdapter
// (currently a stub — no broker writes per CLAUDE.md #2 until the
// execution-engine spec lands). Tabs let the trader preview each view; the
// default view follows the data (activeTrade → IN-TRADE, else HUNT).

import React, { useState, useEffect, useRef } from "react";
import { clickable } from "./a11y.js";
import { useFloat } from "./hooks/useFloat.js";
import { Panel, Row } from "./Shared.jsx";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  modelLabel,
  normalizeSide,
  entryConfirmationVerdict,
} from "./Live.helpers.js";
import { stripCitations, openReactionVerdict } from "./Prep.helpers.js";
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
import { useSessionBrief } from "./hooks/useSessionBrief.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useAiAnalysis } from "./hooks/useAiAnalysis.js";

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

// ── AI · DEEPER READ — an on-demand button that lives INSIDE a card. The
// structured/computed view is always shown; click this only when you want a
// fresh in-depth analysis of the current moment. Re-run while open.
function AiDeepen({ symbol, session, brief, prompt }) {
  const ai = useAiAnalysis({ symbol, session, brief, prompt });
  const [open, setOpen] = useState(false);
  const start = () => { setOpen(true); ai.run(); };
  if (!open) {
    return (
      <button className="btn" style={{ marginTop: 12 }} onClick={start} title="run a deeper AI analysis of this">
        AI · DEEPER READ ▸
      </button>
    );
  }
  const tsLabel = ai.ts
    ? new Date(ai.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) + " ET"
    : null;
  return (
    <div className="lv-box" style={{ marginTop: 12 }}>
      <div className="lv-box-hd" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>AI · DEEPER READ{tsLabel ? ` · ${tsLabel}` : ""}</span>
        {ai.running
          ? <span className="pill dim">analyzing…</span>
          : <span className="pill interactive" onClick={ai.run}>RE-RUN</span>}
      </div>
      <div className="ai-prose">
        {ai.text || (ai.running ? "running a deeper read… (~a few seconds; costs a turn)" : "no read returned.")}
      </div>
    </div>
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
function InTradeView({ position, trade, lastBar, price, symbol, workingOrders, brief, session }) {
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
  const view = { side, entry, stop, tp1, tp2: t.tp2, r_realized: t.r_realized, tp1_hit: t.tp1_hit };
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
  const mng = (fn) => () => { try { executionAdapter[fn]({ symbol: position?.symbol || symbol, tradeId: t.id }); } catch { /* best-effort */ } };
  const deepenPrompt = `Live read of the open ${t.model || side} ${side} trade on ${sym} (entry ${entry} / stop ${stop} / TP1 ${tp1}). Per Lanto — is price respecting the setup, has it confirmed continuation toward the ultimate target, and should the runner trail or is structure breaking? Concise prose, no tool calls.`;
  return (
    <div className="work-scroll">
      <Panel title="IN-TRADE"
        right={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {live && <span className="acct live">● LIVE</span>}
          {t.id && <span style={{ color: "var(--value)", fontSize: 11 }}>#{t.id}</span>}
          <span className={"pill " + (side === "long" ? "green" : "red")}>{side.toUpperCase()}</span>
          {grade !== "—" && <span className={"pill " + gradeTone}>{grade}</span>}
          <span style={{ color: "var(--label)", fontSize: 10 }}>{sym}{qty ? ` · ${qty}c` : ""}{t.model ? ` · ${t.model}` : ""}</span>
        </span>}>

        <div className="live-grid">
          <div className="lcell"><span className="k">PRICE</span><span className={"v " + grid.price.tone}><Px v={grid.price.v} /></span><span className="sub">{grid.price.sub}</span></div>
          <div className="lcell"><span className="k">P&amp;L</span><span className={"v " + grid.pnl.tone}><Px v={grid.pnl.v} /></span><span className="sub">{grid.pnl.sub}</span></div>
          <div className="lcell"><span className="k">→ TP1</span><span className={"v " + grid.toTp1.tone}><Px v={grid.toTp1.v} /></span><span className="sub">{grid.toTp1.sub}</span></div>
          <div className="lcell"><span className="k">→ STOP</span><span className={"v " + grid.toStop.tone}><Px v={grid.toStop.v} /></span><span className="sub">{grid.toStop.sub}</span></div>
        </div>

        <div className="lv-box plan-rows">
          <div className="lv-box-hd">RISK PLAN</div>
          <div className="ai-prose" style={{ color: "var(--label)", marginBottom: 6, fontSize: 10 }}>T1 ≈ 1–1.5R · Ultimate ≈ 2R+ (HTF draw)</div>
          <Row k="Entry" v={<Px v={entry ?? "—"} />} />
          <Row k="Stop" v={<Px v={`${stop ?? "—"}${t.tp1_hit ? " · BE" : ""}`} tone="red" />} />
          <Row k="TP1" v={<Px v={tp1 ?? "—"} tone="green" />} />
          {t.tp2 != null && <Row k="TP2" v={<Px v={t.tp2} tone="green" />} />}
          <Row k="Size" v={<span>{qty != null ? `${qty}c` : "—"}{t.rr ? ` · ${t.rr}` : ""}{t.tp1_hit ? " · stop at BE" : ""}</span>} />
          {dollarRisk != null && <Row k="$ Risk" v={<Px v={"$" + dollarRisk} />} />}
        </div>

        <div className="lv-box">
          <div className="lv-box-hd">MANAGE POSITION</div>
          <div className="ai-prose" style={{ marginBottom: 8, color: "var(--label)" }}>
            {t.tp1_hit
              ? "Runner · no-trim — stop at break-even, trailing structurally to TP2 / structure-change exit."
              : "No-trim ride-the-trail — hold full size to TP1, then trail; never scaled."}
          </div>
          <div className="itbtns">
            <button className="itbtn flatten" onClick={mng("flatten")}>▣ FLATTEN</button>
            <button className="itbtn be" onClick={mng("moveStopToBE")}>⇲ BE</button>
          </div>
          <div className="itbtns-sec">
            <button className="itbtn-sec" onClick={mng("trail")}>TRAIL</button>
            <button className="itbtn-sec" onClick={mng("cancel")}>CANCEL</button>
          </div>
        </div>

        {latestBrain && (
          <div className="lv-box">
            <div className="lv-box-hd">BRAIN · DETERMINISTIC</div>
            <div className="ai-prose">{walkerTruthToProse(latestBrain.truth)}</div>
          </div>
        )}
        <AiDeepen symbol={sym} session={session} brief={brief} prompt={deepenPrompt} />
      </Panel>
    </div>
  );
}

// ── ENTRY (verdict-first) — open-reaction verdict + entry model + 1m
// confirmation. Always structured; an in-card AI button runs a deeper read.
function EntryHuntView({ setup, lastBarPrice, chat, noTrade, noTradeReason, onAccept, onReject, openReaction, brief, session, symbol }) {
  const read = latestReadText(chat?.messages || []);
  const orPanel = <LiveOpenReactionPanel latest={openReaction?.latest} brief={brief} ltf={openReaction?.ltf} />;

  if (!setup) {
    const prose = { color: "var(--prose)", fontSize: 11, lineHeight: 1.55, overflowWrap: "anywhere", wordBreak: "break-word" };
    const sh = noTrade?.sourceHealth;
    const deepenPrompt = `Live read of ${symbol || "the lead symbol"}${session ? `, ${session.toUpperCase()}` : ""}: no setup is surfaced yet. Per Lanto — what is price doing right now (displacement vs consolidation), is the open-reaction bias confirming, and what would the next clean MSS / Trend / Inversion entry need? Concise prose, no tool calls.`;
    return (
      <div className="work-scroll">
        {orPanel}
        <Panel title="ENTRY CANDIDATE" right={<span className="pill dim">{noTradeReason ? "no-trade" : "waiting"}</span>}>
            <div className="lv-box" style={{ marginTop: 0 }}>
              <div className="lv-box-hd">{noTradeReason ? "NO-TRADE REASON" : "STATUS"}</div>
              <div style={prose}>{noTradeReason || "awaiting next walker fire."}</div>
            </div>
            {noTrade?.blockers?.length ? (
              <div className="lv-box" style={{ marginTop: 10 }}>
                <div className="lv-box-hd">NO-TRADE BLOCKERS</div>
                <div style={prose}>{noTrade.blockers.join(", ")}</div>
              </div>
            ) : null}
            {sh ? (
              <div className="lv-box" style={{ marginTop: 10 }}>
                <div className="lv-box-hd">SOURCE HEALTH</div>
                <div style={prose}>
                  {sh.status || "unknown"}
                  {sh.stale === true ? " · stale" : ""}
                  {sh.schemaSupported === false ? " · unsupported schema" : ""}
                  {sh.blockers?.length ? ` · ${sh.blockers.join(", ")}` : ""}
                </div>
              </div>
            ) : null}
            {noTrade?.strategyChainStatus || noTrade?.evaluationStatus ? (
              <div className="lv-box" style={{ marginTop: 10 }}>
                <div className="lv-box-hd">EVALUATION STATUS</div>
                <div style={prose}>
                  {noTradeStatusLabel(noTrade)}
                  {noTrade.evaluationStatus ? ` · ${noTrade.evaluationStatus}` : ""}
                  {noTrade.strategyChainStatus ? ` · chain ${noTrade.strategyChainStatus}` : ""}
                </div>
              </div>
            ) : null}
            {noTrade?.evidenceRefs?.length ? (
              <div className="lv-box" style={{ marginTop: 10 }}>
                <div className="lv-box-hd">EVIDENCE REFS</div>
                <div style={prose}>{noTrade.evidenceRefs.join(", ")}</div>
              </div>
            ) : null}
            {read?.text && (
              <div className="lv-box" style={{ marginTop: 10 }}>
                <div className="lv-box-hd">BRAIN READ {read.t ? `· ${read.t}` : ""}</div>
                <div className="ai-prose">{read.text}</div>
              </div>
            )}
            <AiDeepen symbol={symbol} session={session} brief={brief} prompt={deepenPrompt} />
        </Panel>
      </div>
    );
  }

  const grade = setup.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  const side = (setup.side || "").toLowerCase();
  const price = Number.isFinite(lastBarPrice) ? lastBarPrice : Number(setup.entry);
  const fmtD = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(1);
  // Build the rungs then order top→bottom by price (correct for long AND short).
  const rungs = [
    { tag: "TP2", cls: "tp", px: Number(setup.tp2) },
    { tag: "TP1", cls: "tp", px: Number(setup.tp1) },
    { tag: "NOW", cls: "now wait", px: price, now: true },
    { tag: "ENTRY", cls: "entry", px: Number(setup.entry) },
    { tag: "STOP", cls: "stop", px: Number(setup.stop) },
  ].filter((r) => Number.isFinite(r.px)).sort((a, b) => b.px - a.px);
  const confRows = pillar3ToConfirmationRows(selectPillar3(setup.pillar_breakdown));
  const confV = entryConfirmationVerdict(confRows);
  const mark = { pass: "✓", weak: "~", fail: "✗", missing: "·", pending: "·" };
  const stTxt = { pass: "yes", weak: "weak", fail: "fail", missing: "—", pending: "pending" };
  const deepenPrompt = `Live read of the ${modelLabel(setup)} ${side} setup on ${symbol || "the lead symbol"}${session ? `, ${session.toUpperCase()}` : ""} (entry ${setup.entry} / stop ${setup.stop} / TP1 ${setup.tp1}). Per Lanto — did it take significant liquidity, is displacement clean, is the 1m confirmation deliberate (not wicky), and is it aligned with the open-reaction bias? What invalidates it? Concise prose, no tool calls.`;

  return (
    <div className="work-scroll">
      {orPanel}
      <Panel title="ENTRY"
        right={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span className={"pill " + (side === "long" ? "green" : "red")}>{(setup.side || "").toUpperCase()}</span>
          <span className={"pill " + gradeTone}>{grade}</span>
          <span style={{ color: "var(--label)", fontSize: 10 }}>{modelLabel(setup)}</span>
        </span>}>
          <div className="lv-box" style={{ marginTop: 0 }}>
            <div className="lv-box-hd">CONFIRMATION</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={"pill " + confV.tone}>{confV.label}</span>
              <span style={{ color: "var(--label)", fontSize: 11 }}>{modelLabel(setup)} · {(setup.side || "").toUpperCase()}</span>
            </div>
          </div>
          <div className="intrade-cols">
            <div className="vlad hunt">
              {rungs.map((r) => (
                <div key={r.tag} className={"rung " + r.cls}>
                  <span className="tag">{r.tag}</span>
                  <span className="px"><Px v={r.now ? r.px.toFixed(2) : r.px} /></span>
                  <span className="dist">{r.now ? "now" : fmtD(r.px - price)}</span>
                </div>
              ))}
            </div>
            <div className="side">
              <div className="conf">
                {confRows.map((c) => (
                  <div className="citem" key={c.label} title={c.detail}>
                    <span className={"mk " + c.status}>{mark[c.status] || "·"}</span>
                    <span className="lbl">{c.label}</span>
                    <span className={"st " + c.status}>{stTxt[c.status] || c.status}</span>
                  </div>
                ))}
              </div>
              <div className="conf-foot">
                <div className="mtile"><span className="k">R : R</span><span className="v">{setup.rr ?? "—"}</span></div>
                <div className="mtile"><span className="k">SIZE</span><span className="v">{sizeLabel(setup.size)}</span></div>
              </div>
            </div>
          </div>
          <div className="lv-box" style={{ marginTop: 12 }}>
            <div className="lv-box-hd">ACTIONS</div>
            <div style={{ display: "flex", justifyContent: "flex-start", gap: 6 }}>
              <button className="btn red" onClick={() => onReject?.(setup)}>REJECT</button>
              <button className="btn green" onClick={() => onAccept?.(setup)}>ACCEPT</button>
            </div>
          </div>
          {read?.text && (
            <div className="lv-box" style={{ marginTop: 10 }}>
              <div className="lv-box-hd">BRAIN READ {read.t ? `· ${read.t}` : ""}</div>
              <div className="ai-prose">{read.text}</div>
            </div>
          )}
          <AiDeepen symbol={symbol} session={session} brief={brief} prompt={deepenPrompt} />
        </Panel>
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

// ── LiveCell — topbar cell + 660px tabbed popover ────────────────────────
function LiveCell({ guards, symbol }) {
  const [open, setOpen] = useState(false);
  const float = useFloat();
  const [view, setView] = useState("hunt");   // hunt | ticket | intrade
  const [userPickedView, setUserPickedView] = useState(false);
  const [fireMsg, setFireMsg] = useState(null);   // placement failure banner

  const backtest = useBacktestRunning();
  const health = useHealth();
  const { activeTrade, accept } = useTrades();
  const { activeSetup, noTrade, noTradeReason } = useActiveSetup();
  const lastBar = useLastBar();
  const chat = useChat();
  const exec = useExecutionState();
  const { brief, session } = useSessionBrief();
  const openReaction = useOpenReaction(session);
  // Real account orders route to (paper/live) — for the ticket badge + journal
  // metadata. Routing itself is enforced main-side by the confirmed account.
  const { acct } = useBrokerAccount();
  const accountType = realAccountView(acct).type;

  // Default view follows the data unless the user clicked a tab this session.
  // A live broker position (execution feed) OR a journal trade → IN-TRADE.
  const hasPosition = !!exec.position || !!activeTrade;
  const dataView = hasPosition ? "intrade" : "hunt";
  const effectiveView = userPickedView ? view : dataView;

  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.which === "live") setOpen((o) => !o);
      if (e.detail?.which === "all-close") setOpen(false);
    };
    window.addEventListener("topbar:open-cell", onOpen);
    return () => window.removeEventListener("topbar:open-cell", onOpen);
  }, []);

  // Auto-open the popover the moment a NEW setup surfaces, so the trader can
  // confirm/reject it without hunting for the cell. Keyed on the setup id so it
  // fires once per surface (not every render); resets when the setup clears so a
  // re-surface re-opens. Forces the HUNT view, where accept/reject lives.
  const lastSurfacedId = useRef(null);
  useEffect(() => {
    const id = activeSetup?.id;
    if (id && id !== lastSurfacedId.current) {
      lastSurfacedId.current = id;
      setOpen(true);
      setUserPickedView(true);
      setView("hunt");
    } else if (!id) {
      lastSurfacedId.current = null;
    }
  }, [activeSetup?.id]);

  // Cell badge: green/red P&L when in a position (live broker or journal),
  // amber HUNT when hunting, else dim.
  let badge;
  if (exec.position || activeTrade) {
    const src = exec.position
      ? { entry: exec.position.avgFill, stop: exec.position.sl, tp1: exec.position.tp, side: normalizeSide(exec.position.side) || "long" }
      : activeTrade;
    const badgePrice = (typeof exec.price === "number" && Number.isFinite(exec.price)) ? exec.price : lastBar?.close;
    const pnl = liveGridFromTrade(src, badgePrice)?.pnl;
    const cls = pnl?.tone === "red" ? "red" : "green";
    badge = (<><span className={"pulse " + cls} /><span className={"pnl " + cls}>{pnl?.v ?? "—"}</span></>);
  } else if (activeSetup) {
    badge = (<><span className="pulse" /><span className="state amber">HUNT</span></>);
  } else {
    badge = (<span className="dot dim" />);
  }

  const loopRunning = health?.loop === "healthy";
  const loopStale = health?.loop === "stale";
  const detText = loopRunning ? "RUNNING" : loopStale ? "STALE" : "STOPPED";
  const toggleDetector = async () => {
    try { if (loopRunning) await window.api?.detector?.stop?.(); else await window.api?.detector?.start?.(); } catch { /* best-effort */ }
  };

  const pickView = (v) => {
    setUserPickedView(true);
    setView(v);
  };

  const lastPrice = lastBar?.close;
  const ticketSetup = activeSetup;
  const TABS = [["hunt", "HUNT"], ["ticket", "TICKET"], ["intrade", "IN-TRADE"]];

  // Accept from HUNT → size in TICKET; fire in TICKET → real accept + order → IN-TRADE.
  // One position at a time (scale-in removed 2026-06-23).
  const onHuntAccept = () => { setUserPickedView(true); setView("ticket"); };
  const onTicketFire = async (order) => {
    setFireMsg(null);
    try {
      if (ticketSetup) {
        const req = buildOrderRequest({
          setup: ticketSetup, sizing: order.sizing, guards, account: accountType, symbol, type: order.type,
        });
        await accept({ ...ticketSetup, symbol });
        const res = await executionAdapter.placeOrder(req);
        // Surface a failed/blocked placement instead of silently advancing to
        // IN-TRADE — otherwise a rejected order looks like a live trade.
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
    setUserPickedView(true); setView("intrade");
  };

  let body;
  if (backtest.running) {
    body = <BacktestRunningPlaceholder session={backtest.session} />;
  } else if (effectiveView === "intrade") {
    body = (exec.position || activeTrade)
      ? <InTradeView position={exec.position} trade={activeTrade} lastBar={lastBar} price={exec.price} symbol={symbol} workingOrders={exec.workingOrders}
                     brief={brief} session={session} />
      : <div className="stub" style={{ padding: 20, color: "var(--label)" }}>[ no active position ]</div>;
  } else if (effectiveView === "ticket") {
    body = ticketSetup
      ? <TicketView setup={ticketSetup} account={accountType} guards={guards} symbol={symbol}
                    onFire={onTicketFire} onCancel={() => pickView("hunt")} />
      : <div className="stub" style={{ padding: 20, color: "var(--label)" }}>[ no candidate to ticket ]</div>;
  } else {
    body = <EntryHuntView setup={activeSetup} lastBarPrice={lastPrice} chat={chat}
                          noTrade={noTrade} noTradeReason={noTradeReason}
                          onAccept={onHuntAccept} onReject={() => pickView("hunt")}
                          openReaction={openReaction} brief={brief} session={session} symbol={symbol} />;
  }

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} {...clickable((e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); })}>
      <span className="k">LIVE</span>
      {badge}
      {open && (
        <div className={"bt-popover w-660" + float.popoverClass} style={float.popoverStyle} onClick={(e) => e.stopPropagation()}>
          <div className="head live-head" onMouseDown={float.onDragStart}>
            <span className="t">LIVE</span>
            <span className="det">
              <i className="dot" />
              <span className="lbl">DETECTOR</span>
              <span className={"run" + (loopRunning ? "" : loopStale ? " warn" : " off")}>{detText}</span>
              <span className="stop" onClick={toggleDetector}>{loopRunning ? "STOP" : "START"}</span>
            </span>
            <span className="spacer" style={{ flex: 1 }} />
            <div className="live-tabs">
              {TABS.map(([v, l]) => (
                <span key={v} className={"tab" + (effectiveView === v ? " on" : "")} onClick={() => pickView(v)}>{l}</span>
              ))}
            </div>
            <span className={"float-btn" + (float.floating ? " on" : "")}
                  title={float.floating ? "Dock window" : "Float — move & resize freely"}
                  onClick={float.toggle}>⛶</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            {!exec.connected && !exec.loading && (
              <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)",
                            color: "var(--amber)", fontSize: 10.5, letterSpacing: ".14em" }}>
                ⚠ PAPER TRADING NOT CONNECTED — connect it in TradingView to place orders
              </div>
            )}
            {fireMsg && (
              <div onClick={() => setFireMsg(null)} style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)",
                            background: "var(--surface-2)", color: "var(--red)", fontSize: 10.5, letterSpacing: ".14em", cursor: "pointer" }}>
                ⚠ {fireMsg}
              </div>
            )}
            {body}
          </div>
        </div>
      )}
    </div>
  );
}

export { LiveCell, TicketView, InTradeView, EntryHuntView };
// Legacy alias kept for any importer expecting LiveWorkstation.
export { LiveCell as LiveWorkstation };
