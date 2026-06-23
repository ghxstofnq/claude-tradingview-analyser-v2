import React from "react";
import { createRoot } from "react-dom/client";
// Bundle real Inter (design.md UI font) — the weights design.md uses: 400 body,
// 500 nav/captions, 600 titles/buttons, 700 display. Vite emits the woff2; the
// --sans token (app.css) lists Inter first, so this is what now renders.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { App } from "./App.jsx";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
