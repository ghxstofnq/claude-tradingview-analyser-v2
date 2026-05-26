// PREP mode workstation — Session Brief.
// Layout mirrors the strategy doc's 7-step checklist.

import React, { useEffect, useState } from "react";
import { Panel, Row, Grade, ScenarioCard } from "./Shared.jsx";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { useSessionRecap } from "./hooks/useSessionRecap.js";
import {
  groupLevelsByPrice,
  selectPillar,
  pillar2ToRows,
  formatChainChip,
} from "./Prep.helpers.js";

const SESSION_LABEL = {
  "london": "LONDON",
  "ny-am":  "NY AM",
  "ny-pm":  "NY PM",
};

// Normalize a key_level name for day-over-day diffing. Strips a trailing
// parenthetical state suffix and surrounding whitespace, so "AS.L" and
// "AS.L (swept-rejected)" compare equal. The state field already carries
// taken/untaken — the suffix is just decoration that breaks the diff.
function normalizeLevelName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Compute a summary of what changed between two briefs.
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
  const curMap = new Map();
  for (const l of current.key_levels || []) curMap.set(normalizeLevelName(l.name), l.name);
  const priMap = new Map();
  for (const l of prior.key_levels || []) priMap.set(normalizeLevelName(l.name), l.name);
  const added = [...curMap.keys()].filter((n) => !priMap.has(n)).map((n) => curMap.get(n));
  const removed = [...priMap.keys()].filter((n) => !curMap.has(n)).map((n) => priMap.get(n));
  if (added.length) rows.push({ k: "New levels", v: added.join(", ") });
  if (removed.length) rows.push({ k: "Dropped levels", v: removed.join(", ") });
  return rows;
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

// STATUS STRIP — replaces the old StaleBriefBanner + ChangedPanel +
// inline ChainStatusChip + RefreshButton. One thin row at the top of
// PREP that consolidates all four signals.
const STALE_BRIEF_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function StatusStrip({ ageMs, briefTs, chainStatus, refreshStatus, onRefresh, onToggleDiff, diffOpen }) {
  const stale = ageMs != null && ageMs >= STALE_BRIEF_THRESHOLD_MS;
  const ageLabel = ageMs != null ? formatAge(ageMs) : null;
  const etTime = briefTs ? formatEtTime(briefTs) : "";
  const chip = formatChainChip(chainStatus);
  const running = refreshStatus === "running";
  return (
    <div className={"status-strip" + (stale ? " stale" : "")}>
      <span>
        {ageLabel && <span className="age">claude · {ageLabel}</span>}
        {etTime && <span className="et"> @ {etTime} ET</span>}
        {!ageLabel && !etTime && <span className="et">no brief yet</span>}
      </span>
      <span>
        {chip.visible && (
          <span className={"chip " + (chip.tone === "stale" ? "stale" : "")}>
            {chip.label}
          </span>
        )}
      </span>
      <span className="diff-link" onClick={onToggleDiff}>
        CHANGED SINCE LAST {diffOpen ? "▾" : "▸"}
      </span>
      <button
        onClick={onRefresh}
        disabled={running}
        style={{
          color: running ? "var(--label)" : "var(--amber)",
          background: "transparent",
          border: "1px solid var(--border)",
          padding: "2px 9px",
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 9.5,
          letterSpacing: ".16em",
          cursor: running ? "default" : "pointer",
        }}>
        {running ? "[ ··· ]" : "[ REFRESH ]"}
      </button>
    </div>
  );
}

