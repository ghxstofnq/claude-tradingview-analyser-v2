# AI Command-Following Consistency

**Date:** 2026-05-17
**Motivating question:** how do we make Claude follow the `/analyze` recipe consistently every time? User had read that it "should be structured around tool calling" — verify or challenge that with primary sources.

## Headline finding

"Tool calling for consistency" is half-right, and the conflation is doing real damage in the wider industry.

The mechanism that actually produces consistency is **grammar-constrained decoding against a schema**, available two ways on Anthropic's API:
- Tool inputs with `strict: true` (function-call as output schema)
- Structured Outputs (`output_config.format`)

Both forbid token deviation at sample-time. Calling a tool to *fetch data* is orthogonal — it changes what's in context, not how the output is shaped. Free-text template-following (today's `/analyze`) is the weakest of the three forms.

## Concrete numbers

- Tool Use Examples lift parameter-handling accuracy **72% → 90%** (Anthropic's [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)).
- `CLAUDE.md` is injected as `<system-reminder>` in the messages array, **not** the system prompt. Empirical reports converge on a soft ceiling around **~150–200 instructions** before degradation; files over **~2,000 tokens** start crowding working context.
- Tool-with-schema vs. free-text instructions: roughly **1–2 orders of magnitude** improvement on structural fidelity.
- STED benchmark: Claude 3.7 Sonnet shows near-perfect structural consistency at temperature 0.9; smaller models degrade hard. Temperature = 0 is necessary, not sufficient.

## The Claude Code constraint

We're running this project inside a Claude Code session, not as direct API consumers. `output_config.format` and `strict: true` are API-level controls — we don't have direct access to them. In CC we can only *describe* a schema in the slash command body, not enforce it at decode time.

Levers available inside Claude Code:

1. **Tight slash-command prompt** mirroring the schema we'd enforce on the API.
2. **Few-shot examples (3–5)** inside the command, wrapped in `<example>` tags. Anthropic explicitly recommends this pattern.
3. **Self-check step** in the prompt — e.g. "every cited price must appear in the bundle; if it doesn't, remove it."
4. **Golden-output regression testing** against captured `analyze.json` fixtures. Standard playbook: 100–300-row golden dataset, deterministic format checks plus LLM-as-judge for semantics, run on every prompt/model change.
5. **Verification rules in code** — e.g. a `cite-or-reject` post-hoc string check on the analyzer's output.

## The verification gap

This is where teams get burned. Models version-drift, prompts drift, schemas drift. Production failures get added back to the golden set. Without regression testing, the day a Claude model upgrade silently changes your interpretations is the day you find out the hard way.

## Sources

- Anthropic: [Increase output consistency](https://platform.claude.com/docs/en/docs/test-and-evaluate/strengthen-guardrails/increase-consistency)
- Anthropic: [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- Anthropic: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic: [Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Claude Code: [Slash Commands in the SDK](https://code.claude.com/docs/en/agent-sdk/slash-commands)
- STED and Consistency Scoring: [arXiv:2512.23712](https://arxiv.org/abs/2512.23712)
- [Inside Claude Code's System Prompt](https://www.claudecodecamp.com/p/inside-claude-code-s-system-prompt)
- [How Claude Code Builds a System Prompt](https://www.dbreunig.com/2026/04/04/how-claude-code-builds-a-system-prompt.html)
- [CLAUDE.md best practices — Arize](https://arize.com/blog/claude-md-best-practices-learned-from-optimizing-claude-code-with-prompt-learning/)
- [Automated Prompt Regression Testing — Traceloop](https://www.traceloop.com/blog/automated-prompt-regression-testing-with-llm-as-a-judge-and-ci-cd)
- [Test Cases, Goldens, and Datasets — Confident AI](https://www.confident-ai.com/docs/llm-evaluation/core-concepts/test-cases-goldens-datasets)
