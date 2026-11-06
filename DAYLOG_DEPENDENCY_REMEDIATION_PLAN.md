# DayLog Dependency Remediation Plan

**Status: APPROVED SCOPE APPLIED.** The same-major direct updates and compatible transitive fixes were applied after approval. Before/after audit results and validation are recorded in [DAYLOG_DEPENDENCY_SECURITY_REPORT.md](./DAYLOG_DEPENDENCY_SECURITY_REPORT.md). No deployment, database, or remote-service mutation was performed.

## 1. Baseline

Audit captured on 2026-11-05 using `pnpm audit --prod --json` from the repository root. The command exited 1, as expected for findings.

| Severity | Audit package/version records | Unique GitHub advisory IDs |
|---|---:|---:|
| Critical | 10 | 9 |
| High | 118 | 94 |
| Moderate | 68 | 57 |
| Low | 14 | 14 |
| **Total** | **210** | **174** |

Audit metadata reports 1,192 production dependency entries (1,337 total including 145 optional entries). Records count package/version matches; repeated GHSA IDs can affect multiple packages or resolved version branches. The appendix preserves each of the 210 records instead of treating repeated package matches as new unique GHSAs.

Repository baseline:

- Root requires Node `>=22.13` and pins `pnpm@12.16.1`. Installed Node is `v26.6.0`; the configured `pnpm` shim cannot find its pinned CLI. Audit and validation commands therefore use `npm exec --yes --package=pnpm@12.16.1 -- pnpm ...`, which successfully ran the audit without changing repository manifests.
- `pnpm-workspace.yaml` defines `apps/*` and `packages/*`; existing overrides are `@fastify/otel>@opentelemetry/instrumentation: 0.214.0`, `@prisma/instrumentation>@opentelemetry/instrumentation: 0.214.0`, and `import-in-the-middle: ^3.0.0`. Preserve these.
- Direct audited versions include Next.js `16.0.3` (web/admin), Clerk Next.js `6.37.3` (web/admin), Clerk Expo `2.19.11` (mobile), Sentry Next.js `10.47.0` (web/admin), React `19.2.3` (web/admin) and `19.1.0` (mobile), React Native `0.81.5`, Expo `54.0.33`, and Convex `1.38.0`.
- React, React Native, Expo, and Convex themselves have no advisory record in this audit. Their versions should not be changed as part of this remediation absent a demonstrated dependency requirement.

The audit tests membership in the production dependency graph, not whether every transitive package ships in a client bundle or is reachable at runtime. Direct production usage was confirmed for Next.js, Clerk, Sentry, and Zod. Many mobile findings resolve through Expo/React Native tooling or plist/XML packages; bundle/runtime reachability remains to be checked. The Next.js proxy/middleware and Clerk route-protection findings affect the actual web/admin authentication architecture. Sentry's tunnel-route advisory is conditional; no `tunnelRoute` configuration was found, but Sentry is directly used for instrumentation.

## 2. Critical findings and proposed minimum targets

All reported vulnerable ranges match the locked versions. The target versions below are the audit's patched lower bounds, not arbitrary latest versions.

| GHSA | Package (locked) | Vulnerable range | Audit patched range | Workspace / dependency path | Assessment |
|---|---|---|---|---|---|
| GHSA-9qr9-h5gf-34mp | `next` 16.0.3 | `>=16.0.0-canary.0 <16.0.7` | `>=16.0.10` | web/admin direct and via Clerk/Sentry | Next is used in both production apps. |
| GHSA-vqx2-fgx2-5wq9 | `@clerk/shared` 3.39.0, 3.44.0 | `<3.47.4` in the affected canary range | `>=3.47.4` | web/admin/mobile/backend transitive | Shared Clerk code is present throughout the auth stack. |
| GHSA-vqx2-fgx2-5wq9 | `@clerk/nextjs` 6.37.3 | `<6.39.2` in the affected snapshot range | `>=6.39.2` | web/admin direct | Both apps use Clerk's Next.js middleware/proxy and auth components. |
| GHSA-w7jw-789q-3m8p | `shell-quote` 1.8.3 | `<=1.8.3` | `>=1.8.4` | mobile transitive via React Native/React DevTools | Appears in the production graph; packaged/runtime exposure needs verification. A separate high advisory requires 1.9.0. |
| GHSA-23hp-3jrh-7fpw | `tar` 7.5.2 | `<=7.5.18` | `>=7.5.19` | mobile transitive | Multiple subsequent tar advisories make `7.5.21` the proposed common target. |
| GHSA-p293-qw3h-jr36 | `next` 16.0.3 | `<16.3.3` | `>=16.3.3` | web/admin direct and transitive | Windows-hosted server RCE; target 16.4.1 covers this and later Next advisories. |
| GHSA-2xp9-vwfh-vxw4 | `next` 16.0.3 | `<16.3.3` | `>=16.3.3` | web/admin direct and transitive | Unauthenticated image-optimization RCE. |
| GHSA-mchm-gjx6-7h55 | `@sentry/nextjs` 10.47.0 | `<10.75.2` | `>=10.75.2` | web/admin direct | Sentry is initialized in both apps. The middleware-bypass advisory applies when a tunnel route is configured; none was found. |
| GHSA-2464-fhr4-w9xw | `next` 16.0.3 | `<=16.4.0` | `>=16.4.1` | web/admin direct and transitive | Unauthenticated image-optimization RCE. |
| GHSA-673q-mjm6-r5xr | `next` 16.0.3 | `<=16.4.0` | `>=16.4.1` | web/admin direct and transitive | Unauthenticated RCE in affected `use cache` functions. |

There are **nine distinct critical GHSAs** across **ten package-specific records**; Clerk's one GHSA appears against both `@clerk/shared` and `@clerk/nextjs`.

## 3. Prioritized remediation

### A. Same-major package updates — proposed first

Subject to approval, update the direct declarations and lockfile only where needed:

1. **Next.js:** update web/admin from exact `16.0.3` to at least `16.4.1`. This stays on major 16 and satisfies all Next.js findings in the current audit, whose latest listed patched lower bound is 16.4.1. It is a multi-minor update, not a pure patch release; review Next.js release notes and run both applications' checks, builds, and E2E tests.
2. **Clerk Next.js:** update web/admin to at least `6.39.3`. This is the lowest version satisfying both the critical middleware advisory and the high Clerk authorization-bypass advisory. Registry peer metadata confirms Clerk 6.39.3 supports Next `^16` and React `~19.2.3`.
3. **Clerk Expo:** update mobile to at least `2.20.1`. Its declared peers accept React 19 and React Native `>=0.73`; its package dependencies request fixed/newer Clerk shared, JS, and React packages. Verify the resolved graph and Expo SDK 54 integration; do not upgrade Expo or React Native.
4. **Sentry Next.js:** update web/admin to at least `10.75.2`, still major 10. Registry peer metadata includes Next 16. Verify instrumentation/configuration compatibility.
5. **Transitive safe updates:** after tracing each parent range, raise vulnerable patch-level dependencies where compatible, including tar `7.5.21`, shell-quote `1.9.0`, `fast-uri` `3.1.9`, undici `6.29.1`, postcss `8.5.23`, sharp `0.35.5`, brace-expansion (per installed major: 1.1.21 / 2.1.7 / 5.0.12), minimatch (3.1.4 / 9.0.7), js-yaml (3.15.2 / 4.3.2), and other same-major targets listed in the appendix. Prefer parent-package upgrades over broad overrides; add an override only after checking every affected consumer and preserving the existing overrides.

Clerk package peer metadata was checked without installing: Clerk Next.js 6.39.3 supports this repo's Next 16 / React 19.2.3; Clerk Expo 2.20.1 accepts this repo's Expo-related React/RN peer versions. The patched Clerk package family includes `@clerk/backend >=2.33.3`, `@clerk/shared >=3.47.5`, and `@clerk/clerk-js >=5.125.10`; Clerk Expo 2.20.1 declares dependencies at or above those fixed families.

### B. High-priority packages that need dependency-path investigation

The 118 high records (94 distinct GHSAs) cluster around Next.js, Clerk, and transitive mobile/build dependencies. Exact advisory IDs, installed versions, vulnerable ranges, patched ranges, and workspaces are in the appendix.

