# DayLog Deploy + Operations Runbook

This runbook reflects the current monorepo implementation and CI workflow.

## 1) Environments and services

Required services:

- Convex deployment (backend functions + data)
- Clerk (auth for web/admin/mobile)
- OpenAI (summary generation)
- Hosting for web/admin (for example Vercel)
- Expo/EAS distribution path for mobile builds

Required environment variables:

- Web/Admin runtime:
  - `NEXT_PUBLIC_CONVEX_URL`
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
- Mobile runtime:
  - `EXPO_PUBLIC_CONVEX_URL`
  - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Convex dashboard:
  - `CLERK_JWT_ISSUER_DOMAIN`
  - `CLERK_WEBHOOK_SECRET`
  - `OPENAI_API_KEY`
  - `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (optional)

See [CONVEX_SETUP.md](CONVEX_SETUP.md) for setup details and validation behavior.

## 2) CI/CD gates (source of truth)

CI workflow file: [.github/workflows/backend-validation.yml](.github/workflows/backend-validation.yml)

Required checks:

- `backend-validation`

What each check enforces:

- `backend-validation`: install, secret scan, repo lint, repo typecheck, selective web/admin builds, backend lint/tests, mobile typecheck/lint/build

Branch protection alignment (manual GitHub setting):

1. Open repository Settings -> Branches -> Branch protection rules.
2. Edit the rule for `main` (and any release branch rules).
3. Under required status checks, keep only `backend-validation`.
4. Remove stale checks such as `Feature Branch CI / ci-checks`, `Feature Branch CI / Backend Tests`, and `Feature Branch CI / Mobile Validation` if present.

Automated verification (recommended for release checks):

1. Generate a GitHub token with permission to read branch protection rules (repository Administration read).
2. Run from repo root:

```bash
GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner>/<repo> pnpm verify:branch-protection
```

Optional flags:

- `pnpm verify:branch-protection -- --repo <owner/repo>` to override `GITHUB_REPOSITORY`
- `pnpm verify:branch-protection -- --branch <branch>` to verify non-default branches (defaults to `main`)

Expected result:

- `PASS` when required checks are exactly `backend-validation`
- `FAIL` when checks are missing, extra checks exist, or API access fails

## 3) Pre-merge local checklist

Run from repo root:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm --filter @repo/backend test:run
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
pnpm build:web
pnpm build:admin
```

## 4) Deployment checklist

1. Validate secrets and URLs are present in target environments.
2. Ensure Convex env vars are configured for target deployment.
3. Confirm Clerk webhook points to:
   - `https://<your-convex-deployment>.convex.site/clerk/webhook`
4. Merge to the deployment branch according to your release policy.
5. Deploy web/admin from latest green commit.
6. Publish/distribute mobile build as needed.

Release checklist add-on:

- Run `pnpm verify:branch-protection` before creating a release tag or cutover.

## 5) Post-deploy smoke checks

Web/Admin:

- Sign in via Clerk
- Confirm data loads from Convex
- Generate a day summary from dashboard

Backend:

- Verify Clerk webhook events are accepted
- Verify summary generation succeeds (OpenAI key valid)
- Verify integration secrets are encrypted at rest:
  - Run `integrations:adminAuditIntegrationSecretsEncryptionStatus`
  - Confirm `legacyPlaintextRows = 0` and `missingEncryptedAccessRows = 0`
  - If non-zero, run `integrations:adminMigrateLegacyIntegrationSecretsAll` and re-check

Mobile:

- Sign in and load tabs
- Create a memory
- Validate sync/API flows used by current release

## 6) Common operations

### Run backend logs

```bash
pnpm --filter @repo/backend logs
```

### Run Convex dev locally

```bash
pnpm --filter @repo/backend dev
```

### Bootstrap first admin

- Set `ADMIN_BOOTSTRAP_CLERK_USER_IDS` in Convex env.
- Call mutation `users:bootstrapMakeMeAdmin` while signed in as an allowed Clerk user.

### Integration secret migration sweep

- Audit current status: `integrations:adminAuditIntegrationSecretsEncryptionStatus`
- Migrate all legacy plaintext rows: `integrations:adminMigrateLegacyIntegrationSecretsAll`
- Re-audit and ensure plaintext counters are zero before declaring production ready

## 7) Troubleshooting quick notes

- Startup env validation errors: check required variable names and formats in [CONVEX_SETUP.md](CONVEX_SETUP.md).
- CI secret scan failures: rotate exposed keys and remove credential-like strings from tracked files.
- Convex auth failures: verify Clerk JWT issuer domain and Clerk JWT template (`applicationID: "convex"`).
