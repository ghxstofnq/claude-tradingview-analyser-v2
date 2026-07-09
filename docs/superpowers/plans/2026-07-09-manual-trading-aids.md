# Implementation Plan: Manual-Trading Aids

2026-07-09 · status: APPROVED — user input received; decisions recorded below.

## Overview

Seven improvements that make manual trading easier by turning the app from a
silent watcher into an active co-pilot: it should call you when something needs
eyes (sounds/notifications), tell you what it's waiting for (hunt view), keep
the day's rules in front of you (day chip), remove mental math at entry time
(one-key ticket), capture every trade for review automatically (auto-journal),
train you off-session (drill mode), and put the two missing strategy visuals on
the chart (SMT, NY-open window).

**Relationship to the 2026-07-09 Hermes plan** (`.hermes/plans/2026-07-09_201121-…`):
that plan is the bot-trustworthiness / go-live track (evidence gates, execution
lifecycle, reconciliation). This plan is the operator/manual-trading layer. No
file-level collisions expected except `TopBar.jsx` / `LivePage.jsx` (both plans
touch app truth surfaces) — whichever lands second rebases.

## Architecture decisions

- **No new data producers.** Every feature reads existing streams:
  `deterministic:packet` (per-bar walker truth), `walkers:state` (walker list),
  `useSessionBrief` / `useOpenReaction` (day context), execution fill events.
  The walker chain stays the single setup brain; nothing here grades, routes,
  or vetoes trades.
- **All arithmetic in code** (distances, R, size) — helpers + existing
  `cli/lib/sizing.js`. Constraint #7 unchanged.
- **Sounds/notifications ride the existing prefs pattern** (`usePrefs`:
  `notif` / `sound` / `autoTicket`, already wired for price alerts) — extended,
  not duplicated.
- **Pine changes are additive and visual-only.** Schema stays 4. SMT is a
  display aid; if the chain ever consumes it, that's a separate default-off
  lever + full-corpus fold per the standing faithfulness rule.
