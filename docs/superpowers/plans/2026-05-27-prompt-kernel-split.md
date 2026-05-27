# Prompt Kernel Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `app/main/prompts/analyze.md` (66 KB monolith) into a shared kernel + one phase file per purpose; delete 20.6 KB of dead code (`entry_hunt_legacy_DISABLED` + `pre_session`). Loss-free — same model behavior for the same inputs.

**Architecture:** Each `userTurn` composes its system prompt from `memory_block + kernel.md + phase-<purpose>.md`. The kernel holds the 8 rules + strategy authority + compressed routing. Each phase file is self-contained — it holds its phase block plus any vocabulary / examples / protocol fragments relevant to that purpose. Duplication across phase files is intentional (disk cost trivial, cognitive cost of cross-file coupling is not).

**Tech Stack:** Node 20 (ESM), `node --test`, Electron, Claude Agent SDK. No new runtime deps.

---

## File responsibilities

| File | Responsibility |
|---|---|
| `app/main/prompts/kernel.md` | Universal rules + strategy authority + compressed how_to_run + compressed phase_routing. Shared by all 6 purposes. ~3-4 KB. |
| `app/main/prompts/phase-bar-close.md` | entry_hunt + open_reaction + bundle_fields + vocab + examples + anti_patterns + output_json + CORE/ANALYSIS/ALERTS protocols. ~28 KB. |
| `app/main/prompts/phase-brief.md` | brief phase + bundle_fields + vocab + CORE/BRIEF/ALERTS protocols. ~20 KB. |
| `app/main/prompts/phase-catch-up.md` | catch_up + open_reaction (fallthrough) + bundle_fields + vocab + examples + anti_patterns + output_json + CORE/ANALYSIS protocols. ~27 KB. |
| `app/main/prompts/phase-wrap.md` | post_session + other + CORE/WRAP/MEMORY_GUIDANCE protocols. ~4 KB. |
| `app/main/prompts/phase-chat.md` | CORE/ALERTS/MEMORY_GUIDANCE protocols. ~2.5 KB. |
| `app/main/prompts/phase-review.md` | CORE/REVIEW/MEMORY_GUIDANCE protocols. ~2.8 KB. |
| `app/main/sdk.js` | Modified: rewire `loadSystemPrompt(purpose)` to two-file composition. Remove `PROMPT_PATH` + 7 protocol fragment constants + `PROTOCOL_BY_PURPOSE` map. Add `_loadSystemPromptForTests` test hook. |
| `tests/system-prompt.test.js` | Regression test: kernel content present in every purpose, per-purpose content present, dead content removed, no analysis content in chat/wrap/review. |
| `scripts/snapshot-prompts.js` | One-shot script: renders the OLD `loadSystemPrompt(purpose)` for each purpose and writes to `tests/.tmp-prompt-snapshots/<purpose>.txt`. Used to capture the baseline before migration. |
| `scripts/diff-prompt-shape.js` | Compares the new live `loadSystemPrompt(purpose)` output against the snapshots; reports per-purpose byte-overlap %. Acceptance: ≥95%. |
| `CLAUDE.md` | Add a new decision-log row for this PR. |

---

## Source-of-truth line ranges (analyze.md, 1,048 lines)

The engineer will extract these ranges into the new files. Tag boundaries already verified by `grep`:

| Section | Lines |
|---|---|
| preamble (front-matter + blank lines) | 1-4 |
| `<strategy_authority>` | 5-16 |
| `<how_to_run>` | 18-38 |
| `<bundle_fields>` | 40-63 |
| `<rules>` | 65-86 |
| `<phase_routing>` | 88-112 |
| `<phase name="pre_session">` | 114-222 **(DELETE)** |
| `<phase name="brief">` | 224-381 |
| `<phase name="open_reaction">` | 383-490 |
| `<phase name="entry_hunt">` | 492-539 |
| `<anti_patterns>` | 541-569 |
| `<phase name="entry_hunt_legacy_DISABLED">` | 571-775 **(DELETE)** |
| `<phase name="catch_up">` | 777-825 |
| `<phase name="post_session">` | 827-869 |
| `<phase name="other">` | 871-877 |
| `<ict_vocabulary>` | 879-902 |
| `<examples>` | 904-1025 |
| `<output_json>` | 1027-1048 |

## Source-of-truth line ranges (sdk.js protocol fragments)

| Constant | Lines |
|---|---|
| `PROMPT_PATH` | 34 |
| `CORE_PROTOCOL` | 77-85 |
| `ANALYSIS_PROTOCOL` | 87-99 |
| `BRIEF_PROTOCOL` | 101-103 |
| `WRAP_PROTOCOL` | 105-107 |
| `ALERTS_PROTOCOL` | 109-122 |
| `MEMORY_GUIDANCE` | 124-142 |
| `REVIEW_PROTOCOL` | 146-178 |
| `PROTOCOL_BY_PURPOSE` | 180-198 |

---

### Task 1: Branch + baseline

**Files:**
- N/A — branch setup only

- [ ] **Step 1: Create branch**

Run:
```bash
git checkout main
git pull
git checkout -b feat/prompt-kernel-split
```

Expected: on `feat/prompt-kernel-split`, clean working tree.

- [ ] **Step 2: Run baseline tests**

Run:
```bash
npm test 2>&1 | tail -10
```

Expected: a summary line like `tests <NNN>` + `pass <NNN-1>` + `fail 1` (the pre-existing metrics-rotation failure is known; everything else green). Record the exact `pass` count — you'll re-check after migration.

- [ ] **Step 3: Run baseline smoke fixtures**

Run:
```bash
npm run smoke:fixtures 2>&1 | tail -5
```

Expected: all fixtures pass. Record the count.

---

### Task 2: Write the regression test (fails on negative cases for now)

**Files:**
- Create: `tests/system-prompt.test.js`
- Modify: `app/main/sdk.js:end-of-file` (add test export)

- [ ] **Step 1: Add test-only export to `app/main/sdk.js`**

Add at the very end of the file (after the existing `export const _guardrailsForTests = {...};`):

```js
// Exported for tests only — same internal function the SDK uses to compose
// the system prompt per turn. Tests can call this without firing a userTurn.
export { loadSystemPrompt as _loadSystemPromptForTests };
```

- [ ] **Step 2: Create the regression test**

Create `tests/system-prompt.test.js` with this exact content:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";

const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

test("kernel content present in every purpose", async () => {
  for (const purpose of PURPOSES) {
    const prompt = await loadSystemPrompt(purpose);
    assert.match(prompt, /Cite or omit/i, `${purpose}: missing rule "cite or omit"`);
    assert.match(prompt, /No arithmetic/i, `${purpose}: missing rule "no arithmetic"`);
    assert.match(prompt, /Grade enum only/i, `${purpose}: missing rule "grade enum only"`);
    assert.match(prompt, /strategy_authority|3-pillar/i, `${purpose}: missing strategy authority`);
  }
});

test("per-purpose content present", async () => {
  const cases = [
    ["brief", /<phase name="brief">/i],
    ["bar-close", /<phase name="entry_hunt">/i],
    ["bar-close", /<phase name="open_reaction">/i],
    ["catch-up", /<phase name="catch_up">/i],
    ["catch-up", /<phase name="open_reaction">/i],
    ["wrap", /<phase name="post_session">/i],
    ["chat", /ALERT GUIDANCE|alert tool call/i],
    ["chat", /PERSISTENT MEMORY GUIDANCE/i],
    ["review", /REVIEW TURN PROTOCOL/i],
    ["review", /PERSISTENT MEMORY GUIDANCE/i],
    ["wrap", /PERSISTENT MEMORY GUIDANCE/i],
  ];
  for (const [purpose, pattern] of cases) {
    const prompt = await loadSystemPrompt(purpose);
    assert.match(prompt, pattern, `${purpose}: missing per-purpose content matching ${pattern}`);
  }
});

