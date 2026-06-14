// App.jsx — essentialist top bar + workstation router (2026-05-27).
// Panels read real-data hooks directly. The legacy window.GOFNQ_DATA
// adapter has been removed.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { TradingViewChart, TvSignInBanner } from "./TvChart.jsx";
import { EvidenceContext, EvidenceSidePanel, ClaudeFeed } from "./Shared.jsx";
import { BacktestCell } from "./BacktestPopover.jsx";
import { PrepCell } from "./PrepPopover.jsx";
import { LiveCell } from "./LivePopover.jsx";
import { ReviewCell } from "./ReviewPopover.jsx";
import { AccountCell } from "./SettingsPopover.jsx";
import { bootAccount, loadGuards, saveGuards } from "./Account.helpers.js";
import { SystemPage } from "./System.jsx";
import { RiskPage } from "./Risk.jsx";
import { FixturesPage } from "./Fixtures.jsx";
import { HealthPage } from "./Health.jsx";
import { SettingsPage } from "./Settings.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import {
  CHAT_PROVIDER_CELLS,
  DEFAULT_CHAT_PROVIDER,
  buildProviderPopoverTitle,
  buildProviderSubmitOptions,
  getExclusiveActiveProvider,
  getProviderChat,
  isProviderChatActive,
} from "./provider-popover-contract.js";

import { useHealth } from "./hooks/useHealth.js";
import { useVersion } from "./hooks/useVersion.js";
import { useAlertFiredListener, useAlertStateListener } from "./hooks/useAlerts.js";
import { useClock } from "./hooks/useClock.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useChat } from "./hooks/useChat.js";
import { useSymbolCache } from "./hooks/useSymbolCache.js";

const SYMBOLS = [
  { sym: "MNQ1!", name: "MICRO E-MINI NASDAQ-100" },
  { sym: "MES1!", name: "MICRO E-MINI S&P 500" },
];

