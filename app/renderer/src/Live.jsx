// LIVE mode workstation — Claude conversation + setups/trades rail.

import React, { useState as useStateL, useEffect as useEffectL, useRef as useRefL } from "react";
import { Panel, Row, Grade, PillarsPanel, SetupCard, TradeCard, ClaudeFeed, SectionHead } from "./Shared.jsx";
import { useChat } from "./hooks/useChat.js";
import { useActiveSetup } from "./hooks/useActiveSetup.js";
import { useTrades } from "./hooks/useTrades.js";
import { useOpenReaction } from "./hooks/useOpenReaction.js";
import { useSetupsHistory } from "./hooks/useSetupsHistory.js";
import { useLastBar } from "./hooks/useLastBar.js";

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

// #51 Outcome derivation as a tiny lookup table — simpler than 5 nested
// conditionals. closed-with-outcome takes priority; otherwise we look
// at state + tp1_hit.
const OUTCOME_MAP = {
  TP1_HIT: { key: "tp1", label: "● TP1 HIT" },
  TP2_HIT: { key: "tp2", label: "● TP2 HIT" },
  STOPPED: { key: "stopped", label: "● STOPPED" },
  INVALIDATED: { key: "invalidated", label: "● INVALIDATED" },
};
function deriveOutcome(t) {
  if (t.outcome && OUTCOME_MAP[t.outcome]) return OUTCOME_MAP[t.outcome];
  if (t.state === "pending_entry") return { key: "open", label: "● PENDING ENTRY" };
  if (t.state === "filled" && t.tp1_hit) return { key: "tp1", label: "● TP1 HIT (runner)" };
  return { key: "open", label: "● OPEN" };
}

// #38 Show both $ and R when both are available, instead of forcing
// one-or-the-other.
function riskLabel(size) {
  if (!size) return "—";
  const dollars = size.dollar_risk != null ? `$${size.dollar_risk}` : null;
  const r = size.r_unit != null ? `${size.r_unit} R` : null;
  if (dollars && r) return `${dollars} · ${r}`;
  return dollars || r || "—";
}

// #23 Stale-fill indicator — if a filled trade hasn't progressed in
// STALE_FILL_MIN minutes, surface a hint. "Progressed" means filled_ts
// or accepted_ts is older than the threshold and no tp1_hit yet.
const STALE_FILL_MIN = 60;
function staleFillNote(t) {
  if (t.state !== "filled" || t.tp1_hit) return "";
  const stampStr = t.filled_ts || t.ts;
  if (!stampStr) return "";
  const ageMin = Math.floor((Date.now() - new Date(stampStr).getTime()) / 60000);
  if (ageMin < STALE_FILL_MIN) return "";
  return `stale fill: ${ageMin}m without TP1`;
}

// #55 Live price relative to targets. Computes distance + closeness to
// each level so the TradeCard can render "live: 21503 · TP1 12 away".
function liveRelative(t, lastClose) {
  if (typeof lastClose !== "number" || !Number.isFinite(lastClose) || !t) return null;
  const fmt = (n) => Number(n.toFixed(2));
  const distTo = (target) => {
    const x = Number(target);
    if (!Number.isFinite(x)) return null;
    return fmt(t.side === "long" ? x - lastClose : lastClose - x);
  };
  return {
    lastClose: fmt(lastClose),
    toTP1: distTo(t.tp1),
    toTP2: distTo(t.tp2),
    toStop: distTo(t.stop),
  };
}

// #60 Pending-entry timer — minutes since accept ts.
// #61 BE flash — adaptTakenTrade now sets stopMovedToBE when tp1_hit
// flipped recently; TradeCard renders a brief flash class.
function adaptTakenTrade(t, lastClose) {
  if (!t) return null;
  const sizeLabel = t.size?.label || (t.size?.contracts != null ? `${t.size.contracts}c` : "—");
  const outcome = deriveOutcome(t);
  const stale = staleFillNote(t);
  // #60 Pending-entry timer.
  let pendingMin = null;
  if (t.state === "pending_entry" && t.ts) {
    pendingMin = Math.floor((Date.now() - new Date(t.ts).getTime()) / 60000);
  }
  // #55 Live price relative to targets.
  const live = liveRelative(t, lastClose);
  // #61 BE flash — true when tp1_hit was just set (within last 60s).
  // We approximate by looking at ts of the most-recent TP1_HIT event;
  // without that, fall back to "show flash if tp1_hit and trade is
  // still open (filled state)".
  const beFlash = !!t.tp1_hit && t.state === "filled";
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
    risk: riskLabel(t.size),
    pnl: t.r_realized != null ? `${t.r_realized > 0 ? "+" : ""}${t.r_realized} R` : "—",
    pnlPositive: t.r_realized > 0,
    pnlNegative: t.r_realized < 0,
    outcome: outcome.key,
    outcomeLabel: outcome.label,
    statusNote: stale ||
      (t.tp1_hit ? "runner: stop at BE" : "") ||
      (pendingMin != null && pendingMin >= 1 ? `pending entry · ${pendingMin}m waiting` : ""),
    setupId: t.setup_id || null,
    live,
    beFlash,
    taken: t.ts ? new Date(t.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/New_York" }) + " ET" : "",
  };
}

function EntryHunt({ loopDown, loopStale, noSetups, alerts, onArmPrice }) {
  // Real chat state + surfaced setup via the Agent SDK.
  const { messages, typing, send: submit, cancel, reset, queuedBehind } = useChat();
  const { activeSetup, noTradeReason, noTradeReasonTs, clearSetup } = useActiveSetup();
  const { activeTrade, accept: acceptApi, reject: rejectApi, rejected, pnl } = useTrades();
  const { close: lastClose } = useLastBar();
  // #59 / #60 Tick every 30s so the setup-age / pending-entry labels
  // refresh even when no chat / bar activity drives a re-render.
  const [, setTick] = useStateL(0);
  useEffectL(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const setup = adaptSurfacedSetup(activeSetup);
  const takenTrade = adaptTakenTrade(activeTrade, lastClose);
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
                   count={takenTrade ? "1 active"
                          : setup ? "1 candidate"
                          : noTradeReason ? "no-trade"
                          : "0 candidate"} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {takenTrade && (
          <TradeCard trade={takenTrade} showSnapshot={false} />
        )}
        {!takenTrade && setup && (
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
          if (takenTrade || setup || !noTradeReason) return null;
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
          if (takenTrade || setup) return null;
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
      <EntryHunt loopDown={loopDown} loopStale={loopStale} noSetups={noSetups}
                 alerts={alerts}
                 onArmPrice={onArmPrice} />
    </div>
  );
}

export { LiveWorkstation };
