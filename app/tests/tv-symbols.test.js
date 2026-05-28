import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chartUrl,
  tvSymbolFor,
  symbolsMatch,
  buildSyncChartSymbolScript,
} from "../renderer/src/tv-symbols.js";

test("dashboard TradingView URL maps workstation MNQ/MES symbols to futures contracts", () => {
  assert.equal(tvSymbolFor("MNQ1!"), "CME_MINI:MNQ1!");
  assert.equal(tvSymbolFor("MES1!"), "CME_MINI:MES1!");
  assert.equal(chartUrl("MNQ1!"), "https://www.tradingview.com/chart/?symbol=CME_MINI%3AMNQ1!");
});

test("symbol matcher accepts exchange differences but rejects stale restored charts", () => {
  assert.equal(symbolsMatch("CME_MINI_DL:MNQ1!", "CME_MINI:MNQ1!"), true);
  assert.equal(symbolsMatch("CME_MINI:MES1!", "CME_MINI:MES1!"), true);
  assert.equal(symbolsMatch("BATS:NFLX", "CME_MINI:MNQ1!"), false);
});

test("webview sync script targets the selected workstation futures symbol", () => {
  const script = buildSyncChartSymbolScript("MNQ1!");
  assert.match(script, /CME_MINI:MNQ1!/);
  assert.match(script, /setSymbol\(target/);
  assert.match(script, /chart_api_missing/);
});
