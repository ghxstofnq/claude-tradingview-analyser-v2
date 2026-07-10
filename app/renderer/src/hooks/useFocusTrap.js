// useFocusTrap — trap Tab focus inside an overlay and restore focus to the
// opener when it closes (Task D2). Used by the floating <Page> and the ⌘K
// <Palette> so keyboard users can't Tab out into the chart behind the scrim,
// and so closing a surface returns focus to wherever it was (⌘K opener, a
// topbar cell, …). The Tab-wrap math is the pure focusTrapTarget helper in
// a11y.js (unit-tested); this hook only owns the DOM wiring.

import { useEffect, useRef } from "react";
import { FOCUSABLE_SELECTOR, focusTrapTarget } from "../a11y.js";

export function useFocusTrap(ref, { active = true, autoFocus = true } = {}) {
  const openerRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    // Remember who opened us so focus can return there on close.
    openerRef.current = document.activeElement;

    const focusables = () => Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus inside on open. Prefer the first real focusable; fall back to
    // the container itself (which is given tabindex=-1 by the caller).
    if (autoFocus) {
      const first = focusables()[0];
      if (first) first.focus();
      else if (typeof node.focus === "function") node.focus();
    }

    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        // Nothing focusable inside — keep focus on the container.
        e.preventDefault();
        if (typeof node.focus === "function") node.focus();
        return;
      }
      const activeIndex = list.indexOf(document.activeElement);
      const targetIndex = focusTrapTarget({ count: list.length, activeIndex, shiftKey: e.shiftKey });
      if (targetIndex != null) {
        e.preventDefault();
        list[targetIndex].focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to the opener if it is still in the document — but only if
      // focus is still "ours" (inside this node, or nowhere). During a
      // page-to-page switch (motion v1) the incoming page has already autofocused
      // itself while the outgoing page is still playing its exit; the outgoing
      // page must not steal that focus back when it finally unmounts.
      const focused = document.activeElement;
      const focusStillOurs = !focused || focused === document.body || node.contains(focused);
      const opener = openerRef.current;
      if (focusStillOurs && opener && typeof opener.focus === "function" && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [ref, active, autoFocus]);
}
