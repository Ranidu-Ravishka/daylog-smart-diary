# DayLog Engineering Workflow (Current State + Delivery Plan)

Project: DayLog – Smart Diary  
Module: PUSL3190 Computing Project

This workflow is based on the **actual repository implementation** in:

- `apps/web` (user web app)
- `apps/mobile` (Expo app)
- `apps/admin` (admin console)
- `packages/backend/convex` (shared backend)

---

## 1) Project Overview

DayLog is a monorepo journaling platform with:

- **Core diary loop implemented**: memory CRUD, day rating, day notes/tags, AI summary generation.
- **Cross-client architecture**: web + mobile clients on a shared Convex backend.
- **Admin operations**: CRUD and metrics across core domain tables.
- **Security baseline**: Clerk auth, ownership checks, env validation, webhook signature verification.

Current status: **strong MVP with incomplete integration + notification flows**.

---

## 2) Architecture Summary

### Frontend

- `apps/web`: Next.js user dashboard (`/dashboard`) with memory CRUD, rating, summary generation, settings, export, account.
- `apps/mobile`: Expo app with tabs (home, add-memory, memory detail, insights, profile, quick setup).
- `apps/admin`: Next.js admin panel with paginated list views and CRUD for users/memories/days/summaries/integrations/preferences/audit logs.

### Backend

- `packages/backend/convex/schema.ts`: data model for users, preferences, memories, memory media, days, summaries, integrations, integration secrets, sync runs, content, audit logs, quotas.
- Domain handlers:
  - `users.ts`, `userPreferences.ts`, `memories.ts`, `days.ts`, `summaries.ts`
  - `summaryGeneration.ts` (OpenAI action)
  - `integrations.ts` (provider sync + secret refs)
  - `admin.ts` (admin CRUD + metrics)
- HTTP endpoint: `http.ts` → `/clerk/webhook`.

### Auth & Authorization

- Clerk for all clients.
- Convex auth provider configured in `auth.config.ts`.
- Shared guards in `authz.ts`: `requireUser`, `requireAdmin`, `requireOwnership`.

### AI Flow

- Trigger: `summaryGeneration.generateSummaryForDay`.
- Input: memories + day metadata + integrationDailyData.
- Model: `gpt-4o` with JSON schema response.
- Output persisted via `summaries.upsertSummary`.
- Quota: `DAILY_SUMMARY_GENERATION_LIMIT = 5` in `summaries.ts`.

### Integrations

- Providers supported in backend: `google_calendar`, `google_fit`, `spotify`, `apple_health`.
- Tokens stored in `integrationSecrets` with opaque `tokref_*` references.
- Sync runs tracked in `integrationSyncRuns`.
- Normalized daily data in `integrationDailyData`.

---

## 3) Development Setup

### Prerequisites

- Node `>=18`
- pnpm `10.x`
- Convex project
- Clerk project
- OpenAI API key

### First-Time Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
cp packages/backend/.env.example packages/backend/.env.local
```

### Start Development

Terminal 1:

```bash
pnpm --filter @repo/backend dev
```

Terminal 2:

```bash
pnpm dev
```

Or per app:

```bash
pnpm dev:web
pnpm dev:admin
pnpm dev:mobile
```

---

## 4) Environment & Configuration Guidance

### Required Runtime Variables

- Web/Admin:
  - `NEXT_PUBLIC_CONVEX_URL`
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
- Mobile:
  - `EXPO_PUBLIC_CONVEX_URL`
  - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Convex Dashboard:
  - `CLERK_JWT_ISSUER_DOMAIN`
  - `CLERK_WEBHOOK_SECRET`
  - `OPENAI_API_KEY`
  - `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (optional)

### Rules

- Never commit real secrets.
- Keep `.env.example` placeholders only.
- Use platform secret stores for deployed environments.
- Backend/admin startup validation must remain strict (fail fast).

---

## 5) Coding Workflow

1. Create a branch from `main`.
2. Implement one feature/fix per branch.
3. Validate with targeted checks.
4. Run full pre-PR checks.
5. Open PR with scope, risk, and test evidence.
6. Merge only after required CI passes.

### Local Validation (minimum)

```bash
pnpm lint
pnpm typecheck
pnpm --filter @repo/backend test:run
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
pnpm build:web
pnpm build:admin
```

---

## 6) Branch Naming Convention

Current history contains mixed patterns (`feature/*`, `features/*`, `task/*`, `chore/*`, `feat/*`).  
Use one standard moving forward:

- `feat/<scope>-<short-description>`
- `fix/<scope>-<short-description>`
- `chore/<scope>-<short-description>`
- `docs/<scope>-<short-description>`

Examples:

- `feat/mobile-reminder-push-scheduler`
- `fix/web-settings-preference-sync`
- `chore/admin-env-validation-refactor`

---

## 7) Commit Message Convention

