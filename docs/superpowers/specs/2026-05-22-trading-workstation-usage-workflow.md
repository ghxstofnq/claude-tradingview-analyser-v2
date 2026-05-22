# Trading Workstation — Usage Workflow

**Date:** 2026-05-22
**Status:** Draft — operating workflow
**Companion to:** the UI design spec — [`2026-05-22-trading-workstation-design.md`](2026-05-22-trading-workstation-design.md)

---

## 1. What this is

How the trader runs a trading day with the Trading Workstation — the routine across PREP / LIVE / REVIEW, the division of labour between the trader and Claude, and how the app replaces today's three-window setup.

The design spec describes *the app*; this describes *operating it*. The trading method itself is documented in `docs/strategy/` (Lanto's 3-pillar framework and the 7-step checklist).

---

## 2. Shape of the day

- One window, open for the whole session.
- **NY AM is the primary session.** NY PM and London are traded occasionally; each runs the same cycle.
- The app's ET clock drives the mode and suggests the next one; the trader follows the suggestion.
- Each session is one cycle: **PREP → LIVE (open reaction → entry hunt) → REVIEW.**

---

## 3. The day-in-the-life

For NY AM; PM and London are the same shape.

### PREP — before the open

- The app is in PREP; the chart is on the higher timeframes (Daily / 4H / 1H).
- Claude has run the pre-session pass: **Pillar 1 (Draw & Bias)** and **Pillar 2 (Price-Action Quality)** graded.
- The trader reads the **Morning Brief** — HTF bias, overnight context (Asia / London ranges + what was swept), key levels, the Pillar 1+2 grade, Claude's plan for the open — against the HTF chart.
- The trader arms price alerts on the levels that matter.
- Leaving PREP **arms the bar-close loop** — Claude is now set to react on every closed bar.
- **Trader's decision:** engage today, or stand aside. A weak Pillar 1/2 read is a no-trade day.

### LIVE · open reaction — 09:30 to ~09:45 ET

- The app suggests LIVE; the chart drops to the lower timeframes (1m / 5m).
- The workstation shows the **open-reaction tracker** — overnight high/low, whether NY breaks or rejects them, the forming LTF bias, the HTF/LTF alignment verdict.
- Claude posts a read on every bar close. The trader **watches** — this window forms the LTF bias; it is not entry-hunting yet.
- **Trader's decision:** aligned day (A+ on the table) or retrace day.

### LIVE · entry hunt — ~09:45 to session end

- The workstation becomes the **Claude conversation + the setups rail**.
- Claude walks the 3-pillar checklist on every bar close. When a setup forms it surfaces as a **setup card** — grade, entry model, entry / stop / TP1 / TP2 / invalidation, confirmation status — with the **6-element grade breakdown**.
- **The trader's core job, all session: accept or reject each setup.** Check the grade against the pillar breakdown, then call it.
- On **accept**: the app records the trade and shows the prescribed size (grade + day of week). The trader places the order in the embedded TradingView order panel — same window (see §4). The app tracks the outcome (TP1 / TP2 / stopped / open).
- On **reject**: logged for review.
- The trader can step away — **armed alerts** call them back when price reaches a level.
- The trader can ask Claude questions in the conversation at any time.

### REVIEW — after the session

- The app suggests REVIEW; the chart goes to **Replay**.
- The **session journal** shows the session grade, accepted trades with outcomes and results (R, win/loss), the rejected setups, and lessons.
- The trader replays the session, studies it, and notes what carries forward.
- The session is saved to the library; lessons inform the next session's PREP.

---

## 4. Execution model

The app is **analysis-only — it never sends an order.** "Accept" records the *decision* to take a trade.

The trader's broker is wired to TradingView, so the order panel lives **inside the embedded chart**. The LIVE flow is therefore one continuous, single-window motion:

> setup surfaces in the rail → check the grade against the pillars → **accept** (app logs the decision + size) → **place the order in the embedded TradingView panel** → app tracks the outcome.

No alt-tabbing — accept and execute happen in the same window.

---

## 5. Trader ↔ Claude — division of labour

| Claude does | The trader does |
|---|---|
| Runs the bar-close loop; grades the pillars; posts a read every bar | Reads the brief; forms the plan |
| Surfaces setups with grade + 6-element breakdown | **Accepts / rejects** each setup |
| Tracks accepted-trade outcomes | **Places the order** (in-window) |
| Writes the session summary | Decides to engage or stand aside; journals lessons |

Claude analyses; the trader judges and executes. No trade is taken without the trader's explicit accept.

---

## 6. What it replaces

| Today — three windows | In the app |
|---|---|
| TradingView Desktop | the embedded chart |
| Claude Code terminal (the `/analyze` session) | the in-app Claude conversation + bar-close loop |
| `tv dash` (oversight TUI) | the status line + loop-health indicator |

---

## 7. Implication for the build

This workflow makes one thing a hard requirement: the embedded chart must be the **full, logged-in TradingView webview with the broker connection live** — because the trader executes through TradingView's in-window order panel. The cut-down widget used in the design prototype cannot do this.

The design spec (§4) already specifies the full webview; this workflow makes the broker connection the operative, non-negotiable part of it.
