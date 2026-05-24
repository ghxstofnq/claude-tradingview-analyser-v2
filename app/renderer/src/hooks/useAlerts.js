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
