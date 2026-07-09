// CommandShell — the redesigned app shell (2026-07-03 handoff). Minimal topbar
// + full-bleed chart + ambient strip; ⌘K palette; centered floating pages over
// a scrim; hold-to-flatten. Replaces the old topbar-cells + statusline model.
//
// State owned here: page router, palette, flatten overlay, toasts, coach chip,
// alerts, calendar. The global keydown/keyup handlers are the single keyboard
// authority (resolveKey is pure). The TradingView webview is mounted exactly
// once inside the chart-host and never remounts — pages/palette/scrim overlay
// it purely by z-index.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TradingViewChart, TvSignInBanner } from "../TvChart.jsx";
import { ErrorBoundary } from "../ErrorBoundary.jsx";
import { TopBar } from "./TopBar.jsx";
import { Palette } from "./Palette.jsx";
import { FlattenConfirm } from "./FlattenConfirm.jsx";
import { PrepWizard } from "./PrepWizard.jsx";
import { Toasts, CoachChip } from "./Toasts.jsx";
import { Page } from "./pages/Page.jsx";
import { BriefingPage } from "./pages/BriefingPage.jsx";
import { LivePage } from "./pages/LivePage.jsx";
import { ReviewPage } from "./pages/ReviewPage.jsx";
import { BacktestPage } from "./pages/BacktestPage.jsx";
import { AgentPage } from "./pages/AgentPage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";
import { SystemShellPage } from "./pages/SystemPage.jsx";
import { RiskShellPage, PrefsShellPage } from "./pages/UtilPages.jsx";
import { resolveKey } from "./keymap.helpers.js";
import { buildCommands } from "./commandList.helpers.js";
import { detectIntent } from "./paletteIntent.helpers.js";
import { parseTicket } from "./parseTicket.helpers.js";
import { visibleRows } from "./commandList.helpers.js";
import { useExecutionState } from "../hooks/useExecutionState.js";
import { useHealth } from "../hooks/useHealth.js";
import { useSessionBrief } from "../hooks/useSessionBrief.js";
import { useActiveSetup } from "../hooks/useActiveSetup.js";
import {
  useAlertStateListener, useAlertFiredListener, normalizeArmed, armAlertReal, disarmAlertReal,
} from "../hooks/useAlerts.js";
import { useCalendar } from "../hooks/useCalendar.js";
import { readPrefs } from "../hooks/usePrefs.js";
import { classifyWalkerTransitions, describeSignal, signalEffects } from "./walkerSignals.helpers.js";
import { playChime } from "./chimes.js";

let TOAST_SEQ = 0;

function fmtCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const m = Math.floor(ms / 60000); const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

// Signed USD — the realized P&L in the flatten toast is DATA from the IPC result,
// never a literal (CLAUDE.md #7 no-LLM-arithmetic applies to display too).
const fmtUsd = (n) => (n >= 0 ? "+$" : "-$") + Math.abs(n).toLocaleString("en-US");

// Preference effects (gated by usePrefs in Settings, applied on an alert fire).
function playTick() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    o.start(); o.stop(ctx.currentTime + 0.16);
    o.onended = () => ctx.close();
  } catch { /* audio unavailable */ }
}
function notifyDesktop(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") { new Notification(title, { body }); return; }
    if (Notification.permission !== "denied") Notification.requestPermission().then((p) => { if (p === "granted") new Notification(title, { body }); }).catch(() => {});
  } catch { /* notifications unavailable */ }
}

const PAGE_COMPONENTS = {
  briefing: BriefingPage, live: LivePage, review: ReviewPage,
  backtest: BacktestPage, agent: AgentPage, settings: SettingsPage, system: SystemShellPage,
  risk: RiskShellPage, prefs: PrefsShellPage,
};

