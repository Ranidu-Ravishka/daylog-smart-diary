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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import {
  useQuery,
  useMutation,
  useAction,
  useConvexAuth,
  usePaginatedQuery,
} from "convex/react";
import { api } from "@repo/backend/convex";
import type { GenericId } from "convex/values";
import {
  INTEGRATION_PROVIDER_META,
  MOOD_EMOJI,
  MOOD_LABELS,
} from "@repo/ui/lib/constants";
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
  MemoryDetailSheet,
  type MemoryPatchPayload,
} from "@/components/memory/memory-detail-sheet";
import { MemoryCarousel } from "@/components/memory/memory-carousel";
import { PeopleYouMetSection } from "@/components/memory/people-you-met-section";
import type { MemoryItem } from "@/components/memory/types";
import {
  enqueueOfflineAppendDayLog,
  isLikelyTransientNetworkError,
} from "@/lib/offline-outbox";
import {
  collectAppleCalendarTimelineForDay,
  type AppleCalendarTimelineEvent,
} from "@/lib/apple-calendar-sync";
import { captureException, logInfo, logWarn } from "@/lib/observability";

type MemoryDoc = MemoryItem;

const MEMORIES_PAGE_SIZE = 20;
const SCROLL_LOAD_MORE_THRESHOLD_PX = 320;

