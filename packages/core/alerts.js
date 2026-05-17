/**
 * Core alert logic.
 */
import { evaluate, evaluateAsync, getClient } from './connection.js';

export async function create({ condition, price, message }) {
  // Snapshot existing alert IDs so we can detect the new one after the create flow.
  // The DOM-fallback `success` flag is unreliable — it has reported false even when alerts are
  // successfully created, and TradingView sometimes rounds/drifts fractional-tick prices.
  // Diffing `list()` before/after is the only trustworthy confirmation.
  let preIds = new Set();
  try {
    const pre = await list();
    preIds = new Set((pre.alerts || []).map(a => a.alert_id));
  } catch (_) {}

  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Create Alert"]')
        || document.querySelector('[data-name="alerts"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);

  if (!opened) {
    const client = await getClient();
    await client.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 1, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA' });
  }

  await new Promise(r => setTimeout(r, 1000));

  const priceSet = await evaluate(`
    (function() {
      var inputs = document.querySelectorAll('[class*="alert"] input[type="text"], [class*="alert"] input[type="number"]');
      for (var i = 0; i < inputs.length; i++) {
        var label = inputs[i].closest('[class*="row"]')?.querySelector('[class*="label"]');
        if (label && /value|price/i.test(label.textContent)) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSet.call(inputs[i], '${price}');
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      if (inputs.length > 0) {
        var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSet.call(inputs[0], '${price}');
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);

  if (message) {
    await evaluate(`
      (function() {
        var textarea = document.querySelector('[class*="alert"] textarea')
          || document.querySelector('textarea[placeholder*="message"]');
        if (textarea) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          nativeSet.call(textarea, ${JSON.stringify(message)});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
  }

  await new Promise(r => setTimeout(r, 500));
  const clicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button[data-name="submit"], button');
      for (var i = 0; i < btns.length; i++) {
        if (/^create$/i.test(btns[i].textContent.trim())) { btns[i].click(); return true; }
      }
      return false;
    })()
  `);

  // Wait for TradingView to persist the alert, then verify via list diff.
  await new Promise(r => setTimeout(r, 1500));
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
        ? `Price drifted ${drift > 0 ? '+' : ''}${drift} — TV rounded or dropped fraction. Whole-integer prices land exact.`
        : null,
      condition,
      message: message || '(none)',
      source: 'dom_fallback_verified_via_list',
    };
  }

  return {
    success: false,
    reason: 'No new alert appeared in list() after create — DOM flow may have failed.',
    dom_clicked_create: !!clicked,
    dom_price_set: !!priceSet,
    requested_price: Number(price),
    condition,
    message: message || '(none)',
    source: 'dom_fallback_unverified',
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
