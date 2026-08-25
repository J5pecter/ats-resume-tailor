import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    testTimeout: 30_000,
  },
});
