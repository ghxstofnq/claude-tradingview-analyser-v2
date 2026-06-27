// cli/lib/engine-cites.js
// Stamp a resolvable JSON-path cite on every engine zone so any consumer that
// picks one — the gate's pickPrimaryDraw (which forwards the primary_draw the
// brief consumes), the bundle citations — carries a citeable reference
// (CLAUDE.md constraint #6). Symbol-relative path, mirroring brief-digest.js:
// `engine_by_tf.<tf>.<kind>[idx]`. Idempotent (only fills an absent cite),
// mutates + returns engineByTf, no-ops on null.
//
// Why this exists: cites were assigned ONLY to digest-ranked zones
// (brief-digest.js), but compute-engine-gates' pickPrimaryDraw reads the FULL
// raw engine list whose zones had no cite — so a forwarded draw could carry
// `cite: null` (2026-06-24 NY-PM MES). Stamping at the gate chokepoint (the same
// engine_by_tf reference that lands in the bundle) gives both lanes cited zones.

const KINDS = ["fvgs", "bprs", "structures"];

export function annotateEngineByTfCites(engineByTf) {
  if (!engineByTf || typeof engineByTf !== "object") return engineByTf;
  for (const [tf, engine] of Object.entries(engineByTf)) {
    if (!engine || typeof engine !== "object") continue;
    for (const kind of KINDS) {
      const arr = engine[kind];
      if (!Array.isArray(arr)) continue;
      arr.forEach((zone, idx) => {
        if (zone && typeof zone === "object" && (zone.cite == null || zone.cite === "")) {
          zone.cite = `engine_by_tf.${tf}.${kind}[${idx}]`;
        }
      });
    }
  }
  return engineByTf;
}
