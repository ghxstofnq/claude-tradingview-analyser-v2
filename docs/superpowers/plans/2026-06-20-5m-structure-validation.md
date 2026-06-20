# Plan — 5m LTF structure, validated before ship

**Intent:** [docs/intent/2026-06-20-5m-structure-validation.md](../../intent/2026-06-20-5m-structure-validation.md)

**Goal:** Make the walker read LTF structure (swings, MSS/BoS, the tapped FVG/iFVG zone,
structural stops, intraday TP pivots) from **5m**, while the **1m** stays the entry trigger
(tap + confirming close). Prove it on the corpus **before** it goes live.

**Architecture (today, from code audit):**
- Live loop folds on **1m** only (`app/main/bar-close.js` — "the fold TF is 1m today").
- `buildStrategyBundleForRuntime` → `buildStrategyContext` sources swings / MSS / FVGs /
  `structural_stops` from `bundle.gates.engine.pillar3` = the **current-TF (1m)** engine.
- The hunt scan is pillar3-only (current TF), so `engine_by_tf.m5` is **null** during the
  hunt → 5m structure isn't captured at all today.
- Tapes (`tests/tapes/*.tape.json`, recorded by `cli/lib/tape-recorder.js`) carry the **1m**
  engine table per bar — they cannot test a 5m read without new capture.

**Strategy of the change:** add a `STRUCTURE_TF` switch (default `1m`, preserving today's
behavior). When `5m`, the structure-bearing fields come from the **5m** engine table; the
entry/confirmation close + entry price stay **1m**. Everything is gated behind the flag and
**folded old-vs-new** before the default flips.

**Tech stack:** Node (CLI + Electron main), the ICT Engine Pine table read over CDP, the
deterministic fold harness (`buildDeterministicPacketTruthFromInputs` + `gradeOpenTrade`).

---

## Phase 0 — Design lock (no code)

### Task 0.1 — Pin the exact field split (5m vs 1m)
- Decide, field-by-field, which walker inputs read 5m vs 1m. Proposed:
  - **5m:** `pillar3.swings`, `structures_by_tier.swing/internal`, `failure_swings`,
    `fvgs`/`bprs` (the tapped zone), `price_context.inside_fvgs`.
  - **1m (unchanged):** the confirmation close / entry price, `confirm_ms`, the bar that
    fires the order, `ohlcv1m`.
  - **Stop = independent variable `STOP_TF`, test BOTH 1m and 5m** (user decision 2026-06-20).
    Do NOT assume the 5m stop. The fold compares structure-5m with a 1m stop vs a 5m stop, so
    `structural_stops` is a knob, not fixed to 5m.
- **Acceptance:** a field-by-field table (5m/1m) appended here, signed off.
- **Verification:** cross-check [docs/strategy/entry-models.md](../../strategy/entry-models.md)
  (structure = 5m, tap/close = 1m).

**CHECKPOINT 0 — human review of the field split before any code.**

---

## Phase 1 — Capture 5m structure

### Task 1.1 — Tape recorder captures a 5m engine track
- **Files:** `cli/lib/tape-recorder.js` (modify), `tests/tape-recorder.test.js` (extend).
- The recorder steps replay 1m-by-1m and snapshots the engine table. Add: at each step also
  snapshot the **5m** engine table, stored on the entry as `inputs.engine5m` (parsed shape
  identical to `gates.engine`), emit-verified (`meta.tf === '5'`) like `cli/lib/tf-capture.js`.
- **Steps (TDD):** (1) failing test — a recorded entry has `inputs.engine5m.pillar3.swings`;
  (2) implement the 5m read; (3) test passes, 1m track unchanged.
- **Acceptance:** `tv record-tape` produces tapes carrying both 1m and 5m tracks.
- **Verification:** record one short live window; assert both tracks + 5m emit stamps.

### Task 1.2 — Live hunt scan refreshes 5m structure
- **Files:** `app/main/bar-close.js` (`buildDetectorInputs`, scan args), `cli/commands/analyze.js`.
- The hunt reuses `--baseline`. Ensure `engine_by_tf.m5` is present and **≤5min fresh** in the
  bundle the walker reads (no per-bar TF switching). Tighten baseline cadence during the hunt
  if needed.
- **Acceptance:** during a live hunt, `inputs.bundle.engine_by_tf.m5.pillar3` is non-null, <5min stale.
- **Verification:** live probe logging 5m freshness per hunt bar.

**CHECKPOINT 1 — confirm 5m data is captured live AND in tapes before touching the walker.**

---

## Phase 2 — Walker reads 5m structure (behind a flag)

### Task 2.1 — Add `STRUCTURE_TF` switch (default `1m`)
- **Files:** `app/main/config.js` (flag), `app/main/bar-close.js` (`buildStrategyBundleForRuntime`).
- Default `1m` → byte-identical behavior. When `5m`, the runtime bundle's
  `gates.engine.pillar3` (+ `price_context.inside_fvgs`) is sourced from the 5m track
  (`engine5m` in tapes / `engine_by_tf.m5` live); `ohlcv1m`, the confirmation row, and entry
  price stay 1m.
