import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./" keeps every asset path relative, so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: { chunkSizeWarningLimit: 2000 },
});