| Package family | Locked version(s) | Audit target(s) | Workspace/path | Notes |
|---|---|---|---|---|
| Next.js | 16.0.3 | 16.4.1 | web/admin direct | Same major; update together and run all app validations. |
| Clerk (`clerk-expo`, `nextjs`, `backend`, `shared`, `clerk-js`, `clerk-react`) | 2.19.11 / 6.37.3 / 2.30.1 / 3.39.0, 3.44.0 / 5.114.1 / 5.58.1, 5.60.0 | 2.20.1 / 6.39.3 / 2.33.3 / 3.47.5 / 5.125.10 / `clerk-react` >=5.61.6 (5.61.11 observed in registry metadata) | all app workspaces, backend transitive | Upgrade supported top-level SDKs first; verify exact transitive resolutions. The audit marks the `clerk-react` fix range as unpublished, so verify the resolved published version and advisory status before updating. |
| Expo/RN transitive tooling | Includes tar 7.5.2, shell-quote 1.8.3, `@xmldom/xmldom` 0.7.13/0.8.11, undici 6.22.0, js-yaml 3.14.2/4.1.0, and others | Appendix patched bounds | mobile; many paths are under Expo CLI/config or React Native tooling | Confirm build-time vs shipped runtime reachability. Prefer compatible parent updates; do not upgrade Expo 54 or React Native 0.81 arbitrarily. |
| Shared web build graph | e.g. postcss 8.4.31/8.4.49/8.5.14, sharp 0.34.5, fast-uri 3.1.0/3.1.2 | appendix latest same-major patched bounds | web/admin, some mobile | Recheck Next/Sentry dependency tree before introducing overrides. |

### C. Major-version or unresolved findings — do not force

- **Zod 3.25.76:** the audit reports the only patched range as `>=4.6.6`, requiring Zod 4. Zod is directly used in `packages/user-settings` and admin and is present in mobile. This is a major API/type migration; do not apply an override or upgrade without explicit approval and dedicated schema/validation regression tests.
- **image-size 1.2.1:** audit's patched lower bound is `2.0.3`, a major update from 1.x. Identify and upgrade the owning dependency or evaluate API compatibility; do not force a 2.x override.
- **glob 13.0.6:** patched lower bound is `14.0.2`, a major update. Trace parent constraints and test before migration.
- **uuid 7.0.3 / 9.0.1 / 10.0.0:** audit reports `>=11.1.1`; upgrading consumers across major versions is not a safe blanket override.
- **minimatch 10.2.5:** a moderate advisory lists `>=11.0.1`; this is a major update for that branch. Resolve through compatible parent packages or request separate approval.
- **fast-xml-builder 1.1.5** has a high advisory patched at `>=1.1.7`, but another moderate advisory for exactly 1.1.5 has no patched range in the audit. Update for the high issue if compatible, then report any remaining moderate finding.
- **deepmerge 4.3.1** has a low advisory with no patched version listed. Do not invent a fix; assess reachability, track upstream status, and document a risk acceptance/removal option.
- `@xmldom/xmldom` 0.7.13 has no patched 0.7.x range in the audit; the reported fix is `>=0.8.15`. Confirm compatibility of parent Expo/native tooling before crossing the 0.x minor line.

If these upgrades are required to reach a zero-critical/zero-high audit, implementation must pause for separate approval of the affected migrations or an explicitly accepted residual risk.

## 4. Compatibility and scope assessment

- **Next.js:** remain on major 16; target is audit-selected 16.4.1. Node `>=20.9` and React/React DOM 18.2+ or 19 are supported by this version; repo requires Node `>=22.13`, React 19, and uses Turborepo without a Next-specific workspace restriction. The multi-minor update needs full regression testing.
- **Clerk:** remain on SDK majors 6 (web/admin) and 2 (Expo/mobile); preserve Clerk JWT issuer/auth architecture and Convex integration. Do not replace authentication or relax authorization.
- **React / React Native / Expo / Convex:** do not change versions in this security pass unless an upstream package has no compatible resolution and a separately approved migration is made. The current audit does not list these packages themselves as vulnerable.
- **Turborepo / pnpm:** keep current workspace and override configuration; lockfile must be regenerated by pnpm 12.16.1 only after approval.
- No Convex deployment, database, schema, app behavior, or remote service changes are in scope.

## 5. Upgrade order after approval

1. Apply only the approved direct Next.js, Clerk, and Sentry updates; regenerate the lockfile with pinned pnpm and inspect the diff.
2. Resolve and verify Clerk's complete package family and ensure the critical Clerk audit records disappear.
3. Update same-major transitive packages through compatible parents; add narrow pnpm overrides only when parent updates cannot resolve a fixed version and all consumers are compatible.
4. Stop before Zod 4, image-size 2, glob 14, uuid 11, minimatch 11, or other major/API migrations unless separately approved.
5. Inspect the resulting diff for unrelated manifest/lock/config changes. Stop if overrides or workspace configuration change unexpectedly.
6. Validate using the commands listed below; then rerun the production audit and record all remaining advisories in `DAYLOG_DEPENDENCY_SECURITY_REPORT.md`. Do not claim full remediation unless that audit supports it.

## 6. Validation plan

Run only after dependency-change approval:

```sh
npm exec --yes --package=pnpm@12.16.1 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@12.16.1 -- pnpm audit --prod
npm exec --yes --package=pnpm@12.16.1 -- pnpm lint:web
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter web check-types
npm exec --yes --package=pnpm@12.16.1 -- pnpm test:web
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter web build
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter admin lint
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter admin check-types
npm exec --yes --package=pnpm@12.16.1 -- pnpm test:admin
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter admin build
npm exec --yes --package=pnpm@12.16.1 -- pnpm lint:mobile
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter mobile check-types
npm exec --yes --package=pnpm@12.16.1 -- pnpm test:mobile
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter mobile build
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter @repo/backend lint
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter @repo/backend check-types
npm exec --yes --package=pnpm@12.16.1 -- pnpm --filter @repo/backend test:run
npm exec --yes --package=pnpm@12.16.1 -- pnpm test:e2e:web
```

These builds are included because the proposed direct upgrades affect web, admin, and mobile dependency graphs. Web/admin build scripts remove their `.next` output before building; check for any user-required generated contents before running them. No Convex dev/deploy command is part of this plan. Record install/audit/lint/type/test/build/E2E outcomes, including any toolchain failures.

## 7. Rollback

- Before changes, preserve the current worktree and record the precise files changed by this task; do not discard pre-existing Phase 1/2 or user changes.
- Keep dependency edits limited to the approved manifests, `pnpm-workspace.yaml` only if a reviewed override is approved, and `pnpm-lock.yaml`.
- If validation fails, diagnose first. Roll back only this task's dependency hunks and lockfile changes using targeted edits; do not reset or restore the whole worktree. Retain the audit evidence and report the reverted package(s) and unresolved advisories.
- No deployment or remote rollback is needed because none will be performed.

## 8. Exhaustive baseline advisory inventory

One row is one `pnpm audit --prod` package/version record. `D` means a direct manifest edge; `T` means transitive; `D+T` means both paths occur in that workspace. Workspace paths are from pnpm's audit JSON (`apps__*` maps to `apps/*`, `packages__*` to `packages/*`). All listed records are present in the production dependency graph; actual bundled/runtime reachability is separately discussed above.

### Critical (10 records)

