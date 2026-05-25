# Leader / Laggard Dual-Scan — Design (v1)

**Date:** 2026-05-24
**Status:** Draft — design awaiting implementation plan
**Related:**
- Strategy authority — [`docs/strategy/trading-strategy-2026.md`](../../strategy/trading-strategy-2026.md), [`docs/strategy/entry-models.md`](../../strategy/entry-models.md)
- Research basis — [`docs/research/ai-trading-analysis.md`](../../research/ai-trading-analysis.md)
- ICT engine migration that established the parsed-engine data source — [`docs/plans/2026-05-21-ict-engine-migration.md`](../../plans/2026-05-21-ict-engine-migration.md)
- LLM-driven session architecture this extends — [`docs/plans/llm-driven-session.md`](../../plans/llm-driven-session.md)

---

## 1. Summary

Today the analysis pipeline reads one symbol — whatever is loaded on the TradingView Desktop chart on CDP port 9223. This design adds a **dual-symbol scan** for the pre-session prep through the 15-minute NY open reaction. After the open reaction finishes, code mechanically picks the "leader" (the symbol with the strongest displacement during the reaction window) and the rest of the session runs single-symbol on the leader.

**Why:** correlated indices (MNQ / MES) often diverge at the open — one runs liquidity first, the other lags. The leader is the cleanest read; trading it gives a higher-conviction signal than averaging the two. This is the SMT (Smart Money Tactic) read — a real ICT technique not currently encoded in the project strategy docs. This design adds it as a pre-flight step before the existing 7-step checklist runs.

**Constraints honored:**
- CLI-only (no MCP tools). The dual-scan extends `tv analyze`.
- No LLM arithmetic. Leader is computed in `cli/lib/compute-leader.js`, never inferred by Claude.
- Cite-or-reject. Every leader-evidence price resolves at a real JSON path in the bundle.
- Grade enum unchanged (`A+ | B | no-trade`). Leader is a separate concept from grade.

---

## 2. v1 scope

**In:**
- `tv analyze --pair <primary>,<secondary>` CLI flag.
- New lib `cli/lib/compute-leader.js` — pure function: bundles in, leader verdict + evidence out.
- New per-session persistence file `state/session/<date>/<session>/pair-decision.json`.
- Per-symbol baseline files: `state/baseline-<symbol>.json` replacing the single `state/baseline.json`.
- New MCP tool `surface_leader_decision` exposed to in-app Claude.
- Phase-aware prompt updates in `app/main/prompts/analyze.md` (pre-session, open-reaction, entry-hunt).
- Documentation: this spec + a follow-up changelog entry in `docs/tradingview-cookbook.md`.

**Out (deferred):**
- More than 2 symbols (quadruple-scan across MNQ / MES / RTY / YM).
- Trading the laggard after leader confirms (classic SMT entry on the lagging index). v1 trades the leader.
- Configurable leader rule (swap displacement for structure-first or sweep-first). v1 uses displacement only.
- Per-symbol Pillar 2 thresholds for the secondary symbol — `cli/lib/pillar2-thresholds.js` has only MNQ calibrated. MES will emit `range_acceptable: null` until calibrated.
- Multi-tab approach (one tab per symbol). v1 uses one chart with code-driven symbol switching.
- Alert auto-arming on laggard structure levels.

---

## 3. Architecture

Three new components and three changed components.

### New

1. **CLI flag `--pair` on `tv analyze`** (changes `cli/commands/analyze.js`).
   When present, the analyze command captures the primary symbol's bundle (existing logic), then calls `chart.setSymbol({symbol: secondary})`, captures again, then restores the primary. Output bundle gains a `pair: {...}` block.

2. **`cli/lib/compute-leader.js`** — new module exporting one pure function:
   ```
   computeLeader({primary, secondary, primaryBundle, secondaryBundle, windowStartMs, windowEndMs, threshold = 0.10})
     → { leader, primary_disp_score, secondary_disp_score, margin, reason }
   ```
   The function scans `pair.symbols[X].engine.fvgs[]` for FVGs with `created_ms >= windowStartMs && created_ms < windowEndMs`, finds the max `disp_score` per symbol, returns the symbol with the higher score. If `|primary_score - secondary_score| < threshold`, returns `leader: null, reason: "inconclusive_margin_below_threshold"`.

