const EXPECTED_REQUIRED_CHECKS = ["backend-validation"];
const DEFAULT_BRANCH = "main";

function parseArgs(argv: string[]) {
  let branch = DEFAULT_BRANCH;
  let repoArg: string | null = null;

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
  }

  return {
    branch: branch.trim() || DEFAULT_BRANCH,
    repoArg: repoArg?.trim() || null,
  };
}

function resolveOwnerRepo(repoArg: string | null) {
  const repoValue = repoArg ?? process.env.GITHUB_REPOSITORY ?? "";
  const [owner, repo] = repoValue.split("/");

  if (!owner || !repo) {
    throw new Error(
      "Missing repository target. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
    );
  }

  return { owner, repo };
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

async function main() {
  const { branch, repoArg } = parseArgs(process.argv.slice(2));
  const { owner, repo } = resolveOwnerRepo(repoArg);
  const token = resolveToken();

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
  const expectedChecks = [...EXPECTED_REQUIRED_CHECKS].sort();

  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Branch: ${branch}`);
  console.log("Required status checks:");

  if (actualChecks.length === 0) {
    console.log("- (none)");
  } else {
    for (const check of actualChecks) {
      console.log(`- ${check}`);
    }
  }

  if (sameChecks(actualChecks, expectedChecks)) {
    console.log("PASS: required checks exactly match backend-validation.");
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
