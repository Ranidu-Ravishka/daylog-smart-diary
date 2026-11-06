# DayLog Privacy and Security Report

## Result

**Status: DEVELOPMENT READY ONLY; NOT READY FOR PRIVATE BETA OR PRODUCTION.** This was a source/configuration review plus local tests and a read-only dependency audit. No penetration testing, remote requests, production access, or real diary-data handling was performed.

## Findings and priorities

### Critical: dependency audit reports route/authentication-relevant advisories

`pnpm audit --prod` exited non-zero and reported **210 advisories: 10 critical, 118 high, 68 moderate, and 14 low** across production dependencies. The committed lockfile resolves:

- `next@16.0.3`; audit results include critical Next.js advisories affecting this version, including React Flight/RCE and image-optimization/server-function issues. The audit listed patched versions at or above `16.0.10` for one advisory and `16.4.1` for others.
- `@clerk/nextjs@6.37.3` and `@clerk/shared@3.39.0` / `3.44.0`; the audit reports the critical Clerk middleware route-protection-bypass advisory, with patched ranges at `@clerk/nextjs >=6.39.2` and `@clerk/shared >=3.47.4`.
- Other critical findings include transitive `shell-quote`, `node-tar`, and Sentry/Next.js advisories; high/moderate findings include additional Next.js, `minimatch`, `undici`, and other transitive packages.

These are package-audit findings, not proof that every advisory is reachable in the deployed architecture. The Clerk middleware finding is especially material because the web relies on Clerk middleware for route protection. **Treat dependency remediation and a clean re-audit as a release blocker.** No dependency changes were made, as the permitted modification scope is documentation only.

### High: deployment security configuration is unverified

- No application-level security-header policy was found in [`next.config.js`](./apps/web/next.config.js) or [`proxy.ts`](./apps/web/proxy.ts). Actual Vercel/edge headers are unknown.
- No staging or production hosting metadata was available to confirm TLS, security headers, domain restrictions, deployment environment separation, or CORS behavior at the edge.
- The custom observability ingest path has origin allowlisting and CORS response logic in [`observabilityIngestionSecurity.ts`](./packages/backend/convex/observabilityIngestionSecurity.ts). This does not establish the hosting platform's CORS policy for the product.

**Header recommendation:** first inventory actual Clerk, Convex, Sentry, image, and application origins; deploy a CSP in `Report-Only` mode; review reports and browser behavior; then enforce a narrowly scoped policy. Do not copy a restrictive CSP without testing Clerk scripts/frames, Convex connections, image hosts, and any Sentry tunnel. Also configure and verify HSTS (after HTTPS/domain readiness), `X-Content-Type-Options: nosniff`, an appropriate `Referrer-Policy`, and a least-privilege `Permissions-Policy`. Verify headers on the deployed response, not only in source.

### Medium: diary-data lifecycle and operational metadata need explicit disclosure

- Summary generation sends diary memories, day ratings/manual notes/people tags, and selected integration context to OpenAI from the Convex backend. Inputs are bounded in code; no OpenAI request or provider privacy/retention setting was verified.
- New summary-quality records persist input byte counts and quality measurements, not the raw model input or generated story. Optional legacy raw-content fields and a redaction/retention path exist; confirm legacy records are actually purged and that configured retention matches the privacy notice.
- Account-deletion jobs are separate from the cascade-deleted user data and can remain for operational retention. The default retention in code is 180 days; the runbook specifies 120 days for staging and 365 days for production. A job retains identifiers/status/progress and may retain `lastError` on failure. Confirm this retention is necessary, privacy-disclosed, and scrubbed appropriately.
- Deletion failure handling records the exception message as `lastError`; the account-status query is user-scoped, but error text should remain sanitized and should not reveal infrastructure details.
- Individual memory deletion catches storage-blob deletion errors and continues deleting the media metadata and memory. If the blob deletion actually failed, the media could be orphaned in storage without a retryable metadata reference. The account-wide cascade has a separate staged cleanup path; neither behavior was tested against remote storage.

## Controls observed

- Backend functions derive identity from Convex auth and use ownership/admin checks; key source is [`authz.ts`](./packages/backend/convex/authz.ts). Existing tests cover missing identity, identity mismatch, and admin boundaries.
- Clerk webhook signatures are verified by Svix. The webhook path returns failure on downstream errors rather than treating failed sync as success.
- OAuth state is random, compared against a short-lived HttpOnly/SameSite=Lax cookie, and web callbacks verify the initiating Clerk user. Production cookies are marked Secure. Provider tokens are stored by opaque reference and encrypted; [`SECURITY.md`](./SECURITY.md) documents KMS-backed envelope encryption as the production preference.
- Sensitive diary/day/summary/integration fields use an encrypted-data path. Actual deployed encryption key configuration and key-management permissions were not verified.
- The AI summary quota is five generations per user/day by default; model input and memory/integration input sizes are bounded. See [`runtimeConfig.ts`](./packages/backend/convex/runtimeConfig.ts) and [`summaryGeneration.ts`](./packages/backend/convex/summaryGeneration.ts).

## Not verified

Live authentication/authorization, cross-account isolation, deployed headers/CORS, OAuth token confidentiality in a real deployment, secret rotation, Sentry redaction behavior, provider/API egress, dependency exploitability, and remote backup/log retention were not tested. No dependency vulnerability fix or security-header configuration was applied.

## Required before private beta

1. Upgrade affected Next.js, Clerk, and other production dependencies; rerun the production audit and regression tests.
2. Verify Clerk/Convex authorization and cross-user isolation using two disposable staging accounts.
3. Verify deployed headers and CSP in report-only mode before enforcement.
4. Confirm KMS/encryption, retention, Sentry scrubbing, OpenAI data handling, and deletion-job retention in staging.
