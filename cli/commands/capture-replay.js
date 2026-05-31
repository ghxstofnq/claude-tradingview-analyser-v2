import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';
import { parseIctEngineTable, findIctEngineRows } from '../lib/ict-engine-parser.js';
import {
  buildReplayCapturePlan,
  captureReplayBundle,
  filterBarsForPullWindow,
  writeReplayBundleAtomic,
} from '../lib/real-session-replay-capture.js';

const TF_SETTLE_MS = 500;

class TradingViewReplayCaptureAdapter {
  async setSymbol(symbol) {
    await chart.setSymbol({ symbol });
  }

  async captureTimeframe(pull, plan) {
    await chart.setTimeframe({ timeframe: pull.tv_resolution });
    await sleep(TF_SETTLE_MS);

    // Best effort: center/zoom the chart on the requested window before reading
    // the in-memory main-series bars. If TradingView has not loaded enough
    // historical bars, validation will fail rather than creating false proof.
    try {
      await chart.scrollToDate({ date: pull.role === 'entry_window' ? plan.as_of_utc : pull.to_utc });
      await chart.setVisibleRange({ from: pull.from_utc_unix, to: pull.to_utc_unix });
      await sleep(TF_SETTLE_MS);
    } catch {
      // Capture proceeds and validation reports missing bars/TFs if range load failed.
    }

    const [history, tables] = await Promise.all([
      fetchTradingViewHistory(plan.symbol, pull),
      data.getPineTables(),
    ]);
    const bars = {
      success: true,
      symbol: plan.symbol,
      tv_resolution: pull.tv_resolution,
      requested_window: pull,
      bars: filterBarsForPullWindow(history.rows, pull),
      raw_count: history.rows.length,
      raw_first_time: history.rows[0]?.time ?? null,
      raw_last_time: history.rows.at(-1)?.time ?? null,
      source: 'tradingview-websocket-history',
    };
    return {
      bars,
      engine: parseIctEngineTable(findIctEngineRows(tables)),
    };
  }
}

async function fetchTradingViewHistory(symbol, pull) {
  const count = historyCountForPull(pull);
  const session = `cs_${Math.random().toString(36).slice(2, 14)}`;
  const url = 'wss://data.tradingview.com/socket.io/websocket';
  const rows = await new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Origin: 'https://www.tradingview.com', 'User-Agent': 'Mozilla/5.0' },
    });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out fetching TradingView history for ${symbol} ${pull.tv_resolution}`));
    }, 20000);

    ws.on('open', () => {
      sendTv(ws, 'set_auth_token', ['unauthorized_user_token']);
      sendTv(ws, 'chart_create_session', [session, '']);
      sendTv(ws, 'resolve_symbol', [session, 'symbol_1', `=${JSON.stringify({ symbol, adjustment: 'splits', session: 'extended' })}`]);
      sendTv(ws, 'create_series', [session, 's1', 's1', 'symbol_1', pull.tv_resolution, count, '']);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on('message', (data) => {
      for (const msg of parseTvMessages(data)) {
        if (msg.m === 'symbol_error' || msg.m === 'series_error' || msg.m === 'critical_error') {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`TradingView history error for ${symbol} ${pull.tv_resolution}: ${JSON.stringify(msg.p)}`));
          return;
        }
        if (msg.m === 'timescale_update') {
          const series = msg.p?.[1]?.s1;
          if (Array.isArray(series?.s) && series.s.length > 0) {
            clearTimeout(timer);
            ws.close();
            resolve(series.s.map((row) => normalizeTvBar(row.v)));
            return;
          }
        }
      }
    });
  });
  return { rows };
}

function historyCountForPull(pull) {
  if (pull.tv_resolution === '1') return 5000;
  if (pull.tv_resolution === '5') return 2000;
  if (pull.tv_resolution === '15') return 1500;
  if (pull.tv_resolution === '60') return 1000;
  if (pull.tv_resolution === '240') return 800;
  return 500;
}

function normalizeTvBar(values) {
  return {
    time: values[0],
    open: values[1],
    high: values[2],
    low: values[3],
    close: values[4],
    volume: values[5] ?? null,
  };
}

function sendTv(ws, method, params) {
  const payload = JSON.stringify({ m: method, p: params });
  ws.send(`~m~${payload.length}~m~${payload}`);
}

function parseTvMessages(data) {
  const text = String(data);
  const messages = [];
  let i = 0;
  while (i < text.length) {
    const marker = text.indexOf('~m~', i);
    if (marker === -1) break;
    const lenStart = marker + 3;
    const lenEnd = text.indexOf('~m~', lenStart);
    if (lenEnd === -1) break;
    const len = Number(text.slice(lenStart, lenEnd));
    const start = lenEnd + 3;
    const payload = text.slice(start, start + len);
    try { messages.push(JSON.parse(payload)); } catch {}
    i = start + len;
  }
  return messages;
}

register('capture-replay', {
  description: 'Capture GXNQ no-lookahead replay data from TradingView for D1/H4/H1/15M/5M context and 15M/5M/1M NY AM replay',
  options: {
    label: { type: 'string', short: 'l', description: 'Path to gxofnq.real-session-label.v1 JSON' },
    symbol: { type: 'string', short: 's', description: 'TradingView symbol override (default: label.contract_hint)' },
    date: { type: 'string', short: 'd', description: 'Trade date YYYY-MM-DD (default: label.trade_date)' },
    'as-of': { type: 'string', description: 'Decision as-of ET timestamp/time (default: label expected entry)' },
    'context-start': { type: 'string', description: 'Context start ET HH:MM (default 09:30)' },
    'entry-end': { type: 'string', description: 'Entry replay end ET HH:MM (default 12:00)' },
    out: { type: 'string', short: 'o', description: 'Output bundle JSON path' },
    force: { type: 'boolean', short: 'f', description: 'Write even when validation is not replay-ready' },
  },
  handler: async (opts) => {
    const label = opts.label ? JSON.parse(readFileSync(opts.label, 'utf8')) : null;
    const plan = buildReplayCapturePlan({
      label,
      symbol: opts.symbol,
      tradeDate: opts.date,
      contextStart: opts['context-start'] || '09:30',
      entryWindowEnd: opts['entry-end'] || '12:00',
      asOf: opts['as-of'],
    });
    const bundle = await captureReplayBundle({
      label,
      plan,
      adapter: new TradingViewReplayCaptureAdapter(),
    });

    if (opts.out) {
      const write = writeReplayBundleAtomic(opts.out, bundle, plan, { force: opts.force });
      return {
        success: true,
        out: opts.out,
        plan: summarizePlan(plan),
        validation: write.validation,
      };
    }
    return bundle;
  },
});

function summarizePlan(plan) {
  return {
    symbol: plan.symbol,
    trade_date: plan.trade_date,
    context_start_et: plan.context_start_et,
    as_of_et: plan.as_of_et,
    entry_window_end_et: plan.entry_window_end_et,
    pulls: plan.pulls.map((p) => ({ role: p.role, key: p.key, tv_resolution: p.tv_resolution })),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
