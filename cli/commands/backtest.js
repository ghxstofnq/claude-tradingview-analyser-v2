import { readFileSync } from "node:fs";
import path from "node:path";

import { register } from "../router.js";
import { collectBacktestReadiness, DEFAULT_SYMBOL, defaultStateDir, validateBacktestSymbol } from "../lib/backtest-readiness.js";
import { approveReadiness, verifyReadinessTests } from "../lib/backtest-readiness-actions.js";
import { DEFAULT_MIN_SESSIONS } from "../lib/backtest-verdict.js";
import { certifyCorpus } from "../lib/corpus-certification.js";
import { foldSymbol } from "../../app/main/backtest-baseline.js";

async function foldOne(symbol) {
  const normalized = validateBacktestSymbol(symbol || DEFAULT_SYMBOL);
  const baseline = await foldSymbol({ symbol: normalized, stateDir: defaultStateDir() });
  return {
    symbol: normalized,
    cum_r: baseline.total_r,
    sessions: baseline.corpus?.n_sessions ?? 0,
    dates: baseline.corpus?.dates ?? [],
    per_day: baseline.per_day ?? [],
    code_sha: baseline.code_sha,
  };
}

async function verdictCmd(opts) {
  const minSessions = opts.min == null ? DEFAULT_MIN_SESSIONS : Number(opts.min);
  if (!Number.isInteger(minSessions) || minSessions <= 0) {
    throw new Error("--min must be a positive integer");
  }
  const readiness = await collectBacktestReadiness({
    symbol: opts.symbol || DEFAULT_SYMBOL,
    stateDir: defaultStateDir(),
    cwd: process.cwd(),
    env: process.env,
    minSessions,
  });
  if (!readiness.ready) process.exitCode = 1;
  return readiness;
}

async function foldCmd(opts) {
  return foldOne(opts.symbol || DEFAULT_SYMBOL);
}

function listCmd(opts) {
  const idxPath = path.join(defaultStateDir(), "backtest", "index.json");
  let index;
  try {
    index = JSON.parse(readFileSync(idxPath, "utf8"));
  } catch {
    index = { runs: [] };
  }
  const symbol = opts.symbol ? validateBacktestSymbol(opts.symbol) : null;
  const runs = (index.runs || [])
    .filter((r) => !symbol || r.symbol === symbol)
    .map((r) => ({
      date: r.date,
      session: r.session,
      symbol: r.symbol,
      total_r: r.total_r ?? null,
      run_id: r.run_id,
    }));
  return { symbol, count: runs.length, runs };
}

function certifyCmd() {
  const report = certifyCorpus({ stateDir: defaultStateDir() });
  if (report.certified === false) process.exitCode = 1;
  return report;
}

async function verifyTestsCmd() {
  const result = await verifyReadinessTests({
    stateDir: defaultStateDir(),
    cwd: process.cwd(),
    env: process.env,
  });
  if (!result.ok) process.exitCode = result.exitCode || 1;
  return result;
}

async function approveCmd(opts) {
  const result = await approveReadiness({
    stateDir: defaultStateDir(),
    cwd: process.cwd(),
    env: process.env,
    symbol: opts.symbol || DEFAULT_SYMBOL,
    strategyReview: opts["strategy-review"],
    userWindowApproved: opts["user-window-approved"] === true,
    note: opts.note || "",
  });
  return result;
}

register("backtest", {
  description: "Deterministic backtest surface go-live readiness, faithful fold, corpus (agent + GUI share it)",
  subcommands: new Map([
    ["verdict", {
      description: "Fail-closed go-live readiness object for current symbol",
      options: {
        symbol: { type: "string", description: "MNQ1! (default) or MES1!" },
        min: { type: "string", description: `Trusted-window session floor (default ${DEFAULT_MIN_SESSIONS})` },
      },
      handler: verdictCmd,
    }],
    ["verify-tests", {
      description: "Run broad repository tests and write current-code test evidence on success",
      options: {},
      handler: verifyTestsCmd,
    }],
    ["approve", {
      description: "Write explicit readiness approval for current manifest/selection/code/levers",
      options: {
        symbol: { type: "string", description: "MNQ1! (default) or MES1!" },
        "strategy-review": { type: "string", description: "Must be approved or rejected" },
        "user-window-approved": { type: "boolean", description: "Required explicit user trading-window approval" },
        note: { type: "string", description: "Audit note" },
      },
      handler: approveCmd,
    }],
    ["fold", {
      description: "Fold faithful baseline symbol cum R + per-session",
      options: {
        symbol: { type: "string", description: "MNQ1! (default) or MES1!" },
      },
      handler: foldCmd,
    }],
    ["list", {
      description: "List recorded corpus runs",
      options: {
        symbol: { type: "string", description: "Filter symbol" },
      },
      handler: listCmd,
    }],
    ["certify", {
      description: "Certify gate corpus 2026-H1 manifest (deterministic coverage parity, fails closed)",
      options: {},
      handler: certifyCmd,
    }],
  ]),
});

export const __test = {
  approveCmd,
  certifyCmd,
  foldCmd,
  listCmd,
  verdictCmd,
  verifyTestsCmd,
};
