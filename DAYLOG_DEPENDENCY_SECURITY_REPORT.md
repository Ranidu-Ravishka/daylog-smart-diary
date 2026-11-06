# DayLog Dependency Security Report

**Audit date:** 2026-11-05  
**Status:** Approved same-major and compatible transitive updates applied. No critical production dependency advisories remain. High-severity advisories remain, so this is not a clean dependency audit and does not support private-beta or production readiness.

## Executive summary

The initial `pnpm audit --prod --json` found 210 package/advisory records (174 unique GitHub advisory IDs). The final production audit found 35 records (30 unique IDs). Duplicate records are package/version matches for shared advisory IDs, not separate unique vulnerabilities.

| Severity | Initial records | Final records | Initial unique IDs | Final unique IDs |
|---|---:|---:|---:|---:|
| Critical | 10 | **0** | 9 | **0** |
| High | 118 | **17** | 94 | **17** |
| Moderate | 68 | **17** | 57 | **12** |
| Low | 14 | **1** | 14 | **1** |
| **Total** | **210** | **35** | **174** | **30** |

`pnpm audit --prod` still exits non-zero because findings remain. No claim is made that all vulnerabilities are fixed.

## Changes applied

### Direct package updates

| Workspace | Package | Before | After |
|---|---|---:|---:|
| web/admin | `next` | 16.0.3 | 16.4.1 |
| admin | `eslint-config-next` | 16.0.3 | 16.4.1 |
| web/admin | `@clerk/nextjs` | 6.37.3 | 6.39.3 |
| mobile | `@clerk/clerk-expo` | 2.19.11 | 2.20.1 |
| web/admin | `@sentry/nextjs` | 10.47.0 | 10.75.2 |

The direct packages remain on their existing major versions. Clerk's resolved transitive packages now include `@clerk/clerk-react` 5.61.11, `@clerk/shared` 3.48.0, `@clerk/clerk-js` 5.128.1, and `@clerk/backend` 2.33.8.

### Compatible transitive fixes

Added narrowly versioned pnpm overrides for compatible same-major/patch-level transitive fixes, including:

- Clerk React/shared; Babel core; brace-expansion 1.x/2.x/5.x; browserslist; compression; fast-uri; fast-xml-builder; js-cookie; js-yaml 3.x/4.x; lodash; minimatch 3.x/9.x; nanoid; node-forge; picomatch 2.x/3.x; postcss; preact; shell-quote; source-map-js; tar; undici; ws 6.x/7.x/8.x; yaml 1.x/2.x; and `@xmldom/xmldom` 0.8.x.
- The existing three overrides in `pnpm-workspace.yaml` were preserved.
- `bufferutil` and `utf-8-validate` were explicitly set to `allowBuilds: false`. This records the existing decision not to run their native install scripts; no dependency build scripts were approved or executed.

The production audit no longer reports vulnerable versions of Next.js, the direct Clerk Next.js/Expo integrations, Sentry Next.js, tar, or shell-quote.

## Remaining findings and compatibility blockers

### High (17 records, 17 unique GHSAs)

| Package | Locked version | Workspace | Patched version | Why not changed |
|---|---:|---|---:|---|
| `@xmldom/xmldom` | 0.7.13 | mobile (Expo/native plist tooling) | >=0.8.15 | Crossing 0.7 to 0.8 in a 0.x package; requires parent compatibility testing. |
| `decode-uri-component` | 0.2.2 | mobile (transitive) | >=0.5.1 | 0.x API/version-line migration; parent compatibility is unverified. |
| `image-size` | 1.2.1 | mobile (transitive) | >=2.0.3 | Major version upgrade; requires checking the owning dependency/API. |
| `zod` | 3.25.76 | admin, mobile, `packages/user-settings` | >=4.6.6 | Zod 3→4 migration; direct schema/type consumers need a separately approved migration. |

The complete record-level inventory, including all 17 high findings and exact advisory IDs/ranges, is in the appendix. These unresolved high findings block a clean audit and should be addressed before private beta or production. The transitive mobile paths are present in the production graph; that alone does not establish that each package ships in a user-facing bundle.

### Moderate (17 records, 12 unique GHSAs)

Remaining moderate findings affect:

