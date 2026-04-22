# DayLog Contributing Guide (Documentation)

> Status: Active
> Last Updated: 2026-04-14
> Audience: All contributors

This guide defines how documentation must be updated in DayLog.
Use it for all markdown changes in the repository.

## 1) Core Rules

1. Do not invent features or behavior.
2. Use repository code and scripts as source of truth.
3. Keep onboarding steps exact and runnable.
4. Do not leave placeholders unexplained.
5. Keep one canonical source per topic.

## 2) Required Document Header Template

Every maintained markdown file should start with:

- A single H1 title
- A metadata block with:
  - Status
  - Last Updated
  - Audience
  - Standard link to this guide

Example structure:

- H1 title
- Metadata blockquote lines
- Intro paragraph

## 3) Ownership Boundaries

- README.md:
  - Canonical project onboarding, environment matrix, and run commands.
- workflow.md:
  - Engineering and production standards.
- DEPLOY_RUNBOOK.md:
  - Release and operational procedures.
- SECURITY.md:
  - Secret handling and rotation policy.
- App/package READMEs:
  - Surface-specific setup and troubleshooting only.

Do not duplicate full onboarding across app-level READMEs.
Link back to README.md for canonical setup.

## 4) Environment Variable Documentation Rules

1. Document exact variable names from code.
2. If teams use aliases, show explicit mapping (for example CONVEX_URL -> NEXT_PUBLIC_CONVEX_URL).
3. Separate variables by surface (web, admin, mobile, backend).
4. Mark production-critical variables clearly (auth, encryption, observability).

## 5) Command Documentation Rules

1. Document commands that exist in package.json scripts, or provide direct package commands.
2. Prefer root-level commands for onboarding.
3. Call out scope when a command is package-specific.
4. Keep examples copy-paste safe.

## 6) Writing Style Rules

1. Use short, direct sentences.
2. Prefer numbered steps for procedures.
3. Prefer bullets for requirements/checklists.
4. Avoid ambiguous terms like "usually" and "might" in setup steps.
5. Use consistent section naming across docs.

## 7) Links and References

1. Use relative links to files in this repository.
2. Keep links current when files move or are removed.
3. If a file is removed, update all references in the same change.

## 8) Update Checklist (Before Merge)

1. Validate all commands still exist and run.
2. Validate env var names against source files.
3. Remove stale duplicate content.
4. Update Last Updated metadata date.
5. Ensure related docs remain consistent.

## 9) Preferred Change Pattern

When changing architecture or runtime behavior:

1. Update code first.
2. Update canonical doc second (README/workflow/runbook/security).
3. Update surface docs third (apps/packages).
4. Add migration/troubleshooting notes when behavior changed.

## 10) CI Secrets & Validation Checklist

Before merging changes that affect production configuration or deployment, run this checklist:

1. Add or update required repository secrets (do not commit secrets to source):

- `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `EXPORT_SIGNING_SECRET`, `INTEGRATION_SECRETS_KEYRING_JSON`, `INTEGRATION_SECRETS_ACTIVE_KEY_ID`.

2. Run the validator locally to verify formats and keys:

```bash
node scripts/validate-prod-env.mjs --mode=local
```

3. Ensure CI will run the validator in strict mode (the repo contains `.github/workflows/validate-prod-env.yml`). The CI job will run in `--mode=ci` on `main` pushes and will fail the pipeline on invalid/missing secrets.
4. Confirm `INTEGRATION_SECRETS_KEYRING_JSON` contains a JSON object mapping key ids to base64-encoded 32-byte keys and that `INTEGRATION_SECRETS_ACTIVE_KEY_ID` matches one of those keys.
5. Do not use placeholder values in secrets; the validator rejects common placeholder tokens (for example `changeme`, `replace-me`, `your_...`).
6. If adding new production env vars, document them in `README.md` and add validation in `scripts/validate-prod-env.mjs`.

Follow this checklist to reduce accidental misconfiguration and deploy-time failures.
