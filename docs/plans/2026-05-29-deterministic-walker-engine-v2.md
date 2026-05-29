# Deterministic Walker Engine V2 Implementation Plan

> **For Hermes:** Use `subagent-driven-development` or a task-by-task TDD workflow to implement this plan. Do not copy PR #81 wholesale; port only the architecture and rebuild the evidence contracts for V2.

**Goal:** Replace free-form LLM entry judgment with a deterministic Pillar 3 walker engine that tracks MSS, Trend, and Inversion from evidence to a strict execution packet.

**Architecture:** TradingView webview/ICT Engine evidence is captured through the project-local `./bin/tv` path on CDP port 9223, normalized into strategy context, evaluated by Pillar 1/2 gates, then advanced by deterministic entry-model walkers. Claude/Codex may explain or journal the final packet but may not mutate entry, stop, target, model, side, or grade.

**Tech Stack:** Electron main/renderer, Node ES modules, `node --test`, project-local `./bin/tv`, ICT Engine V2 rows, existing `state/session/<date>/<session>/` state pattern, existing surface/dashboard IPC.

---

## 0. Decision and Scope

### Decision

Use PR #81 as a reference only.

Port the idea:

- stateful walker lifecycle
- pure JS modules
- spawn -> advance -> kill -> trigger pipeline
- LIVE walker status UI
- unit-test layout
- entry-hunt LLM bypass

Do not port these PR #81 behaviors as-is:

- fixed-R synthetic TP1/TP2
- hardcoded `A+`
- synthetic `walker.<id>.*` citations that do not resolve to evidence
- strategy timing based on `Date.now()`
- direct `surfaceSetup()` calls that bypass staged detector truth/evidence validation
- weak confirmation proof
- nested `walkers.json` path behavior

### Non-scope for this phase

- Broker execution
- Auto-order placement
- Hidden live trading
- Replacing the webview/CDP 9223 architecture
- Using external TradingView MCP tools in this repo
- Rewriting the full UI before the evidence engine is correct

---

## 1. Where It Fits

Current V2 strategic flow should become:

```txt
TradingView Webview / ./bin/tv / ICT Engine V2
        ↓
Evidence Capture Layer
        ↓
Source Health + Normalizer
        ↓
Strategy Context Builder
        ↓
Pillar 1 Evaluator: HTF draw, overnight, NY reaction, MNQ/MES leadership
        ↓
Pillar 2 Evaluator: price action quality, chop, displacement, clean delivery
        ↓
Pillar 3 Walker Engine: MSS / Trend / Inversion lifecycle
        ↓
Execution Packet Builder + Validator
        ↓
Surface / Dashboard / Review Pack
        ↓
LLM Narration / Memory / Journal
```

The walker engine is the deterministic **Pillar 3 entry-model lifecycle**. It is not the whole strategy by itself.

---

## 2. Proposed File Layout

Adapt names if existing files already provide equivalents, but keep this separation.

```txt
app/main/strategy/
  context/
    build-strategy-context.js
    source-health.js
  pillars/
    evaluate-pillar1.js
    evaluate-pillar2.js
  walkers/
    walker-engine.js
    walker-state.js
    walker-spawn.js
    walker-advance.js
    walker-kill.js
    walker-runtime.js
  execution/
    build-execution-packet.js
    validate-execution-packet.js
    grade-cap.js
    targets.js
    stops.js
  replay/
    run-walker-replay-case.js

app/main/bar-close.js
app/main/tools/surface.js
app/preload.cjs
app/renderer/src/hooks/useWalkers.js
app/renderer/src/LivePopover.jsx

tests/strategy/
  context/
  pillars/
  walkers/
  execution/
  replay/
```

Key rule: `context`, `pillars`, `walkers`, and `execution` must not import Claude/Codex provider code.

---

## 3. Evidence Contract

### Task 3.1: Define strategy context shape

**Objective:** create one normalized object the deterministic strategy engine consumes.

**Create:** `app/main/strategy/context/build-strategy-context.js`  
**Test:** `tests/strategy/context/build-strategy-context.test.js`

Minimum context shape:

```js
{
  market: 'MNQ1!',
  session: 'ny-am',
  eventTimeUtc: '2026-05-29T13:45:00.000Z',
  eventTimeEt: '09:45:00',
  sourceHealth: {
    status: 'fresh',
    schemaSupported: true,
    stale: false,
    blockers: []
  },
  pillar1: {
    status: 'pass',
    htfBias: 'bullish',
    htfDraw: { side: 'above', price: 21000, label: 'PDH', evidenceRef: '...' },
    primaryDraw: { side: 'above', price: 21000, label: 'Asia High', evidenceRef: '...' },
    untakenTargets: { above: [], below: [] },
    blockers: []
  },
  pillar2: {
    status: 'pass',
    candleQuality: 'clean',
    displacement: 'clean',
    chop15m: false,
    blockers: []
  },
  pillar3: {
    pdArrays: [],
    fvgs: [],
    ifvgs: [],
    bprs: [],
    confirmationRows: [],
    ohlcv1m: [],
    ohlcv5m: []
  }
}
```

**Tests:**

- missing `gates.engine` -> `sourceHealth.status = 'blocked'`
- missing `gates.engine.meta` -> blocked
- `schema_supported !== true` -> blocked
- `stale !== false` -> blocked
- missing ICT Engine rows -> blocked
- unknown market/session -> blocked

### Task 3.2: Make source health a hard gate

**Objective:** no walker can spawn or advance to a ready setup unless source health is fresh.

**Create/Modify:** `app/main/strategy/context/source-health.js`  
**Test:** `tests/strategy/context/source-health.test.js`

Expected behavior:

```js
isTradableSourceHealth({ status: 'fresh', stale: false, schemaSupported: true }) === true
isTradableSourceHealth({ status: 'fresh', stale: true, schemaSupported: true }) === false
isTradableSourceHealth({}) === false
```

---

## 4. Walker State Engine

### Task 4.1: Create pure walker state modules

**Objective:** create testable modules without side effects.

**Create:**

```txt
app/main/strategy/walkers/walker-engine.js
app/main/strategy/walkers/walker-state.js
app/main/strategy/walkers/walker-spawn.js
app/main/strategy/walkers/walker-advance.js
app/main/strategy/walkers/walker-kill.js
```

Walker state:

```js
{
  id: 'walker_...',
  market: 'MNQ1!',
  session: 'ny-am',
  model: 'MSS',
  side: 'long',
  stage: 'watching',
  createdAtUtc: '...',
  lastUpdatedAtUtc: '...',
  sourceEventTimeUtc: '...',
  pdArrayRef: null,
  tapRef: null,
  confirmationRef: null,
  blockers: [],
  evidence: {}
}
```

Stages:

```txt
watching
pd_identified
tap_seen
confirmation_pending
confirmed
packet_ready
blocked
expired
```

Use event/candle timestamps from context, not `Date.now()`, for strategy decisions.

### Task 4.2: Runtime persistence

**Objective:** persist walker state correctly under the active session folder.

**Create:** `app/main/strategy/walkers/walker-runtime.js`  
**Test:** `tests/strategy/walkers/walker-runtime.test.js`

Path must be:

```txt
state/session/<YYYY-MM-DD>/<session>/walkers.json
```

not:

```txt
state/session/<YYYY-MM-DD>/<session>/<session>/walkers.json
```

Use atomic write via temp file + rename.

---

## 5. MSS Lifecycle

### Task 5.1: MSS spawn

**Objective:** spawn MSS only from valid liquidity sweep + displacement evidence.

**Modify:** `app/main/strategy/walkers/walker-spawn.js`  
**Test:** `tests/strategy/walkers/mss-spawn.test.js`

Spawn requires:

- source health fresh
- Pillar 1 context present
- swept liquidity is one of: Asia high/low, London high/low, PDH/PDL, or clear structural swing
- displacement/MSS evidence after sweep
- valid FVG/PD array in the reversal direction
- no existing duplicate walker for same market/session/model/side/pd array

### Task 5.2: MSS tap and confirmation

**Objective:** detect tap then exact confirmation close.

**Modify:** `app/main/strategy/walkers/walker-advance.js`  
**Test:** `tests/strategy/walkers/mss-advance.test.js`

