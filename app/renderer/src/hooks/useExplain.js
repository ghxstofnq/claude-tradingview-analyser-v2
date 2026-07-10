// useExplain — fires the on-demand anomaly explainer (Track 2 §2b item 5,
// docs/intent/2026-07-10-unified-goal.md). The System page's ANOMALIES card calls
// explain(anomaly) when the operator clicks EXPLAIN on a red readiness blocker or
// a captured app:error.
//
// ISOLATION: the turn runs under the dedicated `explain` purpose on its own
// `explain:*` IPC channel — NOT the shared chat channel — so it never pollutes
// the chat context and its reply never surfaces in the CLAUDE/BRAIN feed. It
// renders inline on the card that asked for it.
//
// Mirrors useAiAnalysis (#242): a runningRef guards double-fires, the streamed
// chunks accumulate into `text`, and turn_complete clears running. It adds an
// inline `error` (from the dedicated explain:error, never app:error) and an
// `activeKey` so the card knows WHICH anomaly's explanation to render.

import { useCallback, useEffect, useRef, useState } from "react";
import { buildExplainEvent } from "../shell/anomalies.helpers.js";

export function useExplain({ symbol = "MNQ1!" } = {}) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [ts, setTs] = useState(null);
  const runningRef = useRef(false);
  const bufRef = useRef("");

  useEffect(() => {
    // Capture only OUR turn: explain-purpose claude chunks while we're running, on
    // the dedicated `explain:*` channel (never chat:*). The purpose guard is
    // belt-and-braces — this channel only ever carries explain turns.
    const offChunk = window.api?.explain?.onChunk?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "explain") return;
      if ((ev?.provider ?? "claude") !== "claude") return;
      if (typeof ev?.text !== "string") return;
      bufRef.current += ev.text;
      setText(bufRef.current);
    });
    const offErr = window.api?.explain?.onError?.((ev) => {
      if (!runningRef.current) return;
      setError(typeof ev?.message === "string" && ev.message ? ev.message : "the explanation failed");
    });
    const offDone = window.api?.explain?.onTurnComplete?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "explain") return;
      runningRef.current = false;
      setRunning(false);
      setTs(Date.now());
    });
    return () => { offChunk?.(); offErr?.(); offDone?.(); };
  }, []);

  const explain = useCallback(async (anomaly) => {
    if (runningRef.current || !anomaly) return;
    bufRef.current = "";
    setText("");
    setError(null);
    setTs(null);
    setActiveKey(anomaly.key ?? null);
    runningRef.current = true;
    setRunning(true);

    const event = buildExplainEvent(anomaly);

    // A FRESH readiness snapshot at click time (reuse the readiness:get IPC).
    // Main adds the health snapshot (getLastHealth). Best-effort — a failed read
    // still explains from the event alone.
    let readiness = null;
    try {
      const rr = await window.api?.readiness?.get?.(symbol);
      if (rr?.ok && rr.readiness) readiness = rr.readiness;
    } catch { /* keep null; main still supplies health */ }

    try {
      const res = await window.api?.explain?.run?.({ event, readiness });
      // A streamed turn clears running via turn_complete. But a rejected
      // (in-flight) or immediate-failure result never streams — clear here so the
      // button can never hang on RUNNING.
      if (res && res.ok === false && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
        setError(res.error || "the explanation failed");
      }
    } catch {
      runningRef.current = false;
      setRunning(false);
      setError("the explanation failed to start");
    }
  }, [symbol]);

  // Collapse the inline explanation (operator dismisses it).
  const dismiss = useCallback(() => {
    if (runningRef.current) return;
    setActiveKey(null);
    setText("");
    setError(null);
  }, []);

  return { text, running, error, activeKey, ts, explain, dismiss };
}
