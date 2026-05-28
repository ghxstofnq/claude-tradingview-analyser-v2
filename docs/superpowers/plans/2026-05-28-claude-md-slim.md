# CLAUDE.md Slim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim our 313-line `CLAUDE.md` to ~130 lines by relocating the architecture-decisions table to `docs/decisions-log.md` and the operational recipes to `docs/recipes/*.md`. Hard constraints + project layout + workflow rules stay inline.

**Architecture:** Pure content relocation. No runtime code changes. CLAUDE.md gains cross-reference pointers where content was moved out.

**Tech Stack:** Markdown only. No tests beyond a length check + one smoke turn after merging.

---

## File Structure

```
CLAUDE.md                   [modify] — slim to ~130 lines, add cross-refs
docs/
  decisions-log.md          [create] — architecture decisions table relocated here
  recipes/
    analyze.md              [create] — `/analyze` recipe
    session.md              [create] — session detector recipe
    dash.md                 [create] — `/dash` TUI recipe
    judge.md                [create] — `/judge` semantic-regression recipe
```

---

## Task 1: Branch setup

- [ ] **Step 1: Create branch off main**

Run: `git fetch origin main && git checkout -b feat/claude-md-slim origin/main`
Expected: `Switched to a new branch 'feat/claude-md-slim'`

---

## Task 2: Capture baseline line count

- [ ] **Step 1: Record before-state**

Run: `wc -l CLAUDE.md`
Expected: `313 CLAUDE.md` (or thereabouts).

Save the number — Task 9 verifies we reduced it.

---

## Task 3: Identify section boundaries in CLAUDE.md

- [ ] **Step 1: List section headers**

Run: `grep -n "^## " CLAUDE.md`
Expected: a list of `## Section` lines with line numbers. Will include sections like `## Hard constraints`, `## Architecture decisions`, `## The analyze recipe`, `## The session recipe`, `## The dash recipe`, `## The judge recipe`, `## Status`, `## Pending implementation`.

- [ ] **Step 2: Note line ranges for sections to relocate**

For each of the following sections, write down the start and end lines. You'll need them in Tasks 4–7.

- `## Architecture decisions` (entire decisions table)
- `## The \`analyze\` recipe` (or similarly named — covers `/analyze` workflow)
- `## The session recipe` (or `## The session recipe (LLM-driven, runs on every bar close)`)
- `## The \`dash\` recipe`
- `## The \`/judge\` recipe`

---

## Task 4: Create docs/decisions-log.md from the decisions table

**Files:**
- Create: `docs/decisions-log.md`

- [ ] **Step 1: Extract the decisions section into a new file**

Use the line range from Task 3 step 2. Copy the entire `## Architecture decisions` section (including its intro paragraph and the table) into a new file `docs/decisions-log.md`.

Add a header at the top of the new file:

```markdown
# Architecture Decisions Log

> Relocated from `CLAUDE.md` on 2026-05-28 as part of the CLAUDE.md slim. The CLAUDE.md file references this log via a cross-reference pointer. Add new decisions here, not in CLAUDE.md.

```

Then paste the existing `| Date | Decision | Rationale |` table content directly below.

- [ ] **Step 2: Verify the file**

Run: `wc -l docs/decisions-log.md && head -5 docs/decisions-log.md && tail -3 docs/decisions-log.md`
Expected: file is hundreds of lines, header present at top, last decision row visible at bottom.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions-log.md
git commit -m "$(cat <<'EOF'
docs: relocate architecture decisions table to docs/decisions-log.md

Moved from CLAUDE.md. New decisions should be appended here, not in CLAUDE.md.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create docs/recipes/ directory + analyze.md

**Files:**
- Create: `docs/recipes/analyze.md`

- [ ] **Step 1: Make the directory**

Run: `mkdir -p docs/recipes`

- [ ] **Step 2: Extract the analyze recipe section into a new file**

Copy the entire `## The \`analyze\` recipe` section from `CLAUDE.md` into `docs/recipes/analyze.md`.

Add a header at the top:

```markdown
# The `analyze` recipe

> Relocated from `CLAUDE.md` on 2026-05-28 as part of the CLAUDE.md slim. Describes what `./bin/tv analyze` returns + how to invoke it.

```

- [ ] **Step 3: Verify**

Run: `wc -l docs/recipes/analyze.md && head -3 docs/recipes/analyze.md`
Expected: file present with header.

- [ ] **Step 4: Commit**

```bash
git add docs/recipes/analyze.md
git commit -m "$(cat <<'EOF'
docs(recipes): relocate analyze recipe to docs/recipes/analyze.md

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Extract session + dash + judge recipes

**Files:**
- Create: `docs/recipes/session.md`
- Create: `docs/recipes/dash.md`
- Create: `docs/recipes/judge.md`

- [ ] **Step 1: Extract session recipe**

Copy `## The session recipe ...` section into `docs/recipes/session.md` with a relocated-from header analogous to Task 5 step 2.

- [ ] **Step 2: Extract dash recipe**

Copy `## The \`dash\` recipe` section into `docs/recipes/dash.md` with the relocated-from header.

