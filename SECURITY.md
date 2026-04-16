# DayLog Security and Secrets Handling

> Status: Active
> Last Updated: 2026-04-14
> Audience: Engineers and operators
> Standard: [CONTRIBUTING.md](CONTRIBUTING.md)

DayLog uses Clerk, Convex, OpenAI, OAuth providers, and Sentry. Treat all credentials as production secrets.

## 1) Core Policy

- Never commit real secrets to source control.
- Keep only placeholder values in `.env.example` files.
- Store production secrets in platform-managed secret stores.
- Rotate exposed secrets immediately.
- Re-verify auth, webhook, integration sync, and summary generation after rotation.

## 2) Secret Locations by Surface

- Web/admin hosting environment
- Mobile EAS/Expo environment
- Convex deployment environment
- Clerk provider dashboard
- Google Cloud and Spotify developer dashboards
- Sentry project settings

## 3) High-Risk Secrets to Rotate on Exposure

Clerk:

- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_WEBHOOK_SECRET`

OpenAI:

- `OPENAI_API_KEY`

OAuth providers:

- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_SECRET`

Backend/integration encryption:

- Values inside `INTEGRATION_SECRETS_KEYRING_JSON`
- `INTEGRATION_SECRETS_ACTIVE_KEY_ID` when rotating active key selection
- `EXPORT_SIGNING_SECRET`

Observability:

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_SENTRY_DSN`

## 4) Rotation Checklist

1. Rotate secret in provider dashboard first.
2. Update all environments using that secret.
3. Restart/redeploy affected surfaces.
4. Re-run smoke tests:
   - sign-in
   - webhook delivery
   - integration connect/sync
   - summary generation
5. Invalidate stale sessions/tokens if applicable.
6. Audit logs for unusual activity.

## 5) Integration Token Encryption Controls

Production OAuth token storage depends on envelope encryption.
These Convex env vars must be set correctly:

- `INTEGRATION_SECRETS_KEYRING_JSON`
- `INTEGRATION_SECRETS_ACTIVE_KEY_ID`

If either is missing/invalid, OAuth connect/sync paths can fail.

## 6) Branch Protection Verification Security

- Policy file: `.github/branch-protection.expected.json`
- Verification command: `pnpm verify:branch-protection`
- CI secret: `BRANCH_PROTECTION_TOKEN` (least privilege)

Do not expose branch-protection verification tokens to forked PR contexts.

## 7) Manual Secret Scan Commands

From repository root:

```bash
git ls-files '**/.env*'
git grep -nE '(sk_(test|live)_[A-Za-z0-9]{20,}|pk_(test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{16,})' -- . ':(exclude)SECURITY.md'
```

Expected result:

- No real secrets in tracked files.
- Only placeholder values in example env files.
