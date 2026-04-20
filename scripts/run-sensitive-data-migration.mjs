#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultBackendCwd = resolve(scriptDir, "../packages/backend");
const migrationTables = [
  "memories",
  "days",
  "daySummaries",
  "integrationDailyData",
];

function printHelp() {
  console.log(`Run sensitive-data migration and post-migration risk audit.

Usage:
  node scripts/run-sensitive-data-migration.mjs --target <target> [options]

Targets:
  dev
  prod
  preview:<name>
  deployment:<name>

Options:
  --mode <dry-run|full>           Migration mode (default: dry-run)
  --batch-size <n>                Migration batch size (default: 200)
  --max-batches-per-table <n>     Max batches per table (default: 200)
  --audit-batch-size <n>          Audit batch size (default: 200)
  --admin-subject <subject>       Admin identity subject for Convex run
  --skip-audit                    Skip post-migration audit query
  --cwd <path>                    Backend package path (default: packages/backend)
  --help                          Show this message
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
    mode: "dry-run",
    batchSize: 200,
    maxBatchesPerTable: 200,
    auditBatchSize: 200,
    adminSubject: undefined,
    skipAudit: false,
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

    if (arg === "--mode") {
      parsed.mode = argv[index + 1] ?? parsed.mode;
      index += 1;
      continue;
    }

    if (arg === "--batch-size") {
      parsed.batchSize = parseInteger(argv[index + 1], "--batch-size", parsed.batchSize);
      index += 1;
      continue;
    }

    if (arg === "--max-batches-per-table") {
      parsed.maxBatchesPerTable = parseInteger(
        argv[index + 1],
        "--max-batches-per-table",
        parsed.maxBatchesPerTable,
      );
      index += 1;
      continue;
    }

    if (arg === "--audit-batch-size") {
      parsed.auditBatchSize = parseInteger(
        argv[index + 1],
        "--audit-batch-size",
        parsed.auditBatchSize,
      );
      index += 1;
      continue;
    }

    if (arg === "--admin-subject") {
      parsed.adminSubject = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--skip-audit") {
      parsed.skipAudit = true;
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

  if (parsed.mode !== "dry-run" && parsed.mode !== "full") {
    throw new Error("--mode must be one of: dry-run, full");
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
    // Fall through and try to locate JSON payload within mixed output.
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

function emptyAuditTotals(table) {
  return {
    table,
    scanned: 0,
    needsMigrationRows: 0,
    plaintextRows: 0,
    sealedRows: 0,
    missingNonceRows: 0,
    missingNonceRejectRiskRows: 0,
    migratedRows: 0,
    migratedWithPlaintextRows: 0,
    validationRejectRiskRows: 0,
    pages: 0,
  };
}

function accumulateAuditTotals(target, page) {
  target.scanned += page.scanned;
  target.needsMigrationRows += page.needsMigrationRows;
  target.plaintextRows += page.plaintextRows;
  target.sealedRows += page.sealedRows;
  target.missingNonceRows += page.missingNonceRows;
  target.missingNonceRejectRiskRows += page.missingNonceRejectRiskRows;
  target.migratedRows += page.migratedRows;
  target.migratedWithPlaintextRows += page.migratedWithPlaintextRows;
  target.validationRejectRiskRows += page.validationRejectRiskRows;
  target.pages += 1;
}

function auditTable(cwd, targetFlagList, table, auditBatchSize, adminSubject) {
  const totals = emptyAuditTotals(table);
  let cursor;
  let guard = 0;

  while (true) {
    guard += 1;
    if (guard > 10000) {
      throw new Error(`Audit pagination exceeded guard limit for ${table}.`);
    }

    const args = {
      table,
      batchSize: auditBatchSize,
      ...(cursor ? { cursor } : {}),
    };

    const page = runConvexFunctionJson(
      cwd,
      targetFlagList,
      "sensitiveDataMigration:adminAuditSensitiveDataTableStatus",
      args,
      adminSubject,
    );

    accumulateAuditTotals(totals, page);

    if (page.done || !page.nextCursor) {
      break;
    }

    cursor = page.nextCursor;
  }

  return totals;
}

function mergeOverallAudit(auditByTable) {
  const overall = {
    scanned: 0,
    needsMigrationRows: 0,
    plaintextRows: 0,
    sealedRows: 0,
    missingNonceRows: 0,
    missingNonceRejectRiskRows: 0,
    migratedRows: 0,
    migratedWithPlaintextRows: 0,
    validationRejectRiskRows: 0,
  };

  for (const row of auditByTable) {
    overall.scanned += row.scanned;
    overall.needsMigrationRows += row.needsMigrationRows;
    overall.plaintextRows += row.plaintextRows;
    overall.sealedRows += row.sealedRows;
    overall.missingNonceRows += row.missingNonceRows;
    overall.missingNonceRejectRiskRows += row.missingNonceRejectRiskRows;
    overall.migratedRows += row.migratedRows;
    overall.migratedWithPlaintextRows += row.migratedWithPlaintextRows;
    overall.validationRejectRiskRows += row.validationRejectRiskRows;
  }

  return overall;
}

function summarizeMigration(migrationResult) {
  const tableSummaries = Array.isArray(migrationResult.results)
    ? migrationResult.results
    : [];
  const totals =
    migrationResult.totals && typeof migrationResult.totals === "object"
      ? migrationResult.totals
      : {};
  const completeTables = tableSummaries.filter((entry) => entry.complete).length;
  const totalTables = tableSummaries.length;

  return {
    scanned: totals.scanned ?? 0,
    migrated: totals.migrated ?? 0,
    plaintextDetected: totals.plaintextDetected ?? 0,
    failed: totals.failed ?? 0,
    completeTables,
    totalTables,
    tableSummaries,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const flags = targetFlags(args.target);

  const adminSubject = args.adminSubject?.trim() || readAdminSubject(args.cwd, flags);

  const migrationPayload = {
    batchSize: args.batchSize,
    maxBatchesPerTable: args.maxBatchesPerTable,
    dryRun: args.mode === "dry-run",
  };

  const migration = runConvexFunctionJson(
    args.cwd,
    flags,
    "sensitiveDataMigration:adminMigrateAllSensitiveData",
    migrationPayload,
    adminSubject,
  );

  const migrationSummary = summarizeMigration(migration);

  const result = {
    target: args.target,
    mode: args.mode,
    adminSubject,
    migration: migrationSummary,
  };

  if (!args.skipAudit) {
    const auditByTable = migrationTables.map((table) =>
      auditTable(args.cwd, flags, table, args.auditBatchSize, adminSubject),
    );
    result.auditByTable = auditByTable;
    result.auditOverall = mergeOverallAudit(auditByTable);
  }

  console.log(JSON.stringify(result, null, 2));

  if (migrationSummary.failed > 0) {
    process.exitCode = 2;
    return;
  }

  if (args.mode === "full" && migrationSummary.completeTables < migrationSummary.totalTables) {
    process.exitCode = 3;
    return;
  }

  if (!args.skipAudit && result.auditOverall.validationRejectRiskRows > 0) {
    process.exitCode = 4;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  console.error(`[run-sensitive-data-migration] ${message}`);
  process.exit(1);
}
