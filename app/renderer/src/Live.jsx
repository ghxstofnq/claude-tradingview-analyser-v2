// LIVE mode workstation — Claude conversation + setups/trades rail.
// Three sub-states routed by data: OpenReaction / EntryHunt / InTrade.

import React, { useState as useStateL, useEffect as useEffectL, useRef as useRefL } from "react";
import { Panel, Row, Grade, PillarsPanel, SetupCard, ClaudeFeed, SectionHead, LiveCell } from "./Shared.jsx";
import { useChat } from "./hooks/useChat.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { useTrades } from "./hooks/useTrades.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useSetupsHistory } from "./hooks/useSetupsHistory.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useSessionBrief } from "./hooks/useSessionBrief.js";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
} from "./Live.helpers.js";

const BIAS_TONE = { bullish: "green", bearish: "red", mixed: "amber", unclear: "amber" };

// #27 Dynamic session label — was hardcoded "1m · NY AM" even during
// PM and London. Derive from ET clock.
function sessionLabel() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return "1m · CLOSED";
  const m = Number(get("hour")) * 60 + Number(get("minute"));
  if (m >= 9 * 60 + 30 && m < 12 * 60) return "1m · NY AM";
  if (m >= 13 * 60 && m < 16 * 60) return "1m · NY PM";
  if (m >= 3 * 60 && m < 6 * 60) return "1m · LONDON";
  return "1m · INTER-SESSION";
}

function OpenReactionTracker() {
  const { reads, latest } = useOpenReaction();
  const minutesIn = latest?.minutes_into_phase ?? 0;
  const left = Math.max(0, 15 - minutesIn);

  if (!latest) {
    return (
      <Panel title="STEP 4 · NY OPEN LTF BIAS · waiting for first read">
        <div style={{ color: "var(--label)", fontSize: 11.5, lineHeight: 1.55 }}>
          Claude will post the first open-reaction read after the next bar close.
          Each read covers: what NY just did, the bias direction forming, and what
          level will resolve it. Latest read at top, prior reads below.
        </div>
      </Panel>
    );
  }

  return (
    <>
      <Panel title="STEP 4 · NY OPEN LTF BIAS"
             right={`+${minutesIn}m · ${left}m left`}>
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }}>
          {latest.latest_read}
        </div>
        <Row k="Bias direction so far"
             v={<span className={"v " + (BIAS_TONE[latest.bias_direction] || "")}>
                  {String(latest.bias_direction || "").toUpperCase() || "—"}
                </span>} />
        <Row k="Watching" v={latest.watching || "—"} />
      </Panel>

      {reads.length > 1 && <PreviousReadsPanel reads={reads.slice(1)} />}
    </>
  );
}

