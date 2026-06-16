import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 12000;
const POLL_INTERVAL = 250;
const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

// One round-trip health probe of the chart's DATA SERIES — not the quote feed.
// The quote keeps ticking even when the chart pane is wedged on "This symbol
// doesn't exist" (the quote feed and the chart series are separate), so a live
// quote is useless as a wedge signal. We read the main series' bar count and
// the current resolution straight off the chart model, and check for the
// error-screen text. `ok` means: real bars present AND no error screen.
export async function chartHealth() {
  return await evaluate(`
    (function(){
      var out = { ok:false, symbolDoesntExist:false, hasBars:false, barCount:0, resolution:null, symbol:null };
      try { out.symbolDoesntExist = /symbol doesn't exist|symbol does not exist/i.test((document.body && document.body.innerText) || ''); } catch(e){}
      try {
        var chart = ${CHART_API};
        out.resolution = chart.resolution();
        out.symbol = chart.symbol();
        var bars = chart._chartWidget.model().mainSeries().bars();
        var first = bars.firstIndex(), last = bars.lastIndex();
        if (typeof first === 'number' && typeof last === 'number' && last >= first) {
          out.hasBars = true;
          out.barCount = last - first + 1;
        }
      } catch(e){ out.error = String(e).slice(0,100); }
      out.ok = out.hasBars && !out.symbolDoesntExist;
      return out;
    })()
  `);
}

// Block until the chart's data series is genuinely healthy at the requested
// symbol/resolution before returning — the SETTLE-VERIFY GATE. "Healthy" =
// real bars loaded, no "symbol doesn't exist" screen, resolution/symbol match,
// AND the bar count stable across two reads (mid-switch the series briefly
// holds the previous TF's bars). Returning only when the chart has finished
// loading is what prevents the next switch from racing the data-series rebind
// — the accumulating-corruption wedge confirmed 2026-06-16 (fast back-to-back
// switches wedged; the same switches paced did not). On a genuine wedge it
// returns false after the timeout so the caller can recover.
export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  const wantSymbol = expectedSymbol ? expectedSymbol.toUpperCase().replace(/^[A-Z_]+:/, '') : null;
  let lastBarCount = -1;
  let stable = 0;

  while (Date.now() - start < timeout) {
    let h = null;
    try { h = await chartHealth(); } catch { /* transient eval failure — retry */ }

    const resolutionOk = !expectedTf || String(h?.resolution) === String(expectedTf);
    const symbolOk = !wantSymbol || (h?.symbol || '').toUpperCase().includes(wantSymbol);

    if (h && h.ok && resolutionOk && symbolOk) {
      if (h.barCount === lastBarCount) stable += 1; else stable = 0;
      lastBarCount = h.barCount;
      if (stable >= 2) return true;   // two consecutive matching healthy reads = settled
    } else {
      stable = 0;
      lastBarCount = -1;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — caller should treat false as "verify / recover".
  return false;
}
