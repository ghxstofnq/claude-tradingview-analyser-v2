// useValueTick — restart a one-shot `.value-tick` pulse whenever `value` changes.
// Returns a ref to attach to the element that carries the `.value-tick` class;
// the pulse is an `::after` overlay so it never disturbs the element's own
// background. `active` gates it: pass false for STALE / PENDING states so they
// never tick (motion v1 rule).
//
// First appearance is intentionally SILENT — a value's first render never ticks,
// only later changes do (a freshly opened position / a grade landing should be
// calm, not a flash).
//
// `opts.minIntervalMs` is a rate-limit backstop: even a qualifying change won't
// tick more than once per interval. Callers that feed a raw, frequently-polled
// number (the live P&L) pass a coarse "milestone" value AND a ≥10s interval so
// the money number pulses on a meaningful move, never on every poll. Callers
// whose value already flips rarely (day chip, readiness verdict) leave it 0.
//
// Under prefers-reduced-motion the class still toggles but the CSS animation is a
// no-op, so this stays inert.

import { useRef, useEffect } from "react";

export function useValueTick(value, active = true, { minIntervalMs = 0 } = {}) {
  const ref = useRef(null);
  const prev = useRef(value);
  const primed = useRef(false);
  const lastTickAt = useRef(0);

  useEffect(() => {
    const el = ref.current;
    const changed = !Object.is(prev.current, value);
    prev.current = value;
    if (!primed.current) {
      primed.current = true; // never tick on the first render / first value
      return;
    }
    if (!active || !changed || !el) return;
    const now = Date.now();
    if (minIntervalMs > 0 && now - lastTickAt.current < minIntervalMs) return; // backstop throttle
    lastTickAt.current = now;
    el.classList.remove("is-tick");
    void el.offsetWidth; // force reflow so the same animation restarts
    el.classList.add("is-tick");
  }, [value, active, minIntervalMs]);

  return ref;
}
