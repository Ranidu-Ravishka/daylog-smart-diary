# Convex + TypeScript + ESLint

This template provides a minimal setup to get Convex working, with TypeScript
and ESLint.

Start by editing `convex/myFunctions.ts` and interact with your backend from the
dashboard or via the CLI:

```sh
npx convex run myFunctions:myQuery '{"first": 1, "second": "Hello"}'
```

See Convex docs at <https://docs.convex.dev/home>

## Setting up

```sh
npm create convex@latest -t bare
```

## Admin bootstrap (Clerk)

To create your first admin user (so you can access the admin app), set this
Convex environment variable (in the Convex Dashboard) to a comma-separated list
of Clerk user IDs allowed to self-promote:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS=clerk_user_id_1,clerk_user_id_2`

Then call the mutation `users:bootstrapMakeMeAdmin` while signed in.

## AI summary generation environment

Set the OpenAI API key in Convex dashboard environment variables:

- `OPENAI_API_KEY=your_openai_api_key`

This key is used by `summaryGeneration:generateSummaryForDay` via an internal Convex action.

## Startup env validation

Convex backend startup now fails fast when required env variables are missing,
empty, malformed, or placeholder values:

- `CLERK_JWT_ISSUER_DOMAIN` (required https URL)
- `CLERK_WEBHOOK_SECRET` (required, must start with `whsec_`)
- `OPENAI_API_KEY` (required, must start with `sk-`)

Optional:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS` (if set, must contain real Clerk IDs)

If you see an `[env:convex]` startup error, fix the listed variables in Convex
dashboard environment settings and restart `convex dev`.
