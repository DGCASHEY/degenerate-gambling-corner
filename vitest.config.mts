import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/db/global-setup.ts"],
    // Real database work (row locks, deliberate waits) is slower than the
    // default 5 seconds allows on a cold start.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
