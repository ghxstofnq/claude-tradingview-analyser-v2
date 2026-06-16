// session-levels.js — compute a HISTORY of session highs/lows (Asia / London /
// NY-AM / NY-PM) from raw candles, with NO lookahead.
//
// Why: the ICT engine only emits the MOST RECENT high/low per session type
// ("NYPM.H" = the latest PM high, overwritten every PM). So an old persistent
// draw — e.g. a PM high from 11 days ago that price still hasn't traded through
// — never reaches the targets. This recovers them deterministically. The level
// VALUE is a fixed historical fact (June 4 PM high = 30896 regardless of when
// you look); only "taken yet?" is time-dependent, and we judge it as of a given
// bar so the backtest is honest.
//
// Pure. ET windows mirror the Pine engine (SESS_* in pine/ict-engine.pine).
// Strategy §2.1 (session highs/lows are draws) + §7 Step 7 (TP toward HTF/
// session liquidity).

// NY-time session windows as minutes-of-day. Asia crosses midnight.
const WINDOWS = {
  asia: { start: 18 * 60, end: 3 * 60, crossesMidnight: true },
  london: { start: 3 * 60, end: 9 * 60 + 30 },
  ny_am: { start: 9 * 60 + 30, end: 12 * 60 },
  ny_pm: { start: 13 * 60, end: 16 * 60 },
};

function etParts(ms) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms));
  const g = (t) => f.find((p) => p.type === t)?.value;
  let hh = Number(g("hour"));
  if (hh === 24) hh = 0;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, minutes: hh * 60 + Number(g("minute")) };
}

function prevDate(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Which session a candle falls in + the "session day" key (the date the session
// STARTED — Asia before 03:00 ET belongs to the prior calendar day).
function classify(ms) {
  const { date, minutes } = etParts(ms);
  for (const [name, w] of Object.entries(WINDOWS)) {
    const inIt = w.crossesMidnight ? (minutes >= w.start || minutes < w.end) : (minutes >= w.start && minutes < w.end);
    if (inIt) {
      const sessionDay = w.crossesMidnight && minutes < w.end ? prevDate(date) : date;
      return { name, sessionDay, key: `${name}:${sessionDay}` };
    }
  }
  return null;
}

const TYPE_TAG = { asia: "AS", london: "LO", ny_am: "NYAM", ny_pm: "NYPM" };

/**
 * Group candles into per-session-instance high/low. Returns a map keyed by
 * "<type>:<sessionDay>" → { name, sessionDay, high, low, firstMs, lastMs }.
 * Candles: [{ time(sec), high, low }]. `time` is seconds (TV ohlcv) or ms.
 */
export function computeSessionHistory(candles = []) {
  const byKey = new Map();
  for (const c of candles) {
    const ms = Number(c?.time) < 1e12 ? Number(c?.time) * 1000 : Number(c?.time);
    const hi = Number(c?.high), lo = Number(c?.low);
    if (!Number.isFinite(ms) || !Number.isFinite(hi) || !Number.isFinite(lo)) continue;
    const cls = classify(ms);
    if (!cls) continue;
    const cur = byKey.get(cls.key);
    if (!cur) byKey.set(cls.key, { name: cls.name, sessionDay: cls.sessionDay, high: hi, low: lo, firstMs: ms, lastMs: ms });
    else {
      cur.high = Math.max(cur.high, hi);
      cur.low = Math.min(cur.low, lo);
      cur.firstMs = Math.min(cur.firstMs, ms);
      cur.lastMs = Math.max(cur.lastMs, ms);
    }
  }
  return byKey;
}

/**
 * Untaken session draws as of `asOfMs`. For a long we want session HIGHS above
 * `price` that price has not traded through since the session closed; mirror for
 * shorts. A session counts only if it completed before `asOfMs` (no lookahead),
 * i.e. it is not the session-instance containing asOfMs. `taken` is recomputed
 * from candles strictly after the session through asOfMs.
 *
 * @returns { above:[{name,price,sessionDay,tf?}], below:[...] }
 */
export function untakenSessionDraws(candles, { price, asOfMs, lookbackPerType = 8 } = {}) {
  const above = [], below = [];
  if (!Number.isFinite(price) || !Number.isFinite(asOfMs)) return { above, below };
  const byKey = computeSessionHistory(candles);
  const asOfKey = classify(asOfMs)?.key ?? null;
  // Candle highs/lows for swept recompute (only ≤ asOfMs).
  const norm = candles
    .map((c) => ({ ms: Number(c.time) < 1e12 ? Number(c.time) * 1000 : Number(c.time), high: Number(c.high), low: Number(c.low) }))
    .filter((c) => Number.isFinite(c.ms) && c.ms <= asOfMs)
    .sort((a, b) => a.ms - b.ms);

  const perType = {};
  for (const sess of [...byKey.values()].sort((a, b) => b.lastMs - a.lastMs)) {
    if (sess.key === asOfKey) continue;            // current/incomplete session — exclude
    if (sess.lastMs >= asOfMs) continue;           // hasn't closed by the test bar
    const tag = TYPE_TAG[sess.name] ?? sess.name;
    perType[sess.name] = (perType[sess.name] ?? 0) + 1;
    if (perType[sess.name] > lookbackPerType) continue;
    // High draw (for longs): above price + not taken since the session closed.
    if (sess.high > price) {
      const takenAfter = norm.some((c) => c.ms > sess.lastMs && c.high >= sess.high);
      if (!takenAfter) above.push({ name: `${tag}.H`, price: sess.high, sessionDay: sess.sessionDay, source: "session_draw", cite: "session_history" });
    }
    // Low draw (for shorts): below price + not taken since.
    if (sess.low < price) {
      const takenAfter = norm.some((c) => c.ms > sess.lastMs && c.low <= sess.low);
      if (!takenAfter) below.push({ name: `${tag}.L`, price: sess.low, sessionDay: sess.sessionDay, source: "session_draw", cite: "session_history" });
    }
  }
  above.sort((a, b) => a.price - b.price);          // nearest first
  below.sort((a, b) => b.price - a.price);
  return { above, below };
}

export const __test = { classify, computeSessionHistory, WINDOWS };
