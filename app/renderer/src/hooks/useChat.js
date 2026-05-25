// useChat — streamed Claude conversation state.
//
// Produces messages in the shape ClaudeFeed expects:
//   [{ type: "user" | "reply" | "bar-read", t: "HH:MM", body: "<html>" }]
//
// `body` is HTML; user-typed text is escaped before being inserted.

import { useEffect, useRef, useState } from "react";

// Cap chat history to avoid unbounded memory growth. Each brief generates
// 200+ chunk events; an 8h trading session can produce hundreds of
// thousands of accumulated entries. Drop the oldest when exceeding MAX,
// keep KEEP so a streaming reply isn't truncated mid-flight.
const CHAT_HISTORY_MAX = 500;
const CHAT_HISTORY_KEEP = 400;

function trimHistory(arr) {
  if (arr.length <= CHAT_HISTORY_MAX) return arr;
  // Keep the last CHAT_HISTORY_KEEP entries. Dropping ~100 at a time
  // means the trim only fires every ~100 new messages, not on every push.
  return arr.slice(-CHAT_HISTORY_KEEP);
}

function nowStamp() {
  const d = new Date();
  return [d.getHours(), d.getMinutes()]
    .map((x) => String(x).padStart(2, "0")).join(":");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function useChat() {
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [activeSetup, setActiveSetup] = useState(null);
  const [noTradeReason, setNoTradeReason] = useState(null);
  const streamingIdxRef = useRef(null);   // index of the in-flight reply message

  useEffect(() => {
    if (!window.api?.chat) {
      // eslint-disable-next-line no-console
      console.error("[useChat] window.api.chat is undefined — preload script failed to load");
      return;
    }
    // eslint-disable-next-line no-console
    console.log("[useChat] subscribing to chat events");

    const offChunk = window.api.chat.onChunk((ev) => {
      // eslint-disable-next-line no-console
      console.log("[useChat] chunk", JSON.stringify(ev?.text || "").slice(0, 80));
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

    const offToolCall = window.api.chat.onToolCall?.((ev) => {
      // eslint-disable-next-line no-console
      console.log("[useChat] tool_call", ev?.name, ev?.payload);
      if (ev?.name === "surface_setup" && ev.payload) {
        setActiveSetup(ev.payload);
        setNoTradeReason(null);
      } else if (ev?.name === "surface_no_trade" && ev.payload) {
        setActiveSetup(null);
        setNoTradeReason(ev.payload.reason || "no-trade");
      }
    });

    const offTurnComplete = window.api.chat.onTurnComplete(() => {
      // eslint-disable-next-line no-console
      console.log("[useChat] turn_complete");
      streamingIdxRef.current = null;
      setTyping(false);
    });

    const offError = window.api.error?.onError?.((ev) => {
      // eslint-disable-next-line no-console
      console.error("[useChat] app:error", ev);
      setMessages((prev) => trimHistory([
        ...prev,
        { type: "reply", t: nowStamp(), body: `<span style="color:#f0796a">error: ${escapeHtml(ev.message || "unknown")}</span>` },
      ]));
      streamingIdxRef.current = null;
      setTyping(false);
    });

    return () => {
      offChunk?.();
      offToolCall?.();
      offTurnComplete?.();
      offError?.();
    };
  }, []);

  async function send(text) {
    // eslint-disable-next-line no-console
    console.log("[useChat] send", JSON.stringify(text).slice(0, 80));
    setMessages((prev) => {
      const next = trimHistory(prev.slice());
      next.push({ type: "user", t: nowStamp(), body: escapeHtml(text) });
      next.push({ type: "reply", t: nowStamp(), body: "" });
      streamingIdxRef.current = next.length - 1;
      return next;
    });
    setTyping(true);
    try {
      const res = await window.api.chat.send(text);
      // eslint-disable-next-line no-console
      console.log("[useChat] send returned", res);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[useChat] send threw", err);
      setTyping(false);
      streamingIdxRef.current = null;
    }
  }

  function clearSetup() {
    setActiveSetup(null);
    setNoTradeReason(null);
  }

  // Kill-switch: ask main to abort the currently in-flight Claude turn.
  // Mutex releases; next queued turn proceeds normally. Useful when
  // Claude is in a loop or analyzing something obviously wrong.
  async function cancel() {
    try {
      await window.api?.chat?.cancel?.();
    } catch { /* best-effort */ }
  }

  // Reset chat conversation: clears the renderer history AND tells main
  // to forget the 'chat' purpose session id. Next user message starts a
  // fresh conversation. Brief / wrap / bar-close sessions are untouched.
  async function reset() {
    try {
      await window.api?.chat?.reset?.();
    } catch { /* best-effort */ }
    setMessages([]);
    streamingIdxRef.current = null;
    setTyping(false);
  }

  return { messages, typing, send, cancel, reset, activeSetup, noTradeReason, clearSetup };
}
