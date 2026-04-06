// NOTE: You can remove this file. Declaring the shape
// of the database is entirely optional in Convex.
// See https://docs.convex.dev/database/schemas.

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const encryptedSecretEnvelopeValidator = v.object({
  version: v.number(),
  algorithm: v.literal("AES-256-GCM"),
  wrappedDekAlgorithm: v.literal("AES-256-GCM"),
  keyId: v.string(),
  keyVersion: v.number(),
  encryptedValue: v.string(),
  valueIv: v.string(),
  encryptedDek: v.string(),
  dekIv: v.string(),
  createdAt: v.number(),
});

const integrationHealthStatusValidator = v.union(
  v.literal("connected"),
  v.literal("degraded"),
  v.literal("failed"),
);

const tokenValidityStatusValidator = v.union(
  v.literal("valid"),
  v.literal("expiring_soon"),
  v.literal("expired"),
  v.literal("unknown"),
);

const retentionPolicySnapshotValidator = v.object({
  key: v.string(),
  retentionDays: v.number(),
  sensitive: v.boolean(),
  enabled: v.boolean(),
});

const summaryQualityScoresValidator = v.object({
  overall: v.number(),
  length: v.number(),
  coherence: v.number(),
  duplication: v.number(),
  failure: v.number(),
});

const activityLevelValidator = v.union(
  v.literal("active"),
  v.literal("mixed"),
  v.literal("idle"),
);

const locationStayPointValidator = v.object({
  label: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  durationMinutes: v.number(),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  radiusMeters: v.optional(v.number()),
});

