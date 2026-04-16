# DayLog Convex Setup Guide

> Status: Active
> Last Updated: 2026-04-14
> Audience: Engineers onboarding backend and auth
> Standard: [CONTRIBUTING.md](CONTRIBUTING.md)

This guide covers backend setup for the shared Convex deployment used by:

- `apps/web`
- `apps/admin`
- `apps/mobile`

For full project onboarding, start with [README.md](README.md).

## 1) Prerequisites

- Node.js `>=18`
- pnpm `10.x`
- Convex account
- Clerk app configured for DayLog

## 2) Install Dependencies

From repository root:

```bash
pnpm install
```

## 3) Start Convex Dev

From repository root:

```bash
pnpm dev:backend
```

Equivalent command:

```bash
pnpm --filter @repo/backend dev
```

This initializes Convex project linkage (if needed) and starts backend dev.

## 4) Configure Local App Env Files

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

Set these minimum local values:

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
```

Important:

- Use the same Convex deployment URL for all clients.
- Do not commit `.env.local` files.

## 5) Configure Convex Deployment Environment Variables

Set in Convex dashboard for the active deployment.

Required:

```dotenv
CLERK_JWT_ISSUER_DOMAIN=
CLERK_WEBHOOK_SECRET=
EXPORT_SIGNING_SECRET=
OPENAI_API_KEY=
SUMMARY_DAILY_GENERATION_LIMIT=5
```

Retention policies (set explicitly per deployment environment):

```dotenv
RETENTION_MEMORIES_DAYS=
RETENTION_DAYS_RECORDS_DAYS=
RETENTION_DAY_SUMMARIES_DAYS=
RETENTION_INTEGRATION_DATA_DAYS=
RETENTION_SYNC_RUNS_DAYS=
RETENTION_LOCATION_SIGNALS_DAYS=
RETENTION_SUMMARY_EVENTS_DAYS=
RETENTION_SUMMARY_QUALITY_DAYS=
RETENTION_SUMMARY_QUOTAS_DAYS=
RETENTION_INFO_EVENTS_DAYS=
RETENTION_HEALTH_EVENTS_DAYS=
RETENTION_AUDIT_LOGS_DAYS=
RETENTION_PLATFORM_AUDIT_DAYS=
RETENTION_EXPORT_JOBS_DAYS=
RETENTION_RESTORE_JOBS_DAYS=
RETENTION_USER_DELETION_JOBS_DAYS=
```

Use the production/staging/development values from [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md#2-environment-matrix).

OAuth and integration sync (required for durable provider sync and refresh):

```dotenv
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

Backend observability:

```dotenv
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_INFO_EVENT_SAMPLE_RATE=0.1
```

Integration secret encryption (required for production OAuth token encryption):

```dotenv
INTEGRATION_SECRETS_KEYRING_JSON=
INTEGRATION_SECRETS_ACTIVE_KEY_ID=
```

Validation behavior already enforced in code:

- `CLERK_JWT_ISSUER_DOMAIN` must be valid `https` URL.
- `CLERK_WEBHOOK_SECRET` must start with `whsec_`.
- `EXPORT_SIGNING_SECRET` is required in production for export/restore payload integrity signing.
- `EXPORT_SIGNING_SECRET` must be dedicated (do not reuse `CLERK_WEBHOOK_SECRET`).
- `OPENAI_API_KEY` must start with `sk-`.
- Placeholder values are rejected by backend/admin env validation.

## 6) Configure Clerk Webhook

Create Clerk webhook endpoint:

- `https://<your-convex-deployment>.convex.site/clerk/webhook`

Subscribe to at least:

- `user.created`
- `user.updated`
- `user.deleted`

Set webhook signing secret as Convex env var:

- `CLERK_WEBHOOK_SECRET`

## 7) Run Applications Against Backend

Terminal 1:

```bash
pnpm dev:backend
```

Terminal 2:

```bash
pnpm dev:web
```

Terminal 3:

```bash
pnpm dev:admin
```

Terminal 4:

```bash
pnpm --filter mobile start
```

## 8) Verification Checklist

1. Web sign-in works and dashboard loads data.
2. Admin sign-in works and protected pages load.
3. Mobile sign-in works and API-backed tabs load.
4. Clerk webhook events are accepted by Convex.
5. Summary generation works with OpenAI key configured.
6. OAuth connect flow returns to settings with success state.

## 9) Troubleshooting

### Backend startup fails with env error

- Error prefix `[env:convex]` means required Convex vars are missing/invalid.
- Fix values in Convex dashboard, then restart backend dev.

### Admin startup fails with env error

- Error prefix `[env:admin]` means missing/invalid `ADMIN_CACHE_SECRET`, `CLERK_SECRET_KEY`, or `NEXT_PUBLIC_CONVEX_URL`.

### OAuth callback fails with 400

- Verify provider redirect URI matches exactly:
  - `${NEXT_PUBLIC_APP_URL}/api/integrations/oauth/<provider>/callback`
- Verify client ID/client secret pair belongs to that OAuth app.

### OAuth token refresh fails later (400)

- Reconnect provider from app settings.
- For Google testing-mode apps, refresh tokens may expire quickly; publish app when appropriate.

### Integration secret crypto error

- If callback or sync fails with integration secret encryption config error, set:
  - `INTEGRATION_SECRETS_KEYRING_JSON`
  - `INTEGRATION_SECRETS_ACTIVE_KEY_ID`
