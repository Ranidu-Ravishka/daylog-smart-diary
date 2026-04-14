# DayLog Admin App (`apps/admin`)

> Status: Active
> Last Updated: 2026-04-14
> Audience: Admin and platform engineers
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Internal Next.js admin application for operational and governance workflows.

Canonical onboarding and monorepo setup:

- [../../README.md](../../README.md)

## Required Environment Variables

Create from example:

```bash
cp apps/admin/.env.example apps/admin/.env.local
```

Required:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `ADMIN_CACHE_SECRET` (minimum 32 characters)

Validation notes:

- Startup fails fast for missing/placeholder values.
- `CLERK_SECRET_KEY` must start with `sk_test_` or `sk_live_`.
- `NEXT_PUBLIC_CONVEX_URL` must be valid `https` URL.

## Local Development

From repository root:

```bash
pnpm dev:admin
```

## Commands

From repository root:

```bash
pnpm --filter admin dev
pnpm --filter admin lint
pnpm --filter admin test
pnpm --filter admin build
pnpm --filter admin start
```

## First Admin Bootstrap

1. Set Convex env variable `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (comma-separated Clerk user IDs).
2. Sign in with one of those user IDs.
3. Call mutation `users:bootstrapMakeMeAdmin`.

## Troubleshooting

- `Unauthorized` in admin pages:
  - Verify target user is admin in backend.
- Startup env validation failure:
  - Fix invalid env values and restart app.
- Data load failure:
  - Ensure `NEXT_PUBLIC_CONVEX_URL` matches current backend deployment URL.
