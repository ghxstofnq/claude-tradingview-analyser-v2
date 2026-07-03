// SettingsPage — ⌘6. Native 2-col card grid (Batch C): AUTOMATION + LIVE ROUTING,
// SESSION GUARDS + RISK SIZING, PREFERENCES full-width. Reuses SettingsPopover's
// real logic verbatim — the guarded type-LIVE arming, the enforced guards store
// (same one the Prep wizard edits), and the automation-mode config. Nothing is
// faked: controls the app can't back yet (SUGGEST auto-fire, max-trades/consec
// guards, revert-to-sim) are intentionally not shown — see the polish PR notes.

import React, { useState, useEffect } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { clickable } from "../../a11y.js";
import { armReady as isArmReady, realAccountView } from "../../Account.helpers.js";
import { useExecutionState } from "../../hooks/useExecutionState.js";
import { useHealth } from "../../hooks/useHealth.js";
import { useFills } from "../../hooks/useFills.js";
import { usePrefs } from "../../hooks/usePrefs.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const pointValueFor = (sym) => (/^M?ES/i.test(sym) ? 5 : /^M?NQ/i.test(sym) || /NQ/i.test(sym) ? 2 : 2);

function Card({ label, right, live, children }) {
  return (
    <div className={"cmd-set-card" + (live ? " live" : "")}>
      <div className="cmd-set-hd"><span>{label}</span>{right}</div>
      {children}
    </div>
  );
}

function Stepper({ name, desc, value, fmt, onStep }) {
  return (
    <div className="cmd-set-row">
      <div className="rk"><span className="n">{name}</span>{desc && <span className="d">{desc}</span>}</div>
      <span className="cmd-set-step" {...clickable(() => onStep(-1), { label: "decrease " + name })}>−</span>
      <span className="cmd-set-num">{fmt ? fmt(value) : value}</span>
      <span className="cmd-set-step" {...clickable(() => onStep(1), { label: "increase " + name })}>+</span>
    </div>
  );
}

function Toggle({ name, desc, on, onToggle }) {
  return (
    <div className="cmd-set-row">
      <div className="rk"><span className="n">{name}</span>{desc && <span className="d">{desc}</span>}</div>
      <span className={"cmd-set-switch" + (on ? " on" : "")} {...clickable(onToggle, { label: name })}><i /></span>
    </div>
  );
}

