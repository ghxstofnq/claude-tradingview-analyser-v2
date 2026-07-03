// AskView — one-shot "ask Claude" from the palette. Sends the query once on
// open, streams the reply. Body is Claude's own escaped HTML (same trust model
// as ClaudeFeed), rendered via dangerouslySetInnerHTML.

import React, { useEffect, useRef } from "react";
import { clickable } from "../../a11y.js";

export function AskView({ chat, query, onClose }) {
  const sentFor = useRef(null);

  useEffect(() => {
    if (query && sentFor.current !== query) {
      sentFor.current = query;
      chat.send(query);
    }
  }, [query, chat]);

  // Latest reply message from this claude conversation.
  const reply = [...(chat.messages || [])].reverse().find((m) => m.type === "reply");
  const streaming = chat.typing;

  return (
    <>
      <div className="cmd-pal-input">
        <span className="cmd-pal-head-badge">ASK</span>
        <span style={{ fontSize: 14, color: "var(--value-strong)", flex: 1 }}>{query}</span>
        <span className="cmd-kbd" {...clickable(onClose)}>esc</span>
      </div>
      <div className="cmd-ask">
        <p className="prose">
          {reply ? <span dangerouslySetInnerHTML={{ __html: reply.body }} />
                 : (streaming ? "" : "…")}
          {streaming && <span className="caret" />}
        </p>
      </div>
      <div className="cmd-pal-foot">
        <span>Claude · {streaming ? "thinking…" : "answered"}</span>
        <span className="sp" />
        <span>press <span className="cmd-kbd">esc</span> to close</span>
      </div>
    </>
  );
}
