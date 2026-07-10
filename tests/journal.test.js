// tests/journal.test.js
// Auto-journal on trade close (app/main/journal.js) — row shape, note
// patching, and session-filtered reads. File IO runs against GOFNQ_STATE_DIR
// (the suite sets a temp dir; never the live tree).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.GOFNQ_STATE_DIR = process.env.GOFNQ_STATE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));

const { buildJournalRow, addNote, readJournal } = await import("../app/main/journal.js");
const { stateRoot } = await import("../app/main/sessions.js");

const FILL = {
  ts: "2026-07-10T15:34:31.292Z",
  account: "paper", symbol: "MNQ1!", side: "buy", qty: 2,
  planned: { entry: 21000, stop: 20974.5, tp: 21051 },
  actual: { entry: 21001.25, exit: 21052, usd: 203, r: 1.9, heldMs: 480000 },
};

describe("buildJournalRow", () => {
  it("maps the fill's actual fields verbatim — no recomputation", () => {
    const row = buildJournalRow(FILL, { date: "2026-07-10", session: "ny-am", id: "jr-1" });
    assert.equal(row.id, "jr-1");
    assert.equal(row.session, "ny-am");
    assert.equal(row.entry, 21001.25);
    assert.equal(row.exit, 21052);
    assert.equal(row.r, 1.9);
    assert.equal(row.usd, 203);
    assert.equal(row.heldMs, 480000);
    assert.deepEqual(row.planned, FILL.planned);
    assert.equal(row.note, null);
    assert.equal(row.screenshot, null);
    assert.equal(row.suggested_note, null);
  });
  it("degrades honestly on a sparse fill", () => {
    const row = buildJournalRow({ symbol: "MES1!" }, { date: "2026-07-10", session: "ny-pm", id: "jr-2" });
    assert.equal(row.r, null);
    assert.equal(row.entry, null);
    assert.equal(row.side, null);
  });
});

