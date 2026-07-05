# Intent: the gate corpus (confirmed 2026-07-05)

Interviewed and confirmed verbatim by the user, 2026-07-05.

- **Outcome:** a trusted backtest corpus — every NY AM and PM session from 2026-01-10 to
  2026-07-03, MNQ and MES — recorded through the exact live capture pipeline (same
  timeframes, same clock-timed brief/open-reaction context, nothing injected from
  hindsight), with dual-emit fields added to the Pine FIRST so one recording carries both
  production values and the two GRP_LEVERS variants (`rejected_rw`, `leg_high_org`-class
  fields; legacy fields untouched).
- **User:** the trader — this corpus is the REAL-MONEY GATE instrument
  (docs/intent/2026-06-27-end-goal.md: backtest net-positive over a trusted window),
  not a scratch dataset.
- **Why now:** audit batch 1 deployed (PR #207) and the levers shipped default-off
  (PR #208); every fold — lever enablement, strategy work, the real-money decision — is
  blocked on a corpus; the old corpus is wiped and was never parity-trusted.
- **Success, two gates in order:**
  1. **Parity proven, not assumed:** record a recent day with real live walker-inputs on
     disk, diff recorded inputs vs live bar-by-bar, match. The corpus inherits trust from
     this proof.
  2. The full ~250-session run completes and folds. Net-positive over the whole window on
     this data = the green light to arm real money.
- **Constraints:** recorder is the SOLE CDP driver (app stopped); run resumable across
  days; capture exactly documented (which TFs, what cadence, what context, per bar — a
  capture manifest committed alongside the corpus).
- **Out of scope:** London sessions; enabling the two levers (the fold decides that); the
  SMT leader-selection merge; real-money arming itself.

Execution order implied: (1) dual-emit Pine fields + parser typing (additive keys),
(2) parity-proof day + bar-by-bar diff, (3) full recording campaign, (4) folds.
