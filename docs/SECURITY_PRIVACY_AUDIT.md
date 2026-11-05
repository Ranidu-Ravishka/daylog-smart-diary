# DayLog Security, Privacy & Production Readiness Audit

**Status:** Source-level backend verification and focused synthetic regression testing completed. Deployed-provider settings and production operations remain unverified.

## Executive assessment

The source review found effective server-side identity and ownership patterns across the main user data paths, and synthetic behavior tests cover selected cross-user reads, exports, and restore ownership. No production data or live third-party account was accessed. The source review is not an end-to-end authorization proof for every function or a security certification.

One previously identified high-severity developer-workstation risk in an optional generated skill was remediated: the skill no longer instructs users to execute remote code directly in a shell. The canonical generator/source for that skill was not found, so regeneration could reintroduce the unsafe instruction.

This follow-up removed prompt/output copies from new AI quality events, added a resumable legacy-event redaction, introduced provider-aware OAuth revocation tracking, and retained export references when storage cleanup fails. Account deletion queues supported OAuth revocations and now fails visibly/retryably on storage errors. Google revocation is attempted asynchronously; Spotify revocation is unsupported and must be completed by the user at Spotify. Production configuration, provider behavior, backups, and live two-account authorization remain unverified.

**Readiness:** Suitable only for a controlled beta in a verified isolated environment, with the remaining risks below accepted and users accurately informed. Public release should wait for provider revocation/deletion handling, AI data-retention decisions, production configuration verification, and operational recovery evidence. No GDPR or other legal compliance claim is made.

## Architecture and trust boundaries

| Flow | Data crossing the boundary | Source evidence and limitations |
|---|---|---|
| Web/mobile → Clerk → Convex | Clerk subject/JWT and account identity | Web route middleware and Convex `requireUser` checks are present. Deployed issuer, audience, session duration, revocation and Clerk environment pairing were not inspected. |
| Web/mobile → Convex database | Diary text, mood, day metadata, settings, media and integration context | Public functions generally derive the owner from authenticated identity and use owner-scoped indexes/checks. Convex internal functions are not client-callable, but any internal caller remains trusted code. |
| Convex → OpenAI | Diary memory text, day metadata, selected integration context/metrics, generated responses and server credential | Calls occur in backend actions using server environment configuration. A request was not made during this audit. OpenAI account retention/training configuration was not inspected. |
| Web OAuth callback → provider → Convex | Authorization code, provider tokens/scopes and one-time mobile handoff | Web routes validate state and web-account match; Convex stores OAuth secrets in encrypted envelopes. No external account or provider call was used for this audit. Provider-side revocation is absent from the reviewed disconnect/deletion paths. |
| User → export/restore → Convex storage | Diary archive, signed JSON backup, restore payload and signed download URL | Export and restore actions derive identity from Convex auth and use owner-scoped data queries. Storage access URL expiry and hosting-level retention are not independently verified. |
| Mobile device → Convex | Optional rounded location stay/movement context and, on supported Android devices, aggregated call count/duration | Both features require explicit opt-in and applicable permissions/settings; background location is also runtime-policy gated. Device/OS behavior was not tested as part of this source audit. |
| Developer tooling → local shell | Source tree and developer environment | Optional generated skill had an unsafe remote-to-shell command; the checked-in instruction is remediated, but upstream regeneration risk remains. |

## Sensitive-data inventory

