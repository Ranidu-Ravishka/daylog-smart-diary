# DayLog release workflow

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Authors, reviewers, release drivers  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

This page is a **short checklist** for shipping changes. Authoritative policy text lives in **[workflow.md](../workflow.md)** and operational detail in **[DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md)**.

## Before merge

1. Classify risk (**R0–R3**) per [workflow.md](../workflow.md) (section “Change Risk Levels”).
2. Run the **mandatory local commands** for the surfaces you touched ([workflow.md](../workflow.md), “Mandatory Local Validation Commands”).
3. Ensure **CI** is green (`backend-validation` and other required checks).
4. For R2/R3: document migration, rollback, and privacy/security notes in the PR.

## Before deploy

1. Follow **[DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md)** — section “Pre-Release Checks” (lint, typecheck, test, builds).
2. Run `node scripts/validate-prod-env.mjs --mode=local` with production-like secrets when validating a release candidate.
3. Confirm **branch protection** expectations if you changed CI or policy files ([workflow.md](../workflow.md), “CI and Branch Protection”).

## Deploy

1. **Convex** first, then web/admin, then mobile ([DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md), “Deploy Order”).
2. Execute **post-deploy smoke tests** ([DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md), “Post-Deploy Smoke Tests”).

## After deploy

- Monitor Sentry and host logs for regressions.
- For data migrations: confirm audit queries from the runbook report **zero** high-risk rows before closing the release ticket.

## Hotfixes

Use `hotfix/...` branches and the process in [workflow.md](../workflow.md) (“Hotfix Process”). No merges to `main` without tests and review.
