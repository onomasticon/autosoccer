import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/build/**"],
    globalSetup: ["./packages/db/src/test-global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