| Data | Storage/processing | Access boundary | Retention and deletion evidence |
|---|---|---|---|
| Memory title, description and mood | Convex `memories`; sensitive fields use the sensitive-data envelope helpers | Authenticated owner-scoped functions; authorized internal code | Account cascade deletes records and associated media. Routine retention is configurable; backups/provider copies are outside this source review. |
| Daily notes, tags and ratings | Convex `days`; sensitive fields use the sensitive-data helpers | Authenticated owner-scoped functions | Included in account cascade and export/restore. Retention values are environment/admin-configurable. |
| Summaries and integration daily context | Convex `daySummaries` and `integrationDailyData`; sensitive fields use encrypted helpers | Owner-scoped access | Included in cascade and retention cleanup. Selected context is sent to OpenAI during generation. |
| AI generation events | Convex `summaryGenerationEvents`; new rows retain input byte count, normalized outcome and quality metadata, not prompt/output text | Internal writes; admin quality surfaces are separately authorized | Daily resumable migration redacts legacy prompt/output/source/error fields; account cascade and configurable event retention also apply. |
| AI attempt metadata | Convex `aiSummaryAttempts`, with quality flags and normalized failure metadata; legacy prompt-derived FNV-1a `inputHash` is not used by current writes or returned by the admin query | Internal writes; chain queries require admin | A backward-compatible optional validator accepts existing hashes while a resumable scheduled migration removes them; account cascade and configurable 60-day retention also apply. New writes do not persist hashes or raw output summaries. |
| Derived analytics/recommendations | Convex `dailyFeatureVectors` and `nextBestDayRecommendations`; vectors include mood/activity/health-derived metrics and recommendations | Authenticated owner-scoped reads; internal writes | Account cascade and configurable 90-day default retention policies are implemented. |
| Integration tokens | Convex `integrationSecrets`, AES-256-GCM encrypted token envelopes | Internal secret-read/write functions, tied to owner/provider/token reference | Google revocation jobs retain the secret only until terminal result; Spotify secrets are removed locally, with remote revocation unsupported. Job metadata expires after 30 days. |
| Export artifacts/jobs | Convex Storage plus `exportJobs` | Export job owner checks and signed storage URL | Retention and deletion preserve artifact references when storage deletion fails; retries occur on subsequent cleanup runs. Historical storage orphans without a database reference cannot be safely enumerated by the reviewed code. |
| Restore/deletion jobs | Convex `restoreJobs` and `userDeletionJobs` | Authenticated owner queries; internal mutation writes | Configurable retention cleanup exists. Deletion jobs retain identifiers/progress until that cleanup runs. |
| OAuth handoffs | Convex `oauthMobileHandoffs` with short-lived single-use opaque codes | Authenticated issue; internal consume; provider-scoped and expiry checked | Purged after expiry and by account cascade. Callback credential persistence now rejects accounts with active deletion. |
| Location and call context | Device-side encrypted background queue, then per-day context in Convex | Explicit feature consent/settings, OS permission, and background runtime flag | Local queue and backend retention behavior are governed separately; there is no verified end-to-end retention SLA in this audit. |

## Findings and remediation status

### HIGH — Optional developer skill allowed remote shell execution — remediated; regeneration risk remains

- **Evidence:** `packages/backend/.agents/skills/convex-improve-convex-plugin/SKILL.md` previously directed a `curl | bash`-style operation.
- **Impact:** A user following the instruction could execute remote-controlled code with local developer privileges.
- **Fix:** The checked-in skill now permits only an already-present, trusted and reviewed local helper and stops if none is available. No remote code was fetched or run.
- **Remaining risk:** The skill identifies itself as generated, but no canonical source/generator was found in repository configuration or local documentation. Correct the upstream source when identified; until then, preserve this checked-in patch and include the pattern in regeneration review.
- **Status/confidence:** Closed in the checked-in file; upstream regeneration risk remains. High, 8/10.

### MEDIUM — OAuth callback could recreate credentials during account deletion — fixed

- **Evidence:** `integrations.ts`'s internal `connectIntegrationWithOAuthTokensInternal` previously passed client/callback-resolved `userId` directly to credential persistence. The deletion cascade removes integrations and secrets before the final `oauthMobileHandoffs` stage (`cascadeCleanup.ts`). The Clerk OAuth callback and mobile handoff paths call this internal mutation (`oauthConnect.ts`). Normal public functions use `requireUser`, which blocks deletion-requested accounts, but this internal persistence path did not.
- **Impact:** A callback arriving after the integration/secret cleanup stage could recreate provider credentials that the already-advanced cascade would not revisit. The later Clerk deletion webhook removes the tombstone but does not re-run the completed cascade.
- **Fix:** Added a guard in the shared integration persistence path and handoff consumption path. It rejects missing/purged/deletion-requested users and users with a requested or processing deletion job. The check runs inside the same Convex mutation transaction as token/integration writes.
- **Tests:** Added synthetic behavior tests for a pending handoff after deletion request, credential persistence after deletion request, and credential persistence while a deletion job is active. The OAuth handoff behavior suite passed, 12/12.
- **Remaining uncertainty:** No deployed concurrent callback/deletion race test was run; correctness relies on Convex mutation transaction semantics.
- **Status/confidence:** Fixed and covered by focused synthetic regression tests. Medium, 8/10.

