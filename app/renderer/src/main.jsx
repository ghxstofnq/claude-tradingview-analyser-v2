import React from "react";
import { createRoot } from "react-dom/client";
// Inter + JetBrains Mono are self-hosted via @font-face in app.css (variable woff2,
// ss03-capable, offline-safe) — no @fontsource static imports needed.
import { App } from "./App.jsx";

// Test-only fixture adapter (Task D1). The Playwright workflow harness injects a
// sentinel object on window.__GOFNQ_FIXTURE__ (via addInitScript, before this
// module runs) to drive the renderer with fixture state and NO Electron. The
// shipped app never sets that global — in Electron production window.api is
// already provided by preload.cjs — so this branch is dead in production, and
// installFixtureApi() itself hard-throws unless the sentinel is present.
async function boot() {
  const fx = typeof window !== "undefined" ? window.__GOFNQ_FIXTURE__ : null;
  if (fx && fx.__isGofnqFixtureHarness === true && !window.api) {
    const { installFixtureApi } = await import("./fixture-adapter.js");
    installFixtureApi(fx);
  }
  const root = createRoot(document.getElementById("root"));
  root.render(<App />);
}

boot();
