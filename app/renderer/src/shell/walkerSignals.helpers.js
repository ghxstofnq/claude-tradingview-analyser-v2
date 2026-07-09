// walkerSignals — pure classification of walker/packet transitions into named
// audio/notification signals. Fed by consecutive deterministic:packet truths
// (app/main/bar-close.js); stage vocabulary from
// app/main/strategy/walkers/walker-state.js. No arithmetic beyond counting —
// every number in a signal's text is read verbatim from the packet.
//
// Signal kinds, in priority order (one bar can raise several):
//   packet_fired      — truth.bestPacket present on a new bar (loud + notify)
//   confirmed         — a walker crossed into `confirmed`
//   awaiting_confirm  — a walker crossed into `confirmation_pending`
//   zone_tapped       — a walker crossed into `tap_seen`
//   walker_died       — a walker went `blocked` / `expired`
//   walker_spawned    — a new active walker appeared
// Bulk collapse: >BULK_MAX spawns (or deaths) in one bar fold into a single
// `_bulk` signal — June sessions have run 60+ walkers; a chime storm would get
// the feature muted on day one.

const STAGE_ORDER = [
  "watching", "pd_identified", "tap_seen", "confirmation_pending",
  "confirmed", "packet_ready", "blocked", "expired",
];
const TERMINAL = new Set(["packet_ready", "blocked", "expired"]);
const DEAD = new Set(["blocked", "expired"]);

export const BULK_MAX = 3;

// Per-walker stage-crossing signals, highest first. `packet_ready` is excluded
// — the packet itself is the signal for that crossing.
const STAGE_SIGNALS = [
  ["confirmed", "confirmed"],
  ["confirmation_pending", "awaiting_confirm"],
  ["tap_seen", "zone_tapped"],
];

const PRIORITY = [
  "packet_fired", "confirmed", "awaiting_confirm", "zone_tapped",
  "walker_died", "walker_died_bulk", "walker_spawned", "walker_spawned_bulk",
];

const idx = (stage) => STAGE_ORDER.indexOf(stage);

function walkerLabel(w) {
  return [w?.model, w?.side].filter(Boolean).join(" ") || "walker";
}

// prevWalkers/walkers: truth.walkers arrays of consecutive bars.
// hadPacket: whether the packet on THIS truth was already signaled (caller
// tracks by eventTimeUtc — re-folds of the same bar must not re-chime).
export function classifyWalkerTransitions({ prevWalkers = [], truth = {}, packetAlreadySignaled = false } = {}) {
  const prev = new Map((prevWalkers ?? []).map((w) => [w?.id, w]));
  const signals = [];
  const spawned = [];
  const died = [];

  for (const w of truth?.walkers ?? []) {
    if (!w?.id) continue;
    const before = prev.get(w.id);
    if (!before) {
      if (!TERMINAL.has(w.stage)) spawned.push(w);
      continue;
    }
    const from = idx(before.stage);
    const to = idx(w.stage);
    if (to === from) continue;
    if (DEAD.has(w.stage)) { died.push(w); continue; }
    // Highest crossed threshold only — a same-candle tap-and-close walker that
    // jumps watching→confirmed raises one `confirmed`, not three chimes.
    for (const [stage, kind] of STAGE_SIGNALS) {
      const th = idx(stage);
      if (to >= th && from < th) {
        signals.push({ kind, walker: { id: w.id, model: w.model, side: w.side, stage: w.stage } });
        break;
      }
    }
  }

  if (spawned.length > BULK_MAX) {
    signals.push({ kind: "walker_spawned_bulk", count: spawned.length });
  } else {
    for (const w of spawned) signals.push({ kind: "walker_spawned", walker: { id: w.id, model: w.model, side: w.side, stage: w.stage } });
  }
  if (died.length > BULK_MAX) {
    signals.push({ kind: "walker_died_bulk", count: died.length });
  } else {
    for (const w of died) signals.push({ kind: "walker_died", walker: { id: w.id, model: w.model, side: w.side, stage: w.stage } });
  }

  const p = truth?.bestPacket;
  if (p && !packetAlreadySignaled) {
    signals.push({
      kind: "packet_fired",
      packet: {
        model: p.model ?? null, side: p.side ?? null, grade: p.grade ?? null,
        entry: p.entry?.price ?? null, stop: p.stop?.price ?? null,
        tp1: p.tp1?.price ?? null, market: truth.market ?? null,
      },
    });
  }

  signals.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  return signals;
}

// Human line for toasts/notifications. Numbers verbatim from the packet.
export function describeSignal(sig) {
  switch (sig?.kind) {
    case "packet_fired": {
      const p = sig.packet ?? {};
      const head = [p.market, p.model, p.side, p.grade].filter(Boolean).join(" ");
      const nums = [
        p.entry != null ? `entry ${p.entry}` : null,
        p.stop != null ? `stop ${p.stop}` : null,
        p.tp1 != null ? `tp1 ${p.tp1}` : null,
      ].filter(Boolean).join(" · ");
      return `PACKET — ${head}${nums ? ` — ${nums}` : ""}`;
    }
    case "confirmed": return `${walkerLabel(sig.walker)} — confirmed`;
    case "awaiting_confirm": return `${walkerLabel(sig.walker)} — tapped, awaiting 1m confirm`;
    case "zone_tapped": return `${walkerLabel(sig.walker)} — zone tapped`;
    case "walker_died": return `${walkerLabel(sig.walker)} — invalidated`;
    case "walker_spawned": return `${walkerLabel(sig.walker)} — now walking`;
    case "walker_spawned_bulk": return `${sig.count} walkers spawned`;
    case "walker_died_bulk": return `${sig.count} walkers invalidated`;
    default: return "walker update";
  }
}

// Which signals get which effect. Chime tiers: loud (packet), normal
// (progress toward entry), soft (housekeeping).
export function signalEffects(sig) {
  switch (sig?.kind) {
    case "packet_fired": return { chime: "loud", notify: true, toast: true };
    case "confirmed": return { chime: "normal", notify: false, toast: true };
    case "awaiting_confirm": return { chime: "normal", notify: false, toast: true };
    case "zone_tapped": return { chime: "normal", notify: false, toast: false };
    case "walker_died": return { chime: "soft", notify: false, toast: false };
    case "walker_spawned": return { chime: "soft", notify: false, toast: false };
    case "walker_spawned_bulk": return { chime: "soft", notify: false, toast: false };
    case "walker_died_bulk": return { chime: "soft", notify: false, toast: false };
    default: return { chime: null, notify: false, toast: false };
  }
}
