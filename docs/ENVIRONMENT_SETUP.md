# DayLog environment setup

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

This guide lists **environment variables by surface** and how to validate them. Names match the codebase and `.env.example` files.

## Prerequisites

- **Node.js**: minimum **22.13** (`package.json` `engines`). **Node 22** matches CI (`.github/workflows/backend-validation.yml`).
- **pnpm**: **12.16.1** (`packageManager`).

## Copy example env files

From the repository root:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

Never commit real `.env.local` files.

## Convex URL mapping

Convex exposes a deployment URL. Clients expect different public names:

| Generic | Web / Admin | Mobile |
| ------- | ----------- | ------ |
| Deployment URL | `NEXT_PUBLIC_CONVEX_URL` | `EXPO_PUBLIC_CONVEX_URL` |

Use the **same** deployment URL across all clients for a given environment.

## Web (`apps/web/.env.local`)

Required for local product flows:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL` (must match the origin you use in the browser, including port)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

Recommended:

- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_DSN` (optional server-side Sentry for Next)

## Admin (`apps/admin/.env.local`)

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `ADMIN_CACHE_SECRET` (minimum length enforced at startup; see app README)

## Mobile (`apps/mobile/.env.local`)

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_WEB_APP_URL` (web origin used for OAuth handoff; must match running web)

Optional:

- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_SENTRY_FORCE_TEST_EXCEPTION=true` (test-only)

## Convex deployment (dashboard env)

Set these on the **Convex** deployment used by the apps.

### Core

- `CLERK_JWT_ISSUER_DOMAIN` — HTTPS issuer URL from Clerk.
- `CLERK_WEBHOOK_SECRET` — `whsec_...` signing secret from Clerk webhook configuration.
- `EXPORT_SIGNING_SECRET` — dedicated secret for export/restore signing (do not reuse webhook secret).
- `OPENAI_API_KEY` — `sk-...` for summaries.
- `SUMMARY_DAILY_GENERATION_LIMIT` — numeric cap (example in [../CONVEX_SETUP.md](../CONVEX_SETUP.md)).
- `AI_INPUT_COST_PER_1K_USD` — estimated input cost used for internal telemetry (default `0.005`).
- `AI_OUTPUT_COST_PER_1K_USD` — estimated output cost used for internal telemetry (default `0.015`).
- `AI_GATEWAY_BASE_URL` / `AI_GATEWAY_API_KEY` — optional backend-only gateway configuration.

Ask Your Day and personal insights use the same backend OpenAI credentials. The web
client never receives these values. Configure OpenAI organization/project spend
limits and alerts separately; the application ledger is not an OpenAI billing limit.

### OAuth server-side (refresh and sync)

Same provider credentials as web, also on Convex:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

### Retention

All `RETENTION_*_DAYS` variables listed in [../DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md#2-environment-matrix).

### Integration token encryption (production)

The backend accepts **either**:

1. **KMS-style reference** (preferred for production):  
   `INTEGRATION_SECRETS_KMS_KEY_ID` or `KMS_KEY_ID`, or `KEY_RING_URI` / `INTEGRATION_SECRETS_KEY_RING_URI` depending on your deployment (see `scripts/validate-prod-env.mjs` and [../SECURITY.md](../SECURITY.md)).

2. **Legacy keyring** (migration / dev):  
   `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID`.

CI in **strict** mode (`--mode=ci`) requires **at least one** of these paths to be configured (`validate-prod-env.mjs`).

### Sensitive field encryption

- `SENSITIVE_DATA_KEYRING_JSON`
- `SENSITIVE_DATA_ACTIVE_KEY_ID`

See [../CONVEX_SETUP.md](../CONVEX_SETUP.md) and [../SECURITY.md](../SECURITY.md) for rotation and policy.

### Observability ingest (if used)

Turbo `globalEnv` and Convex code may reference observability ingest secrets and allowlists (see `turbo.json` and `packages/backend/convex/observabilityIngestion*.ts`). Configure only if you enable those paths.

## Validate configuration

```bash
# Lenient local check
node scripts/validate-prod-env.mjs --mode=local

# Strict (matches production gate semantics)
node scripts/validate-prod-env.mjs --mode=ci
```

The **main** branch path in `backend-validation` uses `MODE=ci` when validating secrets from GitHub Actions.

## Clerk webhook URL

Register in the Clerk dashboard:

- `https://<your-deployment>.convex.site/clerk/webhook`

Subscribe at minimum to: `user.created`, `user.updated`, `user.deleted` (see [../CONVEX_SETUP.md](../CONVEX_SETUP.md)).

## Further reading

- [API_OVERVIEW.md](./API_OVERVIEW.md) — Convex usage from apps.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Env-related errors.
