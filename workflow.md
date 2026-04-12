# DayLog Production Engineering Workflow

Last updated: 2026-04-08

## 1) Purpose

This document is the mandatory engineering workflow for DayLog.
It defines how we design, build, review, validate, release, and operate changes across:

- web app (`apps/web`)
- admin app (`apps/admin`)
- mobile app (`apps/mobile`)
- backend (`packages/backend`)

This workflow is strict by default. Any exception must be documented and approved.

## 2) Operating Principles

1. `main` is always releasable.
2. Prefer small, reversible changes over large batch changes.
3. Every production-affecting change must be backed by automated evidence.
4. Security, privacy, and data integrity are non-negotiable.
5. Cross-surface compatibility is required for shared contracts.

## 3) Repository Boundaries

Monorepo stack:

- package manager: pnpm workspaces
- task orchestration: turbo
- backend: Convex
- auth: Clerk
- summaries: OpenAI-backed generation

A change in one surface can impact all others. Treat shared contracts as production APIs.

## 4) Roles and Accountability

- Author:
  - Owns design, implementation, testing evidence, and rollout notes.
- Reviewer:
  - Owns risk-based review quality (correctness, security, regressions).
- Release Driver:
  - Owns go/no-go, deployment coordination, rollback readiness.
- Incident Commander (when needed):
  - Owns hotfix path and post-incident follow-through.

## 5) Change Risk Levels

Classify each PR before coding. Use highest applicable level.

### R0 - Low Risk

Examples:

- docs-only
- copy updates without behavior changes
- comments/refactors with no runtime impact

Minimum gates:

- lint
- typecheck
- one reviewer

### R1 - Standard Product Risk

Examples:

- single-surface UX or logic changes
- non-sensitive settings updates
- isolated backend logic with bounded blast radius

Minimum gates:

- full local checklist
- CI green
- one reviewer

### R2 - High Cross-Surface Risk

Examples:

- shared API contract changes
- schema/index updates
- integration sync flow changes
- auth/session boundary changes
- admin governance and data operations

Minimum gates:

- full local checklist
- CI green
- migration/rollback note
- two reviewers when available

### R3 - Critical Risk

Examples:

- sensitive context tracking (location, health, communication metadata)
- encryption/secret handling
- deletion/retention/cascade logic
- webhook validation and identity boundaries

Minimum gates:

- full local checklist
- CI green
- explicit threat model note
- privacy checklist completion
- rollout guardrails and rollback playbook
- two reviewers required

## 6) Branching and Commits

### 6.1 Branch Naming

- `feature/<area>-<short-desc>`
- `fix/<area>-<short-desc>`
- `hotfix/<area>-<short-desc>`
- `chore/<area>-<short-desc>`

Examples:

- `feature/mobile-background-location-guardrails`
- `fix/web-oauth-callback-state-validation`

### 6.2 Commit Style

Use Conventional Commits:

- `feat`
- `fix`
- `perf`
- `refactor`
- `test`
- `docs`
- `chore`

Requirements:

- imperative subject
- scope included when useful (`feat(web): ...`)
- body includes why and risk notes for non-trivial changes

## 7) Delivery Lifecycle

### 7.1 Plan

Before coding, document:

- problem statement
- impacted modules
- risk level (R0-R3)
- validation plan
- rollback strategy (R2/R3)

### 7.2 Implement

Implementation rules:

- keep diffs focused
- avoid unrelated refactors in same PR
- preserve backwards compatibility for shared contracts unless a planned migration is included

### 7.3 Validate Locally

Run required local checks before requesting review.

### 7.4 Review

Review focuses on:

- correctness and regressions
- authz/authn boundaries
- data integrity and idempotency
- scalability (pagination, bounded queries, N+1 avoidance)
- observability and operability

### 7.5 Merge

Merge only after:

- required approvals
- required checks green
- unresolved critical comments closed

### 7.6 Deploy

Follow `DEPLOY_RUNBOOK.md` and execute smoke checks.

### 7.7 Verify

Post-deploy verification is mandatory for R2/R3 changes.

## 8) Mandatory Local Validation Commands

Run from repo root unless noted.

