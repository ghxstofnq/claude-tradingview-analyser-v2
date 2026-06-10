import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ipcSource = readFileSync(new URL('../app/main/ipc.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../app/preload.cjs', import.meta.url), 'utf8');
const sessionViewsSource = readFileSync(new URL('../app/main/session-views.js', import.meta.url), 'utf8');
const hookSource = readFileSync(new URL('../app/renderer/src/hooks/useOpenReaction.js', import.meta.url), 'utf8');
const livePopoverSource = readFileSync(new URL('../app/renderer/src/LivePopover.jsx', import.meta.url), 'utf8');

test('open-reaction view exposes finalized LTF lock brief and last trader decision', () => {
  assert.match(sessionViewsSource, /ltf-bias\.json/);
  assert.match(sessionViewsSource, /lock-brief-decision\.json/);
  assert.match(hookSource, /setLtfBias\(res\.ltfBias \|\| null\)/);
  assert.match(hookSource, /setLockDecision\(res\.lockDecision \|\| null\)/);
  assert.match(hookSource, /return \{ reads, latest, ltfBias, lockDecision, reload \}/);
});

test('lock brief approval has explicit Start Detector and Watch 10m More actions', () => {
  assert.match(preloadSource, /lockBriefAction\(session, action\)/);
  assert.match(preloadSource, /prep:lock_brief_action/);
  assert.match(preloadSource, /onLockBriefDecision/);

  assert.match(ipcSource, /ipcMain\.handle\("prep:lock_brief_action"/);
  assert.match(ipcSource, /recordLockBriefDecision\(args\.session, args\.action\)/);
  assert.match(ipcSource, /args\.action === "start_detector"/);
  assert.match(ipcSource, /setMode\("live"\)/);
  assert.match(ipcSource, /startDetector\(\{ send \}\)/);
  assert.match(ipcSource, /prep:lock_brief_decision/);

  assert.match(sessionViewsSource, /"start_detector"/);
  assert.match(sessionViewsSource, /"watch_10m_more"/);
  assert.match(sessionViewsSource, /extend_minutes: action === "watch_10m_more" \? 10 : 0/);
});

test('LIVE open-reaction lock card renders approval buttons and calls IPC with machine actions', () => {
  assert.match(livePopoverSource, /LOCK BRIEF/);
  assert.match(livePopoverSource, /START DETECTOR/);
  assert.match(livePopoverSource, /WATCH 10M MORE/);
  assert.match(livePopoverSource, /lockBriefAction\?\.\(openReaction\?\.session, action\)/);
  assert.match(livePopoverSource, /runLockAction\("start_detector"\)/);
  assert.match(livePopoverSource, /runLockAction\("watch_10m_more"\)/);
});
