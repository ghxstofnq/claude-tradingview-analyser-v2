# Batch A walker-alignment blocker report — 2026-06-29

> 2026-06-30 update: the 06-09 blocker below is superseded by Option A. The active 06-09 oracle is the evidence-backed `Inversion short B` packet (`29760 / 29818.75 / 29595.25`, first packet `2026-06-09T14:27:00Z`), not the rejected `29731.25 / 29851.50 / A+` target. See `docs/audits/2026-06-30-batch-a-06-09-blocker.md`.

## Context

User approved Batch A oracle packets from `docs/audits/recent-oracle-packets/` and asked to align the deterministic walker chain so the approved rows can be flipped back to `verified:true`.

A tight red replay check was created locally against:

- `tests/tapes/2026-06-09-ny-am-replay.tape.json`
- `tests/tapes/2026-06-16-ny-am-replay.tape.json`
- `tests/tapes/2026-06-17-ny-am-replay.tape.json`
- `tests/tapes/2026-06-18-ny-am-replay.tape.json`

Command used:

```bash
node --test tests/batch-a-approved-oracle.test.js
```

The red check was **not committed** because it would make `npm run test` fail until the unresolved modeling decisions below are resolved.

## Current fold vs approved oracle

### 2026-06-09 NY-AM

Approved oracle:

```text
Inversion short A+
entry 29731.25
stop 29851.50
tp1 29595.25
tp2 29113.75
valid window ~10:29–10:34 ET
```

Current deterministic packets:

```text
10:00 Inversion short A+ entry 29964.75 stop 30027.75 tp1 29751.25
10:01 Inversion short A+ entry 29949.25 stop 30013.75 tp1 29751.25
10:05 Inversion short A+ entry 29956.75 stop 30006.50 tp1 29751.25
10:27 Inversion short B  entry 29760.00 stop 29818.75 tp1 29595.25
10:30 Inversion short B  entry 29736.50 stop 29814.25 tp1 29302.50
10:31 Inversion short B  entry 29684.25 stop 29798.25 tp1 29302.50
10:44 Inversion short B  entry 29633.75 stop 29762.75 tp1 29302.50
10:57 Inversion short B  entry 29427.50 stop 29516.25 tp1 28779.00
```

Key blocker:

- The approved `29731.25` is present in the tape as the **open** of the 10:35 ET bar, not as the current chain's confirmation close.
- The production execution packet currently enters from `confirmationPayload.close`, so it cannot emit `29731.25` without a model decision to use next-bar-open / limit-fill semantics for this oracle row.
- The approved `29851.50` stop is present in higher-timeframe FVG evidence, not in the current structural-stop pool used by `inversionStructuralStop`.

Conclusion: do **not** flip this tape to `verified:true` yet. A production change would need to define a non-close fill rule and an HTF-array stop anchor for this exact kind of two-imbalance A+ inversion.

### 2026-06-16 NY-AM

Approved oracle:

```text
MSS / Reversal FVG short B
entry 30864.25
stop 30896
tp1 30783
tp2 30561.75
first packet 09:57 ET
```

Current deterministic packets:

```text
09:57 Trend short B     entry 30864.25 stop 30889.00 tp1 30750.75 tp2 30561.75
10:14 Inversion short B entry 30821.00 stop 30856.25 tp1 30561.75 tp2 30561.75
10:54 Trend short B     entry 30640.50 stop 30672.50 tp1 30561.75 tp2 30561.75
```

Key blocker:

- The entry and side/grade are aligned at 09:57, but the lifecycle is `Trend`, not `MSS`.
- The current MSS lifecycle spawns on an older bear FVG (`zone:30942.75-30943.25`) and is killed by `mss_premise_invalidated_new_high`; it never attaches to the 09:57 FVG-retrace zone (`zone:30883.75-30894.25`).
- TP1 selection prefers an intraday swing (`30750.75`) over the approved session/draw target (`30783`).

Conclusion: this can likely be fixed with production rules, but not by a one-line sort change. It needs MSS reversal-zone selection and target-priority clarification for MSS/reversal rows.

### 2026-06-17 NY-AM

Approved oracle:

```text
No trade — price-quality veto despite bearish read.
```

Current deterministic fold:

```text
passes no_trade
```

Conclusion: this row remains safe as `verified:true`.

### 2026-06-18 NY-AM

Approved oracle:

```text
Trend / Continuation long B
entry 30452.75
stop 30400
tp1 30615
window ~09:46 ET
```

Current deterministic packets:

```text
09:43 Inversion long B entry 30470.25 stop 30411.00 tp1 30615
09:50 Inversion long B entry 30496.50 stop 30422.75 tp1 30615
```

Key blocker:

- The current chain treats the reclaim as an `Inversion` continuation instead of a `Trend` continuation.
- The approved `30452.75` is the CE / reclaim price of the dip-reclaim bull FVG, not the current inversion confirmation close.
- The approved `30400` stop is present in the raw FVG evidence, but the current trend/inversion stop rules select nearer runtime structure (`30411` / `30422.75`).

Conclusion: this needs a production rule for sloppy aligned-bias trend continuation that can enter at the CE/reclaim price and anchor to the FVG/dip invalidation level instead of the inversion close.

## Decision

I did **not** flip 06-09 / 06-16 / 06-18 back to `verified:true`, because doing so now would make the green tape gate claim the production chain emits packets it does not actually emit.

Safe current state remains:

- `2026-06-17` verified no-trade row is valid.
- `2026-06-09`, `2026-06-16`, `2026-06-18` keep their approved expected packets but remain `verified:false` pending one of:
  1. deeper production model work, or
  2. an explicit fixture-authority override path that is clearly separate from live walker truth.

## Verification after this report

Run after removing the local red test:

```bash
git diff --check
node scripts/fold-pair-leader.mjs
npm run tapes
npm run test
```
