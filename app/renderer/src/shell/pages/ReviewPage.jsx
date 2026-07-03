// ReviewPage — ⌘3. Native review dashboard (PR3). Three tabs — SESSION (summary
// cells + Claude's wrap + graded candidate ledger), JOURNAL (the full ledger as
// a table), STATS (real per-trade metrics + equity curve). Every number flows
// through the proven Review.helpers + hooks; nothing fabricated.

import React, { useState, useMemo } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS, PAGE_FOOT } from "../shell.constants.js";
import { clickable } from "../../a11y.js";
import { useReview } from "../../hooks/useReview.js";
import { useFills } from "../../hooks/useFills.js";
import {
  buildLedger, formatGradeShort, buildTrackRecordFromFills, degradedChainStages, computeFaithfulness,
} from "../../Review.helpers.js";
import "../../cs/review.css";

const TABS = [["SESSION", "SESSION"], ["JOURNAL", "JOURNAL"], ["STATS", "STATS"]];
const gTone = (g) => (g === "A+" ? "green" : g === "B" ? "amber" : "dim");
const sessionShort = (s) => ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" }[s] ?? (s ?? ""));
const signed = (n) => (n > 0 ? "+" : "") + n; // no double sign on negatives

function Card({ title, meta, right, className, children }) {
  return (
    <div className={"cs-cell card" + (className ? " " + className : "")}>
      <div className="cs-cell-hd"><span className="cs-cell-label">{title}</span>{meta && <span className="cs-cell-meta">{meta}</span>}{right && <span className="cs-cell-right">{right}</span>}</div>
      {children}
    </div>
  );
}

// ── ledger row (shared by SESSION + JOURNAL) ───────────────────────────
function LedgerRow({ row, brief, expanded, onToggle }) {
  const s = row.setup || {};
  const t = row.setup?.ts ? new Date(row.setup.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) : "—";
  const grade = formatGradeShort(s.grade || s.grade_capped);
  const side = (s.side || "").toUpperCase();
  const model = (s.model || "").toUpperCase();
  const marks = computeFaithfulness(s, row.trade, brief).marks || ["na", "na", "na"];
  return (
    <>
      <div className={"cs-lrow" + (row.expandable ? " click" : "")} {...(row.expandable ? clickable(onToggle) : {})}>
        {row.expandable ? <span className="car">{expanded ? "▾" : "▸"}</span> : <span className="car dim">·</span>}
        <span className="ts">{t}</span>
        <span className={"cs-grade-mini " + gTone(s.grade || s.grade_capped)}>{grade}</span>
        <span className={"side " + (side === "LONG" ? "up" : side === "SHORT" ? "down" : "")}>{side || "—"}</span>
        <span className="model">{model}</span>
        <span className="cs-fmark" title="faithfulness: bias · price action · entry model">
          {marks.map((m, i) => <span key={i} className={"cs-fseg " + (m || "na")} />)}
        </span>
        <span className={"cs-st " + (row.state?.tone || "amber")}>{row.state?.label}</span>
        <span className="rsn">{row.reason}</span>
      </div>
      {expanded && row.trade && (
        <div className="cs-lexp">
          <span>entry <b>{row.trade.entry ?? s.entry ?? "—"}</b></span>
          <span>stop <b>{row.trade.stop ?? s.stop ?? "—"}</b></span>
          <span>tp1 <b>{row.trade.tp1 ?? s.tp1 ?? "—"}</b></span>
          {row.trade.outcome && <span>outcome <b className={/tp|confirm/i.test(row.trade.outcome) ? "up" : /stop|invalid/i.test(row.trade.outcome) ? "down" : ""}>{row.trade.outcome}</b></span>}
        </div>
      )}
    </>
  );
}

