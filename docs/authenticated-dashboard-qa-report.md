# DayLog Authenticated Dashboard QA & Functional Testing Report

**Run date:** 2026-11-04  
**Scope:** Authenticated web dashboard, functional flows, and responsive browser QA.

## 1. Browser-testing setup

- **Automation:** Existing Playwright setup with Chromium; no dependencies were added.
- **App:** Local production build, served at `http://localhost:3010`. The `localhost` host is required for the local Clerk development-browser handshake; no auth middleware or security behavior was changed.
- **Authentication:** Local Clerk key was verified as a development/test key. The web Convex URL matched the configured backend development deployment. The user signed into the normal DayLog sign-in form in the browser; credentials were neither requested in chat nor printed or persisted by this task.
- **Physical-device testing:** Not performed. All viewport results below are Chromium emulation.
- **Privacy:** Only a synthetic entry was created. It was edited, verified, then deleted. Existing journal contents and account values were not read into the report or screenshots. Dashboard screenshots mask main-content text, images, charts, and the profile control.

## 2. Actual routes and route coverage

### Authenticated web routes

| Route | Result |
|---|---|
| `/dashboard` | Loaded; journal, date picker, memories, quick stats, data sources, and AI summary are integrated here |
| `/dashboard/settings` | Loaded; preferences and integrations settings |
| `/dashboard/account` | Loaded; account information, session, and danger-zone sections |
| `/dashboard/export` | Loaded; export and restore interface |

The source route tree contains no separate `/dashboard/calendar`, `/dashboard/ai-brain`, `/dashboard/ask-your-day`, or `/dashboard/analytics` page. Calendar/date selection and AI summary are parts of `/dashboard`; a standalone analytics/chat route was not found and is not claimed as tested.

### Public routes

The previously completed public-page browser pass covered `/`, `/sign-in`, `/sign-up`, `/faq`, and `/pricing`; its screenshot/report artifacts remain under `apps/web/qa/screenshots/`.

### Protected-route behavior

All four authenticated routes were also checked without a session and redirected to `/sign-in`. After the normal sign-out flow, `/dashboard` again redirected to sign-in.

The unauthenticated redirect probe is recorded in [auth-access-check.json](../apps/web/qa/screenshots/auth-access-check.json).

## 3. Responsive browser results

Each authenticated route was loaded and allowed to reach its settled state at every requested viewport: **36 route/viewport checks total**.

| Class | Viewports | Result |
|---|---|---|
| Desktop | 1440x900 | 4/4 routes loaded; no overflow |
| Tablet | 1024x768, 834x1194, 768x1024 | 12/12 route checks loaded; no overflow |
| Mobile | 430x932, 390x844, 375x812, 360x800, 320x700 | 20/20 route checks loaded; no non-scrollable overflow after the fix |

Across the stabilized matrix: **0 unexpected redirects, 0 stuck loading skeletons, 0 navigation-mode mismatches, 0 uncaught JavaScript exceptions, 0 console errors, 0 HTTP 5xx responses, and 0 critical request failures**. Aborted route-prefetch requests during navigation were treated as expected cancellations.

At 320px, the calendar grid is intentionally horizontally scrollable. The end of the grid was reached and the final day remained accessible; the page itself did not scroll horizontally.

### Screenshots

Masked authenticated dashboard screenshots were captured after data loading:

- [Desktop — 1440x900](../apps/web/qa/screenshots/auth-dashboard-1440x900.png)
- [Tablet — 768x1024](../apps/web/qa/screenshots/auth-dashboard-768x1024.png)
- [Mobile — 390x844](../apps/web/qa/screenshots/auth-dashboard-390x844.png)
- [Mobile — 375x812](../apps/web/qa/screenshots/auth-dashboard-375x812.png)

The images are browser-emulated and intentionally redact page text/media and the profile control to avoid exposing account or diary content.

## 4. Functional workflow results

### Authentication

