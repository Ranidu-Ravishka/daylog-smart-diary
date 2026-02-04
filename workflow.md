# DayLog — Development Workflow (Step-by-step)

This file is your **living roadmap** for building DayLog from today → final product.
It’s written to match your current repo:

- `packages/backend` = **shared Convex backend**
- `apps/mobile` = **Expo + Clerk** (already wired to Convex auth)
- `apps/admin` = **Next.js + Auth0** (currently separate auth from Convex)
- `apps/web` = **Next.js** (Convex client, no auth yet)

> Keep this workflow updated as you make decisions (auth provider, tables, UX scope).

---

## 0) Ground rules (do this first)

### 0.1 Define the product in 1 page

Write and keep updating a short “Product Spec” (can be in the proposal or README):

- Target user + top 3 problems DayLog solves
- Core user journeys (onboarding → daily summary → add memory → insights)
- Privacy promise (what you collect, why, retention, export/delete)
- “MVP vs V1 vs V2” feature list

### 0.2 Decide the single source of truth

- Convex is the system of record for: users, memories, day summaries, preferences, integrations.
- External sources (Health, Location, Calendar, Spending, Screen Time) are **inputs**, not your DB.

### 0.3 Choose ONE auth strategy for _all_ clients

Right now:

- Mobile uses **Clerk** and already fetches a Clerk JWT template token named `convex`.
- Backend `auth.config.ts` is configured for **Clerk**.
- Admin uses **Auth0**.

You should pick one:

**Recommended (lowest friction with current code): Standardize on Clerk**

- Use Clerk for Mobile + Admin + Web.
- Convex auth stays Clerk.

**Alternative: Standardize on Auth0**

- You must switch Convex auth to Auth0 JWT verification and update Mobile to use Auth0.

Until you unify auth, avoid writing “secure” backend logic—because admin/web/mobile identities won’t match.

---

## 1) Local setup (repeatable dev environment)

### 1.1 Install dependencies

From repo root:

```bash
pnpm install
```

### 1.2 Start Convex (keep it running)

```bash
cd packages/backend
npx convex dev
```

### 1.3 Set environment variables

Copy the Convex deployment URL into:

- `apps/web/.env.local`
  - `NEXT_PUBLIC_CONVEX_URL=...`
- `apps/admin/.env.local`
  - `NEXT_PUBLIC_CONVEX_URL=...`
- `apps/mobile/.env.local`
  - `EXPO_PUBLIC_CONVEX_URL=...`

