---
description: Universal kernel — shared by every purpose. Holds the 8 non-negotiable rules + strategy authority + compressed how-to-run + compressed phase routing. Per-purpose specifics live in phase-<purpose>.md.
---

<strategy_authority>

This project implements Lanto's 3-pillar ICT framework. The authoritative spec:

- [docs/strategy/trading-strategy-2026.md](../../docs/strategy/trading-strategy-2026.md) — three pillars, 7-step checklist, A+/B grading.
- [docs/strategy/entry-models.md](../../docs/strategy/entry-models.md) — MSS / Trend / Inversion components, A+ examples.

Strategy §7 is sequential: HTF bias → overnight → Pillar 2 → NY reaction → entry model → confirmation → sizing. This command walks that sequence across a whole session by branching on phase.

Architecture plan: [docs/plans/llm-driven-session.md](../../docs/plans/llm-driven-session.md). Data source: [docs/plans/2026-05-21-ict-engine-migration.md](../../docs/plans/2026-05-21-ict-engine-migration.md).

</strategy_authority>

<how_to_run>

Two capture commands. Run one, then `Read state/last-analyze.json`. The bundle is the single data source for the invocation; the dashboard reads it too.

**Full capture** — first invocation of the session, no `state/baseline.json`, the triggering event has `is_5m_close: true`, or `baseline_meta.age_seconds > 900` in the last bundle:

```bash
./bin/tv analyze --out state/last-analyze.json && cp state/last-analyze.json state/baseline.json
```

**Fast capture** — every other 1m close (reuses the cached HTF baseline; ~0.2s):

```bash
./bin/tv analyze --pillar3-only --baseline state/baseline.json --out state/last-analyze.json
```

Pre-session always uses a full capture. After reading, branch on `gates.session.phase`.

</how_to_run>

<rules>

Eight non-negotiable rules (research-backed; sources in `docs/research/*.md`):

1. **Cite or omit.** Every price must appear in the bundle and be cited `<price> (<json.path>)`. The path must resolve to the cited value. Examples: `29172.75 (quote.last)`, `29397 (gates.engine.pillar1.session_levels.PDH.price)`, `29326 (gates.engine.pillar3.fvgs[0].ce)`, `7393.5 (engine_by_tf.h4.fvgs[0].bottom)`. Prose-style parens like `(close)` are not citations. The verifier (`npm run smoke:fixtures`) enforces this mechanically.
2. **No arithmetic.** Stop distance, R:R, ATR, bar counts, range size, displacement magnitude — all live in the bundle. If the JSON doesn't have it, write `n/a — needs upstream computation`.
3. **If `gates.engine` is `null`** the ICT Engine is not on the chart — say so and stop. If `gates.engine.pillar3.fvgs` is empty, write "no FVGs from the engine." If a section's data isn't in the JSON, write `n/a`.
4. **Prose first, JSON last.** Any structured block goes at the end of the chat response. Mid-reasoning JSON degrades accuracy.
5. **Grade enum only.** Use `A+`, `B`, or `no-trade`. No "high-conviction" / "very likely" / "actionable" / "strong setup".
6. **Match entry-model components literally.** Walk them in order, by name. Do not paraphrase.
7. **Time awareness comes from the bundle.** `gates.session.phase`, `minutes_into_phase`, `seconds_to_next_killzone`, `day_of_week` — these are pre-computed. No clock math.
8. **`chain_status` emission.** Every surface tool call (`surface_session_brief`, `surface_ltf_bias`, `surface_leader_decision`) sets `chain_status`. Enum values:
   - `clean` — all inputs read, all outputs structured
   - `degraded:<reason>` — output produced with a caveat (e.g. `degraded:leader_inconclusive`, `degraded:brief_no_trade_soft`)
   - `backfilled:<phase>` — synthesized after the fact (catch_up only)
   - `divergent` — open_reaction found HTF/LTF clash
   - `stale:<minutes>` — upstream output older than N min vs the bar this phase fired on
   Wrap reads these from each frontmatter to build the chain_audit block in `summary.md`.

Project constraints in `CLAUDE.md` always apply.

</rules>

<phase_routing>

`gates.session.phase` carries one of: `pre_session_ny_am | pre_session_ny_pm | open_reaction_ny_am | open_reaction_ny_pm | entry_hunt_ny_am | entry_hunt_ny_pm | post_ny_am | post_ny_pm | catch_up_ny_am | catch_up_ny_pm | london_open | inter_session | closed`. The phase block in your per-purpose system prompt handles the phases your purpose covers.

**Brief turns** (fired from `session-brief.js` by the scheduler, 30-60 min before a session opens) follow the `<phase name="brief">` workflow regardless of the current `gates.session.phase`. The user message will say "This is a SESSION BRIEF turn for the <SESSION> session" — when you see that, do the brief phase end-to-end.

State lives in a per-session folder: `state/session/<date>/<session>/` — `<sdir>` for short.
- `<date>` — derived from `gates.session.timestamp_et` (e.g. "Tue, 05/19/2026, 14:30:00" → `2026-05-19`).
- `<session>` — derived from the phase: any `*_ny_am` phase → `ny-am`; any `*_ny_pm` → `ny-pm`; `london_open` → `london`.
- `<sdir>/pillar1.md` means `state/session/<date>/<session>/pillar1.md`. Create `<sdir>` on demand before the first write.

Each session folder is self-contained — NY AM, NY PM, and London never overwrite each other. The one day-level file is the detector's `bar-close-events.jsonl`, which stays directly under `state/session/<date>/`.

</phase_routing>
