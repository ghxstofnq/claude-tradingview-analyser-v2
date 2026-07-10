// Palette — the ⌘K overlay. Owns the query input; the detected intent (pure
// detectIntent) selects which view renders. Selection/keyboard nav is driven by
// CommandShell (which holds `sel`) so the global keydown handler stays the one
// source of truth.

import React, { useRef, useEffect } from "react";
import { clickable } from "../a11y.js";
import { detectIntent } from "./paletteIntent.helpers.js";
import { parseTicket } from "./parseTicket.helpers.js";
import { visibleRows } from "./commandList.helpers.js";
import { PaletteList } from "./palette/PaletteList.jsx";
import { AskView } from "./palette/AskView.jsx";
import { TicketView } from "./palette/TicketView.jsx";
import { BrowseAlertsView } from "./palette/BrowseAlertsView.jsx";
import { NewsView } from "./palette/NewsView.jsx";
import { OrdersView } from "./palette/OrdersView.jsx";

export function Palette({
  query, onQuery, sel, onHover, forcedView, askQuery, packetSeed,
  commands, symbol, chat, alerts, events, workingOrders,
  onRunCommand, onDisarm, onCancelAll, onToast, onClose,
}) {
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // forcedView is set only on commit (Tab / Enter → ask). While typing a
  // question the list stays up with the "⏎ asks Claude" hint — no per-keystroke
  // sends — so `ask` renders exclusively when forced.
  const detected = detectIntent(query);
  const intent = forcedView || (detected === "ask" ? "filter" : detected);
  const rows = intent === "root" || intent === "filter" ? visibleRows(commands, query) : [];
  const noResults = intent === "filter" && rows.length === 0;

  const showInput = intent !== "ask" && intent !== "browse";

  return (
    <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
      {showInput && (
        <div className="cmd-pal-input">
          <span className="glass">⌕</span>
          <input ref={inputRef} type="text" value={query} data-cmd-pal-input="1"
                 onChange={(e) => onQuery(e.target.value)} autoFocus
                 placeholder="Type a command, a price, or a question…" />
          <span className="cmd-kbd" {...clickable(onClose)}>esc</span>
        </div>
      )}

      {intent === "ask" && <AskView chat={chat} query={askQuery || query.trim()} onClose={onClose} onToast={onToast} />}
      {intent === "ticket" && (
        <TicketView seed={parseTicket(query, { defaultSymbol: symbol })} packetSeed={packetSeed} onToast={onToast} onClose={onClose} />
      )}
      {intent === "browse" && (
        <BrowseAlertsView armed={alerts.armed} fired={alerts.fired} onDisarm={onDisarm} />
      )}
      {intent === "news" && <NewsView events={events} />}
      {intent === "orders" && <OrdersView symbol={symbol} orders={workingOrders} onCancelAll={onCancelAll} />}
      {(intent === "root" || intent === "filter") && (
        <PaletteList rows={rows} sel={sel} sectionLabel={query.trim() ? "MATCHES" : "SUGGESTED"}
                     onHover={onHover} onRun={onRunCommand} noResults={noResults} />
      )}

      {/* Prototype footer: the left grammar trio + the right hint (both kept). */}
      <div className="cmd-pal-foot">
        <span>navigate <span className="cs-kbd-hint">↑↓</span></span>
        <span>run <span className="cs-kbd-hint">⏎</span></span>
        <span>ask <span className="cs-kbd-hint">tab</span></span>
        <span className="sp" />
        <span>{intent === "filter" && noResults ? "⏎ asks Claude" : "verb runs · ? asks · noun browses"}</span>
      </div>
    </div>
  );
}
