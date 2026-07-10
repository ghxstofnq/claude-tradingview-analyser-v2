// app/main/prose-section.js — slice a single Markdown H2 section out of an
// LLM turn's streamed prose. Pure, no I/O.
//
// A one-shot LLM turn streams its WHOLE reasoning before (optionally) the
// trader-facing block we want to surface. This extracts only the text under
// the LAST line-anchored `## <MARKER>` heading (discarding everything before
// it, incl. the heading line). No such heading → null (better absent than
// polluted). Line-anchored + last-occurrence so an inline mention or an earlier
// code-fence can't false-trigger.
//
// Originally the CRITIQUE-only slicer inside session-wrap.js (#239, Track 2 §2b
// item 1); generalized here so the coach narration (item 2) reuses it for the
// `## COACH` marker instead of duplicating the regex.

// Escape any regex metacharacters in the marker so it is matched literally.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// extractMarkedSection(prose, marker) → the trimmed body under the final
// `## <marker>` H2 heading, or null when there is nothing to surface.
export function extractMarkedSection(prose, marker) {
  const text = String(prose ?? "");
  if (!text) return null;
  const safe = String(marker ?? "").trim();
  if (!safe) return null;
  // A Markdown H2 whose sole content is the marker, alone on its own line.
  const re = new RegExp(`^[ \\t]*##[ \\t]+${escapeRegex(safe)}[ \\t]*$`, "gm");
  let last = null;
  for (let m; (m = re.exec(text)); ) last = m;
  if (!last) return null;
  const body = text.slice(last.index + last[0].length).trim();
  return body || null;
}
