// useChat — streamed Claude conversation state.
//
// Produces messages in the shape ClaudeFeed expects:
//   [{ type: "user" | "reply" | "bar-read", t: "HH:MM", body: "<html>" }]
//
// `body` is HTML; user-typed text is escaped before being inserted.

import { useEffect, useRef, useState } from "react";
import { shouldProviderHandleEvent } from "../provider-popover-contract.js";

// #20 Gate verbose console logging behind a localStorage flag so
// production runs aren't noisy. Set `localStorage.debug_chat = "1"` in
// devtools to re-enable.
const DEBUG = typeof window !== "undefined" && window?.localStorage?.getItem?.("debug_chat") === "1";
function dlog(...args) { if (DEBUG) console.log(...args); }

// #35 Bumped from 500 (PREP-default) — LIVE generates 6-12 messages
// per bar-close turn × 60 turns/hour = up to 700/hour. 500 was hit in
// <1h. 2000 covers a full 8h session with margin.
const CHAT_HISTORY_MAX = 2000;
const CHAT_HISTORY_KEEP = 1600;

function trimHistory(arr) {
  if (arr.length <= CHAT_HISTORY_MAX) return arr;
  return arr.slice(-CHAT_HISTORY_KEEP);
}

// #41 ET timestamp instead of trader's local clock — matches brief +
// recap which already use ET. Trader's eye doesn't have to convert.
function nowStamp() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// #68 useChat now owns only the chat-stream concern. The activeSetup
// + noTradeReason state lives in useActiveSetup so the setup card
// survives chat resets and is conceptually separate.
export function useChat({ provider = "claude" } = {}) {
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  // #44 "queued behind <purpose>" hint while waiting on the mutex.
  const [queuedBehind, setQueuedBehind] = useState(null);
  // Set of purposes with an in-flight turn (from the global activity
  // stream). Drives the CLAUDE dot's green-when-working state.
  const [workingPurposes, setWorkingPurposes] = useState(new Set());
  const streamingIdxRef = useRef(null);   // index of the in-flight reply message
  // Map of purpose → index of its currently-streaming activity row, so
  // tool_call / end events append to the right row instead of creating
  // duplicates.
  const activityIdxRef = useRef(new Map());

  useEffect(() => {
    if (!window.api?.chat) {
      // eslint-disable-next-line no-console
      console.error("[useChat] window.api.chat is undefined — preload script failed to load");
      return;
    }
    dlog("[useChat] subscribing to chat events");

    const offChunk = window.api.chat.onChunk((ev) => {
      if (!shouldProviderHandleEvent(provider, ev)) return;
      dlog("[useChat] chunk", JSON.stringify(ev?.text || "").slice(0, 80));
      setMessages((prev) => {
        const idx = streamingIdxRef.current;
        if (idx == null) return prev;
        const next = prev.slice();
        const cur = next[idx];
        if (!cur) return prev;
        next[idx] = { ...cur, body: (cur.body || "") + escapeHtml(ev.text) };
        return next;
      });
    });

    // (surface_setup / surface_no_trade tool_calls are handled by
    // useActiveSetup now — see #68.)

    const offTurnComplete = window.api.chat.onTurnComplete((ev) => {
      if (!shouldProviderHandleEvent(provider, ev)) return;
      dlog("[useChat] turn_complete", ev);
      // #63 Append a one-line duration footer to the streaming reply so
      // the trader sees "took 47s" without a separate panel. Skip if
      // duration is missing (catch-up turns currently don't emit it).
      if (ev?.durationMs && streamingIdxRef.current != null) {
        setMessages((prev) => {
          const idx = streamingIdxRef.current;
          if (idx == null || !prev[idx]) return prev;
          const secs = (ev.durationMs / 1000).toFixed(1);
          const next = prev.slice();
          next[idx] = {
            ...next[idx],
            body: (next[idx].body || "") +
              `<div style="color:var(--label);font-size:9.5px;letter-spacing:.08em;margin-top:4px">[ ${ev.purpose || "turn"} · ${secs}s ]</div>`,
          };
          return next;
        });
      }
      streamingIdxRef.current = null;
      setTyping(false);
      setQueuedBehind(null);
      clearTypingWatchdog();
    });

    const offQueued = window.api.chat.onQueued?.((ev) => {
      if (!shouldProviderHandleEvent(provider, ev)) return;
      setQueuedBehind(ev?.waitingOn || "another turn");
    });
    const offQueueReady = window.api.chat.onQueueReady?.((ev) => {
      if (!shouldProviderHandleEvent(provider, ev)) return;
      setQueuedBehind(null);
    });

    const offError = window.api.error?.onError?.((ev) => {
      if (!shouldProviderHandleEvent(provider, ev)) return;
      // eslint-disable-next-line no-console
      console.error("[useChat] app:error", ev);
      // Warnings (level=warn) get an amber tint + "notice:" prefix instead
      // of red + "error:" — e.g. the preflight "Chart reverted" notice is
      // informational, not a failure. Plain errors stay red.
      const isWarn = ev?.level === "warn";
      const color = isWarn ? "#d4a657" : "#f0796a";
      const prefix = isWarn ? "notice" : "error";
      setMessages((prev) => trimHistory([
        ...prev,
        { type: "reply", t: nowStamp(), body: `<span style="color:${color}">${prefix}: ${escapeHtml(ev.message || "unknown")}</span>` },
      ]));
      streamingIdxRef.current = null;
      setTyping(false);
      clearTypingWatchdog();
    });

    // Global activity stream — every userTurn across all purposes. The
    // chat purpose has its own dedicated handlers above, so we skip
    // chat-purpose events here to avoid duplicating the prose. Other
    // purposes (bar-close, brief, wrap, review, catch-up) get a compact
    // activity row showing start → tool calls → end with duration.
    const offActivity = window.api?.claude?.onActivity?.((ev) => {
      if (!shouldProviderHandleEvent(provider, ev)) return;
      const purpose = ev?.purpose;
      if (!purpose) return;
      // Track working set for the CLAUDE dot. Chat counts too — when
      // the user sends a message the dot should turn green.
      if (ev.type === "activity_start") {
        setWorkingPurposes((prev) => {
          const next = new Set(prev); next.add(purpose); return next;
        });
      } else if (ev.type === "activity_end") {
        setWorkingPurposes((prev) => {
          if (!prev.has(purpose)) return prev;
          const next = new Set(prev); next.delete(purpose); return next;
        });
      }
      // Skip chat-purpose activity messages — the dedicated chat:* flow
      // above already renders the actual prose. We only want to *show*
      // the autonomous purposes (bar-close, brief, etc.) here.
      if (purpose === "chat") return;
      const purposeLbl = purpose.toUpperCase();
      if (ev.type === "activity_start") {
        setMessages((prev) => {
          const next = trimHistory(prev.slice());
          next.push({
            type: "activity",
            t: nowStamp(),
            body: `<div style="color:var(--label);font-size:9.5px;letter-spacing:.12em"><span style="color:var(--amber)">▸ ${purposeLbl}</span> · started</div>`,
          });
          activityIdxRef.current.set(purpose, next.length - 1);
          return next;
        });
      } else if (ev.type === "tool_call") {
        const toolName = ev?.name || ev?.tool || "tool";
        setMessages((prev) => {
          const idx = activityIdxRef.current.get(purpose);
          if (idx == null || !prev[idx]) return prev;
          const next = prev.slice();
          next[idx] = {
            ...next[idx],
            body: (next[idx].body || "") +
              `<div style="color:var(--label);font-size:9.5px;letter-spacing:.08em;padding-left:14px">→ ${escapeHtml(toolName)}</div>`,
          };
          return next;
        });
      } else if (ev.type === "activity_end") {
        const idx = activityIdxRef.current.get(purpose);
        activityIdxRef.current.delete(purpose);
        if (idx == null) return;
        setMessages((prev) => {
          if (!prev[idx]) return prev;
          const next = prev.slice();
          next[idx] = {
            ...next[idx],
            body: (next[idx].body || "") +
              `<div style="color:var(--green);font-size:9.5px;letter-spacing:.08em;padding-left:14px">✓ done</div>`,
          };
          return next;
        });
      } else if (ev.type === "error") {
        const idx = activityIdxRef.current.get(purpose);
        if (idx == null) return;
        setMessages((prev) => {
          if (!prev[idx]) return prev;
          const next = prev.slice();
          next[idx] = {
            ...next[idx],
            body: (next[idx].body || "") +
              `<div style="color:var(--red);font-size:9.5px;letter-spacing:.08em;padding-left:14px">✗ ${escapeHtml(ev.message || "error")}</div>`,
          };
          return next;
        });
      }
    });

    return () => {
      offChunk?.();
      offTurnComplete?.();
      offQueued?.();
      offQueueReady?.();
      offError?.();
      offActivity?.();
    };
  }, [provider]);

  // Typing watchdog. If turn_complete is missed (IPC blip, app:error
  // before chunks start, etc), `typing` would stay true forever and the
  // dots animate indefinitely. Clear after 6 min — longer than the
  // brief timeout (300s) so legitimate slow turns aren't cut off.
  const TYPING_WATCHDOG_MS = 6 * 60 * 1000;
  const typingTimerRef = useRef(null);
  function armTypingWatchdog() {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn("[useChat] typing watchdog fired — clearing stuck typing state");
      setTyping(false);
      streamingIdxRef.current = null;
    }, TYPING_WATCHDOG_MS);
  }
  function clearTypingWatchdog() {
    if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
  }

  async function send(text) {
    dlog("[useChat] send", JSON.stringify(text).slice(0, 80));
    setMessages((prev) => {
      const next = trimHistory(prev.slice());
      next.push({ type: "user", t: nowStamp(), body: escapeHtml(text) });
      next.push({ type: "reply", t: nowStamp(), body: "" });
      streamingIdxRef.current = next.length - 1;
      return next;
    });
    setTyping(true);
    armTypingWatchdog();
    try {
      const res = await window.api.chat.send(text, { provider });
      dlog("[useChat] send returned", res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[useChat] send threw", err);
      setTyping(false);
      streamingIdxRef.current = null;
      clearTypingWatchdog();
    }
  }

  // Kill-switch: ask main to abort the currently in-flight Claude turn.
  // Mutex releases; next queued turn proceeds normally. Useful when
  // Claude is in a loop or analyzing something obviously wrong.
  async function cancel() {
    try {
      await window.api?.chat?.cancel?.();
    } catch { /* best-effort */ }
    streamingIdxRef.current = null;
    setTyping(false);
    setQueuedBehind(null);
    clearTypingWatchdog();
  }

  // Reset chat conversation: clears the renderer history AND tells main
  // to forget the 'chat' purpose session id. Next user message starts a
  // fresh conversation. Brief / wrap / bar-close sessions are untouched.
  //
  // #68 No longer touches activeSetup — separate concern owned by
  // useActiveSetup. If the caller wants to clear both, they can call
  // reset() + clearSetup() from useActiveSetup independently.
  async function reset() {
    try {
      await window.api?.chat?.reset?.({ provider });
    } catch { /* best-effort */ }
    setMessages([]);
    streamingIdxRef.current = null;
    setTyping(false);
    clearTypingWatchdog();
  }

  return { messages, typing, send, cancel, reset, queuedBehind, workingPurposes };
}
