// app/renderer/src/hooks/useBacktest.js
// Single source of truth for the BacktestPopover's state machine. Subscribes
// to backtest:event from main, drives a reducer, exposes actions that talk
// back to main via ipc.
//
// Two exports:
//   useBacktest()          — full reducer + actions, consumed by BacktestPopover
//   useBacktestRunning()   — slim subscription for exclusive-mode placeholders
//                            on Prep / Live panels

import { useEffect, useReducer, useCallback, useState, useRef } from "react";
import { nextState } from "../Backtest.helpers.js";

const INITIAL = {
  ui: "IDLE",
  library: { runs: [], loading: true },
  currentRun: null,    // { runId, session, date, mode, progress, setups[] }
  surfacedSetup: null, // populated while AWAITING in pause mode
  selectedRunId: null, // for DETAIL view
  detail: null,        // populated when DETAIL view loads run data
};

export function reducer(s, action) {
  switch (action.type) {
    case "LIBRARY_LOADED":
      return { ...s, library: { runs: action.runs, loading: false } };

    case "START": {
      const ui = nextState(s.ui, { type: "START", mode: action.cfg.mode });
      return {
        ...s, ui,
        currentRun: {
          runId: null, ...action.cfg,
          progress: { bar: 0, total: 180, cost: 0, phase: "starting" },
          setups: [],
        },
      };
    }

    case "ENGINE_EVENT": {
      const e = action.event;
      // The engine's own events drive the UI state — a run may have been
      // started outside the form (preload API, app restart mid-run), so
      // start/progress recover AUTO_RUNNING from IDLE/DONE on their own.
      const followEngine = (s.ui === "IDLE" || s.ui === "DONE") ? "AUTO_RUNNING" : s.ui;
      if (e.type === "start") {
        return { ...s, ui: followEngine, currentRun: { ...(s.currentRun ?? {}), runId: e.runId, date: e.date, session: e.session, mode: e.mode } };
      }
      if (e.type === "progress") {
        return { ...s, ui: followEngine, currentRun: { ...(s.currentRun ?? {}), progress: { bar: e.bar, total: e.total, cost: e.cost, phase: e.phase } } };
      }
      if (e.type === "setup_surfaced") {
        const existing = s.currentRun?.setups ?? [];
        const next = existing.some((x) => x.id === e.setup?.id) ? existing : [...existing, e.setup];
        return { ...s, currentRun: { ...(s.currentRun ?? {}), setups: next } };
      }
      if (e.type === "setup_accepted") {
        // The engine emits { setupId } only (no full setup) — setup_surfaced
        // already added it. Flip the existing row's accepted flag; never push
        // (the old code pushed e.setup === undefined → a garbage card).
        const setups = (s.currentRun?.setups ?? []).map((x) =>
          x.id === e.setupId ? { ...x, accepted: true } : x);
        return { ...s, currentRun: { ...(s.currentRun ?? {}), setups } };
      }
      if (e.type === "paused") {
        const setups = s.currentRun?.setups ?? [];
        const next = setups.some((x) => x.id === e.setup?.id) ? setups : [...setups, e.setup];
        return {
          ...s,
          ui: nextState(s.ui, { type: "SETUP_SURFACED", mode: "pause" }),
          surfacedSetup: e.setup,
          currentRun: { ...(s.currentRun ?? {}), setups: next },
        };
      }
      if (e.type === "setup_rejected") {
        // Strip the rejected setup from currentRun for visual clarity
        return { ...s, currentRun: { ...(s.currentRun ?? {}), setups: (s.currentRun?.setups ?? []).filter((x) => x.id !== e.setupId) } };
      }
      if (e.type === "setup_outcome") {
        const setups = (s.currentRun?.setups ?? []).map((x) =>
          x.id === e.setupId ? { ...x, outcome: e.outcome, exit: e.exit } : x);
        return { ...s, currentRun: { ...(s.currentRun ?? {}), setups } };
      }
      if (e.type === "done") {
        return { ...s, ui: "DONE", currentRun: { ...(s.currentRun ?? {}), summary: e.summary } };
      }
      if (e.type === "error") {
        return { ...s, ui: "DONE", currentRun: { ...(s.currentRun ?? {}), error: e.message } };
      }
      return s;
    }

    case "DECISION":
      return {
        ...s,
        ui: nextState(s.ui, { type: "DECISION", choice: action.choice }),
        surfacedSetup: null,
      };

    case "VIEW_ALL":
      return { ...s, ui: nextState(s.ui, action) };

    case "ROW_CLICK":
      return { ...s, ui: nextState(s.ui, action), selectedRunId: action.runId };

    case "BACK":
      return { ...s, ui: nextState(s.ui, action), selectedRunId: null, detail: null };

    case "OPEN_DETAIL":
      return { ...s, ui: nextState(s.ui, action), selectedRunId: action.runId };

    case "DISMISS":
      return { ...s, ui: nextState(s.ui, action) };

    case "RUN_ANOTHER":
      return { ...s, ui: nextState(s.ui, action), currentRun: null, surfacedSetup: null };

    case "DETAIL_LOADED":
      return { ...s, detail: action.detail };

    default:
      return s;
  }
}

