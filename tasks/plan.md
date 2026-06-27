# Plan — Faithful-Lanto deepening + backtest≡live parity (no live trading in scope)

> Goal: [docs/intent/2026-06-27-end-goal.md](../docs/intent/2026-06-27-end-goal.md) — the north star.
> Checklist: [tasks/todo.md](todo.md).
> **2026-06-28 replan.** Integrates the active options from the external-research audit
> ([docs/research/external-corpus-2026-06-27/](../docs/research/external-corpus-2026-06-27/README.md)).
> **Scope decision (user, 2026-06-28): NO live trading in this plan** — the live London demo, Tradovate
> demo arming, and the real-money gate are **deferred to a later plan**. This plan is purely the
> prerequisite work: deepen faithfulness, keep the backtest≡live parity gate honest, grow the corpus,
> surface it faithfully in the UI. Grounded in code: **most faithfulness work is already built and
> default-on** — this plan FINISHES + VALIDATES it, it does not rebuild it.

## Corrected state (grounded 2026-06-28 — read before assuming anything is "to build")

- ✅ **3-vote grade (research option 2 / gap #1)** — BUILT + default-on. `cli/lib/pillar1-bias.js`
  (`htfVote`/`overnightVote`/`combineBias` → `draw_bias_pillar` / `a_plus_eligible` / `b_elevatable`),
  consumed by the nested grade in `app/main/strategy/walkers/execution-packet.js:494-506`, wired
  resolver→`bar-close.js:1343`→`deriveGrade`. The §6 "CONTRADICTS" verdict in `lanto-source-of-truth.md`
  is STALE (pre-rebuild). Remaining = **validate** against an extended oracle, not build.
- ✅ **Near-price draw (gap #4)** — BUILT. `pickPrimaryDraw` + `GOFNQ_NEAR_PRICE_PCT` in `pillar1-bias.js`.
- ✅ **Leader / SMT (research option 1 / gap #2)** — corpus-folded + USER-SIGNED-OFF
  ([spec §6b/§6c/§9](../docs/superpowers/specs/2026-06-25-faithful-pair-leader-design.md)): **demote
  divergence-SMT to an optional confirmation overlay; adopt the displacement leader**
  (`cli/lib/compute-leader.js`, `displacementLeaderEvidence`) behind `GOFNQ_FAITHFUL_LEADER` (default
  OFF). This matches the crawl finding ("SMT = confirmation, not entry"). Remaining = more paired
  weeks → fold → default-on; **the real edge limiter is Pillar-3 MES coverage** (spec §6b conclusion 3).
- ✅ **Brain** — Stage G faithful on 5 oracle sessions (right bias/grade/model/side; stands aside on the
  no-trade day). The deterministic chain is the only setup producer (zero-LLM).
- 🔧 **Parity gate** — standing + green (`npm run parity`, `tests/parity-gate.test.js`); corpus thin.
  **Why it stays even with no live trading:** it proves the backtest fold reproduces what the real chain
  produced on recorded sessions — so the folds Track 2 uses to validate levers are trustworthy. It grows
  from **already-recorded** live walker-inputs (no new live sessions needed).
- 🔧 **Oracle / corpus** — only **7 tapes**, **7 oracle sessions**. This is the binding constraint on
  every fold below (research option 4). Discord ground truth: `~/.../Lantos Alerted Trades - Organized.md`.
- 🔧 **UI fidelity** — one violation fixed (B1); re-point + probe pending (B2/B3).

## Out of scope (deferred to a later plan — NOT abandoned; the north-star still stands)

- Live London demo / armed auto-fire on live data.
- Tradovate demo (or real) arming, order routing, live session supervision.
- Real-money gate.

These are the prerequisite's downstream; this plan makes the chain trustworthy enough to justify them.

## Dependency graph (tracks run in parallel; arrows = hard dependencies)

```
        ┌──────────────────────────────────────────────────────────┐
        │ TRACK 0 — FOUNDATION: paired corpus + oracle (option 4)   │  feeds every fold below
        └───────┬───────────────────────────┬──────────────────────┘
                │                            │
   ┌────────────▼───────────┐   ┌───────────▼──────────────────────────────┐   ┌──────────────┐
   │ A — PARITY GATE         │   │ TRACK 2 — FAITHFUL LEVERS (each folded,   │   │ TRACK 3 — UI │
   │ backtest≡recorded-live  │   │ default-OFF flag, user-approved one-by-one)│  │ fidelity     │
   │ (underpins the folds;   │   │ G1 validate 3-vote grade (option 2)        │  │ B2 → B3      │
   │  A3 from existing        │  │ G2 MSS-significance + join FVG (option 3)  │  └──────────────┘
   │  recordings)            │   │ G3 leader default-on + SMT overlay (opt 1) │
   └─────────────────────────┘   │ G4 Pillar-3 MES coverage (edge limiter)    │
                                  └────────────────────────────────────────────┘
```

**Why this order.** Track 0 (corpus/oracle) is the foundation every fold needs — it is the binding
constraint, so it starts now and grows continuously (recording is automatic via replay, off-session).
The parity gate (A) is mostly done and underpins the trust in every Track-2 fold, so it's maintained
alongside. Track 2 levers each need corpus + a fold, landing as the corpus grows — cheapest/safest
first: G1 validates what's already on; G2 are isolated refinements; G3/G4 need ≥3-4 paired weeks.
Track 3 (UI) is parallel and surfaces all of it faithfully.

## Phases

**TRACK 0 — Foundation (corpus + oracle).** Replay-record paired MNQ+MES NY-AM (and London) sessions
via `tv record-tape` (single-TF, off-session only — replay poisons live capture); hand-grade each
against Lanto's Discord; lock into the oracle. Target ≥3-4 paired weeks. Unblocks A3 + every Track-2 fold.

**A — Parity gate (keystone for fold-trust).** Maintain the standing gate (`npm run parity`); expand the
`verified:true` + parity corpus from **already-recorded** live walker-inputs (replay-recorded / past
sessions) — no new live trading. Keeps Track-2's folds honest.

**TRACK 2 — Faithful levers (options 1-3 + the edge limiter).** Each default-OFF, folded old-vs-new on
the Track-0 corpus, user approves one at a time before default-on.
- **G1 — Validate the 3-vote grade (option 2).** It's already on; re-grade the extended oracle under it,
  fold, spot-check vs Discord. Confirm or tune; no rebuild.
- **G2 — Small refinements (option 3).** (a) MSS-significance spawn gate (gap #3): a valid MSS needs
  significant liquidity + matching displacement, not any rejected sweep — port the significance gate to
  the walker MSS/Inversion spawn. (b) `join_consecutive` FVG de-noise on walker spawns (SMC idea). Fold each.
- **G3 — Faithful leader default-on + SMT overlay (option 1).** Flip `GOFNQ_FAITHFUL_LEADER` on once it
  survives ≥3-4 paired weeks; expose divergence-SMT as an optional open-reaction direction confirmation
  (never the symbol/grade gate). Per the signed-off spec §9.
- **G4 — Pillar-3 MES coverage (the dominant edge limiter).** Audit why the chain's MES setups ≠ Lanto's
  (spec §6b conclusion 3); close the gap so a correct leader pick actually converts. Fold.

**TRACK 3 — UI fidelity (transparency mandate).** B2 re-point any remaining UI-only numbers; B3 probe
panel-value == bot-input via the design-harness (no computer-use).

## Checkpoints (hard gates — user reviews; I report, user concludes)

- **P** (A): parity gate green + standing on the recorded corpus. *Keeps the folds trustworthy.*
- **G◇** (each Track-2 lever): fold table old-vs-new — user picks keep / tune / shelve before default-on.
- **U** (Track 3 B): panels mirror the bot's analysis.

## Standing rules (CLAUDE.md + memory)

- Zero LLM in the trade path; the deterministic chain is the only setup producer.
- **Faithful-to-Lanto first**, derived from his transcripts/Discord/oracle — never "fix" a faithful
  behavior to protect P&L. Every lever is **default-OFF + folded old-vs-new** before it ships, one at a time.
- CLI only (`./bin/tv`), TV Desktop CDP 9225; no MCP TV tools; no computer-use; recording off-session only.
- **No live trading / no order placement in this plan** — verify by unit test / read-only inspection / fold.
- Run git/tests **in the worktree**; guard tests with `GOFNQ_STATE_DIR`. Feature branches + PR; never main;
  co-author tag on commits.