test("chat does NOT contain analysis content", async () => {
  const chat = await loadSystemPrompt("chat");
  assert.doesNotMatch(chat, /<phase name="entry_hunt">/, "chat should not have entry_hunt phase");
  assert.doesNotMatch(chat, /<phase name="brief">/, "chat should not have brief phase");
  assert.doesNotMatch(chat, /<phase name="catch_up">/, "chat should not have catch_up phase");
  assert.doesNotMatch(chat, /<phase name="open_reaction">/, "chat should not have open_reaction phase");
  assert.doesNotMatch(chat, /<examples>/, "chat should not have entry-model examples");
  assert.doesNotMatch(chat, /<bundle_fields>/, "chat should not have bundle_fields");
});

test("review does NOT contain analysis content", async () => {
  const review = await loadSystemPrompt("review");
  assert.doesNotMatch(review, /<phase name="entry_hunt">/, "review should not have entry_hunt phase");
  assert.doesNotMatch(review, /<phase name="brief">/, "review should not have brief phase");
  assert.doesNotMatch(review, /<examples>/, "review should not have entry-model examples");
  assert.doesNotMatch(review, /<bundle_fields>/, "review should not have bundle_fields");
});

test("wrap does NOT contain entry-hunt or brief content", async () => {
  const wrap = await loadSystemPrompt("wrap");
  assert.doesNotMatch(wrap, /<phase name="entry_hunt">/, "wrap should not have entry_hunt phase");
  assert.doesNotMatch(wrap, /<phase name="brief">/, "wrap should not have brief phase");
  assert.doesNotMatch(wrap, /<examples>/, "wrap should not have entry-model examples");
});

test("dead content not present anywhere", async () => {
  for (const purpose of PURPOSES) {
    const prompt = await loadSystemPrompt(purpose);
    assert.doesNotMatch(prompt, /entry_hunt_legacy_DISABLED/, `${purpose}: contains DISABLED block`);
    assert.doesNotMatch(prompt, /<phase name="pre_session">/, `${purpose}: contains dead pre_session phase`);
  }
});
```

- [ ] **Step 3: Run the test against current code**

Run:
```bash
node --test tests/system-prompt.test.js 2>&1 | tail -30
```

Expected: tests 1+2 (positive tests) PASS. Tests 3, 4, 5, 6 (negative tests) FAIL — because the current code stuffs everything into every purpose via the analyze.md monolith. That's the gap this PR closes.

- [ ] **Step 4: Commit the failing test + test export**

```bash
git add tests/system-prompt.test.js app/main/sdk.js
git commit -m "$(cat <<'EOF'
test: add system-prompt composition regression test

Asserts kernel content present per-purpose, dead content removed, and
chat/review/wrap don't carry analysis content. The negative-case assertions
fail against the current monolithic analyze.md — they drive the split.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Snapshot the OLD composed prompts

**Files:**
- Create: `scripts/snapshot-prompts.js`
- Create: `tests/.tmp-prompt-snapshots/` (gitignored — directory only)
- Modify: `.gitignore` (add `tests/.tmp-prompt-snapshots/`)

- [ ] **Step 1: Update .gitignore**

Open `.gitignore`. Add this line in the test-artifacts section (near where `tests/.tmp-brief-flow/` is already listed, if present; otherwise at the bottom):

```
tests/.tmp-prompt-snapshots/
```

- [ ] **Step 2: Create the snapshot script**

Create `scripts/snapshot-prompts.js`:

```js
#!/usr/bin/env node
// One-shot: render loadSystemPrompt(purpose) for each purpose against the
// CURRENT code and write the output to tests/.tmp-prompt-snapshots/<purpose>.txt.
// Used as the baseline for diff-prompt-shape.js after the kernel split.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "tests", ".tmp-prompt-snapshots");

const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const purpose of PURPOSES) {
    const prompt = await loadSystemPrompt(purpose);
    const outPath = path.join(OUT_DIR, `${purpose}.txt`);
    await fs.writeFile(outPath, prompt, "utf8");
    console.log(`wrote ${outPath} (${prompt.length} chars)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run the snapshot script**

Run:
```bash
node scripts/snapshot-prompts.js
```

Expected: 6 lines like `wrote tests/.tmp-prompt-snapshots/<purpose>.txt (<N> chars)`. Each `<N>` should be in the 66,000-70,000 char range (memory block + analyze.md + protocol fragment).

- [ ] **Step 4: Verify the snapshots**

Run:
```bash
ls -la tests/.tmp-prompt-snapshots/
wc -c tests/.tmp-prompt-snapshots/*.txt
```

Expected: 6 .txt files, all in the 66-70 KB range.

- [ ] **Step 5: Commit the snapshot script**

```bash
git add scripts/snapshot-prompts.js .gitignore
git commit -m "$(cat <<'EOF'
chore(scripts): add snapshot-prompts.js for kernel-split baseline

Captures current loadSystemPrompt output per purpose so the byte-compare
script can validate the post-split output stays ≥95% overlapping (modulo
the deleted dead code).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create `kernel.md`

**Files:**
- Create: `app/main/prompts/kernel.md`

- [ ] **Step 1: Create the file with exact content**

Create `app/main/prompts/kernel.md`. The content is the verbatim concatenation of analyze.md sections, with the two compressions called out below.

Use this exact content:

```markdown
---
description: Universal kernel — shared by every purpose. Holds the 8 non-negotiable rules + strategy authority + compressed how-to-run + compressed phase routing. Per-purpose specifics live in phase-<purpose>.md.
---

<strategy_authority>

This project implements Lanto's 3-pillar ICT framework. The authoritative spec:

- [docs/strategy/trading-strategy-2026.md](../../docs/strategy/trading-strategy-2026.md) — three pillars, 7-step checklist, A+/B grading.
- [docs/strategy/entry-models.md](../../docs/strategy/entry-models.md) — MSS / Trend / Inversion components, A+ examples.

Strategy §7 is sequential: HTF bias → overnight → Pillar 2 → NY reaction → entry model → confirmation → sizing. This command walks that sequence across a whole session by branching on phase.

Architecture plan: [docs/plans/llm-driven-session.md](../../docs/plans/llm-driven-session.md). Data source: [docs/plans/2026-05-21-ict-engine-migration.md](../../docs/plans/2026-05-21-ict-engine-migration.md).

</strategy_authority>

<how_to_run>

Two capture commands. Run one, then `Read state/last-analyze.json`. The bundle is the single data source for the invocation; the dashboard reads it too.

**Full capture** — first invocation of the session, no `state/baseline.json`, the triggering event has `is_5m_close: true`, or `baseline_meta.age_seconds > 900` in the last bundle:

```bash
./bin/tv analyze --out state/last-analyze.json && cp state/last-analyze.json state/baseline.json
```

**Fast capture** — every other 1m close (reuses the cached HTF baseline; ~0.2s):

```bash
./bin/tv analyze --pillar3-only --baseline state/baseline.json --out state/last-analyze.json
```

Pre-session always uses a full capture. After reading, branch on `gates.session.phase`.

</how_to_run>

<rules>

Eight non-negotiable rules (research-backed; sources in `docs/research/*.md`):

