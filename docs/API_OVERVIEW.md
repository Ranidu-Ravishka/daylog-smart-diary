# DayLog API overview (Convex)

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

DayLog’s **authoritative API** is the Convex deployment in `@repo/backend`. There is no separate REST product API: web, admin, and mobile call **Convex queries, mutations, and actions** generated into `packages/backend/convex/_generated/`.

## Client usage

TypeScript apps import the generated namespace:

```typescript
import { api } from "@repo/backend/convex";
```

They pass `api.<module>.<function>` to `useQuery`, `useMutation`, `useAction`, or `fetchMutation` / Convex HTTP clients as appropriate.

**Document types** (for example `Id<"memories">`) come from:

```typescript
import type { Id } from "@repo/backend";
```

## HTTP endpoints (Convex site)

Defined in `packages/backend/convex/http.ts` (exact paths are relative to your Convex HTTP site base URL):

- **`POST /clerk/webhook`** — Clerk user sync (`webhooks.ts`).
- **Observability ingest** — routes under `/observability/...` (see `observabilityIngestion.ts` for methods and security).
- **`POST /integrations/oauth/connect`** — OAuth connect helper (`oauthConnect.ts`).

**Web OAuth callbacks** for Google Calendar, Google Fit, and Spotify are implemented as **Next.js route handlers** under `apps/web` (`/api/integrations/oauth/...`), not in `http.ts`.

## Functional areas (by module name)

Use `packages/backend/convex/` filenames as the index. Major areas include:

| Area | Typical modules |
| ---- | ----------------- |
| Users and auth | `users.ts`, `authz.ts`, `webhooks.ts` |
| Days and memories | `days.ts`, `memories.ts`, `content.ts` |
| Summaries | `summaryGeneration.ts`, `summaries.ts`, `summaryQuality.ts`, `summaryCircuitBreaker.ts` |
| Integrations | `integrations.ts`, `integrations.*.ts`, `oauthConnect.ts`, `integrationProviders.ts`, `integrationHealth.ts` |
| Admin | `admin.ts`, `admin/services/*`, `admin/controllers/*` |
| Retention and cleanup | `retention.ts`, `cascadeCleanup.ts`, `crons.ts` |
| Security and encryption | `sensitiveDataCrypto.ts`, `sensitiveDataMigration.ts`, `integrationSecretsCrypto.ts`, `integrationSecrets.admin.ts` |
| Config and limits | `runtimeConfig.ts`, `featureFlags.ts`, `planLimits.ts` |
| Observability | `observability.ts`, `observabilityIngestion.ts`, `observabilityIngestRateLimiter.ts` |

The generated `api` object mirrors **exported** Convex functions. If a symbol is not exported from a module, it is not part of the public client surface.

## Actions and internal functions

Some workflows use **actions** or **`internal`*** functions** for privileged work (OpenAI calls, cross-service IO). Prefer reading `packages/backend/convex/_generated/api.d.ts` after `npx convex dev` when you need an exact list.

## Related documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System context.
- [../CONVEX_SETUP.md](../CONVEX_SETUP.md) — Env and Clerk webhook setup.
- `packages/backend/convex/_generated/ai/guidelines.md` — Convex patterns for this repo (for agents and humans).
