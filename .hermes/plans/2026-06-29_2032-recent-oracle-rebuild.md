# Recent-Date Oracle Rebuild Plan

> **For Hermes:** This is a supervisor plan for rebuilding CTV-v2 oracle rows from recent, replayable MNQ/MES evidence. Use the CTV-v2 workflow and do not promote exact truth without chart/tape evidence plus user approval.

**Goal:** Rebuild the executable oracle from recent sessions in the last two months, using paired MNQ/MES intraday tapes and conservative hand approval, while keeping older transcript-only sessions as calibration rather than exact execution truth.

**Architecture:** Split the rebuild into (1) eligibility policy, (2) candidate deck discovery, (3) per-date tape capture and hand-grade packets, (4) explicit promotion into fixtures/oracle rows, and (5) pair-leader fold validation. Large tape artifacts remain local-only/ignored unless a separate storage plan is approved.

**Tech Stack:** Existing CTV-v2 Node scripts: `./bin/tv record-tape`, `npm run tapes`, `node scripts/fold-pair-leader.mjs`, stage-G fixture labels under `tests/fixtures/stage-g-sessions/`, tapes under `tests/tapes/`, audit docs under `docs/audits/`.

---

## Current context

- Current branch: `docs/rebuild-oracle-from-authority`.
- Current date/time checked from the host: `2026-06-29 20:32 CEST`.
- Recent-window definition: `2026-04-29` through `2026-06-29`.
- Existing local paired rows already foldable: `2026-02-09`, `2026-06-09`, `2026-06-16`, `2026-06-17`, `2026-06-18`.
- `2025-12-12` is blocked for exact promotion because MES intraday replay/history is unavailable in the current tool path. It remains transcript-only calibration.
- Existing recent state/session directories are primarily June 2026; use June as phase-1 and extend into May only if replay discovery proves available and useful.

## Non-negotiable oracle policy

An exact oracle row is promotable only if all are true:

1. **Allowed authority:** strategy docs/transcripts, chart/tape evidence, or explicit user approval. No retired callout/alert-derived material.
2. **Paired evidence:** MNQ and MES tapes exist for the same date/session/window, or the row is explicitly documented as single-instrument-only.
3. **Manual grade packet:** model, side, entry, stop, TP1/TP2, grade, first-packet timestamp, and outcome are derived from chart/tape evidence.
4. **Approval:** user approves the exact packet before label status flips from `unlabeled` / `needs_gxofnq_review`.
5. **Verification:** `npm run tapes`, `node scripts/fold-pair-leader.mjs`, and `npm run test` pass before commit.

If any item fails, the row stays `pending_review`, `unlabeled`, or `needs_gxofnq_review`.

---

## Candidate deck — phase 1

Use these as the first rebuild deck. The goal is not to force every row into the oracle; it is to collect a balanced set and promote only the rows that survive evidence review.

| Priority | Date | Session | Current signal | Why include | Initial action |
|---:|---|---|---|---|---|
| 1 | `2026-06-09` | NY-AM | Existing MNQ short A+ tape + local MES tape | Short winner / A+ / existing paired fold row | Re-review exact packet and approval status; keep as seed if still evidence-clean |
| 2 | `2026-06-16` | NY-AM | Existing MNQ short B/MSS-vs-Trend discrepancy + local MES tape | B-grade short + pair-leader stress | Re-grade model taxonomy from chart/tape before treating as final |
| 3 | `2026-06-17` | NY-AM | Existing MNQ no-trade + local MES long false-positive | No-trade guard and pair-disagreement row | Preserve as no-trade candidate if tape review confirms no valid MNQ setup |
| 4 | `2026-06-18` | NY-AM | Existing row conflicts with later session setup artifacts | Important discrepancy / should not be blindly trusted | Re-grade from scratch; do not rely on stale label expectation |
| 5 | `2026-06-12` | NY-AM | Persisted setup: Inversion long B around `2026-06-12T15:36Z` | Fresh long candidate from recent local state | Record MNQ+MES 09:30–12:05 ET; hand-grade or reject |
| 6 | `2026-06-19` | NY-AM | Multiple long/short setup candidates | Ambiguity/stress day; useful for “do not overtrade” rules | Record paired tapes; likely mark as review/stress, not immediate oracle |
| 7 | `2026-06-22` | NY-AM | Recent no-setup/no-trade state | No-trade coverage | Record paired tapes and verify no setup under current walker + hand read |
| 8 | `2026-06-23` | NY-AM | Recent no-setup/no-trade state | Second no-trade coverage | Record paired tapes and verify no setup |
| 9 | `2026-06-24` | NY-AM | Existing unverified MNQ Inversion long tape | Potential recent long candidate | Re-record/complete MES counterpart, then hand-grade exact packet |
| 10 | `2026-06-29` | NY-AM | Latest bearish-context no-setup state | Very recent current-regime no-trade / bearish calibration | Use only after session is complete; record if replay path stable |

