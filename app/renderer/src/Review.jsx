// REVIEW mode workstation — Session journal, fed by real data on disk.
//
// Sources:
//   state/session/<date>/<session>/{brief.json, summary.json, setups.jsonl, trades.jsonl}
//
// Reads via window.api.review.* (see app/main/review.js).

import React, { useState } from "react";
import { Panel, Row, Grade, TradeCard, SectionHead } from "./Shared.jsx";
import { useReview } from "./hooks/useReview.js";

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
  const accepted = trades;       // every accepted setup ended up here
  const rejected = setups.filter((s) => s._disposition === "rejected" || s._disposition === "no-trade");

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

      <SectionHead title="ACCEPTED TRADES" count={accepted.length} />
      <div style={{ paddingTop: 4, paddingBottom: 4 }}>
        {accepted.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            <div style={{ color: "var(--label)", fontSize: 11 }}>no trades accepted this session</div>
          </div>
        ) : accepted.map((t) => <TradeCard key={t.id} trade={adaptTrade(t)} />)}
      </div>

      <SectionHead title="REJECTED / NO-TRADE" count={rejected.length} />
      <div className="panel-body flush" style={{ paddingTop: 2, paddingBottom: 6 }}>
        {rejected.length === 0 ? (
          <div className="empty-state" style={{ padding: 14 }}>
            <div style={{ color: "var(--label)", fontSize: 11 }}>no rejected setups</div>
          </div>
        ) : rejected.map((r) => (
          <div key={r.id || r.ts} className="level-row"
               style={{ gridTemplateColumns: "auto auto 1fr auto", padding: "6px 14px" }}>
            <Grade value={r.grade || "no-trade"} />
            <span style={{ color: "var(--label)", fontSize: 10.5, letterSpacing: ".08em" }}>
              {r.id || "—"}
            </span>
            <span style={{ color: "var(--value)", fontSize: 11 }}>
              <span style={{
                color: r.direction === "long" || r.side === "long" ? "var(--green)" : "var(--red)",
                letterSpacing: ".1em", marginRight: 8, fontSize: 10,
              }}>
                {String(r.direction || r.side || "").toUpperCase()}
              </span>
              <span style={{ color: "var(--label)", marginRight: 8 }}>{r.model || ""}</span>
              <span style={{ color: "var(--prose)" }}>
                {r._disposition === "no-trade" ? "no-trade discipline marker" : "rejected"}
              </span>
            </span>
            <span style={{ color: "var(--label-dim)", fontSize: 9.5, letterSpacing: ".08em" }}>
              {fmtTime(r.ts)}
            </span>
          </div>
        ))}
      </div>

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
