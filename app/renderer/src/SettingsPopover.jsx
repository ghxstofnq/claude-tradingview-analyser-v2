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
  const set = (k, v) => setGuards({ ...guards, [k]: v });
  const exec = useExecutionState();
  const broker = live ? "Tradovate · LIVE" : "Tradovate · DEMO";

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