// Inline expansion of the day-over-day diff, opened by clicking
// "CHANGED SINCE LAST ▸" in the StatusStrip. Renders nothing when
// closed; renders a placeholder when no prior brief exists.
function InlineChanges({ open, session, brief }) {
  const [prior, setPrior] = useState(null);
  const [priorDate, setPriorDate] = useState(null);
  useEffect(() => {
    if (!open || !session || !brief) return;
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
  }, [open, session, brief?.ts]);

  if (!open) return null;
  if (!prior) {
    return (
      <Panel title={`CHANGED SINCE LAST ${SESSION_LABEL[session] || ""} BRIEF`}>
        <Row k="—" v="no prior brief on file" tone="dim" />
      </Panel>
    );
  }
  const changes = diffBriefs(brief, prior);
  if (!changes.length) {
    return (
      <Panel title={`CHANGED SINCE LAST ${SESSION_LABEL[session] || ""} BRIEF`}
             right={<span style={{ color: "var(--label)", fontSize: 10 }}>vs {priorDate}</span>}>
        <Row k="—" v="no changes since prior brief" tone="dim" />
      </Panel>
    );
  }
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

function EmptyBrief({ status, statusReason, progress, session }) {
  const running = status === "running";
  let message;
  if (running) {
    const progressNote = progress > 0 ? ` (${progress} tool ${progress === 1 ? "call" : "calls"} so far)` : "";
    message = `Claude is preparing the session brief${progressNote} — HTF context, overnight ranges, key levels, and Pillar 1+2 grade. This takes 2-5 minutes.`;
  } else if (status === "error") {
    message = `The session brief failed${statusReason ? `: ${statusReason}` : ""}. Hit refresh to try again.`;
  } else if (status === "skipped") {
    message = `Brief skipped${statusReason ? `: ${statusReason}` : ""}.`;
  } else if (session) {
    message = "No brief yet for this session. Hit refresh to run one now — or wait for the next scheduled trigger (02:00 / 09:00 / 13:00 ET).";
  } else {
    message = "Outside trading windows — next session opens Monday 02:00 ET (London).";
  }
  return (
    <Panel title={`SESSION BRIEF · ${SESSION_LABEL[session] || "—"}`}>
      <div style={{ color: "var(--label)", fontSize: 11.5, lineHeight: 1.6 }}>
        {message}
      </div>
    </Panel>
  );
}

// STEP 1 · HTF BIAS — D/4H/1H rows + primary draw sub-section.
function Step1Panel({ htfBias = [], primaryDraw, htfDestination }) {
  return (
    <Panel title="STEP 1 · HTF BIAS"
           right={<span className="step-meta">D / 4H / 1H + primary draw</span>}>
      {htfBias.map((r) => (
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
      {primaryDraw && (
        <>
          <div style={{
            color: "var(--label)", fontSize: 9, letterSpacing: ".18em",
            padding: "8px 0 4px", borderTop: "1px dotted var(--border)",
            marginTop: 6,
          }}>
            PRIMARY HTF DRAW
          </div>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="k" style={{ minWidth: 50 }}>
              {(primaryDraw.tf || "").toUpperCase()} {primaryDraw.kind} {primaryDraw.dir}
            </span>
            <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14 }}>
              <span title={primaryDraw.cite || undefined}
                    style={{ color: "var(--prose)", borderBottom: primaryDraw.cite ? "1px dotted var(--label)" : undefined, cursor: primaryDraw.cite ? "help" : undefined }}>
                {formatPx(primaryDraw.bottom)} – {formatPx(primaryDraw.top)}
              </span>
              <span style={{ marginLeft: 8, color: "var(--label)", fontSize: 11 }}>
                disp_score {primaryDraw.disp_score} · {primaryDraw.state}
              </span>
            </span>
          </div>
          {htfDestination && (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span className="k" style={{ minWidth: 50 }}>DEST</span>
              <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14, color: "var(--prose)" }}>
                {htfDestination}
              </span>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// STEP 2 · OVERNIGHT + LEVELS — Asia/London rows + untaken above/below
// sub-sections (alert bells preserved).
function Step2Panel({ overnight = [], levels = [], currentPrice, armed, fired, onToggleArm }) {
  const grouped = groupLevelsByPrice(levels, currentPrice);
  const renderLevel = (lv) => {
    const px = formatPx(lv.price);
    const isArmed = !!armed[lv.name];
    const isFired = fired.some((f) => f.name === lv.name);
    return (
      <div className="level-row" key={lv.name}>
        <span className="marker">{lv.state === "untaken" ? "─" : "·"}</span>
        <span className="name" title={lv.cite || undefined}
              style={lv.cite ? { borderBottom: "1px dotted var(--label)", cursor: "help" } : undefined}>
          {lv.name}
        </span>
        <span className="price" title={lv.cite || undefined}>{px}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={"state " + (lv.state || "untaken")}>
            {(lv.state || "untaken").toUpperCase()}
          </span>
          <span className={"bell" + (isFired ? " fired" : isArmed ? " armed" : "")}
                title={isFired ? "alert fired" : isArmed ? "alert armed — click to disarm" : "set alert"}
                onClick={() => onToggleArm && onToggleArm(lv.name, px)}>
            {isFired ? "◉" : isArmed ? "●" : "○"}
          </span>
        </span>
      </div>
    );
  };
  return (
    <Panel title="STEP 2 · OVERNIGHT + LEVELS"
           right={<span className="step-meta">Asia + London + untaken liquidity</span>}>
      {overnight.map((r, i) => <Row key={i} k={r.k} v={r.v} tone={r.tone} />)}

      {grouped.above && grouped.above.length > 0 && (
        <div className="untaken-block">
          <div className="head">UNTAKEN ABOVE</div>
          {grouped.above.map(renderLevel)}
        </div>
      )}
      {grouped.below && grouped.below.length > 0 && (
        <div className="untaken-block">
          <div className="head">UNTAKEN BELOW</div>
          {grouped.below.map(renderLevel)}
        </div>
      )}
      {grouped.all && grouped.all.length > 0 && (
        <div className="untaken-block">
          <div className="head">LEVELS</div>
          {grouped.all.map(renderLevel)}
        </div>
      )}
    </Panel>
  );
}

// STEP 3 · PRICE QUALITY — Pillar 2 broken out into 3 rows.
function Step3Panel({ pillars }) {
  const pillar2 = selectPillar(pillars, /price.*action|quality/i);
  const rows = pillar2ToRows(pillar2);
  return (
    <Panel title="STEP 3 · PRICE QUALITY"
           right={<span className="step-meta">Pillar 2 · the &quot;tradeable today?&quot; filter</span>}>
      {rows.map((r) => <Row key={r.k} k={r.k} v={r.v} tone={r.tone} />)}
    </Panel>
  );
}

// One-line PRE-SESSION GRADE headline — replaces the full pillar drilldown.
function GradeHeadline({ pillarGrade, pillars }) {
  const p1 = selectPillar(pillars, /draw.*bias/i);
  const p2 = selectPillar(pillars, /price.*action|quality/i);
  return (
    <Panel title="PRE-SESSION GRADE" right={<span className="step-meta">aggregate of pillars 1 + 2</span>}>
      <div className="pillar-headline">
        <Grade value={pillarGrade || "no-trade"} />
        <span className="why">
          {p1 && <>Pillar 1 <span className={p1.status}>{(p1.status || "").toUpperCase()}</span></>}
          {p1 && p2 && " · "}
          {p2 && <>Pillar 2 <span className={p2.status}>{(p2.status || "").toUpperCase()}</span></>}
          {!p1 && !p2 && "—"}
        </span>
      </div>
    </Panel>
  );
}

function PrepWorkstation({ alerts, onToggleArm, currentPrice }) {
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

  const [diffOpen, setDiffOpen] = useState(false);

  // Empty state: recap + status strip + empty brief.
  if (!brief) {
    return (
      <div className="work-scroll">
        {recap && <RecapPanel session={recapSession} recap={recap} />}
        <StatusStrip
          ageMs={ageMs}
          briefTs={null}
          chainStatus={null}
          refreshStatus={status}
          onRefresh={refresh}
          onToggleDiff={() => setDiffOpen((o) => !o)}
          diffOpen={diffOpen}
        />
        <InlineChanges open={diffOpen} session={session} brief={null} />
        <EmptyBrief
          status={status}
          statusReason={statusReason}
          progress={progress}
          session={session}
        />
      </div>
    );
  }

  // Levels — defensive sort by price desc, then handed to groupLevelsByPrice.
  const levels = (brief.key_levels || [])
    .slice()
    .sort((a, b) => {
      const an = typeof a.price === "number" ? a.price : -Infinity;
      const bn = typeof b.price === "number" ? b.price : -Infinity;
      return bn - an;
    })
    .map((lv) => ({
      name: lv.name,
      price: lv.price,
      state: lv.state || "untaken",
      cite: typeof lv.cite === "string" ? lv.cite : null,
    }));

  return (
    <div className="work-scroll">
      {recap && recapSession !== brief.session && (
        <RecapPanel session={recapSession} recap={recap} />
      )}

      <StatusStrip
        ageMs={ageMs}
        briefTs={brief.ts}
        chainStatus={brief.chain_status}
        refreshStatus={status}
        onRefresh={refresh}
        onToggleDiff={() => setDiffOpen((o) => !o)}
        diffOpen={diffOpen}
      />
      <InlineChanges open={diffOpen} session={brief.session} brief={brief} />

      <Panel title={`SESSION BRIEF · ${SESSION_LABEL[brief.session] || ""}${selectedSymbol ? ` · ${selectedSymbol}` : ""}`}>
        {availableSymbols.length > 1 && (
          <div style={{ display: "flex", gap: 6, padding: "0 0 8px" }}>
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

      <Step1Panel
        htfBias={brief.htf_bias || []}
        primaryDraw={brief.primary_draw}
        htfDestination={brief.htf_destination}
      />

      <Step2Panel
        overnight={brief.overnight || []}
        levels={levels}
        currentPrice={currentPrice}
        armed={armed}
        fired={fired}
        onToggleArm={onToggleArm}
      />

      <Step3Panel pillars={brief.pillars || []} />

      <GradeHeadline pillarGrade={brief.pillar_grade} pillars={brief.pillars || []} />

      {Array.isArray(brief.scenarios) && brief.scenarios.length > 0 && (
        <Panel title="SCENARIOS · IF / THEN" right={<span className="step-meta">claude proposed</span>}>
          {brief.scenarios.map((s, i) => (
            <ScenarioCard key={s.id || i} scenario={s} />
          ))}
        </Panel>
      )}

      <Panel title="CLAUDE · PLAN FOR THE OPEN">
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {brief.plan}
        </div>
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
              <div className="sub">click the ○ on any untaken level above to arm one</div>
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
