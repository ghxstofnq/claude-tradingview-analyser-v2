// Regression guard: tests (and any caller) must be able to redirect session
// state writes away from the LIVE state/session dir. A live NY-AM brief was
// clobbered by tests/brief-flow.test.js calling surfaceSessionBrief while
// briefDirFor ignored GOFNQ_BRIEF_DIR_OVERRIDE and wrote to the live folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const VALID_BRIEF = {
  session: "ny-am",
  symbol: "MNQ1!",
  brief: "isolation test",
  htf_bias: [{ tf: "DAILY", bias: "BULLISH", note: "n" }],
  key_levels: [{ name: "PDH", price: 1, state: "untaken" }],
  pillar_grade: "B",
  pillars: [
    { name: "Draw & Bias", status: "pass", elements: [{ name: "HTF bias", status: "pass" }] },
    { name: "Price-Action Quality", status: "weak", elements: [{ name: "range", status: "weak" }] },
  ],
  scenarios: [],
};

test("surfaceSessionBrief honors GOFNQ_BRIEF_DIR_OVERRIDE (writes to override, not live)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "brief-override-"));
  process.env.GOFNQ_BRIEF_DIR_OVERRIDE = tmp;
  try {
    const { surfaceSessionBrief } = await import("../app/main/tools/surface.js");
    const res = await surfaceSessionBrief({ ...VALID_BRIEF, ts: "2026-06-15T14:00:00Z" });
    assert.equal(res.ok, true);
    const f = path.join(tmp, "brief-MNQ1!.json");
    const exists = await fs.access(f).then(() => true).catch(() => false);
    assert.equal(exists, true, "brief must land in the override dir, not the live session dir");
  } finally {
    delete process.env.GOFNQ_BRIEF_DIR_OVERRIDE;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("activeSessionDir honors GOFNQ_STATE_DIR (redirects the whole state root)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "state-root-"));
  process.env.GOFNQ_STATE_DIR = tmp;
  try {
    const { activeSessionDir } = await import("../app/main/sessions.js");
    const dir = await activeSessionDir();
    assert.ok(dir.startsWith(tmp), `expected session dir under ${tmp}, got ${dir}`);
  } finally {
    delete process.env.GOFNQ_STATE_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
