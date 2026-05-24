import React, { useState, useEffect, useRef } from "react";
import { Panel, Row, Grade, PillarsPanel, StatusLine, Btn } from "./Shared.jsx";
import { TradingViewChart, TvSignInBanner } from "./TvChart.jsx";
import { PrepWorkstation } from "./Prep.jsx";
import { LiveWorkstation } from "./Live.jsx";
import { ReviewWorkstation } from "./Review.jsx";
import { useHealth } from "./hooks/useHealth.js";
import { armAlertReal, useAlertFiredListener } from "./hooks/useAlerts.js";
import { useClock } from "./hooks/useClock.js";
import { useLastBar } from "./hooks/useLastBar.js";
import { useSymbolCache, formatPx as fmtCachedPx, formatAgeShort } from "./hooks/useSymbolCache.js";
import { FileViewer } from "./FileViewer.jsx";

const INITIAL = {
  mode: "prep",
  liveSubState: "entry-hunt",
  loopHealth: "healthy",
  noSetups: false,
  appState: "running",
  suggestMode: true,
};

const SYMBOLS = [
  { sym: "MNQ1!", name: "MICRO E-MINI NASDAQ-100" },
  { sym: "MES1!", name: "MICRO E-MINI S&P 500" },
  { sym: "MYM1!", name: "MICRO E-MINI DOW" },
  { sym: "M2K1!", name: "MICRO E-MINI RUSSELL" },
  { sym: "MGC1!", name: "MICRO GOLD" },
  { sym: "MCL1!", name: "MICRO WTI CRUDE" },
];