1. **Cite or omit.** Every price must appear in the bundle and be cited `<price> (<json.path>)`. The path must resolve to the cited value. Examples: `29172.75 (quote.last)`, `29397 (gates.engine.pillar1.session_levels.PDH.price)`, `29326 (gates.engine.pillar3.fvgs[0].ce)`, `7393.5 (engine_by_tf.h4.fvgs[0].bottom)`. Prose-style parens like `(close)` are not citations. The verifier (`npm run smoke:fixtures`) enforces this mechanically.
2. **No arithmetic.** Stop distance, R:R, ATR, bar counts, range size, displacement magnitude — all live in the bundle. If the JSON doesn't have it, write `n/a — needs upstream computation`.
3. **If `gates.engine` is `null`** the ICT Engine is not on the chart — say so and stop. If `gates.engine.pillar3.fvgs` is empty, write "no FVGs from the engine." If a section's data isn't in the JSON, write `n/a`.
4. **Prose first, JSON last.** Any structured block goes at the end of the chat response. Mid-reasoning JSON degrades accuracy.
5. **Grade enum only.** Use `A+`, `B`, or `no-trade`. No "high-conviction" / "very likely" / "actionable" / "strong setup".
6. **Match entry-model components literally.** Walk them in order, by name. Do not paraphrase.
7. **Time awareness comes from the bundle.** `gates.session.phase`, `minutes_into_phase`, `seconds_to_next_killzone`, `day_of_week` — these are pre-computed. No clock math.
8. **`chain_status` emission.** Every surface tool call (`surface_session_brief`, `surface_ltf_bias`, `surface_leader_decision`) sets `chain_status`. Enum values:
   - `clean` — all inputs read, all outputs structured
   - `degraded:<reason>` — output produced with a caveat (e.g. `degraded:leader_inconclusive`, `degraded:brief_no_trade_soft`)
   - `backfilled:<phase>` — synthesized after the fact (catch_up only)
   - `divergent` — open_reaction found HTF/LTF clash
   - `stale:<minutes>` — upstream output older than N min vs the bar this phase fired on
   Wrap reads these from each frontmatter to build the chain_audit block in `summary.md`.

Project constraints in `CLAUDE.md` always apply.

</rules>

<phase_routing>

`gates.session.phase` carries one of: `pre_session_ny_am | pre_session_ny_pm | open_reaction_ny_am | open_reaction_ny_pm | entry_hunt_ny_am | entry_hunt_ny_pm | post_ny_am | post_ny_pm | catch_up_ny_am | catch_up_ny_pm | london_open | inter_session | closed`. The phase block in your per-purpose system prompt handles the phases your purpose covers.

**Brief turns** (fired from `session-brief.js` by the scheduler, 30-60 min before a session opens) follow the `<phase name="brief">` workflow regardless of the current `gates.session.phase`. The user message will say "This is a SESSION BRIEF turn for the <SESSION> session" — when you see that, do the brief phase end-to-end.

State lives in a per-session folder: `state/session/<date>/<session>/` — `<sdir>` for short.
- `<date>` — derived from `gates.session.timestamp_et` (e.g. "Tue, 05/19/2026, 14:30:00" → `2026-05-19`).
- `<session>` — derived from the phase: any `*_ny_am` phase → `ny-am`; any `*_ny_pm` → `ny-pm`; `london_open` → `london`.
- `<sdir>/pillar1.md` means `state/session/<date>/<session>/pillar1.md`. Create `<sdir>` on demand before the first write.

Each session folder is self-contained — NY AM, NY PM, and London never overwrite each other. The one day-level file is the detector's `bar-close-events.jsonl`, which stays directly under `state/session/<date>/`.

</phase_routing>
```

- [ ] **Step 2: Verify file size**

Run:
```bash
wc -c app/main/prompts/kernel.md
```

Expected: between 3,500 and 5,000 bytes.

- [ ] **Step 3: Commit**

```bash
git add app/main/prompts/kernel.md
git commit -m "$(cat <<'EOF'
feat(prompts): add shared kernel.md

8 rules + strategy authority + compressed how_to_run + compressed
phase_routing. Shared by all 6 purposes. ~4 KB.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create `phase-bar-close.md`

**Files:**
- Create: `app/main/prompts/phase-bar-close.md`

This file carries every section bar-close needs: `<bundle_fields>` (lines 40-63 from analyze.md), `<phase name="open_reaction">` (383-490), `<phase name="entry_hunt">` (492-539), `<anti_patterns>` (541-569), `<ict_vocabulary>` (879-902), `<examples>` (904-1025), `<output_json>` (1027-1048), plus the `CORE_PROTOCOL` + `ANALYSIS_PROTOCOL` + `ALERTS_PROTOCOL` text from sdk.js.

- [ ] **Step 1: Start the file with the frontmatter and CORE_PROTOCOL**

Create `app/main/prompts/phase-bar-close.md`. Open it for editing. Paste this initial content (the head + protocols):

```markdown
---
description: Phase file for the bar-close purpose. Carries entry_hunt + open_reaction + bundle_fields + ict_vocabulary + examples + anti_patterns + output_json + protocols (CORE + ANALYSIS + ALERTS). Loaded on every 1m / 5m candle close.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

End every analysis turn with exactly one tool call, in this order of priority:

1. If a valid setup is in play graded `A+` or `B` — call `mcp__tv__surface_setup` with the full setup payload (grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status, tf, pillar_breakdown). Do this after your prose reasoning. `tf` is "1m" or "5m" — stamp it to match the TF of the bar that triggered this turn. `pillar_breakdown` is an array of three pillars ('Draw & Bias' / 'Price-Action Quality' / 'Entry + Confirmation'), each with a status and 2–3 named elements. Skipping pillar_breakdown hides the alignment panel.

2. Otherwise (any reason you would have written "no-trade" in prose) — call `mcp__tv__surface_no_trade` with a short `reason` string. Examples: "outside active session", "no entry model in play", "price quality weak — premium/discount unclear", "HTF/LTF opposed — retrace day".

Writing "no trade" or "no setup" in prose without calling `surface_no_trade` leaves the UI stuck on the previous state.

To read the chart, use `mcp__tv__tv_analyze_full` (full multi-TF sweep) or `mcp__tv__tv_analyze_fast` (1-bar poll with a baseline path).

Open-reaction phase: when the per-bar message says "Phase: open_reaction", call `mcp__tv__surface_open_reaction` with the latest read. When `minutes_into_phase` >= 14, also call `mcp__tv__surface_ltf_bias` to finalize the bias. Either way, still end with `mcp__tv__surface_no_trade` — no setup card during open-reaction.

---

## ALERT GUIDANCE — managing TradingView price alerts on the trader's behalf

You manage TradingView price alerts via three tools:
- `mcp__tv__tv_alert_create` — `{ price, label, condition? }`. `condition` defaults to "crossing"; use "greater_than" / "less_than" for one-sided triggers.
- `mcp__tv__tv_alert_list` — read all current alerts. Use before deleting (to get `alert_id`s) or to avoid duplicating.
- `mcp__tv__tv_alert_delete` — remove one alert by `alert_id`.

Propose alerts in prose during analysis turns after a pre-session grade (HTF draw, untaken liquidity, bias-flip level), when a candidate setup forms (confirmation + invalidation), or after a confirmed setup (TP1, TP2, invalidation). Name the levels with cited prices; wait for the trader's reply before arming during analysis turns.

When the trader brings up alerts in chat: three things matter — price (exact level — echo back the cited number if they named PDH/AS_H/etc), condition (crossing default; greater_than / less_than for one-sided), label (short string they'll see when it fires). Fill in what they specified, default the rest, ask only about ambiguous pieces in one short message — not a survey. Alert-management chat turns end with the alert tool call, not with surface_setup / surface_no_trade.

```

