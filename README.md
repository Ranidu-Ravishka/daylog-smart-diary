# DayLog

> Status: Active
> Last Updated: 2026-04-14
> Audience: All engineers
> Standard: [CONTRIBUTING.md](CONTRIBUTING.md)

DayLog is a production-grade, cross-platform life journaling system built as a pnpm/turbo monorepo.
It combines personal memory capture, daily AI summaries, integrations, and privacy-aware life context signals.

## 1. Project Overview

### What DayLog is

DayLog helps users track what happened during the day, connect external data sources, and generate high-quality day summaries.
The same backend powers web, admin, and mobile clients.

### Core features

- Memory tracking
  - Create, edit, list, and delete day-scoped memories.
  - Mood tagging and day ratings.
- Daily summaries
  - OpenAI-backed summary generation from memories and integration context.
- Integrations
  - OAuth-backed providers currently implemented in this repository:
    - Google Calendar
    - Google Fit
    - Spotify
    - Apple Health daily uploads
- Life context tracking
  - Optional and privacy-gated contextual signals (for example location/activity summaries).
  - Designed around data minimization and retention controls.
- Cross-platform support
  - Web app (Next.js)
  - Admin app (Next.js)
  - Mobile app (Expo / React Native)

## 2. Tech Stack

- Web: Next.js 16, React 19, TypeScript
- Admin: Next.js 16, React 19, TypeScript
- Mobile: Expo 54, React Native 0.81, Expo Router
- Backend: Convex (TypeScript functions, schema, scheduled jobs)
- Auth: Clerk (client auth + webhook sync + Convex JWT template)
- AI: OpenAI API (summary generation)
- Observability: Sentry + structured JSON logging
- Tooling: pnpm workspaces, Turbo, Vitest, ESLint, Prettier

## 3. Monorepo Structure

Core production surfaces:

- `apps/web`
  - User-facing Next.js application.
  - Runs on port `3000` by default.
- `apps/admin`
  - Internal/admin Next.js application.
  - Runs on port `3001`.
- `apps/mobile`
  - Expo / React Native client.
  - Uses the same backend contracts as web/admin.
- `packages/backend`
  - Shared Convex backend for all surfaces.
  - Owns schema, auth boundaries, integrations, summaries, export flows, retention jobs.

Supporting shared packages:

- `packages/ui`: shared UI primitives/utilities
- `packages/user-settings`: shared user settings contracts
- `packages/eslint-config`, `packages/typescript-config`: workspace standards

## Getting Started (Step-by-step)

### 1. Clone repo

```bash
git clone <repo-url>
cd <repo>
```

Replace `<repo-url>` with your actual DayLog repository URL.

### 2. Install dependencies

```bash
pnpm install
```

### 3. Setup environment variables

Create local env files:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

DayLog uses app-specific variable names. If your team manages a single shared `CONVEX_URL` secret, copy it into:

- `NEXT_PUBLIC_CONVEX_URL` (web/admin)
- `EXPO_PUBLIC_CONVEX_URL` (mobile)

Required variables by surface:

`apps/web/.env.local`

```dotenv
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
NEXT_PUBLIC_SENTRY_DSN=
# Optional fallback for server-side web Sentry
SENTRY_DSN=
```

`apps/admin/.env.local`

```dotenv
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
ADMIN_CACHE_SECRET=
```

`apps/mobile/.env.local`

```dotenv
EXPO_PUBLIC_CONVEX_URL=
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
EXPO_PUBLIC_WEB_APP_URL=http://localhost:3000
EXPO_PUBLIC_SENTRY_DSN=
```

Convex deployment environment variables (set in Convex dashboard):

```dotenv
CLERK_JWT_ISSUER_DOMAIN=
CLERK_WEBHOOK_SECRET=
OPENAI_API_KEY=
SUMMARY_DAILY_GENERATION_LIMIT=5

# OAuth refresh + server-side provider sync
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Backend observability
SENTRY_DSN=

# Integration secret encryption (required for production OAuth token encryption)
INTEGRATION_SECRETS_KEYRING_JSON=
INTEGRATION_SECRETS_ACTIVE_KEY_ID=
```

Mapping for common names requested by teams:

- `CONVEX_URL` -> copy to `NEXT_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CONVEX_URL`
- `BACKEND_SENTRY_DSN` -> set as Convex `SENTRY_DSN`

Where to get each variable:

- Clerk
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: Clerk dashboard -> API Keys.
  - `CLERK_JWT_ISSUER_DOMAIN`: Clerk instance domain used by Convex JWT auth.
  - `CLERK_WEBHOOK_SECRET`: Clerk webhook endpoint signing secret.
- Convex
  - `NEXT_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_CONVEX_URL`: your Convex deployment URL.
  - Get this when you run `convex dev` or from Convex deployment settings.
- OpenAI
  - `OPENAI_API_KEY`: OpenAI dashboard -> API keys.
- Sentry
  - `NEXT_PUBLIC_SENTRY_DSN`: Sentry project DSN for web client.
  - `EXPO_PUBLIC_SENTRY_DSN`: Sentry project DSN for mobile client.
  - `SENTRY_DSN` (backend): Sentry DSN for Convex/backend runtime.
- Google OAuth
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google Cloud Console -> OAuth 2.0 Client ID credentials.
- Spotify OAuth
  - `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: Spotify Developer Dashboard -> app credentials.

### 4. Run backend

```bash
pnpm dev:backend
```

### 5. Run web

```bash
pnpm dev:web
```

### 6. Run mobile

```bash
pnpm --filter mobile start
```

### 7. Run admin

```bash
pnpm dev:admin
```

## Integrations Setup

### Google OAuth setup

1. Create an OAuth app in Google Cloud Console.
2. Set OAuth consent screen (test users for non-published app).
3. Add redirect URIs for DayLog callback routes:
   - `http://localhost:3000/api/integrations/oauth/google_calendar/callback`
   - `http://localhost:3000/api/integrations/oauth/google_fit/callback`
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in both:
   - `apps/web/.env.local`
   - Convex deployment environment

### Spotify OAuth setup

1. Create app at Spotify Developer Dashboard.
2. Add redirect URI:
   - `http://localhost:3000/api/integrations/oauth/spotify/callback`
3. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in both:
   - `apps/web/.env.local`
   - Convex deployment environment

### Common OAuth issues and exact fixes

- "redirect URI not secure"
  - Provider requires `https` for non-local domains.
  - Use `https://<your-domain>/api/integrations/oauth/<provider>/callback` in production.
- Localhost callback mismatch
  - `NEXT_PUBLIC_APP_URL` must match the host you used to start web locally.
  - If web is not on `3000`, update provider redirect URI to the active local port.
- Callback mismatch/400 during token exchange
  - Ensure provider redirect URI exactly matches:
    `NEXT_PUBLIC_APP_URL + /api/integrations/oauth/<provider>/callback`
  - Verify client ID/secret pair matches the same OAuth app.
- Google `access_denied` on test accounts
  - Add your account in OAuth consent screen -> Audience -> Test users.

## Observability

### Sentry setup by surface

- Web
  - Uses `NEXT_PUBLIC_SENTRY_DSN` (client).
  - Server/edge paths can use `SENTRY_DSN` fallback.
- Mobile
  - Uses `EXPO_PUBLIC_SENTRY_DSN`.
  - Optional test flag: `EXPO_PUBLIC_SENTRY_FORCE_TEST_EXCEPTION=true`.
- Backend (Convex)
  - Uses `SENTRY_DSN`.
  - If your secrets manager uses `BACKEND_SENTRY_DSN`, map it to `SENTRY_DSN`.

### Structured logging format (required)

Structured logs are emitted as JSON and must include:

- `event`
- `userId`
- `status`
- `errorMessage`

Additional envelope fields include app/surface/level/timestamp/context.

### Where to view logs and errors

- Backend logs: `pnpm --filter @repo/backend logs` or Convex dashboard logs.
- Web/Admin runtime logs: hosting platform logs (for example Vercel logs).
- Mobile runtime logs: Expo logs/dev client logs.
- Cross-surface error monitoring: Sentry projects/dashboards.

## Testing

```bash
pnpm test
pnpm test:coverage
```

What is tested:

- Backend: Convex behavior tests, integration logic, summary/export paths.
- Web: OAuth abuse protection and integration callback behavior tests.
- Admin: UI/server behavior tests configured in `apps/admin/vitest.config.ts`.
- Mobile: app/library behavior tests configured in `apps/mobile/vitest.config.ts`.

Coverage note:

- `pnpm test:coverage` currently runs backend coverage (`@repo/backend`).

## Deployment (High Level)

- Web -> Vercel (or equivalent Next.js host)
- Mobile -> Expo / EAS
- Backend -> Convex deployment

For release operations, use:

- [workflow.md](workflow.md)
- [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md)
- [SECURITY.md](SECURITY.md)