// ---------- Symbol switcher ----------
function SymbolSwitcher({ symbol, setSymbol }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const cache = useSymbolCache(open);
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="status-cell symbol sym-wrap" ref={ref}>
      <span className="sym-trigger" onClick={() => setOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: 8, height: "100%" }}>
        <span className="k">SYM</span>
        <span className="v">{symbol}</span>
        <span className="caret">▾</span>
      </span>
      {open && (
        <div className="sym-menu">
          <div className="head">CME MICRO FUTURES</div>
          {SYMBOLS.map((s) => {
            const c = cache[s.sym];
            const age = c?.ts ? formatAgeShort(c.ts) : null;
            return (
              <div key={s.sym}
                   className={"opt" + (s.sym === symbol ? " cur" : "")}
                   onClick={() => { setSymbol(s.sym); setOpen(false); }}>
                <span className="sym">{s.sym}</span>
                <span className="name">{s.name}</span>
                <span className="px" style={{ color: c ? "var(--value)" : "var(--label-dim)" }}>
                  {c ? fmtCachedPx(c.px) : "—"}
                  {age && (
                    <span style={{ color: "var(--label)", fontSize: 9.5, marginLeft: 6 }}>
                      {age}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Alert chip + popover ----------
function AlertChip({ fired, onClick }) {
  return (
    <div className="status-cell alert-chip" onClick={onClick} title="fired alerts">
      <span className="k">ALERTS</span>
      <span className="count">{fired.length}</span>
    </div>
  );
}

function AlertsPopover({ fired, armed, onClose }) {
  const armedList = Object.entries(armed);
  return (
    <div style={{
      position: "absolute",
      top: "calc(var(--topbar-h) - 1px)",
      right: 12,
      width: 360,
      background: "var(--surface-0)",
      border: "1px solid var(--border)",
      borderTop: 0,
      zIndex: 50,
    }}>
      <div style={{
        padding: "6px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-1)",
      }}>
        <span style={{ color: "var(--amber)", fontSize: 10, letterSpacing: ".22em" }}>
          FIRED ALERTS · TODAY
        </span>
        <span onClick={onClose}
              style={{ color: "var(--label-dim)", fontSize: 13, cursor: "pointer" }}>×</span>
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {fired.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            <div style={{ color: "var(--label)" }}>no alerts fired today</div>
          </div>
        ) : fired.map((a, i) => (
          <div className="alert-entry" key={i}>
            <span className="when">{a.t}</span>
            <span className="what"><b>{a.name}</b> @ <span className="px">{a.px}</span></span>
            <span style={{ color: "var(--green)", fontSize: 9, letterSpacing: ".1em" }}>FIRED</span>
          </div>
        ))}
      </div>
      {armedList.length > 0 && (
        <>
          <div style={{
            padding: "4px 12px",
            color: "var(--label)", fontSize: 9.5, letterSpacing: ".18em",
            borderTop: "1px solid var(--border)",
            background: "var(--surface-1)",
          }}>
            ARMED · WATCHING
          </div>
          {armedList.map(([name, px]) => (
            <div className="alert-entry" key={name}>
              <span className="when">—</span>
              <span className="what"><b>{name}</b> @ <span className="px">{px}</span></span>
              <span style={{ color: "var(--amber)", fontSize: 9, letterSpacing: ".1em" }}>ARMED</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------- Files chip + popover ----------
function FilesChip({ onClick }) {
  return (
    <div className="status-cell alert-chip" onClick={onClick} title="session files">
      <span className="k">FILES</span>
      <span className="count">≡</span>
    </div>
  );
}

function fmtAge(mtimeMs) {
  if (!mtimeMs) return "—";
  const s = Math.max(0, Math.floor((Date.now() - mtimeMs) / 1000));
  if (s < 60) return `${s}s old`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m old`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m old`;
}

function fmtSize(bytes) {
  if (!bytes) return "0";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function FilesPopover({ onClose, onView }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const reload = () => {
    window.api?.files?.list?.().then((res) => {
      if (res?.ok) { setData(res); setErr(null); }
      else setErr(res?.error || "list failed");
    }).catch((e) => setErr(String(e?.message || e)));
  };
  useEffect(() => {
    reload();
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      position: "absolute",
      top: "calc(var(--topbar-h) - 1px)",
      right: 12,
      width: 460,
      background: "var(--surface-0)",
      border: "1px solid var(--border)",
      borderTop: 0,
      zIndex: 50,
      fontFamily: "ui-monospace, Menlo, monospace",
    }}>
      <div style={{
        padding: "6px 12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-1)",
      }}>
        <span style={{ color: "var(--amber)", fontSize: 10, letterSpacing: ".22em" }}>
          SESSION FILES · {data?.session?.toUpperCase() || "—"} · {data?.date || ""}
        </span>
        <span onClick={onClose}
              style={{ color: "var(--label-dim)", fontSize: 13, cursor: "pointer" }}>×</span>
      </div>
      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        {err && (
          <div style={{ padding: 14, color: "var(--red)", fontSize: 11 }}>{err}</div>
        )}
        {data && data.files.map((f) => (
          <div key={f.label}
               style={{
                 padding: "8px 12px",
                 borderBottom: "1px solid var(--border-dim, #1e2228)",
                 display: "grid",
                 gridTemplateColumns: "1fr auto auto auto",
                 columnGap: 10,
                 alignItems: "center",
                 opacity: f.exists ? 1 : 0.45,
               }}>
            <span style={{ color: f.exists ? "var(--value)" : "var(--label)", fontSize: 11 }}>
              {f.label}
              {f.group === "state" && (
                <span style={{ color: "var(--label)", fontSize: 9.5, marginLeft: 6 }}>
                  (state/)
                </span>
              )}
              {f.group === "day" && (
                <span style={{ color: "var(--label)", fontSize: 9.5, marginLeft: 6 }}>
                  (day/)
                </span>
              )}
            </span>
            <span style={{ color: "var(--label)", fontSize: 10 }}>
              {f.exists
                ? (f.lines != null ? `${f.lines} lines · ${fmtSize(f.size_bytes)}` : fmtSize(f.size_bytes))
                : "missing"}
            </span>
            <span style={{ color: "var(--label)", fontSize: 10 }}>
              {f.exists ? fmtAge(f.mtime_ms) : ""}
            </span>
            <span style={{ display: "flex", gap: 4 }}>
              <button
                disabled={!f.exists}
                onClick={() => onView?.(f)}
                style={{
                  color: f.exists ? "var(--amber)" : "var(--label-dim)",
                  background: "transparent",
                  border: "1px solid var(--amber, #e3b341)",
                  padding: "2px 7px",
                  fontSize: 9.5,
                  letterSpacing: ".12em",
                  cursor: f.exists ? "pointer" : "default",
                  fontFamily: "inherit",
                }}>
                VIEW
              </button>
              <button
                disabled={!f.exists}
                onClick={() => window.api?.files?.open?.(f.path)}
                style={{
                  color: f.exists ? "var(--value)" : "var(--label-dim)",
                  background: "transparent",
                  border: "1px solid var(--border, #2a3038)",
                  padding: "2px 7px",
                  fontSize: 9.5,
                  letterSpacing: ".12em",
                  cursor: f.exists ? "pointer" : "default",
                  fontFamily: "inherit",
                }}>
                EDIT
              </button>
              <button
                disabled={!f.exists}
                onClick={() => window.api?.files?.reveal?.(f.path)}
                style={{
                  color: f.exists ? "var(--value)" : "var(--label-dim)",
                  background: "transparent",
                  border: "1px solid var(--border, #2a3038)",
                  padding: "2px 7px",
                  fontSize: 9.5,
                  letterSpacing: ".12em",
                  cursor: f.exists ? "pointer" : "default",
                  fontFamily: "inherit",
                }}>
                REVEAL
              </button>
            </span>
          </div>
        ))}
      </div>
      {data && (
        <div style={{
          padding: "6px 12px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}>
          <span style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".08em" }}>
            session dir
          </span>
          <button
            onClick={() => window.api?.files?.reveal?.(data.session_dir)}
            style={{
              color: "var(--amber)",
              background: "transparent",
              border: "1px solid var(--amber, #e3b341)",
              padding: "2px 9px",
              fontSize: 9.5,
              letterSpacing: ".16em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}>
            OPEN IN FINDER
          </button>
        </div>
      )}
    </div>
  );
}

function AlertToast({ alert, onClose }) {
  useEffect(() => {
    const id = setTimeout(onClose, 4500);
    return () => clearTimeout(id);
  }, [onClose]);
  // Names beginning with "@ " are free-form prices Claude mentioned; the
  // "name" duplicates the price, so just show the price once.
  const isFreeForm = typeof alert.name === "string" && alert.name.startsWith("@ ");
  return (
    <div className="alert-toast">
      <span className="ind"></span>
      <span className="what">
        {isFreeForm
          ? <>ALERT · price reached <b>{alert.px}</b></>
          : <>ALERT · <b>{alert.name}</b> reached <b>{alert.px}</b></>}
      </span>
      <span className="dismiss" onClick={onClose}>×</span>
    </div>
  );
}

// ---------- Theme toggle ----------
// A real terminal control — [ DARK ] / [ LIGHT ] segmented, persistent in
// localStorage. Lives in the top-bar status cluster so it's reachable from
// every mode without crowding the mode switch.
function ThemeToggle({ theme, setTheme }) {
  return (
    <div className="status-cell theme-toggle">
      <button className={"th-btn" + (theme === "dark" ? " on" : "")}
              onClick={() => setTheme("dark")}
              title="dark theme">◐</button>
      <button className={"th-btn" + (theme === "light" ? " on" : "")}
              onClick={() => setTheme("light")}
              title="light theme">◑</button>
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({ mode, setMode, suggested, status, symbol, setSymbol,
                  fired, armed, alertsOpen, setAlertsOpen,
                  filesOpen, setFilesOpen,
                  theme, setTheme }) {
  const modes = [
    { id: "prep", label: "PREP",   num: "01" },
    { id: "live", label: "LIVE",   num: "02" },
    { id: "review", label: "REVIEW", num: "03" },
  ];
  return (
    <header className="topbar">
      <div className="topbar-id">
        <span className="glyph"></span>
        <span className="name">ICT · WORKSTATION</span>
        <span className="build">0.4.1</span>
      </div>
      <div className="mode-switch">
        {modes.map((m) => (
          <button key={m.id}
                  className={"mode-btn" + (mode === m.id ? " on" : "") + (suggested === m.id && mode !== m.id ? " suggested" : "")}
                  onClick={() => setMode(m.id)}>
            <span className="num">{m.num}</span>
            <span>{m.label}</span>
            <span className="dot"></span>
          </button>
        ))}
      </div>
      <div className="topbar-status">
        <SymbolSwitcher symbol={symbol} setSymbol={setSymbol} />
        <div className="status-cell">
          <span className="k">ET</span>
          <span className="v">{status.clock}</span>
        </div>
        <div className="status-cell">
          <span className="k">PH</span>
          <span className="v amber">{status.phase}</span>
        </div>
        <div className="status-cell">
          <span className="k">KZ</span>
          <span className="v">{status.killzone}</span>
        </div>
        <AlertChip fired={fired} onClick={() => setAlertsOpen((o) => !o)} />
        <FilesChip onClick={() => setFilesOpen((o) => !o)} />
        <div className="status-cell">
          <span className="k">LOOP</span>
          <span className={"loop-dot " + (status.loop !== "healthy" ? status.loop : "")}></span>
          <span className={"v " + ({ healthy: "green", stale: "amber", down: "red" }[status.loop])}>
            {status.loop.toUpperCase()}
          </span>
        </div>
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>
    </header>
  );
}

// ---------- Replay transport ----------
function ReplayTransport() {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="transport">
      <button className="t-btn" title="rewind">⏮</button>
      <button className="t-btn" title="step back">◀</button>
      <button className={"t-btn" + (playing ? " playing" : "")}
              onClick={() => setPlaying((p) => !p)}
              title={playing ? "pause" : "play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <button className="t-btn" title="step forward">▶</button>
      <button className="t-btn" title="end">⏭</button>
      <span className="t-time">09:50 · BAR 80 / 210</span>
      <div className="t-progress"><div className="fill"></div></div>
      <span className="t-speed">SPEED <b>2×</b></span>
    </div>
  );
}

// ---------- Chart pane ----------
function ChartContextStrip({ mode }) {
  const ctx = mode === "prep"   ? "HIGHER-TF · CONTEXT · D / 4H / 1H"
            : mode === "review" ? "REPLAY · LOWER-TF · SESSION REVIEW"
            : "LOWER-TF · ENTRY · 1m / 5m";
  return (
    <div className="chart-toolbar">
      <span className="tag">{ctx}</span>
      <span className="tag" style={{ color: "var(--blue)" }}>● TRADINGVIEW CHART</span>
      <span className="tag" style={{ color: "var(--label)" }}>chart controls: native TradingView toolbar</span>
      <span className="tradingview-mark">EMBEDDED · LIVE</span>
    </div>
  );
}

function ChartPane({ mode, symbol, theme }) {
  return (
    <div className="chart-pane">
      <ChartContextStrip mode={mode} />
      <div className="chart-body">
        <TradingViewChart symbol={symbol} interval={mode === "prep" ? "1H" : "1m"} theme={theme} />
        <TvSignInBanner />
      </div>
      {mode === "review" && <ReplayTransport />}
    </div>
  );
}

// ---------- Overlays ----------
function MarketClosedOverlay({ marketState, opensIn, opensAt }) {
  const reason = marketState === "closed-weekend"
    ? "CME · weekend break"
    : "CME · settlement break";
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(6,8,11,0.78)",
      backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 10, pointerEvents: "none",
    }}>
      <div style={{
        border: "1px solid var(--border)", background: "var(--surface-0)",
        padding: "18px 24px", textAlign: "center",
      }}>
        <div style={{ color: "var(--amber)", letterSpacing: ".22em", fontSize: 11, marginBottom: 8 }}>
          MARKET CLOSED
        </div>
        <div style={{ color: "var(--value)", fontSize: 13, marginBottom: 4 }}>
          {reason}
        </div>
        <div style={{ color: "var(--label)", fontSize: 11, letterSpacing: ".06em" }}>
          {opensAt}{opensIn ? ` · in ${opensIn}` : ""}
        </div>
      </div>
    </div>
  );
}

function TvNotLoggedIn() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "var(--chart-bg)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 5,
    }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div style={{ color: "var(--amber)", letterSpacing: ".22em", fontSize: 11, marginBottom: 14 }}>
          TRADINGVIEW · NOT SIGNED IN
        </div>
        <div style={{ color: "var(--value)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 18 }}>
          The embedded TradingView webview has no session.
          Sign in once — your account, layouts, and indicators persist after that.
        </div>
        <button className="btn amber">SIGN IN TO TRADINGVIEW</button>
      </div>
    </div>
  );
}

function Workstation({ mode, tweaks, alerts, onToggleArm, onArmPrice }) {
  if (mode === "prep")   return <PrepWorkstation alerts={alerts} onToggleArm={onToggleArm} />;
  if (mode === "review") return <ReviewWorkstation />;
  return (
    <LiveWorkstation
      subState={tweaks.liveSubState}
      loopDown={tweaks.loopHealth === "down"}
      noSetups={tweaks.noSetups}
      alerts={alerts}
      onArmPrice={onArmPrice}
    />
  );
}

function buildStatus(clock, effectiveT, lastBar) {
  // Auto-stale the loop if the last bar is older than 90s during an active
  // session window — early warning that the detector died.
  let loop = effectiveT.loopHealth;
  if (clock.marketState === "open"
      && (clock.phase === "OPEN REACTION" || clock.phase === "ENTRY HUNT")
      && lastBar.age_seconds != null
      && lastBar.age_seconds > 90) {
    loop = "stale";
  }
  const lastBarLabel = lastBar.ts ? `${lastBar.hhmm} · ${lastBar.age_label}` : "—";
  return { clock: clock.clock, phase: clock.phase, killzone: clock.killzone, loop, lastBar: lastBarLabel };
}

function suggestedMode(tweaks, clock) {
  if (!tweaks.suggestMode) return null;
  if (!clock || clock.marketState !== "open") return null;
  if (clock.phase === "OPEN REACTION" || clock.phase === "ENTRY HUNT") return "live";
  if (clock.phase === "PRE-SESSION") return "prep";
  return null;
}

function App() {
  const [t, setT] = useState(INITIAL);
  const setTweak = (k, v) => setT((prev) => ({ ...prev, [k]: v }));
  const [symbol, setSymbol] = useState("MNQ1!");
  const symbolMeta = SYMBOLS.find((s) => s.sym === symbol) || SYMBOLS[0];

  // ---- Theme ----
  // Hydrate from localStorage on first render so refresh keeps the choice.
  // Apply the value to <html data-theme=...> so CSS [data-theme="light"]
  // overrides take effect across every surface.
  const [theme, setTheme] = useState(() => {
    try {
      const v = localStorage.getItem("theme");
      return v === "light" || v === "dark" ? v : "dark";
    } catch (e) { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
  }, [theme]);

  // alert state — armed: { name: priceString }, fired: [{name,px,t,note}]
  const [alerts, setAlerts] = useState({
    armed: { "PDH": "21 528.50" },
    fired: [
      { name: "ONL", px: "21 471.50", t: "09:34:18", note: "swept on open" },
    ],
  });
  const [toast, setToast] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState(null);

  const toggleArm = (name, px) => {
    setAlerts((a) => {
      // Already armed at this exact name? toggle off (local only — TradingView
      // disarm is a Phase-8 polish; for v1, leaving the real alert active is
      // acceptable, the local map just hides the dot).
      if (a.armed[name]) {
        const newArmed = { ...a.armed };
        delete newArmed[name];
        return { ...a, armed: newArmed };
      }
      // Already armed at this same PRICE under a different name — treat as
      // the same alert and disarm those instead of duplicating.
      const matchingKeys = Object.entries(a.armed)
        .filter(([, p]) => p === px)
        .map(([k]) => k);
      if (matchingKeys.length > 0) {
        const newArmed = { ...a.armed };
        for (const k of matchingKeys) delete newArmed[k];
        return { ...a, armed: newArmed };
      }
      return { ...a, armed: { ...a.armed, [name]: px } };
    });
    // Fire the real alert into TradingView via main.
    armAlertReal(px, name).catch(() => {});
  };

  // Arm an alert at a free-form price Claude named.
  const armFromPrice = (px) => {
    setAlerts((a) => {
      if ((a.fired || []).some((f) => f.px === px)) return a;
      const existingKeys = Object.entries(a.armed)
        .filter(([, p]) => p === px)
        .map(([k]) => k);
      if (existingKeys.length > 0) {
        const newArmed = { ...a.armed };
        for (const k of existingKeys) delete newArmed[k];
        return { ...a, armed: newArmed };
      }
      const key = "@ " + px;
      return { ...a, armed: { ...a.armed, [key]: px } };
    });
    armAlertReal(px, "@ " + px).catch(() => {});
  };

  // Real fired-alert events from main: append to the local fired list +
  // show a toast.
  useAlertFiredListener((ev) => {
    const pxStr = ev.price != null
      ? String(ev.price).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
      : "";
    setAlerts((a) => {
      const newArmed = { ...a.armed };
      // Remove any armed entry that targeted this price.
      for (const [k, v] of Object.entries(newArmed)) {
        if (v === pxStr || parseFloat(v.replace(/\s/g, "")) === Number(ev.price)) {
          delete newArmed[k];
        }
      }
      const newFired = [
        { name: ev.label || pxStr, px: pxStr, t: ev.fired_at?.slice(11, 19) || nowStamp(), note: "price level reached" },
        ...(a.fired || []),
      ];
      return { ...a, armed: newArmed, fired: newFired };
    });
    setToast({ name: ev.label || pxStr, px: pxStr });
  });

  const mode = t.mode;
  const split = mode === "live" ? "split-70" : "split-60";
  const health = useHealth();
  // Real loop health from main overrides the tweak default; in PREP/REVIEW
  // health may not be active yet — fall back to the tweak.
  const effectiveT = health?.loop && health.loop !== "off"
    ? { ...t, loopHealth: health.loop }
    : t;
  const clock = useClock();
  const lastBar = useLastBar();
  const status = buildStatus(clock, effectiveT, lastBar);
  const sg = suggestedMode(t, clock);

  // Keyboard shortcuts: Cmd/Ctrl+1/2/3 mode switch, / to focus chat input.
  useEffect(() => {
    const onKey = (e) => {
      const inField = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        setTweak("mode", "prep");
        window.api?.mode?.switch?.("prep");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        setTweak("mode", "live");
        window.api?.mode?.switch?.("live");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "3") {
        e.preventDefault();
        setTweak("mode", "review");
        window.api?.mode?.switch?.("review");
      } else if (e.key === "/" && !inField) {
        const input = document.querySelector(".claude-compose input");
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TopBar mode={mode}
              setMode={(m) => { setTweak("mode", m); window.api?.mode?.switch?.(m); }}
              suggested={sg}
              status={status}
              symbol={symbol}
              setSymbol={setSymbol}
              fired={alerts.fired}
              armed={alerts.armed}
              alertsOpen={alertsOpen}
              setAlertsOpen={setAlertsOpen}
              filesOpen={filesOpen}
              setFilesOpen={setFilesOpen}
              theme={theme}
              setTheme={setTheme} />

      {alertsOpen && (
        <AlertsPopover fired={alerts.fired} armed={alerts.armed}
                       onClose={() => setAlertsOpen(false)} />
      )}
      {filesOpen && (
        <FilesPopover
          onClose={() => setFilesOpen(false)}
          onView={(f) => { setViewerFile(f); setFilesOpen(false); }} />
      )}
      {viewerFile && (
        <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />
      )}

      <div className={"main " + split}>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: "100%" }}>
          <ChartPane mode={mode} symbol={symbol} theme={theme} />
          {clock.marketState !== "open" && (
            <MarketClosedOverlay marketState={clock.marketState}
                                 opensIn={clock.opensIn}
                                 opensAt={clock.opensAt} />
          )}
          {toast && <AlertToast alert={toast} onClose={() => setToast(null)} />}
        </div>
        <div className="work-pane">
          <Workstation mode={mode} tweaks={t}
                       alerts={alerts}
                       onToggleArm={toggleArm}
                       onArmPrice={armFromPrice} />
        </div>
      </div>

      <StatusLine
        mode={mode.toUpperCase()}
        subState={mode === "live" ? t.liveSubState : null}
        phase={status.phase}
        killzone={status.killzone}
        loop={status.loop}
        lastBar={status.lastBar}
        sessionsRun={mode === "review" ? "3" : "1"} />

    </div>
  );
}

function nowStamp() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((x) => String(x).padStart(2, "0")).join(":");
}

export { App };
