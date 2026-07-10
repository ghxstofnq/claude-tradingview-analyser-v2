// Unit tests for the deterministic coach digest builder
// (app/main/coach-digest.js). Every number the coach LLM may cite is computed
// here — these tests pin that computation and prove torn-input tolerance.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCoachDigest, hashDigest } from "../app/main/coach-digest.js";

// Minimal journal factory — the shape getJournalFor returns, trimmed to what
// the digest reads.
function journal({
  date, session = "ny-am", grade = "B",
  wins = 0, losses = 0, net_r = 0, setups = 0, accepted = 0, gradable = 0, faithful = 0,
  chain_audit = {}, setupRows = [], trades = [], fills = [], intents = [],
} = {}) {
  return {
    date, session,
    brief: { pillar_grade: grade },
    summary: { chain_audit },
    stats: { wins, losses, net_r, setups, accepted, gradable, faithful },
    setups: setupRows,
    trades, fills, intents,
  };
}

describe("buildCoachDigest — aggregates", () => {
  // Most-recent first (as getRecentJournals returns).
  const journals = [
    journal({ date: "2026-07-10", grade: "A+", wins: 1, losses: 0, net_r: 2, setups: 2, accepted: 1, gradable: 1, faithful: 1, setupRows: [{ model: "MSS", _disposition: "accepted" }] }),
    journal({ date: "2026-07-09", grade: "B", wins: 0, losses: 1, net_r: -1, setups: 1, accepted: 1, gradable: 1, faithful: 0, setupRows: [{ model: "Trend", _disposition: "accepted" }] }),
    journal({ date: "2026-07-08", grade: "B", wins: 1, losses: 0, net_r: 1.5, setups: 1, accepted: 1, gradable: 1, faithful: 1, setupRows: [{ model: "MSS", _disposition: "accepted" }] }),
  ];

  const d = buildCoachDigest(journals);

  test("counts sessions and window", () => {
    assert.equal(d.n_sessions, 3);
    assert.equal(d.window.from, "2026-07-08"); // oldest
    assert.equal(d.window.to, "2026-07-10");   // newest
  });

  test("aggregate wins/losses/cum_r/win_rate computed in code", () => {
    assert.equal(d.aggregate.wins, 2);
    assert.equal(d.aggregate.losses, 1);
    assert.equal(d.aggregate.decided, 3);
    assert.equal(d.aggregate.cum_r, 2.5); // 2 + (-1) + 1.5
    assert.equal(d.aggregate.win_rate, 0.67); // round2(2/3)
    assert.equal(d.aggregate.best_session_r, 2);
    assert.equal(d.aggregate.worst_session_r, -1);
  });

  test("per-session rows carry R/outcome/grade/model, most-recent first", () => {
    assert.equal(d.sessions[0].date, "2026-07-10");
    assert.equal(d.sessions[0].outcome, "win");
    assert.deepEqual(d.sessions[0].models, ["MSS"]);
    assert.equal(d.sessions[1].outcome, "loss");
    assert.equal(d.sessions[1].grade, "B");
  });

  test("grade + model tallies", () => {
    assert.deepEqual(d.grade_counts, { "A+": 1, B: 2 });
    assert.deepEqual(d.model_counts, { MSS: 2, TREND: 1 });
  });

  test("faithfulness tally", () => {
    assert.equal(d.faithfulness.gradable, 3);
    assert.equal(d.faithfulness.faithful, 2);
    assert.equal(d.faithfulness.rate, 0.67);
  });

  test("equity series is chronological and cumulative", () => {
    assert.deepEqual(d.equity.map((e) => e.cum_r), [1.5, 0.5, 2.5]);
    assert.equal(d.equity[0].date, "2026-07-08");
  });
});

describe("buildCoachDigest — streaks", () => {
  test("current + longest win/loss over chronological order", () => {
    // chronological oldest→newest: win, win, loss, win  →  current run = 1 win
    const journals = [
      journal({ date: "2026-07-13", net_r: 1, wins: 1 }),  // newest
      journal({ date: "2026-07-12", net_r: -1, losses: 1 }),
      journal({ date: "2026-07-11", net_r: 2, wins: 1 }),
      journal({ date: "2026-07-10", net_r: 1, wins: 1 }),  // oldest
    ];
    const d = buildCoachDigest(journals);
    assert.deepEqual(d.streaks.current, { kind: "win", length: 1 });
    assert.equal(d.streaks.longest_win, 2);  // the 07-10,07-11 pair
    assert.equal(d.streaks.longest_loss, 1);
  });

  test("scratch / no-trade sessions break a streak", () => {
    const journals = [
      journal({ date: "2026-07-12", net_r: 1, wins: 1 }),   // newest
      journal({ date: "2026-07-11", net_r: 0 }),            // no-trade breaks
      journal({ date: "2026-07-10", net_r: 1, wins: 1 }),   // oldest
    ];
    const d = buildCoachDigest(journals);
    assert.deepEqual(d.streaks.current, { kind: "win", length: 1 });
    assert.equal(d.streaks.longest_win, 1);
  });
});

