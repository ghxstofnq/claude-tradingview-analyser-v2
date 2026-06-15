# Deterministic Open-Reaction — Design

**Date:** 2026-06-15
**Status:** approved (user dialogue 2026-06-15)

## Problem

The live chain is deterministic everywhere *except* the open-reaction phase. Brief, entry-hunt, and wrap all run in code (deterministic-first, no LLM on the load path). But the open-reaction window (NY-open +0–15m) still depends on three Claude tool calls fired at minute 14:

- `surface_leader_decision` → writes `pair-decision.json` (MNQ vs MES)
- `surface_ltf_bias` → writes the LTF bias (`ltf-bias.json` + `.md`)
- `surface_open_reaction` → writes the open verdict (`open-reaction.json` + `.md`)

Plus two LLM catch-up paths (a leader-pick turn, and a chain-aware `catch_up` routing) that backfill these when the system starts mid-session.

Consequences observed:
- When Claude auth is down, the whole day blocks on `missing_ltf_bias` (2026-06-12 London).
- The LLM can emit a soft `"mixed"` bias that the deterministic resolver never produces — it passes the readiness gate and leaves the day walkable both ways, instead of standing aside on a genuinely neutral open.
- It diverges from the backtest, which resolves the open reaction with pure functions.

## Goal

Make the open-reaction phase fully deterministic — the same resolver functions the backtest folds — so the live chain reaches the brief/entry-hunt/wrap standard: no Claude on the load path.

## What already exists (reused, not rebuilt)

The backtest's open-reaction logic is already pure code, and the live chain already has a faithful mirror:

| Concern | Function | File |
|---|---|---|
| Open verdict (break/rejection vs HTF draw, §7 Step 4) | `resolveOpenReaction` | `cli/lib/open-reaction-resolver.js` |
| LTF bias context (verdict + late-direction + MSS realignment) | `deriveLtfBiasContext` | `app/main/live-ltf-resolver.js` |
| Entry-model priority | `computeEntryModelPriority` | `cli/lib/entry-model-priority.js` |
| Leader (MNQ vs MES by in-window disp_score, constraint #7) | `computeLeader` | `cli/lib/compute-leader.js` |
| Paired capture | `tvAnalyzeFast({ pair, baseline, baselineSecondary })` | `app/main/tools/tv-analyze.js` |
| Writers | `surfaceLeaderDecision` / `surfaceLtfBias` / `surfaceOpenReaction` | `app/main/tools/surface.js` |

`deriveLtfBiasContext` already mirrors the backtest line-for-line (verified): same `resolveOpenReaction`, same quiet-open "first post-window swing earns B" rule (§7 Step 7), same post-window swing-MSS realignment (§2.3 / §7 Step 5). The backtest comments say "mirrors the live resolver."

`computeLeader` is the one thing the backtest does *not* do (it is single-symbol, symbol fixed at config). User decision 2026-06-15: keep it — preserve live's MNQ-vs-MES edge, but compute it in code, never via Claude. Default to `PAIR_PRIMARY` when inconclusive (existing fallback).

## Design

### New module: `app/main/live-open-reaction-finalizer.js`

One exported async function:

```
finalizeOpenReactionDeterministic({ session, eventTs, deps }) -> { wrote, leader, bias, reason }
```

Behavior:
1. **Idempotency / freshness.** Read the active session dir. If `pair-decision.json` exists AND `ltf-bias.json` has a non-empty bias, return `{ wrote:false, reason:"already_final" }`. (A pending bias — null — is *not* final; re-run so a late direction can be earned.)
2. **Paired capture.** `tvAnalyzeFast({ pair: PAIR_DEFAULT, baseline: <primary baseline>, baselineSecondary: <secondary baseline> })`. Same call the LLM open-reaction turn made. On capture failure, return `{ wrote:false, reason:"capture_failed" }` (caller leaves the chain blocked honestly).
3. **Leader.** Read `bundle.pair.leader_evidence` (the CLI already ran `computeLeader`). `leader = leader_evidence.leader || PAIR_PRIMARY`. Write `pair-decision.json` via `surfaceLeaderDecision({ primary, secondary, leader, evidence, reason, session })`.
4. **Bias + open verdict.** Pull the leader's single-symbol bundle (`bundle.pair.symbols[leaderSymbol]`). Run `deriveLtfBiasContext({ bundle: leaderBundle, brief, session, eventTs })`. Write `ltf-bias.json` + `.md` via `surfaceLtfBias({ session, ltf_bias, htf_ltf_alignment, is_retrace_day, entry_model_priority, grade_cap, reasoning, source:"deterministic-finalizer" })`, and `open-reaction.*` via `surfaceOpenReaction` with the verdict. When `deriveLtfBiasContext` returns null bias (pre-resolve or quiet open), write the bias record with `ltf_bias: null` / `"pending"` so the file exists but the readiness gate still blocks — direction is earned on a later bar by the in-memory re-derivation already in `buildDetectorInputs`.

Pure-ish: the capture + file writes are injected via `deps` so unit tests stub them. `computeLeader`/`resolveOpenReaction`/`deriveLtfBiasContext` are real (already unit-tested).

### Wiring in `app/main/bar-close.js` `handleBar`

- **Open-reaction phase** (`phase === "open_reaction"`): replace the LLM hint + `userTurn` with a call to `finalizeOpenReactionDeterministic`, then `return`. No Claude turn during open reaction. Same paired-capture cadence as before (per bar), but deterministic. The finalizer writes the open verdict each bar (live tracker stays fresh) and finalizes leader + bias once the window resolve point passes.
- **Entry-hunt with missing files** (the old `runLeaderCatchupTurn` path at ~476, and the `catch_up` routing at ~588–610): replace the LLM turns with one `finalizeOpenReactionDeterministic` call. It backfills `pair-decision.json` + `ltf-bias.*` deterministically (post-window late-direction included), then entry-hunt resumes next bar. Remove `runLeaderCatchupTurn` and the `isCatchUp` LLM text branch (now dead).
- The in-memory `deriveLtfBiasContext` fallback in `buildDetectorInputs` (~1376) stays as belt-and-suspenders.

## Behavioral change (accepted)

The deterministic resolver emits a real bias or `null` — never `"mixed"`. On a quiet open (no draw, no in-window structure) the day stays **blocked** (honest no-trade) until the first post-window swing earns direction at a B cap — instead of the LLM's `"mixed"` leaving both sides walkable. Stricter on quiet days; strategy-correct (§7 Step 7: a neutral overnight is one weaker element) and backtest-matching. This is the intended effect.

## Out of scope

- Per-bar open-reaction *prose* commentary (was a side effect of the LLM turn). The deterministic verdict is written; optional Codex commentary, off by default, mirrors the brief's posture and can be a follow-up.
- Any change to `backtest-engine.js` / `backtest-grader.js` (owned elsewhere). This PR only *reads* them for parity.
- The brief/wrap/entry-hunt paths (already deterministic).

## Testing

- Unit (`node --test`) on the finalizer with stubbed capture + writers: leader pick (primary/secondary/inconclusive→PAIR_PRIMARY), bias derived vs pending, idempotency skip when final, capture-failure path, backfill (post-window late direction).
- Full `npm test` in the worktree (not the main checkout — tests clobber live state; PR #79 guard).
- Manual: confirm an open-reaction window writes `pair-decision.json` + `ltf-bias.*` + `open-reaction.*` with no `surface_*` LLM tool calls in the metrics.

## Strategy authority

§7 Step 4 (NY-open LTF bias from overnight break/rejection), §7 Step 5 (MSS = the LTF turning), §7 Step 7 (neutral overnight = one weaker element), §2.3 ("never marries a bias" / mid-session realignment). All already implemented in the reused resolvers.
