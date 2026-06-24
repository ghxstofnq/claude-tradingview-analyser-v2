# Plan — Validate the faithful-Lanto chain, then live-trade it on Tradovate demo

> Canonical copy: `~/.claude/plans/mellow-frolicking-chipmunk.md` (approved 2026-06-23).
> Checklist: [tasks/todo.md](todo.md). Supersedes the prior backtest-baseline plan
> (PR #147, merged+deployed — recoverable in git history).

## Context

Brain (Stages A–E) and the Tradovate execution layer are merged on
`feat/faithful-lanto-rebuild`. What's missing is the **gate**: Stage G (fold the Lanto
oracle sessions through the rebuilt chain, confirm it picks Lanto's
bias/grade/model/side/entry/stop/TP) has never run — only 1 of ~7 oracle tapes exists.

Decision (user, 2026-06-23): **strict gate first** — Stage G must pass before any live
session (first live session, London, slips if needed). When live it runs **armed
auto-fire on Tradovate demo** (no real money), **autonomous**, Claude-monitored, user
reviews the recap. Real money is a separate later gate.

## Phases (each a complete vertical path; 1↔2 loop until the gate passes)

0. **Smoke the harness** — fold the existing 06-09 tape + any salvaged live sessions; prove the chain folds clean.
1. **Stage G (gate)** — record + fold all ~7 oracle sessions; compare each to oracle Part D; promote+verify on match.
2. **Chain fixes** — TDD-fix each oracle divergence, coherently; re-fold.
3. **Stage F finish** — UI surfaces the validated outputs (design-harness + state files; no computer-use).
4. **Readiness + Tradovate arming (gate)** — backend/capture/live-check/supervisor green; demo confirmed+armed; routing verified by tests, no orders placed.
5. **First live demo session** — next London after gates; armed, autonomous, monitored; recap.
6. **Iterate to fully working** — fix Phase-5 defects, re-guard the gate, more clean sessions.

## Checkpoints
- **G** (after Phase 1): all oracle sessions match Lanto — hard gate, user reviews.
- **R** (after Phase 4): readiness green + demo armed — user confirms the London target.
- **Session** (after Phase 5): traded correctly? triage defects.

## Oracle sessions (Stage G)
02-09 (A+ multi-align long) · 06-09 (A+ Inversion short) · 12-12 (2/3-B short, **MES**) ·
10-02 (B long→flip, MNQ) · 06-16 (B short) · 06-17 (no-trade) · 06-18 (marginal B long).

See the canonical plan for per-step acceptance, the verification cheatsheet, and risks.
