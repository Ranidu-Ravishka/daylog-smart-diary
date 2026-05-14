# DayLog deployment overview

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers and release drivers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

This page summarizes **where** each part of DayLog runs and **in what order** to deploy. Step-by-step operations, retention matrices, and smoke tests live in the **[DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md)**.

## Surfaces

| Surface | Code path | Typical host |
| ------- | --------- | ------------ |
| Web | `apps/web` | Vercel or compatible Next.js host |
| Admin | `apps/admin` | Vercel (often separate project) |
| Mobile | `apps/mobile` | Expo / EAS binaries and OTA |
| Backend | `packages/backend` | Convex cloud |

## Recommended deploy order

1. **Convex** — schema and functions first so clients never call missing APIs.
2. **Web and admin** — after backend is healthy; align `NEXT_PUBLIC_CONVEX_URL` with the deployment.
3. **Mobile** — after web is live; align `EXPO_PUBLIC_WEB_APP_URL` with the **same** web origin users use for OAuth completion.

## Environment alignment checklist

- Web `NEXT_PUBLIC_APP_URL` matches production domain and OAuth redirect URIs.
- All apps use the same Convex URL for that environment.
- Clerk JWT issuer and webhook secret match the Clerk instance in use.
- Sentry DSNs exist for each shipped surface you monitor.

## CI gates

- **`backend-validation`** (`.github/workflows/backend-validation.yml`) — branch protection check, env validation, lint, typecheck, tests, and conditional app builds.
- **`Validate Prod Env`** (`.github/workflows/validate-prod-env.yml`) — standalone validator for secrets on pushes to `main` and pull requests.

Reusable “call this workflow from deploy” snippets should point at the **actual** files above. There is no `pre-deploy-validate.yml` in this repository; either invoke `node scripts/validate-prod-env.mjs` in your deploy pipeline or reuse the same job pattern as `backend-validation`.

## Operations scripts

Documented in the runbook and root `package.json`:

- Sensitive data keyring rotation and migration (`ops:rotate-sensitive-data-keyring`, `ops:run-sensitive-data-migration`).
- Integration token hardening (`ops:run-integration-token-hardening`).

## Next steps

Read **[DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md)** for pre-release commands, smoke tests, rollback guidance, and admin bootstrap.