Core (all non-doc PRs):

```bash
pnpm install
pnpm lint
pnpm typecheck
```

Backend-affecting changes:

```bash
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test:run
pnpm test:coverage:backend
```

Web-affecting changes:

```bash
pnpm build:web
pnpm --filter web test:oauth-abuse
```

Admin-affecting changes:

```bash
pnpm build:admin
pnpm --filter admin lint
```

Mobile-affecting changes:

```bash
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
pnpm --filter mobile exec vitest run
```

Notes:

- Mobile unit tests exist in `apps/mobile/lib/*.test.ts`; they are required for mobile logic changes.
- If a command is intentionally skipped, document why in PR with owner approval.

## 9) CI and Branch Protection

Source of truth:

- workflow: `.github/workflows/backend-validation.yml`
- policy: `.github/branch-protection.expected.json`

Current required branch check:

- `backend-validation`

Policy verification command:

```bash
GITHUB_TOKEN=<token> GITHUB_REPOSITORY=<owner/repo> pnpm verify:branch-protection -- --branch main
```

Any change to CI policy requires:

- update to expected policy file
- runbook update
- explicit PR note under "CI impact"

## 10) Pull Request Standard

Every PR must include:

1. Problem and intent
2. Risk level (R0-R3)
3. What changed (by module)
4. Validation evidence (commands + pass/fail)
5. Screenshots/video for UI changes (web/admin/mobile)
6. Migration and rollback notes (R2/R3)
7. Privacy/security checklist for sensitive features

Preferred PR size:

- under 500 net lines

If larger:

- justify why split was not practical
- provide review map by file and risk hotspots

## 11) Data and Schema Change Protocol

Applies to schema/index/data-model changes.

Requirements:

1. Forward-compatible rollout plan
2. Backfill or migration strategy (if needed)
3. Idempotent migration behavior
4. Rollback strategy with failure handling
5. Post-deploy validation query or dashboard checks

Additional constraints:

- all user-facing queries must stay bounded (pagination or explicit limits)
- avoid unbounded table scans on hot paths
- avoid per-row lookup loops when set-based alternatives exist

## 12) Sensitive Context and Privacy Standard

Applies to location, health/fitness, calendar/notification context, communication metadata, and inferred mood/activity signals.

Mandatory requirements:

1. Explicit opt-in before collection
2. Feature-scoped permissions (no silent enablement of adjacent signals)
3. Fail-closed behavior when permissions are denied
4. Coarse, minimum-necessary data retention by default
5. Disable path stops new writes immediately
6. Export/delete flows include newly collected fields
7. No raw secret or sensitive payload logging

Merge is blocked if this section is incomplete for applicable changes.

## 13) Observability and Reliability Requirements

For R1-R3 changes:

- emit structured logs for key state transitions
- include actionable error messages for users/operators
- ensure failures are observable without attaching debuggers
- avoid console-only error handling in production user flows

For background/sync pipelines:

- idempotency keys or equivalent guards
- timeout and retry strategy documented
- degraded mode behavior defined

## 14) Release Checklist

Before release:

1. Latest `main` has green required checks
2. Branch protection policy verified
3. Environment variables validated (no placeholders)
4. Security-sensitive migrations audited (if applicable)
5. Smoke test plan assigned and owned

After release:

1. Sign-in and dashboard flow succeeds
2. Summary generation succeeds
3. Integration connect/sync path succeeds
4. Admin critical pages load
5. Error rates show no unexpected spike

## 15) Hotfix Process

For production-impacting defects:

1. Branch from `main` using `hotfix/...`
2. Implement minimal targeted fix
3. Add/adjust tests for root cause
4. Open expedited PR with incident context
5. Require approvals and green CI
6. Deploy, verify, and publish incident follow-up actions

No "fix now, test later" merges to `main`.

## 16) Definition of Done

A change is done only when all are true:

1. Functional behavior meets acceptance criteria
2. Required local checks completed
3. Required CI checks green
4. Security/privacy requirements satisfied
5. Reliability and failure handling are explicit
6. Tests cover changed risk surface
7. Documentation/runbook updates are complete
8. Rollback impact is understood for production