### HIGH — Account deletion omitted AI attempts and derived insight records — fixed

- **Evidence:** The original multi-stage account cascade did not include `aiSummaryAttempts`, `dailyFeatureVectors`, or `nextBestDayRecommendations`. These tables contain user-linked AI quality metadata and diary-derived activity/mood features or recommendations. No routine retention policies covered them either.
- **Impact:** A completed account deletion could leave associated AI/analytics records behind indefinitely, contrary to the expectation that the account's stored data is removed.
- **Fix:** Added separate batched cascade stages and deletion counters for all three tables, plus configurable retention policies and documented environment overrides. Added active-account guards to integration secret/sync/data writers, summary-quality writers, derived-insight writers, integration-health events, and quota release so in-flight work cannot recreate those records after deletion begins.
- **Tests:** Synthetic cascade tests assert owner rows are removed while another user's rows remain. Retention tests assert stale rows are removed and fresh rows remain. A focused deletion-race test verifies asynchronous internal writers reject a deletion-requested user. The affected backend suite passed **74/74 tests**.
- **Remaining uncertainty:** No deployed concurrent deletion/workflow race test or backup-system erasure verification was performed. Storage artifacts and external provider copies are not part of this database cascade.
- **Status/confidence:** Fixed in source with regression coverage. High, 8/10.

### MEDIUM — AI generation stored diary-derived prompt copies in backend quality events — remediated in source

- **Historical evidence:** `summaryGeneration.ts` composed diary/context model input and passed it to `recordSummaryGenerationEvaluationInternal` (`summaryQuality.ts`), which persisted prompt/output/source/error fields in `summaryGenerationEvents`.
- **Fix:** New quality events persist input byte count, normalized outcome and evaluation metadata only. In-memory scoring still uses the generated response. Provider exceptions use generic diagnostics and the persisted failure code is normalized.
- **Legacy cleanup:** A bounded daily migration removes old prompt/output/highlight/source/error fields and resumes through scheduled cursors. A completion marker prevents repeated full scans. Confirm migration completion in the deployed environment before release.
- **Controls/remaining risk:** API credentials remain server-side; prompt data is still transmitted to OpenAI for requested summary generation. No explicit request timeout or output-token ceiling was found; OpenAI account retention/training configuration remains unverified. No paid request was made.
- **Tests:** Synthetic tests assert new events omit content and legacy content is redacted. See current test results below.
- **Status/confidence:** Source-level minimization implemented; deployed migration and provider retention remain unverified. Medium, 8/10.

### MEDIUM — OAuth remote revocation is incomplete / operationally dependent

- **Evidence:** `integrations.ts` now immediately disconnects locally and queues Google token revocation with encrypted secret retention, retry state, failure status and a periodic recovery sweeper. Account deletion queues the same work. Spotify is explicitly recorded as unsupported and its local credentials are removed.
- **Impact/remaining limitation:** Remote provider access is not disabled until Google confirms revocation. Spotify grants remain until the user revokes them through Spotify. Terminal provider errors are not represented as success; user-facing instructions and operational monitoring are still required.
- **Tests:** Mocks cover owner checks, Google success, retryable 503, Spotify unsupported behavior and terminal retry failure. No external provider call or account was used.
- **Status/confidence:** Application-level lifecycle implemented; provider response semantics and real account behavior remain unverified. Medium, 8/10.

### MEDIUM — Privacy notice omitted active optional data collection and AI processing — corrected in source

- **Evidence:** `apps/mobile/lib/life-context-toggle-policy.ts`, `use-location-tracking.ts`, and `background-location-tracker.ts` implement explicit-consent controlled background location while the app may be closed. `android-call-activity-sync.ts` reads Android call-log records but returns only count and total-duration aggregates. AI summaries transmit relevant diary/context data to OpenAI. The previous web privacy page denied background location/call-log collection and did not name OpenAI or describe quality telemetry.
- **Fix:** Updated `apps/web/app/privacy/page.tsx` to explain the opt-in/runtime/permission gates, background operation, aggregated Android call context, OpenAI processing, and backend quality-event recording. This is a technical consistency correction, not legal review.
- **Remaining uncertainty:** Counsel/product owners should approve the notice and ensure it covers retention, provider terms, and jurisdiction-specific disclosures. No legal compliance determination is made.
- **Status/confidence:** Source mismatch corrected; policy/legal review remains. Medium, 8/10.

