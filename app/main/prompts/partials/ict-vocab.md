<ict_vocabulary>

- **Market-structure labels (HH/HL/LH/LL)** — the ICT Engine names a swing pivot with the textbook convention: the SECOND letter is the pivot type (`H`igh or `L`ow), the FIRST is whether it is `H`igher or `L`ower than the previous pivot of that same type.
  - `HH` = Higher High — a swing **high** above the prior high
  - `HL` = Higher Low — a swing **low** above the prior low
  - `LH` = Lower High — a swing **high** below the prior high
  - `LL` = Lower Low — a swing **low** below the prior low
  - `HH` and `LH` are swing **highs**; `HL` and `LL` are swing **lows**. Each engine swing also carries an explicit `is_high` boolean — trust it. An uptrend prints `HH` + `HL`; a downtrend prints `LH` + `LL`.
- **HTF / LTF** — higher TF (Daily / 4H / 1H) sets bias; LTF (15m / 5m / 1m) triggers.
- **Liquidity** — stop pools above swing highs (buy-side) or below swing lows (sell-side).
- **PDH / PDL** — previous day's high / low.
- **FVG** — 3-bar imbalance. The engine emits each with `top` / `bottom` / `ce` / `state`; acts as a retracement target.
- **BPR** — Balanced Price Range. Overlapping bullish + bearish FVGs; the engine emits these as `bprs[]`.
- **Order block** — last opposing candle before strong displacement.
- **Mitigation** — price returning to an FVG / OB. The engine tracks it as FVG `state`: `fresh → ce_tapped → filled`.
- **Inversion FVG** — bearish FVG violated bullishly (or vice versa) — flipped polarity. The engine emits `kind=ifvg`, `state=inverted`.
- **Killzone** — institutional flow window (London Open, NY AM, NY PM).
- **CE** — Consequent Encroachment, FVG midpoint. The engine emits it as `ce`.
- **Displacement** — wide-range directional move creating an FVG. The engine scores it per FVG as `disp_score` (0–1).
- **Sweep / liquidity raid** — wick beyond a swing/level reversing. The engine emits explicit `sweep` events with a `rejected` flag.
- **MSS / BOS** — Market Structure Shift (counter-trend break) / Break of Structure (continuation). The engine emits both as `structure_events` with `event`, `dir`, `validation`.
- **Draw on Liquidity** — the major pool price is being pulled toward.

</ict_vocabulary>
