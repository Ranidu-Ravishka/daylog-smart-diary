import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      // @ts-expect-error Vitest runtime supports this option; local types lag.
      all: true,
      reporter: ["text", "lcov"],
      // Keep source coverage strict whether vitest runs from repo root or package root.
      include: ["packages/backend/convex/**/*.ts", "convex/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/__tests__/**",
        "test-utils/**",
        "**/__mocks__/**",
        "**/mocks/**",
        "**/_generated/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 59,
        statements: 77,
      },
    },
  },
});
