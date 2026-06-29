import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inversionEntryValid } from '../app/main/strategy/walkers/inversion-lifecycle.js';

// Stage-G deterministic inversion gate (depth-in-leg → reversal needs a recent
// session-tier grab / continuation needs a swing-tier trend). Leg 29000–30000.
const NOW = Date.parse('2026-06-09T14:00:00.000Z');
const min = (m) => NOW - m * 60000;
const ctx = ({ sweeps = [], structuresSwing = [], legHigh = 30000, legLow = 29000, coherence }) => ({
  pillar2: { legHigh, legLow, coherence },
  pillar3: { sweeps, structuresSwing },
});

test('reversal (deep) VALID with a recent session-tier opposing grab', () => {
  const r = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(30) }] }),
    side: 'short', entryPrice: 29400, nowMs: NOW, // depth 60%
  });
  assert.equal(r.kind, 'reversal');
  assert.equal(r.valid, true);
});

test('reversal (deep) INVALID when the only grab is stale (overnight)', () => {
  const r = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'buy', target: 'AS.H', swept_ms: min(300) }] }),
    side: 'short', entryPrice: 29400, nowMs: NOW,
  });
  assert.equal(r.kind, 'reversal');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'reversal_no_recent_grab');
});

test('continuation (shallow) VALID with a swing-tier trend break', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss', tier: 'swing' }] }),
    side: 'short', entryPrice: 29900, nowMs: NOW, // depth 10%
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, true);
});

test('continuation (shallow) INVALID without a swing-tier trend', () => {
  const r = inversionEntryValid({
    // hasContext via a sweep, but no swing structure
    context: ctx({ sweeps: [{ side: 'buy', target: 'LO.H', swept_ms: min(20) }] }),
    side: 'short', entryPrice: 29900, nowMs: NOW,
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'continuation_no_swing_trend');
});

test('long mirror: reversal needs a recent sell-side grab', () => {
  const valid = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'sell', target: 'NYAM.L', swept_ms: min(15) }] }),
    side: 'long', entryPrice: 29600, nowMs: NOW, // depth 60%
  });
  assert.equal(valid.valid, true);
  const invalid = inversionEntryValid({
    context: ctx({ sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(15) }] }), // wrong side
    side: 'long', entryPrice: 29600, nowMs: NOW,
  });
  assert.equal(invalid.valid, false);
});

test('fail-open: no sweep AND no structure (minimal fixture) → valid', () => {
  const r = inversionEntryValid({ context: ctx({}), side: 'short', entryPrice: 29400, nowMs: NOW });
  assert.equal(r.kind, 'no_context');
  assert.equal(r.valid, true);
});

test('fail-open: unreadable leg extremes → valid', () => {
  const r = inversionEntryValid({
    context: { pillar2: {}, pillar3: { sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(10) }] } },
    side: 'short', entryPrice: 29400, nowMs: NOW,
  });
  assert.equal(r.valid, true);
});

test('continuation chop veto: low m15 coherence → invalid (G3)', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss' }], coherence: 0.1 }),
    side: 'short', entryPrice: 29900, nowMs: NOW, // shallow continuation
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'chop_low_coherence');
});

test('continuation: high coherence (clean trend) → valid', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss' }], coherence: 0.8 }),
    side: 'short', entryPrice: 29900, nowMs: NOW,
  });
  assert.equal(r.valid, true);
});

test('continuation: NULL coherence (no m15 bars) → valid, NOT chop (Number(null) guard)', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss' }], coherence: null }),
    side: 'short', entryPrice: 29900, nowMs: NOW,
  });
  assert.equal(r.valid, true, 'null coherence must fail-open, not read as 0/chop');
});

