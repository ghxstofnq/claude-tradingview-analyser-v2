// Pure helpers for Review.jsx — extracted so they can be unit-tested with
// `node --test`. Importing this file has no side effects.

// Format the grade value for the narrow ledger grade column.
// "no-trade" → "NO" (the full string wraps in the narrow column).
// Everything else passes through ("A+", "B").
export function formatGradeShort(grade) {
  if (grade === "no-trade") return "NO";
  if (grade == null) return "—";
  return String(grade);
}

// Derive the state string + tone for one ledger row.
// Inputs:
//   setup — annotated setup record from review.js getJournalFor
//   trade — matching folded trade (or null if not accepted)
// Output: { label, tone }
//   tone: "green" | "red" | "amber" | "blue" | "dim"
export function deriveLedgerState(setup, trade) {
  const disp = setup?._disposition;
  if (disp === "no-trade") return { label: "NO-TRADE", tone: "amber" };
  if (disp === "rejected") return { label: "REJECTED", tone: "red" };
  if (disp !== "accepted") return { label: "—", tone: "dim" };
  // Accepted — look at the matching trade outcome.
  const outcome = trade?.outcome;
  if (outcome === "TP1_HIT") return { label: "CONFIRMED · TP1", tone: "green" };
  if (outcome === "TP2_HIT") return { label: "CONFIRMED · TP2", tone: "green" };
  if (outcome === "STOPPED") return { label: "STOPPED", tone: "red" };
  if (outcome === "INVALIDATED") return { label: "INVALIDATED", tone: "red" };
  if (trade?.state === "pending_entry") return { label: "PENDING", tone: "blue" };
  if (trade?.state === "filled") return { label: "OPEN", tone: "blue" };
  return { label: "OPEN", tone: "blue" };
}

// Derive the reason string shown in the rightmost ledger column.
// For accepted rows the reason is short — the inline expansion carries
// the full TradeCard. For other rows we surface the no-trade / rejection
// reason so the trader can see why the row landed where it did.
export function deriveLedgerReason(setup, trade) {
  const disp = setup?._disposition;
  if (disp === "no-trade") {
    return setup.no_trade_reason || "no reason given";
  }
  if (disp === "rejected") {
    const r = setup._rejection_reason;
    return r && r.trim() ? r : "rejected · no reason given";
  }
  if (disp === "accepted") {
    const outcome = trade?.outcome;
    if (outcome === "STOPPED" || outcome === "INVALIDATED") {
      return outcome === "STOPPED" ? "stopped" : "invalidated";
    }
    // Default: a short label telling the trader the row is expandable.
    const model = setup.model || trade?.model || "";
    return model ? `${model} · click to expand` : "click to expand";
  }
  return "";
}

// Build the chronological ledger rows.
// Inputs:
//   setups — annotated array from review.js getJournalFor.
//   trades — folded trades array (from useReview.journal.trades).
// Output: [{ setup, trade, state, reason, expandable }]
//
// Rules:
//   - _disposition === "ignored" rows are suppressed.
//   - Rows are sorted by setup.ts ascending; setups missing ts keep
//     their insertion order at the front (defensive — pre-ts data).
//   - Only accepted rows are marked expandable.
//   - The matching trade is found by trade.setup_id === setup.id (when accepted).
export function buildLedger(setups = [], trades = []) {
  const tradesBySetupId = new Map();
  for (const t of trades) {
    if (t && t.setup_id) tradesBySetupId.set(t.setup_id, t);
  }
  const rows = (setups || [])
    .filter((s) => s && s._disposition !== "ignored")
    .map((s) => {
      const trade = s._disposition === "accepted"
        ? (tradesBySetupId.get(s.id) || null)
        : null;
      const state = deriveLedgerState(s, trade);
      const reason = deriveLedgerReason(s, trade);
      return {
        setup: s,
        trade,
        state,
        reason,
        expandable: s._disposition === "accepted" && !!trade,
      };
    });
  // Sort by ts ascending; missing ts keeps insertion order via stable sort.
  rows.sort((a, b) => {
    const ta = a.setup?.ts ? new Date(a.setup.ts).getTime() : Number.NEGATIVE_INFINITY;
    const tb = b.setup?.ts ? new Date(b.setup.ts).getTime() : Number.NEGATIVE_INFINITY;
    return ta - tb;
  });
  return rows;
}

