// Toasts — bottom-right transient notices + the coach hint chip.
// Toast tint is a token name (green/amber/red/blue/mute) → .tint-* class.

import React from "react";
import { clickable } from "../a11y.js";

export function Toasts({ toasts, onDismiss }) {
  if (!toasts?.length) return null;
  return (
    <div className="cmd-toasts">
      {toasts.map((t) => (
        <div key={t.id} className={"cmd-toast tint-" + (t.tint || "green")}
             {...clickable(() => onDismiss(t.id))}>
          <span className="d" />
          <span className="m">{t.msg}</span>
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
