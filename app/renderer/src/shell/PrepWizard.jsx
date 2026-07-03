// PrepWizard — the guided 4-step pre-session flow (⌘K "Start prep" / the Briefing
// pill). A 560px overlay walking Calendar → Bias → Levels → Guards, each reusing
// the real session data (useCalendar / useSessionBrief / useAlerts) and the same
// guards store the Settings page edits. Step state (open/step/checks) lives in
// CommandShell; this component is presentation + the per-step hooks.

import React, { useState } from "react";
import { clickable } from "../a11y.js";
import { useSessionBrief } from "../hooks/useSessionBrief.js";
import { useCalendar } from "../hooks/useCalendar.js";
import { armAlertReal, disarmAlertReal, useAlertStateListener, normalizeArmed } from "../hooks/useAlerts.js";
import { decisionLine } from "../Prep.helpers.js";

const STEP_NAMES = ["CALENDAR", "BIAS", "LEVELS", "GUARDS"];
const sessionShort = (s) => ({ "ny-am": "NY-AM", "ny-pm": "NY-PM", london: "LONDON" }[s] ?? (s ?? ""));

function CalendarStep() {
  const events = useCalendar();
  const now = Date.now();
  const rows = (events || []).filter((e) => { const t = new Date(e?.ts).getTime(); return Number.isFinite(t) && t > now; }).slice(0, 6);
  return (
    <div className="cmd-prep-step">
      {rows.length ? rows.map((e, i) => {
        const hhmm = new Date(e.ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
        const imp = String(e.impact || "").toLowerCase();
        const cls = imp.includes("high") ? "high" : imp.includes("med") ? "med" : "low";
        const lbl = cls === "high" ? "HIGH" : cls === "med" ? "MED" : "LOW";
        return (
          <div key={i} className="cmd-prep-cal">
            <span className="t">{hhmm}</span><span className="ev">{e.event}</span><span className={"imp " + cls}>{lbl}</span>
          </div>
        );
      }) : <div className="cmd-prep-empty">No upcoming events on the calendar feed.</div>}
      <div className="cmd-prep-banner amber"><span className="tag">AUTO</span><span>No-entry window arms itself around the high-impact print.</span></div>
    </div>
  );
}

function BiasStep() {
  const { briefsBySymbol } = useSessionBrief();
  const syms = Object.keys(briefsBySymbol || {});
  return (
    <div className="cmd-prep-step">
      <div className="cmd-prep-bias">
        {syms.length ? syms.map((s) => {
          const d = decisionLine(briefsBySymbol[s]);
          return (
            <div key={s} className="cmd-prep-biascard">
              <div className="hd"><span className="sym">{s}</span><span className={"pill " + (d.gradeTone || "dim")}>{d.grade}</span></div>
              <div className={"bias " + (d.biasTone || "warn")}>{d.bias}</div>
            </div>
          );
        }) : <div className="cmd-prep-empty">No brief yet — HTF bias resolves once the session brief runs.</div>}
      </div>
      <div className="cmd-prep-banner blue"><span className="tag">COMPARE</span><span>Trade the leader — the stronger overnight side.</span></div>
    </div>
  );
}

function LevelsStep() {
  const { brief } = useSessionBrief();
  const [armed, setArmed] = useState([]);
  useAlertStateListener((ev) => setArmed(normalizeArmed(ev).map((a) => ({ id: a.id, price: a.price }))));
  const levels = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const armedFor = (price) => armed.find((a) => String(a.price) === String(price));
  const toggle = async (l) => { const a = armedFor(l.price); if (a) await disarmAlertReal(a.id); else await armAlertReal(String(l.price), l.name); };
  return (
    <div className="cmd-prep-step">
      {levels.length ? levels.map((l, i) => (
        <div key={i} className="cmd-prep-lvl">
          <span className={"bell" + (armedFor(l.price) ? " on" : "")} {...clickable(() => toggle(l), { label: "toggle alert" })}>{armedFor(l.price) ? "◈" : "◇"}</span>
          <span className="nm">{l.name}</span>
          <span className="px">{l.price}</span>
        </div>
      )) : <div className="cmd-prep-empty">No untaken levels yet.</div>}
      <div className="cmd-prep-hint">◈ arms a price alert per level.</div>
    </div>
  );
}

function GuardsStep({ guards, setGuards }) {
  // Dual-write like SettingsPage: setGuards is renderer/localStorage only, so the
  // main-process enforced guards (auto-fire + ⌘K quick-order) must also be pushed
  // via execution.config.set — otherwise a Prep edit silently desyncs enforcement.
  const bump = (k, d, lo, hi) => {
    const next = { ...guards, [k]: Math.max(lo, Math.min(hi, (Number(guards?.[k]) || 0) + d)) };
    setGuards(next);
    window.api?.execution?.config?.set?.({ guards: next }).catch(() => {});
  };
  const rows = [
    ["Max $ / trade", "perTradeMax", 25, 25, 2000, "per-order ceiling"],
    ["Daily loss limit", "dailyLimit", 50, 100, 5000, "locks entries when hit"],
    ["Default $ risk", "defaultRisk", 25, 25, 2000, "seeds each ticket"],
  ];
  return (
    <div className="cmd-prep-step">
      {rows.map(([name, k, inc, lo, hi, desc]) => (
        <div key={k} className="cmd-prep-guard">
          <div className="rk"><span className="n">{name}</span><span className="d">{desc}</span></div>
          <span className="cmd-set-step" {...clickable(() => bump(k, -inc, lo, hi), { label: "decrease " + name })}>−</span>
          <span className="v">${(Number(guards?.[k]) || 0).toLocaleString("en-US")}</span>
          <span className="cmd-set-step" {...clickable(() => bump(k, inc, lo, hi), { label: "increase " + name })}>+</span>
        </div>
      ))}
      <div className="cmd-prep-hint">Same guards as Settings (⌘6) — edits apply live.</div>
    </div>
  );
}

export function PrepWizard({ step, onNext, onBack, onClose, guards, setGuards }) {
  const { session } = useSessionBrief();
  const body = step === 0 ? <CalendarStep />
    : step === 1 ? <BiasStep />
    : step === 2 ? <LevelsStep />
    : <GuardsStep guards={guards} setGuards={setGuards} />;
  return (
    <div className="cmd-prep" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="icon tint-blue">◔</span>
        <span className="t">Prep session</span>
        <span className="stp">STEP {step + 1} OF 4 · {STEP_NAMES[step]}{session ? ` · ${sessionShort(session)}` : ""}</span>
        <span className="sp" style={{ flex: 1 }} />
        <span className="esc cmd-kbd" {...clickable(onClose, { label: "close prep" })}>esc</span>
      </div>
      <div className="body">{body}</div>
      <div className="foot">
        <div className="cmd-prep-dots">{[0, 1, 2, 3].map((i) => <span key={i} className={"dot " + (i < step ? "done" : i === step ? "now" : "todo")} />)}</div>
        <span className="sp" style={{ flex: 1 }} />
        {step > 0 && <span className="pill dim interactive" {...clickable(onBack, { label: "back" })}>Back</span>}
        <span className="pill primary" {...clickable(onNext, { label: step === 3 ? "finish prep" : "confirm and next" })}>{step === 3 ? "Finish prep" : "Confirm & next"}</span>
      </div>
    </div>
  );
}
