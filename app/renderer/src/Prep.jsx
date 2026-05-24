// PREP mode workstation — Session Brief.

import React from "react";
import { Panel, Row, Grade, PillarsPanel } from "./Shared.jsx";
import { useSessionBrief, formatAge } from "./hooks/useSessionBrief.js";
import { useSessionRecap } from "./hooks/useSessionRecap.js";

const SESSION_LABEL = {
  "london": "LONDON",
  "ny-am":  "NY AM",
  "ny-pm":  "NY PM",
};

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

function RefreshButton({ status, onClick, age }) {
  const running = status === "running";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: "var(--label)", fontSize: 10 }}>
        {running ? "claude is preparing…" : age != null ? `claude · ${formatAge(age)}` : ""}
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

function EmptyBrief({ status, session, onRefresh }) {
  const running = status === "running";
  return (
    <Panel title={`SESSION BRIEF · ${SESSION_LABEL[session] || "—"}`}
           right={<RefreshButton status={status} onClick={onRefresh} />}>
      <div style={{ color: "var(--label)", fontSize: 11.5, lineHeight: 1.6 }}>
        {running
          ? "Claude is preparing the session brief — HTF context, overnight ranges, key levels, and Pillar 1+2 grade. This takes ~15s."
          : status === "error"
          ? "The session brief failed to generate. Hit refresh to try again."
          : session
          ? "No brief yet for this session. Hit refresh to run one now — or wait for the next scheduled trigger (02:00 / 09:00 / 13:00 ET)."
          : "Outside trading windows — next session opens Monday 02:00 ET (London)."}
      </div>
    </Panel>
  );
}

function PrepWorkstation({ alerts, onToggleArm }) {
  const armed = alerts?.armed || {};
  const fired = alerts?.fired || [];

  const { brief, session, status, refresh, ageMs } = useSessionBrief();
  const { session: recapSession, recap } = useSessionRecap();

  if (!brief) {
    return (
      <div className="work-scroll">
        {recap && <RecapPanel session={recapSession} recap={recap} />}
        <EmptyBrief status={status} session={session} onRefresh={refresh} />
      </div>
    );
  }

  const levels = (brief.key_levels || []).map((lv) => ({
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
      <Panel title={`SESSION BRIEF · ${SESSION_LABEL[brief.session] || ""}`}
             right={<RefreshButton status={status} onClick={refresh} age={ageMs} />}>
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55 }}>
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
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6 }}>
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
