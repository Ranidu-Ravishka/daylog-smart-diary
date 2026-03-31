import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["convex/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "lcov"],
      include: ["convex/**/*.behavior.test.ts", "test-utils/inMemoryConvex.ts"],
      exclude: ["convex/_generated/**"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
