import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ipcSource = readFileSync(new URL('../app/main/ipc.js', import.meta.url), 'utf8');

test('LIVE popover detector:start must enter live mode before starting detector', () => {
  const startHandler = ipcSource.match(/ipcMain\.handle\("detector:start", async \(\) => \{([\s\S]*?)\n  \}\);/)?.[1] ?? '';

  assert.match(startHandler, /setMode\("live"\)/);
  assert.ok(startHandler.indexOf('setMode("live")') < startHandler.indexOf('startDetector({ send })'));
});

test('LIVE popover detector:stop must leave live mode so bar-close turns stay gated', () => {
  const stopHandler = ipcSource.match(/ipcMain\.handle\("detector:stop", async \(\) => \{([\s\S]*?)\n  \}\);/)?.[1] ?? '';

  assert.match(stopHandler, /setMode\("prep"\)/);
});
