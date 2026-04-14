# DayLog Backend (`packages/backend`)

> Status: Active
> Last Updated: 2026-04-14
> Audience: Backend engineers
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Shared Convex backend for web, admin, and mobile.

Canonical onboarding:

- [../../README.md](../../README.md)
- [../../CONVEX_SETUP.md](../../CONVEX_SETUP.md)

## Local Commands

From repository root:

```bash
pnpm --filter @repo/backend dev
pnpm --filter @repo/backend logs
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
pnpm --filter @repo/backend test:coverage:backend
```

## Required Convex Environment Variables

Core required:

- `CLERK_JWT_ISSUER_DOMAIN`
- `CLERK_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `SUMMARY_DAILY_GENERATION_LIMIT`

OAuth sync credentials (recommended and required for durable provider refresh flows):

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Observability:

- `SENTRY_DSN`
- optional `SENTRY_TRACES_SAMPLE_RATE`
- optional `SENTRY_INFO_EVENT_SAMPLE_RATE`

Integration token encryption (production critical):

- `INTEGRATION_SECRETS_KEYRING_JSON`
- `INTEGRATION_SECRETS_ACTIVE_KEY_ID`

Optional operational env:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS`
- retention policy overrides (`RETENTION_*`)

## Validation Behavior

Backend startup validates required env values and fails fast when invalid.

Examples:

- non-https issuer domain rejected
- invalid webhook secret format rejected
- placeholder/example values rejected

## Important Operational Paths

- Summary generation:
  - `summaryGeneration:generateSummaryForDay`
- Export artifacts and jobs:
  - `summaries:prepareMyDiaryExportArtifact`
  - `summaries:listMyExportJobsPaginated`
  - `summaries:getMyExportJobDownloadUrl`
- Integration secret migration/audit:
  - `integrations:adminAuditIntegrationSecretsEncryptionStatus`
  - `integrations:adminMigrateLegacyIntegrationSecretsAll`

## Troubleshooting

- `[env:convex]` startup errors:
  - Fix missing/invalid Convex env vars and restart backend dev.
- OAuth callback/integration connect crypto errors:
  - Verify integration encryption env vars are present.
- Token refresh failures (`400`):
  - Reconnect provider and verify provider OAuth app status/settings.
