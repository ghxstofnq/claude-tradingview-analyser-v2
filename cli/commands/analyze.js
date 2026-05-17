import { register } from '../router.js';
import * as chart from '@tvmcp/core/chart';
import * as data from '@tvmcp/core/data';

register('analyze', {
  description: 'Bundle current chart state, quote, OHLCV summary, indicator values, and Pine drawings into one JSON object for ICT analysis by Claude.',
  handler: async () => {
    const [
      state,
      visibleRange,
      quote,
      bars,
      indicatorValues,
      lines,
      labels,
      tables,
      boxes,
    ] = await Promise.all([
      chart.getState(),
      chart.getVisibleRange(),
      data.getQuote(),
      data.getOhlcv({ summary: true }),
      data.getStudyValues(),
      data.getPineLines({ verbose: false }),
      data.getPineLabels({ verbose: false }),
      data.getPineTables(),
      data.getPineBoxes({ verbose: false }),
    ]);

    return {
      timestamp: new Date().toISOString(),
      chart: state,
      visible_range: visibleRange,
      quote,
      bars,
      indicators: indicatorValues,
      pine: { lines, labels, tables, boxes },
    };
  },
});
