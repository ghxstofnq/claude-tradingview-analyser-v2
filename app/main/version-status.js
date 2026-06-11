// version-status — surfaces "what code is this app actually running?"
//
// Failure mode this exists for (observed 2026-06-11): six merged PRs sat in
// origin/main while the running Electron process stayed on week-old code.
// Nothing in the UI said so; the live loop was silently running stale logic.
//
// Three facts, re-read on a slow poll:
//   boot_sha — HEAD at process start (main-process code is frozen at boot;
//              vite only hot-reloads the renderer)
//   disk sha — HEAD now (a pull/merge moved it → restart needed)
//   behind   — commits in HEAD..origin/main after a tolerated best-effort
//              fetch (merged-on-GitHub-but-not-pulled → pull needed)
//
// Pure decision core + DI exec so tests never spawn git.

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POLL_INTERVAL_MS = 5 * 60_000;
const GIT_TIMEOUT_MS = 15_000;

export function shortSha(sha) {
  if (typeof sha !== "string") return null;
  const trimmed = sha.trim();
  return trimmed ? trimmed.slice(0, 7) : null;
}

export function computeVersionStatus({ bootSha, diskSha, behind } = {}) {
  const restartNeeded = Boolean(bootSha && diskSha && bootSha !== diskSha);
  const behindCount = Number.isFinite(behind) ? behind : null;
  const pullNeeded = behindCount != null && behindCount > 0;
  const state = restartNeeded && pullNeeded ? "restart_and_pull"
    : restartNeeded ? "restart_needed"
    : pullNeeded ? "pull_needed"
    : "current";
  return {
    state,
    sha: shortSha(diskSha ?? bootSha),
    boot_sha: shortSha(bootSha),
    restart_needed: restartNeeded,
    pull_needed: pullNeeded,
    behind: behindCount,
  };
}

function execGit(args, { cwd, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: timeoutMs }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

export async function readGitFacts({ repoRoot = REPO_ROOT, execFn = execGit, fetchRemote = true } = {}) {
  if (fetchRemote) {
    // Best-effort: offline / no-credential failures must not break the poll.
    try { await execFn(["fetch", "--quiet", "origin", "main"], { cwd: repoRoot }); } catch { /* tolerated */ }
  }
  let diskSha = null;
  try { diskSha = (await execFn(["rev-parse", "HEAD"], { cwd: repoRoot })).trim() || null; } catch { /* tolerated */ }
  let behind = null;
  try {
    const raw = (await execFn(["rev-list", "--count", "HEAD..origin/main"], { cwd: repoRoot })).trim();
    const parsed = Number.parseInt(raw, 10);
    behind = Number.isFinite(parsed) ? parsed : null;
  } catch { /* no upstream ref / detached — tolerated */ }
  return { diskSha, behind };
}

export function createVersionPoll({ repoRoot = REPO_ROOT, send, execFn = execGit, fetchRemote = true } = {}) {
  let bootSha = null;
  let status = computeVersionStatus({});
  let timer = null;

  async function tick() {
    let facts;
    try {
      facts = await readGitFacts({ repoRoot, execFn, fetchRemote });
    } catch {
      return status; // keep last-known status; never flap on read errors
    }
    if (!facts.diskSha) return status;
    if (bootSha == null) bootSha = facts.diskSha;
    status = computeVersionStatus({ bootSha, diskSha: facts.diskSha, behind: facts.behind });
    send?.("version:status", status);
    return status;
  }

  return {
    tick,
    get: () => status,
    start() {
      tick().catch(() => {});
      timer = setInterval(() => tick().catch(() => {}), POLL_INTERVAL_MS);
      timer.unref?.();
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
