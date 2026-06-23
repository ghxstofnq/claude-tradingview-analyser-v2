// CHAT workstation — v2 designer port (unified 4-channel popover).
// Faithful to ~/Downloads/Dashboard Location (4)/assets/chat.jsx. Collapses
// the old per-provider CLAUDE/CODEX chips into one CHAT cell with channel
// tabs: CLAUDE + CODEX (interactive) and BRAIN + WALKERS (read-only feeds of
// what the backend is thinking). A peek strip surfaces the latest backend
// thought from the channel you're not looking at.

import React, { useState, useEffect, useRef } from "react";
import { clickable } from "./a11y.js";
import { useFloat } from "./hooks/useFloat.js";
import { buildProviderSubmitOptions } from "./provider-popover-contract.js";
import { useWalkers } from "./hooks/useWalkers.js";
import { useDeterministicBrain } from "./hooks/useDeterministicBrain.js";
import { walkerTruthToProse } from "./Brain.helpers.js";

const CHANNELS = [
  { k: "claude", l: "CLAUDE" },
  { k: "codex", l: "CODEX" },
  { k: "brain", l: "BRAIN" },
  { k: "walkers", l: "WALKERS" },
];

// Interactive channel (CLAUDE / CODEX) — wired to a real useChat() provider.
function ChatChannel({ chat, provider, label }) {
  const feedRef = useRef(null);
  const [input, setInput] = useState("");
  const messages = chat?.messages || [];
  useEffect(() => { const el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, chat?.typing]);
  const head = (m) => {
    const who = m.type === "bar-read" ? `BAR-CLOSE · ${label}`
              : m.type === "activity" ? `${label} · ACTIVITY`
              : m.type === "reply" ? label : "YOU";
    return m.t ? `${who} · ${m.t}` : who;
  };
  const submit = () => {
    if (!input.trim()) return;
    chat?.send?.(input.trim(), buildProviderSubmitOptions(provider));
    setInput("");
  };
  return (
    <div className="claude">
      <div className="claude-feed" ref={feedRef} data-empty-label={`no messages yet — ask ${label.toLowerCase()} below`}>
        {messages.map((m, i) => (
          <div key={i} className={"claude-msg " + m.type}>
            <div className="head"><span className="who">{head(m)}</span></div>
            <div className="body" dangerouslySetInnerHTML={{ __html: m.body }} />
          </div>
        ))}
        {chat?.typing && (
          <div className="claude-msg reply">
            <div className="head"><span className="who">{label} · now</span></div>
            <div className="body"><span className="typing"><i></i><i></i><i></i></span></div>
          </div>
        )}
      </div>
      <form className="claude-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <span className="prompt">&gt;</span>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={`ask ${label.toLowerCase()}…`} />
        <span className="claude-controls">
          {chat?.typing && <span className="ctl red" onClick={(e) => { e.preventDefault(); chat?.cancel?.(); }}>[ STOP ]</span>}
          <span className="ctl" onClick={(e) => { e.preventDefault(); chat?.reset?.(); }}>[ RESET ]</span>
        </span>
      </form>
    </div>
  );
}

