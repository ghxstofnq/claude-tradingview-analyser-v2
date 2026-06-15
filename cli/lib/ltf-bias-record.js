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