Phase-1 target: promote **6–8 high-confidence rows**, not all 10.

Target balance after phase 1:

- 2–3 long rows
- 2–3 short rows
- 2 no-trade rows
- At least one A+ row and at least two B rows
- At least one row where MNQ/MES disagree, but only if the evidence supports the oracle pick

---

## Step-by-step execution plan

### Task 1: Append the recent-date rebuild policy to the audit

**Objective:** Make the pivot explicit in `docs/audits/2026-06-29-oracle-rebuild-kickoff.md`.

**Files:**
- Modify: `docs/audits/2026-06-29-oracle-rebuild-kickoff.md`

**Steps:**
1. Add a section: `## Recent-date oracle rebuild policy`.
2. State that `2025-12-12` is transcript-only calibration unless chart/tape evidence appears.
3. Add the exact promotion policy from this plan.
4. Add the phase-1 candidate deck table.
5. Run `git diff --check`.

**Verification:**
```bash
git diff --check
```

### Task 2: Create scratch capture labels for new candidate dates

**Objective:** Generate capture-only labels for dates that do not already have clean MNQ+MES labels.

**Files:**
- Create/modify as needed under `state/regrades/recent-oracle-candidates/`
- Do not commit scratch labels unless they become formal fixtures after approval.

**Important:** Capture labels must not invent oracle truth. Use unknown expected values unless the exact packet is already approved.

**Candidate scratch labels:**
- `2026-06-12-mnq-ny-am-capture.label.json`
- `2026-06-12-mes-ny-am-capture.label.json`
- `2026-06-19-mnq-ny-am-capture.label.json`
- `2026-06-19-mes-ny-am-capture.label.json`
- `2026-06-22-mnq-ny-am-capture.label.json`
- `2026-06-22-mes-ny-am-capture.label.json`
- `2026-06-23-mnq-ny-am-capture.label.json`
- `2026-06-23-mes-ny-am-capture.label.json`
- `2026-06-24-mnq-ny-am-capture.label.json`
- `2026-06-24-mes-ny-am-capture.label.json`
- `2026-06-29-mnq-ny-am-capture.label.json`
- `2026-06-29-mes-ny-am-capture.label.json`

**Verification:**
```bash
node -e "for (const f of process.argv.slice(1)) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('ok')" state/regrades/recent-oracle-candidates/*.label.json
```

### Task 3: Probe replay availability before committing to dates

**Objective:** Fail fast on dates/symbols where TradingView replay has no intraday data.

**Commands:**
```bash
./bin/tv record-tape --label <scratch-label> --from 09:30 --to 11:00 --fixture <date>-<symbol>-ny-am-probe --out tests/tapes/<date>-<symbol>-ny-am-probe.tape.json
```

**Rules:**
- If replay says date unavailable, mark the date as blocked in the audit and move to the next candidate.
- If the tape is recorded, keep it ignored/local-only until review.
- Delete failed or partial probe artifacts unless they are useful as documented blockers.

