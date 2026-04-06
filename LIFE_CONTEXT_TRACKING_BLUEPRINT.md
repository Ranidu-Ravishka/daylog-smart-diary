# DayLog Life Context Tracking Blueprint

Last updated: 2026-04-06

This document defines the production architecture and implementation plan for privacy-aware contextual tracking in DayLog.

## 1) Architecture Overview

### System goals

- Enrich day summaries with useful life context, not raw surveillance data.
- Keep data collection explicit, user-controlled, and revocable.
- Optimize battery by using coarse signals, bounded polling, and feature-level throttling.

### High-level data flow

1. User opts in from mobile settings by feature.
2. Mobile collection modules gather minimal signals per capability:
   - foreground location updates
   - health/activity snapshots
   - calendar summaries
   - communication aggregate counts (if permitted)
3. Mobile normalizes raw sensor/API outputs into a small contextual payload.
4. Mobile writes normalized payloads to Convex via `integrations.upsertMyIntegrationDailyData` or `integrations.upsertMyContextualDailyData`.
5. Convex stores data in `integrationDailyData` keyed by `userId + provider + dayKey`.
6. Convex aggregation query (`integrations.getMyIntegrationContextAggregateForDay`) builds day-level context views.
7. Summary generation consumes integration context (`summaryGeneration.generateSummaryForDay`) as structured model input.

### Layers

- Mobile collection layer:
  - `apps/mobile/lib/foreground-location-tracker.ts`
  - `apps/mobile/lib/location-stay-points.ts`
  - `apps/mobile/lib/apple-health-sync.ts`
  - `apps/mobile/lib/android-screen-time-sync.ts`
- Backend ingestion layer:
  - `packages/backend/convex/integrations.ts`
  - `packages/backend/convex/integrationProviders.ts`
  - `packages/backend/convex/schema.ts`
- Daily aggregation + summary layer:
  - `packages/backend/convex/integrations.ts` (aggregate query)
  - `packages/backend/convex/summaryGeneration.ts`

## 2) Feature Breakdown (Step-by-step)

### A) Location Intelligence

#### Location APIs / SDKs

- Expo: `expo-location` foreground permissions + `watchPositionAsync`
- Optional controlled background mode (future): `Location.startLocationUpdatesAsync` with explicit feature flag

#### Location platform limitations

- iOS: background location requires Always permission and strict review compliance.
- Android: background location requires additional permission and user education; OEM battery policies may throttle updates.

#### Location permissions

- `Location.requestForegroundPermissionsAsync()` first.
- Background mode only after explicit secondary consent flow.

#### Location data model

- Provider type: `location`
- Stored fields:
  - summary + signals
  - context.location:
    - mode
    - totalTrackedMinutes
    - totalDistanceMeters
    - stayPoints (coarse labels + durations)

#### Location implementation steps

1. Collect coarse location points while app is open.
2. Buffer points in memory with age pruning (8h window).
3. Detect stay points client-side.
4. Upload summarized payload (no raw GPS trail persistence).
5. Aggregate by `dayKey` in backend for timeline and summaries.

### B) Activity & Fitness Tracking

#### Fitness APIs / SDKs

- iOS: HealthKit via `react-native-health` (already present in repo)
- Android: Google Fit REST (OAuth) and optional Android usage stats module for screen time

#### Fitness platform limitations

- HealthKit unavailable in Expo Go; dev client/native build required.
- Google Fit OAuth scope/user consent required.

#### Fitness permissions

- iOS Health permissions (steps, sleep as configured)
- Google OAuth scopes for fitness data

#### Fitness data model

- Provider types:
  - existing: `google_fit`, `apple_health`
  - new contextual type: `fitness`
- Stored fields:
  - metrics (steps/sleep/screen)
  - context.fitness (distanceMeters, activeMinutes, idleMinutes, source)

#### Fitness implementation steps

1. Pull daily metrics from platform API.
2. Normalize into common schema.
3. Upsert by `dayKey` using provider row.
4. Aggregate with max/safe merge semantics in backend.

### C) Mood & Context Awareness (Privacy-first)

#### Mood APIs / SDKs

- Manual mood selection from existing memory/day surfaces.
- Optional lightweight inference from non-sensitive signals (time-of-day, activity cadence).

#### Mood platform limitations

- No face/voice biometrics in baseline design.

#### Mood permissions

- No extra OS permissions for manual mood.
- Inference is strictly derived from already-consented signals.

#### Mood data model

- Provider type: `activity_summary`
- context.activitySummary:
  - mood
  - moodConfidence (0..1)
  - activityLevel (`active|mixed|idle`)

#### Mood implementation steps

1. Keep manual mood as source of truth.
2. If inference enabled, store as low-confidence hint only.
3. Surface confidence and allow quick correction.

### D) Communication Signals (High-level only)

#### Communication APIs / SDKs

- Android-only option: aggregate call count/duration via platform-safe APIs, gated behind explicit permission and product/legal approval.
- iOS: no raw call log access path; use user-provided or shortcut-based aggregates if needed.

#### Communication platform limitations

- iOS does not allow general raw call log ingestion for this use case.

#### Communication permissions

- Android call-state/call-log permissions only if feature enabled and policy-approved.

#### Communication data model

- Provider type: `activity_summary`
- context.activitySummary:
  - callsCount
  - callDurationMinutes

#### Communication implementation steps

