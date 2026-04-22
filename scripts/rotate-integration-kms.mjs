#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultBackendCwd = resolve(scriptDir, "../packages/backend");

function printHelp() {
  console.log(`Rotate integration secrets to a new KMS key and re-encrypt DB records.

Usage:
  node scripts/rotate-integration-kms.mjs --target <target> --new-key-id <keyId> [--dry-run] [--admin-subject <subject>] [--cwd <path>]

Targets:
  dev
  prod
  preview:<name>
  deployment:<name>

Options:
  --new-key-id <id>         New KMS key id (required)
  --dry-run                 Do not write DB changes; just compute plan
  --admin-subject <subject> Admin identity subject for Convex run
  --cwd <path>              Backend package path (default: packages/backend)
  --help                    Show this message
`);
}

function parseArgs(argv) {
  const parsed = { target: undefined, newKeyId: undefined, dryRun: false, adminSubject: undefined, cwd: defaultBackendCwd };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--target") {
      parsed.target = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--new-key-id") {
      parsed.newKeyId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--admin-subject") {
      parsed.adminSubject = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--cwd") {
      parsed.cwd = argv[i + 1] ?? parsed.cwd;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.target) throw new Error("Missing required argument: --target");
  if (!parsed.newKeyId) throw new Error("Missing required argument: --new-key-id");
  return parsed;
}

function targetFlags(target) {
  if (target === "dev") return [];
  if (target === "prod") return ["--prod"];
  if (target.startsWith("preview:")) return ["--preview-name", target.slice("preview:".length).trim()];
  if (target.startsWith("deployment:")) return ["--deployment-name", target.slice("deployment:".length).trim()];
  throw new Error(`Unsupported target: ${target}. Use dev, prod, preview:<name>, or deployment:<name>.`);
}

function runConvex(cwd, args, options = {}) {
  const result = spawnSync("pnpm", ["exec", "convex", ...args], { cwd, encoding: "utf8", stdio: "pipe" });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const msg = result.stderr?.trim() || result.stdout?.trim() || "Convex command failed";
    throw new Error(msg);
  }
  return result;
}

function parseJsonFromOutput(stdout, stderr) {
  const output = `${stdout || ""}\n${stderr || ""}`.trim();
  if (!output) throw new Error("Missing JSON output from Convex command.");
  try { return JSON.parse(output); } catch {}

  // Try to locate JSON within mixed output
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = output.slice(first, last + 1);
    try { return JSON.parse(candidate); } catch {
      try { return runInNewContext(`(${candidate})`, Object.create(null), { timeout: 1000 }); } catch {}
    }
  }
  throw new Error("Unable to parse JSON from Convex output.");
}

function runConvexFunctionJson(cwd, targetFlagList, functionName, args, identitySubject) {
  const commandArgs = ["run", "--typecheck", "disable", "--codegen", "disable", "--identity", JSON.stringify({ subject: identitySubject }), functionName, JSON.stringify(args), ...targetFlagList];
  const result = runConvex(cwd, commandArgs);
  return parseJsonFromOutput(result.stdout, result.stderr);
}

function readAdminSubject(cwd, targetFlagList) {
  const envResult = runConvex(cwd, ["env", "get", "ADMIN_BOOTSTRAP_CLERK_USER_IDS", ...targetFlagList], { allowFailure: true });
  if (envResult.status === 0) {
    const raw = envResult.stdout.trim();
    if (raw) {
      const first = raw.split(",").map((s) => s.trim()).find(Boolean);
      if (first) return first;
    }
  }

  const userResult = runConvex(cwd, ["data", "user", "--format", "jsonArray", "--limit", "200", ...targetFlagList], { allowFailure: true });
  if (userResult.status === 0) {
    const users = parseJsonFromOutput(userResult.stdout, userResult.stderr);
    if (Array.isArray(users)) {
      const adminUser = users.find((u) => u && u.isAdmin === true && typeof u.clerkUserId === "string");
      if (adminUser?.clerkUserId) return adminUser.clerkUserId;
    }
  }

  throw new Error("Unable to resolve admin subject. Pass --admin-subject explicitly or set ADMIN_BOOTSTRAP_CLERK_USER_IDS.");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const flags = targetFlags(args.target);

  // Set KMS key id in Convex environment
  runConvex(args.cwd, ["env", "set", "INTEGRATION_SECRETS_KMS_KEY_ID", args.newKeyId, ...flags]);

  const adminSubject = args.adminSubject ?? readAdminSubject(args.cwd, flags);

  const functionName = "integrationSecrets.admin:adminRotateIntegrationSecretKeys";
  const fnArgs = { newKeyId: args.newKeyId, dryRun: args.dryRun };

  const result = runConvexFunctionJson(args.cwd, flags, functionName, fnArgs, adminSubject);

  console.log(JSON.stringify({ target: args.target, newKeyId: args.newKeyId, result }, null, 2));
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[rotate-integration-kms] ${message}`);
  process.exit(1);
}
