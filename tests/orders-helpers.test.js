// tests/orders-helpers.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDrawOption, formatStopSource, routingLabel, blockMessage, orderResultToast } from "../app/renderer/src/Orders.helpers.js";

describe("orderResultToast", () => {
  const ctx = { side: "buy", contracts: 3, symbol: "MES1!" };
  it("success only when the broker confirms (ok:true)", () => {
    assert.equal(orderResultToast({ ok: true, broker: "paper" }, ctx), "ORDER SENT · BUY 3c MES1!");
  });
  it("guard/route block → BLOCKED with the mapped reason", () => {
    assert.match(orderResultToast({ ok: false, blocked: true, code: "no_stop" }, ctx), /^BLOCKED · No stop/);
  });
  it("broker rejection (non-200, not blocked) → ORDER FAILED, not SENT", () => {
    const t = orderResultToast({ ok: false, broker: "paper", result: { ok: false, status: 400, body: "bad" } }, ctx);
    assert.match(t, /^ORDER FAILED/);
    assert.match(t, /400/);
  });
  it("thrown/transport error → ORDER FAILED with the error text", () => {
    assert.match(orderResultToast({ ok: false, error: "fetch failed" }, ctx), /^ORDER FAILED · fetch failed/);
  });
});

describe("orders helpers", () => {
  it("formatDrawOption: name · price · R", () => {
    assert.equal(formatDrawOption({ name: "NYAM.H", price: 21120, rr: 4 }), "NYAM.H · 21120 · 4R");
    assert.equal(formatDrawOption({ name: "EQH pool", price: 21150.25, rr: null }), "EQH pool · 21150.25");
  });
  it("formatStopSource maps kind to label", () => {
    assert.equal(formatStopSource("leg_low"), "leg low");
    assert.equal(formatStopSource("swing_high"), "swing high");
    assert.equal(formatStopSource("session_level_low"), "session level");
    assert.equal(formatStopSource("typed"), "typed");
    assert.equal(formatStopSource(null), "—");
  });
  it("routingLabel from account gate", () => {
    assert.equal(routingLabel({ confirmed: { id: "9256021", type: "paper" }, gate: { route: true } }), "paper · 9256021");
    assert.equal(routingLabel({ confirmed: null, gate: { route: false, needsConfirm: true } }), "confirm account");
    assert.equal(routingLabel({ confirmed: { id: "1", type: "live" }, gate: { route: false } }), "live blocked");
  });
  it("routingLabel surfaces a pending Tradovate switch by name", () => {
    assert.equal(
      routingLabel({ active: { id: "D54476869", type: "live", broker: "tradovate" }, confirmed: { id: "9256021", type: "paper" }, gate: { needsConfirm: true } }),
      "confirm Tradovate · D54476869",
    );
    assert.equal(
      routingLabel({ confirmed: { id: "D54476869", type: "live", broker: "tradovate" }, gate: { route: true } }),
      "tradovate · D54476869",
    );
  });
  it("blockMessage is human", () => {
    assert.match(blockMessage("no_stop"), /stop/i);
    assert.match(blockMessage("stop_wrong_side"), /side/i);
    assert.match(blockMessage("no_size"), /size|\$50/i);
    assert.equal(blockMessage(null), "");
  });
});

// ── chooser rows (refined BUY/SELL ticket, 2026-07-10) ──────────────────────
import { stopChooserRows, tpChooserRows, stopTag, parseInstantStop, packetTicketSeed } from "../app/renderer/src/Orders.helpers.js";

const PREVIEW = {
  entry: 21000,
  tpDefault: 21051,
  stopOptions: [
    { kind: "fvg_c1", name: "1/3 FVG 20980–20990", levelPrice: 20975, stopPrice: 20974.5 },
    { kind: "fvg_c2", name: "2/3 FVG 20980–20990", levelPrice: 20984, stopPrice: 20983.5 },
    { kind: "swing_low", name: "swing low", levelPrice: 20940, stopPrice: 20939.5 },
    { kind: "session_level_low", name: "NYAM.L", levelPrice: 20900, stopPrice: 20899.5 },
  ],
  tpDraws: [
    { name: "NYAM.H", price: 21120, kind: "session_level", rr: 4.7 },
    { name: "eqh", price: 21150, kind: "eqh", rr: 5.9 },
  ],
};

