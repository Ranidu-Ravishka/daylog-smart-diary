# DayLog Deploy and Operations Runbook

> Status: Active
> Last Updated: 2026-05-15
> Audience: Engineers and release drivers
> Standard: [CONTRIBUTING.md](CONTRIBUTING.md)

This runbook defines release and operational steps for DayLog production.

Related policy docs:

- [workflow.md](workflow.md)
- [SECURITY.md](SECURITY.md)
- [CONVEX_SETUP.md](CONVEX_SETUP.md)

## 1) Deployment Surfaces

- Web: Next.js app in `apps/web` (target: Vercel or equivalent)
- Admin: Next.js app in `apps/admin` (target: Vercel or equivalent)
- Mobile: Expo app in `apps/mobile` (target: Expo/EAS)
- Backend: Convex package in `packages/backend` (target: Convex deployment)

## 2) Environment Matrix

Web/admin environment:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

Web integration env:

- `NEXT_PUBLIC_APP_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Web observability env:

- `NEXT_PUBLIC_SENTRY_DSN`
- optional `SENTRY_DSN`

Mobile environment:

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_WEB_APP_URL`
- `EXPO_PUBLIC_SENTRY_DSN`

Convex deployment environment:

- `CLERK_JWT_ISSUER_DOMAIN`
- `CLERK_WEBHOOK_SECRET`
- `EXPORT_SIGNING_SECRET`
- `OPENAI_API_KEY`
- `SUMMARY_DAILY_GENERATION_LIMIT`
- `RETENTION_MEMORIES_DAYS`
- `RETENTION_DAYS_RECORDS_DAYS`
- `RETENTION_DAY_SUMMARIES_DAYS`
- `RETENTION_INTEGRATION_DATA_DAYS`
- `RETENTION_SYNC_RUNS_DAYS`
- `RETENTION_LOCATION_SIGNALS_DAYS`
- `RETENTION_SUMMARY_EVENTS_DAYS`
- `RETENTION_AI_SUMMARY_ATTEMPTS_DAYS`
- `RETENTION_SUMMARY_QUALITY_DAYS`
- `RETENTION_DAILY_FEATURE_VECTORS_DAYS`
- `RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS`
- `RETENTION_SUMMARY_QUOTAS_DAYS`
- `RETENTION_INFO_EVENTS_DAYS`
- `RETENTION_HEALTH_EVENTS_DAYS`
- `RETENTION_AUDIT_LOGS_DAYS`
- `RETENTION_PLATFORM_AUDIT_DAYS`
- `RETENTION_EXPORT_JOBS_DAYS`
- `RETENTION_RESTORE_JOBS_DAYS`
- `RETENTION_USER_DELETION_JOBS_DAYS`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SENTRY_DSN`
- `INTEGRATION_SECRETS_KMS_KEY_ID` / `KMS_KEY_ID` / `KEY_RING_URI` **or** legacy `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID`
- `SENSITIVE_DATA_KEYRING_JSON`
- `SENSITIVE_DATA_ACTIVE_KEY_ID`

Retention policy values by environment (set these explicitly in Convex env):

Production:

```dotenv
RETENTION_MEMORIES_DAYS=365
RETENTION_DAYS_RECORDS_DAYS=180
RETENTION_DAY_SUMMARIES_DAYS=180
RETENTION_INTEGRATION_DATA_DAYS=180
RETENTION_SYNC_RUNS_DAYS=120
RETENTION_LOCATION_SIGNALS_DAYS=30
RETENTION_SUMMARY_EVENTS_DAYS=90
RETENTION_AI_SUMMARY_ATTEMPTS_DAYS=90
RETENTION_SUMMARY_QUALITY_DAYS=90
RETENTION_DAILY_FEATURE_VECTORS_DAYS=180
RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS=180
RETENTION_SUMMARY_QUOTAS_DAYS=365
RETENTION_INFO_EVENTS_DAYS=90
RETENTION_HEALTH_EVENTS_DAYS=180
RETENTION_AUDIT_LOGS_DAYS=365
RETENTION_PLATFORM_AUDIT_DAYS=365
RETENTION_EXPORT_JOBS_DAYS=30
RETENTION_RESTORE_JOBS_DAYS=30
RETENTION_USER_DELETION_JOBS_DAYS=365
```

Staging:

```dotenv
RETENTION_MEMORIES_DAYS=120
RETENTION_DAYS_RECORDS_DAYS=90
RETENTION_DAY_SUMMARIES_DAYS=90
RETENTION_INTEGRATION_DATA_DAYS=90
RETENTION_SYNC_RUNS_DAYS=60
RETENTION_LOCATION_SIGNALS_DAYS=14
RETENTION_SUMMARY_EVENTS_DAYS=30
RETENTION_AI_SUMMARY_ATTEMPTS_DAYS=45
RETENTION_SUMMARY_QUALITY_DAYS=45
RETENTION_DAILY_FEATURE_VECTORS_DAYS=90
RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS=90
RETENTION_SUMMARY_QUOTAS_DAYS=120
RETENTION_INFO_EVENTS_DAYS=45
RETENTION_HEALTH_EVENTS_DAYS=90
RETENTION_AUDIT_LOGS_DAYS=120
RETENTION_PLATFORM_AUDIT_DAYS=120
RETENTION_EXPORT_JOBS_DAYS=14
RETENTION_RESTORE_JOBS_DAYS=14
RETENTION_USER_DELETION_JOBS_DAYS=120
```

Development:

```dotenv
RETENTION_MEMORIES_DAYS=60
RETENTION_DAYS_RECORDS_DAYS=45
RETENTION_DAY_SUMMARIES_DAYS=45
RETENTION_INTEGRATION_DATA_DAYS=45
RETENTION_SYNC_RUNS_DAYS=30
RETENTION_LOCATION_SIGNALS_DAYS=7
RETENTION_SUMMARY_EVENTS_DAYS=14
RETENTION_AI_SUMMARY_ATTEMPTS_DAYS=21
RETENTION_SUMMARY_QUALITY_DAYS=21
RETENTION_DAILY_FEATURE_VECTORS_DAYS=45
RETENTION_NEXT_BEST_DAY_RECOMMENDATIONS_DAYS=45
RETENTION_SUMMARY_QUOTAS_DAYS=45
RETENTION_INFO_EVENTS_DAYS=21
RETENTION_HEALTH_EVENTS_DAYS=45
RETENTION_AUDIT_LOGS_DAYS=60
RETENTION_PLATFORM_AUDIT_DAYS=60
RETENTION_EXPORT_JOBS_DAYS=7
RETENTION_RESTORE_JOBS_DAYS=7
RETENTION_USER_DELETION_JOBS_DAYS=60
```

## 3) Pre-Release Checks

From repository root:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build:web
pnpm build:admin
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
```

