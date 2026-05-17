# AI Trading Analysis — Accuracy & Best Practices

**Date:** 2026-05-17
**Motivating question:** how reliable is LLM-driven chart and indicator analysis? What does the evidence say about accuracy, common failure modes, and best practices — particularly for ICT methodology?

## Headline finding

The peer-reviewed literature is uniformly skeptical of LLM-only trading analysis. **There is no peer-reviewed work specifically on LLM identification of ICT structures** (FVGs, order blocks, killzones, liquidity sweeps, market-structure shifts). Anyone claiming "LLMs do ICT well" is anecdotal — including this analysis.

The empirically supported pattern is **deterministic extraction → LLM synthesis**: code identifies structure; the LLM interprets and contextualizes. Hybrid architectures consistently outperform LLM-only flows in the published work.

## Accuracy figures from the literature

| Finding | Source |
|--------|--------|
| GPT-5 and DeepSeek-V3 underperformed buy-and-hold on 20 DJIA stocks over four months | [StockBench (Oct 2025), arXiv:2510.02209](https://arxiv.org/abs/2510.02209) |
| Prior "LLM trading advantages" largely vanished on broader cross-sections / longer horizons | [FINSABER, arXiv:2505.07078](https://arxiv.org/abs/2505.07078) |
| Frontier LLMs show Expected Calibration Error 0.12–0.40 in finance — systematically overconfident | [Mind the Confidence Gap, arXiv:2502.11028](https://arxiv.org/html/2502.11028v3) |
| Arithmetic error rate rises ~+14 percentage points as numerical magnitudes grow | [arXiv:2502.08680](https://arxiv.org/html/2502.08680v1) |
| Forcing structured JSON output **during** reasoning degrades accuracy ~10–15% | [Is JSON Prompting a Good Strategy? — PromptLayer](https://blog.promptlayer.com/is-json-prompting-a-good-strategy/) |
| Frontier LLMs memorize prices on pre-cutoff dates rather than predict | [The Memorization Problem, arXiv:2504.14765](https://arxiv.org/html/2504.14765v1) |
| One hedge fund's "30% alpha" from LLM sentiment was entirely look-ahead bias | [Finance Alliance retrospective](https://www.financealliance.io/the-hidden-danger-of-look-ahead-bias-in-financial-llms/) |
| Best agent on real-world finance research tasks (o3): **46.8%** accuracy at $3.79/query | [FinToolBench, arXiv:2603.08262](https://arxiv.org/html/2603.08262) |
| LLM time-series explanation accuracy: 0.00–0.12 for Seasonal Drop / Volatility Shift; 0.94–0.96 for Structural Break | [LLM-as-a-Judge for Time Series, arXiv:2604.02118](https://arxiv.org/abs/2604.02118) |
| Self-consistency / majority-vote ensembling lifts reasoning accuracy by 11–18 pp on math benchmarks | [arXiv:2502.06233](https://arxiv.org/pdf/2502.06233) |
| Algorithmic OB+FVG+dynamic-feature detection: 65.3% win rate, 2.37 Sharpe (deterministic only) | [IJNRD paper](https://www.ijnrd.org/papers/IJNRD2411009.pdf) |

LLMs spot regime breaks reasonably well; they miss subtle volatility-state changes — directly relevant for "killzone activity vs. drift."

## Failure modes (ranked by relevance to this project)

1. **Hallucinated levels** — LLM cites prices not in the data.
2. **Recency anchoring** on the most recent bar.
3. **Overconfidence** — confident-sounding but wrong; verbal confidence does not track realized accuracy.
4. **Arithmetic errors** on counts / distances / R:R / ATR.
5. **Methodology drift** — forgets ICT, defaults to generic TA.
6. **Look-ahead bias** when shown historical sessions Claude saw in pre-training.

## Recommendations for this project (ordered by accuracy impact)

1. **Cite-or-reject rule.** Every numeric level in the analysis MUST reference an ID from `pine.boxes[i]`, `pine.lines[i]`, or `pine.labels[i]`. Bare prices not in the bundle are forbidden. Verifiable post-hoc with a string check. *Biggest accuracy lever.*
2. **Reason in prose, summarize in JSON.** Claude writes the read as prose, then ends with a small structured block (`{ bias, killzone_status, setup, entry, stop, target, invalidation, confidence }`). Confidence enum: `wait | conditional | actionable`. Ban `actionable` unless rule gates pass.
3. **Rule-based co-signal gates in `tv analyze` itself.** Boolean flags computed in code — `htf_bias_aligned`, `price_inside_pine_box`, `inside_killzone_window` — emitted in the JSON. Claude reads them; doesn't compute them.
4. **No LLM arithmetic.** Stop distance, R:R, bar counts, ATR — all computed in code and emitted in the JSON. Claude reads numbers, never produces one.
5. **Three canonical examples in the slash command.** London sweep → NY reversal, Asia accumulation → London expansion, no-setup standstill. Wrapped in `<example>` tags.
6. **Trim and split CLAUDE.md.** Move the ICT vocabulary out of CLAUDE.md to its own reference file, included from the slash command so it's re-read per call. Keep CLAUDE.md to hard constraints + decisions + layout (under ~120 instructions).
7. **Build a golden dataset before trading on this.** Capture 50 `tv analyze` outputs over the next few weeks, hand-grade the right read. Regression-test on every Claude version + prompt change.

## Three things this project should NOT do

1. **Don't add screenshots to the analysis input.** Multimodal models can answer correctly while barely using the image — accuracy stays high even if you swap in the wrong chart. The JSON bundle is strictly better; a screenshot risks the LLM anchoring on visual features and producing fluent-but-fictional readings.
2. **Don't backtest on data Claude has seen during pre-training.** Use post-cutoff sessions or out-of-sample symbols only. The hedge-fund "30% alpha that vanished" is the cautionary tale.
3. **Don't let the LLM do arithmetic on OHLCV.** Don't ask it to count consecutive bullish bars, compute ATR, measure range, check stop distances. The cure is tool-use, not better prompting.

## Honest caveat

Peer-reviewed work on LLMs + ICT specifically does not exist as of this date. The recommendations above transfer from adjacent published findings (chart-pattern accuracy, hybrid-architecture wins, calibration failures) — they're the best available basis, not a guarantee.

The single highest-leverage thing you can do to know if this analyzer works is **a golden dataset + shadow-trading**, not more prompt engineering.

## Sources

### Primary research
- [StockBench: Can LLM Agents Trade Stocks Profitably (arXiv:2510.02209)](https://arxiv.org/abs/2510.02209)
- [FINSABER / Can LLM-based Financial Investing Strategies Outperform the Market (arXiv:2505.07078)](https://arxiv.org/abs/2505.07078)
- [The Memorization Problem (arXiv:2504.14765)](https://arxiv.org/html/2504.14765v1)
- [Mind the Confidence Gap (arXiv:2502.11028)](https://arxiv.org/html/2502.11028v3)
- [Holistic Analysis of Hallucination in GPT-4V (arXiv:2311.03287)](https://arxiv.org/abs/2311.03287)
- [LLM-as-a-Judge for Time Series Explanations (arXiv:2604.02118)](https://arxiv.org/abs/2604.02118)
- [FinToolBench (arXiv:2603.08262)](https://arxiv.org/html/2603.08262)
- [Anchoring Bias in Large Language Models (arXiv:2412.06593)](https://arxiv.org/pdf/2412.06593)
- [Self-Consistency / Ensembling — arXiv:2502.06233](https://arxiv.org/pdf/2502.06233)

### Practitioner / engineering
- [Claude vs ChatGPT vs ChartSnipe — Chart Analysis Accuracy](https://chartsnipe.com/blog/claude-vs-chatgpt-vs-chartsnipe-chart-analysis)
- [Is JSON Prompting a Good Strategy? — PromptLayer](https://blog.promptlayer.com/is-json-prompting-a-good-strategy/)
- [GPT-4 with Vision: Complete Guide — Roboflow](https://blog.roboflow.com/gpt-4-vision/)
- [Look-ahead bias in financial LLMs — Finance Alliance](https://www.financealliance.io/the-hidden-danger-of-look-ahead-bias-in-financial-llms/)
- [smart-money-concepts (deterministic ICT detector) — GitHub](https://github.com/joshyattridge/smart-money-concepts)
- [Multimodal LLMs Interpreting Charts — Towards Data Science](https://towardsdatascience.com/mulitmodal-llms-interpreting-charts-b212f5c0aa1f/)
- [Just-in-Time Historical State Reconstruction — MDPI](https://www.mdpi.com/2673-2688/7/4/117)
