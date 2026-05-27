<anti_patterns>

The following 8 misreads happened in real sessions and produced bad output. The detector now prevents most of them structurally, but if you ever find yourself doing one of these, stop and re-read `<candidate_object>`.

**❌ "FRESH FVG" DOES NOT MEAN "RETESTED".**
   `engine.fvgs[N].state: "fresh"` + `created_ms` in the last 1-3 bars means the pullback has not happened yet. The 3 candles around `created_ms` CREATED the FVG, they did not retest it. The detector's `retrace_to_fvg.present` checks `price_context.inside_fvgs[]` — trust that.

**❌ "REACTED" DOES NOT MEAN "RETESTED".**
   `reacted: true` (now exposed as `displacement_at_creation: true` after disambiguation) = the impulse that CREATED the FVG was clean. It does NOT mean a later pullback tested the zone.

**❌ SWEPT LEVELS ARE NOT VALID TARGETS.**
   `gates.engine.pillar1.session_levels.<LEVEL>.swept: true` (or `taken: true`) means the level was already taken. NEVER cite as TP. The detector's `tp1` / `tp2` pull from `untaken_above[]` / `untaken_below[]` only.

**❌ FVG-BOTTOM STOP IS A LAST-RESORT FALLBACK.**
   Strategy priority for FVG entries: candle 1 low of the 3-candle FVG formation > pullback swing low > FVG bottom. The detector pre-ranks all three in `stop_options[]`. Pick `stop_options[0]` unless its cite fails to resolve.

**❌ LOCKED LTF BIAS DOES NOT FORCE DIRECTION.**
   `ltf_bias.bias` is a snapshot at the leader-decision moment, not a lock for the entire session. The detector's `side` is computed from HTF destination + current engine state — trust its side pick over a stale LTF bias.

**❌ PHASE TAG IS DERIVED FROM ET CLOCK, NOT WRITTEN BY MODEL.**
   Do not author `"phase: open_reaction_ny_pm"` at 13:09 ET (21 min before NY PM open at 13:30). The phase is set by `surface.js` based on the live ET clock.

**❌ SIZING IS PRE-COMPUTED, NEVER FABRICATED.**
   `sizing_note` must come from the `<sizing_pre_computed>` block in the brief prompt, citing `memory.USER` or `strategy.sizing-table`. Do not write a prose-level sizing claim like "Tuesday standard."

**❌ NEVER PROMOTE GRADE PAST `grade_capped`.**
   If detector emits `grade_capped: B`, surfacing `grade: A+` will be rejected by the validator. Use `grade_capped` directly.

</anti_patterns>
