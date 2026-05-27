// LIVE workstation — essentialist re-add (2026-05-27).
// Sub-state routed: InTrade > EntryHunt > OpenReaction (default).
// CLAUDE conversation lives in the global top-bar popover — no inline chat
// here. RISK rows are broken into Entry / Stop (red) / TP1 / TP2 (green)
// for color-coded scannability.

import React from "react";
import { Panel, Row, Grade } from "./Shared.jsx";
import {
  selectPillar3,
  pillar3ToConfirmationRows,
  liveGridFromTrade,
  latestBarReadMessage,
} from "./Live.helpers.js";
import { stripCitations } from "./Prep.helpers.js";
import { useTrades } from "./hooks/useTrades.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useHealth } from "./hooks/useHealth.js";
import { useChat } from "./hooks/useChat.js";
import { useSessionBrief } from "./hooks/useSessionBrief.js";
import { useClock } from "./hooks/useClock.js";

// ── Loop banner (only when unhealthy) ────────────────────────────────
function LoopBanner({ status }) {
  if (status === "healthy" || !status) return null;
  const tone = status === "down" ? "red" : "amber";
  const label = status === "down" ? "DETECTOR DOWN" : "DETECTOR STALE";
  return (
    <div style={{
      padding: "6px 16px",
      borderBottom: "1px solid var(--border)",
      background: "var(--surface-2)",
      color: tone === "red" ? "var(--red)" : "var(--amber)",
      fontSize: 10.5, letterSpacing: ".22em",
    }}>
      {label} · bar-close polling is paused — fix in System page
    </div>
  );
}

// ── Sub-state 1: OPEN REACTION (Step 4) ──────────────────────────────
function OpenReactionView({ openReaction, brief }) {
  const latest = openReaction?.latest;
  const windowLbl = latest?.minutes_into_phase != null
    ? `+${latest.minutes_into_phase}m`
    : "—";
  const bias = latest?.bias_direction || "—";
  const outcome = brief?.pillar2_verdict === "good" ? "aligned"
                : brief?.pillar2_verdict === "poor" ? "conflicted"
                : "—";
  const liq = (brief?.key_levels || []).slice(0, 12);
  const read = stripCitations(latest?.latest_read);
  const watching = stripCitations(latest?.watching);
  const proseStyle = {
    color: "var(--prose)", fontSize: 11, lineHeight: 1.5,
    padding: "6px 0",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
  return (
    <div className="work-scroll">
      <Panel title="STEP 4 · NY OPEN LTF BIAS" meta={windowLbl}>
        <Row k="Window"   v={windowLbl} />
        <Row k="Reaction" v={bias}
             tone={bias === "bullish" ? "ok"
                 : bias === "bearish" ? "warn" : ""} />
        <Row k="Outcome"  v={outcome}
             tone={outcome === "aligned" ? "ok" : outcome === "conflicted" ? "bad" : ""} />
        {read && (
          <>
            <div className="sect-hd" style={{ marginTop: 12 }}>CLAUDE READ</div>
            <div style={proseStyle}>{read}</div>
          </>
        )}
        {watching && (
          <>
            <div className="sect-hd" style={{ marginTop: 8 }}>WATCHING</div>
            <div style={proseStyle}>{watching}</div>
          </>
        )}
        {liq.length > 0 && (
          <>
            <div className="sect-hd" style={{ marginTop: 12 }}>SESSION LIQUIDITY</div>
            {liq.map((lv) => (
              <Row key={lv.name}
                   k={lv.name}
                   v={`${lv.price} · ${lv.state || "—"}`}
                   tone={lv.state === "untaken" ? "" : "dim"} />
            ))}
          </>
        )}
      </Panel>
    </div>
  );
}

// Pull the most recent Claude reply prose from the chat stream + strip
// citations so it reads as plain English. Matches OpenReactionView's
// CLAUDE READ rendering — gives the entry-hunt panel a live narration
// of the model's per-bar reasoning.
function latestClaudeReadHtml(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && (m.type === "reply" || m.type === "bar-read") && m.body) return m;
  }
  return null;
}

