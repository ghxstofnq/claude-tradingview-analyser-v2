// tests/review-critique.test.js — Track 2 §2b item 1 (session critique card).
//
// Covers the main-side write path (session-wrap.fireReviewTurn / buildCritiqueFile),
// the read path (review.getJournalFor), and the ReviewPage source contract. All
// deps are injected — no Agent SDK, no TV, no live LLM. The whole state tree is
// redirected to a temp dir via GOFNQ_STATE_DIR so nothing touches live state/.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Redirect the whole state tree BEFORE importing modules that resolve it. Node's
// test runner isolates each test file in its own process, so this is contained.
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gofnq-critique-"));
process.env.GOFNQ_STATE_DIR = STATE_DIR;

const { fireReviewTurn, buildCritiqueFile, extractCritiqueSection } = await import("../app/main/session-wrap.js");
const { getJournalFor } = await import("../app/main/review.js");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const noop = () => {};

// A fake userTurn that streams `text` via chunk events (each tagged with a
// provider, exactly as sdk.js does), optionally errors, then resolves.
function fakeTurn(text, { error = false, provider = "claude" } = {}) {
  return async ({ onEvent }) => {
    if (text) onEvent?.({ type: "chunk", text, provider });
    if (error) onEvent?.({ type: "error", message: "boom", provider });
    onEvent?.({ type: "turn_complete", provider });
  };
}

