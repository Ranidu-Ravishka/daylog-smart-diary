import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  useMutation,
  useAction,
  useConvexAuth,
  usePaginatedQuery,
} from "convex/react";
import { api } from "@repo/backend/convex";
import type { GenericId } from "convex/values";
import { INTEGRATION_PROVIDER_META, MOOD_EMOJI } from "@repo/ui/lib/constants";
import {
  Spacing,
  Typography,
  Radius,
  type ThemeColors,
} from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";
import { AppButton } from "@/components/ui/app-button";
import {
  enqueueOfflineAppendDayLog,
  isLikelyTransientNetworkError,
} from "@/lib/offline-outbox";
import { captureException, logInfo, logWarn } from "@/lib/observability";

type MemoryDoc = {
  _id: GenericId<"memories">;
  title: string;
  description?: string;
  mood?: string;
  thumbnailUrl?: string | null;
};

const MEMORIES_PAGE_SIZE = 20;
const SCROLL_LOAD_MORE_THRESHOLD_PX = 320;

type IntegrationDailyDataDoc = {
  _id: string;
  provider: string;
  summary?: string;
  signals?: string[];
  syncedAt: number;
};

function isMemoryDoc(value: unknown): value is MemoryDoc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate._id === "string" &&
    typeof candidate.title === "string" &&
    (candidate.description === undefined ||
      typeof candidate.description === "string") &&
    (candidate.mood === undefined || typeof candidate.mood === "string") &&
    (candidate.thumbnailUrl === undefined ||
      candidate.thumbnailUrl === null ||
      typeof candidate.thumbnailUrl === "string")
  );
}

function isIntegrationDailyDataDoc(
  value: unknown,
): value is IntegrationDailyDataDoc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate._id === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.syncedAt === "number" &&
    (candidate.summary === undefined ||
      typeof candidate.summary === "string") &&
    (candidate.signals === undefined || Array.isArray(candidate.signals))
  );
}

function toProviderLabel(provider: string): string {
  if (provider === "location") return "Location (foreground)";
  if (provider === "fitness") return "Fitness";
  if (provider === "calendar") return "Calendar";
  if (provider === "activity_summary") return "Activity Summary";

  return (
    INTEGRATION_PROVIDER_META[
      provider as keyof typeof INTEGRATION_PROVIDER_META
    ]?.label ?? provider
  );
}

function getTodayDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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

function redactPotentialSecrets(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[redacted]")
    .replace(/(api key provided\s*:?\s*)[A-Za-z0-9_*.-]+/gi, "$1[redacted]");
}

