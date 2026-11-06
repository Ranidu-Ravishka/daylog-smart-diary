# DayLog

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers and operators  
> Standard: [CONTRIBUTING.md](CONTRIBUTING.md)

**DayLog** is a cross-platform life journaling product: capture memories, connect integrations, and generate daily summaries—with a shared **Convex** backend and **Clerk** authentication across **web**, **admin**, and **mobile**.

---

## Product snapshot

| Capability | Description |
| ---------- | ----------- |
| **Memories** | Create, edit, list, and delete day-scoped memories; mood and day ratings. |
| **Summaries** | OpenAI-backed daily summaries from memories and integration context. |
| **Integrations** | OAuth providers wired in-repo: **Google Calendar**, **Google Fit**, **Spotify**, **Apple Health** uploads. |
| **Life context** | Optional, consent-gated contextual signals (location, fitness, calendar aggregates). See [LIFE_CONTEXT_TRACKING_BLUEPRINT.md](LIFE_CONTEXT_TRACKING_BLUEPRINT.md). |
| **Surfaces** | **Web** and **Admin** (Next.js 16), **Mobile** (Expo 54 / React Native). |

### Screenshots

Add product imagery under `docs/assets/` and link it here, for example:

```markdown
![DayLog dashboard](docs/assets/web-dashboard.png)
```

Until those files exist, this section is intentionally a placeholder so marketing and engineering can drop assets without reworking the README structure.

---

## Tech stack

| Layer | Choices |
| ----- | ------- |
| **Web / Admin** | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| **Mobile** | Expo 54, React Native 0.81, Expo Router |
| **Backend** | Convex (queries, mutations, actions, HTTP routes, crons) |
| **Auth** | Clerk (JWT to Convex + Svix-signed webhooks) |
| **AI** | OpenAI API (summary generation in Convex) |
| **Observability** | Sentry, structured JSON logs |
| **Monorepo** | pnpm workspaces, Turborepo, Vitest, ESLint, Prettier |

---

## Monorepo layout

```
apps/
  web/          # User-facing Next.js (default dev port 3000)
  admin/        # Internal Next.js (dev port 3001)
  mobile/       # Expo client
packages/
  backend/      # Convex schema + functions (@repo/backend)
  ui/           # Shared React primitives (@repo/ui)
  theme/        # Design tokens, motion, palette (@repo/theme)
  user-settings/# Shared settings contracts (@repo/user-settings)
  sentry-sanitize/ # Shared Sentry scrubbing (@repo/sentry-sanitize)
  eslint-config/
  typescript-config/
docs/           # Architecture, testing, design system, etc.
```

---

## Documentation index

| Doc | Use when |
| --- | -------- |
| [docs/README.md](docs/README.md) | Hub for all guides |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and package roles |
| [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md) | Env vars by surface |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy order and CI |
| [docs/TESTING.md](docs/TESTING.md) | Commands and coverage |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common failures |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Tokens, typography, motion |
| [docs/API_OVERVIEW.md](docs/API_OVERVIEW.md) | How clients use Convex |
| [docs/RELEASE_WORKFLOW.md](docs/RELEASE_WORKFLOW.md) | Short release checklist |
| [CONVEX_SETUP.md](CONVEX_SETUP.md) | Backend + Clerk checklist |
| [workflow.md](workflow.md) | Engineering policy (risk levels, reviews) |
| [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md) | Production operations |
| [SECURITY.md](SECURITY.md) | Secrets and encryption |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [LIFE_CONTEXT_TRACKING_BLUEPRINT.md](LIFE_CONTEXT_TRACKING_BLUEPRINT.md) | Context tracking architecture |

---

## Prerequisites

- **Node.js** ≥ 22.13 (`package.json` engines). **Node 22** matches GitHub Actions.
- **pnpm** 12.16.1 (`packageManager` field in `package.json`).

---

## Quick start

### 1. Install

```bash
git clone <your-repo-url>
cd <repository-directory>
pnpm install
```

### 2. Environment files

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

Fill values using [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md). At minimum, set the **same** Convex deployment URL as:

- `NEXT_PUBLIC_CONVEX_URL` (web + admin)
- `EXPO_PUBLIC_CONVEX_URL` (mobile)

### 3. Run Convex

```bash
pnpm dev:backend
```

### 4. Run clients (separate terminals)

```bash
pnpm dev:web      # http://localhost:3000
pnpm dev:admin    # http://localhost:3001
pnpm dev:mobile   # Expo dev server
```

---

## Environment highlights