describe("journal file round-trip (temp state dir)", () => {
  const DATE = "2026-07-10";
  const dir = () => path.join(stateRoot(), "session", DATE);

  before(() => {
    fs.mkdirSync(dir(), { recursive: true });
    const rows = [
      buildJournalRow(FILL, { date: DATE, session: "ny-am", id: "jr-a" }),
      buildJournalRow({ ...FILL, side: "sell", actual: { ...FILL.actual, r: -1 } }, { date: DATE, session: "ny-pm", id: "jr-b" }),
    ];
    fs.writeFileSync(path.join(dir(), "journal.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  });

  it("readJournal filters by session; no file → empty", () => {
    assert.equal(readJournal({ date: DATE }).length, 2);
    assert.deepEqual(readJournal({ date: DATE, session: "ny-am" }).map((r) => r.id), ["jr-a"]);
    assert.deepEqual(readJournal({ date: "1999-01-01" }), []);
  });

  it("addNote patches exactly one row and caps length", () => {
    const res = addNote({ date: DATE, id: "jr-b", note: "chased — pillar 2 was marginal" });
    assert.equal(res.ok, true);
    const rows = readJournal({ date: DATE });
    assert.equal(rows.find((r) => r.id === "jr-b").note, "chased — pillar 2 was marginal");
    assert.equal(rows.find((r) => r.id === "jr-a").note, null);
    const long = addNote({ date: DATE, id: "jr-a", note: "x".repeat(500) });
    assert.equal(long.ok, true);
    assert.equal(readJournal({ date: DATE }).find((r) => r.id === "jr-a").note.length, 300);
  });

  it("addNote without id/date refuses", () => {
    assert.equal(addNote({ note: "hi" }).ok, false);
  });
});

// Post-close journal assist (Track 2, ruled 2026-07-10): a best-effort LLM
// draft lands on the row as suggested_note, fire-and-forget, strictly AFTER the
// close is on disk. The drafter + screenshot fn are injected so nothing shells
// out to TV or the Agent SDK.
const { recordClose, draftAndAttachNote, setJournalNoteDrafter, setJournalScreenshotFn, setJournalSend } = await import("../app/main/journal.js");

describe("draftAndAttachNote — suggested_note patch + re-emit", () => {
  const DATE = "2026-07-11";
  const dir = () => path.join(stateRoot(), "session", DATE);
  before(() => {
    fs.mkdirSync(dir(), { recursive: true });
    const row = buildJournalRow(FILL, { date: DATE, session: "ny-am", id: "jr-draft" });
    fs.writeFileSync(path.join(dir(), "journal.jsonl"), JSON.stringify(row) + "\n");
  });

  it("lands the drafted note on the row and re-emits journal:close", async () => {
    const sent = [];
    setJournalSend((ch, payload) => sent.push({ ch, payload }));
    setJournalNoteDrafter(async () => "clean MSS short, entry tracked the packet");
    const row = { id: "jr-draft", date: DATE, session: "ny-am" };
    await draftAndAttachNote({ date: DATE, id: "jr-draft", row });
    const stored = readJournal({ date: DATE }).find((r) => r.id === "jr-draft");
    assert.equal(stored.suggested_note, "clean MSS short, entry tracked the packet");
    assert.ok(sent.some((s) => s.ch === "journal:close" && s.payload.suggested_note), "re-emitted journal:close with the draft");
    setJournalSend(null);
    setJournalNoteDrafter(null);
  });

  it("a null draft leaves the row untouched", async () => {
    setJournalNoteDrafter(async () => null);
    await draftAndAttachNote({ date: DATE, id: "jr-draft", row: { id: "jr-draft", date: DATE } });
    // suggested_note is whatever the prior test set; a null draft must not clear it.
    const stored = readJournal({ date: DATE }).find((r) => r.id === "jr-draft");
    assert.equal(stored.suggested_note, "clean MSS short, entry tracked the packet");
    setJournalNoteDrafter(null);
  });

  it("never throws when the drafter rejects", async () => {
    setJournalNoteDrafter(async () => { throw new Error("boom"); });
    await assert.doesNotReject(draftAndAttachNote({ date: DATE, id: "jr-draft", row: { id: "jr-draft", date: DATE } }));
    setJournalNoteDrafter(null);
  });

  it("re-emit carries the PERSISTED note, not the stale close snapshot", async () => {
    const D2 = "2026-07-12";
    fs.mkdirSync(path.join(stateRoot(), "session", D2), { recursive: true });
    const seed = buildJournalRow(FILL, { date: D2, session: "ny-am", id: "jr-note" });
    fs.writeFileSync(path.join(stateRoot(), "session", D2, "journal.jsonl"), JSON.stringify(seed) + "\n");
    // Trader saves a note BEFORE the async draft lands.
    addNote({ date: D2, id: "jr-note", note: "chased it, pillar 2 marginal" });

    const sent = [];
    setJournalSend((ch, payload) => sent.push({ ch, payload }));
    setJournalNoteDrafter(async () => "suggested draft from claude");
    // The stale snapshot passed to draftAndAttachNote still has note:null.
    await draftAndAttachNote({ date: D2, id: "jr-note", row: { ...seed } });

    const emit = sent.find((s) => s.ch === "journal:close");
    assert.equal(emit.payload.note, "chased it, pillar 2 marginal", "re-emit carries the saved note, not null");
    assert.equal(emit.payload.suggested_note, "suggested draft from claude");
    setJournalSend(null);
    setJournalNoteDrafter(null);
  });
});

describe("recordClose is not delayed or broken by the journal turn", () => {
  it("returns ok even when the drafter rejects; the row is intact", async () => {
    // Fast fake screenshot (no ./bin/tv shell-out) + a rejecting drafter.
    setJournalScreenshotFn(async () => null);
    let drafterCalled = false;
    setJournalNoteDrafter(async () => { drafterCalled = true; throw new Error("llm exploded"); });
    const events = [];
    setJournalSend((ch, payload) => events.push({ ch, payload }));

    const res = await recordClose(FILL);
    assert.equal(res.ok, true);
    assert.ok(res.id, "recordClose returns the row id promptly");

    // The row was recorded (journal:close emitted) regardless of the LLM turn.
    const closeEv = events.find((e) => e.ch === "journal:close");
    assert.ok(closeEv, "journal:close emitted for the recorded row");
    const { date, id } = closeEv.payload;
    const stored = readJournal({ date }).find((r) => r.id === id);
    assert.ok(stored, "the close row is on disk");
    assert.equal(stored.suggested_note, null, "a rejected draft never patches suggested_note");

    // Let the fire-and-forget rejection settle; it must be swallowed.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(drafterCalled, true, "the drafter was invoked (fire-and-forget)");
    setJournalScreenshotFn(null);
    setJournalNoteDrafter(null);
    setJournalSend(null);
  });

  it("returns promptly even when the journal turn HANGS (never resolves)", async () => {
    setJournalScreenshotFn(async () => null);
    // A drafter that never settles — proves recordClose does not await it.
    setJournalNoteDrafter(() => new Promise(() => {}));
    setJournalSend(() => {});
    const started = Date.now();
    const res = await recordClose(FILL);
    const elapsed = Date.now() - started;
    assert.equal(res.ok, true);
    assert.ok(res.id);
    assert.ok(elapsed < 1000, `recordClose must return promptly under a hung turn (took ${elapsed}ms)`);
    setJournalScreenshotFn(null);
    setJournalNoteDrafter(null);
    setJournalSend(null);
  });
});
