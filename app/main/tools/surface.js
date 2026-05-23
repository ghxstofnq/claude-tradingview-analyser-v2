// surface_setup / surface_no_trade — tools Claude calls to push structured
// output to the UI as a card. Main captures the call, persists to disk,
// and forwards to the renderer via the chat:tool_call IPC event.

import fs from "node:fs/promises";
import path from "node:path";
import { activeSessionDir } from "../sessions.js";

let _send = null;
export function setSurfaceSink(sendFn) { _send = sendFn; }

export async function surfaceSetup(payload) {
  const dir = await activeSessionDir();
  const file = path.join(dir, "setups.jsonl");
  const id = payload.id || `S-${Date.now().toString(36)}`;
  const record = { ...payload, id, ts: new Date().toISOString() };
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
  _send?.("chat:tool_call", { name: "surface_setup", payload: record });
  return { ok: true, id };
}

export async function surfaceNoTrade({ reason }) {
  _send?.("chat:tool_call", { name: "surface_no_trade", payload: { reason } });
  return { ok: true };
}
