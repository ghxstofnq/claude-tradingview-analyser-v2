# Strategy authority + fixture provenance diff audit

Date: 2026-06-29
Branch: `chore/remove-lanto-callout-authority`
Base checkpoint before this audit: `db8b692 chore: classify operator scripts`
Scope: the remaining uncommitted 35-file strategy/fixture diff after script cleanup.

## Classification

| Slice | Files |
|---|---|
| Authority policy / strategy docs | `CLAUDE.md`, `docs/strategy/README.md`, `docs/strategy/lanto-oracle.md`, `docs/strategy/lanto-prep-rubric.md`, `docs/strategy/prep-live-pipeline-wiring.md` |
| Historical plans / active task wording | `docs/intent/*`, `docs/plans/*`, `docs/superpowers/*`, `tasks/plan.md`, `tasks/todo.md` |
| Code/test comments and non-behavioral wording | `app/main/strategy/walkers/*`, `cli/lib/*`, `tests/direct-session-brief.test.js`, `tests/inversion-entry-gate.test.js` |
| Pair-leader scoring surface | `scripts/fold-pair-leader.mjs` plus pair-leader spec/docs |
| Fixture provenance | `tests/fixtures/real-sessions/*`, `tests/fixtures/stage-g-sessions/*` |

## Decisions

- Added an explicit authority policy: strategy docs + vendored transcripts are allowed; Lanto callout / alerted-trade-derived files are retired as authority.
- Demoted the 2025-12-12 MES exact trade expectation to `needs_gxofnq_review` because its exact instrument/entry/SL/TP levels came from retired material and must be re-derived before scoring.
- Reworded paired MNQ/MES candidate fixture source messages so they remain useful market-data tapes but do not claim leader ground truth.
- Updated `scripts/fold-pair-leader.mjs` so only docs/transcripts-backed, user-approved rows are scored against `oracle_pick`; retired candidate rows print `pending_review` / not-scored.
- Cleaned code/test comments that referred to Discord calls or old actual-call language. No runtime logic was intentionally changed.
- Left raw/allowed transcript mentions alone; retiring a derived source is not a ban on the person/name in canonical transcripts or strategy method language.

## Verification

Ran after the audit patches:

```bash
node --test tests/direct-session-brief.test.js tests/inversion-entry-gate.test.js tests/real-session-label-contract.test.js
npm run smoke:fixtures
GOFNQ_STATE_DIR=$(mktemp -d) npm test
git diff --check
```

Results:

- Targeted tests — passed (`59` tests).
- `npm run smoke:fixtures` — passed (`22/22` checks across `14` fixtures).
- `GOFNQ_STATE_DIR=$(mktemp -d) npm test` — passed (`1607` root tests + `9` app tests).
- `git diff --check` — passed.

## Remaining cautions

- Some historical docs outside this diff still mention Lanto/Discord/callouts. They should be handled only if they act as current authority; raw transcripts and historical records can remain.
- The pair-leader corpus needs re-grading from allowed sources before it can support a live/default-on leader-selection change.
