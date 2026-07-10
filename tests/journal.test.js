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