// ── Sub-state 2: ENTRY HUNT (Step 5 + Step 6) ────────────────────────
function EntryHuntView({ activeSetup, noTradeReason, onAccept, onReject, chat }) {
  // Show Claude's latest read regardless of whether a setup is active —
  // when no setup, it explains *why* no-trade; when a setup is in play,
  // it gives the chain rationale.
  const latestReply = latestClaudeReadHtml(chat?.messages || []);
  const readHtml = latestReply
    ? stripCitations(latestReply.body.replace(/<[^>]+>/g, " "))
    : null;
  const proseStyle = {
    color: "var(--prose)", fontSize: 11, lineHeight: 1.5,
    padding: "6px 0",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  if (!activeSetup) {
    // The meta slot is a tight tag-line on the right of the panel header —
    // long reasons (detector diagnostic prose like "MSS: no failure_swing
    // with dir=bear in pillar3.failure_swings; ...") wrap into a wall of
    // text that looks broken. Keep meta short; render the full reason as
    // body prose where it can wrap properly.
    return (
      <div className="work-scroll">
        <Panel title="ENTRY CANDIDATE"
               right={<span className="pill dim">{noTradeReason ? "no-trade" : "waiting"}</span>}>
          {noTradeReason ? (
            <>
              <div className="sect-hd">NO-TRADE REASON</div>
              <div style={proseStyle}>{noTradeReason}</div>
            </>
          ) : null}
          {readHtml ? (
            <>
              <div className="sect-hd">CLAUDE READ {latestReply.t ? `· ${latestReply.t}` : ""}</div>
              <div style={proseStyle}>{readHtml}</div>
            </>
          ) : !noTradeReason ? (
            <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
              waiting for Claude's next bar-close read…
            </div>
          ) : null}
        </Panel>
      </div>
    );
  }
  const pillar3 = selectPillar3(activeSetup.pillar_breakdown);
  const confRows = pillar3ToConfirmationRows(pillar3);
  // Map full label -> [concise label, tooltip]
  const conciseLabel = {
    "PD-array tap": ["PD tap", "PD-array tap — wick touch of an HTF FVG/BPR/OB"],
    "1m close past structure": ["1m close", "1m close past structure — first LTF acknowledgement"],
    "5m close past structure": ["5m close", "5m close past structure — confirmed displacement"],
    "Clean delivery": ["Delivery", "Clean delivery (no wick rejection)"],
  };
  const grade = activeSetup.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  return (
    <div className="work-scroll">
      <Panel title="ENTRY CANDIDATE"
             right={
               <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                 <span className={"pill " + gradeTone}>{grade}</span>
                 <span style={{ color: "var(--label)", fontSize: 10 }}>
                   {activeSetup.model || "—"} · {(activeSetup.side || "—").toUpperCase()}
                 </span>
               </span>}>
        <div className="sect-hd">CONFIRMATION</div>
        {confRows.map((r) => {
          const [label, tip] = conciseLabel[r.label] || [r.label, ""];
          const tone = r.status === "pass" ? "ok"
                      : r.status === "weak" ? "warn"
                      : r.status === "fail" ? "bad" : "dim";
          return (
            <div className="row" key={r.label} title={tip}>
              <span className="k">{label}</span>
              <span className={"v " + tone}>{r.status === "pass" ? "yes" : (r.status === "missing" ? "—" : r.status)}</span>
            </div>
          );
        })}

        <div className="sect-hd" style={{ marginTop: 12 }}>RISK</div>
        <Row k="Entry" v={<span className="v num">{activeSetup.entry ?? "—"}</span>} />
        <Row k="Stop"  v={<span className="v num red">{activeSetup.stop ?? "—"}</span>} />
        <Row k="TP1"   v={<span className="v num green">{activeSetup.tp1 ?? "—"}</span>} />
        <Row k="TP2"   v={<span className="v num green">{activeSetup.tp2 ?? "—"}</span>} />
        <Row k="R : R" v={activeSetup.rr ?? "—"}
             tone={activeSetup.rr >= 1.5 ? "ok" : activeSetup.rr != null ? "warn" : ""} />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 14 }}>
          <button className="btn red"   onClick={() => onReject?.(activeSetup)}>REJECT</button>
          <button className="btn green" onClick={() => onAccept?.(activeSetup)}>ACCEPT</button>
        </div>

        {readHtml && (
          <>
            <div className="sect-hd" style={{ marginTop: 12 }}>CLAUDE READ {latestReply.t ? `· ${latestReply.t}` : ""}</div>
            <div style={proseStyle}>{readHtml}</div>
          </>
        )}
      </Panel>
    </div>
  );
}