3. **`surface_leader_decision` MCP tool** registered in `app/main/sdk.js`. Schema:
   ```
   { primary, secondary, leader, evidence: { primary_disp_score, secondary_disp_score, margin } }
   ```
   Writes `state/session/<date>/<session>/pair-decision.json`. Called by in-app Claude at minute 14 of the open-reaction phase (alongside the existing `surface_ltf_bias` tool).

### Changed

4. **`cli/commands/analyze.js`** — three changes:
   - Add `--pair` flag.
   - Before running, check `state/session/<today>/<session>/pair-decision.json`. If present AND `leader` is set AND `decided_at` is today's ET date, set the chart symbol to the leader (if not already there) and skip the dual capture even when `--pair` is passed.
   - When dual-capturing, write the bundle's `pair: {...}` block. Always restore the chart's original symbol on completion (mirror the existing TF-restore pattern).

5. **`app/main/prompts/analyze.md`** — phase blocks updated:
   - **Pre-session phase**: when `pair` is in the bundle, write one `pillar1.md` + one `pillar2.md` that synthesize both symbols comparatively. Single grade applies to the pair.
   - **Open-reaction phase**: continue dual-scanning; surface `pair.leader_evidence` in chat at each bar. At minute 14, call `surface_leader_decision(...)` alongside `surface_ltf_bias(...)`.
   - **Entry-hunt phase**: when `pair-decision.json` exists, the bundle is single-symbol on the leader. Run normal entry-hunt unchanged.

6. **Baseline file naming** — `cli/commands/analyze.js`'s `--baseline` resolution becomes per-symbol: pass `--baseline state/baseline-MNQ1!.json` for primary, `--baseline state/baseline-MES1!.json` for secondary. Backward compatibility: if only the old single `state/baseline.json` exists, treat it as the primary's baseline and emit a one-line warning.

---

## 4. Data flow per session

### T-15min before NY open (pre-session)

1. User triggers pre-session via chat or scheduled run.
2. CLI runs: `tv analyze --pair MNQ1!,MES1! --out state/last-analyze.json`.
3. Multi-TF sweep on primary, switch to secondary, multi-TF sweep, restore. ~30s total.
4. Bundle gains `pair.symbols.{MNQ1!, MES1!}` with both symbols' full per-TF data + `pair.leader_evidence` (empty: window hasn't started).
5. In-app Claude reads the bundle, writes `pillar1.md` + `pillar2.md` synthesizing both symbols. One grade for the pair.
6. `pair-decision.json` does not exist yet.

### NY open + 0–15 min (open-reaction)

1. Bar-close detector fires on every 1m + 5m close.
2. CLI runs: `tv analyze --pair --pillar3-only --baseline state/baseline-MNQ1!.json --baseline-secondary state/baseline-MES1!.json --out state/last-analyze.json`.
   - Fast capture: switch + read for each symbol (~1–2s).
3. Bundle has both symbols. `pair.leader_evidence` updates each bar with max `disp_score` per symbol from FVGs created since the open started.
4. Claude updates `open-reaction.md` (running log) describing both symbols.
5. At minute 14, Claude calls `surface_leader_decision(...)`:
   - Tool writes `pair-decision.json` with leader + evidence.
   - Tool also writes a `leader_symbol` field into the existing `ltf-bias.md`.

### NY open + 15min onwards (entry-hunt)

1. Bar-close detector keeps firing.
2. CLI runs: `tv analyze --pillar3-only --baseline state/baseline-<leader>.json --out state/last-analyze.json`.
3. Before capture, CLI reads `pair-decision.json`. If chart symbol != leader, calls `setSymbol(leader)`. Then captures single-symbol.
4. Bundle is single-symbol (the leader). No `pair` block. Same shape as today.
5. Claude walks the three entry models on the leader. Existing entry-hunt flow unchanged.

### Post-session (wrap)

1. Existing `summary.md` flow is unchanged.
2. The session-summary prompt notes the leader symbol and the leader evidence margin in the `bias_picture` paragraph.

---

## 5. Bundle shape changes

### Existing single-symbol bundle (unchanged when `--pair` not passed)

