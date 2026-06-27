# REVIEW popover redesign — per-trade Lanto faithfulness

**Goal:** Turn REVIEW from a mechanical-outcome report into a faithfulness review. For every candidate the chain produced, show whether it respected Lanto's method (bias / price-action / entry-model) and where the bot deviated (stop anchor, liquidity draw). Re-skin all three tabs to the Raycast system.

**Confirmed (2026-06-25):** direction approved; faithfulness mark = 3-segment bar; whole popover; production-ready.

**Design system:** Raycast dark (DESIGN.md). Near-black canvas, hairline `#242728`, white = the only action color, semantic green/red/amber for STATUS only, Inter ss03. Fixes baked in everywhere: kill banned left-border stripes, all text ≥12px tokens, palette tokens not hard-coded rgba, retire hero-metric tiles.

**Data source (no fabrication — PRODUCT.md #3):** every verdict derives from fields that already exist on the setup record + `executionPacket` + brief. No invented signals.

**Files:**
- `app/renderer/src/Review.helpers.js` — add `computeFaithfulness(setup, trade, brief)` (pure, React-free, shared with main).
- `tests/review-faithfulness.test.js` — new, `node --test`.
- `app/renderer/src/ReviewPopover.jsx` — new `FaithfulnessMark` + `FaithfulnessBreakdown`; rewire ledger row/expansion; rework TRACK + LIBRARY.
- `app/renderer/src/app.css` — `.fmark`, `.frow`, restyled TRACK/LIBRARY classes; remove inline rgba.
- `app/main/review.js` — `computeStats` (line 76) rolls up `faithful` / `faithful_rate` using the shared helper (Slice 4 only).

---

## Faithfulness rules (field-derived; tune under test)

Each dimension → `{ status: 'pass'|'soft'|'deviation'|'na', detail }`. Mark = `[bias, priceAction, entryModel]`.

- **bias** — `pillar_breakdown['Pillar 1']` PASS + `side` matches `brief.primary_draw.dir` → pass · Pillar 1 pass but draw/side unknown → soft · side contradicts draw, or Pillar 1 fail → deviation · neither present → na.
- **priceAction** — `pillar_breakdown['Pillar 2']` PASS + `executionPacket.entry.rawPayload.chop_15m === false` → pass · chop_15m true → soft · Pillar 2 fail → deviation.
- **entryModel** — `pillar_breakdown['Pillar 3']` PASS + `confirm_close === true` + `confirm_dir` matches side + `ce_held === true` → pass; downgrade pass→**soft** when `entry.rawPayload.source === 'violation_close_bridge'` (aggressive variant, not engine-stamped); missing confirmation → deviation.
- **stop** — Inversion: faithful only when `stop_cite` is zone-anchored (`zone:`); a generic `bars.last_5_bars[extreme]` cite → **deviation**, detail carries the point distance `abs(entry-stop)`. MSS/Trend: structural/swing stop is acceptable → pass.
- **draw** — `tp1_cite` is a named session/PD draw (PWH/PDH/PWL/NYAM_*/`primary_draw`) → pass · `session_history` / `internal` / unnamed swing → **soft** (flag: verify it's the real magnet).

`na` renders as "—", never a fabricated pass.

---

## Slice 1 — Faithfulness helper (pure, tested) — renderer-safe (live)

**Files:** `Review.helpers.js`, `tests/review-faithfulness.test.js`

- [ ] Write failing tests: (a) clean MSS = all pass; (b) the real 06-24 Inversion long (`tests` fixture inline) = bias pass, price pass, entry **soft** (bridge source), stop **deviation** (swing-extreme, 136pt), draw **soft** (`session_history`); (c) no-trade premature = entry deviation; (d) packet missing `executionPacket` → all `na`, no throw.
- [ ] Run: `node --test tests/review-faithfulness.test.js` → FAIL.
- [ ] Implement `computeFaithfulness(setup, trade, brief)` per the rules above. Defensive on missing fields.
- [ ] Run tests → PASS.
- [ ] Commit `feat(review): faithfulness verdict helper (pure, tested)`.

**Acceptance:** every status traces to a named field; the 06-24 record reproduces the mockup's verdict exactly; no fabricated pass on missing data.

**CHECKPOINT 1 — logic locked before any UI.**

## Slice 2 — SESSION ledger + breakdown (the centerpiece) — renderer-safe (live)

**Files:** `ReviewPopover.jsx`, `app.css`

- [ ] `app.css`: add `.fmark` (3 segment bars, `.pass/.soft/.deviation` → green/amber/`#3a3a3a` dim, palette tokens) + `.frow` (breakdown row, icon + text, ≥13px). Remove the `borderLeft:2px` stripe and inline `rgba(...)` from confirmed rows; use `--surface-card` + hairline.
- [ ] `FaithfulnessMark({ marks })` — 3 segment bars.
- [ ] `FaithfulnessBreakdown({ f })` — bias / price / entry rows (ti-check / ti-circle-half-2 / ti-x) then stop + draw checks, then sourced figures (entry·stop·tp1·R:R·size, mono).
- [ ] Rewire `LedgerRow`: columns `time · grade · side · model · <FaithfulnessMark> · outcome`; click → `<FaithfulnessBreakdown>` (replaces the trade-only expansion; keep entry/stop/tp figures inside it).
- [ ] Verify with design-harness: screenshot SESSION tab + computed-style probe (no `border-left` >1px accent; all font-size ≥12px; colors resolve to palette).
- [ ] Commit `feat(review): SESSION faithfulness ledger + 3-seg mark`.

**Acceptance:** ledger renders for the current session; no banned stripes; ≥12px; mark colors map to the verdict; expansion shows the 5 dimensions.

**CHECKPOINT 2 — core visual reviewed.**

## Slice 3 — TRACK rework — renderer-safe (live)

**Files:** `ReviewPopover.jsx`, `app.css`, `Review.helpers.js`

- [ ] Replace `.an-hero` big-number tiles with a tight Raycast stat line (label + value inline, no card-per-metric). Keep per-account separation + real fills math.
- [ ] Add `by_model` aggregation to `buildTrackRecord` (group R by setup model — needs the loaded session's setups; cross-history by-model stays session-scoped unless Slice 4 rollup lands).
- [ ] Add a current-session faithfulness summary (faithful / soft / deviated counts) from `computeFaithfulness` over `journal.setups`.
- [ ] Restyle concentration bars to hairline/quiet; keep by-grade.
- [ ] Verify design-harness: no hero tiles; numbers still real.
- [ ] Commit `feat(review): TRACK stat-line + by-model + faithfulness summary`.

**Acceptance:** no hero-metric template; every number sourced; faithfulness summary matches the ledger.

## Slice 4 — LIBRARY + faithful-rate rollup — **main-process (apply after session)**

**Files:** `app/main/review.js`, `ReviewPopover.jsx`, `app.css`

- [ ] `review.js computeStats`: import `computeFaithfulness` from `../renderer/src/Review.helpers.js`; add `faithful`, `faithful_rate` over the session's setups. (Backend change → needs app restart; build + headless-test now, apply after the live session.)
- [ ] `node --test` a small review-stats test asserting the rollup on a fixture session.
- [ ] LIBRARY: replace the plain table with a command-palette-style list — `date · session · grade · candidates · net R · faithful-rate`; click to load. Tokenized, ≥12px.
- [ ] Verify design-harness: list renders; faithful-rate column populated from real rollup.
- [ ] Commit `feat(review): LIBRARY list + per-session faithful-rate rollup`.

**Acceptance:** rollup computed in main from real setups (same helper as renderer); LIBRARY shows it; no fabrication.

**CHECKPOINT 3 — backend rollup signed off before applying live.**

## Slice 5 — Degraded-chain note, motion, a11y — renderer-safe (live)

**Files:** `ReviewPopover.jsx`, `app.css`

- [ ] Replace the red `borderLeft:2px` degraded-chain strip with a full-width tokenized note (`--accent-red-soft` bg, no stripe).
- [ ] Expand/collapse transition 150–250ms + `@media (prefers-reduced-motion: reduce)` fallback.
- [ ] Empty/no-trade/open states reviewed (teach, not "nothing here").
- [ ] Final design-harness pass: all 3 tabs, contrast probe (body ≥4.5:1 on `#0d0d0d`), keyboard focus + 1/2/3 hotkeys intact.
- [ ] Commit `fix(review): degraded-chain note, motion, a11y polish`.

**Acceptance:** zero banned patterns repo-wide in ReviewPopover; AA contrast; reduced-motion honored.

---

## Verification & live-session safety

- **Tests:** `node --test` for helpers + review-stats. Run in this worktree (helper tests touch no `state/`); guard with `GOFNQ_STATE_DIR` if any test reads session dirs.
- **Visual:** `design-harness` (Playwright headless screenshots + computed-style probe). **No computer-use.**
- **Live safety:** Slices 1–3, 5 are renderer/helper only → hot-reload, safe during the live session. **Slice 4 touches `app/main/review.js`** → applying it needs an app restart, so build + headless-test it now but apply after the trading session.

## Open decision (assert default unless overridden)

- Cross-history faithful-rate (TRACK by-model + LIBRARY column) needs the Slice-4 rollup. **Default:** session-scoped faithfulness in Slices 1–3 (live-safe), cross-history rate via the rollup in Slice 4 (after session). This avoids loading every session's setups in the renderer.
