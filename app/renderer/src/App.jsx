// App.jsx — essentialist top bar + workstation router (2026-05-27).
// Panels read real-data hooks directly. The legacy window.GOFNQ_DATA
// adapter has been removed.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { TradingViewChart, TvSignInBanner } from "./TvChart.jsx";
import { EvidenceContext, EvidenceSidePanel, ClaudeFeed } from "./Shared.jsx";
import { PrepWorkstation } from "./Prep.jsx";
import { LiveWorkstation } from "./Live.jsx";
import { ReviewWorkstation } from "./Review.jsx";
import { SystemPage } from "./System.jsx";
import { RiskPage } from "./Risk.jsx";
import { FixturesPage } from "./Fixtures.jsx";
import { HealthPage } from "./Health.jsx";
import { SettingsPage } from "./Settings.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

import { useHealth } from "./hooks/useHealth.js";
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
          position: "absolute", top: "100%", left: 0, zIndex: 50,
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

function ClaudePopover({ chat, onClose }) {
  const messages = chat?.messages || [];
  return (
    <div className="claude-popover" onClick={(e) => e.stopPropagation()}>
      <div className="head">
        <span className="t">CLAUDE · CONVERSATION</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      <div className="body">
        <ClaudeFeed
          messages={messages}
          typing={chat?.typing}
          onSubmit={(text) => chat?.send?.(text)}
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
function TopBar({ mode, setMode, symbol, setSymbol, theme, setTheme,
                  clock,
                  news, newsOpen, setNewsOpen, newsImminent,
                  alerts, alertsOpen, setAlertsOpen, onDisarm,
                  chat, claudeOpen, setClaudeOpen,
                  loopStatus }) {
  const modes = [
    { id: "prep",   label: "PREP",   n: "01" },
    { id: "live",   label: "LIVE",   n: "02" },
    { id: "review", label: "REVIEW", n: "03" },
  ];
  const newsCount = news.length;
  const alertCount = alerts.fired.length + alerts.armed.length;
  const chatActive = !!(chat?.typing || (chat?.messages?.length > 0));
  return (
    <header className="topbar">
      <div className="id">
        <span className="glyph"></span>
        <span>ICT · WORKSTATION</span>
      </div>
      <div className="modes">
        {modes.map((m) => (
          <button key={m.id}
                  className={"mode-btn" + (mode === m.id ? " on" : "")}
                  onClick={() => setMode(m.id)}>
            <span className="n">{m.n}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <div className="status">
        <SymbolSwitcher symbol={symbol} setSymbol={setSymbol} />
        <div className="cell"><span className="k">ET</span><span className="v">{clock?.clock || "—"}</span></div>
        <div className="cell"><span className="k">PH</span><span className="v amber">{clock?.phase || "—"}</span></div>
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
        <div className="cell pop-cell claude-cell"
             onClick={() => setClaudeOpen((o) => !o)}>
          <span className="k">CLAUDE</span>
          <span className={"claude-dot" + (chatActive ? " active" : "")} />
          {claudeOpen && (
            <ClaudePopover chat={chat} onClose={() => setClaudeOpen(false)} />
          )}
        </div>
        <div className="cell">
          <span className="k">LOOP</span>
          <span className={"dot " + (loopStatus === "stale" ? "stale" : loopStatus === "down" ? "down" : "")}></span>
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

function StatusLine({ state, focus, cycle, killzone, lastBar }) {
  return (
    <div className="statusline">
      <div className="grp">
        <span className="item"><span className="k">STATE</span><span className="v">{state}</span></span>
        <span className="item"><span className="k">FOCUS</span><span className="v">{focus}</span></span>
        <span className="item"><span className="k">CYCLE</span><span className="v">{cycle}</span></span>
      </div>
      <div className="grp">
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
  const [mode, setMode] = useState("prep");
  const [symbol, setSymbol] = useState("MNQ1!");
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

  // Mode sync — restore from main on boot + push on user change.
  useEffect(() => {
    const off = window.api?.mode?.onCurrent?.((ev) => {
      if (ev?.mode) setMode(ev.mode);
    });
    return () => off?.();
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

  // CLAUDE popover state — global, shared across all pages
  const chat = useChat();
  const [claudeOpen, setClaudeOpen] = useState(false);

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

  const split = mode === "live" ? "split-70" : "split-50";
  const UtilComp = UTIL_PAGES[utilPage] || null;
  const Workstation =
    mode === "prep"   ? PrepWorkstation :
    mode === "live"   ? LiveWorkstation :
                        ReviewWorkstation;

  return (
    <EvidenceContext.Provider value={openEvidence}>
    <div className="app">
      <TopBar mode={mode}
              setMode={(m) => { setMode(m); window.api?.mode?.switch?.(m); }}
              symbol={symbol} setSymbol={setSymbol}
              theme={theme} setTheme={setTheme}
              clock={clock}
              loopStatus={health?.loop}
              news={remainingEvents}
              newsOpen={newsOpen} setNewsOpen={setNewsOpen}
              newsImminent={newsImminent}
              alerts={alerts}
              alertsOpen={alertsOpen} setAlertsOpen={setAlertsOpen}
              onDisarm={disarm}
              chat={chat}
              claudeOpen={claudeOpen} setClaudeOpen={setClaudeOpen} />

      {/* Persistent chart-host — mounted ONCE at the App root. Switching
          between modes / util pages toggles the .hidden class so the TV
          session stays alive. */}
      <div className={"chart-host " + (UtilComp ? "hidden" : split)}>
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
        <div className={"main " + split}>
          <div className="chart-spacer" />
          <div className="work-pane">
            <ErrorBoundary label={mode.toUpperCase()}>
              <Workstation symbol={symbol} currentPrice={currentPrice} />
            </ErrorBoundary>
          </div>
        </div>
      )}

      <StatusLine
        state={mode.toUpperCase()}
        focus={symbol}
        cycle={lastBar?.hhmm || "—"}
        killzone={clock?.killzone || "—"}
        lastBar={lastBar?.ts ? `${lastBar.hhmm} · ${lastBar.age_label}` : "—"} />
    </div>
    </EvidenceContext.Provider>
  );
}

export { App };
