import { register } from '../router.js';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';

/**
 * tv dash — a small terminal TUI for live oversight during a trading session.
 *
 * Reads from the filesystem:
 *   - state/session/detector-heartbeat.json — detector status (written by
 *     ./bin/tv stream bar-close every poll iteration).
 *   - state/session/<today>/bar-close-events.jsonl — every detected close
 *     (persisted by the detector alongside stdout).
 *   - state/session/<today>/*.md — phase outputs (pillar1, pillar2,
 *     open-reaction, ltf-bias, htf-summary).
 *   - state/session/<today>/setups.jsonl + bars.jsonl — entry-hunt state.
 *   - state/last-analyze.json — most recent bundle (for current ET / phase).
 *
 * Refreshes every 2s. ANSI clear-and-redraw, no external deps. Press q +
 * Enter to quit.
 */

const COLS = 80;
const REFRESH_MS = 2000;

const HEARTBEAT_PATH = 'state/session/detector-heartbeat.json';
const LAST_ANALYZE_PATH = 'state/last-analyze.json';
const SESSION_DIR_BASE = 'state/session';

// ANSI helpers
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const CLEAR_HOME = '\x1b[2J\x1b[H';

function nowETDate() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

function nowETTime() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false,
  });
  return fmt.format(new Date());
}

function fileMtimeStr(path) {
  try {
    const st = statSync(path);
    return new Date(st.mtimeMs).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
  } catch (e) { return null; }
}

function readJsonl(path, lastN = 5) {
  try {
    const txt = readFileSync(path, 'utf8');
    const lines = txt.split('\n').filter((l) => l.trim());
    const total = lines.length;
    return { total, tail: lines.slice(-lastN).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) };
  } catch (e) { return { total: 0, tail: [] }; }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return null; }
}

function readMdSummary(path) {
  try {
    const txt = readFileSync(path, 'utf8');
    const lines = txt.split('\n');
    // Pull frontmatter-ish or the first "verdict" / "htf_bias" / "ltf_bias" line.
    const verdict = lines.find((l) => /^- (htf_bias|ltf_bias|pillar2|verdict|bias_direction_note|htf_ltf_alignment):/.test(l.trim()));
    return { lines: lines.length, verdict: verdict ? verdict.trim() : null };
  } catch (e) { return null; }
}

function ageStr(isoOrMs) {
  if (!isoOrMs) return '—';
  const ts = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ts)) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m${s%60}s ago`;
  return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m ago`;
}

function pad(s, n) { return (s + ' '.repeat(n)).slice(0, n); }

function sectionHeader(title) {
  const line = '═'.repeat(COLS - 2);
  return `${CYAN}╔${line}╗\n║ ${BOLD}${pad(title, COLS - 4)}${RESET}${CYAN} ║\n╚${line}╝${RESET}`;
}

function smallHeader(title) {
  return `\n${BOLD}${title}${RESET}`;
}