// ── Sub-state 3: IN-TRADE ─────────────────────────────────────────────
function InTradeView({ activeTrade, lastBar, chat }) {
  if (!activeTrade) return <div className="stub">[ no active trade ]</div>;
  const grid = liveGridFromTrade(activeTrade, lastBar?.close);
  const barRead = latestBarReadMessage(chat?.messages || []);
  const grade = activeTrade.grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  return (
    <div className="work-scroll">
      <Panel title="IN-TRADE"
             right={
               <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                 <span style={{ color: "var(--value)", fontSize: 11 }}>#{activeTrade.id}</span>
                 <span className={"pill " + (activeTrade.side === "long" ? "green" : "red")}>
                   {(activeTrade.side || "").toUpperCase()}
                 </span>
                 <span className={"pill " + gradeTone}>{grade}</span>
                 <span style={{ color: "var(--label)", fontSize: 10 }}>{activeTrade.model || ""}</span>
               </span>}>
        <div className="sect-hd">RISK PLAN</div>
        <Row k="Entry" v={<span className="v num">{activeTrade.entry}</span>} />
        <Row k="Stop"  v={<span className="v num red">{activeTrade.stop}{activeTrade.tp1_hit ? " · BE" : ""}</span>} />
        <Row k="TP1"   v={<span className="v num green">{activeTrade.tp1}</span>} />
        <Row k="TP2"   v={<span className="v num green">{activeTrade.tp2}</span>} />
        <Row k="Size"  v={activeTrade.size?.label || (activeTrade.size?.contracts ? `${activeTrade.size.contracts}c` : "—")} />

        <div className="sect-hd" style={{ marginTop: 12 }}>LIVE</div>
        <div className="live-grid">
          <div className="lcell"><span className="k">PRICE</span><span className={"v " + grid.price.tone}>{grid.price.v}</span><span className="sub">{grid.price.sub}</span></div>
          <div className="lcell"><span className="k">P&amp;L</span><span className={"v " + grid.pnl.tone}>{grid.pnl.v}</span><span className="sub">{grid.pnl.sub}</span></div>
          <div className="lcell"><span className="k">TO TP1</span><span className={"v " + grid.toTp1.tone}>{grid.toTp1.v}</span><span className="sub">{grid.toTp1.sub}</span></div>
          <div className="lcell"><span className="k">TO STOP</span><span className={"v " + grid.toStop.tone}>{grid.toStop.v}</span><span className="sub">{grid.toStop.sub}</span></div>
        </div>

        <div className="sect-hd" style={{ marginTop: 12 }}>ACTIONS</div>
        <div className="trade-actions">
          <button className="btn amber">▸ TV STOP</button>
          <button className="btn amber">▸ TV SCALE</button>
          <button className="btn red">▸ TV CLOSE</button>
        </div>

        {barRead && (
          <>
            <div className="sect-hd" style={{ marginTop: 12 }}>BRAIN</div>
            <div className="trade-narration" dangerouslySetInnerHTML={{ __html: barRead.body }} />
          </>
        )}
      </Panel>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────
function LiveWorkstation() {
  const health = useHealth();
  const { activeTrade, accept, reject } = useTrades();
  const { activeSetup, noTradeReason } = useActiveSetup();
  const openReaction = useOpenReaction();
  const lastBar = useLastBar();
  const chat = useChat();
  const { brief } = useSessionBrief();
  const clock = useClock();

  // Sub-state precedence:
  //   1. activeTrade present → IN-TRADE
  //   2. ET clock in open-reaction phase (09:30→09:45 / 13:30→13:45) →
  //      OPEN REACTION. Even with no live read yet, we show this view
  //      because the trader is *in* the open window.
  //   3. otherwise → ENTRY HUNT (with empty state if no active setup).
  //
  // Bug observed 2026-05-27: the prior router fell through to
  // OpenReactionView whenever activeSetup was null, leaving stale
  // +10m open-reaction data on screen during the entry_hunt phase.
  const inOpenReaction = clock?.phase === "OPEN REACTION";
  let body;
  if (activeTrade) {
    body = <InTradeView activeTrade={activeTrade} lastBar={lastBar} chat={chat} />;
  } else if (inOpenReaction) {
    body = <OpenReactionView openReaction={openReaction} brief={brief} />;
  } else {
    body = <EntryHuntView activeSetup={activeSetup} noTradeReason={noTradeReason}
                          onAccept={accept} onReject={(s) => reject(s.id, "")}
                          chat={chat} />;
  }

  return (
    <>
      <LoopBanner status={health?.loop} />
      {body}
    </>
  );
}

export { OpenReactionView, EntryHuntView, InTradeView, LiveWorkstation };