describe("buildCoachDigest — chain + discrepancies", () => {
  test("degraded wrap frontmatter tallies to the chain block", () => {
    const journals = [
      journal({ date: "2026-07-10", chain_audit: { open_reaction: { chain_status: "degraded:htf_partial" } } }),
      journal({ date: "2026-07-09", chain_audit: {} }),
    ];
    const d = buildCoachDigest(journals);
    assert.equal(d.chain.degraded, 1);
    assert.equal(d.chain.clean, 1);
    assert.equal(d.sessions[0].chain_status, "degraded");
  });

  test("evidence-chain discrepancies counted where fill+trade present", () => {
    const trade = { id: "t1", ts: "2026-07-10T13:41:00.000Z", symbol: "MNQ1!", side: "long", outcome: "TP1_HIT", size: { contracts: 2 } };
    const fill = { ts: "2026-07-10T13:41:05.000Z", symbol: "MNQ1!", side: "buy", qty: 1, actual: { r: 1 } }; // qty mismatch 2 vs 1
    const journals = [journal({ date: "2026-07-10", trades: [trade], fills: [fill] })];
    const d = buildCoachDigest(journals);
    assert.ok(d.discrepancies.total >= 1);
    assert.ok(d.sessions[0].discrepancies >= 1);
    assert.ok(d.sessions[0].discrepancy_kinds.qty_mismatch >= 1);
  });

  test("no fill/intent → no discrepancies (old sessions)", () => {
    const trade = { id: "t1", ts: "2026-07-10T13:41:00.000Z", symbol: "MNQ1!", side: "long", outcome: "TP1_HIT" };
    const d = buildCoachDigest([journal({ date: "2026-07-10", trades: [trade], fills: [], intents: [] })]);
    assert.equal(d.discrepancies.total, 0);
  });
});

describe("buildCoachDigest — torn input tolerance", () => {
  test("empty / null / non-array input → zeroed digest, never throws", () => {
    for (const input of [[], null, undefined, "nope", [null, undefined]]) {
      const d = buildCoachDigest(input);
      assert.equal(d.n_sessions, 0);
      assert.equal(d.aggregate.cum_r, 0);
      assert.equal(d.aggregate.win_rate, null);
      assert.deepEqual(d.streaks.current, { kind: "none", length: 0 });
      assert.equal(d.window.from, null);
    }
  });

  test("missing fields on a journal degrade gracefully", () => {
    const d = buildCoachDigest([{ date: "2026-07-10" }, {}]);
    assert.equal(d.n_sessions, 2);
    assert.equal(d.sessions[0].net_r, 0);
    assert.equal(d.sessions[0].grade, null);
    assert.deepEqual(d.sessions[0].models, []);
  });

  test("respects the limit (default 10)", () => {
    const many = Array.from({ length: 15 }, (_, i) => journal({ date: `2026-07-${String(i + 1).padStart(2, "0")}` }));
    assert.equal(buildCoachDigest(many).n_sessions, 10);
    assert.equal(buildCoachDigest(many, { limit: 3 }).n_sessions, 3);
  });
});

describe("hashDigest", () => {
  test("stable for identical content, key-order independent", () => {
    const a = { x: 1, y: [1, 2], z: { b: 2, a: 1 } };
    const b = { z: { a: 1, b: 2 }, y: [1, 2], x: 1 };
    assert.equal(hashDigest(a), hashDigest(b));
    assert.match(hashDigest(a), /^[0-9a-f]{8}$/);
  });

  test("changes when content changes", () => {
    assert.notEqual(hashDigest({ x: 1 }), hashDigest({ x: 2 }));
  });

  test("same journals → same digest hash (deterministic)", () => {
    const js = [journal({ date: "2026-07-10", net_r: 2, wins: 1 })];
    assert.equal(hashDigest(buildCoachDigest(js)), hashDigest(buildCoachDigest(js)));
  });
});
