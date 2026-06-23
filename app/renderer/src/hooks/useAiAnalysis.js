// useAiAnalysis — fires a fresh, focused in-depth pre-open analysis turn on
// demand. The PREP panel's AI view re-runs this every time it's opened (user
// decision: "always kick off a fresh analysis on click"). It reuses the
// existing chat:send_message IPC (provider claude) and captures the streamed
// reply.
//
// NOTE: because this rides the shared chat channel, the reply ALSO surfaces in
// the CHAT popover's claude feed. That's the cheap v1; a dedicated one-shot IPC
// (purpose "prep-deep") is the clean upgrade if isolation becomes wanted.

import { useCallback, useEffect, useRef, useState } from "react";

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
    // Capture only OUR turn: chat-purpose claude chunks while we're running.
    // bar-close / brief narration carries a non-"chat" purpose → ignored.
    const offChunk = window.api?.chat?.onChunk?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "chat") return;
      if ((ev?.provider ?? "claude") !== "claude") return;
      if (typeof ev?.text !== "string") return;
      bufRef.current += ev.text;
      setText(bufRef.current);
    });
    const offDone = window.api?.chat?.onTurnComplete?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "chat") return;
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

    const sym = symbol || "the lead symbol";
    const sess = session ? session.toUpperCase() : "the upcoming session";
    const gradeLine = brief?.pillar_grade ? ` The deterministic pre-session grade is ${brief.pillar_grade}.` : "";
    const prompt = customPrompt || (
      `In-depth pre-open read for ${sym}, ${sess}. Walk Lanto's three components as concise prose: ` +
      `(1) draw & bias — the near-price HTF arrays + liquidity, the overnight read, and the provisional bias with why; ` +
      `(2) price action — is price good or bad right now (displacement vs consolidation, gap sizes, overnight range); ` +
      `(3) the open scenarios — the two reactions to watch for after 09:30 and what would make today A+ vs a stand-aside.` +
      `${gradeLine} Ground every number in today's brief. No tool calls needed — just the read.`
    );

    Promise.resolve(window.api?.chat?.send?.(prompt, { provider: "claude" }))
      .catch(() => { runningRef.current = false; setRunning(false); });
  }, [symbol, session, brief, customPrompt]);

  return { text, running, ts, run };
}