- [ ] **Step 3: Extract judge recipe**

Copy `## The \`/judge\` recipe` section into `docs/recipes/judge.md` with the relocated-from header.

- [ ] **Step 4: Verify all three files**

Run: `ls -la docs/recipes/ && wc -l docs/recipes/*.md`
Expected: 4 files (analyze.md from Task 5, session.md, dash.md, judge.md). Each has reasonable line count.

- [ ] **Step 5: Commit**

```bash
git add docs/recipes/session.md docs/recipes/dash.md docs/recipes/judge.md
git commit -m "$(cat <<'EOF'
docs(recipes): relocate session/dash/judge recipes to docs/recipes/

CLAUDE.md cleanup. CLAUDE.md cross-refs added in next commit.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Slim CLAUDE.md — remove relocated sections + add cross-refs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove the architecture decisions section from CLAUDE.md**

Open `CLAUDE.md`. Find the `## Architecture decisions` section (using the line range captured in Task 3 step 2). Delete the entire section (the heading + intro paragraph + the entire decisions table).

Replace with a single cross-reference line. Pick a logical place — probably right where the section used to start:

```markdown
## Architecture decisions

See [`docs/decisions-log.md`](docs/decisions-log.md) — historical decisions table. Append new entries there, not here.
```

- [ ] **Step 2: Remove the analyze recipe section**

Find `## The \`analyze\` recipe`. Delete the entire section. Replace with:

```markdown
## The `analyze` recipe

See [`docs/recipes/analyze.md`](docs/recipes/analyze.md).
```

- [ ] **Step 3: Remove the session recipe section**

Find `## The session recipe ...`. Delete the entire section. Replace with:

```markdown
## The session recipe

See [`docs/recipes/session.md`](docs/recipes/session.md).
```

- [ ] **Step 4: Remove the dash recipe section**

Find `## The \`dash\` recipe`. Delete the entire section. Replace with:

```markdown
## The `dash` recipe

See [`docs/recipes/dash.md`](docs/recipes/dash.md).
```

- [ ] **Step 5: Remove the judge recipe section**

Find `## The \`/judge\` recipe`. Delete the entire section. Replace with:

```markdown
## The `/judge` recipe

See [`docs/recipes/judge.md`](docs/recipes/judge.md).
```

- [ ] **Step 6: Sanity check the trimmed file**

Run: `wc -l CLAUDE.md`
Expected: ~130 lines (was ~313).

Run: `grep -n "^## " CLAUDE.md`
Expected: section headers still present including all 11 hard constraints, project layout, repo rules, status, pending implementation, plus 5 cross-reference stubs.

Run: `git diff --stat CLAUDE.md`
Expected: large deletion count.

---

## Task 8: Smoke-test that Claude can still resolve cross-refs

- [ ] **Step 1: Restart Electron**

Run: `npm run dev` (from `app/`).

- [ ] **Step 2: Trigger a chat turn that exercises the constraints**

In the CLAUDE popover, type: "What's the cite-or-reject rule, and where do I find the analyze recipe?"

Expected: Claude answers correctly (constraints are still inline) AND mentions `docs/recipes/analyze.md` as the recipe location.

If Claude can't resolve either, the slim was too aggressive. Walk back to Task 7 — likely a section was deleted that shouldn't have been (e.g., the hard constraints list).

- [ ] **Step 3: Verify one bar-close turn still completes**

Wait for the bar-close detector to fire (~60s). Check the CLAUDE activity stream — the bar-close turn should complete normally.

---

## Task 9: Final length verification + commit slim

- [ ] **Step 1: Confirm line count**

Run: `wc -l CLAUDE.md`
Expected: ~130 lines.

- [ ] **Step 2: Commit the slim**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude.md): slim from 313 to ~130 lines

Architecture decisions and operational recipes (analyze/session/dash/judge) relocated to docs/decisions-log.md and docs/recipes/. CLAUDE.md retains the 11 hard constraints, project layout, repo rules, workflow rules, status, and pending implementation lists — these are load-bearing for every Claude turn.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Push + open PR

- [ ] **Step 1: Push**

Run: `git push -u origin feat/claude-md-slim`

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "docs: slim CLAUDE.md (PR2 of walker-engine spec)" --body "$(cat <<'EOF'
## Summary
- Architecture decisions table → `docs/decisions-log.md`
- Operational recipes (analyze, session, dash, judge) → `docs/recipes/*.md`
- CLAUDE.md slimmed from 313 → ~130 lines
- Hard constraints + project layout + workflow rules retained inline (load-bearing for Claude turns)

## Test plan
- [ ] Cross-reference smoke: ask Claude about a constraint + a recipe → both resolve
- [ ] Bar-close turn completes after Electron restart
- [ ] `wc -l CLAUDE.md` ≈ 130

Independent of PR0/PR1 of the walker-engine spec. Can land in parallel.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Done criteria

- CLAUDE.md is ~130 lines
- All 4 recipes live under `docs/recipes/`
- `docs/decisions-log.md` exists with full historical decisions
- Smoke turn confirms Claude can still resolve cross-refs
- Branch pushed, PR opened
