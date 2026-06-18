// SettingsPopover + AccountCell — ACCOUNT & EXECUTION settings, anchored to the
// account badge in the topbar. Real home for: PAPER<->LIVE arming (guarded,
// type-LIVE-to-arm), per-trade/daily-loss guardrails, default risk. Ported from
// the v4 mockup (pop-settings.jsx), props-based (no MOCK / no useWS), using
// Account.helpers. Account mode is ephemeral (App boots PAPER); guardrails
// persist there. Arming sets UI state now; the executionAdapter retargets the
// broker when the execution engine lands.
import React, { useState, useEffect, useRef } from "react";
import { armReady as isArmReady, realAccountView } from "./Account.helpers.js";
import { useExecutionState } from "./hooks/useExecutionState.js";
import { useBrokerAccount } from "./hooks/useBrokerAccount.js";

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

function SettingsPopover({ guards, setGuards, onClose }) {
  const exec = useExecutionState();

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
  // Broker-routing arming: the engine follows the ACTIVE TradingView account but
  // only routes to the CONFIRMED one; a switch needs a deliberate confirm. Read
  // the live state from main + poll.
  const [acct, setAcct] = useState(null);
  const [confirmTxt, setConfirmTxt] = useState("");
  const loadAcct = () => window.api?.execution?.account?.get?.().then((r) => { if (r?.ok) setAcct(r); }).catch(() => {});
  useEffect(() => { loadAcct(); const h = setInterval(loadAcct, 3000); return () => clearInterval(h); }, []);
  const acctGate = acct?.gate;
  // Truthful account view (what orders actually route to) — replaces the old
  // ephemeral renderer flag that could show a LIVE badge while routing stayed paper.
  const view = realAccountView(acct);
  const live = view.live;
  const broker = view.name || (live ? "Live account" : "Paper Trading");
  const confirmAccount = async () => {
    const r = await window.api?.execution?.account?.confirm?.(confirmTxt.trim().toUpperCase());
    if (r?.ok) { setConfirmTxt(""); loadAcct(); }
  };
  const resumeAuto = async () => { await window.api?.execution?.account?.resumeAuto?.(); loadAcct(); };

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
          <div className="guard-foot">Arm &amp; confirm routing in <b>BROKER ROUTING</b> below — this reflects what orders route to.</div>
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
        <div className="section">
          <div className="sect-hd"><span>BROKER ROUTING</span><span className="meta">FOLLOWS THE ACTIVE ACCOUNT</span></div>
          <Row k="Active" v={acct?.active
            ? <span>{acct.active.name || acct.active.id} · <b style={{ color: acct.active.type === "live" ? "var(--red)" : "var(--label)" }}>{(acct.active.type || "").toUpperCase()}</b></span>
            : <span style={{ color: "var(--amber)" }}>unknown — open the trading panel</span>} />
          <Row k="Confirmed" v={acct?.confirmed
            ? <span>{acct.confirmed.name || acct.confirmed.id} · {(acct.confirmed.type || "").toUpperCase()}</span>
            : <span style={{ color: "var(--amber)" }}>none</span>} />
          <Row k="Routing" v={acctGate?.route
            ? <span style={{ color: "var(--green)" }}>● OK</span>
            : <span style={{ color: "var(--amber)" }}>{acctGate?.reason === "no_active_account" ? "blocked — no active account" : "blocked — confirm the switch"}</span>} />
          {acctGate?.needsConfirm && acctGate.level === "live" && (
            <div className="arm-gate">
              <div className="warn"><span className="hz" />
                <span>Active account is <b>LIVE (real money)</b>. Type <b>LIVE</b> to route to it.</span>
              </div>
              <div className="arm-row">
                <input className={"arm-input" + (isArmReady(confirmTxt.trim().toUpperCase()) ? " ok" : "")} value={confirmTxt}
                  placeholder="type LIVE to confirm" onChange={(e) => setConfirmTxt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmAccount(); }} />
                <button className={"arm-confirm" + (isArmReady(confirmTxt.trim().toUpperCase()) ? "" : " off")}
                  disabled={!isArmReady(confirmTxt.trim().toUpperCase())} onClick={confirmAccount}>CONFIRM LIVE</button>
              </div>
            </div>
          )}
          {acctGate?.needsConfirm && acctGate.level === "paper" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="arm-confirm" onClick={confirmAccount}>ROUTE TO {acct?.active?.name || "ACCOUNT"}</button>
            </div>
          )}
          {acct?.confirmed?.type === "live" && acct?.autoResumed === false && (
            <div className="arm-gate">
              <div className="warn live"><span className="hz" />
                <span>LIVE auto is <b>paused</b> after restart — manual entries work; tap to resume auto-fire.</span>
              </div>
              <button className="arm-confirm" onClick={resumeAuto}>RESUME LIVE AUTO</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountCell({ guards, setGuards }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  const { acct } = useBrokerAccount();
  const live = realAccountView(acct).live;
  return (
    <div className={"cell pop-cell acct-cell" + (live ? " live" : "") + (open ? " open" : "")} ref={ref}
      onClick={(e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); }}
      title="account & execution settings">
      <span className={"acct-badge " + (live ? "live" : "paper")}>
        <span className="d" />{live ? "LIVE" : "PAPER"}<span className="sub">{live ? "REAL" : "SIM"}</span>
        <span className="gear">▾</span>
      </span>
      {open && <SettingsPopover guards={guards} setGuards={setGuards} onClose={() => setOpen(false)} />}
    </div>
  );
}

export { SettingsPopover };