// ─────────────────────────────────────────────────────────────────────────────
// SymbolSwitcher — drop-down in topbar
function SymbolSwitcher({ symbol, setSymbol }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="cell" ref={ref} style={{ position: "relative", cursor: "pointer" }}>
      <span className="k">SYM</span>
      <span className="v" onClick={() => setOpen((o) => !o)}>{symbol} ▾</span>
      {open && (
        <div className="sym-menu" style={{
          position: "absolute", top: "100%", right: 0, zIndex: 50,
          background: "var(--surface-1)", border: "1px solid var(--border)",
          minWidth: 240,
        }}>
          {SYMBOLS.map((s) => (
            <div key={s.sym}
                 onClick={() => { setSymbol(s.sym); setOpen(false); }}
                 style={{
                   padding: "6px 12px", display: "flex", gap: 10,
                   color: s.sym === symbol ? "var(--amber)" : "var(--value)",
                   borderBottom: "1px solid var(--border)",
                   cursor: "pointer",
                 }}>
              <span>{s.sym}</span>
              <span style={{ color: "var(--label)", fontSize: 10 }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// useCalendar — pulls window.api.calendar.thisWeek() on mount + subscribes
// to refresh broadcasts.
function useCalendar() {
  const [payload, setPayload] = useState({ events: [], fetched_at: null });
  useEffect(() => {
    let mounted = true;
    window.api?.calendar?.thisWeek?.().then((res) => {
      if (mounted && res?.ok) setPayload({ events: res.events || [], fetched_at: res.fetched_at });
    }).catch(() => {});
    const off = window.api?.calendar?.onUpdate?.((p) => {
      if (mounted) setPayload(p || { events: [] });
    });
    return () => { mounted = false; off?.(); };
  }, []);
  return payload;
}

// Lightweight ET-weekday grouping; mirrors app/main/calendar.js groupByDay
// (we duplicate to avoid the renderer importing from main).
function groupByDayET(events) {
  if (!Array.isArray(events)) return [];
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const byKey = new Map();
  for (const ev of events) {
    if (!ev?.ts) continue;
    const d = new Date(ev.ts);
    if (!Number.isFinite(d.getTime())) continue;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    }).formatToParts(d);
    const get = (t) => fmt.find((p) => p.type === t)?.value;
    const key = `${get("year")}-${get("month")}-${get("day")}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        weekday: (get("weekday") || "").toUpperCase().slice(0, 3),
        date: `${MONTHS[Number(get("month"))-1]} ${Number(get("day"))}`,
        dateIso: key,
        events: [],
      });
    }
    byKey.get(key).events.push(ev);
  }
  return [...byKey.values()].sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

function todayKeyET(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t) => fmt.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function fmtTimeET(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " ET";
}

function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NewsPopover — weekday-grouped USD high+medium events, with TODAY highlight
// and imminent-event amber tint.
function NewsPopover({ payload, now, onClose }) {
  const events = payload?.events || [];
  const groups = groupByDayET(events);
  const todayKey = todayKeyET(now);
  const dtNow = now.getTime();
  return (
    <div className="news-popover" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="t">NEWS · THIS WEEK</span>
        <span className="sub">USD HIGH + MED · ET</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      {events.length === 0 && (
        <div className="empty">no events cached yet — try again in a minute</div>
      )}
      {groups.map((g) => (
        <React.Fragment key={g.dateIso}>
          <div className={"day-header" + (g.dateIso === todayKey ? " today" : "")}>
            {g.weekday} · {g.date}
          </div>
          {g.events.map((e, i) => {
            const dt = new Date(e.ts).getTime();
            const past = dt < dtNow;
            const imminent = !past && (dt - dtNow) <= 2 * 60 * 60 * 1000;
            return (
              <div key={i} className={"news-row" + (past ? " past" : "") + (imminent ? " imminent" : "")}>
                <span className="ts">
                  {imminent ? `IN ${fmtCountdown(dt - dtNow)}` : fmtTimeET(e.ts)}
                </span>
                <span className="ccy">{e.currency}</span>
                <span className="event">
                  {e.event}
                  {e.forecast && (
                    <span className="fc"> · fcst {e.forecast}{e.previous ? ` · prev ${e.previous}` : ""}</span>
                  )}
                </span>
                <span className={"impact " + e.impact}>{(e.impact || "").toUpperCase().slice(0, 3)}</span>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function AlertsPopover({ alerts, onClose, onDisarm }) {
  return (
    <div className="alerts-popover" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="t">ALERTS · TODAY</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      {alerts.armed.length === 0 && alerts.fired.length === 0 && (
        <div className="empty">no alerts yet</div>
      )}
      {alerts.fired.map((a, i) => (
        <div className="alert-row" key={"f" + i}>
          <span><b>{a.name}</b> @ {a.price}</span>
          <span className="t">FIRED {a.t}</span>
        </div>
      ))}
      {alerts.armed.map((a) => (
        <div className="alert-row" key={a.name}>
          <span><b>{a.name}</b> @ {a.price}</span>
          <span className="disarm" onClick={() => onDisarm(a.name)}>DISARM</span>
        </div>
      ))}
    </div>
  );
}

function ProviderPopover({ provider, chat, onClose }) {
  const messages = chat?.messages || [];
  const providerLabel = provider.toUpperCase();
  return (
    <div className="claude-popover statusline-popover" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="t">{buildProviderPopoverTitle(provider)}</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      <div className="body">
        <ClaudeFeed
          messages={messages}
          typing={chat?.typing}
          providerLabel={providerLabel}
          onSubmit={(text) => chat?.send?.(text, buildProviderSubmitOptions(provider))}
          onCancel={chat?.typing ? chat?.cancel : null}
          onReset={chat?.reset}
        />
      </div>
    </div>
  );
}

function AlertToast({ alert, onClose }) {
  useEffect(() => {
    const id = setTimeout(onClose, 4500);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <div className="alert-toast" onClick={onClose}>
      <span className="ind"></span>
      ALERT · <b>{alert.name}</b> reached <b>{alert.price}</b>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VersionCell — running-code visibility. Red RESTART when the code on disk
// moved past what this process booted with; amber PULL when origin/main is
// ahead of the local checkout; dim short SHA otherwise. June 2026: six
// merged PRs never ran because nothing surfaced that the app was stale.
function VersionCell() {
  const v = useVersion();
  if (!v?.sha) return null;
  const cls = v.restart_needed ? " red" : v.pull_needed ? " amber" : "";
  const label = v.restart_needed ? "RESTART" : v.pull_needed ? `PULL −${v.behind}` : v.sha;
  const title = v.restart_needed
    ? `Code on disk is ${v.sha} but this app booted on ${v.boot_sha} — restart the app to run it`
    : v.pull_needed
      ? `origin/main is ${v.behind} commit(s) ahead of the local checkout — git pull, then restart`
      : `running ${v.sha} (up to date with origin/main)`;
  return (
    <div className="cell" title={title}>
      <span className="k">VER</span>
      <span className={"v" + cls}>{label}</span>
    </div>
  );
}

function TopBar({ symbol, setSymbol, theme, setTheme,
                  clock,
                  news, newsOpen, setNewsOpen, newsImminent,
                  alerts, alertsOpen, setAlertsOpen, onDisarm,
                  account, setAccount, guards, setGuards,
                  currentPrice }) {
  const newsCount = news.length;
  const alertCount = alerts.fired.length + alerts.armed.length;
  return (
    <header className="topbar">
      <div className="id"><span className="wm">G<span className="accent">X</span>OFNQ</span></div>
      <div className="status">
        <VersionCell />
        <AccountCell account={account} setAccount={setAccount} guards={guards} setGuards={setGuards} />
        <div className={"cell pop-cell" + (alertCount > 0 ? " has-alerts" : "")}
             onClick={() => setAlertsOpen((o) => !o)}>
          <span className="k">ALERTS</span>
          <span className="count">{alertCount}</span>
          {alertsOpen && (
            <AlertsPopover alerts={alerts}
              onClose={() => setAlertsOpen(false)}
              onDisarm={onDisarm} />
          )}
        </div>
        <div className={"cell pop-cell" + (newsCount > 0 ? " has-news" : "")}
             onClick={() => setNewsOpen((o) => !o)}>
          <span className="k">NEWS</span>
          <span className="count">{newsCount}</span>
          {newsImminent && (
            <span className="countdown">{newsImminent}</span>
          )}
          {newsOpen && (
            <NewsPopover payload={{ events: news }} now={new Date()} onClose={() => setNewsOpen(false)} />
          )}
        </div>
        <div className="cell">
          <button className={"th-btn" + (theme === "dark" ? " on" : "")}
                  onClick={() => setTheme("dark")}>◐</button>
          <button className={"th-btn" + (theme === "light" ? " on" : "")}
                  onClick={() => setTheme("light")}>◑</button>
        </div>
      </div>
    </header>
  );
}

function StatusLine({ state, focus, cycle, killzone, lastBar, loopStatus, phase,
                      symbol, currentPrice,
                      chats, activeProvider, setActiveProvider, openProvider, setOpenProvider }) {
  const loopDown = loopStatus === "stale" || loopStatus === "down";
  const activeChat = getProviderChat(chats, activeProvider);
  const chatActive = isProviderChatActive(chats, activeProvider);
  const selectProvider = (provider) => {
    const next = getExclusiveActiveProvider(activeProvider, provider);
    if (next !== activeProvider && chatActive) activeChat?.cancel?.();
    setActiveProvider(next);
    setOpenProvider((cur) => cur === next ? null : next);
  };
  return (
    <div className="statusline">
      <div className="grp">
        <PrepCell symbol={symbol} currentPrice={currentPrice} />
        <LiveCell />
        <ReviewCell />
        <BacktestCell />
        <span className="item provider-controls">
          {CHAT_PROVIDER_CELLS.map((cell) => {
            const selected = activeProvider === cell.provider;
            return (
              <span key={cell.provider}
                    className={"provider-chip" + (selected ? " selected" : "")}
                    onClick={(e) => { e.stopPropagation(); selectProvider(cell.provider); }}>
                <span className="k">{cell.label}</span>
                <span className={"claude-dot" + (selected && isProviderChatActive(chats, cell.provider) ? " active" : "")} />
                {openProvider === cell.provider && selected && (
                  <ProviderPopover provider={cell.provider}
                                   chat={getProviderChat(chats, cell.provider)}
                                   onClose={() => setOpenProvider(null)} />
                )}
              </span>
            );
          })}
          <span className={"provider-stop" + (chatActive ? " active" : " disabled")}
                title={`stop ${activeProvider}`}
                onClick={(e) => { e.stopPropagation(); if (chatActive) activeChat?.cancel?.(); }}>
            STOP
          </span>
        </span>
      </div>
      <div className="grp">
        <span className="item"><span className="k">PH</span><span className="v amber">{phase}</span></span>
        <span className="item"><span className="k">KZ</span><span className="v">{killzone}</span></span>
        <span className="item"><span className="k">LAST BAR</span><span className="v">{lastBar}</span></span>
      </div>
    </div>
  );
}

// Hash router for util pages
const UTIL_PAGES = {
  system:   SystemPage,
  risk:     RiskPage,
  fixtures: FixturesPage,
  health:   HealthPage,
  settings: SettingsPage,
};

// ─────────────────────────────────────────────────────────────────────────────
function App() {
  // Mode tabs removed 2026-05-28; PREP/LIVE/REVIEW are popovers in the topbar.
  const [symbol, setSymbol] = useState("MNQ1!");

  // Account mode is ephemeral — boots PAPER every launch, never persists (a
  // real-money safety rule); guardrails persist. (dashboard-v2)
  const [account, setAccount] = useState(() => bootAccount());
  const [guards, setGuards] = useState(() => loadGuards());
  useEffect(() => { saveGuards(guards); }, [guards]);

  const [utilPage, setUtilPage] = useState(() => location.hash.slice(1));
  useEffect(() => {
    const onHash = () => setUtilPage(location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Theme — hydrate from localStorage, apply to <html data-theme="…">
  const [theme, setTheme] = useState(() => {
    try {
      const v = localStorage.getItem("workstation:theme");
      return v === "light" || v === "dark" ? v : "dark";
    } catch (e) { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("workstation:theme", theme); } catch (e) {}
  }, [theme]);

  // Hotkeys: 1/2/3 open PREP/LIVE/REVIEW popovers; Esc closes any open
  // popover. Implemented via a window CustomEvent that each *Cell subscribes
  // to ("topbar:open-cell"). Ignore keypresses while a text input is focused
  // so typing in the brief search field etc. isn't intercepted.
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      let which = null;
      if (e.key === "1") which = "prep";
      else if (e.key === "2") which = "live";
      else if (e.key === "3") which = "review";
      else if (e.key === "Escape") which = "all-close";
      if (which) {
        window.dispatchEvent(new CustomEvent("topbar:open-cell", { detail: { which } }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Alerts state — replaced by main's TV poll.
  const [alerts, setAlerts] = useState({ armed: [], fired: [] });
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const disarm = (name) => setAlerts((s) => ({
    ...s,
    armed: s.armed.filter((a) => a.name !== name),
  }));

  useAlertStateListener((ev) => {
    const armed = (ev?.armed || []).map((a) => ({
      name: a.label && a.label.trim() ? a.label : `@ ${a.price}`,
      price: a.price,
    }));
    setAlerts((s) => ({ ...s, armed }));
  });
  useAlertFiredListener((ev) => {
    const name = ev.label || `@ ${ev.price}`;
    const t = ev.fired_at?.slice(11, 19) || "";
    setAlerts((s) => ({
      ...s,
      fired: [{ name, price: ev.price, t }, ...s.fired],
      armed: s.armed.filter((a) => a.price !== ev.price),
    }));
    setToast({ name, price: ev.price });
  });

  // Evidence drill-down
  const [evidence, setEvidence] = useState(null);
  const openEvidence = (refData, label) => setEvidence({ refData, label });
  const closeEvidence = () => setEvidence(null);

  // LLM provider state — Claude and Codex keep separate conversations while
  // the status bar exposes exactly one active provider at a time.
  const [activeProvider, setActiveProvider] = useState(DEFAULT_CHAT_PROVIDER);
  const [openProvider, setOpenProvider] = useState(null);
  const claudeChat = useChat({ provider: "claude" });
  const codexChat = useChat({ provider: "codex" });
  const chats = { claude: claudeChat, codex: codexChat };

  // Calendar — real ForexFactory feed via main process
  const calendarPayload = useCalendar();

  // Symbol cache → currentPrice for the active symbol (used by PREP STEP 2)
  const symbolCache = useSymbolCache(false);
  const currentPrice = symbolCache?.[symbol]?.px ?? null;

  // Real data hooks (still needed at top level for status bars / hash route)
  const clock = useClock();
  const lastBar = useLastBar();
  const health = useHealth();

  // News chip — count of events strictly after now; ticks every 60s so
  // the badge + countdown stay current without a page refresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  const remainingEvents = useMemo(() => {
    const t = now.getTime();
    return (calendarPayload.events || []).filter((e) => {
      const dt = new Date(e?.ts).getTime();
      return Number.isFinite(dt) && dt > t;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarPayload.events, now.getMinutes()]);
  const newsImminent = useMemo(() => {
    const t = now.getTime();
    const nextEvent = (calendarPayload.events || []).find((e) => {
      const dt = new Date(e?.ts).getTime();
      return Number.isFinite(dt) && dt > t && (dt - t) <= 2 * 60 * 60 * 1000;
    });
    if (!nextEvent) return null;
    const dt = new Date(nextEvent.ts).getTime();
    return `${nextEvent.event} in ${fmtCountdown(dt - t)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarPayload.events, now.getMinutes()]);

  const [newsOpen, setNewsOpen] = useState(false);

  const UtilComp = UTIL_PAGES[utilPage] || null;

  return (
    <EvidenceContext.Provider value={openEvidence}>
    <div className="app">
      <TopBar symbol={symbol} setSymbol={setSymbol}
              theme={theme} setTheme={setTheme}
              clock={clock}
              news={remainingEvents}
              newsOpen={newsOpen} setNewsOpen={setNewsOpen}
              newsImminent={newsImminent}
              alerts={alerts}
              alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen}
              onDisarm={disarm}
              account={account} setAccount={setAccount} guards={guards} setGuards={setGuards}
              currentPrice={currentPrice} />

      {/* Persistent chart-host — mounted ONCE at the App root. Util pages
          toggle the .hidden class so the TV session stays alive. PREP/LIVE/
          REVIEW are popovers now (no full-pane workstation), so chart goes
          full-width by default. */}
      <div className={"chart-host " + (UtilComp ? "hidden" : "full")}>
        <div className="chart-body">
          <ErrorBoundary label="CHART">
            <TradingViewChart symbol={symbol} />
            <TvSignInBanner />
          </ErrorBoundary>
        </div>
      </div>

      {toast && <AlertToast alert={toast} onClose={() => setToast(null)} />}
      <EvidenceSidePanel
        open={!!evidence}
        refData={evidence?.refData}
        label={evidence?.label}
        onClose={closeEvidence} />

      {UtilComp ? (
        <div className="util-pane">
          <ErrorBoundary label={utilPage.toUpperCase()}>
            <UtilComp />
          </ErrorBoundary>
        </div>
      ) : (
        // Chart is the only main-area view; popovers in the topbar host the
        // PREP / LIVE / REVIEW content on demand.
        <div className="main">
          <div className="chart-spacer" />
        </div>
      )}

      <StatusLine
        symbol={symbol}
        currentPrice={currentPrice}
        state={"CHART"}
        focus={symbol}
        cycle={lastBar?.hhmm || "—"}
        killzone={clock?.killzone || "—"}
        lastBar={lastBar?.ts ? `${lastBar.hhmm} · ${lastBar.age_label}` : "—"}
        loopStatus={health?.loop}
        phase={clock?.phase || "—"}
        chats={chats}
        activeProvider={activeProvider}
        setActiveProvider={setActiveProvider}
        openProvider={openProvider}
        setOpenProvider={setOpenProvider} />
    </div>
    </EvidenceContext.Provider>
  );
}

export { App };
