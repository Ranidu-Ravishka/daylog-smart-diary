# DayLog Deep Technical Review (Senior Engineering Pass)

Last updated: 2026-03-30

## Executive Summary (Leadership Readout)

DayLog has evolved from a multi-app bootstrap into a functionally complete cross-platform journaling system with shared backend contracts, production-grade auth integration, AI summary generation, and contextual integrations (calendar/fitness/music/location/health). The overall architecture direction is strong and scalable in shape, but there are targeted implementation risks that should be resolved before high-growth usage.

Current maturity snapshot:

1. **Core product loop is shipped** across web and mobile: memory capture, day metadata, and summary rendering.
2. **Admin control plane is broad** (CRUD, audit surfaces, role gates), but has a few query-performance/correctness concerns.
3. **Integration subsystem is thoughtfully designed** (provider allowlists, token refs, sync-run idempotency), but secret-at-rest hardening remains a priority.
4. **Operational posture is improving** (strict env validation + CI validation + secret scan), though docs and CI naming are slightly out of sync.
5. **Testing depth lags feature depth**, especially for highest-risk backend behavior.

Executive risk ranking (highest first):

1. Audit-log filtered pagination correctness risk.
2. Admin dashboard full-table scan scalability risk.
3. Plaintext integration token storage risk.
4. Backend behavior-test coverage risk.

Recommended near-term objective:

- Complete a 2-6 week hardening cycle focused on correctness, performance baselines, security uplift, and deterministic backend behavior tests, without broad product-surface expansion.

## 1) Purpose

This document captures a deep, evidence-backed technical review of DayLog from project bootstrap to the current state. It is intended to be the working source for:

- architecture understanding,
- implementation inventory,
- risk and technical-debt tracking,
- next-step execution planning.

The review covers web, mobile, admin, backend (Convex), auth, AI summary generation, integrations, CI/security posture, and observed scaling risks.

## 2) Scope and Review Method

Review method used:

1. Read root docs and runbooks.
2. Reconstruct timeline from git history (oldest to newest).
3. Map backend modules, schema, and handler boundaries.
4. Map web/admin/mobile implementation surfaces.
5. Trace cross-system data flow (auth, summaries, integrations, exports).
6. Identify concrete technical debt and delivery risk.

Evidence model:

- Findings are based on committed repository code and docs.
- No speculative architecture assumptions are presented as facts.

## Program Status Matrix (Current Snapshot)

| Area                            | Current State          | Implementation Depth | Confidence  | Primary Risk | Next Gate                                       |
| ------------------------------- | ---------------------- | -------------------- | ----------- | ------------ | ----------------------------------------------- |
| Monorepo foundation             | Stable                 | High                 | High        | Low          | Keep config drift low across packages           |
| Backend schema/domain model     | Stable                 | High                 | High        | Low          | Maintain schema/index discipline with growth    |
| Auth + authorization boundaries | Stable                 | High                 | High        | Medium       | Add more negative-path tests for authz          |
| Web dashboard core flow         | Shipped                | High                 | High        | Medium       | Continued UX and resilience polish              |
| Mobile core flow                | Shipped                | High                 | Medium-High | Medium       | Device-level regression matrix for services     |
| Admin CRUD surface              | Shipped                | High                 | Medium      | Medium       | Query performance and pagination correctness    |
| Audit log review flow           | Partially robust       | Medium               | Medium      | High         | Fix cursor/filter semantics                     |
| AI summary generation           | Shipped                | Medium-High          | Medium-High | Medium       | Add quality-eval + failure-path tests           |
| Integration sync architecture   | Strong direction       | High                 | Medium-High | Medium       | Harden token security + provider observability  |
| Data export/privacy controls    | Shipped                | Medium-High          | Medium-High | Low-Medium   | Clarify retention and location policy           |
| CI and release gates            | Good baseline          | Medium-High          | Medium-High | Low-Medium   | Align check naming + enforce policy consistency |
| Backend automated tests         | Underpowered for scope | Low-Medium           | Medium      | High         | Restore behavior tests for critical flows       |

Interpretation:

- Platform architecture is in a good state.
- Product surface is broad enough for user validation.
- Next maturity gains come mostly from hardening, not feature count.

## 3) Evolution Timeline (Beginning -> Current)

### Phase A: Monorepo and multi-app foundation

- Turborepo + pnpm workspace established.
- Apps split into `apps/web`, `apps/admin`, `apps/mobile`.
- Shared packages introduced (`packages/backend`, `packages/ui`, eslint/ts configs).

Primary result:

- Solid platform for shared backend contract and independent app delivery cadence.

### Phase B: Auth migration and hardening direction

- Admin app migrated from Auth0 to Clerk.
- Convex + Clerk alignment introduced progressively across clients.
- Auth fallback and runtime resilience added during migration window.

Primary result:

- Unified auth provider direction across ecosystem.

### Phase C: Backend domain assembly (Convex)

- Core schema introduced for users, preferences, memories, day records, summaries, integrations, and audit logs.
- Authz helpers (`requireUser`, `requireAdmin`, `requireOwnership`) centralized.
- Clerk webhook handling added for user lifecycle sync/deletion.

Primary result:

- Backend became the single source of truth for all clients.

### Phase D: Core product loop delivered

- Web dashboard flow delivered (memories, day context, summary area).
- Mobile core tabs and core loop shipped.
- Admin CRUD and governance surfaces added.

Primary result:

- End-to-end usable product with web/mobile/admin parity around shared domain.

### Phase E: AI summaries and context enrichment

- OpenAI-backed day summary generation implemented.
- Daily generation quota model added.
- Retry/backoff and structured output handling improved.

Primary result:

- AI feature moved from prototype capability to governed production behavior.

### Phase F: Integrations and operational hardening

- OAuth provider flows (Google Calendar/Fit, Spotify) added.
- Integration secret storage + token refresh lifecycle + sync-run idempotency added.
- Mobile contextual ingestion expanded (foreground location, health, screen-time adapters).
- CI/security improvements shipped (secret scan, stricter validation, validation gates).

Primary result:

- Multi-source context pipeline is functionally complete for next-stage refinement.

## 4) Current Architecture (System Map)

### 4.1 Monorepo and Toolchain

- Workspace orchestration: Turborepo + pnpm.
- Language: TypeScript across apps and packages.
- CI orchestration: GitHub Actions workflow at `.github/workflows/feature.yml`.
- Shared UI primitives and constants in `packages/ui`.

### 4.2 Backend Architecture (Convex)

#### 4.2.1 Domain tables and model shape

Core tables include:

- `user`
- `userPreferences`
- `memories`
- `memoryMedia`
- `days`
- `daySummaries`
- `summaryGenerationQuotas`
- `integrations`
- `integrationSecrets`
- `integrationSyncRuns`
- `integrationDailyData`
- `auditLogs`

Important modeling choice:

- `dayKey`-centric time model (`YYYY-MM-DD`) is consistently used for daily joins and syncs.

#### 4.2.2 Auth and authorization model

- Clerk identity is bridged to internal user rows.
- `requireUser` gates authenticated access.
- `requireAdmin` gates admin-only operations.
- `requireOwnership` enforces resource ownership for user-scoped records.
- Webhook sync keeps backend user state aligned with Clerk lifecycle events.

#### 4.2.3 Summaries pipeline

- Summary generation action assembles context from memories/day metadata/integration rows.
- Quota reservation/enforcement protects cost and abuse boundaries.
- OpenAI call layer has retry behavior and structured parsing.
- `summaryGenerationQuotas` provides per-day guardrails.

#### 4.2.4 Integration subsystem

Key architecture patterns:

- provider allowlists and parsing helpers centralized,
- OAuth tokens associated with opaque `tokenRef`,
- secrets held in `integrationSecrets` table,
- per-user/provider/day sync-run idempotency state in `integrationSyncRuns`,
- normalized daily context rows in `integrationDailyData`.

This is a mature integration architecture direction, with clear extension points for new providers.

#### 4.2.5 Admin backend surface

- Admin dashboard metrics query.
- Admin CRUD endpoints per major domain entity.
- Audit log read/write operations.
- Paginated queries exist for large entities.

### 4.3 Web App Architecture (`apps/web`)

- Next.js App Router with Clerk + Convex providers.
- Dashboard shell with summary/settings/export/account navigation.
- Daily summary page consumes Convex queries/actions.
- Settings page manages integrations and provider sync actions.
- Export page supports JSON/TXT payload export and optional location-signal inclusion.
- OAuth start/callback routes handled server-side in web app API routes.

### 4.4 Admin App Architecture (`apps/admin`)

- Next.js App Router + Clerk.
- Proxy/middleware gate validates auth/admin and sets signed short-lived admin cache cookie.
- Admin guard wrapper is used across admin route pages.
- Full list/create/edit/delete coverage for users, memories, days, summaries, integrations, preferences, and content.
- Audit logs page uses paginated query + client filters.

### 4.5 Mobile App Architecture (`apps/mobile`)