// degradedChainStages — flatten a wrap's chain_audit into the stages that
// actually failed. Enum per CLAUDE.md rule 8: clean / degraded:<reason> /
// backfilled:<phase> / divergent / stale:<min>. Only degraded:* and stale:*
// are failures worth a red strip — divergent is a market verdict and
// backfilled means the chain recovered on its own.
// Honest TRACK RECORD summary over the session-library rows (no per-trade
// fabrication — every number is summed from real per-session totals).
// rows: [{ date, session, grade, total_r, stats:{setups,accepted} }].
// Returns the aggregates the designer's analytics hero/strip/concentration
// can honestly render. Per-trade cuts (expectancy/payoff/by-model) need a
// per-trade pipeline that doesn't exist yet, so they're deliberately absent.
export function buildTrackRecord(rows = []) {
  const r1 = (n) => Math.round(n * 10) / 10;
  // Per-session R lives in stats.net_r (the library row shape); total_r is a
  // forward-compat fallback. Every row is a real session — no-trade days
  // count as 0R sessions.
  const sessR = (r) => Number(r.stats?.net_r ?? r.total_r ?? 0) || 0;
  const list = (rows || []).filter(Boolean);
  const n = list.length;
  const cumR = r1(list.reduce((s, r) => s + sessR(r), 0));
  const wins = list.filter((r) => sessR(r) > 0);
  const losses = list.filter((r) => sessR(r) < 0);
  const best = list.reduce((m, r) => Math.max(m, sessR(r)), 0);
  const worst = list.reduce((m, r) => Math.min(m, sessR(r)), 0);
  const setupsTotal = list.reduce((s, r) => s + (r.stats?.setups || 0), 0);
  const acceptedTotal = list.reduce((s, r) => s + (r.stats?.accepted || 0), 0);

  const groupR = (keyFn) => {
    const m = new Map();
    for (const r of list) {
      const k = keyFn(r);
      const cur = m.get(k) || { k, r: 0, n: 0 };
      cur.r = r1(cur.r + sessR(r));
      cur.n += 1;
      m.set(k, cur);
    }
    return [...m.values()];
  };
  const sessLabel = (s) => ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" })[s] || s || "—";
  const bySession = groupR((r) => sessLabel(r.session));
  const byGrade = groupR((r) => r.grade || "—");

  return {
    n_sessions: n,
    cum_r: cumR,
    avg_r: n ? r1(cumR / n) : 0,
    win_sessions: wins.length,
    loss_sessions: losses.length,
    win_pct: n ? Math.round((100 * wins.length) / n) : 0,
    best_r: r1(best),
    worst_r: r1(worst),
    setups_total: setupsTotal,
    accepted_total: acceptedTotal,
    by_session: bySession,
    by_grade: byGrade,
  };
}

// Real TRACK RECORD from actual execution fills (state/trades records).
// Each fill: { side, symbol, account, planned:{entry,stop,tp},
// actual:{entry,exit,usd,r,heldMs} }. Per-trade R is the realized R recorded
// at close (computed in code from realized $ ÷ risk — not fabricated).
export function buildTrackRecordFromFills(fills = []) {
  const r2 = (n) => Math.round(n * 100) / 100;
  // R stats are computed over fills that recorded an R (bracketed round-trips);
  // NET $ is summed over ALL fills — including un-bracketed (r:null) ones — so
  // the EXECUTED headline agrees with buildTrackRecordByAccount.net_usd on the
  // same fills (a Tradovate null-bracket fill still moved real money).
  const all = (fills || []).filter(Boolean);
  const list = all.filter((f) => f && f.actual && typeof f.actual.r === "number");
  const n = list.length;
  const rs = list.map((f) => f.actual.r);
  const cumR = r2(rs.reduce((s, v) => s + v, 0));
  const cumUsd = Math.round(all.reduce((s, f) => s + (Number(f?.actual?.usd) || 0), 0));
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  // BE scratches don't count against win-rate — win% is over decided trades.
  const decided = wins.length + losses.length;
  const winRate = decided ? Math.round((100 * wins.length) / decided) : 0;
  const avgWin = wins.length ? r2(wins.reduce((s, v) => s + v, 0) / wins.length) : 0;
  const avgLoss = losses.length ? r2(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
  const expectancy = n ? r2(cumR / n) : 0;
  const payoff = avgLoss !== 0 ? r2(avgWin / Math.abs(avgLoss)) : 0;
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of rs) { eq = r2(eq + r); peak = Math.max(peak, eq); maxDD = Math.min(maxDD, r2(eq - peak)); }
  const best = rs.length ? r2(Math.max(...rs)) : 0;
  const worst = rs.length ? r2(Math.min(...rs)) : 0;
  return {
    n_trades: n, cum_r: cumR, cum_usd: cumUsd, win_pct: winRate,
    win_n: wins.length, loss_n: losses.length, avg_win: avgWin, avg_loss: avgLoss,
    expectancy, payoff, max_drawdown_r: r2(maxDD), best_r: best, worst_r: worst,
  };
}

