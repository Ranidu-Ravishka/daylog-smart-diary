import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useUser } from "@clerk/clerk-expo";
import { useQuery, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import type { GenericId } from "convex/values";
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

function getTodayDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function formatMemoryTime(timestamp: number): string {
  const d = new Date(timestamp);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
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

// ── Loading skeleton ────────────────────────────────────────
function HomeScreenSkeleton() {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Skeleton width={200} height={28} />
          <Skeleton width={36} height={36} radius={18} />
        </View>
        <View style={styles.statsRow}>
          {[1, 2, 3].map((i) => (
            <View key={i} style={styles.statCard}>
              <Skeleton width={28} height={28} radius={14} />
              <Skeleton width={40} height={22} style={{ marginTop: 8 }} />
              <Skeleton width={60} height={12} style={{ marginTop: 4 }} />
            </View>
          ))}
        </View>
        <SkeletonCard lines={4} style={{ marginHorizontal: Spacing.xl }} />
        <SkeletonCard lines={2} style={{ marginHorizontal: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Main component ──────────────────────────────────────────
const HomeScreen = () => {
  const { colors: c } = useAppTheme();
  const styles = React.useMemo(() => createStyles(c), [c]);
  const router = useRouter();
  const { user } = useUser();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const todayKey = getTodayDayKey();
  const [refreshing, setRefreshing] = React.useState(false);
  const [refreshToken, setRefreshToken] = React.useState(0);
  const [lastSyncAt, setLastSyncAt] = React.useState<number | null>(null);
  const [relativeNow, setRelativeNow] = React.useState(() => Date.now());

  const recentMemories = useQuery(
    api.memories.listRecentMemories,
    isAuthenticated ? { limit: 10, refreshToken } : "skip",
  );
  const todayDay = useQuery(
    api.days.getDay,
    isAuthenticated ? { dayKey: todayKey, refreshToken } : "skip",
  );
  const todaySummary = useQuery(
    api.summaries.getSummaryByDay,
    isAuthenticated ? { dayKey: todayKey, refreshToken } : "skip",
  );
  const memoryIds = (recentMemories ?? []).map(
    (memory: { _id: GenericId<"memories"> }) => memory._id,
  );
  const memoryThumbnails = useQuery(
    api.memories.listMemoryMediaThumbnailsForMemories,
    isAuthenticated ? { memoryIds, refreshToken } : "skip",
  ) as { memoryId: string; thumbnailUrl: string | null }[] | undefined;

  const thumbnailCacheRef = React.useRef<Map<string, string | null>>(new Map());

  React.useEffect(() => {
    if (!memoryThumbnails) return;
    for (const entry of memoryThumbnails) {
      thumbnailCacheRef.current.set(entry.memoryId, entry.thumbnailUrl);
    }
  }, [memoryThumbnails]);

  const thumbnailByMemoryId = React.useMemo(() => {
    const fromQuery = new Map(
      (memoryThumbnails ?? []).map((entry) => [
        entry.memoryId,
        entry.thumbnailUrl,
      ]),
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

  const isLoading =
    isAuthLoading || (isAuthenticated && recentMemories === undefined);

  const isRefreshDataReady =
    !isAuthenticated ||
    (recentMemories !== undefined &&
      todayDay !== undefined &&
      todaySummary !== undefined &&
      memoryThumbnails !== undefined);

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

  const onRefresh = React.useCallback(() => {
    if (refreshing) return;

    setRefreshing(true);
    setRefreshToken((value) => value + 1);
  }, [refreshing]);

  const syncStatusText = refreshing
    ? "Syncing..."
    : formatLastSyncTime(lastSyncAt, relativeNow);

  if (isLoading) return <HomeScreenSkeleton />;

  const memories = recentMemories ?? [];
  const todayMemories = memories.filter(
    (m: { dayKey: string }) => m.dayKey === todayKey,
  );
  const userName = user?.firstName ?? "there";

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
        {/* ── Header ────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.userName}>{userName}</Text>
            <Text style={styles.syncText}>{syncStatusText}</Text>
          </View>
          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => router.push("/profile")}
            activeOpacity={0.7}
          >
            <Ionicons name="person" size={18} color={c.tint} />
          </TouchableOpacity>
        </View>

        {/* ── Stats ─────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="book-outline" size={20} color={c.tint} />
            <Text style={styles.statValue}>{todayMemories.length}</Text>
            <Text style={styles.statLabel}>Memories</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="star-outline" size={20} color={c.warning} />
            <Text style={styles.statValue}>
              {todayDay?.rating ? `${todayDay.rating}/5` : "—"}
            </Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="walk-outline" size={20} color={c.success} />
            <Text style={styles.statValue}>
              {todaySummary?.metrics?.steps?.toLocaleString() ?? "—"}
            </Text>
            <Text style={styles.statLabel}>Steps</Text>
          </View>
        </View>

        {/* ── Daily Summary ─────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Today's Summary" />
          <AppCard>
            {todaySummary ? (
              <>
                <Text style={styles.summaryText}>{todaySummary.story}</Text>
                {todaySummary.highlights.length > 0 && (
                  <View style={styles.highlightsWrap}>
                    {todaySummary.highlights.map((h: string, i: number) => (
                      <View key={i} style={styles.highlightChip}>
                        <Text style={styles.highlightText}>{h}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <EmptyState
                icon="sunny-outline"
                title="No summary yet"
                subtitle="Generate your day story from the Memory tab using your memories and connected integrations."
                actionLabel="Generate now"
                onAction={() => router.push("/memory")}
              />
            )}
          </AppCard>
        </View>

        {/* ── Quick Actions ─────────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader title="Quick Actions" />
          <View style={styles.actionsRow}>
            {[
              {
                icon: "add-circle-outline" as const,
                label: "Add",
                route: "/add-memory",
              },
              {
                icon: "today-outline" as const,
                label: "Today",
                route: "/memory",
              },
              {
                icon: "bar-chart-outline" as const,
                label: "Insights",
                route: "/insights",
              },
              {
                icon: "settings-outline" as const,
                label: "Settings",
                route: "/profile",
              },
            ].map((a, i) => (
              <TouchableOpacity
                key={i}
                style={styles.actionItem}
                onPress={() =>
                  router.push(
                    a.route as
                      | "/add-memory"
                      | "/memory"
                      | "/insights"
                      | "/profile",
                  )
                }
                activeOpacity={0.7}
              >
                <View style={styles.actionIcon}>
                  <Ionicons name={a.icon} size={22} color={c.tint} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Recent Memories ───────────────────────────── */}
        <View style={styles.section}>
          <SectionHeader
            title="Recent Memories"
            action={memories.length > 0 ? "See all" : undefined}
            onAction={() => router.push("/memory")}
          />
          {memories.length === 0 ? (
            <AppCard>
              <EmptyState
                icon="sparkles-outline"
                title="No memories yet"
                subtitle="Capture your first moment to start building your timeline."
                actionLabel="Add Memory"
                onAction={() => router.push("/add-memory")}
              />
            </AppCard>
          ) : (
            <AppCard padded={false}>
              {memories.map((mem, idx) => (
                <View
                  key={mem._id}
                  style={[
                    styles.memoryRow,
                    idx < memories.length - 1 && styles.memoryBorder,
                  ]}
                >
                  <View style={styles.moodDot}>
                    <Text style={{ fontSize: 16 }}>
                      {MOOD_EMOJI[mem.mood ?? ""] ?? "📝"}
                    </Text>
                  </View>
                  <View style={styles.memoryInfo}>
                    <Text style={styles.memoryTitle} numberOfLines={1}>
                      {mem.title ?? "Untitled memory"}
                    </Text>
                    {mem.mood && (
                      <Text style={styles.memoryMood}>{mem.mood}</Text>
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
                  <View style={styles.memoryTime}>
                    <Text style={styles.timeText}>
                      {formatMemoryTime(mem.happenedAt)}
                    </Text>
                    <Text style={styles.dayText}>{mem.dayKey}</Text>
                  </View>
                </View>
              ))}
            </AppCard>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

export default HomeScreen;

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
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing["2xl"],
    },
    greeting: {
      ...Typography.callout,
      color: c.textSecondary,
    },
    userName: {
      ...Typography.title1,
      color: c.text,
      marginTop: 2,
    },
    syncText: {
      ...Typography.caption2,
      color: c.textSecondary,
      marginTop: 4,
    },
    avatarBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.tintLight,
      alignItems: "center",
      justifyContent: "center",
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

    // Summary
    summaryText: {
      ...Typography.body,
      color: c.text,
      marginBottom: Spacing.md,
    },
    highlightsWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
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

    // Quick Actions
    actionsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    actionItem: {
      alignItems: "center",
      flex: 1,
    },
    actionIcon: {
      width: 52,
      height: 52,
      borderRadius: 16,
      backgroundColor: c.tintLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.sm,
    },
    actionLabel: {
      ...Typography.caption1,
      color: c.textSecondary,
    },

    // Memory list
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
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: c.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: Spacing.md,
    },
    memoryInfo: {
      flex: 1,
    },
    memoryTitle: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    memoryMood: {
      ...Typography.caption2,
      color: c.textTertiary,
      marginTop: 2,
      textTransform: "capitalize",
    },
    memoryTime: {
      alignItems: "flex-end",
      marginLeft: Spacing.md,
    },
    memoryThumb: {
      width: 36,
      height: 36,
      borderRadius: Radius.sm,
      marginLeft: Spacing.sm,
      backgroundColor: c.surfaceSecondary,
    },
    timeText: {
      ...Typography.caption1,
      color: c.textSecondary,
    },
    dayText: {
      ...Typography.caption2,
      color: c.textTertiary,
      marginTop: 2,
    },
  });
}
