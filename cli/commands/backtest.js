// `tv backtest` — the agent-drivable command surface over the deterministic
// backtest engine. The GUI (BacktestPopover), scripts, and LLM agents all read
// the SAME fold, so there is one source of truth for "is the bot good enough?".
//
//   tv backtest verdict --symbol MNQ1!    the go-live gate (keystone output)
//   tv backtest fold    --symbol MNQ1!    the faithful baseline fold
//   tv backtest list    --symbol MNQ1!    the recorded corpus (audit)
//
// Every subcommand returns a plain object; the router prints it as JSON (the
// house convention), so output is always machine-readable. Deterministic + $0
// (no LLM, no chart) — safe for an agent to call in a loop. `compare` (fold-test
// a code change vs baseline) and `record` (replay a session into the corpus) are
// the next subcommands; today they live in the GUI + scripts/fold-*.mjs.

import path from "node:path";
import { readFileSync } from "node:fs";
import { register } from "../router.js";
import { foldSymbol } from "../../app/main/backtest-baseline.js";

const DEFAULT_SYMBOL = "MNQ1!";
// Trusted-window floor: below this the corpus is too thin to green-light real
// money regardless of the R (end-goal: net-positive over a *trusted* window).
const DEFAULT_MIN_SESSIONS = 20;

function stateDir() {
  return process.env.GOFNQ_STATE_DIR || path.resolve("state");
}

// The go-live verdict from the faithful fold. Pure — same inputs, same answer.
export function computeVerdict({ cum_r, sessions, minSessions = DEFAULT_MIN_SESSIONS }) {
  if (!sessions) return { verdict: "NO_CORPUS", ready: false, reason: "no recorded runs — record a session first" };
  if (sessions < minSessions) return { verdict: "NEEDS_MORE_DATA", ready: false, reason: `${sessions}/${minSessions} sessions in the trusted window` };
  if (cum_r <= 0) return { verdict: "NOT_READY", ready: false, reason: `${cum_r >= 0 ? "+" : ""}${cum_r}R — not net-positive` };
  return { verdict: "NET_POSITIVE", ready: true, reason: `${cum_r >= 0 ? "+" : ""}${cum_r}R over ${sessions} sessions` };
}

async function foldOne(symbol) {
  const b = await foldSymbol({ symbol, stateDir: stateDir() });
  return {
    symbol,
    cum_r: b.total_r,
    sessions: b.corpus?.n_sessions ?? 0,
    dates: b.corpus?.dates ?? [],
    per_day: b.per_day ?? [],
    code_sha: b.code_sha,
    built_at: b.built_at,
  };
}

async function verdictCmd(opts) {
  const symbol = opts.symbol || DEFAULT_SYMBOL;
  const minSessions = opts.min ? Number(opts.min) : DEFAULT_MIN_SESSIONS;
  const f = await foldOne(symbol);
  const v = computeVerdict({ cum_r: f.cum_r, sessions: f.sessions, minSessions });
  return { symbol, cum_r: f.cum_r, sessions: f.sessions, min_sessions: minSessions, code_sha: f.code_sha, built_at: f.built_at, ...v };
}

async function foldCmd(opts) {
  return foldOne(opts.symbol || DEFAULT_SYMBOL);
}

function listCmd(opts) {
  const idxPath = path.join(stateDir(), "backtest", "index.json");
  let index;
  try { index = JSON.parse(readFileSync(idxPath, "utf8")); }
  catch { index = { runs: [] }; }
  const symbol = opts.symbol || null;
  const runs = (index.runs || [])
    .filter((r) => !symbol || r.symbol === symbol)
    .map((r) => ({ date: r.date, session: r.session, symbol: r.symbol, total_r: r.total_r ?? null, run_id: r.run_id }));
  return { symbol, count: runs.length, runs };
}

register("backtest", {
  description: "Deterministic backtest surface — go-live verdict, faithful fold, corpus (agent + GUI share it)",
  subcommands: new Map([
    ["verdict", {
      description: "Go-live gate: is the bot net-positive over a trusted window?",
      options: {
        symbol: { type: "string", description: "MNQ1! (default) or MES1!" },
        min: { type: "string", description: `Trusted-window session floor (default ${DEFAULT_MIN_SESSIONS})` },
      },
      handler: verdictCmd,
    }],
    ["fold", {
      description: "Fold the faithful baseline for a symbol — cum R + per-session",
      options: {
        symbol: { type: "string", description: "MNQ1! (default) or MES1!" },
      },
      handler: foldCmd,
    }],
    ["list", {
      description: "List the recorded corpus runs",
      options: {
        symbol: { type: "string", description: "Filter to a symbol" },
      },
      handler: listCmd,
    }],
  ]),
});
