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
    <div className="cs-flatten" onClick={(e) => e.stopPropagation()}>
      <div className="cs-flatten-inner">
        {hasPosition ? (
          <>
            <div className="cs-flatten-hd">
              <span className="cs-flatten-ic">◱</span>
              <div>
                <div className="cs-flatten-title">Flatten all positions</div>
                <div className="cs-flatten-detail">{detail || "Sends a market close for the open position."}</div>
              </div>
            </div>
            <div className="cs-flatten-track" onMouseDown={start} onMouseUp={stop} onMouseLeave={stop}>
              <span className="cs-flatten-fill"
                    style={{ width: pct + "%",
                             transition: pct === 0 ? "width .12s" : "none" }} />
            </div>
            <div className="cs-flatten-foot">
              <span>hold <span className="cs-kbd-mini">⏎</span> to confirm · release cancels</span>
              <span className="cs-flatten-esc" {...clickable(onClose)}>esc · cancel</span>
            </div>
          </>
        ) : (
          <div className="cs-flatten-hd">
            <span className="cs-flatten-ic flat">◱</span>
            <div>
              <div className="cs-flatten-title">You're flat</div>
              <div className="cs-flatten-detail">No open position, nothing to flatten · esc to close</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
