// state-retention.js — sweepOldSessions deletes folders older than 30d.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SANDBOX = path.join(REPO_ROOT, "tests", ".tmp-retention");

describe("state-retention — sweepOldSessions", () => {
  before(async () => {
    await fs.rm(SANDBOX, { recursive: true, force: true });
    await fs.mkdir(path.join(SANDBOX, "state", "session"), { recursive: true });
  });
  after(async () => {
    await fs.rm(SANDBOX, { recursive: true, force: true });
  });

  it("deletes folders older than 30 days, keeps recent + non-date folders", async () => {
    const root = path.join(SANDBOX, "state", "session");
    const yyyymmdd = (d) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const old = yyyymmdd(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));   // 60d ago
    const recent = yyyymmdd(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)); // 5d ago
    await fs.mkdir(path.join(root, old), { recursive: true });
    await fs.mkdir(path.join(root, recent), { recursive: true });
    await fs.mkdir(path.join(root, "not-a-date"), { recursive: true });
    await fs.writeFile(path.join(root, "loose-file.txt"), "x");

    const { sweepOldSessions } = await import("../app/main/state-retention.js");
    const result = await sweepOldSessions(SANDBOX);

    assert.equal(result.deleted, 1, "old folder should be deleted");
    assert.ok(result.kept >= 1, "recent folder should be kept");

    const entries = await fs.readdir(root);
    assert.equal(entries.includes(old), false, "old folder should be gone");
    assert.equal(entries.includes(recent), true, "recent folder should remain");
    assert.equal(entries.includes("not-a-date"), true, "non-date folder ignored");
  });

  it("no-ops when state/session is missing", async () => {
    const empty = path.join(SANDBOX, "empty");
    await fs.mkdir(empty, { recursive: true });
    const { sweepOldSessions } = await import("../app/main/state-retention.js");
    const result = await sweepOldSessions(empty);
    assert.deepEqual(result, { deleted: 0, kept: 0 });
  });
});
