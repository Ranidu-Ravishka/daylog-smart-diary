# DayLog testing

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

## Run everything (from repo root)

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Turborepo orchestrates per-package `lint`, `check-types`, and `test` tasks where defined.

## By area

### Backend (`@repo/backend`)

```bash
pnpm --filter @repo/backend test:run
pnpm test:coverage:backend
pnpm --filter @repo/backend lint
```

Vitest tests live alongside Convex modules as `*.behavior.test.ts`, `*.test.ts`, etc.

### Web (`web`)

```bash
pnpm --filter web test
pnpm --filter web test:e2e
```

- Default `pnpm --filter web test` runs OAuth abuse / integration callback tests (Vitest).
- `test:e2e` runs Playwright (`apps/web/playwright.config.ts`); install browsers once with `pnpm --filter web test:e2e:install` if needed.

### Admin (`admin`)

```bash
pnpm --filter admin test
pnpm --filter admin lint
```

### Mobile (`mobile`)

```bash
pnpm --filter mobile test
pnpm --filter mobile lint
pnpm --filter mobile check-types
pnpm --filter mobile build:ci
```

Mobile unit tests live under `apps/mobile/lib/*.test.ts` (see [../workflow.md](../workflow.md)).

## Root shortcuts

| Script | Effect |
| ------ | ------ |
| `pnpm test:web` | Web tests |
| `pnpm test:backend` | Backend Vitest |
| `pnpm test:admin` | Admin Vitest |
| `pnpm test:mobile` | Mobile Vitest |
| `pnpm test:e2e:web` | Web Playwright |

## Coverage

`pnpm test:coverage` / `pnpm test:coverage:backend` run backend coverage today. Other surfaces may add coverage tasks independently.

## CI

GitHub Actions runs the same classes of checks as local development for protected branches. See `.github/workflows/backend-validation.yml`.
