# DayLog Web (`apps/web`)

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Web engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

User-facing **Next.js 16** app: memories, summaries, account settings, and **OAuth callback routes** for integrations.

**Monorepo onboarding:** [../../README.md](../../README.md)  
**Architecture:** [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)

## Routing

- **App Router** — routes under `app/` (layouts, server components, route handlers).
- **API routes** — Next.js route handlers under `app/api/` (including `/api/integrations/oauth/...` callbacks).

## Environment

Create from example (run from repo root):

```bash
cp apps/web/.env.example apps/web/.env.local
```

Required for auth, Convex, and integrations:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

Recommended:

- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_DSN` (optional server-side Sentry)

Details: [../../docs/ENVIRONMENT_SETUP.md](../../docs/ENVIRONMENT_SETUP.md).

## Local development

From repository root:

```bash
pnpm dev:web
```

Default URL: `http://localhost:3000` (see `apps/web/scripts/dev.mjs` if customized).

## Commands

```bash
pnpm --filter web dev
pnpm --filter web lint
pnpm --filter web check-types
pnpm --filter web build
pnpm --filter web start
pnpm --filter web test
pnpm --filter web test:e2e
```

## OAuth callback routes

Register these paths on each provider (prefix with `NEXT_PUBLIC_APP_URL`). Routes are implemented as `/api/integrations/oauth/[provider]/callback` in App Router.

| Provider | `provider` value |
| -------- | ---------------- |
| Google Calendar | `google_calendar` |
| Google Fit | `google_fit` |
| Spotify | `spotify` |

Example: `${NEXT_PUBLIC_APP_URL}/api/integrations/oauth/spotify/callback`.

## Auth flow (summary)

1. Clerk handles sign-in in the browser.
2. `ConvexReactClient` uses `NEXT_PUBLIC_CONVEX_URL` and Clerk session to call Convex queries/mutations (`import { api } from "@repo/backend/convex"`).
3. OAuth starts on web; tokens and sync run with secrets present on **both** web env and **Convex** deployment env.

## Testing

- `pnpm --filter web test` — Vitest (OAuth abuse / callback coverage).
- `pnpm --filter web test:e2e` — Playwright; first run may need `pnpm --filter web test:e2e:install`.

See [../../docs/TESTING.md](../../docs/TESTING.md).

## Deployment

Static export is not the default target: deploy as a **Node** Next.js app (for example Vercel). See [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Troubleshooting

See [../../docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md) and OAuth notes in [../../README.md](../../README.md).
