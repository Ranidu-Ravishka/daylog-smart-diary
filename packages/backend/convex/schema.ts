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
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_clerkUserId", ["clerkUserId"]),

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
      .index("by_user_happenedAt", ["userId", "happenedAt"]),

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
    }).index("by_user_day", ["userId", "dayKey"]),

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
    }).index("by_user_day", ["userId", "dayKey"]),

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
      scopes: v.optional(v.array(v.string())),
      tokenRef: v.optional(v.string()),
    }).index("by_user_provider", ["userId", "provider"]),

    // ── Audit logs (admin + security) ────────────────────────
    auditLogs: defineTable({
      actorUserId: v.id("user"),
      action: v.string(),
      target: v.optional(v.string()),
      at: v.number(),
    }).index("by_actor", ["actorUserId"]),
  },
  { schemaValidation: true },
);
