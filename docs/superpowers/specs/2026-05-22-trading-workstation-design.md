# Trading Workstation — UI Design Specification

**Date:** 2026-05-22
**Status:** Draft v2 — revised against the codebase and the strategy docs
**Audience:** UI/UX designer
**Prepared by:** the app owner (an ICT discretionary futures trader) with Claude

---

## 1. Summary

A single-window **Electron desktop app** that unifies one trader's entire ICT workflow — the TradingView chart, the analysis engine (Claude), and a session journal — into one workspace.

Today these live in three separate windows: TradingView Desktop, a Claude Code terminal, and a status TUI. This app replaces that with one window whose right-hand panel reshapes across the phases of a trading session: **PREP**, **LIVE**, **REVIEW**.

**The designer's job:** design every surface *around* the embedded chart — the chrome, the workstation panels, the Claude conversation, the journal — in a **pure-terminal** visual language. The chart itself is TradingView's own UI and is not designed here (see §4).

---

## 2. Who it's for

One user: a discretionary futures trader who runs **Lanto's 3-pillar ICT strategy**, primarily on MNQ (Micro Nasdaq futures). Solo use — not a product for sale. The user is technical, terse, data-driven, and works in terminal tools all day.

Their method is rule-based and sequential: a fixed 7-step checklist run across fixed phases of the day. The app exists to make running that checklist fast, legible, and reviewable.

**Success:** the trader can run a whole session — prep, live entry-hunting, post-session review — without leaving the window, and can later review every trade decision and its outcome.

---

## 3. Domain primer (for the designer)

The designer is not expected to know ICT trading. The minimum working model:

- **The trading day has up to three sessions.** **NY AM**, **NY PM**, and optionally **London** — each is a separate session, graded and journalled independently. Each session runs its own PREP → LIVE → REVIEW cycle.
- **Each session has phases.** Pre-session prep → the **open reaction** (the first ~15–30 min — watch how price reacts to overnight levels) → **entry hunt** during "killzones" (high-activity time windows) → post-session review. The open reaction is its own distinct activity, not yet entry-hunting (see §6.2).
- **The 3 pillars.** The method's three checks — **Pillar 1: Draw & Bias**, **Pillar 2: Price-Action Quality**, **Pillar 3: Entry Model + Confirmation**. **No trade is taken unless all three align.** See §8.
- **A "setup"** is a potential trade. Each carries: a direction (long / short), an **entry model** (one of three — "MSS", "Trend", "Inversion"; names only, no mechanics needed), **entry / stop / two targets (TP1, TP2) / invalidation** prices, a **risk:reward** number, and a **confirmation status**.
- **Grade.** Every setup is graded with one of exactly three values: **`A+`**, **`B`**, **`no-trade`**. This enum is fixed. The grade is a roll-up of six alignment elements (§8) — never a free-text confidence word.
- **Claude** is the analysis engine — an AI that runs the checklist on every closed price bar and writes up what it sees. In this app, Claude is a live conversation the trader reads and talks to.
- **Levels & liquidity** — the method watches specific price levels (prior day / week highs and lows, overnight session highs / lows). These appear as named price rows.

Full method reference (in this repo, optional depth): `docs/strategy/trading-strategy-2026.md`, `docs/strategy/entry-models.md`.

---

## 4. Platform & technical constraints

Fixed. Design within them.

- **Electron desktop app.** Single window. Desktop-first: design for **1440×900 and up**; must stay usable down to a **1280px-wide** laptop. No mobile, no tablet, no web.
- **The chart is the real TradingView.** The left side embeds **TradingView.com** in a webview — the trader's actual account, custom indicators, saved chart layouts. The trader logs into TradingView *inside the app* on first run; the session persists.
  - **The webview is TradingView's own UI and cannot be restyled.** The designer designs everything *except* the chart interior. Treat the chart region as a rectangle whose contents the designer does not control — but its frame, border, and how it docks are the designer's.
- **Claude runs inside the app** as a hosted conversation. *How* it is hosted is an open engineering question (§16), not a design input.
- **One instrument at a time.** The app shows one symbol's chart and analysis. A symbol switcher changes it. No multi-chart grid, no watchlist wall.
- **Analysis-only — the app never places orders.** See §9: the trade-decision flow is a *journaling* action, not execution.

---

## 5. Information architecture

One persistent structure; modes that reshape with the trading phase.

**Persistent (every mode):**
- A **top bar** spanning the window: app identity, the **mode switch**, and a **status cluster** (§11).
- The **TradingView chart**, always docked **left**.
- A **workstation panel**, always **right**.

