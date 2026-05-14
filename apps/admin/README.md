# DayLog Admin (`apps/admin`)

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Admin and platform engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Internal **Next.js 16** application for operational and governance workflows (supporting tables, audits, and Convex-backed admin APIs).

**Monorepo onboarding:** [../../README.md](../../README.md)  
**Architecture:** [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)

## Routing

- **App Router** — `app/` directory with route groups and layouts for admin pages.

## Environment

```bash
cp apps/admin/.env.example apps/admin/.env.local
```

Required:

- `NEXT_PUBLIC_CONVEX_URL` — must be a valid `https` URL in production-style validation.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY` — must start with `sk_test_` or `sk_live_`.
- `ADMIN_CACHE_SECRET` — minimum 32 characters (startup validates).

See [../../docs/ENVIRONMENT_SETUP.md](../../docs/ENVIRONMENT_SETUP.md).

## Local development

```bash
pnpm dev:admin
```

Dev server uses **port 3001** (`next dev --port 3001`).

## Commands

```bash
pnpm --filter admin dev
pnpm --filter admin lint
pnpm --filter admin check-types
pnpm --filter admin test
pnpm --filter admin build
pnpm --filter admin start
```

## Auth and admin access

- Sign-in uses **Clerk** like other surfaces.
- **Admin privileges** are enforced in Convex; bootstrap is documented below.

### First admin bootstrap

1. Set Convex env `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (comma-separated Clerk user IDs).
2. Sign in as one of those users.
3. Call Convex mutation `users:bootstrapMakeMeAdmin` (see backend / admin code for invocation path).

## Testing

```bash
pnpm --filter admin test
```

Vitest config: `apps/admin/vitest.config.ts`. More: [../../docs/TESTING.md](../../docs/TESTING.md).

## Deployment

Deploy like web (Next.js host). Use a **separate** production project from the public web app when possible. [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Troubleshooting

- **`Unauthorized`** — User may lack admin role in Convex; verify bootstrap and admin tables.
- **Env validation on startup** — Fix keys listed in the error banner; see [../../docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md).
