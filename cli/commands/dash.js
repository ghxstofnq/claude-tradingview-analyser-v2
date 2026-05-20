import { register } from '../router.js';

/**
 * tv dash — registered here so `tv --help` lists it, but the actual
 * implementation is a Go binary (bubbletea + lipgloss) at bin/tv-dash.
 *
 * The shell wrapper at bin/tv intercepts `tv dash` BEFORE Node sees it
 * and `exec`s into bin/tv-dash directly. This is necessary because
 * bubbletea needs exclusive raw-mode TTY ownership, which fails when
 * launched as a Node child process (spawn loses the TTY).
 *
 * One-time setup:
 *   brew install go
 *   make dash
 */

register('dash', {
  description: 'Live oversight TUI (Go + bubbletea). Run via `./bin/tv dash` — the shell wrapper exec\'s into bin/tv-dash. Build with `make dash`.',
  options: {},
  handler: async () => {
    process.stderr.write(
      'Use `./bin/tv dash` (the shell wrapper) instead of invoking the Node CLI directly.\n' +
      'The shell `exec`s into bin/tv-dash so bubbletea can claim the TTY.\n',
    );
    process.exit(2);
  },
});
