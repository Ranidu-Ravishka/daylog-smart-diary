# DayLog backend (`packages/backend`)

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Backend engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Shared **Convex** backend for web, admin, and mobile (`@repo/backend`).

**Onboarding:** [../../README.md](../../README.md) · **Convex setup:** [../../CONVEX_SETUP.md](../../CONVEX_SETUP.md) · **API shape:** [../../docs/API_OVERVIEW.md](../../docs/API_OVERVIEW.md)

## HTTP routes (`convex/http.ts`)

Mounted on your Convex **HTTP site** URL (same host Clerk webhooks use):

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/clerk/webhook` | Clerk user sync (`webhooks.ts`) |
| `POST` | `/integrations/oauth/connect` | OAuth connect helper (`oauthConnect.ts`) |
| `OPTIONS` / `POST` | `/observability/info-event` | Client info-event ingest (`observabilityIngestion.ts`) |

Provider OAuth **callbacks** for Google and Spotify are implemented on **Next.js** (`apps/web`), not here.

## Local commands

From repository root:

```bash
pnpm dev:backend
pnpm --filter @repo/backend dev
pnpm --filter @repo/backend logs
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
pnpm --filter @repo/backend test:coverage:backend
```

## Convex environment variables

### Core

- `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`, `EXPORT_SIGNING_SECRET`, `OPENAI_API_KEY`, `SUMMARY_DAILY_GENERATION_LIMIT`

### OAuth (server-side refresh)

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

### Observability

- `SENTRY_DSN`, optional `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_INFO_EVENT_SAMPLE_RATE`

### Integration token encryption

- **Preferred:** `INTEGRATION_SECRETS_KMS_KEY_ID` or `KMS_KEY_ID` (and optional key ring URI variables per deployment).
- **Legacy:** `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID`.

### Sensitive-data encryption

- `SENSITIVE_DATA_KEYRING_JSON`, `SENSITIVE_DATA_ACTIVE_KEY_ID`

### Optional ops

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS`
- All `RETENTION_*` knobs (see [../../DEPLOY_RUNBOOK.md](../../DEPLOY_RUNBOOK.md))

Startup reads and validates many of these in `convex/env.ts` (fail-fast on invalid production config).

## Cron and retention

- **`crons.ts`** — scheduled jobs (retention, housekeeping).
- **`retention.ts`** — env-driven day counts per table class.

## Important Convex entry points (for grep / ops)

- Summaries: `summaryGeneration`, `summaries` modules.
- Export jobs: `summaries:prepareMyDiaryExportArtifact`, `summaries:listMyExportJobsPaginated`, `summaries:getMyExportJobDownloadUrl`.
- Integration crypto audit: `integrations:adminAuditIntegrationSecretsEncryptionStatus`.
- Sensitive-data migration: `sensitiveDataMigration:adminMigrateAllSensitiveData`, `sensitiveDataMigration:adminAuditSensitiveDataTableStatus`.

## Operational scripts (repo root)

```bash
pnpm ops:rotate-sensitive-data-keyring -- --target <target>
pnpm ops:run-sensitive-data-migration -- --target <target> --mode dry-run
pnpm ops:run-sensitive-data-migration -- --target <target> --mode full
```

## Troubleshooting

- **`[env:convex]`** — Fix Convex dashboard env and restart `pnpm dev:backend`.
- **Integration crypto errors** — Verify KMS or legacy keyring per [../../SECURITY.md](../../SECURITY.md).
- **Token refresh `400`** — User reconnect + verify provider app status.

See [../../docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md).

## AI / agent hints

`AGENTS.md` and `CLAUDE.md` point Convex contributors at `convex/_generated/ai/guidelines.md`.
