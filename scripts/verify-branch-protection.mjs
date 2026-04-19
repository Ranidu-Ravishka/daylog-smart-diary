import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const EXPECTED_REQUIRED_CHECKS = [
  "backend-validation",
  "app-tests-backend",
  "app-tests-web",
  "app-tests-admin",
  "app-tests-mobile",
];

const DEFAULT_BRANCH = "main";
const DEFAULT_EXPECTED_FILE = ".github/branch-protection.expected.json";

// Fail-closed defaults. If no config file exists, these policy checks are still enforced.
const DEFAULT_POLICY = {
  requireStatusChecksStrict: true,
  requirePullRequestReviews: true,
  requiredApprovingReviewCount: 1,
  allowForcePushes: false,
  allowDeletions: false,
};

function parseArgs(argv) {
  let branch = DEFAULT_BRANCH;
  let repoArg = null;
  let expectedFile = null;
  let allowUnsupportedPlan = false;

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

    if (arg === "--allow-unsupported-plan") {
      allowUnsupportedPlan = true;
      continue;
    }
  }

  return {
    branch: branch.trim() || DEFAULT_BRANCH,
    repoArg: repoArg?.trim() || null,
    expectedFile: expectedFile?.trim() || null,
    allowUnsupportedPlan,
  };
}

function parseBooleanFlag(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isBranchProtectionPlanLimitation(status, details) {
  if (status !== 403) {
    return false;
  }

  return /upgrade to github pro or make this repository public to enable this feature/i.test(
    details,
  );
}

function resolveOwnerRepo(repoArg) {
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

function detectRepoFromGitRemoteOrigin() {
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
      "Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN) with permission to read branch protection. This check is fail-closed and cannot be skipped.",
    );
  }

  return token;
}

function extractRequiredChecks(payload) {
  const required = payload?.required_status_checks;
  if (!required) return [];

  const checks = new Set();

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

function sameChecks(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((value, index) => value === expected[index]);
}

function normalizeChecks(value) {
  if (!Array.isArray(value)) {
    throw new Error("requiredStatusChecks must be an array of strings.");
  }

  const normalized = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();

  return [...new Set(normalized)];
}

function parseBooleanOrDefault(value, fallback, fieldName) {
  if (typeof value === "undefined") {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

function parseIntegerOrDefault(value, fallback, fieldName, minValue) {
  if (typeof value === "undefined") {
    return fallback;
  }

  if (!Number.isInteger(value) || value < minValue) {
    throw new Error(`${fieldName} must be an integer >= ${minValue}.`);
  }

  return value;
}

function resolveExpectedPolicy(args) {
  const expectedFile = path.resolve(
    process.cwd(),
    args.expectedFileArg ?? DEFAULT_EXPECTED_FILE,
  );

  if (!existsSync(expectedFile)) {
    return {
      requiredChecks: [...EXPECTED_REQUIRED_CHECKS].sort(),
      ...DEFAULT_POLICY,
      source: "built-in defaults",
    };
  }

  const raw = readFileSync(expectedFile, "utf8");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Expected config file is not valid JSON: ${expectedFile}`);
  }

  const branchConfig = parsed?.branches?.[args.branch];
  if (!branchConfig || typeof branchConfig !== "object") {
    throw new Error(
      `Expected config file does not define branch \"${args.branch}\": ${expectedFile}`,
    );
  }

  return {
    requiredChecks: normalizeChecks(branchConfig.requiredStatusChecks),
    requireStatusChecksStrict: parseBooleanOrDefault(
      branchConfig.requireStatusChecksStrict,
      DEFAULT_POLICY.requireStatusChecksStrict,
      "requireStatusChecksStrict",
    ),
    requirePullRequestReviews: parseBooleanOrDefault(
      branchConfig.requirePullRequestReviews,
      DEFAULT_POLICY.requirePullRequestReviews,
      "requirePullRequestReviews",
    ),
    requiredApprovingReviewCount: parseIntegerOrDefault(
      branchConfig.requiredApprovingReviewCount,
      DEFAULT_POLICY.requiredApprovingReviewCount,
      "requiredApprovingReviewCount",
      0,
    ),
    allowForcePushes: parseBooleanOrDefault(
      branchConfig.allowForcePushes,
      DEFAULT_POLICY.allowForcePushes,
      "allowForcePushes",
    ),
    allowDeletions: parseBooleanOrDefault(
      branchConfig.allowDeletions,
      DEFAULT_POLICY.allowDeletions,
      "allowDeletions",
    ),
    source: path.relative(process.cwd(), expectedFile) || expectedFile,
  };
}

function readStatusChecksStrict(payload) {
  const required = payload?.required_status_checks;
  if (!required || typeof required !== "object") {
    return false;
  }

  return required.strict === true;
}

function readToggleEnabled(value) {
  return Boolean(value && typeof value === "object" && value.enabled === true);
}

function readRequiredApprovingReviewCount(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }

  const count = value.required_approving_review_count;
  if (!Number.isInteger(count) || count < 0) {
    return 0;
  }

  return count;
}

