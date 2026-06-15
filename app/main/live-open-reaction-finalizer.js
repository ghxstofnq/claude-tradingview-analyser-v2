// live-open-reaction-finalizer — deterministic open-reaction resolution.
//
// The live chain was deterministic everywhere except the open-reaction window
// (NY-open +0..15m), which still depended on three Claude tool calls at
// minute 14: surface_leader_decision, surface_ltf_bias, surface_open_reaction
// (plus two LLM catch-up paths). This module replaces all of them with the
// SAME pure resolvers the backtest folds:
//   - leader  → computeLeader, surfaced in the bundle as pair.leader_evidence
//   - bias    → deriveLtfBiasContext (live-ltf-resolver.js — mirrors the
//               backtest's resolveOpenReaction + late-direction + MSS realign)
//   - open    → the same verdict, rendered into the open-reaction tracker
//
// No LLM on the load path. Strategy authority: §7 Step 4 / Step 5 / Step 7,
// §2.3. See docs/superpowers/specs/2026-06-15-deterministic-open-reaction-design.md.
//
// Every external effect (capture, file reads, the three writers, the resolver)
// is injected via `deps` so the core is unit-testable without fs/CDP/Electron;
// `buildRealDeps()` lazy-imports the production wiring.

import { PAIR_PRIMARY, PAIR_SECONDARY } from "./config.js";

function isFinalBias(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s !== "" && s !== "pending" && s !== "stand_aside";
}

/**
 * Resolve the open reaction deterministically and persist leader + LTF bias +
 * open verdict. Returns a small status object; never throws on the happy path
 * (capture failures degrade to { wrote:false } so the caller leaves the chain
 * honestly blocked).
 *
 * @param {object}  p
 * @param {string}  p.session            'london' | 'ny-am' | 'ny-pm'
 * @param {string}  p.eventTs            ISO timestamp of the closing bar (UTC).
 * @param {number} [p.minutesIntoPhase]  for the open-reaction tracker.
 * @param {object} [p.deps]              injected effects (tests stub all of these).
 */
export async function finalizeOpenReactionDeterministic({ session, eventTs, minutesIntoPhase = null, deps } = {}) {
  const d = deps || (await buildRealDeps());

  const existingLeader = await d.readExistingLeader();
  const persistedBias = await d.readPersistedBias();
  if (existingLeader && isFinalBias(persistedBias)) {
    return { wrote: false, reason: "already_final" };
  }

  let captured = null;
  try {
    captured = await d.capture();
  } catch {
    captured = null;
  }
  const bundle = captured?.bundle;
  if (!bundle) return { wrote: false, reason: "capture_failed" };

  // Resolve leader + the leader's single-symbol bundle. When pair-decision.json
  // already exists the CLI short-circuits --pair to a single-symbol leader
  // bundle (no `pair` block) — handle both shapes.
  let leader = existingLeader || null;
  let leaderBundle = null;
  if (bundle.pair?.symbols) {
    const evidence = bundle.pair.leader_evidence || null;
    leader = existingLeader || evidence?.leader || PAIR_PRIMARY;
    leaderBundle = bundle.pair.symbols[leader] || bundle.pair.symbols[PAIR_PRIMARY] || null;
    if (!existingLeader) {
      await d.writeLeaderDecision({
        primary: bundle.pair.primary || PAIR_PRIMARY,
        secondary: bundle.pair.secondary || PAIR_SECONDARY,
        leader,
        evidence,
        reason: evidence?.reason || null,
        session,
      });
    }
  } else {
    leader = existingLeader || bundle.symbol || PAIR_PRIMARY;
    leaderBundle = bundle;
  }
  if (!leaderBundle) return { wrote: false, reason: "no_leader_bundle" };

  let brief = null;
  try {
    brief = await d.readBrief(leader);
  } catch {
    brief = null;
  }

  const ctx = await d.deriveBias({ bundle: leaderBundle, brief, session, eventTs });
  const bias = ctx?.bias ?? null;

  await d.writeOpenReaction({
    session,
    minutes_into_phase: minutesIntoPhase,
    latest_read: ctx
      ? `Deterministic open read: ${ctx.interaction || "resolving"} → bias ${bias ?? "pending"} (${ctx.htf_ltf_alignment || "unclear"})`
      : "Open-reaction resolving — bias pending until a post-window structure earns direction (+15m).",
    bias_direction: bias ?? "pending",
    watching: ctx?.entry_model_priority
      ? `entry model priority: ${ctx.entry_model_priority}`
      : "post-window swing structure to earn direction (§7 Step 7)",
  });

  await d.writeLtfBias({
    session,
    ltf_bias: bias,
    htf_ltf_alignment: ctx?.htf_ltf_alignment ?? "unclear",
    is_retrace_day: ctx?.is_retrace_day ?? false,
    entry_model_priority: ctx?.entry_model_priority ?? "undecided",
    grade_cap: ctx?.grade_cap ?? "B",
    reasoning: ctx?.cite
      ? `Deterministic resolver (${ctx.source || "live-ltf-resolver"}): ${ctx.interaction || "open-reaction"} cite=${ctx.cite}`
      : "Deterministic resolver: open-reaction pending (no draw / no in-window structure yet).",
    source: ctx?.source ?? "deterministic-finalizer",
  });

  return { wrote: true, leader, bias, alignment: ctx?.htf_ltf_alignment ?? null };
}