- Expo Router tabs + Clerk + Convex provider chain.
- Core tabs:
  - Home,
  - Add Memory,
  - Insights,
  - Memory (daily detail),
  - Profile/Settings,
  - Quick setup flow.
- Device-context services:
  - reminder scheduler/sync,
  - foreground location tracking,
  - Apple Health ingestion bridge,
  - Android/iOS screen-time ingestion bridges.

Notable mobile strength:

- profile/settings screen acts as integration and preference control plane, including quiet hours and location tracking state.

## 5) Cross-System Data Flow (How Parts Connect)

### 5.1 Auth and identity flow

1. User authenticates via Clerk (web/mobile/admin).
2. Convex receives auth context via provider bridge.
3. Backend user row exists via webhook sync or sync mutation path.
4. Domain handlers authorize by user/admin/ownership checks.

### 5.2 Core day loop flow

1. User creates memories (`memories` + optional `memoryMedia`).
2. User updates day metadata (`days`: rating, notes, people tags).
3. Summary action composes all day context and writes `daySummaries`.
4. Web/mobile surfaces render a unified day narrative.

### 5.3 Integrations flow (OAuth providers)

1. Client starts OAuth via web route `/api/integrations/oauth/[provider]/start`.
2. Callback exchanges code for tokens and mutates Convex integration state.
3. Tokens are linked via `tokenRef`; secrets stored server-side.
4. User-triggered sync writes normalized provider/day rows to `integrationDailyData`.
5. Summary generation includes this context in prompts/sources.

### 5.4 Mobile native-context flow

1. Tab layout boot syncs reminders from user preferences.
2. If foreground location tracking is enabled, app watches location only while app is active.
3. Coarse location signal rows are written via integration daily data mutation.
4. Preference state tracks permission/last update metadata.

### 5.5 Export flow

1. Web export page calls backend export query.
2. Query returns summaries/memories/days/integrationDailyData.
3. Location rows can be excluded unless explicitly requested.
4. Download generated as JSON or text.

## 6) Strengths (What Was Implemented Well)

1. **Strong backend contract reuse** across web/admin/mobile reduces divergence risk.
2. **Good authz discipline** (user/admin/ownership helper model is explicit and repeatable).
3. **Integration reliability patterns are mature** (allowlists, refresh logic, idempotency state).
4. **AI summary pipeline is governed** (quota and retries, not just raw model calls).
5. **Privacy-aware export controls** (optional location inclusion) are a good product trust decision.
6. **Operational quality improved** with stricter env validation and CI secret scanning.

## 7) Findings: Risks, Inconsistencies, and Debt

### 7.1 High severity

#### Finding H1: Audit log pagination can omit valid rows under filters

- Current behavior paginates first then applies action/time filters in memory.
- This can drop records across page boundaries because cursor progression is done on unfiltered set.

Impact:

- Incomplete or misleading audit review results for admins.

Recommendation:

- Move filter conditions into index-constrained query paths where possible.
- Add additional indexes for high-value filter combinations.
- Add regression tests for filtered cursor continuity.

#### Finding H2: Admin dashboard metrics perform full table collects

- Dashboard counts are built via `collect()` on major tables.
- As data grows, this becomes an O(N) hot path for an always-visible screen.

Impact:

- Higher latency, more memory pressure, eventual dashboard instability at scale.

Recommendation:

- Introduce incrementally maintained counters/materialized metrics.
- Or split counts into targeted indexed count flows where feasible.

### 7.2 Medium severity

#### Finding M1: Integration secrets are server-side but not application-encrypted

- Tokens are in dedicated secrets table, which is good boundary design.
- They are still stored as plaintext fields in DB records.

Impact:

- DB compromise yields immediately usable provider tokens.

Recommendation:

- Add application-layer envelope encryption (KMS/key rotation compatible).
- Keep current `tokenRef` addressing model.

#### Finding M2: Test coverage does not match backend complexity

- Current visible backend tests are provider parsing + validators unit tests.
- High-risk flows (summary generation, integration sync idempotency, authz boundaries, admin query correctness) need behavior tests.

Impact:

- Regression risk is concentrated in the most business-critical modules.

Recommendation:

- Reintroduce handler-level behavior tests with deterministic harnesses.
- Gate on core-flow test suites in CI.

#### Finding M3: Cross-package type import boundaries are brittle in web

- Some web components import generated backend model types via deep relative path.

Impact:

- Refactor fragility and workspace-boundary coupling.

Recommendation:

- Re-export needed types from package entry points and consume through alias imports only.

