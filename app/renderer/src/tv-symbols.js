const TV_SYMBOL_MAP = {
  "MNQ1!": "CME_MINI:MNQ1!",
  "MES1!": "CME_MINI:MES1!",
  "MYM1!": "CME_MINI:MYM1!",
  "M2K1!": "CME_MINI:M2K1!",
  "MGC1!": "COMEX_MINI:MGC1!",
  "MCL1!": "NYMEX_MINI:MCL1!",
};

function tvSymbolFor(symbol) {
  return TV_SYMBOL_MAP[symbol] || TV_SYMBOL_MAP["MNQ1!"];
}

function chartUrl(symbol) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbolFor(symbol))}`;
}

function bareSymbol(symbol) {
  return String(symbol || "").replace(/^[A-Z_]+:/, "");
}

function symbolsMatch(actual, expected) {
  if (!actual || !expected) return false;
  const a = String(actual);
  const e = String(expected);
  return a === e || bareSymbol(a) === bareSymbol(e);
}

function buildSyncChartSymbolScript(symbol) {
  const target = tvSymbolFor(symbol);
  return `
    (function() {
      const target = ${JSON.stringify(target)};
      function readChart() {
        try {
          return window.TradingViewApi &&
            window.TradingViewApi._activeChartWidgetWV &&
            window.TradingViewApi._activeChartWidgetWV.value &&
            window.TradingViewApi._activeChartWidgetWV.value();
        } catch (e) { return null; }
      }
      function bare(s) { return String(s || '').replace(/^[A-Z_]+:/, ''); }
      function matches(actual, expected) {
        return actual === expected || bare(actual) === bare(expected);
      }
      return new Promise((resolve) => {
        const chart = readChart();
        if (!chart || typeof chart.symbol !== 'function' || typeof chart.setSymbol !== 'function') {
          resolve({ ok: false, reason: 'chart_api_missing', target });
          return;
        }
        const before = chart.symbol();
        if (matches(before, target)) {
          resolve({ ok: true, changed: false, before, after: before, target });
          return;
        }
        chart.setSymbol(target, {});
        setTimeout(() => {
          let after = null;
          try { after = chart.symbol(); } catch (e) {}
          resolve({ ok: matches(after, target), changed: true, before, after, target });
        }, 900);
      });
    })()
  `;
}

export { TV_SYMBOL_MAP, tvSymbolFor, chartUrl, bareSymbol, symbolsMatch, buildSyncChartSymbolScript };
