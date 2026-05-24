/**
 * Core alert logic.
 *
 * Create flow (verified live 2026-05-24 against TradingView Desktop 3.1.0):
 *   1. Click [aria-label="Create alert"] to open the dialog.
 *   2. Find the dialog root via its title prefix span ([class*="textPrefix-"]
 *      containing "Create alert").
 *   3. JS-focus + select the price input. Synthetic input events DO NOT
 *      update TV's internal alert model — only real keystrokes do.
 *   4. Backspace to clear, then dispatch CDP keystrokes per digit/period.
 *   5. Optionally set a custom message: click [data-qa-id="alert-message-button"]
 *      to open the message tab, then type into textarea#alert-message via
 *      CDP keystrokes (same framework-binding issue applies).
 *   6. Click the submit button (or press Enter if no message was typed).
 *   7. Verify by diffing list_alerts before/after.
 *
 * Delete flow (verified live 2026-05-24, cleared 329 alerts):
 *   1. Open Alerts widgetbar tab via [data-name="alerts"], ensure the
 *      "Alerts" sub-tab is active.
 *   2. For per-alert delete: find the row whose [data-name="alert-item-description"]
 *      matches the alert's message, click its [data-name="alert-delete-button"],
 *      click [data-qa-id="yes-btn"] to confirm.
 *   3. For delete-all: loop the same click+confirm sequence until no more
 *      delete buttons exist.
 *
 * See docs/tradingview-cookbook.md for full reverse-engineering notes.
 */
import { evaluate, evaluateAsync, getClient } from './connection.js';

const DIALOG_QA = 'alerts-create-edit-dialog';
const SUBMIT_QA = 'submit';
const CANCEL_QA = 'cancel';
const MSG_BUTTON_QA = 'alert-message-button';
const MSG_SUB_DIALOG_QA = 'alerts-message-edit-dialog';

// ---------- helpers ----------

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Dispatch one character via CDP — both keyDown and keyUp. Handles digits,
// period, space, letters, and common punctuation. For unknown chars, falls
// back to passing the char as `text` with a generic vkc.
async function typeChar(client, c) {
  const isDigit = /[0-9]/.test(c);
  const isLetter = /[a-zA-Z]/.test(c);
  let code = 'Unidentified';
  let vkc = c.charCodeAt(0);
  let modifiers = 0;
  if (isDigit) {
    code = `Digit${c}`;
    vkc = c.charCodeAt(0);
  } else if (isLetter) {
    code = `Key${c.toUpperCase()}`;
    vkc = c.toUpperCase().charCodeAt(0);
    if (c === c.toUpperCase() && c !== c.toLowerCase()) modifiers = 8;   // shift for uppercase
  } else if (c === '.') { code = 'Period'; vkc = 190; }
  else if (c === ' ') { code = 'Space'; vkc = 32; }
  else if (c === '-') { code = 'Minus'; vkc = 189; }
  else if (c === '_') { code = 'Minus'; vkc = 189; modifiers = 8; }
  else if (c === ',') { code = 'Comma'; vkc = 188; }
  else if (c === '/') { code = 'Slash'; vkc = 191; }
  else if (c === ':') { code = 'Semicolon'; vkc = 186; modifiers = 8; }
  await client.Input.dispatchKeyEvent({ type: 'keyDown', text: c, key: c, code, windowsVirtualKeyCode: vkc, modifiers });
  await client.Input.dispatchKeyEvent({ type: 'keyUp',          key: c, code, windowsVirtualKeyCode: vkc, modifiers });
}

async function typeString(client, str, perCharDelayMs = 20) {
  for (const c of String(str)) {
    await typeChar(client, c);
    if (perCharDelayMs) await sleep(perCharDelayMs);
  }
}

// Press a named key (e.g. 'Backspace', 'Enter', 'Tab').
async function pressKey(client, key, opts = {}) {
  const codeMap = { Backspace: { code: 'Backspace', vkc: 8 }, Enter: { code: 'Enter', vkc: 13 }, Tab: { code: 'Tab', vkc: 9 } };
  const k = codeMap[key] || { code: key, vkc: 0 };
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key, code: k.code, windowsVirtualKeyCode: k.vkc, modifiers: opts.modifiers || 0 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp',   key, code: k.code, windowsVirtualKeyCode: k.vkc, modifiers: opts.modifiers || 0 });
}

