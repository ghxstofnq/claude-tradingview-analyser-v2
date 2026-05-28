# How Claude runs inside the app

Reference for the prompts and files the in-app Claude session sees, separate from the CLI `/analyze` slash command flow. This is what actually drives the desktop Trading Workstation.

## Three turn types

| Trigger | Turn | Source |
|---|---|---|
| Auto at 02:00 / 09:00 / 13:00 ET + app-open if missing + PREP refresh button | **Session brief** | [`app/main/session-brief.js`](../app/main/session-brief.js) |
| Every closed bar in LIVE mode | **Per-bar** | [`app/main/bar-close.js`](../app/main/bar-close.js) |
| Auto at 06:05 / 12:05 / 16:05 ET + app-open catch-up | **Session wrap** | [`app/main/session-wrap.js`](../app/main/session-wrap.js) |

All three call `userTurn()` in [`app/main/sdk.js`](../app/main/sdk.js) which calls the Claude Agent SDK's `query()`, with the per-turn prompt below as the user message and the system prompt assembled from two pieces. After each completed turn, `app/main/turn-surface-contract.js` validates the observed `surface_*` tool calls; a prose-only or wrong-phase turn emits a `surface contract violation` error before `turn_complete`, so the dashboard/metrics cannot silently treat a non-surfaced analysis as successful.

---

## System prompt (loaded once per turn, identical for all turn types)

`systemPrompt = analyze.md + OUTPUT_PROTOCOL`

### Part 1 — [`app/main/prompts/analyze.md`](../app/main/prompts/analyze.md)

467 lines, byte-identical to [`.claude/commands/analyze.md`](../.claude/commands/analyze.md). Contains:
- Strategy authority pointer ([`docs/strategy/*.md`](strategy/))
- Bundle field reference for `tv analyze`
- The seven non-negotiable rules (cite-or-reject, no arithmetic, prose first, grade enum, etc.)
- Phase routing table (`pre_session` / `open_reaction` / `entry_hunt` / `post` / `inter_session`)
- Section bodies for each phase telling Claude exactly what files to read and write
- ICT vocabulary
- Three A+ example readings (MSS / Trend / Inversion)
- The JSON output template for confirmed setups

Open the file directly for the verbatim text.

### Part 2 — `OUTPUT_PROTOCOL` (appended, defined in [`app/main/sdk.js`](../app/main/sdk.js))

```
---

## OUTPUT PROTOCOL — TOOL SURFACES (read carefully)

You are running inside the desktop Trading Workstation, not the CLI. The workstation panel renders setup cards from your tool calls — prose alone does not surface a card.

**Every analysis turn MUST end with exactly one tool call**, in this order of priority:

1. If a valid setup is in play and you would call it `A+` or `B` — call `mcp__tv__surface_setup` with the full setup payload (grade, model, direction, entry, stop, tp1, tp2, invalidation, rr, confirmation_status). Do this AFTER your prose reasoning.

2. Otherwise (any reason you would have written "no-trade" in prose) — call `mcp__tv__surface_no_trade` with a short `reason` string. Examples:
   - "outside active session"
   - "no entry model in play"
   - "price quality weak — premium/discount unclear"
   - "HTF/LTF opposed — retrace day"

Writing "no trade" or "no setup" in prose without calling `surface_no_trade` is a bug — the UI will stay stuck on the previous state. Always end with one of the two surface tools.

To read the chart, use `mcp__tv__tv_analyze_full` (full multi-TF sweep) or `mcp__tv__tv_analyze_fast` (1-bar poll with a baseline path). To arm alerts, use `mcp__tv__tv_alert_create`.

**EXCEPTION — session-brief turns.** When the user message asks you to run "the SESSION BRIEF for the X session", do NOT call surface_setup or surface_no_trade. Instead, call `mcp__tv__surface_session_brief` exactly once at the end of the turn with the structured payload. That's the only tool that surfaces the PREP panels.

**EXCEPTION — open-reaction phase turns.** When the per-bar message says "Phase: open_reaction": call `mcp__tv__surface_open_reaction` with the latest read (what NY just did, bias direction so far, what you're watching) — this persists to open-reaction.md as a running log. When `minutes_into_phase` >= 14 in the prompt context, ALSO call `mcp__tv__surface_ltf_bias` to finalize the bias before ending the turn. Either way, still end the turn with `mcp__tv__surface_no_trade` — no setup card during open-reaction.

**EXCEPTION — session-summary turns.** When the user message asks you to run "the SESSION SUMMARY for the X session", do NOT call surface_setup or surface_no_trade. Instead, call `mcp__tv__surface_session_summary` exactly once at the end with bias_picture, what_happened, watch_next_session.

Reason in prose first; surface last.
```

