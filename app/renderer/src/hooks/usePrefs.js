// usePrefs — UI preferences persisted to localStorage (workstation:prefs).
// Renderer-only (no main-process store): the three toggles gate real renderer
// effects fired on an alert (see CommandShell's alert-fired listener):
//   notif      → a desktop Notification
//   sound      → a short WebAudio tick
//   autoTicket → auto-open the command palette
// Shared by the Settings page (read/write) and CommandShell (read).
import { useEffect, useState } from "react";

export const PREFS_KEY = "workstation:prefs";
export const PREFS_DEFAULT = { notif: false, sound: false, autoTicket: false };

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...PREFS_DEFAULT, ...JSON.parse(raw) } : { ...PREFS_DEFAULT };
  } catch { return { ...PREFS_DEFAULT }; }
}

// Read the current prefs without subscribing (for one-shot effect gating).
export function readPrefs() { return loadPrefs(); }

export function usePrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  useEffect(() => {
    // Reflect edits made in another mount of the hook (e.g. Settings ⇄ CommandShell).
    const onStorage = (e) => { if (e.key === PREFS_KEY) setPrefs(loadPrefs()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const setPref = (k, v) => {
    setPrefs((p) => {
      const next = { ...p, [k]: v };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  return { prefs, setPref };
}