**The mode switch — PREP / LIVE / REVIEW — retools the workstation's contents and the split ratio:**

| Mode | Split (chart / workstation) | Workstation becomes |
|--------|------------------------------|----------------------|
| PREP | 50 / 50 | Morning brief |
| LIVE | 70 / 30 | Open-reaction tracker, then Claude + setups rail |
| REVIEW | 50 / 50 | Session journal |

The chart never moves or disappears — only the right side and the split change.

**Modes map to the session's real phases:**

| Phase | Mode |
|--------|------|
| pre-session | PREP |
| open reaction (first ~15 min) | LIVE — open-reaction sub-state |
| entry hunt | LIVE — entry-hunt sub-state |
| post-session | REVIEW |
| between sessions / market closed | idle states (§14) |

**Multiple sessions per day.** A calendar day has NY AM, NY PM, and optionally London. Each runs its own PREP → LIVE → REVIEW. The mode switch operates on the *current* session; the trader can also open REVIEW for an earlier session from the same day (§6.3).

**Mode switching** is manual (the trader clicks), but the app *gently suggests* the phase-appropriate mode (driven by the session-phase clock) — e.g. highlight LIVE as the session opens. Suggestion only; never auto-switch.

---

## 6. The three modes

### 6.1 PREP — pre-session · 50 / 50

**Purpose:** before the session, read higher-timeframe context and form a plan. PREP grades **Pillar 1 and Pillar 2**.

**Chart (left 50%):** TradingView on higher timeframes (Daily / 4H / 1H).

**Workstation (right 50%) — the Morning Brief**, top to bottom:
- **HTF bias** — Daily / 4H / 1H, each with a direction read.
- **Overnight context** — the Asia and London session ranges, and which levels were swept overnight.
- **Key levels** — named price levels: prior week high/low (PWH/PWL), prior day high/low (PDH/PDL), overnight session highs/lows. Each row: name + price + taken/untaken state.
- **Pillar 1 + 2 grade** — the pre-session read of the first two pillars (see §8).
- **Claude's plan** — a short written scenario for the open, generated by Claude.

**Interactions:** read-mostly. Optionally: click a key level to jump the chart to it, or set a price alert on it (§10).

### 6.2 LIVE — 70 / 30

The most-used mode. The chart stays at 70%; the workstation has **two sub-states** driven by the session phase.

**LIVE · open reaction** (first ~15–30 min of the session)

> Strategy Step 4: this window is for *forming the LTF bias*, not entry-hunting. You watch how price reacts to overnight levels.

- **Chart (70%):** TradingView, lower timeframes (1m / 5m).
- **Workstation (30%) — the open-reaction tracker:** overnight high/low (Asia, London), whether NY has broken above/below them, the reaction (sharp rejection vs. continuation), the **forming LTF bias**, and the **HTF/LTF alignment** verdict (aligned → A+ potential; opposed → retrace day). The Claude conversation is present above it.
- When the open reaction resolves (~15 min in), the workstation transitions to the entry-hunt rail.

**LIVE · entry hunt** (rest of the session)

- **Chart (70%):** TradingView, lower timeframes (1m / 5m) with the trader's ICT indicator.
- **Workstation (30%) — a focused vertical rail:**
  - **Claude conversation** (upper, dominant — ~60% of the rail). A live feed: Claude posts a read on every closed bar; the trader can type questions. See §7.
  - **Setups & trades** (lower — ~40%). The current **setup card** (§9, §13) with **Accept / Reject** controls; below it, **active trades** the trader has accepted, each with live outcome state. Multiple setups scroll; the highest-grade or active item pins to the top.
  - A **status line** at the rail's foot: phase, killzone countdown, loop health.
- The **pillar-alignment component** (§8) is visible in this sub-state — it shows why the current setup grades as it does.

**Interactions:** Accept / Reject on setups (§9); type into the Claude conversation; scroll setups; set alerts (§10).

### 6.3 REVIEW — post-session · 50 / 50

**Purpose:** after a session — replay it, study what happened, see how accepted trades resolved.

**Chart (left 50%):** TradingView in **Replay** — step through the session bar by bar. The app supplies **transport controls** — start, step, **autoplay (with a speed control)**, stop — as chrome above or around the chart.

