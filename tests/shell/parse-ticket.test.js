// parse-ticket.test — palette ticket seed parsing (Command Shell PR1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTicket } from "../../app/renderer/src/shell/parseTicket.helpers.js";

test("long 2 mnq → buy seed with qty hint + symbol", () => {
  assert.deepEqual(parseTicket("long 2 mnq"), {
    side: "buy", dir: "LONG", qtyHint: 2, symbol: "MNQ1!",
  });
});

test("short mes → sell, no qty hint", () => {
  assert.deepEqual(parseTicket("short mes"), {
    side: "sell", dir: "SHORT", qtyHint: null, symbol: "MES1!",
  });
});

test("bare side falls back to the active symbol", () => {
  assert.deepEqual(parseTicket("long", { defaultSymbol: "MES1!" }), {
    side: "buy", dir: "LONG", qtyHint: null, symbol: "MES1!",
  });
  assert.equal(parseTicket("short 3").symbol, "MNQ1!");
});

test("non-ticket input → null", () => {
  assert.equal(parseTicket("why did we flatten?"), null);
  assert.equal(parseTicket(""), null);
  assert.equal(parseTicket("belong 2 mnq"), null); // word boundary
});
