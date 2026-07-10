// Reviewer nit #1 on PR #231: after a feed disconnect the last position frame
// is stale — a fill can land during the gap. markDisconnected must reset the
// proven-flag so reconciler reads fail closed until a fresh position_update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTradingState, markDisconnected, __test } from "../app/main/execution/trading-feed.js";

test("markDisconnected resets connected and hasReceivedPositionUpdate", () => {
  __test.setPositionUpdateReceived(true);
  assert.equal(getTradingState().hasReceivedPositionUpdate, true);
  assert.equal(getTradingState().connected, true);

  markDisconnected();

  const s = getTradingState();
  assert.equal(s.connected, false);
  assert.equal(s.hasReceivedPositionUpdate, false, "stale position frame must not read as proven after a disconnect");
});
