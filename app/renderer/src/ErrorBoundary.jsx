// ErrorBoundary — catch render-time errors in one region so they don't
// blank-screen the whole app (Task C5 containment).
//
// React only catches errors thrown during render / lifecycle / constructor
// via class components implementing componentDidCatch. Functional
// equivalents (react-error-boundary) require a dep — this one-screen
// class is enough.
//
// Two variants:
//   "page"      — a non-money panel crash: RETRY only. Sibling regions (TopBar,
//                 chart, palette) keep rendering; a crash in one page never
//                 takes down the shell.
//   "emergency" — a money-path region (LIVE / ORDERS): RETRY + OPEN SYSTEM +
//                 a broker-CONFIRMED FLATTEN, so a crashed trade surface can
//                 still be flattened and diagnosed without a full restart. The
//                 FLATTEN shows the broker's actual returned ok/realized — never
//                 a fire-and-forget "done".
//
// resetKey: when it changes (e.g. the active page) the boundary clears its
// caught error so switching away from a crashed page recovers automatically.

import React from "react";
import { MAX_RETRIES, boundaryActions, isEmergency, retriesExhausted, shouldReset } from "./ErrorBoundary.helpers.js";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retries: 0, flatMsg: null, flatting: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    // Per-page reset: a changed resetKey clears the caught error.
    if (props.resetKey !== undefined && props.resetKey !== state._resetKey) {
      return { _resetKey: props.resetKey, error: null, flatMsg: null };
    }
    return null;
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[error-boundary]", this.props.label || "panel", "crashed:", error, info?.componentStack);
  }

  reset = () => {
    this.setState((s) => ({ error: null, flatMsg: null, retries: s.retries + 1 }));
  };

  openSystem = () => {
    try { this.props.onOpenSystem?.(); } catch { /* best-effort */ }
  };

  // Broker-CONFIRMED flatten — call the real close and surface the returned
  // ok/realized (broker truth), not a fire-and-forget. onFlatten (if provided)
  // owns the call; otherwise hit execution.flatten directly.
  flatten = async () => {
    this.setState({ flatting: true, flatMsg: null });
    try {
      const r = this.props.onFlatten
        ? await this.props.onFlatten()
        : await window.api?.execution?.flatten?.({});
      const ok = r?.ok === true;
      const realized = Number.isFinite(r?.realized) ? ` · ${r.realized >= 0 ? "+$" : "-$"}${Math.abs(r.realized).toLocaleString("en-US")} realized` : "";
      this.setState({ flatting: false, flatMsg: ok ? `FLATTENED at market${realized}` : `FLATTEN FAILED — ${r?.error || "broker rejected"}` });
    } catch (e) {
      this.setState({ flatting: false, flatMsg: `FLATTEN FAILED — ${String(e?.message || e)}` });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const variant = this.props.variant || "page";
    const exhausted = retriesExhausted(this.state.retries, MAX_RETRIES);
    const actions = boundaryActions(variant);
    const btn = (extra) => ({
      background: "transparent",
      border: "1px solid " + (extra?.tone || "var(--border, #2a3038)"),
      color: extra?.color || "var(--label)",
      padding: "4px 12px",
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 10,
      letterSpacing: ".16em",
      cursor: extra?.disabled ? "not-allowed" : "pointer",
      marginRight: 8,
    });

    return (
      <div style={{ padding: "24px", fontFamily: "ui-monospace, Menlo, monospace", color: "var(--label)", fontSize: 12 }}>
        <div style={{ color: "var(--red, #f0796a)", fontSize: 11, letterSpacing: ".16em", marginBottom: 8 }}>
          [ {this.props.label || "PANEL"} CRASHED{isEmergency(variant) ? " · MONEY-PATH" : ""} ]
        </div>
        <div style={{ marginBottom: 12, lineHeight: 1.6 }}>
          {exhausted
            ? `This region has crashed ${this.state.retries} times — the error looks deterministic. ${isEmergency(variant) ? "Flatten any open position, then restart the app." : "Restart the app to recover."}`
            : "This region hit a render error. The rest of the app is still working."}
        </div>
        <div style={{ background: "var(--surface-1)", padding: "8px 12px", color: "var(--prose)", fontSize: 11, marginBottom: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
          {actions.includes("retry") && (
            <button onClick={this.reset} disabled={exhausted}
                    style={btn({ tone: exhausted ? undefined : "var(--amber)", color: exhausted ? "var(--label)" : "var(--amber)", disabled: exhausted })}>
              {exhausted ? "[ EXHAUSTED — RESTART ]" : `[ RETRY (${MAX_RETRIES - this.state.retries} left) ]`}
            </button>
          )}
          {actions.includes("open_system") && (
            <button onClick={this.openSystem} style={btn({})}>[ OPEN SYSTEM ]</button>
          )}
          {actions.includes("flatten") && (
            <button onClick={this.flatten} disabled={this.state.flatting}
                    style={btn({ tone: "var(--red)", color: "var(--red)", disabled: this.state.flatting })}>
              {this.state.flatting ? "[ FLATTENING… ]" : "[ FLATTEN POSITION ]"}
            </button>
          )}
        </div>
        {this.state.flatMsg && (
          <div style={{ marginTop: 10, fontSize: 11, color: /FAILED/.test(this.state.flatMsg) ? "var(--red)" : "var(--green)" }}>
            {this.state.flatMsg}
          </div>
        )}
      </div>
    );
  }
}
