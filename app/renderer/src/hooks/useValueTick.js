// useValueTick — restart a one-shot `.value-tick` pulse whenever `value` changes.
// Returns a ref to attach to the element that carries the `.value-tick` class;
// the pulse is an `::after` overlay so it never disturbs the element's own
// background. `active` gates it: pass false for STALE / PENDING states so they
// never tick (motion v1 rule). The first appearance of a value never ticks —
// only subsequent changes do. Under prefers-reduced-motion the class toggles
// but the CSS animation is a no-op, so this stays inert.

import { useRef, useEffect } from "react";

export function useValueTick(value, active = true) {
  const ref = useRef(null);
  const prev = useRef(value);
  const primed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    const changed = !Object.is(prev.current, value);
    prev.current = value;
    if (!primed.current) {
      primed.current = true; // never tick on the first render / first value
      return;
    }
    if (!active || !changed || !el) return;
    el.classList.remove("is-tick");
    void el.offsetWidth; // force reflow so the same animation restarts
    el.classList.add("is-tick");
  }, [value, active]);

  return ref;
}
