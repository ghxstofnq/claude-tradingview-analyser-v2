import { register } from '../router.js';
import * as core from '@tvmcp/core/ui';

register('layout', {
  description: 'Layout tools (list, switch, save)',
  subcommands: new Map([
    ['list', {
      description: 'List saved chart layouts',
      handler: () => core.layoutList(),
    }],
    ['switch', {
      description: 'Switch to a saved layout by name or ID',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Layout name required. Usage: tv layout switch "My Layout"');
        return core.layoutSwitch({ name: positionals.join(' ') });
      },
    }],
    ['save', {
      description: 'Persist the current chart layout to the server (survives reload — run after a Pine deploy)',
      handler: () => core.saveChart(),
    }],
  ]),
});
