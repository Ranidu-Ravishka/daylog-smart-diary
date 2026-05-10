import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useConvexAuth, useAction, useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import type { GenericId } from "convex/values";
import { captureException } from "@/lib/observability";
import { MOOD_EMOJI, MOOD_LABELS } from "@repo/ui/lib/constants";
import {
  Spacing,
  Typography,
  Radius,
  Shadows,
  type ThemeColors,
} from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";
import { AppCard } from "@/components/ui/app-card";
import { AppButton } from "@/components/ui/app-button";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatLastSyncTime,
  formatRelativeElapsed,
} from "@/lib/format-sync-status";
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
  _id: GenericId<"daySummaries">;
  dayKey: string;
  story: string;
  highlights: string[];
  metrics?: {
    steps?: number;
    sleepMinutes?: number;
    screenTimeMinutes?: number;
    spendingTotal?: number;
  };
  sourcesUsed?: string[];
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
  const generateInsightNarrative = useAction(
    api.personalInsights.generateInsightNarrative,
  );
  const upsertSummary = useMutation(api.summaries.upsertSummary);
  const deleteSummary = useMutation(api.summaries.deleteSummary);

  const [aiNarrative, setAiNarrative] = useState<{
    narrative: string;
    highlights: string[];
    anomalies: string[];
    recommendedFocus: string[];
    generatedAt: number;
  } | null>(null);
  const [aiNarrativeLoading, setAiNarrativeLoading] = useState(false);
  const [aiNarrativeError, setAiNarrativeError] = useState<string | null>(null);

  const [editingSummary, setEditingSummary] = useState<{
    summary: SummaryDoc;
    storyDraft: string;
    highlightsDraft: string;
  } | null>(null);
  const [isSummarySaving, setIsSummarySaving] = useState(false);
  const [isSummaryDeleting, setIsSummaryDeleting] = useState(false);

  const handleGenerateAiNarrative = useCallback(async () => {
    if (!isAuthenticated || aiNarrativeLoading) return;
    setAiNarrativeLoading(true);
    setAiNarrativeError(null);
    try {
      const result = await generateInsightNarrative({ windowDays: 14 });
      setAiNarrative({
        narrative: result.narrative,
        highlights: result.highlights,
        anomalies: result.anomalies,
        recommendedFocus: result.recommendedFocus,
        generatedAt: result.generatedAt,
      });
    } catch (error) {
      captureException("mobile_insight_narrative_failed", error, {
        status: "failed",
      });
      setAiNarrativeError(
        error instanceof Error
          ? error.message
          : "Failed to generate AI narrative.",
      );
    } finally {
      setAiNarrativeLoading(false);
    }
  }, [generateInsightNarrative, isAuthenticated, aiNarrativeLoading]);

  const handleSaveStory = useCallback(async () => {
    if (!editingSummary) return;
    const story = editingSummary.storyDraft.trim();
    if (!story) {
      Alert.alert("Story required", "Please write something for this day.");
      return;
    }
    const highlights = editingSummary.highlightsDraft
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    setIsSummarySaving(true);
    try {
      await upsertSummary({
        dayKey: editingSummary.summary.dayKey,
        story,
        highlights,
        metrics: editingSummary.summary.metrics,
        sourcesUsed: editingSummary.summary.sourcesUsed ?? [],
      });
      setEditingSummary(null);
    } catch (error) {
      captureException("mobile_summary_update_failed", error, {
        summaryId: editingSummary.summary._id,
      });
      Alert.alert("Error", "Could not update this story.");
    } finally {
      setIsSummarySaving(false);
    }
  }, [editingSummary, upsertSummary]);

  const handleDeleteStory = useCallback(
    (summary: SummaryDoc) => {
      Alert.alert(
        "Delete this story?",
        `Remove the day story for ${summary.dayKey}? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setIsSummaryDeleting(true);
              try {
                await deleteSummary({ summaryId: summary._id });
                setEditingSummary(null);
              } catch (error) {
                captureException("mobile_summary_delete_failed", error, {
                  summaryId: summary._id,
                });
                Alert.alert("Error", "Could not delete this story.");
              } finally {
                setIsSummaryDeleting(false);
              }
            },
          },
        ],
      );
    },
    [deleteSummary],
  );

  const isRefreshDataReady =
    !isAuthenticated || (summaries !== undefined && memories !== undefined);

  const isLoading = isAuthLoading || (isAuthenticated && !isRefreshDataReady);

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
    }, 30_000);

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

  const memoriesByDayKey = React.useMemo(() => {
    const grouped = new Map<string, MemoryDoc[]>();
    for (const memory of resolvedMemories) {
      const current = grouped.get(memory.dayKey);
      if (current) {
        current.push(memory);
      } else {
        grouped.set(memory.dayKey, [memory]);
      }
    }
    return grouped;
  }, [resolvedMemories]);

  // Derive mood trends (last 7 days)
  const moodTrendsData = React.useMemo(() => {
    const dayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - (6 - i));
      const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const dayOfWeek =
        dayLabels[date.getDay() === 0 ? 6 : date.getDay() - 1] ?? "?";

      const dayMemories = memoriesByDayKey.get(dayKey) ?? [];
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
  }, [memoriesByDayKey]);

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

  if (isLoading) return <InsightsSkeleton />;

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
            <Ionicons name="happy-outline" size={20} color={c.tint} />
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

        {/* ── AI Narrative ────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="AI Narrative"
            action={
              aiNarrative
                ? `Updated ${formatRelativeElapsed(aiNarrative.generatedAt, relativeNow)}`
                : "AI-generated"
            }
          />
          <AppCard>
            {aiNarrative ? (
              <>
                <Text style={styles.aiNarrativeBody}>
                  {aiNarrative.narrative}
                </Text>
                {aiNarrative.highlights.length > 0 && (
                  <View style={styles.aiNarrativeSection}>
                    <Text style={styles.aiNarrativeSubtitle}>Highlights</Text>
                    {aiNarrative.highlights.map((item, index) => (
                      <Text
                        key={`hl-${index}`}
                        style={styles.aiNarrativeBullet}
                      >
                        • {item}
                      </Text>
                    ))}
                  </View>
                )}
                {aiNarrative.anomalies.length > 0 && (
                  <View style={styles.aiNarrativeSection}>
                    <Text style={styles.aiNarrativeSubtitle}>Anomalies</Text>
                    {aiNarrative.anomalies.map((item, index) => (
                      <Text
                        key={`an-${index}`}
                        style={styles.aiNarrativeBullet}
                      >
                        • {item}
                      </Text>
                    ))}
                  </View>
                )}
                {aiNarrative.recommendedFocus.length > 0 && (
                  <View style={styles.aiNarrativeSection}>
                    <Text style={styles.aiNarrativeSubtitle}>
                      Focus for tomorrow
                    </Text>
                    {aiNarrative.recommendedFocus.map((item, index) => (
                      <Text
                        key={`rec-${index}`}
                        style={styles.aiNarrativeBullet}
                      >
                        • {item}
                      </Text>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.aiNarrativeBody}>
                Generate an AI-written summary of your last 14 days with trend
                and anomaly detection.
              </Text>
            )}

            {aiNarrativeError ? (
              <Text style={styles.aiNarrativeError}>{aiNarrativeError}</Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.aiNarrativeButton,
                aiNarrativeLoading && styles.aiNarrativeButtonDisabled,
              ]}
              onPress={handleGenerateAiNarrative}
              disabled={aiNarrativeLoading}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={
                aiNarrative
                  ? "Regenerate AI narrative"
                  : "Generate AI narrative"
              }
            >
              {aiNarrativeLoading ? (
                <ActivityIndicator color={c.inverseText} />
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color={c.inverseText} />
                  <Text style={styles.aiNarrativeButtonText}>
                    {aiNarrative ? "Regenerate" : "Generate AI narrative"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </AppCard>
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
                  <Text
                    style={styles.distEmoji}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {MOOD_EMOJI[mood] ?? "❓"}
                  </Text>
                  <Text style={styles.distLabel}>
                    {MOOD_LABELS[mood] ??
                      mood.charAt(0).toUpperCase() + mood.slice(1)}
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
                  <Pressable
                    key={s._id}
                    style={({ pressed }) => [
                      styles.storyRow,
                      idx < Math.min(resolvedSummaries.length, 5) - 1 &&
                        styles.storyBorder,
                      pressed && styles.storyRowPressed,
                    ]}
                    onPress={() =>
                      setEditingSummary({
                        summary: s,
                        storyDraft: s.story,
                        highlightsDraft: (s.highlights ?? []).join(", "),
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Open day story for ${s.dayKey}`}
                  >
                    <View style={styles.storyHeader}>
                      <Text style={styles.storyDate}>{s.dayKey}</Text>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={c.textTertiary}
                      />
                    </View>
                    <Text style={styles.storyText} numberOfLines={2}>
                      {s.story}
                    </Text>
                    {s.highlights && s.highlights.length > 0 && (
                      <Text style={styles.storyHighlights}>
                        {s.highlights.length} highlight
                        {s.highlights.length > 1 ? "s" : ""}
                      </Text>
                    )}
                  </Pressable>
                ))}
            </AppCard>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <Modal
        visible={editingSummary !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingSummary(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.editBackdrop}
        >
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setEditingSummary(null)}
          />
          <View style={styles.editSheet}>
            <View style={styles.editHandle} />
            <View style={styles.editHeaderRow}>
              <Text style={styles.editTitle}>
                {editingSummary?.summary.dayKey ?? "Edit story"}
              </Text>
              <Pressable
                onPress={() => setEditingSummary(null)}
                accessibilityLabel="Close story editor"
                accessibilityRole="button"
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={c.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.editScrollWrap}
              contentContainerStyle={styles.editScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.editLabel}>Story</Text>
              <TextInput
                style={[styles.editInput, styles.editTextArea]}
                value={editingSummary?.storyDraft ?? ""}
                onChangeText={(value) =>
                  setEditingSummary((current) =>
                    current ? { ...current, storyDraft: value } : current,
                  )
                }
                multiline
                placeholder="Write the story for this day…"
                placeholderTextColor={c.textTertiary}
                accessibilityLabel="Story text"
              />

              <Text style={[styles.editLabel, { marginTop: Spacing.md }]}>
                Highlights (comma separated)
              </Text>
              <TextInput
                style={styles.editInput}
                value={editingSummary?.highlightsDraft ?? ""}
                onChangeText={(value) =>
                  setEditingSummary((current) =>
                    current ? { ...current, highlightsDraft: value } : current,
                  )
                }
                placeholder="e.g. Coffee with Sarah, finished sprint"
                placeholderTextColor={c.textTertiary}
                accessibilityLabel="Story highlights"
              />
            </ScrollView>
            <View style={styles.editActions}>
              <AppButton
                title="Delete"
                variant="secondary"
                onPress={() =>
                  editingSummary && handleDeleteStory(editingSummary.summary)
                }
                loading={isSummaryDeleting}
                disabled={isSummaryDeleting}
                size="md"
                style={{ flex: 1 }}
              />
              <AppButton
                title="Save"
                onPress={handleSaveStory}
                loading={isSummarySaving}
                disabled={isSummarySaving || !editingSummary?.storyDraft.trim()}
                size="md"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
      borderWidth: 1,
      borderColor: c.border,
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

    // AI Narrative
    aiNarrativeBody: {
      ...Typography.body,
      color: c.text,
    },
    aiNarrativeSection: {
      marginTop: Spacing.md,
    },
    aiNarrativeSubtitle: {
      ...Typography.caption1,
      color: c.textSecondary,
      marginBottom: Spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    aiNarrativeBullet: {
      ...Typography.callout,
      color: c.text,
      marginBottom: 2,
    },
    aiNarrativeError: {
      ...Typography.caption1,
      color: c.error,
      marginTop: Spacing.md,
    },
    aiNarrativeButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
      backgroundColor: c.tint,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.lg,
    },
    aiNarrativeButtonDisabled: {
      opacity: 0.7,
    },
    aiNarrativeButtonText: {
      ...Typography.bodyMedium,
      color: c.inverseText,
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
    storyRowPressed: {
      backgroundColor: c.surfaceSecondary,
    },
    storyBorder: {
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    storyHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 4,
    },
    storyDate: {
      ...Typography.caption1,
      color: c.textTertiary,
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

    // Story edit modal
    editBackdrop: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "flex-end",
    },
    editSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: Radius.xl,
      borderTopRightRadius: Radius.xl,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: c.border,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.lg,
      maxHeight: "92%",
    },
    editHandle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: Spacing.md,
    },
    editHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing.md,
    },
    editTitle: {
      ...Typography.title3,
      color: c.text,
    },
    editScrollWrap: {
      flexGrow: 0,
    },
    editScrollContent: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.lg,
      gap: 4,
    },
    editLabel: {
      ...Typography.label,
      color: c.textSecondary,
      marginBottom: Spacing.xs,
    },
    editInput: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 48,
      ...Typography.body,
      color: c.text,
      backgroundColor: c.surface,
    },
    editTextArea: {
      minHeight: 140,
      textAlignVertical: "top",
      paddingTop: Spacing.md,
    },
    editActions: {
      flexDirection: "row",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.divider,
    },
  });
}
