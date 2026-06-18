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

// The open-reaction window (strategy §2.3.1 / §7 Step 4): check the SMT read
// each bar from minute 15; lock early when conclusive; hard stop at minute 30.
const WINDOW_OPEN_MIN = 15;
const WINDOW_HARD_STOP_MIN = 30;

function isFinalBias(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s !== "" && s !== "pending" && s !== "stand_aside";
}

/**
 * Pure timing policy for locking the SMT leader. Decides, from the window
 * minute + the analyze SMT evidence, whether to lock now, keep waiting, or
 * stand aside. Never defaults to PAIR_PRIMARY on missing data.
 *
 * Returns { action, leader?, standaside?, reason? } where action ∈
 *   none       — a leader is already locked (don't re-lock)
 *   wait       — pre-window (<15m) or still resolving (15–30m, not done)
 *   lock       — clear divergence (any bar ≥15m) OR measured near-tie at 30m → MNQ
 *   standaside — 30m hard stop with unreadable data (missing / no pivot)
 */
export function planLeaderLock({ existingLeader, minutesIntoPhase, evidence } = {}) {
  if (existingLeader) return { action: "none" };
  const m = Number(minutesIntoPhase);
  const ev = evidence || {};
  if (!(Number.isFinite(m) && m >= WINDOW_OPEN_MIN)) return { action: "wait", reason: "pre_window" };
  if (ev.done && ev.smt_leader) {
    return { action: "lock", leader: ev.smt_leader, standaside: false, reason: ev.reason || "smt_divergence" };
  }
  if (!(m >= WINDOW_HARD_STOP_MIN)) return { action: "wait", reason: "resolving" };
  const crit = ev.criteria || {};
  if (!crit.data_present || !crit.pivots_confirmed) {
    return { action: "standaside", reason: ev.reason || "smt_unreadable_data" };
  }
  // Measured near-tie at the hard stop — no relative-strength edge → MNQ.
  return { action: "lock", leader: PAIR_PRIMARY, standaside: false, reason: ev.reason || "no_divergence_measured" };
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
  const evidence = bundle.pair?.symbols ? (bundle.pair.leader_evidence || null) : null;
  const primary = bundle.pair?.primary || PAIR_PRIMARY;
  const secondary = bundle.pair?.secondary || PAIR_SECONDARY;
  // Provisional leader (for the bias read) until the lock fires — the SMT
  // proposal if present, else the primary. NEVER trades off this; it only
  // decides which symbol's bundle the bias resolver reads.
  let leader = existingLeader
    || (bundle.pair?.symbols ? (evidence?.smt_leader || PAIR_PRIMARY) : (bundle.symbol || PAIR_PRIMARY));
  let leaderBundle = bundle.pair?.symbols
    ? (bundle.pair.symbols[leader] || bundle.pair.symbols[PAIR_PRIMARY] || null)
    : bundle;

  // Timing policy: lock the leader only when the SMT read is conclusive
  // (≥15m) or at the 30m hard stop. Stand aside on unreadable data — never a
  // silent PAIR_PRIMARY default (strategy §2.3.1).
  const plan = planLeaderLock({ existingLeader, minutesIntoPhase, evidence });
  let standaside = false;
  if (plan.action === "lock") {
    leader = plan.leader;
    if (bundle.pair?.symbols) leaderBundle = bundle.pair.symbols[leader] || leaderBundle;
    await d.writeLeaderDecision({
      primary, secondary, leader, session,
      method: "smt", bias_dir: evidence?.bias_dir ?? null,
      divergence: evidence?.divergence ?? null, gap: evidence?.gap ?? null,
      standaside: false, evidence, reason: plan.reason,
    });
  } else if (plan.action === "standaside") {
    standaside = true;
    await d.writeLeaderDecision({
      primary, secondary, leader: null, session,
      method: "smt", standaside: true, evidence, reason: plan.reason,
    });
    await d.notify?.({
      title: "SMT leader unreadable — standing aside",
      body: `${session}: ${plan.reason} (both symbols' open-window data required)`,
    });
  }
  // action "wait" / "none": no leader decision written this bar.

  if (standaside) {
    await d.writeOpenReaction({
      session, minutes_into_phase: minutesIntoPhase,
      latest_read: `SMT unreadable at the 30m hard stop — standing aside (${plan.reason}).`,
      bias_direction: "stand_aside",
      watching: "no relative-strength edge readable; both symbols' open-window data required",
    });
    await d.writeLtfBias({
      session, ltf_bias: "stand_aside", htf_ltf_alignment: "unclear", is_retrace_day: false,
      entry_model_priority: "undecided", grade_cap: "no-trade",
      reasoning: `SMT leader unreadable (${plan.reason}) — stand aside per §2.3.1`,
      source: "smt-standaside",
    });
    return { wrote: true, leader: null, bias: "stand_aside", locked: false, standaside: true, reason: plan.reason };
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

  return {
    wrote: true, leader, bias, alignment: ctx?.htf_ltf_alignment ?? null,
    locked: plan.action === "lock", reason: plan.reason ?? null,
  };
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
    notify: async (n) => {
      try { const { notifySystem } = await import("./notify.js"); await notifySystem(n); } catch { /* notify best-effort */ }
    },
    _currentSession: currentSession,
  };
}

export const __test = { isFinalBias };
