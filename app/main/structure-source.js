// structure-source.js — pick the timeframe the BIAS layer reads market
// structure from. 5m-structure campaign (2026-06-20): when STRUCTURE_TF='5',
// the open-reaction resolver and the mid-session realignment read swing-tier
// structure (MSS/BoS) from the 5m engine so a 1m false break can't flip the
// day's bias. The walker's entry layer (FVGs / sweeps / confirmation) stays 1m.
// Default '1' returns the existing 1m read, unchanged.

import { computeEngineGates } from "../../cli/lib/compute-engine-gates.js";
import { structureTf, realignTf } from "./config.js";

// Computed gates of the per-bar captured 5m engine table (engine_by_tf.m5), or
// null when no 5m track is present. Shared by the walker overlay (bar-close) and
// the bias layer so there is one 5m-gates derivation.
export function fiveMGates(bundle, { quoteTimeMs } = {}) {
  const m5 = bundle?.engine_by_tf?.m5;
  if (!m5) return null;
  return computeEngineGates({
    engine: m5,
    engineByTf: null,
    last: bundle?.quote?.last ?? null,
    lastBar: null,
    lastBarAgeSeconds: null,
    m5LastBar: null,
    m15LastBar: null,
    quoteTimeMs: quoteTimeMs ?? Date.now(),
  });
}

// Swing-tier structure events from the configured STRUCTURE_TF (5m when enabled
// and a 5m track exists, else the 1m gates). Same shape either way — each event
// carries event/dir/tier/confirmed_ms/validation — so the resolver's time
// filters and the realignment's MSS/BoS checks work unchanged.
function swingStructuresAtTf(bundle, tf) {
  if (tf === "5") {
    const g5 = fiveMGates(bundle);
    if (g5) return g5.pillar3?.structures_by_tier?.swing ?? [];
  }
  return bundle?.gates?.engine?.pillar3?.structures_by_tier?.swing ?? [];
}

// Open-reaction read (and walker overlay) — follows STRUCTURE_TF.
export function swingStructuresForBias(bundle) {
  return swingStructuresAtTf(bundle, structureTf());
}

// Mid-session realignment ONLY — follows REALIGN_TF, so the fold can route just
// the bias-flip lever to 5m while the open read stays 1m.
export function swingStructuresForRealign(bundle) {
  return swingStructuresAtTf(bundle, realignTf());
}