- OpenTelemetry core 2.6.1 and six instrumentations (Knex, Mongoose, MySQL, MySQL2, PostgreSQL, and tedious), whose patched releases are outside their current 0.x minor lines.
- `@xmldom/xmldom` 0.7.13 and `decode-uri-component` 0.2.2, covered by the compatibility concerns above.
- `fast-xml-parser` 5.5.8 (audit fix >=5.7.0).
- `glob` 13.0.6 (fix >=14.0.2).
- `minimatch` 10.2.5 and 9.0.7 (the remaining advisory's fix requires >=11.0.1).
- `stream-json` 1.9.1 (fix >=3.5.0/3.6.0).
- `uuid` 7.0.3, 8.3.2, and 10.0.0 (fix >=11.1.1).

The cross-major/0.x-minor items were not forced through overrides. Their parent dependency constraints and migration impact need investigation before updating.

### Low (1 record, 1 unique GHSA)

`deepmerge` 4.3.1 in the mobile graph has no patched version listed by the audit. Track upstream status and assess whether its parent can remove or replace it; do not invent an override.

## Validation results

| Check | Result | Notes |
|---|---|---|
| Frozen install | **PASS** | `pnpm install --frozen-lockfile --ignore-scripts` with pnpm 12.16.1. The repository explicitly denies build scripts for `bufferutil` and `utf-8-validate`. |
| Final production audit | **FINDINGS REMAIN** | 0 critical, 17 high, 17 moderate, 1 low; command exits non-zero as expected. |
| Workspace lint | **FAIL** | Admin lint reports `react-hooks/set-state-in-effect` in two pages (see below). |
| Web lint | **PASS** | `pnpm lint:web`. |
| Mobile lint | **PASS** | `pnpm lint:mobile`. |
| Backend lint | **PASS** | `pnpm --filter @repo/backend lint`. |
| Workspace TypeScript checks | **PASS** | `pnpm typecheck`; 7/7 Turbo tasks succeeded, including web/admin/mobile/backend. |
| Workspace unit tests | **PASS** | `pnpm test`; 4/4 Turbo test tasks succeeded. Backend reports 265 passing tests; admin reports 7 passing tests. |
| Web production build | **PASS** | Next.js 16.4.1. |
| Admin production build | **PASS** | Next.js 16.4.1. |
| Mobile web export | **PASS** | Expo SDK 54 export completed. |
| Web Playwright E2E | **PASS** | 3/3 tests passed. |

Admin lint failures:

- `apps/admin/app/feature-flags/page.tsx:149` — synchronous `setDrafts` in an effect.
- `apps/admin/app/retention/page.tsx:135` — synchronous `setPolicyDrafts` in an effect.

The lint failures were not changed because they are application-code changes outside this dependency-only scope. They were observed with the upgraded `eslint-config-next`; whether they were present under the old lockfile was not established. Web, mobile, and backend lint pass independently.

Turborepo warns that it cannot parse the lockfile's multiple YAML documents when resolving workspace metadata, but all tasks continued and passed or failed with their own results. This warning is not an audit failure. Builds also emitted Node's `module.register()` deprecation warning. pnpm reported peer-dependency/deprecated-subdependency warnings during resolution; these are not hidden by the security counts.

## Scope and release assessment

- No application source code, authentication logic, database schema/data, Convex deployment configuration, remote service, or production environment was changed.
- No deploy, Convex dev/deploy command, database mutation, or account deletion was performed.
- The current dependency status is **not ready for private beta or production** while the 17 high advisories remain. Continue development only with the residual risk understood.
- Before private beta, get separate approval for the necessary API/major migrations, remediate or risk-accept each high finding with evidence, rerun the production audit, and resolve the admin lint failures.
- Before production, also resolve/review the remaining moderate and low findings, verify runtime/bundle reachability, and repeat validation in CI on the project's supported Node 22 runtime.

## Recommended next steps

1. Approve a separate compatibility/migration task for Zod 4, then add schema/type regression coverage across `packages/user-settings`, admin, and mobile.
2. Trace the parent Expo/native dependency constraints for `@xmldom/xmldom`, `decode-uri-component`, and `image-size`; prefer parent upgrades over force-overrides.
3. Review the remaining moderate package paths and choose compatible parent upgrades or documented risk acceptance; track `deepmerge` upstream status.
4. Fix or explicitly disposition the two admin lint errors.
5. Rerun `pnpm audit --prod` and all relevant tests/builds after any later changes. Do not deploy based on this report alone.

## Final production audit inventory

Each row is one package/advisory record from the final `pnpm audit --prod --json` output. `D` denotes a direct manifest path and `T` a transitive path. Runtime reachability must be assessed separately from graph membership.

<!-- FINAL_ADVISORY_TABLE -->
