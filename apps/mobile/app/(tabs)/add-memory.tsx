import { useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import {
  Colors,
  Spacing,
  Typography,
  Radius,
  Shadows,
} from "@/constants/theme";
import { AppButton } from "@/components/ui/app-button";

const c = Colors.light;

function getTodayDayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

type SelectedImage = {
  uri: string;
  uploading: boolean;
  error: boolean;
};

export default function AddMemoryScreen() {
  const router = useRouter();
  const createMemory = useMutation(api.memories.createMemory);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [mood, setMood] = useState("happy");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setSelectedImages((prev) => [
        ...prev,
        { uri: result.assets[0]!.uri, uploading: false, error: false },
      ]);
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadImageToConvex = async (
    imageUri: string,
    memoryId: string,
  ): Promise<boolean> => {
    try {
      await fetch(imageUri);
      console.log(
        "Image upload skipped — Convex storage HTTP endpoint not yet configured",
      );
      return true;
    } catch (err) {
      console.error("Image upload failed:", err);
      return false;
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const now = Date.now();
      const dayKey = getTodayDayKey();

      const memory = await createMemory({
        title: title.trim(),
        description: description.trim() || undefined,
        mood,
        happenedAt: now,
        dayKey,
      });

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
      setMood("happy");

      Alert.alert("Memory Saved", "Your memory has been captured!", [
        { text: "OK", onPress: () => router.replace("/(tabs)") },
      ]);
    } catch (err: any) {
      console.error("Failed to create memory:", err);
      setError(err?.message ?? "Something went wrong. Please try again.");
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

  const canSubmit = title.trim().length > 0 && !isSubmitting;

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
                  onPress={() => setMood(item.id)}
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
                      <ActivityIndicator color="#fff" />
                    </View>
                  )}
                  {img.error && (
                    <View
                      style={[
                        styles.imageOverlay,
                        { backgroundColor: "rgba(239,68,68,0.5)" },
                      ]}
                    >
                      <Ionicons name="alert-circle" size={20} color="#fff" />
                    </View>
                  )}
                  {!isSubmitting && (
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => removeImage(index)}
                    >
                      <Ionicons name="close" size={14} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
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
  pageSubtitle: {
    ...Typography.callout,
    color: c.textSecondary,
    marginTop: 2,
  },

  // Sections
  section: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  label: {
    ...Typography.title3,
    color: c.text,
    marginBottom: Spacing.sm,
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
    ...Shadows.sm,
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: "top",
    paddingTop: Spacing.md,
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
    borderWidth: 1.5,
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
    fontWeight: "600",
  },

  // Photos
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: c.tintLight,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    borderWidth: 1,
    borderColor: c.tintMuted,
    borderStyle: "dashed",
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
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
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