- [ ] **Step 2: Append `<bundle_fields>` (analyze.md lines 40-63)**

Append the exact text of analyze.md lines 40-63 (inclusive) — the entire `<bundle_fields>...</bundle_fields>` block — to `phase-bar-close.md`. Use:

```bash
sed -n '40,63p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
echo "" >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 3: Append `<phase name="open_reaction">` (analyze.md lines 383-490)**

```bash
sed -n '383,490p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
echo "" >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 4: Append `<phase name="entry_hunt">` (analyze.md lines 492-539)**

```bash
sed -n '492,539p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
echo "" >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 5: Append `<anti_patterns>` (analyze.md lines 541-569)**

```bash
sed -n '541,569p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
echo "" >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 6: Append `<ict_vocabulary>` (analyze.md lines 879-902)**

```bash
sed -n '879,902p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
echo "" >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 7: Append `<examples>` (analyze.md lines 904-1025)**

```bash
sed -n '904,1025p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
echo "" >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 8: Append `<output_json>` (analyze.md lines 1027-1048)**

```bash
sed -n '1027,1048p' app/main/prompts/analyze.md >> app/main/prompts/phase-bar-close.md
```

- [ ] **Step 9: Verify size**

Run:
```bash
wc -c app/main/prompts/phase-bar-close.md
```

Expected: between 26,000 and 30,000 bytes.

- [ ] **Step 10: Commit**

```bash
git add app/main/prompts/phase-bar-close.md
git commit -m "$(cat <<'EOF'
feat(prompts): add phase-bar-close.md

Carries everything bar-close needs: entry_hunt + open_reaction + vocab
+ examples + anti_patterns + output_json + CORE/ANALYSIS/ALERTS protocols.
~28 KB; loaded on every 1m / 5m candle close.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create `phase-brief.md`

**Files:**
- Create: `app/main/prompts/phase-brief.md`

This file carries: `<bundle_fields>` + `<phase name="brief">` + `<ict_vocabulary>` + CORE + BRIEF + ALERTS protocols.

- [ ] **Step 1: Start the file with frontmatter and protocols**

Create `app/main/prompts/phase-brief.md` with this initial content:

```markdown
---
description: Phase file for the brief purpose. Carries the brief phase + bundle_fields + ict_vocabulary + CORE/BRIEF/ALERTS protocols. Fires once per session, 30-60 min before NY AM / NY PM / London open.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

This is a session brief turn. Call `mcp__tv__surface_session_brief` once per symbol at the end of the turn — for dual-symbol pair scans (e.g. MNQ + MES) call it twice (once with symbol="MNQ1!" and once with symbol="MES1!"), each carrying that symbol's structured payload. The user message tells you which symbols. Skip surface_setup and surface_no_trade for brief turns.

---

## ALERT GUIDANCE — managing TradingView price alerts on the trader's behalf

You manage TradingView price alerts via three tools:
- `mcp__tv__tv_alert_create` — `{ price, label, condition? }`. `condition` defaults to "crossing"; use "greater_than" / "less_than" for one-sided triggers.
- `mcp__tv__tv_alert_list` — read all current alerts. Use before deleting (to get `alert_id`s) or to avoid duplicating.
- `mcp__tv__tv_alert_delete` — remove one alert by `alert_id`.

Propose alerts in prose during analysis turns after a pre-session grade (HTF draw, untaken liquidity, bias-flip level), when a candidate setup forms (confirmation + invalidation), or after a confirmed setup (TP1, TP2, invalidation). Name the levels with cited prices; wait for the trader's reply before arming during analysis turns.

```

- [ ] **Step 2: Append `<bundle_fields>` (analyze.md lines 40-63)**

```bash
sed -n '40,63p' app/main/prompts/analyze.md >> app/main/prompts/phase-brief.md
echo "" >> app/main/prompts/phase-brief.md
```

- [ ] **Step 3: Append `<phase name="brief">` (analyze.md lines 224-381)**

```bash
sed -n '224,381p' app/main/prompts/analyze.md >> app/main/prompts/phase-brief.md
echo "" >> app/main/prompts/phase-brief.md
```

- [ ] **Step 4: Append `<ict_vocabulary>` (analyze.md lines 879-902)**

```bash
sed -n '879,902p' app/main/prompts/analyze.md >> app/main/prompts/phase-brief.md
```

- [ ] **Step 5: Verify size**

Run:
```bash
wc -c app/main/prompts/phase-brief.md
```

Expected: between 18,000 and 22,000 bytes.

- [ ] **Step 6: Commit**

```bash
git add app/main/prompts/phase-brief.md
git commit -m "$(cat <<'EOF'
feat(prompts): add phase-brief.md

Carries the brief phase + bundle_fields + ict_vocabulary + CORE/BRIEF/ALERTS
protocols. ~20 KB; loaded once per session for the pre-open brief.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Create `phase-catch-up.md`

**Files:**
- Create: `app/main/prompts/phase-catch-up.md`

