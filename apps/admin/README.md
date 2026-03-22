# DayLog Admin App (`apps/admin`)

Admin Next.js application for managing users, content, memories, days, summaries,
integrations, preferences, and audit logs.

## Required environment variables

Create `apps/admin/.env.local` from `apps/admin/.env.example`.

Required:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

## Local development

From repo root:

```bash
pnpm dev:admin
```

Admin runs on port `3001`.

## Commands

From repo root:

```bash
pnpm --filter admin dev
pnpm --filter admin lint
pnpm --filter admin build
pnpm --filter admin start
```

## Admin access bootstrap

For first-time admin access:

1. Set `ADMIN_BOOTSTRAP_CLERK_USER_IDS` in Convex environment variables.
2. Sign in with one of those Clerk user IDs.
3. Call mutation `users:bootstrapMakeMeAdmin`.

## Runtime notes

- Admin list pages use server-backed pagination endpoints.
- Integration status and audit log filters are server-side.
- Startup env validation fails fast for missing/invalid critical env vars.

## Troubleshooting

- `Unauthorized` errors: verify user is admin in backend `user` table.
- Startup env errors: verify required variables and value formats.
- Data load errors: verify shared `NEXT_PUBLIC_CONVEX_URL` matches backend deployment.
