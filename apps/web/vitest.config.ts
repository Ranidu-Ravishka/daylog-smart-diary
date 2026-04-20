import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "app/api/integrations/oauth/*.test.ts",
      "app/api/integrations/oauth/**/*.test.ts",
      "app/api/observability/**/*.test.ts",
    ],
    passWithNoTests: false,
    clearMocks: true,
  },
});
