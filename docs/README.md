# DayLog documentation

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Engineers and operators  
> Standard: [../CONTRIBUTING.md](../CONTRIBUTING.md)

This directory is the **documentation index** for the DayLog monorepo. Operational policies and runbooks also live at the repository root for visibility and deep links from GitHub.

## Start here

| Document | Purpose |
| -------- | ------- |
| [../README.md](../README.md) | Project overview, quick start, commands, links |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute, review expectations, doc standards |
| [../workflow.md](../workflow.md) | Engineering workflow, risk levels, local validation |
| [../SECURITY.md](../SECURITY.md) | Secrets, rotation, encryption controls |
| [../DEPLOY_RUNBOOK.md](../DEPLOY_RUNBOOK.md) | Releases, environments, smoke tests, operations |
| [../CONVEX_SETUP.md](../CONVEX_SETUP.md) | Convex + Clerk + env checklist |

## Guides in `docs/`

| Document | Purpose |
| -------- | ------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System layout, auth, data flow, packages |
| [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md) | Env vars by surface, validation, examples |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Where each app runs, deploy order, CI gates |
| [TESTING.md](./TESTING.md) | Unit, integration, E2E, coverage |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Common failures and fixes |
| [RELEASE_WORKFLOW.md](./RELEASE_WORKFLOW.md) | Release checklist and pointers to policy docs |
| [API_OVERVIEW.md](./API_OVERVIEW.md) | How clients talk to Convex (no invented RPCs) |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Tokens, typography, motion, accessibility |

## Product and architecture notes

| Document | Purpose |
| -------- | ------- |
| [../LIFE_CONTEXT_TRACKING_BLUEPRINT.md](../LIFE_CONTEXT_TRACKING_BLUEPRINT.md) | Life-context signals, privacy model, mobile + backend touchpoints |

## Optional media

Add screenshots under `docs/assets/` (for example `docs/assets/web-dashboard.png`) and reference them from the root [README.md](../README.md).
