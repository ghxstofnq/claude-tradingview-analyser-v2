// PREP mode workstation — Session Brief.

import React, { useEffect, useState } from "react";
import { Panel, Row, Grade, PillarsPanel } from "./Shared.jsx";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { useSessionRecap } from "./hooks/useSessionRecap.js";

const SESSION_LABEL = {
  "london": "LONDON",
  "ny-am":  "NY AM",
  "ny-pm":  "NY PM",
};

// Compute a summary of what changed between two briefs. Compares:
//   - bias direction (htf_bias[0].bias as the headline)
//   - pillar_grade
//   - key_levels added / removed (by name)
// Returns an array of human-readable change rows.
function diffBriefs(current, prior) {
  if (!current || !prior) return [];
  const rows = [];
  const curBias = (current.htf_bias || [])[0]?.bias;
  const priBias = (prior.htf_bias || [])[0]?.bias;
  if (curBias && priBias && curBias !== priBias) {
    rows.push({ k: "Daily bias", from: priBias, to: curBias });
  }
  if (current.pillar_grade && prior.pillar_grade && current.pillar_grade !== prior.pillar_grade) {
    rows.push({ k: "Pillar grade", from: prior.pillar_grade, to: current.pillar_grade });
  }
  const curLevels = new Set((current.key_levels || []).map((l) => l.name));
  const priLevels = new Set((prior.key_levels || []).map((l) => l.name));
  const added = [...curLevels].filter((n) => !priLevels.has(n));
  const removed = [...priLevels].filter((n) => !curLevels.has(n));
  if (added.length) rows.push({ k: "New levels", v: added.join(", ") });
  if (removed.length) rows.push({ k: "Dropped levels", v: removed.join(", ") });
  return rows;
}

// Visible banner when the brief is from a prior trading window — e.g.
// London brief still showing during NY AM, or NY AM brief showing
// during NY PM. Threshold is intentionally generous (4h) to avoid
// crying wolf during the same session.
const STALE_BRIEF_THRESHOLD_MS = 4 * 60 * 60 * 1000;
function StaleBriefBanner({ ageMs, onRefresh }) {
  if (ageMs == null || ageMs < STALE_BRIEF_THRESHOLD_MS) return null;
  const ageLabel = formatAge(ageMs);
  return (
    <div style={{
      background: "var(--surface-1)",
      border: "1px solid var(--amber, #d4a657)",
      borderLeft: "3px solid var(--amber, #d4a657)",
      padding: "10px 14px",
      marginBottom: 10,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
    }}>
      <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.4 }}>
        <span style={{ color: "var(--amber)", letterSpacing: ".1em", fontSize: 10 }}>STALE · </span>
        This brief is {ageLabel} — likely from a prior session window. Refresh to grade the current session.
      </div>
      <button onClick={onRefresh}
              style={{
                background: "transparent",
                border: "1px solid var(--amber)",
                color: "var(--amber)",
                padding: "3px 12px",
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 9.5,
                letterSpacing: ".16em",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}>
        [ REFRESH ]
      </button>
    </div>
  );
}

