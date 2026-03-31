// NOTE: You can remove this file. Declaring the shape
// of the database is entirely optional in Convex.
// See https://docs.convex.dev/database/schemas.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema(
  {
    // ── CMS content (used by admin) ──────────────────────────
    content: defineTable({
      slug: v.string(),
      title: v.string(),
      body: v.string(),
    }).index("by_slug", ["slug"]),

    // ── Users ────────────────────────────────────────────────
    user: defineTable({
      clerkUserId: v.string(),
      email: v.string(),
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      isAdmin: v.optional(v.boolean()),
    })
      .index("by_clerkUserId", ["clerkUserId"])
      .index("by_email", ["email"]),

    // ── User preferences (onboarding / quick-setup) ──────────
    userPreferences: defineTable({
      clerkUserId: v.string(),
      focusAreas: v.array(v.number()),
      reminderType: v.union(v.literal("daily"), v.literal("weekly")),
      dailyTime: v.string(),
      weeklyDay: v.string(),
      formattedTime: v.string(),
      theme: v.optional(
        v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
      ),
      notificationsEnabled: v.optional(v.boolean()),
      dailySummaryEnabled: v.optional(v.boolean()),
      weeklyInsightsEnabled: v.optional(v.boolean()),
      quietHoursEnabled: v.optional(v.boolean()),
      quietHoursStart: v.optional(v.string()),
      quietHoursEnd: v.optional(v.string()),
      autoSyncIntegrations: v.optional(v.boolean()),
      defaultMemoryMood: v.optional(v.string()),
      locationTrackingEnabled: v.optional(v.boolean()),
      locationPermissionStatus: v.optional(
        v.union(
          v.literal("unknown"),
          v.literal("granted"),
          v.literal("denied"),
        ),
      ),
      locationLastUpdatedAt: v.optional(v.number()),
      locationLastArea: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_clerkUserId", ["clerkUserId"])
      .index("by_updatedAt", ["updatedAt"]),

    // ── Memories (user-created moments) ──────────────────────
    memories: defineTable({
      userId: v.id("user"),
      title: v.string(),
      description: v.optional(v.string()),
      mood: v.optional(v.string()),
      happenedAt: v.number(),
      dayKey: v.string(), // "YYYY-MM-DD" in user timezone
    })
      .index("by_user_day", ["userId", "dayKey"])
      .index("by_user_happenedAt", ["userId", "happenedAt"])
      .index("by_happenedAt", ["happenedAt"])
      .index("by_day_happenedAt", ["dayKey", "happenedAt"]),

    // ── Memory media (images/videos attached to a memory) ────
    memoryMedia: defineTable({
      memoryId: v.id("memories"),
      userId: v.id("user"),
      storageId: v.string(),
      type: v.union(v.literal("image"), v.literal("video")),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
    }).index("by_memory", ["memoryId"]),

    // ── Days (one daily record per user per day) ─────────────
    days: defineTable({
      userId: v.id("user"),
      dayKey: v.string(),
      rating: v.optional(v.number()),
      manualNotes: v.optional(v.array(v.string())),
      peopleTags: v.optional(v.array(v.string())),
    })
      .index("by_user_day", ["userId", "dayKey"])
      .index("by_dayKey", ["dayKey"]),

    // ── Day summaries (generated narrative + metrics) ────────
    daySummaries: defineTable({
      userId: v.id("user"),
      dayKey: v.string(),
      story: v.string(),
      highlights: v.array(v.string()),
      metrics: v.optional(
        v.object({
          steps: v.optional(v.number()),
          sleepMinutes: v.optional(v.number()),
          screenTimeMinutes: v.optional(v.number()),
          spendingTotal: v.optional(v.number()),
        }),
      ),
      sourcesUsed: v.array(v.string()),
      generatedAt: v.number(),
    })
      .index("by_user_day", ["userId", "dayKey"])
      .index("by_user_generatedAt", ["userId", "generatedAt"])
      .index("by_generatedAt", ["generatedAt"])
      .index("by_day_generatedAt", ["dayKey", "generatedAt"]),

    // ── Per-user quota counters for summary generation ──────
    summaryGenerationQuotas: defineTable({
      userId: v.id("user"),
      quotaDayKey: v.string(), // YYYY-MM-DD (UTC day)
      used: v.number(),
      updatedAt: v.number(),
    }).index("by_user_day", ["userId", "quotaDayKey"]),

    // ── Admin dashboard materialized global counters ───────
    adminDashboardMetrics: defineTable({
      key: v.string(),
      totalUsers: v.number(),
      totalMemories: v.number(),
      totalDays: v.number(),
      totalSummaries: v.number(),
      totalIntegrations: v.number(),
      totalPreferences: v.number(),
      totalAuditLogs: v.number(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // ── Integrations (external data-source connections) ──────
    integrations: defineTable({
      userId: v.id("user"),
      provider: v.string(),
      status: v.union(
        v.literal("connected"),
        v.literal("disconnected"),
        v.literal("error"),
      ),
      lastSyncAt: v.optional(v.number()),
      lastError: v.optional(v.string()),
      scopes: v.optional(v.array(v.string())),
      tokenRef: v.optional(v.string()),
    })
      .index("by_user_provider", ["userId", "provider"])
      .index("by_status", ["status"])
      .index("by_provider", ["provider"])
      .index("by_status_provider", ["status", "provider"]),

    // ── Server-side integration secrets (never exposed to clients) ─────
    integrationSecrets: defineTable({
      userId: v.id("user"),
      provider: v.string(),
      tokenRef: v.string(),
      accessToken: v.string(),
      refreshToken: v.optional(v.string()),
      accessTokenExpiresAt: v.optional(v.number()),
      lastRefreshAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_tokenRef", ["tokenRef"])
      .index("by_user_provider", ["userId", "provider"]),

    // ── Per-user/provider/day sync state (idempotency + retries) ──────
    integrationSyncRuns: defineTable({
      userId: v.id("user"),
      provider: v.string(),
      dayKey: v.string(),
      status: v.union(
        v.literal("in_progress"),
        v.literal("success"),
        v.literal("error"),
      ),
      startedAt: v.number(),
      updatedAt: v.number(),
      lastError: v.optional(v.string()),
    })
      .index("by_user_provider_day", ["userId", "provider", "dayKey"])
      .index("by_user_provider", ["userId", "provider"])
      .index("by_user_day_updatedAt", ["userId", "dayKey", "updatedAt"]),

    // ── Normalized per-day integration sync payloads ───────
    integrationDailyData: defineTable({
      userId: v.id("user"),
      provider: v.string(),
      dayKey: v.string(),
      syncedAt: v.number(),
      metrics: v.optional(
        v.object({
          steps: v.optional(v.number()),
          sleepMinutes: v.optional(v.number()),
          screenTimeMinutes: v.optional(v.number()),
          spendingTotal: v.optional(v.number()),
        }),
      ),
      summary: v.optional(v.string()),
      signals: v.optional(v.array(v.string())),
    })
      .index("by_user_day", ["userId", "dayKey"])
      .index("by_user_provider_day", ["userId", "provider", "dayKey"])
      .index("by_user_provider", ["userId", "provider"]),

    // ── Audit logs (admin + security) ────────────────────────
    auditLogs: defineTable({
      actorUserId: v.id("user"),
      action: v.string(),
      target: v.optional(v.string()),
      at: v.number(),
    })
      .index("by_userId", ["actorUserId"])
      .index("by_createdAt", ["at"])
      .index("by_userId_createdAt", ["actorUserId", "at"])
      .index("by_action_createdAt", ["action", "at"])
      .index("by_userId_action_createdAt", ["actorUserId", "action", "at"]),
  },
  { schemaValidation: true },
);
