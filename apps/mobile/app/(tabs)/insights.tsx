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
  Spacing,
  Typography,
  Radius,
  Shadows,
  type ThemeColors,
} from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";
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

function formatRelativeElapsed(lastSyncAt: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - lastSyncAt) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function formatLastSyncTime(lastSyncAt: number | null, now: number): string {
  if (lastSyncAt === null) return "Last sync: pending";

  const absolute = new Date(lastSyncAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return `Last sync: ${absolute} • Updated ${formatRelativeElapsed(lastSyncAt, now)}`;
}

function InsightsSkeleton() {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);

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
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());

  const onRefresh = useCallback(() => {
    if (refreshing) return;

    setRefreshing(true);
    setRefreshToken((value) => value + 1);
  }, [refreshing]);

  const summaries = useQuery(
    api.summaries.listRecentSummaries,
    isAuthenticated ? { limit: 7, refreshToken } : "skip",
  );
  const memories = useQuery(
    api.memories.listRecentMemories,
    isAuthenticated ? { limit: 30, refreshToken } : "skip",
  );

  const isLoading =
    isAuthLoading || (isAuthenticated && memories === undefined);

  const isRefreshDataReady =
    !isAuthenticated || (summaries !== undefined && memories !== undefined);

  React.useEffect(() => {
    if (!isRefreshDataReady) return;

    setLastSyncAt((current) => current ?? Date.now());
  }, [isRefreshDataReady]);

  React.useEffect(() => {
    if (!refreshing || !isRefreshDataReady) return;

    setRefreshing(false);
    setLastSyncAt(Date.now());
  }, [isRefreshDataReady, refreshing]);

  React.useEffect(() => {
    if (lastSyncAt === null) return;

    const interval = setInterval(() => {
      setRelativeNow(Date.now());
    }, 1_000);

    return () => {
      clearInterval(interval);
    };
  }, [lastSyncAt]);

  const syncStatusText = refreshing
    ? "Syncing..."
    : formatLastSyncTime(lastSyncAt, relativeNow);

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
    let value: number | null = null;
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

  const moodValues = moodTrendsData
    .map((item) => item.value)
    .filter((value): value is number => value !== null);

  const avgMood =
    moodValues.length > 0
      ? (
          moodValues.reduce((sum, value) => sum + value, 0) /
          moodValues.length /
          10
        ).toFixed(1)
      : "—";

  const totalMemories = resolvedMemories.length;
  const summariesCount = resolvedSummaries.length;
  const moodDaysTracked = moodValues.length;

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

  const hasData = resolvedMemories.length > 0 || resolvedSummaries.length > 0;

  if (!hasData) {
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
          <View style={styles.headerRow}>
            <Text style={styles.pageTitle}>Insights</Text>
            <Text style={styles.syncText}>{syncStatusText}</Text>
          </View>
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="analytics-outline"
              title="No Insights Yet"
              subtitle="Start adding memories to see your mood trends, stats, and patterns here."
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const renderMoodChart = () => {
    const maxValue = Math.max(...moodValues, 1);
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
          if (item.value === null) {
            return (
              <View
                key={index}
                style={{
                  position: "absolute",
                  left: (index * CHART_WIDTH) / 6 - 3,
                  top: chartHeight - 3,
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: c.textTertiary,
                  opacity: 0.45,
                }}
              />
            );
          }

          const nextItem = moodTrendsData[index + 1];
          const xPos = (index * CHART_WIDTH) / 6;
          const yPos = chartHeight - (item.value / maxValue) * chartHeight;

          const canLinkToNext = nextItem?.value !== null;
          const nextValue = nextItem?.value ?? item.value;

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
              {canLinkToNext && (
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
                          ((item.value - nextValue) / maxValue) * chartHeight,
                          2,
                        ),
                    ),
                    transform: [
                      {
                        rotate: `${Math.atan2(
                          ((item.value - nextValue) / maxValue) * chartHeight,
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
          <Text style={styles.syncText}>{syncStatusText}</Text>
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
          <View style={styles.statCard}>
            <Ionicons name="sparkles-outline" size={20} color={c.warning} />
            <Text style={styles.statValue}>{summariesCount}</Text>
            <Text style={styles.statLabel}>Summaries</Text>
          </View>
        </View>

        {/* ── Mood Trends ─────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="Mood Trends"
            action={`${moodDaysTracked}/7 days with mood data`}
          />
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
function createStyles(c: ThemeColors) {
  return StyleSheet.create({
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
    syncText: {
      ...Typography.caption2,
      color: c.textSecondary,
      marginTop: 4,
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
    emptyStateWrap: {
      minHeight: 320,
      justifyContent: "center",
      paddingHorizontal: Spacing.xl,
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
}
