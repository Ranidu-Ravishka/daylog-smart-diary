import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import { MOOD_EMOJI } from "@repo/ui/lib/constants";
import {
  Colors,
  Spacing,
  Typography,
  Radius,
  Shadows,
} from "@/constants/theme";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";

const c = Colors.light;
const { width } = Dimensions.get("window");
const CHART_WIDTH = width - Spacing.xl * 2 - Spacing.xl * 2; // card padding

const MOOD_VALUES: Record<string, number> = {
  happy: 75,
  excited: 90,
  loved: 85,
  peaceful: 70,
  sad: 30,
  angry: 20,
  anxious: 35,
  neutral: 50,
};

type MemoryDoc = {
  _id: string;
  dayKey: string;
  mood?: string;
};

type SummaryDoc = {
  _id: string;
  dayKey: string;
  story: string;
  highlights: string[];
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
  };
};

function isMemoryDoc(value: unknown): value is MemoryDoc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate._id === "string" &&
    typeof candidate.dayKey === "string" &&
    (candidate.mood === undefined || typeof candidate.mood === "string")
  );
}

function isSummaryDoc(value: unknown): value is SummaryDoc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate._id === "string" &&
    typeof candidate.dayKey === "string" &&
    typeof candidate.story === "string" &&
    Array.isArray(candidate.highlights)
  );
}

