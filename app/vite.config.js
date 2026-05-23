import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("renderer"),
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true,
  },
});