### 7.3 Low severity

#### Finding L1: CI naming drift across docs/workflow

- Docs refer to `Backend Tests` while workflow job name is `Backend Validation`.

Impact:

- Confusion in branch protection setup and release checklists.

Recommendation:

- Standardize naming in docs and branch-protection rule labels.

## 8) Security and Compliance Posture Snapshot

Current positives:

- Required env validation for critical backend/admin secrets.
- Clerk webhook signature verification.
- CI secret-scan gate in feature workflow.
- Admin middleware gate + signed admin-cache cookie strategy.

Security backlog to prioritize:

1. Token encryption at application level.
2. Formalized security tests for OAuth callback abuse cases (state mismatch, replay, wrong user, malformed return path).
3. Audit logging coverage verification for all admin mutating paths.

## 9) Testing and Quality Status

Current:

- Backend lint/test steps exist in CI.
- Mobile validation includes typecheck/lint/build:ci.

Gap:

- Current backend tests are narrow for present feature depth.

Recommended minimal high-value test suites:

1. Summary generation quota enforcement and failure/retry behavior.
2. Integration sync idempotency and refresh-token update paths.
3. Audit log pagination/filter correctness.
4. Authz negative-path tests (forbidden/unauthorized) on core handlers.
5. OAuth callback state/user mismatch hard-fail tests.

## 10) Delivery Plan (Prioritized)

### 0-2 weeks (stability + correctness)

1. Fix audit log filter/pagination correctness.
2. Normalize CI naming across docs and protections.
3. Add focused behavior tests for summaries + integrations + audit logs.

### 2-6 weeks (scale + security)

1. Replace collect-based admin dashboard metrics with scalable counters.
2. Add token encryption migration path for `integrationSecrets`.
3. Harden OAuth callback tests and observability events.

### 6-12 weeks (platform maturity)

1. Add full provider health dashboard/alerts (sync error rates, stale syncs).
2. Introduce data retention and lifecycle policy docs (especially for location signals).
3. Expand integration provider SDK abstraction for easier provider onboarding.

## Action Tickets (Owner + Effort + Outcome)

The following backlog translates this review into execution-ready engineering tickets.

### Priority P0 (Correctness and risk containment)

| Ticket | Title                                                   | Owner      | Effort | Outcome                                | Acceptance Criteria                                                                           |
| ------ | ------------------------------------------------------- | ---------- | ------ | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| P0-01  | Fix audit-log filtered pagination semantics             | Backend    | M      | Correct admin audit visibility         | Date/action filters are query-level where possible; cursor pages do not skip matching records |
| P0-02  | Add regression tests for audit log pagination/filtering | Backend QA | S-M    | Prevent future correctness regressions | Tests prove stable ordering and complete coverage across multi-page filtered queries          |
| P0-03  | Align CI/check naming across docs and branch protection | DevEx      | S      | Remove operational ambiguity           | README, workflow doc, deploy runbook, and branch rule names are identical                     |
| P0-04  | Re-establish backend behavior test baseline             | Backend    | M      | Raise confidence in critical flows     | Tests cover summaries, integrations idempotency, authz negative paths, and key admin queries  |

### Priority P1 (Performance and security hardening)

| Ticket | Title                                                                  | Owner              | Effort | Outcome                                 | Acceptance Criteria                                                                                   |
| ------ | ---------------------------------------------------------------------- | ------------------ | ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P1-01  | Replace collect-based admin metrics with counters/materialized metrics | Backend            | M-L    | Predictable dashboard performance       | No full-table collect on admin dashboard path; latency baseline documented                            |
| P1-02  | Add app-layer encryption for integration secrets                       | Security + Backend | L      | Token-compromise blast radius reduction | Access/refresh tokens encrypted at rest with managed key strategy and migration completed             |
| P1-03  | Add OAuth callback abuse-path test suite                               | Security QA        | M      | Better auth-flow resilience             | State mismatch, user mismatch, malformed return paths, and replay attempts are hard-failed and tested |
| P1-04  | Add integration sync observability contract                            | Backend + Ops      | M      | Faster production diagnosis             | Sync success/error rates and stale-run signals are queryable with basic alert thresholds              |

### Priority P2 (Consistency and maintainability)