// Lazily wire the production effects. Dynamic imports keep the heavy modules
// (surface writers, the analyzer, sessions) out of the unit-test path.
async function buildRealDeps() {
  const [
    { tvAnalyzeFast },
    { surfaceLeaderDecision, surfaceLtfBias, surfaceOpenReaction },
    { deriveLtfBiasContext },
    { activeSessionDir, currentSession },
    { baselinePathFor, PAIR_DEFAULT },
    fs,
    path,
  ] = await Promise.all([
    import("./tools/tv-analyze.js"),
    import("./tools/surface.js"),
    import("./live-ltf-resolver.js"),
    import("./sessions.js"),
    import("./config.js"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const briefFilenameForLeader = (leader) => {
    if (leader === PAIR_PRIMARY) return `brief-${PAIR_PRIMARY}.json`;
    if (leader === PAIR_SECONDARY) return `brief-${PAIR_SECONDARY}.json`;
    return "brief.json";
  };

  return {
    capture: () =>
      tvAnalyzeFast({
        pair: PAIR_DEFAULT,
        baseline: baselinePathFor(PAIR_PRIMARY),
        baselineSecondary: baselinePathFor(PAIR_SECONDARY),
      }),
    readExistingLeader: async () => {
      try {
        const dir = await activeSessionDir();
        const txt = await fs.readFile(path.join(dir, "pair-decision.json"), "utf8");
        return JSON.parse(txt)?.leader || null;
      } catch {
        return null;
      }
    },
    readPersistedBias: async () => {
      try {
        const dir = await activeSessionDir();
        const txt = await fs.readFile(path.join(dir, "ltf-bias.json"), "utf8");
        const rec = JSON.parse(txt);
        return rec?.ltf_bias ?? rec?.bias ?? null;
      } catch {
        return null;
      }
    },
    readBrief: async (leader) => {
      const dir = await activeSessionDir();
      const names = [briefFilenameForLeader(leader), "brief.json"].filter((v, i, a) => v && a.indexOf(v) === i);
      for (const name of names) {
        try {
          return JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
        } catch { /* try next */ }
      }
      return null;
    },
    deriveBias: (args) => deriveLtfBiasContext(args),
    writeLeaderDecision: (p) => surfaceLeaderDecision(p),
    writeLtfBias: (p) => surfaceLtfBias(p),
    writeOpenReaction: (p) => surfaceOpenReaction(p),
    _currentSession: currentSession,
  };
}

export const __test = { isFinalBias };
