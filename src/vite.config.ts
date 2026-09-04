import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  // ws:true wajib — tanpa itu proxy menjawab upgrade /api/terminal/... dengan 404 HTTP.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
  build: {
    outDir: "dist",
    // ADR-0160 · vendor yang jarang berubah dipisah dari kode app supaya cache browser bertahan
    // lintas rilis hanoman; layar berat sudah jadi chunk sendiri lewat React.lazy di App.tsx.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
          highlight: ["highlight.js"],
          markdown: ["marked", "dompurify"],
        },
      },
    },
  },
  test: { environment: "jsdom", setupFiles: "./test/setup.ts", globals: true },
});
