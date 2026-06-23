// useFloat — detach a .bt-popover into a free-floating window: a toggle button,
// drag-to-move by its header, and native CSS resize (the `.floating` class adds
// `resize: both`). Reusable across popovers; PREP wires it first.
//
// Returns props to spread onto the popover + its head:
//   popoverClass  → append to the .bt-popover className (" floating" | "")
//   popoverStyle  → inline {left,top} while floating (undefined when docked)
//   onDragStart   → put on the .head's onMouseDown (no-op when docked / on buttons)
//   floating, toggle

import { useCallback, useEffect, useRef, useState } from "react";

const W = 660; // matches .w-660 — used only to seed a sensible first position

export function useFloat() {
  const [floating, setFloating] = useState(false);
  const [pos, setPos] = useState(null); // {x,y} once placed
  const drag = useRef(null);

  const toggle = useCallback(() => {
    setFloating((f) => {
      const next = !f;
      if (next && !pos) {
        // Seed a sensible spot the first time: a touch left of centre, below chrome.
        const x = Math.max(16, Math.round(window.innerWidth / 2 - W / 2));
        setPos({ x, y: 72 });
      }
      return next;
    });
  }, [pos]);

  const onDragStart = useCallback((e) => {
    if (!floating) return;
    if (e.button !== 0) return;                 // left-button only
    // Drag from the title/empty header area only — never hijack a head control
    // (close, float, tabs, detector, back, pills, inputs).
    if (e.target.closest(
      "button, input, select, textarea, a, [role='button'], " +
      ".x, .float-btn, .tab, .live-tabs, .pill, .seg, .back, .det, .stop, .meta-pill"
    )) return;
    const base = pos || { x: 0, y: 0 };
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y };
    e.preventDefault();
  }, [floating, pos]);

  useEffect(() => {
    if (!floating) return;
    const clamp = (x, y) => ({
      // keep the header grabbable: never let it leave the viewport entirely
      x: Math.min(Math.max(x, 80 - W), window.innerWidth - 80),
      y: Math.min(Math.max(y, 4), window.innerHeight - 40),
    });
    const onMove = (e) => {
      const d = drag.current;
      if (!d) return;
      setPos(clamp(d.baseX + (e.clientX - d.startX), d.baseY + (e.clientY - d.startY)));
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [floating]);

  // The chart is an Electron <webview>, which swallows mousemove the instant the
  // cursor crosses it — so a header-drag (window mousemove) AND the native resize
  // grip both stall mid-gesture. While a drag/resize gesture is active on a
  // floating popover, make the webview pointer-events:none so the mouse passes
  // through to the document; restore on mouseup. Capture phase so it arms before
  // the gesture (incl. the native resize grip, which fires no JS event of its own).
  useEffect(() => {
    if (!floating) return;
    const wv = document.querySelector("webview");
    if (!wv) return;
    let armed = false;
    const arm = (e) => {
      if (e.target.closest && e.target.closest(".bt-popover.floating")) {
        armed = true;
        wv.style.pointerEvents = "none";
      }
    };
    const disarm = () => { if (armed) { armed = false; wv.style.pointerEvents = ""; } };
    window.addEventListener("mousedown", arm, true);
    window.addEventListener("mouseup", disarm, true);
    return () => {
      window.removeEventListener("mousedown", arm, true);
      window.removeEventListener("mouseup", disarm, true);
      wv.style.pointerEvents = "";
    };
  }, [floating]);

  return {
    floating,
    toggle,
    onDragStart,
    popoverClass: floating ? " floating" : "",
    popoverStyle: floating && pos ? { left: pos.x, top: pos.y } : undefined,
  };
}
