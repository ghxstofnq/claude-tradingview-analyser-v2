// run-symbol — the canonical instrument tag for a backtest run, shared by the
// engine (tags new runs), the back-tag migration (recovers the symbol of
// existing runs from their recorded data), and their tests. Only MNQ/MES are
// traded; anything else is null (never guessed — keeps the per-symbol analytics
// honest: an untaggable run shows under NEITHER instrument, never a fabricated one).

const ROOT_RE = /(MNQ|MES)/;

// Normalize any symbol-ish string ("mes", "MES1!", "CME_MINI:MNQ1!") to the
// canonical "MNQ1!" / "MES1!", or null if it names neither instrument.
export function canonicalSymbol(sym) {
  const m = ROOT_RE.exec(String(sym ?? "").toUpperCase());
  return m ? `${m[1]}1!` : null;
}

// Recover a run's traded instrument from the raw text of any of its recorded
// files (tape.json / brief-bundle.json carry the chart symbol throughout).
// First MNQ/MES occurrence wins — a run is single-instrument by construction
// (BOTH studies expand to separate per-symbol runs).
export function parseRunSymbol(text) {
  return canonicalSymbol(String(text ?? "").match(/(MNQ|MES)1!/)?.[0] ?? null);
}
