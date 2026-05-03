import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/e2e.spec.ts"],
    testTimeout: 45_000,
    hookTimeout: 25_000,
  },
});
