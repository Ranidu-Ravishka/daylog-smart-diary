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
Backend/integration encryption (preferred KMS-backed key management):

- `INTEGRATION_SECRETS_KMS_KEY_ID` — Preferred production config. Set this to your KMS key identifier (for example an AWS KMS KeyId or ARN). When present, the runtime will use KMS to wrap/unwrap data-encryption-keys (DEKs); do not store plaintext key material in environment variables.
- `INTEGRATION_SECRETS_KEY_RING_URI` — Optional provider-specific key ring identifier (for multi-cloud setups).
- `INTEGRATION_SECRETS_AUDIT_LOG_PATH` — Optional local file path where the backend will append best-effort audit events (used for on-host auditing during rotation).
- `INTEGRATION_SECRETS_LOCAL_KEK_PATH` — Local-dev fallback (base64-encoded 32-byte AES key stored in a 0600 file). Use only for developer machines; do not commit this file.

Legacy (deprecated but supported during migration):

- `INTEGRATION_SECRETS_KEYRING_JSON` — JSON mapping of key ids to base64-encoded AES-256 keys. Keep only while migrating; do not add new keys here when using KMS.
- `INTEGRATION_SECRETS_ACTIVE_KEY_ID` — The active key id in the legacy keyring used to encrypt new records.

Migration and rotation guidance:

1. Create a new KMS key in your cloud provider and grant the Convex runtime (or host identity) permission to use it for Encrypt/Decrypt.
2. Set `INTEGRATION_SECRETS_KMS_KEY_ID` in your Convex deployment (or `KMS_KEY_ID` fallback) to the new key identifier.
3. Run the rotation helper to re-encrypt existing database secrets with the new KMS key. From the repository root:

```bash
node scripts/rotate-integration-kms.mjs --target <target> --new-key-id <KMS_KEY_ID> --admin-subject <admin-identity>
```

Options:

- `--dry-run` — compute and print the planned changes without modifying data.
- `--admin-subject` — admin identity used to run the Convex internal rotation mutation.

Notes:

- Maintain the legacy `INTEGRATION_SECRETS_KEYRING_JSON` (read-only) until all records have been re-encrypted and validated. Remove it only after rotation completes and you have retained any required key history per your policy.
- Do NOT store plaintext key material in environment variables for production. Prefer KMS or an external secrets manager.
- For local development, use `scripts/init-local-integration-kms.mjs` to create a local KEK file and set `INTEGRATION_SECRETS_LOCAL_KEK_PATH` in your local env. This avoids putting plaintext keys in `.env` files.

Audit and monitoring:

- The backend will emit best-effort structured audit events for encryption, decryption, and rotation. You can configure `INTEGRATION_SECRETS_AUDIT_LOG_PATH` to persist a local audit log (useful during rotation). For production, forward these events to a secure centralized audit sink.
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
