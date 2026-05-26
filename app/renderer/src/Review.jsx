// REVIEW mode workstation — Session journal, fed by real data on disk.
//
// Sources:
//   state/session/<date>/<session>/{brief.json, summary.json, setups.jsonl, trades.jsonl}
//
// Reads via window.api.review.* (see app/main/review.js).

import React, { useState } from "react";
import { Panel, Row, Grade, TradeCard, SectionHead } from "./Shared.jsx";
import { useReview } from "./hooks/useReview.js";
import { useAgentState } from "./hooks/useAgentState.js";
import {
  formatGradeShort,
  deriveLedgerState,
  deriveLedgerReason,
  buildLedger,
} from "./Review.helpers.js";

const SESSION_LABEL = { "ny-am": "NY AM", "ny-pm": "NY PM", "london": "LONDON" };

function fmtPx(n) {
  if (typeof n !== "number") return String(n ?? "");
  const [whole, dec = ""] = String(n).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }) + " ET";
  } catch { return ""; }
}

function fmtDateDisplay(yyyymmdd) {
  if (!yyyymmdd) return "";
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const mo = dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${wd} ${mo} ${d}`.toUpperCase();
}

// Export the current session's full journal as a single JSON file to
// the user's Downloads folder. Bundles brief + summary + setups + trades
// so the trader can open it in a spreadsheet or share for review.
function ExportButton({ date, session }) {
  const [state, setState] = useState("idle"); // idle | exporting | done | error
  const [msg, setMsg] = useState("");
  const onClick = async () => {
    if (!date || !session) return;
    setState("exporting");
    setMsg("");
    try {
      const res = await window.api?.review?.exportSession?.(date, session);
      if (res?.ok) {
        setState("done");
        setMsg(`Saved to ${res.path}`);
        setTimeout(() => setState("idle"), 4000);
      } else {
        setState("error");
        setMsg(res?.error || "export failed");
      }
    } catch (e) {
      setState("error");
      setMsg(String(e?.message || e));
    }
  };
  const label = state === "exporting" ? "[ EXPORTING… ]"
              : state === "done" ? "[ EXPORTED ]"
              : state === "error" ? "[ EXPORT FAILED ]"
              : "[ EXPORT JSON ]";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
      {msg && (
        <span style={{ color: state === "error" ? "var(--red)" : "var(--label)", fontSize: 9.5 }}>
          {msg.length > 60 ? "…" + msg.slice(-58) : msg}
        </span>
      )}
      <button onClick={onClick}
              disabled={state === "exporting"}
              title="export brief + summary + setups + trades as one JSON file to ~/Downloads"
              style={{
                background: "transparent",
                border: "1px solid var(--border, #2a3038)",
                color: state === "error" ? "var(--red)" : "var(--label)",
                padding: "2px 10px",
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 9.5,
                letterSpacing: ".14em",
                cursor: state === "exporting" ? "default" : "pointer",
              }}>
        {label}
      </button>
    </span>
  );
}

// Adapt the folded-trade record to the shape TradeCard expects.
function adaptTrade(t) {
  if (!t) return null;
  const sizeLabel = t.size?.label || (t.size?.contracts != null ? `${t.size.contracts}c` : "—");
  const outcome = t.outcome === "TP1_HIT" ? "tp1"
    : t.outcome === "TP2_HIT" ? "tp2"
    : t.outcome === "STOPPED" ? "stopped"
    : t.outcome === "INVALIDATED" ? "invalidated"
    : t.state === "filled" ? "open"
    : t.state === "pending_entry" ? "pending"
    : "open";
  const outcomeLabel = outcome === "tp1" ? "● TP1 HIT"
    : outcome === "tp2" ? "● TP2 HIT"
    : outcome === "stopped" ? "● STOPPED"
    : outcome === "invalidated" ? "● INVALIDATED"
    : outcome === "pending" ? "● PENDING ENTRY"
    : "● OPEN";
  return {
    id: t.id,
    grade: t.grade,
    side: t.side,
    model: t.model,
    entry: fmtPx(t.entry),
    stop: fmtPx(t.stop),
    tp1: fmtPx(t.tp1),
    tp2: fmtPx(t.tp2),
    rr: t.rr != null ? String(t.rr) : "—",
    size: sizeLabel,
    risk: t.size?.dollar_risk != null ? `$${t.size.dollar_risk}` : (t.size?.r_unit != null ? `${t.size.r_unit} R` : "—"),
    pnl: t.r_realized != null ? `${t.r_realized > 0 ? "+" : ""}${t.r_realized} R` : "—",
    pnlPositive: t.r_realized > 0,
    pnlNegative: t.r_realized < 0,
    outcome,
    outcomeLabel,
    statusNote: t.tp1_hit && t.outcome !== "TP2_HIT" ? "runner: stop at BE" : "",
    taken: fmtTime(t.ts),
  };
}

// Single chronological row in the CANDIDATE LEDGER. Used in the new
// REVIEW layout. State/reason are pre-computed by buildLedger so the
// component is render-only.
function LedgerRow({ row, expanded, onToggle }) {
  const { setup, state, reason, expandable } = row;
  const grade = setup.grade || "no-trade";
  const gradeClass = grade === "A+" ? "aplus" : grade === "B" ? "b" : "nt";
  const side = (setup.direction || setup.side || "").toLowerCase();
  const sideLabel = side ? side.toUpperCase() : "—";
  const ts = setup.ts
    ? new Date(setup.ts).toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York",
      }) + " ET"
    : "—";
  return (
    <div
      className={
        "ledger-row" +
        (expandable ? " expandable" : "") +
        (setup._disposition === "accepted" ? " accepted" : "")
      }
      onClick={expandable ? () => onToggle(setup.id) : undefined}
      title={reason}
    >
      <span className="ts">{ts}</span>
      <span className={"grade " + gradeClass}>{formatGradeShort(grade)}</span>
      <span className={"side " + (side === "long" ? "long" : side === "short" ? "short" : "")}>
        {sideLabel}
      </span>
      <span className="model">{setup.model || "—"}</span>
      <span className={"state " + state.tone}>{state.label}</span>
      <span className="reason">
        {reason}
        {expandable && <span className="caret">{expanded ? " ▾" : " ▸"}</span>}
      </span>
    </div>
  );
}

// Inline TradeCard wrapper rendered under an expanded ledger row.
function LedgerTradeExpand({ trade }) {
  if (!trade) return null;
  return (
    <div className="ledger-trade-expand">
      <TradeCard trade={adaptTrade(trade)} showSnapshot={false} />
    </div>
  );
}

// CANDIDATE LEDGER — the new chronological panel. Replaces the
// ACCEPTED TRADES and REJECTED / NO-TRADE blocks. Expand state is a
// local Set<setupId>.
function CandidateLedger({ setups, trades }) {
  const rows = buildLedger(setups, trades);
  const ignoredCount = (setups || []).filter((s) => s && s._disposition === "ignored").length;
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (rows.length === 0) {
    return (
      <>
        <SectionHead title="CANDIDATE LEDGER" count="0" />
        <div className="empty-state" style={{ padding: 14 }}>
          <div style={{ color: "var(--label)", fontSize: 11 }}>no candidates surfaced this session</div>
        </div>
      </>
    );
  }
  return (
    <>
      <SectionHead
        title="CANDIDATE LEDGER"
        count={
          ignoredCount > 0
            ? `${rows.length} · ${ignoredCount} ignored`
            : String(rows.length)
        }
      />
      <div className="panel-body flush">
        {rows.map((row) => {
          const isOpen = expanded.has(row.setup.id);
          return (
            <React.Fragment key={row.setup.id || row.setup.ts}>
              <LedgerRow row={row} expanded={isOpen} onToggle={toggle} />
              {isOpen && row.expandable && <LedgerTradeExpand trade={row.trade} />}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}

// AGENT STATE panel — three cards: USER.md viewer, MEMORY.md viewer,
// today's spend. Reads via useAgentState which refreshes on every
// turn_complete. The agent writes to memory only during chat/wrap/review
// turns; this panel is read-only.
function AgentState() {
  const { memory, usage, loading } = useAgentState();

  if (loading) {
    return (
      <Panel title="AGENT STATE">
        <div style={{ color: "var(--label)", fontSize: 11, padding: 4 }}>loading…</div>
      </Panel>
    );
  }

  const formatCost = (n) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return "$0.00";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  };

  return (
    <>
      <SectionHead title="AGENT STATE" count="memory · spend" />
      <MemoryCard label="USER PROFILE" hint="who the trader is" data={memory?.user} />
      <MemoryCard label="MEMORY" hint="cross-day lessons" data={memory?.memory} />
      <Panel title="TODAY'S SPEND">
        {!usage ? (
          <div style={{ color: "var(--label)", fontSize: 11, padding: 4 }}>no usage yet</div>
        ) : (
          <>
            <div className="rows-2">
              <Row k="Total cost" v={formatCost(usage.total_cost_usd)}
                   tone={usage.total_cost_usd > 5 ? "amber" : ""} />
              <Row k="Turns" v={String(usage.total_turns || 0)} />
              <Row k="Input tokens" v={fmtNum(usage.total_input)} />
              <Row k="Output tokens" v={fmtNum(usage.total_output)} />
              <Row k="Cache reads" v={fmtNum(usage.total_cache_read)} tone="dim" />
              <Row k="Cache writes" v={fmtNum(usage.total_cache_creation)} tone="dim" />
            </div>
            {Object.keys(usage.by_purpose || {}).length > 0 && (
              <>
                <div className="hr" />
                <div style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".14em", marginBottom: 4 }}>
                  BY PURPOSE
                </div>
                {Object.entries(usage.by_purpose).map(([purpose, slot]) => (
                  <div key={purpose} className="level-row"
                       style={{ gridTemplateColumns: "1fr auto auto", padding: "4px 0", borderBottom: "none" }}>
                    <span style={{ color: "var(--value)", fontSize: 11 }}>{purpose}</span>
                    <span style={{ color: "var(--label)", fontSize: 10.5, marginRight: 10 }}>
                      {slot.turns} turn{slot.turns === 1 ? "" : "s"}
                    </span>
                    <span style={{ color: "var(--value)", fontSize: 11 }}>{formatCost(slot.cost_usd)}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

function MemoryCard({ label, hint, data }) {
  if (!data) {
    return (
      <Panel title={label} right={<span style={{ color: "var(--label-dim)", fontSize: 10 }}>{hint}</span>}>
        <div style={{ color: "var(--label)", fontSize: 11, padding: 4 }}>nothing yet</div>
      </Panel>
    );
  }
  const { entries, char_count, char_limit, pct } = data;
  const barColor = pct >= 90 ? "var(--red)" : pct >= 70 ? "var(--amber)" : "var(--label)";
  return (
    <Panel
      title={label}
      right={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--label-dim)", fontSize: 10 }}>{hint}</span>
          <span style={{ color: "var(--label)", fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace" }}>
            {pct}% — {char_count.toLocaleString()}/{char_limit.toLocaleString()} chars
          </span>
        </span>
      }
    >
      <div style={{ position: "relative", height: 3, background: "var(--border-dim)", marginBottom: 10, borderRadius: 1 }}>
        <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${Math.min(100, pct)}%`, background: barColor, transition: "width 200ms ease" }} />
      </div>
      {entries.length === 0 ? (
        <div style={{ color: "var(--label)", fontSize: 11, padding: 4 }}>
          no entries yet — the agent will write here when it learns something durable
        </div>
      ) : (
        <div>
          {entries.map((e, i) => (
            <div key={i} style={{
              padding: "6px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--border-dim)",
              color: "var(--value)",
              fontSize: 11.5,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}>
              <span style={{ color: "var(--label-dim)", marginRight: 8, fontSize: 9.5 }}>{i + 1}</span>
              {e}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function fmtNum(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

function EmptyJournal({ session, sessions, onPick }) {
  return (
    <div className="work-scroll">
      <Panel title="REVIEW · NO SESSION DATA YET">
        <div style={{ color: "var(--label)", fontSize: 11.5, lineHeight: 1.6, marginBottom: 12 }}>
          No journal to review yet. Once a session brief, setup, or trade lands
          on disk, it will show up here automatically.
        </div>
        {sessions.length > 0 && (
          <div style={{ fontSize: 11 }}>
            <div style={{ color: "var(--label)", marginBottom: 6, letterSpacing: ".1em" }}>
              FOLDERS ON DISK
            </div>
            {sessions.slice(0, 5).map((s) => (
              <div key={s.date + s.session}
                   onClick={() => onPick(s)}
                   style={{ padding: "4px 0", cursor: "pointer", color: "var(--value)" }}>
                {s.date} · {SESSION_LABEL[s.session]}
              </div>
            ))}
          </div>
        )}
      </Panel>
      {/* Agent state is useful even on an empty journal day — memory and
          spend reflect cross-day activity that the journal doesn't cover. */}
      <AgentState />
    </div>
  );
}

function ReviewWorkstation() {
  const [pick, setPick] = useState(null);
  const { journal, sessions, library, loading } = useReview(pick || {});

  if (loading && !journal) {
    return (
      <div className="work-scroll">
        <div style={{ color: "var(--label)", fontSize: 11, padding: 16 }}>loading…</div>
      </div>
    );
  }

  if (!journal) {
    return <EmptyJournal sessions={sessions} onPick={setPick} />;
  }

  const { date, session, brief, summary, setups, trades, stats } = journal;

  return (
    <div className="work-scroll">
      <Panel title={`SESSION JOURNAL · ${SESSION_LABEL[session] || ""} · ${fmtDateDisplay(date)}`}
             right={<>
               <Grade value={brief?.pillar_grade || "no-trade"} />
               <span style={{ marginLeft: 8, color: "var(--label)", fontSize: 10 }}>
                 {date}
               </span>
               <ExportButton date={date} session={session} />
             </>}>
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }}>
          {summary?.bias_picture ||
            "_no summary yet — session may still be in progress or the wrap hasn't fired._"}
        </div>
        {summary?.what_happened && (
          <>
            <div style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".14em", marginTop: 10, marginBottom: 4 }}>
              WHAT HAPPENED
            </div>
            <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }}>
              {summary.what_happened}
            </div>
          </>
        )}
        <div className="hr" />
        <div className="rows-2">
          <Row k="Setups" v={String(stats.setups)} />
          <Row k="Accepted" v={String(stats.accepted)} />
          <Row k="Rejected" v={String(stats.rejected)} />
          <Row k="No-trade" v={String(stats.no_trade)} />
          <Row k="Wins" v={String(stats.wins)} tone={stats.wins > 0 ? "green" : ""} />
          <Row k="Losses" v={String(stats.losses)} tone={stats.losses > 0 ? "red" : ""} />
          <Row k="Net R" v={`${stats.net_r > 0 ? "+ " : stats.net_r < 0 ? "− " : ""}${Math.abs(stats.net_r)} R`}
               tone={stats.net_r > 0 ? "green" : stats.net_r < 0 ? "red" : ""} />
        </div>
      </Panel>

      <CandidateLedger setups={setups} trades={trades} />

      {summary?.watch_next_session?.length > 0 && (
        <>
          <SectionHead title="WATCH NEXT SESSION" count={`${summary.watch_next_session.length} notes`} />
          <div className="panel-body" style={{ padding: "8px 14px" }}>
            {summary.watch_next_session.map((w, i) => (
              <div key={i} style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6, marginBottom: 6 }}>
                <span style={{ color: "var(--amber)", letterSpacing: ".06em" }}>{i + 1}. </span>
                {w}
              </div>
            ))}
          </div>
        </>
      )}

      <AgentState />

      <SectionHead title="SESSION LIBRARY" count={`${library.length} entries`} />
      <div className="panel-body flush">
        {library.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            <div style={{ color: "var(--label)", fontSize: 11 }}>no past sessions yet</div>
          </div>
        ) : (
          <table className="lib">
            <thead>
              <tr>
                <th>DATE</th><th>SESSION</th><th>GRADE</th>
                <th style={{ textAlign: "right" }}>SETUPS</th>
                <th style={{ textAlign: "right" }}>ACCEPTED</th>
                <th style={{ textAlign: "right" }}>NET R</th>
              </tr>
            </thead>
            <tbody>
              {library.map((r) => {
                const cur = r.date === date && r.session === session;
                const tone = r.stats.net_r > 0 ? "green" : r.stats.net_r < 0 ? "red" : "dim";
                const netLabel = r.stats.net_r === 0 ? "—"
                  : `${r.stats.net_r > 0 ? "+ " : "− "}${Math.abs(r.stats.net_r)} R`;
                return (
                  <tr key={r.date + r.session}
                      className={cur ? "cur" : ""}
                      onClick={() => setPick({ date: r.date, session: r.session })}
                      style={{ cursor: "pointer" }}>
                    <td>{r.date}</td>
                    <td className="dim">{SESSION_LABEL[r.session] || r.session}</td>
                    <td><Grade value={r.grade || "no-trade"} /></td>
                    <td style={{ textAlign: "right" }}>{r.stats.setups}</td>
                    <td style={{ textAlign: "right" }}>{r.stats.accepted}</td>
                    <td className={tone} style={{ textAlign: "right" }}>{netLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export { ReviewWorkstation };
