#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(process.env.HOME || ".", ".daylog", "integration_kek.b64");

function printHelp() {
  console.log(`Initialize a local KEK file for development use.

Usage:
  node scripts/init-local-integration-kms.mjs [--path <file>]

Options:
  --path <file>   Path to write the base64-encoded KEK (default: ${defaultPath})
`);
}

function parseArgs(argv) {
  const parsed = { path: defaultPath };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--path") {
      parsed.path = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = dirname(args.path);
  mkdirSync(dir, { recursive: true });

  const key = randomBytes(32);
  const b64 = key.toString("base64");
  writeFileSync(args.path, b64, { encoding: "utf8", mode: 0o600 });

  console.log(JSON.stringify({ path: args.path, created: true }, null, 2));
  console.log(`Set INTEGRATION_SECRETS_LOCAL_KEK_PATH=${args.path} for local runs.`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[init-local-integration-kms] ${message}`);
  process.exit(1);
}