function Ledger({ ledger, brief }) {
  const [open, setOpen] = useState(null);
  if (!ledger.length) return <div className="cs-empty">no candidates this session</div>;
  return (
    <div className="cs-ledger">
      {ledger.map((row, i) => (
        <LedgerRow key={row.setup?.id ?? i} row={row} brief={brief} expanded={open === i} onToggle={() => setOpen(open === i ? null : i)} />
      ))}
    </div>
  );
}

// ── SESSION tab ────────────────────────────────────────────────────────
function SessionTab({ journal }) {
  if (!journal) return <div className="cs-empty" style={{ margin: "auto", padding: 40 }}>no journal yet for the active session</div>;
  const ledger = buildLedger(journal.setups || [], journal.trades || []);
  const grade = journal.brief?.pillar_grade || "—";
  const accepted = ledger.filter((r) => r.setup?._disposition === "accepted").length;
  // journal trades carry a STATUS string (not R); the W/L tally comes from the
  // ledger state tone. Realized $/R lives in the fills-based STATS tab.
  const wins = ledger.filter((r) => r.state?.tone === "green").length;
  const losses = ledger.filter((r) => r.state?.tone === "red").length;
  const wrap = journal.summary?.bias_picture || journal.brief?.brief || "no wrap yet for this session.";
  const degraded = degradedChainStages(journal.summary?.chain_audit);
  const onExport = () => window.api?.review?.exportSession?.(journal.date, journal.session).catch(() => {});
  const cells = [
    ["RESULT", `${wins}W · ${losses}L`, wins > losses ? "green" : losses > wins ? "red" : "value"],
    ["SETUPS", String(ledger.length), "value"],
    ["ACCEPTED", String(accepted), "value"],
    ["GRADE", formatGradeShort(grade), gTone(grade)],
  ];
  return (
    <div className="cs-dash">
      {degraded.length > 0 && <div className="chain-degraded">{`CHAIN DEGRADED — ${degraded.map((d) => `${d.stage}: ${d.status}`).join(" · ")}`}</div>}
      <div className="cs-cells">
        {cells.map(([k, v, tone]) => (
          <div className="cs-cell" key={k}><div className="cs-cell-label">{k}</div><div className={"cs-cell-val " + tone}>{v}</div></div>
        ))}
      </div>
      <div className="cs-band">
        <Card title="CLAUDE'S WRAP" className="wrap">
          <p className="cs-wrap-text">{wrap}</p>
        </Card>
        <Card title="SETUPS · GRADED" meta={`${ledger.length} candidates`}
              right={<span className="cs-btn-ghost-sm" {...clickable(onExport)}>EXPORT JSON</span>}>
          <Ledger ledger={ledger} brief={journal.brief} />
        </Card>
      </div>
    </div>
  );
}

// ── JOURNAL tab (the ledger as a table) ────────────────────────────────
function JournalTab({ journal }) {
  const ledger = journal ? buildLedger(journal.setups || [], journal.trades || []) : [];
  return (
    <div className="cs-dash">
      <div className="cs-band">
        <Card title={`CANDIDATE LEDGER · ${sessionShort(journal?.session)} · ${journal?.date ?? ""}`} meta={`${ledger.length} rows`}>
          <Ledger ledger={ledger} brief={journal?.brief} />
        </Card>
      </div>
    </div>
  );
}

// ── STATS tab (real per-trade metrics + equity curve) ──────────────────
function EquityCurve({ fills }) {
  const pts = useMemo(() => {
    const rs = (fills || []).filter((f) => f?.actual && typeof f.actual.r === "number").map((f) => f.actual.r);
    let eq = 0; const series = [0];
    for (const r of rs) { eq += r; series.push(eq); }
    return series;
  }, [fills]);
  if (pts.length < 2) return <div className="cs-empty">not enough closed trades for an equity curve</div>;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = (max - min) || 1;
  const W = 1000, H = 140, pad = 8;
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => pad + (max - v) / span * (H - 2 * pad);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const up = pts[pts.length - 1] >= 0;
  return (
    <div className="cs-equity">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polygon points={area} className={up ? "area up" : "area down"} />
        <polyline points={line} className={up ? "line up" : "line down"} />
      </svg>
    </div>
  );
}