function getSummaryGenerationErrorMessage(error: unknown): string {
  const fallback = "Could not generate summary right now.";
  if (!(error instanceof Error) || !error.message) return fallback;

  const rawMessage = error.message;
  const noDataSignature =
    "No memories, day metadata, or integration sync data found for this date";

  if (rawMessage.includes(noDataSignature)) {
    return "Add at least one memory, day note/rating/tag, or synced integration data before generating a summary.";
  }

  const lines = rawMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines.find(
    (line) =>
      !line.startsWith("[CONVEX ") &&
      !line.startsWith("[Request ID:") &&
      !line.startsWith("Called by client") &&
      !line.startsWith("at handler"),
  );

  if (!candidate) return fallback;

  const cleaned = candidate
    .replace(/^Uncaught Error:\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  const redacted = redactPotentialSecrets(cleaned);
  if (/OpenAI authentication failed \((401|403)\)/i.test(redacted)) {
    return "Summary generation is temporarily unavailable. Please try again later.";
  }

  return redacted || fallback;
}

function getSummaryGenerationFailureResultMessage(
  result: unknown,
): string | null {
  if (typeof result !== "object" || result === null) return null;

  const candidate = result as {
    success?: unknown;
    message?: unknown;
  };

  if (candidate.success !== false) return null;

  if (typeof candidate.message === "string" && candidate.message.trim()) {
    return candidate.message.trim();
  }

  return "Could not generate summary right now.";
}

function MemorySkeleton() {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Skeleton width={180} height={28} />
        </View>
        <View style={styles.metricsRow}>
          <Skeleton width={90} height={16} />
          <Skeleton width={90} height={16} />
        </View>
        <SkeletonCard lines={4} style={{ marginHorizontal: Spacing.xl }} />
        <SkeletonCard lines={3} style={{ marginHorizontal: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const DailyDetailView = () => {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const dayKey = getTodayDayKey();
  const scrollRef = React.useRef<ScrollView>(null);
  const manualNotesSectionYRef = React.useRef(0);
  const manualEntryInputRef = React.useRef<TextInput>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());

  const summary = useQuery(
    api.summaries.getSummaryByDay,
    isAuthenticated ? { dayKey, refreshToken } : "skip",
  );
  const {
    results: rawPaginatedMemories,
    status: memoriesStatus,
    loadMore: loadMoreMemories,
  } = usePaginatedQuery(
    api.memories.listMemoriesByDayPaginated,
    isAuthenticated ? { dayKey, refreshToken } : "skip",
    { initialNumItems: MEMORIES_PAGE_SIZE },
  );
  const resolvedMemories = React.useMemo(() => {
    if (!Array.isArray(rawPaginatedMemories)) return [];
    return rawPaginatedMemories.filter(isMemoryDoc);
  }, [rawPaginatedMemories]);
  const day = useQuery(
    api.days.getDay,
    isAuthenticated ? { dayKey, refreshToken } : "skip",
  );
  const summaryQuota = useQuery(
    api.summaries.getSummaryQuotaForDay,
    isAuthenticated ? { refreshToken } : "skip",
  );
  const rawIntegrationDailyData = useQuery(
    api.integrations.listMyIntegrationDailyDataForDay,
    isAuthenticated ? { dayKey, refreshToken } : "skip",
  );
  const generateSummaryForDay = useAction(
    api.summaryGeneration.generateSummaryForDay,
  );

  const integrationDailyData = React.useMemo(() => {
    if (!Array.isArray(rawIntegrationDailyData)) return [];
    return rawIntegrationDailyData.filter(isIntegrationDailyDataDoc);
  }, [rawIntegrationDailyData]);

  const isLoadingMoreMemories = memoriesStatus === "LoadingMore";
  const canLoadMoreMemories = memoriesStatus === "CanLoadMore";
  const loadMoreTriggeredRef = React.useRef(false);

  React.useEffect(() => {
    if (!isLoadingMoreMemories) {
      loadMoreTriggeredRef.current = false;
    }
  }, [isLoadingMoreMemories]);

  const handleMemoryScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!canLoadMoreMemories || isLoadingMoreMemories) {
        return;
      }

      if (loadMoreTriggeredRef.current) {
        return;
      }

      const { layoutMeasurement, contentOffset, contentSize } =
        event.nativeEvent;
      const distanceFromBottom =
        contentSize.height - (contentOffset.y + layoutMeasurement.height);

      if (distanceFromBottom > SCROLL_LOAD_MORE_THRESHOLD_PX) {
        return;
      }

      loadMoreTriggeredRef.current = true;
      loadMoreMemories(MEMORIES_PAGE_SIZE);
    },
    [canLoadMoreMemories, isLoadingMoreMemories, loadMoreMemories],
  );

  const upsertDay = useMutation(api.days.upsertDay);
  const appendDayLogEntries = useMutation(api.days.appendDayLogEntries);

  const [manualEntry, setManualEntry] = useState("");
  const [personInput, setPersonInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryGenerationError, setSummaryGenerationError] = useState<
    string | null
  >(null);
  const [refreshing, setRefreshing] = useState(false);
  const [optimisticRating, setOptimisticRating] = useState<number | null>(null);

  const onRefresh = useCallback(() => {
    if (refreshing) return;

    setRefreshing(true);
    setRefreshToken((value) => value + 1);
  }, [refreshing]);

  const rating = optimisticRating ?? day?.rating ?? 0;
  const peopleTags = React.useMemo(
    () => day?.peopleTags ?? [],
    [day?.peopleTags],
  );
  const manualNotes = React.useMemo(
    () => day?.manualNotes ?? [],
    [day?.manualNotes],
  );

  const isLoading =
    isAuthLoading ||
    (isAuthenticated &&
      memoriesStatus === "LoadingFirstPage" &&
      resolvedMemories.length === 0);

  const isRefreshDataReady =
    !isAuthenticated ||
    (summary !== undefined &&
      memoriesStatus !== "LoadingFirstPage" &&
      day !== undefined &&
      summaryQuota !== undefined &&
      rawIntegrationDailyData !== undefined);

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

  const handleRateDay = useCallback(
    async (stars: number) => {
      setOptimisticRating(stars);
      try {
        await appendDayLogEntries({ dayKey, rating: stars });
      } catch (err) {
        if (isLikelyTransientNetworkError(err)) {
          await enqueueOfflineAppendDayLog({
            dayKey,
            rating: stars,
          });

          Alert.alert(
            "Saved Offline",
            "Day rating was queued and will sync when online.",
          );
          return;
        }

        setOptimisticRating(null);
        captureException("mobile_day_rating_failed", err, {
          dayKey,
          stars,
        });
      }
    },
    [appendDayLogEntries, dayKey],
  );

  const handleAddEntry = useCallback(async () => {
    if (!manualEntry.trim()) return;
    setIsSaving(true);
    try {
      const note = manualEntry.trim();
      await appendDayLogEntries({
        dayKey,
        manualNotesToAdd: [note],
      });
      setManualEntry("");
    } catch (err) {
      if (isLikelyTransientNetworkError(err)) {
        await enqueueOfflineAppendDayLog({
          dayKey,
          manualNotesToAdd: [manualEntry.trim()],
        });
        setManualEntry("");
        Alert.alert(
          "Saved Offline",
          "Day note was queued and will sync when online.",
        );
        return;
      }

      captureException("mobile_day_note_add_failed", err, {
        dayKey,
      });
      Alert.alert("Error", "Failed to save entry. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [appendDayLogEntries, dayKey, manualEntry]);

  const handleAddPerson = useCallback(async () => {
    if (!personInput.trim()) return;
    setIsSaving(true);
    try {
      const person = personInput.trim();
      await appendDayLogEntries({
        dayKey,
        peopleTagsToAdd: [person],
      });
      setPersonInput("");
    } catch (err) {
      if (isLikelyTransientNetworkError(err)) {
        await enqueueOfflineAppendDayLog({
          dayKey,
          peopleTagsToAdd: [personInput.trim()],
        });
        setPersonInput("");
        Alert.alert(
          "Saved Offline",
          "Person tag was queued and will sync when online.",
        );
        return;
      }

      captureException("mobile_day_person_add_failed", err, {
        dayKey,
      });
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [appendDayLogEntries, dayKey, personInput]);

  const handleRemovePerson = useCallback(
    async (index: number) => {
      try {
        const updatedTags = peopleTags.filter(
          (_: string, i: number) => i !== index,
        );
        await upsertDay({ dayKey, peopleTags: updatedTags });
      } catch (err) {
        captureException("mobile_day_person_remove_failed", err, {
          dayKey,
          index,
        });
      }
    },
    [peopleTags, dayKey, upsertDay],
  );

  const hasDayMetadataForSummary =
    day?.rating !== undefined ||
    (day?.manualNotes?.length ?? 0) > 0 ||
    (day?.peopleTags?.length ?? 0) > 0;
  const hasSummaryInputs =
    resolvedMemories.length > 0 ||
    hasDayMetadataForSummary ||
    integrationDailyData.length > 0;
  const isSummaryActionDisabled = isGeneratingSummary || !hasSummaryInputs;

  const handleGenerateSummary = useCallback(async () => {
    if (!hasSummaryInputs) {
      logInfo("mobile_summary_generation_skipped", {
        status: "skipped",
        dayKey,
        reason: "no_input_data",
      });
      setSummaryGenerationError(
        "Add at least one memory, day note/rating/tag, or synced integration data before generating a summary.",
      );
      return;
    }

    logInfo("mobile_summary_generation_started", {
      status: "started",
      dayKey,
      memoryCount: resolvedMemories.length,
      hasDayMetadataForSummary,
      integrationDataCount: integrationDailyData.length,
    });

    setIsGeneratingSummary(true);
    setSummaryGenerationError(null);

    try {
      const result = await generateSummaryForDay({ dayKey });
      const failureMessage = getSummaryGenerationFailureResultMessage(result);
      if (failureMessage) {
        logWarn("mobile_summary_generation_result_failed", {
          status: "failed",
          dayKey,
          errorMessage: failureMessage,
        });
        setSummaryGenerationError(failureMessage);
      } else {
        logInfo("mobile_summary_generation_succeeded", {
          status: "succeeded",
          dayKey,
        });
      }
    } catch (error) {
      const message = getSummaryGenerationErrorMessage(error);
      captureException("mobile_summary_generation_failed", error, {
        status: "failed",
        dayKey,
        errorMessage: message,
      });
      setSummaryGenerationError(message);
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [
    dayKey,
    generateSummaryForDay,
    hasDayMetadataForSummary,
    hasSummaryInputs,
    integrationDailyData.length,
    resolvedMemories.length,
  ]);

  const handleJumpToManualNotes = useCallback(() => {
    const targetY = Math.max(0, manualNotesSectionYRef.current - Spacing.xl);
    scrollRef.current?.scrollTo({ y: targetY, animated: true });

    setTimeout(() => {
      manualEntryInputRef.current?.focus();
    }, 260);
  }, []);

  if (isLoading) return <MemorySkeleton />;

  const moodFromMemories =
    resolvedMemories.length > 0 ? (resolvedMemories[0]?.mood ?? null) : null;

  const sourcesUsed = summary?.sourcesUsed ?? [];
  const hasDataSources =
    sourcesUsed.length > 0 || integrationDailyData.length > 0;
  const syncStatusText = refreshing
    ? "Syncing..."
    : formatLastSyncTime(lastSyncAt, relativeNow);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={handleMemoryScroll}
        scrollEventThrottle={120}
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
          <Text style={styles.pageTitle}>Today{"'s"} Detail</Text>
          <Text style={styles.dateText}>{dayKey}</Text>
          <Text style={styles.syncText}>{syncStatusText}</Text>
        </View>

        {/* ── Quick Metrics ───────────────────────────── */}
        <View style={styles.metricsRow}>
          <View style={styles.metricChip}>
            <Ionicons name="happy-outline" size={14} color={c.tint} />
            <Text style={styles.metricText}>
              {moodFromMemories
                ? `${MOOD_EMOJI[moodFromMemories] ?? ""} ${moodFromMemories}`
                : "No mood"}
            </Text>
          </View>
          <View style={styles.metricChip}>
            <Ionicons name="document-text-outline" size={14} color={c.tint} />
            <Text style={styles.metricText}>
              {resolvedMemories.length} memories
            </Text>
          </View>
          <View style={styles.metricChip}>
            <Ionicons name="star" size={14} color={c.warning} />
            <Text style={styles.metricText}>
              {rating > 0 ? `${rating}/5` : "—"}
            </Text>
          </View>
        </View>

        {/* ── Day Story ───────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Your Day Story" />
          <AppCard>
            {summary ? (
              <>
                <Text style={styles.storyText}>{summary.story}</Text>
                {summary.highlights && summary.highlights.length > 0 && (
                  <View style={styles.highlightsWrap}>
                    {summary.highlights.map((h: string, i: number) => (
                      <View key={i} style={styles.highlightChip}>
                        <Text style={styles.highlightText}>{h}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <Text style={styles.summaryMetaText}>
                  Generated at{" "}
                  {new Date(summary.generatedAt).toLocaleTimeString()}
                </Text>
              </>
            ) : (
              <EmptyState
                icon="book-outline"
                title="No story yet"
                subtitle="Generate a summary from your memories and connected integration data."
                actionLabel="Add Memory"
                onAction={() => router.push("/add-memory")}
              />
            )}

            <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
              {!summary && !hasSummaryInputs ? (
                <AppButton
                  title="Add Day Note"
                  onPress={handleJumpToManualNotes}
                  variant="secondary"
                  size="md"
                  icon={
                    <Ionicons name="create-outline" size={16} color={c.tint} />
                  }
                />
              ) : null}

              <AppButton
                title={
                  summary
                    ? isGeneratingSummary
                      ? "Refreshing..."
                      : hasSummaryInputs
                        ? "Refresh Summary"
                        : "Add data to refresh"
                    : isGeneratingSummary
                      ? "Generating..."
                      : hasSummaryInputs
                        ? "Generate Summary"
                        : "Add data to generate"
                }
                onPress={handleGenerateSummary}
                disabled={isSummaryActionDisabled}
                loading={isGeneratingSummary}
                size="md"
              />

              {summaryQuota ? (
                <Text style={styles.summaryHintText}>
                  Daily summary quota: {summaryQuota.remaining} remaining of{" "}
                  {summaryQuota.limit}
                </Text>
              ) : null}

              {!hasSummaryInputs ? (
                <Text style={styles.summaryBlockedHintText}>
                  This day has no memories, notes, rating, people tags, or
                  synced integration data yet.
                </Text>
              ) : null}

              {summaryGenerationError ? (
                <Text style={styles.summaryErrorText}>
                  {summaryGenerationError}
                </Text>
              ) : null}
            </View>
          </AppCard>
        </View>

        {/* ── Today's Memories ─────────────────────────── */}
        {resolvedMemories.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Today's Memories" />
            <AppCard padded={false}>
              {resolvedMemories.map((mem: MemoryDoc, idx: number) => (
                <View
                  key={mem._id}
                  style={[
                    styles.memoryRow,
                    idx < resolvedMemories.length - 1 && styles.memoryBorder,
                  ]}
                >
                  <View style={styles.moodDot}>
                    <Text style={{ fontSize: 14 }}>
                      {MOOD_EMOJI[mem.mood ?? ""] ?? "📝"}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memoryTitle}>{mem.title}</Text>
                    {mem.description && (
                      <Text style={styles.memoryDesc} numberOfLines={2}>
                        {mem.description}
                      </Text>
                    )}
                  </View>
                  {mem.thumbnailUrl ? (
                    <Image
                      source={{
                        uri: mem.thumbnailUrl,
                      }}
                      style={styles.memoryThumb}
                    />
                  ) : null}
                </View>
              ))}
            </AppCard>
            {isLoadingMoreMemories ? (
              <Text style={styles.loadMoreText}>Loading more memories...</Text>
            ) : canLoadMoreMemories ? (
              <Text style={styles.loadMoreText}>Scroll to load more</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.section}>
            <SectionHeader title="Today's Memories" />
            <AppCard>
              <EmptyState
                icon="time-outline"
                title="No memories today"
                subtitle="Everything is working—this day just has no memories yet. Add one to get started."
                actionLabel="Add Memory"
                onAction={() => router.push("/add-memory")}
              />
            </AppCard>
          </View>
        )}

        {/* ── Data Sources ─────────────────────────────── */}
        {hasDataSources && (
          <View style={styles.section}>
            <SectionHeader title="Data Sources" />
            <AppCard>
              <Text style={styles.sourcesHeaderText}>
                Connected providers synced today
              </Text>
              {integrationDailyData.length > 0 ? (
                <View style={styles.sourcesWrap}>
                  {integrationDailyData.map((entry) => (
                    <View key={entry._id} style={styles.sourceChip}>
                      <Ionicons name="link-outline" size={12} color={c.tint} />
                      <Text style={styles.sourceText}>
                        {toProviderLabel(entry.provider)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.sourcesEmptyText}>
                  No provider data synced for this day.
                </Text>
              )}

              {sourcesUsed.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.sourcesHeaderText,
                      { marginTop: Spacing.md },
                    ]}
                  >
                    Sources used in the latest summary
                  </Text>
                  <View style={styles.sourcesWrap}>
                    {sourcesUsed.map((source: string, index: number) => (
                      <View key={index} style={styles.sourceChip}>
                        <Ionicons
                          name="flash-outline"
                          size={12}
                          color={c.tint}
                        />
                        <Text style={styles.sourceText}>{source}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </AppCard>
          </View>
        )}

        {/* ── Manual Notes ─────────────────────────────── */}
        <View
          style={styles.section}
          onLayout={(event) => {
            manualNotesSectionYRef.current = event.nativeEvent.layout.y;
          }}
        >
          <SectionHeader title="Manual Notes" />
          <AppCard>
            {manualNotes.length > 0 && (
              <View style={{ marginBottom: Spacing.lg }}>
                {manualNotes.map((note: string, index: number) => (
                  <View key={index} style={styles.noteRow}>
                    <View style={styles.noteBullet} />
                    <Text style={styles.noteText}>{note}</Text>
                  </View>
                ))}
              </View>
            )}
            <TextInput
              ref={manualEntryInputRef}
              style={styles.input}
              placeholder="Add what mattered today..."
              placeholderTextColor={c.textTertiary}
              value={manualEntry}
              onChangeText={setManualEntry}
              multiline
              editable={!isSaving}
            />
            <AppButton
              title={isSaving ? "" : "Add Entry"}
              onPress={handleAddEntry}
              disabled={!manualEntry.trim() || isSaving}
              loading={isSaving}
              size="md"
              style={{ marginTop: Spacing.md }}
            />
          </AppCard>
        </View>

        {/* ── People Tags ──────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="People You Met" />
          <AppCard>
            <View style={styles.personInputRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder="Name..."
                placeholderTextColor={c.textTertiary}
                value={personInput}
                onChangeText={setPersonInput}
                editable={!isSaving}
                onSubmitEditing={handleAddPerson}
              />
              <AppButton
                title="Add"
                onPress={handleAddPerson}
                variant="secondary"
                size="sm"
                disabled={!personInput.trim() || isSaving}
                style={{ marginLeft: Spacing.sm }}
              />
            </View>
            {peopleTags.length > 0 && (
              <View style={styles.tagsWrap}>
                {peopleTags.map((person: string, index: number) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.personTag}
                    onLongPress={() => handleRemovePerson(index)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="person-outline" size={12} color={c.tint} />
                    <Text style={styles.personTagText}>{person}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </AppCard>
        </View>

        {/* ── Rate Your Day ────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Rate Your Day" />
          <AppCard style={{ alignItems: "center" }}>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                  key={star}
                  onPress={() => handleRateDay(star)}
                  style={styles.starBtn}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={star <= rating ? "star" : "star-outline"}
                    size={32}
                    color={star <= rating ? c.warning : c.textTertiary}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.ratingLabel}>
              {rating === 0
                ? "Tap to rate"
                : rating === 5
                  ? "Excellent!"
                  : rating === 4
                    ? "Great"
                    : rating === 3
                      ? "Good"
                      : rating === 2
                        ? "Okay"
                        : "Not great"}
            </Text>
          </AppCard>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

export default DailyDetailView;

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
      marginBottom: Spacing.md,
    },
    pageTitle: {
      ...Typography.title1,
      color: c.text,
    },
    dateText: {
      ...Typography.callout,
      color: c.textSecondary,
      marginTop: 2,
    },
    syncText: {
      ...Typography.caption2,
      color: c.textSecondary,
      marginTop: 4,
    },

    // Metrics
    metricsRow: {
      flexDirection: "row",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing["2xl"],
      flexWrap: "wrap",
    },
    metricChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.tintLight,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    metricText: {
      ...Typography.caption1,
      color: c.tint,
    },

    // Section
    section: {
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing["2xl"],
    },

    // Story
    storyText: {
      ...Typography.body,
      color: c.text,
    },
    summaryMetaText: {
      ...Typography.caption2,
      color: c.textSecondary,
      marginTop: Spacing.md,
    },
    summaryHintText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
    summaryBlockedHintText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
    summaryErrorText: {
      ...Typography.caption2,
      color: c.error,
    },
    highlightsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      marginTop: Spacing.lg,
    },
    highlightChip: {
      backgroundColor: c.tintLight,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    highlightText: {
      ...Typography.caption1,
      color: c.tint,
    },

    // Memories list
    memoryRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.lg,
    },
    memoryBorder: {
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    moodDot: {
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: c.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: Spacing.md,
    },
    memoryTitle: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    memoryDesc: {
      ...Typography.callout,
      color: c.textSecondary,
      marginTop: 2,
    },
    memoryThumb: {
      width: 42,
      height: 42,
      borderRadius: Radius.md,
      marginLeft: Spacing.md,
      backgroundColor: c.surfaceSecondary,
    },
    loadMoreText: {
      ...Typography.caption2,
      color: c.textSecondary,
      textAlign: "center",
      marginTop: Spacing.sm,
    },

    // Sources
    sourcesWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
    },
    sourcesHeaderText: {
      ...Typography.caption,
      color: c.textSecondary,
      marginBottom: Spacing.sm,
    },
    sourcesEmptyText: {
      ...Typography.caption,
      color: c.textSecondary,
    },
    sourceChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.surfaceSecondary,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    sourceText: {
      ...Typography.caption1,
      color: c.textSecondary,
    },

    // Notes
    noteRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginBottom: Spacing.sm,
    },
    noteBullet: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.tint,
      marginTop: 7,
      marginRight: Spacing.sm,
    },
    noteText: {
      ...Typography.body,
      color: c.text,
      flex: 1,
    },
    input: {
      backgroundColor: c.inputBg,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 44,
      ...Typography.body,
      color: c.text,
    },

    // People
    personInputRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: Spacing.md,
    },
    tagsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
    },
    personTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: c.tintLight,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs + 2,
    },
    personTagText: {
      ...Typography.caption1,
      color: c.tint,
    },

    // Stars
    starsRow: {
      flexDirection: "row",
      gap: Spacing.md,
      marginBottom: Spacing.sm,
    },
    starBtn: {
      padding: 4,
    },
    ratingLabel: {
      ...Typography.callout,
      color: c.textSecondary,
    },
  });
}