**Web** (`apps/web/.env.local`): Convex URL, Clerk keys, `NEXT_PUBLIC_APP_URL`, Google and Spotify OAuth client IDs/secrets, optional Sentry.

**Admin** (`apps/admin/.env.local`): Convex URL, Clerk keys, `ADMIN_CACHE_SECRET`.

**Mobile** (`apps/mobile/.env.local`): Convex URL, Clerk publishable key, `EXPO_PUBLIC_WEB_APP_URL` (must match the web origin used for OAuth handoff).

**Convex dashboard**: Clerk JWT issuer + webhook secret, OpenAI key, export signing secret, retention `RETENTION_*` days, provider OAuth secrets, Sentry, integration encryption (**KMS preferred** or legacy keyring), sensitive-data keyring. Full lists: [CONVEX_SETUP.md](CONVEX_SETUP.md), [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md).

### Integration encryption (production)

Prefer **KMS** (`INTEGRATION_SECRETS_KMS_KEY_ID` / `KMS_KEY_ID` / `KEY_RING_URI`). The legacy pair `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID` remains supported for migration and development. CI strict mode requires **at least one** path (`scripts/validate-prod-env.mjs`).

Rotation helper (when moving to KMS):

```bash
node scripts/rotate-integration-kms.mjs --target <target> --new-key-id <KMS_KEY_ID> --admin-subject <admin-identity>
```

Use `--dry-run` first. Keep legacy keyring material readable until rotation is verified.

---

## OAuth redirect URIs (web)

Register these on each provider (local example uses port **3000**). The web app implements a single dynamic route: `/api/integrations/oauth/[provider]/callback` — use one of the `provider` values below.

| Provider | `provider` segment |
| -------- | ------------------ |
| Google Calendar | `google_calendar` |
| Google Fit | `google_fit` |
| Spotify | `spotify` |

Example local callback URL:

`http://localhost:3000/api/integrations/oauth/google_calendar/callback`

Production: `https://<your-domain>/api/integrations/oauth/<provider>/callback`.

---

## Repository scripts

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | All dev tasks (Turbo) |
| `pnpm dev:web` / `dev:admin` / `dev:mobile` / `dev:backend` | Single surface |
| `pnpm lint` | ESLint across workspace |
| `pnpm typecheck` | Typecheck all packages that define `check-types` |
| `pnpm test` | Tests via Turbo |
| `pnpm build` | Production builds |
| `pnpm build:web` / `pnpm build:admin` | Shorthand web/admin builds |

Mobile CI bundle: `pnpm --filter mobile build:ci`

---

## Testing and quality

See [docs/TESTING.md](docs/TESTING.md). Common entry points:

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:coverage:backend
pnpm --filter web test:e2e
```

---

## CI and secrets

- **`backend-validation`** (`.github/workflows/backend-validation.yml`) — branch protection verification, `validate-prod-env`, lint, typecheck, tests, conditional app builds.
- **`Validate Prod Env`** (`.github/workflows/validate-prod-env.yml`) — additional env validation on `main` and PRs.

GitHub Actions secrets should include at least: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `EXPORT_SIGNING_SECRET`, and **either** KMS-related secrets **or** `INTEGRATION_SECRETS_KEYRING_JSON` + `INTEGRATION_SECRETS_ACTIVE_KEY_ID`. Match the env block in `backend-validation.yml`.

Local validation:

```bash
node scripts/validate-prod-env.mjs --mode=local
node scripts/validate-prod-env.mjs --mode=ci
```

---

## Deployment

High level: **Convex → web/admin → mobile**. Details, retention matrix, smoke tests, and rollback: [DEPLOY_RUNBOOK.md](DEPLOY_RUNBOOK.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Observability

| Surface | DSN / notes |
| ------- | ----------- |
| Web | `NEXT_PUBLIC_SENTRY_DSN`, optional `SENTRY_DSN` for server |
| Mobile | `EXPO_PUBLIC_SENTRY_DSN` |
| Convex | `SENTRY_DSN` |

Structured logs for critical paths should include `event`, `userId`, `status`, and `errorMessage` (see [workflow.md](workflow.md)).

---

## Security

Never commit real secrets. Policy, rotation, and encryption controls: [SECURITY.md](SECURITY.md).

---

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [workflow.md](workflow.md) before opening a PR. Risk level (R0–R3), validation commands, and documentation updates are required for non-trivial changes.

---

## License

This repository does **not** include a root `LICENSE` file. Distribution and reuse terms are defined by the project owners. Add a `LICENSE` when publishing publicly.