// Resolve a human display name for an account. Honest — never invents a name
// (PRODUCT.md #3). The armed/confirmed account carries a real name from
// execution-config; every other account is shown by the only identifier we
// recorded (its broker account id), so two accounts are always distinguishable.
export function resolveAccountName(accountId, broker, confirmed) {
  if (confirmed?.id && accountId === confirmed.id && confirmed.name) return confirmed.name;
  if (accountId && accountId !== "unknown") return String(accountId);
  return "Unattributed";
}

// Per-ACCOUNT trade ledger keyed by the SPECIFIC account id — not the broker
// label, which collapses two distinct Tradovate accounts into one "tradovate"
// group. Each entry carries the resolved name, an `armed` flag (the
// confirmed/active account orders route to), the per-account summary, and the
// account's own trades newest-first for the expandable view. The confirmed
// account is always present — even with zero fills here — so the separation is
// explicit and the armed account never silently disappears.
//   fills:     readAllFills records { accountId, account, side, symbol, qty, actual:{r,usd} }
//   confirmed: execution-config confirmedAccount { id, name, type } | null
export function buildTrackRecordByAccount(fills = [], confirmed = null) {
  const groups = new Map();
  for (const f of (fills || [])) {
    const key = f?.accountId ?? f?.account ?? "unknown";
    if (!groups.has(key)) groups.set(key, { broker: f?.account ?? null, list: [] });
    groups.get(key).list.push(f);
  }
  // The armed account is always its own visible group, even with no fills here.
  if (confirmed?.id && !groups.has(confirmed.id)) {
    groups.set(confirmed.id, { broker: confirmed.broker ?? null, list: [] });
  }
  const sumUsd = (l) => Math.round(l.reduce((s, f) => s + (Number(f?.actual?.usd) || 0), 0));
  const sumR = (l) => {
    const rs = l.map((f) => f?.actual?.r).filter((r) => typeof r === "number");
    return rs.length ? Math.round(rs.reduce((s, v) => s + v, 0) * 100) / 100 : null;
  };
  const out = [...groups.entries()].map(([accountId, { broker, list }]) => ({
    accountId,
    account: broker ?? "unknown",
    broker,
    name: resolveAccountName(accountId, broker, confirmed),
    armed: confirmed?.id != null && accountId === confirmed.id,
    ...buildTrackRecordFromFills(list),
    n_trades: list.length,                  // all fills, incl. un-bracketed (r:null)
    net_usd: sumUsd(list),                   // real $ over every fill
    net_r: sumR(list),                       // R only where a bracket recorded it
    trades: [...list].sort((a, b) => String(b.ts).localeCompare(String(a.ts))),
  }));
  // Armed account first, then busiest.
  return out.sort((a, b) => Number(b.armed) - Number(a.armed) || b.n_trades - a.n_trades);
}

export function degradedChainStages(chainAudit) {
  if (!chainAudit || typeof chainAudit !== "object") return [];
  const out = [];
  const visit = (node, prefix) => {
    if (!node || typeof node !== "object") return;
    const status = node.chain_status;
    if (typeof status === "string") {
      if (status.startsWith("degraded") || status.startsWith("stale")) {
        out.push({ stage: prefix, status });
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, prefix ? `${prefix}.${key}` : key);
    }
  };
  visit(chainAudit, "");
  return out;
}

// Today's ET calendar date (YYYY-MM-DD) — the badge is a "today's session"
// indicator, so it must be scoped to today, not just the newest row.
export function etDateNow() {
  try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); } catch { return null; }
}

