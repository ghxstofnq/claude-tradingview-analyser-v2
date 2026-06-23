# Product

## Register

product

## Users

A single discretionary ICT futures day-trader (the owner/operator). Trades MNQ and MES
during the New York sessions (London / NY-AM / NY-PM killzones) following Lanto's 3-pillar
ICT methodology. Works at a desk on a desktop (Electron) app beside a live TradingView
chart, moving through one workflow per session: prep the bias → watch the open → hunt a
setup → manage the trade → review. A power user fluent in the domain who wants signal and
speed, not hand-holding.

## Product Purpose

A TradingView-driven ICT analysis and execution workstation that runs the trader's
documented strategy end-to-end. It captures multi-timeframe market structure from a live
chart, grades the daily bias and price quality, surfaces A+ / B / no-trade setups from a
deterministic walker chain, executes (paper-first, guarded live) with sizing + guardrails,
and journals every session for review and backtest. Success = the trader trusts it to prep,
flag, and manage trades faithfully to the strategy — zero hallucinated levels, no manual
number-crunching.

## Brand Personality

Precise, quiet, professional-grade. The tool disappears into the task: monochrome near-black
surfaces, one white action, status carried by a tight semantic palette. The voice is terse
and factual — a calm instrument, not a coach. Confidence through restraint; every pixel earns
its place. Reference: Raycast — command-palette calm, hairline structure, ss03 Inter.

## Anti-references

Explicitly NOT:
- A gamified retail-broker app (Robinhood-style celebration UI, dopamine buttons, confetti).
- A SaaS marketing site (gradients, hero-metric templates, identical card grids, eyebrow
  kickers — the AI-slop look).
- A cluttered legacy terminal (Bloomberg-style wall of tiny multicolored text, no hierarchy).
- A generic "admin template" dark dashboard (navy/grey, purple accent, rounded-everything).

## Design Principles

1. **The instrument disappears.** The chart and the numbers lead; chrome recedes to
   near-black. If a control competes with the data for attention, the control is wrong.
2. **One action, one color.** White is the only primary action. Saturated hues mean *status*
   (grade, long/short, displacement) — never decoration, never chrome.
3. **Every number is sourced, never invented.** Cite-or-reject and no-LLM-arithmetic are
   product law; the UI shows computed values, never guesses.
4. **Signal over density — but density when earned.** Show what the current session phase
   needs and let the rest collapse. Dense is fine when the trader needs it; clutter is not.
5. **Trust through consistency.** The same component means the same thing on every panel — a
   setup card, a grade pill, a status chip read identically in PREP, LIVE, and REVIEW.

## Accessibility & Inclusion

Single-user desktop tool, standard needs. Hold body/label contrast at WCAG AA (≥4.5:1) on the
near-black canvas, keep keyboard basics working (focusable controls, visible focus, the
existing 1/2/3 hotkeys), and ship a `prefers-reduced-motion` fallback for any animation added.
No specialized accommodations required at this time.