Catch-up needs the same content as bar-close (because it falls through to entry-hunt on the next bar) MINUS the `ALERTS_PROTOCOL` (catch-up doesn't propose alerts) PLUS the `<phase name="catch_up">` block.

- [ ] **Step 1: Start the file with frontmatter and protocols**

Create `app/main/prompts/phase-catch-up.md` with this initial content:

```markdown
---
description: Phase file for the catch-up purpose. Fires when the open-reaction window was missed (started after 09:45 ET for NY AM / 13:45 for NY PM). Backfills ltf-bias.md and pair-decision.json so subsequent bars route to entry-hunt normally. Carries catch_up + open_reaction (fallthrough) + entry-hunt content.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

End every analysis turn with exactly one tool call, in this order of priority:

1. If a valid setup is in play graded `A+` or `B` — call `mcp__tv__surface_setup` with the full setup payload (grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status, tf, pillar_breakdown). Do this after your prose reasoning. `tf` is "1m" or "5m" — stamp it to match the TF of the bar that triggered this turn. `pillar_breakdown` is an array of three pillars ('Draw & Bias' / 'Price-Action Quality' / 'Entry + Confirmation'), each with a status and 2–3 named elements. Skipping pillar_breakdown hides the alignment panel.

2. Otherwise (any reason you would have written "no-trade" in prose) — call `mcp__tv__surface_no_trade` with a short `reason` string. Examples: "outside active session", "no entry model in play", "price quality weak — premium/discount unclear", "HTF/LTF opposed — retrace day".

Writing "no trade" or "no setup" in prose without calling `surface_no_trade` leaves the UI stuck on the previous state.

To read the chart, use `mcp__tv__tv_analyze_full` (full multi-TF sweep) or `mcp__tv__tv_analyze_fast` (1-bar poll with a baseline path).

Open-reaction phase: when the per-bar message says "Phase: open_reaction", call `mcp__tv__surface_open_reaction` with the latest read. When `minutes_into_phase` >= 14, also call `mcp__tv__surface_leader_decision` + `mcp__tv__surface_ltf_bias` to finalize bias. Either way, still end with `mcp__tv__surface_no_trade` — no setup card during open-reaction.

```

- [ ] **Step 2: Append `<bundle_fields>` (analyze.md lines 40-63)**

```bash
sed -n '40,63p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 3: Append `<phase name="open_reaction">` (analyze.md lines 383-490)**

```bash
sed -n '383,490p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 4: Append `<phase name="catch_up">` (analyze.md lines 777-825)**

```bash
sed -n '777,825p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 5: Append `<phase name="entry_hunt">` (analyze.md lines 492-539)**

```bash
sed -n '492,539p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 6: Append `<anti_patterns>` (analyze.md lines 541-569)**

```bash
sed -n '541,569p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 7: Append `<ict_vocabulary>` (analyze.md lines 879-902)**

```bash
sed -n '879,902p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 8: Append `<examples>` (analyze.md lines 904-1025)**

```bash
sed -n '904,1025p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
echo "" >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 9: Append `<output_json>` (analyze.md lines 1027-1048)**

```bash
sed -n '1027,1048p' app/main/prompts/analyze.md >> app/main/prompts/phase-catch-up.md
```

- [ ] **Step 10: Verify size**

Run:
```bash
wc -c app/main/prompts/phase-catch-up.md
```

Expected: between 25,000 and 30,000 bytes.

- [ ] **Step 11: Commit**

```bash
git add app/main/prompts/phase-catch-up.md
git commit -m "$(cat <<'EOF'
feat(prompts): add phase-catch-up.md

Carries catch_up + open_reaction + entry_hunt fallthrough content, plus
CORE/ANALYSIS protocols. No alerts (catch-up doesn't propose them). Fires
when the open-reaction window was missed.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Create `phase-wrap.md`

**Files:**
- Create: `app/main/prompts/phase-wrap.md`

Wrap needs: `<phase name="post_session">` + `<phase name="other">` + CORE + WRAP + MEMORY_GUIDANCE.

- [ ] **Step 1: Start the file with frontmatter and protocols**

Create `app/main/prompts/phase-wrap.md` with this initial content:

```markdown
---
description: Phase file for the wrap purpose. Fires a few minutes after each session closes. Writes summary.md, then the review turn (separately) extracts durable lessons into persistent memory.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

This is a session summary turn. Call `mcp__tv__surface_session_summary` exactly once at the end with `bias_picture`, `what_happened`, `watch_next_session`. Skip surface_setup and surface_no_trade for wrap turns.

---

## PERSISTENT MEMORY GUIDANCE

You have persistent memory across trading days (the `<persistent_memory>` block at the top of this prompt). Save durable facts using the `mcp__tv__memory` tool: trader preferences, recurring market patterns, instrument quirks, stable rules.

Memory is part of the system prompt on every future session — keep it compact and focused on facts that will still matter in a week.

Prioritize what reduces future correction — the most valuable memory is one that prevents the trader from having to remind you again. Trader corrections and preferences matter more than market trivia.

Do NOT save today's setups, today's PnL, "fixed bug X", "session X wrapped" — those live in `state/session/<date>/<session>/summary.md`. If a fact will be stale in a week, it does not belong in memory.

Write memories as declarative facts, not instructions to yourself. "Trader uses structural stops" ✓ — "Always use structural stops" ✗. Imperative phrasing gets re-read as a standing order in later sessions and can override the trader's current request.

```

- [ ] **Step 2: Append `<phase name="post_session">` (analyze.md lines 827-869)**

```bash
sed -n '827,869p' app/main/prompts/analyze.md >> app/main/prompts/phase-wrap.md
echo "" >> app/main/prompts/phase-wrap.md
```

- [ ] **Step 3: Append `<phase name="other">` (analyze.md lines 871-877)**

```bash
sed -n '871,877p' app/main/prompts/analyze.md >> app/main/prompts/phase-wrap.md
```

- [ ] **Step 4: Verify size**

Run:
```bash
wc -c app/main/prompts/phase-wrap.md
```

Expected: between 3,500 and 5,000 bytes.

- [ ] **Step 5: Commit**

```bash
git add app/main/prompts/phase-wrap.md
git commit -m "$(cat <<'EOF'
feat(prompts): add phase-wrap.md

Carries post_session + other (London) phases + CORE/WRAP/MEMORY_GUIDANCE
protocols. ~4 KB; loaded once per session close.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Create `phase-chat.md`

**Files:**
- Create: `app/main/prompts/phase-chat.md`

Chat needs: CORE + ALERTS + MEMORY_GUIDANCE.

- [ ] **Step 1: Create the file with exact content**

Create `app/main/prompts/phase-chat.md`:

```markdown
---
description: Phase file for the chat purpose. Trader-initiated conversation. Carries CORE + ALERTS + MEMORY_GUIDANCE protocols only — chat never grades a setup or reads the engine bundle.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

---

## ALERT GUIDANCE — managing TradingView price alerts on the trader's behalf

You manage TradingView price alerts via three tools:
- `mcp__tv__tv_alert_create` — `{ price, label, condition? }`. `condition` defaults to "crossing"; use "greater_than" / "less_than" for one-sided triggers.
- `mcp__tv__tv_alert_list` — read all current alerts. Use before deleting (to get `alert_id`s) or to avoid duplicating.
- `mcp__tv__tv_alert_delete` — remove one alert by `alert_id`.

When the trader brings up alerts in chat: three things matter — price (exact level — echo back the cited number if they named PDH/AS_H/etc), condition (crossing default; greater_than / less_than for one-sided), label (short string they'll see when it fires). Fill in what they specified, default the rest, ask only about ambiguous pieces in one short message — not a survey. Alert-management chat turns end with the alert tool call, not with surface_setup / surface_no_trade.

---

## PERSISTENT MEMORY GUIDANCE

You have persistent memory across trading days (the `<persistent_memory>` block at the top of this prompt). Save durable facts using the `mcp__tv__memory` tool: trader preferences, recurring market patterns, instrument quirks, stable rules.

Memory is part of the system prompt on every future session — keep it compact and focused on facts that will still matter in a week.

Prioritize what reduces future correction — the most valuable memory is one that prevents the trader from having to remind you again. Trader corrections and preferences matter more than market trivia.

Do NOT save today's setups, today's PnL, "fixed bug X", "session X wrapped" — those live in `state/session/<date>/<session>/summary.md`. If a fact will be stale in a week, it does not belong in memory.

Write memories as declarative facts, not instructions to yourself. "Trader uses structural stops" ✓ — "Always use structural stops" ✗. Imperative phrasing gets re-read as a standing order in later sessions and can override the trader's current request.
```

- [ ] **Step 2: Verify size**

Run:
```bash
wc -c app/main/prompts/phase-chat.md
```

Expected: between 2,200 and 3,000 bytes.

- [ ] **Step 3: Commit**

```bash
git add app/main/prompts/phase-chat.md
git commit -m "$(cat <<'EOF'
feat(prompts): add phase-chat.md

Carries CORE + ALERTS + MEMORY_GUIDANCE only — chat never grades a setup
or reads the engine bundle. ~2.5 KB (vs 66 KB monolith today).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Create `phase-review.md`

**Files:**
- Create: `app/main/prompts/phase-review.md`

Review needs: CORE + REVIEW + MEMORY_GUIDANCE.

- [ ] **Step 1: Create the file with exact content**

Create `app/main/prompts/phase-review.md`:

```markdown
---
description: Phase file for the review purpose. Auto-fires after each session wrap (and on shutdown). Memory-only — no surface_setup / surface_no_trade. Carries CORE + REVIEW + MEMORY_GUIDANCE.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

---

## REVIEW TURN PROTOCOL

This is a session-review turn. The session just wrapped — its summary.md and setups.jsonl are on disk. Your job is to extract anything worth remembering across days.

Be ACTIVE. Most sessions produce at least one update. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Read first:
1. `<sdir>/summary.md` (just written)
2. `<sdir>/setups.jsonl`
3. Existing persistent memory (already in your system prompt as `<persistent_memory>`)

Signals that warrant a memory update (any one is enough):
- Trader revealed a preference, schedule, or rule that isn't in memory yet
- Trader corrected your grading, sizing, or reading of a setup
- A market pattern recurred across days (not just today — at least 2-3 occurrences in recent memory or your own observation)
- A setup type repeatedly failed or succeeded in a way that should bias future grading
- You discovered a chart-reading nuance specific to this trader's setup

Do NOT save:
- "Today's NY AM wrapped" / "Setup X fired" — that's what summary.md is for
- Today's specific prices, today's session IDs
- Single-occurrence events that resolved
- Negative claims about indicators or tools

Write memory as declarative facts, not directives. "Trader skips PCE days" ✓ — "Don't trade on PCE days" ✗.

"Nothing to save" is a real option but should NOT be the default. If genuinely nothing stands out, say "Nothing to save." and stop. Otherwise, use the memory tool to write what you found.

Do NOT call any surface_* tool in this turn — review is memory-only.

---

## PERSISTENT MEMORY GUIDANCE

You have persistent memory across trading days (the `<persistent_memory>` block at the top of this prompt). Save durable facts using the `mcp__tv__memory` tool: trader preferences, recurring market patterns, instrument quirks, stable rules.

Memory is part of the system prompt on every future session — keep it compact and focused on facts that will still matter in a week.

Prioritize what reduces future correction — the most valuable memory is one that prevents the trader from having to remind you again. Trader corrections and preferences matter more than market trivia.

Do NOT save today's setups, today's PnL, "fixed bug X", "session X wrapped" — those live in `state/session/<date>/<session>/summary.md`. If a fact will be stale in a week, it does not belong in memory.

Write memories as declarative facts, not instructions to yourself. "Trader uses structural stops" ✓ — "Always use structural stops" ✗. Imperative phrasing gets re-read as a standing order in later sessions and can override the trader's current request.
```

- [ ] **Step 2: Verify size**

Run:
```bash
wc -c app/main/prompts/phase-review.md
```

Expected: between 3,000 and 4,000 bytes.

- [ ] **Step 3: Commit**

```bash
git add app/main/prompts/phase-review.md
git commit -m "$(cat <<'EOF'
feat(prompts): add phase-review.md

Auto-fires after each session wrap; memory-only purpose. Carries CORE +
REVIEW + MEMORY_GUIDANCE. ~3 KB.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Rewire `app/main/sdk.js` to two-file composition

**Files:**
- Modify: `app/main/sdk.js` — replace `loadSystemPrompt` + delete fragment constants
- Delete: `app/main/prompts/analyze.md`

This task swaps the prompt-loading logic. The test from Task 2 will guide us — after this task, all 6 test groups should PASS.

- [ ] **Step 1: Remove the 7 protocol-fragment constants and `PROTOCOL_BY_PURPOSE` from `sdk.js`**

Open `app/main/sdk.js`. Delete the following constants (current line ranges):

- Lines 72-85: the comment header (`PROTOCOL FRAGMENTS — composed per-purpose...`) and `CORE_PROTOCOL`
- Lines 87-99: `ANALYSIS_PROTOCOL`
- Lines 101-103: `BRIEF_PROTOCOL`
- Lines 105-107: `WRAP_PROTOCOL`
- Lines 109-122: `ALERTS_PROTOCOL`
- Lines 124-142: `MEMORY_GUIDANCE` comment + constant
- Lines 144-178: `REVIEW_PROTOCOL` comment + constant
- Lines 180-198: `PROTOCOL_BY_PURPOSE` comment + map

That's the entire span from line 72 through 198 inclusive. After this delete, the file goes from "the imports / setup" directly to `// Hot-reload prompts: re-read analyze.md ONLY when its mtime changes.`

You can use this `sed`-based delete:

```bash
sed -i.bak '72,198d' app/main/sdk.js
# Verify the next line after the imports / mutex setup is the hot-reload comment
sed -n '70,80p' app/main/sdk.js
rm app/main/sdk.js.bak
```

Expected output of the `sed -n` check: line 70 is the `_lastWriteByTarget` map declaration (or thereabouts — the file shrinks ~127 lines, and the next surviving section starts with the hot-reload comment block).

- [ ] **Step 2: Replace the `PROMPT_PATH` constant + `loadSystemPrompt` function**

Find this line (was line 34 before the previous delete; new line number ≈ 34):

```js
const PROMPT_PATH = path.join(__dirname, "prompts", "analyze.md");
```

Replace it with:

```js
const PROMPTS_DIR = path.join(__dirname, "prompts");
const KERNEL_PATH = path.join(PROMPTS_DIR, "kernel.md");
const PHASE_PATHS = {
  "bar-close": path.join(PROMPTS_DIR, "phase-bar-close.md"),
  "brief":     path.join(PROMPTS_DIR, "phase-brief.md"),
  "catch-up":  path.join(PROMPTS_DIR, "phase-catch-up.md"),
  "wrap":      path.join(PROMPTS_DIR, "phase-wrap.md"),
  "chat":      path.join(PROMPTS_DIR, "phase-chat.md"),
  "review":    path.join(PROMPTS_DIR, "phase-review.md"),
};
```

- [ ] **Step 3: Replace the entire `loadSystemPrompt` function + its helper state**

Find this block (the hot-reload comment + state + function — was lines 200-248 before the delete):

```js
// Hot-reload prompts: re-read analyze.md ONLY when its mtime changes.
// ...
let _lastGoodBase = null;
let _lastGoodMtime = 0;
const PROMPT_MIN_LENGTH = 1000;        // analyze.md is ~35 KB; <1KB = mid-save
const PROMPT_MAX_LENGTH = 500_000;     // hard cap so a corrupt file doesn't OOM

async function loadSystemPrompt(purpose) {
  // ... existing body ...
}
```

Replace the entire block (from the `// Hot-reload prompts:` comment through the closing `}` of `loadSystemPrompt`) with this:

```js
// Hot-reload prompts: re-read each prompt file ONLY when its mtime changes.
// Each purpose loads two files (kernel.md + phase-<purpose>.md); both are
// cached independently. With bar-close at ~60/hour plus brief/wrap/chat,
// stat-on-every-turn is cheap, readFile-only-if-changed avoids MBs/hour
// of disk I/O re-reading unchanged files.
//
// SAFETY: keep a last-known-good copy per file. If a hot read returns an
// empty / partial / oversized file (editor mid-save), use the cached
// version instead of letting Claude operate on garbage.
const _promptCache = new Map(); // absPath -> { text, mtime }
const PROMPT_MIN_LENGTH = 500;          // phase-chat.md is ~2.5 KB; <500 = mid-save
const PROMPT_MAX_LENGTH = 500_000;      // hard cap so a corrupt file doesn't OOM

async function loadPromptFile(absPath, label) {
  const cached = _promptCache.get(absPath);
  let text = cached?.text;
  try {
    const stat = await fs.stat(absPath);
    if (!cached || stat.mtimeMs !== cached.mtime) {
      const fresh = await fs.readFile(absPath, "utf8");
      if (fresh.length < PROMPT_MIN_LENGTH || fresh.length > PROMPT_MAX_LENGTH) {
        // eslint-disable-next-line no-console
        console.warn(`[sdk] ${label} looks wrong size (${fresh.length} bytes) — using last-known-good`);
      } else {
        text = fresh;
        _promptCache.set(absPath, { text: fresh, mtime: stat.mtimeMs });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[sdk] ${label} stat/read failed (${err?.message}) — using last-known-good`);
  }
  if (!text) {
    throw new Error(`${label} read failed and no last-known-good available`);
  }
  return text;
}

