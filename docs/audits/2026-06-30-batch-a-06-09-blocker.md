# Batch A — 2026-06-09 NY-AM walker-alignment blocker

**Date:** 2026-06-30
**Scope:** 2026-06-09 NY-AM only. 06-16 and 06-18 alignments (commits `eb2a4ea`, `dde86ce`) are untouched and still green.
**Verdict:** **BLOCKED — needs user modeling decisions / new evidence before the chain can emit the approved oracle.** No production change shipped. A focused regression test was added but `skip`ped (with this report cited) so the suite stays green and no red gate is faked.

## Approved oracle (target)

From `docs/audits/recent-oracle-packets/2026-06-09-ny-am.md` and `docs/strategy/lanto-oracle.md:164-184`:

```
Inversion short A+ · entry 29731.25 · stop 29851.50 · TP1 29595.25 · TP2 29113.75 · window ~10:29-10:34 ET
```

## What the chain emits today

Folding the real tape (`tests/tapes/2026-06-09-ny-am-replay.tape.json`) through the real chain (`buildDeterministicPacketTruthFromInputs`):

- First (and only surviving) packet: **10:00 ET Inversion short A+ entry 29964.75 stop 30027.75 tp1 29751.25**. The session primary-trade latch then suppresses every later packet.
- With the latch disabled (diagnostic only, reverted), the full candidate stream is:

```
10:00 Inv short A+  e=29964.75 s=30027.75(failed_leg_extreme) tp1=29751.25   <- latches
10:01 Inv short A+  e=29949.25 s=30013.75
10:05 Inv short A+  e=29956.75 s=30006.50
10:27 Inv short B   e=29760.00 s=29818.75 tp1=29595.25
10:30 Inv short B   e=29736.50 s=29814.25
10:31 Inv short B   e=29684.25 s=29798.25
10:44 Inv short B   e=29633.75 s=29762.75
10:57 Inv short B   e=29427.50 s=29516.25
```

No candidate matches the approved entry (29731.25), stop (29851.50), or grade (A+).

## Why this is not a one-rule fix — evidence

The approved packet needs FOUR coordinated changes. Three of them have no production-general anchor in the evidence the walker consumes.

### 1. Entry 29731.25 has NO structural anchor (hard blocker)

Verified directly against the tape:

- It closes **no bar** at 1m / 5m / 15m.
- It is **not** an FVG/BPR edge, CE, swing, or level on **any** timeframe.
- It is only the **1m open of the 10:35 ET bar** (`t=1781015700`, O=29731.25 H=29736 L=29695 C=29702.5). In the raw tape `29731.25` appears as `"open"` (25×, the same bar repeated across `last_5_bars`) and as a `c1o` candle-1-open; the lone `"entry": 29731.25` is the hand-entered expected block itself.

Every inversion this session confirms on a **close** through a violated bull FVG. The nearest real confirmations are 10:27 (close 29760 = CE of the inverted 29743-29776 zone), 10:30 (close 29736.5), 10:31 (close 29684.25). The current entry rule (confirmation close) and the 06-18 rule (gap CE) both yield different numbers. To land 29731.25 you would have to adopt a new fill rule (violating-candle **open**, or next-bar open) **and** make the chain pick the specific 10:35 bar over the earlier same-zone inversions — that selection is fixture-specific, has no transcript basis, and would change entries on every other inversion day (06-16 / 02-09 + the fold corpus).

The oracle's own text is internally inconsistent here: it labels 29731.25 a "1m inversion close," but no 1m bar closes at that price. The actual fill rule the oracle intends is undefined.

### 2. Stop 29851.50 is an h1 FVG candle-1-open, not a level the inversion stop rule reads

`29851.5` appears in the entire tape only as:
- `"c1o": 29851.5` (92×) — the candle-1-open of an **h1 (1-hour) inverted bull FVG `[29763-29820.5]`** (`engine_by_tf.h1`), and
- `"stop": 29851.5` (1×) — the hand-entered expected block.

`inversionStructuralStop()` selects from 1m leg-extreme / violating-candle / structural-swing / zone-edge. It never reads HTF-FVG candle-1-opens. The number is absent from all 1m evidence. The oracle's rationale ("above the 29836 retrace swing") points at a **different** level — the 1m bear FVG top `29836.75` — ~15 pts away from where the number actually lives. So even the intended stop anchor is ambiguous (1m bear-FVG top vs h1-FVG c1o). Reaching into `engine_by_tf.h1` for an inversion stop is a new cross-timeframe mechanism that needs full-corpus validation and an explicit rule, not a sort tweak.

### 3. Grade A+ requires multi-alignment that the evidence does not support

Day folds B: `drawBiasPillar="clear-2of3"`, `aPlusEligible=false`, `bElevatable=true`. A+ would need `hasMultiAlignment()` true — a same-direction (bear) 5m FVG that **took liquidity** overlapping the 1m entry zone `[29703.75-29736.5]`. The nearest bear 5m FVG that took liq is `[29807.5-29916.75]`, ~70 pts above; it does not overlap. So the "two-and-one" the oracle cites is not detectable from the 5m FVG evidence at the entry zone under the current model.

### 4. The one defensible clean change does not reach the target

Suppressing the stale 10:00/10:01/10:05 early inversions is principled — at 10:00 the down-move is not established: `coherence=0.28` (chop), `atr14=13.25`, leg only ~80 pts (30040.75→29961), no sell-side session grab yet (LO.L sweeps at 10:27, AS.L at 10:45), and the most-recent swing-tier structure is still a **bull** BoS@30035.75. Suppressing them moves the first packet to ~10:27 — but that packet is **entry 29760 / stop 29818.75 / B**, which still does not match the oracle. Shipping suppression alone (a) does not align the day and (b) shifts the fold corpus for a target it cannot reach — that violates "fold before trusting a separator" and the no-scope-creep rule, so it is left unshipped and listed as a recommendation below.

## What is needed to unblock (user decisions / evidence)

1. **Entry fill rule.** Define, in production-general terms, what price an Inversion enters at and which bar confirms — because 29731.25 is a bar open, not a close/CE/edge. Options to choose between: confirmation close (current), gap CE (06-18), violating-candle open, or next-bar open. Whatever is chosen must fold clean across 06-16 / 02-09 / the corpus.
2. **Stop anchor rule.** Decide whether an Inversion stop may anchor on an HTF (h1) FVG candle-1-open (29851.5), or on the 1m bear-FVG top the oracle's prose names (29836.75 + buffer), or the existing 1m structural pool. These give different stops; the oracle's prose and the actual number disagree.
3. **A+ basis.** Confirm whether the "two-and-one" elevation should fire here given that no bear 5m took-liq FVG overlaps the 1m entry zone, or supply the chart evidence for the pairing.
4. Optional but recommended regardless: approve the stale-early-inversion suppression (coherence / sell-side-delivery gate) as its own validated change, since the 10:00 latch is a real fidelity defect independent of the exact oracle numbers.

Until 1-3 are resolved, the approved entry/stop/grade cannot be produced without fixture-specific hardcoding (forbidden), so `2026-06-09-ny-am-replay.tape.json` stays `verified:false` and the focused test stays `skip`ped.

## Current state (unchanged / green)

- `tests/tapes/2026-06-09-ny-am-replay.tape.json` — `verified:false` (kept; the gate skips it).
- 06-16 / 06-18 focused tests — pass. 06-17 no-trade / 02-09 verified tapes — pass.
- No production code changed. Diagnostic latch toggle used during investigation was reverted (`git diff` clean on `deterministic-strategy.js`).
