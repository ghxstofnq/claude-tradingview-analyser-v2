/**
 * Core alert logic.
 *
 * Create flow (verified live 2026-05-24 against TradingView Desktop 3.1.0):
 *   1. Click [aria-label="Create alert"] to open the dialog.
 *   2. Find the dialog root via its title prefix span ([class*="textPrefix-"]
 *      containing "Create alert").
 *   3. JS-focus + select the lone text input. Synthetic input events DO NOT
 *      update TV's internal alert model — only real keystrokes do.
 *   4. Backspace to clear, then dispatch CDP keystrokes for each digit/period
 *      of the target price (modifiers / vkc set per character).
 *   5. Press Enter — this commits the typed price into TV's model AND submits.
 *   6. Verify by diffing list_alerts before/after.
 *
 * Why the rewrite was needed:
 *   - Previous code used [aria-label="Create Alert"] (capital A); TV's label
 *     is lowercase "Create alert".
 *   - Previous code wrote into the input via native-setter + dispatchEvent.
 *     TV's framework ignores that — the DOM input value updates but the
 *     internal alert state still holds the prefilled market price. Pressing
 *     Create therefore creates an alert at the prefilled price, not ours.
 *   - The list-diff verification is preserved.
 *
 * Message parameter: ignored. The new dialog hides custom message input
 * behind a sub-panel click. The auto-generated TV message ("SYM Crossing PX")
 * is used. Custom messages can be re-introduced as a follow-up.
 */
import { evaluate, evaluateAsync, getClient } from './connection.js';

const SUBMIT_BTN_PREFIX = 'submitBtn-';
const CREATE_TITLE_PREFIX = 'Create alert';

// Dispatch a single character via CDP — both keyDown and keyUp.
async function typeChar(client, c) {
  const isDigit = /\d/.test(c);
  const code = isDigit ? `Digit${c}` : 'Period';
  const vkc  = isDigit ? c.charCodeAt(0) : 190;
  await client.Input.dispatchKeyEvent({ type: 'keyDown', text: c, key: c, code, windowsVirtualKeyCode: vkc });
  await client.Input.dispatchKeyEvent({ type: 'keyUp',                key: c, code, windowsVirtualKeyCode: vkc });
}

export async function create({ condition, price, message }) {
  // Snapshot existing alert IDs so we can verify the new one after submit.
  let preIds = new Set();
  try {
    const pre = await list();
    preIds = new Set((pre.alerts || []).map(a => a.alert_id));
  } catch (_) {}

  // 1) Open the Create Alert dialog.
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
      requested_price: Number(price),
      condition,
      source: 'dom_keyboard_unverified',
    };
  }

  await new Promise(r => setTimeout(r, 1000));

  // 2 + 3) Find the dialog input and focus + select it.
  const focused = await evaluate(`
    (function() {
      var ts = Array.from(document.querySelectorAll('[class*="textPrefix-"]'))
        .find(function(s){ return s.textContent.trim().startsWith(${JSON.stringify(CREATE_TITLE_PREFIX)}); });
      if (!ts) return false;
      var root = ts;
      for (var i = 0; i < 15 && root.parentElement; i++) {
        root = root.parentElement;
        if (root.querySelectorAll('button[class*=${JSON.stringify(SUBMIT_BTN_PREFIX)}]').length >= 1) break;
      }
      var input = root.querySelector('input[type="text"]');
      if (!input) return false;
      input.focus();
      input.select();
      return true;
    })()
  `);

  if (!focused) {
    return {
      success: false,
      reason: 'Dialog opened but could not focus the price input.',
      requested_price: Number(price),
      condition,
      source: 'dom_keyboard_unverified',
    };
  }

  // 4) Backspace to clear, then type the new price via CDP keystrokes.
  const client = await getClient();
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await new Promise(r => setTimeout(r, 80));

  for (const c of String(price)) {
    await typeChar(client, c);
    await new Promise(r => setTimeout(r, 25));
  }

  // 5) Press Enter — commits the typed value to TV's model AND submits.
  await new Promise(r => setTimeout(r, 200));
  await client.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await client.Input.dispatchKeyEvent({ type: 'keyUp',   key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

  // 6) Wait for TV to persist, then verify via list diff.
  await new Promise(r => setTimeout(r, 1800));
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
      source: 'dom_keyboard_verified_via_list',
    };
  }

  return {
    success: false,
    reason: 'No new alert appeared in list() after submit — Enter key may not have committed.',
    dom_opened: opened,
    dom_input_focused: focused,
    requested_price: Number(price),
    condition,
    message: message || '(none)',
    source: 'dom_keyboard_unverified',
  };
}

export async function list() {
  // Use pricealerts REST API — returns structured data with alert_id, symbol, price, conditions
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

export async function deleteAlerts({ delete_all }) {
  if (delete_all) {
    const result = await evaluate(`
      (function() {
        var alertBtn = document.querySelector('[data-name="alerts"]');
        if (alertBtn) alertBtn.click();
        var header = document.querySelector('[data-name="alerts"]');
        if (header) {
          header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
          return { context_menu_opened: true };
        }
        return { context_menu_opened: false };
      })()
    `);
    return { success: true, note: 'Alert deletion requires manual confirmation in the context menu.', context_menu_opened: result?.context_menu_opened || false, source: 'dom_fallback' };
  }
  throw new Error('Individual alert deletion not yet supported. Use delete_all: true.');
}