describe("stopChooserRows", () => {
  it("untouched ticket selects the default (first) row; rows carry tag/label/pts", () => {
    const { rows, customSel } = stopChooserRows(PREVIEW, "");
    assert.equal(customSel, false);
    assert.deepEqual(rows.map((r) => [r.tag, r.sel]), [["1/3 FVG", true], ["2/3 FVG", false], ["SL", false], ["session", false]]);
    assert.equal(rows[0].label, "20980–20990"); // zone bounds, tag stripped
    assert.equal(rows[0].pts, 25.5);
    assert.equal(rows[0].value, ""); // default row writes "" → placement re-derives fresh
    assert.equal(rows[3].label, "NYAM.L");
  });
  it("typed price matching an option selects that row; unknown price selects custom", () => {
    const a = stopChooserRows(PREVIEW, "20939.5");
    assert.equal(a.rows.find((r) => r.sel).tag, "SL");
    const b = stopChooserRows(PREVIEW, "20955");
    assert.equal(b.rows.some((r) => r.sel), false);
    assert.equal(b.customSel, true);
  });
});

describe("tpChooserRows", () => {
  it("1:2 default first + tagged draws; untouched selects the default", () => {
    const { rows } = tpChooserRows(PREVIEW, "");
    assert.deepEqual(rows.map((r) => [r.tag, r.sel]), [["1:2", true], ["session", false], ["pool", false]]);
    assert.equal(rows[0].price, 21051);
    assert.equal(rows[0].rr, 2);
  });
  it("picking a draw selects it; custom otherwise; no tpDefault → no 1:2 row", () => {
    assert.equal(tpChooserRows(PREVIEW, "21120").rows.find((r) => r.sel).label, "NYAM.H");
    assert.equal(tpChooserRows(PREVIEW, "21500").customSel, true);
    assert.equal(tpChooserRows({ ...PREVIEW, tpDefault: null }, "").rows.some((r) => r.tag === "1:2"), false);
  });
});

describe("stopTag", () => {
  it("maps every stop kind to its display tag", () => {
    assert.equal(stopTag("fvg_c1"), "1/3 FVG");
    assert.equal(stopTag("swing_high"), "SH");
    assert.equal(stopTag("leg_low"), "leg");
    assert.equal(stopTag("mystery"), "mystery");
  });
});

describe("iFVG chooser labels (2026-07-10)", () => {
  it("ifvg kinds tag as 1/3–2/3 iFVG and strip the tag from the zone label", () => {
    const preview = {
      entry: 21000, tpDefault: 21051, tpDraws: [],
      stopOptions: [
        { kind: "ifvg_c1", name: "1/3 iFVG 20990–20995", levelPrice: 20990, stopPrice: 20989.5 },
        { kind: "ifvg_c2", name: "2/3 iFVG 20990–20995", levelPrice: 20984, stopPrice: 20983.5 },
        { kind: "swing_low", name: "swing low", levelPrice: 20940, stopPrice: 20939.5 },
      ],
    };
    const { rows } = stopChooserRows(preview, "");
    assert.deepEqual(rows.map((r) => [r.tag, r.label, r.sel]),
      [["1/3 iFVG", "20990–20995", true], ["2/3 iFVG", "20990–20995", false], ["SL", "swing low", false]]);
  });
});

describe("parseInstantStop (instant-SL quick order, 2026-07-10)", () => {
  it("empty → popup mode; valid price → instant with parsed stop", () => {
    assert.deepEqual(parseInstantStop(""), { mode: "popup" });
    assert.deepEqual(parseInstantStop("  "), { mode: "popup" });
    assert.deepEqual(parseInstantStop(" 29910.25 "), { mode: "instant", stop: 29910.25 });
  });
  it("junk and non-positive values are invalid — never guessed into a stop", () => {
    assert.equal(parseInstantStop("abc").mode, "invalid");
    assert.equal(parseInstantStop("29,910").mode, "invalid"); // thousands separator isn't a number
    assert.equal(parseInstantStop("-5").mode, "invalid");
    assert.equal(parseInstantStop("0").mode, "invalid");
  });
});

describe("packetTicketSeed (one-key packet ticket, 2026-07-09 Task 4)", () => {
  it("maps a fired packet to buy/sell + exact typed stop/tp strings", () => {
    const seed = packetTicketSeed({ market: "MNQ1!", model: "Inversion", side: "short", grade: "B", entry: 29691, stop: 29811.75, tp1: 29302.5 });
    assert.deepEqual(seed, { side: "sell", stop: "29811.75", tp: "29302.5", label: "MNQ1! Inversion short B" });
  });
  it("long maps to buy; missing prices stay empty (ticket defaults take over)", () => {
    const seed = packetTicketSeed({ side: "long", model: "MSS" });
    assert.equal(seed.side, "buy");
    assert.equal(seed.stop, "");
    assert.equal(seed.tp, "");
  });
  it("null / unknown side → null (no ticket to open)", () => {
    assert.equal(packetTicketSeed(null), null);
    assert.equal(packetTicketSeed({ side: "flat" }), null);
  });
});
