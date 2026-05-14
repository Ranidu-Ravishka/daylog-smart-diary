# DayLog architecture

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

This document describes how DayLog is structured in this repository. It reflects the **current** layout of `apps/*`, `packages/*`, and the Convex backend.

## System context

DayLog is a **pnpm + Turborepo** monorepo. One **Convex** deployment backs three clients:

- **Web** (`apps/web`) — Next.js 16, user-facing journaling, integrations OAuth callbacks, summaries UI.
- **Admin** (`apps/admin`) — Next.js 16, internal operations and governance (Clerk-authenticated, admin-gated in Convex).
- **Mobile** (`apps/mobile`) — Expo 54 / React Native, shared Convex contracts; some flows hand off to the web app for OAuth.

**Authentication** is **Clerk** on clients; Convex validates JWTs and syncs users via **Svix-signed** Clerk webhooks.

**AI summaries** use the **OpenAI** API from Convex functions (see `packages/backend/convex/summaryGeneration.ts` and related modules).

## High-level diagram

```text
                    ┌─────────────┐
                    │   Clerk     │
                    └──────┬──────┘
           JWT + webhooks   │
                            ▼
┌──────────┐  ┌──────────┐  │  ┌──────────┐
│ Web      │  │ Admin    │  │  │ Mobile   │
│ Next.js  │  │ Next.js  │  │  │ Expo RN  │
└─────┬────┘  └────┬─────┘  │  └────┬─────┘
      │            │        │       │
      └────────────┴────────┴───────┘
                      │
                      ▼
            ┌─────────────────────┐
            │ Convex (backend)    │
            │ queries/mutations   │
            │ actions + HTTP      │
            └──────────┬──────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   OpenAI API    OAuth providers   Sentry / logs
```

## Repository layout

### Applications (`apps/`)

| Path | Role |
| ---- | ---- |
| `apps/web` | Public Next.js app; `/api/integrations/oauth/...` callback routes for Google Calendar, Google Fit, Spotify. |
| `apps/admin` | Internal Next.js app; port **3001** in dev (`package.json` script). |
| `apps/mobile` | Expo Router app; uses `EXPO_PUBLIC_*` env; native modules for health, location, etc. |

### Shared packages (`packages/`)

| Package | Role |
| ------- | ---- |
| `@repo/backend` | Convex schema, functions, HTTP router, crons, env validation. Consumed via `convex` client and generated API types. |
| `@repo/ui` | Shared React primitives (see package `exports` in `packages/ui/package.json`). |
| `@repo/theme` | Design tokens: CSS variables (`packages/theme/css/`), native colors (`packages/theme/src/native.ts`), motion (`packages/theme/src/motion.ts`). |
| `@repo/user-settings` | Shared Zod-backed settings contracts. |
| `@repo/sentry-sanitize` | Shared helpers for scrubbing Sentry payloads across surfaces. |
| `@repo/eslint-config` | Workspace ESLint presets. |
| `@repo/typescript-config` | Shared `tsconfig` bases. |

## Backend (Convex) structure

Entry points and cross-cutting concerns live under `packages/backend/convex/`:

- **`schema.ts`** — Table definitions and indexes.
- **`auth.config.ts` / `authz.ts`** — Clerk JWT integration and authorization helpers.
- **`http.ts`** — HTTP routes (for example Clerk webhook, observability ingest, OAuth connect). Paths are registered as documented in Convex (site URL + path).
- **`webhooks.ts`** — Clerk user sync webhook handler.
- **`crons.ts`** — Scheduled retention and maintenance jobs.
- **`retention.ts`** — Data lifecycle enforcement (env-driven `RETENTION_*` days).
- **`integrations*.ts`**, **`oauthConnect.ts`** — Provider sync, OAuth, daily integration data.
- **`summaryGeneration.ts`**, **`summaries.ts`** — Summary pipeline and export-related flows.
- **`sensitiveDataCrypto.ts`**, **`sensitiveDataMigration.ts`** — Field-level encryption and migrations.
- **`integrationSecretsCrypto.ts`** — OAuth token envelope encryption (KMS or legacy keyring).
- **`observability.ts`**, **`observabilityIngestion.ts`** — Structured logging and ingest endpoints.

For **module-level detail** when coding, use the source files above rather than duplicating API lists here. [API_OVERVIEW.md](./API_OVERVIEW.md) describes how clients invoke Convex.

## Auth flow (simplified)

1. User signs in with Clerk on web, admin, or mobile.
2. The Convex client sends requests with a Clerk-issued JWT Convex accepts per `auth.config.ts`.
3. Clerk webhook `POST /clerk/webhook` (Convex HTTP) creates or updates the user record in Convex.
4. **Admin** users are granted through Convex-controlled admin checks and optional bootstrap env `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (see [../apps/admin/README.md](../apps/admin/README.md)).

## Observability

- **Sentry** is wired for web, admin, mobile, and Convex (see each app’s env examples and `packages/backend/convex/observability.ts`).
- **Structured logs** follow the conventions in [../workflow.md](../workflow.md) (event, userId, status, errorMessage).

## Related reading

- [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) — Environment variables and validation.
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — UI tokens and shared design rules.
- [../LIFE_CONTEXT_TRACKING_BLUEPRINT.md](../LIFE_CONTEXT_TRACKING_BLUEPRINT.md) — Contextual signals and privacy boundaries.
