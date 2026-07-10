// App.jsx — thin host for the Command Shell (2026-07-03 redesign). Owns the
// cross-cutting state the shell reads (symbol, guards, theme, the two chat
// providers, current price) and the evidence drill-down context; the shell
// itself renders the topbar, the single-mount TradingView chart, the ambient
// strip, the ⌘K palette, and the floating pages.

import React, { useState, useEffect } from "react";
import { EvidenceContext, EvidenceSidePanel } from "./Shared.jsx";
import { CommandShell } from "./shell/CommandShell.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { loadGuards, saveGuards } from "./Account.helpers.js";
import { useChat } from "./hooks/useChat.js";
import { useSymbolCache } from "./hooks/useSymbolCache.js";

function App() {
  const [symbol, setSymbol] = useState("MNQ1!");

  // Guardrails persist; the account orders route to is owned by main (the
  // confirmed broker account) and surfaced read-only via useBrokerAccount.
  const [guards, setGuards] = useState(() => loadGuards());
  useEffect(() => { saveGuards(guards); }, [guards]);

  // Theme — hydrate localStorage, apply <html data-theme="…">. The shell
  // exposes the toggle as a palette command (the old topbar button is gone).
  const [theme, setTheme] = useState(() => {
    try { const v = localStorage.getItem("workstation:theme"); return v === "light" || v === "dark" ? v : "dark"; }
    catch (e) { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("workstation:theme", theme); } catch (e) {}
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  // Evidence drill-down — pages open evidence via EvidenceContext; the side
  // panel sits above every shell overlay.
  const [evidence, setEvidence] = useState(null);
  const openEvidence = (refData, label) => setEvidence({ refData, label });
  const closeEvidence = () => setEvidence(null);

  // LLM providers — Claude and Codex keep separate conversations.
  const claudeChat = useChat({ provider: "claude" });
  const codexChat = useChat({ provider: "codex" });
  const chats = { claude: claudeChat, codex: codexChat };

  // Symbol cache → current price for the active symbol (PREP levels grouping).
  const symbolCache = useSymbolCache(false);
  const currentPrice = symbolCache?.[symbol]?.px ?? null;

  return (
    <EvidenceContext.Provider value={openEvidence}>
      {/* Outermost safety net (Task C5): the shell is a money-path surface, so
          if it throws below every inner boundary the fallback still offers a
          broker-confirmed FLATTEN + OPEN SYSTEM rather than a blank screen. */}
      <ErrorBoundary label="APP SHELL" variant="emergency"
                     onFlatten={() => window.api?.execution?.flatten?.({ symbol })}>
        <CommandShell
          symbol={symbol} setSymbol={setSymbol}
          guards={guards} setGuards={setGuards}
          chats={chats} currentPrice={currentPrice}
          onToggleTheme={toggleTheme} />
      </ErrorBoundary>
      <ErrorBoundary label="EVIDENCE PANEL">
        <EvidenceSidePanel
          open={!!evidence}
          refData={evidence?.refData}
          label={evidence?.label}
          onClose={closeEvidence} />
      </ErrorBoundary>
    </EvidenceContext.Provider>
  );
}

export { App };
