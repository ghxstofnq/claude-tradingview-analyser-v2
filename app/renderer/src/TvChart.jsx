// TradingView chart — embedded Electron <webview> pointing at tradingview.com.
//
// The webview is broker-connected (the trader's actual account) and is the
// surface where the order panel lives — execution happens inside the chart
// frame per the usage-workflow companion §4.
//
// `partition="persist:tradingview"` keeps the login session across app
// restarts. The component mounts ONCE at the App level (in ChartPane); mode
// switches and trade accepts never unmount it, so the chart never reloads.

import React, { useEffect as useEffectTv, useRef as useRefTv, useState as useStateTv } from "react";
import { chartUrl, buildSyncChartSymbolScript } from "./tv-symbols.js";

async function syncWebviewSymbol(wv, symbol) {
  if (!wv || typeof wv.executeJavaScript !== "function") return null;
  try {
    const res = await wv.executeJavaScript(buildSyncChartSymbolScript(symbol), false);
    // eslint-disable-next-line no-console
    console.log("[tv-webview] symbol-sync", res);
    return res;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[tv-webview] symbol-sync failed", e?.message || e);
    return { ok: false, reason: e?.message || String(e) };
  }
}

function TradingViewChart({ symbol = "MNQ1!" }) {
  const ref = useRefTv(null);
  const [ready, setReady] = useStateTv(false);
  const [failure, setFailure] = useStateTv(null);
  const [retryNonce, setRetryNonce] = useStateTv(0);
  // did-finish-load is registered once at mount — read the live symbol through
  // a ref, or a symbol switch gets synced back to the mount-time symbol.
  const symbolRef = useRefTv(symbol);
  symbolRef.current = symbol;

  useEffectTv(() => {
    const wv = ref.current;
    if (!wv) return;

    let cancelled = false;

    const onDomReady = () => {
      // eslint-disable-next-line no-console
      console.log("[tv-webview] dom-ready", wv.getURL?.());
    };
    const onDidFinishLoad = async () => {
      // eslint-disable-next-line no-console
      console.log("[tv-webview] did-finish-load", wv.getURL?.());
      if (cancelled) return;
      clearTimeout(failsafe);
      await syncWebviewSymbol(wv, symbolRef.current);
      if (cancelled) return;
      setReady(true);
      setFailure(null);
    };
    const onDidFailLoad = (e) => {
      if (e.isMainFrame === false) return;
      if (e.errorCode === -3) return;        // ERR_ABORTED — normal SPA nav
      // eslint-disable-next-line no-console
      console.warn("[tv-webview] did-fail-load", e);
      if (cancelled) return;
      setFailure({ code: e.errorCode, desc: e.errorDescription, url: e.validatedURL });
    };
    const onCrashed = () => {
      // eslint-disable-next-line no-console
      console.error("[tv-webview] crashed");
      if (cancelled) return;
      setFailure({ code: "crashed", desc: "webview renderer crashed" });
    };

    wv.addEventListener("dom-ready", onDomReady);
    wv.addEventListener("did-finish-load", onDidFinishLoad);
    wv.addEventListener("did-fail-load", onDidFailLoad);
    wv.addEventListener("crashed", onCrashed);

    // The webview loads from the `src` attribute — no explicit loadURL needed.
    // Just put a failsafe so if no load event arrives in 60s we surface that.
    const failsafe = setTimeout(() => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn("[tv-webview] failsafe fired");
      setFailure((f) => f || { code: "timeout", desc: "no did-finish-load after 60s" });
    }, 60_000);

    return () => {
      cancelled = true;
      wv.removeEventListener("dom-ready", onDomReady);
      wv.removeEventListener("did-finish-load", onDidFinishLoad);
      wv.removeEventListener("did-fail-load", onDidFailLoad);
      wv.removeEventListener("crashed", onCrashed);
      clearTimeout(failsafe);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  // Best-effort symbol switching without unmounting. A persisted TradingView
  // session can ignore the URL's ?symbol= and restore the last chart (observed
  // NFLX while the workstation topbar said MNQ1!), so always verify/sync via
  // TradingViewApi after the webview is ready instead of trusting getURL().
  useEffectTv(() => {
    const wv = ref.current;
    if (!wv || !ready) return;
    const target = chartUrl(symbol);
    try {
      if (typeof wv.getURL === "function" && wv.getURL() !== target) {
        wv.loadURL(target);
        return;
      }
    } catch (e) { /* silent */ }
    syncWebviewSymbol(wv, symbol);
  }, [symbol, ready]);

  const retry = () => {
    setReady(false);
    setFailure(null);
    setRetryNonce((n) => n + 1);
    const wv = ref.current;
    try {
      if (wv && typeof wv.reload === "function") wv.reload();
      else if (wv) wv.src = chartUrl(symbol);
    } catch (e) { /* silent */ }
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0b0e13" }}>
      <webview
        ref={ref}
        src={chartUrl(symbol)}
        partition="persist:tradingview"
        allowpopups="true"
        useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        style={{
          width: "100%", height: "100%",
          display: "inline-flex",
          visibility: ready && !failure ? "visible" : "hidden",
        }}
      />
      {!ready && !failure && <TvLoading />}
      {failure && <TvFailed failure={failure} onRetry={retry} />}
    </div>
  );
}

function TvLoading() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 12,
      color: "var(--label)", fontFamily: "var(--mono)",
    }}>
      <div style={{ color: "var(--amber)", letterSpacing: ".22em", fontSize: 11 }}>
        TRADINGVIEW · LOADING
      </div>
      <div style={{ fontSize: 10, letterSpacing: ".06em" }}>
        embedding chart webview…
      </div>
    </div>
  );
}

function TvFailed({ failure, onRetry }) {
  // Compact Raycast card (the one white pill is the sole primary action). The
  // debug line stays as a small secondary readout — useful, but no longer chrome.
  return (
    <div className="cs-tv-fail">
      <span className="cs-tv-fail-ic">▦</span>
      <span className="cs-tv-fail-title">TradingView failed to load</span>
      <span className="cs-tv-fail-sub">webview crashed or network dropped — session state is safe</span>
      <span className="cs-tv-fail-retry" onClick={onRetry}>↻ RETRY</span>
      {failure?.code != null && (
        <div className="cs-tv-fail-dbg">code {String(failure.code)}{failure?.desc ? ` · ${failure.desc}` : ""}</div>
      )}
    </div>
  );
}

// Sign-in banner overlay on the chart — dismissible, remembered in
// localStorage so it doesn't reappear after the user signs in.
function TvSignInBanner() {
  const [dismissed, setDismissed] = useStateTv(() => {
    try { return localStorage.getItem("tv-signin-dismissed") === "1"; }
    catch (e) { return false; }
  });
  if (dismissed) return null;
  const signIn = () => {
    // No dedicated sign-in IPC — focus the webview (best-effort) so the trader
    // can sign in inside the chart, then optimistically hide + remember the
    // dismissal so the banner doesn't reappear once signed in.
    try { window.focus(); } catch (e) { /* noop */ }
    try { localStorage.setItem("tv-signin-dismissed", "1"); } catch (e) { /* noop */ }
    setDismissed(true);
  };
  return (
    <div className="cs-tv-signin">
      <span className="cs-tv-signin-dot" />
      <span className="cs-tv-signin-msg">TradingView session signed out — chart data is paused</span>
      <button className="cs-tv-signin-btn" onClick={signIn}>Sign in</button>
    </div>
  );
}

export { TradingViewChart, TvSignInBanner };
