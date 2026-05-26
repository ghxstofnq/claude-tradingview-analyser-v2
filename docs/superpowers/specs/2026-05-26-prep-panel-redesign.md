# PREP panel redesign — spec

**Status:** approved (design signed off in brainstorm session 2026-05-26)
**Scope:** `app/renderer/src/Prep.jsx` and friends — PREP mode workstation only.
**Out of scope:** LIVE and REVIEW panels, util pages (Settings / Health / Fixtures / System / Risk), persistent chart-host refactor, EvidenceLink pattern. Those land in follow-on specs (panel-by-panel).

---

## 1. Goal

Make PREP read like the strategy doc's 7-step checklist. Promote scenarios from a buried subsection of the PLAN panel to a first-class panel with grade pills. Collapse three small status elements (stale banner, day-over-day diff, chain chip + refresh) into one thin top row. Keep every existing data hook unchanged. One additive schema extension only.

---

## 2. Locked design (signed off in browser mockup)

Final layout, top to bottom (mockup: `.superpowers/brainstorm/55206-1779830706/content/prep-final-design.html`):

1. **STATUS STRIP** (new, thin) — replaces the StaleBriefBanner and ChangedPanel as standalone panels. One row: `claude · <age> @ <hh:mm ET>` · chain chip (only when non-clean) · `CHANGED SINCE LAST ▸` link · `[ REFRESH ]`. The stale banner's amber border-left moves to the strip when `ageMs > 4h`. Clicking `CHANGED SINCE LAST ▸` expands the diff inline (still uses `ChangedPanel`'s `diffBriefs()` — just collapsed by default).
2. **SESSION BRIEF · &lt;SESSION&gt; · &lt;SYMBOL&gt;** — unchanged. Prose blob, symbol selector tabs (when paired), chain status chip moves out of here to the strip.
3. **STEP 1 · HTF BIAS** — D / 4H / 1H rows + **PRIMARY HTF DRAW** sub-section nested at the bottom. Replaces the separate `PRIMARY HTF DRAW` panel.
4. **STEP 2 · OVERNIGHT + LEVELS** — Asia/London hi/lo + mode rows + **UNTAKEN ABOVE** sub-section + **UNTAKEN BELOW** sub-section. Levels grouped by direction relative to `quote.last`, each row keeps the alert bell. Replaces the separate `KEY LEVELS` panel.
5. **STEP 3 · PRICE QUALITY** — three rows mapped from the Pillar 2 element list: `3h range`, `4H/1H displacement`, `15m/5m candles`. New panel; pulls the same data out of `brief.pillars[1]` so the PRE-SESSION GRADE panel doesn't need a Pillar 2 drilldown.
6. **PRE-SESSION GRADE** — one-line headline: grade pill + "why" line (`Pillar 1 PASS · Pillar 2 WEAK — bias good but price quality fragile`). Replaces the full `PillarsPanel` drilldown.
7. **SCENARIOS · IF / THEN** — first-class panel. Each card has `id · grade pill`, then TRIGGER / ACTION / TARGET rows. Promoted from a subsection inside the PLAN panel.
8. **CLAUDE · PLAN FOR THE OPEN** — prose plan + anchored target + anchored stop + sizing rows. Scenarios moved out; everything else stays.
9. **PRICE ALERTS** — unchanged.

Panel count: 10 → 9. The dropped panels (StaleBriefBanner, ChangedPanel as own panel, PRIMARY HTF DRAW, KEY LEVELS) are absorbed; the new panels (STATUS STRIP, STEP 3) net to a smaller count.

---

## 3. Schema delta — additive, backward compatible

One change in `app/main/sdk.js` (the `surfaceSessionBrief` Zod):

```js
// Before
scenarios: z.array(z.object({
  condition: z.string(),
  action:    z.string(),
})).min(1).max(4)

// After
scenarios: z.array(z.object({
  id:        z.string().describe("Stable id — 'scn-1', 'scn-2'. Used as React key."),
  grade:     z.enum(["A+", "B", "no-trade"])
              .describe("Grade for THIS scenario if it fires (not the overall pre-session grade)"),
  condition: z.string().describe("Trigger condition — UI labels this 'TRIGGER'"),
  action:    z.string(),
  target:    z.string().refine((s) => /\d/.test(s), {
              message: "target must contain a cited price (a digit) — e.g. '21 420 (PWH)'",
             }).describe("Anchored target with citation, e.g. '21 420 (engine.levels.PWH)'"),
})).min(1).max(4)
```

