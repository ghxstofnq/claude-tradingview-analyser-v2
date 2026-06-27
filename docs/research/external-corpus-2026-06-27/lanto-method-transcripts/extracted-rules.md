# Lanto method-video transcripts — extracted rules

Five fresh Lanto YouTube method videos (auto-generated subs — lower fidelity than the
formatted class transcripts in `docs/strategy/transcripts/`; treat wording as
approximate, the *concepts* are reliable). These are **supplementary corroboration** for
the strategy spec, not a replacement. Standing rule
[[derive-faithfulness-from-transcripts]]: faithfulness is grounded in Lanto's own words.

| File | Video |
|---|---|
| `kBAZYIqlLMg-3M-From-3-Steps-Strategy.txt` | "$3M From 3 Steps Strategy" |
| `t2xKfcNSpO4-IFVG-FVG-Best-Results.txt` | "IFVG + FVG: The Setup Behind My Best Results" |
| `kOmp9b1ID2c-One-Entry-Model-Stupid-Simple.txt` | "Making +$42,000 LIVE Using This One Entry Model" |
| `h0SVib2ClhE-Do-This-Before-You-Enter.txt` | "Do This Before You Enter Another Trade" |
| `iSwj-o3-aWE-Trading-Is-Hard-Until-System.txt` | "Trading Is Hard Until You Build A System Like This" |

## Bias — the 3-vote model (corroborates gap #1, source-of-truth §1.1)
> "Step one, higher time frame bias… Step two, overnight… Step three, the opening range
> move." (3-Steps)

This is a **second independent Lanto source** for the same 3-component grade the
class-recording cites. The bot grades by *alignment* instead — see
[`lanto-source-of-truth.md` §1.1](../../strategy/lanto-source-of-truth.md).

## FVG quality (corroborates §2 price action)
> "A good fair value gap has a strong displacement sequence, takes previous liquidity,
> and clean candle bodies. A bad fair value gap has [none of that]." (3-Steps)
> "You seek large displacement in the body of the fair value gap… [at] an area of
> liquidity." (3-Steps)

Matches our engine's displacement-score + took-liq ranking. **MATCH.**

## Entry models (corroborates `entry-models.md` — all three present)
- **Trend / continuation:** "continuation entry model… off a 5-minute bullish fair value
  gap… stop loss could be the swing point or the model stop loss… target the 4-hour BPR
  fill / one-day internal high." (One-Entry-Model)
- **BPR entry:** "this type of entry is called a BPR [entry]… 5-minute bullish fair value
  gap." (One-Entry-Model) — BPR is treated as a first-class entry array.
- **Inversion:** "a 5-minute bullish fair value gap which turns into a bearish inversion
  fair value gap… ride the inversion." (IFVG+FVG) — the violating close flips the zone,
  exactly our inversion aggressive variant.

## Confirmation = NY-open reaction (corroborates `confirmation.md`)
> "Three [steps to a golden entry]: one, higher time frame [array]; two, [opening] range
> move confirmation, New York open; three, golden entry." (IFVG+FVG)
> "Reaction confirms or denies bias." / "[the HTF array] will either confirm or deny our
> higher [time frame bias]." (Do-This-Before-You-Enter)

Confirmation is the **reaction at the array**, not the initial liquidity grab. **MATCH.**

## Stops (corroborates `risk-and-management.md`)
> "Our stop loss being the swing point." / "stop loss could be the swing point or the
> model stop loss." Entry = "wait for a [fair value] gap retest and entry."

## Net read
Entry models, FVG quality, confirmation discipline, and stop placement all **MATCH** the
spec — these videos reinforce that the *engine/walker mechanics* are faithful. The one
recurring divergence the transcripts re-surface is **gap #1 (the 3-vote grade)**: Lanto
counts HTF + overnight + opening-range; the bot gates on alignment and leaves overnight
out of the grade.
