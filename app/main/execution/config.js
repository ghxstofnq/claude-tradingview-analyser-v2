// app/main/execution/config.js
// Execution state paths + the per-user paper account id. The account id is
// stable per TradingView user and only streams over the trading WS on order
// activity, so it's stored here (seeded from the M0 spike, self-healed from
// order acks) rather than re-discovered every launch. state/ is the repo's
// canonical state root (same as sessions.js REPO_ROOT).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const STATE_DIR = path.join(REPO_ROOT, "state");
export const TRADES_DIR = path.join(STATE_DIR, "trades");
const CONFIG_PATH = path.join(STATE_DIR, "execution-config.json");

export function readExecConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

export function writeExecConfig(patch) {
  const next = { ...readExecConfig(), ...patch };
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function paperAccountId() {
  const v = readExecConfig().paperAccountId;
  return v != null ? String(v) : null;
}

// Self-heal: when an order ack reveals the account id, persist it.
export function rememberAccountId(id) {
  if (id != null && String(id) !== String(readExecConfig().paperAccountId)) {
    writeExecConfig({ paperAccountId: String(id) });
  }
}
