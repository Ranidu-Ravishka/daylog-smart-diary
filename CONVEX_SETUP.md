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

### 1. Install Dependencies

```powershell
pnpm install
```

### 2. Setup Convex

Navigate to the backend package and initialize Convex:

```powershell
cd packages/backend
npx convex dev
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

**`apps/web/.env.local`:**

```dotenv
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
```

**`apps/admin/.env.local`:**

```dotenv
NEXT_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
```

**`apps/mobile/.env.local`:**

```dotenv
EXPO_PUBLIC_CONVEX_URL=https://your-project.convex.cloud
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
```

**Convex Dashboard Environment Variables:**

```bash
CLERK_JWT_ISSUER_DOMAIN=https://your-instance.clerk.accounts.dev
CLERK_WEBHOOK_SECRET=whsec_xxx
```

⚠️ **All three apps must use the SAME Convex URL**

## 🪝 Clerk Webhook Setup (Required)

1. In Clerk Dashboard, create a webhook endpoint pointing to:

- `https://<your-convex-deployment>.convex.site/clerk/webhook`

1. Subscribe at minimum to events:

- `user.created`
- `user.updated`

1. Copy the signing secret from Clerk and set it as:

- `CLERK_WEBHOOK_SECRET` in Convex environment variables

The webhook implementation verifies Svix signature headers and rejects invalid signatures.

## 🏃 Running the Apps

### Option 1: Run All Apps with Turbo

```powershell
# From root directory
pnpm dev
```

### Option 2: Run Apps Individually

```powershell
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
      myFunctions.ts    # Your Convex functions
      schema.ts         # Database schema
      _generated/       # Auto-generated types and API
        api.d.ts
        api.js

apps/
  web/                  # Next.js web app
    app/
      providers.tsx     # Convex provider setup
      convex-demo.tsx   # Example usage

  admin/                # Next.js admin app
    app/
      providers.tsx     # Convex provider setup
      convex-demo.tsx   # Example usage

  mobile/               # Expo mobile app
    app/
      _layout.tsx       # Convex provider setup
    components/
      convex-demo.tsx   # Example usage
```

## 💡 Using Convex in Your Apps

### Import the API

```typescript
import { api } from "@repo/backend/convex";
import { useQuery, useMutation, useAction } from "convex/react";
```

### Query Data

```typescript
const data = useQuery(api.myFunctions.myQuery, {
  first: 42,
  second: "hello",
});
```

### Mutate Data

```typescript
const myMutation = useMutation(api.myFunctions.myMutation);

const handleClick = () => {
  myMutation({ first: 1, second: "test" });
};
```

### Run Actions

```typescript
const myAction = useAction(api.myFunctions.myAction);

const handleAction = () => {
  myAction({ first: 1, second: "test" });
};
```

## 🧪 Testing the Setup

After starting all apps, visit:

1. **Web:** [http://localhost:3000](http://localhost:3000) - Import and use `ConvexDemo` component
2. **Admin:** [http://localhost:3001](http://localhost:3001) - Import and use `ConvexDemo` component
3. **Mobile:** Use Expo Go app or simulator - Import `ConvexDemo` from components

Each app has a demo component showing:

- ✅ Live query from Convex
- ✅ Mutation capabilities
- ✅ Shared backend connection

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

### Type errors

1. Make sure `convex dev` regenerated the `_generated/` files
2. Restart your TypeScript server in VS Code
3. Run `pnpm install` again

## 📚 Resources

- [Convex Documentation](https://docs.convex.dev)
- [Convex with Next.js](https://docs.convex.dev/quickstart/nextjs)
- [Convex with React Native](https://docs.convex.dev/quickstart/react-native)