---

## User prompts (verbatim, one per turn type)

### 1. Session-brief prompt ([`session-brief.js:116`](../app/main/session-brief.js))

```
Run the SESSION BRIEF for the ${SESSION.toUpperCase()} session.

Steps:
1. Call mcp__tv__tv_analyze_full to load HTF context (Daily / 4H / 1H, overnight ranges).
2. Reason in prose: grade Pillars 1 (Draw & Bias) and 2 (Price-Action Quality). Identify HTF bias per timeframe, overnight context (Asia / London ranges, what was swept), key levels (PWH / PDH / ONH / ONL / PDL / PWL with taken/untaken state), and a written plan for the session open.
3. At the END of the turn, call mcp__tv__surface_session_brief with the structured payload. This is the only tool call that surfaces the brief to the PREP panels — do NOT call surface_setup or surface_no_trade in a session-brief turn.
```

`${SESSION}` is one of `london` / `ny-am` / `ny-pm`.

### 2. Per-bar prompt ([`bar-close.js:runClaudeTurnFor`](../app/main/bar-close.js))

```
A new ${TF} bar just closed at ${TS} (ET). Phase: ${PHASE}${MIP_SUFFIX}.

SESSION MEMORY (read-only context for this turn):
${MEMORY_BLOCK}

${HINT}
```

