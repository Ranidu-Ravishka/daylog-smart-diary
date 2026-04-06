/* eslint-env node */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PNPM_BINARY = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function hasJavaExecutable(javaHome) {
  if (!javaHome) return false;

  const executable = process.platform === "win32" ? "java.exe" : "java";
  return existsSync(`${javaHome}/bin/${executable}`);
}

function parseJavaMajor(versionOutput) {
  const match = versionOutput.match(/version\s+"([^"]+)"/);
  if (!match) return null;

  const rawVersion = match[1];
  const parts = rawVersion.split(".");

  if (parts[0] === "1" && parts.length > 1) {
    const major = Number.parseInt(parts[1] ?? "", 10);
    return Number.isFinite(major) ? major : null;
  }

  const major = Number.parseInt(parts[0] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

function getJavaMajorForHome(javaHome) {
  if (!hasJavaExecutable(javaHome)) return null;

  const executable = process.platform === "win32" ? "java.exe" : "java";
  const result = spawnSync(`${javaHome}/bin/${executable}`, ["-version"], {
    encoding: "utf8",
  });

  if (result.error) return null;

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return parseJavaMajor(output);
}

function isGradleCompatibleJavaHome(javaHome) {
  const major = getJavaMajorForHome(javaHome);
  if (major === null) return false;

  return major >= 17 && major <= 24;
}

function resolveJavaHome() {
  if (isGradleCompatibleJavaHome(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  const candidates = [];

  if (process.platform === "darwin") {
    try {
      const java21 = execFileSync("/usr/libexec/java_home", ["-v", "21"], {
        encoding: "utf8",
      }).trim();
      if (java21) candidates.push(java21);
    } catch {
      // Fallback to Homebrew path below.
    }

    candidates.push(
      "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
      "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
    );
  }

  for (const candidate of candidates) {
    if (isGradleCompatibleJavaHome(candidate)) {
      return candidate;
    }
  }

  return process.env.JAVA_HOME;
}

function main() {
  const javaHome = resolveJavaHome();
  const env = {
    ...process.env,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  };

  if (!javaHome) {
    console.warn(
      "[mobile:android] No compatible JAVA_HOME was auto-detected. Install JDK 21 (e.g. openjdk@21) or set JAVA_HOME manually.",
    );
  }

  if (javaHome) {
    console.log(`[mobile:android] Using JAVA_HOME=${javaHome}`);
  }

  const child = spawn(PNPM_BINARY, ["exec", "expo", "run:android"], {
    stdio: "inherit",
    env,
  });

  child.on("error", (error) => {
    console.error("[mobile:android] Failed to launch Android run:", error);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

main();