// Continuation = run WITH the CURRENT trend ("clear strong trend in price",
// Entry-Models 11:15). The current trend is set by the MOST-RECENT swing-tier
// break (by confirmed_ms), not any stale break still in the history list.
// 2026-06-24 ny-am: a bull continuation long fired one bar after a bear MSS
// because an old bull BOS still sat in structuresSwing.
test('continuation: most-recent swing-tier break AGAINST the trade direction → invalid (2026-06-24 ny-am bug)', () => {
  const r = inversionEntryValid({
    context: ctx({
      structuresSwing: [
        { dir: 'bull', event: 'bos', confirmed_ms: min(600) }, // stale bull
        { dir: 'bear', event: 'bos', confirmed_ms: min(30) },  // recent bear = current trend
      ],
      coherence: 0.8,
    }),
    side: 'long', entryPrice: 29100, nowMs: NOW, // shallow → continuation
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'continuation_trend_against');
});

test('continuation: most-recent swing-tier break WITH the trade direction → valid', () => {
  const r = inversionEntryValid({
    context: ctx({
      structuresSwing: [
        { dir: 'bear', event: 'bos', confirmed_ms: min(600) }, // stale bear
        { dir: 'bull', event: 'mss', confirmed_ms: min(30) },  // recent bull = current trend
      ],
      coherence: 0.8,
    }),
    side: 'long', entryPrice: 29100, nowMs: NOW,
  });
  assert.equal(r.kind, 'continuation');
  assert.equal(r.valid, true);
});

test('GOFNQ_INV_GATE=0 disables the gate', () => {
  const prev = process.env.GOFNQ_INV_GATE;
  process.env.GOFNQ_INV_GATE = '0';
  try {
    const r = inversionEntryValid({ context: ctx({}), side: 'short', entryPrice: 29400, nowMs: NOW });
    assert.equal(r.valid, true);
    assert.equal(r.kind, 'disabled');
  } finally {
    if (prev === undefined) delete process.env.GOFNQ_INV_GATE; else process.env.GOFNQ_INV_GATE = prev;
  }
});

// Trend-aware override (2026-06-25), DEFAULT-OFF behind GOFNQ_INV_TREND_OVERRIDE.
// "Deep = reversal" is backwards in a trending leg: a DEEP entry with no reversal
// grab but an established CLEAN same-direction swing trend is a CONTINUATION (01-29
// 10:28 MES candidate: deep short 0.93, coherence 1.0, 5 bear breaks, no session-tier buy grab).
// Strictly additive on `valid` — it only rescues
// deep-no-grab entries the reversal branch would block, never removes a valid
// reversal. Gated off because it regresses the 06-16 oracle day (see lifecycle note).
function withOverride(fn) {
  const prev = process.env.GOFNQ_INV_TREND_OVERRIDE;
  process.env.GOFNQ_INV_TREND_OVERRIDE = '1';
  try { fn(); } finally {
    if (prev === undefined) delete process.env.GOFNQ_INV_TREND_OVERRIDE; else process.env.GOFNQ_INV_TREND_OVERRIDE = prev;
  }
}

test('override OFF (default): deep + clean trend + no grab stays blocked', () => {
  const r = inversionEntryValid({
    context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss', confirmed_ms: min(30) }], coherence: 1 }),
    side: 'short', entryPrice: 29400, nowMs: NOW,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'reversal_no_recent_grab');
});

test('override ON: deep + clean same-dir trend + NO grab → valid continuation_deep (01-29 10:28)', () => {
  withOverride(() => {
    const r = inversionEntryValid({
      context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss', confirmed_ms: min(30) }], coherence: 1 }),
      side: 'short', entryPrice: 29400, nowMs: NOW, // depth 0.6, sweeps empty → no grab
    });
    assert.equal(r.valid, true);
    assert.equal(r.kind, 'continuation_deep');
  });
});

test('override ON: deep + same-dir trend but CHOP (low coherence) + no grab → invalid (06-17)', () => {
  withOverride(() => {
    const r = inversionEntryValid({
      context: ctx({ structuresSwing: [{ dir: 'bear', event: 'mss', confirmed_ms: min(30) }], coherence: 0.1 }),
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, false);
  });
});

test('override ON: deep + NO swing trend + no grab → stays reversal_no_recent_grab', () => {
  withOverride(() => {
    const r = inversionEntryValid({
      context: ctx({ sweeps: [{ side: 'sell', target: 'LO.L', swept_ms: min(20) }] }),
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, false);
    assert.equal(r.kind, 'reversal');
    assert.equal(r.reason, 'reversal_no_recent_grab');
  });
});

test('override ON: deep + trend AGAINST (recent bull) + no grab → invalid', () => {
  withOverride(() => {
    const r = inversionEntryValid({
      context: ctx({ structuresSwing: [{ dir: 'bull', event: 'mss', confirmed_ms: min(20) }], coherence: 1 }),
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, false);
  });
});

test('override ON: deep + grab present is unchanged: valid reversal (never demotes)', () => {
  withOverride(() => {
    const r = inversionEntryValid({
      context: ctx({
        sweeps: [{ side: 'buy', target: 'NYAM.H', swept_ms: min(30) }],
        structuresSwing: [{ dir: 'bull', event: 'mss', confirmed_ms: min(10) }], // trend against, but grab wins
        coherence: 0.1,
      }),
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, true);
    assert.equal(r.kind, 'reversal');
  });
});

// Open-reaction gate (GOFNQ_INV_OPEN_GATE): suppress the override inside the first
// ~15 min of the ny-am session (§7 Step 4). This is the separator that recovers the
// 06-16 oracle (premature 09:32/09:40 fires) while keeping 01-29 (minute 58).
function withOpenGate(fn) {
  const a = process.env.GOFNQ_INV_TREND_OVERRIDE, b = process.env.GOFNQ_INV_OPEN_GATE;
  process.env.GOFNQ_INV_TREND_OVERRIDE = '1';
  process.env.GOFNQ_INV_OPEN_GATE = '1';
  try { fn(); } finally {
    if (a === undefined) delete process.env.GOFNQ_INV_TREND_OVERRIDE; else process.env.GOFNQ_INV_TREND_OVERRIDE = a;
    if (b === undefined) delete process.env.GOFNQ_INV_OPEN_GATE; else process.env.GOFNQ_INV_OPEN_GATE = b;
  }
}
const cohCtx = () => ctx({ structuresSwing: [{ dir: 'bear', event: 'mss', confirmed_ms: min(30) }], coherence: 1 });

test('open-gate ON: deep continuation INSIDE the open window (min 5) → suppressed', () => {
  withOpenGate(() => {
    const r = inversionEntryValid({
      context: { ...cohCtx(), eventTimeUtc: '2026-06-16T13:35:00.000Z' }, // 09:35 ET = min 5
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'reversal_no_recent_grab');
  });
});

test('open-gate ON: deep continuation PAST the open window (min 58) → fires (01-29 10:28)', () => {
  withOpenGate(() => {
    const r = inversionEntryValid({
      context: { ...cohCtx(), eventTimeUtc: '2026-06-16T14:28:00.000Z' }, // 10:28 ET = min 58
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, true);
    assert.equal(r.kind, 'continuation_deep');
  });
});

test('open-gate fail-open: unknown event time → does not suppress', () => {
  withOpenGate(() => {
    const r = inversionEntryValid({
      context: cohCtx(), // no eventTimeUtc
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(r.valid, true);
    assert.equal(r.kind, 'continuation_deep');
  });
});

// Internal-sweep grab (GOFNQ_INV_PATIENCE): a deep inversion with NO session-tier
// grab but a recent OPPOSING-side internal swing sweep is a valid reversal — the
// stop-anchoring internal-liquidity grab (06-15: Lanto's long after the 10:14 dip
// swept an internal low). Naturally blocks premature entries (no recent sweep yet).
test('GOFNQ_INV_PATIENCE: deep + recent opposing internal sweep → valid reversal', () => {
  const prev = process.env.GOFNQ_INV_PATIENCE;
  process.env.GOFNQ_INV_PATIENCE = '1';
  try {
    const r = inversionEntryValid({
      context: ctx({
        sweeps: [{ side: 'sell', target: 'LO.L', swept_ms: min(20) }], // no session-tier BUY grab for the short
        // recent swept internal HIGH = the opposing (buyside) grab for a short
        legHigh: 30000, legLow: 29000,
      }),
      side: 'short', entryPrice: 29400, nowMs: NOW, // depth 0.6 → reversal branch
    });
    // ctx() has no internalSwings → no internal grab → still blocked (proves the guard)
    assert.equal(r.valid, false);
    assert.equal(r.reason, 'reversal_no_recent_grab');

    const withSweep = inversionEntryValid({
      context: {
        pillar2: { legHigh: 30000, legLow: 29000 },
        pillar3: {
          sweeps: [{ side: 'sell', target: 'LO.L', swept_ms: min(20) }],
          internalSwings: [{ kind: 'LH', is_high: true, swept: true, swept_ms: min(10) }],
        },
      },
      side: 'short', entryPrice: 29400, nowMs: NOW,
    });
    assert.equal(withSweep.valid, true);
    assert.equal(withSweep.reason, 'internal_sweep_grab');
  } finally {
    if (prev === undefined) delete process.env.GOFNQ_INV_PATIENCE; else process.env.GOFNQ_INV_PATIENCE = prev;
  }
});

test('GOFNQ_INV_PATIENCE OFF (default): internal sweep grants NO grab', () => {
  const r = inversionEntryValid({
    context: {
      pillar2: { legHigh: 30000, legLow: 29000 },
      pillar3: {
        sweeps: [{ side: 'sell', target: 'LO.L', swept_ms: min(20) }],
        internalSwings: [{ kind: 'LH', is_high: true, swept: true, swept_ms: min(10) }],
      },
    },
    side: 'short', entryPrice: 29400, nowMs: NOW,
  });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'reversal_no_recent_grab');
});