Variables filled by main:
- `${TF}` — `1m` or `5m`
- `${TS}` — bar close timestamp (ISO)
- `${PHASE}` — `open_reaction` or `entry_hunt`
- `${MIP_SUFFIX}` — ` (+${minutes_into_phase}m)` during open-reaction, empty otherwise
- `${MEMORY_BLOCK}` — see [Session memory block](#session-memory-block) below; omitted entirely if no memory files exist
- `${HINT}` — phase-dependent:

**Open-reaction hint:**
```
Open-reaction window (+${MIP}m of 15). Call surface_open_reaction with the latest read (session="${SESSION}"). ${FINALIZE_CLAUSE}End the turn with surface_no_trade. Do NOT call surface_setup during open-reaction.
```
- `${FINALIZE_CLAUSE}` only when `minutes_into_phase >= 14`: `minutes_into_phase >= 14 — ALSO call surface_ltf_bias to finalize bias. `

**Entry-hunt hint:**
```
Walk all three entry models by NAME — MSS / Trend / Inversion. Give one verdict per model (don't stop at the first miss). If a candidate or confirmed setup is in play, call surface_setup; otherwise surface_no_trade.
```

### 3. Session-wrap prompt ([`session-wrap.js:runWrapFor`](../app/main/session-wrap.js))

```
Run the SESSION SUMMARY for the ${SESSION.toUpperCase()} session.

SESSION MEMORY:
${MEMORY_BLOCK}

Steps:
1. Synthesize Pillar 1 + Pillar 2 + LTF bias into a one-paragraph bias picture (cite prices via JSON paths where applicable).
2. Write one paragraph describing what happened — did setups fire / confirm; the session's narrative.
3. List 1–2 bullets for what to watch in the next session.
4. End the turn by calling mcp__tv__surface_session_summary with session="${SESSION}" and the structured payload. Do NOT call surface_setup or surface_no_trade.
```

If no memory files exist, `${MEMORY_BLOCK}` becomes:
```
_no memory files for this session — wrap with whatever you can infer; explicitly note the gap._
```

---

## Session memory block

Built by `readSessionMemory()` in [`bar-close.js`](../app/main/bar-close.js) and `readSessionMemoryFor()` in [`surface.js`](../app/main/tools/surface.js). Reads from `state/session/<date>/<session>/`:

```
--- pillar1.md ---
<full contents>

--- pillar2.md ---
<full contents>

--- ltf-bias.md ---
<full contents>

--- open-reaction.md ---
<full contents>

--- setups.jsonl (last N) ---
<one JSON object per line>

--- bars.jsonl (last N) ---
<one JSON object per line>
```

| Source file | Tail / full | Limit |
|---|---|---|
| `pillar1.md` | full | — |
| `pillar2.md` | full | — |
| `ltf-bias.md` | full | — |
| `open-reaction.md` | full | — |
| `setups.jsonl` | tail | 5 (per-bar), 20 (wrap) |
| `bars.jsonl` | tail | 10 (per-bar), 20 (wrap) |

Missing files are silently skipped — early-session prompts get less context, late-session prompts get more.

---

## Files Claude can write (via MCP `surface_*` tools)

Defined in [`app/main/tools/surface.js`](../app/main/tools/surface.js). All paths under `state/session/<date>/<session>/`.

| Tool | Files written | When |
|---|---|---|
| `surface_setup` | `setups.jsonl` (append) | A+ or B setup identified |
| `surface_no_trade` | _none — IPC event only_ | Discipline marker, no valid setup |
| `surface_session_brief` | `brief.json`, `pillar1.md`, `pillar2.md` | End of session-brief turn |
| `surface_open_reaction` | `open-reaction.json`, `open-reaction.md` | Per bar during open-reaction phase |
| `surface_ltf_bias` | `ltf-bias.json`, `ltf-bias.md` | At +14m of open-reaction |
| `surface_session_summary` | `summary.json`, `summary.md` | End of session-wrap turn |

`open-reaction.json` is the source of truth (array of all reads); `open-reaction.md` is re-rendered every call with the latest read on top and prior reads archived below. The markdown sidecars on the others (`pillar1.md`, `pillar2.md`, `ltf-bias.md`, `summary.md`) are derived views of the JSON payload, formatted for the file viewer.

Tools Claude can also call but that don't write files:
- `tv_analyze_full` — runs `./bin/tv analyze --out state/last-analyze.json` (multi-TF sweep)
- `tv_analyze_fast` — runs `./bin/tv analyze --pillar3-only --baseline state/baseline.json --out state/last-analyze.json`
- `tv_alert_create` — TradingView alert
- `tv_alert_list` — TradingView alert list

---

## Files written by main (deterministic, not Claude)

These exist for Claude's benefit but main fills them in code:

| File | Writer | Purpose |
|---|---|---|
| `bars.jsonl` / `bars-5m.jsonl` | `bar-close.js:appendBarLog` | Every closed bar's `{time, tf, o, h, l, c, body_ratio, direction, close_position_in_range}` — body_ratio etc. computed in main (constraint #7) |
| `trades.jsonl` | `trades.js:acceptSetup` / `bar-close.js:tickOpenTrades` | Accept / reject events + outcome transitions (TP1, TP2, STOPPED, INVALIDATED) from comparing the live bar to active trades |
| `bar-close-events.jsonl` | `./bin/tv stream bar-close` (subprocess) | Raw detector event log, day-level (not per-session) |
| `state/session/detector-heartbeat.json` | same subprocess | Detector's liveness pulse, read by dashboard |
| `state/last-analyze.json` | `tv analyze --out` | Latest bundle Claude requested |
| `state/baseline.json` | `bar-close.js:maybeRefreshBaseline` | HTF baseline, refreshed every 15 min, reused by `tv_analyze_fast` |

---

## Session folder location

`state/session/<YYYY-MM-DD>/<session>/` where:
- `<YYYY-MM-DD>` is today's date in ET
- `<session>` is `ny-am` / `ny-pm` / `london` — each session has its own folder, never overwritten

The day-level file `bar-close-events.jsonl` lives directly under `state/session/<YYYY-MM-DD>/`.