**Verification:**
```bash
node -e "const fs=require('fs'); for (const f of process.argv.slice(1)) { const t=JSON.parse(fs.readFileSync(f,'utf8')); console.log(f, t.date, t.session, t.entries?.length, t.verified, t.expected?.outcome); }" tests/tapes/*-probe.tape.json
```

### Task 4: Build per-date grade packets

**Objective:** For each available candidate, write a compact review packet before any fixture promotion.

**Files:**
- Create: `docs/audits/recent-oracle-packets/<date>-ny-am.md`

**Each packet must include:**
- Candidate date/session/symbols.
- Tape paths and bar counts.
- Pre-session HTF/Pillar context from allowed files.
- Open reaction and pair-leader notes.
- First valid setup candidate, if any.
- Exact model/side/entry/stop/TP1/TP2/grade/outcome, or `no_trade`.
- Rejection notes for near-miss/invalid setups.
- Explicit recommendation: `PROMOTE`, `NO-TRADE`, or `REJECT / NEEDS REVIEW`.

**Verification:**
```bash
git diff --check docs/audits/recent-oracle-packets
```

### Task 5: Ask for user approval in batches

**Objective:** Avoid silently promoting truth.

**Batch size:** 2–3 packets at a time.

**Approval prompt format:**
```text
Approve these exact oracle packets?
1. <date> <symbol> <model> <side> entry/stop/tp1/tp2 grade outcome
2. <date> no_trade reason
```

**Only after approval:** update formal labels/fixtures.

### Task 6: Promote approved rows into fixtures/tapes

**Objective:** Flip only approved rows from scratch/review state into formal oracle fixtures.

**Files likely touched:**
- `tests/fixtures/stage-g-sessions/*.label.json`
- Possibly `tests/tapes/*.tape.json` metadata for verified expected rows, if the repo policy accepts committing that tape size. Otherwise keep tapes local-only and commit only fixture/audit docs.
- `docs/audits/2026-06-29-oracle-rebuild-kickoff.md`

**Verification:**
```bash
npm run tapes
node scripts/fold-pair-leader.mjs
npm run test
```

### Task 7: Commit in evidence slices

**Objective:** Keep history reviewable.

Suggested commits:
1. `docs: plan recent oracle rebuild deck`
2. `docs: record recent oracle packet batch 1`
3. `test: promote approved recent oracle rows batch 1`
4. `docs: record recent oracle packet batch 2`
5. `test: promote approved recent oracle rows batch 2`

Do not commit large local-only tapes unless the user approves a storage strategy.

---

## Risks and guardrails

| Risk | Guardrail |
|---|---|
| Current walker output is mistaken for oracle truth | Current output can propose candidates, but chart/tape + hand approval decides truth |
| Overfitting to June-only regime | Start with June because artifacts exist; add May replay dates if phase 1 lacks balance |
| Pair fold becomes authority by itself | Pair fold validates behavior against approved truth; it does not create truth |
| MES counterpart tapes are unverified | Treat them as local analysis inputs until hand-graded |
| Exact model taxonomy mismatch, e.g. MSS vs Trend/Inversion | Re-grade from chart/strategy definitions before promotion |
| Large tape blobs bloat git | Keep tapes ignored/local-only unless storage policy changes |

---

## First execution recommendation

Start with three date batches:

1. **Batch A / seed sanity:** `2026-06-09`, `2026-06-16`, `2026-06-17`, `2026-06-18`.
   - Goal: re-review existing rows and document which ones are safe as seed rows.
2. **Batch B / new long + no-trade:** `2026-06-12`, `2026-06-22`, `2026-06-23`.
   - Goal: add one long candidate and two no-trade candidates if replay works.
3. **Batch C / stress + current regime:** `2026-06-19`, `2026-06-24`, `2026-06-29`.
   - Goal: capture ambiguity, an existing unverified long, and latest bearish-context no-trade.

Stop after each batch to produce packets and request approval before fixture promotion.
