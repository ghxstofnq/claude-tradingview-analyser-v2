// REVIEW mode workstation — Session journal.

import React from "react";
import { Panel, Row, Grade, TradeCard, SectionHead } from "./Shared.jsx";

function ReviewWorkstation() {
  const trades = [
    {
      id: "T-0427", grade: "A+", side: "long", model: "MSS reversal",
      entry: "21 487.25", stop: "21 472.00",
      tp1: "21 521.50", tp2: "21 548.00", rr: "3.1",
      size: "1 contract", risk: "$76.25 · 0.75 R",
      pnl: "+ $171.25", pnlPositive: true,
      outcome: "tp1", outcomeLabel: "● TP1 HIT",
      statusNote: "+2.25 R · runner stopped at BE",
      taken: "09:50:14 ET",
    },
    {
      id: "T-0428", grade: "B", side: "short", model: "Inversion",
      entry: "21 524.75", stop: "21 537.00",
      tp1: "21 502.00", tp2: "21 486.50", rr: "1.9",
      size: "1 contract", risk: "$61.25 · 0.50 R",
      pnl: "− $61.25", pnlNegative: true,
      outcome: "stopped", outcomeLabel: "● STOPPED",
      statusNote: "stop hit at 21 537.50",
      taken: "10:42:00 ET",
    },
  ];

  const rejected = [
    {
      id: "S-0429", grade: "B", side: "long", model: "Trend continuation",
      taken: "11:18 ET", reason: "low conviction · skipped during lunch chop",
    },
    {
      id: "S-0430", grade: "no-trade", side: "long", model: "MSS reversal",
      taken: "13:04 ET", reason: "no entry model in play",
    },
  ];

  const library = [
    { date: "MAY 25", session: "NY AM", grade: "A+", setups: 3, accepted: 1, result: "+ $171.25", tone: "green", cur: true },
    { date: "MAY 22", session: "NY PM", grade: "B",  setups: 2, accepted: 1, result: "+ $48.50",  tone: "green" },
    { date: "MAY 22", session: "NY AM", grade: "no-trade", setups: 1, accepted: 0, result: "—", tone: "dim" },
    { date: "MAY 21", session: "NY AM", grade: "A+", setups: 4, accepted: 2, result: "+ $312.00", tone: "green" },
    { date: "MAY 21", session: "LONDON", grade: "B", setups: 2, accepted: 1, result: "− $58.00", tone: "red" },
    { date: "MAY 20", session: "NY AM", grade: "B",  setups: 3, accepted: 1, result: "+ $94.75", tone: "green" },
    { date: "MAY 19", session: "NY AM", grade: "A+", setups: 2, accepted: 1, result: "+ $228.50", tone: "green" },
  ];

  return (
    <div className="work-scroll">
      <Panel title="SESSION JOURNAL · NY AM · MON MAY 25"
             right={<><Grade value="A+" /><span style={{ marginLeft: 8, color: "var(--label)", fontSize: 10 }}>09:30 → 11:30 ET</span></>}>
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 8 }}>
          HTF aligned long all day. ONL swept at 09:34, sharp reclaim, A+ MSS off
          the 5m FVG took TP1 cleanly. Mid-session B inversion short above PDH
          stopped — fair stop, marginal grade. Discipline held: no chasing,
          no revenge trade.
        </div>
        <div className="rows-2">
          <Row k="Setups" v="3" />
          <Row k="Accepted" v="2" />
          <Row k="Rejected" v="1" />
          <Row k="No-trade" v="1" />
          <Row k="Wins" v="1" tone="green" />
          <Row k="Losses" v="1" tone="red" />
          <Row k="Net P / L" v="+ $110.00" tone="green" />
          <Row k="Net R" v="+ 1.75 R" tone="green" />
        </div>
      </Panel>

      <SectionHead title="ACCEPTED TRADES" count={trades.length} />
      <div style={{ paddingTop: 4, paddingBottom: 4 }}>
        {trades.map((t) => <TradeCard key={t.id} trade={t} />)}
      </div>

      <SectionHead title="REJECTED / NO-TRADE" count={rejected.length} />
      <div className="panel-body flush" style={{ paddingTop: 2, paddingBottom: 6 }}>
        {rejected.map((r) => (
          <div key={r.id} className="level-row"
               style={{ gridTemplateColumns: "auto auto 1fr auto", padding: "6px 14px" }}>
            <Grade value={r.grade} />
            <span style={{ color: "var(--label)", fontSize: 10.5, letterSpacing: ".08em" }}>
              #{r.id}
            </span>
            <span style={{ color: "var(--value)", fontSize: 11 }}>
              <span style={{ color: r.side === "long" ? "var(--green)" : "var(--red)", letterSpacing: ".1em", marginRight: 8, fontSize: 10 }}>
                {r.side.toUpperCase()}
              </span>
              <span style={{ color: "var(--label)", marginRight: 8 }}>{r.model}</span>
              <span style={{ color: "var(--prose)" }}>{r.reason}</span>
            </span>
            <span style={{ color: "var(--label-dim)", fontSize: 9.5, letterSpacing: ".08em" }}>{r.taken}</span>
          </div>
        ))}
      </div>

      <SectionHead title="LESSONS" count="2 notes" />
      <div className="panel-body" style={{ padding: "8px 14px" }}>
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6, marginBottom: 8 }}>
          <span style={{ color: "var(--amber)", letterSpacing: ".06em" }}>1. </span>
          The 10:42 inversion short above PDH was marginal — pillar 2 was
          weak (no clear premium displacement). Should have been{" "}
          <em style={{color:"var(--amber)", fontStyle:"normal"}}>no-trade</em>, not B.
        </div>
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6 }}>
          <span style={{ color: "var(--amber)", letterSpacing: ".06em" }}>2. </span>
          Patience on the open paid off — waiting the full 12 minutes for the
          MSS reclaim gave a 3.1 R:R entry instead of front-running the sweep.
        </div>
      </div>

      <SectionHead title="SESSION LIBRARY" count={library.length + " entries"} />
      <div className="panel-body flush">
        <table className="lib">
          <thead>
            <tr>
              <th>DATE</th><th>SESSION</th><th>GRADE</th>
              <th style={{ textAlign: "right" }}>SETUPS</th>
              <th style={{ textAlign: "right" }}>ACCEPTED</th>
              <th style={{ textAlign: "right" }}>RESULT</th>
            </tr>
          </thead>
          <tbody>
            {library.map((r, i) => (
              <tr key={i} className={r.cur ? "cur" : ""}>
                <td>{r.date}</td>
                <td className="dim">{r.session}</td>
                <td><Grade value={r.grade} /></td>
                <td style={{ textAlign: "right" }}>{r.setups}</td>
                <td style={{ textAlign: "right" }}>{r.accepted}</td>
                <td className={r.tone} style={{ textAlign: "right" }}>{r.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { ReviewWorkstation };
