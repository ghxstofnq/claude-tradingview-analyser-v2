# ICT Engine V1 → V2 Schema Diff

Captured 2026-05-28 against MNQ1! 1m chart, immediately after loading `ICT Engine V2` on the in-app webview.

Reference V1 sample: `tests/fixtures/001-current.bundle.json` (schema=1, 93 rows).
V2 capture: `tests/migration/v2-baseline.bundle.json` + raw rows at `tests/migration/v2-raw-pine.txt` (schema=2, 102 rows).

## Schema marker

| | V1 | V2 |
|---|---|---|
| `engine.meta.schema` | `1` | `2` |
| `engine.meta.count` | 93 | 102 |
| Other meta fields | identical | identical |

## Row types

V1 and V2 emit the same nine row types: `meta`, `level`, `sweep`, `fvg`, `bpr`, `swing`, `structure`, `liquidity`, `quality`. No row types added or removed.

## Per-row-type field diff

### level — identical

`name`, `price`, `state`, `swept`, `formed_ms`. No changes.

### sweep — identical

`target`, `price`, `side`, `swept_ms`, `rejected`. No changes.

### swing — identical

`kind`, `price`, `bar_ms`, `tier`, `swept` (parser adds `is_high`). No changes.

### structure — identical

`event` (bos|mss), `dir`, `level`, `broken_swing_ms`, `confirmed_ms`, `displacement` (bool), `tier` (swing|internal), `validation`. No changes.

### liquidity — identical

`kind` (eql), `side`, `price`, `swept`. V1 fixture didn't populate any liquidity rows; V2 captures populate them — but the field shape is the same as the parser already supports.

### fvg — V2 adds 10 lifecycle fields

V1 fields: `kind`, `dir`, `top`, `bottom`, `ce`, `created_ms`, `took_liq`, `disp_score`, `reacted`, `reaction_dir`, `state`.

V2 adds:

| Field | Type | Meaning |
|---|---|---|
| `size_quality` | `str` (`tiny\|normal\|...`) | Engine's per-zone size grading |
| `entered_ms` | `num` | First ms price wicked into the FVG |
| `bars_in_zone` | `num` | Total bars price spent inside the zone |
| `minutes_in_zone` | `num` | Total minutes inside |
| `ce_held` | `bool` | Whether CE held on first reaction |
| `confirm_close` | `bool` | Whether a clean close confirmed the reaction |
| `confirm_dir` | `str` (`bull\|bear\|none`) | Direction of the confirming close |
| `confirm_ms` | `num` | Ms of the confirming bar |
| `chop_15m` | `bool` | Whether 15m chop is detected around the zone |
| `entry_state` | `str` (`none\|confirmed\|invalidated`) | Engine's verdict on the entry lifecycle |

### bpr — V2 adds the same 10 lifecycle fields (plus `ce`)

V1 fields: `dir`, `top`, `bottom`, `created_ms`, `took_liq`, `reacted`, `reaction_dir`, `state`.

V2 adds: `ce` (num) — V1 didn't ship CE on BPRs but V2 does. Plus the same 10 lifecycle fields as `fvg`.

### quality — V2 drops `has_chop`, adds `atr_14`, `atr_17`, `session`

V1: `range_3h`, `range_quality`, `displacement`, `candle`, `has_chop`.

V2: `range_3h`, `range_quality`, `displacement`, `candle`, `atr_14` (num), `atr_17` (num), `session` (str — `ny_am`, etc.).

`has_chop` is dropped from V2. Existing parser type map already declares `atr_14` and `atr_17` as `num` (added during PR #56's ICT-engine utilization sweep), so coercion for those is already correct. `session` is new — defaults to `str` which is correct.

## New row types in V2

None.

## Removed row types from V1

None.

## Parser implications

Three changes needed in `cli/lib/ict-engine-parser.js`:

1. **`findIctEngineRows`** — currently does `s?.name === 'ICT Engine'` exact-match. V2's actual indicator name is `'ICT Engine V2'`. Switch to a substring match like `/^ICT Engine/i.test(s?.name)`.
2. **`ENGINE_SCHEMA` constant** + the `schema_supported` check — currently rejects schema=2. Widen to accept both schemas.
3. **`ROW_FIELD_TYPES`** — add the new V2 numeric / bool fields under `fvg` and `bpr` so they don't default to strings. Specifically: `entered_ms` (num), `bars_in_zone` (num), `minutes_in_zone` (num), `ce_held` (bool), `confirm_close` (bool), `confirm_ms` (num), `chop_15m` (bool), and BPR's `ce` (num). String fields (`size_quality`, `confirm_dir`, `entry_state`, `session`) keep the str default — already correct.

`compute-engine-gates.js` does not need changes for the migration itself. The new V2 lifecycle fields ride through the parsed engine object and become available at `gates.engine.pillar3.fvgs[].entered_ms` etc. without explicit promotion. Downstream consumers can opt in to those fields when they need them (e.g., the walker engine's confirmation logic).

## What stays the same

- All gate paths that V1 consumers cite continue to resolve under V2.
- Smoke fixtures' `expected.md` citations remain valid (the V1 fields they cite all still exist in V2).
- No new row types means no new dispatch branches in `parseIctEngineTable`.