// Badge numbers for the REVIEW topbar cell from the library (newest-first row).
// Reads net_r/setups from the row's `stats` block — the row shape is
// { date, session, grade, stats:{ net_r, setups, ... } }.
// Stale-guard (audit C33): the newest row may be a PRIOR day's session. Only
// show its R when its date IS today; otherwise fall back to the dim
// setup-count state so yesterday's P&L is never labeled "today's session".
export function todayBadge(library, todayEtDate = etDateNow()) {
  const row = Array.isArray(library) ? library[0] : null;
  if (!row || (row.date && todayEtDate && row.date !== todayEtDate)) {
    return { totalR: null, setups: row?.stats?.setups ?? 0 };
  }
  const r = row?.stats?.net_r;
  return { totalR: r == null ? null : Number(r), setups: row?.stats?.setups ?? 0 };
}

// ── Faithfulness verdict ──────────────────────────────────────────────
// computeFaithfulness(setup, trade?, brief?) → per-trade Lanto adherence,
// derived ONLY from fields already on the setup record + executionPacket
// (no fabrication — PRODUCT.md #3). Each dimension is one of:
//   "pass" | "soft" | "deviation" | "na".
// marks = [bias, priceAction, entryModel] drives the 3-segment ledger mark.
// stop + draw are the two places the chain most often drifts from Lanto.
const NAMED_DRAW = /PWH|PWL|PDH|PDL|NYAM|NYPM|AS[._]|LO[._]|primary_draw|pillar1/i;

function pillarVerdict(setup, name) {
  const p = (setup?.pillar_breakdown || []).find((x) => x?.name === name);
  if (!p || typeof p.verdict !== "string") return null;
  return /pass/i.test(p.verdict) ? "pass" : "fail";
}

export function computeFaithfulness(setup, trade = null, brief = null) {
  const pkt = setup?.executionPacket || null;
  const raw = pkt?.entry?.rawPayload || {};
  const side = setup?.side || setup?.direction || pkt?.side || null;
  const model = setup?.model || pkt?.model || null;
  const na = (detail) => ({ status: "na", detail });

  // Not a setup record (tranche_skip, missing packet) → nothing to grade.
  if (!setup || (!pkt && !setup.pillar_breakdown)) {
    const dim = na("no setup evidence");
    return {
      bias: dim, priceAction: dim, entryModel: dim, stop: dim, draw: dim,
      marks: ["na", "na", "na"],
      summary: { faithful: false, deviations: 0, softs: 0, gradable: false },
    };
  }

  // 1. Bias (Component 1 — draw & bias). The deterministic Pillar 1 context
  //    gate IS the bias check. The draw is surfaced as context, NOT as a
  //    pass/fail driver — a PD array's own `dir` is its polarity, not the
  //    draw's destination, so comparing side to primary_draw.dir is unsound.
  const p1 = pillarVerdict(setup, "Pillar 1");
  const drawDir = brief?.primary_draw?.dir ?? brief?.primaryDraw?.dir ?? null;
  const bias = p1 === "pass"
    ? { status: "pass", detail: `context gate pass${drawDir ? ` · draw ${drawDir}` : ""}` }
    : p1 === "fail"
      ? { status: "deviation", detail: "Pillar 1 context gate failed" }
      : na("no Pillar 1 verdict");

  // 2. Price action (Component 2). Pillar 2 quality + 15m chop.
  const p2 = pillarVerdict(setup, "Pillar 2");
  const chop = raw.chop_15m === true;
  const priceAction = p2 === "fail"
    ? { status: "deviation", detail: "Pillar 2 quality gate failed" }
    : p2 === "pass"
      ? (chop ? { status: "soft", detail: "quality pass but 15m chop" }
              : { status: "pass", detail: "displacement clean, 15m not chop" })
      : na("no Pillar 2 verdict");

  // 3. Entry model (Component 3). Confirmation discipline; the aggressive
  //    bridge-synthesized variant is real but lower-evidence → soft.
  const p3 = pillarVerdict(setup, "Pillar 3");
  const wantDir = side === "long" ? "bull" : side === "short" ? "bear" : null;
  const confirmed = raw.confirm_close === true
    && (!wantDir || raw.confirm_dir === wantDir) && raw.ce_held !== false;
  const bridge = raw.source === "violation_close_bridge";
  let entryModel;
  if (p3 === "fail") {
    entryModel = { status: "deviation", detail: "Pillar 3 confirmation failed" };
  } else if (p3 === "pass" || confirmed) {
    entryModel = bridge
      ? { status: "soft", detail: `${model || "entry"} confirm via bridge (aggressive, not engine-stamped)` }
      : { status: "pass", detail: `${model || "entry"} 1m confirm close${raw.ce_held ? ", CE held" : ""}` };
  } else {
    entryModel = na("no Pillar 3 verdict");
  }

  // 4. Stop anchor. Inversion is faithful only beyond the inverted array
  //    (a zone-anchored cite); a generic swing-extreme cite is a deviation.
  const stopCite = setup?.stop_cite || "";
  const ptDist = (setup?.entry != null && setup?.stop != null)
    ? Math.round(Math.abs(Number(setup.entry) - Number(setup.stop)) * 100) / 100 : null;
  let stop;
  if (!stopCite) {
    stop = na("no stop cite");
  } else if (model === "Inversion") {
    stop = /zone/i.test(stopCite)
      ? { status: "pass", detail: `anchored to the array${ptDist != null ? ` (${ptDist}pt)` : ""}` }
      : { status: "deviation", detail: `${stopCite}${ptDist != null ? ` (${ptDist}pt)` : ""} — Lanto anchors just beyond the inverted array` };
  } else {
    stop = { status: "pass", detail: `structural stop${ptDist != null ? ` (${ptDist}pt)` : ""}` };
  }

  // 5. Liquidity draw. TP1 should target a named session/PD draw, not an
  //    internal swing or an unnamed session_history level.
  const tpCite = setup?.tp1_cite || "";
  let draw;
  if (!tpCite) {
    draw = na("no TP1 cite");
  } else if (NAMED_DRAW.test(tpCite)) {
    draw = { status: "pass", detail: `TP1 → ${tpCite}` };
  } else {
    draw = { status: "soft", detail: `TP1 cites ${tpCite} — verify it's a named draw, not an internal swing` };
  }

  const dims = [bias, priceAction, entryModel, stop, draw];
  const deviations = dims.filter((d) => d.status === "deviation").length;
  const softs = dims.filter((d) => d.status === "soft").length;
  const gradable = dims.some((d) => d.status !== "na");
  return {
    bias, priceAction, entryModel, stop, draw,
    marks: [bias.status, priceAction.status, entryModel.status],
    summary: { faithful: gradable && deviations === 0, deviations, softs, gradable },
  };
}

