/**
 * Core streaming logic — real-time JSONL output from TradingView.
 * Uses efficient poll + dedup: only emits when data changes.
 */
import { evaluate } from './connection.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ET date helper for state/session/<YYYY-MM-DD>/ paths.
function nowETDate() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // en-CA gives YYYY-MM-DD
}

const HEARTBEAT_PATH = 'state/session/detector-heartbeat.json';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
const MODEL = `${CHART_API}._chartWidget.model()`;

/**
 * Generic poll-and-diff loop.
 * Calls fetcher(), compares to last value, emits JSONL on change.
 * Writes to stdout directly for pipe-friendliness.
 */
async function pollLoop(fetcher, { interval = 500, dedupe = true, label = 'stream' } = {}) {
  let lastHash = null;
  let running = true;

  const cleanup = () => { running = false; };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Emit header with compliance notice
  const start = Date.now();
  process.stderr.write(`\u26A0  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n`);
  process.stderr.write(`   Streams from your locally running TradingView Desktop instance only.\n`);
  process.stderr.write(`   Does not connect to TradingView servers. Requires --remote-debugging-port=9223.\n`);
  process.stderr.write(`   Ensure your usage complies with TradingView's Terms of Use.\n`);
  process.stderr.write(`[stream:${label}] started, interval=${interval}ms, Ctrl+C to stop\n`);

  while (running) {
    try {
      const data = await fetcher();
      if (!data) { await sleep(interval); continue; }

      const hash = dedupe ? JSON.stringify(data) : null;
      if (!dedupe || hash !== lastHash) {
        lastHash = hash;
        const line = JSON.stringify({ ...data, _ts: Date.now(), _stream: label });
        process.stdout.write(line + '\n');
      }
    } catch (err) {
      // Connection errors — retry silently
      if (/CDP|ECONNREFUSED/i.test(err.message)) {
        await sleep(2000);
        continue;
      }
      process.stderr.write(`[stream:${label}] error: ${err.message}\n`);
    }
    await sleep(interval);
  }

  process.stderr.write(`[stream:${label}] stopped after ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Stream: quote ──

async function fetchQuote() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
      };
    })()
  `);
}

export async function streamQuote({ interval } = {}) {
  return pollLoop(fetchQuote, { interval: interval || 300, label: 'quote' });
}

// ── Stream: ohlcv (last N bars, emits on new bar) ──

async function fetchLastBar() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var last = bars.lastIndex();
      var v = bars.valueAt(last);
      if (!v) return null;
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        bar_time: v[0],
        open: v[1],
        high: v[2],
        low: v[3],
        close: v[4],
        volume: v[5] || 0,
        bar_index: last,
      };
    })()
  `);
}

export async function streamBars({ interval } = {}) {
  return pollLoop(fetchLastBar, { interval: interval || 500, label: 'bars' });
}

// ── Stream: bar-close (time-aligned; emits one event per closed bar) ──

/**
 * Fetch the current bar AND the previous bar in one CDP call. Used by
 * streamBarClose — when we detect the bar.time has advanced, we emit using
 * `previous` (the actual just-closed bar with its final OHLC).
 */
async function fetchLastTwoBars() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var bars = m.mainSeries().bars();
      var lastIdx = bars.lastIndex();
      var cur = bars.valueAt(lastIdx);
      if (!cur) return null;
      var prev = lastIdx > 0 ? bars.valueAt(lastIdx - 1) : null;
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        current:  { bar_time: cur[0],  open: cur[1],  high: cur[2],  low: cur[3],  close: cur[4],  volume: cur[5]  || 0 },
        previous: prev ? { bar_time: prev[0], open: prev[1], high: prev[2], low: prev[3], close: prev[4], volume: prev[5] || 0 } : null,
      };
    })()
  `);
}

