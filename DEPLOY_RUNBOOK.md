# DayLog Deploy and Operations Runbook

> Status: Active
> Last Updated: 2026-04-14
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
- `OPENAI_API_KEY`
- `SUMMARY_DAILY_GENERATION_LIMIT`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SENTRY_DSN`
- `INTEGRATION_SECRETS_KEYRING_JSON`
- `INTEGRATION_SECRETS_ACTIVE_KEY_ID`

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

1. Audit encrypted integration secrets:
   - `integrations:adminAuditIntegrationSecretsEncryptionStatus`
2. If needed, run migration sweep:
   - `integrations:adminMigrateLegacyIntegrationSecretsAll`

## 6) Operational Commands

Backend logs:

```bash
pnpm --filter @repo/backend logs
```

Admin bootstrap:

1. Set `ADMIN_BOOTSTRAP_CLERK_USER_IDS` in Convex env.
2. Sign in as listed Clerk user.
3. Call mutation `users:bootstrapMakeMeAdmin`.

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
