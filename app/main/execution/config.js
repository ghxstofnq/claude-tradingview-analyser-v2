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

// Backtest-exact defaults. automationMode boots to "manual" (safest); the
// auto modes + risk knobs are opt-in via settings. guards mirror the renderer
// ticket defaults so auto-fire (no ticket) enforces the same gate.
export const DEFAULT_EXEC_CONFIG = {
  paperAccountId: null,
  automationMode: "manual",   // "manual" | "anchor-auto-adds" | "auto"
  maxAdds: 5,                 // SCALE_IN_MAX
  combinedCapUsd: null,       // null = no combined-position cap
  guards: { perTradeMax: 250, dailyLimit: 600, defaultRisk: 120 },
};

// Pure deep-merge of patch over base, with the `guards` sub-object merged
// (not replaced) so a partial guards patch keeps its siblings.
export function mergeExecConfig(base, patch) {
  const out = { ...base, ...patch };
  if (base?.guards || patch?.guards) out.guards = { ...(base?.guards || {}), ...(patch?.guards || {}) };
  return out;
}

function readRaw() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

export function readExecConfig() {
  return mergeExecConfig(DEFAULT_EXEC_CONFIG, readRaw());
}

export function writeExecConfig(patch) {
  const next = mergeExecConfig(readExecConfig(), patch);
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