### Pre-deploy validation

Before any production deploy, run the repository environment validator to ensure required secrets and production envs are present and valid. This can be run locally for a quick check or enforced in CI as a pre-deploy gate.

Local quick check:

```bash
# local (less strict) checks
node scripts/validate-prod-env.mjs --mode=local
```

CI / pre-deploy gate (strict): this repo validates secrets in **`backend-validation`** (see `.github/workflows/backend-validation.yml`) and also runs **`validate-prod-env`** standalone on pushes to `main` (`.github/workflows/validate-prod-env.yml`). There is no separate `pre-deploy-validate.yml` workflow file.

To reuse the same gate in an external deploy pipeline, run the script directly and pass the same secrets your Convex production deployment uses:

```yaml
jobs:
  pre-deploy-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: corepack enable && pnpm install --frozen-lockfile
      - name: Validate prod env (strict)
        env:
          NODE_ENV: production
          CLERK_JWT_ISSUER_DOMAIN: ${{ secrets.CLERK_JWT_ISSUER_DOMAIN }}
          CLERK_WEBHOOK_SECRET: ${{ secrets.CLERK_WEBHOOK_SECRET }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          EXPORT_SIGNING_SECRET: ${{ secrets.EXPORT_SIGNING_SECRET }}
          INTEGRATION_SECRETS_KMS_KEY_ID: ${{ secrets.INTEGRATION_SECRETS_KMS_KEY_ID }}
          KMS_KEY_ID: ${{ secrets.KMS_KEY_ID }}
          KEY_RING_URI: ${{ secrets.KEY_RING_URI }}
          INTEGRATION_SECRETS_KEYRING_JSON: ${{ secrets.INTEGRATION_SECRETS_KEYRING_JSON }}
          INTEGRATION_SECRETS_ACTIVE_KEY_ID: ${{ secrets.INTEGRATION_SECRETS_ACTIVE_KEY_ID }}
        run: node scripts/validate-prod-env.mjs --mode=ci
```

