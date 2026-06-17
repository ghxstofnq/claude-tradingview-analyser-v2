// useAlerts — wires real fired-alert events from main into the UI's
// existing alerts state shape (armed map + fired list), and exposes
// arm() / disarm() that hit the actual `tv alert create` CLI.
//
// The local "armed" map is best-effort — it's the renderer's memory of
// what the user asked to arm. The "fired" list is authoritative — it's
// what main saw transition armed→triggered in TradingView.

import { useEffect } from "react";

export function useAlertFiredListener(onFired) {
  useEffect(() => {
    if (typeof onFired !== "function") return;
    const off = window.api?.alert?.onFired?.(onFired);
    return () => off?.();
  }, [onFired]);
}

export function useAlertStateListener(onState) {
  useEffect(() => {
    if (typeof onState !== "function") return;
    const off = window.api?.alert?.onState?.(onState);
    return () => off?.();
  }, [onState]);
}

export async function armAlertReal(priceStr, label) {
  if (!window.api?.alert?.arm) return { ok: false };
  const price = parseFloat(String(priceStr).replace(/\s/g, "").replace(/,/g, ""));
  if (!Number.isFinite(price)) return { ok: false, error: "bad price" };
  return window.api.alert.arm(price, String(label || ""));
}

// Disarm a real TV alert by its id (main → tvAlertDeleteOne). The armed model
// must carry the id (see normalizeArmed) — disarming by price/name is impossible.
export async function disarmAlertReal(id) {
  if (id == null || !window.api?.alert?.disarm) return { ok: false };
  return window.api.alert.disarm(id);
}

// Normalize an `alerts:state` payload into the renderer's armed model, PRESERVING
// the alert `id`. The old code mapped armed → prices only, dropping the id, so
// disarm (which needs the id) was a no-op. Returns [{ id, price, label }] for
// finite-priced, id-bearing alerts only.
export function normalizeArmed(ev) {
  const arr = Array.isArray(ev?.armed) ? ev.armed : [];
  return arr
    .filter((a) => a && a.id != null && Number.isFinite(Number(a.price)))
    .map((a) => ({ id: a.id, price: Number(a.price), label: a.label || "" }));
}