function evaluateBranchProtectionPolicy(payload, expected) {
  const actualChecks = extractRequiredChecks(payload);
  const actualStrict = readStatusChecksStrict(payload);

  const reviewRules = payload?.required_pull_request_reviews;
  const hasReviewRules = Boolean(reviewRules && typeof reviewRules === "object");
  const actualApprovingReviewCount = readRequiredApprovingReviewCount(reviewRules);

  const actualAllowForcePushes = readToggleEnabled(payload?.allow_force_pushes);
  const actualAllowDeletions = readToggleEnabled(payload?.allow_deletions);

  const failures = [];

  // Rule: required status checks must match the expected policy exactly.
  if (!sameChecks(actualChecks, expected.requiredChecks)) {
    failures.push(
      `required_status_checks mismatch. Expected [${expected.requiredChecks.join(", ") || "(none)"}], got [${actualChecks.join(", ") || "(none)"}].`,
    );
  }

  // Rule: required status checks must be strict (branch must be up to date before merge).
  if (expected.requireStatusChecksStrict && !actualStrict) {
    failures.push(
      "required_status_checks.strict is disabled. Enable strict status checks.",
    );
  }

  // Rule: pull request review protection must be enabled.
  if (expected.requirePullRequestReviews && !hasReviewRules) {
    failures.push(
      "required_pull_request_reviews is disabled. Enable required PR reviews.",
    );
  }

  // Rule: minimum number of approving reviews must be met.
  if (actualApprovingReviewCount < expected.requiredApprovingReviewCount) {
    failures.push(
      `required_pull_request_reviews.required_approving_review_count is ${actualApprovingReviewCount}. Expected at least ${expected.requiredApprovingReviewCount}.`,
    );
  }

  // Rule: force pushes must remain disabled.
  if (actualAllowForcePushes !== expected.allowForcePushes) {
    failures.push(
      `allow_force_pushes.enabled is ${actualAllowForcePushes}. Expected ${expected.allowForcePushes}.`,
    );
  }

  // Rule: branch deletion must remain disabled.
  if (actualAllowDeletions !== expected.allowDeletions) {
    failures.push(
      `allow_deletions.enabled is ${actualAllowDeletions}. Expected ${expected.allowDeletions}.`,
    );
  }

  return {
    failures,
    actual: {
      requiredChecks: actualChecks,
      requireStatusChecksStrict: actualStrict,
      requirePullRequestReviews: hasReviewRules,
      requiredApprovingReviewCount: actualApprovingReviewCount,
      allowForcePushes: actualAllowForcePushes,
      allowDeletions: actualAllowDeletions,
    },
  };
}

async function main() {
  const { branch, repoArg, expectedFile, allowUnsupportedPlan } = parseArgs(
    process.argv.slice(2),
  );
  const { owner, repo } = resolveOwnerRepo(repoArg);
  const token = resolveToken();
  const expected = resolveExpectedPolicy({
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

    const allowUnsupportedPlanFromEnv = parseBooleanFlag(
      process.env.ALLOW_UNSUPPORTED_BRANCH_PROTECTION,
    );
    const allowUnsupportedPlanBypass =
      allowUnsupportedPlan || allowUnsupportedPlanFromEnv;

    if (
      allowUnsupportedPlanBypass &&
      isBranchProtectionPlanLimitation(response.status, details)
    ) {
      console.warn(
        `WARN: Branch protection API is unavailable for ${owner}/${repo}@${branch} on the current GitHub plan.`,
      );
      console.warn(
        "WARN: Continuing only because ALLOW_UNSUPPORTED_BRANCH_PROTECTION is enabled.",
      );
      console.warn(
        "WARN: Live branch protection rules could not be verified. Upgrade GitHub plan or make repository public to re-enable strict verification.",
      );
      process.exit(0);
    }

    console.error(
      `FAIL: Unable to fetch branch protection for ${owner}/${repo}@${branch}.`,
    );
    console.error("Reason: live branch protection verification failed (fail-closed).");
    console.error(`HTTP ${response.status} ${response.statusText}`);
    if (details) {
      console.error(details);
    }
    process.exit(1);
  }

  const payload = await response.json();
  const evaluation = evaluateBranchProtectionPolicy(payload, expected);

  console.log(`Repository: ${owner}/${repo}`);
  console.log(`Branch: ${branch}`);
  console.log(`Policy source: ${expected.source}`);

  console.log("Expected branch protection policy:");
  console.log(`- requiredStatusChecks: ${expected.requiredChecks.join(", ") || "(none)"}`);
  console.log(`- requireStatusChecksStrict: ${expected.requireStatusChecksStrict}`);
  console.log(`- requirePullRequestReviews: ${expected.requirePullRequestReviews}`);
  console.log(
    `- requiredApprovingReviewCount: ${expected.requiredApprovingReviewCount}`,
  );
  console.log(`- allowForcePushes: ${expected.allowForcePushes}`);
  console.log(`- allowDeletions: ${expected.allowDeletions}`);

  console.log("Observed branch protection policy:");
  console.log(
    `- requiredStatusChecks: ${evaluation.actual.requiredChecks.join(", ") || "(none)"}`,
  );
  console.log(
    `- requireStatusChecksStrict: ${evaluation.actual.requireStatusChecksStrict}`,
  );
  console.log(
    `- requirePullRequestReviews: ${evaluation.actual.requirePullRequestReviews}`,
  );
  console.log(
    `- requiredApprovingReviewCount: ${evaluation.actual.requiredApprovingReviewCount}`,
  );
  console.log(`- allowForcePushes: ${evaluation.actual.allowForcePushes}`);
  console.log(`- allowDeletions: ${evaluation.actual.allowDeletions}`);

  if (evaluation.failures.length === 0) {
    console.log("PASS: Branch protection policy matches fail-closed requirements.");
    process.exit(0);
  }

  console.error("FAIL: Branch protection policy validation failed.");
  for (const failure of evaluation.failures) {
    console.error(`- ${failure}`);
  }
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
