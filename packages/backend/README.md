# Convex + TypeScript + ESLint

This template provides a minimal setup to get Convex working, with TypeScript
and ESLint.

Start by editing `convex/myFunctions.ts` and interact with your backend from the
dashboard or via the CLI:

```sh
npx convex run myFunctions:myQuery '{"first": 1, "second": "Hello"}'
```

See Convex docs at https://docs.convex.dev/home

## Setting up

```
npm create convex@latest -t bare
```

## Admin bootstrap (Clerk)

To create your first admin user (so you can access the admin app), set this
Convex environment variable (in the Convex Dashboard) to a comma-separated list
of Clerk user IDs allowed to self-promote:

- `ADMIN_BOOTSTRAP_CLERK_USER_IDS=clerk_user_id_1,clerk_user_id_2`

Then call the mutation `users:bootstrapMakeMeAdmin` while signed in.
