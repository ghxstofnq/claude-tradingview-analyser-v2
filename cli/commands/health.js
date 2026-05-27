import { register } from '../router.js';
import * as core from '@tvmcp/core/health';

register('status', {
  description: 'Check CDP connection to TradingView',
  handler: () => core.healthCheck(),
});
