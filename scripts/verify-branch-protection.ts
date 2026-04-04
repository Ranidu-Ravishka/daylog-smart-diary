import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const EXPECTED_REQUIRED_CHECKS = ["backend-validation"];
const DEFAULT_BRANCH = "main";
const DEFAULT_EXPECTED_FILE = ".github/branch-protection.expected.json";

type BranchExpectedConfig = {
  requiredStatusChecks: string[];
};

type ExpectedConfigFile = {
  branches?: Record<string, Partial<BranchExpectedConfig>>;
};

function parseArgs(argv: string[]) {
  let branch = DEFAULT_BRANCH;
  let repoArg: string | null = null;
  let expectedFile: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--branch") {
      branch = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg?.startsWith("--branch=")) {
      branch = arg.slice("--branch=".length);
      continue;
    }

    if (arg === "--repo") {
      repoArg = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg?.startsWith("--repo=")) {
      repoArg = arg.slice("--repo=".length);
      continue;
    }

    if (arg === "--expected-file") {
      expectedFile = argv[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg?.startsWith("--expected-file=")) {
      expectedFile = arg.slice("--expected-file=".length);
      continue;
    }
  }

  return {
    branch: branch.trim() || DEFAULT_BRANCH,
    repoArg: repoArg?.trim() || null,
    expectedFile: expectedFile?.trim() || null,
  };
}

function resolveOwnerRepo(repoArg: string | null) {
  const repoValue =
    repoArg ??
    process.env.GITHUB_REPOSITORY ??
    detectRepoFromGitRemoteOrigin() ??
    "";
  const [owner, repo] = repoValue.split("/");

  if (!owner || !repo) {
    throw new Error(
      "Missing repository target. Provide --repo <owner/repo>, set GITHUB_REPOSITORY, or ensure remote.origin.url points to GitHub.",
    );
  }

  return { owner, repo };
}

function detectRepoFromGitRemoteOrigin(): string | null {
  let remoteUrl = "";

  try {
    remoteUrl = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }

  if (!remoteUrl) return null;

  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;

  const owner = match[1]?.trim();
  const repo = match[2]?.trim();

  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

function resolveToken() {
  const token =
    process.env.GITHUB_TOKEN?.trim() ?? process.env.GH_TOKEN?.trim() ?? "";

  if (!token) {
    throw new Error(
      "Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN) with permission to read branch protection.",
    );
  }

  return token;
}

function extractRequiredChecks(payload: any): string[] {
  const required = payload?.required_status_checks;
  if (!required) return [];

  const checks = new Set<string>();

  if (Array.isArray(required.contexts)) {
    for (const context of required.contexts) {
      if (typeof context === "string" && context.trim()) {
        checks.add(context.trim());
      }
    }
  }

  if (Array.isArray(required.checks)) {
    for (const check of required.checks) {
      if (typeof check === "string" && check.trim()) {
        checks.add(check.trim());
        continue;
      }

      if (
        typeof check === "object" &&
        check !== null &&
        typeof check.context === "string" &&
        check.context.trim()
      ) {
        checks.add(check.context.trim());
      }
    }
  }

  return [...checks].sort();
}

function sameChecks(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function normalizeChecks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("requiredStatusChecks must be an array of strings.");
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();

  return [...new Set(normalized)];
}

function resolveExpectedChecks(args: {
  branch: string;
  expectedFileArg: string | null;
}): {
  checks: string[];
  source: string;
} {
  const expectedFile = path.resolve(
    process.cwd(),
    args.expectedFileArg ?? DEFAULT_EXPECTED_FILE,
  );

  if (!existsSync(expectedFile)) {
    return {
      checks: [...EXPECTED_REQUIRED_CHECKS].sort(),
      source: "built-in defaults",
    };
  }

  const raw = readFileSync(expectedFile, "utf8");

  let parsed: ExpectedConfigFile;
  try {
    parsed = JSON.parse(raw) as ExpectedConfigFile;
  } catch {
    throw new Error(`Expected config file is not valid JSON: ${expectedFile}`);
  }

  const branchConfig = parsed.branches?.[args.branch];
  if (!branchConfig) {
    throw new Error(
      `Expected config file does not define branch \"${args.branch}\": ${expectedFile}`,
    );
  }

  return {
    checks: normalizeChecks(branchConfig.requiredStatusChecks),
    source: path.relative(process.cwd(), expectedFile) || expectedFile,
  };
}

async function main() {
  const { branch, repoArg, expectedFile } = parseArgs(process.argv.slice(2));
  const { owner, repo } = resolveOwnerRepo(repoArg);
  const token = resolveToken();
  const expected = resolveExpectedChecks({
    branch,
    expectedFileArg: expectedFile,
  });

  const url = `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "daylog-branch-protection-verifier",
    },
  });

  if (!response.ok) {
    const details = await response.text();
    console.error(
      `FAIL: Unable to fetch branch protection for ${owner}/${repo}@${branch}.`,
    );
    console.error(`HTTP ${response.status} ${response.statusText}`);
    if (details) {
      console.error(details);
    }
    process.exit(1);
  }

  const payload = await response.json();
  const actualChecks = extractRequiredChecks(payload);
  const expectedChecks = expected.checks;

  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Expected checks source: ${expected.source}`);
  console.log("Required status checks:");

  if (actualChecks.length === 0) {
    console.log("- (none)");
  } else {
    for (const check of actualChecks) {
      console.log(`- ${check}`);
    }
  }

  console.log(`Expected required checks: ${expectedChecks.join(", ") || "(none)"}`);

  if (sameChecks(actualChecks, expectedChecks)) {
    console.log("PASS: required checks match expected policy.");
    process.exit(0);
  }

  console.error("FAIL: required checks do not match expected policy.");
  console.error(`Expected: ${expectedChecks.join(", ") || "(none)"}`);
  console.error(`Actual: ${actualChecks.join(", ") || "(none)"}`);
  process.exit(1);
}

main().catch((error) => {
  console.error("FAIL: verification script crashed.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
