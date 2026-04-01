# DayLog Web App (`apps/web`)

User-facing Next.js application for DayLog.

## Product boundary notes

- Web supports journaling, mood tracking, integration connect/sync, and OpenAI summary generation.
- Current integrations: Google Calendar, Google Fit, Spotify, and Apple Health uploads.
- Mobile app supports optional foreground location tracking (coarse, while app is open); background location and call-log collection are not part of the current shipped feature set.

## Required environment variables

Create `apps/web/.env.local` from `apps/web/.env.example`.

Required:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL` (for OAuth callback URL generation)
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Google Calendar/Fit OAuth)
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (Spotify OAuth)

## Local development

From repo root:

```bash
pnpm dev:web
```

Notes:

- The web dev script uses `apps/web/scripts/dev.mjs` and prefers port `3000`.
- If `3000` is busy, it automatically picks the next free port (up to `3020`).

## Commands

From repo root:

```bash
pnpm --filter web dev
pnpm --filter web lint
pnpm --filter web check-types
pnpm --filter web build
pnpm --filter web start
```

## Build/CI expectations

- The root CI workflow may run `pnpm build:web` when web/shared files change.
- `pnpm lint` and `pnpm typecheck` are expected to pass at repo level.

## Troubleshooting

- Convex connection issues: verify `NEXT_PUBLIC_CONVEX_URL` and ensure backend is running.
- Clerk issues: verify publishable/secret keys and sign-in routes.
- If local port changes from `3000`, use the printed URL from the dev startup log.
