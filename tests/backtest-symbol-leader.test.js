// The popover MNQ/MES/BOTH selector must reach the engine — it used to be
// dropped at backtest:start, so every run was the primary regardless.
import { test } from "node:test";
import assert from "node:assert/strict";
import { leaderForSymbol } from "../app/main/backtest-deps.js";
import { PAIR_PRIMARY, PAIR_SECONDARY } from "../app/main/config.js";

test("leaderForSymbol maps the popover selector to a leader", () => {
  assert.equal(leaderForSymbol("mes"), PAIR_SECONDARY);
  assert.equal(leaderForSymbol("MES1!"), PAIR_SECONDARY);
  assert.equal(leaderForSymbol("mnq"), PAIR_PRIMARY);
  assert.equal(leaderForSymbol("MNQ1!"), PAIR_PRIMARY);
  assert.equal(leaderForSymbol("both"), null);   // engine keeps configured primary
  assert.equal(leaderForSymbol(undefined), null);
});
