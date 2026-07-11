// ReviewPage — ⌘3. Native review dashboard split into three explicit truth
// domains (Task C4):
//   EXECUTED — real broker fills (money that moved): per-trade metrics, equity
//              curve, plan-vs-actual for the session, per-account ledger.
//   JOURNAL  — the deterministic walker journal (SIMULATED R, NOT executed):
//              graded candidate ledger + evidence-chain drill-down + a
//              discrepancy strip that reconciles the journal against the fills.
//   BACKTEST — the corpus fold (historical replay), labeled as such.
// A simulated / journaled R can NEVER be shown as an executed one — every panel
// carries its domain banner and a copy-contract test guards the labels.
// Every number flows through the proven Review.helpers + hooks; nothing fabricated.

import React, { useState, useMemo } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS, PAGE_FOOT } from "../shell.constants.js";
import { clickable, tab } from "../../a11y.js";
import { useReview } from "../../hooks/useReview.js";
import { useCoach } from "../../hooks/useCoach.js";
import { useFills } from "../../hooks/useFills.js";
import { useBaseline } from "../../hooks/useBaseline.js";
import { useBrokerAccount } from "../../hooks/useBrokerAccount.js";
import { Row } from "../../Shared.jsx";
import {
  buildLedger, formatGradeShort, buildTrackRecordFromFills, degradedChainStages, computeFaithfulness,
  buildTrackRecordByAccount, REVIEW_DOMAINS, buildEvidenceChain, computeDiscrepancies, assignFillsToTrades,
  critiqueViewModel, critiqueMetaLabel, coachViewModel,
} from "../../Review.helpers.js";
import "../../cs/review.css";

const TABS = [["EXECUTED", "EXECUTED"], ["JOURNAL", "JOURNAL"], ["BACKTEST", "BACKTEST"]];
const gTone = (g) => (g === "A+" ? "green" : g === "B" ? "amber" : "dim");
const sessionShort = (s) => ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" }[s] ?? (s ?? ""));
const signed = (n) => (n > 0 ? "+" : "") + n; // no double sign on negatives

// Domain provenance banner — makes the source of every number on the tab
// unmistakable (PRODUCT.md #3). Copy comes straight from REVIEW_DOMAINS.
function DomainBanner({ domain }) {
  return (
    <div className={"cs-domain-banner d-" + domain.key.toLowerCase()} title={domain.note}>
      <span className="cs-domain-banner__lbl">{domain.label}</span>
      <span className="cs-domain-banner__src">{domain.source}</span>
      <span className="cs-domain-banner__note">{domain.note}</span>
    </div>
  );
}

function Card({ title, meta, right, className, children }) {
  return (
    <div className={"cs-cell card" + (className ? " " + className : "")}>
      <div className="cs-cell-hd"><span className="cs-cell-label">{title}</span>{meta && <span className="cs-cell-meta">{meta}</span>}{right && <span className="cs-cell-right">{right}</span>}</div>
      {children}
    </div>
  );
}

