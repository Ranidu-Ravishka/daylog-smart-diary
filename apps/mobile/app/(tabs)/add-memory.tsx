import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import { SETTINGS_DEFAULTS } from "@repo/ui/lib/constants";
import type { GenericId } from "convex/values";
import {
  Spacing,
  Typography,
  Radius,
  type ThemeColors,
} from "@/constants/theme";
import { useAppTheme } from "@/components/theme-provider";
import { AppButton } from "@/components/ui/app-button";
import {
  enqueueOfflineCreateMemory,
  enqueueOfflineMemoryMediaUpload,
  isLikelyTransientNetworkError,
} from "@/lib/offline-outbox";
import { withOpacity } from "@/lib/color-utils";
import { captureException, logInfo } from "@/lib/observability";

function getTodayDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function createMediaClientRequestId(
  memoryClientRequestId: string,
  imageIndex: number,
): string {
  return `${memoryClientRequestId}_media_${imageIndex}`;
}

const CREATE_MEMORY_TIMEOUT_MS = 20_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timerId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

type SelectedImage = {
  uri: string;
  width?: number;
  height?: number;
  uploading: boolean;
  error: boolean;
};

type MemoryId = GenericId<"memories">;

export default function AddMemoryScreen() {
  const { colors: c } = useAppTheme();
  const styles = useMemo(() => createStyles(c), [c]);
  const router = useRouter();
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const createMemory = useMutation(api.memories.createMemory);
  const createUploadUrl = useMutation(
    api.memories.generateMemoryMediaUploadUrl,
  );
  const addMemoryMedia = useMutation(api.memories.addMemoryMedia);
  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const hasSelectedMoodManually = useRef(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [mood, setMood] = useState<string>(SETTINGS_DEFAULTS.defaultMemoryMood);
  const [tagsInput, setTagsInput] = useState("");
  const [linkedPeopleInput, setLinkedPeopleInput] = useState("");
  const [location, setLocation] = useState("");
  const [timestamp, setTimestamp] = useState(() => Date.now());
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasSelectedMoodManually.current) return;
    const preferredMood = preferences?.defaultMemoryMood?.trim();
    if (!preferredMood) return;
    setMood(preferredMood);
  }, [preferences?.defaultMemoryMood]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      const asset = result.assets[0];
      setSelectedImages((prev) => [
        ...prev,
        {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          uploading: false,
          error: false,
        },
      ]);
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadImageToConvex = async (
    imageUri: string,
    memoryId: MemoryId,
    imageMeta?: { width?: number; height?: number },
  ): Promise<boolean> => {
    try {
      const { uploadUrl } = await createUploadUrl({});
      const imageResponse = await fetch(imageUri);
      const imageBlob = await imageResponse.blob();

      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": imageBlob.type || "application/octet-stream",
        },
        body: imageBlob,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed with status ${uploadResponse.status}`);
      }

      const uploadResult = (await uploadResponse.json()) as {
        storageId?: string;
      };
      if (!uploadResult.storageId) {
        throw new Error("Upload succeeded but no storageId was returned");
      }

      await addMemoryMedia({
        memoryId,
        storageId: uploadResult.storageId,
        type: "image",
        width: imageMeta?.width,
        height: imageMeta?.height,
      });

      return true;
    } catch (err) {
      captureException("mobile_memory_image_upload_failed", err, {
        memoryId,
        hasImageMetadata: Boolean(imageMeta),
      });
      return false;
    }
  };

  const handleSubmit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    if (isAuthLoading) {
      setError("Still signing you in. Please try again in a moment.");
      return;
    }

    if (!isAuthenticated) {
      setError("You need to be signed in to save a memory.");
      return;
    }

    const happenedAt = timestamp;
    const dayKey = getTodayDayKey();
    const clientRequestId = `mobile_mem_${happenedAt}_${Math.floor(
      Math.random() * 1_000_000,
    )
      .toString()
      .padStart(6, "0")}`;

    logInfo("mobile_memory_create_started", {
      status: "started",
      dayKey,
      selectedImageCount: selectedImages.length,
      hasDescription: Boolean(description.trim()),
    });

    setIsSubmitting(true);
    setError(null);
    const parsedTags = tagsInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const parsedLinkedPeople = linkedPeopleInput
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      const memory = await withTimeout(
        createMemory({
          clientRequestId,
          title: trimmedTitle,
          description: description.trim() || undefined,
          mood,
          happenedAt,
          dayKey,
          tags: parsedTags.length > 0 ? parsedTags : undefined,
          linkedPeople:
            parsedLinkedPeople.length > 0 ? parsedLinkedPeople : undefined,
          location: location.trim() || undefined,
        }),
        CREATE_MEMORY_TIMEOUT_MS,
        "Save timed out. Please check your connection and try again.",
      );

      if (memory && selectedImages.length > 0) {
        for (let i = 0; i < selectedImages.length; i++) {
          setSelectedImages((prev) =>
            prev.map((img, idx) =>
              idx === i ? { ...img, uploading: true } : img,
            ),
          );

          const success = await uploadImageToConvex(
            selectedImages[i]!.uri,
            memory._id,
            {
              width: selectedImages[i]?.width,
              height: selectedImages[i]?.height,
            },
          );

          setSelectedImages((prev) =>
            prev.map((img, idx) =>
              idx === i ? { ...img, uploading: false, error: !success } : img,
            ),
          );
        }
      }

      setTitle("");
      setDescription("");
      setSelectedImages([]);
      setMood(
        preferences?.defaultMemoryMood ?? SETTINGS_DEFAULTS.defaultMemoryMood,
      );
      setTagsInput("");
      setLinkedPeopleInput("");
      setLocation("");
      setTimestamp(Date.now());
      hasSelectedMoodManually.current = false;

      logInfo("mobile_memory_create_succeeded", {
        status: "succeeded",
        dayKey,
        memoryId: memory?._id,
        selectedImageCount: selectedImages.length,
      });

      Alert.alert("Memory Saved", "Your memory has been captured!", [
        { text: "OK", onPress: () => router.replace("/(tabs)") },
      ]);
    } catch (err: unknown) {
      if (isLikelyTransientNetworkError(err)) {
        try {
          await enqueueOfflineCreateMemory({
            clientRequestId,
            title: trimmedTitle,
            description: description.trim() || undefined,
            mood,
            happenedAt,
            dayKey,
            tags: parsedTags.length > 0 ? parsedTags : undefined,
            linkedPeople:
              parsedLinkedPeople.length > 0 ? parsedLinkedPeople : undefined,
            location: location.trim() || undefined,
          });

          let queuedPhotoCount = 0;
          for (let index = 0; index < selectedImages.length; index += 1) {
            const image = selectedImages[index];
            if (!image?.uri?.trim()) {
              continue;
            }

            await enqueueOfflineMemoryMediaUpload({
              memoryClientRequestId: clientRequestId,
              mediaClientRequestId: createMediaClientRequestId(
                clientRequestId,
                index,
              ),
              localUri: image.uri,
              width: image.width,
              height: image.height,
            });
            queuedPhotoCount += 1;
          }

          setTitle("");
          setDescription("");
          setSelectedImages([]);
          setMood(
            preferences?.defaultMemoryMood ??
              SETTINGS_DEFAULTS.defaultMemoryMood,
          );
          setTagsInput("");
          setLinkedPeopleInput("");
          setLocation("");
          setTimestamp(Date.now());
          hasSelectedMoodManually.current = false;

          logInfo("mobile_memory_create_queued_offline", {
            status: "queued",
            dayKey,
            queuedPhotoCount,
          });

          Alert.alert(
            "Saved Offline",
            queuedPhotoCount > 0
              ? `Memory and ${queuedPhotoCount} photo(s) were queued and will sync automatically when connection is restored.`
              : "Memory was queued and will sync automatically when connection is restored.",
            [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
          );
          return;
        } catch (queueError) {
          setError(
            queueError instanceof Error
              ? queueError.message
              : "Failed to queue memory for offline sync.",
          );
          return;
        }
      }

      captureException("mobile_memory_create_failed", err, {
        status: "failed",
        dayKey,
        selectedImageCount: selectedImages.length,
      });
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const moods = [
    { id: "happy", emoji: "😊", label: "Happy" },
    { id: "sad", emoji: "😢", label: "Sad" },
    { id: "excited", emoji: "🎉", label: "Excited" },
    { id: "peaceful", emoji: "😌", label: "Peaceful" },
    { id: "loved", emoji: "❤️", label: "Loved" },
  ];

  const canSubmit =
    title.trim().length > 0 &&
    !isSubmitting &&
    !isAuthLoading &&
    isAuthenticated;

  const handleTimestampChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === "android") {
      setIsDatePickerVisible(false);
    }
    if (event.type === "dismissed" || !selectedDate) {
      return;
    }
    setTimestamp(selectedDate.getTime());
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────── */}
        <View style={styles.headerRow}>
          <Text style={styles.pageTitle}>New Memory</Text>
          <Text style={styles.pageSubtitle}>Capture this moment</Text>
        </View>

        {/* ── Error Banner ────────────────────────────── */}
        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color={c.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => setError(null)} hitSlop={8}>
              <Ionicons name="close" size={16} color={c.error} />
            </TouchableOpacity>
          </View>
        )}

        {/* ── Title ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            style={styles.input}
            placeholder="Give your memory a title"
            placeholderTextColor={c.textTertiary}
            value={title}
            onChangeText={setTitle}
            editable={!isSubmitting}
          />
        </View>

        {/* ── Description ─────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe this memory..."
            placeholderTextColor={c.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            editable={!isSubmitting}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Date & Time</Text>
          <TouchableOpacity
            style={styles.inputButton}
            onPress={() => setIsDatePickerVisible(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Edit memory date and time"
          >
            <Text style={styles.timestampValue}>
              {new Date(timestamp).toLocaleString()}
            </Text>
          </TouchableOpacity>
          {isDatePickerVisible ? (
            <DateTimePicker
              value={new Date(timestamp)}
              mode="datetime"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={handleTimestampChange}
            />
          ) : null}
        </View>

        {/* ── Mood ─────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>How are you feeling?</Text>
          <View style={styles.moodRow}>
            {moods.map((item) => {
              const isSelected = mood === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.moodBtn, isSelected && styles.moodBtnSelected]}
                  onPress={() => {
                    hasSelectedMoodManually.current = true;
                    setMood(item.id);
                  }}
                  disabled={isSubmitting}
                  activeOpacity={0.7}
                >
                  <Text style={styles.moodEmoji}>{item.emoji}</Text>
                  <Text
                    style={[
                      styles.moodLabel,
                      isSelected && styles.moodLabelSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Photos ───────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.label}>Photos</Text>
          <TouchableOpacity
            style={styles.photoBtn}
            onPress={pickImage}
            disabled={isSubmitting}
            activeOpacity={0.7}
          >
            <Ionicons name="camera-outline" size={20} color={c.tint} />
            <Text style={styles.photoBtnText}>Add Photo</Text>
          </TouchableOpacity>

          {selectedImages.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.imageScroll}
            >
              {selectedImages.map((img, index) => (
                <View key={index} style={styles.imageWrap}>
                  <Image source={{ uri: img.uri }} style={styles.imageThumb} />
                  {img.uploading && (
                    <View style={styles.imageOverlay}>
                      <ActivityIndicator color={c.inverseText} />
                    </View>
                  )}
                  {img.error && (
                    <View
                      style={[styles.imageOverlay, styles.imageErrorOverlay]}
                    >
                      <Ionicons
                        name="alert-circle"
                        size={20}
                        color={c.inverseText}
                      />
                    </View>
                  )}
                  {!isSubmitting && (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => removeImage(index)}
                    >
                      <Ionicons name="close" size={14} color={c.inverseText} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Tags</Text>
          <TextInput
            style={styles.input}
            placeholder="work, gym, friends"
            placeholderTextColor={c.textTertiary}
            value={tagsInput}
            onChangeText={setTagsInput}
            editable={!isSubmitting}
            accessibilityLabel="Memory tags"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Linked People</Text>
          <TextInput
            style={styles.input}
            placeholder="Alice, Bob"
            placeholderTextColor={c.textTertiary}
            value={linkedPeopleInput}
            onChangeText={setLinkedPeopleInput}
            editable={!isSubmitting}
            accessibilityLabel="Linked people"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Location (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Coffee shop, Colombo"
            placeholderTextColor={c.textTertiary}
            value={location}
            onChangeText={setLocation}
            editable={!isSubmitting}
            accessibilityLabel="Memory location"
          />
        </View>

        {/* ── Submit ───────────────────────────────────── */}
        <View style={styles.section}>
          <AppButton
            title="Save Memory"
            onPress={handleSubmit}
            disabled={!canSubmit}
            loading={isSubmitting}
            size="lg"
          />
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

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
    pageSubtitle: {
      ...Typography.callout,
      color: c.textSecondary,
      marginTop: Spacing.xs,
    },

    // Sections
    section: {
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing.xl,
    },
    label: {
      ...Typography.title3,
      color: c.text,
      marginBottom: Spacing.md,
    },

    // Inputs
    input: {
      backgroundColor: c.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      ...Typography.body,
      color: c.text,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 48,
    },
    inputButton: {
      backgroundColor: c.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 48,
      justifyContent: "center",
    },
    textArea: {
      minHeight: 110,
      textAlignVertical: "top",
      paddingTop: Spacing.md,
    },
    timestampValue: {
      ...Typography.body,
      color: c.text,
    },

    // Error
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.errorLight,
      borderRadius: Radius.md,
      padding: Spacing.md,
      marginHorizontal: Spacing.xl,
      marginBottom: Spacing.xl,
      gap: Spacing.sm,
    },
    errorText: {
      ...Typography.callout,
      color: c.error,
      flex: 1,
    },

    // Mood
    moodRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
    },
    moodBtn: {
      backgroundColor: c.surface,
      borderRadius: Radius.xl,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      alignItems: "center",
      borderWidth: 1,
      borderColor: c.border,
      minWidth: 72,
    },
    moodBtnSelected: {
      backgroundColor: c.tintLight,
      borderColor: c.tint,
    },
    moodEmoji: {
      fontSize: 22,
      marginBottom: 4,
    },
    moodLabel: {
      ...Typography.caption1,
      color: c.textSecondary,
    },
    moodLabelSelected: {
      color: c.tint,
      ...Typography.label,
    },

    // Photos
    photoBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
      backgroundColor: c.surfaceSecondary,
      borderRadius: Radius.md,
      paddingVertical: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
    },
    photoBtnText: {
      ...Typography.bodyMedium,
      color: c.tint,
    },
    imageScroll: {
      marginTop: Spacing.md,
    },
    imageWrap: {
      position: "relative",
      marginRight: Spacing.md,
    },
    imageThumb: {
      width: 88,
      height: 88,
      borderRadius: Radius.md,
    },
    imageOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
      borderRadius: Radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    imageErrorOverlay: {
      backgroundColor: withOpacity(c.error, 0.5),
    },
    removeBtn: {
      position: "absolute",
      top: -6,
      right: -6,
      backgroundColor: c.error,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
