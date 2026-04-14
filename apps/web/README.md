# DayLog Web App (`apps/web`)

> Status: Active
> Last Updated: 2026-04-14
> Audience: Web engineers
> Standard: [../../CONTRIBUTING.md](../../CONTRIBUTING.md)

User-facing Next.js application for memories, summaries, settings, and integrations.

Canonical onboarding and monorepo setup:

- [../../README.md](../../README.md)

## Required Environment Variables

Create from example:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Required for runtime/auth/integrations:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Recommended for observability:

- `NEXT_PUBLIC_SENTRY_DSN`
- optional server-side override: `SENTRY_DSN`

## Local Development

From repository root:

```bash
pnpm dev:web
```

## Commands

From repository root:

```bash
pnpm --filter web dev
pnpm --filter web lint
pnpm --filter web check-types
pnpm --filter web build
pnpm --filter web start
pnpm --filter web test
```

## OAuth Callback Routes

These paths must be registered in OAuth providers:

- Google Calendar:
  - `/api/integrations/oauth/google_calendar/callback`
- Google Fit:
  - `/api/integrations/oauth/google_fit/callback`
- Spotify:
  - `/api/integrations/oauth/spotify/callback`

Full URI format:

- `${NEXT_PUBLIC_APP_URL}/api/integrations/oauth/<provider>/callback`

## Troubleshooting

- OAuth callback mismatch:
  - Check provider redirect URI exactly matches `NEXT_PUBLIC_APP_URL` + callback path.
- OAuth callback rejected:
  - Verify state cookie flow and that user is still signed in.
- Missing integration credentials:
  - Check `GOOGLE_*` and `SPOTIFY_*` env vars in both web env and Convex env.
- Convex auth token missing in callback:
  - Re-authenticate and retry connection.
