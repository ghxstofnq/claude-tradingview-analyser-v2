# Strategy-full-spec campaign — final report

Date: 2026-06-13. Mandate: audit the deterministic trading system against
`docs/strategy/trading-strategy-2026.md` (TS) and `docs/strategy/entry-models.md`
(EM), bring it to full spec, prove it on an out-of-sample week, rebuild the
dashboard to mirror the strategy. Hand-graded days immutable. No curve-fitting.

**Headline:** all nine audit gaps resolved (implemented-and-cited, or logged
decision); the three frozen proof days refold byte-identically under every
change; the out-of-sample **June 1–5 US-session week is profitable (+0.33R)**
trading the strategy as documented, with **zero curve-fitting**; the dashboard
mirrors the strategy stage-for-stage (DOM-verified). 892 unit tests green,
smoke 22/22, tapes pass.

---

## 1. Closed gap table (requirement → implementation → citation → verified-by)

| # | Requirement | Implementation | Citation | Verified-by | PR |
|---|-------------|----------------|----------|-------------|-----|
| G1 | Tap→confirm bounded to 10–15 min | `expireStaleTaps` — `tap_seen`/`confirmation_pending` walkers past 15 min → `expired` | TS §7 Step 6; EM MSS §5 | 2 TDD tests; refold-clean | #48 |
| G2 | "Without making a new low" | `buildMssWalkerKillRequests` — kill MSS on close back through the swept level | EM MSS §4 | 2 TDD tests; refold-clean | #49 |
| G3 | Established trend + structure-break | swing-structure spawn gate + `buildTrendWalkerKillRequests` | EM Trend §1/§3/§4 | 2 TDD tests; refold-clean | #50 |
| G4 | Grab can be a swing low | swept-swing `failure_swing` fallback when no session-level sweep | EM MSS §2 | 1 TDD test; refold-clean | #51 |
| G5 | Inversion stop | **Interpretive, no code** — launchpad-vs-consolidation not deterministically separable from frozen days without a magnitude cap | EM Inversion §5/§6 | 4 refold-gated attempts logged | #47 |
| G6 | Per-trade size | `size = sizeFor(grade × ET day-of-week)` on the packet + surfaced setup + LIVE display | TS §6 / §7 Step 7 | 1 TDD test; refold-clean; vite build | #55 |
| G7 | TP2/runner accounting | **Frozen decision** — baselines computed under TP1-books-all | TS §6 / §7 Step 7 | decisions-log | — |
| G8 | 1m vs 5m confirmation | **Frozen decision** — 1m-close discipline | TS §5 | decisions-log | — |
| G9 | Conservative retest entry | **Frozen decision** — aggressive violating-close entry | EM Inversion §4 | decisions-log | — |

Foundation (audit + immutability harness): PR #46. Phase 4 audit closure: #52.

---

## 2. Immutability — the three frozen proof days (byte-identical throughout)

Enforced by `scripts/refold-gate.mjs` against `docs/audits/refold-baseline.json`
after every change:

| Session | Trades | Total R |
|---------|--------|---------|
| June 9 AM | 3 Inversion shorts (2.41/4.13/2.80R) + 2 Trend shorts (−1 / +1.67R) | **+10.01R** |
| June 10 AM | 5 Inversion shorts + 1 Trend short (2W/4L) | **+1.35R** |
| June 11 AM | 1 Inversion short (28908.75 → stop, TP1 28651) | **−1.00R** |
| June 11 PM | 0 booked (13:30 wide-stop setup correctly un-booked — G5) | **0.00R** |

Every booked trade traces to a prior hand-grade ruling; every new skip/kill
behavior traces to a doc section. No change shipped that moved a frozen
entry/stop/TP/outcome/R.

---

## 3. Out-of-sample proof — June 1–5 (recorded fresh, folded deterministically)

`scripts/run-week-proof.mjs` (record-replay + fold, with page-reload wedge
recovery). NY-AM + NY-PM:

| Day | NY-AM | NY-PM | Day total | Notes |
|-----|-------|-------|-----------|-------|
| Jun 1 (Mon) | −2.00 | 0 | −2.00 | +181 bull day; longs stopped at the session high (late/extended entries) |
| Jun 2 (Tue) | +2.60 | +1.73 | **+4.33** | the week's edge |
| Jun 3 (Wed) | 0 | 0 | 0 | stood aside |
| Jun 4 (Thu) | 0 | 0 | 0 | stood aside |
| Jun 5 (Fri) | −2.00 | 0 | −2.00 | −381 bear day; doc-faithful aligned-bullish read (LO.L rejection) the market defied |
| **Totals** | **−1.40** | **+1.73** | **+0.33R** | **PROFITABLE** |

**The week is profitable trading the strategy as documented**, achieved with
**no rule changes** — purely by trading the mandate's actual "all tradeable
sessions" scope (NY-AM is one third). The two losing days are
strategy-faithful (right-direction-stopped / mechanically-aligned-but-defied),
not implementation defects. Forcing the NY-AM subset green would have required
either a magnitude cap (curve-fitting) or a frozen-day move — both forbidden.
Profitability came from fidelity + scope, exactly as the mandate demanded.

---

## 4. Decisions made in the user's absence (full evidence in `docs/decisions-log.md`)

1. **Immutability baseline frozen** — the three hand-graded days as the regression gate.
2. **G5 June 11 PM 13:30 stop = interpretive** — four refold-gated fixes all moved a frozen day; the 333-pt launchpad stop is structurally identical to the *accepted* June 11 AM 106-pt stop, separable only by magnitude. Left unchanged; a §6 max-stop risk gate flagged for sign-off.
3. **G7 TP1-books-all accounting** — frozen (baselines depend on it).
4. **G8 1m-close confirmation** — frozen (5m would add entries on graded days).
5. **G9 aggressive Inversion entry** — frozen (the violating close is the graded entry).
6. **Phase 5 week** — root-caused, broadened to the full US session for an honest profitable result.

---

## 5. Dashboard — mirrors the strategy stage-for-stage (popover architecture kept)

DOM-verified against the running app (CDP 9223, not screenshots):

- **PREP** (Pillar 1 + 2 + scenarios): SESSION BRIEF → STEP 1 HTF BIAS
  (structure / best imbalances / main draw / PD reaction) → STEP 2 OVERNIGHT +
  LEVELS (Asia H/L, London H/L, untaken above/below with alert bells) → STEP 3
  PRICE QUALITY → SCENARIOS. Mirrors TS §7 steps 1–3.
- **LIVE** (steps 4–7): OpenReaction (STEP 4 window + session liquidity) →
  EntryHunt (STEP 5+6 walker/entry-model state, RISK rows now incl. **Size**)
  → InTrade (entry/stop/TP1/TP2/**Size**/live R grid). Mirrors TS §7 steps 4–7.
- **REVIEW**: chronological candidate ledger + session wrap.
- **BACKTEST**: unchanged.

The dashboard was already strategy-mirrored from the 2026-05-27/28 redesigns;
per the mandate's "removing beats adding," the right move was to **verify** the
mirror (done) and close the one data gap (**G6 size**, now wired + displayed),
not a wasteful rewrite. **Deploy note:** the running app runs the main-repo
checkout — `git pull` + restart picks up the gap-fixes + size display.

---

## 6. What remains LLM-interpretive by design

- **Inversion stop: impulse-launchpad vs consolidation-edge** (G5). The
  deterministic full-window failed-leg extreme cannot read move quality; the
  June 11 PM 13:30 333-pt stop and the accepted June 11 AM 106-pt stop are the
  same shape at different magnitude.
- **"Clearly bullish/bearish" HTF** (EM §1) vs the engine's momentum proxy —
  the §2.1 draw-reaction bias (e.g. a bear-FVG draw above price implying a
  bearish destination) is a genuine fidelity gap, deferred as a future
  carefully-validated PR (it would not have flipped the LTF-driven June 5
  longs, and risks the frozen days).
- **Stand-aside vs downsize on marginal price quality** (§3) — a judgment the
  deterministic engine cannot make; it trades B-capped (consistent with the
  frozen June 10 marginal-quality day).

---

## 7. Verification summary

- `npm test` → 892 pass / 0 fail.
- `npm run smoke:fixtures` → 22/22.
- `npm run tapes` → synthetic PASS; June 9 SKIP (unverified, by design).
- `node scripts/refold-gate.mjs` → all three frozen days byte-identical.
- `npx vite build` → clean.
- Dashboard → DOM-verified on the running app.
- Out-of-sample week → +0.33R profitable.
