// AgentPage — ⌘5 / ⌘J. Chat-only right-side sidecar (the one page that escapes
// the centered frame + scrim): it pins flush to the right rail beside the chart,
// which shrinks to make room. All chat logic lives in AgentBody + useChat.

import React from "react";
import { AgentBody } from "../../ChatPopover.jsx";

export function AgentPage({ chats, onClose }) {
  return (
    <div className="shell-sidecar" onClick={(e) => e.stopPropagation()}>
      <AgentBody chats={chats} onClose={onClose} />
    </div>
  );
}
