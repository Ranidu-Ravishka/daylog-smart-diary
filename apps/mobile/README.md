# DayLog Mobile App (`apps/mobile`)

Expo + React Native client for DayLog.

## Required environment variables

Create `apps/mobile/.env.local` from `apps/mobile/.env.example`.

Required:

- `EXPO_PUBLIC_CONVEX_URL`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`

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