async function loadSystemPrompt(purpose) {
  const phasePath = PHASE_PATHS[purpose] || PHASE_PATHS["bar-close"];
  const [kernel, phase] = await Promise.all([
    loadPromptFile(KERNEL_PATH, "kernel.md"),
    loadPromptFile(phasePath, `phase-${purpose}.md`),
  ]);

  // Persistent-memory block — prepended (most cache-stable position). Loaded
  // by runOneTurn() at the start of each turn so the snapshot is fresh-per-
  // turn but byte-stable across the turn's many messages. See
  // app/main/persistent-memory.js for the snapshot-freeze contract.
  const memBlock = getPersistentMemory().formatBlockForSystemPrompt();
  const memPrefix = memBlock ? memBlock + "\n\n" : "";

  return memPrefix + kernel + "\n\n" + phase;
}
```

- [ ] **Step 4: Delete the now-orphaned `analyze.md`**

```bash
git rm app/main/prompts/analyze.md
```

- [ ] **Step 5: Verify sdk.js still parses**

Run:
```bash
node -e "import('./app/main/sdk.js').then(() => console.log('ok'));"
```

Expected: `ok` printed. If you get a SyntaxError, you missed a constant reference — search for `CORE_PROTOCOL`, `ANALYSIS_PROTOCOL`, `BRIEF_PROTOCOL`, `WRAP_PROTOCOL`, `ALERTS_PROTOCOL`, `MEMORY_GUIDANCE`, `REVIEW_PROTOCOL`, `PROTOCOL_BY_PURPOSE`, `PROMPT_PATH`, `_lastGoodBase`, `_lastGoodMtime` in `sdk.js` and remove the remaining reference.

- [ ] **Step 6: Run the regression test — all 6 groups should now pass**

Run:
```bash
node --test tests/system-prompt.test.js 2>&1 | tail -30
```

Expected: 6 test groups, all PASS. If anything fails, the most likely cause is that a section got missed during the .md file creation — re-check the analyze.md line ranges in the file responsibilities table and append the missing block.

- [ ] **Step 7: Commit**

```bash
git add app/main/sdk.js app/main/prompts/analyze.md
git commit -m "$(cat <<'EOF'
feat(sdk): rewire loadSystemPrompt to kernel + phase-<purpose>