- **Journal screenshots are for the human reviewer only** — never analysis
  input (constraint #5 intact).

## Task list

### Phase 1 — Awareness (the machine stares so you don't)

#### Task 1: Walker stage-change sounds + notifications — **S/M**

**Description:** A pure classifier turns consecutive walker/packet events into
named signals — `walker_spawned`, `zone_tapped`, `awaiting_confirm`,
`packet_fired`, `walker_invalidated`, `bias_flip` — and CommandShell plays a
distinct WebAudio tone per class (packet gets the loudest + a native
notification via `notifySystem`, so it lands even with the window hidden).
Gated by the existing `sound` / `notif` prefs; a new Settings toggle scopes
walker sounds separately from price-alert sounds.

**Acceptance criteria:**
- [ ] Packet fire always produces sound + native notification when enabled
- [ ] Stage transitions produce distinct, quieter tones; no repeats on re-folds of the same bar (de-dupe by `eventTimeUtc` like `useDeterministicBrain`)
- [ ] All-off prefs produce zero audio/notifications

**Verification:** `node --test` on the transition classifier (pure); manual: replay a recorded tape through the fold and hear/see the sequence.
**Dependencies:** none. **Files:** new `app/renderer/src/shell/walkerSignals.helpers.js`, `CommandShell.jsx`, `usePrefs.js`, `SettingsPage.jsx`, `tests/…` (≈4 files)

#### Task 2: Live-page hunt view — **M**

**Description:** Replace the "Awaiting next walker fire" empty line with a
WALKERS panel on LivePage FEED: one row per active walker — model, side, stage,
zone bounds, **distance in points from last price** (computed in a helper from
the walker's zone + symbol cache), and a one-line "waiting for: tap → 1m close
through CE" / "dies if: close through {level}" derived from the walker stage.

**Acceptance criteria:**
- [ ] Every active walker renders with stage + live distance; updates per bar
- [ ] Empty state says what would create a walker ("no PD arrays being walked — nearest candidate {zone} {n}pts away") when the engine has candidates, else an honest quiet-market line
- [ ] Panel renders identically from recorded fixture data (no live-only rendering path)

**Verification:** `node --test` on row-builder helpers (`Live.helpers.js` pattern); design-harness screenshot of LivePage with fixture walkers.
**Dependencies:** none. **Files:** `LivePage.jsx`, `Live.helpers.js` (+tests), maybe `useWalkers.js` (≈3-4 files)

#### Task 3: Top-bar day chip — **S/M**

**Description:** An always-visible chip in the top bar with the day's operating
rules: grade cap (`A+ elig / B cap / NO-TRADE`), bias count (`2/3`), today's
size rule (from `computeSize` — Mon/Fri half, Tue–Thu full), and a hard red
**HANDS OFF** state when the open-reaction reverses the bias (spec: BIAS 18:42).
Data from `useSessionBrief` + `useOpenReaction`; size via one new read-only IPC
that calls `cli/lib/sizing.js` in main.

**Acceptance criteria:**
- [ ] Chip shows grade · bias-count · size from today's brief; absent brief → "no brief yet" dim state (never fabricated values)
- [ ] Open-reaction reversal renders the red HANDS OFF variant
- [ ] Clicking the chip opens the Briefing page

**Verification:** `node --test` on the chip formatter (pure); screenshot via design-harness.
**Dependencies:** none (rebase-aware of Hermes TopBar work). **Files:** `TopBar.jsx`, new formatter helper (+tests), `ipc.js`, `preload.cjs` (≈4-5 files)

### Checkpoint 1 — after Tasks 1-3
- [ ] Tests + vite build green; smoke fixtures untouched (22/22)
- [ ] One live (or replayed) session heard + seen end-to-end: sounds fired, hunt view tracked walkers, chip matched the brief
- [ ] User review before Phase 2

### Phase 2 — Action (remove friction at the moment of entry/exit)

#### Task 4: One-key ticket from packet — **M**

**Description:** When a packet fires, pressing Enter on the packet notification
(or the palette command "Ticket from last packet", or the existing `autoTicket`
pref) opens the palette TicketView prefilled from the packet: symbol, side,
entry, structural stop, TP1, and size already computed by grade × weekday. The
trader reviews and confirms — the existing accept/arm flow is unchanged
(SUGGEST-mode gate intact; no auto-submission).

**Acceptance criteria:**
- [ ] Packet → prefilled ticket carries the exact packet numbers (no recompute drift); mapper is a pure tested fn
- [ ] `autoTicket` on: palette opens prefilled on packet fire; off: nothing auto-opens
- [ ] Confirm path is byte-identical to today's manual ticket accept (guardrails untouched)

**Verification:** `node --test` on packet→ticket mapper; manual: fold a tape to a packet and walk the ticket.
**Dependencies:** Task 1 (packet signal plumbing). **Files:** `paletteIntent.helpers.js` or new mapper, `TicketView.jsx`, `CommandShell.jsx` (+tests) (≈4 files)

#### Task 5: Auto-journal on trade close — **M**

**Description:** When a real fill closes a position (flatten, stop, TP), main
appends a journal row — entry/exit/realized R/duration/setup reference — to the
session journal `review.js` already reads, captures one chart screenshot into
`state/session/<date>/<session>/journal/` (human review only), and the renderer
shows a non-blocking toast prompting an optional one-line "weakest pillar?"
note appended to the same row.

**Acceptance criteria:**
- [ ] Every close event produces exactly one journal row with code-computed R (matches execution engine's number, never recomputed elsewhere)
- [ ] Screenshot lands in the session folder; REVIEW → JOURNAL renders row + note
- [ ] Note prompt is skippable; skipping loses nothing else

**Verification:** `node --test` on the row builder; paper-trade close on the 9223 webview produces row + file (user places the trade — I never place orders).
**Dependencies:** none. **Files:** `app/main/execution/…` close hook, `review.js`, `ReviewPage.jsx`, toast wiring (+tests) (≈5 files)

### Checkpoint 2 — after Tasks 4-5
- [ ] A full manual paper round-trip: packet → sound → ticket → accept → close → journal row, zero manual bookkeeping
- [ ] User review before Phase 3

### Phase 3 — Practice + chart

#### Task 6: Drill mode — **M/L, guarded**

**Description:** Palette command "Drill: random session" — picks a random
recorded corpus session, drives TV bar-replay to the session open, and steps
1m bars on your keypress while you walk the 7-step checklist by hand. "Reveal"
shows the walker's packet + the recorded outcome for comparison; a scorecard
(your call vs bot vs outcome) appends to a drill log. **Guarded by the backtest
exclusivity pattern:** requires detector stopped + off-session (one CDP driver
rule; replay-wedge memories apply), reuses the backtest engine's replay
plumbing + wedge recovery.

**Acceptance criteria:**
- [ ] Drill refuses to start during a session window or with the detector running
- [ ] Random session loads at the open; step/reveal/score loop works; TV replay always exits cleanly (also on abort)
- [ ] Drill log rows accumulate; no writes into live session folders

**Verification:** `node --test` on session-picker + scorecard builders; one manual drill end-to-end off-session.
**Dependencies:** none, but riskiest (replay wedge) — isolated by design. **Files:** new `app/main/drill.js`, palette command, small DrillView, IPC/preload (+tests) (≈5-6 files)

#### Task 7: Pine — NY-open reaction window — **S**

**Description:** Additive visual in `pine/ict-engine.pine`: a 09:30 ET open
marker plus shading for the minute-15→30 decision window (checklist Step 4 has
no visual anchor today). No emit changes; schema stays 4.

**Acceptance criteria:**
- [ ] Window renders on 1m/5m, hidden on HTF; zero new/changed emit keys (parser diff clean)

**Verification:** deploy per the documented procedure (open→set→Update on chart→save; verify study count 1); `tv data tables` diff shows unchanged rows; screenshot.
**Dependencies:** none. **Files:** `pine/ict-engine.pine` (1 file)

#### Task 8: Pine — SMT divergence read (visual-only) — **M**

**Description:** `request.security` on the sibling symbol (MES1! from MNQ chart
and vice versa); compare the last swing pair; render a checklist-panel row
("SMT: MES not confirming HH ✕") + optional marker at the diverging swing.
Additive emit row `smt` (state + sibling swing) for future use — **explicitly
display-only**; any chain consumption is a separate default-off lever + fold.

**Acceptance criteria:**
- [ ] Panel row states confirm / diverge / n-a (sibling data unavailable) honestly
- [ ] Emit additions are purely additive (existing citation paths untouched; parser types the new row; schema stays 4)

**Verification:** parser unit test for the new row; deploy + verify keys-present on fresh zones; visual check against a known divergent day.
**Dependencies:** Task 7 (same deploy batch preferred). **Files:** `pine/ict-engine.pine`, `cli/lib/ict-engine-parser.js` (+test) (≈3 files)

#### Task 9 (no code): chart checklist for the user

Add a public **HTF candles** overlay indicator (5m/15m candles rendered on the
1m chart — keeps 1m-close confirmation discipline without TF flipping), and
enable TV built-ins: economic events on the time axis, session breaks, and the
position tool. 10 minutes, zero code, user does it once on the 9225 layout.

### Checkpoint 3 — complete
- [ ] All acceptance criteria met; full suite + smoke green; each PR merged + app deployed per the always-deploy-after-merge rule

## Ordering & PR mapping

One task = one PR (Task 7+8 may share one Pine deploy PR). Order: 1 → 2 → 3 →
checkpoint → 4 → 5 → checkpoint → 6 → 7/8 → 9. Tasks 1-3 are independent and
parallelizable; 4 depends on 1.

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Notification fatigue → sounds get muted | High (kills the feature) | Few, distinct, quiet stage tones; loud only on packet; per-class toggles; de-dupe on re-folds |
| Drill mode wedges TV replay | Med | Exclusivity guard (detector stopped + off-session), reuse backtest wedge recovery, always-stop-replay finally block |
| Pine deploy duplicates/reverts study | Med | Follow the 2026-06-21 documented procedure exactly; verify by key-presence + study count 1 |
| SMT scope-creep into the chain | High (faithfulness) | Visual-only in this plan; chain use = separate default-off lever + full-corpus fold |
| Collision with Hermes plan (TopBar/LivePage) | Low | Small PRs, rebase-second policy noted in both plans |
| Journal screenshot misuse as analysis input | Low | Stored under `journal/`, never referenced by any bundle/prompt path |

## Decisions (user input 2026-07-09)

1. **Sound style: chimes** (user). Distinct WebAudio tones per event class;
   loud only on packet fire / bias flip.
2. **Auto-ticket: stays opt-in OFF** (delegated). A palette stealing focus
   mid-chart is worse than a chime; the packet toast/notification becomes the
   one-click ticket path, and the `autoTicket` pref flips it to automatic.
3. **Day chip: as proposed** (delegated) — `grade cap · bias count · size`,
   red HANDS OFF variant, click opens Briefing.
4. **Journal note prompt: keep, dismissible** (user). Toast must be explicitly
   dismissible and skippable with zero data loss.
5. **Drill mode: parked last** (delegated). Pine tasks 7/8 move ahead of it —
   new Phase 3 order: 7 → 8 → 9 → 6.
6. **SMT: chart panel only** (delegated). Mirroring into the app would create a
   second surface that can disagree — revisit only with the walker-verdict
   on-chart roadmap item.