If any item is missing, the work is not done.

## 17) Exception Handling

Exceptions are rare and must include:

- reason and risk
- approver
- compensating controls
- follow-up deadline

Allowed examples:

- temporary CI bypass for external outage with manual validation evidence
- staged mitigation for urgent incident with explicit post-incident hardening tasks

Unapproved exceptions are policy violations.

## 18) Cross-Surface Contract Enforcement

All shared contracts between web, mobile, admin, and backend must be treated as production APIs.

Requirements:

1. Single source of truth:
   - Shared types/validators must be defined in backend or shared packages
2. No implicit assumptions:
   - Frontend must not assume fields not defined in backend contracts
3. Backward compatibility:
   - Breaking changes require migration strategy (R2/R3)
4. Validation:
   - All external inputs must pass strict validation (no "any" bypass)

CI expectation:

- Contract-breaking changes must fail typecheck or tests
- Boundary checks must be enforced (no direct backend misuse)

Failure to follow this leads to silent production bugs.

## 19) Feature Flags and Controlled Rollouts

All high-risk or user-sensitive features must be behind feature flags.

Examples:

- integrations
- summary generation changes
- background tracking
- AI features

Requirements:

1. Feature flags must be:
   - remotely configurable (runtimeConfig or backend-driven)
   - environment-aware (dev/staging/prod)

2. Rollout strategy:

- Phase 1: internal testing
- Phase 2: limited user rollout
- Phase 3: full release

3. Kill switch:

- Every critical feature must be disable-able without redeploy

Merge is blocked for R2/R3 features without rollout strategy.

## 20) Performance Budget and Constraints

All features must respect performance budgets.

Backend:

- No unbounded queries on user-facing paths
- Queries must be paginated or explicitly limited
- Avoid N+1 query patterns

Web/Admin:

- First load must not block on heavy data
- Use loading states for async operations

Mobile:

- Avoid excessive background processing
- Limit network calls and batching frequency
- Minimize battery impact

PRs must include:

- performance impact note (if applicable)

Regressions must be treated as defects.

## 21) Observability Standard

All production flows must be observable.

Requirements:

1. Structured logging:

- Use consistent format:
  - event name
  - userId (if applicable)
  - status (success/failure)
  - error reason (if failure)

2. Error tracking:

- All critical errors must be captured (e.g., Sentry)
- No silent failures

3. Key events to log:

- summary generation start/end
- integration sync start/end
- webhook processing
- export requests
- background tracking events

4. User-facing errors:

- Must be actionable
- Must not expose internal details

Console-only logging is not acceptable for production-critical paths.

## 22) Mobile-Specific Production Rules

Mobile behavior must respect OS constraints and user expectations.

Requirements:

1. Background features:

- Must be explicitly enabled
- Must respect OS permissions
- Must fail safely if permissions revoked

2. Battery impact:

- Background tracking must be bounded
- Avoid high-frequency polling

3. Network reliability:

- Offline-safe behavior required where applicable
- Retry strategy must be defined

4. UI consistency:

- Every async action must have:
  - loading state
  - success feedback
  - error handling

Mobile-specific failures must not silently degrade behavior.

## 23) Data Lifecycle and Retention

All stored data must have a defined lifecycle.

Requirements:

1. Retention policy:

- Define how long data is stored
- Apply especially to:
  - location data
  - health data
  - integration data

2. Cleanup:

- Background jobs must enforce retention rules
- Must be idempotent

3. User control:

- Users must be able to:
  - export data
  - delete data

4. Storage control:

- Avoid unbounded data growth
- Use limits or archival strategies

Unbounded storage growth is not acceptable.

## 24) Integration Reliability Standard

All external integrations must be resilient and observable.

Requirements:

1. Sync behavior:

- Must be idempotent
- Must handle partial failures

2. Retry policy:

- Define retry strategy (with limits)
- Avoid infinite loops

3. Health tracking:

- Track:
  - success rate
  - failure rate
  - last sync time

4. User visibility:

- Users must see:
  - connection status
  - last sync result

5. Failure handling:

- Must degrade gracefully
- Must not block core app usage

Integration failures must be visible and recoverable.
