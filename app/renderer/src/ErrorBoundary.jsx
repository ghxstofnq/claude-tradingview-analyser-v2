// ErrorBoundary — catch render-time errors in one panel so they don't
// blank-screen the whole app.
//
// React only catches errors thrown during render / lifecycle / constructor
// via class components implementing componentDidCatch. Functional
// equivalents (react-error-boundary) require a dep — this one-screen
// class is enough.
//
// Per-mode wrapping: each top-level workstation (PREP / LIVE / REVIEW)
// gets its own boundary. A crash in LIVE doesn't take down PREP.

import React from "react";

// Cap retries so a deterministic render error (bad data shape, etc)
// doesn't let the user click [TRY AGAIN] forever, hitting the same
// error each time. After MAX_RETRIES the button is disabled and the
// user is told to restart.
const MAX_RETRIES = 3;

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, retries: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[error-boundary]", this.props.label || "panel", "crashed:", error, info?.componentStack);
  }

  reset = () => {
    this.setState((s) => ({ error: null, retries: s.retries + 1 }));
  };

  render() {
    if (this.state.error) {
      const exhausted = this.state.retries >= MAX_RETRIES;
      return (
        <div style={{
          padding: "24px",
          fontFamily: "ui-monospace, Menlo, monospace",
          color: "var(--label)",
          fontSize: 12,
        }}>
          <div style={{
            color: "var(--red, #f0796a)",
            fontSize: 11,
            letterSpacing: ".16em",
            marginBottom: 8,
          }}>
            [ {this.props.label || "PANEL"} CRASHED ]
          </div>
          <div style={{ marginBottom: 12, lineHeight: 1.6 }}>
            {exhausted
              ? `This panel has crashed ${this.state.retries} times — the error looks deterministic. Restart the app to recover.`
              : "This panel hit a render error. The rest of the app is still working."}
          </div>
          <div style={{
            background: "var(--surface-1)",
            padding: "8px 12px",
            color: "var(--prose)",
            fontSize: 11,
            marginBottom: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button onClick={this.reset}
                  disabled={exhausted}
                  style={{
                    background: "transparent",
                    border: "1px solid " + (exhausted ? "var(--border, #2a3038)" : "var(--amber)"),
                    color: exhausted ? "var(--label)" : "var(--amber)",
                    padding: "4px 12px",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 10,
                    letterSpacing: ".16em",
                    cursor: exhausted ? "not-allowed" : "pointer",
                  }}>
            {exhausted ? "[ EXHAUSTED — RESTART ]" : `[ TRY AGAIN (${MAX_RETRIES - this.state.retries} left) ]`}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
