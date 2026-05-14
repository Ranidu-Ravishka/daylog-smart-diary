# DayLog Production Engineering Workflow

> Status: Active
> Last Updated: 2026-05-15
> Audience: Engineers, reviewers, release drivers
> Standard: [CONTRIBUTING.md](CONTRIBUTING.md)

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
1. Risk level (R0-R3)
1. What changed (by module)
1. Validation evidence (commands + pass/fail)
1. Screenshots/video for UI changes (web/admin/mobile)
1. Migration and rollback notes (R2/R3)
1. Privacy/security checklist for sensitive features

Preferred PR size:

- under 500 net lines

If larger:

- justify why split was not practical
- provide review map by file and risk hotspots

## 11) Data and Schema Change Protocol

Applies to schema/index/data-model changes.

Requirements:

1. Forward-compatible rollout plan
1. Backfill or migration strategy (if needed)
1. Idempotent migration behavior
1. Rollback strategy with failure handling
1. Post-deploy validation query or dashboard checks

Additional constraints:

- all user-facing queries must stay bounded (pagination or explicit limits)
- avoid unbounded table scans on hot paths
- avoid per-row lookup loops when set-based alternatives exist

## 12) Sensitive Context and Privacy Standard

Applies to location, health/fitness, calendar/notification context, communication metadata, and inferred mood/activity signals.

Mandatory requirements:

1. Explicit opt-in before collection
1. Feature-scoped permissions (no silent enablement of adjacent signals)
1. Fail-closed behavior when permissions are denied
1. Coarse, minimum-necessary data retention by default
1. Disable path stops new writes immediately
1. Export/delete flows include newly collected fields
1. No raw secret or sensitive payload logging

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
1. Branch protection policy verified
1. Environment variables validated (no placeholders)
1. Security-sensitive migrations audited (if applicable)
1. Smoke test plan assigned and owned

After release:

1. Sign-in and dashboard flow succeeds
1. Summary generation succeeds
1. Integration connect/sync path succeeds
1. Admin critical pages load
1. Error rates show no unexpected spike

## 15) Hotfix Process

For production-impacting defects:

1. Branch from `main` using `hotfix/...`
1. Implement minimal targeted fix
1. Add/adjust tests for root cause
1. Open expedited PR with incident context
1. Require approvals and green CI
1. Deploy, verify, and publish incident follow-up actions

No "fix now, test later" merges to `main`.

## 16) Definition of Done

A change is done only when all are true:

1. Functional behavior meets acceptance criteria
1. Required local checks completed
1. Required CI checks green
1. Security/privacy requirements satisfied
1. Reliability and failure handling are explicit
1. Tests cover changed risk surface
1. Documentation/runbook updates are complete
1. Rollback impact is understood for production

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
1. No implicit assumptions:
   - Frontend must not assume fields not defined in backend contracts
1. Backward compatibility:
   - Breaking changes require migration strategy (R2/R3)
1. Validation:
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

1. Rollout strategy:

- Phase 1: internal testing
- Phase 2: limited user rollout
- Phase 3: full release

1. Kill switch:

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

1. Error tracking:

- All critical errors must be captured (e.g., Sentry)
- No silent failures

1. Key events to log:

- summary generation start/end
- integration sync start/end
- webhook processing
- export requests
- background tracking events

1. User-facing errors:

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

1. Battery impact:

- Background tracking must be bounded
- Avoid high-frequency polling

1. Network reliability:

- Offline-safe behavior required where applicable
- Retry strategy must be defined

1. UI consistency:

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

1. Cleanup:

- Background jobs must enforce retention rules
- Must be idempotent

1. User control:

- Users must be able to:
  - export data
  - delete data

1. Storage control:

- Avoid unbounded data growth
- Use limits or archival strategies

Unbounded storage growth is not acceptable.

## 24) Integration Reliability Standard

All external integrations must be resilient and observable.

Requirements:

1. Sync behavior:

- Must be idempotent
- Must handle partial failures

1. Retry policy:

- Define retry strategy (with limits)
- Avoid infinite loops

1. Health tracking:

- Track:
  - success rate
  - failure rate
  - last sync time

1. User visibility:

- Users must see:
  - connection status
  - last sync result

1. Failure handling:

- Must degrade gracefully
- Must not block core app usage

Integration failures must be visible and recoverable.

## 25) Observability Standards

Observability is a release blocker, not an optional enhancement.

Required standards:

1. Sentry coverage:

- Sentry must be configured for every production surface:
  - web
  - admin
  - mobile
  - backend
- Any surface without active error capture must be treated as not production-ready.

1. Structured logging:

- Structured logs are mandatory for critical paths.
- Log envelopes must include at minimum:
  - `event`
  - `userId` (or `null` when unavailable)
  - `status`
  - `errorMessage`

1. No silent failures:

- Failures must emit logs and user-safe error feedback.
- Catch-and-ignore behavior without telemetry is prohibited.
- Production paths must not rely on console-only ad-hoc debugging.

## 26) Data Integrity Rules

Data correctness must be deterministic across all clients.

1. Canonical `dayKey`:

- `dayKey` must always use `YYYY-MM-DD` format.
- `dayKey` must represent a real calendar date.
- All writes/updates must pass shared validator enforcement.

1. Timezone consistency:

- Day boundary calculations must use the same resolved user timezone strategy.
- Mixed timezone assumptions between clients/backend are prohibited.
- Contract changes to day window logic require cross-surface validation evidence.

## 27) Performance Rules

1. No N+1 query patterns:

- N+1 data access in production paths is prohibited.
- Use indexed/batched/set-based query plans.

1. Bounded reads:

- Every user-facing list/query must be bounded with explicit limits or pagination.
- Unbounded scans on hot paths are release blockers.

1. Pagination by default:

- Admin, export, and integration-history views must use paginated fetch paths.

## 28) Export Scalability Rules

1. Exports must be scalable:

- Export workflows must use pagination and/or background job execution.
- Large exports must not block request/response cycles.

1. Artifact strategy:

- Large export payloads must be generated server-side and delivered via artifact download URLs.
- Export jobs must expose status transitions and failure visibility.

1. Reliability:

- Export jobs must be idempotent and retry-safe.
- Retention cleanup must remove stale artifacts to prevent storage growth.

## 29) UX Reliability Rules

All user-triggered async flows must implement deterministic UX states.

Required per async flow:

1. Loading state
1. Error state
1. Retry mechanism

Additional requirements:

- Prevent duplicate submits during in-flight requests.
- Preserve user context on failure (do not silently reset input).
- Show actionable user-safe messages, not raw internal stack traces.

## 30) Production Readiness Checklist

Release go/no-go requires all items complete:

1. Environment variables are present, non-placeholder, and validated.
1. Sentry is connected and receiving events for all required surfaces.
1. Integrations are connectable and sync paths are verified.
1. Required CI checks are passing.
1. Production code paths contain no stray `console.log` debugging statements.

If any checklist item is incomplete, deployment must be blocked.
