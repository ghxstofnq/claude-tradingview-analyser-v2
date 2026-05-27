// detector-brief-digest — synthesizes the brief_digest fields the strategy
// detector reads (htf_destination + primary_draw under the leader symbol's
// pillar1) into a bundle in three scenarios:
//
//   (1) Analyze-time: brief hasn't run yet, so the digest has no
//       htf_destination / primary_draw. Pull from brief.json on disk.
//
//   (2) Post-pair-decision single-symbol bundles: no `pair` block → no
//       brief_digest at all → without this, the detector silently emits
//       "Awaiting brief. Run brief phase first." every bar.
//
//   (3) Slim-projection bundles (`last-scan.slim.json`): `projectSlim`
//       drops brief_digest entirely. Same fix path covers this.
//
// htf_destination is saved by `surface_session_brief` as a prose string
// ("below 29876 sell-side then 30192.25 buy-side"), but the detector
// expects an object with `.dir`. parseHtfDestination handles the prefix.

/**
 * Parse the prose "above ..." / "below ..." / "balanced" prefix saved by
 * surface_session_brief into the {dir, text} shape the detector expects.
 * Returns null for non-strings. dir is null when no directional prefix
 * matches (e.g. "balanced", or empty), letting resolveSidesToEvaluate
 * fall through to the two-sided default.
 */
export function parseHtfDestination(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  const dir = /^above\b/i.test(text) ? "above" : /^below\b/i.test(text) ? "below" : null;
  return { dir, text };
}

/**
 * Mutate `bundle` in place: create-or-merge
 * bundle.brief_digest.symbols[<symbolKey>].pillar1 with the brief's
 * htf_destination + primary_draw. Returns the same bundle for chaining.
 *
 * Returns the bundle unchanged when either `brief` or `leader` is falsy.
 * `leader` is the lowercase short form ("mnq" / "mes") as written into
 * pair-decision.json; the symbolKey resolves to "MNQ1!" / "MES1!" /
 * "PRIMARY" (fallback for single-instrument projects).
 */
export function attachDetectorBriefDigest(bundle, brief, leader) {
  if (!bundle || !brief || !leader) return bundle;
  const symKey = leader === "mnq" ? "MNQ1!" : leader === "mes" ? "MES1!" : "PRIMARY";
  bundle.brief_digest = bundle.brief_digest || { symbols: {} };
  bundle.brief_digest.symbols = bundle.brief_digest.symbols || {};
  bundle.brief_digest.symbols[symKey] = bundle.brief_digest.symbols[symKey] || {};
  bundle.brief_digest.symbols[symKey].pillar1 = bundle.brief_digest.symbols[symKey].pillar1 || {};
  const p1 = bundle.brief_digest.symbols[symKey].pillar1;
  if (brief.htf_destination) {
    const parsed = parseHtfDestination(brief.htf_destination);
    if (parsed) p1.htf_destination = parsed;
  }
  if (brief.primary_draw) p1.primary_draw = brief.primary_draw;
  return bundle;
}
