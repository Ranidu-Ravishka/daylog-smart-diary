# DayLog Security: Secrets and Environment Handling

This project uses Clerk, Convex, and OpenAI credentials. Treat all secrets as sensitive and rotate immediately if they appear in git history.

## Secret handling policy

- Never commit real values in `.env`, `.env.local`, or any local secret file.
- Keep only placeholders in `.env.example` files.
- Store runtime secrets in platform-managed secret stores:
  - Convex dashboard env variables
  - Vercel/hosting project env variables
  - EAS/Expo secure environment configuration
- If a secret is exposed, rotate it first, then update docs/examples.
- CI runs a high-confidence secret scan on feature branches and PRs.

## Immediate rotation guidance

Based on repository audit, the following providers should be reviewed and rotated now if the exposed values were ever valid in your environments.

### Clerk

Rotate immediately:

- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_WEBHOOK_SECRET`

Also verify:

- JWT template used by Convex (`applicationID: "convex"`)
- Allowed domains, redirect URLs, and webhook endpoint subscriptions

### Convex

Review and rotate/redeploy if needed:

- Deployment URL used in examples (`NEXT_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_CONVEX_URL`)
- Any backend env values in Convex dashboard if they were paired with exposed keys

### OpenAI

Rotate immediately:

- `OPENAI_API_KEY`

Also verify:

- API key scope and project ownership
- Spend limits and alerting

## Practical rotation checklist

1. Rotate Clerk secret key and webhook secret in Clerk dashboard.
2. Rotate Clerk publishable keys if they were tied to compromised configuration.
3. Rotate OpenAI API key.
4. Update Convex dashboard env vars (`CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`, `OPENAI_API_KEY`, bootstrap ids).
5. Update deployment env vars for web/admin/mobile and local `.env.local` files.
6. Invalidate old sessions/tokens where applicable.
7. Re-run sign-in, webhook, and summary generation smoke tests.
8. Confirm tracked `.env.example` files contain placeholders only.
9. Review git history for accidental secret commits and purge if required.
10. Enable secret scanning in CI/Git provider for future detection.

## Manual verification commands

Run from repo root:

- `git ls-files '**/.env*'`
- `git grep -nE '(sk_(test|live)_[A-Za-z0-9]{20,}|pk_(test|live)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{16,})' -- . ':(exclude)SECURITY.md'`

Expected result:

- Only `.env.example` files are tracked.
- No real credentials in docs or source.