Strict mode requires **either** KMS-style references (`INTEGRATION_SECRETS_KMS_KEY_ID` / `KMS_KEY_ID` / `KEY_RING_URI`) **or** a valid legacy keyring pair; see `scripts/validate-prod-env.mjs`.

Branch policy verification:

```bash
GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> pnpm verify:branch-protection -- --branch main
```

## 4) Deploy Order

Recommended order for production stability:

1. Deploy backend (Convex)
2. Deploy web and admin
3. Publish mobile build/update

### 4.1 Backend deploy

From repository root:

```bash
pnpm --filter @repo/backend exec convex deploy
```

After deploy:

- Verify Convex env variables are set and non-placeholder.
- Verify Clerk webhook endpoint is reachable.

### 4.2 Web/admin deploy

- Deploy from the commit that passed required CI checks.
- Ensure web/admin environment variables match backend deployment URL and auth keys.

### 4.3 Mobile deploy

- Build and publish via Expo/EAS according to release channel policy.
- Ensure `EXPO_PUBLIC_WEB_APP_URL` points to the deployed web host used for OAuth completion.

## 5) Post-Deploy Smoke Tests

Core:

1. Sign in on web, admin, and mobile.
2. Create memory and verify day timeline updates.
3. Generate daily summary.
4. Connect at least one OAuth provider and run sync.
5. Run export flow and confirm artifact download.

Observability:

1. Confirm Sentry receives events from web/mobile/backend.
2. Confirm structured logs include `event`, `userId`, `status`, `errorMessage`.
3. Confirm no silent failures in critical user flows.

Security/integration data:

1. Run integration token hardening gate:
   - `pnpm ops:run-integration-token-hardening -- --target <target> --mode migrate`
2. The command must report and enforce all-zero values before deployment:
   - `nonOpaqueCount`
   - `unsafeCount`
   - `legacyPlaintextRows`
   - `missingEncryptedAccessRows`
3. Audit sensitive-data migration validation risk:
   - `sensitiveDataMigration:adminAuditSensitiveDataTableStatus`
4. If any table reports `validationRejectRiskRows > 0`, stop rollout before enabling/continuing writes.

## 6) Operational Commands

Backend logs:

```bash
pnpm --filter @repo/backend logs
```

Sensitive-data key rotation (target: `dev`, `prod`, `preview:<name>`, or `deployment:<name>`):

```bash
pnpm ops:rotate-sensitive-data-keyring -- --target <target>
```

Sensitive-data migration and audit:

```bash
pnpm ops:run-sensitive-data-migration -- --target <target> --mode dry-run
pnpm ops:run-sensitive-data-migration -- --target <target> --mode full
```

Integration token hardening migration and audit:

```bash
pnpm ops:run-integration-token-hardening -- --target <target> --mode migrate
pnpm ops:run-integration-token-hardening -- --target <target> --mode audit
```

Key ID policy for sensitive-data keyring:

