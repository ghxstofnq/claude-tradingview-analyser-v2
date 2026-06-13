import { buildExecutionPacketForWalker } from './execution-packet.js';
import { runMssWalkerLifecycle } from './mss-lifecycle.js';
import { runTrendWalkerLifecycle } from './trend-lifecycle.js';
import { runInversionWalkerLifecycle } from './inversion-lifecycle.js';
import { runWalkerEngine } from './walker-engine.js';
import { killWalker } from './walker-kill.js';

// TS §7 Step 6: "Price taps your chosen PD array. Within 10–15 minutes, you
// get a strong 1m/5m close in your direction." EM MSS §5: "No trade if price
// wicks through and closes weak or chops inside the FVG for >10–15 minutes."
// A walker that tapped its zone but has not confirmed within this window is
// stale — it must not confirm on a much-later bar. Applies to the tap-wait
// stages (MSS/Trend); Inversion confirms on the violating close with no tap
// wait, so it has no tappedAtUtc and is unaffected.
const TAP_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1000;
const TAP_WAIT_STAGES = new Set(['tap_seen', 'confirmation_pending']);

function expireStaleTaps({ context, walkers }) {
  const nowMs = Date.parse(context?.eventTimeUtc);
  if (!Number.isFinite(nowMs)) return { walkers, events: [] };
  const events = [];
  const next = walkers.map((walker) => {
    if (!TAP_WAIT_STAGES.has(walker?.stage)) return walker;
    const tappedMs = Date.parse(walker?.tappedAtUtc);
    if (!Number.isFinite(tappedMs)) return walker;
    if (nowMs - tappedMs <= TAP_CONFIRMATION_TIMEOUT_MS) return walker;
    const killed = killWalker(walker, {
      eventTimeUtc: context?.eventTimeUtc,
      stage: 'expired',
      reason: 'tap_confirmation_timeout',
      evidenceRef: walker?.tapRef ?? null,
    });
    events.push({ type: 'walker_expired', walkerId: walker.id, reason: 'tap_confirmation_timeout' });
    return killed;
  });
  return { walkers: next, events };
}

// Grade first, then the open-reaction model priority (a preference, not a
// gate — resolver spec §3.4 "which model to walk first"), then Inversion
// before Trend: when one candle both inverts a zone and wick-taps another,
// the fresh violation IS the event being traded (GXNQ hand grade, June 9
// trade 3 — the 10:26 close). Insertion order must never decide.
function makePacketSort(context) {
  const gradeRank = { 'A+': 0, B: 1, 'no-trade': 9 };
  const modelRank = { inversion: 0, mss: 1, trend: 2 };
  const priority = String(context?.sessionChain?.entryModelPriority ?? '').toLowerCase();
  const priorityRank = (p) =>
    priority && !['undecided', 'unknown', 'none', ''].includes(priority)
      ? (String(p.model ?? '').toLowerCase() === priority ? 0 : 1)
      : 0;
  return (a, b) =>
    ((gradeRank[a.grade] ?? 8) - (gradeRank[b.grade] ?? 8)) ||
    (priorityRank(a) - priorityRank(b)) ||
    ((modelRank[String(a.model ?? '').toLowerCase()] ?? 8) - (modelRank[String(b.model ?? '').toLowerCase()] ?? 8));
}

function finalizeConfirmedWalkers({ context, walkers }) {
  const packets = [];
  const advanceRequests = [];
  const killRequests = [];

  for (const walker of walkers) {
    if (walker?.stage !== 'confirmed') continue;
    const packet = buildExecutionPacketForWalker({ context, walker });
    packets.push({ walkerId: walker.id, ...packet });
    if (packet.status === 'executable') {
      advanceRequests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        stage: 'packet_ready',
        evidenceRef: packet.entry?.evidenceRef ?? walker.confirmationRef,
        evidenceKey: 'executionPacket',
        rawPayload: packet,
      });
    } else {
      killRequests.push({
        id: walker.id,
        eventTimeUtc: context?.eventTimeUtc,
        reason: packet.blockers[0] ?? 'execution_packet_blocked',
        evidenceRef: packet.entry?.evidenceRef ?? walker.confirmationRef,
      });
    }
  }

  const advanced = runWalkerEngine({ context, walkers, advanceRequests });
  const killed = runWalkerEngine({ context, walkers: advanced.walkers, killRequests });
  return { walkers: killed.walkers, packets, events: [...advanced.events, ...killed.events] };
}

export function runDeterministicWalkerStrategy({ context, walkers = [] } = {}) {
  // Expire stale taps BEFORE the lifecycles run, so a tap that blew its 10–15
  // min confirmation window cannot confirm on the current (much later) bar.
  const expired = expireStaleTaps({ context, walkers });
  const mss = runMssWalkerLifecycle({ context, walkers: expired.walkers });
  const trend = runTrendWalkerLifecycle({ context, walkers: mss.walkers });
  const inversion = runInversionWalkerLifecycle({ context, walkers: trend.walkers });
  const finalized = finalizeConfirmedWalkers({ context, walkers: inversion.walkers });
  const executablePackets = finalized.packets.filter((packet) => packet.status === 'executable').sort(makePacketSort(context));

  return {
    walkers: finalized.walkers,
    packets: finalized.packets,
    bestPacket: executablePackets[0] ?? null,
    finalVerdict: executablePackets.length > 0 ? 'manual_candidate' : 'no_trade',
    events: [...expired.events, ...mss.events, ...trend.events, ...inversion.events, ...finalized.events],
  };
}
