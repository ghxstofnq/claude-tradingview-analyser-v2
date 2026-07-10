// Renderer-side helpers for the anomaly explainer (Track 2 §2b item 5). Pure
// functions extracted for node --test (the renderer has no Vitest): the capped
// app:error ring buffer, the unified anomaly view model, the explain-event
// builder, plus the injection-inertness guarantee (the reply and error details
// are DATA carried verbatim and rendered as React text nodes — no HTML built).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  pushAppError,
  buildAnomalies,
  buildExplainEvent,
  MAX_ERRORS,
} from "../app/renderer/src/shell/anomalies.helpers.js";
import { isDedicatedChannelPurpose, isNarrationPurpose } from "../app/renderer/src/hooks/useChat.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

describe("pushAppError — capped, newest-first ring buffer", () => {
  it("prepends the newest error with a stable, unique id", () => {
    let list = [];
    list = pushAppError(list, { source: "ipc:chat", message: "first" });
    list = pushAppError(list, { source: "sdk", message: "second", level: "warn" });
    assert.equal(list.length, 2);
    assert.equal(list[0].message, "second", "newest first");
    assert.equal(list[0].level, "warn");
    assert.equal(list[1].message, "first");
    assert.notEqual(list[0].id, list[1].id, "ids must be unique for React keys");
  });

  it("caps the buffer at MAX_ERRORS, dropping the oldest", () => {
    let list = [];
    for (let i = 0; i < MAX_ERRORS + 4; i++) list = pushAppError(list, { message: `e${i}` });
    assert.equal(list.length, MAX_ERRORS, "buffer must not grow past the cap");
    assert.equal(list[0].message, `e${MAX_ERRORS + 3}`, "newest retained");
    assert.ok(!list.some((e) => e.message === "e0"), "oldest dropped");
  });

  it("null-safes a malformed event", () => {
    const list = pushAppError(null, undefined);
    assert.equal(list.length, 1);
    assert.equal(list[0].source, "app");
    assert.equal(list[0].level, "error");
    assert.equal(typeof list[0].message, "string");
  });
});

describe("buildAnomalies — unified list of red readiness blockers + app errors", () => {
  const readiness = {
    summary: { mode: "locked" },
    rows: [
      { id: "detector", label: "Detector bar-data", status: "fail", reason: "heartbeat stale", action: "restart_detector" },
      { id: "pine", label: "TradingView / Pine", status: "unavailable", reason: "no engine telemetry" },
      { id: "automation", label: "Automation mode", status: "warn", reason: "manual only" },
      { id: "tests", label: "Tests / build", status: "pass", reason: "green" },
    ],
  };
  const errors = [
    { id: 2, source: "ipc:execution", message: "broker timeout", level: "error" },
    { id: 1, source: "alert:arm", message: "chart reverted", level: "warn" },
  ];

  it("includes fail + unavailable readiness rows, excludes pass + warn/pending", () => {
    const out = buildAnomalies({ readiness, errors: [] });
    const ids = out.map((a) => a.code);
    assert.ok(ids.includes("detector"), "fail rows are anomalies");
    assert.ok(ids.includes("pine"), "unavailable rows are anomalies");
    assert.ok(!ids.includes("automation"), "warn rows are amber, not red — not anomalies");
    assert.ok(!ids.includes("tests"), "pass rows are never anomalies");
  });

  it("lists app errors first, then readiness blockers, with stable keys", () => {
    const out = buildAnomalies({ readiness, errors });
    assert.equal(out[0].kind, "app_error", "app errors come first");
    assert.equal(out[0].key, "err:2");
    const rdy = out.filter((a) => a.kind === "readiness");
    assert.deepEqual(rdy.map((a) => a.key), ["rdy:detector", "rdy:pine"]);
    // each readiness anomaly carries the fields buildExplainEvent needs
    const det = rdy.find((a) => a.code === "detector");
    assert.equal(det.action, "restart_detector");
    assert.equal(det.status, "fail");
    assert.equal(det.tone, "bad");
  });

  it("returns an empty list when readiness is clean and no errors captured", () => {
    const clean = { rows: [{ id: "tests", label: "Tests", status: "pass", reason: "green" }] };
    assert.deepEqual(buildAnomalies({ readiness: clean, errors: [] }), []);
    assert.deepEqual(buildAnomalies({}), []);
  });
});

describe("buildExplainEvent — anomaly → main event payload", () => {
  it("maps a readiness anomaly (code/source/status/action/message)", () => {
    const ev = buildExplainEvent({ kind: "readiness", code: "detector", source: "detector", status: "fail", action: "restart_detector", detail: "heartbeat stale", label: "Detector" });
    assert.equal(ev.kind, "readiness");
    assert.equal(ev.code, "detector");
    assert.equal(ev.status, "fail");
    assert.equal(ev.action, "restart_detector");
    assert.equal(ev.message, "heartbeat stale");
  });

  it("maps an app_error anomaly (source/level/message)", () => {
    const ev = buildExplainEvent({ kind: "app_error", source: "ipc:execution", level: "warn", detail: "broker timeout" });
    assert.equal(ev.kind, "app_error");
    assert.equal(ev.source, "ipc:execution");
    assert.equal(ev.level, "warn");
    assert.equal(ev.message, "broker timeout");
  });

  it("defaults to app_error shape and null-safes a missing anomaly", () => {
    const ev = buildExplainEvent();
    assert.equal(ev.kind, "app_error");
    assert.equal(ev.level, "error");
    assert.equal(ev.message, "");
  });
});

describe("injection-inertness — details are DATA, rendered as text nodes", () => {
  it("carries a markup-laden error message verbatim (no escaping, no stripping)", () => {
    const malicious = `<img src=x onerror="alert(1)"> & <script>steal()</script>`;
    const list = pushAppError([], { source: "sdk", message: malicious });
    const [anom] = buildAnomalies({ readiness: null, errors: list });
    // The value is preserved verbatim as DATA — the render path (React text
    // child) is what neutralizes it, so the helper must NOT pre-escape or strip.
    assert.equal(anom.detail, malicious, "message must be carried verbatim as data");
    assert.equal(buildExplainEvent(anom).message, malicious, "explain event carries the raw message too");
  });

  it("SystemPage renders anomaly + reply as text nodes (no dangerouslySetInnerHTML)", () => {
    const src = readFileSync(path.join(repoRoot, "app/renderer/src/shell/pages/SystemPage.jsx"), "utf8");
    // The anomaly card must never build HTML from an error/reply string. Match the
    // JSX attribute form (`dangerouslySetInnerHTML=`) so a mention in a comment
    // (like the one above the AnomaliesCard) doesn't trip the guard.
    assert.ok(!/dangerouslySetInnerHTML\s*=/.test(src), "SystemPage must not use dangerouslySetInnerHTML for anomaly content");
  });
});

describe("dedicated-channel + narration classification for explain", () => {
  it("explain is a dedicated-channel purpose (kept OUT of the CLAUDE/BRAIN feed)", () => {
    assert.equal(isDedicatedChannelPurpose("explain"), true);
  });
  it("explain never narrates into the BRAIN feed", () => {
    assert.equal(isNarrationPurpose("explain"), false);
  });
});