const integrationDailyContextValidator = v.object({
  schemaVersion: v.optional(v.number()),
  location: v.optional(
    v.object({
      mode: v.union(
        v.literal("foreground"),
        v.literal("background_controlled"),
      ),
      totalTrackedMinutes: v.optional(v.number()),
      totalDistanceMeters: v.optional(v.number()),
      stayPoints: v.optional(v.array(locationStayPointValidator)),
    }),
  ),
  fitness: v.optional(
    v.object({
      steps: v.optional(v.number()),
      distanceMeters: v.optional(v.number()),
      activeMinutes: v.optional(v.number()),
      idleMinutes: v.optional(v.number()),
      source: v.optional(v.string()),
    }),
  ),
  calendar: v.optional(
    v.object({
      meetingsCount: v.optional(v.number()),
      busyMinutes: v.optional(v.number()),
      remindersCount: v.optional(v.number()),
      eventTitles: v.optional(v.array(v.string())),
    }),
  ),
  activitySummary: v.optional(
    v.object({
      callsCount: v.optional(v.number()),
      callDurationMinutes: v.optional(v.number()),
      mood: v.optional(v.string()),
      moodConfidence: v.optional(v.number()),
      activityLevel: v.optional(activityLevelValidator),
    }),
  ),
});

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
      callLogsTrackingEnabled: v.optional(v.boolean()),
      moodDetectionFaceRecognitionEnabled: v.optional(v.boolean()),
      fitnessTrackingEnabled: v.optional(v.boolean()),
      calendarNotificationsTrackingEnabled: v.optional(v.boolean()),
      backgroundLocationTrackingEnabled: v.optional(v.boolean()),
      locationPermissionStatus: v.optional(
        v.union(
          v.literal("unknown"),
          v.literal("granted"),
          v.literal("denied"),
        ),
      ),
      locationLastUpdatedAt: v.optional(v.number()),
      locationLastArea: v.optional(v.string()),
      backgroundLocationAutoDisabledAt: v.optional(v.number()),
      backgroundLocationAutoDisableReason: v.optional(v.string()),
      backgroundLocationBatteryImpactScore: v.optional(v.number()),
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
    })
      .index("by_memory", ["memoryId"])
      .index("by_user", ["userId"]),

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
      encryptedAccessToken: v.optional(encryptedSecretEnvelopeValidator),
      encryptedRefreshToken: v.optional(encryptedSecretEnvelopeValidator),
      // Legacy plaintext fields are retained temporarily for migration.
      accessToken: v.optional(v.string()),
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
      context: v.optional(integrationDailyContextValidator),
    })
      .index("by_user_day", ["userId", "dayKey"])
      .index("by_user_provider_day", ["userId", "provider", "dayKey"])
      .index("by_user_provider", ["userId", "provider"])
      .index("by_syncedAt", ["syncedAt"])
      .index("by_provider_syncedAt", ["provider", "syncedAt"]),

    // ── Integration health snapshots/events (observability) ───────────────
    integrationProviderHealth: defineTable({
      provider: v.string(),
      status: integrationHealthStatusValidator,
      tokenValidityStatus: tokenValidityStatusValidator,
      lastSyncAt: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      totalSyncAttempts: v.number(),
      failedSyncAttempts: v.number(),
      errorRate: v.number(),
      recentOutcomes: v.array(
        v.union(v.literal("success"), v.literal("error"), v.literal("skipped")),
      ),
      recentFailures: v.array(
        v.object({
          at: v.number(),
          error: v.string(),
          dayKey: v.optional(v.string()),
          userId: v.optional(v.id("user")),
        }),
      ),
      updatedAt: v.number(),
    })
      .index("by_provider", ["provider"])
      .index("by_status_updatedAt", ["status", "updatedAt"]),

    integrationHealthEvents: defineTable({
      provider: v.string(),
      userId: v.optional(v.id("user")),
      integrationId: v.optional(v.id("integrations")),
      dayKey: v.optional(v.string()),
      outcome: v.union(
        v.literal("success"),
        v.literal("error"),
        v.literal("skipped"),
      ),
      status: integrationHealthStatusValidator,
      tokenValidityStatus: tokenValidityStatusValidator,
      error: v.optional(v.string()),
      latencyMs: v.optional(v.number()),
      at: v.number(),
    })
      .index("by_provider_at", ["provider", "at"])
      .index("by_status_at", ["status", "at"])
      .index("by_outcome_at", ["outcome", "at"]),

    // ── Data retention governance (policy + execution audit) ──────────────
    dataRetentionPolicies: defineTable({
      key: v.string(),
      retentionDays: v.number(),
      sensitive: v.boolean(),
      enabled: v.boolean(),
      updatedBy: v.optional(v.id("user")),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    dataRetentionRuns: defineTable({
      trigger: v.union(v.literal("cron"), v.literal("manual")),
      status: v.union(v.literal("success"), v.literal("error")),
      dryRun: v.boolean(),
      startedAt: v.number(),
      finishedAt: v.number(),
      policySnapshot: v.array(retentionPolicySnapshotValidator),
      deletedCounts: v.object({
        memories: v.number(),
        daySummaries: v.number(),
        integrationDailyData: v.number(),
        locationSignals: v.number(),
        summaryGenerationEvents: v.number(),
      }),
      error: v.optional(v.string()),
      actorUserId: v.optional(v.id("user")),
    })
      .index("by_startedAt", ["startedAt"])
      .index("by_status_startedAt", ["status", "startedAt"]),

    platformAuditEvents: defineTable({
      category: v.union(
        v.literal("retention"),
        v.literal("summary_quality"),
        v.literal("integration_health"),
      ),
      action: v.string(),
      actorType: v.union(
        v.literal("system"),
        v.literal("admin"),
        v.literal("user"),
      ),
      actorUserId: v.optional(v.id("user")),
      target: v.optional(v.string()),
      details: v.optional(v.string()),
      at: v.number(),
    })
      .index("by_category_at", ["category", "at"])
      .index("by_actor_at", ["actorType", "at"]),

    // ── Summary quality harness artifacts ─────────────────────────────────
    summaryGenerationEvents: defineTable({
      userId: v.id("user"),
      dayKey: v.string(),
      modelProvider: v.string(),
      modelName: v.string(),
      modelInput: v.string(),
      generatedStory: v.optional(v.string()),
      generatedHighlights: v.optional(v.array(v.string())),
      sourcesUsed: v.optional(v.array(v.string())),
      success: v.boolean(),
      failureReason: v.optional(v.string()),
      summaryId: v.optional(v.id("daySummaries")),
      createdAt: v.number(),
    })
      .index("by_createdAt", ["createdAt"])
      .index("by_user_day_createdAt", ["userId", "dayKey", "createdAt"])
      .index("by_success_createdAt", ["success", "createdAt"]),

    summaryQualityEvaluations: defineTable({
      userId: v.id("user"),
      dayKey: v.string(),
      generationEventId: v.id("summaryGenerationEvents"),
      summaryId: v.optional(v.id("daySummaries")),
      scores: summaryQualityScoresValidator,
      wordCount: v.number(),
      duplicateLineRatio: v.number(),
      flags: v.array(v.string()),
      lowQuality: v.boolean(),
      evaluatedAt: v.number(),
    })
      .index("by_evaluatedAt", ["evaluatedAt"])
      .index("by_lowQuality_evaluatedAt", ["lowQuality", "evaluatedAt"])
      .index("by_generationEventId", ["generationEventId"])
      .index("by_user_day_evaluatedAt", ["userId", "dayKey", "evaluatedAt"]),

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
