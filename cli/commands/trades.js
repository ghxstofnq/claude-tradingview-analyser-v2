import fs from "node:fs/promises";
import path from "node:path";
import { register } from "../router.js";
import { tickTrades, foldOpenTrades } from "../lib/trade-outcomes.js";

async function readEvents(sessionDir) {
  const file = path.join(sessionDir, "trades.jsonl");
  try {
    const txt = await fs.readFile(file, "utf8");
    return txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function tickCmd(opts) {
  const sessionDir = opts.session || process.env.SESSION_DIR;
  if (!sessionDir) {
    console.error("--session <dir> required (or set SESSION_DIR env var)");
    process.exit(2);
  }
  let bar;
  try {
    bar = JSON.parse(opts.bar || process.env.BAR || "{}");
  } catch (err) {
    console.error("--bar must be a JSON object with high/low/ts");
    process.exit(2);
  }
  const events = await readEvents(sessionDir);
  const open = foldOpenTrades(events);
  const { transitions, updated } = tickTrades(open, bar);

  const file = path.join(sessionDir, "trades.jsonl");
  for (const tr of transitions) {
    await fs.appendFile(file, JSON.stringify({ type: "outcome", ...tr }) + "\n", "utf8");
  }
  return { transitions, updated };
}

async function listCmd(opts) {
  const sessionDir = opts.session || process.env.SESSION_DIR;
  if (!sessionDir) {
    console.error("--session <dir> required");
    process.exit(2);
  }
  const events = await readEvents(sessionDir);
  return foldOpenTrades(events);
}

async function showCmd(opts) {
  const sessionDir = opts.session || process.env.SESSION_DIR;
  if (!sessionDir) {
    console.error("--session <dir> required");
    process.exit(2);
  }
  const id = opts.id;
  if (!id) {
    console.error("--id <trade-id> required");
    process.exit(2);
  }
  const events = await readEvents(sessionDir);
  return events.filter((e) => e.id === id);
}

register("trades", {
  description: "Trade tracking — tick outcomes, list open trades, show by id",
  subcommands: new Map([
    ["tick", {
      description: "Apply the latest bar to open trades; appends any transitions",
      options: {
        session: { type: "string", description: "Session dir (state/session/<date>/<session>)" },
        bar: { type: "string", description: "Bar JSON: {\"high\":N,\"low\":N,\"ts\":\"...\"}" },
      },
      handler: tickCmd,
    }],
    ["list", {
      description: "List currently open trades",
      options: {
        session: { type: "string" },
      },
      handler: listCmd,
    }],
    ["show", {
      description: "Show all events for a trade id",
      options: {
        session: { type: "string" },
        id: { type: "string" },
      },
      handler: showCmd,
    }],
  ]),
});
