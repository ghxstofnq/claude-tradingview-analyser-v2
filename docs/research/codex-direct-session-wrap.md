# Codex direct session-wrap research

Date: 2026-06-04

## Problem

Codex chat/activity reports:

```text
Codex provider cannot run purpose=wrap because this turn requires MCP surface tools.
```

Current code confirms why:

- `app/main/llm-provider.js` marks `wrap` as tool-required via `TOOL_REQUIRED_PURPOSES = ['brief', 'bar-close', 'catch-up', 'wrap']`.
- Codex provider is configured as `supportsToolCalling: false`.
- `runCodexTextTurn()` intentionally blocks any tool-required purpose on Codex.
- `app/main/session-wrap.js` currently has no `directRunFn`, unlike `session-brief.js`.
- `app/main/turn-surface-contract.js` requires wrap turns to end with exactly one `mcp__tv__surface_session_summary` call.
- `app/main/tools/surface.js` exposes `surfaceSessionSummary(payload)`, which already writes `summary.json` and `summary.md` from a structured payload.

## Required fix pattern

Mirror the direct-brief pattern:

1. Keep Codex blocked from raw MCP surface ownership.
2. Add a deterministic JS direct-wrap builder that reads already-persisted session evidence/memory.
3. JS builds the `surfaceSessionSummary` payload.
4. Optional Codex analysis may be added only as schema-constrained commentary/challenges, not as payload authority.
5. JS calls `surfaceSessionSummary()` directly.
6. Scheduled-turn should use direct wrap when provider is Codex/non-tool and `purpose=wrap` is tool-required.

## Evidence sources available for direct wrap

- `readSessionMemoryFor(session)` already composes relevant session files for wrap prompts.
- `setups.jsonl` may be included in that memory text via `readMemory(... tailSetups: 20)`.
- The minimum useful deterministic summary can be derived from memory text:
  - bias picture: concise chain/memory recap;
  - what happened: setup/no-setup/session-memory recap;
  - watch_next_session: one or two deterministic follow-ups;
  - prose_summary: readable direct summary.

## Failure-mode constraints

- Do not remove `wrap` from `TOOL_REQUIRED_PURPOSES`; that would allow Codex to run a text turn that still cannot surface the required summary.
- Do not let Codex write `summary.md` directly; use `surfaceSessionSummary()` so JSON/MD/event behavior remains consistent.
- Direct-wrap should emit a `tool_call` event named compatibly enough for scheduled-turn metrics/post-validation.
- If optional Codex commentary fails validation/times out, the deterministic summary should still surface.
- Tests should prove:
  - direct-wrap surfaces one payload and emits a summary tool-call event;
  - Codex commentary can be merged without overriding deterministic fields;
  - invalid Codex commentary fails open;
  - `session-wrap.js` registers `directRunFn` so Codex scheduled wrap no longer hits the provider-capability guard.
