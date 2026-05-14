#!/usr/bin/env node
/**
 * Fail if built JS artifacts exceed configured ceilings (mobile Expo web export).
 *
 * Usage (from repo root):
 *   node scripts/check-bundle-budgets.mjs
 *
 * Env:
 *   MOBILE_DIST_PATH   — default apps/mobile/dist
 *   MOBILE_WEB_ENTRY_MAX_BYTES — default 6.5 MiB (Expo web entry-* bundle)
 *   SKIP_MOBILE_BUNDLE_BUDGET — set to "1" to skip (e.g. local without mobile build)
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const MOBILE_DIST =
  process.env.MOBILE_DIST_PATH?.trim() || path.join(root, "apps/mobile/dist");
const MOBILE_ENTRY_MAX = Number(
  process.env.MOBILE_WEB_ENTRY_MAX_BYTES ||
    String(Math.floor(6.5 * 1024 * 1024)),
);

async function findFilesRecursive(dir, predicate) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await findFilesRecursive(full, predicate)));
    } else if (ent.isFile() && predicate(full, ent.name)) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  if (process.env.SKIP_MOBILE_BUNDLE_BUDGET === "1") {
    console.log("check-bundle-budgets: SKIP_MOBILE_BUNDLE_BUDGET=1, skipping.");
    return;
  }

  const mobileEntryDir = path.join(
    MOBILE_DIST,
    "_expo",
    "static",
    "js",
    "web",
  );
  const entries = await findFilesRecursive(
    mobileEntryDir,
    (_full, name) => /^entry-.*\.js$/.test(name),
  );

  if (entries.length === 0) {
    console.error(
      `check-bundle-budgets: no Expo web entry-*.js under ${mobileEntryDir}. Run pnpm --filter mobile build:ci first, or set SKIP_MOBILE_BUNDLE_BUDGET=1.`,
    );
    process.exit(1);
  }

  let worst = { file: "", bytes: 0 };
  for (const file of entries) {
    const s = await stat(file);
    if (s.size > worst.bytes) {
      worst = { file, bytes: s.size };
    }
  }

  const mb = (worst.bytes / (1024 * 1024)).toFixed(2);
  console.log(
    `check-bundle-budgets: largest mobile web entry ${path.relative(root, worst.file)} = ${worst.bytes} bytes (${mb} MiB); max ${MOBILE_ENTRY_MAX}.`,
  );

  if (worst.bytes > MOBILE_ENTRY_MAX) {
    console.error(
      `check-bundle-budgets: FAILED — bundle exceeds MOBILE_WEB_ENTRY_MAX_BYTES (${MOBILE_ENTRY_MAX}).`,
    );
    process.exit(1);
  }
}

await main();
