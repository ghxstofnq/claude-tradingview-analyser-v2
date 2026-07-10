// tests/journal-assist.test.js
// LLM-drafted post-close journal note (app/main/journal-assist.js). All deps
// are injected — no Agent SDK, no TV, no live LLM. Fire-and-forget contract:
// every failure path resolves to null, never throws.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { draftJournalNote, buildCloseContext, readScreenshotAttachment } from "../app/main/journal-assist.js";

const ROW = {
  id: "jr-1", side: "sell", symbol: "MNQ1!", qty: 2, account: "paper",
  entry: 21001.25, exit: 20950, r: 1.9, usd: 203, heldMs: 480000,
  planned: { model: "MSS", grade: "A+", entry: 21000, stop: 21012, tp1: 20950, tp2: 20900 },
  screenshot: null,
};

const noopMetric = () => {};
// A fake userTurn that streams `text` via chunk events then resolves.
function fakeTurn(text, { error = false } = {}) {
  return async ({ onEvent }) => {
    if (error) onEvent?.({ type: "error", message: "boom" });
    if (text) onEvent?.({ type: "chunk", text });
    onEvent?.({ type: "turn_complete" });
  };
}

describe("buildCloseContext", () => {
  it("embeds fills, R, and the planned packet verbatim; no invented numbers", () => {
    const ctx = buildCloseContext(ROW);
    assert.match(ctx, /side: short/);
    assert.match(ctx, /MNQ/);
    assert.match(ctx, /actual entry: 21001.25/);
    assert.match(ctx, /realized R: 1.9/);
    assert.match(ctx, /"model":"MSS"/);
    assert.match(ctx, /"grade":"A\+"/);
    assert.match(ctx, /no new numbers/i);
  });
  it("degrades honestly on a sparse row", () => {
    const ctx = buildCloseContext({ symbol: "MES1!" });
    assert.match(ctx, /side: \?/);
    assert.match(ctx, /realized R: n\/a/);
    assert.match(ctx, /planned packet.*n\/a/);
  });
});

describe("readScreenshotAttachment", () => {
  it("returns null for missing/blank paths", () => {
    assert.equal(readScreenshotAttachment(null), null);
    assert.equal(readScreenshotAttachment(""), null);
    assert.equal(readScreenshotAttachment("nope/does-not-exist.png"), null);
  });
  it("reads a real file to base64 with a png media type", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jassist-"));
    const rel = "shot.png";
    const abs = path.join(dir, rel);
    fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const att = readScreenshotAttachment(rel, { root: dir });
    assert.equal(att.media_type, "image/png");
    assert.equal(att.data, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
  });
  it("rejects an oversized capture", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jassist-"));
    fs.writeFileSync(path.join(dir, "big.png"), Buffer.alloc(64));
    assert.equal(readScreenshotAttachment("big.png", { root: dir, maxBytes: 8 }), null);
  });
});

// Shared deps: no auth block, no screenshot, no-op reset/metric, ZERO defer so
// tests never sleep the 4s production pre-delay. Override per test.
const base = (over = {}) => ({
  isAuthBlocked: () => null,
  readAttachment: () => null,
  reset: () => {},
  metric: noopMetric,
  deferMs: 0,
  ...over,
});

describe("draftJournalNote", () => {
  it("returns the trimmed note when the turn resolves (text-only, no screenshot)", async () => {
    let sawImages = "unset";
    const turn = async ({ images, onEvent }) => {
      sawImages = images;
      onEvent?.({ type: "chunk", text: "  Clean MSS short, entry followed the packet.  " });
      onEvent?.({ type: "turn_complete" });
    };
    const note = await draftJournalNote(ROW, base({ turn }));
    assert.equal(note, "Clean MSS short, entry followed the packet.");
    assert.equal(sawImages, null, "no screenshot → images should be null (text-only)");
  });

  it("attaches the screenshot as an image when one is present", async () => {
    let sawImages = null;
    const turn = async ({ images, onEvent }) => { sawImages = images; onEvent?.({ type: "chunk", text: "note" }); onEvent?.({ type: "turn_complete" }); };
    const readAttachment = () => ({ data: "AAAA", media_type: "image/png" });
    const note = await draftJournalNote({ ...ROW, screenshot: "state/x.png" }, base({ turn, readAttachment }));
    assert.equal(note, "note");
    assert.deepEqual(sawImages, [{ data: "AAAA", media_type: "image/png" }]);
  });

  it("resets the session before EACH draft — no cross-trade accumulation", async () => {
    const resets = [];
    const turn = fakeTurn("note");
    await draftJournalNote(ROW, base({ turn, reset: (p) => resets.push(p) }));
    await draftJournalNote(ROW, base({ turn, reset: (p) => resets.push(p) }));
    assert.deepEqual(resets, ["journal", "journal"], "each draft gets a fresh journal session");
  });

  it("skips silently when the LLM is auth-blocked (never calls the turn or reset)", async () => {
    let called = false, reset = false;
    const turn = async () => { called = true; };
    const note = await draftJournalNote(ROW, base({ turn, isAuthBlocked: () => ({ ts: 1, message: "blocked" }), reset: () => { reset = true; } }));
    assert.equal(note, null);
    assert.equal(called, false);
    assert.equal(reset, false, "no reset when we never fire");
  });

  it("records event:'timeout' (not 'failed') when the turn times out", async () => {
    const events = [];
    const turn = async ({ onEvent }) => { onEvent?.({ type: "error", message: "timed out", kind: "timeout" }); };
    const note = await draftJournalNote(ROW, base({ turn, metric: (e) => events.push(e) }));
    assert.equal(note, null);
    assert.ok(events.some((e) => e.event === "timeout"), "timeout metric recorded");
    assert.ok(!events.some((e) => e.event === "failed"), "not recorded as failed");
  });

  it("passes the usage event through to the succeeded metric (per-purpose cost)", async () => {
    const events = [];
    const turn = async ({ onEvent }) => {
      onEvent?.({ type: "usage", usage: { cost_usd: 0.004, input_tokens: 900 } });
      onEvent?.({ type: "chunk", text: "note" });
      onEvent?.({ type: "turn_complete" });
    };
    await draftJournalNote(ROW, base({ turn, metric: (e) => events.push(e) }));
    const ok = events.find((e) => e.event === "succeeded");
    assert.ok(ok, "succeeded metric recorded");
    assert.deepEqual(ok.usage, { cost_usd: 0.004, input_tokens: 900 });
  });

  it("returns null (never throws) when the turn errors with no text", async () => {
    const note = await draftJournalNote(ROW, base({ turn: fakeTurn("", { error: true }) }));
    assert.equal(note, null);
  });

  it("returns null when the turn produces empty text", async () => {
    const note = await draftJournalNote(ROW, base({ turn: fakeTurn("   ") }));
    assert.equal(note, null);
  });

  it("never throws even when the turn fn itself rejects", async () => {
    const turn = async () => { throw new Error("kaboom"); };
    const note = await draftJournalNote(ROW, base({ turn }));
    assert.equal(note, null);
  });

  it("caps the note at 300 chars", async () => {
    const note = await draftJournalNote(ROW, base({ turn: fakeTurn("x".repeat(500)) }));
    assert.equal(note.length, 300);
  });
});