// ── Review truth domains (Task C4) ──────────────────────────────────────────
// REVIEW splits the record into three explicit provenance domains so a
// SIMULATED / deterministic R can NEVER be shown as an executed one (PRODUCT.md
// #3 honesty). The copy is load-bearing — a contract test asserts JOURNAL is
// never labeled executed and always says SIMULATED.
export const REVIEW_DOMAINS = Object.freeze({
  EXECUTED: Object.freeze({ key: "EXECUTED", label: "EXECUTED", source: "broker fills", note: "Real broker fills — money that actually moved." }),
  JOURNAL: Object.freeze({ key: "JOURNAL", label: "JOURNAL", source: "deterministic · SIMULATED", note: "Deterministic walker journal — SIMULATED R, not executed." }),
  BACKTEST: Object.freeze({ key: "BACKTEST", label: "BACKTEST", source: "corpus fold", note: "Historical corpus fold — replayed, not executed." }),
});

// Tag a record with its provenance domain. Fail-safe default is JOURNAL
// (simulated) — a record is only ever promoted to EXECUTED on POSITIVE broker
// evidence (a real fill with a $ result + an account it routed to), so a
// simulated row can never masquerade as executed.
export function tagDomain(record = {}) {
  if (!record || typeof record !== "object") return REVIEW_DOMAINS.JOURNAL.key;
  if (record.domain && REVIEW_DOMAINS[record.domain]) return record.domain;
  if (record.corpus === true || record.run_id != null || record.backtest === true) return REVIEW_DOMAINS.BACKTEST.key;
  const a = record.actual || null;
  const hasBrokerResult = !!a && (a.usd != null || a.exit != null);
  const hasAccount = record.accountId != null || record.account != null || record.broker != null;
  if (hasBrokerResult && hasAccount) return REVIEW_DOMAINS.EXECUTED.key;
  return REVIEW_DOMAINS.JOURNAL.key;
}