// #40 Expand/collapse prior open-reaction reads. Long latest_reads
// stack into a wall of text otherwise.
// #58 Order toggle — "first read" (chronological, oldest first) is
// often the most important (e.g. how NY actually opened). Default is
// reverse-chrono (newest first) to match the rest of the trading UI.
function PreviousReadsPanel({ reads }) {
  const [expanded, setExpanded] = useStateL(() => new Set());
  const [chronological, setChronological] = useStateL(false);
  const ordered = chronological ? [...reads].reverse() : reads;
  const toggle = (i) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="title">PREVIOUS READS</span>
        <span className="meta" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>{reads.length} prior · click to expand</span>
          <button onClick={() => setChronological((c) => !c)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border, #2a3038)",
                    color: chronological ? "var(--amber)" : "var(--label)",
                    padding: "1px 7px",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 9,
                    letterSpacing: ".12em",
                    cursor: "pointer",
                  }}>
            {chronological ? "OLDEST ↓" : "NEWEST ↓"}
          </button>
        </span>
      </header>
      <div className="panel-body flush">
        {ordered.map((r, i) => {
          const open = expanded.has(i);
          const txt = r.latest_read || "";
          const preview = txt.length > 100 ? txt.slice(0, 100) + "…" : txt;
          return (
            <div key={i} onClick={() => toggle(i)}
                 style={{
                   padding: "8px 14px",
                   borderBottom: "1px solid var(--border-dim, #1e2228)",
                   cursor: txt.length > 100 ? "pointer" : "default",
                 }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "baseline",
                marginBottom: 4,
              }}>
                <span style={{ color: "var(--label)", fontSize: 10, letterSpacing: ".08em" }}>
                  +{r.minutes_into_phase ?? "?"}m{txt.length > 100 ? (open ? " ▾" : " ▸") : ""}
                </span>
                <span className={"v " + (BIAS_TONE[r.bias_direction] || "")}
                      style={{ fontSize: 10, letterSpacing: ".1em" }}>
                  {String(r.bias_direction || "").toUpperCase() || "—"}
                </span>
              </div>
              <div style={{ color: "var(--prose)", fontSize: 11, lineHeight: 1.5 }}>
                {open ? txt : preview}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// SESSION LIQUIDITY — used inside OpenReactionView. Reads brief key_levels
// and renders untaken / swept liquidity in a compact list.
function SessionLiquidityPanel() {
  const { brief } = useSessionBrief();
  const levels = brief?.key_levels || [];
  if (levels.length === 0) return null;
  // Sort high → low for at-a-glance scanning.
  const sorted = [...levels].sort((a, b) => {
    const an = typeof a.price === "number" ? a.price : -Infinity;
    const bn = typeof b.price === "number" ? b.price : -Infinity;
    return bn - an;
  });
  const fmtPx = (p) => {
    if (typeof p !== "number") return String(p ?? "");
    const [whole, dec = ""] = String(p).split(".");
    const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
  };
  return (
    <section className="panel session-liquidity">
      <header className="panel-head">
        <span className="title">SESSION LIQUIDITY</span>
        <span className="meta">{levels.length} level{levels.length === 1 ? "" : "s"}</span>
      </header>
      <div className="panel-body flush">
        {sorted.map((lv) => {
          const state = lv.state || "untaken";
          return (
            <div className="lvl" key={lv.name}>
              <span className="marker">{state === "untaken" ? "─" : "·"}</span>
              <span className="name">{lv.name}</span>
              <span className="price">{fmtPx(lv.price)}</span>
              <span className={"state " + state}>{state.toUpperCase()}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// OpenReactionView — the OpenReaction sub-state. Wraps the existing
// OpenReactionTracker, inserts SESSION LIQUIDITY between latest + previous
// reads, preserves loop-down banner.
function OpenReactionView({ loopDown }) {
  return (
    <div className="work-scroll">
      {loopDown && (
        <div className="banner">
          <span className="glyph">● LOOP DOWN</span>
          <span className="txt">bar-close detector not reporting</span>
          <span className="sub">RESTART</span>
        </div>
      )}
      <OpenReactionTracker />
      <SessionLiquidityPanel />
    </div>
  );
}

// #45 Rejected trades panel — surfaces the useTrades.rejected list
// (capped at 20 in the hook) below SETUPS & TRADES. Was: captured
// silently and never rendered.
function RejectedSetupsPanel({ rejected }) {
  if (!rejected || rejected.length === 0) return null;
  return (
    <section className="panel" style={{ marginTop: 6 }}>
      <header className="panel-head">
        <span className="title">REJECTED · THIS SESSION</span>
        <span className="meta">{rejected.length}</span>
      </header>
      <div className="panel-body flush">
        {rejected.map((r, i) => {
          const t = r.ts ? new Date(r.ts).toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
            timeZone: "America/New_York",
          }) : "—";
          return (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "auto auto 1fr",
              gap: 10,
              padding: "5px 14px",
              borderBottom: "1px solid var(--border-dim, #1e2228)",
              alignItems: "baseline",
            }}>
              <span style={{ color: "var(--label-dim)", fontSize: 9.5, letterSpacing: ".08em" }}>{t}</span>
              <span style={{ color: "var(--red)", fontSize: 9.5, letterSpacing: ".1em" }}>REJECTED</span>
              <span style={{ color: "var(--prose)", fontSize: 11 }}>
                {r.reason || <span style={{ color: "var(--label-dim)", fontStyle: "italic" }}>no reason given</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Compact list of recent setups. Renders below the live setup card so the
// trader can see the session's setup trail at a glance.
//
// #26 Default: show only A+ / B (real setups). Toggle to see no-trades
// too. A flurry of no-trades used to push real setups off the last-8.
function SetupHistoryList() {
  const [showAll, setShowAll] = useStateL(false);
  // Pull 30 so we have enough after filtering to fill the panel.
  const { setups: allSetups } = useSetupsHistory({ limit: 30 });
  const filtered = showAll
    ? allSetups
    : allSetups.filter((s) => s.grade === "A+" || s.grade === "B");
  const setups = filtered.slice(0, 8);
  if (!allSetups.length) return null;
  return (
    <section className="panel" style={{ marginTop: 6 }}>
      <header className="panel-head">
        <span className="title">SETUP HISTORY · THIS SESSION</span>
        <span className="meta" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>{setups.length} of {allSetups.length}</span>
          <button onClick={() => setShowAll((s) => !s)}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border, #2a3038)",
                    color: showAll ? "var(--amber)" : "var(--label)",
                    padding: "1px 7px",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 9,
                    letterSpacing: ".12em",
                    cursor: "pointer",
                  }}>
            {showAll ? "A+/B ONLY" : "SHOW ALL"}
          </button>
        </span>
      </header>
      <div className="panel-body flush">
        {setups.map((s) => {
          const status = s.confirmation_status || s.status || "";
          const sideTone = s.direction === "long" || s.side === "long" ? "green" : "red";
          const t = s.ts ? new Date(s.ts).toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          }) : "—";
          return (
            <div key={s.id || s.ts} className="level-row"
                 style={{ gridTemplateColumns: "auto auto auto 1fr auto", padding: "5px 14px", gap: 10 }}>
              <span style={{ color: "var(--label-dim)", fontSize: 9.5, letterSpacing: ".08em" }}>{t}</span>
              <Grade value={s.grade || "no-trade"} />
              <span style={{ color: "var(--" + sideTone + ")", fontSize: 10, letterSpacing: ".1em" }}>
                {String(s.direction || s.side || "").toUpperCase()}
              </span>
              <span style={{ color: "var(--label)", fontSize: 11 }}>
                {s.model || ""}
              </span>
              <span style={{ color: "var(--label-dim)", fontSize: 9.5, letterSpacing: ".08em" }}>
                {status.toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// STEP 5+6 — explicit MODEL + CONFIRMATION checks for the active setup.
// Hides when no active setup. Source: activeSetup.pillar_breakdown[].
function Step5n6Panel({ activeSetup }) {
  if (!activeSetup) return null;
  const pillar3 = selectPillar3(activeSetup.pillar_breakdown);
  const rows = pillar3ToConfirmationRows(pillar3);
  const modelStatus = pillar3?.status === "pass" ? "valid"
                    : pillar3?.status === "pending" ? "pending"
                    : pillar3?.status === "weak" ? "weak"
                    : "—";
  const modelTone = pillar3?.status === "pass" ? "green"
                  : pillar3?.status === "pending" ? "amber"
                  : pillar3?.status === "weak" ? "amber"
                  : "dim";
  const check = (status) => {
    if (status === "pass") return "✓";
    if (status === "weak") return "~";
    if (status === "fail") return "✗";
    return "·";
  };
  return (
    <section className="panel step5n6-panel">
      <header className="panel-head">
        <span className="title">STEP 5+6 · ENTRY MODEL + CONFIRMATION</span>
        <span className="meta">claude-graded</span>
      </header>
      <div className="panel-body flush">
        <div className="sect-hd">MODEL</div>
        <div className="confirmation-row">
          <span className="label">Active</span>
          <span className={"detail " + modelTone}>
            {activeSetup.model || "—"} · {modelStatus}
          </span>
        </div>
        <div className="sect-hd">CONFIRMATION</div>
        {rows.map((r) => (
          <div className="confirmation-row" key={r.label}>
            <span className="label">
              <span className={"check " + r.status}>{check(r.status)}</span>
              {r.label}
            </span>
            <span className={"detail " + (
              r.status === "pass" ? "green"
              : r.status === "weak" || r.status === "fail" ? "amber"
              : "dim"
            )}>{r.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatPx(n) {
  if (typeof n !== "number") return String(n ?? "");
  const [whole, dec = ""] = String(n).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
}

// #31 Compute setup age from setup.ts on every render. Previously hard-
// coded "fresh" — misleading when a setup sat unaccepted for 8 minutes.
function computeAge(ts) {
  if (!ts) return "fresh";
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "fresh";
  const s = Math.floor(ms / 1000);
  if (s < 30) return "fresh";
  if (s < 60) return `${s}s old`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m old` : `${Math.floor(m / 60)}h ${m % 60}m old`;
}

function adaptSurfacedSetup(s) {
  if (!s) return null;
  return {
    grade: s.grade,
    model: s.model,
    side: s.direction,
    entry: formatPx(s.entry),
    stop: formatPx(s.stop),
    tp1: formatPx(s.tp1),
    tp2: formatPx(s.tp2),
    invalidation: formatPx(s.invalidation),
    rr: s.rr != null ? String(s.rr) : "—",
    confirmed: s.confirmation_status === "confirmed",
    confirmAge: "",
    label: s.label || "ACTIVE SETUP",
    age: computeAge(s.ts),
    _raw: s,
  };
}

// TV hand-off — three buttons that focus the TradingView pane and fire a
// toast. No broker integration; no order execution. The trader uses
// TradingView's own UI to act.
const TV_HANDOFF_TOASTS = {
  stop:  "Modify your stop in TradingView's right-side panel.",
  scale: "Scale your position in TradingView's order ticket.",
  close: "Close your position in TradingView's order ticket.",
};

function TvHandoffActions({ onAction }) {
  return (
    <div className="tv-handoff">
      <button onClick={() => onAction("stop")}>▸ TV STOP</button>
      <button onClick={() => onAction("scale")}>▸ TV SCALE</button>
      <button onClick={() => onAction("close")}>▸ TV CLOSE</button>
    </div>
  );
}

// Self-dismissing toast for TV hand-off feedback. Lives inside the LIVE
// pane; auto-hides after 3s.
function TvToast({ message, onClose }) {
  useEffectL(() => {
    const id = setTimeout(onClose, 3000);
    return () => clearTimeout(id);
  }, [onClose]);
  if (!message) return null;
  return (
    <div className="tv-toast">
      <b>TV HAND-OFF · </b>{message}
    </div>
  );
}

// Latest bar-read message rendered as a quoted brain narration. Source:
// useChat().messages filtered to type === "bar-read". Hides when no
// bar-read has been emitted yet.
function BrainNarrationBlock({ messages }) {
  const m = latestBarReadMessage(messages);
  if (!m) return null;
  return (
    <div className="brain-narration">
      <div className="head">BRAIN · LAST BAR · {m.t}</div>
      <div className="body" dangerouslySetInnerHTML={{ __html: m.body }} />
    </div>
  );
}

// Adapt the in-trade summary header — derives status pill from trade
// state/outcome. Mirrors the existing adaptTakenTrade for consistency
// but pares down to what InTrade displays in the header.
function tradeHeaderInfo(trade) {
  if (!trade) return null;
  const ageMin = trade.ts ? Math.floor((Date.now() - new Date(trade.ts).getTime()) / 60000) : null;
  let status;
  if (trade.outcome === "TP1_HIT" || (trade.state === "filled" && trade.tp1_hit)) status = "TP1 HIT · runner";
  else if (trade.outcome === "TP2_HIT") status = "TP2 HIT";
  else if (trade.outcome === "STOPPED") status = "STOPPED";
  else if (trade.outcome === "INVALIDATED") status = "INVALIDATED";
  else if (trade.state === "pending_entry") status = "PENDING ENTRY" + (ageMin ? ` · ${ageMin}m` : "");
  else if (trade.tp1_hit) status = "FILLED · BE stop";
  else if (trade.state === "filled") status = "FILLED";
  else status = "OPEN";
  return {
    id: trade.id || "—",
    model: trade.model || "—",
    side: trade.side || "long",
    grade: trade.grade || "—",
    status,
    ageMin,
  };
}

// IN-TRADE sub-state — hybrid layout: dedicated panel at top, chat + history
// continue below. Replaces the previous TradeCard embed for active trades.
function InTrade({ trade, chatMessages, loopDown, loopStale, alerts, onArmPrice, onTvHandoff }) {
  const { close: lastClose } = useLastBar();
  const grid = liveGridFromTrade(trade, lastClose);
  const head = tradeHeaderInfo(trade);
  return (
    <>
      {loopDown && (
        <div className="banner">
          <span className="glyph">● LOOP DOWN</span>
          <span className="txt">bar-close detector not reporting</span>
          <span className="sub">RESTART</span>
        </div>
      )}
      {!loopDown && loopStale && (
        <div className="banner" style={{ borderColor: "var(--amber, #d4a657)", color: "var(--amber)" }}>
          <span className="glyph">● LOOP STALE</span>
          <span className="txt">detector heartbeat slow · trade ticking may lag</span>
        </div>
      )}

      <section className="panel intrade-panel">
        <header className="panel-head">
          <span className="title">IN-TRADE</span>
          <span className="meta">
            #{head?.id} · {head?.ageMin != null ? `${head.ageMin}m old` : ""}
          </span>
        </header>
        <div className="trade-head">
          <span className="id">{head?.model}</span>
          <span className={"side " + (head?.side === "short" ? "short" : "long")}>
            {String(head?.side || "").toUpperCase()}
          </span>
          <Grade value={head?.grade} />
          <span className="status">{head?.status}</span>
        </div>

        <div className="live-grid-2x2">
          <LiveCell k="PRICE"    v={grid.price.v}  sub={grid.price.sub}  tone={grid.price.tone} />
          <LiveCell k="P&L"      v={grid.pnl.v}    sub={grid.pnl.sub}    tone={grid.pnl.tone} />
          <LiveCell k="TO TP1"   v={grid.toTp1.v}  sub={grid.toTp1.sub}  tone={grid.toTp1.tone} />
          <LiveCell k="TO STOP"  v={grid.toStop.v} sub={grid.toStop.sub} tone={grid.toStop.tone} />
        </div>

        <div style={{ padding: "0 14px 6px" }}>
          <Row k="Entry / Stop" v={`${formatPx(trade.entry)} / ${formatPx(trade.stop)}${trade.tp1_hit ? " · BE" : ""}`} tone="num" />
          <Row k="TP1 / TP2"    v={`${formatPx(trade.tp1)} / ${formatPx(trade.tp2)}`} tone="num green" />
        </div>

        <TvHandoffActions onAction={onTvHandoff} />
      </section>

      <BrainNarrationBlock messages={chatMessages} />
    </>
  );
}

// Chat-only view used INSIDE the InTrade branch — the full EntryHuntView
// would render setup-card + history which are noisy when you're in trade.
// This keeps just the chat feed accessible.
function EntryHuntChat({ alerts, onArmPrice }) {
  const { messages, typing, send: submit, cancel, reset, queuedBehind } = useChat();
  return (
    <>
      {queuedBehind && (
        <div style={{
          padding: "6px 14px",
          background: "var(--surface-1)",
          color: "var(--amber)",
          fontSize: 10,
          fontFamily: "ui-monospace, Menlo, monospace",
          letterSpacing: ".08em",
          borderBottom: "1px solid var(--border-dim, #1e2228)",
        }}>
          QUEUED · waiting on {queuedBehind} turn to finish
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ClaudeFeed messages={messages} typing={typing} onSubmit={submit}
                    onCancel={cancel} onReset={reset}
                    onArmPrice={onArmPrice}
                    armedPrices={alerts ? new Set(Object.values(alerts.armed || {})) : null}
                    firedPrices={alerts ? new Set((alerts.fired || []).map((f) => f.px)) : null} />
      </div>
    </>
  );
}

function EntryHuntView({ loopDown, loopStale, noSetups, alerts, onArmPrice }) {
  // Real chat state + surfaced setup via the Agent SDK.
  const { messages, typing, send: submit, cancel, reset, queuedBehind } = useChat();
  const { activeSetup, noTradeReason, noTradeReasonTs, clearSetup } = useActiveSetup();
  const { accept: acceptApi, reject: rejectApi, rejected, pnl } = useTrades();
  // #59 / #60 Tick every 30s so the setup-age / pending-entry labels
  // refresh even when no chat / bar activity drives a re-render.
  const [, setTick] = useStateL(0);
  useEffectL(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const setup = adaptSurfacedSetup(activeSetup);
  // #2 In-flight guards prevent double-click → two trade events.
  // #3 Loop-down guard: don't let the trader accept when the detector
  // can't track outcomes. Trade would sit pending forever.
  const [acceptPending, setAcceptPending] = useStateL(false);
  const [rejectPending, setRejectPending] = useStateL(false);

  const accept = async () => {
    if (!activeSetup || acceptPending) return;
    if (loopDown) {
      alert("Loop is DOWN — detector isn't tracking trades. Wait for it to recover before accepting.");
      return;
    }
    // #25 Snapshot activeSetup at click time. If a new surface_setup
    // lands between click and IPC roundtrip, we accept the ORIGINAL
    // setup the trader actually saw — not whatever overwrote it.
    const setupSnapshot = activeSetup;
    setAcceptPending(true);
    try {
      const res = await acceptApi(setupSnapshot);
      if (res?.ok) clearSetup();
      else if (res?.error) alert(`Couldn't accept: ${res.error}`);
    } finally {
      setAcceptPending(false);
    }
  };
  const reject = async () => {
    if (!activeSetup || rejectPending) return;
    const setupSnapshot = activeSetup;
    setRejectPending(true);
    try {
      // #30 capture a reason via a prompt — empty string still acceptable.
      const reason = window.prompt("Reject reason (optional):", "") || "";
      await rejectApi(setupSnapshot.id, reason);
      clearSetup();
    } finally {
      setRejectPending(false);
    }
  };

  return (
    <>
      {loopDown && (
        <div className="banner">
          <span className="glyph">● LOOP DOWN</span>
          <span className="txt">bar-close detector not reporting</span>
          <span className="sub">RESTART</span>
        </div>
      )}
      {/* #21 Surface "stale" — heartbeat older than 30s but not yet
          down. Was: only "down" got a banner; stale was silent. */}
      {!loopDown && loopStale && (
        <div className="banner" style={{ borderColor: "var(--amber, #d4a657)", color: "var(--amber)" }}>
          <span className="glyph">● LOOP STALE</span>
          <span className="txt">detector heartbeat slow · trade ticking may lag</span>
        </div>
      )}

      <SectionHead title="CLAUDE · CONVERSATION" count={sessionLabel()} />
      {/* #44 Queued-behind hint. Mutex makes chat wait behind bar-close
          and brief turns — was silent before. */}
      {queuedBehind && (
        <div style={{
          padding: "6px 14px",
          background: "var(--surface-1)",
          color: "var(--amber)",
          fontSize: 10,
          fontFamily: "ui-monospace, Menlo, monospace",
          letterSpacing: ".08em",
          borderBottom: "1px solid var(--border-dim, #1e2228)",
        }}>
          QUEUED · waiting on {queuedBehind} turn to finish
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ClaudeFeed messages={messages} typing={typing} onSubmit={submit}
                    onCancel={cancel} onReset={reset}
                    onArmPrice={onArmPrice}
                    armedPrices={alerts ? new Set(Object.values(alerts.armed || {})) : null}
                    firedPrices={alerts ? new Set((alerts.fired || []).map((f) => f.px)) : null} />
      </div>

      {/* #46 Compact live P&L line above the setups/trades section. */}
      {pnl.decided + pnl.openCount > 0 && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "4px 14px",
          background: "var(--surface-1)",
          borderBottom: "1px solid var(--border-dim, #1e2228)",
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 10,
          letterSpacing: ".08em",
        }}>
          <span style={{ color: "var(--label)" }}>SESSION P&amp;L</span>
          <span style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <span style={{
              color: pnl.totalR > 0 ? "var(--green)" : pnl.totalR < 0 ? "var(--red)" : "var(--prose)",
              fontWeight: 600,
            }}>
              {pnl.totalR > 0 ? "+" : ""}{pnl.totalR} R
            </span>
            <span style={{ color: "var(--label)" }}>
              {pnl.wins}W / {pnl.losses}L
              {pnl.openCount > 0 && <span style={{ color: "var(--amber)" }}> · {pnl.openCount} open</span>}
            </span>
          </span>
        </div>
      )}

      <SectionHead title="SETUPS & TRADES"
                   count={setup ? "1 candidate"
                          : noTradeReason ? "no-trade"
                          : "0 candidate"} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Step5n6Panel activeSetup={activeSetup} />
        {setup && (
          <SetupCard setup={setup}
                     onAccept={accept}
                     onReject={reject}
                     featured
                     onArmPrice={onArmPrice} />
        )}
        {/* #57 no-trade expiry: fade after 90s, hide after 5 min. The
            reason is current intent of the latest turn — older than 5
            min it's stale enough to hide entirely. */}
        {(() => {
          if (setup || !noTradeReason) return null;
          const ageMs = noTradeReasonTs ? Date.now() - noTradeReasonTs : 0;
          if (ageMs > 5 * 60_000) return null;
          const faded = ageMs > 90_000;
          const ageMin = Math.floor(ageMs / 60_000);
          return (
            <div className="empty-state" style={{ opacity: faded ? 0.45 : 1 }}>
              <div className="glyph">[ NO-TRADE ]</div>
              <div>{noTradeReason}</div>
              <div className="sub">
                discipline · waiting on next setup
                {ageMin > 0 && <span style={{ marginLeft: 8 }}>· {ageMin}m old</span>}
              </div>
            </div>
          );
        })()}
        {(() => {
          if (setup) return null;
          // Show WATCHING when there's no no-trade reason OR the reason
          // is expired (matches the rule in #57 above).
          const ageMs = noTradeReasonTs ? Date.now() - noTradeReasonTs : Infinity;
          if (noTradeReason && ageMs <= 5 * 60_000) return null;
          return (
            <div className="empty-state">
              <div className="glyph">[ WATCHING ]</div>
              <div>no setup surfaced yet · ask claude or wait for the live loop</div>
              <div className="sub">no-setup is a correct state</div>
            </div>
          );
        })()}

        <SetupHistoryList />
        <RejectedSetupsPanel rejected={rejected} />

        {Array.isArray(activeSetup?.pillar_breakdown) && activeSetup.pillar_breakdown.length > 0 && (
          <section className="panel" style={{ marginTop: 6 }}>
            <header className="panel-head">
              <span className="title">PILLAR ALIGNMENT</span>
              <span className="meta">{activeSetup.grade}</span>
            </header>
            <div className="panel-body flush">
              <PillarsPanel pillars={activeSetup.pillar_breakdown} />
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function LiveWorkstation({ subState, loopDown, loopStale, noSetups, alerts, onArmPrice }) {
  // Hoist data sources that the router needs to choose a sub-state.
  const { activeTrade } = useTrades();
  const { messages: chatMessages } = useChat();

  // TV hand-off toast — local state, self-dismisses after 3s.
  const [tvToast, setTvToast] = useStateL(null);
  const handleTvHandoff = (action) => {
    setTvToast(TV_HANDOFF_TOASTS[action] || "");
    // Focus the TradingView chart pane so the trader's eyes go there.
    const chartHost = document.querySelector(".chart-pane");
    if (chartHost) chartHost.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  // InTrade takes priority over the open-reaction / entry-hunt subState.
  if (activeTrade) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", position: "relative" }}>
        {tvToast && <TvToast message={tvToast} onClose={() => setTvToast(null)} />}
        <InTrade
          trade={activeTrade}
          chatMessages={chatMessages}
          loopDown={loopDown}
          loopStale={loopStale}
          alerts={alerts}
          onArmPrice={onArmPrice}
          onTvHandoff={handleTvHandoff}
        />
        {/* Chat + setup history still live below the IN-TRADE panel so
            the trader can ask questions mid-trade. */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <SectionHead title="CLAUDE · CONVERSATION" count={sessionLabel()} />
          <EntryHuntChat alerts={alerts} onArmPrice={onArmPrice} />
        </div>
      </div>
    );
  }

  if (subState === "open-reaction") {
    return <OpenReactionView loopDown={loopDown} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <EntryHuntView
        loopDown={loopDown}
        loopStale={loopStale}
        noSetups={noSetups}
        alerts={alerts}
        onArmPrice={onArmPrice}
      />
    </div>
  );
}

export { LiveWorkstation };