/**
 * Bar-close detector. Wall-clock-driven: emits ONE event per minute boundary,
 * regardless of the chart's display TF. This way Claude runs every minute
 * (with 5m closes flagged) even when the user / Claude has the chart on
 * another TF for analysis.
 *
 * Event schema:
 *   {
 *     kind: "bar_close",
 *     tf: "1m",                          // logical tick TF — always 1m here
 *     ts: <ISO string>,                  // wall-clock minute boundary
 *     symbol: "CME_MINI:MNQ1!",
 *     chart_tf: "1" | "5" | ...,         // chart's display TF, diagnostic only
 *     ohlc: { open, high, low, close, volume },   // chart's latest bar (running or closed)
 *     bar_open_time:  <unix sec>,        // OPEN of the reported bar
 *     bar_close_time: <unix sec>,        // when chart's TF bar will close (== current.bar_time)
 *     is_new_bar: true|false,            // chart's TF bar JUST closed at this tick
 *     is_5m_close: true|false,           // wall-clock 5m boundary (xx:00, xx:05, xx:10, ...)
 *     _ts: <epoch ms at emit>,
 *   }
 *
 * Designed for the LLM-driven session pattern (docs/plans/llm-driven-session.md):
 * pipe into the Claude Code `Monitor` tool; each line becomes a notification
 * the LLM reacts to with phase-aware /analyze. Handler-side semantics:
 * tickOpenTrades runs every minute (running ohlc fine for TP/SL hit detection);
 * appendBarLog only runs when is_new_bar (no duplicate rows for in-progress bars).
 */
export async function streamBarClose() {
  let lastSeenBarTime = null;
  let running = true;
  const startedAt = new Date().toISOString();
  let lastEventAt = null;
  let lastBar = null;

  const cleanup = () => { running = false; };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Heartbeat writer — the dashboard + main-process health monitor use this
  // to verify the detector is alive and to show what bar / TF it's tracking.
  // Updated every ~5s during sleep (not just at state transitions) so the
  // health monitor's >30s STALE threshold doesn't false-alarm.
  function writeHeartbeat(state) {
    try {
      mkdirSync(dirname(HEARTBEAT_PATH), { recursive: true });
      writeFileSync(HEARTBEAT_PATH, JSON.stringify({
        pid: process.pid,
        started_at: startedAt,
        last_heartbeat: new Date().toISOString(),
        last_event_at: lastEventAt,
        last_bar_time: lastSeenBarTime,
        last_bar_close: lastBar,
        current_state: state,  // "sleeping_to_boundary" | "polling_for_close" | "emitted"
      }, null, 2));
    } catch (e) { /* best-effort */ }
  }

  // Persist bar-close events to a per-day JSONL (in addition to stdout).
  function persistEvent(event) {
    try {
      const path = `state/session/${nowETDate()}/bar-close-events.jsonl`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(event) + '\n', { flag: 'a' });
    } catch (e) { /* best-effort */ }
  }

  // Heartbeat cadence during the sleep-to-boundary phase. Health monitor
  // flags STALE at >30s; 5s gives plenty of margin.
  const SLEEP_HEARTBEAT_MS = 5000;

  process.stderr.write(`⚠  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n`);
  process.stderr.write(`   Streams from your locally running TradingView Desktop instance only.\n`);
  process.stderr.write(`[stream:bar-close] started. Wall-clock minute ticking — emits every minute regardless of chart TF.\n`);
  process.stderr.write(`[stream:bar-close] heartbeat -> ${HEARTBEAT_PATH}; events -> state/session/<today>/bar-close-events.jsonl\n`);
  process.stderr.write(`[stream:bar-close] Ctrl+C to stop.\n`);
  writeHeartbeat('starting');

  while (running) {
    try {
      // Sleep until the next wall-clock minute boundary + 250ms grace (let TV
      // commit the close tick after the boundary). Tick the heartbeat every
      // ~5s during sleep so the health monitor keeps seeing a fresh detector.
      const targetMs = Math.ceil((Date.now() + 100) / 60_000) * 60_000 + 250;
      while (running && Date.now() < targetMs) {
        writeHeartbeat('sleeping_to_boundary');
        const remaining = targetMs - Date.now();
        await sleep(Math.min(SLEEP_HEARTBEAT_MS, remaining));
      }
      if (!running) break;

      writeHeartbeat('polling_for_close');
      // Poll fast for ~3s to catch the new bar appearing on the chart's TF
      // (only relevant when chart is on 1m — for higher TFs, the bar most
      // likely hasn't closed at this minute boundary, and is_new_bar=false).
      let data = null;
      let isNewBar = false;
      for (let i = 0; i < 30 && running; i++) {
        const fetched = await fetchLastTwoBars();
        if (!fetched) { await sleep(100); continue; }
        data = fetched;
        if (lastSeenBarTime !== null && fetched.current.bar_time !== lastSeenBarTime) {
          isNewBar = true;
          break;
        }
        await sleep(100);
      }
      if (!data) continue;  // poll never returned data — skip this tick

      // First poll — establish baseline and don't emit (no previous to
      // compare against; downstream "is_new_bar" would be misleading).
      if (lastSeenBarTime === null) {
        lastSeenBarTime = data.current.bar_time;
        process.stderr.write(`[stream:bar-close] tracking baseline bar_time=${lastSeenBarTime} (chart_tf=${data.resolution})\n`);
        continue;
      }

      // Choose which bar to report: the just-closed one (when chart's TF
      // bar actually rolled over) or the in-progress current bar (when chart
      // is on a higher TF and no new bar appeared this minute).
      const reportedBar = isNewBar && data.previous && data.previous.bar_time === lastSeenBarTime
        ? data.previous
        : data.current;

      // Wall-clock 5m boundary: derive from the minute boundary that just
      // passed, not from chart bar timestamps. The detector ticks every
      // minute regardless of chart TF, so this is the source of truth.
      const boundaryUnix = Math.floor((targetMs - 250) / 60_000) * 60;
      const is5mClose = boundaryUnix % 300 === 0;

      const event = {
        kind: 'bar_close',
        tf: '1m',
        ts: new Date(boundaryUnix * 1000).toISOString(),
        symbol: data.symbol,
        chart_tf: data.resolution,
        ohlc: {
          open: reportedBar.open,
          high: reportedBar.high,
          low: reportedBar.low,
          close: reportedBar.close,
          volume: reportedBar.volume,
        },
        bar_open_time: reportedBar.bar_time,
        bar_close_time: data.current.bar_time,
        is_new_bar: isNewBar,
        is_5m_close: is5mClose,
        _ts: Date.now(),
      };

      process.stdout.write(JSON.stringify(event) + '\n');
      persistEvent(event);
      lastEventAt = new Date().toISOString();
      lastBar = { time: reportedBar.bar_time, close: reportedBar.close, chart_tf: data.resolution };
      if (isNewBar) lastSeenBarTime = data.current.bar_time;
      writeHeartbeat('emitted');
    } catch (err) {
      if (/CDP|ECONNREFUSED/i.test(err.message)) {
        await sleep(2000);
        continue;
      }
      process.stderr.write(`[stream:bar-close] error: ${err.message}\n`);
      await sleep(500);
    }
  }

  process.stderr.write(`[stream:bar-close] stopped\n`);
  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);
}