Rules:

- price must tap/enter selected FVG/PD array
- confirmation defaults to a later candle after tap
- confirmation candle must close in setup direction
- candle must be strong body with small/no wick
- same-candle exception is allowed only if `body >= 1.7 * totalWick`
- weak/wicky/doji confirmation blocks
- chop over 10-15 minutes blocks

### Task 5.3: MSS stop and targets

**Objective:** construct only execution-valid MSS packets.

**Modify:**

```txt
app/main/strategy/execution/stops.js
app/main/strategy/execution/targets.js
app/main/strategy/execution/build-execution-packet.js
```

**Test:**

```txt
tests/strategy/execution/mss-execution-packet.test.js
```

MSS stop:

- proven sweep high/low or MSS swing high/low
- not PD-array CE fallback
- not random last wick

TP1:

- side-consistent untaken liquidity
- valid: Asia high/low, London high/low, PDH/PDL, HTF draw
- invalid: internal swing only, opposite-side liquidity, NYAM high/low during NY AM
- must be `>= 1.5R`

---

## 6. Trend Lifecycle

### Task 6.1: Trend spawn

**Objective:** spawn Trend only after aligned displacement and internal pullback opportunity.

**Modify:** `app/main/strategy/walkers/walker-spawn.js`  
**Test:** `tests/strategy/walkers/trend-spawn.test.js`

Trend requires:

- HTF/LTF alignment
- clean BoS/displacement in bias direction
- valid internal FVG/PD array
- no opposing MSS/chop blocker

### Task 6.2: Trend confirmation

**Objective:** require later confirmation after pullback/tap.

**Modify:** `app/main/strategy/walkers/walker-advance.js`  
**Test:** `tests/strategy/walkers/trend-advance.test.js`

Rules:

- tap candle itself is not confirmation
- later strong confirmation close required
- weak confirmation blocks
- broken structure blocks
- structural stop required
- TP1 rules same as MSS

---

## 7. Inversion Lifecycle

### Task 7.1: Inversion close-through confirmation

**Objective:** implement the corrected Inversion definition.

**Modify:** `app/main/strategy/walkers/walker-advance.js`  
**Test:** `tests/strategy/walkers/inversion-advance.test.js`

Rules:

- opposing FVG/PD array must exist
- long Inversion: close beyond far/upper edge of original bearish FVG
- short Inversion: close beyond far/lower edge of original bullish FVG
- CE-only close is blocked
- wick-through is blocked
- close-through candle is the confirmation and entry candle
- close-through candle must be strong-bodied, small/no wick

### Task 7.2: Inversion stop reconstruction

**Objective:** prove stop from the original opposing FVG formation.

**Modify:** `app/main/strategy/execution/stops.js`  
**Test:** `tests/strategy/execution/inversion-stop.test.js`

Rules:

- reconstruct original three-candle FVG from retained OHLCV
- long Inversion stop: below third candle low
- short Inversion stop: above third candle high
- missing original candles -> blocked packet
- do not trust a later `kind=ifvg.created_ms` as original FVG source without reconstruction

---

## 8. Execution Packet Layer

### Task 8.1: Build execution packet

**Objective:** separate walker detection from executable trade recommendation.

**Create:** `app/main/strategy/execution/build-execution-packet.js`  
**Test:** `tests/strategy/execution/build-execution-packet.test.js`

Packet shape:

```js
{
  status: 'ready',
  market: 'MNQ1!',
  session: 'ny-am',
  model: 'MSS',
  side: 'long',
  grade: 'A+',
  entry: 21000.25,
  stop: 20984.25,
  tp1: 21030.25,
  tp2: 21060.25,
  riskPoints: 16,
  tp1R: 1.875,
  confirmation: {
    timeframe: '1m',
    timeUtc: '...',
    timeEt: '09:51:00',
    candle: { open: 0, high: 0, low: 0, close: 0 },
    evidenceRef: '...'
  },
  evidence: {
    selectedPdArray: {},
    selectedConfirmationCandle: {},
    selectedStop: {},
    rejectedStops: [],
    selectedTp1: {},
    rejectedTargets: [],
    sourceRefs: []
  },
  blockers: []
}
```

