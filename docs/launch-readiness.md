# DayLog Web Launch-Readiness QA

**Run date:** 2026-11-05  
**Scope:** Local web-first baseline, public browser routes, backend/web automated checks, and source-level review. No deployment or production services were changed.

## A. Executive summary

The web app builds, its web/backend lint and type checks pass, and the available web and backend automated tests pass. Public pages rendered successfully across the complete requested viewport matrix, with no measured horizontal overflow or browser console/page errors. The mobile marketing menu and unauthenticated dashboard redirect were also exercised.

This is not a complete release audit. No authenticated test account or production-like staging configuration was available, so diary CRUD, AI requests, exports, account deletion, analytics, and real OAuth flows were not exercised in a signed-in session. Production environment validation fails because required deployment secrets are not configured in this local environment.

**Release recommendation: DEVELOPMENT READY.** Do not treat this result as private-beta or production approval.

## B. Architecture and route findings

- The repository is a pnpm/Turborepo monorepo. The user-facing web surface is Next.js 16/React 19; Convex is the backend, Clerk provides authentication, and shared UI/theme/settings packages are used by web, admin, and mobile.
- The web route tree has public pages at `/`, `/about`, `/contact`, `/developers`, `/faq`, `/pricing`, `/privacy`, `/terms`, `/sign-in`, and `/sign-up`.
- Authenticated web routes currently exposed are `/dashboard`, `/dashboard/account`, `/dashboard/export`, and `/dashboard/settings`. The dashboard includes date-scoped memories and summaries; there are no separate web page routes for calendar, AI Brain, analytics, or diary listing/editing in the discovered App Router tree.
- Admin and mobile remain separate surfaces. Neither was modified or independently browser-tested in this web-first pass.

## C. UI/UX improvements

No product UI code was changed because browser QA did not identify a confirmed defect requiring a safe code change. The existing public pages retained their minimal visual style and the reviewed layouts showed no clipping or overlap. I corrected the stale Node/pnpm prerequisites in the root and environment setup documentation and added this QA report and its evidence.

## D. Responsive QA

Chromium tested all 10 public routes at all 13 required viewport sizes: **130 route/viewport loads**. The sizes were 1920 × 1080, 1600 × 900, 1440 × 900, 1366 × 768, 1024 × 768, 834 × 1194, 768 × 1024, 430 × 932, 393 × 852, 390 × 844, 375 × 812, 360 × 800, and 320 × 700.

Every load returned HTTP 200; no horizontal overflow was measured. Full-page screenshots were captured after scrolling through the page so scroll-triggered content animations could settle, then visually inspected:

- [1440 × 900 desktop](screenshots/desktop-1440x900.png)
- [1024 × 768 tablet](screenshots/tablet-1024x768.png)
- [768 × 1024 tablet](screenshots/tablet-768x1024.png)
- [390 × 844 mobile](screenshots/mobile-390x844.png)
- [375 × 812 mobile](screenshots/mobile-375x812.png)
- [390 × 844 sign-in](screenshots/sign-in-mobile-390x844.png)
- [Complete route/viewport results](viewport-results.json)

The sign-in capture is a local Clerk development-mode screen; it does not demonstrate a production Clerk configuration. These are emulated browser sizes, not physical-device tests.

## E. Browser QA

The installed Playwright Chromium browser was used. All 10 public routes were checked at every responsive size. No navigation errors, uncaught page errors, or console errors were recorded. Page titles and primary headings were captured in the structured results.

The existing OAuth E2E suite passed **3/3 tests** against the freshly built app:

- unauthenticated OAuth start redirects toward sign-in;
- the mobile-handoff path is not redirected to sign-in;
- a callback without valid state is reachable and handled by the callback path.

These are route/security-boundary tests, not successful provider connections. No external OAuth account was connected.

## F. Functional testing

The mobile navigation was opened at 390 × 844, exposed 8 links, navigated to FAQ, and closed after selection. The protected dashboard returned a 307 redirect to `/sign-in` without a session.

No authenticated Clerk test user was available, so create/edit/delete memory, settings persistence, export/restore, analytics, and AI success/failure workflows remain unverified.

## G. Security findings

