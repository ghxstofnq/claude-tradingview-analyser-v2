// SettingsPopover + AccountCell — ACCOUNT & EXECUTION settings, anchored to the
// account badge in the topbar. Real home for: PAPER<->LIVE arming (guarded,
// type-LIVE-to-arm), per-trade/daily-loss guardrails, default risk. Ported from
// the v4 mockup (pop-settings.jsx), props-based (no MOCK / no useWS), using
// Account.helpers. Account mode is ephemeral (App boots PAPER); guardrails
// persist there. Arming sets UI state now; the executionAdapter retargets the
// broker when the execution engine lands.
import React, { useState, useEffect, useRef } from "react";
import { armReady as isArmReady } from "./Account.helpers.js";
import { useExecutionState } from "./hooks/useExecutionState.js";

function Row({ k, v }) {
  return (
    <div className="row"><span className="k">{k}</span><span className="v">{v}</span></div>
  );
}

function GuardField({ label, hint, value, onChange }) {
  return (
    <div className="set-field">
      <span className="k">{label}{hint && <i>{hint}</i>}</span>
      <div className="set-input">
        <span className="pre">$</span>
        <input type="text" inputMode="numeric" value={value}
          onChange={(e) => onChange(+(e.target.value.replace(/[^0-9]/g, "") || 0))} />
      </div>
    </div>
  );
}

