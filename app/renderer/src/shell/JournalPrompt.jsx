// JournalPrompt — the dismissible post-close note card (plan 2026-07-09
// Task 5, user decision: keep the "weakest pillar?" prompt, dismissible).
// Raised by main's journal:close event after every recorded round-trip; SAVE
// (or Enter in the field) patches the journal row, × dismisses losing nothing
// — the trade row itself is already on disk either way.
import React, { useState } from "react";
import { clickable } from "../a11y.js";

const fmtR = (r) => (r == null ? null : `${r > 0 ? "+" : ""}${r}R`);

export function JournalPrompt({ row, onDone }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!row) return null;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (note.trim() !== "") {
        await window.api?.journal?.note?.({ date: row.date, id: row.id, note: note.trim() });
      }
      onDone?.(note.trim() !== "");
    } finally { setBusy(false); }
  };

  const r = fmtR(row.r);
  return (
    <div className="jr-prompt">
      <div className="jr-head">
        <span className="jr-title">TRADE CLOSED</span>
        <span className={"cs-dir " + (row.side === "buy" ? "long" : "short")}>{row.side === "buy" ? "long" : "short"}</span>
        <span className="jr-sym">{row.qty ?? ""} {String(row.symbol ?? "").replace(/1!$/, "")}</span>
        {r && <span className={"jr-r " + (row.r > 0 ? "up" : row.r < 0 ? "down" : "")}>{r}</span>}
        <span className="sp" />
        <span className="jr-x" {...clickable(() => onDone?.(false), { label: "dismiss journal note" })}>×</span>
      </div>
      <div className="jr-body">
        <input className="jr-in" placeholder="weakest pillar? (optional — journaled either way)"
               value={note} autoFocus
               onChange={(e) => setNote(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); save(); } if (e.key === "Escape") { e.stopPropagation(); onDone?.(false); } }} />
        <span className="jr-save" {...clickable(save, { label: "save journal note" })}>{busy ? "…" : "SAVE"}</span>
      </div>
    </div>
  );
}
