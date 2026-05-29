import { buildExecutionPacketForWalker } from './execution-packet.js';
import { runMssWalkerLifecycle } from './mss-lifecycle.js';
import { runTrendWalkerLifecycle } from './trend-lifecycle.js';
import { runInversionWalkerLifecycle } from './inversion-lifecycle.js';
import { runWalkerEngine } from './walker-engine.js';

function packetSort(a, b) {
  const gradeRank = { 'A+': 0, B: 1, 'no-trade': 9 };
  return (gradeRank[a.grade] ?? 8) - (gradeRank[b.grade] ?? 8);
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
  const mss = runMssWalkerLifecycle({ context, walkers });
  const trend = runTrendWalkerLifecycle({ context, walkers: mss.walkers });
  const inversion = runInversionWalkerLifecycle({ context, walkers: trend.walkers });
  const finalized = finalizeConfirmedWalkers({ context, walkers: inversion.walkers });
  const executablePackets = finalized.packets.filter((packet) => packet.status === 'executable').sort(packetSort);

  return {
    walkers: finalized.walkers,
    packets: finalized.packets,
    bestPacket: executablePackets[0] ?? null,
    finalVerdict: executablePackets.length > 0 ? 'manual_candidate' : 'no_trade',
    events: [...mss.events, ...trend.events, ...inversion.events, ...finalized.events],
  };
}
