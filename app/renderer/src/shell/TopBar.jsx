// TopBar — the Command Shell chrome: a minimal top row (symbol pills, last bar,
// loop-health dot) and a bottom ambient strip (news, guard meter, contracts,
// position P&L, VER, ⌘K). Display-only hooks are read here; symbol/guards and
// open handlers come from CommandShell so state has one owner.

import React from "react";
import { clickable } from "../a11y.js";
import { useVersion } from "../hooks/useVersion.js";
import { useLastBar } from "../hooks/useLastBar.js";
import { useHealth } from "../hooks/useHealth.js";
import { useFills } from "../hooks/useFills.js";
import { liveGridFromTrade } from "../Live.helpers.js";

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
  onOpenPalette, onOpenNews, onOpenAlerts, onVerClick,
}) {
  const version = useVersion();
  const lastBar = useLastBar();
  const health = useHealth();
  const { fills } = useFills(TODAY());
  const ver = verView(version);

  const loop = health?.loop;
  const healthCls = loop === "healthy" ? "" : loop === "stale" ? "warn" : "off";
  const healthTitle = loop === "healthy" ? "loop healthy" : loop === "stale" ? "detector stale" : "detector stopped";

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

  return (
    <>
      <div className="cmd-topbar">
        <span className="cmd-sym">
          {SYMS.map((s) => (
            <span key={s} className={"pill" + (s === symbol ? " active" : " interactive")}
                  {...clickable(() => setSymbol(s))}>{s}</span>
          ))}
        </span>
        <span className="sp" />
        <span className="cmd-lastbar" title="last bar">{lastBar?.hhmm || "—"} · {lastBar?.age_label || "—"}</span>
        <span className={"cmd-health " + healthCls} title={healthTitle} />
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
          {pnl && <span className={"cmd-pos-pnl " + (pnl.tone === "red" ? "down" : "up")}>{pnl.v}</span>}
        </div>
        <span className="sp" />
        {ver && <span className={"cmd-ver " + ver.cls} title={ver.title} {...clickable(onVerClick)}>{ver.label}</span>}
        <div className="cmd-k-btn" {...clickable(onOpenPalette)}>
          <span>Command</span><span className="kcap">⌘ K</span>
        </div>
      </div>
    </>
  );
}
