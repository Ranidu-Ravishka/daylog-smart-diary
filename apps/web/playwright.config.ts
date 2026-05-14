import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

const port = Number(process.env.PLAYWRIGHT_WEB_PORT || "3010");
const host = process.env.PLAYWRIGHT_WEB_HOST || "127.0.0.1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://${host}:${port}`;

/**
 * E2E against a running Next server. In CI we start `next start` via webServer.
 * Locally: reuse an existing dev/preview server with PLAYWRIGHT_BASE_URL, or let webServer start.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: `pnpm exec next start -p ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        cwd: webRoot,
        // `clerkMiddleware` requires CLERK_SECRET_KEY for `next start`; CI uses a non-sensitive placeholder.
        env: {
          CLERK_SECRET_KEY:
            process.env.CLERK_SECRET_KEY ?? "sk_test_placeholder",
        },
      },
});
