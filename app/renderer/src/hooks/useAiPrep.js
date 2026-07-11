// useAiPrep — the ⌘1 "AI Prep": ONE analysis turn that reads the session's
// deterministic brief file and writes eight reading-friendly ## sections, one
// per prep card. Run-once semantics: the result persists to the session folder
// (prep.aiSave) and re-mounts hydrate from disk (prep.aiGet); regeneration is
// the caller's deliberate act, never a side effect of viewing.
//
// Streams over the analysis channel (purpose "analysis" — one-shot, read-only,
// 120s main-side timeout) with the same guards as useAiAnalysis, parsing
// sections progressively so cards populate while the turn writes.

import { useCallback, useEffect, useRef, useState } from "react";
import { splitMarkedSections } from "../Prep.helpers.js";

// Order matters: it's both the output contract and the card map.
export const AI_PREP_MARKERS = [
  "CALENDAR", "OVERNIGHT", "PRICE QUALITY", "HTF READ",
  "BIAS", "OPEN REACTION", "SCENARIOS", "PLAN",
];

function nyToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(Date.now());
}

export function buildAiPrepPrompt({ symbol, session, date }) {
  return [
    `AI Prep — write the ${String(session || "").toUpperCase()} pre-session brief for ${symbol} as reading-friendly sections a trader absorbs in two minutes.`,
    ``,
    `Data: Read state/session/${date}/${session}/brief-${symbol}.json — the exact data behind the deterministic prep cards. You may also Read state/last-analyze.digest.json for HTF context if it exists. Read nothing else; run no captures.`,
    ``,
    `Output EXACTLY these eight H2 sections, in this order, each 2-5 plain-English sentences (SCENARIOS may run one short paragraph per scenario):`,
    ``,
    `## CALENDAR`, `## OVERNIGHT`, `## PRICE QUALITY`, `## HTF READ`,
    `## BIAS`, `## OPEN REACTION`, `## SCENARIOS`, `## PLAN`,
    ``,
    `Rules (the kernel's hard rules, restated):`,
    `- Open HTF READ with a one-line bottom line for the day.`,
    `- Every price cited as <price> (<json.path>) resolving into that brief JSON (or the digest). A number you cannot cite: write n/a.`,
    `- No arithmetic — only numbers that already exist in the files.`,
    `- Grade words: A+ | B | no-trade only. Restate the deterministic pillar_grade; never override it.`,
    `- You are not a trade signal: describe what the data says, never instruct a trade.`,
    ``,
    `Self-check before finishing: all eight headers present exactly once, every number cited, nothing instructs a trade. No text after PLAN's body.`,
  ].join("\n");
}

const EMPTY = Object.freeze({});

export function useAiPrep({ symbol, session, brief } = {}) {
  const [sections, setSections] = useState(EMPTY);
  const [active, setActive] = useState(null);   // marker being streamed right now
  const [running, setRunning] = useState(false);
  const [ts, setTs] = useState(null);           // ISO string of the displayed record
  const [error, setError] = useState(null);
  const runningRef = useRef(false);
  const bufRef = useRef("");
  const watchdogRef = useRef(null);
  const metaRef = useRef({ symbol, session });  // captured at run() start for the save

  const clearWatchdog = () => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  };

  // Hydrate the saved record for this symbol; skipped while a turn streams.
  useEffect(() => {
    if (!symbol || runningRef.current) return;
    let alive = true;
    window.api?.prep?.aiGet?.(symbol).then((r) => {
      if (!alive) return;
      if (r?.ok && r.record?.sections) {
        setSections(r.record.sections);
        setTs(r.record.ts || null);
        setError(null);
      } else {
        setSections(EMPTY);
        setTs(null);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [symbol, session]);

  useEffect(() => {
    const offChunk = window.api?.analysis?.onChunk?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "analysis") return;
      if ((ev?.provider ?? "claude") !== "claude") return;
      if (typeof ev?.text !== "string") return;
      bufRef.current += ev.text;
      const parsed = splitMarkedSections(bufRef.current, AI_PREP_MARKERS);
      setSections(parsed.sections);
      setActive(parsed.active);
    });
    const offDone = window.api?.analysis?.onTurnComplete?.((ev) => {
      if (!runningRef.current) return;
      if (ev?.purpose && ev.purpose !== "analysis") return;
      clearWatchdog();
      runningRef.current = false;
      setRunning(false);
      setActive(null);
      const raw = bufRef.current;
      const parsed = splitMarkedSections(raw, AI_PREP_MARKERS);
      const got = Object.values(parsed.sections).filter(Boolean).length;
      if (!got) {
        setError("The turn returned no sections — tap AI Prep to retry.");
        return;
      }
      setSections(parsed.sections);
      const { symbol: sym, session: sess } = metaRef.current;
      const record = {
        ts: new Date().toISOString(),
        symbol: sym, session: sess, date: nyToday(),
        raw, sections: parsed.sections,
      };
      setTs(record.ts);
      window.api?.prep?.aiSave?.(sym, record).catch(() => {});
    });
    return () => { offChunk?.(); offDone?.(); clearWatchdog(); };
  }, []);

  const run = useCallback(() => {
    if (runningRef.current || !symbol || !session) return;
    bufRef.current = "";
    metaRef.current = { symbol, session };
    setSections(EMPTY);
    setActive(null);
    setTs(null);
    setError(null);
    runningRef.current = true;
    setRunning(true);

    const fail = (msg) => {
      if (!runningRef.current) return;
      clearWatchdog();
      runningRef.current = false;
      setRunning(false);
      setActive(null);
      setError(msg);
    };
    watchdogRef.current = setTimeout(() => fail("AI Prep didn't come back — tap AI Prep to retry."), 150_000);

    const prompt = buildAiPrepPrompt({ symbol, session, date: brief?.date || nyToday() });
    Promise.resolve(window.api?.analysis?.run?.(prompt, { provider: "claude" }))
      .then((r) => { if (r && r.ok === false) fail("AI Prep failed to start — tap AI Prep to retry."); })
      .catch(() => fail("AI Prep failed to start — tap AI Prep to retry."));
  }, [symbol, session, brief]);

  const exists = Object.values(sections).some(Boolean);
  // Regeneration gate: deterministic brief newer than the saved AI prep.
  const stale = !!(exists && ts && brief?.ts && new Date(brief.ts).getTime() > new Date(ts).getTime());

  return { sections, active, running, ts, error, run, exists, stale };
}
