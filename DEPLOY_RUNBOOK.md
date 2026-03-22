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

CI workflow file: [.github/workflows/feature.yml](.github/workflows/feature.yml)

Required checks:

- `Feature Branch CI / ci-checks`
- `Feature Branch CI / Backend Tests`
- `Feature Branch CI / Mobile Validation`

What each check enforces:

- `ci-checks`: install, secret scan, repo lint, repo typecheck, selective web/admin builds
- `Backend Tests`: `pnpm --filter @repo/backend test:run`
- `Mobile Validation`: mobile typecheck + lint + Expo web export (`build:ci`)

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

## 5) Post-deploy smoke checks

Web/Admin:

- Sign in via Clerk
- Confirm data loads from Convex
- Generate a day summary from dashboard

Backend:

- Verify Clerk webhook events are accepted
- Verify summary generation succeeds (OpenAI key valid)

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

## 7) Troubleshooting quick notes

- Startup env validation errors: check required variable names and formats in [CONVEX_SETUP.md](CONVEX_SETUP.md).
- CI secret scan failures: rotate exposed keys and remove credential-like strings from tracked files.
- Convex auth failures: verify Clerk JWT issuer domain and Clerk JWT template (`applicationID: "convex"`).
