# DayLog Mobile App (`apps/mobile`)

> Status: Active
> Last Updated: 2026-04-14
> Audience: Mobile engineers
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

Expo + React Native client for DayLog memory capture, integrations, and daily summaries.

Canonical onboarding and monorepo setup:

- [../../README.md](../../README.md)

## Required Environment Variables

Create from example:

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

Required:

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_WEB_APP_URL`

Observability:

- `EXPO_PUBLIC_SENTRY_DSN`
- optional test-only flag: `EXPO_PUBLIC_SENTRY_FORCE_TEST_EXCEPTION=true`

## Local Development

From repository root:

```bash
pnpm --filter mobile start
```

Additional commands:

```bash
pnpm --filter mobile android
pnpm --filter mobile ios
pnpm --filter mobile web
pnpm --filter mobile lint
pnpm --filter mobile check-types
pnpm --filter mobile test
pnpm --filter mobile build:ci
```

## Capability Notes

- Integrations available through shared backend contracts (Google Calendar, Google Fit, Spotify, Apple Health uploads).
- Foreground location tracking is optional and permission-gated.
- Controlled background tracking is explicitly opt-in and policy-gated.
- Android communication summary depends on native capability and permission path.

## OAuth Handoff

Mobile integration connect flows use the web OAuth routes and return-path handoff.
Ensure `EXPO_PUBLIC_WEB_APP_URL` points to the correct deployed/local web host.

## Troubleshooting

- Auth appears stuck:
  - Verify Clerk key and network access to Clerk + Convex.
- OAuth handoff fails:
  - Verify web base URL and callback return path.
- Build issues in Expo Go for native-only features:
  - Use a development build when feature requires native modules.
