// useAiAnalysis — fires a fresh, focused in-depth deep-read turn on demand. The
// PREP panel's AI view re-runs this every time it's opened (user decision:
// "always kick off a fresh analysis on click"); LIVE reuses the same machinery
// with a live-context prompt.
//
// ISOLATION (Track 2 §2b item 3, docs/intent/2026-07-10-unified-goal.md): this
// runs under the dedicated `analysis` purpose on its own `analysis:*` IPC channel
// — NOT the shared chat channel. The turn has its own session (reset one-shot per
// run) and its own read-only phase prompt, so a deep read never pollutes the chat
// context and the reply never surfaces in the CHAT/BRAIN feed — it renders here,
// on the panel that asked for it. (Was a "cheap v1" that rode chat:send_message.)

import { useCallback, useEffect, useRef, useState } from "react";

// buildAnalysisPrompt — pure. The default pre-open read walks Lanto's three
// components; `customPrompt` (LIVE's live-context read of the current setup/trade)
// wins verbatim when provided. Extracted for node --test coverage.
export function buildAnalysisPrompt({ symbol, session, brief, customPrompt } = {}) {
  if (customPrompt) return customPrompt;
  const sym = symbol || "the lead symbol";
  const sess = session ? session.toUpperCase() : "the upcoming session";
  const gradeLine = brief?.pillar_grade ? ` The deterministic pre-session grade is ${brief.pillar_grade}.` : "";
  return (
    `In-depth pre-open read for ${sym}, ${sess}. Walk Lanto's three components as concise prose: ` +
    `(1) draw & bias — the near-price HTF arrays + liquidity, the overnight read, and the provisional bias with why; ` +
    `(2) price action — is price good or bad right now (displacement vs consolidation, gap sizes, overnight range); ` +
    `(3) open scenarios — the two reactions to watch after 09:30 that would make today A+ vs stand-aside.` +
    `${gradeLine} Ground every number in today's brief. No tool calls needed — just read.`
  );
}

// `prompt` (optional) overrides the default pre-open prompt — LIVE passes a
// live-context prompt (read the current setup/trade) so the same on-demand
// streaming machinery serves both surfaces.
export function useAiAnalysis({ symbol, session, brief, prompt: customPrompt } = {}) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [ts, setTs] = useState(null);
  const runningRef = useRef(false);
  const bufRef = useRef("");

  useEffect(() => {
    // Capture only OUR turn: analysis-purpose claude chunks while we're running,
    // on the dedicated `analysis:*` channel (never chat:*). The purpose guard is
    // belt-and-braces — this channel only ever carries analysis turns.
    const offChunk = window.api?.analysis?.onChunk?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "analysis") return;
      if ((ev?.provider ?? "claude") !== "claude") return;
      if (typeof ev?.text !== "string") return;
      bufRef.current += ev.text;
      setText(bufRef.current);
    });
    const offDone = window.api?.analysis?.onTurnComplete?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "analysis") return;
      runningRef.current = false;
      setRunning(false);
      setTs(Date.now());
    });
    return () => { offChunk?.(); offDone?.(); };
  }, []);

  const run = useCallback(() => {
    if (runningRef.current) return;
    bufRef.current = "";
    setText("");
    setTs(null);
    runningRef.current = true;
    setRunning(true);

    const prompt = buildAnalysisPrompt({ symbol, session, brief, customPrompt });

    Promise.resolve(window.api?.analysis?.run?.(prompt, { provider: "claude" }))
      .catch(() => { runningRef.current = false; setRunning(false); });
  }, [symbol, session, brief, customPrompt]);

  return { text, running, ts, run };
}
