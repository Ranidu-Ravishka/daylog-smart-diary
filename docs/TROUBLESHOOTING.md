# DayLog troubleshooting

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

## Environment and startup

### `[env:convex]` or Convex dev fails immediately

- Convex deployment env vars are missing or invalid. Fix in the Convex dashboard, then restart `pnpm dev:backend`.
- Compare required variables with [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) and [../CONVEX_SETUP.md](../CONVEX_SETUP.md).

### Admin fails with `[env:admin]`

- Check `ADMIN_CACHE_SECRET` length and strength, `CLERK_SECRET_KEY`, and `NEXT_PUBLIC_CONVEX_URL` (must be valid `https` URL in production-style validation).

### `validate-prod-env` fails in CI

- On `main`, the repo runs strict mode. Ensure **either** KMS env vars **or** valid legacy `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID` are present in secrets (see `scripts/validate-prod-env.mjs`).
- Confirm `CLERK_JWT_ISSUER_DOMAIN` is **https**, `CLERK_WEBHOOK_SECRET` starts with `whsec_`, and `OPENAI_API_KEY` starts with `sk-`.

## OAuth

### Redirect URI mismatch

- Provider redirect URI must match exactly:  
  `{NEXT_PUBLIC_APP_URL}/api/integrations/oauth/<provider>/callback`  
  where `<provider>` is `google_calendar`, `google_fit`, or `spotify` (see [../apps/web/README.md](../apps/web/README.md)).

### Mobile handoff fails

- `EXPO_PUBLIC_WEB_APP_URL` must point at the same web instance that completed OAuth.
- User must still be signed in when returning to the app if your flow depends on session cookies on web.

### Token refresh errors later

- Reconnect the integration from settings.
- Confirm Google OAuth app is not stuck in **testing** mode with expired refresh policies when you expect long-lived tokens.

## Builds

### Next.js build fails on missing Convex URL

- CI sets a dummy `NEXT_PUBLIC_CONVEX_URL` for builds. Locally, set real or dummy **https** URLs in `.env.local` so `ConvexReactClient` construction succeeds.

### Mobile `build:ci` fails

- Run `pnpm --filter mobile check-types` and `pnpm --filter mobile lint` for faster signal.
- Native-only features require a **development build**, not Expo Go alone.

## Backend and data

### Integration encryption errors

- Verify KMS or legacy integration keyring configuration per [../SECURITY.md](../SECURITY.md).

### Sensitive-data migration warnings

- Follow [../DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md) dry-run → full migration sequence; stop if `validationRejectRiskRows > 0`.

## Logs

- Convex: `pnpm --filter @repo/backend logs` or the Convex dashboard.
- Web/Admin: host logs (for example Vercel).
- Mobile: Expo / device logs.

## Still stuck

1. Re-read the surface README under `apps/<name>/README.md`.
2. Search Convex handlers for the feature’s module in `packages/backend/convex/`.
3. Open an issue with repro steps, environment (dev/staging/prod), and **redacted** env key names (not values).
