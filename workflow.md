# DayLog Engineering Workflow (Reality-Aligned, March 2026)

Project: DayLog - AI-Assisted Journal  
Module: PUSL3190 Computing Project

This workflow is the implementation-aware source of truth for how we build, review, and ship DayLog.

Applies to:

- apps/web (user web app)
- apps/mobile (Expo app)
- apps/admin (admin console)
- packages/backend/convex (shared Convex backend)

---

## 1) Critical Findings First

### High Severity

1. OAuth integrations do not persist or use refresh tokens.
   - Risk: provider connections eventually fail after access token expiry.
   - Impact: scheduled or repeated sync degrades over time.

2. CI and testing docs were previously out of sync with executable gates.
   - Mitigation: CI now includes an explicit Backend Validation job and docs are aligned to real checks.
   - Residual risk: branch protection settings in GitHub must continue to match workflow job names.

### Medium Severity

1. Provider validation was inconsistent across write APIs.
   - Mitigation: provider validation is now centralized with strict allowlists, input normalization, and shared guard functions across integration and admin write paths.
   - Residual risk: new write entry points can regress if they bypass the centralized validation layer.

2. Integration sync-run query path has avoidable scale cost.
   - Mitigation: day-scoped sync-run reads now use an index-native query with direct user/day filtering and descending order by update time.
   - Residual risk: future sync-run read APIs can regress if they bypass indexed patterns.

### Low Severity

1. Backend docs have stale module naming.
   - Risk: contributor confusion and onboarding slowdown.
   - Impact: avoidable implementation mistakes and slower ramp-up.

---

## 2) Open Assumptions (Must Be Confirmed)

1. Product intent is long-lived OAuth integrations (production lifecycle), not short-session tokens.
2. Backend behavior tests were removed or paused intentionally, not accidentally lost.
3. location is intentionally modeled as a contextual integration provider for daily signal ingestion.

If any assumption is wrong, update this document and the remediation plan before coding.

---

## 3) Evolution Timeline (Implemented Phases)

1. Foundation: Turborepo + pnpm monorepo bootstrap.
2. Platform wiring: Convex integrated across web, admin, and mobile.
3. Identity migration: Auth0 experiments shifted to Clerk + Convex.
4. Core loop: memory CRUD, mood capture, day rating, dashboard flow.
5. Admin maturity: paginated admin lists, CRUD detail/edit flows, role gating.
6. AI summaries: OpenAI summary generation plus quota and retry hardening.
7. Security hardening: strict env validation, webhook verification, CI secret scanning.
8. Integrations: Google Calendar, Google Fit, Spotify OAuth, Apple Health upload path.
9. Mobile context: reminders, onboarding steps, foreground location, screen-time augmentation.

---

## 4) Architecture Snapshot (Current)

### Frontend

- apps/web: dashboard, memory flow, summaries, settings, export, OAuth routes.
- apps/mobile: tab-based app with quick setup, profile controls, reminder and integration operations.
- apps/admin: admin dashboard and data management with server-backed pagination.

### Backend

- schema-first Convex model in schema.ts.
- auth and ownership boundaries in authz.ts.
- domains: users, userPreferences, memories, days, summaries, summaryGeneration, integrations, admin.
- webhook endpoint in http.ts.

### Strengths to Keep

1. Cross-platform dayKey-centric data model.
2. Good ownership enforcement patterns.
3. Integration sync idempotency and retry controls.
4. Summary generation normalization and schema-constrained output.
5. Strong mobile preference and runtime-state UX for reminders/location.

---

## 5) Implementation Boundaries

Implemented now:

- memory journaling, mood tags, day ratings, AI day summaries
- integrations: Google Calendar, Google Fit, Spotify, Apple Health daily upload path
- mobile reminders and optional foreground-only location signals

Not implemented now:

- background location tracking
- call-log ingestion

All demos, docs, and stakeholder communication must treat non-implemented items as future scope.

---

## 6) Real CI and Local Validation Truth

CI source of truth: .github/workflows/feature.yml

Current CI jobs:

- Feature Branch CI / ci-checks
- Feature Branch CI / Backend Validation
- Feature Branch CI / Mobile Validation

Current local baseline (real scripts):

```bash
pnpm lint
pnpm typecheck
pnpm build:web
pnpm build:admin
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
```

Branch protection rules are configured in GitHub repository settings (not in git). Required status checks must match the workflow job names above exactly.

Rule: do not document a command or CI gate unless it exists and is green in the repository.

