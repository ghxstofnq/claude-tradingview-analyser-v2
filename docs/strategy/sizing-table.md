# Sizing Table

Canonical sizing rules for Lanto's strategy (§6 + §7 step 7).

Sizing is a **lookup** by `day_of_week × grade`:

| Day      | A+   | B    |
|----------|------|------|
| Mon      | 0.5R | 0.5R |
| Tue      | 1.0R | 0.5R |
| Wed      | 1.0R | 0.5R |
| Thu      | 1.0R | 0.5R |
| Fri      | 0.5R | 0.5R |
| no-trade | 0    | 0    |

Reasoning: Mon/Fri are reduced regardless of grade (news, weekend
risk, lower liquidity). On core days (Tue-Thu) the grade gates size
— A+ alignment gets full R, B gets half. Tue-Thu B and Mon/Fri (any
grade) all land at 0.5R; that's intentional, not a multiplication.

Memory overrides live in `state/memory/USER.md`. If USER.md contains
a matching `skip` rule (e.g. "skip PCE Wednesdays"), the helper
returns `r_size: 0` with `override_reason` set.
