#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultBackendCwd = resolve(scriptDir, "../packages/backend");

function parseArgs(argv) {
  const parsed = {
    target: undefined,
    newKeyId: undefined,
    dryRun: false,
    cwd: defaultBackendCwd,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--target") {
      parsed.target = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--new-key-id") {
      parsed.newKeyId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--cwd") {
      parsed.cwd = argv[index + 1] ?? parsed.cwd;
      index += 1;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.target) {
    throw new Error("Missing required argument: --target");
  }

  return parsed;
}

function printHelp() {
  console.log(`Rotate SENSITIVE_DATA keyring env vars on a Convex deployment.

Usage:
  node scripts/rotate-sensitive-data-keyring.mjs --target <target> [options]

Targets:
  dev
  prod
  preview:<name>
  deployment:<name>

Options:
  --new-key-id <id>   Explicit key id to activate (default: generated id)
  --dry-run           Compute and print plan without writing env vars
  --cwd <path>        Backend package path (default: packages/backend)
  --help              Show this message
`);
}

function targetFlags(target) {
  if (target === "dev") return [];
  if (target === "prod") return ["--prod"];
  if (target.startsWith("preview:")) {
    const name = target.slice("preview:".length).trim();
    if (!name) throw new Error("Preview target is missing a name.");
    return ["--preview-name", name];
  }
  if (target.startsWith("deployment:")) {
    const name = target.slice("deployment:".length).trim();
    if (!name) throw new Error("Deployment target is missing a name.");
    return ["--deployment-name", name];
  }

  throw new Error(
    `Unsupported target: ${target}. Use dev, prod, preview:<name>, or deployment:<name>.`,
  );
}

function runConvex(cwd, args, options = {}) {
  const result = spawnSync("pnpm", ["exec", "convex", ...args], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const message =
      result.stderr?.trim() || result.stdout?.trim() || "Convex command failed";
    throw new Error(message);
  }

  return result;
}

function tryReadKeyringJson(cwd, flags) {
  const result = runConvex(
    cwd,
    ["env", "get", "SENSITIVE_DATA_KEYRING_JSON", ...flags],
    { allowFailure: true },
  );

  if (result.status === 0) {
    return result.stdout.trim() || "{}";
  }

  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    combined.includes("not found") ||
    combined.includes("not set") ||
    combined.includes("does not exist")
  ) {
    return "{}";
  }

  throw new Error(result.stderr?.trim() || "Failed to read keyring env var");
}

function sanitizeTarget(target) {
  return target.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildDefaultKeyId(target) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `sd_${stamp}_${sanitizeTarget(target).toLowerCase()}`;
}

function ensureUniqueKeyId(desired, keyring) {
  if (!Object.prototype.hasOwnProperty.call(keyring, desired)) {
    return desired;
  }

  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(keyring, `${desired}_${suffix}`)) {
    suffix += 1;
  }

  return `${desired}_${suffix}`;
}

function parseKeyring(jsonValue) {
  if (!jsonValue?.trim()) return {};

  let parsed;
  try {
    parsed = JSON.parse(jsonValue);
  } catch {
    throw new Error("SENSITIVE_DATA_KEYRING_JSON is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SENSITIVE_DATA_KEYRING_JSON must be a JSON object.");
  }

  for (const [keyId, keyMaterial] of Object.entries(parsed)) {
    if (!keyId.trim() || typeof keyMaterial !== "string" || !keyMaterial.trim()) {
      throw new Error("SENSITIVE_DATA_KEYRING_JSON contains invalid entries.");
    }
  }

  return { ...parsed };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const flags = targetFlags(args.target);

  const existingJson = tryReadKeyringJson(args.cwd, flags);
  const keyring = parseKeyring(existingJson);

  const desiredKeyId = args.newKeyId?.trim() || buildDefaultKeyId(args.target);
  const nextKeyId = ensureUniqueKeyId(desiredKeyId, keyring);
  const nextKeyValue = randomBytes(32).toString("base64");

  keyring[nextKeyId] = nextKeyValue;

  const keyIds = Object.keys(keyring).sort();

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          target: args.target,
          dryRun: true,
          activeKeyId: nextKeyId,
          keyCountBefore: keyIds.length - 1,
          keyCountAfter: keyIds.length,
          keyIds,
        },
        null,
        2,
      ),
    );
    return;
  }

  runConvex(args.cwd, [
    "env",
    "set",
    "SENSITIVE_DATA_KEYRING_JSON",
    JSON.stringify(keyring),
    ...flags,
  ]);

  runConvex(args.cwd, [
    "env",
    "set",
    "SENSITIVE_DATA_ACTIVE_KEY_ID",
    nextKeyId,
    ...flags,
  ]);

  console.log(
    JSON.stringify(
      {
        target: args.target,
        activeKeyId: nextKeyId,
        keyCount: keyIds.length,
        keyIds,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(`[rotate-sensitive-data-keyring] ${message}`);
  process.exit(1);
}
