# DayLog Development Workflow

This document reflects the current implementation state of the DayLog monorepo.

## 1) Architecture snapshot

- Backend: Convex (`packages/backend`)
- Auth: Clerk across web, admin, and mobile
- Web app: Next.js (`apps/web`)
- Admin app: Next.js (`apps/admin`)
- Mobile app: Expo (`apps/mobile`)
- Shared packages: `@repo/backend`, `@repo/ui`, `@repo/eslint-config`, `@repo/typescript-config`

## 2) One-time setup

1. Install dependencies:

```bash
pnpm install
```

1. Copy env examples:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

1. Start Convex and configure deployment/env:

```bash
pnpm --filter @repo/backend dev
```

Then follow [CONVEX_SETUP.md](CONVEX_SETUP.md).

## 3) Daily local workflow

### 3.1 Start development

Terminal 1:

```bash
pnpm --filter @repo/backend dev
```

Terminal 2:

```bash
pnpm dev
```

Or run an app directly:

```bash
pnpm dev:web
pnpm dev:admin
pnpm dev:mobile
```

### 3.2 Typical coding loop

1. Make schema/function/UI changes.
2. Run targeted checks in affected packages.
3. Run repo-level quality gates before opening PR.

Recommended pre-PR checks:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @repo/backend test:run
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
```

## 4) CI workflow (source of truth)

CI file: [.github/workflows/feature.yml](.github/workflows/feature.yml)

Required checks:

- `Feature Branch CI / ci-checks`
- `Feature Branch CI / Backend Tests`
- `Feature Branch CI / Mobile Validation`

CI behavior summary:

- Lint + typecheck run at repo level.
- Web/admin builds run conditionally based on changed paths.
- Backend tests always run.
- Mobile validation always runs (`check-types`, `lint`, `build:ci`).

## 5) Domain workflow notes

### 5.1 Backend (Convex)

- Keep schema changes in `packages/backend/convex/schema.ts`.
- Keep domain logic in domain files (`users.ts`, `memories.ts`, etc.).
- Use strict auth + ownership checks for user-scoped operations.

### 5.2 Admin app

- Use server-backed paginated admin endpoints.
- Keep ID typing aligned with Convex entity IDs.
- Validate admin pages with:

```bash
pnpm --filter admin lint
pnpm --filter admin build
```

### 5.3 Summary generation + integrations

- Summary action: `summaryGeneration:generateSummaryForDay`
- Integration daily sync storage: `integrationDailyData`
- Supported providers currently include Google Calendar, Google Fit, Spotify, and Apple Health upload path.

## 6) Troubleshooting quick guide

- Env validation failures: check required variable names/formats in [CONVEX_SETUP.md](CONVEX_SETUP.md).
- Auth mismatch issues: verify Clerk keys and Convex JWT issuer domain.
- CI failures: mirror exact failing command locally from workflow job logs.
- Convex type drift: restart `convex dev` and rerun checks.

## 7) Related documents

- Root overview: [README.md](README.md)
- Setup details: [CONVEX_SETUP.md](CONVEX_SETUP.md)
- Deploy/runbook: [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md)
- Security practices: [SECURITY.md](SECURITY.md)
