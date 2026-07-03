// FlattenConfirm — ⇧⌘F overlay. Hold Enter (or press-and-hold the bar) for
// 400ms to fire execution.flatten; releasing cancels. Read-only when flat.

import React, { useEffect, useRef, useState } from "react";
import { clickable } from "../a11y.js";

const HOLD_MS = 400;

export function FlattenConfirm({ hasPosition, detail, holdActive, onClose, onFlatten }) {
  const [pct, setPct] = useState(0);
  const raf = useRef(null);
  const t0 = useRef(null);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null; t0.current = null;
    setPct(0);
  };

  const start = () => {
    if (!hasPosition || t0.current != null) return;
    t0.current = performance.now();
    const tick = (now) => {
      const p = Math.min(100, ((now - t0.current) / HOLD_MS) * 100);
      setPct(p);
      if (p >= 100) { stop(); onFlatten(); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  // Enter-hold from the global keyboard handler drives holdActive.
  useEffect(() => {
    if (holdActive) start(); else stop();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdActive]);

  return (
    <div className="cmd-flatten" onClick={(e) => e.stopPropagation()}>
      <div className="inner">
        {hasPosition ? (
          <>
            <div className="hd">
              <span className="icon">◱</span>
              <div>
                <div className="t">Flatten all positions</div>
                <div className="d">{detail || "Sends a market close for the open position."}</div>
              </div>
            </div>
            <div className="cmd-hold" onMouseDown={start} onMouseUp={stop} onMouseLeave={stop}>
              <span style={{ transform: `scaleX(${pct / 100})`,
                             transition: pct === 0 ? "transform .12s" : "none" }} />
            </div>
            <div className="foot">
              <span>hold <span className="cmd-kbd">⏎</span> to confirm · release cancels</span>
              <span className="esc" {...clickable(onClose)}>esc · cancel</span>
            </div>
          </>
        ) : (
          <div className="hd">
            <span className="icon flat">◱</span>
            <div>
              <div className="t">You're flat</div>
              <div className="d">No open position, nothing to flatten · esc to close</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