// ── Journal candidate ledger (SIMULATED) + evidence-chain drill-down ────────
function EvidenceDrill({ evidence }) {
  if (!evidence) return null;
  const { chain, discrepancies } = evidence;
  return (
    <div className="cs-evchain">
      <div className="cs-evchain-hops">
        {chain.map((h) => (
          <span key={h.key} className={"cs-evhop" + (h.available ? " ok" : " miss")} title={h.detail || (h.available ? "" : "no record for this hop")}>
            {h.label}{h.available && h.detail ? ` · ${h.detail}` : h.available ? "" : " ✕"}
          </span>
        ))}
      </div>
      {discrepancies.length > 0 && (
        <div className="cs-evdisc">
          {discrepancies.map((d, i) => (
            <span key={i} className="cs-evdisc-chip" title={d.detail}>{d.kind.replace(/_/g, " ")}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerRow({ row, brief, evidence, expanded, onToggle }) {
  const s = row.setup || {};
  const t = row.setup?.ts ? new Date(row.setup.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" }) : "—";
  const grade = formatGradeShort(s.grade || s.grade_capped);
  const side = (s.side || "").toUpperCase();
  const model = (s.model || "").toUpperCase();
  const marks = computeFaithfulness(s, row.trade, brief).marks || ["na", "na", "na"];
  const hasDisc = evidence?.discrepancies?.length > 0;
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
        {hasDisc && <span className="cs-disc-dot" title="broker/journal discrepancy">⚠</span>}
        <span className="rsn">{row.reason}</span>
      </div>
      {expanded && (
        <div className="cs-lexp">
          {row.trade && (
            <div className="cs-lexp-nums">
              <span>entry <b>{row.trade.entry ?? s.entry ?? "—"}</b></span>
              <span>stop <b>{row.trade.stop ?? s.stop ?? "—"}</b></span>
              <span>tp1 <b>{row.trade.tp1 ?? s.tp1 ?? "—"}</b></span>
              {row.trade.outcome && <span>outcome <b className={/tp|confirm/i.test(row.trade.outcome) ? "up" : /stop|invalid/i.test(row.trade.outcome) ? "down" : ""}>{row.trade.outcome}</b></span>}
            </div>
          )}
          <EvidenceDrill evidence={evidence} />
        </div>
      )}
    </>
  );
}

function Ledger({ ledger, brief, evidenceFor }) {
  const [open, setOpen] = useState(null);
  if (!ledger.length) return <div className="cs-empty">no candidates this session</div>;
  return (
    <div className="cs-ledger">
      {ledger.map((row, i) => (
        <LedgerRow key={row.setup?.id ?? i} row={row} brief={brief}
                   evidence={row.expandable ? evidenceFor?.(row) : null}
                   expanded={open === i} onToggle={() => setOpen(open === i ? null : i)} />
      ))}
    </div>
  );
}

// Latest durable intent per decision_id (pure last-wins fold — mirrors main's
// foldIntents but kept renderer-local so we never bundle main-process code).
function latestIntentByDecision(intents = []) {
  const m = new Map();
  for (const r of intents || []) {
    if (r && typeof r === "object" && r.decision_id) m.set(r.decision_id, r);
  }
  return m;
}
// Fill↔trade assignment for the evidence chain lives in Review.helpers.js
// (bounded window + 1:1, no misattribution) — see assignFillsToTrades.

// ── JOURNAL tab (SESSION folds in here) ────────────────────────────────────
function JournalTab({ journal, coach, coachCurrentHash, coachInFlight, onGenerateCoach }) {
  if (!journal) return <div className="cs-empty" style={{ margin: "auto", padding: 40 }}>no journal yet for the active session</div>;
  const ledger = buildLedger(journal.setups || [], journal.trades || []);
  const grade = journal.brief?.pillar_grade || "—";
  const accepted = ledger.filter((r) => r.setup?._disposition === "accepted").length;
  const wins = ledger.filter((r) => r.state?.tone === "green").length;
  const losses = ledger.filter((r) => r.state?.tone === "red").length;
  const wrap = journal.summary?.bias_picture || journal.brief?.brief || "no wrap yet for this session.";
  const degraded = degradedChainStages(journal.summary?.chain_audit);
  const closes = journal.closes ?? [];
  // Track 2 §2b item 1: the review turn's session critique (SIMULATED/journal
  // narrative). Absent → the card doesn't render (no empty-state noise).
  const critique = useMemo(() => critiqueViewModel(journal.critique), [journal.critique]);
  // Coach narration (Track 2 §2b item 2) — cross-session read, rendered below
  // the critique. Absent → no card. Kept alongside the other JOURNAL useMemos
  // so the hook order matches the early-return guard above.
  const coachVm = useMemo(() => coachViewModel(coach, { currentHash: coachCurrentHash }), [coach, coachCurrentHash]);
  const onExport = () => window.api?.review?.exportSession?.(journal.date, journal.session).catch(() => {});

  // Evidence + discrepancy join: intent by exact decision_id; fill via a
  // bounded, 1:1 assignment (no misattribution across same-side trades).
  const intentMap = useMemo(() => latestIntentByDecision(journal.intents), [journal.intents]);
  const fillMap = useMemo(() => assignFillsToTrades(journal.trades || [], journal.fills || []), [journal.trades, journal.fills]);
  const evidenceFor = useMemo(() => (row) => {
    const trade = row.trade;
    if (!trade) return null;
    const intent = trade.decision_id ? intentMap.get(trade.decision_id) || null : null;
    const fill = fillMap.get(trade.id) || null;
    const chain = buildEvidenceChain({ fill, intent, journalTrade: trade, reconcile: null });
    const discrepancies = computeDiscrepancies({ fill, intent, journalTrade: trade, reconcile: null });
    return { chain, discrepancies };
  }, [intentMap, fillMap]);

  // Session-wide discrepancy roll-up for the strip.
  const discSummary = useMemo(() => {
    const counts = {};
    for (const row of ledger) {
      if (!row.expandable) continue;
      for (const d of evidenceFor(row)?.discrepancies || []) counts[d.kind] = (counts[d.kind] || 0) + 1;
    }
    return counts;
  }, [ledger, evidenceFor]);
  const discKinds = Object.keys(discSummary);

  const cells = [
    ["RESULT", `${wins}W · ${losses}L`, wins > losses ? "green" : losses > wins ? "red" : "value"],
    ["SETUPS", String(ledger.length), "value"],
    ["ACCEPTED", String(accepted), "value"],
    ["GRADE", formatGradeShort(grade), gTone(grade)],
  ];
  return (
    <div className="cs-dash">
      <DomainBanner domain={REVIEW_DOMAINS.JOURNAL} />
      <div className="cs-coach-hd">
        <span className="cs-coach-hd__lbl">COACH · recent-performance read</span>
        <button type="button" className="cs-coach-btn cs-btn-ghost-sm" disabled={coachInFlight}
                onClick={() => onGenerateCoach?.()}
                title="LLM prose over your last sessions — numbers stay deterministic">
          {coachInFlight ? "COACHING…" : coachVm ? "REGENERATE" : "COACH READ"}
        </button>
      </div>
      {degraded.length > 0 && <div className="chain-degraded">{`CHAIN DEGRADED — ${degraded.map((d) => `${d.stage}: ${d.status}`).join(" · ")}`}</div>}
      <div className={"cs-disc-strip" + (discKinds.length ? " has" : " clean")}>
        {discKinds.length
          ? <>⚠ BROKER/JOURNAL DISCREPANCIES · {discKinds.map((k) => `${k.replace(/_/g, " ")} ×${discSummary[k]}`).join(" · ")}</>
          : <>✓ no broker/journal discrepancies this session</>}
      </div>
      <div className="cs-cells">
        {cells.map(([k, v, tone]) => (
          <div className="cs-cell" key={k}><div className="cs-cell-label">{k}</div><div className={"cs-cell-val " + tone}>{v}</div></div>
        ))}
      </div>
      <div className="cs-band">
        <Card title="CLAUDE'S WRAP" className="wrap">
          <p className="cs-wrap-text">{wrap}</p>
        </Card>
        <Card title="SETUPS · GRADED (SIMULATED)" meta={`${ledger.length} candidates`}
              right={<span className="cs-btn-ghost-sm" {...clickable(onExport)}>EXPORT JSON</span>}>
          <Ledger ledger={ledger} brief={journal.brief} evidenceFor={evidenceFor} />
        </Card>
      </div>
      {critique && (
        <div className="cs-band">
          <Card title="CLAUDE'S SESSION CRITIQUE" className="critique" meta={critiqueMetaLabel(critique)}>
            {critique.paragraphs.map((p, i) => (
              <p key={i} className="cs-wrap-text">{p}</p>
            ))}
          </Card>
        </div>
      )}
      {coachVm && (
        <div className="cs-band">
          <Card title="CLAUDE'S COACH READ" className="coach" meta={critiqueMetaLabel(coachVm)}
                right={coachVm.stale ? <span className="cs-coach-stale" title="the numbers moved since this read — regenerate for a fresh one">STALE · REGENERATE</span> : null}>
            {coachVm.paragraphs.map((p, i) => (
              <p key={i} className="cs-wrap-text">{p}</p>
            ))}
          </Card>
        </div>
      )}
      {closes.length > 0 && (
        <div className="cs-band">
          <Card title="CLOSED TRADES · AUTO-JOURNAL" meta={`${closes.length} rows`}>
            {closes.map((c) => (
              <div key={c.id} className="jr-row">
                <span className="jr-row-ts">{String(c.ts ?? "").slice(11, 16)}</span>
                <span className={"cs-dir " + (c.side === "buy" ? "long" : "short")}>{c.side === "buy" ? "long" : "short"}</span>
                <span className="jr-row-sym">{c.qty ?? ""} {String(c.symbol ?? "").replace(/1!$/, "")}</span>
                <span className="jr-row-px">{c.entry ?? "—"} → {c.exit ?? "—"}</span>
                <span className={"jr-row-r " + (c.r > 0 ? "up" : c.r < 0 ? "down" : "")}>{c.r != null ? `${c.r > 0 ? "+" : ""}${c.r}R` : "—"}</span>
                <span className="jr-row-note" title={c.note || ""}>{c.note || ""}</span>
                {c.screenshot ? <span className="jr-row-shot" title={c.screenshot}>▣</span> : <span className="jr-row-shot dim" />}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

// ── EXECUTED tab — real broker fills (harvested from the retired ReviewPopover) ─
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

// Plan-vs-actual for the picked session's executed fills (harvested).
function SessionFillsPanel({ fills }) {
  if (!fills || fills.length === 0) return null;
  const cumR = Math.round(fills.reduce((s, f) => s + (Number(f?.actual?.r) || 0), 0) * 100) / 100;
  const cumUsd = Math.round(fills.reduce((s, f) => s + (Number(f?.actual?.usd) || 0), 0));
  return (
    <Card title="EXECUTED FILLS · PLAN vs ACTUAL"
          meta={`${fills.length} fill${fills.length === 1 ? "" : "s"} · ${cumR > 0 ? "+" : ""}${cumR}R · ${cumUsd >= 0 ? "+" : ""}$${cumUsd}`}>
      {fills.map((f, i) => {
        const a = f.actual || {}, p = f.planned || {};
        const sideCls = (f.side === "long" || f.side === "buy") ? "up" : "down";
        return (
          <div key={i} className="cs-fill-pva">
            <div className="cs-fill-pva__hd">
              <span className={"side " + sideCls}>{(f.side || "").toUpperCase()}</span>
              <span className="sym">{(f.symbol || "").replace("CME_MINI:", "")} · {f.qty}c</span>
              <span className={"pl " + (a.r > 0 ? "up" : a.r < 0 ? "down" : "")}>{a.r > 0 ? "+" : ""}{a.r ?? "—"}R · {a.usd >= 0 ? "+" : ""}${a.usd ?? "—"}</span>
            </div>
            <Row k="Planned E/S/T" v={`${p.entry ?? "—"} / ${p.stop ?? "—"} / ${p.tp ?? "—"}`} />
            <Row k="Actual fill→exit" v={`${a.entry ?? "—"} → ${a.exit ?? "—"}`} tone={a.r > 0 ? "ok" : a.r < 0 ? "bad" : ""} />
          </div>
        );
      })}
    </Card>
  );
}

function AccountTradeRow({ t }) {
  const a = t.actual || {};
  const sideCls = (t.side === "long" || t.side === "buy") ? "l" : "s";
  const sym = (t.symbol || "").replace(/^[A-Z_]+:/, "");
  const time = t.ts
    ? new Date(t.ts).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })
    : "—";
  const rTone = a.r > 0 ? "var(--green)" : a.r < 0 ? "var(--red)" : "var(--label)";
  const usdTone = a.usd > 0 ? "var(--green)" : a.usd < 0 ? "var(--red)" : "var(--label)";
  return (
    <div className="acct-trade">
      <span className="att-t">{time}</span>
      <span className={"att-side " + sideCls}>{(t.side || "").toUpperCase()}</span>
      <span className="att-sym">{sym}<span className="att-qty">{t.qty}c</span></span>
      <span className="att-px">{a.entry ?? "—"} <span className="arr">→</span> {a.exit ?? "—"}</span>
      <span className="att-pl">
        {a.r != null && <span style={{ color: rTone }}>{a.r > 0 ? "+" : ""}{a.r}R</span>}
        <span style={{ color: usdTone }}>{a.usd >= 0 ? "+" : ""}${a.usd ?? "—"}</span>
      </span>
    </div>
  );
}

function AccountGroup({ acct, expanded, onToggle }) {
  const empty = acct.n_trades === 0;
  const rTone = acct.net_r == null ? "var(--label)" : acct.net_r > 0 ? "var(--green)" : acct.net_r < 0 ? "var(--red)" : "var(--label)";
  const usdTone = acct.net_usd > 0 ? "var(--green)" : acct.net_usd < 0 ? "var(--red)" : "var(--label)";
  return (
    <div className={"acct-group" + (expanded ? " open" : "") + (empty ? " empty" : "")}>
      <button type="button" className="acct-head"
              onClick={empty ? undefined : onToggle} disabled={empty}
              aria-expanded={empty ? undefined : expanded}>
        <span className="ah-caret" aria-hidden="true">{empty ? "·" : expanded ? "▾" : "▸"}</span>
        <span className="ah-name">{acct.name}</span>
        {/* broker tag adds nothing when it just repeats the account name */}
        {(acct.armed || String(acct.broker || "").toUpperCase() !== String(acct.name || "").toUpperCase()) &&
          <span className={"ah-tag" + (acct.armed ? " armed" : "")}>{acct.armed ? "ARMED" : String(acct.broker || "").toUpperCase()}</span>}
        <span className="ah-sum">
          <span className="ah-n">{empty ? "no fills here" : `${acct.n_trades} trade${acct.n_trades === 1 ? "" : "s"}`}</span>
          {acct.net_r != null && <span style={{ color: rTone }}>{acct.net_r > 0 ? "+" : ""}{acct.net_r}R</span>}
          {!empty && <span style={{ color: usdTone }}>{acct.net_usd >= 0 ? "+" : ""}${acct.net_usd}</span>}
        </span>
      </button>
      {expanded && !empty && (
        <div className="acct-body">
          <div className="acct-stat">
            <span>{acct.win_pct}% win</span>
            <span>payoff {acct.payoff.toFixed(2)}×</span>
            <span style={{ color: "var(--green)" }}>+{acct.avg_win.toFixed(2)}R</span>
            <span style={{ color: "var(--red)" }}>{acct.avg_loss.toFixed(2)}R</span>
            <span style={{ color: "var(--red)" }}>DD {acct.max_drawdown_r.toFixed(1)}R</span>
          </div>
          {acct.trades.map((t, i) => <AccountTradeRow key={i} t={t} />)}
        </div>
      )}
    </div>
  );
}

function AccountLedger({ fills }) {
  const { acct } = useBrokerAccount();
  const confirmed = acct?.confirmed || null;
  const groups = buildTrackRecordByAccount(fills, confirmed);
  const armedId = groups.find((g) => g.armed)?.accountId;
  const [open, setOpen] = useState(null);
  const openSet = open ?? new Set(armedId ? [armedId] : []);
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev ?? (armedId ? [armedId] : []));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <Card title="ACCOUNTS" meta={`${groups.length} account${groups.length === 1 ? "" : "s"} · click to expand`}>
      {groups.length === 0 && <div className="cs-empty">no executed trades yet</div>}
      {groups.map((g) => (
        <AccountGroup key={g.accountId} acct={g}
                      expanded={openSet.has(g.accountId)}
                      onToggle={() => toggle(g.accountId)} />
      ))}
    </Card>
  );
}

function ExecutedTab({ allFills, sessionFills }) {
  const tr = buildTrackRecordFromFills(allFills);
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
      <DomainBanner domain={REVIEW_DOMAINS.EXECUTED} />
      <div className="cs-stat-cells">
        {cells.map(([k, v, tone]) => (
          <div className="cs-stat-cell" key={k}><div className="k">{k}</div><div className={"v " + tone}>{v}</div></div>
        ))}
      </div>
      {/* $ sums ALL fills; R metrics only cover bracketed round-trips that
          recorded an R — when the two denominators diverge, say so instead of
          letting the headline read as a contradiction. */}
      {tr.n_fills > tr.n_trades && (
        <div className="cs-stat-note">
          $ covers all {tr.n_fills} fills · R metrics cover the {tr.n_trades} bracketed trade{tr.n_trades === 1 ? "" : "s"} that recorded an R
        </div>
      )}
      <div className="cs-equity-wrap">
        <Card title="EQUITY CURVE · CUMULATIVE R" meta={`max DD ${tr.max_drawdown_r}R`}>
          <EquityCurve fills={allFills} />
          <div className="cs-eqfoot">
            <span>best <b className="up">{signed(tr.best_r)}R</b></span>
            <span>worst <b className="down">{signed(tr.worst_r)}R</b></span>
            <span>avg win <b>{signed(tr.avg_win)}R</b></span>
            <span>avg loss <b>{signed(tr.avg_loss)}R</b></span>
          </div>
        </Card>
      </div>
      <div className="cs-band">
        <SessionFillsPanel fills={sessionFills} />
        <AccountLedger fills={allFills} />
      </div>
    </div>
  );
}

// ── BACKTEST tab — corpus fold aggregates ──────────────────────────────────
function BacktestTab({ symbol }) {
  const { baseline, loading } = useBaseline(symbol);
  if (loading) return <div className="cs-empty" style={{ margin: "auto", padding: 40 }}>loading corpus fold…</div>;
  if (!baseline) return (
    <div className="cs-dash">
      <DomainBanner domain={REVIEW_DOMAINS.BACKTEST} />
      <div className="cs-empty" style={{ margin: "auto", padding: 40 }}>no corpus fold baseline for {symbol}. Run one from the Backtest page (⌘4).</div>
    </div>
  );
  const totalR = Number(baseline.total_r);
  const cells = [
    ["SYMBOL", symbol, "value"],
    ["SESSIONS", String(baseline.corpus?.n_sessions ?? "—"), "value"],
    ["FOLD R", (totalR >= 0 ? "+" : "") + (Number.isFinite(totalR) ? totalR : "—") + "R", totalR > 0 ? "green" : totalR < 0 ? "red" : "value"],
    ["CODE", baseline.code_sha ? String(baseline.code_sha).slice(0, 7) : "—", "value"],
  ];
  return (
    <div className="cs-dash">
      <DomainBanner domain={REVIEW_DOMAINS.BACKTEST} />
      <div className="cs-cells">
        {cells.map(([k, v, tone]) => (
          <div className="cs-cell" key={k}><div className="cs-cell-label">{k}</div><div className={"cs-cell-val " + tone}>{v}</div></div>
        ))}
      </div>
      <div className="cs-band">
        <Card title="CORPUS FOLD" meta={baseline.built_at ? `folded ${new Date(baseline.built_at).toLocaleString()}` : ""}>
          <p className="cs-wrap-text">Historical replay of the fold-week corpus — {baseline.corpus?.n_sessions ?? 0} sessions.
            This is a simulated fold, not executed trades. Open the Backtest page (⌘4) for per-run detail and fold-tests.</p>
        </Card>
      </div>
    </div>
  );
}

// Recent-session picker — only the domains that scope to one session use it.
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
export function ReviewPage({ onClose, symbol = "MNQ1!" }) {
  const [view, setView] = useState("JOURNAL");
  const [picked, setPicked] = useState({});
  const { journal, library } = useReview(picked);
  const { coach, currentHash: coachCurrentHash, inFlight: coachInFlight, generate: generateCoach } = useCoach();
  const { fills } = useFills("all");

  const tabs = (
    <span className="cs-tablist" role="tablist" aria-label="review domain">
      {TABS.map(([v, l]) => (
        <span key={v} className={"cs-tabpill" + (view === v ? " is-active" : "")}
              {...tab(() => setView(v), { selected: view === v, label: l })}>{l}</span>
      ))}
    </span>
  );
  return (
    <Page icon={PAGE_ICONS.review} tint="mute" title="Review" wide tabs={tabs} onClose={onClose}
          foot={<><span>{PAGE_FOOT}</span><span className="sp" /><span>rows expand · chart stays live behind</span></>}>
      {view !== "BACKTEST" && <SessionPicker library={library} picked={picked} onPick={setPicked} />}
      {view === "EXECUTED" && <ExecutedTab allFills={fills} sessionFills={journal?.fills || []} />}
      {view === "JOURNAL" && <JournalTab journal={journal} coach={coach} coachCurrentHash={coachCurrentHash} coachInFlight={coachInFlight} onGenerateCoach={generateCoach} />}
      {view === "BACKTEST" && <BacktestTab symbol={symbol} />}
    </Page>
  );
}