**Field name decision:** keep `condition` (not rename to `trigger`). Renaming breaks every existing brief in `state/session/`. The UI labels the row "TRIGGER" — the schema name is internal.

**Renderer compatibility:** old briefs (pre-2026-05-26) have no `id`, `grade`, or `target`. ScenarioCard renders missing fields as "—". Zod loads old briefs from disk via `safeParse` (no throw); only newly-emitted briefs go through `.parse` and must include the new fields.

**Prompt update:** `app/main/prompts/analyze.md` lines 336-352 and the mirror in `.claude/commands/analyze.md` get a 5-line addition describing the new fields with an A+ example. The citation rule (constraint #6) already applies to every numeric price; the new `target` field gets called out explicitly.

---

## 4. Renderer changes — file-level inventory

### `app/renderer/src/Prep.jsx` — full restructure
- Replace `StaleBriefBanner` + `ChangedPanel` separate panel rendering with a single `<StatusStrip>` component.
- Move `RefreshButton` and `ChainStatusChip` out of the SESSION BRIEF panel into the strip.
- Combine `HTF BIAS` + `PRIMARY HTF DRAW` panels into a single `<Step1Panel>`.
- Combine `OVERNIGHT CONTEXT` + `KEY LEVELS` panels into a single `<Step2Panel>` that groups levels by `quote.last`.
- Add `<Step3Panel>` that pulls `brief.pillars[1]` (Pillar 2) and renders its elements as 3 rows.
- Replace `PRE-SESSION GRADE` panel body (currently `<PillarsPanel pillars={brief.pillars}/>`) with a one-line headline.
- Add `<ScenariosPanel>` rendering `brief.scenarios` as `<ScenarioCard>` instances (each card: id + grade pill header, then TRIGGER/ACTION/TARGET rows).
- Strip scenarios block out of `CLAUDE · PLAN FOR THE OPEN`.

### `app/renderer/src/Shared.jsx` — additive
- New exported `ScenarioCard({ scenario })` component.
- `PillarsPanel` untouched — still used by LIVE/REVIEW for the full pillars drilldown.

### `app/renderer/src/app.css` — additive only
- New classes: `.status-strip`, `.scn-card-full`, `.pillar-headline`, `.untaken-block`, `.untaken-block .head`. Existing classes untouched so LIVE/REVIEW visuals don't drift.

### `app/main/sdk.js` — Zod extension (described in §3)

### `app/main/prompts/analyze.md` + `.claude/commands/analyze.md` — prompt update (described in §3)

---

## 5. Data wiring — unchanged

These hooks and IPC paths stay exactly as they are:

- `useSessionBrief` — brief object, refresh fn, status, statusReason, progress, ageMs, availableSymbols, selectedSymbol, setSelectedSymbol, session.
- `useSessionRecap` — recap session, recap data.
- `window.api.prep.priorBrief(session, today)` — day-over-day diff source.
- `alerts` prop (drilled in from App) — `{ armed, fired }`.
- `onToggleArm(name, px)` — bell click handler.
- `formatAge`, `formatPx`, `formatEtTime`, `normalizeLevelName`, `diffBriefs` — all stay in Prep.jsx as-is.

---

## 6. Grouping logic — STEP 2 levels

The level grouping needs current price. The brief schema (`surfaceSessionBrief` Zod in `sdk.js`) does **not** carry a price snapshot — only `key_levels[].price`. **Decision:** drill `currentPrice` as a prop from `App.jsx` into PrepWorkstation, sourced from the existing `useSymbolCache` hook (which already powers the symbol switcher's price column).

- `App.jsx` selects `cache[symbol]?.px` and passes it as `currentPrice` to `<PrepWorkstation>`.
- Step2Panel receives `currentPrice` and `levels`, partitions levels into `above` (price > currentPrice) and `below` (price <= currentPrice).
- Fallback: when `currentPrice == null` (cache miss, symbol just switched), Step2Panel renders a single "UNTAKEN" sub-section sorted high → low (today's behavior).

The sort order within each block is by absolute distance to `currentPrice` — closest level first, in both directions. **Live re-render:** since `currentPrice` updates as the cache refreshes (every few seconds), the grouping is live, not snapshot-frozen. This is fine because the brief itself is stale-stable; only the partition shifts when price moves through a level.

---

## 7. Test plan

### Unit (Vitest, existing test runner)

- `app/renderer/src/Prep.test.jsx` (new):
  - StatusStrip renders age + et-time, hides chain chip when status is `clean`.
  - StatusStrip applies amber left-border when `ageMs > 4h`.
  - `CHANGED SINCE LAST ▸` link calls `prep.priorBrief` and expands the diff.
  - Step1Panel renders HTF rows + primary draw sub-section; hides primary draw when absent.
  - Step2Panel groups untaken levels above/below `brief.last`; falls back to a single block when `brief.last` is missing.
  - Step3Panel pulls `brief.pillars[1]` and renders exactly three rows in order: range, displacement, candles. Maps element status to color (pass=green, weak=amber, fail=red).
  - PRE-SESSION GRADE headline shows pill + why line; never renders the drilldown.
  - ScenarioCard renders id + grade pill + 3 rows; renders "—" gracefully when `target`/`grade` missing.

### Integration (existing smoke harness)

- Add `tests/fixtures/009-prep-redesign-paired.bundle.json` + `.expected.md` paired fixture. Capture from a real London brief output. Run `npm run smoke:fixtures` to verify the new schema doesn't break the verifier.
- Add `tests/fixtures/010-prep-redesign-aplus.bundle.json` with `pillar_grade=A+` and all 3 scenarios at grade A+.
- Add `tests/fixtures/011-prep-redesign-old-brief.bundle.json` representing a pre-schema brief (scenarios without id/grade/target) — renderer must show "—" not crash.

### Manual

- Boot the Electron app, navigate to PREP, verify each panel renders with the demo brief.
- Hit REFRESH, watch the strip transition from `[ REFRESH ]` to `[ ··· ]` and back.
- Click the bell on an untaken level above `brief.last`, verify TV alert is created and bell goes to ●.
- Switch theme to light, verify all new classes have light-mode equivalents.

---

## 8. Risks and rollback

### Risks
- **R1** — Pillar 2 element ordering. The renderer assumes `brief.pillars[1].elements[0..2]` are range / displacement / candles in that order. If the prompt emits a different order, Step3Panel mis-labels. **Mitigation:** match by element name substring (`/range/i`, `/displacement/i`, `/candle/i`) rather than position.
- **R2** — Old briefs have no `id` on scenarios. React `key` falls back to index, which causes re-mount on add/remove. Acceptable for a 1-4 length list; not worth a migration.
- **R3** — `useSymbolCache` returns null on first render before its IPC tick completes. Step2Panel must handle the null case without crashing. **Mitigation:** the fallback (single sorted-high-to-low block) covers this and the panel always renders.
- **R4** — Schema validation strictness. The new `target` field is required on every scenario. If the model emits an incomplete brief, the Zod throws and the brief turn errors out. **Acceptable** — that's the existing pattern for required fields.

### Rollback
- Revert `Prep.jsx`, `Shared.jsx` (remove ScenarioCard), `app.css` (remove new classes), `sdk.js` (revert scenario Zod), `analyze.md` and `.claude/commands/analyze.md` (revert prompt change).
- Existing briefs in `state/session/` are untouched (the old schema is a subset of the new — all existing briefs pass safeParse on the new schema, just with `id`/`grade`/`target` missing).

---

## 9. Decisions log (for posterity)

| # | Decision | Reason |
|---|----------|--------|
| 1 | Layout direction = checklist-mirror (variant B) | Strategy doc's 7-step structure is the canonical sequence; reading PREP like the doc cuts cognitive load.  |
| 2 | Scenario shape = full (id + grade + trigger + action + target) | Per-scenario grade and explicit target match the strategy doc's "if / then / target" cadence. Cost = 3 additive fields. |
| 3 | KEY LEVELS = replace, not split | One source of truth for untaken liquidity. Grouping above/below is what the trader scans during the open. |
| 4 | Status strip = merge (stale + diff + chain chip + refresh) | Three small panels at the top of every brief was wasted vertical space. Strip is two lines of HTML. |
| 5 | PRE-SESSION GRADE = one-line headline | Pillar 1 is already in STEP 1, Pillar 2 is already in STEP 3 — drilldown would duplicate. |
| 6 | Scenario field rename = NO | `condition` → `trigger` would break every brief in `state/session/`. UI labels it "TRIGGER" — schema name is internal. |
| 7 | Pillar 2 element matching = by name substring, not index | Robust to ordering changes in the prompt; index-based mapping is fragile. |
| 8 | Level grouping anchor = `currentPrice` prop from `useSymbolCache` | Brief schema has no price snapshot field. Cache-backed live price keeps the partition useful as price moves; brief data itself stays stable. |

---

## 10. Next step

Hand off to `superpowers:writing-plans` to break this spec into ordered, runnable implementation tasks.
