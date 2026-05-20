# LLM-Driven Session — Plan

**Status:** approved 2026-05-19 (user)
**Replaces:** the entire `tv watch` watchman + briefing/preflight scaffolding.
**Why:** the watchman + briefing was hybrid (deterministic watchman polling, LLM only on-demand). User wants the LLM to OWN the session — runs on every 1m and 5m candle close, fully aware of time and the 3-pillar framework, accumulates state across the session, can predict what to expect next.

---

## The four pieces

1. **A tiny detector script.** Watches TradingView and prints one line every time a 1m or 5m candle closes. Just a printer, no thinking. Replaces the watchman entirely.

2. **A monitor in the Claude Code session.** Watches the detector's output. Every line printed = one event inside our conversation.

3. **One smart `/analyze` command — phase-aware.** Reads the ET clock + reads everything in the active session folder `state/session/<today>/<session>/` + reads the new bar's bundle. Does the right thing for the current phase. Writes updates.

4. **A folder per session — `state/session/<today>/<session>/`** (`<session>` = `ny-am` / `ny-pm` / `london`). Plain markdown + JSONL files. Built up through the session. Each new `/analyze` reads them and appends.

---

## Phases the `/analyze` knows about

| Phase | ET window | What it does |
|---|---|---|
| **Pre-session** | before 09:30 | Grade Pillar 1+2 once (HTF bias + overnight + candle quality). Save to disk. Subsequent bar events: "waiting for NY open" — no token waste. |
| **Open reaction** | 09:30–09:45 | Read prior Pillar 1+2. Watch NY's first 15 min. Update `open-reaction.md` and `ltf-bias.md` each bar. |
| **Entry hunt** | 09:45–12:00 | Full reasoning every bar close. References everything before + new bar. Flags potential setups in `setups.jsonl`. |
| **Post-NYAM** | 12:00+ | Wrap with the session's `summary.md`. Idle until NY PM (13:00). |
| **NY PM** | 13:00 onward | Same phase pattern as NY AM: pre at 13:00, open-reaction 13:30–13:45, entry hunt 13:45–16:00. |

---

## State files (`state/session/<YYYY-MM-DD>/<session>/`)

One folder per session (`<session>` = `ny-am` / `ny-pm` / `london`); each is self-contained, so sessions never overwrite each other. The detector's `bar-close-events.jsonl` sits at the day level.

- `pillar1.md` — HTF bias + overnight, frozen after pre-session grade
- `pillar2.md` — Price quality verdict, frozen
- `open-reaction.md` — built 09:30–09:45 (and 13:30–13:45 for NY PM)
- `ltf-bias.md` — finalized at 09:45 / 13:45
- `bars.jsonl` — every 1m bar captured, append-only
- `bars-5m.jsonl` — every 5m bar
- `setups.jsonl` — flagged potential entries, append-only with timestamp + rationale
- `summary.md` — one-paragraph session wrap (bias picture + what happened + what to watch), written once at post-session

---

## What a typical session looks like

**08:30 ET (you start):**
- Terminal: `./bin/tv stream bar-close`
- Claude Code session: tell me to `Monitor("./bin/tv stream bar-close")`
- Type `/analyze` once. I grade Pillar 1+2 (pre-session), save, then idle.

**09:30:01 ET → 09:44:01 ET (each 1m bar close, plus 5m closes):**
- Detector prints. I see event. I `/analyze`. Each tick updates `open-reaction.md` / `ltf-bias.md`.

**09:45:01 ET:**
- `/analyze` flips to entry-hunt mode. Writes `ltf-bias.md` final verdict.

**09:46:01 ET → 12:00:01 ET (every bar):**
- Bar closes → `/analyze` → reasoning with full session memory → "no setup" or "potential MSS-long forming, watch for confirmation candle above 7400 within 15 min."

**12:00 ET:**
- Session wrap. `summary.md` written to the `ny-am/` folder. Idle until 13:00.

**13:00 ET:**
- NY PM pre-session grade (Pillar 1+2 stays from morning unless materially changed).
- Same phase pattern through 16:00.

---

## What gets deleted

- `cli/commands/watch.js` — the entire watchman
- All briefing-file logic, preflight mode, alert state machine, pd_array_*, snapshot retention, watches.json
- `state/watch/` directory — replaced by `state/session/<date>/`

## What survives

- `./bin/tv analyze` — bundle capture. Still useful, called by `/analyze` each tick.
- `docs/strategy/*.md` — strategy docs.
- Hard constraints in CLAUDE.md (cite-or-reject, no LLM arithmetic, etc.).
- The deterministic gates in `analyze.js`.
- The 3-pillar slash-command body in `.claude/commands/analyze.md` — rewritten to be phase-aware.

---

## Order of work

1. **Detector**: add `./bin/tv stream bar-close` — time-aligned polling, emits one JSON line per 1m close + per 5m close. ~50 LOC.
2. **Delete watchman**: remove `cli/commands/watch.js`, registration, state files, briefing logic, CLAUDE.md sections.
3. **State layout**: `state/session/<YYYY-MM-DD>/<session>/` skeleton + a small helper for path resolution.
4. **Rewrite `/analyze`**: phase-aware — detects time, reads state, does the right thing per phase. Updated `.claude/commands/analyze.md`.
5. **Test**: live during next NY AM (or replay).

---

## Research basis (from deep research dispatched 2026-05-19)

- **Bar-close detection**: TradingView CDP polling is the right path; time-aligned polling (sleep to next 60s boundary, poll fast 3s post) gets ~200ms latency. Injected JS bar-index watcher gets ~30ms but adds failure modes. Going with time-aligned for v1. Sources: TradingView Pine docs (`barstate.isconfirmed`), Freqtrade/Jesse architecture (both candle-driven, not tick-driven).
- **LLM-driven trading architecture**: production pattern is event queue + worker. Time awareness must be pre-computed in prompt (`time_to_next_killzone`, `minutes_into_phase`) — LLMs are temporally blind by default (arXiv 2510.23853). Rolling Markdown consolidation every 30-60 min keeps context linear (HiAgent, arXiv 2408.09559: +42% accuracy, -65% context).
- **Claude Code features**: `Monitor` tool is the right primitive — each stdout line of a background command becomes a notification. `/loop` is cron-based only (no external triggers). Claude Max 20x subscription means no API caching needed; cost is solved at the subscription level.
- **No peer-reviewed ICT+LLM work exists** — this remains frontier.

## Anti-patterns documented (mostly already mitigated by CLAUDE.md hard constraints)

- Hallucinated levels → constraint #6 (cite-or-reject).
- Arithmetic drift → constraint #7 (no LLM arithmetic; computed in `analyze.js`).
- Overconfidence → constraint #9 (grade enum A+/B/no-trade only).
- Memorized outcomes on pre-cutoff dates → constraint #10.

## Open after v1

- Whether to add the injected JS bar-index watcher (30ms vs 200ms latency).
- Multi-day persistence (currently session-scoped to `<date>` folder).
