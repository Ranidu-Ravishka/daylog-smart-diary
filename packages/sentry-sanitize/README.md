# `@repo/sentry-sanitize`

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers working on observability  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Shared **Sentry payload sanitization**: redacts sensitive keys, truncates large strings/arrays/objects before error reports leave web, admin, mobile, or Convex wrappers.

Entry point: `src/index.ts` (depth limits, key patterns for tokens/journal-like fields, safe header allowlist).

## Scripts

```bash
pnpm --filter @repo/sentry-sanitize lint
pnpm --filter @repo/sentry-sanitize check-types
```
