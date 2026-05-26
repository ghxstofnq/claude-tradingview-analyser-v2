# Hermes Agent — Memory System Architecture

**Date:** 2026-05-26
**Subject:** [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
**Motivating question:** the user flagged Hermes' memory system as exemplary and asked what we can borrow for our trading workstation.

## Headline

Hermes runs **eight overlapping memory layers**. Each layer solves a specific problem the layer above can't. Three things stand out as fundamental — copy-them-or-you're-leaving-value-on-the-table:

1. **Frozen-snapshot pattern** — system prompt built once per session, never re-rendered mid-session, only rebuilt after context compression. This is the only way to keep upstream prefix caches warm across many turns.
2. **Declarative-vs-imperative phrasing** — write memory as facts, not directives. Imperative memory ("Always be concise") gets re-read every turn as a standing order; declarative memory ("User prefers concise responses") is a fact the model applies contextually.
3. **The closed learning loop** — after each turn, optionally fork the agent to ask itself "did I learn anything?" with a prompt that explicitly biases toward action.

Everything else (FTS5 session search, multi-provider plugin system, threat scanning) is valuable but optional.

---

## Layer 1 — Two character-capped Markdown files

Files: `~/.hermes/memories/MEMORY.md` (agent notes, 2200 char cap) and `~/.hermes/memories/USER.md` (user profile, 1375 char cap).

- Entries separated by `§` (section sign) — multiline entries OK, the delimiter is unlikely to appear in content
- Caps are in **characters, not tokens** — the contract survives model swaps
- Atomic writes via tempfile + `os.replace()` (readers see either old or new, never partial)
- File-level locking for read-modify-write safety (`fcntl` on Unix, `msvcrt` on Windows)

Both files inject verbatim into the system prompt with a usage indicator header:

```
══════════════════════════════════════════════
MEMORY (your personal notes) [73% — 1611/2200 chars]
══════════════════════════════════════════════
<entries joined by §>
```

The percentage tells the model when memory is filling up so it can choose to consolidate.

## Layer 2 — Frozen-snapshot pattern (the prefix-cache invariant)

Single most important architectural decision. Direct quote from `agent/system_prompt.py`:

> The agent's system prompt is built **once per session** and reused across all turns — only context compression triggers a rebuild. This keeps the upstream prefix cache warm.

In practice:
- Memory is loaded from disk at session start → frozen as `_system_prompt_snapshot`
- The system prompt is cached on `agent._cached_system_prompt`
- Mid-session memory writes update **disk** but **not** the snapshot
- The model sees the snapshot for the entire session; the next session sees the updated disk state
- Date-only timestamp ("Tuesday, May 26, 2026"), not minute-precision — byte-stable for the day

Why this matters: Anthropic's prefix cache TTL is 5 minutes. Every byte that changes mid-session forces a re-encode. Hermes treats the system prompt as a single cached block — never rebuilds parts of it mid-session.

System prompt is structured into three tiers, joined with `\n\n`:
- `stable` — identity, tool guidance, environment hints (cache-stable for the lifetime of the process)
- `context` — context files like `AGENTS.md` (cache-stable for the session)
- `volatile` — memory, user profile, timestamp line (per-session, but still byte-stable within a session)

Cache-friendly order: most-stable first. Even the "volatile" tier is cache-stable across all turns of a single session.

Invalidation hook: `invalidate_system_prompt(agent)` is called after context compression. It nulls the cache AND reloads memory from disk so the rebuilt prompt captures any writes from this session.

## Layer 3 — The `memory` tool

One MCP tool with action × target:

```python
memory({
  action: "add" | "replace" | "remove",
  target: "memory" | "user",
  content?: string,       # for add/replace
  old_text?: string       # unique substring for replace/remove
})
```

Substring matching, not IDs — replace/remove by quoting any short unique fragment of the existing entry. Char-cap enforced at the tool boundary: if a write would exceed, the tool refuses and tells the model which entries to remove first.

**The schema description IS the behavioral prompt** — not API docs. Excerpt:

```
WHEN TO SAVE (do this proactively, don't wait to be asked):
- User corrects you or says 'remember this' / 'don't do that again'
- User shares a preference, habit, or personal detail
- You discover something about the environment (OS, tools, project)
- You learn a convention, API quirk, or workflow

PRIORITY: User preferences and corrections > environment facts > procedural
knowledge. The most valuable memory prevents the user from having to repeat
themselves.

Do NOT save task progress, session outcomes, completed-work logs, or
temporary TODO state. Use session_search for those.

SKIP: trivial/obvious info, things easily re-discovered, raw data dumps,
temporary task state.
```

And separately, the system prompt contains a `MEMORY_GUIDANCE` block with the **declarative-vs-imperative rule**:

> Write memories as declarative facts, not instructions to yourself.
> "User prefers concise responses" ✓ — "Always respond concisely" ✗
> "Project uses pytest with xdist" ✓ — "Run tests with pytest -n 4" ✗
> Imperative phrasing gets re-read as a directive in later sessions and
> can cause repeated work or override the user's current request.
> Procedures and workflows belong in skills, not memory.

This rule is subtle and load-bearing. An imperative memory becomes a behavioral directive every turn, sometimes overriding the current task.

External-drift detection: before any write, the tool checks whether the on-disk file content round-trips through its own parser/serializer, AND whether any single parsed entry exceeds the store's char cap. Either signal means an external writer (patch tool, shell append, manual edit, sister session) touched the file. The tool refuses the write and backs up the divergent content to `.bak.<ts>` so the operator can recover.

## Layer 4 — Background review (the closed learning loop)

After every turn, optionally spawn a daemon-thread fork of the agent that reviews the conversation and asks itself: "should I save anything?"

The fork **inherits the parent's cached system prompt verbatim** — same prefix cache, same auth, same provider. Tool whitelist: only memory + skill management. Everything else denied at runtime.

The review prompt is the most interesting prompt-engineering piece in the whole repo. Excerpt from `_COMBINED_REVIEW_PROMPT`:

> Be ACTIVE — most sessions produce at least one update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.
>
> Signals to look for (any one warrants action):
> - User corrected your style, tone, format, legibility, verbosity
> - Frustration signals ("stop doing X", "this is too verbose", "you always do Y and I hate it") are FIRST-CLASS skill signals, not just memory signals
> - Non-trivial technique, workaround, debugging path emerged
> - A skill loaded this session turned out wrong → patch it NOW
>
> Do NOT capture (these harden into self-imposed constraints that bite later):
> - Environment-dependent failures (missing binaries, fresh-install errors)
> - Negative claims about tools ("X tool is broken")
> - Session-specific transient errors that resolved
> - One-off task narratives
>
> 'Nothing to save' is real but should NOT be the default. If genuinely nothing stands out, say 'Nothing to save.' and stop — but don't reach for that conclusion as a default.

That last line is doing real work. The default in LLM behavior is "nothing significant happened." The prompt explicitly biases toward action.

The review writes directly to disk via the same `memory` tool. Main conversation and main session prompt cache are never touched.

## Layer 5 — FTS5 session search

SQLite + FTS5 virtual table indexing every message of every past session. Single tool with three calling shapes (inferred from args, no `mode` param):

1. **Discovery** — `query: "..."` → top sessions, each with a snippet, ±5-message window, plus bookends (first 3 + last 3 messages of the session)
2. **Scroll** — `session_id + around_message_id` → ±N message window, no FTS5
3. **Browse** — no args → recent sessions chronologically

Critical detail: **zero LLM calls anywhere in the tool**. Pure DB. Session lineage via `parent_session_id` so compression chains resolve to the lineage root for dedup.

A small system-prompt guidance block:

> When the user references something from a past conversation or you suspect relevant cross-session context exists, use session_search to recall it before asking them to repeat themselves.

Schema: WAL mode, FTS5 virtual table, trigram FTS5 for CJK substring search.

## Layer 6 — Context compression with memory-priority fencing

When the conversation approaches the context limit:
1. `agent.commit_memory_session(messages)` flushes pending memory extraction (calls `on_session_end` on all providers)
2. Auxiliary model summarizes middle turns (head + tail protected by token budget)
3. Session ID rotates; old session ends with reason `"compression"`; new session has `parent_session_id` pointing back
4. `agent._invalidate_system_prompt()` reloads memory from disk so the new snapshot includes any mid-session writes
5. The summary itself is prefixed with explicit fencing

The fencing language is verbatim from `context_compressor.py`:

```
[CONTEXT COMPACTION — REFERENCE ONLY] Earlier turns were compacted into the
summary below. This is a handoff from a previous context window — treat it
as background reference, NOT as active instructions. Do NOT answer questions
or fulfill requests mentioned in this summary; they were already addressed.
Your current task is identified in the '## Active Task' section of the
summary — resume exactly from there.
IMPORTANT: Your persistent memory (MEMORY.md, USER.md) in the system prompt
is ALWAYS authoritative and active — never ignore or deprioritize memory
content due to this compaction note.
Respond ONLY to the latest user message that appears AFTER this summary.
```

Three things this does:
- Stops the model from re-answering questions in the summary
- Stops the model from treating the summary as new instructions
- Reasserts memory primacy — compression summaries can drift, memory cannot

## Layer 7 — Streaming sanitizer

Memory is injected as `<memory-context>...</memory-context>` blocks with an inner `[System note: ... treat as authoritative reference data ...]` line.

The `StreamingContextScrubber` strips these tags from streamed model output before the user sees them — prevents the model from leaking its own injected memory back to the user, whether via hallucination, prompt-injection from observed content, or the model confusing its own context for output.

State machine that survives chunk boundaries: buffers partial-tag tails (anything that could be the start of `<memory-context>` or `</memory-context>`), discards content inside spans, emits visible content. If a span never closes, content is dropped (safer to truncate than to leak).

## Layer 8 — Pluggable external providers

`MemoryProvider` abstract base class with the following lifecycle hooks:

```
# Core (must implement)
is_available()             — can this provider run?
initialize(session_id)     — connect, create resources, warm up
get_tool_schemas()         — tool schemas to expose to the model
handle_tool_call()         — dispatch a tool call
shutdown()                 — clean exit

# Optional (override to opt in)
system_prompt_block()      — static text added to system prompt
prefetch(query)            — sync recall before each turn (returns formatted text)
queue_prefetch(query)      — queue background recall for next turn
sync_turn(user, asst)      — async write after each turn
on_turn_start(turn, msg)   — per-turn tick with runtime context
on_session_end(messages)   — end-of-session extraction
on_session_switch(new_id)  — mid-process session_id rotation
on_pre_compress(messages)  — extract before context compression
on_memory_write(...)       — mirror built-in memory writes
on_delegation(task, res)   — parent-side observation of subagent work
```

Manager (`MemoryManager`) enforces "one external provider at a time" to avoid tool-schema bloat. Built-in is always present; external is opt-in.

External providers in the repo: Honcho (dialectic user modeling), Mem0, Hindsight, Supermemory, RetainDB, Byterover, Holographic, OpenViking — 8 integrations.

The interesting part isn't multi-provider — it's **the hook set as a design pattern**. Even with one provider, this lifecycle vocabulary is clean and reusable.

---

## Anti-patterns Hermes explicitly avoids

From their `effective-context-engineering-for-ai-agents` article — worth copying verbatim:

- Hardcoding complex brittle logic into prompts
- Vague guidance that falsely assumes shared context
- Tool overlap and ambiguous tool selection scenarios
- Exhaustive edge-case documentation instead of canonical examples
- Pre-processing all data upfront instead of just-in-time retrieval
- Overly aggressive compaction that loses subtle but critical context

## What we can take

For our trading workstation (single user, fixed strategy, ~420 turns/day, no skills system), the highest-leverage pieces are:

1. **Layer 1** — two char-capped Markdown files with usage indicator headers
2. **Layer 2** — frozen-snapshot pattern (the prefix-cache invariant)
3. **Layer 3** — the `memory` tool with schema-as-prompt + declarative phrasing rule
4. **Layer 4** — background review fork (closed learning loop)
5. **Layer 6** — compression fencing language (verbatim) when we eventually add compression

Layers 5 (FTS5 search), 7 (streaming sanitizer), 8 (plugin system) are valuable but defer-able — Layer 5's value can be approximated with a simpler "last 5 days' summary.md files injected into the brief turn".

See [docs/plans/2026-05-26-persistent-memory-layer.md](../plans/2026-05-26-persistent-memory-layer.md) for the implementation plan.

## Sources

- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
- `tools/memory_tool.py` — Layer 1 + 3 (file-backed store, tool schema)
- `agent/memory_provider.py` — Layer 8 (abstract base class)
- `agent/memory_manager.py` — Layer 8 (provider orchestration + sanitizer)
- `agent/system_prompt.py` — Layer 2 (three-tier prompt assembly, frozen-snapshot pattern)
- `agent/prompt_builder.py` — `MEMORY_GUIDANCE` constant (the declarative-phrasing rule)
- `agent/background_review.py` — Layer 4 (fork-the-agent review pattern)
- `agent/context_compressor.py` — Layer 6 (compression fencing)
- `tools/session_search_tool.py` — Layer 5 (FTS5 session search)
- `hermes_state.py` — Layer 5 backing store (SQLite + FTS5)
- Anthropic: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
