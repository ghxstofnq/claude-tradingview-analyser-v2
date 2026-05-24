// LIVE mode workstation — Claude conversation + setups/trades rail.

import React, { useState as useStateL, useEffect as useEffectL, useRef as useRefL } from "react";
import { Panel, Row, Grade, PillarsPanel, SetupCard, TradeCard, ClaudeFeed, SectionHead } from "./Shared.jsx";
import { useChat } from "./hooks/useChat.js";
import { useTrades } from "./hooks/useTrades.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useSetupsHistory } from "./hooks/useSetupsHistory.js";

const BIAS_TONE = { bullish: "green", bearish: "red", mixed: "amber", unclear: "amber" };

function OpenReactionTracker() {
  const { reads, latest } = useOpenReaction();
  const minutesIn = latest?.minutes_into_phase ?? 0;
  const left = Math.max(0, 15 - minutesIn);

  if (!latest) {
    return (
      <Panel title="OPEN REACTION · waiting for first read">
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
      <Panel title="OPEN REACTION · LATEST READ"
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

      {reads.length > 1 && (
        <section className="panel">
          <header className="panel-head">
            <span className="title">PREVIOUS READS</span>
            <span className="meta">{reads.length - 1} prior</span>
          </header>
          <div className="panel-body flush">
            {reads.slice(1).map((r, i) => (
              <div key={i}
                   style={{
                     padding: "8px 14px",
                     borderBottom: "1px solid var(--border-dim, #1e2228)",
                   }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  marginBottom: 4,
                }}>
                  <span style={{ color: "var(--label)", fontSize: 10, letterSpacing: ".08em" }}>
                    +{r.minutes_into_phase ?? "?"}m
                  </span>
                  <span className={"v " + (BIAS_TONE[r.bias_direction] || "")}
                        style={{ fontSize: 10, letterSpacing: ".1em" }}>
                    {String(r.bias_direction || "").toUpperCase() || "—"}
                  </span>
                </div>
                <div style={{ color: "var(--prose)", fontSize: 11, lineHeight: 1.5 }}>
                  {r.latest_read}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// Compact list of recent setups. Renders below the live setup card so the
// trader can see the session's setup trail at a glance.
function SetupHistoryList() {
  const { setups } = useSetupsHistory({ limit: 8 });
  if (!setups.length) return null;
  return (
    <section className="panel" style={{ marginTop: 6 }}>
      <header className="panel-head">
        <span className="title">SETUP HISTORY · THIS SESSION</span>
        <span className="meta">{setups.length} entries</span>
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

function formatPx(n) {
  if (typeof n !== "number") return String(n ?? "");
  const [whole, dec = ""] = String(n).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
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
    age: "fresh",
    _raw: s,
  };
}

function adaptTakenTrade(t) {
  if (!t) return null;
  const sizeLabel = t.size?.label || (t.size?.contracts != null ? `${t.size.contracts}c` : "—");
  const outcome = t.outcome
    ? t.outcome === "TP1_HIT" ? "tp1"
      : t.outcome === "TP2_HIT" ? "tp2"
      : t.outcome === "STOPPED" ? "stopped"
      : t.outcome === "INVALIDATED" ? "invalidated"
      : "open"
    : (t.state === "filled" ? (t.tp1_hit ? "tp1" : "open") : "open");
  const outcomeLabel = outcome === "tp1" ? "● TP1 HIT"
    : outcome === "tp2" ? "● TP2 HIT"
    : outcome === "stopped" ? "● STOPPED"
    : outcome === "invalidated" ? "● INVALIDATED"
    : t.state === "pending_entry" ? "● PENDING ENTRY"
    : "● OPEN";
  return {
    id: t.id,
    grade: t.grade,
    side: t.side,
    model: t.model,
    entry: formatPx(t.entry),
    stop: formatPx(t.stop),
    tp1: formatPx(t.tp1),
    tp2: formatPx(t.tp2),
    rr: t.rr != null ? String(t.rr) : "—",
    size: sizeLabel,
    risk: t.size?.dollar_risk != null ? `$${t.size.dollar_risk}` : (t.size?.r_unit != null ? `${t.size.r_unit} R` : "—"),
    pnl: t.r_realized != null ? `${t.r_realized > 0 ? "+" : ""}${t.r_realized} R` : "—",
    pnlPositive: t.r_realized > 0,
    pnlNegative: t.r_realized < 0,
    outcome,
    outcomeLabel,
    statusNote: t.tp1_hit ? "runner: stop at BE" : "",
    taken: t.ts ? new Date(t.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " ET" : "",
  };
}

function EntryHunt({ loopDown, noSetups, alerts, onArmPrice }) {
  // Real chat state + surfaced setup via the Agent SDK.
  const { messages, typing, send: submit, activeSetup, noTradeReason, clearSetup } = useChat();
  const { activeTrade, accept: acceptApi, reject: rejectApi } = useTrades();
  const setup = adaptSurfacedSetup(activeSetup);
  const takenTrade = adaptTakenTrade(activeTrade);

  const accept = async () => {
    if (!activeSetup) return;
    const res = await acceptApi(activeSetup);
    if (res?.ok) clearSetup();
  };
  const reject = async () => {
    if (!activeSetup) return;
    await rejectApi(activeSetup.id, "");
    clearSetup();
  };

  return (
    <>
      {loopDown && (
        <div className="banner">
          <span className="glyph">● LOOP DOWN</span>
          <span className="txt">bar-close detector not reporting · last bar 09:46 ET</span>
          <span className="sub">RESTART</span>
        </div>
      )}

      <SectionHead title="CLAUDE · CONVERSATION" count="1m · NY AM" />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ClaudeFeed messages={messages} typing={typing} onSubmit={submit}
                    onArmPrice={onArmPrice}
                    armedPrices={alerts ? new Set(Object.values(alerts.armed || {})) : null}
                    firedPrices={alerts ? new Set((alerts.fired || []).map((f) => f.px)) : null} />
      </div>

      <SectionHead title="SETUPS & TRADES"
                   count={takenTrade ? "1 active"
                          : setup ? "1 candidate"
                          : noTradeReason ? "no-trade"
                          : "0 candidate"} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {takenTrade && (
          <TradeCard trade={takenTrade} showSnapshot={false} />
        )}
        {!takenTrade && setup && (
          <SetupCard setup={setup} onAccept={accept} onReject={reject} featured />
        )}
        {!takenTrade && !setup && noTradeReason && (
          <div className="empty-state">
            <div className="glyph">[ NO-TRADE ]</div>
            <div>{noTradeReason}</div>
            <div className="sub">discipline · waiting on next setup</div>
          </div>
        )}
        {!takenTrade && !setup && !noTradeReason && (
          <div className="empty-state">
            <div className="glyph">[ WATCHING ]</div>
            <div>no setup surfaced yet · ask claude or wait for the live loop</div>
            <div className="sub">no-setup is a correct state</div>
          </div>
        )}

        <SetupHistoryList />

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

function LiveWorkstation({ subState, loopDown, noSetups, alerts, onArmPrice }) {
  if (subState === "open-reaction") {
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
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <EntryHunt loopDown={loopDown} noSetups={noSetups}
                 alerts={alerts}
                 onArmPrice={onArmPrice} />
    </div>
  );
}

export { LiveWorkstation };
