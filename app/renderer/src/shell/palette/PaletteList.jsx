// PaletteList — the root/filtered command rows. Rows come from
// commandList.helpers (pure); this only renders + reports selection/run.

import React from "react";
import { clickable } from "../../a11y.js";

export function PaletteList({ rows, sel, sectionLabel, onHover, onRun, noResults }) {
  if (noResults) {
    return (
      <div className="cmd-pal-body">
        <div className="cmd-pal-empty">No match — <b>⏎ asks Claude instead</b></div>
      </div>
    );
  }
  return (
    <div className="cmd-pal-body">
      {sectionLabel && <div className="cmd-pal-sect">{sectionLabel}</div>}
      {rows.map((r, i) => (
        <div key={r.id} className={"cmd-row" + (i === sel ? " sel" : "")}
             onMouseEnter={() => onHover(i)} {...clickable(() => onRun(r))}>
          <span className={"cmd-row-icon tint-" + (r.tint || "mute")}>{r.icon}</span>
          <span className="cmd-row-label">{r.label}</span>
          {r.detail && <span className="cmd-row-detail">{r.detail}</span>}
          {r.kbd && <span className="cmd-row-kbd">{r.kbd}</span>}
        </div>
      ))}
    </div>
  );
}