### LOW — Export storage cleanup failures require operational retry/monitoring

- **Evidence/Fix:** `summaries.ts` and `retention.ts` preserve artifact IDs and cleanup error/attempt metadata when deletion fails. Account cascade storage failures propagate so the deletion job cannot falsely complete; a failed action can retry through the normal deletion lifecycle. Export jobs retain artifact IDs before finalization.
- **Tests:** Synthetic storage failures verify the export row remains and succeeds on retry, including an account-cascade retry.
- **Remaining limitation:** The repository has no safe global object-storage inventory/orphan reconciliation mechanism. Historical objects whose database references were already lost cannot be identified from these functions. Storage URL expiration is not verified.
- **Status/confidence:** New failure path is retryable; historical orphan discovery and provider retention remain unverified. Low, 7/10.

### INFORMATIONAL — OAuth state cookie integrity and deployment controls need environment verification

- OAuth `/start` uses a random state and an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); callback compares the returned state and verifies the web Clerk user still matches. Cookie payload is base64-encoded, not cryptographically signed. No exploit was demonstrated; validate host/domain and cookie assumptions in the deployed topology.
- `apps/web/next.config.js` contains image configuration but no explicit security-header/CSP rules. Platform-level headers may exist outside the repository and were not inspected.
- Web middleware protects non-public routes, while Convex `requireUser` is the data authorization boundary. Deployment-specific Clerk/Convex issuer, audience, CORS, cookie, rate-limit and secret settings were not available for verification.

## Authentication and Convex authorization evidence

| Surface | Reviewed boundary | Evidence and result |
|---|---|---|
| Shared identity | `authz.ts` `getCurrentUser`, `requireUser`, `requireAdmin`, `requireOwnership` | Resolves Clerk identity to a Convex user; rejects missing, backend-purged, deletion-requested and active-deletion-job accounts; admin and resource owner checks are server-side. |
| Memories/media | `memories.ts` user-facing create/read/update/delete and media functions | Uses authenticated user identity and resource ownership for ID-based operations; media access is tied to owned memory/resource. Behavior tests cover selected unauthorized ID paths. |
| Days/calendar | `days.ts` user-facing get/list/upsert/delete paths | Uses user-scoped day indexes and current-user identity. No cross-user live account test was performed. |
| Preferences | `userPreferences.ts` user preference query/mutation paths | Uses authenticated Clerk-to-user/preferences mapping. |
| Integrations/tokens | `integrations.ts`, `integrations.auth.ts`, `integrations.sync.ts` | User-facing integration operations check ownership; token-bearing writes/reads are internal and tied to user/provider/token reference. Encrypted secrets are not returned by ordinary integration list queries. OAuth and asynchronous sync writers reject deletion-in-progress users. Disconnect is owner-checked and disables local use before external revocation is attempted. |
| Summaries/analytics | `summaries.ts`, `personalInsights.ts`, `summaryGeneration.ts`, `summaryQuality.ts` | User-facing reads/writes obtain current identity and scope by user/day; AI generation reads user-scoped sources. Internal quality, insight and quota-release writes reject deletion-in-progress users. |
| Export/restore | `summaries.ts` | Actions obtain active identity via `getSummaryGenerationIdentity`; export dataset queries are user-scoped. Download requires export-job ownership. Restore validates schema, size, signature and exact Clerk owner before applying rows under the current `userId`. |
| HTTP/webhooks | `http.ts`, `oauthConnect.ts`, `webhooks.ts`, `observabilityIngestion.ts` | Clerk webhook uses Svix verification. Observability ingestion uses authenticated JWT/replay nonce and rate controls. OAuth callback verifies state; mobile handoff is 256-bit, single-use, provider-scoped and expiring. |

Focused existing behavior suites include memory/day/summary ownership, export download ownership, restore tampering/owner mismatch and user deletion cascade coverage. These are isolated handler-level in-memory tests, not deployed Convex end-to-end or two-live-account tests. The audit did not execute a two-account cross-user test against a development deployment.

## AI and OpenAI processing