- Source review found shared backend guards that derive the caller from the authenticated identity and compare resource ownership. Backend behavior tests include identity, memory/media ownership, day ownership, summary ownership, and admin authorization cases.
- OAuth callback and mobile-handoff tests passed. No OAuth exchange or third-party account action was performed.
- The documented tracked-secret pattern scan matched only the synthetic CI Clerk test publishable key pattern; it did not identify a real secret. This is a narrow pattern scan, not proof that the repository contains no secrets.
- No application-level CSP or common response-security-header policy was found in the inspected web/admin source or configuration. A deployment host may supply these headers, but that was not verified. **Release action:** verify the actual staging response headers and decide the required CSP, HSTS, framing, MIME, and referrer policies before external testing. This is a configuration gap, not a demonstrated exploit.
- This was not a destructive penetration test or a complete independent security assessment. No confirmed exploitable vulnerability was established by the checks run here.

## H. Privacy and data lifecycle

- The published privacy page says relevant diary text and day-level context may be processed by OpenAI for requested summaries/insights and that generation inputs and outputs are recorded in the backend for quality evaluation. It also says retention depends on account configuration and OpenAI terms rather than promising a specific third-party retention period.
- The app exposes account and export routes; backend tests cover retention/deletion and export/restore ownership behavior. Those workflows were not exercised against an authenticated account here.
- Actual backup deletion behavior, production retention values, provider-side retention, and end-to-end account deletion were not independently verified. Privacy-policy accuracy and legal sufficiency still need product/legal review before beta.
- No end-to-end encryption or certification claim was verified. Do not make such claims based on this audit.

## I. Performance and accessibility

- All tested public pages rendered without observed client exceptions. The existing bundle-budget script passed at 5.14 MiB against its 6.5 MiB limit, but that check reports the mobile web entry and is not a web-app bundle measurement.
- No Lighthouse/Core Web Vitals run or physical-device test was performed.
- The mobile menu exposes an accessible name, `aria-expanded`, and `aria-controls`; its interaction worked in Chromium. This is a spot check, not a WCAG audit. Keyboard and screen-reader testing, contrast measurement, and formal touch-target review remain outstanding.

## J. Regression checks

| Check | Result |
|---|---|
| `pnpm --filter web lint` | Passed |
| `pnpm --filter web check-types` | Passed; Next emitted a Baseline data-age advisory |
| `pnpm --filter web test` | Passed: 3 files, 15 tests |
| `pnpm --filter web build` | Passed; see build warnings below |
| `pnpm --filter web test:e2e` | Passed: 3 tests |
| `pnpm --filter @repo/backend check-types` | Passed |
| `pnpm --filter @repo/backend lint` | Passed |
| `pnpm --filter @repo/backend test:run` | Passed: 45 files, 265 tests |
| `node scripts/validate-prod-env.mjs --mode=local` | Passed |
| `node scripts/validate-prod-env.mjs --mode=ci` | Blocked: deployment secrets/configuration are absent locally |
| `node scripts/check-baseline-browser-mapping-freshness.mjs` | Passed |

The web build emitted existing dependency-resolution warnings: nested OpenTelemetry instrumentation requests `import-in-the-middle` 2.0.6 while the project resolves 3.0.0. The build still completed, but the dependency mismatch should be reviewed. Node also emitted a `module.register()` deprecation warning. No dependency changes were made.

The system `pnpm` shim did not have the repository-pinned CLI available; checks were run using pnpm 12.16.1 through temporary `npm exec`, without changing project dependencies.

## K. Deployment readiness

Local environment validation passed. CI-mode validation did not: it reported missing `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `EXPORT_SIGNING_SECRET`, and an integration-secrets KMS/keyring configuration. No secret values were printed or supplied.

No staging deployment, domain/callback verification, production Clerk/Convex configuration, backup restore, monitoring delivery, or rollback test was performed. Do not deploy from this result.

## L. Remaining work, prioritized

1. **High:** provide a dedicated synthetic Clerk/Convex staging account and exercise signed-in memory CRUD, settings, export/restore, deletion, AI limits/failures, and authorization boundaries.
2. **High:** satisfy the CI-mode environment gate in a protected staging/production configuration; verify OAuth callback URLs and security headers from the deployed response.
3. **Medium:** review the privacy policy and marketing privacy statements against actual storage, AI-provider, retention, backup, and deletion behavior; obtain appropriate legal review.
4. **Medium:** investigate the `import-in-the-middle` version mismatch and evaluate the build warnings without upgrading dependencies blindly.
5. **Medium:** perform keyboard/screen-reader/contrast checks and physical-device verification; run web-specific performance and bundle analysis.
6. **Follow-up:** separately validate admin and mobile regressions before their respective releases.

## M. Final release recommendation

**DEVELOPMENT READY** — local web build, automated web/backend checks, and public responsive-route checks passed. The app is **not** shown to be internal-test, private-beta, or production ready because authenticated core workflows, production-like services, deployment headers, external integrations, and data lifecycle behavior have not been verified end to end.
