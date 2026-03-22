/* eslint-env node */

import { createServer } from "node:net";
import { spawn } from "node:child_process";
import process from "node:process";

function canUsePort(port) {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "0.0.0.0");
  });
}

async function pickPort(preferredPort) {
  if (await canUsePort(preferredPort)) return preferredPort;

  for (let port = preferredPort + 1; port <= preferredPort + 20; port += 1) {
    if (await canUsePort(port)) return port;
  }

  throw new Error(`No free port found between ${preferredPort} and ${preferredPort + 20}`);
}

async function main() {
  const preferredPort = 3000;
  const selectedPort = await pickPort(preferredPort);

  if (selectedPort !== preferredPort) {
    console.warn(
      `[web:dev] Port ${preferredPort} is busy; starting on ${selectedPort} instead.`,
    );
  }

  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "next", "dev", "--webpack", "--port", String(selectedPort)],
    {
      stdio: "inherit",
      env: process.env,
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error("[web:dev] Failed to start:", error);
  process.exit(1);
});