function StatsTab({ fills }) {
  const tr = buildTrackRecordFromFills(fills);
  const cells = [
    ["NET P&L", (tr.cum_usd >= 0 ? "+$" : "-$") + Math.abs(tr.cum_usd).toLocaleString("en-US"), tr.cum_usd > 0 ? "green" : tr.cum_usd < 0 ? "red" : "value"],
    ["NET R", (tr.cum_r >= 0 ? "+" : "") + tr.cum_r + "R", tr.cum_r > 0 ? "green" : tr.cum_r < 0 ? "red" : "value"],
    ["WIN RATE", tr.win_pct + "%", "value"],
    ["PAYOFF", tr.payoff ? tr.payoff + "×" : "—", "value"],
    ["EXPECTANCY", (tr.expectancy >= 0 ? "+" : "") + tr.expectancy + "R", "value"],
    ["TRADES", String(tr.n_trades), "value"],
  ];
  return (
    <div className="cs-dash">
      <div className="cs-stat-cells">
        {cells.map(([k, v, tone]) => (
          <div className="cs-stat-cell" key={k}><div className="k">{k}</div><div className={"v " + tone}>{v}</div></div>
        ))}
      </div>
      <div className="cs-equity-wrap">
        <Card title="EQUITY CURVE · CUMULATIVE R" meta={`max DD ${tr.max_drawdown_r}R`}>
          <EquityCurve fills={fills} />
          <div className="cs-eqfoot">
            <span>best <b className="up">{signed(tr.best_r)}R</b></span>
            <span>worst <b className="down">{signed(tr.worst_r)}R</b></span>
            <span>avg win <b>{signed(tr.avg_win)}R</b></span>
            <span>avg loss <b>{signed(tr.avg_loss)}R</b></span>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Recent-session picker — pills for the last few library rows (matches the
// prototype's TODAY / <date> pills); STATS is cross-session so it's hidden there.
function SessionPicker({ library, picked, onPick }) {
  const recent = (library || []).slice(0, 6);
  if (!recent.length) return null;
  const active = (r) => picked?.date === r.date && picked?.session === r.session;
  const anyActive = recent.some(active);
  return (
    <div className="cs-picker">
      <span className={"cs-sesspill" + (!anyActive ? " is-active" : "")} {...clickable(() => onPick({}))}>LATEST</span>
      {recent.map((r) => (
        <span key={`${r.date}-${r.session}`} className={"cs-sesspill" + (active(r) ? " is-active" : "")}
              {...clickable(() => onPick({ date: r.date, session: r.session }))}
              title={`${r.date} · ${sessionShort(r.session)}`}>
          {sessionShort(r.session)} {String(r.date).slice(5)}
        </span>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
export function ReviewPage({ onClose }) {
  const [view, setView] = useState("SESSION");
  const [picked, setPicked] = useState({});
  const { journal, library } = useReview(picked);
  const { fills } = useFills("all");

  const tabs = TABS.map(([v, l]) => (
    <span key={v} className={"cs-tabpill" + (view === v ? " is-active" : "")} {...clickable(() => setView(v))}>{l}</span>
  ));
  return (
    <Page icon={PAGE_ICONS.review} tint="mute" title="Review" wide tabs={tabs} onClose={onClose}
          foot={<><span>{PAGE_FOOT}</span><span className="sp" /><span>rows expand · chart stays live behind</span></>}>
      {view !== "STATS" && <SessionPicker library={library} picked={picked} onPick={setPicked} />}
      {view === "SESSION" && <SessionTab journal={journal} />}
      {view === "JOURNAL" && <JournalTab journal={journal} />}
      {view === "STATS" && <StatsTab fills={fills} />}
    </Page>
  );
}