- `summaryGeneration.ts` assembles current-day memory content, day metadata, and bounded integration data. It sends this to the OpenAI adapter in `providerAdapters.ts`. Personal-insight narrative generation sends aggregated feature vectors/trends from `personalInsights.ts`.
- API keys are loaded from server-only environment configuration in `env.ts`; backend adapters perform the network request. No key was printed or exposed in browser code during this source review. Production deployment secret values were not inspected.
- Summary inputs are limited to 50 memories, 64 KB of memory text, and 32 integration rows. A daily quota/idempotency mechanism, circuit breaker, bounded retry/autopilot behavior and strict response schema are implemented.
- New `summaryGenerationEvents` rows retain only input byte length, result metadata and evaluation scores; prompts, generated text, highlights, source names, and provider error strings are not persisted. Quality scores continue to be computed in memory.
- A daily internal migration redacts those fields from legacy events in bounded pages and resumes by cursor. Legacy failure reasons are normalized to `generation_failed`. The migration's completion/operational state should be monitored; the persistent data remains subject to event retention and account deletion.
- `aiSummaryAttempts` stores flags and normalized failure metadata rather than raw generated summaries. Legacy prompt-derived FNV-1a input hashes are being removed through a resumable scheduled migration; current writes do not store them. `dailyFeatureVectors` and `nextBestDayRecommendations` persist user-linked derived activity, mood, and health-context data.
- The reviewed OpenAI request has no explicit `AbortSignal` timeout or output-token ceiling. Provider account retention/training settings and billing limits were not inspected. No paid request was made.
- The web privacy notice discloses OpenAI processing. UI-level just-in-time consent and the production OpenAI configuration remain to be confirmed.

## OAuth and integrations

- Providers and minimum scopes are enumerated in `apps/web/lib/integrations-oauth.ts`. Start/callback routes use an OAuth state value in an `HttpOnly`, `SameSite=Lax` cookie, check the callback state, and require the current web Clerk account to match the account that started the flow. Redirect paths are normalized to local paths; mobile return URLs are protocol constrained.
- OAuth callback performs server-side token exchange and posts tokens to Convex over the configured HTTP site origin. Logs inspected record provider, state prefix, scope counts and token presence, not token values. Mobile auth uses a short-lived single-use handoff.
- `integrationSecrets.ts`/`integrations.auth.ts` store access/refresh tokens using AES-256-GCM encrypted envelopes, with user/provider/token-reference binding. Key configuration is server-side; actual KMS/keyring deployment, rotation completion and backup key custody were not verified.
- Refresh is implemented for supported OAuth providers. Google Calendar/Fit and Gmail Summary disconnects enqueue server-side revocation, immediately mark the local integration disconnected, and retain encrypted credentials only while revocation is pending. Successful provider responses are recorded as revoked; retry exhaustion or provider rejection is recorded as failed, never as confirmed revocation. A 15-minute sweeper recovers due/interrupted attempts; terminal job metadata is purged after 30 days.
- Spotify exposes no revocation implementation in this repository. Disconnect clears local credentials and records remote revocation as unsupported; users must revoke access through Spotify's account controls. Account deletion follows the same behavior and may finish while a remote revocation job remains pending.
- Synthetic tests cover owner rejection, local disconnect, Google success, retryable 503, Spotify unsupported behavior and terminal retry failure. No live OAuth account was connected; provider behavior, token refresh/expiration and real revocation were not dynamically tested.

## Export, restore and account deletion

- Export actions derive the active user identity; `exportMyDiaryData` reads only user-scoped datasets. JSON archives include an HMAC-SHA-256 signature and owner Clerk ID; production requires `EXPORT_SIGNING_SECRET`. Restore enforces a 5 MiB limit, schema version, row validators/counts, signature and caller/owner equality before batched writes. Imported rows are written under the authenticated caller's Convex user ID.
- JSON is the signed restorable format. Plain-text export is human-readable and is not accepted by the signed JSON restore parser. OAuth credentials are not part of exported datasets.
- Export-job listing and download URL queries enforce owner scope; restore-job listing is owner-scoped. Existing behavior tests exercise export ownership, backup tampering and restore owner mismatch. No real export download or restore was run.
- Account deletion is a scheduled multi-stage cascade covering memories/media, summaries, days, integrations/daily data/secrets, export and restore jobs, AI quality/generation/attempt records, derived feature vectors/recommendations, preferences, audit records, quota rows and mobile handoffs. User deletion status blocks normal authenticated functions. OAuth callback and asynchronous writer races are guarded at the internal write boundaries. Connected integrations are locally disabled and revocation jobs are queued before cascade cleanup.
- AI attempt, derived feature-vector and recommendation tables now have configurable retention policies (defaults: 60/90/90 days); `DEPLOY_RUNBOOK.md` lists environment overrides. This is source-level behavior and documentation, not evidence that deployed schedules or environment values are configured.
- Storage deletion failures during export retention or account deletion now propagate or preserve the database artifact reference and failure metadata for a later retry; deletion is not reported as complete while its cascade mutation fails. Tests use mocked storage and synthetic rows only. Profile-image storage deletion failures also propagate.
- Export artifacts created by an in-flight action are attached to their job before finalization, so a later failure can retain the storage ID for cleanup. No safe global object-storage listing/orphan reconciliation mechanism was found; historical orphan objects cannot be identified safely without a provider-supported inventory.
- Backup frequency, location, encryption, access controls, retention duration, recovery testing and backup erasure are not evidenced by repository configuration. Deletion from active Convex records does not establish immediate erasure from backups or external providers. Deletion-job rows are removed by a separate configurable retention policy.
- No account was deleted and no destructive operation was performed.

