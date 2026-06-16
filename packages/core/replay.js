/**
 * Core replay mode logic.
 */
import { evaluate, getReplayApi } from './connection.js';
import { waitForChartReady } from './wait.js';

function wv(path) {
  return `(function(){ var v = ${path}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
}

// Convert "YYYY-MM-DD" + "HH:MM" (ET wall clock) into an ISO UTC timestamp.
// DST-aware: probes whether ET is EDT (UTC-4) or EST (UTC-5) on that date.
// Without time, a bare date string is interpreted as midnight UTC by JS's
// Date constructor, which is 8 PM ET the prior day — useful for "set replay
// to the very start of date X UTC" but never what a trader means when they
// say "replay 2026-05-20".
export function etTimestampToIsoUtc(dateStr, timeStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const [hh, mm = 0] = String(timeStr).split(':').map(Number);
  if (![y, mo, d, hh, mm].every(n => Number.isFinite(n))) {
    throw new Error(`Invalid date/time for ET conversion: date='${dateStr}' time='${timeStr}'`);
  }
  // Trial 1: assume EDT (UTC-4). If the resulting UTC moment shows our
  // intended ET hour, we're done. Otherwise EST (UTC-5).
  const t1Ms = Date.UTC(y, mo - 1, d, hh + 4, mm);
  const etHourAtT1 = new Date(t1Ms).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  });
  if ((parseInt(etHourAtT1, 10) % 24) === hh) return new Date(t1Ms).toISOString();
  return new Date(Date.UTC(y, mo - 1, d, hh + 5, mm)).toISOString();
}

export async function start({ date, time } = {}) {
  const rp = await getReplayApi();
  const available = await evaluate(wv(`${rp}.isReplayAvailable()`));
  if (!available) throw new Error('Replay is not available for the current symbol/timeframe');

  await evaluate(`${rp}.showReplayToolbar()`);
  await new Promise(r => setTimeout(r, 500));

  if (date) {
    const tsArg = time ? etTimestampToIsoUtc(date, time) : date;
    await evaluate(`${rp}.selectDate(new Date('${tsArg}'))`);
  } else {
    await evaluate(`${rp}.selectFirstAvailableDate()`);
  }
  await new Promise(r => setTimeout(r, 1000));

  // Check for "Data point unavailable" toast which corrupts the chart
  const toast = await evaluate(`
    (function() {
      var toasts = document.querySelectorAll('[class*="toast"], [class*="notification"], [class*="banner"]');
      for (var i = 0; i < toasts.length; i++) {
        var text = toasts[i].textContent || '';
        if (/data point unavailable|not available for playback/i.test(text)) return text.trim().substring(0, 200);
      }
      return null;
    })()
  `);

  if (toast) {
    // Stop replay to recover chart
    try { await evaluate(`${rp}.stopReplay()`); } catch {}
    try { await evaluate(`${rp}.hideReplayToolbar()`); } catch {}
    throw new Error(`Replay date unavailable: "${toast}". The requested date has no data for this timeframe. Try a more recent date or switch to a higher timeframe (e.g., Daily).`);
  }

  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  // Settle-verify: don't return until the chart has actually loaded replay bars
  // (not wedged on "symbol doesn't exist"), so the caller's first read/switch
  // doesn't race the load. Non-fatal — a false here is surfaced via chart_ready.
  const chartReady = await waitForChartReady(null, null, 8000);
  const currentDate = await evaluate(wv(`${rp}.currentDate()`));
  return { success: true, replay_started: !!started, chart_ready: chartReady, date: date || '(first available)', current_date: currentDate };
}

export async function step() {
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  await evaluate(`${rp}.doStep()`);
  const currentDate = await evaluate(wv(`${rp}.currentDate()`));
  return { success: true, action: 'step', current_date: currentDate };
}

export async function autoplay({ speed } = {}) {
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  if (speed > 0) await evaluate(`${rp}.changeAutoplayDelay(${speed})`);
  await evaluate(`${rp}.toggleAutoplay()`);
  const isAutoplay = await evaluate(wv(`${rp}.isAutoplayStarted()`));
  const currentDelay = await evaluate(wv(`${rp}.autoplayDelay()`));
  return { success: true, autoplay_active: !!isAutoplay, delay_ms: currentDelay };
}

// Detect the "Leave current replay?" confirmation dialog and click its Leave
// button (one round-trip: detect + click). TV shows this dialog whenever you
// leave an active replay; if it isn't dismissed the chart stays bound to
// replay and the very next symbol/TF switch wedges into the "This symbol
// doesn't exist" data-session error. We never tick "Save this replay" — Leave
// discards it. Returns true if the dialog was present and Leave was clicked.
async function clickLeaveReplayDialog() {
  try {
    return !!(await evaluate(`
      (function() {
        var dlgs = document.querySelectorAll('[class*="dialog"]');
        var present = false;
        for (var d = 0; d < dlgs.length; d++) {
          if (/leave current replay/i.test(dlgs[d].textContent || '')) { present = true; break; }
        }
        if (!present) return false;
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if (/^Leave$/i.test((btns[i].textContent || '').trim())) { btns[i].click(); return true; }
        }
        return false;
      })()
    `));
  } catch { return false; }
}

export async function stop({ deadlineMs = 8000 } = {}) {
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) {
    // Even when not "started", a leftover Leave dialog can block the chart —
    // dismiss it before hiding the toolbar.
    await clickLeaveReplayDialog();
    try { await evaluate(`${rp}.hideReplayToolbar()`); } catch {}
    const toolbarVisible = await evaluate(wv(`${rp}.isReplayToolbarVisible()`));
    return { success: true, action: 'already_stopped', replay_started: false, toolbar_visible: !!toolbarVisible };
  }
  await evaluate(`${rp}.stopReplay()`);
  await new Promise(r => setTimeout(r, 800));
  try { await evaluate(`${rp}.goToRealtime()`); } catch {}
  try { await evaluate(`${rp}.leaveReplay()`); } catch {}

  // POLL for the "Leave current replay?" dialog and click Leave the moment it
  // appears, then keep polling until replay is actually stopped. leaveReplay()
  // blocks the page's main thread during the realtime reload, so a single
  // fixed-delay search races the dialog render — if it's missed the dialog
  // stays open, replay never leaves, and the chart wedges on the next switch.
  // Polling removes the race entirely (root cause confirmed 2026-06-16).
  const deadline = Date.now() + deadlineMs;
  let leaveClicked = false;
  let stoppedConfirmed = false;
  while (Date.now() < deadline) {
    if (await clickLeaveReplayDialog()) leaveClicked = true;
    let stillStarted = true;
    try { stillStarted = !!(await evaluate(wv(`${rp}.isReplayStarted()`))); } catch { /* thread busy mid-reload — retry */ }
    if (!stillStarted) { stoppedConfirmed = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!stoppedConfirmed) {
    try { await evaluate(`${rp}.hideReplayToolbar()`); } catch {}
  }
  await new Promise(r => setTimeout(r, 300));
  const state = await evaluate(`
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return {
        is_replay_started: unwrap(r.isReplayStarted()),
        is_replay_toolbar_visible: unwrap(r.isReplayToolbarVisible && r.isReplayToolbarVisible()),
        replay_mode: unwrap(r.replayMode && r.replayMode()),
      };
    })()
  `);
  const stopped = !state?.is_replay_started;
  return {
    success: true,
    action: stopped ? 'replay_stopped' : 'replay_stop_requested',
    replay_started: !!state?.is_replay_started,
    toolbar_visible: !!state?.is_replay_toolbar_visible,
    replay_mode: state?.replay_mode ?? null,
    leave_dialog_clicked: leaveClicked,
  };
}

export async function trade({ action }) {
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  if (action === 'buy') await evaluate(`${rp}.buy()`);
  else if (action === 'sell') await evaluate(`${rp}.sell()`);
  else if (action === 'close') await evaluate(`${rp}.closePosition()`);
  else throw new Error('Invalid action. Use: buy, sell, or close');

  const position = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, action, position, realized_pnl: pnl };
}

export async function status() {
  const rp = await getReplayApi();
  const st = await evaluate(`
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return {
        is_replay_available: unwrap(r.isReplayAvailable()),
        is_replay_started: unwrap(r.isReplayStarted()),
        is_autoplay_started: unwrap(r.isAutoplayStarted()),
        replay_mode: unwrap(r.replayMode()),
        current_date: unwrap(r.currentDate()),
        autoplay_delay: unwrap(r.autoplayDelay()),
      };
    })()
  `);
  const pos = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, ...st, position: pos, realized_pnl: pnl };
}