function rvNum(v) {
  if (v == null || v === "") return null; // Number(null) === 0 — guard it
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function rvSide(s) {
  const v = String(s || "").toLowerCase();
  if (v === "long" || v === "buy") return "long";
  if (v === "short" || v === "sell") return "short";
  return null;
}

// Points of adverse entry slippage that count as a discrepancy worth surfacing.
export const SLIPPAGE_MATERIAL_PTS = 0.5;

// Entry slippage between the PLANNED entry and the ACTUAL broker fill. Shown
// ONLY when both are finite — a Tradovate bracket that filled with a null
// planned entry (no plan recorded) returns shown:false rather than a fabricated
// zero. `points` is signed so positive = adverse (worse than planned) for the
// trade's own direction.
export function computeSlippage(fill = {}) {
  const p = fill?.planned || {};
  const a = fill?.actual || {};
  const pe = rvNum(p.entry);
  const ae = rvNum(a.entry);
  if (pe == null || ae == null) return { shown: false, points: null, adverse: false };
  const dir = rvSide(fill.side);
  const raw = ae - pe;
  const points = Math.round((dir === "short" ? -raw : raw) * 100) / 100;
  return { shown: true, points, adverse: points > 0 };
}

// The end-to-end evidence chain for one executed/journaled trade: intent →
// order → fill → journal → reconcile. A missing hop is available:false (never
// invented) so the drill-down honestly shows where the trail breaks.
export function buildEvidenceChain({ fill = null, intent = null, journalTrade = null, reconcile = null } = {}) {
  const acked = !!intent && ["BROKER_ACKNOWLEDGED", "POSITION_CONFIRMED", "STOP_CONFIRMED"].includes(intent.state);
  const recState = typeof reconcile === "string" ? reconcile : reconcile?.state ?? null;
  return [
    { key: "INTENT", label: "Intent", available: !!intent, detail: intent ? `${intent.decision_id ?? "—"} · ${intent.state ?? "—"}` : null },
    { key: "ORDER", label: "Broker order", available: acked || !!fill, detail: intent?.state ?? (fill ? "filled" : null) },
    { key: "FILL", label: "Fill", available: !!(fill && fill.actual), detail: fill?.actual ? `${fill.actual.entry ?? "—"} → ${fill.actual.exit ?? "—"}` : null },
    { key: "JOURNAL", label: "Journal", available: !!journalTrade, detail: journalTrade ? `#${journalTrade.id ?? "—"} · ${journalTrade.outcome ?? journalTrade.state ?? "—"}` : null },
    { key: "RECONCILE", label: "Reconcile", available: recState != null, detail: recState },
  ];
}

// Discrepancies between what the journal recorded and what the broker executed.
// A clean, fully-consistent trade returns []. Kinds: qty_mismatch /
// outcome_mismatch / naked_stop / intent_unresolved / slippage.
export function computeDiscrepancies({ fill = null, intent = null, journalTrade = null, reconcile = null } = {}) {
  const out = [];
  const jqty = rvNum(journalTrade?.size?.contracts ?? journalTrade?.contracts ?? null);
  const fqty = rvNum(fill?.qty ?? null);
  if (jqty != null && fqty != null && jqty !== fqty) {
    out.push({ kind: "qty_mismatch", detail: `journal ${jqty}c vs broker ${fqty}c` });
  }
  const jOut = journalTrade?.outcome ?? null;
  const fr = rvNum(fill?.actual?.r ?? null);
  if (jOut && fr != null) {
    const journalWin = /TP/i.test(jOut);
    const journalLoss = /STOP|INVALID/i.test(jOut);
    if ((journalWin && fr < 0) || (journalLoss && fr > 0)) {
      out.push({ kind: "outcome_mismatch", detail: `journal ${jOut} but executed ${fr}R` });
    }
  }
  const recState = typeof reconcile === "string" ? reconcile : reconcile?.state ?? null;
  if (recState === "CRITICAL_NO_STOP") {
    out.push({ kind: "naked_stop", detail: "reconcile: open position with NO protective stop" });
  }
  if (intent && ["RECOVERY_REQUIRED", "UNKNOWN"].includes(intent.state)) {
    out.push({ kind: "intent_unresolved", detail: `intent held in ${intent.state}` });
  }
  const slip = computeSlippage(fill || {});
  if (slip.shown && slip.adverse && Math.abs(slip.points) >= SLIPPAGE_MATERIAL_PTS) {
    out.push({ kind: "slippage", detail: `${slip.points}pt adverse fill vs plan` });
  }
  return out;
}

// ── Fill ↔ trade assignment (Task C4) ───────────────────────────────────────
// Executed fills carry no decision_id/trade_id, so the evidence chain joins a
// fill to a journal trade heuristically: same instrument root + side, nearest
// timestamp — but bounded and 1:1. A fill matches at most ONE trade (greedy
// nearest first), a trade with no ts gets no match, and a match outside the
// window is rejected. No fallback-to-first: a miss is an honest no-match so the
// evidence chain shows the FILL hop unavailable rather than misattributing.
export const FILL_MATCH_WINDOW_MS = 10 * 60 * 1000; // 10 min

const rvRoot = (s) => (String(s || "").toUpperCase().match(/(MNQ|MES|NQ|ES)/) || [])[1] || null;
function rvSideEq(a, b) {
  const sa = rvSide(a), sb = rvSide(b);
  return sa != null && sa === sb;
}

// Returns Map(trade.id → fill). Greedy: rank every eligible (trade, fill) pair
// by |Δt|, assign smallest first, each fill and each trade used at most once.
export function assignFillsToTrades(trades = [], fills = [], { maxDeltaMs = FILL_MATCH_WINDOW_MS } = {}) {
  const pairs = [];
  for (const t of trades || []) {
    if (!t || t.id == null || !t.ts) continue; // no ts → honest no-match
    const tms = Date.parse(t.ts);
    if (!Number.isFinite(tms)) continue;
    const tRoot = rvRoot(t.symbol);
    for (let fi = 0; fi < (fills || []).length; fi += 1) {
      const f = fills[fi];
      if (!f || !f.ts) continue;
      if (rvRoot(f.symbol) !== tRoot) continue;
      if (!rvSideEq(f.side, t.side)) continue;
      const fms = Date.parse(f.ts);
      if (!Number.isFinite(fms)) continue;
      const d = Math.abs(fms - tms);
      if (d > maxDeltaMs) continue;
      pairs.push({ tid: t.id, fi, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const out = new Map();
  const usedFills = new Set();
  for (const p of pairs) {
    if (out.has(p.tid) || usedFills.has(p.fi)) continue;
    out.set(p.tid, fills[p.fi]);
    usedFills.add(p.fi);
  }
  return out;
}

// ── Session critique (Track 2 §2b item 1) ───────────────────────────────────
// Parse the raw critique.md the review turn writes into a render-ready view
// model. Pure + defensive: parses the small `--- ts/session/provider ---`
// frontmatter, splits the body into plain-text paragraphs, and drops empty
// input. It performs NO HTML/markdown interpretation — every paragraph is a
// plain string the card renders as a React text node (auto-escaped by React),
// so an embedded `<script>` renders as inert text, never executed markup.
// Returns null when there is nothing to show (so the card doesn't render).
export function critiqueViewModel(raw) {
  if (typeof raw !== "string") return null;
  let rest = raw.replace(/^﻿/, "").replace(/^\s+/, "");
  const meta = { ts: null, session: null, provider: null };
  // Optional YAML-lite frontmatter fenced by lines of exactly `---`.
  const fence = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
  const m = rest.match(fence);
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      if (key === "ts" || key === "session" || key === "provider") meta[key] = val || null;
    }
    rest = rest.slice(m[0].length);
  }
  const paragraphs = rest
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;
  return { ts: meta.ts, session: meta.session, provider: meta.provider, paragraphs };
}

// ── Coach narration (Track 2 §2b item 2) ────────────────────────────────────
// The coach.md the coach turn writes has the SAME shape as critique.md — a
// small `--- ts/provider/digest_hash ---` frontmatter then plain-text
// paragraphs — so it reuses the same defensive, HTML-inert parser. Every
// paragraph is rendered as a React text node, so an embedded `<script>` is
// inert text, never executed markup. Returns null when there's nothing to show.
export function coachViewModel(raw) {
  return critiqueViewModel(raw);
}

// Compact, human label for the critique card's provider · time meta line.
// Purely cosmetic — never fabricates data (returns "" when a part is absent).
export function critiqueMetaLabel({ provider, ts } = {}) {
  const parts = [];
  if (provider) parts.push(String(provider).toUpperCase());
  if (ts) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      }));
    }
  }
  return parts.join(" · ");
}