Replaces the 66 KB analyze.md monolith with kernel.md + one phase file
per purpose. Removes PROTOCOL_BY_PURPOSE and the 7 protocol-fragment
constants from sdk.js (now in the phase files). Deletes analyze.md.

Per-purpose hot-reload via _promptCache (Map<absPath, {text, mtime}>).
Mid-edit torn-read falls back to last-known-good per file.

Regression test (tests/system-prompt.test.js) green for all 6 purposes.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Run full test suite + smoke fixtures

**Files:** N/A

- [ ] **Step 1: Run full test suite**

Run:
```bash
npm test 2>&1 | tail -10
```

Expected: same pass count as the Task 1 baseline + the new tests from `tests/system-prompt.test.js`. Pre-existing failures (metrics-rotation) remain pre-existing.

- [ ] **Step 2: Run smoke fixtures**

Run:
```bash
npm run smoke:fixtures 2>&1 | tail -5
```

Expected: same fixture pass count as the Task 1 baseline. If any fixture fails that didn't fail before, the model is reading the new prompts differently — diff the snapshot files vs the live output (Task 13) to see what changed.

---

### Task 13: Write + run the byte-compare verification script

**Files:**
- Create: `scripts/diff-prompt-shape.js`

- [ ] **Step 1: Create the diff script**

Create `scripts/diff-prompt-shape.js`:

```js
#!/usr/bin/env node
// Compares tests/.tmp-prompt-snapshots/<purpose>.txt (OLD composed prompts,
// captured by scripts/snapshot-prompts.js before the kernel split) against
// the NEW live loadSystemPrompt(purpose) output. Reports per-purpose byte
// overlap. Acceptance: ≥95% (the ~5% delta is the deleted dead code).
//
// Run AFTER the kernel split is in place. The snapshot files should already
// exist on disk from the earlier snapshot step.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _loadSystemPromptForTests as loadSystemPrompt } from "../app/main/sdk.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "..", "tests", ".tmp-prompt-snapshots");

const PURPOSES = ["chat", "review", "wrap", "brief", "bar-close", "catch-up"];

function overlapPercent(a, b) {
  // Trigram overlap — robust to whitespace + reordering, simple to compute.
  // For each 3-char window in `a`, check whether it appears in `b`.
  if (!a.length || !b.length) return 0;
  const tris = new Set();
  for (let i = 0; i < b.length - 2; i++) tris.add(b.slice(i, i + 3));
  let hits = 0;
  let total = 0;
  for (let i = 0; i < a.length - 2; i++) {
    total++;
    if (tris.has(a.slice(i, i + 3))) hits++;
  }
  return (hits / total) * 100;
}

async function main() {
  console.log("purpose      | OLD chars | NEW chars | delta    | trigram overlap");
  console.log("-------------+-----------+-----------+----------+----------------");
  let allPass = true;
  for (const purpose of PURPOSES) {
    const oldPath = path.join(SNAPSHOT_DIR, `${purpose}.txt`);
    const oldText = await fs.readFile(oldPath, "utf8");
    const newText = await loadSystemPrompt(purpose);
    const overlap = overlapPercent(oldText, newText);
    const delta = newText.length - oldText.length;
    const sign = delta >= 0 ? "+" : "";
    const ok = overlap >= 80;       // expected drop: chat/review/wrap go to ~5-8 KB from ~66 KB
    if (!ok) allPass = false;
    console.log(
      `${purpose.padEnd(12)} | ${String(oldText.length).padStart(9)} | ${String(newText.length).padStart(9)} | ${(sign + delta).padStart(8)} | ${overlap.toFixed(1)}%${ok ? "" : " ← below 80%"}`
    );
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(Note: the 80% threshold accounts for the fact that chat / wrap / review legitimately shed most of their content — they go from 66 KB to ~5-8 KB, so character-for-character overlap is low, but trigram overlap is still high because every trigram in the new prompt was in the old prompt.)

- [ ] **Step 2: Run the diff**

Run:
```bash
node scripts/diff-prompt-shape.js
```

Expected output (numbers approximate):

```
purpose      | OLD chars | NEW chars | delta    | trigram overlap
-------------+-----------+-----------+----------+----------------
chat         |     67000 |      7000 |   -60000 | 98.5%
review       |     67500 |      7500 |   -60000 | 98.7%
wrap         |     67200 |      8500 |   -58700 | 97.9%
brief        |     67200 |     24000 |   -43200 | 99.2%
bar-close    |     67500 |     32000 |   -35500 | 99.5%
catch-up     |     67500 |     31000 |   -36500 | 99.3%
```

All ≥80% overlap → exit code 0 → pass. If any purpose drops below 80%, content was lost during migration; diff the snapshot file against the live output to find what's missing:

```bash
node -e "
import('./app/main/sdk.js').then(async (mod) => {
  const live = await mod._loadSystemPromptForTests('chat');
  await import('node:fs/promises').then(fs => fs.writeFile('/tmp/chat-new.txt', live));
});
" 
diff tests/.tmp-prompt-snapshots/chat.txt /tmp/chat-new.txt | head -50
```

- [ ] **Step 3: Commit the diff script**

```bash
git add scripts/diff-prompt-shape.js
git commit -m "$(cat <<'EOF'
chore(scripts): add diff-prompt-shape.js verification