---

## 7) Step-by-Step Remediation Plan (Execution Order)

### Step 0 - Align truth before feature work

Goal: eliminate doc/CI mismatch first.

Tasks:

1. Update README and backend READMEs to match actual scripts and checks.
2. Decide one direction:
   - restore backend tests plus CI Backend Tests job, or
   - remove backend test claims until tests are reintroduced.
3. Update branch protection check names to match workflow jobs.

Exit criteria:

- every command in docs executes successfully
- all required check names in docs match workflow file exactly

### Step 1 - Implement OAuth refresh-token lifecycle

Goal: make integration auth durable.

Tasks:

1. Extend integration secret model for refresh credentials and token expiry metadata.
2. Persist refresh_token during OAuth callback when provider returns it.
3. Add pre-sync token-refresh logic for expired or near-expiry access tokens.
4. Update stored access token after refresh.
5. Record actionable error states when refresh fails.

Exit criteria:

- long-lived sync still works after access token expiry window
- reconnect is no longer required for normal token expiry events

### Step 2 - Enforce provider validation at write boundaries

Goal: centralize allowed provider rules.

Tasks:

1. Create shared provider validator used by all integration write mutations/actions.
2. Explicitly allow contextual provider values (for example location) where intended.
3. Reject unknown providers with clear errors.

Exit criteria:

- no integration write path accepts uncontrolled provider strings
- provider rules are defined once and reused

Status: completed.

Completion notes:

1. Added a centralized provider validation module with strict integration and daily-data provider sets.
2. Enforced provider validation and normalization across integration write APIs, internal mutations, and admin integration write APIs.
3. Added tests for provider normalization, allowlist acceptance, and clear rejection behavior.

### Step 3 - Optimize sync-run query scale path

Goal: remove collect-then-filter pattern.

Tasks:

1. Add an index aligned to day-scoped query requirements.
2. Replace in-memory filtering query with index-native query.
3. Verify result ordering and parity with previous behavior.

Exit criteria:

- sync-run list query is index-aligned for day lookups
- no broad collect for day-specific user reads

Status: completed.

Completion notes:

1. Added a day-scoped index for integration sync runs keyed by user, day, and updatedAt.
2. Replaced the collect-then-filter/sort implementation with an index-native query for day-specific sync-run reads.
3. Preserved result ordering semantics by sorting on updatedAt descending at query level.

### Step 4 - Burn down documentation and type-safety drift

Goal: close reliability debt and improve contributor velocity.

Tasks:

1. Replace stale file names and commands in backend docs.
2. Reduce any-based casts around summary and integration pipelines where practical.
3. Add or restore backend behavioral tests tied to key auth/integration flows.

Exit criteria:

- docs reflect live repository structure
- critical backend paths have deterministic test coverage

---

## 8) Branch, Commit, and PR Standards

### Branch naming

- feat/scope-description
- fix/scope-description
- chore/scope-description
- docs/scope-description

### Commit style

- feat: add oauth token refresh flow
- fix: validate integration provider on write paths
- docs: align workflow and ci gates with repository reality

### PR requirements

1. Problem statement and risk summary.
2. What changed and why.
3. Validation evidence (commands run and outcomes).
4. Rollback notes for risky migrations.
5. Docs updated in same PR when behavior/contracts changed.

---

## 9) Review Checklist (Reviewer + Author)

- [ ] No secrets committed.
- [ ] Authz and ownership enforced on all user mutations.
- [ ] Admin-only operations enforce requireAdmin paths.
- [ ] Provider validation exists at every write boundary.
- [ ] Integration token handling does not expose credentials to clients.
- [ ] Loading, error, and retry states are user-visible for async UX.
- [ ] CI jobs and docs are consistent.
- [ ] Any new command in docs is executable in the repo.

---

## 10) Definition of Done

A task is done only when:

1. End-to-end behavior works for target flows.
2. Security and authz invariants are preserved.
3. Lint, typecheck, and build checks pass.
4. Critical manual smoke paths are verified.
5. Documentation is updated to repository truth.
6. Known limitations are clearly documented.

---

## 11) Current Explicit Gaps

1. OAuth refresh-token lifecycle is incomplete.
2. Branch protection required checks must remain synchronized with workflow job names.
3. Provider validation consistency must be preserved as new write APIs are added.
4. Integration sync-run query scale characteristics must remain index-aligned as new read paths are added.
5. Some docs still contain stale naming.

This file must be updated whenever any gap above is resolved.