| Severity | Advisory | Package | Installed version(s) | Vulnerable range | Patched range | Affected workspaces (D=direct, T=transitive) | Advisory title |
|---|---|---|---|---|---|---|---|
| critical | [GHSA-vqx2-fgx2-5wq9](https://github.com/advisories/GHSA-vqx2-fgx2-5wq9) | @clerk/nextjs | 6.37.3 | >=6.0.0-snapshot.vb87a27f <6.39.2 | >=6.39.2 | apps/admin (D), apps/web (D) | Official Clerk JavaScript SDKs: Middleware-based route protection bypass |
| critical | [GHSA-vqx2-fgx2-5wq9](https://github.com/advisories/GHSA-vqx2-fgx2-5wq9) | @clerk/shared | 3.39.0, 3.44.0 | >=3.0.0-canary.v20250225091530 <3.47.4 | >=3.47.4 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | Official Clerk JavaScript SDKs: Middleware-based route protection bypass |
| critical | [GHSA-mchm-gjx6-7h55](https://github.com/advisories/GHSA-mchm-gjx6-7h55) | @sentry/nextjs | 10.47.0 | >=10.0.0-alpha.0 <10.75.2 | >=10.75.2 | apps/admin (D), apps/web (D) | Sentry-Javascript: Middleware Bypass when using Tunnel route |
| critical | [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) | next | 16.0.3 | >=16.0.0 <=16.4.0 | >=16.4.1 | apps/admin (D+T), apps/web (D+T) | Next.js: Unauthenticated Remote Code Execution in Image Optimization API when SVG files are used |
| critical | [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) | next | 16.0.3 | >=16.0.0 <16.3.3 | >=16.3.3 | apps/admin (D+T), apps/web (D+T) | Next.js: Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used |
| critical | [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) | next | 16.0.3 | >=16.0.0 <=16.4.0 | >=16.4.1 | apps/admin (D+T), apps/web (D+T) | Next.js: Unauthenticated Remote Code Execution in `use cache` functions returning typed arrays |
| critical | [GHSA-9qr9-h5gf-34mp](https://github.com/advisories/GHSA-9qr9-h5gf-34mp) | next | 16.0.3 | >=16.0.0-canary.0 <16.0.7 | >=16.0.10 | apps/admin (D+T), apps/web (D+T) | Next.js is vulnerable to RCE in React flight protocol |
| critical | [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) | next | 16.0.3 | >=16.0.0 <16.3.3 | >=16.3.3 | apps/admin (D+T), apps/web (D+T) | Next.js: Unauthenticated Remote Code Execution on windows-hosted servers |
| critical | [GHSA-w7jw-789q-3m8p](https://github.com/advisories/GHSA-w7jw-789q-3m8p) | shell-quote | 1.8.3 | >=1.1.0 <=1.8.3 | >=1.8.4 | apps/mobile (T) | shell-quote quote() does not escape newlines in object .op values |
| critical | [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) | tar | 7.5.2 | <=7.5.18 | >=7.5.19 | apps/mobile (T) | node-tar: Decompression/parse DoS via unlimited input |

### High (118 records)

| Severity | Advisory | Package | Installed version(s) | Vulnerable range | Patched range | Affected workspaces (D=direct, T=transitive) | Advisory title |
|---|---|---|---|---|---|---|---|
| high | [GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c) | @clerk/backend | 2.30.1 | >=2.0.0 <=2.33.2 | >=2.33.3 | apps/admin (T), apps/web (T) | Clerk has an authorization bypass when combining organization, billing, or reverification checks |
| high | [GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c) | @clerk/clerk-expo | 2.19.11 | >=2.2.11 <=2.19.35 | >=2.20.1 | apps/mobile (D) | Clerk has an authorization bypass when combining organization, billing, or reverification checks |
| high | [GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c) | @clerk/clerk-js | 5.114.1 | >=5.22.0 <=5.125.9 | >=5.125.10 | apps/mobile (T) | Clerk has an authorization bypass when combining organization, billing, or reverification checks |
| high | [GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c) | @clerk/clerk-react | 5.58.1, 5.60.0 | >=5.9.0 <=5.61.5 | none reported | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | Clerk has an authorization bypass when combining organization, billing, or reverification checks |
| high | [GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c) | @clerk/nextjs | 6.37.3 | >=6.0.0 <=6.39.2 | >=6.39.3 | apps/admin (D), apps/web (D) | Clerk has an authorization bypass when combining organization, billing, or reverification checks |
| high | [GHSA-w24r-5266-9c3c](https://github.com/advisories/GHSA-w24r-5266-9c3c) | @clerk/shared | 3.39.0, 3.44.0 | >=3.0.0 <=3.47.4 | >=3.47.5 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | Clerk has an authorization bypass when combining organization, billing, or reverification checks |
| high | [GHSA-27p8-2357-5qqv](https://github.com/advisories/GHSA-27p8-2357-5qqv) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: DocType `name` Injection Bypasses requireWellFormed |
| high | [GHSA-2v35-w6hq-6mfw](https://github.com/advisories/GHSA-2v35-w6hq-6mfw) | @xmldom/xmldom | 0.7.13, 0.8.11 | <0.8.13 | >=0.8.15 | apps/mobile (T) | xmldom: Uncontrolled recursion in XML serialization leads to DoS |
| high | [GHSA-4w3w-2rp5-g8jm](https://github.com/advisories/GHSA-4w3w-2rp5-g8jm) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.13 | >=0.8.15 | apps/mobile (T) | xmldom: Attribute name injection via setAttribute() bypasses requireWellFormed |
| high | [GHSA-8344-3jmq-59r6](https://github.com/advisories/GHSA-8344-3jmq-59r6) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: Quadratic-time attribute deduplication |
| high | [GHSA-93r5-fhx6-vmg9](https://github.com/advisories/GHSA-93r5-fhx6-vmg9) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: Quadratic-time parsing via the malformed-input recovery path — `parseElementStartPart` re-scan and `normalize()` adjacent-text merge |
| high | [GHSA-965w-775f-mr7g](https://github.com/advisories/GHSA-965w-775f-mr7g) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: Quadratic-memory consumption |
| high | [GHSA-c7q8-3ch8-vqpv](https://github.com/advisories/GHSA-c7q8-3ch8-vqpv) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: Processing Instruction Target Injection Bypasses requireWellFormed |
| high | [GHSA-f6ww-3ggp-fr8h](https://github.com/advisories/GHSA-f6ww-3ggp-fr8h) | @xmldom/xmldom | 0.7.13, 0.8.11 | <0.8.13 | >=0.8.15 | apps/mobile (T) | xmldom has XML injection through unvalidated DocumentType serialization |
| high | [GHSA-j759-j44w-7fr8](https://github.com/advisories/GHSA-j759-j44w-7fr8) | @xmldom/xmldom | 0.7.13, 0.8.11 | <0.8.13 | >=0.8.15 | apps/mobile (T) | xmldom has XML node injection through unvalidated comment serialization |
| high | [GHSA-w2rr-34g9-rvrj](https://github.com/advisories/GHSA-w2rr-34g9-rvrj) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.13 | >=0.8.15 | apps/mobile (T) | xmldom: Element name injection via createElement() bypasses requireWellFormed |
| high | [GHSA-wh4c-j3r5-mjhp](https://github.com/advisories/GHSA-wh4c-j3r5-mjhp) | @xmldom/xmldom | 0.7.13, 0.8.11 | <0.8.12 | >=0.8.15 | apps/mobile (T) | xmldom: XML injection via unsafe CDATA serialization allows attacker-controlled markup insertion |
| high | [GHSA-x4fp-j954-r2f4](https://github.com/advisories/GHSA-x4fp-j954-r2f4) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: End-tag Whitespace-Trim Regex ReDoS — quadratic backtracking in the 0.8.x end-tag parser |
| high | [GHSA-x6wf-f3px-wcqx](https://github.com/advisories/GHSA-x6wf-f3px-wcqx) | @xmldom/xmldom | 0.7.13, 0.8.11 | <0.8.13 | >=0.8.15 | apps/mobile (T) | xmldom has XML node injection through unvalidated processing instruction serialization |
| high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | brace-expansion | 2.0.2 | >=2.0.0 <2.1.2 | >=2.1.2 | apps/mobile (T) | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | brace-expansion | 1.1.12 | <1.1.16 | >=1.1.16 | apps/mobile (T) | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| high | [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp) | brace-expansion | 5.0.5 | >=3.0.0 <5.0.7 | >=5.0.7 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| high | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | brace-expansion | 1.1.12 | <1.1.19 | >=1.1.19 | apps/mobile (T) | brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion |
| high | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | brace-expansion | 2.0.2 | >=2.0.0 <2.1.5 | >=2.1.5 | apps/mobile (T) | brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion |
| high | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | brace-expansion | 5.0.5 | >=4.0.0 <5.0.10 | >=5.0.10 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: DoS via uncontrolled recursion in parseCommaParts causing stack exhaustion |
| high | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | brace-expansion | 1.1.12 | <1.1.17 | >=1.1.17 | apps/mobile (T) | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash |
| high | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | brace-expansion | 2.0.2 | >=2.0.0 <2.1.3 | >=2.1.3 | apps/mobile (T) | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash |
| high | [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) | brace-expansion | 5.0.5 | >=4.0.0 <5.0.8 | >=5.0.8 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash |
| high | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | brace-expansion | 1.1.12 | <1.1.20 | >=1.1.20 | apps/mobile (T) | brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion |
| high | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | brace-expansion | 2.0.2 | >=2.0.0 <2.1.6 | >=2.1.6 | apps/mobile (T) | brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion |
| high | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | brace-expansion | 5.0.5 | >=4.0.0 <5.0.11 | >=5.0.11 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: DoS via uncontrolled recursion on nested brace groups causing stack exhaustion |
| high | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | brace-expansion | 5.0.5 | >=4.0.0 <5.0.9 | >=5.0.9 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation |
| high | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | brace-expansion | 2.0.2 | >=2.0.0 <2.1.4 | >=2.1.4 | apps/mobile (T) | brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation |
| high | [GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895) | brace-expansion | 1.1.12 | <1.1.18 | >=1.1.18 | apps/mobile (T) | brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation |
| high | [GHSA-73wf-gq98-2v4g](https://github.com/advisories/GHSA-73wf-gq98-2v4g) | browserslist | 4.28.0, 4.28.2 | <=4.28.6 | >=4.28.7 | apps/admin (T), apps/mobile (T), apps/web (T) | Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) |
| high | [GHSA-c83g-rgw3-j3cx](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) | browserslist | 4.28.0, 4.28.2 | <=4.28.6 | >=4.28.7 | apps/admin (T), apps/mobile (T), apps/web (T) | Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM |
| high | [GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95) | compression | 1.8.1 | <1.8.2 | >=1.8.2 | apps/mobile (T) | compression vulnerable to Denial of Service via memory leak on premature response close |
| high | [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) | decode-uri-component | 0.2.2 | <=0.5.0 | >=0.5.1 | apps/mobile (T) | decode-uri-component vulnerable to denial of service via quadratic replacement of percent-encoded runs |
| high | [GHSA-4c8g-83qw-93j6](https://github.com/advisories/GHSA-4c8g-83qw-93j6) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.3 | >=3.1.3 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to host confusion via failed IDN canonicalization |
| high | [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.5 | >=3.1.5 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to host confusion via backslash authority introducer |
| high | [GHSA-f65p-4m7j-42xc](https://github.com/advisories/GHSA-f65p-4m7j-42xc) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.6 | >=3.1.6 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization |
| high | [GHSA-fph4-wmhf-6fwf](https://github.com/advisories/GHSA-fph4-wmhf-6fwf) | fast-uri | 3.1.2 | >=3.1.2 <3.1.6 | >=3.1.6 | apps/admin (T), apps/web (T) | fast-uri vulnerable to server-side request forgery via repeated hostname percent-decoding |
| high | [GHSA-jqff-g426-hqxp](https://github.com/advisories/GHSA-jqff-g426-hqxp) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.6 | >=3.1.6 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to host confusion via percent-encoded scheme normalization |
| high | [GHSA-q3j6-qgpj-74h6](https://github.com/advisories/GHSA-q3j6-qgpj-74h6) | fast-uri | 3.1.0 | >=3.0.0 <=3.1.0 | >=3.1.1 | apps/mobile (T) | fast-uri vulnerable to path traversal via percent-encoded dot segments |
| high | [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.7 | >=3.1.7 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to authority injection via an unvalidated port in serialize |
| high | [GHSA-v2hh-gcrm-f6hx](https://github.com/advisories/GHSA-v2hh-gcrm-f6hx) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <=3.1.3 | >=3.1.4 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to host confusion via literal backslash authority delimiter |
| high | [GHSA-v39h-62p7-jpjc](https://github.com/advisories/GHSA-v39h-62p7-jpjc) | fast-uri | 3.1.0 | >=3.0.0 <=3.1.1 | >=3.1.2 | apps/mobile (T) | fast-uri vulnerable to host confusion via percent-encoded authority delimiters |
| high | [GHSA-5wm8-gmm8-39j9](https://github.com/advisories/GHSA-5wm8-gmm8-39j9) | fast-xml-builder | 1.1.5 | <=1.1.6 | >=1.1.7 | packages/backend (T) | fast-xml-builder allows attribute values with unwanted quotes to bypass malicious or unwanted attributes |
| high | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | image-size | 1.2.1 | >=1.2.0 <=2.0.2 | >=2.0.3 | apps/mobile (T) | image-size: JXL and HEIF parsers allow denial of service through infinite loops |
| high | [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | image-size | 1.2.1 | >=0.6.3 <=2.0.2 | >=2.0.3 | apps/mobile (T) | image-size: ICNS parser allows denial of service through an infinite loop |
| high | [GHSA-qjx8-664m-686j](https://github.com/advisories/GHSA-qjx8-664m-686j) | js-cookie | 3.0.5 | <=3.0.5 | >=3.0.7 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | JavaScript Cookie: Per-instance prototype hijack in assign() enables cookie-attribute injection |
| high | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | js-yaml | 3.14.2 | >=3.0.0 <3.15.2 | >=3.15.2 | apps/mobile (T) | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| high | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | js-yaml | 4.1.0 | >=4.0.0 <4.3.2 | >=4.3.2 | apps/mobile (T) | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| high | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | js-yaml | 4.1.0 | >=4.0.0 <4.3.0 | >=4.3.0 | apps/mobile (T) | js-yaml: YAML merge-key chains can force quadratic CPU consumption |
| high | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | js-yaml | 3.14.2 | >=3.0.0 <3.15.0 | >=3.15.0 | apps/mobile (T) | js-yaml: YAML merge-key chains can force quadratic CPU consumption |
| high | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | js-yaml | 3.14.2 | >=3.0.0 <3.15.1 | >=3.15.1 | apps/mobile (T) | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| high | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | js-yaml | 4.1.0 | >=4.0.0 <4.3.1 | >=4.3.1 | apps/mobile (T) | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| high | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) | lodash | 4.17.21 | >=4.0.0 <=4.17.23 | >=4.18.1 | apps/mobile (T) | lodash vulnerable to Code Injection via `_.template` imports key names |
| high | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | minimatch | 3.1.2 | <3.1.4 | >=3.1.4 | apps/mobile (T) | minimatch ReDoS: nested *() extglobs generate catastrophically backtracking regular expressions |
| high | [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74) | minimatch | 9.0.5 | >=9.0.0 <9.0.7 | >=9.0.7 | apps/mobile (T) | minimatch ReDoS: nested *() extglobs generate catastrophically backtracking regular expressions |
| high | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | minimatch | 3.1.2 | <3.1.3 | >=3.1.3 | apps/mobile (T) | minimatch has a ReDoS via repeated wildcards with non-matching literal in pattern |
| high | [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26) | minimatch | 9.0.5 | >=9.0.0 <9.0.6 | >=9.0.6 | apps/mobile (T) | minimatch has a ReDoS via repeated wildcards with non-matching literal in pattern |
| high | [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | minimatch | 3.1.2 | <3.1.3 | >=3.1.3 | apps/mobile (T) | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| high | [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj) | minimatch | 9.0.5 | >=9.0.0 <9.0.7 | >=9.0.7 | apps/mobile (T) | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| high | [GHSA-28wg-ghj8-5hjv](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) | nanoid | 3.3.11, 3.3.12 | <3.3.16 | >=3.3.16 | apps/admin (T), apps/mobile (T), apps/web (T) | nanoid: non-secure generators can loop indefinitely with negative size |
| high | [GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8) | nanoid | 3.3.11, 3.3.12 | <3.3.18 | >=3.3.18 | apps/admin (T), apps/mobile (T), apps/web (T) | nanoid: custom generators can loop indefinitely when size is zero |
| high | [GHSA-xwg4-73v4-xw9w](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) | nanoid | 3.3.11 | <3.3.12 | >=3.3.12 | apps/admin (T), apps/mobile (T), apps/web (T) | nanoid: Integer Overflow or Wraparound |
| high | [GHSA-267c-6grr-h53f](https://github.com/advisories/GHSA-267c-6grr-h53f) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes |
| high | [GHSA-26hh-7cqf-hhc6](https://github.com/advisories/GHSA-26hh-7cqf-hhc6) | next | 16.0.3 | >=16.0.0 <16.2.6 | >=16.2.6 | apps/admin (D+T), apps/web (D+T) | Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes - Incomplete Fix Follow-Up |
| high | [GHSA-36qx-fr4f-26g5](https://github.com/advisories/GHSA-36qx-fr4f-26g5) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n |
| high | [GHSA-492v-c6pp-mqqv](https://github.com/advisories/GHSA-492v-c6pp-mqqv) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js has a Middleware / Proxy bypass through dynamic route parameter injection |
| high | [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Middleware / Proxy bypass in App Router applications using Turbopack and single locale |
| high | [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Server-Side Request Forgery in Server Actions on custom servers |
| high | [GHSA-8h8q-6873-q5fj](https://github.com/advisories/GHSA-8h8q-6873-q5fj) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js Vulnerable to Denial of Service with Server Components |
| high | [GHSA-c4j6-fc7j-m34r](https://github.com/advisories/GHSA-c4j6-fc7j-m34r) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades |
| high | [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) | next | 16.0.3 | >=16.0.0 <16.3.8 | >=16.3.8 | apps/admin (D+T), apps/web (D+T) | Next.js has Server-Side Request Forgery in Image Optimization |
| high | [GHSA-h25m-26qc-wcjf](https://github.com/advisories/GHSA-h25m-26qc-wcjf) | next | 16.0.3 | >=16.0.0-beta.0 <16.0.11 | >=16.0.11 | apps/admin (D+T), apps/web (D+T) | Next.js HTTP request deserialization can lead to DoS when using insecure React Server Components |
| high | [GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Denial of Service in App Router using Server Actions |
| high | [GHSA-mg66-mrh9-m8jx](https://github.com/advisories/GHSA-mg66-mrh9-m8jx) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js vulnerable to Denial of Service via connection exhaustion in applications using Cache Components |
| high | [GHSA-mwv6-3258-q52c](https://github.com/advisories/GHSA-mwv6-3258-q52c) | next | 16.0.3 | >=16.0.0-beta.0 <16.0.9 | >=16.0.10 | apps/admin (D+T), apps/web (D+T) | Next Vulnerable to Denial of Service with Server Components |
| high | [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) | next | 16.0.3 | >=16.0.0 <=16.4.0 | >=16.4.1 | apps/admin (D+T), apps/web (D+T) | Next.js: Denial of Service in App Router using Server Actions |
| high | [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Server-Side Request Forgery in rewrites via attacker-controlled destination hostname |
| high | [GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) | next | 16.0.3 | >=16.0.0-beta.0 <16.2.3 | >=16.2.3 | apps/admin (D+T), apps/web (D+T) | Next.js has a Denial of Service with Server Components |
| high | [GHSA-5x38-2vff-x55p](https://github.com/advisories/GHSA-5x38-2vff-x55p) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: X.509 basicConstraints bypass in verifyCertificateChain() via deprecated extension OIDs 2.5.29.10 and 2.5.29.13 |
| high | [GHSA-7wch-p9px-956x](https://github.com/advisories/GHSA-7wch-p9px-956x) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: Regular expression denial of service in PEM decoding (pem.decode) |
| high | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements |
| high | [GHSA-8hrf-8g6f-7xwp](https://github.com/advisories/GHSA-8hrf-8g6f-7xwp) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: Denial of service in TLS record processing via a record interleaved with a fragmented handshake message |
| high | [GHSA-hqq3-7jhf-c5jx](https://github.com/advisories/GHSA-hqq3-7jhf-c5jx) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: Denial of service in TLS record processing via call stack exhaustion |
| high | [GHSA-jc66-7q78-782g](https://github.com/advisories/GHSA-jc66-7q78-782g) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: PKCS#12 MAC forgery and constant-key PBE via zero iteration count |
| high | [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | picomatch | 2.3.1 | <2.3.2 | >=2.3.2 | apps/mobile (T) | Picomatch has a ReDoS vulnerability via extglob quantifiers |
| high | [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | picomatch | 3.0.1 | >=3.0.0 <3.0.2 | >=3.0.2 | apps/mobile (T) | Picomatch has a ReDoS vulnerability via extglob quantifiers |
| high | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) | postcss | 8.4.31, 8.4.49 | <=8.5.11 | >=8.5.12 | apps/admin (T), apps/mobile (T), apps/web (T) | PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments |
| high | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | postcss | 8.4.31, 8.4.49, 8.5.14 | <=8.5.17 | >=8.5.18 | apps/admin (T), apps/mobile (T), apps/web (T) | PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure |
| high | [GHSA-36hm-qxxp-pg3m](https://github.com/advisories/GHSA-36hm-qxxp-pg3m) | preact | 10.28.0 | >=10.28.0 <10.28.2 | >=10.28.2 | apps/mobile (T) | Preact has JSON VNode Injection issue |
| high | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) | sharp | 0.34.5 | <0.35.0 | >=0.35.0 | apps/admin (T), apps/web (T) | sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 |
| high | [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) | sharp | 0.34.5 | <0.35.4 | >=0.35.4 | apps/admin (T), apps/web (T) | sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 |
| high | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | sharp | 0.34.5 | <0.35.5 | >=0.35.5 | apps/admin (T), apps/web (T) | sharp : Vulnerability in librsvg dependency CVE-2026-96889 |
| high | [GHSA-395f-4hp3-45gv](https://github.com/advisories/GHSA-395f-4hp3-45gv) | shell-quote | 1.8.3 | <=1.8.4 | >=1.9.0 | apps/mobile (T) | shell-quote: Quadratic-complexity Denial of Service in `parse()` (CWE-407) |
| high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | source-map-js | 1.2.1 | >=1.0.0 <1.2.2 | >=1.2.2 | apps/admin (T), apps/mobile (T), apps/web (T) | source-map-js allows event-loop denial of service through indexed source-map section offsets |
| high | [GHSA-34x7-hfp2-rc4v](https://github.com/advisories/GHSA-34x7-hfp2-rc4v) | tar | 7.5.2 | <7.5.7 | >=7.5.8 | apps/mobile (T) | node-tar Vulnerable to Arbitrary File Creation/Overwrite via Hardlink Path Traversal |
| high | [GHSA-83g3-92jg-28cx](https://github.com/advisories/GHSA-83g3-92jg-28cx) | tar | 7.5.2 | <7.5.8 | >=7.5.8 | apps/mobile (T) | Arbitrary File Read/Write via Hardlink Target Escape Through Symlink Chain in node-tar Extraction |
| high | [GHSA-8qq5-rm4j-mr97](https://github.com/advisories/GHSA-8qq5-rm4j-mr97) | tar | 7.5.2 | <=7.5.2 | >=7.5.8 | apps/mobile (T) | node-tar is Vulnerable to Arbitrary File Overwrite and Symlink Poisoning via Insufficient Path Sanitization |
| high | [GHSA-8x88-c5mf-7j5w](https://github.com/advisories/GHSA-8x88-c5mf-7j5w) | tar | 7.5.2 | <=7.5.17 | >=7.5.18 | apps/mobile (T) | node-tar: Negative tar entry size causes infinite loop in archive replace |
| high | [GHSA-9ppj-qmqm-q256](https://github.com/advisories/GHSA-9ppj-qmqm-q256) | tar | 7.5.2 | <=7.5.10 | >=7.5.11 | apps/mobile (T) | node-tar Symlink Path Traversal via Drive-Relative Linkpath |
| high | [GHSA-qffp-2rhf-9h96](https://github.com/advisories/GHSA-qffp-2rhf-9h96) | tar | 7.5.2 | <=7.5.9 | >=7.5.10 | apps/mobile (T) | tar has Hardlink Path Traversal via Drive-Relative Linkpath |
| high | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m) | tar | 7.5.2 | <=7.5.20 | >=7.5.21 | apps/mobile (T) | node-tar: Uncontrolled recursion in mapHas/filesFilter allows uncatchable stack-overflow DoS via crafted long-path tar with member selection |
| high | [GHSA-r6q2-hw4h-h46w](https://github.com/advisories/GHSA-r6q2-hw4h-h46w) | tar | 7.5.2 | <=7.5.3 | >=7.5.8 | apps/mobile (T) | Race Condition in node-tar Path Reservations via Unicode Ligature Collisions on macOS APFS |
| high | [GHSA-2m5v-pch6-74hx](https://github.com/advisories/GHSA-2m5v-pch6-74hx) | undici | 6.22.0 | >=4.0.0 <6.29.1 | >=6.29.1 | apps/mobile (T) | undici vulnerable to TLS certificate validation bypass via dropped tls options in Agent |
| high | [GHSA-f269-vfmq-vjvj](https://github.com/advisories/GHSA-f269-vfmq-vjvj) | undici | 6.22.0 | >=6.0.0 <6.24.0 | >=6.24.0 | apps/mobile (T) | Undici: Malicious WebSocket 64-bit length overflows parser and crashes the client |
| high | [GHSA-qrxm-fqhp-jwvm](https://github.com/advisories/GHSA-qrxm-fqhp-jwvm) | undici | 6.22.0 | >=4.2.1 <6.29.1 | >=6.29.1 | apps/mobile (T) | undici vulnerable to Denial of Service via TLS 1.2 certificate-changing renegotiation |
| high | [GHSA-rfgv-xxqx-mfg5](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5) | undici | 6.22.0 | >=6.7.0 <6.28.1 | >=6.28.1 | apps/mobile (T) | undici vulnerable to Denial of Service via unrequested WebSocket subprotocol |
| high | [GHSA-v9p9-hfj2-hcw8](https://github.com/advisories/GHSA-v9p9-hfj2-hcw8) | undici | 6.22.0 | <6.24.0 | >=6.24.0 | apps/mobile (T) | Undici has Unhandled Exception in WebSocket Client Due to Invalid server_max_window_bits Validation |
| high | [GHSA-vrm6-8vpv-qv8q](https://github.com/advisories/GHSA-vrm6-8vpv-qv8q) | undici | 6.22.0 | <6.24.0 | >=6.24.0 | apps/mobile (T) | Undici has Unbounded Memory Consumption in WebSocket permessage-deflate Decompression |
| high | [GHSA-vxpw-j846-p89q](https://github.com/advisories/GHSA-vxpw-j846-p89q) | undici | 6.22.0 | <6.27.0 | >=6.27.0 | apps/mobile (T) | undici WebSocket client vulnerable to denial of service via fragment count bypass |
| high | [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | ws | 8.18.0, 8.18.3 | >=8.0.0 <8.21.0 | >=8.21.0 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | ws: Memory exhaustion DoS from tiny fragments and data chunks |
| high | [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | ws | 7.5.10 | >=7.0.0 <7.5.11 | >=7.5.11 | apps/mobile (T) | ws: Memory exhaustion DoS from tiny fragments and data chunks |
| high | [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | ws | 6.2.3 | >=6.0.0 <6.2.4 | >=6.2.4 | apps/mobile (T) | ws: Memory exhaustion DoS from tiny fragments and data chunks |
| high | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | zod | 3.25.76 | <4.6.6 | >=4.6.6 | apps/admin (D), apps/mobile (T), packages/user-settings (D) | Zod can exhaust memory while validating oversized constrained collections |

### Moderate (68 records)

| Severity | Advisory | Package | Installed version(s) | Vulnerable range | Patched range | Affected workspaces (D=direct, T=transitive) | Advisory title |
|---|---|---|---|---|---|---|---|
| moderate | [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | @opentelemetry/core | 2.6.1 | <2.8.0 | >=2.8.0 | apps/admin (T), apps/web (T), packages/backend (T) | OpenTelemetry Core: Unbounded memory allocation in W3C Baggage propagation |
| moderate | [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) | @opentelemetry/instrumentation-knex | 0.58.0 | <0.65.0 | >=0.65.0 | apps/admin (T), apps/web (T), packages/backend (T) | Multiple @opentelemetry/instrumentation-* packages expose database username via unconditional db.user span attribute |
| moderate | [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) | @opentelemetry/instrumentation-mongoose | 0.60.0 | <0.67.0 | >=0.67.0 | apps/admin (T), apps/web (T), packages/backend (T) | Multiple @opentelemetry/instrumentation-* packages expose database username via unconditional db.user span attribute |
| moderate | [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) | @opentelemetry/instrumentation-mysql | 0.60.0 | <0.67.0 | >=0.67.0 | apps/admin (T), apps/web (T), packages/backend (T) | Multiple @opentelemetry/instrumentation-* packages expose database username via unconditional db.user span attribute |
| moderate | [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) | @opentelemetry/instrumentation-mysql2 | 0.60.0 | <0.67.0 | >=0.67.0 | apps/admin (T), apps/web (T), packages/backend (T) | Multiple @opentelemetry/instrumentation-* packages expose database username via unconditional db.user span attribute |
| moderate | [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) | @opentelemetry/instrumentation-pg | 0.66.0 | <0.73.0 | >=0.73.0 | apps/admin (T), apps/web (T), packages/backend (T) | Multiple @opentelemetry/instrumentation-* packages expose database username via unconditional db.user span attribute |
| moderate | [GHSA-qqmp-wf37-98f9](https://github.com/advisories/GHSA-qqmp-wf37-98f9) | @opentelemetry/instrumentation-tedious | 0.33.0 | <0.40.0 | >=0.40.0 | apps/admin (T), apps/web (T), packages/backend (T) | Multiple @opentelemetry/instrumentation-* packages expose database username via unconditional db.user span attribute |
| moderate | [GHSA-6gmq-8vp8-gcm6](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: XML fragment injection via invalid EntityReference.nodeName during requireWellFormed serialization |
| moderate | [GHSA-6h8r-xr42-gp59](https://github.com/advisories/GHSA-6h8r-xr42-gp59) | @xmldom/xmldom | 0.7.13, 0.8.11 | >=0.7.0 <=0.8.14 | >=0.8.15 | apps/mobile (T) | xmldom: Parser silently accepts a not-well-formed end tag whose name is followed by a line break and trailing content |
| moderate | [GHSA-f886-m6hf-6m8v](https://github.com/advisories/GHSA-f886-m6hf-6m8v) | brace-expansion | 1.1.12 | <1.1.13 | >=1.1.13 | apps/mobile (T) | brace-expansion: Zero-step sequence causes process hang and memory exhaustion |
| moderate | [GHSA-f886-m6hf-6m8v](https://github.com/advisories/GHSA-f886-m6hf-6m8v) | brace-expansion | 2.0.2 | >=2.0.0 <2.0.3 | >=2.0.3 | apps/mobile (T) | brace-expansion: Zero-step sequence causes process hang and memory exhaustion |
| moderate | [GHSA-jxxr-4gwj-5jf2](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2) | brace-expansion | 5.0.5 | >=5.0.0 <5.0.6 | >=5.0.6 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: Large numeric range defeats documented `max` DoS protection |
| moderate | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | brace-expansion | 1.1.12 | <1.1.21 | >=1.1.21 | apps/mobile (T) | brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service |
| moderate | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | brace-expansion | 2.0.2 | >=2.0.0 <2.1.7 | >=2.1.7 | apps/mobile (T) | brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service |
| moderate | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | brace-expansion | 5.0.5 | >=4.0.0 <5.0.12 | >=5.0.12 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | brace-expansion: Quadratic-time expansion of the `{a},b}` rewrite causes CPU denial of service |
| moderate | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | decode-uri-component | 0.2.2 | <=0.4.2 | >=0.5.0 | apps/mobile (T) | decode-uri-component: Denial of service via exponential decoding of malformed percent-encoded input |
| moderate | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.8 | >=3.1.8 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to inconsistent host case normalization via percent-encoded octets |
| moderate | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.9 | >=3.1.9 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding |
| moderate | [GHSA-45c6-75p6-83cc](https://github.com/advisories/GHSA-45c6-75p6-83cc) | fast-xml-builder | 1.1.5 | =1.1.5 | none reported | packages/backend (T) | fast-xml-builder Comment Value regex can be bypassed |
| moderate | [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) | fast-xml-parser | 5.5.8 | <5.7.0 | >=5.7.0 | packages/backend (T) | fast-xml-parser XMLBuilder: XML Comment and CDATA Injection via Unescaped Delimiters |
| moderate | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob | 13.0.6 | >=9.0.0 <=14.0.1 | >=14.0.2 | apps/admin (T), apps/mobile (T), apps/web (T) | Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal |
| moderate | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) | js-yaml | 3.14.2 | <3.15.0 | >=3.15.0 | apps/mobile (T) | JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases |
| moderate | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) | js-yaml | 4.1.0 | >=4.0.0 <=4.1.1 | >=4.2.0 | apps/mobile (T) | JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases |
| moderate | [GHSA-mh29-5h37-fv8m](https://github.com/advisories/GHSA-mh29-5h37-fv8m) | js-yaml | 4.1.0 | >=4.0.0 <4.1.1 | >=4.1.1 | apps/mobile (T) | js-yaml has prototype pollution in merge (<<) |
| moderate | [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | lodash | 4.17.21 | >=4.0.0 <=4.17.22 | >=4.17.23 | apps/mobile (T) | Lodash has Prototype Pollution Vulnerability in `_.unset`, `_.omit`, and `_.pullAt` functions |
| moderate | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch | 10.2.5, 9.0.5 | >=7.0.0 <11.0.1 | >=11.0.1 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | minimatch has potential denial of service via globparts amplification |
| moderate | [GHSA-3x4c-7xq6-9pq8](https://github.com/advisories/GHSA-3x4c-7xq6-9pq8) | next | 16.0.3 | >=16.0.0-beta.0 <16.1.7 | >=16.1.7 | apps/admin (D+T), apps/web (D+T) | Next.js: Unbounded next/image disk cache growth can exhaust storage |
| moderate | [GHSA-4633-3j49-mh5q](https://github.com/advisories/GHSA-4633-3j49-mh5q) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Cache confusion of response bodies for requests with bodies containing invalid UTF-8 byte sequences |
| moderate | [GHSA-4c39-4ccg-62r3](https://github.com/advisories/GHSA-4c39-4ccg-62r3) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Unbounded Server Action payload in Edge runtime |
| moderate | [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676) | next | 16.0.3 | >=16.0.0 <16.3.8 | >=16.3.8 | apps/admin (D+T), apps/web (D+T) | Next.js has cache poisoning of SSG and ISR pages in self-hosted applications |
| moderate | [GHSA-5f7q-jpqc-wp7h](https://github.com/advisories/GHSA-5f7q-jpqc-wp7h) | next | 16.0.3 | >=16.0.0-beta.0 <16.1.5 | >=16.1.5 | apps/admin (D+T), apps/web (D+T) | Next.js has Unbounded Memory Consumption via PPR Resume Endpoint  |
| moderate | [GHSA-68g3-v927-f742](https://github.com/advisories/GHSA-68g3-v927-f742) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Cache confusion of response bodies for requests with bodies |
| moderate | [GHSA-955p-x3mx-jcvp](https://github.com/advisories/GHSA-955p-x3mx-jcvp) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Unauthenticated disclosure of internal Server Function endpoints |
| moderate | [GHSA-9g9p-9gw9-jx7f](https://github.com/advisories/GHSA-9g9p-9gw9-jx7f) | next | 16.0.3 | >=15.6.0-canary.0 <16.1.5 | >=16.1.5 | apps/admin (D+T), apps/web (D+T) | Next.js self-hosted applications vulnerable to DoS via Image Optimizer remotePatterns configuration |
| moderate | [GHSA-f87g-xv8r-7p7x](https://github.com/advisories/GHSA-f87g-xv8r-7p7x) | next | 16.0.3 | >=16.0.0 <16.3.8 | >=16.3.8 | apps/admin (D+T), apps/web (D+T) | Next.js has information disclosure in App Router metadata image routes via dynamicParams bypass |
| moderate | [GHSA-ffhc-5mcf-pf4q](https://github.com/advisories/GHSA-ffhc-5mcf-pf4q) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js vulnerable to cross-site scripting in App Router applications using CSP nonces |
| moderate | [GHSA-ggv3-7p47-pfv8](https://github.com/advisories/GHSA-ggv3-7p47-pfv8) | next | 16.0.3 | >=16.0.0-beta.0 <16.1.7 | >=16.1.7 | apps/admin (D+T), apps/web (D+T) | Next.js: HTTP request smuggling in rewrites |
| moderate | [GHSA-gx5p-jg67-6x7h](https://github.com/advisories/GHSA-gx5p-jg67-6x7h) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js has cross-site scripting in beforeInteractive scripts with untrusted input |
| moderate | [GHSA-h27x-g6w4-24gq](https://github.com/advisories/GHSA-h27x-g6w4-24gq) | next | 16.0.3 | >=16.0.1 <16.1.7 | >=16.1.7 | apps/admin (D+T), apps/web (D+T) | Next.js: Unbounded postponed resume buffering can lead to DoS |
| moderate | [GHSA-h64f-5h5j-jqjh](https://github.com/advisories/GHSA-h64f-5h5j-jqjh) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js has a Denial of Service in the Image Optimization API |
| moderate | [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p) | next | 16.0.3 | >=16.0.0 <16.3.8 | >=16.3.8 | apps/admin (D+T), apps/web (D+T) | Next.js has cache poisoning in SSG/ISR rendering that leads to cross-user content substitution and persistent denial of service |
| moderate | [GHSA-mq59-m269-xvcx](https://github.com/advisories/GHSA-mq59-m269-xvcx) | next | 16.0.3 | >=16.0.1 <16.1.7 | >=16.1.7 | apps/admin (D+T), apps/web (D+T) | Next.js: null origin can bypass Server Actions CSRF checks |
| moderate | [GHSA-q8wf-6r8g-63ch](https://github.com/advisories/GHSA-q8wf-6r8g-63ch) | next | 16.0.3 | >=16.0.0 <16.2.11 | >=16.2.11 | apps/admin (D+T), apps/web (D+T) | Next.js: Denial of Service in the Image Optimization API using SVGs |
| moderate | [GHSA-w37m-7fhw-fmv9](https://github.com/advisories/GHSA-w37m-7fhw-fmv9) | next | 16.0.3 | >=16.0.0-beta.0 <16.0.9 | >=16.0.10 | apps/admin (D+T), apps/web (D+T) | Next Server Actions Source Code Exposure  |
| moderate | [GHSA-wfc6-r584-vfw7](https://github.com/advisories/GHSA-wfc6-r584-vfw7) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js vulnerable to cache poisoning in React Server Component responses |
| moderate | [GHSA-525v-9gp9-w22h](https://github.com/advisories/GHSA-525v-9gp9-w22h) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: TLS client crash when the server sends no certificate |
| moderate | [GHSA-5cwg-6vw7-rj6p](https://github.com/advisories/GHSA-5cwg-6vw7-rj6p) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: AES-GCM authentication bypass via unvalidated tagLength option |
| moderate | [GHSA-6wvx-3r32-xmcg](https://github.com/advisories/GHSA-6wvx-3r32-xmcg) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: Prototype Pollution in forge.http cookie handling via a malicious Set-Cookie |
| moderate | [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) | picomatch | 2.3.1 | <2.3.2 | >=2.3.2 | apps/mobile (T) | Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching |
| moderate | [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) | picomatch | 3.0.1 | >=3.0.0 <3.0.2 | >=3.0.2 | apps/mobile (T) | Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching |
| moderate | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) | postcss | 8.4.31, 8.4.49, 8.5.14 | <=8.5.22 | >=8.5.23 | apps/admin (T), apps/mobile (T), apps/web (T) | PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset |
| moderate | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | postcss | 8.4.31, 8.4.49 | <8.5.10 | >=8.5.10 | apps/admin (T), apps/mobile (T), apps/web (T) | PostCSS has XSS via Unescaped </style> in its CSS Stringify Output |
| moderate | [GHSA-gvwx-54wh-qm9j](https://github.com/advisories/GHSA-gvwx-54wh-qm9j) | tar | 7.5.2 | <=7.5.16 | >=7.5.17 | apps/mobile (T) | node-tar: Uncaught Exception DoS via NUL byte in PAX path/linkpath records |
| moderate | [GHSA-vmf3-w455-68vh](https://github.com/advisories/GHSA-vmf3-w455-68vh) | tar | 7.5.2 | <=7.5.15 | >=7.5.16 | apps/mobile (T) | node-tar applies PAX size override to intermediary GNU long-name/long-link headers, causing tar parser interpretation differential (file smuggling) |
| moderate | [GHSA-w8wr-v893-vjvp](https://github.com/advisories/GHSA-w8wr-v893-vjvp) | tar | 7.5.2 | <=7.5.17 | >=7.5.18 | apps/mobile (T) | node-tar: Process crash via PAX numeric path type confusion |
| moderate | [GHSA-2mjp-6q6p-2qxm](https://github.com/advisories/GHSA-2mjp-6q6p-2qxm) | undici | 6.22.0 | <6.24.0 | >=6.24.0 | apps/mobile (T) | Undici has an HTTP Request/Response Smuggling issue |
| moderate | [GHSA-4992-7rv2-5pvq](https://github.com/advisories/GHSA-4992-7rv2-5pvq) | undici | 6.22.0 | <6.24.0 | >=6.24.0 | apps/mobile (T) | Undici has CRLF Injection in undici via `upgrade` option |
| moderate | [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685) | undici | 6.22.0 | >=6.5.0 <6.29.1 | >=6.29.1 | apps/mobile (T) | undici vulnerable to Denial of Service via unbounded memory in the EventSource parser |
| moderate | [GHSA-8xcm-r25x-g524](https://github.com/advisories/GHSA-8xcm-r25x-g524) | undici | 6.22.0 | <6.28.0 | >=6.28.0 | apps/mobile (T) | undici vulnerable to downstream response desynchronization via retry interceptor |
| moderate | [GHSA-9fm3-97px-rjf6](https://github.com/advisories/GHSA-9fm3-97px-rjf6) | undici | 6.22.0 | >=5.15.0 <6.29.1 | >=6.29.1 | apps/mobile (T) | undici WebSocket client vulnerable to Denial of Service via unbounded automatic PONG buffering |
| moderate | [GHSA-g9mf-h72j-4rw9](https://github.com/advisories/GHSA-g9mf-h72j-4rw9) | undici | 6.22.0 | <6.23.0 | >=6.23.0 | apps/mobile (T) | Undici has an unbounded decompression chain in HTTP responses on Node.js Fetch API via Content-Encoding leads to resource exhaustion |
| moderate | [GHSA-m8rv-5g2x-5cg5](https://github.com/advisories/GHSA-m8rv-5g2x-5cg5) | undici | 6.22.0 | <6.28.0 | >=6.28.0 | apps/mobile (T) | undici vulnerable to CRLF Injection via blob-like body 'type' property |
| moderate | [GHSA-p88m-4jfj-68fv](https://github.com/advisories/GHSA-p88m-4jfj-68fv) | undici | 6.22.0 | <6.27.0 | >=6.27.0 | apps/mobile (T) | undici vulnerable to HTTP header injection via Set-Cookie percent-decoding |
| moderate | [GHSA-v3r7-h72x-cjcm](https://github.com/advisories/GHSA-v3r7-h72x-cjcm) | undici | 6.22.0 | <6.28.0 | >=6.28.0 | apps/mobile (T) | undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields |
| moderate | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | uuid | 10.0.0, 7.0.3, 9.0.1 | <11.1.1 | >=11.1.1 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided |
| moderate | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) | ws | 8.18.0, 8.18.3 | >=8.0.0 <8.20.1 | >=8.20.1 | apps/admin (T), apps/mobile (T), apps/web (T), packages/backend (T) | ws: Uninitialized memory disclosure |
| moderate | [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) | yaml | 1.10.2 | >=1.0.0 <1.10.3 | >=1.10.3 | apps/mobile (T), apps/web (T) | yaml is vulnerable to Stack Overflow via deeply nested YAML collections |
| moderate | [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) | yaml | 2.8.1 | >=2.0.0 <2.8.3 | >=2.8.3 | apps/mobile (T) | yaml is vulnerable to Stack Overflow via deeply nested YAML collections |

### Low (14 records)

| Severity | Advisory | Package | Installed version(s) | Vulnerable range | Patched range | Affected workspaces (D=direct, T=transitive) | Advisory title |
|---|---|---|---|---|---|---|---|
| low | [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8) | @babel/core | 7.28.5, 7.29.0 | <=7.29.0 | >=7.29.6 | apps/admin (T), apps/mobile (T), apps/web (T) | @babel/core: Arbitrary File Read via sourceMappingURL Comment |
| low | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | deepmerge | 4.3.1 | >=4.2.0 <=4.3.1 | none reported | apps/mobile (T) | deepmerge mergeObject() allows prototype poisoning of returned objects |
| low | [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.9 | >=3.1.9 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references |
| low | [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) | fast-uri | 3.1.0, 3.1.2 | >=3.0.0 <3.1.9 | >=3.1.9 | apps/admin (T), apps/mobile (T), apps/web (T) | fast-uri vulnerable to improper path equivalence in relative reference normalization |
| low | [GHSA-39w2-rjm5-chcv](https://github.com/advisories/GHSA-39w2-rjm5-chcv) | next | 16.0.3 | >=16.0.0 <16.3.8 | >=16.3.8 | apps/admin (D+T), apps/web (D+T) | Next.js has information disclosure in development server's Model Context Protocol endpoint |
| low | [GHSA-3g8h-86w9-wvmq](https://github.com/advisories/GHSA-3g8h-86w9-wvmq) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js's Middleware / Proxy redirects can be cache-poisoned |
| low | [GHSA-jcc7-9wpm-mj36](https://github.com/advisories/GHSA-jcc7-9wpm-mj36) | next | 16.0.3 | >=16.0.1 <16.1.7 | >=16.1.7 | apps/admin (D+T), apps/web (D+T) | Next.js: null origin can bypass dev HMR websocket CSRF checks |
| low | [GHSA-vfv6-92ff-j949](https://github.com/advisories/GHSA-vfv6-92ff-j949) | next | 16.0.3 | >=16.0.0 <16.2.5 | >=16.2.5 | apps/admin (D+T), apps/web (D+T) | Next.js vulnerable to cache poisoning via collisions in React Server Component cache-busting |
| low | [GHSA-4487-j8r4-4g2f](https://github.com/advisories/GHSA-4487-j8r4-4g2f) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: verifyCertificateChain() removes trusted CA certificates with the same subject from the CA store |
| low | [GHSA-4642-5mcj-2rqw](https://github.com/advisories/GHSA-4642-5mcj-2rqw) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: ASN.1 OID first arc truncation in asn1.oidToDer |
| low | [GHSA-h6cr-wjv9-3cpp](https://github.com/advisories/GHSA-h6cr-wjv9-3cpp) | node-forge | 1.4.0 | <=1.4.0 | >=1.4.1 | apps/mobile (T) | Forge: Denial of Service via infinite loop in BigInteger.modInverse() with negative input (incomplete fix of CVE-2026-33891) |
| low | [GHSA-35p6-xmwp-9g52](https://github.com/advisories/GHSA-35p6-xmwp-9g52) | undici | 6.22.0 | <6.27.0 | >=6.27.0 | apps/mobile (T) | undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse |
| low | [GHSA-g8m3-5g58-fq7m](https://github.com/advisories/GHSA-g8m3-5g58-fq7m) | undici | 6.22.0 | <6.27.0 | >=6.27.0 | apps/mobile (T) | undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching |
| low | [GHSA-r53p-7pc4-xj5r](https://github.com/advisories/GHSA-r53p-7pc4-xj5r) | undici | 6.22.0 | <6.28.1 | >=6.28.1 | apps/mobile (T) | undici vulnerable to downstream response splitting via retry interceptor |
