// app/renderer/src/hooks/usePrep.js
// State for the PREP popover. Wraps the existing window.api.prep.* IPC
// channels and exposes a slim {state, derived, actions} contract.
//
// Underlying data: the brief turn's surface_session_brief output, persisted
// to state/session/<date>/<session>/brief.json. window.api.prep.get() reads
// the latest brief. window.api.prep.refresh() triggers a fresh brief turn.

import { useEffect, useReducer, useCallback } from "react";

export const INITIAL = {
  brief: null,        // full brief payload from prep:get (or null)
  isLoading: false,   // true while a RUN_BRIEF is in flight
  error: null,        // last RUN_BRIEF error message (or null)
};

export function reducer(s, action) {
  switch (action.type) {
    case "BRIEF_LOADED":    return { ...s, brief: action.brief, isLoading: false, error: null };
    case "RUN_BRIEF":       return { ...s, isLoading: true, error: null };
    case "RUN_BRIEF_DONE":  return { ...s, isLoading: false };
    case "RUN_BRIEF_ERROR": return { ...s, isLoading: false, error: action.message };
    default: return s;
  }
}

// Pure deriver — precomputes everything the popover body needs so render
// stays declarative. Returns { hasBrief: false } when nothing is loaded yet
// so the body can show its empty-state branch.
export function deriveState({ brief }) {
  if (!brief) return { hasBrief: false };
  return {
    hasBrief: true,
    grade: brief.pillar_grade ?? null,
    proseSummary: brief.prose_summary ?? null,
    htfBias: brief.htf_bias ?? [],
    primaryDraw: brief.primary_draw ?? null,
    keyLevels: brief.key_levels ?? [],
    pillar2: brief.pillar2_verdict ?? null,
    scenarios: brief.scenarios ?? [],
    chainStatus: brief.chain_status ?? "clean",
    date: brief.date ?? null,
    session: brief.session ?? null,
    overnight: brief.overnight ?? [],
    plan: brief.plan ?? null,
  };
}

export function usePrep() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  // Initial brief load + subscribe to prep:brief_updated
  useEffect(() => {
    let alive = true;
    window.api?.prep?.get?.().then((brief) => {
      if (alive) dispatch({ type: "BRIEF_LOADED", brief });
    });
    const off = window.api?.prep?.onUpdated?.((brief) => {
      // brief_updated emits the new payload; refetch if event payload missing
      if (brief) dispatch({ type: "BRIEF_LOADED", brief });
      else {
        window.api?.prep?.get?.().then((b) => { if (alive) dispatch({ type: "BRIEF_LOADED", brief: b }); });
      }
    });
    return () => { alive = false; off?.(); };
  }, []);

  const runBrief = useCallback(async () => {
    dispatch({ type: "RUN_BRIEF" });
    try {
      await window.api?.prep?.refresh?.();
      dispatch({ type: "RUN_BRIEF_DONE" });
    } catch (e) {
      dispatch({ type: "RUN_BRIEF_ERROR", message: e?.message ?? String(e) });
    }
  }, []);

  const armLevel = useCallback((price, label) => window.api?.alert?.arm?.(price, label), []);
  const disarmLevel = useCallback((id) => window.api?.alert?.disarm?.(id), []);

  return {
    state,
    derived: deriveState(state),
    actions: { runBrief, armLevel, disarmLevel },
  };
}