```json
{
  "timestamp": "...",
  "chart": {...},
  "quote": {...},
  "bars": {...},
  "bars_by_tf": {...},
  "engine": {...},
  "engine_by_tf": {...},
  "gates": { "session": {...}, "engine": {...} }
}
```

### New dual-symbol bundle (when `--pair` is passed AND pair-decision.json doesn't exist)

```json
{
  "timestamp": "...",
  "chart": {...},                    // primary's chart state (back on primary after restore)
  "quote": {...},                    // primary's quote
  "bars": {...},                     // primary
  "bars_by_tf": {...},               // primary
  "engine": {...},                   // primary
  "engine_by_tf": {...},             // primary
  "gates": {...},                    // primary

  "pair": {
    "primary": "MNQ1!",
    "secondary": "MES1!",
    "window_start_ms": 1748178000000,   // NY open ms epoch; null pre-session
    "window_end_ms": 1748178900000,     // NY open + 15 min; null pre-session
    "symbols": {
      "MNQ1!": {                        // primary's full bundle (mirrors top-level fields)
        "chart": {...},
        "quote": {...},
        "bars": {...},
        "bars_by_tf": {...},
        "engine": {...},
        "engine_by_tf": {...},
        "gates": {...}
      },
      "MES1!": {                        // secondary's full bundle
        "chart": {...},
        "quote": {...},
        "bars": {...},
        "bars_by_tf": {...},
        "engine": {...},
        "engine_by_tf": {...},
        "gates": {...}
      }
    },
    "leader_evidence": {
      "primary_disp_score": 0.82,       // max disp_score on FVGs created in window
      "secondary_disp_score": 0.54,
      "margin": 0.28,
      "primary_fvg_path": "pair.symbols.MNQ1!.engine.fvgs[3].disp_score",  // resolves to 0.82
      "secondary_fvg_path": "pair.symbols.MES1!.engine.fvgs[1].disp_score" // resolves to 0.54
    },
    "leader_decided": false,            // true once pair-decision.json is written
    "leader": null                      // null pre-decision; symbol string after
  }
}
```

The top-level `chart`, `quote`, `bars`, `gates`, etc. duplicate `pair.symbols.<primary>.*` for backward compatibility — existing consumers (the dashboard, fixture verifier, single-symbol prompt code) keep working without changes.

### pair-decision.json

```json
{
  "schema": 1,
  "date": "2026-05-25",
  "session": "ny-am",
  "primary": "MNQ1!",
  "secondary": "MES1!",
  "leader": "MNQ1!",
  "decided_at": "2026-05-25T13:45:00Z",
  "evidence": {
    "primary_disp_score": 0.82,
    "secondary_disp_score": 0.54,
    "margin": 0.28,
    "threshold": 0.10
  },
  "reason": "primary_higher_disp_score"
}
```

When `leader: null`, `reason` is one of: `inconclusive_margin_below_threshold` | `secondary_engine_missing` | `no_fvgs_created_in_window`.

---

## 6. Leader rule (mechanical definition)

The leader is **the symbol with the highest `disp_score` on any FVG created during the open-reaction window**.

- Window: `[window_start_ms, window_start_ms + 15*60*1000)` ms epoch, where `window_start_ms` is the session's NY open time (from `gates.session.timestamp_et` for the session, converted to UTC ms).
- For each symbol, scan `engine.fvgs[]` filtering to FVGs whose `created_ms` falls inside the window AND whose `disp_score` is a finite number (ignore `null` / `undefined` / `NaN`).
- Take `max(disp_score)` per symbol over the filtered set.
- If a symbol's filtered set is empty (no FVGs created in window with a usable score), its score is `0`.
- Compare. The higher score's symbol is the leader, provided `|primary_score - secondary_score| >= 0.10`.
- If margin < 0.10 → `leader: null`, `reason: "inconclusive_margin_below_threshold"`.
- If both scores are `0` → `leader: null`, `reason: "no_fvgs_created_in_window"`.
- If the secondary's bundle has `engine == null` (the ICT Engine indicator isn't loaded on that symbol's chart) → `leader: null`, `reason: "secondary_engine_missing"`. Loud warning emitted to stderr.