1. Collect only day-level aggregates.
2. Never persist phone numbers, contacts, or call transcript data.
3. Upsert aggregate payload by `dayKey`.

### E) Notification Context (Outlook / Calendar)

#### Calendar APIs / SDKs

- Existing OAuth provider patterns in web + Convex:
  - Google Calendar currently implemented
- Extendable to Microsoft Graph Calendar (future)

#### Calendar platform limitations

- Calendar APIs vary by provider and OAuth scopes.

#### Calendar permissions

- OAuth delegated consent per provider.

#### Calendar data model

- Provider types:
  - existing: `google_calendar`
  - new contextual type: `calendar`
- context.calendar:
  - meetingsCount
  - busyMinutes
  - remindersCount
  - eventTitles (truncated)

#### Calendar implementation steps

1. Sync event metadata for day range.
2. Compute aggregate counts and busy minutes.
3. Persist summaries/signals and context.calendar.

## 3) Location Deep Dive

### Tracking model

- Default mode: foreground only.
- Controlled background mode (future): user must opt in with separate consent and battery guidance.

### Stay-point algorithm

- Input: ordered coarse track points (lat/lon/time/accuracy).
- Rule:
  - points are in same stay cluster when distance from cluster anchor <= `maxStayRadiusMeters`
  - cluster duration must exceed `minStayDurationMinutes`
- Output:
  - centroid (coarsened)
  - start/end timestamps
  - duration minutes
  - approximate area label

### Battery strategy

- Time interval: 2 minutes
- Distance interval: 200m
- Drop low-quality points (`accuracy > threshold`)
- Throttle uploads when area unchanged + short interval
- Keep bounded in-memory point buffer (8h)

### Sample flow

```ts
const locationContext = buildLocationContextFromPoints(recentTrackPoints);

await upsertMyIntegrationDailyData({
  provider: "location",
  dayKey,
  summary: locationContext.summary,
  signals: locationContext.signals,
  context: locationContext.context,
});
```

## 4) Privacy & Compliance Model

### Consent and controls

- Feature toggles are per capability:
  - location tracking
  - fitness sync
  - calendar sync
  - communication aggregate
  - mood assistance
- Every toggle includes:
  - what is collected
  - why it is collected
  - how to disable/delete

### Data minimization rules

Always store:

- day-level aggregates
- coarse area labels
- bounded, truncated signals

Never store:

- raw continuous GPS history for long retention
- phone numbers, contact names, message/call content
- precise addresses without explicit need
- biometric face recognition outputs (unless explicit future consent + legal approval)

### Retention and export

- Reuse existing retention jobs for `integrationDailyData`.
- Export APIs include contextual rows and preserve location filtering behavior.

## 5) Backend Integration Details

### Schema updates

`integrationDailyData` now supports optional `context` payload:

- `context.location`
- `context.fitness`
- `context.calendar`
- `context.activitySummary`

### Provider types

Daily contextual providers now include:

- `location`
- `fitness`
- `calendar`
- `activity_summary`

### New/updated APIs

- Updated:
  - `integrations.upsertMyIntegrationDailyData` (accepts `context`)
  - `integrations.upsertIntegrationDailyDataInternal` (accepts `context`)
  - `integrations.syncAppleHealthDailyData` (accepts `context`)
- New:
  - `integrations.upsertMyContextualDailyData`
  - `integrations.getMyIntegrationContextAggregateForDay`

### Aggregation logic (`dayKey`)

`getMyIntegrationContextAggregateForDay` returns:

- provider list/count
- merged metrics (steps/sleep/screen/spending)
- location aggregate + human summary from top stay points
- fitness aggregate
- calendar aggregate
- activity summary aggregate
- deduped day-level signals
- latest synced timestamp

## 6) UX Integration Blueprint

### Settings (per-feature toggles)

- Add grouped section: "Life Context Tracking"
- Toggles:
  - Location (foreground)
  - Fitness sync
  - Calendar sync
  - Communication summary
  - Mood assistance
- Each row includes short disclosure and "Learn more" modal.

### Daily timeline view

- New cards:
  - "Places visited" (stay points + duration)
  - "Activity" (steps, distance, active/idle)
  - "Calendar context" (meetings + busy periods)
  - "Communication summary" (aggregate only)

### Insights page

- Weekly trends from aggregated dayKey rows:
  - most frequent stay point labels
  - active minutes trend
  - meeting load trend
  - mood trend (manual + inferred confidence)

### Explainability

- Every insight has source tags:
  - "Derived from foreground location"
  - "Derived from Google Calendar"
  - "Derived from Apple Health"
- Add quick action: "Disable this data source"

## 7) Operational Guardrails

- Keep idempotent upserts by `userId + provider + dayKey`.
- Validate `dayKey` at all entry points.
- Avoid storing unrestricted free text from external providers.
- Apply sanitization before persistence for all context payloads.

## 8) Testing Strategy

- Unit tests:
  - stay-point detection edge cases (jitter, sparse data, invalid points)
  - context sanitization and truncation
  - aggregation outputs for mixed provider rows
- Behavior tests (backend):
  - idempotent context upserts
  - day-level aggregate shape and merged metrics
  - summary input includes context snapshots
- Mobile integration tests:
  - permission denied/limited flows
  - foreground tracking start/stop transitions
  - battery throttle behavior (no excessive uploads)
