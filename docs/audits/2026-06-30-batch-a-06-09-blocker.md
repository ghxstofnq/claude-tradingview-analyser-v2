# Batch A — 2026-06-09 NY-AM Option A resolution

**Date:** 2026-06-30

**Scope:** 2026-06-09 NY-AM only. 06-16 and 06-18 alignments are untouched and still expected to stay green.

**Verdict:** **RESOLVED BY OPTION A** — do not force the prior `29731.25 / 29851.50 / A+` target. The active oracle is the first evidence-backed production-general packet: `Inversion short B`, entry `29760`, stop `29818.75`, TP1 `29595.25`, first packet `2026-06-09T14:27:00.000Z`.

## Rejected prior target

From the earlier approval packet:

```text
Inversion short A+ · entry 29731.25 · stop 29851.50 · TP1 29595.25 · TP2 29113.75 · window ~10:29-10:34 ET
```

This target is now rejected as active oracle truth. It is retained here only as provenance for why the row was revised.

## Evidence from the real tape

Folding the real tape (`tests/tapes/2026-06-09-ny-am-replay.tape.json`) through the real chain, before the Option A change, showed the full candidate stream:

```text
10:00 Inv short A+  e=29964.75 s=30027.75(failed_leg_extreme) tp1=29751.25   <- stale latch
10:01 Inv short A+  e=29949.25 s=30013.75
10:05 Inv short A+  e=29956.75 s=30006.50
10:27 Inv short B   e=29760.00 s=29818.75 tp1=29595.25
10:30 Inv short B   e=29736.50 s=29814.25
10:31 Inv short B   e=29684.25 s=29798.25
10:44 Inv short B   e=29633.75 s=29762.75
10:57 Inv short B   e=29427.50 s=29516.25
```

No candidate matches the rejected entry (`29731.25`), stop (`29851.50`), or grade (`A+`). The first defensible candidate is the 10:27 ET `Inversion short B` packet (`29760 / 29818.75 / 29595.25`).

## Why the prior target was rejected

### 1. Entry `29731.25` has no production-general anchor

Verified directly against the tape:

- It closes **no bar** at 1m / 5m / 15m.
- It is **not** an FVG/BPR edge, CE, swing, or level on any timeframe.
- It is only the **1m open of the 10:35 ET bar** (`t=1781015700`, O=29731.25 H=29736 L=29695 C=29702.5).

Every inversion this session confirms on a **close** through a violated bull FVG. The first clean production-supported confirmation after suppressing the stale latch is 10:27 (`close=29760`).

### 2. Stop `29851.50` is not a production inversion stop anchor

`29851.5` appears in the tape as an h1 FVG candle-1-open and as the hand-entered expected stop. It is absent from the 1m inversion stop evidence. The production inversion stop rule reads failed-leg extreme / violating candle / structural swing / zone edge; it does not reach into h1 FVG candle opens for a one-off stop.

### 3. Grade A+ is unsupported by the tape

Day folds as `drawBiasPillar="clear-2of3"`, `aPlusEligible=false`, `bElevatable=true`. A+ would require `hasMultiAlignment()` true — a same-direction took-liq 5m FVG overlapping the 1m entry zone. The evidence does not show that overlap. Therefore the row stays **B**.

### 4. The stale 10:00 latch was still a real defect

At 10:00 the buy-side grab exists, but the open leg is still two-sided chop (`coherence=0.28`), and the packet latches before the real sell-side delivery. Option A ships the production-general reversal coherence gate so that the first executable packet becomes the evidence-backed 10:27 B short.

## Active state after Option A

- `tests/tapes/2026-06-09-ny-am-replay.tape.json` — `verified:true` with the Option A packet.
- `tests/batch-a-06-09-alignment.test.js` — enabled, no longer skipped.
- Production code change: only the production-general reversal coherence gate; no fixture-specific fill, stop, or grade rule was added.

## Required verification

```bash
node --test tests/batch-a-06-09-alignment.test.js tests/batch-a-06-16-alignment.test.js tests/batch-a-06-18-alignment.test.js
npm run tapes
node scripts/fold-pair-leader.mjs
npm run test
```