**Workstation (right 50%) — the Session Journal:**
- **Session summary** — the session's overall grade and a written wrap of what happened.
- **Trades & setups with outcomes** — every setup surfaced during the session, its accept/reject disposition, and — for accepted trades — the **outcome** and **result** (§9), plus any journal snapshot.
- **Session library** — a table of past sessions (date · session · #setups · outcome), including earlier sessions from the *same day*; selecting one loads it for replay/review.
- **Lessons** — notes carried out of the session.

**Interactions:** drive replay; select a past session; read; annotate lessons.

---

## 7. The Claude conversation surface

Claude is the analysis engine, present as a **persistent conversation** — most prominent in LIVE, but reachable in every mode (Claude writes the PREP brief and assists in REVIEW).

**Behavior:**
- The session runs on a **bar-close loop**: a background detector fires an event when each price bar closes; Claude reacts to each — running the phase-aware analysis and appending to the session's notes.
- The conversation shows this as a **live feed** — a stream of Claude's per-bar reads, timestamped, newest at the bottom. Reads are short; the trader skims them.
- The trader can **type in** — ask a question, or ask Claude to run a fresh analysis. Trader messages and Claude's replies interleave with the automatic per-bar reads.
- **Loop health must be visible** (§11): healthy / stale / down, with the last bar processed. If the loop is down the trader must know immediately — this is a safety signal.

**Output discipline (affects the UI):** Claude reasons in prose, then emits one small structured block. The **conversation feed shows the prose**; the **setup card is that structured block rendered**. Every price Claude states is backed by a source in the data bundle — prices in the UI are verifiable, not invented.

**Design notes:** visually distinguish three line types in the feed — (a) automatic per-bar reads, (b) the trader's own messages, (c) Claude's direct replies. Per-bar reads are frequent and must be scannable; they must never bury a reply the trader is waiting on.

---

## 8. The pillar & grade model

The method's spine — and the most important thing for the designer to render well.

- **Three pillars must all align before a trade is valid.** Pillar 1 (Draw & Bias) and Pillar 2 (Price-Action Quality) are graded in **PREP**. Pillar 3 (Entry Model + Confirmation) resolves **live**, during entry hunt.
- **The grade is a roll-up of six alignment elements:** HTF bias · overnight context · NY open reaction · price quality · entry model identified · confirmation. **`A+`** = all six align. **`B`** = one element weaker. **`no-trade`** = multiple weak/missing, or no entry model in play.
- The most important single signal is **HTF/LTF alignment** — when the higher-timeframe bias and the NY open-reaction bias point the same way (strategy §2.4). It is the difference between an A+ and a lesser grade.

**Required component — the pillar-alignment panel.** The app must show the grade *with its reasoning*, not as a bare badge: the 3 pillars and the 6 elements behind the current grade, each with a pass / weak / fail state. A glance answers "why is this A+?" or "what's missing?". This is both a strategy requirement (the method *is* this checklist) and a safeguard — an AI's stated confidence is unreliable, so the trader verifies the grade against its parts rather than trusting the label. Whether this lives as its own panel or as an expansion of the grade badge is the designer's call.

---

## 9. The trade decision & journal flow

**This is a new subsystem.** The project today tracks *setups* (candidate / confirmed / invalidated) but has **no trade-tracking, outcome, or P&L capability** — the app introduces it. The app still **never places orders**; it records the trader's *decisions* so they can be reviewed.

**The flow:**
1. A **setup** is surfaced (by Claude / the analysis) in LIVE as a setup card — grade, entry model, direction, **entry / stop / TP1 / TP2 / invalidation**, risk:reward, confirmation status.
2. The trader makes a call — **Accept** or **Reject**:
   - **Accept** = "valid trade, I am taking it." The setup is **recorded and saved** as a taken trade, with a timestamp.
   - **Reject** = "not valid / skipping." Logged as rejected, kept for review.
3. On **Accept**, the app shows **sizing guidance** — the strategy-prescribed size from the **grade + day of week** (strategy Step 7: A+ vs B; Monday/Friday reduced vs. Tue–Thu). Deterministic and rule-based — it surfaces the trader's own rule, it does not advise.
4. The accepted trade is **tracked** — its outcome resolves over time: **TP1 hit / TP2 hit / stopped / invalidated / open**.
5. Optionally, a **journal snapshot** — a chart image captured at the setup — is stored with the trade. *Snapshots are a human memory aid only; they are never fed back into Claude's analysis.*
6. In **REVIEW**, accepted trades appear with outcome, result (R multiple, win/loss), and snapshot; rejected setups appear too, so the trader can review both trades taken and trades passed.

**Design implications:**
- Every setup card needs clear, deliberate **Accept / Reject** controls. Accept is a commitment — weightier than a casual click, but fast (live market). No multi-step modal.
- An accepted trade needs a distinct **"taken trade"** treatment, visually separate from un-acted setups.
- The accept/reject disposition + outcome is the spine of REVIEW.
- **"No trade" is a correct, common result.** The state where nothing is accepted must read as disciplined, not empty or failed.
- **Vocabularies are not yet finalized.** Per-trade outcome (`TP1 hit / TP2 hit / stopped / invalidated / open`) and the session-level review verdict are to be designed with the owner (§16) — design the badges to accommodate a small fixed set.

---

## 10. Price alerts

A complement to the bar-close loop, so the trader can step away from the screen.

- The trader (or Claude) can set a **price alert** on a key level — most naturally from a key-level row in PREP, or from a level Claude names.
- When an alert fires, it surfaces as a **notification** plus an entry in a **fired-alerts feed** — a compact, always-reachable list of what has triggered and when.
- The project already has alert create / list / delete; the fired-alert *detection* mechanism is an engineering open question (§16).

---

## 11. Global chrome

**Top bar (all modes):**
- App identity — left.
- **Mode switch** — PREP · LIVE · REVIEW. The current mode is unmistakable; the phase-appropriate mode is gently suggested.
- **Status cluster** — right: current **symbol** (with the symbol switcher), **ET clock**, **session phase**, **killzone countdown**, **loop-health** indicator.

**Symbol switcher:** changes the single instrument. Compact — the trader rarely switches. Not an always-visible watchlist.

**Loop-health indicator:** small, always visible, three states — **healthy** (detector + Claude alive, bars processing), **stale** (falling behind), **down** (not running). A safety indicator; the "down" state must be impossible to miss.

---

## 12. Visual language — pure terminal

The owner chose this direction from three options (pure terminal / refined terminal / modern dark). The chart keeps TradingView's look; **every other surface** uses this language.

- **Surface:** near-black background (`#0a0c10` panels, with slightly lighter strata for layering). Hairline borders (`~#1e2228`), **1px, zero border-radius**. No shadows, no gradients, no rounded corners.
- **Type:** **monospace throughout** (system mono — SF Mono / Menlo / `ui-monospace`). Small sizes, tight leading. Headers uppercase and letter-spaced.
- **Density:** high — a Bloomberg-terminal aesthetic. Information-dense and scannable; whitespace groups, it does not decorate.
- **Color is semantic, not decorative:**
  - **Amber `#e3b341`** — primary accent: panel headers, key numbers, prices.
  - **Green `#3fb950`** — long / confirmed / positive / healthy / pass.
  - **Red `#f0796a`** — short / stop / invalidated / down / fail.
  - **Greys** — labels `#5f6670`, values `#c4ccd4`.
- **Grade badge:** `A+` / `B` / `no-trade` — small, solid, high-contrast; `A+` reads strongest.
- **Buttons:** bracketed terminal style — e.g. `[ ACCEPT ]` — uppercase, outline or text, no fill, no radius.
- **Chart frame:** a hairline border around the TradingView webview so it sits inside the terminal language.

The existing terminal dashboard `tv dash` (`cmd/tv-dash/`) is a living reference for this aesthetic.

---

## 13. Component inventory

Reusable pieces the designer should define once:

- **Panel** — titled container (uppercase header + optional right-aligned badge/control).
- **Data row** — label (left, dim) + value (right). The atom of every panel.
- **Price row** — a data row whose value is a price (amber).
- **Named-level row** — name + price + taken/untaken state; can carry a "set alert" affordance.
- **Grade badge** — `A+` / `B` / `no-trade`.
- **Pillar-alignment panel** — the 3 pillars + 6 elements behind the grade, each pass / weak / fail (§8).
- **Status pill / dot** — phase, killzone, loop-health, confirmation status.
- **Open-reaction tracker** — overnight levels, break/reaction state, forming LTF bias, HTF/LTF alignment (§6.2).
- **Setup card** — grade + model + direction + entry / stop / TP1 / TP2 / invalidation + R:R + confirmation + Accept/Reject.
- **Taken-trade card** — an accepted setup + sizing + live outcome state + optional snapshot.
- **Sizing display** — grade + day-of-week → prescribed size (§9).
- **Conversation feed** — Claude's stream, three distinct line types (per-bar read / trader message / reply).
- **Fired-alerts feed** — triggered price alerts, time-stamped (§10).
- **Transport controls** — replay start / step / autoplay+speed / stop.
- **Mode switch** — the PREP/LIVE/REVIEW control.
- **Table** — session library, outcomes lists.

---

## 14. States to design

Not just the happy path:

- **Market closed** — outside trading hours; the app is idle.
- **Between sessions** — e.g. after NY AM, before NY PM; the just-finished session is reviewable, the next is not yet live.
- **Before the open** — PREP with no live data yet.
- **Open reaction in progress** — LIVE's first sub-state, no setups yet by design.
- **Loop down** — detector or Claude not running; the safety state.
- **No setups yet / no-trade** — LIVE, session on, nothing actionable — a disciplined state, not an error.
- **TradingView not logged in** — first run, or an expired webview session.
- **No past sessions** — REVIEW with an empty library.
- **Alert fired** — the notification + feed state.
- **Replay vs realtime** — the REVIEW chart in both states.

---

## 15. Out of scope

- Order entry and execution logic — the app never places orders. (The embedded TradingView webview carries the trader's live broker connection so the trader executes inside it; that's TradingView's own feature, required but not built by the app.)
- Multi-chart grids, watchlist walls, multiple symbols at once, any symbol scanner.
- Mobile, tablet, web.
- Any restyling of the TradingView chart interior.
- Pine Script editing (a developer tool; stays in the CLI).
- The `/judge` / fixture regression tooling (developer QA; not a trader-facing surface).
- A backtesting UI beyond the REVIEW replay.
- Feeding screenshots into Claude's analysis — the analysis runs on structured data only (journal snapshots in §9 are a separate, human-only memory aid).

---

## 16. Open questions & decisions

### Decisions (2026-05-23)

- **Data pipeline.** TradingView Desktop on CDP 9223 keeps running behind the Electron app — the existing CLI and analysis pipeline (`tv analyze`, gates, engine parser, bar-close detector) stay untouched. The embedded TradingView webview is a *separate* visual surface (the trader's account with broker connected); the analysis target is the headless Desktop. Two TradingView instances, one job each.
- **Claude hosting.** **Claude Agent SDK (TypeScript)** runs in the Electron main process; the renderer talks to it over IPC. The SDK handles streaming, tool routing, and session persistence; `./bin/tv` commands are exposed as SDK tools. Skeleton ≈ 100–200 LOC. Prior art: `vanzan01/claude-agent-sdk-starter`, `pheuter/claude-agent-desktop`.
- **Trade-outcome source.** **Bar-close inference** for v1 — Claude polls 1m/5m bars (already wired via `tv analyze`) and infers TP/stop hits from price. The trade-tracking schema is designed so a future opt-in `tv reconcile --broker <name>` adapter can patch actual fills (slippage + commissions) onto the inference records overnight. Tradovate is the cleanest first reconciler target ($25/mo API add-on).
- **Reading the broker through TradingView is a dead end** — recorded so we don't re-research. The Broker Integration API is one-way (brokers feed TradingView, not the other way); the Trading Panel widget data lives in private WebSockets into a virtualised, build-hashed React store; CDP-scraping it is brittle and likely violates ToS. Pine `strategy.*` only sees its own simulation, not the live broker.
- **Persistence format for accepted trades.** Trades persist as `state/session/<date>/<session>/trades.jsonl` — one line per accepted trade, outcome updates appended as new lines on the same trade id. Matches the existing JSONL pattern alongside `bars.jsonl`, `bars-5m.jsonl`, `setups.jsonl`.
- **Outcome enum.** `TP1 HIT | TP2 HIT | STOPPED | INVALIDATED | OPEN`. Fixed set; designed into the prototype's REVIEW card and ratified here.
- **Session-verdict vocabulary.** The session row in REVIEW uses the same `A+ | B | no-trade` enum as setup-level grading — one vocabulary, two scopes.
- **Fired-alert detection.** Poll TradingView's alert list via the existing CDP-driven CLI (`tv alert list`); emit a `fired` event when an alert's state transitions to triggered. No new transport.

### For the designer to raise

- Any panel in §6 whose content needs reprioritising once real data volume is seen.

---

## 17. Reference material

- **Layout wireframe** — the B+C hybrid across the three modes, with split ratios: [`assets/layout-wireframe.html`](assets/layout-wireframe.html). Open in any browser.
- **Visual direction** — the pure-terminal aesthetic, with colour tokens and the setup-card field reference: [`assets/aesthetic-pure-terminal.html`](assets/aesthetic-pure-terminal.html). Open in any browser.
- Strategy reference: `docs/strategy/trading-strategy-2026.md`, `docs/strategy/entry-models.md`.
- Aesthetic reference: the existing `tv dash` terminal UI — `cmd/tv-dash/`.
