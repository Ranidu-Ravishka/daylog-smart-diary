#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultBackendCwd = resolve(scriptDir, "../packages/backend");

function printHelp() {
  console.log(`Run integration token hardening migration and deployment audit gate.

Usage:
  node scripts/run-integration-token-hardening.mjs --target <target> [options]

Targets:
  dev
  prod
  preview:<name>
  deployment:<name>

Options:
  --mode <audit|migrate>       Run mode (default: audit)
  --page-size <n>              Page size for migration and audits (default: 200)
  --max-pages <n>              Max pages to scan (default: 200)
  --max-rows <n>               Max unsafe row previews to return (default: 200)
  --admin-subject <subject>    Admin identity subject for Convex run
  --cwd <path>                 Backend package path (default: packages/backend)
  --help                       Show this message
`);
}

function parseInteger(value, label, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const parsed = {
    target: undefined,
    mode: "audit",
    pageSize: 200,
    maxPages: 200,
    maxRows: 200,
    adminSubject: undefined,
    cwd: defaultBackendCwd,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--") {
      continue;
    }

    if (arg === "--target") {
      parsed.target = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      parsed.mode = argv[index + 1] ?? parsed.mode;
      index += 1;
      continue;
    }

    if (arg === "--page-size") {
      parsed.pageSize = parseInteger(argv[index + 1], "--page-size", parsed.pageSize);
      index += 1;
      continue;
    }

    if (arg === "--max-pages") {
      parsed.maxPages = parseInteger(argv[index + 1], "--max-pages", parsed.maxPages);
      index += 1;
      continue;
    }

    if (arg === "--max-rows") {
      parsed.maxRows = parseInteger(argv[index + 1], "--max-rows", parsed.maxRows);
      index += 1;
      continue;
    }

    if (arg === "--admin-subject") {
      parsed.adminSubject = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--cwd") {
      parsed.cwd = argv[index + 1] ?? parsed.cwd;
      index += 1;
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

  if (parsed.mode !== "audit" && parsed.mode !== "migrate") {
    throw new Error("--mode must be one of: audit, migrate");
  }

  return parsed;
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

  if (result.error) throw result.error;

  if (result.status !== 0 && !options.allowFailure) {
    const message =
      result.stderr?.trim() || result.stdout?.trim() || "Convex command failed";
    throw new Error(message);
  }

  return result;
}

function parseJsonFromOutput(stdout, stderr) {
  const output = `${stdout || ""}\n${stderr || ""}`.trim();
  if (!output) throw new Error("Missing JSON output from Convex command.");

  try {
    return JSON.parse(output);
  } catch {
    // Continue with fallback parsers.
  }

  const tryParseJsLiteral = (candidate) => {
    try {
      return runInNewContext(`(${candidate})`, Object.create(null), {
        timeout: 1000,
      });
    } catch {
      return undefined;
    }
  };

  const firstObjectStart = output.indexOf("{");
  const lastObjectEnd = output.lastIndexOf("}");
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    const candidate = output.slice(firstObjectStart, lastObjectEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      const parsed = tryParseJsLiteral(candidate);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  const firstArrayStart = output.indexOf("[");
  const lastArrayEnd = output.lastIndexOf("]");
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    const candidate = output.slice(firstArrayStart, lastArrayEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      const parsed = tryParseJsLiteral(candidate);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  throw new Error("Unable to parse JSON from Convex output.");
}

function runConvexFunctionJson(cwd, targetFlagList, functionName, args, identitySubject) {
  const commandArgs = [
    "run",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "--identity",
    JSON.stringify({ subject: identitySubject }),
    functionName,
    JSON.stringify(args),
    ...targetFlagList,
  ];

  const result = runConvex(cwd, commandArgs);
  return parseJsonFromOutput(result.stdout, result.stderr);
}

function readAdminSubject(cwd, targetFlagList) {
  const envResult = runConvex(
    cwd,
    ["env", "get", "ADMIN_BOOTSTRAP_CLERK_USER_IDS", ...targetFlagList],
    { allowFailure: true },
  );

  if (envResult.status === 0) {
    const raw = envResult.stdout.trim();
    if (raw) {
      const first = raw
        .split(",")
        .map((value) => value.trim())
        .find(Boolean);
      if (first) return first;
    }
  }

  const userResult = runConvex(
    cwd,
    ["data", "user", "--format", "jsonArray", "--limit", "200", ...targetFlagList],
    { allowFailure: true },
  );

  if (userResult.status === 0) {
    const users = parseJsonFromOutput(userResult.stdout, userResult.stderr);
    if (Array.isArray(users)) {
      const adminUser = users.find(
        (user) => user && user.isAdmin === true && typeof user.clerkUserId === "string",
      );
      if (adminUser?.clerkUserId) return adminUser.clerkUserId;
    }
  }

  throw new Error(
    "Unable to resolve admin subject. Pass --admin-subject explicitly or set ADMIN_BOOTSTRAP_CLERK_USER_IDS.",
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const flags = targetFlags(args.target);
  const adminSubject = args.adminSubject?.trim() || readAdminSubject(args.cwd, flags);

  let migration;
  if (args.mode === "migrate") {
    migration = runConvexFunctionJson(
      args.cwd,
      flags,
      "integrations:adminMigrateLegacyIntegrationTokenRefsAll",
      {
        pageSize: args.pageSize,
        maxPages: args.maxPages,
      },
      adminSubject,
    );
  }

  const nonOpaque = runConvexFunctionJson(
    args.cwd,
    flags,
    "integrations:adminCountLegacyNonOpaqueIntegrationTokenRefs",
    {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    },
    adminSubject,
  );

  const unsafe = runConvexFunctionJson(
    args.cwd,
    flags,
    "integrations:adminAuditUnsafeIntegrationTokenRefs",
    {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
      maxRows: args.maxRows,
    },
    adminSubject,
  );

  const encryption = runConvexFunctionJson(
    args.cwd,
    flags,
    "integrations:adminAuditIntegrationSecretsEncryptionStatus",
    {
      pageSize: args.pageSize,
      maxPages: args.maxPages,
    },
    adminSubject,
  );

  const gate = {
    nonOpaqueCount: Number(nonOpaque.nonOpaqueCount ?? 0),
    unsafeCount: Number(unsafe.unsafeCount ?? 0),
    legacyPlaintextRows: Number(encryption.legacyPlaintextRows ?? 0),
    missingEncryptedAccessRows: Number(encryption.missingEncryptedAccessRows ?? 0),
  };

  gate.passed =
    gate.nonOpaqueCount === 0 &&
    gate.unsafeCount === 0 &&
    gate.legacyPlaintextRows === 0 &&
    gate.missingEncryptedAccessRows === 0;

  const scansComplete = {
    nonOpaqueIsDone: nonOpaque.isDone === true,
    unsafeIsDone: unsafe.isDone === true,
    encryptionIsDone: encryption.isDone === true,
  };

  const result = {
    target: args.target,
    mode: args.mode,
    adminSubject,
    ...(migration ? { migration } : {}),
    audits: {
      nonOpaque,
      unsafe,
      encryption,
    },
    scansComplete,
    gate,
  };

  console.log(JSON.stringify(result, null, 2));

  if (migration && Number(migration.failedCount ?? 0) > 0) {
    process.exitCode = 2;
    return;
  }

  if (!scansComplete.nonOpaqueIsDone || !scansComplete.unsafeIsDone || !scansComplete.encryptionIsDone) {
    process.exitCode = 4;
    return;
  }

  if (!gate.passed) {
    process.exitCode = 3;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(`[run-integration-token-hardening] ${message}`);
  process.exit(1);
}
