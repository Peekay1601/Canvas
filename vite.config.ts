import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file (MCP App resources can't load sibling files), written to docs/
// so GitHub Pages (main, /docs) serves it at https://peekay1601.github.io/Canvas/
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: "docs", emptyOutDir: true },
});
