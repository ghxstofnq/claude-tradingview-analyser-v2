# miss-04: TP cite must NOT be a swept session level

This bundle has AS_H 29990 marked `taken: true` (swept). The original miss had the model citing AS.H as a "bull continuation" target.

Detector requirements:

- `best_candidate.tp1.cite` MUST NOT match `gates.engine.pillar1.session_levels.AS_H`.
- `best_candidate.tp1.cite` MUST be from `untaken_pools_above[]` → resolves to 30015.
- `best_candidate.tp2.cite` similarly untaken.
