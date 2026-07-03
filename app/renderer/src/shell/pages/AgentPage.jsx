// AgentPage — ⌘5 / ⌘J. Hosts the unified CLAUDE / CODEX / BRAIN / WALKERS chat.

import React from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { ChatBody } from "../../ChatPopover.jsx";

export function AgentPage({ chats, onClose }) {
  return (
    <Page icon={PAGE_ICONS.agent} tint="blue" title="Agent" hosted onClose={onClose}
          foot={<><span>⌘J / ⌘5 toggles · esc</span></>}>
      <ChatBody chats={chats} />
    </Page>
  );
}
