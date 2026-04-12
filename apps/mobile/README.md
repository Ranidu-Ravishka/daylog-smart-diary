# DayLog Mobile App (`apps/mobile`)

Expo + React Native client for DayLog.

## Feature scope (current)

- Mobile supports memory capture, mood tagging, day-detail review, integration connect/sync, and daily summary generation from the Memory tab.
- Connected data providers shown in mobile are: Google Calendar, Google Fit, Spotify, and Apple Health uploads.
- Mobile supports optional foreground location tracking and controlled background location tracking (both coarse, privacy-gated).
- Call-log collection remains permission-gated and platform-limited.

## Foreground location MVP setup (mobile)

Location signals use `expo-location` and require user permission.

- Install dependencies in `apps/mobile`:

```bash
pnpm --filter mobile add expo-location
```

- Run the app (Expo Go or development build).
- In app: Profile → Integration Preferences → Foreground Location Tracking.
- Grant foreground location permission when prompted.

Behavior and privacy limits:

- Foreground tracker collects only while the app is open.
- Background tracker is separately opt-in and runtime-gated.
- Stored signal is coarse approximate area (`lat,lng` rounded), not high-frequency raw traces.
- Tracking stops when permission is denied, auto-disabled for battery/rate policy, or toggle is turned off.

## Controlled background location tracking

Background tracking is runtime-gated and opt-in only.

- Requires explicit consent in Profile -> Life Context Tracking.
- Requires foreground + background location OS permissions.
- Uses batched coarse points with stay-point/duration context (not route-level traces).
- Tracks battery impact telemetry and auto-disables when policy thresholds are exceeded.

## Android communication summary setup

Communication summary uses Android-only aggregate call activity and is unavailable on iOS.

- Add native dependency in `apps/mobile`:

```bash
pnpm --filter mobile add react-native-call-log
```

- Build and run an Android development build (not Expo Go).
- In app: Profile -> Life Context Tracking -> Communication Summary.
- Grant call activity/read-call-log permission when prompted.

Behavior and privacy limits:

- Only day-level aggregate counts/duration are used.
- No phone numbers, contact names, or call transcripts are stored.
- If the native module is unavailable in the current build, the toggle remains unavailable.

## Apple Health real-device sync setup (iOS)

Apple Health sync requires a native iOS build (not Expo Go) because HealthKit access is a native capability.

- Add native dependency in `apps/mobile`:

```bash
pnpm --filter mobile add react-native-health
```

- Enable HealthKit entitlement in iOS app configuration and include required privacy usage text.

- Build and run a development client (`expo prebuild` + iOS dev build), then use:

- Profile → Integrations → Apple Health → Connect
- Profile → Integrations → Apple Health → Sync now

If the native module is missing, the app will show an explicit setup error when syncing Apple Health.

## Android screen-time real-data setup

Android screen-time collection requires usage-stats access from a native Android build.

- Add native dependency in `apps/mobile`:

```bash
pnpm --filter mobile add react-native-usage-stats-manager
```

- Build and run Android development client (not Expo Go).
- In app: Profile → Integrations → Google Fit → Sync now.
- On first attempt, grant Usage Access in Android settings when prompted.

When granted, synced Google Fit daily data will include `screenTimeMinutes` from Android usage stats.

## iOS screen-time real-data setup

True iOS Screen Time access requires Apple Screen Time / Family Controls APIs and entitlement approval.

- Add an iOS native bridge module that exposes daily screen time to React Native.
- Enable required Apple capabilities/entitlements (Family Controls / Device Activity) for your app ID.
- Use an iOS native development build (not Expo Go).
- In app: Profile → Integrations → Google Fit → Sync now.

If entitlement/module setup is missing, sync still completes for Google Fit metrics while screen time is skipped with a clear message.

## Required environment variables

Create `apps/mobile/.env.local` from `apps/mobile/.env.example`.

Required:

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_WEB_APP_URL` (web app base URL used for OAuth connect flow)

## Local development

From repo root:

```bash
pnpm dev:mobile
```

Useful alternatives:

```bash
pnpm --filter mobile start
pnpm --filter mobile ios
pnpm --filter mobile android
pnpm --filter mobile web
```

## Quality and CI commands

From repo root:

```bash
pnpm --filter mobile check-types
pnpm --filter mobile lint
pnpm --filter mobile build:ci
```

`build:ci` performs Expo web export and is used by CI as a reliable build-level gate.

## Auth boundary behavior

- Root auth gating is in `app/_layout.tsx`.
- Protected trees mount only after Clerk auth is resolved.
- Unauthenticated users route to `/sign-in` after auth resolution.
- Convex-dependent startup logic is gated until Convex auth is ready.

## Troubleshooting

- Missing `EXPO_PUBLIC_CONVEX_URL` in production build logs indicates env setup is incomplete.
- If auth appears stuck, verify Clerk publishable key and network access to Convex + Clerk.
- If Expo bundling fails, run `pnpm install` from repo root and retry.
