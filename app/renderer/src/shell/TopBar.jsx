// TopBar — the Command Shell chrome: a minimal top row (symbol pills, last bar,
// loop-health dot) and a bottom ambient strip (news, guard meter, contracts,
// position P&L, VER, ⌘K). Display-only hooks are read here; symbol/guards and
// open handlers come from CommandShell so state has one owner.

import React from "react";
import { clickable } from "../a11y.js";
import { useVersion } from "../hooks/useVersion.js";
import { useValueTick } from "../hooks/useValueTick.js";
import { useLastBar } from "../hooks/useLastBar.js";
import { useHealth } from "../hooks/useHealth.js";
import { useFills } from "../hooks/useFills.js";
import { useSessionBrief } from "../hooks/useSessionBrief.js";
import { useOpenReaction } from "../hooks/useOpenReaction.js";
import { buildDayChip } from "./dayChip.helpers.js";
import { parseInstantStop } from "../Orders.helpers.js";
import { liveGridFromTrade, pnlDisplay } from "../Live.helpers.js";

const TODAY = () => new Date().toISOString().slice(0, 10);

const SYMS = ["MNQ1!", "MES1!"];

function verView(v) {
  if (!v?.sha) return null;
  if (v.restart_needed) return { cls: "bad", label: "RESTART",
    title: `Code on disk is ${v.sha} but this app booted on ${v.boot_sha} — restart the app to run it` };
  if (v.pull_needed) return { cls: "warn", label: `PULL −${v.behind}`,
    title: `origin/main is ${v.behind} commit(s) ahead of the local checkout — git pull, then restart` };
  return { cls: "", label: v.sha, title: `running ${v.sha} (up to date with origin/main)` };
}

