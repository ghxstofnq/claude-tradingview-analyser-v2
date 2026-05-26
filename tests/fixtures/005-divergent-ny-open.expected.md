# Expected reading — divergent NY open (HTF bullish, LTF bearish)

Exercises the open_reaction divergence case. HTF h4 is bullish (recent
BoS bull at 29783.75), but LTF (current chart TF) just printed a
bearish BoS at 29948 — LTF reaction contradicts HTF draw.

## Expected verdicts

- `htf_ltf_alignment: divergent`
- `ltf_bias: bearish` — follows the NY reaction direction
- `is_retrace_day: true`
- `grade_cap: B` — A+ not available when HTF and LTF disagree
- `entry_model_priority: MSS` — divergent → LTF reversal at HTF level
- `primary_draw` (the h4 bullish FVG) STAYS valid as end-of-day runner target. Entry-hunt can still target it for runners if a long fires later.

## Citations

HTF h4 bullish structure (the destination): bos bull at 29783.75 (brief_digest.symbols.MNQ1!.htf.h4.recent_structures[0].level), displacement: true, tier internal.
LTF most recent structure (the divergent move): bos bear at 29948 (brief_digest.symbols.MNQ1!.ltf_context.most_recent_structure.level), displacement: true.

## Grade

`B` — divergent open caps the day at B; primary_draw preserved as runner target.
