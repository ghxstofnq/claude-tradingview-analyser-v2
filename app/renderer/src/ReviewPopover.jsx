// REVIEW workstation — essentialist re-add (2026-05-27).
// 3 panels: SESSION JOURNAL · CANDIDATE LEDGER · SESSION LIBRARY.
// Reads useReview() directly. CANDIDATE LEDGER rows are clickable to
// expand into a full TradeCard for confirmed/accepted rows.

import React, { useState, useEffect } from "react";
import { Panel, Row, Grade } from "./Shared.jsx";
import {
  buildLedger,
  deriveLedgerState,
  deriveLedgerReason,
  formatGradeShort,
} from "./Review.helpers.js";
import { useReview } from "./hooks/useReview.js";

// ── SESSION JOURNAL ──────────────────────────────────────────────────
function SessionJournalPanel({ journal, onExport }) {
  if (!journal) {
    return (
      <Panel title="SESSION JOURNAL" meta="—">
        <div style={{ color: "var(--label)", padding: "8px 0", fontSize: 11 }}>
          no journal yet for today's active session
        </div>
      </Panel>
    );
  }
  const grade = journal.brief?.pillar_grade || "—";
  const gradeTone = grade === "A+" ? "green" : grade === "B" ? "amber" : "dim";
  const meta = (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className={"pill " + gradeTone}>{grade}</span>
      <span className="pill interactive" onClick={onExport}>EXPORT JSON</span>
    </span>
  );
  return (
    <Panel title={`SESSION JOURNAL · ${(journal.session || "").toUpperCase()} · ${journal.date}`} right={meta}>
      <div style={{ color: "var(--prose)", fontSize: 12, lineHeight: 1.6,
                     whiteSpace: "pre-wrap", padding: "6px 0" }}>
        {journal.summary?.bias_picture || journal.brief?.brief || "no summary yet"}
      </div>
    </Panel>
  );
}

// ── CANDIDATE LEDGER ─────────────────────────────────────────────────
// Mockup 05-essentialist.html .cand-row uses 5 separate columns:
//   cyc | grade-pill | side | mod | reason
// Confirmed/accepted rows get a green left border + tinted bg; clicking
// opens a compact 3-row trade summary inline (not the full TradeCard).
function LedgerRow({ row, expanded, onToggle }) {
  const setup = row.setup;
  const stateLabel = row.state?.label || "—";
  const tone = row.state?.tone || "dim";
  const cycle = setup.ts
    ? new Date(setup.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })
    : "—";
  const sideUp = (setup.direction || setup.side || "").toUpperCase();
  const sideCls = (setup.direction === "long" || setup.side === "long") ? "l" : "s";
  const grade = formatGradeShort(setup.grade);
  const clickable = row.expandable;
  // Confirmed/expandable rows get a green left border tint matching the mockup.
  const rowHighlight = clickable
    ? { background: "rgba(110,199,136,0.05)", borderLeft: "2px solid var(--green)", paddingLeft: 6 }
    : {};
  const caret = clickable ? (expanded ? " ▴" : " ▾") : "";
  // For confirmed rows the reason column carries the state label + caret;
  // for non-confirmed rows it carries the no-trade/rejection reason.
  const reasonText = clickable
    ? `${stateLabel}${caret}`
    : (row.reason || stateLabel || "");
  return (
    <>
      <div className="cand-row"
           style={{ cursor: clickable ? "pointer" : "default", ...rowHighlight }}
           onClick={clickable ? onToggle : undefined}>
        <span className="cyc">{cycle}</span>
        <span className={"grade-pill " + (grade === "A+" ? "green" : grade === "B" ? "amber" : "dim")}>{grade}</span>
        <span className={"side " + sideCls}>{sideUp}</span>
        <span className="mod">{setup.model || "—"}</span>
        <span className={"reason " + (clickable ? "green" : "")}>{reasonText}</span>
      </div>
      {expanded && row.trade && (
        <LedgerTradeExpand row={row} />
      )}
    </>
  );
}

// Compact inline expansion for a confirmed/accepted trade. Matches the
// mockup's 3-row summary (Entry · Stop · BE / TP1 · P&L / Size) with a
// header line showing grade / side / model · trade-id / outcome.
function LedgerTradeExpand({ row }) {
  const t = row.trade || {};
  const s = row.setup || {};
  const entry = s.entry ?? t.entry;
  const stop = s.stop ?? t.stop;
  const tp1 = s.tp1 ?? t.tp1;
  const pnl = t.r_realized != null
    ? `${t.r_realized > 0 ? "+" : ""}${t.r_realized} R`
    : "—";
  const sizeLbl = t.size?.label
    || (t.size?.contracts ? `${t.size.contracts}c` : "—");
  const sideUp = (t.side || s.direction || s.side || "").toUpperCase();
  const sideCls = (t.side === "long" || s.direction === "long" || s.side === "long") ? "l" : "s";
  const outcome = t.outcome || (t.state === "closed" ? "CLOSED" : "OPEN");
  const outcomeTone = (outcome === "TP1_HIT" || outcome === "TP2_HIT") ? "var(--green)"
                    : (outcome === "STOPPED" || outcome === "INVALIDATED") ? "var(--red)"
                    : "var(--label)";
  return (
    <div style={{
      borderLeft: "2px solid var(--green)",
      background: "rgba(110,199,136,0.04)",
      paddingLeft: 6,
    }}>
      <div style={{
        display: "flex", gap: 8, alignItems: "center",
        fontSize: 10, padding: "8px 0 6px",
      }}>
        <span className="grade-pill green">{s.grade || "A+"}</span>
        <span className={"side " + sideCls}
              style={{ fontSize: 9, letterSpacing: ".18em",
                       color: sideCls === "l" ? "var(--green)" : "var(--red)" }}>
          {sideUp}
        </span>
        <span style={{ color: "var(--value)" }}>
          {s.model || t.model || "—"}{t.id ? ` · #${t.id}` : ""}
        </span>
        <span style={{
          marginLeft: "auto",
          color: outcomeTone,
          fontSize: 9.5, letterSpacing: ".12em",
        }}>
          ● {outcome.replace(/_/g, " ")}
        </span>
      </div>
      <Row k="Entry · Stop" v={`${entry ?? "—"} · ${stop ?? "—"}${t.tp1_hit ? " · BE" : ""}`} />
      <Row k="TP1 · P&L" v={`${tp1 ?? "—"} · ${pnl}`} tone={t.r_realized > 0 ? "ok" : t.r_realized < 0 ? "bad" : ""} />
      <Row k="Size" v={sizeLbl} />
    </div>
  );
}

