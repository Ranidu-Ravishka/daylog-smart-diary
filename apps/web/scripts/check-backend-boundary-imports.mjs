import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const webRoot = join(scriptDir, "..");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
  "dist",
]);

const violationPattern =
  /(?:from\s+["']|import\(\s*["']|export\s+[^;]*from\s+["'])(?:\.\.\/)+packages\/backend\//;

const violations = [];

function walk(currentDir) {
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      walk(absolutePath);
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;

    const source = readFileSync(absolutePath, "utf8");
    const lines = source.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line || !violationPattern.test(line)) continue;

      violations.push({
        path: relative(webRoot, absolutePath),
        line: index + 1,
        code: line.trim(),
      });
    }
  }
}

walk(webRoot);

if (violations.length > 0) {
  console.error(
    "Boundary violation: deep relative imports into packages/backend were found:\n",
  );

  for (const violation of violations) {
    console.error(
      `- ${violation.path}:${violation.line} -> ${violation.code}`,
    );
  }

  globalThis.process.exit(1);
}

console.log(
  "Boundary check passed: no deep relative imports into packages/backend were found.",
);