export function SettingsPage({ guards, setGuards, symbol = "MNQ1!", onClose, onToast }) {
  const exec = useExecutionState();
  const health = useHealth();
  const { fills } = useFills(new Date().toISOString().slice(0, 10));
  const todayLossUsd = Math.abs((fills || []).reduce((s, f) => s + Math.min(0, Number(f?.actual?.usd) || 0), 0));
  const { prefs, setPref } = usePrefs();

  const [cfg, setCfg] = useState(null);
  useEffect(() => { window.api?.execution?.config?.get?.().then((r) => { if (r?.ok) setCfg(r.config); }).catch(() => {}); }, []);
  const setMode = (m) => { setCfg((c) => ({ ...(c || {}), automationMode: m })); window.api?.execution?.config?.set?.({ automationMode: m }).catch(() => {}); onToast?.(`Automation → ${m.toUpperCase()}`, m === "auto" ? "amber" : "blue"); };
  const setGuard = (k, v) => { const next = { ...guards, [k]: v }; setGuards(next); window.api?.execution?.config?.set?.({ guards: next }).catch(() => {}); };

  // Broker routing — the real guarded arming path (identical to SettingsPopover).
  const [acct, setAcct] = useState(null);
  const [confirmTxt, setConfirmTxt] = useState("");
  const loadAcct = () => window.api?.execution?.account?.get?.().then((r) => { if (r?.ok) setAcct(r); }).catch(() => {});
  useEffect(() => { loadAcct(); const h = setInterval(loadAcct, 3000); return () => clearInterval(h); }, []);
  const acctGate = acct?.gate;
  const view = realAccountView(acct);
  const live = view.live;
  const broker = view.name || (live ? "Live account" : "Paper Trading");
  const confirmAccount = async () => { const r = await window.api?.execution?.account?.confirm?.(confirmTxt.trim().toUpperCase()); if (r?.ok) { setConfirmTxt(""); loadAcct(); onToast?.("Routing armed", "red"); } };
  const resumeAuto = async () => { await window.api?.execution?.account?.resumeAuto?.(); loadAcct(); };

  const mode = cfg?.automationMode ?? "manual";
  const loopRunning = health?.loop === "healthy";
  const tripped = guards?.dailyLimit ? todayLossUsd >= guards.dailyLimit : false;
  const autoSuspended = mode === "auto" && (!loopRunning || tripped);
  const armReadyNow = isArmReady(confirmTxt.trim().toUpperCase());

  const MODE_DESC = {
    manual: "The agent proposes setups and narrates — nothing fires without your ✓ accept on the Agent/Live page.",
    auto: "Accepted playbook setups fire without confirmation. Guards and news windows still block every entry.",
  };

  // Risk sizing — real: seed $ risk ÷ (stop × $/pt) → contracts. No fabricated
  // account-balance model; defaultRisk is the enforced per-ticket seed.
  const ptVal = pointValueFor(symbol);
  const stopPts = 24.25;
  const risk = Number(guards?.defaultRisk) || 0;
  const contracts = risk > 0 ? Math.floor(risk / (stopPts * ptVal)) : 0;
  const symShort = String(symbol).replace(/1!$/, "");

  const resume = () => {
    if (tripped) { onToast?.("Daily-loss guard tripped — locked until tomorrow", "red"); return; }
    window.api?.detector?.start?.(); resumeAuto(); onToast?.("Live auto resumed", "green");
  };

  return (
    <Page icon={PAGE_ICONS.settings} tint="mute" title="Settings" page="settings"
          sub={`${broker} · ${live ? "LIVE" : "SIM"}`} hint="edits apply immediately" onClose={onClose}>
      <div className="cmd-set-grid">
        {autoSuspended && (
          <div className="cmd-set-suspend">
            <span className="tag">SUSPENDED</span>
            <span className="rsn">{tripped ? "Daily-loss guard tripped — auto entries locked." : "Detector stopped — auto can't take turns."}</span>
            {!tripped && <span className="pill primary" {...clickable(resume, { label: "resume live auto" })}>RESUME LIVE AUTO</span>}
          </div>
        )}

        <Card label="AUTOMATION">
          <div className="cmd-set-seg">
            {[["manual", "MANUAL"], ["auto", "AUTO"]].map(([v, l]) => (
              <span key={v} className={"cmd-set-seg-opt" + (mode === v ? " on" : "")} {...clickable(() => setMode(v), { label: l })}>{l}</span>
            ))}
          </div>
          <p className="cmd-set-desc">{MODE_DESC[mode] || MODE_DESC.manual}</p>
        </Card>

        <Card label="LIVE ROUTING" live={live}
              right={<span className={"cmd-set-routechip " + (live ? "live" : "sim")}>{live ? "LIVE" : "SIM · PAPER"}</span>}>
          <div className="cmd-set-acct">{broker}</div>
          {acctGate?.needsConfirm && acctGate.level === "live" ? (
            <>
              <p className="cmd-set-desc"><span className="red">Active account is LIVE (real money).</span> Type LIVE to route real orders to it.</p>
              <div className="cmd-set-arm">
                <input className={"cmd-set-arm-input" + (armReadyNow ? " ok" : "")} value={confirmTxt}
                       placeholder="type LIVE to confirm" onChange={(e) => setConfirmTxt(e.target.value)}
                       onKeyDown={(e) => { if (e.key === "Enter") confirmAccount(); }} />
                <button className={"cmd-set-arm-btn" + (armReadyNow ? "" : " off")} disabled={!armReadyNow} onClick={confirmAccount}>CONFIRM LIVE</button>
              </div>
            </>
          ) : acctGate?.needsConfirm && acctGate.level === "paper" ? (
            <>
              <p className="cmd-set-desc">Paper routing. Confirm to route tickets to {broker}.</p>
              <div className="cmd-set-arm end"><button className="cmd-set-arm-btn" onClick={confirmAccount}>ROUTE TO {(acct?.active?.name || "ACCOUNT").toUpperCase()}</button></div>
            </>
          ) : acct?.confirmed?.type === "live" && acct?.autoResumed === false ? (
            <>
              <p className="cmd-set-desc"><span className="red">Live auto paused after restart.</span> Manual entries work; resume to re-arm auto-fire.</p>
              <div className="cmd-set-arm end"><button className="cmd-set-arm-btn" onClick={resumeAuto}>RESUME LIVE AUTO</button></div>
            </>
          ) : (
            <p className="cmd-set-desc">{live ? "Live routing armed. Tickets send real orders. Guards stay enforced." : "Paper routing. Orders are simulated — guards still enforced."}</p>
          )}
        </Card>

        <Card label="SESSION GUARDS">
          <Stepper name="Daily loss limit" desc="entries lock for the day when hit" value={guards?.dailyLimit ?? 0} fmt={usd}
                   onStep={(d) => setGuard("dailyLimit", clamp((guards?.dailyLimit ?? 0) + d * 50, 100, 5000))} />
          <Stepper name="Max $ / trade" desc="per-order ceiling" value={guards?.perTradeMax ?? 0} fmt={usd}
                   onStep={(d) => setGuard("perTradeMax", clamp((guards?.perTradeMax ?? 0) + d * 25, 25, 2000))} />
          <div className={"cmd-set-foot" + (tripped ? " bad" : todayLossUsd >= (guards?.dailyLimit ?? Infinity) * 0.7 ? " warn" : "")}>
            Today: <b>{usd(todayLossUsd)}</b> of {usd(guards?.dailyLimit ?? 0)} used · applies immediately.
          </div>
        </Card>

        <Card label="RISK SIZING">
          <Stepper name="Default $ risk" desc="seeds each new ticket" value={risk} fmt={usd}
                   onStep={(d) => setGuard("defaultRisk", clamp(risk + d * 25, 25, 2000))} />
          <div className="cmd-set-calc">= {usd(risk)} risk · {contracts} {symShort} contract{contracts === 1 ? "" : "s"} at a 24¼-pt stop (${ptVal}/pt)</div>
        </Card>

        <div className="cmd-set-prefs">
          <Card label="PREFERENCES">
            <Toggle name="Desktop notification on alert" desc="system notification when a price alert fires" on={prefs.notif} onToggle={() => setPref("notif", !prefs.notif)} />
            <Toggle name="Sound on alert" desc="short tick when a price alert fires" on={prefs.sound} onToggle={() => setPref("sound", !prefs.sound)} />
            <Toggle name="Auto-open palette on alert" desc="pops ⌘K when a price alert fires" on={prefs.autoTicket} onToggle={() => setPref("autoTicket", !prefs.autoTicket)} />
          </Card>
        </div>
      </div>
    </Page>
  );
}
