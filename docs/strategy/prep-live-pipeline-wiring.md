# PREP & LIVE pipeline wiring — the connected map + the 3 seams

**Purpose.** One reference for how every component connects, so we build the
faithful-Lanto fixes *connected the right way* instead of patching panels in
isolation. Use this before touching the brief grading, the bias derivation, or
any PREP/LIVE panel. Pairs with the faithfulness work tracked in
[lanto-source-of-truth.md](lanto-source-of-truth.md) and the oracle in
[lanto-oracle.md](lanto-oracle.md).

Drawn from a real code trace on `feat/faithful-lanto-rebuild` (2026-06-24), not
from memory. File paths + line numbers are load-bearing — re-verify if they drift.

---

## The shape: one source, two lanes, shared bias state

A shared spine (engine → capture → bundle) forks into two lanes that share the
bias state files in the middle.

### Shared spine
1. **Pine engine** — `pine/ict-engine.pine`, the on-chart evidence table (the
   system's only data source).
2. **Capture** — `tv analyze`: `cli/lib/tf-capture.js` (verified multi-TF read)
   → `cli/lib/ict-engine-parser.js` → `cli/lib/compute-engine-gates.js`.
3. **Bundle** — `{ engine_by_tf, gates, quote, bars_by_tf, brief_digest }`.

### Lane A — PRE-SESSION → PREP (the grade)
1. **`cli/lib/brief-digest.js`** — ranks arrays into `brief_digest.symbols.<sym>`
   (`htf.top_fvgs`, `top_bprs`, `pillar1`, ...) by `(state=fresh, took_liq,
   disp_score)`. **This is where "significant" is decided.**
2. **`app/main/direct-session-brief.js`** — `buildDirectSessionBriefPayloads`
   (`:355`) computes `htf_bias`, `primary_draw`, `pillar1_votes`,
   `pre_session_grade`, `no_trade_reason`. **This is the grade** (`:382`).
3. **State files** — `brief-<sym>.json`, `brief-bundle.json`, `brief.json`.
4. **`app/main/session-brief.js`** — `getBriefForToday` /
   `getBriefsBySymbolForToday` read the files.
5. **IPC `prep:get`** (`app/main/ipc.js:255`) → `useSessionBrief` →
   `PrepPopover.jsx` (renders via `Prep.helpers.js`).

### Lane B — LIVE → LIVE panel (the trade)
1. **`app/main/bar-close.js`** — `handleBar`, per closed 1m / 5m bar.
2. **Open reaction** (`phase==="open_reaction"`, `:505`) —
   `live-open-reaction-finalizer.js` → `deriveLtfBiasContext`
   (`live-ltf-resolver.js`) → writes `open-reaction.json` + `ltf-bias.json`.
   Per-bar effective bias persists to `ltf-bias-live.json` in
   `buildDetectorInputs` (`:1523`).
3. **Entry hunt** (`phase==="entry_hunt"`) — `buildDetectorInputs` → walkers
   (`app/main/strategy/walkers/*`) → `buildDeterministicPacketTruthFromInputs`
   → `deterministic-packet.json` + `setups.jsonl` + `walkers.json` +
   `no-trades.jsonl`.
4. **Execution** — `tranche-manager.js` → `placeTradovateOrder` (raw CDP to the
   webview, paper/demo).
5. **IPC** — `deterministic:onPacket` / `setups:current` / `walkers:onState` /
   `execution:state` → `useDeterministicBrain` / `useActiveSetup` /
   `useWalkers` / `useExecutionState` → `LivePopover.jsx` (`Live.helpers.js`).

### Shared bias state (the middle)
`open-reaction.json`, `ltf-bias.json`, `ltf-bias-live.json` — **written by Lane
B** (finalizer + per-bar resolver), **read by both lanes**:
`getOpenReaction` (`session-views.js:77`) → IPC `prep:open_reaction_get`
(`ipc.js:339`) → `useOpenReaction` → PREP "Open" row **and** the LIVE LTF strip.

---

## The 3 seams (the structural risks)

### ❶ Field contract — writer fields ≠ reader fields
Nothing enforces that a panel reads the fields its writer actually emits.
**Evidence:** `openReactionVerdict` read `verdict` / `confirmation` / `bias` /
`reaction_dir`; the writer has emitted **`bias_direction`** since #30. The reader
was wrong from the commit that introduced it (`2519089`) and showed PENDING on
every directional open until fixed (`787993b`, 2026-06-24).
**Build-it-right:** a contract test that fails the build when a panel reader keys
on a field no writer produces. One test kills the whole bug class. *Every IPC
boundary is an instance of this seam.*

### ❷ Grade anchors an un-ranked / uncited array
The digest decides significance; the grade is computed separately and can anchor
on an array the digest never ranked.
**Evidence (2026-06-24 NY-PM MES):** graded **B** on a `size_quality: "tiny"`
inverted h1 FVG (7472.5–7474.5), `primary_draw.cite: null`, while the digest's
`top_fvgs` for MES h1 was empty. The grade and its cited evidence were out of
sync.
**Build-it-right:** the grade may **only** anchor on a digest-ranked, cited
array. No cite → no grade (fail down with a reason).

### ❸ Two bias computations
PREP grades bias one way (`pillar1BiasFor` in `direct-session-brief.js`); LIVE
resolves it another (`deriveLtfBiasContext` in `live-ltf-resolver.js`). They can
disagree.
**Evidence (2026-06-24 NY-PM):** PREP showed MES **B / bullish** while the LIVE
chain stood aside (`ltf_bias: null`).
**Build-it-right:** **one** bias function; both lanes call it.

---

## Where the Lanto faithfulness audit lands (Phase 0 → Phase 1)

Audit each against his own words (transcripts + Discord), never the derived
specs (standing rule):

| Target | File:line | Today | Faithful |
|---|---|---|---|
| The grade | `direct-session-brief.js:382` | default **B**; drop only on data-gap / pillar2-fail / no-lean. No significance gate, no cite, no count. | his **3-component count** (1/3 no-trade · 2/3 B · 3/3 A+) on **significant** arrays only |
| Significance | `brief-digest.js` ranking | engine `size_quality` + disp_score | **his** bar for a significant array, not the engine's `tiny` |
| Draw vs vote | `deriveHtfBiasDir` / `pillar1BiasFor` / `deriveLtfBiasContext` | array can be both draw and vote | **liquidity = the draw**; a significant array **+ its reaction** = a vote |

---

## Build-it-right principle

**One significance definition, one bias function, one cite-enforced grade — both
lanes consume them.** That removes seams ❷ and ❸ by construction; a contract
test removes ❶. Do not add a second copy of any of the three.

## Status (2026-06-24)
- ❶ fixed for the open-reaction reader (`787993b`); the general contract test is
  **open**.
- ❷ and ❸ are **open** (Phase 1).
- Significance gate / cite-enforcement / 3-component count are **open** (Phase 1),
  gated behind the Phase 0 transcript-grounded rubric + user sign-off.