// BRAIN — read-only bar-by-bar reasoning, sourced DIRECTLY from the
// deterministic chain's per-bar verdict (no Claude in the loop), newest first.
// Each entry is the engine's own verdict rendered as plain English.
function BrainChannel({ entries }) {
  const items = (entries || []).slice().reverse();
  return (
    <div className="claude">
      <div className="ro-banner"><span className="pulse" />BRAIN · deterministic chain · read-only</div>
      <div className="claude-feed" data-empty-label="no bar verdicts yet this session">
        {items.map((e, i) => (
          <div key={e.ts != null ? `${e.ts}-${i}` : i} className="ro-msg brain">
            <div className="h">BRAIN{e.t ? ` · ${e.t} ET` : ""}</div>
            <div className="b">{walkerTruthToProse(e.truth)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WalkersChannel({ walkers }) {
  const list = walkers || [];
  return (
    <div className="claude">
      <div className="ro-banner"><span className="pulse" />WALKER ENGINE · {list.length} active · read-only</div>
      <div className="claude-feed" data-empty-label="no active walkers">
        {list.map((w) => {
          const ageM = w.last_advanced_at ? Math.round((Date.now() - w.last_advanced_at) / 60000) : null;
          return (
            <div key={w.id} className="ro-msg walker">
              <div className="h">{w.panel_id} · {w.model} · {w.variant} · {(w.size_multiplier ?? 1).toFixed(1)}× SIZE</div>
              <div className="b">
                ▸ {w.stage}{ageM != null ? ` (${ageM}m)` : ""}
                {w.displacement_fvg && (
                  <div className="sub">watching FVG {w.displacement_fvg.low}–{w.displacement_fvg.high}
                    {w.hypothetical_r_to_stop != null ? ` · R-to-stop ${w.hypothetical_r_to_stop}` : ""}
                    {w.hypothetical_r_to_tp1 != null ? ` · R-to-TP1 ${w.hypothetical_r_to_tp1}` : ""}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Peek strip — latest backend thought from the channel you're NOT viewing.
function ChatPeek({ ch, setCh, brainEntries, walkers }) {
  const target = ch === "brain" ? "walkers" : "brain";
  if (target === "brain") {
    const b = (brainEntries || [])[brainEntries.length - 1];
    if (!b) return null;
    return (
      <div className="chat-peek" onClick={() => setCh("brain")}>
        <span className="pk-h"><i className="d blue" />BRAIN{b.t ? ` · ${b.t}` : ""}</span>
        <span className="pk-b">{walkerTruthToProse(b.truth)}</span>
        <span className="pk-go">▸ OPEN</span>
      </div>
    );
  }
  const w = (walkers || [])[0];
  if (!w) return null;
  return (
    <div className="chat-peek" onClick={() => setCh("walkers")}>
      <span className="pk-h"><i className="d green" />WALKER · {w.panel_id}</span>
      <span className="pk-b">▸ {w.stage}</span>
      <span className="pk-go">▸ OPEN</span>
    </div>
  );
}

export function ChatCell({ chats }) {
  const [open, setOpen] = useState(false);
  const float = useFloat();
  const [ch, setCh] = useState("claude");
  const walkers = useWalkers();
  const brainEntries = useDeterministicBrain();
  const claude = chats?.claude;
  const codex = chats?.codex;
  const live = !!(claude?.typing || codex?.typing);

  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.which === "chat") setOpen((o) => !o);
      if (e.detail?.which === "all-close") setOpen(false);
    };
    window.addEventListener("topbar:open-cell", onOpen);
    return () => window.removeEventListener("topbar:open-cell", onOpen);
  }, []);

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")}
         {...clickable((e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); })}>
      <span className="k">CHAT</span>
      <span className={"claude-dot" + (live ? " active" : "")} />
      {open && (
        <div className={"bt-popover w-660 chat-pop" + float.popoverClass} style={float.popoverStyle} onClick={(e) => e.stopPropagation()}>
          <div className="head" onMouseDown={float.onDragStart}>
            <span className="t">CHAT</span>
            <span className="spacer" style={{ flex: 1 }} />
            <div className="live-tabs">
              {CHANNELS.map((c) => (
                <span key={c.k} className={"tab" + (ch === c.k ? " on" : "")} onClick={() => setCh(c.k)}>{c.l}</span>
              ))}
            </div>
            <span className={"float-btn" + (float.floating ? " on" : "")}
                  title={float.floating ? "Dock window" : "Float — move & resize freely"}
                  onClick={float.toggle}>⛶</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body chat-body">
            <ChatPeek ch={ch} setCh={setCh} brainEntries={brainEntries} walkers={walkers} />
            {ch === "claude" && <ChatChannel chat={claude} provider="claude" label="CLAUDE" />}
            {ch === "codex" && <ChatChannel chat={codex} provider="codex" label="CODEX" />}
            {ch === "brain" && <BrainChannel entries={brainEntries} />}
            {ch === "walkers" && <WalkersChannel walkers={walkers} />}
          </div>
        </div>
      )}
    </div>
  );
}
