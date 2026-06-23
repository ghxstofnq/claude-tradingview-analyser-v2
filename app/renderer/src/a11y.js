// Shared a11y helper. Many interactive elements in the UI are <div>/<span> with an
// onClick (cells, pills, bells, close glyphs). This makes them behave like a button
// for keyboard users: focusable (tabIndex), announced as a button (role), and
// activated by Enter/Space. Spread onto the element: <div {...clickable(handler)}>.
//
// The visible focus ring is global CSS (:focus-visible in app.css) — keyboard only,
// mouse clicks never show it.
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