| Ticket | Title                                                   | Owner                        | Effort | Outcome                                  | Acceptance Criteria                                                                     |
| ------ | ------------------------------------------------------- | ---------------------------- | ------ | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| P2-01  | Remove deep relative backend type imports from web      | Web + Backend                | S-M    | Better package boundaries                | Web consumes backend types through package export surface only                          |
| P2-02  | Standardize mobile auth screen theming primitives       | Mobile                       | S-M    | UI consistency and maintainability       | `forgot-password` shares tokenized theme approach used in sign-in/sign-up               |
| P2-03  | Add retention policy for location-derived daily signals | Product + Security + Backend | M      | Privacy clarity and governance           | Documented retention + deletion behavior and corresponding backend policy controls      |
| P2-04  | Build summary quality evaluation harness                | AI + Backend                 | M      | Measure summary output quality over time | Evaluation dataset + pass/fail rubric + trend report exists in CI or scheduled workflow |

### Suggested sequencing

1. Execute all P0 tickets first (correctness and confidence).
2. Parallelize P1-01 and P1-03 while P1-02 is being designed.
3. Finish P2 tickets as part of the same hardening release train.

### Suggested ownership model

1. Backend lead owns P0-01, P0-02, P0-04, P1-01.
2. Security lead co-owns P1-02, P1-03, P2-03.
3. Mobile/web leads own P2-01 and P2-02 with backend support.
4. AI/backend pair owns P2-04.

## 11) Architecture Decisions Worth Keeping

Keep these as long-term patterns:

1. Convex as a shared backend contract for all clients.
2. Day-key normalized daily data model.
3. Explicit authz helper boundaries.
4. Integration secret/tokenRef separation from user-visible integration state.
5. Quota-guarded AI generation as a first-class concern.

## 12) Definition of Done for "Next Maturity Milestone"

The next milestone should be considered complete when all are true:

1. Audit logs filter/pagination returns consistent results across cursor pages.
2. Admin metrics no longer rely on whole-table collect patterns.
3. Integration secrets are encrypted at application layer.
4. Core backend behavior test suites exist and are green in CI.
5. Docs, CI job names, and branch protection checks are aligned.

## 13) Commit Milestones (Recent High-Signal Markers)

Selected timeline markers (chronological):

- 2026-02-23: backend schema/auth helpers integration landed.
- 2026-02-25: admin dashboard/CRUD/guards added.
- 2026-03-08 to 2026-03-09: mobile core loop and web dashboard shipped.
- 2026-03-21: AI summary generation implemented.
- 2026-03-22: strict env validation + media upload + pagination + auth gating improvements.
- 2026-03-23: integration secrets + sync run tracking + preference sync + stabilization.
- 2026-03-25: reminders/integrations OAuth + foreground location + health/screen-time.
- 2026-03-28: provider validation centralization and validators tests.

## 14) Quick Reference: Key Files by Concern

Backend core:

- `packages/backend/convex/schema.ts`
- `packages/backend/convex/authz.ts`
- `packages/backend/convex/users.ts`
- `packages/backend/convex/webhooks.ts`
- `packages/backend/convex/memories.ts`
- `packages/backend/convex/days.ts`
- `packages/backend/convex/summaries.ts`
- `packages/backend/convex/summaryGeneration.ts`
- `packages/backend/convex/integrations.ts`
- `packages/backend/convex/integrationProviders.ts`
- `packages/backend/convex/admin.ts`
- `packages/backend/convex/userPreferences.ts`

Web:

- `apps/web/app/providers.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/dashboard/settings/page.tsx`
- `apps/web/app/dashboard/export/page.tsx`
- `apps/web/app/api/integrations/oauth/[provider]/start/route.ts`
- `apps/web/app/api/integrations/oauth/[provider]/callback/route.ts`
- `apps/web/app/integrations/oauth/complete/page.tsx`

Admin:

- `apps/admin/proxy.ts`
- `apps/admin/app/providers.tsx`
- `apps/admin/app/admin/dashboard/page.tsx`
- `apps/admin/app/audit-logs/page.tsx`

Mobile:

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/add-memory.tsx`
- `apps/mobile/app/(tabs)/memory.tsx`
- `apps/mobile/app/(tabs)/insights.tsx`
- `apps/mobile/app/(tabs)/quick-setup.tsx`
- `apps/mobile/app/(tabs)/profile.tsx`
- `apps/mobile/lib/reminder-notifications.ts`
- `apps/mobile/lib/foreground-location-tracker.ts`

CI and ops docs:

- `.github/workflows/feature.yml`
- `README.md`
- `CONVEX_SETUP.md`
- `DEPLOY_RUNBOOK.md`
- `SECURITY.md`

---

This document should be updated whenever major architectural behavior changes (auth model, schema/table design, integration providers, CI gate definitions, or summary generation pipeline).