function InsightsSkeleton() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Skeleton width={100} height={28} />
        </View>
        <View style={styles.statsRow}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.statCard}>
              <Skeleton width={28} height={28} radius={14} />
              <Skeleton width={40} height={22} style={{ marginTop: 8 }} />
              <Skeleton width={55} height={12} style={{ marginTop: 4 }} />
            </View>
          ))}
        </View>
        <SkeletonCard lines={4} style={{ marginHorizontal: Spacing.xl }} />
        <SkeletonCard lines={3} style={{ marginHorizontal: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const InsightsScreen = () => {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const summaries = useQuery(
    api.summaries.listRecentSummaries,
    isAuthenticated ? { limit: 7 } : "skip",
  );
  const memories = useQuery(
    api.memories.listRecentMemories,
    isAuthenticated ? { limit: 30 } : "skip",
  );

  const isLoading =
    isAuthLoading || (isAuthenticated && memories === undefined);

  const resolvedSummaries = React.useMemo(() => {
    if (!Array.isArray(summaries)) return [];
    return summaries.filter(isSummaryDoc);
  }, [summaries]);

  const resolvedMemories = React.useMemo(() => {
    if (!Array.isArray(memories)) return [];
    return memories.filter(isMemoryDoc);
  }, [memories]);

  if (isLoading) return <InsightsSkeleton />;

  // Derive mood trends (last 7 days)
  const dayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const today = new Date();
  const moodTrendsData = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() - (6 - i));
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const dayOfWeek =
      dayLabels[date.getDay() === 0 ? 6 : date.getDay() - 1] ?? "?";

    const dayMemories = resolvedMemories.filter((m) => m.dayKey === dayKey);
    let value = 50;
    if (dayMemories.length > 0) {
      const moodScores = dayMemories
        .filter((m) => m.mood)
        .map((m) => MOOD_VALUES[m.mood ?? "neutral"] ?? 50);
      if (moodScores.length > 0) {
        value = Math.round(
          moodScores.reduce((a: number, b: number) => a + b, 0) /
            moodScores.length,
        );
      }
    }
    return { value, day: dayOfWeek };
  });

  const avgMood =
    moodTrendsData.length > 0
      ? (
          moodTrendsData.reduce((sum, d) => sum + d.value, 0) /
          moodTrendsData.length /
          10
        ).toFixed(1)
      : "—";

  const totalMemories = resolvedMemories.length;

  // Mood distribution
  const moodCounts: Record<string, number> = {};
  resolvedMemories.forEach((m) => {
    if (m.mood) {
      moodCounts[m.mood] = (moodCounts[m.mood] ?? 0) + 1;
    }
  });
  const topMoods = Object.entries(moodCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const maxMoodCount = topMoods.length > 0 ? topMoods[0]![1] : 1;

  // Metrics from latest summary
  const latestSummary =
    resolvedSummaries.length > 0 ? resolvedSummaries[0] : null;
  const steps = latestSummary?.metrics?.steps;
  const sleepHours = latestSummary?.metrics?.sleepMinutes
    ? (latestSummary.metrics.sleepMinutes / 60).toFixed(1)
    : null;

  const hasData = resolvedMemories.length > 0 || resolvedSummaries.length > 0;

  if (!hasData) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="analytics-outline"
            title="No Insights Yet"
            subtitle="Start adding memories to see your mood trends, stats, and patterns here."
          />
        </View>
      </SafeAreaView>
    );
  }

  const renderMoodChart = () => {
    const maxValue = Math.max(...moodTrendsData.map((d) => d.value), 1);
    const chartHeight = 120;

    return (
      <View
        style={{
          height: chartHeight,
          marginBottom: Spacing.lg,
          position: "relative",
        }}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <View
            key={pct}
            style={{
              position: "absolute",
              top: chartHeight * pct,
              left: 0,
              right: 0,
              height: 1,
              backgroundColor: c.divider,
            }}
          />
        ))}
        {/* Data points + lines */}
        {moodTrendsData.map((item, index) => {
          const nextItem = moodTrendsData[index + 1];
          const xPos = (index * CHART_WIDTH) / 6;
          const yPos = chartHeight - (item.value / maxValue) * chartHeight;

          return (
            <View
              key={index}
              style={{
                position: "absolute",
                left: xPos - 4,
                top: yPos - 4,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: c.tint,
              }}
            >
              {nextItem && (
                <View
                  style={{
                    position: "absolute",
                    height: 2,
                    backgroundColor: c.tint,
                    opacity: 0.6,
                    left: 4,
                    top: 3,
                    width: Math.sqrt(
                      Math.pow(CHART_WIDTH / 6, 2) +
                        Math.pow(
                          ((item.value - nextItem.value) / maxValue) *
                            chartHeight,
                          2,
                        ),
                    ),
                    transform: [
                      {
                        rotate: `${Math.atan2(
                          ((item.value - nextItem.value) / maxValue) *
                            chartHeight,
                          CHART_WIDTH / 6,
                        )}rad`,
                      },
                    ],
                  }}
                />
              )}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.tint}
          />
        }
      >
        {/* ── Header ──────────────────────────────────── */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>Insights</Text>
        </View>

        {/* ── Overview Stats ──────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={{ fontSize: 20 }}>😊</Text>
            <Text style={styles.statValue}>{avgMood}</Text>
            <Text style={styles.statLabel}>Avg Mood</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="document-text-outline" size={20} color={c.tint} />
            <Text style={styles.statValue}>{totalMemories}</Text>
            <Text style={styles.statLabel}>Memories</Text>
          </View>
          {steps != null ? (
            <View style={styles.statCard}>
              <Ionicons name="walk-outline" size={20} color={c.success} />
              <Text style={styles.statValue}>{steps.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Steps</Text>
            </View>
          ) : (
            <View style={styles.statCard}>
              <Ionicons name="moon-outline" size={20} color={c.warning} />
              <Text style={styles.statValue}>{sleepHours ?? "—"}</Text>
              <Text style={styles.statLabel}>Sleep (h)</Text>
            </View>
          )}
        </View>

        {/* ── Mood Trends ─────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Mood Trends" action="7 days" />
          <AppCard>
            {renderMoodChart()}
            <View style={styles.daysRow}>
              {moodTrendsData.map((item, index) => (
                <Text key={index} style={styles.dayLabel}>
                  {item.day}
                </Text>
              ))}
            </View>
          </AppCard>
        </View>

        {/* ── Mood Distribution ───────────────────────── */}
        {topMoods.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Mood Distribution" />
            <AppCard>
              {topMoods.map(([mood, count]) => (
                <View key={mood} style={styles.distRow}>
                  <Text style={styles.distEmoji}>
                    {MOOD_EMOJI[mood] ?? "❓"}
                  </Text>
                  <Text style={styles.distLabel}>
                    {mood.charAt(0).toUpperCase() + mood.slice(1)}
                  </Text>
                  <View style={styles.barOuter}>
                    <View
                      style={[
                        styles.barInner,
                        { width: `${(count / maxMoodCount) * 100}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.distCount}>{count}</Text>
                </View>
              ))}
            </AppCard>
          </View>
        )}

        {/* ── Recent Stories ──────────────────────────── */}
        {resolvedSummaries.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Recent Stories" />
            <AppCard padded={false}>
              {resolvedSummaries
                .slice(0, 5)
                .map((s: SummaryDoc, idx: number) => (
                  <View
                    key={s._id}
                    style={[
                      styles.storyRow,
                      idx < Math.min(resolvedSummaries.length, 5) - 1 &&
                        styles.storyBorder,
                    ]}
                  >
                    <Text style={styles.storyDate}>{s.dayKey}</Text>
                    <Text style={styles.storyText} numberOfLines={2}>
                      {s.story}
                    </Text>
                    {s.highlights && s.highlights.length > 0 && (
                      <Text style={styles.storyHighlights}>
                        {s.highlights.length} highlight
                        {s.highlights.length > 1 ? "s" : ""}
                      </Text>
                    )}
                  </View>
                ))}
            </AppCard>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

export default InsightsScreen;

// ── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: c.background,
  },
  scroll: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing["2xl"],
  },

  // Header
  headerRow: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing["2xl"],
  },
  pageTitle: {
    ...Typography.title1,
    color: c.text,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing["2xl"],
  },
  statCard: {
    flex: 1,
    backgroundColor: c.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    alignItems: "center",
    ...Shadows.sm,
  },
  statValue: {
    ...Typography.title2,
    color: c.text,
    marginTop: Spacing.sm,
  },
  statLabel: {
    ...Typography.caption2,
    color: c.textSecondary,
    marginTop: 2,
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing["2xl"],
  },

  // Days of week
  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayLabel: {
    ...Typography.caption1,
    color: c.textSecondary,
    flex: 1,
    textAlign: "center",
  },

  // Mood distribution
  distRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  distEmoji: {
    fontSize: 16,
    marginRight: Spacing.sm,
  },
  distLabel: {
    ...Typography.callout,
    color: c.text,
    width: 72,
  },
  barOuter: {
    flex: 1,
    height: 8,
    backgroundColor: c.surfaceSecondary,
    borderRadius: Radius.full,
    marginHorizontal: Spacing.md,
    overflow: "hidden",
  },
  barInner: {
    height: "100%",
    backgroundColor: c.tint,
    borderRadius: Radius.full,
  },
  distCount: {
    ...Typography.caption1,
    color: c.textSecondary,
    width: 24,
    textAlign: "right",
  },

  // Stories
  storyRow: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  storyBorder: {
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  storyDate: {
    ...Typography.caption1,
    color: c.textTertiary,
    marginBottom: 4,
  },
  storyText: {
    ...Typography.body,
    color: c.text,
  },
  storyHighlights: {
    ...Typography.caption2,
    color: c.tint,
    marginTop: 4,
  },
});
