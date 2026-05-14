# DayLog Mobile (`apps/mobile`)

> Status: Active  
> Last Updated: 2026-05-15  
> Audience: Mobile engineers  
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

**Expo 54** + **React Native** client: memories, integrations, summaries, and optional life-context features (location, health, etc.).

**Monorepo onboarding:** [../../README.md](../../README.md)  
**Life context architecture:** [../../LIFE_CONTEXT_TRACKING_BLUEPRINT.md](../../LIFE_CONTEXT_TRACKING_BLUEPRINT.md)

## Routing

- **Expo Router** — file-based routes under `app/` (tabs, stacks, modals).

## Environment

```bash
cp apps/mobile/.env.example apps/mobile/.env.local
```

Required:

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_WEB_APP_URL` — web origin used for OAuth **handoff** (must match running web app).

Optional:

- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_SENTRY_FORCE_TEST_EXCEPTION=true` (debug only)

## Local development

```bash
pnpm dev:mobile
```

Equivalent:

```bash
pnpm --filter mobile start
```

Platform targets:

```bash
pnpm --filter mobile android
pnpm --filter mobile ios
pnpm --filter mobile web
```

## Commands

```bash
pnpm --filter mobile lint
pnpm --filter mobile check-types
pnpm --filter mobile test
pnpm --filter mobile build:ci
```

`build:ci` runs `expo export --platform web` with `CI=1` for bundle gates.

## Auth and OAuth handoff

- **Clerk** via `@clerk/clerk-expo`.
- Some integration connects use **web OAuth routes** then return to the app; `EXPO_PUBLIC_WEB_APP_URL` must point at the correct web deployment (local or production).

## Capabilities

- Integrations: Google Calendar, Google Fit, Spotify, Apple Health uploads (subject to device build).
- Foreground location: permission-gated; see blueprint for privacy model.
- Native-heavy features may require a **development build** instead of Expo Go alone.

## Testing

```bash
pnpm --filter mobile test
```

Tests live under `apps/mobile/lib/*.test.ts`. See [../../docs/TESTING.md](../../docs/TESTING.md).

## Deployment

Ship with **EAS** / Expo release channels; align env with the production web host used for OAuth. [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Troubleshooting

[../../docs/TROUBLESHOOTING.md](../../docs/TROUBLESHOOTING.md) — auth, handoff, and native build sections.
