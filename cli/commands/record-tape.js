import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';
import * as replay from '@tvmcp/core/replay';
import { parseIctEngineTable, findIctEngineRows } from '../lib/ict-engine-parser.js';
import { recordTape, tapeFromRecording, contextFromLabel } from '../lib/tape-recorder.js';

const SYMBOL_SETTLE_MS = 600;

register('record-tape', {
  description: 'Step TradingView bar replay across a historical session and record a per-bar walker day-tape (ICT Engine recomputed at every bar). Output feeds the day-tape gate after hand-grading.',
  options: {
    label: { type: 'string', short: 'l', description: 'Path to a gxofnq.real-session-label.v1 JSON (provides date, symbol, session context, expected)' },
    from: { type: 'string', description: 'Recording start ET HH:MM (default 09:30)' },
    to: { type: 'string', description: 'Recording end ET HH:MM (default 12:00 — prefer a tight window; ~3-5s per bar)' },
    out: { type: 'string', short: 'o', description: 'Output tape path (default tests/tapes/<date>-<session>-replay.tape.json)' },
  },
  handler: async (opts) => {
    if (!opts?.label) throw new Error('--label <path> is required');
    const label = JSON.parse(readFileSync(opts.label, 'utf8'));
    const context = contextFromLabel(label);

    // Pin the chart to the label's symbol at 1m before starting replay.
    const symbol = String(label.contract_hint ?? label.symbol).replace(/^[A-Z_]+:/, '');
    const state = await chart.getState();
    if (state.symbol.replace(/^[A-Z_]+:/, '') !== symbol) {
      await chart.setSymbol({ symbol });
      await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
    }
    if (state.resolution !== '1') {
      await chart.setTimeframe({ timeframe: '1' });
      await new Promise((r) => setTimeout(r, SYMBOL_SETTLE_MS));
    }

    const recording = await recordTape({
      label,
      fromEt: opts.from || '09:30',
      toEt: opts.to || '12:00',
      deps: {
        startReplay: (args) => replay.start(args),
        stepReplay: () => replay.step(),
        stopReplay: () => replay.stop(),
        readBars: () => data.getOhlcv({ summary: true }),
        readEngine: async () => parseIctEngineTable(findIctEngineRows(await data.getPineTables())),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      },
    });

    const tape = tapeFromRecording({ label, entries: recording.entries });
    const out = opts.out || path.resolve('tests', 'tapes', `${tape.fixture}.tape.json`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(tape, null, 2)}\n`, 'utf8');
    return {
      success: true,
      out,
      session: context.session,
      bars: recording.entries.length,
      first_event: recording.entries[0]?.event?.ts ?? null,
      last_event: recording.entries[recording.entries.length - 1]?.event?.ts ?? null,
      warnings: recording.warnings,
      note: 'Tape lands verified:false. Run npm run tapes to fold it through the walker chain, hand-grade the outcome, then flip verified:true.',
    };
  },
});