## API, application security and operations

- The repository defines Clerk webhook, observability ingestion and OAuth connect HTTP routes in `packages/backend/convex/http.ts`. The webhook validates Svix signatures. The observability endpoint uses a JWT/replay guard and rate-limiter implementation.
- `apps/web/proxy.ts` gates non-public web routes, but frontend middleware is not treated as a data authorization boundary; Convex checks provide that boundary.
- `apps/web/next.config.js` has no explicit CSP/security headers. No repository-level CORS policy or global browser security-header configuration was found in the reviewed web config. Hosting-level controls remain unknown.
- Restore uses validated JSON rather than an arbitrary server-side file upload. No dependency vulnerability scan or broad penetration test was run.
- Deployment docs describe Convex → web/admin → mobile ordering and environment URL alignment. Source checks require HTTPS for Clerk issuer configuration and require export signing secrets in production. No live/staging deployment settings, deployment permissions, production environment separation, backup recovery, monitoring alert delivery, rollback execution or incident response drill was verified.
- Export retention and user deletion-job retention are configurable. Failed storage deletions retain their database references for retry; historical orphan objects without references cannot be discovered by the reviewed code.

## Tests and checks performed

- Source-traced the shared authorization helper and sensitive user-facing surfaces in memories, days, preferences, integrations, summaries/analytics, HTTP/webhooks, export/restore and deletion.
- Reviewed existing handler-level behavior tests for ownership, export/download, restore integrity/owner mismatch, and deletion cleanup.
- The full backend suite passed **262/262 tests** across 45 files. Backend typecheck and lint passed. Focused additions cover AI data minimization and resumable legacy redaction, export cleanup backoff/retry, account-cascade retry, and mocked OAuth revocation lifecycle.
- Updated the web privacy notice to match the implemented opt-in location/call features and AI processing.
- No production data, real diary text, external account, paid AI request or destructive test was used.
- **Deployment-status exception:** a local Convex code-generation command during this follow-up printed “Uploading functions to Convex.” The selected target and resulting deployment history were not verified, and no further remote command was run. An operator must check the Convex deployment history before treating this work as local-only or proceeding with any release.

## Not tested / remaining release requirements

1. Run focused authorization/export/restore suites in CI and, where practical, two-account tests against an isolated development deployment. Handler-level synthetic tests passed locally, but are not an end-to-end deployment proof.
2. Verify production/staging Clerk and Convex environments, issuer/audience alignment, secret provisioning/rotation, security headers/CSP, CORS, cookies, rate limits and monitoring redaction.
3. Verify the one-time legacy AI content redaction completes; confirm OpenAI data controls, retention and user disclosure.
4. Configure and monitor OAuth revocation retries; provide Spotify provider-side revocation instructions and verify provider responses in an isolated test account before public release.
5. Monitor export cleanup/deletion failures and retryable backlog; verify storage URL expiration and backup deletion semantics. Historical orphans without database references need storage-provider inventory procedures.
6. Confirm data-retention periods with product/legal owners, including AI quality events, deletion-job identifiers, location context and provider copies.
7. Exercise backup recovery, monitoring alerts, deployment permissions and rollback in an isolated staging environment.
8. Correct the canonical source for the optional generated developer skill when identified and protect the remediation from regeneration.
9. Investigate the Convex deployment-history exception above and confirm the target/status before further backend operations.

No compliance certification is claimed.
