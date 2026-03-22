# DayLog Monorepo

DayLog is a multi-app journaling platform with a shared Convex backend.

## Apps and packages

- `apps/web` — User-facing Next.js app (port `3000`)
- `apps/admin` — Admin Next.js app (port `3001`)
- `apps/mobile` — Expo app
- `packages/backend` — Shared Convex backend
- `packages/ui` — Shared UI/hooks/constants

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
- `Feature Branch CI / Backend Tests`
- `Feature Branch CI / Mobile Validation`

Run the same gates locally before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm --filter @repo/backend test:run
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
```

`mobile build:ci` uses Expo web export as the strongest reliable CI build-level validation in this stack (without requiring native macOS/iOS build infrastructure in GitHub-hosted runners).

## Security and secrets

- Never commit `.env` or `.env.local` files with real credentials.
- Keep only placeholder values in `.env.example` files.
- Follow the rotation checklist in [SECURITY.md](SECURITY.md).