function nyDate(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const g = (t) => f.find((p) => p.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

describe("buildCritiqueFile", () => {
  test("emits frontmatter (ts/session/provider) + body for non-empty prose", () => {
    const out = buildCritiqueFile({ text: "Clean MSS discipline.", session: "ny-am", provider: "claude", ts: "2026-07-10T20:05:00.000Z" });
    assert.match(out, /^---\n/);
    assert.match(out, /ts: 2026-07-10T20:05:00\.000Z/);
    assert.match(out, /session: ny-am/);
    assert.match(out, /provider: claude/);
    assert.match(out, /Clean MSS discipline\./);
  });
  test("returns null when there is no prose to persist", () => {
    assert.equal(buildCritiqueFile({ text: "   ", session: "ny-am" }), null);
    assert.equal(buildCritiqueFile({ text: "", session: "ny-am" }), null);
    assert.equal(buildCritiqueFile({ text: null, session: "ny-am" }), null);
  });
  test("defaults provider to claude when absent", () => {
    const out = buildCritiqueFile({ text: "x", session: "ny-pm", ts: "t" });
    assert.match(out, /provider: claude/);
  });
});

describe("extractCritiqueSection — only the ## CRITIQUE block, not the whole turn", () => {
  test("returns only the text under the heading; pre-critique chatter is discarded", () => {
    const prose = "Read summary.md and setups.jsonl.\nNothing new to save.\n\n## CRITIQUE\n\nThe chain nailed step 4. Weakest pillar was price quality.";
    const body = extractCritiqueSection(prose);
    assert.equal(body, "The chain nailed step 4. Weakest pillar was price quality.");
    assert.doesNotMatch(body, /Nothing new to save/);
    assert.doesNotMatch(body, /Read summary\.md/);
  });

  test("no heading → null (better absent than polluted)", () => {
    assert.equal(extractCritiqueSection("Just some memory reasoning. Nothing to save."), null);
    assert.equal(extractCritiqueSection(""), null);
    assert.equal(extractCritiqueSection(null), null);
    assert.equal(extractCritiqueSection(undefined), null);
  });

  test("an inline mention of the marker does NOT false-trigger (line-anchored)", () => {
    // The words "## CRITIQUE" appear mid-sentence / inside a code span, never as
    // their own heading line — so there is no real section to slice.
    assert.equal(extractCritiqueSection("I will put the critique under `## CRITIQUE` at the end."), null);
    assert.equal(extractCritiqueSection("Prefix text ## CRITIQUE trailing text on one line."), null);
  });

  test("last-occurrence wins — an earlier code-fenced heading can't shadow the real one", () => {
    const prose = [
      "Here is the format I follow:",
      "```",
      "## CRITIQUE",
      "<the critique goes here>",
      "```",
      "Nothing else to save.",
      "",
      "## CRITIQUE",
      "",
      "The real critique: clean MSS long, B grade, weakest pillar was quality.",
    ].join("\n");
    const body = extractCritiqueSection(prose);
    assert.equal(body, "The real critique: clean MSS long, B grade, weakest pillar was quality.");
    assert.doesNotMatch(body, /the critique goes here/);
  });

  test("heading with no body under it → null", () => {
    assert.equal(extractCritiqueSection("stuff\n\n## CRITIQUE\n\n   "), null);
  });
});

describe("fireReviewTurn — critique write is fire-and-forget safe", () => {
  test("persists ONLY the ## CRITIQUE block, not the pre-critique chatter", async () => {
    const persisted = [];
    await fireReviewTurn("ny-am", {
      turn: fakeTurn("Read summary.md.\nNothing new to save.\n\n## CRITIQUE\n\nChain nailed step 4; weakest pillar was price quality."),
      persist: async (a) => persisted.push(a),
      metric: noop,
    });
    assert.equal(persisted.length, 1);
    assert.match(persisted[0].text, /weakest pillar was price quality/);
    assert.doesNotMatch(persisted[0].text, /Nothing new to save/, "pre-critique narration must be sliced off");
    assert.doesNotMatch(persisted[0].text, /Read summary\.md/);
    assert.equal(persisted[0].session, "ny-am");
    assert.equal(persisted[0].provider, "claude");
    assert.ok(persisted[0].ts, "carries a timestamp");
  });

  test("no ## CRITIQUE marker → no file written (persist never called)", async () => {
    const persisted = [];
    await fireReviewTurn("ny-am", {
      turn: fakeTurn("Reviewed the session. Nothing worth saving today."),
      persist: async (a) => persisted.push(a),
      metric: noop,
    });
    assert.equal(persisted.length, 0, "prose without the marker is treated as no critique");
  });

  test("review turn ERROR → no file written (persist never called), wrap unaffected", async () => {
    const persisted = [];
    await fireReviewTurn("ny-am", {
      turn: fakeTurn("partial text\n\n## CRITIQUE\n\nsome critique then error", { error: true }),
      persist: async (a) => persisted.push(a),
      metric: noop,
    });
    assert.equal(persisted.length, 0, "an errored turn writes no critique even if a marker streamed");
  });

  test("a hanging persist is time-boxed — wrap chain returns promptly, never hangs", async () => {
    const started = Date.now();
    await fireReviewTurn("ny-am", {
      turn: fakeTurn("prep\n\n## CRITIQUE\n\nsolid session"),
      persist: () => new Promise(() => {}), // never resolves
      persistTimeoutMs: 40,
      metric: noop,
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `fireReviewTurn must return promptly on a hung write (took ${elapsed}ms)`);
  });

  test("turn THROWS → never throws out, records failed, no persist", async () => {
    const persisted = [];
    const events = [];
    let threw = false;
    try {
      await fireReviewTurn("ny-pm", {
        turn: async () => { throw new Error("kaboom"); },
        persist: async (a) => persisted.push(a),
        metric: (e) => events.push(e),
      });
    } catch { threw = true; }
    assert.equal(threw, false, "fire-and-forget: must not throw into the wrap chain");
    assert.equal(persisted.length, 0);
    assert.ok(events.some((e) => e.event === "failed"), "records a failed metric");
  });

  test("empty prose (turn produced nothing) → no persist", async () => {
    const persisted = [];
    await fireReviewTurn("ny-am", {
      turn: fakeTurn("   "),
      persist: async (a) => persisted.push(a),
      metric: noop,
    });
    assert.equal(persisted.length, 0);
  });

  test("a persist failure is swallowed — never throws into the wrap chain", async () => {
    let threw = false;
    try {
      await fireReviewTurn("ny-am", {
        turn: fakeTurn("prep\n\n## CRITIQUE\n\nsolid session"),
        persist: async () => { throw new Error("disk full"); },
        metric: noop,
      });
    } catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("getJournalFor — critique read (present / null)", () => {
  test("returns the raw critique text when critique.md exists", async () => {
    const date = "2026-07-09";
    const dir = path.join(STATE_DIR, "session", date, "ny-am");
    fs.mkdirSync(dir, { recursive: true });
    const raw = "---\nts: 2026-07-09T20:00:00.000Z\nsession: ny-am\nprovider: claude\n---\n\nSolid MSS long to the draw.\n";
    fs.writeFileSync(path.join(dir, "critique.md"), raw, "utf8");
    const j = await getJournalFor({ date, session: "ny-am" });
    assert.equal(typeof j.critique, "string");
    assert.match(j.critique, /Solid MSS long to the draw\./);
  });

  test("critique is null when the file is absent", async () => {
    const date = "2026-07-09";
    const dir = path.join(STATE_DIR, "session", date, "ny-pm");
    fs.mkdirSync(dir, { recursive: true });
    const j = await getJournalFor({ date, session: "ny-pm" });
    assert.equal(j.critique, null);
  });

  test("critique is null when the file is blank/whitespace", async () => {
    const date = "2026-07-09";
    const dir = path.join(STATE_DIR, "session", date, "london");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "critique.md"), "   \n\n", "utf8");
    const j = await getJournalFor({ date, session: "london" });
    assert.equal(j.critique, null);
  });
});

describe("write→read parity (default persist lands where getJournalFor reads)", () => {
  test("fireReviewTurn's default write is picked up by getJournalFor for today", async () => {
    await fireReviewTurn("ny-am", {
      turn: fakeTurn("pre-critique reasoning chatter\n\n## CRITIQUE\n\nEnd-to-end critique parity."),
      metric: noop,
    });
    const j = await getJournalFor({ date: nyDate(), session: "ny-am" });
    assert.equal(typeof j.critique, "string");
    assert.match(j.critique, /End-to-end critique parity\./);
    assert.doesNotMatch(j.critique, /pre-critique reasoning chatter/, "only the critique block reaches disk");
    assert.match(j.critique, /provider: claude/);
  });
});

describe("ReviewPage source contract", () => {
  const src = fs.readFileSync(path.join(repoRoot, "app/renderer/src/shell/pages/ReviewPage.jsx"), "utf8");

  test("renders a labeled CLAUDE'S SESSION CRITIQUE card", () => {
    assert.match(src, /CLAUDE'S SESSION CRITIQUE/);
  });

  test("the critique card lives in the JOURNAL domain, never EXECUTED", () => {
    const iJournal = src.indexOf("function JournalTab");
    const iExecuted = src.indexOf("EXECUTED tab");
    const iLabel = src.indexOf("CLAUDE'S SESSION CRITIQUE");
    assert.ok(iJournal >= 0 && iExecuted > iJournal, "expected JournalTab before the EXECUTED tab");
    assert.ok(iLabel > iJournal && iLabel < iExecuted, "critique card must sit inside JournalTab (JOURNAL domain)");
  });

  test("never injects raw HTML (no dangerouslySetInnerHTML)", () => {
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/);
  });
});
