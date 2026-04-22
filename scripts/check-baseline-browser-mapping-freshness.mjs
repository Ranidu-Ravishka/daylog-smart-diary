#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  const fullPath = path.join(rootDir, relativePath);
  const contents = await readFile(fullPath, "utf8");
  return JSON.parse(contents);
}

async function fetchLatestBaselineVersion() {
  const response = await fetch(
    "https://registry.npmjs.org/baseline-browser-mapping/latest",
  );
  if (!response.ok) {
    throw new Error(
      `Unable to fetch baseline-browser-mapping latest version: ${response.status}`,
    );
  }
  const payload = await response.json();
  if (!payload?.version || typeof payload.version !== "string") {
    throw new Error("Unexpected npm registry response for latest package version");
  }
  return payload.version;
}

function stripPrefix(versionRange) {
  return String(versionRange ?? "").replace(/^[~^]/, "").trim();
}

function assertPinnedToLatest(appName, appVersion, latestVersion) {
  if (stripPrefix(appVersion) !== latestVersion) {
    throw new Error(
      `${appName} uses baseline-browser-mapping ${appVersion}, latest is ${latestVersion}. Update with: pnpm up -D baseline-browser-mapping --filter ${appName}`,
    );
  }
}

async function main() {
  const [webPkg, adminPkg] = await Promise.all([
    readJson("apps/web/package.json"),
    readJson("apps/admin/package.json"),
  ]);

  let latestVersion;
  try {
    latestVersion = await fetchLatestBaselineVersion();
  } catch (error) {
    if (process.env.CI === "true") {
      throw error;
    }
    console.warn(
      "Skipping baseline-browser-mapping freshness check because npm registry could not be reached in local environment.",
    );
    return;
  }

  const appsToCheck = [
    {
      name: "web",
      version: webPkg?.devDependencies?.["baseline-browser-mapping"],
    },
    {
      name: "admin",
      version: adminPkg?.devDependencies?.["baseline-browser-mapping"],
    },
  ].filter((app) => Boolean(app.version));

  if (appsToCheck.length === 0) {
    throw new Error(
      "No app declares baseline-browser-mapping in devDependencies; cannot enforce freshness gate",
    );
  }

  for (const app of appsToCheck) {
    assertPinnedToLatest(app.name, app.version, latestVersion);
  }

  console.log(
    `baseline-browser-mapping freshness check passed (latest: ${latestVersion})`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`baseline-browser-mapping freshness check failed: ${message}`);
  process.exit(1);
});