export function TopBar({
  symbol, setSymbol, guards, exec,
  alertCount, newsCount, newsImminent,
  onOpenPalette, onOpenNews, onOpenAlerts, onVerClick, onRelaunchTv, onOpenBriefing,
  onTrade, slDraft = "", setSlDraft,
}) {
  const version = useVersion();
  const lastBar = useLastBar();
  const health = useHealth();
  const { fills } = useFills(TODAY());
  const ver = verView(version);

  // Day chip — the operating rules at a glance (plan 2026-07-09 Task 3):
  // grade (live cap wins over the brief) · bias votes · day-of-week size rule;
  // hard red HANDS OFF when the open reverses the bias.
  const { brief } = useSessionBrief();
  const { latest, ltf } = useOpenReaction();
  const dayChip = buildDayChip({ brief, latest, ltf });
  // Value tick (motion v1) — pulse when the grade/bias text changes, but never
  // while the chip is the empty "none" placeholder (that's a pending state).
  const dayTickRef = useValueTick(dayChip.text, dayChip.state !== "none");

  // Instant-order arming — a valid stop price in the SL field makes the
  // BUY/SELL buttons live triggers (see CommandShell onTrade).
  const slArmed = parseInstantStop(slDraft).mode === "instant";

  const loop = health?.loop;
  // TV Desktop running without the CDP flag blinds the whole system — outranks
  // every other health read and gets a one-click fix on the dot itself.
  const cdpDown = health?.cdp === "down";
  const healthCls = cdpDown ? "off" : loop === "healthy" ? "" : loop === "stale" ? "warn" : "off";
  const healthTitle = cdpDown ? "TradingView CDP down — click to relaunch with the debug flag"
    : loop === "healthy" ? "loop healthy" : loop === "stale" ? "detector stale" : "detector stopped";

  // Guard meter — today's realized loss vs the daily limit (same tally the
  // Settings guardrail readout uses: sum of negative fill USD for today).
  const dailyLimit = guards?.dailyLimit || 0;
  const lossUsed = Math.abs((fills || []).reduce((s, f) => s + Math.min(0, Number(f?.actual?.usd) || 0), 0));
  const hasLoss = lossUsed > 0;
  const guardPct = dailyLimit > 0 ? Math.min(100, Math.round((lossUsed / dailyLimit) * 100)) : 0;
  const guardBad = guardPct >= 100;
  const guardWarn = guardPct >= 70;

  // Contracts meter — open size vs cap.
  const openQty = exec?.position?.qty || 0;

  // Position chip + P&L.
  const pos = exec?.position;
  const posSide = pos ? (pos.side === "buy" || pos.side === "long" ? "long" : "short") : "flat";
  const grid = pos ? liveGridFromTrade(
    { entry: pos.avgFill, stop: pos.sl, tp1: pos.tp, side: posSide }, exec?.price ?? lastBar?.close) : null;
  const pnl = grid?.pnl;
  // Value tick (motion v1) — pulse when live P&L moves, tinted by sign. A stale
  // broker read (last-known P&L) must NOT tick — it isn't a live change.
  const pnlDisp = pnl ? pnlDisplay(pnl, exec?.stale) : null;
  const pnlTickRef = useValueTick(pnlDisp?.v, !!pnlDisp && !pnlDisp.stale);

  return (
    <>
      {/* Prototype top bar: symbol toggle · spacer · clock · health dot. No
          phase/killzone chips, no meters — those live in the ambient strip. */}
      <div className="cmd-topbar">
        <span className="cmd-sym">
          {SYMS.map((s) => (
            <span key={s} className={"cs-sympill" + (s === symbol ? " is-on" : "")}
                  {...clickable(() => setSymbol(s))}>{s}</span>
          ))}
        </span>
        <span ref={dayTickRef} className={"cmd-daychip value-tick " + dayChip.state + " " + (dayChip.tone || "dim")}
              title={dayChip.title} {...clickable(onOpenBriefing, { label: "open briefing" })}>
          {dayChip.text}
        </span>
        <span className="sp" />
        <span className="cmd-lastbar" title="last bar">{lastBar?.hhmm || "—"} · {lastBar?.age_label || "—"}</span>
        {cdpDown && (
          <span className="cmd-cdp-fix" {...clickable(onRelaunchTv, { label: "relaunch TradingView with CDP" })}
                title="TradingView is running without the debug flag — the system can't read the chart. Click to quit + relaunch it with CDP.">
            TV CDP DOWN · RELAUNCH
          </span>
        )}
        <span className={"cmd-health " + healthCls} title={healthTitle}
              {...(cdpDown ? clickable(onRelaunchTv, { label: "relaunch TradingView with CDP" }) : {})} />
      </div>

      <div className="cmd-strip">
        <div className="cmd-strip-item click" {...clickable(onOpenNews)} title="this week's calendar — or type news in ⌘K">
          <span className="cmd-news-n">{newsCount}</span>
          {newsImminent && <span className="cmd-news-t">{newsImminent}</span>}
        </div>
        <div className="cmd-strip-item" title={hasLoss ? `daily loss $${Math.round(lossUsed)} of $${dailyLimit}` : `daily loss limit $${dailyLimit}`}>
          <span className="cmd-meter"><span className={guardBad ? "red" : ""} style={{ width: guardPct + "%" }} /></span>
          <span className={"cmd-meter-lbl" + (guardBad ? " bad" : guardWarn ? " warn" : "")}>
            {hasLoss ? `−$${Math.round(lossUsed)}` : `$${dailyLimit}`}
          </span>
        </div>
        <div className="cmd-strip-item click" {...clickable(onOpenAlerts)} title="armed alerts">
          <span className="cmd-meter-lbl">◈ {alertCount}</span>
        </div>
        <div className="cmd-strip-item" title="open position">
          <span className={"cmd-pos-side " + posSide}>{posSide.toUpperCase()}</span>
          {pnlDisp && (
            // Broker-read outage (exec.stale) → render last-known P&L greyed +
            // STALE, never live-green (Task C5). pnlDisplay maps tone "stale".
            <span ref={pnlTickRef}
                  className={"cmd-pos-pnl value-tick " + (pnlDisp.stale ? "stale" : pnlDisp.tone === "red" ? "down" : "up")}
                  data-tone={pnlDisp.stale ? undefined : pnlDisp.tone === "red" ? "down" : "up"}
                  title={pnlDisp.stale ? "broker read stale — last-known P&L, not live" : undefined}>
              {pnlDisp.v}{pnlDisp.stale ? " · STALE" : ""}
            </span>
          )}
        </div>
        <span className="sp" />
        {/* Manual BUY/SELL (plan 2026-07-10). SL field empty → the buttons open
            the chooser ticket. SL typed → the buttons FIRE a market bracket
            instantly (typed stop · 1:2 TP · Settings risk) — armed styling
            makes the live state unmissable. */}
        <span className={"cmd-trade" + (slArmed ? " armed" : "")}>
          <input className="cmd-sl-in" placeholder="SL" value={slDraft}
                 onChange={(e) => setSlDraft?.(e.target.value)}
                 title="Type a stop price to arm instant orders: BUY/SELL then places a market order with this SL and a 1:2 TP. Empty = the buttons open the ticket." />
          {slDraft !== "" && <span className="cmd-sl-x" {...clickable(() => setSlDraft?.(""), { label: "clear stop" })}>×</span>}
          <span className="cmd-trade-btn sell" {...clickable(() => onTrade?.("sell"), { label: "sell" })}
                title={slArmed ? `SELL market now · SL ${slDraft} · TP 1:2` : "open the sell ticket"}>
            SELL{slArmed ? " ⚡" : ""}
          </span>
          <span className="cmd-trade-btn buy" {...clickable(() => onTrade?.("buy"), { label: "buy" })}
                title={slArmed ? `BUY market now · SL ${slDraft} · TP 1:2` : "open the buy ticket"}>
            BUY{slArmed ? " ⚡" : ""}
          </span>
        </span>
        {ver && <span className={"cmd-ver " + ver.cls} title={ver.title} {...clickable(onVerClick)}>{ver.label}</span>}
        <div className="cmd-k-btn" {...clickable(onOpenPalette)}>
          <span>Command</span><span className="kcap">⌘ K</span>
        </div>
      </div>
    </>
  );
}