function SettingsPopover({ account, setAccount, guards, setGuards, onClose }) {
  const live = account === "live";
  const [arming, setArming] = useState(false);
  const [txt, setTxt] = useState("");
  const ready = isArmReady(txt.trim().toUpperCase());
  const arm = () => { if (!ready) return; setAccount("live"); setArming(false); setTxt(""); };
  const exec = useExecutionState();
  const broker = live ? "Tradovate · LIVE" : "Tradovate · DEMO";

  // Execution config (automation mode + risk knobs) lives in main so auto-fire
  // can read it. Load on mount; every change persists to both renderer state
  // (the live ticket) and main (auto-fire enforcement).
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    window.api?.execution?.config?.get?.().then((r) => { if (r?.ok) setCfg(r.config); }).catch(() => {});
  }, []);
  const setCfgPatch = (patch) => {
    setCfg((c) => ({ ...(c || {}), ...patch }));
    window.api?.execution?.config?.set?.(patch).catch(() => {});
  };
  const set = (k, v) => {
    const next = { ...guards, [k]: v };
    setGuards(next);
    window.api?.execution?.config?.set?.({ guards: next }).catch(() => {});
  };
  const mode = cfg?.automationMode ?? "manual";
  const modeBtn = (v, l) => (
    <button key={v} onClick={() => setCfgPatch({ automationMode: v })}
      style={{ flex: 1, padding: "5px 6px", fontSize: 10, letterSpacing: ".06em", cursor: "pointer",
        border: "1px solid " + (mode === v ? "var(--accent, #6e7ff3)" : "var(--border)"),
        background: mode === v ? "var(--surface-2)" : "transparent",
        color: mode === v ? "var(--value-strong)" : "var(--label)" }}>{l}</button>
  );

  return (
    <div className="bt-popover settings-pop" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className={"t" + (live ? " pause" : "")}>ACCOUNT &amp; EXECUTION</span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="x" onClick={onClose}>×</span>
      </div>
      <div className="body">
        <div className="section">
          <div className="sect-hd"><span>ACTIVE ACCOUNT</span></div>
          <div className="acct-state">
            <span className={"acct-chip " + (live ? "live" : "paper")}><span className="d" />{live ? "LIVE" : "PAPER"}</span>
            <span className="acct-broker">{broker}</span>
          </div>
          {!live && !arming && (
            <button className="arm-btn" onClick={() => setArming(true)}>▲  ARM LIVE TRADING…</button>
          )}
          {!live && arming && (
            <div className="arm-gate">
              <div className="warn"><span className="hz" />
                <span>LIVE routes <b>real orders</b> to the broker. Tickets fire on accept with <b>no per-order confirm</b>. Type <b>LIVE</b> to arm.</span>
              </div>
              <div className="arm-row">
                <input className={"arm-input" + (ready ? " ok" : "")} value={txt} placeholder="type LIVE to arm" autoFocus
                  onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") arm(); }} />
                <button className="arm-cancel" onClick={() => { setArming(false); setTxt(""); }}>CANCEL</button>
                <button className={"arm-confirm" + (ready ? "" : " off")} disabled={!ready} onClick={arm}>ARM</button>
              </div>
            </div>
          )}
          {live && (
            <div className="arm-gate">
              <div className="warn live"><span className="hz" />
                <span>LIVE is armed — orders hit the broker for real. Day P&amp;L counts against the loss limit.</span>
              </div>
              <button className="disarm-btn" onClick={() => setAccount("paper")}>■  RETURN TO PAPER</button>
            </div>
          )}
        </div>
        <div className="section">
          <div className="sect-hd"><span>RISK GUARDRAILS</span><span className="meta">ENFORCED ON EVERY TICKET</span></div>
          <GuardField label="Max $ / trade" hint="per-order ceiling" value={guards.perTradeMax} onChange={(v) => set("perTradeMax", v)} />
          <GuardField label="Daily loss limit" hint="locks new entries when hit" value={guards.dailyLimit} onChange={(v) => set("dailyLimit", v)} />
          <GuardField label="Default $ risk" hint="seeds each new ticket" value={guards.defaultRisk} onChange={(v) => set("defaultRisk", v)} />
          <div className="guard-foot">Today: <b>—</b> · $0 of ${guards.dailyLimit} loss limit used</div>
        </div>
        <div className="section">
          <div className="sect-hd"><span>AUTOMATION</span><span className="meta">SCALE-IN ENGINE · PAPER</span></div>
          <div className="set-field">
            <span className="k">Mode<i>who fires trades</i></span>
            <div style={{ display: "flex", gap: 4, flex: 1 }}>
              {modeBtn("manual", "Manual")}
              {modeBtn("anchor-auto-adds", "Anchor+Adds")}
              {modeBtn("auto", "Full-auto")}
            </div>
          </div>
          <div className="set-field">
            <span className="k">Max adds<i>concurrent scale-ins</i></span>
            <div className="set-input">
              <input type="text" inputMode="numeric" value={cfg?.maxAdds ?? 5}
                onChange={(e) => setCfgPatch({ maxAdds: +(e.target.value.replace(/[^0-9]/g, "") || 0) })} />
            </div>
          </div>
          <div className="set-field">
            <span className="k">Combined cap<i>blank = none</i></span>
            <div className="set-input"><span className="pre">$</span>
              <input type="text" inputMode="numeric" value={cfg?.combinedCapUsd ?? ""}
                onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); setCfgPatch({ combinedCapUsd: raw === "" ? null : +raw }); }} />
            </div>
          </div>
          {mode !== "manual" && (
            <div className="guard-foot" style={{ color: "var(--amber)" }}>
              ⚠ {mode === "auto" ? "Anchor + adds" : "Adds"} fire automatically on paper — up to {(cfg?.maxAdds ?? 5) + 1} stacked positions.
            </div>
          )}
        </div>
        <div className="section">
          <div className="sect-hd"><span>EXECUTION</span></div>
          <Row k="Broker" v={exec.connected
            ? <span style={{ color: "var(--green)" }}>● PAPER TRADING</span>
            : <span style={{ color: "var(--amber)" }}>{exec.loading ? "checking…" : "○ not connected — connect in TradingView"}</span>} />
          <Row k="Per-order confirm" v={<span style={{ color: "var(--amber)" }}>OFF · fires on accept</span>} />
          <Row k="Default order type" v="MARKET" />
          <Row k="Detector" v={<span style={{ color: "var(--green)" }}>● RUNNING</span>} />
        </div>
      </div>
    </div>
  );
}

export function AccountCell({ account, setAccount, guards, setGuards }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  const live = account === "live";
  return (
    <div className={"cell pop-cell acct-cell" + (open ? " open" : "")} ref={ref}
      onClick={(e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); }}
      title="account & execution settings">
      <span className={"acct-badge " + (live ? "live" : "paper")}>
        <span className="d" />{live ? "LIVE" : "PAPER"}<span className="sub">{live ? "REAL" : "SIM"}</span>
        <span className="gear">▾</span>
      </span>
      {open && <SettingsPopover account={account} setAccount={setAccount} guards={guards} setGuards={setGuards} onClose={() => setOpen(false)} />}
    </div>
  );
}

export { SettingsPopover };
