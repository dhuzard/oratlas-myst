import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    // The MyST integration test runs a real `myst build`, which is slow.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