export function CommandShell({ symbol, setSymbol, guards, setGuards, chats, currentPrice, onToggleTheme }) {
  const [page, setPage] = useState(null);
  const [pal, setPal] = useState({ open: false, query: "", sel: 0, forced: null, askQuery: null });
  const [flat, setFlat] = useState({ open: false, hold: false });
  const [prep, setPrep] = useState({ open: false, step: 0 });
  const [toasts, setToasts] = useState([]);
  const [coach, setCoach] = useState(true);

  const exec = useExecutionState();
  const health = useHealth();
  const { brief } = useSessionBrief();
  const events = useCalendar();
  const [automationMode, setAutomationMode] = useState("manual");

  const addToast = useCallback((msg, tint = "green") => {
    const id = ++TOAST_SEQ;
    setToasts((t) => [...t, { id, msg, tint }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const dismissToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  // Alerts — armed set (best-effort) + fired list; fire raises a toast.
  const [alerts, setAlerts] = useState({ armed: [], fired: [] });
  useAlertStateListener((ev) => {
    const armed = normalizeArmed(ev).map((a) => ({ id: a.id, name: a.label?.trim() ? a.label : `@ ${a.price}`, price: a.price }));
    setAlerts((s) => ({ ...s, armed }));
  });
  useAlertFiredListener((ev) => {
    const name = ev.label || `@ ${ev.price}`;
    const t = ev.fired_at?.slice(11, 19) || "";
    setAlerts((s) => ({ ...s, fired: [{ id: ev.id, name, price: ev.price, t }, ...s.fired], armed: s.armed.filter((a) => a.price !== ev.price) }));
    addToast(`ALERT · ${name} reached ${ev.price}`, "amber");
    // Preference-gated effects (Settings ⌘6 → PREFERENCES). Read fresh so a
    // toggle takes effect without re-subscribing this listener.
    const pr = readPrefs();
    if (pr.notif) notifyDesktop("Price alert", `${name} reached ${ev.price}`);
    if (pr.sound) playTick();
    if (pr.autoTicket) openPalette();
  });

  useEffect(() => {
    window.api?.execution?.config?.get?.().then((r) => { if (r?.ok) setAutomationMode(r.config?.automationMode ?? "manual"); }).catch(() => {});
  }, []);

  // Auto-surface a newly detected setup for accept/reject — the LiveCell used to
  // pop itself open on a fresh setup; in the shell that becomes opening the LIVE
  // page (LiveBody mounts in HUNT) + a toast. Guard on the setup id so it fires
  // once per setup, never on unrelated re-renders.
  const { activeSetup } = useActiveSetup();
  const lastSurfaced = useRef(null);
  useEffect(() => {
    const id = activeSetup?.id;
    if (id && id !== lastSurfaced.current) {
      lastSurfaced.current = id;
      setPage("live");
      setPal((p) => ({ ...p, open: false }));
      addToast(`New setup — ${(activeSetup.side || "").toUpperCase()} ${activeSetup.model || ""}`.trim(), "blue");
    }
  }, [activeSetup?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── command context + list ────────────────────────────────────────────
  const levels = useMemo(
    () => (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state).map((l) => ({ name: l.name, price: l.price })),
    [brief]);
  const hasPosition = !!exec?.position;
  const detectorRunning = health?.loop === "healthy";
  const cdpDown = health?.cdp === "down";
  const commands = useMemo(
    () => buildCommands({ tripped: false, levels, hasPosition, detectorRunning, automationMode, symbol, cdpDown }),
    [levels, hasPosition, detectorRunning, automationMode, symbol, cdpDown]);

  // Walker stage-change chimes + packet notifications (plan 2026-07-09 Task 1).
  // Consecutive deterministic:packet truths are classified into signals; the
  // packet chime fires on the rising edge only (a packet that persists across
  // bars doesn't re-chime), and re-folds of the same bar are skipped entirely.
  const walkerSigRef = useRef({ ts: null, walkers: [], hadPacket: false });
  useEffect(() => {
    const off = window.api?.deterministic?.onPacket?.((truth) => {
      const st = walkerSigRef.current;
      const ts = truth?.eventTimeUtc ?? null;
      if (ts != null && ts === st.ts) { st.walkers = truth?.walkers ?? st.walkers; return; }
      const signals = classifyWalkerTransitions({
        prevWalkers: st.walkers, truth, packetAlreadySignaled: st.hadPacket,
      });
      walkerSigRef.current = { ts, walkers: truth?.walkers ?? [], hadPacket: !!truth?.bestPacket };
      if (!signals.length) return;
      const prefs = readPrefs();
      for (const sig of signals) {
        const fx = signalEffects(sig);
        if (fx.chime && prefs.walkerChimes) playChime(fx.chime);
        if (fx.notify && prefs.walkerNotif) notifyDesktop("Walker packet", describeSignal(sig));
        if (fx.toast) addToast(describeSignal(sig), sig.kind === "packet_fired" ? "amber" : "green");
      }
    });
    return () => off?.();
  }, [addToast]);

  // One-click TV Desktop relaunch with the CDP flag (constraint #1 recipe).
  // Takes ~10-20s: quit → reopen → wait for 9225 to answer.
  const relaunchTv = useCallback(async () => {
    addToast("Relaunching TradingView with CDP — takes ~15s…", "amber");
    const r = await window.api?.tv?.relaunch?.().catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (r?.ok) addToast(r.already ? "TradingView CDP already up" : "TradingView relaunched — CDP 9225 up", "green");
    else addToast(`Relaunch failed — ${r?.error || "unknown error"}`, "red");
  }, [addToast]);

  // ── palette open/close ────────────────────────────────────────────────
  const openPalette = (query = "") => setPal({ open: true, query, sel: 0, forced: null, askQuery: null });
  const closePalette = () => setPal((p) => ({ ...p, open: false, forced: null, askQuery: null }));
  const openPage = (p) => { setPage(p); closePalette(); setFlat({ open: false, hold: false }); setPrep({ open: false, step: 0 }); };
  const openFlatten = () => { closePalette(); setFlat({ open: true, hold: false }); };
  const closeFlatten = () => setFlat({ open: false, hold: false });
  // Prep wizard — the guided 4-step pre-session flow.
  const startPrep = () => { closePalette(); setPage(null); setFlat({ open: false, hold: false }); setPrep({ open: true, step: 0 }); };
  const closePrep = () => setPrep({ open: false, step: 0 });
  const prepBack = () => setPrep((p) => ({ ...p, step: Math.max(0, p.step - 1) }));
  const prepNext = () => {
    if (prep.step >= 3) { setPrep({ open: false, step: 0 }); addToast("Prep complete — 4/4 · good hunting", "green"); }
    else setPrep((p) => ({ ...p, step: p.step + 1 }));
  };

  // esc — step out ONE level, deepest-first. The palette steps down internally
  // (view/forced → query → close) before the page closes. Evidence/prep guards
  // slot in at the top when those surfaces land (they only add a guard, never
  // re-order the chain).
  const back = () => {
    if (flat.open) return closeFlatten();
    if (prep.open) return closePrep();
    if (pal.open) {
      if (pal.forced) return setPal((p) => ({ ...p, forced: null, askQuery: null, sel: 0 })); // view → root
      if (pal.query) return setPal((p) => ({ ...p, query: "", sel: 0 }));                      // query → empty
      return closePalette();                                                                   // empty → close
    }
    if (page) return setPage(null);
  };
  // scrim click — dismiss the top overlay outright (no step-down); matches the
  // prototype's dim-click (close palette if open, else close the page).
  const dismiss = () => {
    if (flat.open) return closeFlatten();
    if (prep.open) return closePrep();
    if (pal.open) return closePalette();
    if (page) return setPage(null);
  };

  // ── run a command row ─────────────────────────────────────────────────
  const runCommand = useCallback(async (row) => {
    const a = row?.action; if (!a) return;
    switch (a.type) {
      case "page": openPage(a.page); return;
      case "ask": setPal((p) => ({ ...p, open: true, forced: "ask", query: a.q, askQuery: a.q })); return;
      case "arm": {
        closePalette();
        const r = await armAlertReal(a.price, a.name);
        addToast(r?.ok ? `Alert armed · ${a.name} @ ${a.price}` : `Arm failed · ${a.name}`, "amber");
        return;
      }
      case "be": closePalette(); { const r = await window.api?.execution?.moveStopToBE?.(); addToast(r?.ok ? "Stop moved to breakeven" : "Move-to-BE failed", r?.ok ? "green" : "red"); } return;
      case "trail": closePalette(); { const r = await window.api?.execution?.trail?.(); addToast(r?.ok ? "Trailing stop armed" : "Trail failed", r?.ok ? "green" : "red"); } return;
      case "flatten": openFlatten(); return;
      case "switch-symbol": setSymbol(symbol === "MNQ1!" ? "MES1!" : "MNQ1!"); closePalette(); return;
      case "detector": closePalette(); {
        const running = detectorRunning;
        if (running) await window.api?.detector?.stop?.(); else await window.api?.detector?.start?.();
        addToast(running ? "Detector stopped" : "Detector started", running ? "red" : "green");
      } return;
      case "automation": closePalette(); {
        setAutomationMode(a.mode);
        window.api?.execution?.config?.set?.({ automationMode: a.mode }).catch(() => {});
        addToast(`Automation → ${a.mode.toUpperCase()}`, a.mode === "auto" ? "amber" : "blue");
      } return;
      case "theme": closePalette(); onToggleTheme?.(); return;
      case "startPrep": startPrep(); return;
      case "tv-relaunch": closePalette(); await relaunchTv(); return;
      default: return;
    }
  }, [symbol, detectorRunning, addToast, setSymbol, onToggleTheme, relaunchTv]);

  // ── palette Enter: run selected, or fall through to ask ───────────────
  const paletteEnter = () => {
    const q = pal.query;
    const detected = detectIntent(q);
    if (pal.forced === "ask") return; // already asking
    if (detected === "ask") { setPal((p) => ({ ...p, forced: "ask", askQuery: q.trim() })); return; }
    if (detected === "root" || detected === "filter") {
      const rows = visibleRows(commands, q);
      if (rows.length) return runCommand(rows[Math.min(pal.sel, rows.length - 1)]);
      if (q.trim()) return setPal((p) => ({ ...p, forced: "ask", askQuery: q.trim() })); // no match → ask
    }
    // ticket / browse / news / orders: their own controls handle actions.
  };

  const forceAsk = () => { if (pal.query.trim()) setPal((p) => ({ ...p, forced: "ask", askQuery: p.query.trim() })); };

  const moveSel = (delta) => setPal((p) => {
    const rows = visibleRows(commands, p.query);
    if (!rows.length) return p;
    return { ...p, sel: Math.max(0, Math.min(rows.length - 1, p.sel + delta)) };
  });

  // ── flatten fire ──────────────────────────────────────────────────────
  const fireFlatten = async () => {
    closeFlatten();
    const r = await window.api?.execution?.flatten?.({ symbol });
    if (r?.ok) {
      const realized = Number.isFinite(r?.realized) ? ` · ${fmtUsd(r.realized)} realized` : "";
      addToast(`Flattened ${symbol} @ market${realized}`, "green");
    } else {
      addToast(`FLATTEN FAILED · ${r?.error || ""}`, "red");
    }
  };
  const cancelAllOrders = async () => {
    const r = await window.api?.execution?.cancel?.();
    addToast(r?.ok ? "Working orders cancelled" : "Cancel failed", r?.ok ? "amber" : "red");
  };
  const disarmAlert = async (id) => {
    setAlerts((s) => ({ ...s, armed: s.armed.filter((a) => a.id !== id) })); // optimistic; alerts:state reconciles
    const r = await disarmAlertReal(id);
    addToast(r?.ok ? "Alert disarmed" : "Disarm failed", r?.ok ? "amber" : "red");
  };

  // ── keyboard ──────────────────────────────────────────────────────────
  useEffect(() => {
    const dispatch = (action) => {
      switch (action.type) {
        case "toggle-palette": pal.open ? closePalette() : openPalette(); break;
        case "open-palette": openPalette(); break;
        case "toggle-agent": page === "agent" ? setPage(null) : openPage("agent"); break;
        case "open-flatten": openFlatten(); break;
        case "open-page": openPage(action.page); break;
        case "back": back(); break;
        case "sel": moveSel(action.delta); break;
        case "force-ask": forceAsk(); break;
        case "palette-enter": paletteEnter(); break;
        case "flatten-hold-start": setFlat((f) => ({ ...f, hold: true })); break;
        default: break;
      }
    };
    const onKey = (e) => {
      const t = e.target;
      const typing = !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
      const paletteInputFocused = !!(t && t.dataset && t.dataset.cmdPalInput === "1");
      // resolveKey reads `typing` off its event arg — shape a plain object so
      // the bare-key/`/` typing guard actually fires (a raw DOM event has no
      // `.typing`). Same shape onShellKey uses.
      const synth = { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, repeat: e.repeat, typing };
      const action = resolveKey(synth, { paletteOpen: pal.open, flattenOpen: flat.open, page, paletteInputFocused });
      if (!action) return;
      // Don't preventDefault plain typing keys — resolveKey already returns null
      // for those while typing.
      if (action.type !== "back" || pal.open || flat.open || page || prep.open) e.preventDefault();
      dispatch(action);
    };
    const onKeyUp = (e) => { if (e.key === "Enter") setFlat((f) => (f.hold ? { ...f, hold: false } : f)); };
    // Chords forwarded from the TV webview guest (main) arrive as IPC, not DOM
    // keydown — shape a synthetic event, resolve it against the same pure keymap,
    // and dispatch. No overlay is focused in this path (the chart had focus), so
    // typing/paletteInputFocused are false.
    const onShellKey = (ev) => {
      const synth = { key: ev.key, metaKey: !!(ev.meta || ev.control), ctrlKey: !!ev.control,
                      shiftKey: !!ev.shift, repeat: !!ev.repeat, typing: false };
      const action = resolveKey(synth, { paletteOpen: pal.open, flattenOpen: flat.open, page, typing: false, paletteInputFocused: false });
      if (action) dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    const offShellKey = window.api?.shellKeys?.onKey?.(onShellKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      offShellKey?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pal, flat, page, prep, commands, runCommand]);

  // Refocus the renderer when the chrome is clicked so keyboard shortcuts keep
  // working after the TV webview has held focus (PR1 mitigation; PR3 forwards
  // keys from the guest webContents).
  const refocus = () => { try { window.focus(); } catch { /* noop */ } };

  const cycleVer = () => addToast("VER — click restart in the terminal when stale", "blue");
  const newsImminent = useMemo(() => {
    const now = Date.now();
    const next = (events || []).find((ev) => { const dt = new Date(ev?.ts).getTime(); return Number.isFinite(dt) && dt > now && dt - now <= 2 * 60 * 60 * 1000; });
    if (!next) return null;
    return `${next.event} in ${fmtCountdown(new Date(next.ts).getTime() - now)}`;
  }, [events]);
  const newsCount = useMemo(() => {
    const now = Date.now();
    return (events || []).filter((ev) => { const dt = new Date(ev?.ts).getTime(); return Number.isFinite(dt) && dt > now; }).length;
  }, [events]);

  // Every ⌘1–7 page (Agent included) renders as a centered floating page inside
  // the shared scrim + <Page> frame.
  const PageComp = page ? PAGE_COMPONENTS[page] : null;
  const pageProps = { onClose: () => setPage(null) };
  if (page === "briefing") Object.assign(pageProps, { symbol, currentPrice, onStartPrep: startPrep });
  if (page === "live") Object.assign(pageProps, { symbol, guards, onFlatten: openFlatten });
  if (page === "agent") Object.assign(pageProps, { chats });
  if (page === "settings") Object.assign(pageProps, { guards, setGuards, symbol, onToast: addToast });
  if (page === "system") Object.assign(pageProps, { pushToast: addToast });
  const scrimShown = pal.open || flat.open || prep.open || !!page;

  return (
    <div className="app shell" onMouseDownCapture={refocus}>
      <TopBar
        symbol={symbol} setSymbol={setSymbol} guards={guards} exec={exec}
        alertCount={alerts.armed.length + alerts.fired.length}
        newsCount={newsCount} newsImminent={newsImminent}
        onOpenPalette={() => openPalette()}
        onOpenNews={() => openPalette("news")}
        onOpenAlerts={() => openPalette("alerts")}
        onVerClick={cycleVer} onRelaunchTv={relaunchTv} onOpenBriefing={() => openPage("briefing")} />

      <div className="chart-host">
        <div className="chart-body">
          <ErrorBoundary label="CHART">
            <TradingViewChart symbol={symbol} />
            <TvSignInBanner />
          </ErrorBoundary>
        </div>
      </div>

      {scrimShown && (
        <div className="shell-scrim" onClick={dismiss}>
          {PageComp && <PageComp {...pageProps} />}
          {pal.open && (
            <Palette
              query={pal.query} onQuery={(q) => setPal((p) => ({ ...p, query: q, sel: 0 }))}
              sel={pal.sel} onHover={(i) => setPal((p) => ({ ...p, sel: i }))}
              forcedView={pal.forced} askQuery={pal.askQuery}
              commands={commands} symbol={symbol} chat={chats?.claude}
              alerts={alerts} events={events} workingOrders={exec?.workingOrders || []}
              onRunCommand={runCommand} onDisarm={disarmAlert}
              onCancelAll={cancelAllOrders} onToast={addToast} onClose={closePalette} />
          )}
          {prep.open && (
            <PrepWizard step={prep.step} onNext={prepNext} onBack={prepBack} onClose={closePrep}
                        guards={guards} setGuards={setGuards} />
          )}
          {flat.open && (
            <FlattenConfirm
              hasPosition={hasPosition}
              detail={exec?.position ? `${(exec.position.side || "").toUpperCase()} ${exec.position.qty} ${symbol}` : ""}
              holdActive={flat.hold} onClose={closeFlatten} onFlatten={fireFlatten} />
          )}
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
      {coach && !page && !pal.open && !flat.open && !prep.open && <CoachChip onClose={() => setCoach(false)} />}
    </div>
  );
}
