# DayLog Monorepo

DayLog is a multi-app journaling platform with a shared Convex backend.

## Current capability boundaries

- Implemented: memory journaling, mood tracking, day ratings, OpenAI day summaries, integrations for Google Calendar, Google Fit, Spotify, and Apple Health daily uploads.
- Implemented (mobile): optional foreground location tracking with coarse location signals while the app is open.
- Not implemented: background location tracking and call-log collection.

## Apps and packages

- `apps/web` — User-facing Next.js app (port `3000`)
- `apps/admin` — Admin Next.js app (port `3001`)
- `apps/mobile` — Expo app
- `packages/backend` — Shared Convex backend
- `packages/ui` — Shared UI/hooks/constants

## Documentation map

- Setup: [CONVEX_SETUP.md](CONVEX_SETUP.md)
- Day-to-day workflow: [workflow.md](workflow.md)
- Deploy + operations runbook: [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md)
- Security + secret handling: [SECURITY.md](SECURITY.md)

## Prerequisites

- Node.js `>=18`
- pnpm `10.x`
- Convex account/project
- Clerk app (publishable + secret keys, webhook)
- OpenAI API key (for summary generation)

## Local setup

1. Install dependencies:

```bash
pnpm install
```

1. Copy env files:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

1. Configure Convex and set Convex dashboard env vars.

See [CONVEX_SETUP.md](CONVEX_SETUP.md) for full steps.

Startup now uses strict server env validation for critical backend/admin vars.
If boot fails with env errors, see the troubleshooting section in
[CONVEX_SETUP.md](CONVEX_SETUP.md).

## Run locally

Terminal 1 (Convex):

```bash
cd packages/backend
npx convex dev
```

Terminal 2 (apps):

```bash
pnpm dev
```

Or run individually:

```bash
pnpm dev:web
pnpm dev:admin
pnpm dev:mobile
```

## Build and lint

```bash
pnpm build
pnpm lint
pnpm typecheck
```

Targeted:

```bash
pnpm build:web
pnpm build:admin
pnpm lint:web
pnpm lint:admin
pnpm lint:mobile
```

## CI required PR checks

PR validation runs in `.github/workflows/feature.yml` and should require these job checks in branch protection:

- `Feature Branch CI / ci-checks`
- `Feature Branch CI / Backend Validation`
- `Feature Branch CI / Mobile Validation`

Run the same gates locally before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
```

`mobile build:ci` uses Expo web export as the strongest reliable CI build-level validation in this stack (without requiring native macOS/iOS build infrastructure in GitHub-hosted runners).

## Admin scalability notes

- Admin list pages now use server-backed pagination instead of unbounded full-table loads.
- Backend admin list queries include indexed pagination endpoints for users, memories, days, summaries, integrations, preferences, and audit logs.
- Integrations status filter and audit-log actor/action/date filters now run server-side via indexed query paths.

Run the same validation locally after admin/backend changes:

```bash
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
pnpm --filter admin lint
pnpm --filter admin build
```

Branch protection rules are configured in GitHub repository settings and are not versioned in this repository. Keep the required status checks above in sync with workflow job names.

## App-specific docs

- Web app setup and commands: [apps/web/README.md](apps/web/README.md)
- Admin app setup and commands: [apps/admin/README.md](apps/admin/README.md)
- Mobile app setup and commands: [apps/mobile/README.md](apps/mobile/README.md)
- Backend package docs: [packages/backend/README.md](packages/backend/README.md)

## Security and secrets

- Never commit `.env` or `.env.local` files with real credentials.
- Keep only placeholder values in `.env.example` files.
- Follow the rotation checklist in [SECURITY.md](SECURITY.md).
