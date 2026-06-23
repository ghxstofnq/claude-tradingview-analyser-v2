import React from "react";
import { createRoot } from "react-dom/client";
// Inter + JetBrains Mono are self-hosted via @font-face in app.css (variable woff2,
// ss03-capable, offline-safe) — no @fontsource static imports needed.
import { App } from "./App.jsx";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
