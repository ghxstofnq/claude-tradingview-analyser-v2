---
description: Semantic regression check — re-grades a fixture bundle blind, then scores agreement with its hand-graded expected.md. Complements the deterministic npm run smoke:fixtures.
---

## What this does

`/judge` is the semantic half of fixture regression testing. `npm run smoke:fixtures` checks bundle schema + citation integrity deterministically; `/judge` checks whether a fresh read of a bundle still reaches the same **verdict** as the hand-graded golden — the thing that silently drifts when a model version or the `/analyze` command changes.

Per `docs/research/ai-consistency.md` ("deterministic format checks plus LLM-as-judge for semantics") the two are complementary. `/judge` does **not** replace `smoke:fixtures`.

## Argument

- `/judge 001` — judge one fixture by id.
- `/judge all` — judge every `*.bundle.json` in `tests/fixtures/`.

## Procedure (per fixture `NNN-label`)

Do these in order. **Do not read the expected file before the blind pass** — reading the golden first anchors the verdict and defeats the check.

### 1. Blind pass

`Read tests/fixtures/NNN-label.bundle.json`. Produce a fresh structured verdict from the bundle **alone**, applying the same strategy and rules as `/analyze` (`.claude/commands/analyze.md` — the 3-pillar checklist, `docs/strategy/`). Emit these six fields:

- `grade` — `A+ | B | no-trade`
- `htf_bias` — `bullish | bearish | neutral`
- `pillar2_verdict` — `good | marginal | poor`
- `entry_model` — `MSS | Trend | Inversion | null`
- `confirmation_status` — `confirmed | candidate | invalidated | n/a`
- `trade_direction` — `long | short | none`

### 2. Read the golden

`Read tests/fixtures/NNN-label.expected.md`. Parse its trailing ```json block — the hand-graded golden verdict. Map the fields:

| Judge dimension | Golden path |
|---|---|
| `grade` | `grade` |
| `htf_bias` | `pillar1.htf_bias` |
| `pillar2_verdict` | `pillar2.verdict` |
| `entry_model` | `pillar3.entry_model` |
| `confirmation_status` | `pillar3.confirmation_status` |
| `trade_direction` | derived from `trade`: non-null `entry` with `stop` below it → `long`, `stop` above it → `short`; null `entry` → `none` |

### 3. Compare — one categorical verdict per dimension

- **`agree`** — same enum value.
- **`partial`** — adjacent / same-direction-but-weaker: `A+`↔`B`; `good`↔`marginal` or `marginal`↔`poor`; `confirmed`↔`candidate`; same `htf_bias` direction but one side says `neutral`.
- **`disagree`** — opposite or unrelated: `A+`↔`no-trade`; `good`↔`poor`; `bullish`↔`bearish`; `long`↔`short`; a different `entry_model`.

### 4. Write the result

`Write tests/fixtures/NNN-label.judge.json`:

```json
{
  "fixture": "NNN-label",
  "judged_at": "<ISO-8601>",
  "dimensions": {
    "grade": "agree|partial|disagree",
    "htf_bias": "agree|partial|disagree",
    "pillar2_verdict": "agree|partial|disagree",
    "entry_model": "agree|partial|disagree",
    "confirmation_status": "agree|partial|disagree",
    "trade_direction": "agree|partial|disagree"
  },
  "notes": "<one short line per disagree — what differed and why>"
}
```

## Rules (inherited from analyze.md)

- **Cite or omit.** Any price you mention must resolve in the bundle, cited `<price> (<json.path>)`.
- **No arithmetic.** The judge emits **only** the categorical verdicts above — never a numeric score. `npm run judge:report` computes the agreement percentages from the `*.judge.json` files.
- **Grade enum only** — `A+ | B | no-trade`.
- **Blind first.** The integrity of the check depends on grading the bundle before seeing the golden.

## Chat output

One line per fixture: `NNN-label: <agree>/6 agree, <partial>/6 partial, <disagree>/6 disagree`. For each `disagree`, add its one-line note. End with: `Wrote N judge file(s). Run \`npm run judge:report\` for the tally.`

## Scope note

This check is statistically meaningful only once the corpus is large enough (~10 fixtures — see `docs/plans/2026-05-20-roadmap-fixes.md`). With a small corpus the report is directional, not conclusive.
