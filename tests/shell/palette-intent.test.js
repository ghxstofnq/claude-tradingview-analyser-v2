// palette-intent.test — every detectIntent branch (Command Shell PR1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectIntent } from "../../app/renderer/src/shell/paletteIntent.helpers.js";

test("empty / whitespace → root", () => {
  assert.equal(detectIntent(""), "root");
  assert.equal(detectIntent("   "), "root");
  assert.equal(detectIntent(null), "root");
  assert.equal(detectIntent(undefined), "root");
});

test("long|short prefix → ticket", () => {
  assert.equal(detectIntent("long 2 mnq"), "ticket");
  assert.equal(detectIntent("SHORT mes"), "ticket");
  assert.equal(detectIntent("long"), "ticket");
  // must be a word boundary — "longer trend?" is a question, not a ticket
  assert.notEqual(detectIntent("longer trend?"), "ticket");
});

test("trailing ? or question word → ask", () => {
  assert.equal(detectIntent("did the guard trip?"), "ask");
  assert.equal(detectIntent("why did we flatten"), "ask");
  assert.equal(detectIntent("What is the draw"), "ask");
  assert.equal(detectIntent("should I trim into CPI"), "ask");
  assert.equal(detectIntent("how strong was displacement"), "ask");
});

test("alerts / news / orders nouns → their views", () => {
  assert.equal(detectIntent("alerts"), "browse");
  assert.equal(detectIntent("alert stack"), "browse");
  assert.equal(detectIntent("news"), "news");
  assert.equal(detectIntent("calendar this week"), "news");
  assert.equal(detectIntent("orders"), "orders");
  assert.equal(detectIntent("fills"), "orders");
});

test("anything else → filter", () => {
  assert.equal(detectIntent("flatten"), "filter");
  assert.equal(detectIntent("be"), "filter");
  assert.equal(detectIntent("switch"), "filter");
});
