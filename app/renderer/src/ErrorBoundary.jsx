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

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[error-boundary]", this.props.label || "panel", "crashed:", error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
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
            This panel hit a render error. The rest of the app is still working.
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
                  style={{
                    background: "transparent",
                    border: "1px solid var(--amber)",
                    color: "var(--amber)",
                    padding: "4px 12px",
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 10,
                    letterSpacing: ".16em",
                    cursor: "pointer",
                  }}>
            [ TRY AGAIN ]
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