- Normal Clerk sign-in succeeded in the development instance.
- Sign-out through the account page succeeded.
- The protected dashboard redirected to sign-in after sign-out.
- Sign-up creation, MFA, rate-limit behavior, and a real wrong-password response were not tested.

### Diary / memories

- Opened the create form on mobile.
- Submitted without a title and confirmed the required-title validation message.
- Created one synthetic entry, verified it appeared, and opened its actions menu.
- Edited then cancelled; the original synthetic entry remained unchanged.
- Edited and saved a new synthetic title/description.
- Navigated to Settings and back; the edited entry persisted.
- Deleted only the synthetic entry through the confirmation dialog and verified it disappeared.

### Calendar and navigation

- Used the dashboard date picker to move to the previous day and return to Today.
- At 320px, verified the calendar’s horizontal scroller reaches its final day.
- Used mobile bottom navigation to reach Settings.
- Checked desktop/mobile navigation mode across the viewport matrix.

### AI

- The dashboard AI summary section loaded.
- No summary-generation or external AI request was triggered: the account may contain existing content and an AI call could process it or incur cost.
- AI success, service-error, rate-limit, and separate conversational “AI Brain/Ask Your Day” workflows remain unverified; no such standalone route exists in the web route tree.

### Settings, account, integrations, and export

- Changed the theme preference in the UI and restored its original value without saving an unrelated preference.
- Account and session sections loaded; personal name/email values were not inspected or reported.
- Sign-out was verified. The account deletion action was not submitted.
- Export format toggling (JSON/Text) worked and the location-signals default was off.
- No export download, restore, OAuth connection, provider sync, or other external action was triggered.

## 5. Confirmed defect and fix

| Severity | Route / viewport | Reproduction | Expected | Actual | Fix |
|---|---|---|---|---|---|
| Medium | `/dashboard/export`, 390x844, 375x812, 360x800, 320x700 | Open Export & Restore and inspect the restore action row | Restore actions remain within the card and are usable | “Restore selected datasets” extended past the card edge | [export/page.tsx](../apps/web/app/dashboard/export/page.tsx) now stacks restore actions on narrow screens and uses full-width buttons below `sm`; they return to a row at `sm` and above |

The post-fix 36-check matrix showed no non-scrollable control/page overflow. The dashboard’s date-grid overflow at 320px is contained by its explicit horizontal scroller and was verified accessible, so it was not treated as a defect.

## 6. Browser errors and limitations

- No application JavaScript exceptions, console errors, HTTP 5xx responses, or critical failed requests were observed in the stabilized authenticated run.
- Non-blocking warnings observed: Clerk’s expected development-instance warning and local font preload timing warnings.
- Integration and export service failure states were not forced; no external connections or user-data exports were made.
- Empty-data, AI failure/rate-limit, and authentication-provider MFA/lockout states remain unverified.
- This was Playwright/Chromium viewport emulation, not manual physical-device testing.

## 7. Regression checks

- `pnpm --filter web lint` — passed.
- `pnpm --filter web check-types` — passed.
- `pnpm --filter web test` — passed, 15/15 tests.
- `pnpm --filter web build` — passed.
- `pnpm --filter web test:e2e` — passed, 3/3 tests.
- Backend tests were not run because the only code fix is a web layout/class change and does not touch backend behavior.

The production build emitted existing non-blocking dependency/version and baseline-browser-mapping warnings; compilation, type checking, and build completion succeeded.

## 8. Readiness assessment and next steps

The authenticated core diary workflow, route access, navigation, responsive layout, account sign-out, and protected-route behavior passed against a development Clerk/Convex setup. The mobile export restore overflow found during QA was fixed and rechecked.

**Controlled beta:** Suitable for a controlled web beta, provided beta users use the verified development/staging configuration and known limitations are accepted.

**Before public release:** Validate the AI generation/error/rate-limit paths with approved synthetic fixtures, exercise export/restore and integrations in a dedicated staging account, test sign-up/MFA/lockout behavior, and perform physical-device checks on iOS and Android. Do not treat this browser-emulation run as a production sign-off.