// ── Stream: indicator values ──

async function fetchValues() {
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = ${MODEL};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        try {
          var study = chart.getStudyById(studies[i].id);
          if (!study || !study.isVisible()) continue;
          var src = study._study || study;
          var data = src._lastBarValues || src._data;
          if (!data) continue;
          var vals = {};
          if (typeof data === 'object') {
            for (var k in data) {
              if (typeof data[k] === 'number' && !isNaN(data[k])) vals[k] = data[k];
            }
          }
          if (Object.keys(vals).length > 0) results.push({ name: studies[i].name, values: vals });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamValues({ interval } = {}) {
  return pollLoop(fetchValues, { interval: interval || 500, label: 'values' });
}

// ── Stream: pine lines ──

async function fetchLines(studyFilter) {
  const filter = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evaluate(`
    (function() {
      var filter = ${filter};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.dwglines) continue;
          var linesMap = pc.dwglines.get('lines');
          if (!linesMap) continue;
          var data = linesMap.get(false);
          if (!data || !data._primitivesDataById) continue;
          var levels = [];
          var seen = {};
          data._primitivesDataById.forEach(function(line) {
            var p1 = line.points && line.points[0] ? line.points[0].price : null;
            var p2 = line.points && line.points[1] ? line.points[1].price : null;
            var price = (p1 !== null && p1 === p2) ? p1 : (p1 || p2);
            if (price !== null && !seen[price]) { seen[price] = true; levels.push(price); }
          });
          levels.sort(function(a, b) { return b - a; });
          if (levels.length > 0) results.push({ study: s.name, levels: levels });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamLines({ interval, filter } = {}) {
  return pollLoop(() => fetchLines(filter), { interval: interval || 1000, label: 'lines' });
}

// ── Stream: pine labels ──

async function fetchLabels(studyFilter) {
  const filterStr = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evaluate(`
    (function() {
      var filter = ${filterStr};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.dwglabels) continue;
          var labelsMap = pc.dwglabels.get('labels');
          if (!labelsMap) continue;
          var data = labelsMap.get(false);
          if (!data || !data._primitivesDataById) continue;
          var labels = [];
          data._primitivesDataById.forEach(function(lbl) {
            var text = lbl.text || '';
            var price = lbl.points && lbl.points[0] ? lbl.points[0].price : null;
            if (text) labels.push({ text: text, price: price });
          });
          if (labels.length > 0) results.push({ study: s.name, labels: labels.slice(0, 50) });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamLabels({ interval, filter } = {}) {
  return pollLoop(() => fetchLabels(filter), { interval: interval || 1000, label: 'labels' });
}

// ── Stream: pine tables ──

async function fetchTables(studyFilter) {
  const filterStr = studyFilter ? JSON.stringify(studyFilter) : 'null';
  return evaluate(`
    (function() {
      var filter = ${filterStr};
      var chart = ${CHART_API};
      var studies = chart.getAllStudies();
      var results = [];
      for (var i = 0; i < studies.length; i++) {
        var s = studies[i];
        if (filter && (s.name || '').toLowerCase().indexOf(filter.toLowerCase()) === -1) continue;
        try {
          var study = chart.getStudyById(s.id);
          if (!study) continue;
          var src = study._study || study;
          var g = src._graphics || (src._source && src._source._graphics);
          if (!g) continue;
          var pc = g._primitivesCollection;
          if (!pc || !pc.ownFirstValue) continue;
          var tableMap = pc.ownFirstValue();
          if (!tableMap) continue;
          var tables = [];
          if (typeof tableMap.forEach === 'function') {
            tableMap.forEach(function(table) {
              if (!table || !table.data) return;
              var rows = [];
              for (var r = 0; r < table.data.length; r++) {
                var row = [];
                for (var c = 0; c < table.data[r].length; c++) {
                  row.push(table.data[r][c].text || '');
                }
                rows.push(row);
              }
              tables.push({ rows: rows });
            });
          }
          if (tables.length > 0) results.push({ study: s.name, tables: tables });
        } catch(e) {}
      }
      return { symbol: chart.symbol(), study_count: results.length, studies: results };
    })()
  `);
}

export async function streamTables({ interval, filter } = {}) {
  return pollLoop(() => fetchTables(filter), { interval: interval || 2000, label: 'tables' });
}

// ── Stream: all panes (multi-symbol) ──

const CWC = 'window.TradingViewApi._chartWidgetCollection';

async function fetchAllPanes() {
  return evaluate(`
    (function() {
      var cwc = ${CWC};
      var all = cwc.getAll();
      var layoutType = cwc._layoutType;
      if (typeof layoutType === 'object' && layoutType && typeof layoutType.value === 'function') layoutType = layoutType.value();
      var count = cwc.inlineChartsCount;
      if (typeof count === 'object' && count && typeof count.value === 'function') count = count.value();

      var panes = [];
      for (var i = 0; i < Math.min(all.length, count || all.length); i++) {
        try {
          var c = all[i];
          var model = c.model();
          var ms = model.mainSeries();
          var bars = ms.bars();
          var last = bars.lastIndex();
          var v = bars.valueAt(last);
          if (!v) { panes.push({ index: i, symbol: ms.symbol(), error: 'no bars' }); continue; }
          panes.push({
            index: i,
            symbol: ms.symbol(),
            resolution: ms.interval(),
            time: v[0],
            open: v[1],
            high: v[2],
            low: v[3],
            close: v[4],
            volume: v[5] || 0,
          });
        } catch(e) { panes.push({ index: i, error: e.message }); }
      }
      return { layout: layoutType, pane_count: panes.length, panes: panes };
    })()
  `);
}

export async function streamAllPanes({ interval } = {}) {
  return pollLoop(fetchAllPanes, { interval: interval || 500, label: 'all-panes' });
}
