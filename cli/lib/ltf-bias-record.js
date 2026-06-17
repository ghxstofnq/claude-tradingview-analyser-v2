// cli/lib/ltf-bias-record.js
// Normalize a finalized LTF-bias record into the context the entry-hunt chain
// reads. The structured `ltf-bias.json` sidecar (written by surface_ltf_bias)
// is the documented source of truth; the `.md` is only the human view. The
// live chain used to parse the `.md` FRONTMATTER for a field named `bias`,
// but the writer puts the value in the `.md` body as `ltf_bias` and the real
// payload in the JSON — so the chain saw `bias: null` and blocked every
// divergent/mixed-open session on `missing_ltf_bias`. This normalizer maps the
// JSON record's field names so the reader can use the source of truth. Pure.
export function normalizeLtfBiasRecord(rec) {
  if (!rec || typeof rec !== "object") return {};
  return {
    bias: rec.ltf_bias ?? rec.bias ?? rec.leader_bias ?? null,
    leader: rec.leader ?? null,
    htf_ltf_alignment: rec.htf_ltf_alignment ?? null,
    is_retrace_day: rec.is_retrace_day === true || rec.is_retrace_day === "true",
    entry_model_priority: rec.entry_model_priority ?? null,
    grade_cap: rec.grade_cap ?? null,
  };
}

// Is this normalized record a FINALIZED open-reaction verdict the chain can
// trust as source of truth — even when the bias is a legitimate stand-aside
// (`ltf_bias: null`)?
//
// The bug this guards against: the live reader only accepted ltf-bias.json
// when `bias` was a direction, so on any stand-aside day it discarded the
// valid JSON (which carries entry_model_priority + grade_cap) and fell back to
// the .md — which carries neither. The chain then blocked every bar on
// `missing_entry_model_priority, missing_grade_cap` (June 16 2026: 100% of
// both NY sessions). The finalizer always writes grade_cap + entry_model_priority
// regardless of bias, so their presence — not a non-null bias — marks a real
// record. Only an absent/stub sidecar (no verdict fields at all) should fall
// back to the human-readable .md. Pure.
export function isFinalizedLtfBiasRecord(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  const has = (v) => v != null && String(v).trim() !== "";
  return has(ctx.bias) || has(ctx.grade_cap) || has(ctx.entry_model_priority);
}
