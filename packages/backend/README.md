# DayLog Backend Package (`packages/backend`)

Shared Convex backend for web, admin, and mobile apps.

## Local commands

From repo root:

```bash
pnpm --filter @repo/backend dev
pnpm --filter @repo/backend logs
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
```

## Backend CI gate

The canonical `backend-validation` CI check executes:

```bash
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
```

Keep these commands green locally before opening a PR with backend changes.

## Backend structure

- Convex functions: `packages/backend/convex/*.ts`
- Schema: `packages/backend/convex/schema.ts`
- Auth config: `packages/backend/convex/auth.config.ts`
- Generated API/types: `packages/backend/convex/_generated/*`

## Required Convex environment variables

- `CLERK_JWT_ISSUER_DOMAIN`
- `CLERK_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `SUMMARY_DAILY_GENERATION_LIMIT`

Optional:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS`
- `RETENTION_MEMORIES_DAYS`
- `RETENTION_DAY_SUMMARIES_DAYS`
- `RETENTION_INTEGRATION_DATA_DAYS`
- `RETENTION_LOCATION_SIGNALS_DAYS`
- `RETENTION_SUMMARY_EVENTS_DAYS`
- `RETENTION_DELETE_BATCH_SIZE`
- `SUMMARY_LOW_QUALITY_THRESHOLD`

## Admin bootstrap (Clerk)

To create your first admin user (so you can access the admin app), set this
Convex environment variable (in the Convex Dashboard) to a comma-separated list
of Clerk user IDs allowed to self-promote:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS=clerk_user_id_1,clerk_user_id_2`

Then call the mutation `users:bootstrapMakeMeAdmin` while signed in.

## AI summary generation environment

Set the OpenAI API key in Convex dashboard environment variables:

- `OPENAI_API_KEY=your_openai_api_key`

This key is used by `summaryGeneration:generateSummaryForDay` via an internal Convex action.

## Startup env validation

Convex backend startup now fails fast when required env variables are missing,
empty, malformed, or placeholder values:

- `CLERK_JWT_ISSUER_DOMAIN` (required https URL)
- `CLERK_WEBHOOK_SECRET` (required, must start with `whsec_`)
- `OPENAI_API_KEY` (required, must start with `sk-`)

Optional:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (if set, must contain real Clerk IDs)

If you see an `[env:convex]` startup error, fix the listed variables in Convex
dashboard environment settings and restart `convex dev`.

## Integration sync notes

- Supported providers currently include `google_calendar`, `google_fit`, `spotify`, `apple_health`.
- Provider daily sync data is normalized into `integrationDailyData`.
- Summary generation consumes integration daily data as additional model context.

## Maturity layer modules

- Integration provider adapters: `packages/backend/convex/providerAdapters.ts`
- Integration health snapshots/events: `packages/backend/convex/integrationHealth.ts`
- Retention policies + cleanup jobs: `packages/backend/convex/retention.ts`
- Summary quality harness: `packages/backend/convex/summaryQuality.ts`
- Scheduled cleanup registration: `packages/backend/convex/crons.ts`

### Retention operations

- Scheduled cleanup: every 6 hours via `retention:runScheduledRetentionCleanupInternal`.
- Manual admin trigger: `retention:runRetentionCleanupNow`.
- Admin policy override: `retention:upsertRetentionPolicy`.

### Summary quality operations

- Automatic generation logging + scoring is wired into `summaryGeneration:generateSummaryForDay`.
- Admin backlog evaluation for historical data: `summaryQuality:backfillSummaryQualityEvaluations`.
