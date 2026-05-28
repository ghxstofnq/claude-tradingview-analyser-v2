---
description: Phase file for the wrap purpose. Fires a few minutes after each session closes. Writes summary.md, then the review turn (separately) extracts durable lessons into persistent memory.
---

---

## OUTPUT PROTOCOL — TOOL SURFACES

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders cards from your tool calls — prose alone does not surface a card.

Reason in prose first; surface last.

This is a session summary turn. Call `mcp__tv__surface_session_summary` exactly once at the end with `bias_picture`, `what_happened`, `watch_next_session`, and `prose_summary`. Skip surface_setup and surface_no_trade for wrap turns.

**`prose_summary`** (2-4 sentences, 50-1000 chars) is your free-form recap in the trader's voice — what setups paid, which didn't, and one lesson worth remembering for next session. Read aloud, sounds like the trader telling a colleague how it went. The REVIEW popover renders this in the WRAP · CLAUDE section with bold/color emphasis applied by the UI.

Example:
> "Two A+ shorts in line with the bearish HTF. First MSS at 29105 sweep hit TP1 in 9 bars — textbook. Second (Trend continuation at 10:18) stopped — entered late, RR was already 1:0.7. Day +1.7R. Memory note: late-entry continuations are still hitting stops more than 50% — flag for next session."

---

<!-- @partial:memory-guidance -->

<phase name="post_session">

**Goal:** write a one-paragraph wrap to this session's folder, then idle.

**The work:**

- If `<sdir>/summary.md` already exists, this session is wrapped — output "Already wrapped." and stop.
- Otherwise read `<sdir>/pillar1.md`, `<sdir>/pillar2.md`, `<sdir>/ltf-bias.md`, `<sdir>/setups.jsonl`, then `Write` `<sdir>/summary.md`:

```markdown
---
session: ny-am          # ny-am | ny-pm | london
date: <YYYY-MM-DD>
wrapped_at: <gates.session.timestamp_et>
---

# Session Summary — <session>, <YYYY-MM-DD>

## Bias picture
<one paragraph synthesizing P1 + P2 + LTF bias, prices cited>

## What happened
<one paragraph: did setups fire / confirm; the session's narrative>

## Watch next session
<one or two bullets>
```

Each session writes its own `summary.md` inside its own folder, so the NY AM, NY PM, and London wraps all persist independently for later review — nothing is overwritten.

### Chat output

The single-paragraph wrap. Then say what's next ("Idle until NY PM at 13:00 ET" / "Idle until tomorrow's London Open").

### Self-check before chat output

- `<sdir>/summary.md` exists with `bias_picture`, `what_happened`, `watch_next_session` filled.
- Bias picture cites at least two prices from `<sdir>/pillar1.md` or `<sdir>/pillar2.md`.
- What-happened references any setup that fired (from `<sdir>/setups.jsonl`) by its model + status, or explicitly states "no setups fired".

If any check fails, rewrite the section, then emit chat output.

</phase>

<phase name="other">

**London Open** — optional context-build window. The system is session-focused (NY AM + NY PM), but if you want a London read, treat it as a one-shot grade. Here `<session>` is `london`, so `<sdir>` resolves to `state/session/<date>/london/`. Write `<sdir>/pillar1.md` and `<sdir>/pillar2.md` exactly as in the Pre-session phase (`phase: london_open` in the frontmatter), then a brief `<sdir>/summary.md` wrap as in the Post-session phase. The `london/` folder is independent — NY AM and NY PM never touch it, so the London grade persists for later review. Skip the grade if `<sdir>/pillar1.md` already exists.

**Inter-session, Closed** — idle. Say "Outside NY sessions — no work" plus current phase + countdown. No state writes.

</phase>
