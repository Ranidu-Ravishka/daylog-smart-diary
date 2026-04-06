# DayLog Engineering Workflow

Last updated: 2026-04-06

## 1) Purpose

This document is the operational workflow standard for shipping code in DayLog.
It defines how we branch, commit, review, validate, release, and declare work complete.

Use this file as the default process reference for all contributors.

## 2) Repository Model

- Monorepo: pnpm + turbo
- Applications:
  - apps/web (Next.js)
  - apps/admin (Next.js)
  - apps/mobile (Expo)
- Shared backend:
  - packages/backend (Convex)

All production changes must keep contracts compatible across web, admin, mobile, and backend.

## 3) Branch Strategy

### 3.1 Protected branches

- main:
  - Always releasable
  - Protected in GitHub
  - Direct pushes are not allowed

### 3.2 Working branches

- feature/area-short-description
  - Example: feature/mobile-location-retry
- fix/area-short-description
  - Example: fix/web-export-timeout
- hotfix/area-short-description
  - Example: hotfix/backend-webhook-401
- chore/area-short-description
  - Example: chore/docs-security-rotation

### 3.3 Branch lifecycle rules

- Rebase or merge main into your branch before final review if branch is stale.
- Keep PR scope narrow and coherent.
- Large initiatives must be split into milestone PRs with safe intermediate states.

## 4) Commit Conventions

Use Conventional Commit style:

- feat: new user-facing or platform capability
- fix: bug fix or regression fix
- perf: performance optimization
- refactor: internal restructure without behavior change
- test: test additions/updates
- docs: documentation only
- chore: tooling/infra/non-product maintenance

Examples:

- feat(web): add retry state for summary generation
- fix(backend): validate dayKey in updateMemory mutation
- perf(admin): replace table scan with paginated count

Rules:

- Subject line: imperative, concise, scoped.
- Body: include why, risk, and migration notes (if relevant).
- Breaking changes must include explicit BREAKING CHANGE details.

## 5) Pull Request Standards

Every PR must include:

- Clear problem statement
- What changed and why
- Risk assessment
- Test evidence (commands and result summary)
- Screenshots/video for UI changes (web/mobile/admin)
- Data migration notes if schema/storage behavior changed

PR size guidance:

- Preferred: < 500 net lines
- Above 500 lines: justify split constraints and highlight review focus areas

## 6) CI Expectations

Source-of-truth workflow:

- .github/workflows/backend-validation.yml

Required status check for main:

- backend-validation

Validation gates enforced by CI:

- secret scan
- lint (repo)
- typecheck (repo)
- backend lint
- backend tests
- backend coverage gate
- web OAuth abuse tests
- mobile typecheck
- mobile lint
- mobile Expo web export build validation
- selective web/admin builds based on changed paths

Branch protection verification:

- Policy file: .github/branch-protection.expected.json
- Verification script: scripts/verify-branch-protection.mjs
- Command:
  - pnpm verify:branch-protection -- --branch main

## 7) Local Pre-PR Checklist

Run from repository root:

- pnpm install
- pnpm lint
- pnpm typecheck
- pnpm --filter @repo/backend test:run
- pnpm --filter mobile check-types
- pnpm --filter mobile lint
- pnpm --filter mobile build:ci
- pnpm build:web
- pnpm build:admin

If your change touches web API OAuth routes:

- pnpm --filter web test:oauth-abuse

If your change touches branch policy tooling:

- GITHUB_TOKEN=token_value GITHUB_REPOSITORY=owner/repo pnpm verify:branch-protection -- --branch main

## 8) Code Review Standards

Reviewers must prioritize:

- Correctness and regressions
- Security boundaries (authz, token handling, secret safety)
- Data integrity (idempotency, migrations, cascade behavior)
- Performance/scalability (query patterns, pagination, N+1 paths)
- Observability impact (logs, metrics, actionable errors)

Review checklist:

- Is behavior correct in success and failure paths?
- Are edge cases handled explicitly?
- Are mutations/queries bounded and safe at scale?
- Is user feedback clear for loading/error/empty states?
- Are tests sufficient for changed risk surface?
- Is documentation updated where behavior/ops changed?

Approval policy:

- At least 1 reviewer approval required.
- Critical/security/data-path changes require 2 approvals when available.
- Unresolved critical comments block merge.

## 9) Release Checklist

Before release cut or production deploy:

1. Ensure latest main is green for backend-validation.
2. Verify branch protection policy matches expected JSON.
3. Confirm production environment variables are valid and non-placeholder.
4. Run retention/integration migration audits when applicable.
5. Confirm webhook health and auth flow smoke tests.
6. Smoke test web, admin, and mobile primary journeys.
7. Confirm rollback plan and owner-on-call coverage.

Post-deploy checks:

1. Sign-in and core dashboard flow work.
2. Summary generation succeeds.
3. Integration connect/sync paths succeed for configured providers.
4. Admin pages load and key metrics/audit screens function.
5. Error rates and logs show no unexpected spike.

## 10) Definition of Done (Strict)

A task is done only when all are true:

1. Functional acceptance
   - Feature/fix works as specified across affected clients.
2. Quality gates
   - Local checks pass and CI backend-validation passes.
3. Security and privacy
   - No secret leakage, no weakened auth boundaries, no unsafe token handling.
4. Reliability
   - Failure states are handled with clear user or operator signal.
5. Performance
   - No new unbounded hot paths or avoidable N+1 patterns in critical flows.
6. Tests
   - Automated tests added/updated for changed risk areas.
7. Documentation
   - Relevant docs/runbooks updated.
8. Operability
   - Rollout and rollback impact understood for production changes.

If any item is incomplete, the work is not done.

## 11) Incident and Hotfix Process

Use this process for production-impacting defects:

1. Create hotfix/area-description from main.
2. Add minimal, targeted fix and test coverage.
3. Open expedited PR with incident context and risk note.
4. Obtain required approvals.
5. Merge after green CI.
6. Perform post-release verification and incident retrospective.

## 12) Ownership and Escalation

- Feature owner is responsible for validation evidence in PR.
- Reviewer is responsible for risk-focused review quality.
- Release driver is responsible for checklist completion and go/no-go decision.

If uncertainty remains on security, data migration, or rollback safety, do not ship.

## 13) Sensitive Context Tracking Standard (Mandatory)

Scope:

- Applies to any feature that touches location, health/fitness, calendar, communication metadata, notification context, or inferred mood/activity signals.

### 13.1 Feature development rules

- Explicit opt-in is required before collecting sensitive context data.
- Collection must be feature-scoped; enabling one signal must not silently enable others.
- Data collection must default to minimum viable granularity (coarse location, day-level aggregates, bounded signal lists).
- Raw sensitive payloads must be normalized on-device or at ingestion edge before persistence.
- Every sensitive data path must have a kill switch (feature flag or user toggle) that can disable new writes without redeploying mobile clients.
- No implementation may rely on restricted or prohibited platform data sources (for example raw call logs on iOS).
- Any background collection mode must include a documented battery budget and user-facing justification.

### 13.2 Privacy-first checklist (required in PR description)

- Data inventory updated: what fields are collected, transformed, stored, and exported.
- Legal/privacy surface reviewed for the feature scope.
- User-facing disclosure text added/updated where the feature is enabled.
- Disable path implemented and verified (toggle off stops writes immediately).
- Data retention behavior documented for any new fields/tables.
- Export and delete-account flows verified for newly collected data.
- Logs and telemetry checked to confirm no secrets or raw sensitive payload leakage.

PRs that miss any checklist item are not merge-ready.

### 13.3 Permission handling standards

- Use just-in-time permission prompts tied to user action, never on silent app startup.
- If permission is denied, the feature must fail closed and remain disabled.
- Permission denial UX must include clear remediation path (system settings deep link where available).
- Do not repeatedly prompt after denial in the same session; require explicit user re-attempt.
- Platform constraints must be respected and coded explicitly:
  - iOS: no raw call log ingestion path.
  - iOS HealthKit: must run only in native/dev client builds where supported.
  - Android background/location usage: request only if corresponding feature mode is enabled.
- Preference state in backend must mirror effective permission state (`granted`, `denied`, `unknown`) for operational visibility.

### 13.4 Testing requirements for mobile sensors

- Unit tests are required for normalization/sanitization logic and edge cases.
- Sensor pipelines must include test coverage for permission states:
  - granted
  - denied
  - unavailable/unsupported device
  - revoked after being granted
- Battery-aware behavior must be validated:
  - throttling interval enforcement
  - no tight polling loops
  - bounded in-memory buffering
- Backend behavior tests must validate:
  - dayKey validation at all entry points
  - idempotent upsert by `userId + provider + dayKey`
  - aggregate query correctness for mixed provider data
- Summary generation tests must cover context-aware inputs and no-data fallbacks.

### 13.5 Release checklist additions for tracking features

Before production rollout of any sensitive tracking feature:

1. Confirm consent text, settings copy, and privacy policy updates are deployed together.
2. Verify iOS/Android permission strings and manifest entries are accurate and minimal.
3. Run full mobile + backend validation suite, including sensor/permission scenarios.
4. Validate retention/export paths for new context fields in staging.
5. Confirm on-call rollback plan can disable collection quickly (kill switch verified).
6. Perform staged rollout with monitoring on:
   - write volume anomalies
   - permission denial spikes
   - battery/performance regressions
   - error-rate increase in sync flows

No sensitive tracking feature may be marked complete without satisfying Section 13.