### Task 8.2: Validate execution packet

**Objective:** fail closed before surfacing.

**Create:** `app/main/strategy/execution/validate-execution-packet.js`  
**Test:** `tests/strategy/execution/validate-execution-packet.test.js`

Ready packet requires:

- source health fresh
- known model
- known side
- entry equals exact confirmation close
- confirmation evidence resolves
- stop evidence resolves and is structurally valid
- TP1 evidence resolves and is side-consistent
- TP1 >= 1.5R
- grade does not exceed deterministic cap
- no unresolved refs

Any missing field returns:

```js
{ status: 'blocked', blockers: [...] }
```

No throw for ordinary missing evidence; return blocked with machine-readable blockers.

---

## 9. Grade Cap Engine

### Task 9.1: Implement deterministic grade cap

**Create:** `app/main/strategy/execution/grade-cap.js`  
**Test:** `tests/strategy/execution/grade-cap.test.js`

A+ requires:

- HTF draw aligned
- NY/open reaction aligned
- Pillar 2 clean
- model priority aligned
- large PD array
- clean confirmation
- structural stop
- TP1 >= 1.5R
- valid untaken target
- no chop
- fresh source health

B may allow:

- normal-size PD array when everything else is clean
- weaker but acceptable displacement
- mixed-but-acceptable context
- TP1 around 1.5-2R

No-trade/block when:

- missing confirmation
- stale/blocked source
- no structural stop
- no valid TP1
- chop
- weak confirmation
- unknown HTF/side
- unsupported ICT schema

---

## 10. Bar-Close Integration

### Task 10.1: Add experimental flag

**Modify:** `app/main/bar-close.js` or config module  
**Test:** `tests/bar-close-walker-flag.test.js`

Add:

```txt
WALKER_ENGINE_ENABLED=false
```

Default off until replay proof passes.

### Task 10.2: Route entry-hunt through walker engine

**Modify:** `app/main/bar-close.js`

Flow:

```txt
bar close event
  -> append bars
  -> build/update strategy context
  -> tick walkers
  -> build/validate execution packets for triggers
  -> if ready: surface setup
  -> if blocked: persist blocked attempt + emit dashboard state
  -> LLM not called for packet mutation
```

Important:

- if walker fails internally, fail closed and surface diagnostic, do not fall back to LLM trading call unless explicitly in debug mode
- preserve existing open-reaction/brief/wrap/review LLM flow
- keep Claude/Codex outside trade packet construction

---

## 11. Surface Contract Hardening

### Task 11.1: Add packet-aware surfacing

**Modify:** `app/main/tools/surface.js` or add `app/main/tools/surface-packet.js`

`surface_setup` should accept only a validated ready execution packet, or a payload traceably derived from one.

Validation must reject:

- synthetic cites
- unresolved entry/stop/TP refs
- setup when staged deterministic truth is no-trade
- grade above cap
- TP1 not matching selected target
- stop not matching selected structural stop

Blocked attempts should go to a separate review/debug stream, not the live setup card.

---

## 12. Dashboard Integration

### Task 12.1: Walker status hook

**Create:** `app/renderer/src/hooks/useWalkers.js`  
**Modify:** `app/preload.cjs`

Expose:

```js
window.api.walkers.current()
window.api.walkers.onUpdate(cb)
```

### Task 12.2: LIVE popover walker panel

**Modify:** `app/renderer/src/LivePopover.jsx`

Render active walkers:

```txt
MNQ NY-AM · MSS Long
Stage: waiting for confirmation
Watched PD: bullish FVG 09:47
Tap: seen 09:50
Needs: strong bullish close above CE
Invalidation: below swept low 20984.25
TP1 candidate: Asia High 21034.50, 1.8R
Blockers: none
```

Render blocked attempts too:

```txt
Blocked Trend Long
Reason: tap candle cannot confirm Trend
Entry candidate: 09:51 close
Required: later confirmation close
```

---

## 13. Replay Proof Gate

### Task 13.1: Add deterministic replay runner if missing

**Create/Modify:** `app/main/strategy/replay/run-walker-replay-case.js` and package script if needed.

Script target:

```bash
npm run replay
```