function CandidateLedgerPanel({ ledger }) {
  const [expanded, setExpanded] = useState(new Set());
  const toggle = (id) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <Panel title="CANDIDATE LEDGER"
           meta={`${ledger.length} candidate${ledger.length === 1 ? "" : "s"} · click confirmed rows to expand`}>
      {ledger.length === 0 && (
        <Row k="—" v="no candidates this session" tone="dim" />
      )}
      {ledger.map((row) => {
        const id = row.setup?.id || row.setup?.ts || Math.random();
        return (
          <LedgerRow key={id}
                     row={row}
                     expanded={expanded.has(id)}
                     onToggle={() => toggle(id)} />
        );
      })}
    </Panel>
  );
}

// ── SESSION LIBRARY ──────────────────────────────────────────────────
function SessionLibraryPanel({ library, currentDate, currentSession, onPick }) {
  return (
    <Panel title="SESSION LIBRARY" meta="recent · click to load">
      <table className="lib-table">
        <thead>
          <tr>
            <th>DATE</th><th>SESSION</th><th>GRADE</th>
            <th className="r">CANDS</th><th className="r">CONFIRMED</th>
          </tr>
        </thead>
        <tbody>
          {library.length === 0 && (
            <tr><td colSpan={5} style={{ color: "var(--label)", padding: 14 }}>no sessions yet</td></tr>
          )}
          {library.map((r, i) => {
            const isCur = r.date === currentDate && r.session === currentSession;
            return (
              <tr key={i} className={isCur ? "cur" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={() => onPick?.(r)}>
                <td>{r.date}</td>
                <td className="dim">{r.session}</td>
                <td>{r.grade || "—"}</td>
                <td className="r">{r.stats?.setups ?? "—"}</td>
                <td className="r">{r.stats?.accepted ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

// ── Workstation ──────────────────────────────────────────────────────
function ReviewBody() {
  const [picked, setPicked] = useState({});
  const { journal, library } = useReview(picked);
  const ledger = React.useMemo(
    () => buildLedger(journal?.setups || [], journal?.trades || []),
    [journal],
  );
  const onExport = () => {
    if (!journal) return;
    window.api?.review?.exportSession?.(journal.date, journal.session).then((res) => {
      if (res?.ok) {
        // eslint-disable-next-line no-console
        console.log("[review] exported to", res.path);
      }
    }).catch(() => {});
  };
  const onPickLibrary = (row) => {
    if (!row?.date || !row?.session) return;
    setPicked({ date: row.date, session: row.session });
  };
  return (
    <div className="work-scroll">
      <SessionJournalPanel journal={journal} onExport={onExport} />
      <CandidateLedgerPanel ledger={ledger} />
      <SessionLibraryPanel library={library}
                           currentDate={journal?.date}
                           currentSession={journal?.session}
                           onPick={onPickLibrary} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// ReviewCell — topbar cell + anchored 660px popover wrapper. Badge shows
// today's session P&L color-coded (or setup count pre-session).
function ReviewCell() {
  const [open, setOpen] = useState(false);
  const { journal, library } = useReview();
  const today = library?.[0];                  // assumed sorted newest-first
  const totalR = today?.total_r ?? null;

  let badge;
  if (totalR == null || totalR === 0) {
    badge = <span className="count dim">{today?.setups ?? 0}</span>;
  } else {
    const cls = totalR > 0 ? "green" : "red";
    badge = (
      <span className={"count " + cls}>
        {totalR > 0 ? "+" : ""}{Number(totalR).toFixed(1)}R
      </span>
    );
  }

  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.which === "review") setOpen((o) => !o);
      if (e.detail?.which === "all-close") setOpen(false);
    };
    window.addEventListener("topbar:open-cell", onOpen);
    return () => window.removeEventListener("topbar:open-cell", onOpen);
  }, []);

  const onCellClick = (e) => {
    if (e.target.closest(".bt-popover")) return;
    setOpen((o) => !o);
  };

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")} onClick={onCellClick}>
      <span className="k">REVIEW</span>
      {badge}
      {open && (
        <div className="bt-popover w-660" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">REVIEW</span>
            <span className="sub">{journal?.date ?? "—"} · {journal?.session?.toUpperCase() ?? ""}</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <ReviewBody />
          </div>
        </div>
      )}
    </div>
  );
}

export { ReviewCell };
// Legacy alias until Task 11 rewires the topbar
export { ReviewBody as ReviewWorkstation };
