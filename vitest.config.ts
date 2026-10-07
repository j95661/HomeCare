import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.emulator.test.ts", "node_modules", "dist", "functions"],
    testTimeout: 20000,
  },
});
