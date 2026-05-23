// LIVE mode workstation — Claude conversation + setups/trades rail.

import React, { useState as useStateL, useEffect as useEffectL, useRef as useRefL } from "react";
import { Panel, Row, Grade, PillarsPanel, SetupCard, TradeCard, ClaudeFeed, SectionHead } from "./Shared.jsx";
import { useChat } from "./hooks/useChat.js";
import { useTrades } from "./hooks/useTrades.js";

function OpenReactionTracker({ minutesIn = 8 }) {
  const items = [
    { k: "Asia high",    v: "21 496.50", tag: "untouched", tone: "green" },
    { k: "Asia low",     v: "21 458.75", tag: "untouched", tone: "green" },
    { k: "London high",  v: "21 516.00", tag: "untouched", tone: "green" },
    { k: "London low",   v: "21 471.50", tag: "swept · 09:34", tone: "red" },
  ];
  const reactionPillars = [
    { name: "Open reaction", status: "pass",
      elements: [
        { name: "ONL swept",          status: "pass" },
        { name: "Reaction quality",   status: "pass" },
        { name: "Reclaim confirmed",  status: "pass" },
      ] },
    { name: "LTF bias forming", status: "pass",
      elements: [
        { name: "5m structure long",  status: "pass" },
        { name: "1m MSS @ 21 484.50", status: "pass" },
      ] },
    { name: "HTF / LTF alignment", status: "pass",
      elements: [
        { name: "HTF bias = long",    status: "pass" },
        { name: "LTF bias = long",    status: "pass" },
        { name: "Verdict",            status: "pass" },
      ] },
  ];
  return (
    <>
      <Panel title="OPEN REACTION · 09:30–09:45 ET"
             right={`+${minutesIn}m · ${15 - minutesIn}m left`}>
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55 }}>
          Sharp rejection of <em style={{color:"var(--amber)", fontStyle:"normal"}}>21 471.50</em>{" "}
          (ONL) into the 5m FVG. Reclaim closed at 21 488.25.
          LTF turning bullish — <strong style={{color:"var(--green)"}}>aligned with HTF</strong>.
          A+ potential setting up.
        </div>
      </Panel>

      <section className="panel">
        <header className="panel-head">
          <span className="title">OVERNIGHT LEVELS · STATUS</span>
          <span className="meta">live</span>
        </header>
        <div className="panel-body flush">
          {items.map((it) => (
            <div key={it.k} className="level-row" style={{ gridTemplateColumns: "1fr auto 120px" }}>
              <span className="name" style={{ color: "var(--label)", letterSpacing: ".04em" }}>{it.k}</span>
              <span className="price">{it.v}</span>
              <span className={"state " + (it.tone === "red" ? "taken" : "untaken")}
                    style={{ width: "auto" }}>
                {it.tag.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <span className="title">FORMING READ</span>
          <span className="meta">HTF / LTF · <Grade value="A+" /></span>
        </header>
        <div className="panel-body flush">
          <PillarsPanel pillars={reactionPillars} />
        </div>
      </section>

      <Panel title="NEXT" right="entry-hunt in ~7m">
        <Row k="Forming LTF bias" v={<span className="v green">LONG</span>} />
        <Row k="HTF / LTF" v={<span className="v green">ALIGNED</span>} />
        <Row k="Expected grade ceiling" v={<Grade value="A+" />} />
        <Row k="Best draw" v="21 528.50 (PDH)" tone="num" />
      </Panel>
    </>
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
      <div style={{ flex: 1.45, minHeight: 0, display: "flex", flexDirection: "column" }}>
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

        {!noSetups && (
          <section className="panel" style={{ marginTop: 6 }}>
            <header className="panel-head">
              <span className="title">WHY A+ · PILLAR ALIGNMENT</span>
              <span className="meta">6 / 6 elements</span>
            </header>
            <div className="grade-shift">
              <span>PREP</span>
              <Grade value="B" />
              <span className="arrow">→</span>
              <span>LIVE</span>
              <Grade value="A+" />
              <span className="note" style={{ marginLeft: 8 }}>
                Re-judged at open: <em>Price-Action Quality</em> weak → pass;{" "}
                <em>Entry model</em> and <em>Confirmation</em> pending → pass.
              </span>
            </div>
            <div className="panel-body flush">
              <PillarsPanel pillars={[
                { name: "Draw & Bias", status: "pass",
                  elements: [
                    { name: "HTF bias",          status: "pass" },
                    { name: "Overnight context", status: "pass" },
                  ] },
                { name: "Price-Action Quality", status: "pass",
                  elements: [
                    { name: "NY open reaction",  status: "pass" },
                    { name: "Price quality",     status: "pass" },
                  ] },
                { name: "Entry + Confirmation", status: "pass",
                  elements: [
                    { name: "Entry model",       status: "pass" },
                    { name: "Confirmation",      status: "pass" },
                  ] },
              ]} />
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
        <OpenReactionTracker minutesIn={8} />
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