- **Steps (TDD):** (1) failing test — flag `5m` + fixture with distinct 1m vs 5m structure:
  context swings/MSS come from 5m, entry close from 1m; (2) implement the sourcing swap;
  (3) flag `1m` leaves all existing walker tests unchanged.
- **Acceptance:** flag off = identical; flag on = structure 5m, entry 1m.
- **Verification:** `npm run test:unit` green both states; replay corpus unchanged with flag off.

### Task 2.2 — TP pivots follow 5m; stop is its own `STOP_TF` knob (1m | 5m)
- **Files:** `app/main/strategy/walkers/execution-packet.js` (`targetPool`, stop selection),
  `app/main/config.js` (`STOP_TF`).
- Intraday TP pivots come from 5m swings (with `STRUCTURE_TF=5m`). The **stop** reads its
  anchor pool from `STOP_TF` **independently**: `1m` = today's 1m swing pivots / leg extremes;
  `5m` = the 5m invalidation. Brief `untaken_targets` (session levels) unchanged.
- **Acceptance:** `STOP_TF` selects the stop-anchor TF independently of `STRUCTURE_TF`.
- **Verification:** unit test — same setup yields a 1m-tight stop vs a 5m-wide stop per `STOP_TF`.

**CHECKPOINT 2 — walker behavior under the flag reviewed on a single fixture day.**

---

## Phase 3 — Re-record worst weeks + fold harness

### Task 3.1 — Re-record the worst sessions with the 5m track
- Re-record the 7 −3R days + their weeks: 2026-05-13 pm, 05-15 pm, 05-28 am, 06-11 am,
  06-16 am, 06-17 pm, 06-18 am.
- **Acceptance:** tapes for the worst weeks carry both tracks, `verified:false` until graded.
- **Verification:** `npm run tapes` lists them; both tracks present.

### Task 3.2 — Fold script: 1m vs 5m structure, side by side
- **Files:** `scripts/fold-structure-tf.mjs` (new), reuse `fold-live-corpus` plumbing.
- Folds each session across the variant grid — at minimum: (a) `1m/1m` baseline,
  (b) `structure 5m / stop 1m`, (c) `structure 5m / stop 5m`. Reports per session: R, −3R flag,
  win-rate, and the **per-trade diff** (which losers vanish, which winners change) — so the
  STOP effect (1m vs 5m) is isolated from the structure effect.
- **Acceptance:** one report table per variant, worst weeks first.
- **Verification:** confirm the false-structure losers (1m-MSS whipsaws) are the ones that change.

**CHECKPOINT 3 — review worst-weeks result. Go/no-go before whole-corpus fold.**

---

## Phase 4 — Whole-corpus fold + decision gate

### Task 4.1 — Fold the full corpus, 1m vs 5m
- Re-record remaining sessions; run `fold-structure-tf.mjs` over the whole corpus.
- **Acceptance:** full report — corpus R (1m vs 5m), −3R count, win-rate, trade diff.
- **Decision gate (from intent):** ship only if **R holds-or-improves AND false-structure
  −3R/losing days clean up**. Else: document why and stop/iterate (do not ship).

**CHECKPOINT 4 — human go/no-go on the number.**

---

## Phase 5 — Ship (only if Phase 4 passes)
- Flip `STRUCTURE_TF` default to `5m`; freeze new baseline R; PR + merge + deploy
  (feature branch, never main). Update corpus baseline + memory.
- **Acceptance:** default `5m`, tests green, deployed, baseline frozen.

---

## Risks / notes
- **Data cost:** every validation step needs re-recording (tapes are 1m-only today). Phase 1
  is the long pole.
- **Stop TF is tested, not assumed** (`STOP_TF` 1m vs 5m): wider 5m stops change R:R and TP1
  reachability — the fold grid isolates this; watch the `tp1_below_1_5r` blocker rate.
- **Capture cadence:** live 5m structure must be ≤5min fresh or the walker reads a stale leg.
- **Caveat (intent):** this is *not* the −55R "5m confirmation" change; entry stays 1m.

---

## Todo
- [ ] **0.1** Field split table (5m/1m) — CHECKPOINT 0
- [ ] **1.1** Tape recorder 5m track
- [ ] **1.2** Live hunt 5m freshness — CHECKPOINT 1
- [ ] **2.1** `STRUCTURE_TF` flag + sourcing swap
- [ ] **2.2** TP pivots 5m + `STOP_TF` knob (1m|5m) — CHECKPOINT 2
- [ ] **3.1** Re-record worst weeks
- [ ] **3.2** `fold-structure-tf.mjs` grid (1m/1m · str5m/stop1m · str5m/stop5m) — CHECKPOINT 3
- [ ] **4.1** Whole-corpus fold + decision gate — CHECKPOINT 4
- [ ] **5** Ship (only if Phase 4 passes)
