/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // cubing.js ships web workers that Vite's dep optimizer mangles.
  optimizeDeps: { exclude: ["cubing"] },
  worker: { format: "es" },
  // OpenCV.js doesn't initialize inside worker threads, so tests run in child processes.
  test: { pool: "forks" },
});
