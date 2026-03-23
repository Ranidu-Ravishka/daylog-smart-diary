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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import type { GenericId } from "convex/values";
import { MOOD_EMOJI } from "@repo/ui/lib/constants";
import { Colors, Spacing, Typography, Radius } from "@/constants/theme";
import { AppCard } from "@/components/ui/app-card";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton-loader";
import { EmptyState } from "@/components/ui/empty-state";
import { AppButton } from "@/components/ui/app-button";

const c = Colors.light;

type MemoryDoc = {
  _id: GenericId<"memories">;
  title: string;
  description?: string;
  mood?: string;
};

type MemoryThumbnailDoc = {
  memoryId: string;
  thumbnailUrl: string | null;
};

function isMemoryDoc(value: unknown): value is MemoryDoc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate._id === "string" &&
    typeof candidate.title === "string" &&
    (candidate.description === undefined ||
      typeof candidate.description === "string") &&
    (candidate.mood === undefined || typeof candidate.mood === "string")
  );
}

function isMemoryThumbnailDoc(value: unknown): value is MemoryThumbnailDoc {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.memoryId === "string" &&
    (candidate.thumbnailUrl === null ||
      typeof candidate.thumbnailUrl === "string")
  );
}

function getTodayDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function MemorySkeleton() {
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
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const dayKey = getTodayDayKey();

  const summary = useQuery(
    api.summaries.getSummaryByDay,
    isAuthenticated ? { dayKey } : "skip",
  );
  const memories = useQuery(
    api.memories.listMemoriesByDay,
    isAuthenticated ? { dayKey } : "skip",
  );
  const resolvedMemories = React.useMemo(() => {
    if (!Array.isArray(memories)) return [];
    return memories.filter(isMemoryDoc);
  }, [memories]);
  const day = useQuery(api.days.getDay, isAuthenticated ? { dayKey } : "skip");
  const memoryIds = React.useMemo(
    () => resolvedMemories.map((memory) => memory._id),
    [resolvedMemories],
  );
  const rawMemoryThumbnails = useQuery(
    api.memories.listMemoryMediaThumbnailsForMemories,
    isAuthenticated ? { memoryIds } : "skip",
  );
  const memoryThumbnails = React.useMemo(() => {
    if (!Array.isArray(rawMemoryThumbnails)) return [];
    return rawMemoryThumbnails.filter(isMemoryThumbnailDoc);
  }, [rawMemoryThumbnails]);

  const thumbnailCacheRef = React.useRef<Map<string, string | null>>(new Map());

  React.useEffect(() => {
    for (const entry of memoryThumbnails) {
      thumbnailCacheRef.current.set(entry.memoryId, entry.thumbnailUrl);
    }
  }, [memoryThumbnails]);

  const thumbnailByMemoryId = React.useMemo(() => {
    const fromQuery = new Map(
      memoryThumbnails.map((entry) => [entry.memoryId, entry.thumbnailUrl]),
    );

    const result = new Map<string, string | null>();
    for (const id of memoryIds.map((item: string) => String(item))) {
      if (fromQuery.has(id)) {
        result.set(id, fromQuery.get(id) ?? null);
      } else if (thumbnailCacheRef.current.has(id)) {
        result.set(id, thumbnailCacheRef.current.get(id) ?? null);
      }
    }

    return result;
  }, [memoryIds, memoryThumbnails]);

  const upsertDay = useMutation(api.days.upsertDay);

  const [manualEntry, setManualEntry] = useState("");
  const [personInput, setPersonInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [optimisticRating, setOptimisticRating] = useState<number | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

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
    isAuthLoading || (isAuthenticated && memories === undefined);

  const handleRateDay = useCallback(
    async (stars: number) => {
      setOptimisticRating(stars);
      try {
        await upsertDay({ dayKey, rating: stars });
      } catch (err) {
        setOptimisticRating(null);
        console.error("Failed to rate day:", err);
      }
    },
    [dayKey, upsertDay],
  );

  const handleAddEntry = useCallback(async () => {
    if (!manualEntry.trim()) return;
    setIsSaving(true);
    try {
      const updatedNotes = [...manualNotes, manualEntry.trim()];
      await upsertDay({ dayKey, manualNotes: updatedNotes });
      setManualEntry("");
    } catch (err) {
      console.error("Failed to add entry:", err);
      Alert.alert("Error", "Failed to save entry. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [manualEntry, manualNotes, dayKey, upsertDay]);

  const handleAddPerson = useCallback(async () => {
    if (!personInput.trim()) return;
    setIsSaving(true);
    try {
      const updatedTags = [...peopleTags, personInput.trim()];
      await upsertDay({ dayKey, peopleTags: updatedTags });
      setPersonInput("");
    } catch (err) {
      console.error("Failed to add person:", err);
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [personInput, peopleTags, dayKey, upsertDay]);

  const handleRemovePerson = useCallback(
    async (index: number) => {
      try {
        const updatedTags = peopleTags.filter(
          (_: string, i: number) => i !== index,
        );
        await upsertDay({ dayKey, peopleTags: updatedTags });
      } catch (err) {
        console.error("Failed to remove person:", err);
      }
    },
    [peopleTags, dayKey, upsertDay],
  );

  if (isLoading) return <MemorySkeleton />;

  const moodFromMemories =
    resolvedMemories.length > 0 ? (resolvedMemories[0]?.mood ?? null) : null;

  const sourcesUsed = summary?.sourcesUsed ?? [];

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
          <Text style={styles.pageTitle}>Today{"'s"} Detail</Text>
          <Text style={styles.dateText}>{dayKey}</Text>
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
              {memories?.length ?? 0} memories
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
              </>
            ) : (
              <EmptyState
                icon="book-outline"
                title="No story yet"
                subtitle="Add memories and check back later for your daily narrative."
              />
            )}
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
                  {thumbnailByMemoryId.get(String(mem._id)) ? (
                    <Image
                      source={{
                        uri: thumbnailByMemoryId.get(String(mem._id))!,
                      }}
                      style={styles.memoryThumb}
                    />
                  ) : null}
                </View>
              ))}
            </AppCard>
          </View>
        ) : (
          <View style={styles.section}>
            <SectionHeader title="Today's Memories" />
            <AppCard>
              <EmptyState
                icon="time-outline"
                title="No memories today"
                subtitle="Everything is working—this day just has no memories yet. Add one to get started."
              />
            </AppCard>
          </View>
        )}

        {/* ── Data Sources ─────────────────────────────── */}
        {sourcesUsed.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Data Sources" />
            <AppCard>
              <View style={styles.sourcesWrap}>
                {sourcesUsed.map((source: string, index: number) => (
                  <View key={index} style={styles.sourceChip}>
                    <Ionicons name="link-outline" size={12} color={c.tint} />
                    <Text style={styles.sourceText}>{source}</Text>
                  </View>
                ))}
              </View>
            </AppCard>
          </View>
        )}

        {/* ── Manual Notes ─────────────────────────────── */}
        <View style={styles.section}>
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
                    color={star <= rating ? "#FBBF24" : c.textTertiary}
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

  // Sources
  sourcesWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
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