function ChangedPanel({ session, brief }) {
  const [prior, setPrior] = useState(null);
  const [priorDate, setPriorDate] = useState(null);
  useEffect(() => {
    if (!session || !brief) return;
    // The brief's `ts` is the day it was written. Extract YYYY-MM-DD
    // so we don't compare today vs today.
    const today = (brief.ts || "").slice(0, 10);
    window.api?.prep?.priorBrief?.(session, today).then((res) => {
      if (res?.ok && res.prior) {
        setPrior(res.prior.brief);
        setPriorDate(res.prior.date);
      } else {
        setPrior(null);
        setPriorDate(null);
      }
    }).catch(() => {});
  }, [session, brief?.ts]);

  if (!prior) return null;
  const changes = diffBriefs(brief, prior);
  if (!changes.length) return null;

  return (
    <Panel title={`CHANGED SINCE LAST ${SESSION_LABEL[session] || ""} BRIEF`}
           right={<span style={{ color: "var(--label)", fontSize: 10 }}>vs {priorDate}</span>}>
      {changes.map((c, i) => (
        <div key={i} className="row" style={{ alignItems: "flex-start" }}>
          <span className="k">{c.k}</span>
          <span className="v" style={{ color: "var(--prose)" }}>
            {c.from ? <><span style={{ color: "var(--label)" }}>{c.from}</span>{" → "}<span style={{ color: "var(--amber)" }}>{c.to}</span></> : c.v}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function RecapPanel({ session, recap }) {
  if (!recap) return null;
  const watch = Array.isArray(recap.watch_next_session) ? recap.watch_next_session : [];
  return (
    <Panel title={`LAST SESSION RECAP · ${SESSION_LABEL[session] || ""}`}
           right={<span style={{ color: "var(--label)", fontSize: 10 }}>
             {recap.ts ? formatAge(Date.now() - new Date(recap.ts).getTime()) : ""}
           </span>}>
      <div style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".14em", marginBottom: 4 }}>
        BIAS PICTURE
      </div>
      <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 10 }}>
        {recap.bias_picture || "—"}
      </div>
      <div style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".14em", marginBottom: 4 }}>
        WHAT HAPPENED
      </div>
      <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 10 }}>
        {recap.what_happened || "—"}
      </div>
      {watch.length > 0 && (
        <>
          <div style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".14em", marginBottom: 4 }}>
            WATCH NEXT SESSION
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--value)", fontSize: 11.5, lineHeight: 1.55 }}>
            {watch.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </>
      )}
    </Panel>
  );
}

function formatPx(p) {
  if (typeof p === "string") return p;
  if (typeof p !== "number") return String(p ?? "");
  const [whole, dec = ""] = String(p).split(".");
  const withSpaces = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return dec ? `${withSpaces}.${dec.padEnd(2, "0").slice(0, 2)}` : withSpaces;
}

function formatEtTime(isoStr) {
  if (!isoStr) return "";
  try {
    return new Date(isoStr).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return ""; }
}

function RefreshButton({ status, onClick, age, briefTs }) {
  const running = status === "running";
  // Show both relative ("5m old") and absolute ET wall-clock
  // ("09:03 ET"). Trader can pick whichever is more useful in the moment.
  const etTime = briefTs ? formatEtTime(briefTs) : "";
  const ageLabel = age != null ? formatAge(age) : "";
  const captionParts = [];
  if (ageLabel) captionParts.push(`claude · ${ageLabel}`);
  if (etTime) captionParts.push(`@ ${etTime} ET`);
  const caption = running ? "claude is preparing…" : captionParts.join(" ");
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: "var(--label)", fontSize: 10 }}>
        {caption}
      </span>
      <button
        onClick={onClick}
        disabled={running}
        style={{
          color: running ? "var(--label)" : "var(--amber)",
          background: "transparent",
          border: "1px solid var(--border, #2a3038)",
          padding: "3px 9px",
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 9.5,
          letterSpacing: ".16em",
          cursor: running ? "default" : "pointer",
        }}>
        {running ? "[ ··· ]" : "[ REFRESH ]"}
      </button>
    </span>
  );
}

function EmptyBrief({ status, statusReason, progress, session, onRefresh }) {
  const running = status === "running";
  let message;
  if (running) {
    // Show tool-call progress so the trader sees something is happening
    // instead of staring at static text for 5 minutes. First call is
    // tv_analyze_full (chart capture), subsequent calls are the surface
    // tools (session brief × 2 in dual mode).
    const progressNote = progress > 0 ? ` (${progress} tool ${progress === 1 ? "call" : "calls"} so far)` : "";
    message = `Claude is preparing the session brief${progressNote} — HTF context, overnight ranges, key levels, and Pillar 1+2 grade. This takes 2-5 minutes.`;
  } else if (status === "error") {
    message = `The session brief failed${statusReason ? `: ${statusReason}` : ""}. Hit refresh to try again.`;
  } else if (status === "skipped") {
    // Skipped events now carry a reason from session-brief preflights:
    // "market closed", "TradingView replay is active", "another turn
    // already in flight", "chart preflight failed", etc. Surfacing the
    // reason replaces the prior silent ignore — user knows why nothing
    // happened when they clicked refresh.
    message = `Brief skipped${statusReason ? `: ${statusReason}` : ""}.`;
  } else if (session) {
    message = "No brief yet for this session. Hit refresh to run one now — or wait for the next scheduled trigger (02:00 / 09:00 / 13:00 ET).";
  } else {
    message = "Outside trading windows — next session opens Monday 02:00 ET (London).";
  }
  return (
    <Panel title={`SESSION BRIEF · ${SESSION_LABEL[session] || "—"}`}
           right={<RefreshButton status={status} onClick={onRefresh} />}>
      <div style={{ color: "var(--label)", fontSize: 11.5, lineHeight: 1.6 }}>
        {message}
      </div>
    </Panel>
  );
}

