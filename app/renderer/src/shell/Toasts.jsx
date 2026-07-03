// Toasts — bottom-right transient notices + the coach hint chip.
// Toast tint is a token name (green/amber/red/blue/mute) → .tint-* class.

import React from "react";
import { clickable } from "../a11y.js";

// tint token → status hue applied INLINE on the dot (status-only, never chrome).
const TOAST_HUE = {
  green: "var(--green)", amber: "var(--amber)", red: "var(--red)",
  blue: "var(--blue)", mute: "var(--label)",
};

export function Toasts({ toasts, onDismiss }) {
  if (!toasts?.length) return null;
  return (
    <div className="cs-toasts">
      {toasts.map((t) => (
        <div key={t.id} className="cs-toast"
             {...clickable(() => onDismiss(t.id))}>
          <span className="cs-toast-dot" style={{ background: TOAST_HUE[t.tint] || TOAST_HUE.green }} />
          <span className="cs-toast-msg">{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

export function CoachChip({ onClose }) {
  const cap = (t) => <span className="cmd-kbd">{t}</span>;
  return (
    <div className="cmd-coach">
      <span>{cap("⌘K")} command</span>
      <span>{cap("⌘1–7")} pages</span>
      <span>{cap("⇧⌘F")} flatten</span>
      <span>{cap("esc")} back</span>
      <span className="x" {...clickable(onClose, { label: "dismiss hint" })}>×</span>
    </div>
  );
}
