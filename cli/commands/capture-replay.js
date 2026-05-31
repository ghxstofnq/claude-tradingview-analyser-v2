import { readFileSync } from 'node:fs';

import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';
import { parseIctEngineTable, findIctEngineRows } from '../lib/ict-engine-parser.js';
import {
  buildReplayCapturePlan,
  captureReplayBundle,
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

    const [bars, tables] = await Promise.all([
      data.getOhlcv({ count: 500, summary: false }),
      data.getPineTables(),
    ]);
    return {
      bars: { ...bars, tv_resolution: pull.tv_resolution, requested_window: pull },
      engine: parseIctEngineTable(findIctEngineRows(tables)),
    };
  }
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