// Click an element via REAL CDP mouse events at its center. Synthetic
// .click() doesn't trigger TV's panel-populate logic — only real mouse
// events do. Returns true if the element was found + clicked.
async function realClickBySelector(selector) {
  const coords = await evaluate(`
    (function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), visible: el.offsetParent !== null };
    })()
  `);
  if (!coords || !coords.visible) return false;
  const client = await getClient();
  await client.Input.dispatchMouseEvent({ type: 'mousePressed',  x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  return true;
}

// Ensure the Alerts widgetbar tab is open AND the "Alerts" sub-tab is
// selected. Uses real CDP mouse events because TV's panel won't fully
// populate rows when opened via synthetic .click().
async function ensureAlertsPanelOpen() {
  if (await evaluate(`!!document.querySelector('[data-name="alert-delete-button"]')`)) return true;

  // Check current widget visibility — if widget exists but is hidden, we need to open.
  const widgetVisible = await evaluate(`
    (function() {
      var w = document.querySelector('[data-test-id-widget-type="alerts"]');
      return w ? w.offsetParent !== null : false;
    })()
  `);
  if (!widgetVisible) {
    await realClickBySelector('[data-name="alerts"]');
    await sleep(1800);
  }

  // Ensure "Alerts" sub-tab selected.
  await evaluate(`
    (function() {
      var w = document.querySelector('[data-test-id-widget-type="alerts"]');
      if (!w) return;
      var btn = Array.from(w.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === 'Alerts'; });
      if (btn && !(btn.className || '').includes('checked-')) btn.click();
    })()
  `);
  await sleep(800);

  return !!(await evaluate(`!!document.querySelector('[data-name="alert-delete-button"]')`));
}

// ---------- create ----------

export async function create({ condition, price, message }) {
  let preIds = new Set();
  try {
    const pre = await list();
    preIds = new Set((pre.alerts || []).map(a => a.alert_id));
  } catch (_) {}

  // 1) Open Create Alert dialog.
  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Create alert"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);
  if (!opened) {
    return {
      success: false,
      reason: 'Could not click [aria-label="Create alert"] — TradingView UI may have changed.',
      requested_price: Number(price), condition,
      source: 'dom_keyboard_unverified',
    };
  }
  await sleep(1000);

  const client = await getClient();

  // 2) Custom message FIRST (when set) — opens a sub-dialog. Set the message
  // before touching the price input, because navigating away from the price
  // input loses any typed value (TV's framework only commits on Enter).
  let messageSet = false;
  if (message) {
    const tabClicked = await evaluate(`
      (function() {
        var dlg = document.querySelector('[data-qa-id=${JSON.stringify(DIALOG_QA)}]');
        if (!dlg) return false;
        var btn = dlg.querySelector('[data-qa-id=${JSON.stringify(MSG_BUTTON_QA)}]');
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    if (tabClicked) {
      await sleep(700);
      const taFocused = await evaluate(`
        (function() {
          var sub = document.querySelector('[data-qa-id=${JSON.stringify(MSG_SUB_DIALOG_QA)}]');
          if (!sub) return false;
          var ta = sub.querySelector('textarea#alert-message');
          if (!ta) return false;
          ta.focus();
          ta.select();
          return true;
        })()
      `);
      if (taFocused) {
        await pressKey(client, 'Backspace');
        await sleep(60);
        await typeString(client, message, 15);
        await sleep(150);
        // Submit the sub-dialog to commit the message + return to main dialog.
        await evaluate(`
          (function() {
            var sub = document.querySelector('[data-qa-id=${JSON.stringify(MSG_SUB_DIALOG_QA)}]');
            sub && sub.querySelector('[data-qa-id=${JSON.stringify(SUBMIT_QA)}]')?.click();
          })()
        `);
        await sleep(600);
        messageSet = true;
      }
    }
  }

  // 3 + 4) Focus + select the price input, then type via CDP keystrokes.
  // This must happen LAST — TV's price model is volatile and only commits
  // when Enter is pressed while the input is focused.
  const focused = await evaluate(`
    (function() {
      var dlg = document.querySelector('[data-qa-id=${JSON.stringify(DIALOG_QA)}]');
      if (!dlg) return false;
      var input = dlg.querySelector('input[type="text"]');
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    })()
  `);
  if (!focused) {
    return {
      success: false,
      reason: 'Create dialog opened but could not focus the price input.',
      requested_price: Number(price), condition,
      message_set_attempted: !!message,
      message_set_success: messageSet,
      source: 'dom_keyboard_unverified',
    };
  }
  await pressKey(client, 'Backspace');
  await sleep(80);
  await typeString(client, price, 25);

  // 5) Submit via Enter — commits the typed price into TV's model AND
  // submits the dialog. Single-action commit is the only reliable path.
  await sleep(200);
  await pressKey(client, 'Enter');

  // 7) Wait + verify.
  await sleep(1800);
  let createdAlert = null;
  try {
    const post = await list();
    const newAlerts = (post.alerts || []).filter(a => !preIds.has(a.alert_id));
    if (newAlerts.length > 0) {
      const reqPrice = Number(price);
      const priceOf = a => {
        const v = a.condition?.series?.find(s => s.type === 'value')?.value;
        return typeof v === 'number' ? v : null;
      };
      newAlerts.sort((a, b) => {
        const pa = priceOf(a), pb = priceOf(b);
        if (pa === null) return 1;
        if (pb === null) return -1;
        return Math.abs(pa - reqPrice) - Math.abs(pb - reqPrice);
      });
      createdAlert = newAlerts[0];
    }
  } catch (_) {}

  if (createdAlert) {
    const createdPrice = createdAlert.condition?.series?.find(s => s.type === 'value')?.value ?? null;
    const drift = createdPrice !== null ? Math.round((createdPrice - Number(price)) * 100) / 100 : null;
    return {
      success: true,
      alert_id: createdAlert.alert_id,
      requested_price: Number(price),
      created_price: createdPrice,
      drift,
      drift_warning: drift !== null && drift !== 0
        ? `Price drifted ${drift > 0 ? '+' : ''}${drift} — TV rounded or dropped fraction.`
        : null,
      condition,
      message: createdAlert.message || '(auto)',
      message_set_attempted: !!message,
      message_set_success: messageSet,
      source: 'dom_keyboard_verified_via_list',
    };
  }

  return {
    success: false,
    reason: 'No new alert appeared in list() after submit.',
    requested_price: Number(price),
    condition,
    message: message || '(none)',
    message_set_attempted: !!message,
    source: 'dom_keyboard_unverified',
  };
}

// ---------- list ----------

export async function list() {
  const result = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.s !== 'ok' || !Array.isArray(data.r)) return { alerts: [], error: data.errmsg || 'Unexpected response' };
        return {
          alerts: data.r.map(function(a) {
            var sym = '';
            try { sym = JSON.parse(a.symbol.replace(/^=/, '')).symbol || a.symbol; } catch(e) { sym = a.symbol; }
            return {
              alert_id: a.alert_id,
              symbol: sym,
              type: a.type,
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
            };
          })
        };
      })
      .catch(function(e) { return { alerts: [], error: e.message }; })
  `);
  return { success: true, alert_count: result?.alerts?.length || 0, source: 'internal_api', alerts: result?.alerts || [], error: result?.error };
}

// ---------- delete ----------

// Delete a single alert by ID. The alerts panel doesn't always render
// fresh alerts immediately — we retry over a window, opening the panel and
// looking for the row whose [data-name="alert-item-description"] matches
// our target alert's message. Once we find it, click the row's delete
// button + confirm.
export async function deleteOne({ id, max_wait_ms = 30_000 }) {
  if (id == null) throw new Error('deleteOne requires id');

  const preList = await list();
  const target = (preList.alerts || []).find(a => Number(a.alert_id) === Number(id));
  if (!target) {
    return { success: false, reason: `alert ${id} not on server`, source: 'list_diff' };
  }

  // Make sure the panel is open before we start polling for the row.
  await ensureAlertsPanelOpen();

  // Retry loop — the panel may take seconds to render a freshly-created
  // alert. Poll for the row, with light interaction nudges to encourage
  // a re-render if it's stuck.
  const start = Date.now();
  let clicked = false;
  let attempts = 0;
  while (Date.now() - start < max_wait_ms) {
    attempts += 1;
    clicked = await evaluate(`
      (function() {
        var descs = document.querySelectorAll('[data-name="alert-item-description"]');
        for (var i = 0; i < descs.length; i++) {
          if (descs[i].textContent.trim() === ${JSON.stringify(target.message)}) {
            var row = descs[i];
            for (var j = 0; j < 6 && row.parentElement; j++) {
              row = row.parentElement;
              var del = row.querySelector('[data-name="alert-delete-button"]');
              if (del) { del.click(); return true; }
            }
          }
        }
        return false;
      })()
    `);
    if (clicked) break;
    // Nudge — toggle sub-tab to encourage a re-render.
    if (attempts % 3 === 0) {
      await evaluate(`
        (function() {
          var w = document.querySelector('[data-test-id-widget-type="alerts"]');
          if (!w) return;
          var btns = Array.from(w.querySelectorAll('button'));
          var log = btns.find(b => b.textContent.trim() === 'Log');
          var al  = btns.find(b => b.textContent.trim() === 'Alerts');
          log && log.click();
          setTimeout(function(){ al && al.click(); }, 200);
        })()
      `);
      await sleep(600);
    }
    await sleep(1500);
  }

  if (!clicked) {
    return {
      success: false,
      reason: `alert ${id} not visible in the panel within ${max_wait_ms}ms (the alerts panel sometimes lags on fresh alerts).`,
      target_message: target.message,
      attempts,
      source: 'dom_ui',
    };
  }

  // Confirm dialog
  await sleep(400);
  const confirmed = await evaluate(`
    (function() {
      var y = document.querySelector('[data-qa-id="yes-btn"]');
      if (!y) return false;
      y.click();
      return true;
    })()
  `);
  if (!confirmed) {
    return { success: false, reason: 'no confirm dialog appeared after delete click', source: 'dom_ui' };
  }

  await sleep(1500);

  // Verify
  const postList = await list();
  const stillPresent = (postList.alerts || []).some(a => Number(a.alert_id) === Number(id));
  if (stillPresent) {
    return { success: false, reason: 'alert still present in list after delete', source: 'list_diff' };
  }
  return { success: true, deleted_id: Number(id), attempts, elapsed_ms: Date.now() - start, source: 'dom_ui_verified_via_list' };
}

// Loop click+confirm until no more delete buttons remain. Used by `tv alert
// delete --all`. Destructive — caller must confirm intent.
export async function deleteAll({ max = 1000 } = {}) {
  const preCount = (await list()).alerts.length;
  if (preCount === 0) return { success: true, deleted: 0, source: 'list_diff' };

  const opened = await ensureAlertsPanelOpen();
  if (!opened) {
    return { success: false, reason: 'could not open alerts panel', source: 'dom_ui' };
  }

  let deletes = 0;
  let failsInARow = 0;
  for (let i = 0; i < max; i++) {
    const clicked = await evaluate(`
      (function() {
        var del = document.querySelector('[data-name="alert-delete-button"]');
        if (!del) return false;
        del.click();
        return true;
      })()
    `);
    if (!clicked) break;
    await sleep(380);
    const confirmed = await evaluate(`document.querySelector('[data-qa-id="yes-btn"]')?.click(), !!document.querySelector('[data-qa-id="yes-btn"]')`);
    if (!confirmed) {
      failsInARow += 1;
      if (failsInARow >= 5) break;
      await sleep(800);
      continue;
    }
    failsInARow = 0;
    deletes += 1;
    await sleep(500);
  }
  await sleep(500);
  const postCount = (await list()).alerts.length;
  return {
    success: postCount < preCount,
    deleted: preCount - postCount,
    remaining: postCount,
    source: 'dom_ui_loop_verified_via_list',
  };
}

// CLI entry — routes to deleteOne() or deleteAll() based on flags.
export async function deleteAlerts({ delete_all, id }) {
  if (id != null) return deleteOne({ id });
  if (delete_all) return deleteAll({});
  throw new Error('alert delete requires --id <id> OR --all.');
}
