// Walker engine — pure function composing kill, advance, spawn, cap, proof.
// Spec: docs/superpowers/specs/2026-05-28-walker-engine-and-claude-md-slim-design.md

import { detectIgnitions } from './walker-spawn.js';
import { evaluateAdvance, evaluateKill } from './walker-evaluate.js';
import { enforceCap } from './walker-cap.js';
import { computeSizeMultiplier } from './walker-sizing.js';

export function tickWalkers({ prev, gates, bars, rules, calendar, memory, history, suppression }) {
  const now = Date.now();
  const triggers = [];
  let walkers = (prev?.walkers ?? []).slice();
  const supp = suppression ?? { activeTradeSide: null };

  // 1. Kill pass — drop walkers that no longer apply.
  walkers = walkers.filter((w) => {
    const k = evaluateKill(w, { ...gates, calendar }, bars);
    if (k.kill) {
      triggers.push({ ts: now, walker_id: w.id, stage: w.stage, outcome: 'killed', reason: k.reason });
      return false;
    }
    return true;
  });

  // 2. Advance pass — walk each walker as far as evidence supports on this
  // bar. Loop until stage stops changing or trigger fires. One closed bar
  // can advance multiple stages (e.g. retrace_pending → confirmation →
  // trigger when a bar wicks into the FVG and closes above CE in one move).
  // Safety: cap loop at the longest stage chain length (6) to prevent any
  // future evaluator from looping forever.
  walkers = walkers.map((w) => {
    let cur = w;
    let lastHyp = null;
    for (let i = 0; i < 6; i++) {
      const adv = evaluateAdvance(cur, gates, bars);
      if (adv.stage === cur.stage) {
        if (adv.hypothetical_r_to_stop != null || adv.hypothetical_r_to_tp1 != null) {
          lastHyp = { hypothetical_r_to_stop: adv.hypothetical_r_to_stop, hypothetical_r_to_tp1: adv.hypothetical_r_to_tp1 };
        }
        break;
      }
      cur = { ...cur, stage: adv.stage, last_advanced_at: now, last_evaluated_at: now };
      if (adv.stage === 'trigger' && adv.setup) {
        const { factor, reason } = computeSizeMultiplier({
          model: cur.model, history, userMax: rules?.max_risk_per_trade, autoSizing: rules?.walker_auto_sizing,
        });
        const setup = { ...adv.setup, size_multiplier: factor };
        cur.size_multiplier = factor;
        cur.size_reason = reason;
        cur.entry = adv.setup.entry;
        cur.stop = adv.setup.stop;
        cur.tp1 = adv.setup.tp1;
        cur.tp2 = adv.setup.tp2;
        triggers.push({ ts: now, walker_id: cur.id, stage: 'confirmation', outcome: 'fired', setup });
        break;
      }
    }
    if (lastHyp) cur = { ...cur, ...lastHyp };
    return cur;
  });

  // 3. Spawn pass — new walkers from ignition events.
  const newW = detectIgnitions({ gates, bars, prev: { walkers }, calendar, memory, suppression: supp });
  walkers = walkers.concat(newW);

  // 4. Cap pass — LIFO evict with stage protection.
  walkers = enforceCap(walkers, rules?.walker_max_live ?? 4);

  // 5. Update proof markers (bookkeeping for mid-bar wake guard).
  const m1Last = bars?.m1?.[bars.m1.length - 1];
  const m5Last = bars?.m5?.[bars.m5.length - 1];
  const proof = {
    last_1m_close: m1Last?.ts_ms ?? prev?.proof?.last_1m_close ?? null,
    last_5m_close: m5Last?.ts_ms ?? prev?.proof?.last_5m_close ?? null,
  };

  return {
    next: {
      session: prev?.session,
      walkers,
      triggers: (prev?.triggers ?? []).concat(triggers),
      proof,
    },
    triggers,
  };
}
