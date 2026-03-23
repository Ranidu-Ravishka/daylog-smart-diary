# Convex Multi-App Setup Guide

This monorepo shares a single Convex backend (`packages/backend`) across three applications:

- **Web** (Next.js on port 3000)
- **Admin** (Next.js on port 3001)
- **Mobile** (Expo/React Native)

## 🔐 Authentication Strategy (Final)

DayLog is standardized on **Clerk** for all clients (**Web + Admin + Mobile**) and Convex JWT verification.

- Provider used across apps: **Clerk only**
- Convex auth provider: `packages/backend/convex/auth.config.ts` (Clerk JWT issuer)
- Admin and web sign-in/sign-up routes use Clerk components
- User sync happens via:
  - Client-side sync mutation after sign-in
  - Server webhook at `POST /clerk/webhook` for Clerk user events

## 🚀 Initial Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Setup Convex

Navigate to the backend package and initialize Convex:

```bash
pnpm --filter @repo/backend dev
```

This will:

- Prompt you to login to Convex (or create an account)
- Create a new Convex project
- Generate your deployment URL
- Create `convex.json` file with your project configuration
- Start the Convex dev server

**Important:** Keep this terminal running during development!

### 3. Configure Environment Variables

After `convex dev` runs, you'll get a deployment URL. Copy it and update these files:

Copy each example file first:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
```

Never commit `.env.local` files or real credentials to git. Keep real values only in local env files and platform secret stores.

**`apps/web/.env.local`:**

```dotenv
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
```

**`apps/admin/.env.local`:**

```dotenv
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
```

**`apps/mobile/.env.local`:**

```dotenv
EXPO_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

**Convex Dashboard Environment Variables:**

```bash
CLERK_JWT_ISSUER_DOMAIN=https://your-instance.clerk.accounts.dev
CLERK_WEBHOOK_SECRET=your_clerk_webhook_secret
OPENAI_API_KEY=your_openai_api_key
```

These Convex variables are now strictly validated at startup in backend entry points:

- `CLERK_JWT_ISSUER_DOMAIN` (must be a real https URL)
- `CLERK_WEBHOOK_SECRET` (must start with `whsec_`)
- `OPENAI_API_KEY` (must start with `sk-`)

`OPENAI_API_KEY` is required for manual AI summary generation from the web dashboard.

Admin middleware also validates at startup:

- `CLERK_SECRET_KEY` (must start with `sk_test_` or `sk_live_`)
- `NEXT_PUBLIC_CONVEX_URL` (must be a real https URL)

Placeholder/example values are rejected for these startup-validated variables.

⚠️ **All three apps must use the SAME Convex URL**

## 🪝 Clerk Webhook Setup (Required)

1. In Clerk Dashboard, create a webhook endpoint pointing to:

- `https://<your-convex-deployment>.convex.site/clerk/webhook`

1. Subscribe at minimum to events:

- `user.created`
- `user.updated`
- `user.deleted`

1. Copy the signing secret from Clerk and set it as:

- `CLERK_WEBHOOK_SECRET` in Convex environment variables

The webhook implementation verifies Svix signature headers and rejects invalid signatures.

## 🏃 Running the Apps

### Option 1: Run all apps with Turbo

```bash
# From root directory
pnpm dev
```

In a separate terminal, run Convex dev:

```bash
pnpm --filter @repo/backend dev
```

### Option 2: Run Apps Individually

```bash
# Web app (port 3000)
pnpm dev:web

# Admin app (port 3001)
pnpm dev:admin

# Mobile app
pnpm dev:mobile
```

**Don't forget:** Keep `convex dev` running in `packages/backend`!

## 📁 Project Structure

```text
packages/
  backend/              # Shared Convex backend
    convex/
      memories.ts       # Memory CRUD functions
      days.ts           # Daily metadata functions
      summaryGeneration.ts  # AI summary actions
      schema.ts         # Database schema
      _generated/       # Auto-generated types and API
        api.d.ts
        api.js

apps/
  web/                  # Next.js web app
    app/
      providers.tsx     # Convex provider setup
      dashboard/        # Main authenticated experience

  admin/                # Next.js admin app
    app/
      providers.tsx     # Convex provider setup
      admin/            # Admin pages

  mobile/               # Expo mobile app
    app/
      _layout.tsx       # Convex provider setup
      (tabs)/           # Main mobile experience
```

## 💡 Using Convex in Your Apps

### Import the API

```typescript
import { api } from "@repo/backend/convex";
import { useQuery, useMutation, useAction } from "convex/react";
```

### Query Data

```typescript
const memories = useQuery(api.memories.listRecentMemories, {
  limit: 10,
});
```

### Mutate Data

```typescript
const updateDayRating = useMutation(api.days.updateDayRating);

const handleClick = () => {
  updateDayRating({ dayKey: "2026-03-23", rating: 4 });
};
```

### Run Actions

```typescript
const generateSummary = useAction(api.summaryGeneration.generateSummaryForDay);

const handleAction = () => {
  generateSummary({ dayKey: "2026-03-23" });
};
```

## 🧪 Testing the Setup

After starting all apps, verify authenticated flows load Convex-backed data:

1. **Web:** [http://localhost:3000](http://localhost:3000) → sign in and open dashboard
2. **Admin:** [http://localhost:3001](http://localhost:3001) → sign in and open admin pages
3. **Mobile:** Use Expo Go/simulator → sign in and open tab screens

## 📝 Adding New Convex Functions

1. Edit files in `packages/backend/convex/`
2. Convex dev server auto-regenerates types in `_generated/`
3. All apps automatically get updated TypeScript types
4. Import and use: `api.yourFile.yourFunction`

## 🔑 Key Points

- **One Backend, Multiple Clients:** All apps connect to the same Convex deployment
- **Type Safety:** Generated TypeScript types shared across all apps
- **Hot Reload:** Changes in Convex functions automatically update in all apps
- **Monorepo Benefits:** Shared code, consistent APIs, single source of truth

## 🐛 Troubleshooting

### Module not found errors

Run `pnpm install` from the root directory.

### Convex connection errors

1. Ensure `convex dev` is running in `packages/backend`
2. Verify all `.env.local` files have the correct `CONVEX_URL`
3. Check that the URL is the same in all three apps

### Startup env validation errors

If startup fails with an `[env:convex]` or `[env:admin]` error:

1. Ensure every listed variable exists and is not empty.
2. Replace placeholder/example values with real secrets/URLs.
3. Verify expected formats (`whsec_` for Clerk webhook secret, `sk-` for OpenAI, `sk_test_`/`sk_live_` for Clerk secret key).
4. Restart `npx convex dev` and Next.js dev servers after updating env values.

### Type errors

1. Make sure `convex dev` regenerated the `_generated/` files
2. Restart your TypeScript server in VS Code
3. Run `pnpm install` again

## 📚 Resources

- [Convex Documentation](https://docs.convex.dev)
- [Convex with Next.js](https://docs.convex.dev/quickstart/nextjs)
- [Convex with React Native](https://docs.convex.dev/quickstart/react-native)
- [Developer workflow](workflow.md)
- [Deploy + operations runbook](DEPLOY_RUNBOOK.md)