Threshold (`0.10`) is a hardcoded constant in `cli/lib/compute-leader.js`. Tune by changing one number.

---

## 7. Edge cases + failure modes

| Case | Handling |
|---|---|
| ICT Engine missing on secondary symbol | `leader_evidence.secondary_disp_score = null`; `compute-leader` returns `leader: null, reason: "secondary_engine_missing"`. Warning logged. Entry hunt falls back to primary. |
| Tie (margin < 0.10) | `leader: null, reason: "inconclusive_margin_below_threshold"`. Persisted to pair-decision.json so re-runs don't re-compute. Entry hunt falls back to primary. |
| No FVGs created in window (either symbol) | `leader: null, reason: "no_fvgs_created_in_window"`. Same fallback. |
| Chart currently on neither primary nor secondary when `--pair` runs | CLI errors loudly: `--pair expects chart to be on one of [MNQ1!, MES1!]; got FOO`. No silent symbol swap. |
| Pair-decision.json from a previous day | CLI compares `date` field against today's ET date; ignores if stale and treats this session as fresh. |
| Old single `state/baseline.json` from before this change | Treated as the primary's baseline. One-line warning suggests migrating to the per-symbol naming. |
| Pre-session re-run with pillar files already present | Existing behavior: skip re-grading, arm the loop. No additional `pair` work needed since the files already synthesize both symbols. |
| Symbol-switch settle time | Use `SYMBOL_SETTLE_MS = 600` constant (slightly higher than the existing `TF_SETTLE_MS = 400`). Indicator re-renders are heavier than TF redraws. |
| User wants to override the leader pick mid-session | Manually delete `pair-decision.json` and re-run analyze with `--pair`. Out of scope for automation in v1. |

---

## 8. Implementation order

1. Add `compute-leader.js` lib + unit tests (pure function, easy to test in isolation).
2. Add `--pair` flag to `tv analyze`, write the `pair: {...}` block in the bundle. Restore-symbol logic + symbol-settle delay.
3. Per-symbol baseline file naming + backward-compat fallback.
4. Add `surface_leader_decision` MCP tool + `pair-decision.json` writer.
5. Update `tv analyze` to short-circuit dual-capture when `pair-decision.json` exists.
6. Update `app/main/prompts/analyze.md` phase blocks.
7. Add a fixture exercising the new code path (paired-bundle + expected leader call).
8. Update `docs/tradingview-cookbook.md` with the changelog entry.

Each step independently testable; each step shipped behind verified smoke tests.

---

## 9. Out of scope (deferred follow-ups)

- **Trade the laggard.** The textbook SMT play is to enter on the laggard once the leader confirms. v1 trades the leader. Switching is a future strategy doc change + entry-hunt prompt change.
- **Multi-symbol (>2).** Adding RTY / YM / etc. is a generalization of the same plumbing; v1 locks to 2.
- **Configurable leader rule.** v1 = displacement only. Swappable to structure-first or sweep-first by changing `compute-leader.js`; no API change.
- **MES Pillar 2 calibration.** `cli/lib/pillar2-thresholds.js` needs an MES entry. Until added, MES emits `range_acceptable: null` (existing behavior for uncalibrated symbols).
- **Strategy doc update.** This design adds a pre-flight step that isn't in `docs/strategy/trading-strategy-2026.md`. A future doc PR should encode the leader/laggard step as a strategy formality if it proves out in practice.
- **Alerts on laggard structure.** Auto-arming alerts at the laggard's equivalent levels for SMT trades.

---

## 10. References

- Project rules (CLAUDE.md): CDP 9223 only; CLI only; no LLM arithmetic; cite-or-reject; prose-first JSON-last; grade enum `A+ | B | no-trade`.
- Research basis (`docs/research/ai-trading-analysis.md`): hybrid extraction-then-synthesis beats LLM-only; arithmetic error grows with magnitude; verbal-confidence calibration is unreliable.
- Strategy authority (`docs/strategy/trading-strategy-2026.md` §2.3): "Lanto never marries a bias. HTF gives a macro direction, but immediate trades are decided by how NY reacts to overnight levels." This design operationalizes the "how NY reacts" step by surfacing cross-asset evidence.
