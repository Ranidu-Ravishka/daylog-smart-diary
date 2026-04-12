/* eslint-env node */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const PNPM_BINARY = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const DEFAULT_ANDROID_SDK_ROOT =
  process.env.ANDROID_SDK_ROOT ??
  process.env.ANDROID_HOME ??
  (process.platform === "darwin" ? `${process.env.HOME}/Library/Android/sdk` : null);

function resolveBinary(explicitPath, commandName) {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  const commandResult = spawnSync(commandName, ["--version"], {
    encoding: "utf8",
  });

  if (!commandResult.error) {
    return commandName;
  }

  return null;
}

function getAdbBinary() {
  const sdkPath = DEFAULT_ANDROID_SDK_ROOT
    ? `${DEFAULT_ANDROID_SDK_ROOT}/platform-tools/adb`
    : null;

  return resolveBinary(sdkPath, "adb");
}

function getEmulatorBinary() {
  const sdkPath = DEFAULT_ANDROID_SDK_ROOT
    ? `${DEFAULT_ANDROID_SDK_ROOT}/emulator/emulator`
    : null;

  return resolveBinary(sdkPath, "emulator");
}

function getConnectedAndroidDeviceSerials(adbBinary) {
  const result = spawnSync(adbBinary, ["devices"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return [];

  const lines = (result.stdout ?? "").split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("List of devices"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => parts[0])
    .filter(Boolean);
}

function getFirstAvailableAvd(emulatorBinary) {
  const result = spawnSync(emulatorBinary, ["-list-avds"], {
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) return null;

  const avd = (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return avd ?? null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAndroidDeviceBoot(adbBinary, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const serials = getConnectedAndroidDeviceSerials(adbBinary);
    if (serials.length > 0) {
      const serial = serials[0];
      const bootResult = spawnSync(
        adbBinary,
        ["-s", serial, "shell", "getprop", "sys.boot_completed"],
        { encoding: "utf8" },
      );

      const bootCompleted = (bootResult.stdout ?? "").trim() === "1";
      if (bootCompleted) {
        console.log(`[mobile:android] Android device ready (${serial}).`);
        return true;
      }
    }

    await sleep(2000);
  }

  return false;
}

async function ensureAndroidDeviceReady(env) {
  const adbBinary = getAdbBinary();
  if (!adbBinary) {
    console.warn(
      "[mobile:android] adb not found. Continuing; Expo may fail if no Android device is connected.",
    );
    return;
  }

  const connected = getConnectedAndroidDeviceSerials(adbBinary);
  if (connected.length > 0) {
    console.log(`[mobile:android] Using existing Android device (${connected[0]}).`);
    return;
  }

  const emulatorBinary = getEmulatorBinary();
  if (!emulatorBinary) {
    console.warn(
      "[mobile:android] Android emulator binary not found. Connect a device or install Android SDK emulator tools.",
    );
    return;
  }

  const avd = getFirstAvailableAvd(emulatorBinary);
  if (!avd) {
    console.warn(
      "[mobile:android] No AVD found. Create one in Android Studio > Device Manager.",
    );
    return;
  }

  console.log(`[mobile:android] Starting emulator (${avd})...`);
  const emulatorArgs = ["-avd", avd, "-netdelay", "none", "-netspeed", "full"];

  // Prefer software rendering on Apple Silicon to reduce intermittent emulator GPU crashes.
  if (process.platform === "darwin") {
    emulatorArgs.push("-gpu", "swiftshader_indirect");
  }

  const emulatorProcess = spawn(emulatorBinary, emulatorArgs, {
    env,
    detached: true,
    stdio: "ignore",
  });
  emulatorProcess.unref();

  const ready = await waitForAndroidDeviceBoot(adbBinary, 180_000);
  if (!ready) {
    console.warn(
      "[mobile:android] Timed out waiting for emulator boot. Expo run may still fail until emulator fully starts.",
    );
  }
}

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

async function main() {
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

  await ensureAndroidDeviceReady(env);

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

main().catch((error) => {
  console.error("[mobile:android] Unexpected failure:", error);
  process.exit(1);
});
