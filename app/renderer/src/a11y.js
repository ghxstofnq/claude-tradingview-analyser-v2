// Shared a11y helpers. Many interactive elements in the UI are <div>/<span> with
// an onClick (cells, pills, bells, close glyphs, segmented controls). These make
// them behave like real controls for keyboard users: focusable (tabIndex),
// announced with a role, and activated by Enter/Space. Spread onto the element:
//   <div {...clickable(handler)}>        — button semantics
//   <span {...tab(onSelect, {selected})}> — tab-in-a-tablist semantics
//
// The visible focus ring is global CSS (:focus-visible in app.css) — keyboard
// only, mouse clicks never show it. This module stays framework-free (no React)
// so it is unit-tested directly with node --test; the React focus-trap wrapper
// that consumes FOCUSABLE_SELECTOR / focusTrapTarget lives in
// hooks/useFocusTrap.js.

export function clickable(onClick, { label } = {}) {
  if (typeof onClick !== "function") return {};
  return {
    role: "button",
    tabIndex: 0,
    ...(label ? { "aria-label": label } : {}),
    onClick,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onClick(e);
      }
    },
  };
}

// tab() — role="tab" semantics for a segmented control (the FEED/POSITIONS
// toggle, Review domain tabs, Settings mode picker). Spread onto each tab span;
// the container must carry role="tablist" (+ an aria-label). Roving tabindex:
// only the selected tab is in the Tab order (0); the rest are -1 and reached
// with the arrow keys. Enter/Space and Arrow keys all keep focus on a real tab.
export function tab(onSelect, { selected = false, label } = {}) {
  if (typeof onSelect !== "function") return {};
  return {
    role: "tab",
    "aria-selected": selected ? "true" : "false",
    tabIndex: selected ? 0 : -1,
    ...(label ? { "aria-label": label } : {}),
    onClick: onSelect,
    onKeyDown: (e) => {
      const k = e.key;
      if (k === "Enter" || k === " " || k === "Spacebar") {
        e.preventDefault();
        onSelect(e);
        return;
      }
      const dir = k === "ArrowRight" || k === "ArrowDown" ? 1
        : k === "ArrowLeft" || k === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const el = e.currentTarget;
      const sib = dir > 0 ? el.nextElementSibling : el.previousElementSibling;
      const target = sib && sib.getAttribute && sib.getAttribute("role") === "tab" ? sib : null;
      if (target) {
        // Roving focus + activate: move DOM focus to the neighbour and select it.
        if (typeof target.focus === "function") target.focus();
        if (typeof target.click === "function") target.click();
      }
    },
  };
}

// The elements a focus trap treats as focusable. Kept in one place so the pure
// helper and the React hook agree.
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]:not([disabled])',
  '[role="tab"]',
].join(",");

// focusTrapTarget — pure Tab-wrap math for a focus trap. Given the focusable
// elements inside a container, the index of the currently focused one (-1 when
// focus has escaped the container), and whether Shift was held, return the index
// to move focus to — or null to let the browser's native Tab move happen.
//
//   focus escaped (-1)            → pull back in (first, or last on Shift+Tab)
//   on the last element, Tab      → wrap to first
//   on the first element, Shift+Tab → wrap to last
//   anywhere else                 → null (native Tab is fine)
export function focusTrapTarget({ count, activeIndex, shiftKey = false }) {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (activeIndex < 0) return shiftKey ? count - 1 : 0;
  if (!shiftKey && activeIndex >= count - 1) return 0;
  if (shiftKey && activeIndex <= 0) return count - 1;
  return null;
}