type IntegrationDailyDataDoc = {
  _id: string;
  provider: string;
  summary?: string;
  signals?: string[];
  context?: {
    calendar?: {
      eventTitles?: string[];
    };
  };
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
      typeof candidate.thumbnailUrl === "string") &&
    (candidate.happenedAt === undefined ||
      typeof candidate.happenedAt === "number") &&
    (candidate.tags === undefined || Array.isArray(candidate.tags)) &&
    (candidate.location === undefined ||
      typeof candidate.location === "string") &&
    (candidate.linkedPeople === undefined ||
      Array.isArray(candidate.linkedPeople))
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

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const [year, month, day] = dayKey.split("-").map((value) => Number(value));
  const date = new Date(year, Math.max(0, month - 1), day);
  date.setDate(date.getDate() + deltaDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function formatDurationLabel(durationMinutes: number): string {
  if (durationMinutes < 60) {
    return `${durationMinutes}m`;
  }
  const hours = Math.floor(durationMinutes / 60);
  const remainder = durationMinutes % 60;
  return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
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
  const { isLoaded, isSignedIn } = useAuth();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const [dayKey, setDayKey] = useState(getTodayDayKey());
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
  const resolvedMemories: MemoryDoc[] = React.useMemo(() => {
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
    isLoaded && isSignedIn && isAuthenticated
      ? { dayKey, refreshToken }
      : "skip",
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
  const updateMemory = useMutation(api.memories.updateMemory);
  const deleteMemory = useMutation(api.memories.deleteMemory);

  const [manualEntry, setManualEntry] = useState("");
  const [personInput, setPersonInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [summaryGenerationError, setSummaryGenerationError] = useState<
    string | null
  >(null);
  const [refreshing, setRefreshing] = useState(false);
  const [optimisticRating, setOptimisticRating] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<MemoryDoc | null>(null);
  const [isMemorySaving, setIsMemorySaving] = useState(false);
  const [isMemoryDeleting, setIsMemoryDeleting] = useState(false);
  const [calendarTimelineEnabled, setCalendarTimelineEnabled] = useState(false);
  const [calendarTimelineEvents, setCalendarTimelineEvents] = useState<
    AppleCalendarTimelineEvent[]
  >([]);
  const [isCalendarTimelineLoading, setIsCalendarTimelineLoading] =
    useState(false);
  const [calendarTimelineError, setCalendarTimelineError] = useState<
    string | null
  >(null);
  const [calendarTimelineCached, setCalendarTimelineCached] = useState(false);

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
    }, 10_000);

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

  const handleMarkKnownPerson = useCallback(
    async (name: string) => {
      try {
        await appendDayLogEntries({
          dayKey,
          peopleTagsToAdd: [name],
        });
      } catch (err) {
        if (isLikelyTransientNetworkError(err)) {
          await enqueueOfflineAppendDayLog({
            dayKey,
            peopleTagsToAdd: [name],
          });
          Alert.alert(
            "Saved Offline",
            "Marked person as known. It will sync when online.",
          );
          return;
        }
        Alert.alert("Error", "Could not mark this person as known.");
      }
    },
    [appendDayLogEntries, dayKey],
  );

  React.useEffect(() => {
    if (!calendarTimelineEnabled) {
      return;
    }

    let active = true;
    setIsCalendarTimelineLoading(true);
    setCalendarTimelineError(null);

    collectAppleCalendarTimelineForDay(dayKey)
      .then((result) => {
        if (!active) return;
        setCalendarTimelineEvents(result.events);
        setCalendarTimelineCached(result.cached);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Could not load calendar events for this day.";
        setCalendarTimelineEvents([]);
        setCalendarTimelineCached(false);
        setCalendarTimelineError(message);
      })
      .finally(() => {
        if (!active) return;
        setIsCalendarTimelineLoading(false);
      });

    return () => {
      active = false;
    };
  }, [calendarTimelineEnabled, dayKey]);

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
  const hasRemainingSummaryQuota =
    summaryQuota === undefined ? true : summaryQuota.remaining > 0;
  const isSummaryActionDisabled =
    isGeneratingSummary || !hasSummaryInputs || !hasRemainingSummaryQuota;

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
    if (!hasRemainingSummaryQuota) {
      setSummaryGenerationError(
        "Daily summary quota reached. Please try again tomorrow.",
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
    hasRemainingSummaryQuota,
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

  const moodFromMemories =
    resolvedMemories.length > 0 ? (resolvedMemories[0]?.mood ?? null) : null;
  const moodSummaryLabel = moodFromMemories
    ? `${MOOD_EMOJI[moodFromMemories] ?? ""} ${MOOD_LABELS[moodFromMemories] ?? moodFromMemories}`.trim()
    : null;
  const availableTags = React.useMemo(() => {
    const merged = resolvedMemories.flatMap((memory) => memory.tags ?? []);
    return Array.from(new Set(merged)).slice(0, 12);
  }, [resolvedMemories]);
  const filteredMemories = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return resolvedMemories.filter((memory) => {
      const matchesQuery =
        query.length === 0 ||
        (memory.title ?? "").toLowerCase().includes(query) ||
        (memory.description ?? "").toLowerCase().includes(query);
      const matchesTag =
        selectedTag === null || (memory.tags ?? []).includes(selectedTag);
      return matchesQuery && matchesTag;
    });
  }, [resolvedMemories, searchQuery, selectedTag]);

  const sourcesUsed = summary?.sourcesUsed ?? [];
  const hasDataSources =
    sourcesUsed.length > 0 || integrationDailyData.length > 0;
  const syncStatusText = refreshing
    ? "Syncing..."
    : formatLastSyncTime(lastSyncAt, relativeNow);

  const handleSaveMemory = useCallback(
    async (memory: MemoryDoc, patch: MemoryPatchPayload) => {
      setIsMemorySaving(true);
      try {
        await updateMemory({
          memoryId: memory._id as GenericId<"memories">,
          title: patch.title,
          description: patch.description,
          location: patch.location,
          tags: patch.tags,
          linkedPeople: patch.linkedPeople,
        });
      } catch (error) {
        captureException("mobile_memory_update_failed", error, {
          memoryId: memory._id,
        });
        Alert.alert("Error", "Failed to update memory.");
      } finally {
        setIsMemorySaving(false);
      }
    },
    [updateMemory],
  );

  const handleDeleteMemory = useCallback(
    async (memory: MemoryDoc) => {
      setIsMemoryDeleting(true);
      try {
        await deleteMemory({ memoryId: memory._id as GenericId<"memories"> });
        setSelectedMemory(null);
      } catch (error) {
        captureException("mobile_memory_delete_failed", error, {
          memoryId: memory._id,
        });
        Alert.alert("Error", "Failed to delete memory.");
      } finally {
        setIsMemoryDeleting(false);
      }
    },
    [deleteMemory],
  );

  if (isLoading) return <MemorySkeleton />;

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
          <View style={styles.dayNavRow}>
            <TouchableOpacity
              onPress={() => setDayKey((prev) => shiftDayKey(prev, -1))}
              accessibilityRole="button"
              accessibilityLabel="Previous day"
            >
              <Ionicons name="chevron-back" size={18} color={c.tint} />
            </TouchableOpacity>
            <Text style={styles.dateText}>{dayKey}</Text>
            <TouchableOpacity
              onPress={() => setDayKey((prev) => shiftDayKey(prev, 1))}
              accessibilityRole="button"
              accessibilityLabel="Next day"
            >
              <Ionicons name="chevron-forward" size={18} color={c.tint} />
            </TouchableOpacity>
          </View>
          <Text style={styles.syncText}>{syncStatusText}</Text>
        </View>

        {/* ── Quick Metrics ───────────────────────────── */}
        <View style={styles.metricsRow}>
          <View style={styles.metricChip}>
            <Ionicons name="happy-outline" size={14} color={c.tint} />
            <Text style={styles.metricText}>
              {moodSummaryLabel || "No mood"}
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
              {!hasRemainingSummaryQuota ? (
                <Text style={styles.summaryBlockedHintText}>
                  You have reached today&apos;s summary limit.
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

        {/* ── Daily Timeline ───────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Daily Timeline" />
          <AppCard>
            {!calendarTimelineEnabled ? (
              <View style={{ gap: Spacing.sm }}>
                <Text style={styles.timelineHintText}>
                  Load a clean timeline of your calendar events for this day.
                </Text>
                <AppButton
                  title="Load Timeline"
                  onPress={() => setCalendarTimelineEnabled(true)}
                  variant="secondary"
                  size="md"
                  icon={
                    <Ionicons
                      name="calendar-outline"
                      size={16}
                      color={c.tint}
                    />
                  }
                />
              </View>
            ) : isCalendarTimelineLoading ? (
              <Text style={styles.timelineHintText}>Loading timeline...</Text>
            ) : calendarTimelineError ? (
              <Text style={styles.summaryErrorText}>
                {calendarTimelineError}
              </Text>
            ) : calendarTimelineEvents.length === 0 ? (
              <Text style={styles.timelineHintText}>
                No calendar events scheduled for this day.
              </Text>
            ) : (
              <View style={styles.timelineList}>
                {calendarTimelineEvents.map((event) => (
                  <View
                    key={`${event.id}-${event.startAt}`}
                    style={styles.timelineItem}
                  >
                    <View style={styles.timelineRail}>
                      <View style={styles.timelineDot} />
                      <View style={styles.timelineLine} />
                    </View>
                    <View style={styles.timelineCard}>
                      <Text style={styles.timelineTimeLabel}>
                        {event.timeLabel}
                      </Text>
                      <Text style={styles.timelineTitleText}>
                        {event.title}
                      </Text>
                      <Text style={styles.timelineMetaText}>
                        {event.isAllDay
                          ? "All-day event"
                          : `Duration ${formatDurationLabel(event.durationMinutes)}`}
                      </Text>
                    </View>
                  </View>
                ))}
                <Text style={styles.timelineCacheText}>
                  {calendarTimelineCached
                    ? "Showing cached events for this day."
                    : "Timeline synced from your calendar."}
                </Text>
              </View>
            )}
          </AppCard>
        </View>

        {/* ── Today's Memories ─────────────────────────── */}
        {resolvedMemories.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Today's Memories" />
            <TextInput
              style={styles.input}
              placeholder="Search memories..."
              placeholderTextColor={c.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {availableTags.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.filterChipsWrap}
                contentContainerStyle={{ gap: Spacing.xs }}
              >
                <TouchableOpacity
                  style={[
                    styles.filterChip,
                    selectedTag === null && styles.filterChipSelected,
                  ]}
                  onPress={() => setSelectedTag(null)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      selectedTag === null && styles.filterChipTextSelected,
                    ]}
                  >
                    All
                  </Text>
                </TouchableOpacity>
                {availableTags.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.filterChip,
                      selectedTag === tag && styles.filterChipSelected,
                    ]}
                    onPress={() => setSelectedTag(tag)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedTag === tag && styles.filterChipTextSelected,
                      ]}
                    >
                      #{tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
            <AppCard padded={false}>
              {filteredMemories.length > 0 ? (
                <MemoryCarousel
                  colors={c}
                  memories={filteredMemories}
                  onOpen={(memory) => setSelectedMemory(memory)}
                />
              ) : (
                <EmptyState
                  icon="search-outline"
                  title="No matching memories"
                  subtitle="Try a different search or tag filter."
                />
              )}
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
          <PeopleYouMetSection
            colors={c}
            isAuthenticated={isAuthenticated}
            isSaving={isSaving}
            personInput={personInput}
            peopleTags={peopleTags}
            integrationDailyData={integrationDailyData}
            onPersonInputChange={setPersonInput}
            onAddPerson={handleAddPerson}
            onRemovePerson={handleRemovePerson}
            onMarkKnownPerson={handleMarkKnownPerson}
          />
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
      <MemoryDetailSheet
        visible={Boolean(selectedMemory)}
        memory={selectedMemory}
        colors={c}
        isSaving={isMemorySaving}
        isDeleting={isMemoryDeleting}
        onClose={() => setSelectedMemory(null)}
        onSave={handleSaveMemory}
        onDelete={handleDeleteMemory}
      />
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
    dayNavRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
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
      borderWidth: 1,
      borderColor: c.border,
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
    filterChipsWrap: {
      marginTop: Spacing.sm,
      marginBottom: Spacing.md,
    },
    filterChip: {
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      backgroundColor: c.surface,
    },
    filterChipSelected: {
      borderColor: c.tint,
      backgroundColor: c.tintLight,
    },
    filterChipText: {
      ...Typography.caption1,
      color: c.textSecondary,
    },
    filterChipTextSelected: {
      color: c.tint,
      ...Typography.label,
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
    timelineHintText: {
      ...Typography.caption1,
      color: c.textSecondary,
    },
    timelineList: {
      gap: Spacing.sm,
    },
    timelineItem: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: Spacing.sm,
    },
    timelineRail: {
      width: 16,
      alignItems: "center",
    },
    timelineDot: {
      width: 8,
      height: 8,
      borderRadius: Radius.full,
      backgroundColor: c.text,
      marginTop: 8,
    },
    timelineLine: {
      width: 1,
      flex: 1,
      marginTop: 4,
      backgroundColor: c.border,
    },
    timelineCard: {
      flex: 1,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.lg,
      backgroundColor: c.surface,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      gap: 2,
    },
    timelineTimeLabel: {
      ...Typography.label,
      color: c.text,
    },
    timelineTitleText: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    timelineMetaText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
    timelineCacheText: {
      ...Typography.caption2,
      color: c.textTertiary,
      marginTop: Spacing.xs,
    },
    highlightsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      marginTop: Spacing.lg,
    },
    highlightChip: {
      backgroundColor: c.tintLight,
      borderWidth: 1,
      borderColor: c.border,
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
      borderWidth: 1,
      borderColor: c.border,
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
      backgroundColor: c.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 44,
      ...Typography.body,
      color: c.text,
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
