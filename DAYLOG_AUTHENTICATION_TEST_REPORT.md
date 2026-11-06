# DayLog Authentication Test Report

## Result

**Status: NOT VERIFIED IN AN AUTHENTICATED STAGING ENVIRONMENT.** Source review and local automated tests passed, but no user sign-up, sign-in, session, or protected-route flow was exercised against Clerk and a staging Convex deployment. No test accounts or diary data were created.

## Environment and safety

- The only deployment evidence available locally is a development selector (`CONVEX_DEPLOYMENT=dev`) and the local client URL `https://basic-crane-400.convex.cloud`. Web and backend local configuration point to that URL. This proves neither that the deployment is a safe staging environment nor where a historical upload was sent.
- No production URL, separate staging deployment, Clerk dashboard, test credentials, or deployment history was available.
- No remote services were called, and no deployment commands were run.

## Source review and test evidence

| Area | Finding |
|---|---|
| Clerk-to-Convex auth | The web uses `ConvexProviderWithClerk`; [`auth.config.ts`](./packages/backend/convex/auth.config.ts) requires an HTTPS `CLERK_JWT_ISSUER_DOMAIN` and configures the Convex JWT application ID. |
| User synchronization | Web auth synchronization and Clerk webhook code provision/update the Convex user record. [`webhooks.ts`](./packages/backend/convex/webhooks.ts) verifies Clerk webhook signatures with Svix before processing supported events. |
| Protected web routes | [`proxy.ts`](./apps/web/proxy.ts) uses Clerk middleware and redirects non-public requests without a Clerk user ID to `/sign-in`. This is source-level evidence only, not a browser test. |
| Backend authorization | [`authz.ts`](./packages/backend/convex/authz.ts) resolves the server-side identity to a DayLog user and contains authenticated-user, admin, and identity/ownership guards. It rejects users whose account is in deletion states. |
| Unauthenticated access | Existing unit tests exercise missing identity, unknown identity, non-admin, and identity mismatch cases. The `getMyAccountDeletionStatus` query requires an authenticated user; an unauthenticated invocation is expected to fail with `Unauthorized: not signed in`. |

The backend test suite completed **45 test files / 265 tests passed**. These are local automated tests; they do not prove Clerk session behavior against a live issuer or Convex deployment.

## Requested workflow results

| Test | Result |
|---|---|
| New user registration | Not run: no isolated Clerk staging account/configuration. |
| Existing user sign-in | Not run. |
| Sign-out | Not run. |
| Session persistence | Not run. |
| Session expiration/re-authentication | Not run. |
| Authentication loading state | Not run in a browser against staging. |
| Protected route access | Source guard reviewed; unauthenticated and authenticated browser behavior not run. |
| Unauthenticated Convex query | Unit-level auth guards reject missing identity. No remote query was made. |
| User identity synchronization | Source and webhook unit tests reviewed/passed; live webhook and JWT synchronization not tested. |
| Account data isolation | Authorization helpers and behavior tests exist; cross-account access was not tested against an isolated live deployment. |

## `getMyAccountDeletionStatus` error

`Unauthorized: not signed in` is the expected result when this user-scoped query is run without a Clerk JWT/Convex identity, including a direct dashboard invocation that has no authenticated user context. It is not evidence that the auth requirement should be relaxed. If the same error occurs in the signed-in application, investigate the Clerk JWT template/issuer, Convex auth configuration, and client token propagation in staging.

## Required before private beta

1. Establish a separate staging Convex deployment and Clerk instance/JWT issuer; verify the web and backend use the same staging URL.
2. Create disposable test accounts and verify the ten workflows above in browser/client and Convex contexts, including account A/B isolation.
3. Add authenticated end-to-end checks for session expiry, loading, user synchronization, and deletion-status polling.
4. Upgrade the vulnerable Clerk and Next.js dependencies reported in [`DAYLOG_PRIVACY_SECURITY_REPORT.md`](./DAYLOG_PRIVACY_SECURITY_REPORT.md) before exposing protected routes to beta users.

