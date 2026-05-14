# DayLog contributing guide

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: All contributors  
> Standard: this document

Thank you for improving DayLog. This guide covers **how to contribute code and documentation**, where policies live, and how we keep docs accurate.

## Before you start

1. Read [README.md](README.md) for setup and commands.
2. Read [workflow.md](workflow.md) for risk levels (R0–R3), required checks, and privacy expectations.
3. For backend changes, follow [CONVEX_SETUP.md](CONVEX_SETUP.md) and Convex patterns in `packages/backend/convex/_generated/ai/guidelines.md`.

## Contribution flow

1. **Branch** — Use `feature/...`, `fix/...`, `hotfix/...`, or `chore/...` prefixes (see [workflow.md](workflow.md)).
2. **Implement** — Small, focused diffs; preserve shared contracts across web, admin, and mobile unless you ship a migration plan.
3. **Validate** — Run the commands in [workflow.md](workflow.md) for every surface you touch. At minimum for non-docs work: `pnpm lint`, `pnpm typecheck`, `pnpm test`.
4. **Document** — Update canonical docs when behavior, env vars, or CI changes (see “Documentation ownership” below).
5. **Pull request** — Describe problem, intent, risk level, validation evidence, and rollback notes for R2/R3.

Commit messages: **Conventional Commits** (`feat:`, `fix:`, `docs:`, etc.), imperative subject, optional scope (for example `feat(web): ...`).

## CI and production secrets checklist

When you change production configuration expectations:

1. Store secrets only in your host’s secret manager or GitHub **Actions secrets** — never in source.
2. Ensure strict validation can succeed on `main`: run `node scripts/validate-prod-env.mjs --mode=ci` with the same variable **names** your pipeline sets.
3. **Integration encryption** — Strict CI requires **either** KMS references (`INTEGRATION_SECRETS_KMS_KEY_ID`, `KMS_KEY_ID`, or `KEY_RING_URI` / related) **or** valid `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID`. See `scripts/validate-prod-env.mjs` and [SECURITY.md](SECURITY.md).
4. When adding new required env vars, update [README.md](README.md), [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md), and extend the validator script in the same change when appropriate.

## Documentation ownership

| Topic | Canonical location |
| ----- | ------------------ |
| Onboarding, scripts overview | [README.md](README.md) |
| Doc index and deep guides | [docs/README.md](docs/README.md) |
| Engineering policy | [workflow.md](workflow.md) |
| Releases and operations | [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md) |
| Secrets and encryption | [SECURITY.md](SECURITY.md) |
| Convex + Clerk setup | [CONVEX_SETUP.md](CONVEX_SETUP.md) |
| App-specific quirks | `apps/<name>/README.md` |
| Backend commands and Convex env | [packages/backend/README.md](packages/backend/README.md) |

Do **not** duplicate full onboarding in every app README — link to [README.md](README.md) instead.

## Documentation standards (required for `.md` changes)

1. **Truth** — Do not invent APIs, env vars, or features. Verify against code and scripts.
2. **Runnable steps** — Commands must match `package.json` / app scripts.
3. **One canonical topic** — Prefer linking to the table above instead of copying long env lists.
4. **Headers** — Single H1 per file; use consistent `##` / `###` hierarchy.
5. **Links** — Relative links only; update references when moving or deleting files.
6. **Metadata** — Keep Status / Last Updated / Audience at the top of maintained docs.
7. **Tone** — Professional, concise, minimal emoji.

### Env and command rules

- Document **exact** variable names from code (`.env.example`, `packages/backend/convex/env.ts`, etc.).
- If teams use aliases (for example `CONVEX_URL`), show the mapping to `NEXT_PUBLIC_CONVEX_URL` / `EXPO_PUBLIC_CONVEX_URL`.
- Prefer root `pnpm` scripts in onboarding examples; mention `pnpm --filter <pkg>` when scoped.

### Before merge (docs)

1. Commands still exist.
2. Env names match source.
3. Remove stale duplicates.
4. Update **Last Updated** metadata.

### Preferred change order (code + docs)

1. Code / config first.  
2. Canonical docs (README, runbook, security).  
3. Surface READMEs.  
4. Migration or troubleshooting notes when behavior changes.

## Questions

Open a discussion or issue with the surface (web / admin / mobile / backend), what you tried, and redacted env **keys** (never values).
