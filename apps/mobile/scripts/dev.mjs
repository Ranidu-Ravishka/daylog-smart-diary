/* eslint-env node */

import { spawn } from "node:child_process";
import process from "node:process";

const PNPM_BINARY = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runExpo(args, inspectOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(PNPM_BINARY, ["exec", "expo", "start", ...args], {
      stdio: inspectOutput ? ["inherit", "pipe", "pipe"] : "inherit",
      env: process.env,
    });

    let output = "";

    if (inspectOutput) {
      const pipeWithCapture = (target) => {
        return (chunk) => {
          const text = chunk.toString();
          output += text;
          target.write(chunk);
        };
      };

      child.stdout?.on("data", pipeWithCapture(process.stdout));
      child.stderr?.on("data", pipeWithCapture(process.stderr));
    }

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      const sawMissingDevBuild =
        output.includes("CommandError: No development build") ||
        (output.includes("No development build") &&
          output.includes("for this project is installed"));
      const sawIosOpenTimeout =
        output.includes("xcrun simctl openurl") &&
        (output.includes("Operation timed out") || output.includes("code=60"));

      resolve({
        code: code ?? 1,
        sawMissingDevBuild,
        sawIosOpenTimeout,
      });
    });
  });
}

async function main() {
  const iosAttempt = await runExpo(["--ios", "--port", "3002"], true);

  if (iosAttempt.code === 0) {
    return;
  }

  if (iosAttempt.sawMissingDevBuild) {
    console.warn(
      "[mobile:dev] iOS development build is not installed; falling back to Expo Go server on port 3002.",
    );

    const fallbackAttempt = await runExpo(
      ["--port", "3002", "--go", "--ios"],
      false,
    );
    process.exit(fallbackAttempt.code);
    return;
  }

  if (iosAttempt.sawIosOpenTimeout) {
    console.warn(
      "[mobile:dev] iOS simulator open timed out; continuing with Metro on port 3002 without auto-open.",
    );

    const fallbackAttempt = await runExpo(
      ["--port", "3002", "--dev-client"],
      false,
    );
    process.exit(fallbackAttempt.code);
    return;
  }

  process.exit(iosAttempt.code);
}

main().catch((error) => {
  console.error("[mobile:dev] Failed to start Expo:", error);
  process.exit(1);
});
