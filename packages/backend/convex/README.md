# DayLog Convex Functions (`packages/backend/convex`)

This folder contains DayLog backend domains and shared backend infrastructure.

## Key files

- `schema.ts` — data model (users, memories, days, summaries, integrations, admin/audit)
- `auth.config.ts` — Clerk JWT provider config for Convex auth
- `env.ts` — strict server env parsing/validation
- `http.ts` — HTTP endpoints (including Clerk webhook route)

Domain files:

- `users.ts`
- `preferences.ts`
- `memories.ts`
- `days.ts`
- `summaries.ts`
- `summaryGeneration.ts`
- `integrations.ts`
- `admin.ts`

## Common development commands

From repo root:

```bash
pnpm --filter @repo/backend dev
pnpm --filter @repo/backend logs
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
```

## Auth + ownership expectations

- Convex auth uses Clerk JWT issuer configuration.
- User-facing data mutations/queries enforce user ownership.
- Admin-only endpoints enforce admin role checks.

## Summary generation and integrations

- Summary generation action: `summaryGeneration:generateSummaryForDay`
- Provider sync logic and normalized daily integration data: `integrations.ts`
- Integration daily rows are used as additional context for summary generation.

## References

- [Convex docs](https://docs.convex.dev)
- Monorepo setup: [CONVEX_SETUP.md](../../../CONVEX_SETUP.md)
