# DayLog Staging Readiness Report

## Phase 2 final assessment

**Current status: DEVELOPMENT READY. NOT READY FOR PRIVATE BETA OR PRODUCTION.**

The codebase has meaningful local unit coverage and documented staging requirements, but there is no verified staging environment or authenticated end-to-end evidence. The production dependency audit also reports critical advisories, including a Clerk middleware route-protection bypass affecting the locked Clerk version. Do not expose a beta deployment until the dependency blocker is remediated and staging verification is complete.

## Deployment evidence and November 4, 2026 upload

- The local development selector is `CONVEX_DEPLOYMENT=dev`; the observed local client URL is `https://basic-crane-400.convex.cloud`.
- No separate staging or production Convex URL, Vercel deployment metadata, checked-in Convex deployment configuration, or local deployment-history record was available.
- The local selector and URL describe current local configuration only. They do **not** prove where an upload on November 4, 2026 was sent.
- Convex/Vercel dashboard history, audit logs, and upload records were unavailable. The destination of that historical upload therefore **cannot be confirmed**. Git commit dates or a present-day `dev` selector are not deployment evidence.
- No `convex dev`, `convex deploy`, Vercel deploy, remote mutation, or production database operation was run.

## Environment required for safe staging

### Convex

- Create/select a dedicated non-production deployment, with isolated database/storage and synthetic-only data.
- Configure `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`, `EXPORT_SIGNING_SECRET`, a separate `OPENAI_API_KEY`, explicit `SUMMARY_DAILY_GENERATION_LIMIT`, staging retention values, provider OAuth credentials, and Sentry if enabled.
- Configure production-style integration-token encryption using a staging KMS key/key reference; configure sensitive-data encryption keys separately from production.
- Point web, admin, and mobile clients at this same staging Convex URL.

### Clerk

- Use a separate Clerk development/staging instance and matching publishable/secret keys.
- Configure its JWT issuer/template for Convex (`applicationID: convex`), allowed origins/redirects, and a staging webhook at `https://<staging-convex-deployment>.convex.site/clerk/webhook`.
- Subscribe to the required `user.created`, `user.updated`, and `user.deleted` events and set the matching staging webhook signing secret in Convex.

### Vercel or equivalent hosting

- Create a separate staging project/environment (or tightly controlled preview environment), with `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and canonical `NEXT_PUBLIC_APP_URL` set to staging values.
- Add Google and Spotify staging OAuth client credentials; register each exact staging callback path. Keep provider credentials and Clerk secrets out of client-visible variables.
- Verify actual domains, HTTPS, Clerk allowed origins, callback URLs, response headers, preview access controls, and build-time/runtime environment separation.
- For mobile staging, set `EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_WEB_APP_URL` to staging endpoints.

### Test data/accounts

- Use disposable Clerk users and provider test accounts with synthetic diary entries only.
- Use at least two users to validate authorization and private-record isolation.
- Include synthetic media, AI summaries, integrations, and deletion-stage records for lifecycle testing. Do not import personal or production data.

## Diary workflow source and unit-test evidence

| Workflow | Source/test evidence | Staging result |
|---|---|---|
| Diary/memory create, read, update, delete | Authenticated `createMemory`, `getMemory`, day-list, update, and delete functions are in [`memories.ts`](./packages/backend/convex/memories.ts). `memories.behavior.test.ts` exercises CRUD, mood, media, and cross-user ownership rejection. | No live workflow run. |
| Mood, ratings, notes, people | Memory mood and day rating/manual notes/people tags are implemented in [`memories.ts`](./packages/backend/convex/memories.ts) and [`days.ts`](./packages/backend/convex/days.ts). Day behavior tests cover upsert, rating updates, note/people-tag append, and cross-user day access rejection. People are represented as tags/linked names; no separate people-account system was verified. | No live workflow run. |
| Media | Authenticated upload URL, media list/add/delete, and storage URL paths exist; memory behavior tests exercise these with a mocked storage layer. | No real storage upload or deletion. Individual memory deletion can continue after a storage-delete error; see the privacy report. |
| Daily summaries | Summary generation and user-scoped summary paths exist; local summary tests passed. | No live AI/provider call. |
| Search/filter | The mobile memory screen filters its resolved memories client-side by title/description and tag. It is not evidence of complete server-side/full-text search over all diary records. | No device/browser search test or large-account pagination test. |
| Export | `exportMyDiaryData` is user-scoped; export-job list/download functions check ownership. Local export tests reject another user's download request. | No export artifact was created or downloaded in staging. |

## Documentation/configuration gaps

- [`DEPLOY_RUNBOOK.md`](./DEPLOY_RUNBOOK.md) provides staging retention values, but those settings were not verified on any deployment.
- [`CONVEX_SETUP.md`](./CONVEX_SETUP.md) contains stale prerequisite guidance (Node 18 / pnpm 11) that conflicts with the current root/environment guidance (Node 22.13+ / pnpm 12.16.1). Reconcile before operators follow setup commands.
- Earlier strict local environment validation did not pass because required Clerk, webhook, OpenAI, export-signing, and integration/encryption configuration was missing. No credentials were printed or validated against a staging service.
- The previous report's required verification areas remain untested live: registration/sign-in/session lifecycle, isolation, diary CRUD/media/export, AI provider behavior, deletion end-to-end, OAuth, and hosting headers.

## Release blockers and next steps

1. **Critical:** upgrade vulnerable Next.js and Clerk dependencies and resolve the remaining production audit findings; rerun `pnpm audit --prod` and regression checks.
2. Establish and document an isolated staging Convex, Clerk, and Vercel environment with separate secrets and domains.
3. Verify the November 4, 2026 upload destination from Convex/Vercel dashboard history or audit logs; if unavailable, keep it recorded as unknown.
4. Run authenticated browser/backend tests with disposable accounts, including two-user isolation and all deletion stages.
5. Validate OAuth, OpenAI, provider revocation, security headers/CSP, retention, and privacy disclosure in staging.
6. Only reconsider **PRIVATE BETA READY** after the critical dependencies are patched and all release-blocking staging tests pass. Production requires separate production configuration review and operational evidence.