export function useBacktest() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  // Multi-day STUDY queue: a study expands to N (date × session) jobs that
  // run sequentially through the single-run engine. jobQueueRef holds the
  // remaining jobs; the DONE effect below advances to the next one.
  const jobQueueRef = useRef([]);
  const [jobsRemaining, setJobsRemaining] = useState(0);

  // Initial library load + subscribe to events
  useEffect(() => {
    window.api?.backtest?.list?.().then(({ runs } = {}) => {
      dispatch({ type: "LIBRARY_LOADED", runs: runs ?? [] });
    });
    const off = window.api?.backtest?.onEvent?.((e) => dispatch({ type: "ENGINE_EVENT", event: e }));
    return off;
  }, []);

  // Advance the study queue when a run finishes. Each run lands in the
  // library; when the queue empties the user lands on DONE and can open
  // ANALYTICS to see the aggregate across the runs just produced.
  useEffect(() => {
    if (state.ui !== "DONE") return;
    if (jobQueueRef.current.length === 0) return;
    const next = jobQueueRef.current.shift();
    setJobsRemaining(jobQueueRef.current.length);
    const t = setTimeout(() => {
      dispatch({ type: "START", cfg: next });
      window.api?.backtest?.start?.(next);
    }, 80);
    return () => clearTimeout(t);
  }, [state.ui]);

  // When DETAIL opens, fetch the run's deep data
  useEffect(() => {
    if (state.ui === "DETAIL" && state.selectedRunId) {
      window.api?.backtest?.get?.({ runId: state.selectedRunId })
        .then((detail) => dispatch({ type: "DETAIL_LOADED", detail }));
    }
  }, [state.ui, state.selectedRunId]);

  // After a run finishes, refresh the library so the new run is visible
  useEffect(() => {
    if (state.ui === "DONE") {
      window.api?.backtest?.list?.().then(({ runs } = {}) => {
        dispatch({ type: "LIBRARY_LOADED", runs: runs ?? [] });
      });
    }
  }, [state.ui]);

  return {
    state,
    jobsRemaining,
    actions: {
      start: useCallback((cfg) => {
        jobQueueRef.current = [];
        setJobsRemaining(0);
        dispatch({ type: "START", cfg });
        window.api?.backtest?.start?.(cfg);
      }, []),
      // Run a study: jobs = [{date, session, mode, symbol}...]. Runs the
      // first now; the DONE effect runs the rest sequentially.
      startStudy: useCallback((jobs) => {
        const list = Array.isArray(jobs) ? jobs.slice() : [];
        if (list.length === 0) return;
        const first = list.shift();
        jobQueueRef.current = list;
        setJobsRemaining(list.length);
        dispatch({ type: "START", cfg: first });
        window.api?.backtest?.start?.(first);
      }, []),
      stop: useCallback(() => window.api?.backtest?.stop?.(), []),
      accept: useCallback((setupId) => {
        window.api?.backtest?.decision?.({ choice: "accept", setupId });
        dispatch({ type: "DECISION", choice: "accept" });
      }, []),
      reject: useCallback((setupId, reason) => {
        window.api?.backtest?.decision?.({ choice: "reject", setupId, reason });
        dispatch({ type: "DECISION", choice: "reject" });
      }, []),
      viewAll: useCallback(() => dispatch({ type: "VIEW_ALL" }), []),
      rowClick: useCallback((runId) => dispatch({ type: "ROW_CLICK", runId }), []),
      openDetail: useCallback((runId) => dispatch({ type: "OPEN_DETAIL", runId }), []),
      back: useCallback(() => dispatch({ type: "BACK" }), []),
      dismiss: useCallback(() => dispatch({ type: "DISMISS" }), []),
      runAnother: useCallback(() => dispatch({ type: "RUN_ANOTHER" }), []),
      deleteRun: useCallback(async (runId) => {
        await window.api?.backtest?.delete?.({ runId });
        const { runs } = await window.api?.backtest?.list?.() ?? {};
        dispatch({ type: "LIBRARY_LOADED", runs: runs ?? [] });
      }, []),
    },
  };
}

// Lightweight "is a run active right now" subscription for Prep/Live placeholders.
// Doesn't share state with useBacktest — it has its own listener so multiple
// callers don't clobber each other.
export function useBacktestRunning() {
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState(null);
  useEffect(() => {
    // Initial status query in case a run was already in flight before mount
    window.api?.backtest?.status?.().then(({ running } = {}) => setRunning(!!running));
    const off = window.api?.backtest?.onEvent?.((e) => {
      if (e.type === "start") { setRunning(true); setSession(e.session); }
      if (e.type === "done" || e.type === "error") { setRunning(false); setSession(null); }
    });
    return off;
  }, []);
  return { running, session };
}
