// Atomic JSON persistence used by the persist_* MCP tools.
// Pattern: write tmp -> rename. APFS guarantees same-filesystem rename atomicity
// (writers see either the old or the new file, never a torn write).
//
// We do NOT fsync the parent directory after rename. The dashboard's
// chokidar watcher fires on rename and the data round-trips to JSON every
// cycle, so a post-crash directory-entry replay would self-heal on next tick.
// If durability becomes load-bearing (e.g. a single write that must survive
// power loss), upgrade to write-file-atomic which fsyncs the parent dir.

import { promises as fs } from 'node:fs';

export async function atomicWriteJson(filePath, data) {
  const tmp = filePath + '.tmp';
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, filePath);
}

export async function safeReadJson(filePath, retries = 1) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    if (err.code === 'ENOENT' && retries > 0) {
      // 50ms gap covers the atomic rename window (tmp exists but rename hasn't completed)
      await new Promise((r) => setTimeout(r, 50));
      return safeReadJson(filePath, retries - 1);
    }
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
