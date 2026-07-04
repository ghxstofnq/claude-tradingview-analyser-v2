// AgentPage — ⌘5 / ⌘J. Centered floating page (620px, content-height) rendered
// through the shared <Page> frame — same geometry + open animation as Live. The
// channel state and header controls (provider pills, RESET/STOP) live here in the
// Page header slots; AgentBody renders only the chat feed + compose. All chat
// logic stays in useChat / useWalkers / useDeterministicBrain.

import React, { useState } from "react";
import { Page } from "./Page.jsx";
import { AgentBody, CHANNELS } from "../../ChatPopover.jsx";

export function AgentPage({ chats, onClose }) {
  const [ch, setCh] = useState("claude");
  const claude = chats?.claude;
  const codex = chats?.codex;
  const interactive = ch === "claude" || ch === "codex";
  const active = ch === "claude" ? claude : ch === "codex" ? codex : null;
  const streaming = !!(claude?.typing || codex?.typing);
  const footLeft = interactive ? `CHAT · ${ch.toUpperCase()}` : `FEED · ${ch.toUpperCase()} · READ-ONLY`;

  const tabs = (
    <div className="cs-prov-group">
      {CHANNELS.map((c) => (
        <span key={c.k} className={"cs-provpill" + (ch === c.k ? " is-on" : "")} onClick={() => setCh(c.k)}>{c.l}</span>
      ))}
    </div>
  );

  const right = (
    <>
      <span className={"cs-btn-tiny" + (interactive ? "" : " disabled")}
            onClick={interactive ? () => active?.reset?.() : undefined}>RESET</span>
      <span className={"cs-btn-tiny" + (active?.typing ? " danger-live" : " idle")}
            onClick={active?.typing ? () => active?.cancel?.() : undefined}>STOP</span>
    </>
  );

  const foot = (
    <>
      <span>{footLeft}</span>
      <span className="sp" style={{ flex: 1 }} />
      <span>⌘J / ⌘5 toggles · esc</span>
    </>
  );

  return (
    <Page narrow className="cs-agent" tint="green"
          icon={<span className={"cs-agent-dot " + (streaming ? "is-streaming" : "is-active")} />}
          title="Agent" page="agent" tabs={tabs} right={right} foot={foot} onClose={onClose}>
      <AgentBody ch={ch} chats={chats} />
    </Page>
  );
}