- Use monotonic, unique key IDs (for example `sd_YYYYMMDDHHmmss_env`).
- Keep old key IDs in `SENSITIVE_DATA_KEYRING_JSON` while any old ciphertext may still exist.
- Rotate by adding a new key ID/key and setting `SENSITIVE_DATA_ACTIVE_KEY_ID` to the new ID.

Staging to production rollout sequence:

1. Rotate keyring in staging target.
2. Run staging dry-run migration.
3. Run staging full migration.
4. Confirm `validationRejectRiskRows` is zero across all tables.
5. Rotate keyring in production target.
6. Run production full migration and verify audit output remains at zero risk.

Admin bootstrap:

1. Set `ADMIN_BOOTSTRAP_CLERK_USER_IDS` in Convex env.
2. Sign in as listed Clerk user.
3. Call mutation `users:bootstrapMakeMeAdmin`.

### 6.1 OAuth revocation operations

- `integrations:disconnectIntegration` disables local use immediately. Google Calendar/Fit and Gmail Summary revocation is asynchronous; the encrypted token remains available only while the job is pending or processing.
- A 15-minute Convex cron retries due jobs and recovers interrupted processing attempts. Confirm the cron is active after backend deployment.
- A terminal `failed` status means remote revocation was **not confirmed**. Do not report the provider grant revoked. Ask the user to revoke DayLog access in the provider account and reconnect only if needed.
- Spotify revocation is unsupported by this implementation. Local tokens are removed immediately; instruct users to revoke DayLog access from Spotify's account settings.
- Review revocation failures and retryable backlog using approved, access-controlled Convex operational tooling. Never copy or expose token values in logs, tickets, or support communications. Terminal job metadata is removed after 30 days.

### 6.2 Export cleanup and account deletion

- Scheduled retention cleanup runs every six hours. If storage deletion fails, the export job and artifact ID are retained with a generic error code, attempt count and next-attempt timestamp; the next scheduled cleanup retries it.
- Account deletion fails visibly if storage cleanup fails. Resolve the storage outage and retry the failed deletion through the existing account-deletion flow; do not mark it complete manually while data remains.
- These mechanisms retry artifacts still referenced by database rows. There is no source-verified global object-storage inventory, so previously orphaned artifacts without database references need a separately approved provider inventory/reconciliation procedure. Never delete objects based on client-supplied IDs.
- A completed active-database deletion does not prove erasure from backups or external providers. Do not promise immediate backup erasure.

### 6.3 Backup, recovery and retention evidence

The repository does not establish production backup frequency, storage location, encryption, operator access, retention duration, restore-test results, or backup erasure behavior. Before public release, the service owner must document and verify those settings with the actual Convex/storage provider. Keep separate evidence for:

1. Deletion from active application records.
2. Deletion from object storage.
3. Expiration from retained backups under the configured schedule.
4. Any legal/operational retention exceptions.

Do not claim immediate or completed backup erasure unless the provider's control and audit evidence supports that claim. Test recovery only in an isolated environment.

## 7) Rollback Guidance

If release issues occur:

1. Stop rollout to remaining surfaces.
2. Revert web/admin/mobile deployment to previous known-good build.
3. If backend schema/behavior caused issue, roll forward with targeted hotfix (preferred) and guarded migration path.
4. Keep incident notes including user impact, detection path, and corrective action.

Do not bypass observability and data-integrity requirements during rollback/hotfix.

## 8) Production Readiness Gate

All of the following must be true before final release sign-off:

1. Environment variables are correct and validated.
2. Sentry is connected on required surfaces.
3. Integrations connect/sync in target environment.
4. CI required checks are green.
5. No debug `console.log` usage remains in production-critical code paths.
6. Google revocation retry monitoring and Spotify user instructions are operationally assigned.
7. Storage cleanup retry procedures and backup/recovery/retention evidence are reviewed.
8. Legacy AI quality-event redaction has completed in the target environment.