Use Conventional Commits:

- `feat: add integration connect flow skeleton`
- `fix: guard memory queries behind convex auth`
- `chore: remove unused web public assets`
- `docs: update workflow and delivery scope`

Commit guidance:

- Keep commits small and coherent.
- Include migration notes in commit body if schema changes.
- Avoid “misc updates” messages.

---

## 8) Feature Development Process

For each feature:

1. Define user-visible behavior + acceptance criteria.
2. Identify backend contract first (Convex query/mutation/action).
3. Implement UI state + loading/error states.
4. Add/extend tests where test infrastructure exists.
5. Validate authz + ownership boundaries.
6. Document env/config implications.

Delivery priority rule: **MVP reliability before breadth**.

---

## 9) Testing Checklist

### Backend (required)

- [ ] `pnpm --filter @repo/backend test:run` passes.
- [ ] New backend logic has behavior/unit tests when feasible.
- [ ] Validation errors return clear messages.
- [ ] Unauthorized/forbidden paths are covered.

### Web/Admin/Mobile

- [ ] Lint + type checks pass.
- [ ] Build succeeds for changed app(s).
- [ ] Manual smoke test for changed flows completed.
- [ ] Empty/loading/error states verified.

### Critical Manual Smoke Paths

- [ ] Sign in and user sync works in web/admin/mobile.
- [ ] Memory create/edit/delete with media works.
- [ ] Day rating persists.
- [ ] Summary generation works and saves output.
- [ ] Admin guard blocks non-admin users.

---

## 10) Code Review Checklist

- [ ] Scope is focused and branch name is correct.
- [ ] No secrets in code/docs/config.
- [ ] Authz checks exist for any data mutation.
- [ ] No duplicated business logic introduced.
- [ ] Errors are surfaced to user (not only `console.error`).
- [ ] Loading and failure states exist for async UI operations.
- [ ] Docs updated for behavior/env/workflow changes.

---

## 11) Deployment & Build Notes

CI source of truth: `.github/workflows/feature.yml`.

Required checks:

- `Feature Branch CI / ci-checks`
- `Feature Branch CI / Backend Tests`
- `Feature Branch CI / Mobile Validation`

Post-deploy checks:

- Sign-in flow on web/admin/mobile.
- Clerk webhook event delivery.
- Summary generation action health.
- Integration sync (if enabled in release).

---

## 12) Security Rules

- All user-scoped backend operations must use `requireUser` + ownership checks.
- All admin operations must use `requireAdmin`.
- Keep webhook signature verification enabled.
- Use dedicated secret for admin middleware cache signing (do not reuse Clerk secret).
- Never expose integration access tokens to clients.
- Rotate leaked credentials immediately and document the rotation.

---

## 13) Cleanup & Maintenance Rules

Before each milestone/demo:

- Remove or archive unused template assets and dead routes.
- Remove stale docs referencing non-existent files/functions.
- Standardize branch/commit naming.
- Ensure version labels shown in UI match actual release version.
- Keep workflow docs aligned with real implementation status.

Do not delete files blindly; list candidates in PR description first.

---

## 14) Definition of Done (DoD)

A task is done only when:

- Functional behavior works end-to-end.
- Authz/security checks are correct.
- Lint/type/tests/build checks pass.
- Manual smoke test for affected flow is completed.
- Documentation is updated.
- Known limitations are explicitly stated if not resolved.

---

## 15) Immediate Next Priorities (for final-year delivery)

### P0 (must finish)

1. **Integration connect/sync UX**
   - Add real connect/disconnect/sync controls in web or mobile using existing backend APIs.
2. **Reminder execution path**
   - Implement actual scheduling/notification delivery (current state stores preference only).
3. **Web settings parity**
   - Expose existing backend preference fields in web settings UI.
4. **Fix broken/incorrect UX promises**
   - Add `privacy`/`terms` pages or remove dead links.

### P1 (high value)

1. **Config-driven summary quota**
   - Move hardcoded quota from code to config/admin-manageable source.
2. **Frontend reliability tests**
   - Add minimal smoke-level tests for key web/mobile flows.
3. **Admin security hardening**
   - Use dedicated cache-signing secret in admin middleware.

### P2 (nice to have after MVP stability)

1. Location tagging (privacy-aware opt-in).
2. Richer export formats (CSV/PDF).
3. Dashboard/insight polish and advanced analytics.

---

## 16) Current Known Gaps (explicit)

- Integration backend exists but end-user connect/sync UI is mostly absent.
- Reminder preferences are saved but no notification scheduler exists.
- Mobile theme toggles are largely preference-level; many screens remain fixed `Colors.light`.
- Frontend automated tests are missing.
- Some docs are stale (e.g., `preferences.ts` reference in backend README while file is `userPreferences.ts`).

This document should be updated whenever these gaps are addressed.