Mobile + Clerk also needs:

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=...`

### 1.4 Run apps

From repo root:

```bash
pnpm dev
```

Or individually:

```bash
pnpm dev:web
pnpm dev:admin
pnpm dev:mobile
```

If you only want to run the backend task via Turbo:

```bash
pnpm dev:convex
```

---

## 2) Data model (tables) — design before coding UI

Convex tables live in `packages/backend/convex/schema.ts`.

### 2.1 Current tables (already in repo)

- `content` (slug, title, body) with index `by_slug`
- `documents` (demo table; safe to delete later)

### 2.2 Proposed core tables for DayLog

Use this as the blueprint. Adjust field names to your exact requirements.

#### A) `users`

Purpose: One row per signed-in user.

Suggested fields:

- `clerkUserId` (or `authSubject`) — string (unique)
- `email` — string (optional)
- `displayName` — string (optional)
- `createdAt` — number/time (Convex `_creationTime` exists already)

Indexes:

- `by_auth` on `clerkUserId`

#### B) `userPreferences`

Purpose: onboarding + quick-setup selections.

Fields:

- `userId` — Id<"users">
- `focusAreas` — array<string>
- `reminderDailyTime` — string (e.g. "20:00")
- `reminderWeeklyDay` — string
- `timezone` — string
- `notificationsEnabled` — boolean

Indexes:

- `by_user` on `userId`

#### C) `memories`

Purpose: user-created “moments”.

Fields:

- `userId` — Id<"users">
- `title` — string
- `description` — string
- `mood` — string (enum-like)
- `happenedAt` — number (timestamp)
- `dayKey` — string (e.g. "2026-02-04" in user timezone)

Indexes:

- `by_user_day` on `userId`, `dayKey`
- `by_user_happenedAt` on `userId`, `happenedAt`

#### D) `memoryMedia`

Purpose: images/videos attached to a memory.

Fields:

- `memoryId` — Id<"memories">
- `userId` — Id<"users"> (helps auth checks)
- `storageId` — string (Convex file storage)
- `type` — string ("image" | "video")
- `width`, `height` — number (optional)

Indexes:

- `by_memory` on `memoryId`

#### E) `days`

Purpose: one “daily record” per user per day.

Fields:

- `userId` — Id<"users">
- `dayKey` — string
- `rating` — number (1-5) optional
- `manualNotes` — array<string> OR a structured list of entries
- `peopleTags` — array<string> OR separate table if complex

Indexes:

- `by_user_day` on `userId`, `dayKey` (unique by convention)

#### F) `daySummaries`

Purpose: generated narrative summary + extracted facts.

Fields:

- `userId` — Id<"users">
- `dayKey` — string
- `story` — string
- `highlights` — array<string>
- `metrics` — object (steps, sleep, screenTime, spending totals, etc.)
- `sourcesUsed` — array<string>
- `generatedAt` — number

Indexes:

- `by_user_day` on `userId`, `dayKey`

#### G) `integrations`

Purpose: tokens/status for external data sources.

Fields:

- `userId` — Id<"users">
- `provider` — string ("appleHealth" | "googleCalendar" | ...)
- `status` — string ("connected" | "disconnected" | "error")
- `lastSyncAt` — number
- `scopes` — array<string>
- `tokenRef` — string (never store raw refresh tokens in plain text)

Indexes:

- `by_user_provider` on `userId`, `provider`

#### H) `auditLogs` (optional, admin + security)

Purpose: record important actions.

Fields:

- `actorUserId` — Id<"users"> (or string if system)
- `action` — string
- `target` — object
- `at` — number

---

## 3) Backend logic (Convex functions) — how to build it cleanly

Convex code lives in `packages/backend/convex/`.

### 3.1 File organization (recommended)

Create one file per domain:

- `users.ts` — create/get current user, profile updates
- `preferences.ts` — onboarding + quick setup
- `memories.ts` — CRUD memories, list by day, attach media
- `days.ts` — manual entries, rating, people tagging
- `summaries.ts` — generate/fetch daily summary
- `integrations.ts` — connect/disconnect status, sync jobs
- `admin.ts` — admin-only queries (metrics, moderation)

Keep the existing `content.ts` as “CMS content” used by admin.

### 3.2 Authorization rules (must be consistent)

Once auth is unified (Clerk or Auth0), **every mutation and private query** should:

1. Read identity: `ctx.auth.getUserIdentity()`
2. Map to your `users` table row
3. Enforce ownership: a user can only read/write their own rows
4. Enforce admin role (if needed) for admin-only endpoints

### 3.3 Backend patterns (use these consistently)

- Prefer `slug`/`dayKey`/`provider` indexes for fast lookups.
- Return stable shapes for UI (avoid UI having to guess states).
- **Use pagination for lists (memories timeline).**
- Use `actions` for external API calls (Calendar, spending APIs, AI summarization).

### 3.4 Current backend functions you already have

- `content.writeContent`, `content.getContent`, `content.getContentBySlug`, `content.updateContent`, `content.deleteContent`

This is a good pattern to follow for other domains.

---

## 4) UI implementation workflow (build feature-by-feature)

Use this loop for each feature:

1. UX: define the user story + screen states (loading/empty/error/success)
2. Data: add/adjust schema + indexes
3. Backend: implement query/mutation/action
4. UI: connect the screen using `useQuery`/`useMutation`
5. Polish: validation, optimistic UI, skeletons, accessibility
6. Test: at least one happy-path + one auth/validation failure

---

## 5) Mobile app roadmap (Expo) — turning mock screens into real data

Mobile screens currently look like UI prototypes (mock data + console logs).
Convert them to real features in this order:

### 5.1 Authentication & onboarding

- Ensure `apps/mobile/app/_layout.tsx` stays the root for Clerk + Convex auth.
- Build an onboarding state machine:
  - New user → Quick Setup → Home
  - Returning user → Home

Backend:

- `users.getOrCreateMe`
- `preferences.savePreferences`

UI/UX notes:

- Don’t block the user with long forms.
- Show progress (step indicator) and keep copy simple.

### 5.2 Add Memory (your `add-memory.tsx`)

Backend:

- `memories.createMemory`
- `memories.listMemoriesByDay`
- `memories.deleteMemory`
- `memoryMedia.generateUploadUrl` (or Convex storage flow)

UX notes:

- Disable submit until required fields valid.
- Show upload progress per image.
- If upload fails, keep draft and allow retry.

### 5.3 Daily Detail View (`memory.tsx`)

Backend:

- `days.upsertDay` (rating, manual notes, people tags)
- `summaries.getSummaryByDay`

UX notes:

- Make “manual additions” editable inline.
- Confirm destructive actions.

### 5.4 Insights (`insights.tsx`)

Backend:

- `summaries.getInsightsRange` (7/30/90 days)
- `integrations.getConnectedSources`

UX notes:

- Charts must have readable labels and accessibility.
- Show “data confidence” (what sources used, missing data).

### 5.5 Settings/Profile (`profile.tsx`)

Backend:

- `preferences.updatePreferences`
- `integrations.connectStatus`
- `users.requestDataExport` / `users.deleteAccount`

UX notes:

- Privacy-first defaults.
- Explain permissions and give control.

---

## 6) Admin app roadmap (Next.js) — governance + CMS

Admin already has a working `content` CMS at:

- `/content` list
- `/content/create`
- `/content/edit/[slug]`

Next steps:

### 6.1 Decide what “admin” means

- Is admin only for you (developer)?
- Or will there be a team (roles: admin/editor/support)?

### 6.2 Unify admin auth with the rest

If you keep Clerk:

- Replace Auth0 in `apps/admin` with Clerk.

If you keep Auth0:

- Update Convex auth to accept Auth0 JWTs and change mobile/web.

### 6.3 Add admin-only backend endpoints

- Users overview (counts, growth)
- Content moderation (memories flagged)
- Audit logs

UX notes:

- Admin needs fast tables, filters, pagination, and bulk actions.
- Always show “who/when” for edits.

---

## 7) Web app roadmap (Next.js) — landing + account + reading views

Use web for:

- Marketing/landing page
- Account dashboard
- Read-only daily summaries + exports

Implementation order:

1. Landing page + pricing/FAQ (if needed)
2. Auth + basic account page
3. Daily summary viewer (read-only)
4. Data export and privacy pages

UX notes:

- Keep web extremely fast (Core Web Vitals).
- Use consistent design tokens with mobile (colors/typography).

---

## 8) UX practices (apply everywhere)

### 8.1 Always design for states

Every screen should handle:

- Loading (skeleton preferred)
- Empty (clear next action)
- Error (human message + retry)
- Partial data (show what’s missing)

### 8.2 Accessibility & typography

- Tap targets ≥ 44px on mobile.
- Color contrast ≥ WCAG AA where possible.
- Don’t rely on color alone (icons + labels).

### 8.3 Validation and trust

- Validate at UI level and backend level.
- For sensitive permissions (location/health):
  - explain why, allow skip, allow revoke later.

### 8.4 Privacy UX (this is core to DayLog)

- “What we collect” screen (simple bullets)
- “Export my data” that actually exports
- “Delete account” that actually deletes

---

## 9) Integrations workflow (Location/Calendar/Health/Spending/Digital)

Treat integrations as a pipeline:

1. Connect (OAuth/permission)
2. Store secure token reference + status in `integrations`
3. Sync job (action) pulls raw data
4. Normalize into daily aggregates (not raw event dumps unless needed)
5. Summarize + insights use aggregates

Practical advice:

- Start with **one** integration end-to-end (e.g., Calendar), then replicate.
- Prefer daily aggregates to avoid massive tables and privacy risks.

---

## 10) Testing & quality checks

### 10.1 Minimum checks per feature

- Backend: argument validation + auth checks
- UI: happy-path + one failure state

### 10.2 Linting/Type safety

Run:

```bash
pnpm lint
pnpm typecheck
pnpm format
```

Optional per-app:

```bash
pnpm lint:web
pnpm lint:admin
pnpm lint:mobile
```

### 10.3 Data migration mindset

With Convex, schema changes are easy, but:

- keep migrations small
- add indexes early (avoid slow queries later)

---

## 11) Deployment workflow

### 11.1 Convex

- Use `convex deploy` for production deployment.
- Set environment variables in Convex dashboard.

### 11.2 Web/Admin (Vercel recommended)

- Deploy `apps/web` and `apps/admin` separately.
- Set `NEXT_PUBLIC_CONVEX_URL` per environment.

### 11.3 Mobile (Expo)

- Use EAS builds.
- Ensure production env vars are configured for EAS.

---

## 12) Suggested implementation order (the “golden path”)

If your final goal is a working DayLog product, the highest ROI order is:

1. Unify auth across apps (Clerk recommended)
2. Add `users` + `preferences` tables and wire Quick Setup to backend
3. Add `memories` + `memoryMedia` and wire Add Memory
4. Add `days` (rating/manual notes) and wire Daily Detail
5. Add `daySummaries` generation (start simple: template-based)
6. Add Insights for a 7-day range
7. Add Integrations starting with ONE provider
8. Admin: roles + moderation + audit logs
9. Privacy: export + delete account

---

## 13) Maintenance checklist (every week)

- Review schema + indexes for new queries
- Remove unused demo tables (`documents`) once real tables exist
- Keep UI consistent (colors, typography, spacing)
- Track performance (slow queries, big payloads)
- Keep auth/permissions tight

---

## Notes to future you

- If you ever feel “UI is blocked”, it usually means the **data model isn’t decided**.
- If you ever feel “backend is messy”, it usually means **auth/ownership rules aren’t consistent**.

Keep this file updated as you finalize your proposal requirements.
