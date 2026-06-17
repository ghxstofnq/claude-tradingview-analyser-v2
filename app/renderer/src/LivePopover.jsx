// LIVE workstation — v2 designer port (HUNT / TICKET / IN-TRADE / ADD).
// Faithful to ~/Downloads/Dashboard Location (4)/assets/pop-prep-live.jsx
// (LIVE section). MOCK swapped for real hooks; the order ticket sizes in $
// risk via Sizing.helpers.sizeOrder and fires through executionAdapter
// (currently a stub — no broker writes per CLAUDE.md #2 until the
// execution-engine spec lands). Tabs let the trader preview each view; the
// default view follows the data (activeTrade → IN-TRADE, else HUNT).

import React, { useState, useEffect } from "react";
import { Panel, Row } from "./Shared.jsx";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
  deriveAddCandidate,
  trancheStackFromState,
  normalizeSide,
} from "./Live.helpers.js";
import { stripCitations } from "./Prep.helpers.js";
import { sizeOrder } from "./Sizing.helpers.js";
import { executionAdapter } from "./execution/executionAdapter.js";
import { buildOrderRequest } from "./execution/orderRequest.js";
import { useTrades } from "./hooks/useTrades.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { noTradeStatusLabel } from "./hooks/useActiveSetup.helpers.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useHealth } from "./hooks/useHealth.js";
import { useChat } from "./hooks/useChat.js";
import { useWalkers } from "./hooks/useWalkers.js";
import { useBacktestRunning } from "./hooks/useBacktest.js";
import { useExecutionState } from "./hooks/useExecutionState.js";

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

