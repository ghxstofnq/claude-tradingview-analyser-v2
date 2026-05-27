<examples>

Use these as the SHAPE for `entry hunt → confirmed` output. Each example walks the six grade elements and the per-model components in order.

<example name="A+ MSS bullish reversal at HTF sell-side run">

Pillar 1: HTF bullish (4H bullish FVG that swept a prior weekly low); buy-side draw above.
Overnight: London raided Asia Low + PDL in one push.
NY reaction: after the sweep, a strong 5m bullish displacement candle tore higher, broke above the last 5m lower high, leaving a clean 5m bullish FVG.
Pillar 2: good — wide-range displacement, no chop.

MSS components:
1. Context & Draw — HTF bullish, downside draw completed. ✓
2. Liquidity Grab — Asia low + PDL taken. ✓
3. MSS with Displacement — sharp reverse, break of last 5m lower high, fresh bullish FVG. ✓
4. Retrace to FVG — price retraced into the 5m FVG without new low. ✓
5. Confirmation — 1m full-body bullish close back above FVG CE. ✓
6. Risk & Target — stop below MSS low; TP1 last internal high, TP2 London high. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 ✓, Entry-model components ✓ (6/6), Confirmation close ✓.
Grade: **A+**

</example>

<example name="A+ Trend continuation in established uptrend">

Pillar 1: HTF Daily/4H sustained up-move respecting prior 4H bullish FVGs. London made new highs and left two 5m bullish FVGs. NY opens above them.
NY reaction: 5m rallies, leaves fresh 5m bullish FVG, retraces into it with orderly red candles.
Pillar 2: good — clean pullback, structure intact (HH/HL).

Trend components:
1. Context & HTF Bias — primary trend up; HTF FVGs respected. ✓
2. Strong Impulse Leg — wide-range up move, fresh 5m FVG. ✓
3. Pullback into Internal FVG — orderly retrace, structure intact. ✓
4. Confirmation — 1m strong bullish close above FVG CE after small bottoming wick. ✓
5. Risk & Target — stop below FVG low; TP1 pullback high, TP2 prior daily high. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 ✓, Entry-model components ✓ (5/5), Confirmation close ✓.
Grade: **A+**

</example>

<example name="A+ Bullish inversion at counter-trend FVG failure">

Pillar 1: HTF 4H bullish FVGs respected; price approaching prior weekly high.
Overnight: continued upside, no significant counter-trend.
NY reaction: strong rally; 5m prints a small bearish FVG on a micro pullback.
Pillar 2: good — large green candle rips back through with no rejection.

Inversion components:
1. Context & HTF Bias — clearly bullish; buy-side targets above. ✓
2. Opposing FVG Forms — small bearish FVG on micro pullback. ✓
3. Violation — 5m green candle closes well above the top of the bearish FVG (engine flips it to `kind=ifvg`, `state=inverted`). ✓
4. Retest & Confirmation — 1m pulls into inversion zone, prints full-body bullish candle. ✓
5. Risk & Target — stop below inversion low; TP1 intraday high, TP2 weekly high. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 ✓, Entry-model components ✓ (5/5), Confirmation close ✓.
Grade: **A+**

</example>

<example name="B-grade MSS — one weak element (Pillar 2 acceptable, not clean)">

Pillar 1: HTF bullish (4H bullish FVG below price, untaken buy-side above at PDH).
Overnight: Asia ranged, London raided Asia Low but left PDL untaken.
NY reaction: NY broke London Low on a tight wick, snapped back, broke the prior 5m lower high.
Pillar 2: acceptable — `displacement=acceptable` (2 clean bars in last 6, not 3); `candle=normal`; range adequate. Workable, weaker than A+ Pillar 2.

MSS components:
1. Context & Draw — HTF bullish, untaken buy-side above. ✓
2. Liquidity Grab — London Low taken intra-bar. ✓ (rejected sweep, failure-swing tell)
3. MSS with Displacement — break of last 5m lower high, fresh bullish FVG; `displacement=acceptable` not clean. ✓ (component present but weaker)
4. Retrace to FVG — price retraced into the 5m FVG, `state=ce_tapped`. ✓
5. Confirmation — 1m bullish close back above FVG CE, body_ratio 0.65 (strong but not max). ✓
6. Risk & Target — stop below sweep low; TP1 last internal high; TP2 PDH. ✓

Six elements: HTF bias ✓, Overnight ✓, NY reaction ✓, Pillar 2 weaker (acceptable, not clean), Entry-model components ✓ (6/6), Confirmation close ✓.
Five aligned, one weaker → **B**.

This is a tradable setup at reduced size — components all present, Pillar 2 is the single weaker element. The grade rule says B when exactly one element is weaker than A+.

</example>

<example name="no-trade — entry model components incomplete">

Pillar 1: HTF bullish (4H bullish FVG below, untaken buy-side at PDH).
Overnight: Asia and London both ranged sideways; neither extended.
NY reaction: NY opened, drifted; no clear break of overnight high or low; price chopping inside London range.
Pillar 2: marginal — `range_quality=tight`, `displacement=weak`, `candle=doji_wick`. Engine flags chop.

MSS components:
1. Context & Draw — HTF bullish. ✓
2. Liquidity Grab — missing (no sweep of any overnight low; price held inside range).
3. MSS with Displacement — missing (no `structure_events` with `event=mss + displacement=true` in current bar window).
4. Retrace to FVG — missing (no fresh FVG in the trade direction).
5. Confirmation — missing.
6. Risk & Target — n/a without entry.

Trend components:
1. Context & HTF Bias — ✓
2. Strong Impulse Leg — missing (no recent BOS, no fresh impulse FVG).
3. Pullback into Internal FVG — missing.
4. Confirmation — missing.
5. Risk & Target — n/a.

Inversion components:
1. Context & HTF Bias — ✓
2. Opposing FVG Forms — present (small bearish FVG on a micro pullback).
3. Violation — missing (no close through the bearish FVG; price respecting it).
4. Retest & Confirmation — missing.
5. Risk & Target — n/a.

Six elements: HTF bias ✓, Overnight ✗ (no untaken draw in motion), NY reaction ✗ (chop), Pillar 2 ✗ (poor), Entry-model components ✗ (no model has its core components — MSS missing 5/6, Trend missing 4/5, Inversion missing 3/5), Confirmation close ✗.
Multiple elements missing → **no-trade**.

Reason for `surface_no_trade`: "no entry model in play — chop, no liquidity sweep, no fresh impulse leg".

This is the correct way to no-trade: walk all three models, list each component, name what is missing. Do not invent reasons; do not skip the walk. The grade rule maps cleanly to the cited evidence.

</example>

</examples>