If existing replay command exists, extend it rather than duplicate.

### Task 13.2: Seed replay fixtures

Create fixtures for:

MSS:

- valid A+
- valid B
- weak confirmation blocked
- missing stop blocked
- TP1 < 1.5R blocked
- NYAM high used as TP1 during NYAM blocked

Trend:

- valid continuation
- tap candle blocked
- later confirmation accepted
- weak confirmation blocked

Inversion:

- full close-through accepted
- CE-only close blocked
- wick-through blocked
- missing original FVG candles blocked

General:

- stale source health blocked
- missing ICT rows blocked
- chop blocked
- no HTF draw blocked

### Acceptance gate

Before enabling live default:

```txt
0 false candidates
0 missed valid setups
0 wrong model
0 wrong side
0 invalid ready packets
0 A+ without full proof
```

---

## 14. LLM Provider Boundary

After deterministic packets are stable, provider choice becomes safer.

LLM provider receives:

```js
{
  executionPacket,
  contextSummary,
  blockers,
  memory,
  recentTrades
}
```

LLM may return:

- human explanation
- risk notes
- journal note
- what to watch next

LLM may not change:

- model
- side
- entry
- stop
- TP1/TP2
- grade
- packet status

Provider selector belongs outside the strategy engine:

```txt
LLM_PROVIDER=claude|codex
CLAUDE_MODEL=...
CODEX_MODEL=...
```

---

## 15. Implementation Milestones

### Milestone 1 — Foundation

- branch from `origin/main`
- add strategy folder layout
- add source-health/evidence contract tests
- no UI
- no live enable

Verification:

```bash
npm run test:unit
npm test
```

### Milestone 2 — Walker Core

- pure walker state machine
- event-time based timestamps
- fixed `walkers.json` path
- no setup surfacing yet

Verification:

```bash
node --test tests/strategy/walkers/*.test.js
```

### Milestone 3 — MSS Production Path

- MSS spawn/advance/kill
- exact confirmation proof
- structural stop
- real TP1 validation

Verification:

```bash
node --test tests/strategy/walkers/mss-*.test.js tests/strategy/execution/mss-*.test.js
```

### Milestone 4 — Trend + Inversion

- model-specific lifecycles
- no shared shortcuts that blur model definitions
- inversion original FVG stop reconstruction

Verification:

```bash
node --test tests/strategy/walkers/trend-*.test.js tests/strategy/walkers/inversion-*.test.js
```

### Milestone 5 — Execution Packet + Surface Gate

- packet builder
- packet validator
- blocked attempt stream
- ready-only surface setup

Verification:

```bash
node --test tests/strategy/execution/*.test.js
```

### Milestone 6 — Dashboard Walker Status

- active walker panel
- blocked attempts visible
- ready packet card unchanged except stronger evidence

Verification:

```bash
npm run test:unit
```

### Milestone 7 — Replay Gate

- deterministic replay fixtures
- `npm run replay`
- fail on false/missed/wrong-model/wrong-side/invalid packet

Verification:

```bash
npm run replay
npm test
```

### Milestone 8 — Provider Adapter

- Claude/Codex selector
- LLM narration only
- strategy packet immutable after validation

Verification:

```bash
npm test
```

---

## 16. Definition of Done

This phase is complete when:

- strategy engine output does not depend on Claude/Codex judgment
- all ready packets have exact confirmation candle close/time
- every entry/stop/TP/grade has resolvable evidence
- TP1 is real side-consistent untaken liquidity and >= 1.5R
- A+ cannot be emitted without all A+ evidence
- blocked attempts remain visible for debugging but cannot become live setup cards
- replay gate passes with zero false/missed/wrong-model/wrong-side failures
- live default remains off until replay proof is green and GXNQ approves enabling

---

## 17. Recommended Next Action

Start with **Milestone 1** only:

1. create the branch
2. add context/source-health contract tests
3. implement minimal source-health/context code
4. run tests
5. stop and review before touching bar-close/live routing

Do not start by wiring `bar-close.js`. The evidence contract and execution packet gate must exist first, otherwise V2 repeats PR #81's main weakness: good state-machine idea, weak proof boundary.
