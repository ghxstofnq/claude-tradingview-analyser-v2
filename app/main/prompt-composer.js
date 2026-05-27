// prompt-composer — pure helpers for composing phase files with partial references.
// Phase files embed `<!-- @partial:NAME -->` markers; the loader scans
// for them, reads partials/<NAME>.md, and substitutes.
//
// Kept dependency-free so node --test can import without booting Electron
// / the Agent SDK / Zod. Consumed by app/main/sdk.js#loadSystemPrompt.

const PARTIAL_MARKER_RE = /<!-- @partial:([a-z0-9-]+) -->/g;

/**
 * Scan `body` and return the partial names referenced, in body order.
 * Throws if any name appears more than once (catches refactor mistakes
 * where a block is accidentally referenced twice).
 *
 * The marker syntax is strict: lowercase letters, digits, and hyphens
 * only. Uppercase, slashes, and dots will not match — defense against
 * path-traversal via marker names.
 */
export function findPartialReferences(body) {
  if (typeof body !== "string" || body.length === 0) return [];
  const seen = new Set();
  const order = [];
  for (const m of body.matchAll(PARTIAL_MARKER_RE)) {
    const name = m[1];
    if (seen.has(name)) {
      throw new Error(`duplicate partial marker: ${name}`);
    }
    seen.add(name);
    order.push(name);
  }
  return order;
}

/**
 * Replace every `<!-- @partial:NAME -->` marker in `body` with the
 * corresponding string from `partialContents` (a Map<name, string>).
 *
 * Strips ONE trailing newline from each partial's content before
 * substitution — partial files end with `\n` per convention, but the
 * marker line itself is followed by a blank line in the phase body, so
 * leaving the trailing newline in would produce a double blank line
 * (violating the byte-identical promise).
 *
 * Throws if a referenced partial is missing from the map.
 */
export function composePhaseWithPartials(body, partialContents) {
  return body.replace(PARTIAL_MARKER_RE, (_, name) => {
    if (!partialContents.has(name)) {
      throw new Error(`partial not provided: ${name}`);
    }
    let content = partialContents.get(name);
    if (content.endsWith("\n")) content = content.slice(0, -1);
    return content;
  });
}