// ── WALKER STATUS (engine state above the candidate) ─────────────────────
function WalkerStatusPanel({ walkers }) {
  if (!walkers || walkers.length === 0) return null;
  return (
    <div style={{ background: "var(--surface-0)", border: "1px solid var(--border-d)", padding: "12px 14px", marginBottom: 10 }}>
      <div style={{ color: "var(--label-dim)", fontSize: 9, letterSpacing: ".24em", marginBottom: 10 }}>WALKER STATUS</div>
      {walkers.map((w) => {
        const ageM = w.last_advanced_at ? Math.round((Date.now() - w.last_advanced_at) / 60000) : null;
        return (
          <div key={w.id} style={{ fontSize: 10.5, marginBottom: 6 }}>
            <div style={{ color: "var(--value)" }}>{w.panel_id} · {w.model} · {w.variant} · {(w.size_multiplier ?? 1).toFixed(1)}× size</div>
            <div style={{ color: "var(--label-dim)" }}>▸ {w.stage}{ageM != null ? ` (${ageM}m)` : ""}</div>
            {w.displacement_fvg && (
              <div style={{ color: "var(--label)" }}>
                watching FVG {w.displacement_fvg.low}–{w.displacement_fvg.high}
                {w.hypothetical_r_to_stop != null ? ` · R-to-stop ${w.hypothetical_r_to_stop}` : ""}
                {w.hypothetical_r_to_tp1 != null ? ` · R-to-TP1 ${w.hypothetical_r_to_tp1}` : ""}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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

// ── ORDER TICKET — type $ risk → computed micros → accepting fires ───────
function TicketView({ setup, isAdd, account, guards, symbol, tradeId, onFire, onCancel }) {
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
  else if (!sized.withinTolerance || contracts < 1) block = { code: "SIZE MISMATCH", msg: `No whole micro count lands within $50 of $${risk}. Adjust the $ risk.` };

  const fire = () => {
    if (block) return;
    saveRisk(risk);
    onFire({ type, riskUsd: risk, sizing: sized });
  };
  const sideCls = setup.side === "long" ? "l" : "s";

  return (
    <div className="work-scroll">
      <Panel title={isAdd ? "ADD TICKET" : "ORDER TICKET"}
        right={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {isAdd && <span className="add-badge">ADD</span>}
          <span className={"pill " + (setup.side === "long" ? "green" : "red")}>{setup.side.toUpperCase()}</span>
          <span style={{ color: "var(--label)", fontSize: 10 }}>{setup.model}</span>
        </span>}>

        <div className="ticket-banner">
          <span className={"side " + sideCls}>{setup.side.toUpperCase()}</span>
          <span className="model">{setup.model}</span>
          <span>{symbol} · {type === "market" ? "MARKET" : "LIMIT"}</span>
          <span className="spacer" />
          {isAdd && tradeId && <span style={{ color: "var(--amber)", fontSize: 9, letterSpacing: ".14em" }}>ADDS TO #{tradeId}</span>}
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
          <button className={"tk-fire" + (isAdd ? " add" : "")} onClick={fire}>
            ▸ ACCEPT — {isAdd ? `ADD ${contracts}c TO #${tradeId}` : `SENDS ${type.toUpperCase()} ORDER`}
          </button>
        )}
        <button className="tk-cancel" onClick={onCancel}>CANCEL · BACK</button>
      </Panel>
    </div>
  );
}

// ── IN-TRADE — live grid + risk plan + manage + brain ───────────────────
function InTradeView({ position, trade, tranches, lastBar, price, chat, symbol, addCandidate, onAdd }) {
  // The live broker position (from execution.state / trading WS) is the source
  // of truth for entry/stop/tp/side/qty; the journal trade supplies model /
  // grade / id metadata when present.
  const t = trade || {};
  const live = !!position;
  const side = (position ? normalizeSide(position.side) : null) || t.side || "long";
  const entry = position?.avgFill ?? t.entry;
  const stop = position?.sl ?? t.stop;
  const tp1 = position?.tp ?? t.tp1;
  const qty = position?.qty ?? t.size?.contracts ?? null;
  const sym = String(position?.symbol || symbol || "").replace("CME_MINI:", "");
  const view = { side, entry, stop, tp1, tp2: t.tp2, r_realized: t.r_realized, tp1_hit: t.tp1_hit };
  const livePrice = (typeof price === "number" && Number.isFinite(price)) ? price : lastBar?.close;
  const grid = liveGridFromTrade(view, livePrice);
  const barRead = latestBarReadMessage(chat?.messages || []);
  const grade = t.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  const pointValue = pointValueFor(sym);
  const dollarRisk = (entry != null && stop != null && qty != null)
    ? (Math.abs(entry - stop) * pointValue * qty).toFixed(0)
    : null;
  const mng = (fn) => () => { try { executionAdapter[fn]({ symbol: position?.symbol || symbol, tradeId: t.id }); } catch { /* best-effort */ } };
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

        {Array.isArray(tranches) && tranches.length > 1 && (
          <div className="lv-box">
            <div className="lv-box-hd">TRANCHE STACK · {tranches.length}</div>
            {tranches.map((tr) => (
              <Row key={tr.id}
                k={<span>{tr.role === "anchor" ? "ANCHOR" : `ADD ${tr.seq}`} · #{tr.id}</span>}
                v={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <span className={"pill " + (tr.grade === "A+" ? "green" : tr.grade === "B" ? "amber" : "dim")}>{tr.grade}</span>
                  <Px v={tr.entry} />
                  <span className={tr.tone}>{tr.r}</span>
                </span>} />
            ))}
          </div>
        )}

        <div className="lv-box plan-rows">
          <div className="lv-box-hd">RISK PLAN</div>
          <Row k="Entry" v={<Px v={entry ?? "—"} />} />
          <Row k="Stop" v={<Px v={`${stop ?? "—"}${t.tp1_hit ? " · BE" : ""}`} tone="red" />} />
          <Row k="TP1" v={<Px v={tp1 ?? "—"} tone="green" />} />
          {t.tp2 != null && <Row k="TP2" v={<Px v={t.tp2} tone="green" />} />}
          <Row k="Size" v={<span>{qty != null ? `${qty}c` : "—"}{t.rr ? ` · ${t.rr}` : ""}{t.tp1_hit ? " · stop at BE" : ""}</span>} />
          {dollarRisk != null && <Row k="$ Risk" v={<Px v={"$" + dollarRisk} />} />}
        </div>

        <div className="lv-box">
          <div className="lv-box-hd">MANAGE POSITION</div>
          <div className="itbtns">
            <button className="itbtn flatten" onClick={mng("flatten")}>▣ FLATTEN</button>
            <button className="itbtn be" onClick={mng("moveStopToBE")}>⇲ BE</button>
          </div>
          <button className="panic" onClick={mng("panic")}>PANIC — FLATTEN ALL</button>
          <div className="itbtns-sec">
            <button className="itbtn-sec" onClick={mng("trail")}>TRAIL</button>
            <button className="itbtn-sec" onClick={mng("cancel")}>CANCEL</button>
          </div>
        </div>

        {addCandidate && (
          <div className="lv-box">
            <div className="scale-note" style={{ margin: 0 }}><span className="add-badge">ADD</span> {sizeLabel(addCandidate.size)} scale-in surfaced — review to add to #{trade.id}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <button className="btn amber" onClick={onAdd}>▸ REVIEW ADD CARD</button>
            </div>
          </div>
        )}

        {barRead && (
          <div className="lv-box">
            <div className="lv-box-hd">BRAIN · NARRATION</div>
            <div className="ai-prose"><span dangerouslySetInnerHTML={{ __html: barRead.body }} /></div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── ENTRY HUNT (and ADD) — vladder + confirmation + brain read ──────────
function EntryHuntView({ setup, isAdd, tradeId, lastBarPrice, walkers, chat, noTrade, noTradeReason, onAccept, onReject }) {
  const read = latestReadText(chat?.messages || []);
  if (!setup) {
    const prose = { color: "var(--prose)", fontSize: 11, lineHeight: 1.55, overflowWrap: "anywhere", wordBreak: "break-word" };
    const sh = noTrade?.sourceHealth;
    return (
      <div className="work-scroll">
        {!isAdd && <WalkerStatusPanel walkers={walkers} />}
        <Panel title={isAdd ? "ADD CANDIDATE" : "ENTRY CANDIDATE"} right={<span className="pill dim">{noTradeReason ? "no-trade" : "waiting"}</span>}>
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
        </Panel>
      </div>
    );
  }
  const grade = setup.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
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
  const mark = { pass: "✓", weak: "~", fail: "✗", missing: "·", pending: "·" };
  const stTxt = { pass: "yes", weak: "weak", fail: "fail", missing: "—", pending: "pending" };
  return (
    <div className="work-scroll">
      {!isAdd && <WalkerStatusPanel walkers={walkers} />}
      <Panel title={isAdd ? "ADD CANDIDATE" : "ENTRY CANDIDATE"}
        right={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          {isAdd && <span className="add-badge">ADD</span>}
          <span className={"pill " + (setup.side === "long" ? "green" : "red")}>{(setup.side || "").toUpperCase()}</span>
          <span className={"pill " + gradeTone}>{grade}</span>
          <span style={{ color: "var(--label)", fontSize: 10 }}>{setup.model}</span>
        </span>}>
        {isAdd && tradeId && <div className="scale-note"><span className="add-badge">ADD</span> SCALE-IN · adds to #{tradeId} — not a new position</div>}
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
function LiveCell({ account, guards, symbol }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("hunt");   // hunt | ticket | intrade | add
  const [ticketAdd, setTicketAdd] = useState(false);
  const [userPickedView, setUserPickedView] = useState(false);

  const backtest = useBacktestRunning();
  const health = useHealth();
  const { trades, activeTrade, accept } = useTrades();
  const { activeSetup, noTrade, noTradeReason } = useActiveSetup();
  const lastBar = useLastBar();
  const chat = useChat();
  const walkers = useWalkers();
  const exec = useExecutionState();

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
    if (v === "ticket") setTicketAdd(false);
    setUserPickedView(true);
    setView(v);
  };

  const lastPrice = lastBar?.close;
  // Scale-in: a same-side live candidate onto a green-lit open position.
  const addCandidate = deriveAddCandidate({
    position: exec.position,
    anchor: activeTrade,   // journal anchor carries greenlight_ref (auto-parity)
    activeSetup,
    price: (typeof exec.price === "number" && Number.isFinite(exec.price)) ? exec.price : lastPrice,
  });
  const ticketSetup = ticketAdd ? addCandidate : activeSetup;
  // Open tranches (anchor + adds) for the IN-TRADE stack — each is its own
  // journal trade on a netting account.
  const trancheRows = trancheStackFromState(
    Object.values(trades || {}),
    (typeof exec.price === "number" && Number.isFinite(exec.price)) ? exec.price : lastPrice,
  );
  const TABS = [["hunt", "HUNT"], ["ticket", "TICKET"], ["intrade", "IN-TRADE"], ["add", "ADD"]];

  // Accept from HUNT → size in TICKET; fire in TICKET → real accept + (stub) order → IN-TRADE.
  const onHuntAccept = () => { setTicketAdd(false); setUserPickedView(true); setView("ticket"); };
  const onTicketFire = async (order) => {
    try {
      if (ticketSetup) {
        const req = buildOrderRequest({
          setup: ticketSetup, sizing: order.sizing, guards, account, symbol, type: order.type,
        });
        if (ticketAdd) {
          // Scale-in: open the add as its OWN standalone tranche (own stop +
          // target), not an average-in. The main-process tranche path journals
          // the accept (tagged add) and lays the bracket; exits are managed by
          // the outcome ticker like any tranche.
          executionAdapter.openTranche({ ...ticketSetup, symbol, tranche_role: "add" });
        } else {
          await accept(ticketSetup);
          executionAdapter.placeOrder(req);
        }
      }
    } catch { /* best-effort */ }
    setTicketAdd(false); setUserPickedView(true); setView("intrade");
  };

  let body;
  if (backtest.running) {
    body = <BacktestRunningPlaceholder session={backtest.session} />;
  } else if (effectiveView === "intrade") {
    body = (exec.position || activeTrade)
      ? <InTradeView position={exec.position} trade={activeTrade} tranches={trancheRows} lastBar={lastBar} price={exec.price} chat={chat} symbol={symbol} addCandidate={addCandidate} onAdd={() => pickView("add")} />
      : <div className="stub" style={{ padding: 20, color: "var(--label)" }}>[ no active position ]</div>;
  } else if (effectiveView === "ticket") {
    body = ticketSetup
      ? <TicketView setup={ticketSetup} isAdd={ticketAdd} account={account} guards={guards} symbol={symbol}
                    tradeId={activeTrade?.id} onFire={onTicketFire} onCancel={() => pickView(ticketAdd ? "add" : "hunt")} />
      : <div className="stub" style={{ padding: 20, color: "var(--label)" }}>[ no candidate to ticket ]</div>;
  } else if (effectiveView === "add") {
    body = <EntryHuntView setup={addCandidate} isAdd tradeId={activeTrade?.id} lastBarPrice={lastPrice}
                          walkers={walkers} chat={chat}
                          noTrade={!addCandidate} noTradeReason={addCandidate ? undefined : "no scale-in candidate yet"}
                          onAccept={() => { setTicketAdd(true); setUserPickedView(true); setView("ticket"); }}
                          onReject={() => pickView("intrade")} />;
  } else {
    body = <EntryHuntView setup={activeSetup} lastBarPrice={lastPrice} walkers={walkers} chat={chat}
                          noTrade={noTrade} noTradeReason={noTradeReason}
                          onAccept={onHuntAccept} onReject={() => pickView("hunt")} />;
  }

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} onClick={(e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); }}>
      <span className="k">LIVE</span>
      {badge}
      {open && (
        <div className="bt-popover w-660" onClick={(e) => e.stopPropagation()}>
          <div className="head live-head">
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
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            {!exec.connected && !exec.loading && (
              <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)",
                            color: "var(--amber)", fontSize: 10.5, letterSpacing: ".14em" }}>
                ⚠ PAPER TRADING NOT CONNECTED — connect it in TradingView to place orders
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
