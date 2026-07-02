// cli/lib/jsonl.js
// Tolerant JSONL parse for the money-path journals (trades.jsonl et al.).
// A crash / power-loss / ENOSPC mid-append leaves a partial final line; a
// single torn line must never silently take down outcome tracking or a loss
// guardrail (audit findings C20 / C21). Returns the parsed records plus a count
// of unparseable lines so callers can SURFACE the corruption instead of
// swallowing it. Blank lines are ignored and never counted as dropped.
export function parseJsonlTolerant(text) {
  const records = [];
  let dropped = 0;
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      dropped += 1;
    }
  }
  return { records, dropped };
}