function PrepWorkstation({ alerts, onToggleArm }) {
  const armed = alerts?.armed || {};
  const fired = alerts?.fired || [];

  const {
    brief,
    availableSymbols,
    selectedSymbol,
    setSelectedSymbol,
    session,
    status,
    statusReason,
    progress,
    refresh,
    ageMs,
  } = useSessionBrief();
  const { session: recapSession, recap } = useSessionRecap();

  if (!brief) {
    return (
      <div className="work-scroll">
        {recap && <RecapPanel session={recapSession} recap={recap} />}
        <EmptyBrief status={status} statusReason={statusReason} progress={progress} session={session} onRefresh={refresh} />
      </div>
    );
  }

  // Sort high → low defensively. The schema description asks Claude for
  // this ordering, but Zod doesn't enforce it — and an unsorted level
  // panel is hard to scan ("where's PDH?"). Sort by numeric price desc;
  // any string prices fall to the bottom in submitted order.
  const levels = (brief.key_levels || [])
    .slice()
    .sort((a, b) => {
      const an = typeof a.price === "number" ? a.price : -Infinity;
      const bn = typeof b.price === "number" ? b.price : -Infinity;
      return bn - an;
    })
    .map((lv) => ({
      name: lv.name,
      px: formatPx(lv.price),
      state: lv.state || "untaken",
      marker: lv.state === "untaken" ? "─" : "·",
    }));

  return (
    <div className="work-scroll">
      {recap && recapSession !== brief.session && (
        <RecapPanel session={recapSession} recap={recap} />
      )}
      <StaleBriefBanner ageMs={ageMs} onRefresh={refresh} />
      <ChangedPanel session={brief.session} brief={brief} />
      <Panel title={`SESSION BRIEF · ${SESSION_LABEL[brief.session] || ""}${selectedSymbol ? ` · ${selectedSymbol}` : ""}`}
             right={<RefreshButton status={status} onClick={refresh} age={ageMs} briefTs={brief.ts} />}>
        {availableSymbols.length > 1 && (
          <div style={{
            display: "flex", gap: 6, padding: "0 0 8px",
          }}>
            {availableSymbols.map((sym) => {
              const active = sym === selectedSymbol;
              return (
                <button key={sym}
                        onClick={() => setSelectedSymbol(sym)}
                        style={{
                          background: active ? "var(--surface-1)" : "transparent",
                          border: "1px solid " + (active ? "var(--amber)" : "var(--border)"),
                          color: active ? "var(--amber)" : "var(--value)",
                          padding: "3px 10px", fontFamily: "ui-monospace, Menlo, monospace",
                          fontSize: 10, letterSpacing: ".06em", cursor: "pointer",
                        }}>
                  {sym}
                </button>
              );
            })}
          </div>
        )}
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {brief.brief}
        </div>
      </Panel>

      <Panel title="HTF BIAS">
        {(brief.htf_bias || []).map((r) => (
          <div className="row" key={r.tf} style={{ alignItems: "flex-start" }}>
            <span className="k" style={{ minWidth: 50 }}>{r.tf}</span>
            <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14 }}>
              <span className={"v " + (r.bias === "BEARISH" ? "red" : r.bias === "MIXED" || r.bias === "NEUTRAL" ? "amber" : "green")}
                    style={{ letterSpacing: ".1em", marginRight: 10 }}>
                {r.bias}
              </span>
              <span style={{ color: "var(--label)", fontSize: 11 }}>{r.note}</span>
            </span>
          </div>
        ))}
      </Panel>

      <Panel title="OVERNIGHT CONTEXT">
        {(brief.overnight || []).map((r, i) => <Row key={i} k={r.k} v={r.v} tone={r.tone} />)}
      </Panel>

      <section className="panel">
        <header className="panel-head">
          <span className="title">KEY LEVELS</span>
          <span className="meta">PWH / PDH / ONH / ONL / PDL / PWL</span>
        </header>
        <div className="panel-body flush">
          {levels.map((lv) => {
            const isArmed = !!armed[lv.name];
            const isFired = fired.some((f) => f.name === lv.name);
            return (
              <div className="level-row" key={lv.name}>
                <span className="marker">{lv.marker}</span>
                <span className="name">{lv.name}</span>
                <span className="price">{lv.px}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={"state " + lv.state}>{lv.state.toUpperCase()}</span>
                  <span className={"bell" + (isFired ? " fired" : isArmed ? " armed" : "")}
                        title={isFired ? "alert fired" : isArmed ? "alert armed — click to disarm" : "set alert"}
                        onClick={() => onToggleArm && onToggleArm(lv.name, lv.px)}>
                    {isFired ? "◉" : isArmed ? "●" : "○"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <span className="title">PRE-SESSION GRADE</span>
          <span className="meta">
            PILLARS 1 + 2 · <Grade value={brief.pillar_grade || "no-trade"} />
          </span>
        </header>
        <div className="panel-body flush">
          <PillarsPanel pillars={brief.pillars || []} />
        </div>
      </section>

      <Panel title="CLAUDE · PLAN FOR THE OPEN">
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {brief.plan}
        </div>
        {Array.isArray(brief.scenarios) && brief.scenarios.length > 0 && (
          <>
            <div className="hr" />
            <div style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".14em", marginBottom: 6 }}>
              SCENARIOS
            </div>
            {brief.scenarios.map((s, i) => (
              <div key={i} style={{
                display: "flex", flexDirection: "column", gap: 2,
                padding: "6px 0",
                borderTop: i > 0 ? "1px dashed var(--border-dim, #2a3038)" : "none",
              }}>
                <div style={{ color: "var(--amber)", fontSize: 11 }}>
                  <span style={{ color: "var(--label)" }}>IF&nbsp;</span>{s.condition}
                </div>
                <div style={{ color: "var(--prose)", fontSize: 11, paddingLeft: 28 }}>
                  <span style={{ color: "var(--label)" }}>THEN&nbsp;</span>{s.action}
                </div>
              </div>
            ))}
          </>
        )}
        <div className="hr" />
        <Row k="Anchored target" v={brief.anchored_target} tone="num green" />
        <Row k="Anchored stop"   v={brief.anchored_stop}   tone="num red" />
        <Row k="Sizing if A+ today" v={brief.sizing_note} />
      </Panel>

      <section className="panel">
        <header className="panel-head">
          <span className="title">PRICE ALERTS</span>
          <span className="meta">
            <span style={{ color: "var(--green)" }}>{fired.length} fired</span>
            {" · "}
            <span style={{ color: "var(--amber)" }}>{Object.keys(armed).length} armed</span>
          </span>
        </header>
        <div className="panel-body flush">
          {fired.length === 0 && Object.keys(armed).length === 0 && (
            <div className="empty-state" style={{ padding: "14px" }}>
              <div style={{ color: "var(--label)", fontSize: 11 }}>no alerts armed</div>
              <div className="sub">click the ○ on any key level above to arm one</div>
            </div>
          )}
          {fired.length > 0 && (
            <div className="alerts-feed">
              {fired.map((a, i) => (
                <div className="alert-entry" key={i}>
                  <span className="when">{a.t}</span>
                  <span className="what">
                    <b>{a.name}</b> @ <span className="px">{a.px}</span> — {a.note || "price level reached"}
                  </span>
                  <span style={{ color: "var(--green)", fontSize: 9, letterSpacing: ".1em" }}>FIRED</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(armed).length > 0 && (
            <>
              <div style={{
                padding: "4px 14px",
                fontSize: 9.5, letterSpacing: ".18em",
                color: "var(--label)",
                borderTop: fired.length ? "1px solid var(--border-dim)" : "",
                background: "var(--surface-1)",
              }}>
                ARMED · WATCHING
              </div>
              {Object.entries(armed).map(([name, px]) => (
                <div className="alert-entry" key={name}>
                  <span className="when">—</span>
                  <span className="what">
                    <b>{name}</b> @ <span className="px">{px}</span>
                  </span>
                  <span style={{ color: "var(--amber)", fontSize: 9, letterSpacing: ".1em" }}>ARMED</span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export { PrepWorkstation };
