# DayLog Engineering Workflow

Last updated: 2026-04-04

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