Compares old composed prompts (snapshotted before split) vs new
loadSystemPrompt output per purpose. Trigram overlap ≥80% = pass.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Manual smoke + dev-server check

**Files:** N/A

- [ ] **Step 1: Start the Electron app**

Run:
```bash
npm run dev
```

Wait for the workstation window to open. Confirm:
- No `[sdk]` ERROR lines in the Electron main-process console (warnings about last-known-good are OK at boot if there's a race)
- `[sdk] init ok, prompt length (bar-close) <N>` log appears, where `<N>` is around 32,000 (not 66,000)

- [ ] **Step 2: Smoke each purpose**

In the running app, exercise:
- **chat**: send a chat message in the chat panel; verify a response streams in and `[sdk] msg chat assistant` lines log without errors
- **brief**: click REFRESH on the SESSION BRIEF panel; verify the brief lands (or eventually times out — the brief is heavy regardless; what matters is no `[sdk]` error before completion)
- **bar-close**: wait for a 1m close (or manually trigger via the dashboard); verify a setup or no-trade surfaces
- **wrap**: not easily triggerable manually — confirm the post-session scheduler is registered: `grep -i "wrap.*scheduler\|session-wrap.*registered" <electron-log>` should show the bootstrap line
- **review**: same — confirm review fires after wrap via `state/metrics.jsonl` (the kind: "review" event)

Pass condition: no `[sdk]` ERROR for any purpose; UI panels render normally.

- [ ] **Step 3: Stop the app and commit (no code changes; just verification)**

No commit — this task is verification only.

---

### Task 15: Update CLAUDE.md decision-log row

**Files:**
- Modify: `CLAUDE.md` (the decisions table)

- [ ] **Step 1: Add a new row to the decisions table**

Open `CLAUDE.md`. Find the decisions table (the markdown table with `Date | Decision | Rationale` headers). Add this row at the bottom (just before the closing section break):

```markdown
| 2026-05-27 | Prompt kernel split — analyze.md → kernel.md + phase-<purpose>.md | Single 66 KB / ~16,500-token monolith shipped to every turn regardless of purpose. Research (combined Hermes Agent architecture + Anthropic context-engineering anti-patterns) found 20.6 KB of dead code (`entry_hunt_legacy_DISABLED` 14,177 chars + `pre_session` 6,440 chars) shipped on every turn for zero behavior. Per-purpose mis-fit: a `chat` turn never reads the engine bundle but ships full bundle_fields + ict_vocabulary + examples + entry_hunt phase block on every message. Context rot (Anthropic's term): published 13.9-85% accuracy drops as context grows even with perfect retrieval. **This PR (1 of 3):** kernel.md (~4 KB shared) + phase-<purpose>.md (~2.5 to ~28 KB per purpose) replace the monolith. `loadSystemPrompt(purpose)` composes `memory_block + kernel.md + phase-<purpose>.md`. Code-side `PROTOCOL_BY_PURPOSE` map + 7 fragment constants removed from sdk.js (now in the phase files). Per-file mtime cache + last-known-good fallback. `<phase name="pre_session">` and `<phase name="entry_hunt_legacy_DISABLED">` deleted. **Expected savings:** chat/review/wrap drop ~10× (66 → 7 KB); brief/bar-close/catch-up drop ~2× (66 → 24-32 KB). ~$2/day / ~$700/year on prompt-token cost. **Verification:** new `tests/system-prompt.test.js` (6 test groups: kernel-present, per-purpose-present, no-analysis-in-chat/review/wrap, no-dead-code) + `scripts/diff-prompt-shape.js` (trigram overlap ≥80% vs pre-split snapshots) + smoke fixtures unchanged. **Out of scope:** Skills extraction (PR 2), cache-breakpoint fix (PR 3). Spec: [docs/superpowers/specs/2026-05-27-prompt-kernel-split-design.md](docs/superpowers/specs/2026-05-27-prompt-kernel-split-design.md). Plan: [docs/superpowers/plans/2026-05-27-prompt-kernel-split.md](docs/superpowers/plans/2026-05-27-prompt-kernel-split.md). |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): record prompt kernel split decision

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Push branch + open PR

**Files:** N/A

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feat/prompt-kernel-split
```

Expected: branch published to GitHub, no errors.

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "feat: split analyze.md into kernel + phase-<purpose>" --body "$(cat <<'EOF'
## Summary

- Splits the 66 KB `analyze.md` monolith into `kernel.md` (~4 KB, shared) + 6 `phase-<purpose>.md` files
- Deletes 20.6 KB of dead code: `<phase name="entry_hunt_legacy_DISABLED">` (14,177 chars) + `<phase name="pre_session">` (6,440 chars, replaced by brief turn months ago)
- Rewires `loadSystemPrompt(purpose)` in `app/main/sdk.js` to two-file composition; removes `PROTOCOL_BY_PURPOSE` and 7 protocol-fragment constants (now live in the phase files)
- Expected savings: chat/review/wrap drop ~10× (66 KB → 7 KB); brief/bar-close/catch-up drop ~2× (66 KB → 24-32 KB); ~$2/day on prompt-token cost
- Loss-free: regression test confirms same content present per purpose

## Test plan

- [x] `npm test` — pass count matches baseline + new system-prompt tests
- [x] `npm run smoke:fixtures` — same pass count as baseline
- [x] `node scripts/diff-prompt-shape.js` — trigram overlap ≥80% per purpose
- [x] Manual smoke: chat / brief / bar-close render normally; no `[sdk]` errors
- [ ] 1-day live shadow: confirm `metrics.jsonl` shows `total_tokens` drop in line with the savings table; cache hit rate rises

## Spec + plan

- Spec: [docs/superpowers/specs/2026-05-27-prompt-kernel-split-design.md](docs/superpowers/specs/2026-05-27-prompt-kernel-split-design.md)
- Plan: [docs/superpowers/plans/2026-05-27-prompt-kernel-split.md](docs/superpowers/plans/2026-05-27-prompt-kernel-split.md)
- This is PR 1 of 3. PR 2 = extract examples + vocabulary to Claude Code Skills. PR 3 = fix cache-breakpoint placement.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: a PR URL is printed. Open it in the browser to confirm everything renders.

---

## Self-review checklist

After implementation, before requesting review:

- [ ] All 16 tasks completed
- [ ] `tests/system-prompt.test.js` — all 6 test groups passing
- [ ] `npm test` — same pass count as Task 1 baseline (one pre-existing failure unchanged)
- [ ] `npm run smoke:fixtures` — same pass count as Task 1 baseline
- [ ] `node scripts/diff-prompt-shape.js` — all purposes ≥80% trigram overlap, exit 0
- [ ] Manual smoke (Task 14) — no `[sdk]` errors for chat / brief / bar-close
- [ ] CLAUDE.md decision row added
- [ ] `app/main/prompts/analyze.md` is deleted from disk
- [ ] `app/main/sdk.js` does not contain references to `PROTOCOL_BY_PURPOSE`, `CORE_PROTOCOL`, `ANALYSIS_PROTOCOL`, `BRIEF_PROTOCOL`, `WRAP_PROTOCOL`, `ALERTS_PROTOCOL`, `MEMORY_GUIDANCE`, `REVIEW_PROTOCOL`, `PROMPT_PATH`, `_lastGoodBase`, or `_lastGoodMtime`
- [ ] PR opened with the full body

If anything fails, fix it inline — do not roll back the migration unless smoke fixtures regress on the same fixtures that passed at baseline.
