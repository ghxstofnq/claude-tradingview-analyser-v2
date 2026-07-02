// cli/lib/cite-check.js
// Shared cite-or-reject logic (CLAUDE.md constraint #6). Extracted from
// scripts/verify-citations.js so the SAME resolver runs on the fixture harness
// AND on live LLM output (audit C29) — one implementation, no drift.
//
// Citation syntax: <price> (<json.path>)  e.g.  29172.75 (quote.last)

export function getByPath(obj, path) {
  const tokens = path.split(/\.|\[(\d+)\]/).filter((t) => t !== undefined && t !== "");
  let cur = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = /^\d+$/.test(t) ? cur[Number(t)] : cur[t];
  }
  return cur;
}

export function approxEqual(a, b) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-4;
}

const CITE_RE = /(-?\d+(?:\.\d+)?)\s*\(([^)\n]+)\)/g;
// A citation path must look like a JSON accessor (letters/underscore start, then
// word chars/dots/brackets/digits/!). Skips prose parentheticals like "(close)".
const PATH_RE = /^[a-zA-Z_][\w.[\]!]*$/;

// Pull { cited, path } pairs from any text where the parenthetical is path-shaped.
export function extractCitations(text) {
  const out = [];
  let m;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(String(text || ""))) !== null) {
    const path = m[2].trim();
    if (!PATH_RE.test(path)) continue;
    out.push({ cited: Number(m[1]), path });
  }
  return out;
}

// Resolve every cited price against the bundle. Returns { violations, checked }.
// A violation is a cite whose path is missing, non-numeric, or off by > 1e-4.
export function verifyCitations(text, bundle) {
  const violations = [];
  const checked = [];
  for (const { cited, path } of extractCitations(text)) {
    const actual = getByPath(bundle, path);
    if (actual === undefined) {
      violations.push({ cited, path, reason: "path not present in bundle" });
    } else if (typeof actual !== "number") {
      violations.push({ cited, path, reason: `path resolves to non-number (${typeof actual})` });
    } else if (!approxEqual(cited, actual)) {
      violations.push({ cited, path, reason: `bundle has ${actual}` });
    } else {
      checked.push({ cited, path });
    }
  }
  return { violations, checked };
}
