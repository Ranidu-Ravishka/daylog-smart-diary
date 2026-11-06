# DayLog AI Verification Report

## Result

**Status: MOCK VERIFIED; LIVE AI BEHAVIOR NOT VERIFIED.** No OpenAI request was made, no key was displayed, and no production or personal diary data was used.

## Implemented functionality

- Authenticated daily summary generation is implemented in [`summaryGeneration.ts`](./packages/backend/convex/summaryGeneration.ts) and calls OpenAI from the backend. The configured model name in the generation/evaluation path is `gpt-4o`.
- Personal insights and narrative-related code exist in [`personalInsights.ts`](./packages/backend/convex/personalInsights.ts). Automated tests cover insight behavior, but the live experience was not exercised.
- **Ask Your Day** is now available from the authenticated web dashboard through [`aiBrain.ts`](./packages/backend/convex/aiBrain.ts) and [`dashboard-ask-your-day.tsx`](./apps/web/components/dashboard/dashboard-ask-your-day.tsx). Retrieval is bounded to the requesting user's recent memories and summaries; live provider behavior remains unverified.

## Data sent and privacy controls

Summary input is assembled from a user's day key, selected diary memories, day rating/manual notes/people tags, and integration providers/signals/summaries/metrics/context snapshots. The code bounds memory count and input size, and caps integration context. This still sends private diary-derived information to OpenAI when a user invokes generation; provider privacy terms, configured data-retention options, and user-facing disclosure were not verified.

New evaluation writes record input byte count, success/failure, quality scores, and related metadata. Provider token metadata is recorded in the backend-only `aiUsageRecords` table without prompts or generated diary content. Account deletion and the configurable retention job cover usage records. Although the schema contains optional legacy `modelInput`/generated-content fields, the current write path does not populate them. Legacy content redaction and retention functions exist. Summary content itself is user data and remains subject to encrypted storage and summary-retention policy.

## Limits, errors, and automated evidence

- The default quota is **5 summary generations per user per day** (`SUMMARY_DAILY_GENERATION_LIMIT`); configured deployment values were not verified.
- Model input is size-bounded; summary, insight, and Ask Your Day inputs are bounded. Provider usage is recorded when returned, with conservative byte-based estimates when metadata is missing. Per-request output caps are set for insight and Ask Your Day. No OpenAI organization spend ceiling was verified.
- Idempotency keys protect retries from double-spending quota. Retry/autopilot behavior is feature-flagged and bounded. Model output is normalized/quality-evaluated, and fallback/error paths have unit coverage.
- The local backend suite passed **45 files / 266 tests**, including provider usage extraction, summary generation, personal-insight behavior, retention, and account deletion. The web suite passed **3 files / 15 tests**. Mocked/unit tests do not establish OpenAI connectivity, real rate-limit behavior, provider response validity, token consumption, latency, or live privacy handling.
- CI-mode environment validation had previously failed locally for missing required service configuration, including OpenAI-related configuration. A present environment-variable name or placeholder does not prove a valid staging key.

## Verification table

| Area | Result |
|---|---|
| AI Brain / Ask Your Day | Source reviewed; bounded authenticated web workflow and backend action implemented; live call not run. |
| Daily summaries | Source and local tests reviewed; live call not run. |
| Personal insights | Source and local tests reviewed; live call not run. |
| OpenAI connectivity | Not tested; staging credentials unavailable/unchecked. |
| Usage limits | Default and code path reviewed; deployed limit and actual enforcement not tested live. |
| Invalid responses and failures | Unit/mock coverage exists; live provider error cases not run. |
| Rate limiting | Per-user daily quota is implemented; provider rate limits and deployed behavior not tested. |
| Token consumption/cost | Backend usage ledger and estimates implemented; live provider metadata and billing not verified. |
| Private-data handling | Backend-only request path and bounded input reviewed; provider retention/terms and actual deployment controls not verified. |

## Required before private beta

1. Configure a separate staging OpenAI key and a deliberately low spend limit/quota; verify usage and alerting.
2. Run synthetic-data tests for successful, malformed, rate-limited, timed-out, and unavailable-provider responses.
3. Confirm OpenAI account data-retention settings and document exactly which diary/integration data is transmitted.
4. Confirm legacy raw AI evaluation records are purged and document the effective retention values.
5. Run the new Ask Your Day workflow with synthetic records and verify the configured OpenAI pricing and account budget manually.
