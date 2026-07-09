// dayChip — the always-visible operating-rules chip for the top bar (plan
// 2026-07-09 Task 3). Displays EXISTING truth only: the grade cap from the
// live resolver / brief, the bias-component votes already rendered by
// openReactionVerdict, and the day-of-week size rule. Nothing here re-derives
// grading — the walker chain stays the single brain.

import { openReactionVerdict } from "../Prep.helpers.js";

// Day-of-week sizing label per the strategy sizing table
// (strategy.risk-and-management: Mon/Fri half size, Tue–Thu full). Display-only
// mirror of the rule — actual packet sizing stays in main (execution-packet
// sizeFor). ET weekday: the trading day, not the machine's timezone.
export function daySizeLabel(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" })
    .format(now).toUpperCase();
  if (day === "SAT" || day === "SUN") return { day, sizeText: null };
  return { day, sizeText: day === "MON" || day === "FRI" ? "HALF" : "FULL" };
}

// → { state: "none" | "ok" | "handsoff", ... } for the TopBar renderer.
// state none  — no brief / no resolver context yet (dim, honest)
// state ok    — grade + votes + day-size
// state handsoff — the open reversed the bias (daily-bias.md §4: hands off)
export function buildDayChip({ brief, latest, ltf, now = new Date() } = {}) {
  if (!brief && !ltf) {
    return { state: "none", tone: "dim", text: "NO BRIEF", title: "No session brief yet — ⌘1 to prep the day" };
  }
  const orv = openReactionVerdict(latest, brief, ltf);
  // Count of directional bias components — the same three rows PREP shows
  // (HTF / Overnight / Open), counted, not re-graded.
  const votes = orv.rows.filter((r) => r.v === "BULL" || r.v === "BEAR").length;
  const votesText = `${votes}/3`;

  const grade = ltf?.grade_cap ?? brief?.pillar_grade ?? null;
  const g = String(grade ?? "").toLowerCase();
  const gradeText = g === "a+" ? "A+" : g === "b" ? "B" : g === "no-trade" ? "NO-TRADE" : null;
  const gradeTone = g === "a+" ? "green" : g === "b" ? "amber" : g === "no-trade" ? "red" : "dim";
  const gradeSrc = ltf?.grade_cap != null ? "live cap" : "brief";

  if (orv.verdict === "FLIPS") {
    return {
      state: "handsoff", tone: "red", text: `HANDS OFF · ${votesText}`,
      title: "The open reversed the bias — hands off, timing isn't there (daily-bias.md §4). Click for the briefing.",
    };
  }

  const { day, sizeText } = daySizeLabel(now);
  return {
    state: "ok", tone: gradeTone,
    text: [gradeText ?? "—", votesText, sizeText ? `${day} ${sizeText}` : day].join(" · "),
    title: `bias ${votesText} · grade ${gradeText ?? "—"} (${gradeSrc}) · size rule ${sizeText ?? "—"} (strategy.risk-and-management) — click for the briefing`,
  };
}