function render() {
  const out = [];
  const dateKey = nowETDate();
  const sessionDir = `${SESSION_DIR_BASE}/${dateKey}`;
  const etTime = nowETTime();

  // ─── Top banner ───
  const hb = readJson(HEARTBEAT_PATH);
  const bundle = readJson(LAST_ANALYZE_PATH);
  const session = bundle?.gates?.session;
  const phase = session?.phase || '—';
  const minutesIn = session?.minutes_into_phase ?? null;
  const nextKzLabel = session?.next_killzone_label;
  const secsToKz = session?.seconds_to_next_killzone;
  const nextKzStr = (nextKzLabel && secsToKz != null)
    ? `${nextKzLabel} in ${Math.floor(secsToKz/3600) > 0 ? Math.floor(secsToKz/3600) + 'h ' : ''}${Math.floor((secsToKz%3600)/60)}m`
    : 'none today';

  out.push(`${CYAN}${BOLD}tv dash${RESET}${CYAN}  ·  session ${dateKey}  ·  ET ${etTime}${RESET}`);
  out.push(`${CYAN}phase: ${BOLD}${phase}${RESET}${CYAN}  ${minutesIn != null ? '+' + minutesIn + 'm  ·  ' : ''}next: ${nextKzStr}${RESET}`);
  out.push('');

  // ─── DETECTOR ───
  out.push(`${BOLD}DETECTOR${RESET}`);
  if (!hb) {
    out.push(`  ${RED}NOT RUNNING${RESET} — heartbeat file missing (${HEARTBEAT_PATH})`);
    out.push(`  start with: ${DIM}./bin/tv stream bar-close${RESET}`);
  } else {
    const heartbeatAge = ageStr(hb.last_heartbeat);
    const heartbeatStale = (Date.now() - Date.parse(hb.last_heartbeat)) > 70_000;
    const statusColor = heartbeatStale ? RED : GREEN;
    const statusWord = heartbeatStale ? 'STALE' : 'running';
    out.push(`  ${statusColor}${statusWord}${RESET}  ·  last heartbeat ${heartbeatAge}  ·  pid ${hb.pid}  ·  state=${hb.current_state}`);
    out.push(`  tracking: bar ${hb.last_bar_time ?? '—'}`);
    if (hb.last_bar_close) {
      out.push(`  last emit: ${ageStr(hb.last_event_at)}  ·  bar ${hb.last_bar_close.time} close=${hb.last_bar_close.close} TF=${hb.last_bar_close.tf}`);
    } else {
      out.push(`  last emit: ${DIM}none yet this run${RESET}`);
    }
  }

  // ─── Recent bar closes ───
  const eventsPath = `${sessionDir}/bar-close-events.jsonl`;
  const events = readJsonl(eventsPath, 6);
  out.push('');
  out.push(`${BOLD}RECENT BAR CLOSES${RESET}  ${DIM}(${events.total} today)${RESET}`);
  if (events.tail.length === 0) {
    out.push(`  ${DIM}(none yet)${RESET}`);
  } else {
    for (const e of events.tail.slice().reverse()) {
      const flag = e.is_5m_close ? ` ${MAGENTA}[5m_close]${RESET}` : '';
      const t = e.bar_close_time ? new Date(e.bar_close_time * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) : '—';
      out.push(`  ${t}  bar=${e.bar_open_time}  O=${e.open} H=${e.high} L=${e.low} C=${e.close}  [${e.tf}m]${flag}`);
    }
  }

  // ─── Session state files ───
  out.push('');
  out.push(`${BOLD}SESSION STATE${RESET}  ${DIM}${sessionDir}/${RESET}`);
  const files = [
    'pillar1.md', 'pillar2.md',
    'pillar1-ny-pm.md', 'pillar2-ny-pm.md',
    'open-reaction.md', 'ltf-bias.md',
    'htf-summary.md',
  ];
  let anyFile = false;
  for (const f of files) {
    const path = `${sessionDir}/${f}`;
    if (!existsSync(path)) continue;
    anyFile = true;
    const summary = readMdSummary(path);
    const mtime = fileMtimeStr(path);
    out.push(`  ${pad(f, 22)} ${DIM}mod ${mtime}${RESET}  ${summary?.verdict || ''}`);
  }
  const barsJsonl = readJsonl(`${sessionDir}/bars.jsonl`, 1);
  if (barsJsonl.total > 0) {
    out.push(`  ${pad('bars.jsonl', 22)} ${DIM}${barsJsonl.total} entries${RESET}`);
    anyFile = true;
  }
  const bars5mJsonl = readJsonl(`${sessionDir}/bars-5m.jsonl`, 1);
  if (bars5mJsonl.total > 0) {
    out.push(`  ${pad('bars-5m.jsonl', 22)} ${DIM}${bars5mJsonl.total} entries${RESET}`);
    anyFile = true;
  }
  const setupsJsonl = readJsonl(`${sessionDir}/setups.jsonl`, 1);
  if (setupsJsonl.total > 0) {
    out.push(`  ${pad('setups.jsonl', 22)} ${DIM}${setupsJsonl.total} entries${RESET}`);
    anyFile = true;
  }
  if (!anyFile) {
    out.push(`  ${DIM}(no session files yet — /analyze hasn't written anything)${RESET}`);
  }

  // ─── Recent setups ───
  const setups = readJsonl(`${sessionDir}/setups.jsonl`, 4);
  if (setups.tail.length > 0) {
    out.push('');
    out.push(`${BOLD}RECENT SETUPS${RESET}  ${DIM}(${setups.total} today)${RESET}`);
    for (const s of setups.tail.slice().reverse()) {
      const statusColor = s.status === 'confirmed' ? GREEN : (s.status === 'invalidated' ? RED : YELLOW);
      const t = s.ts ? new Date(s.ts).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) : '—';
      out.push(`  ${t}  ${s.model || '?'} ${s.side || ''} · ${statusColor}${s.status}${RESET}  ${DIM}${s.rationale || ''}${RESET}`);
    }
  }

  // ─── Footer ───
  out.push('');
  out.push(`${DIM}press q + Enter to quit  ·  refresh ${REFRESH_MS/1000}s${RESET}`);

  return out.join('\n');
}

async function runDash() {
  // Disable input echo, line buffer
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  let quitRequested = false;
  process.stdin.on('data', (chunk) => {
    if (/^q/i.test(chunk.trim())) {
      quitRequested = true;
    }
  });

  const draw = () => {
    process.stdout.write(CLEAR_HOME + render() + '\n');
  };

  draw();
  const interval = setInterval(() => {
    if (quitRequested) {
      clearInterval(interval);
      process.stdout.write('\n');
      process.exit(0);
    }
    try { draw(); } catch (e) {
      process.stderr.write(`\n[dash] render error: ${e.message}\n`);
    }
  }, REFRESH_MS);

  // Keep the process alive — interval holds it.
  return new Promise(() => {});
}

register('dash', {
  description: 'Live oversight TUI: detector heartbeat, bar-close events, session state files, recent setups. Refreshes every 2s. Press q to quit.',
  options: {},
  handler: async () => {
    await runDash();
    process.exit(0); // unreachable
  },
});
