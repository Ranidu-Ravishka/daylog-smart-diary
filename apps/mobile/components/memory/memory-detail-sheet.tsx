import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { MOOD_OPTIONS, MOOD_LABELS } from "@repo/ui/lib/constants";
import {
  getDayKeyForTimestamp,
  getResolvedTimeZone,
} from "@repo/ui/lib/day-window";
import { Image } from "expo-image";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { AppButton } from "@/components/ui/app-button";
import { Field } from "@/components/ui/field";
import { MoodEmoji } from "@/components/ui/mood-emoji";
import type { MemoryItem } from "@/components/memory/types";

type MemoryDetailSheetProps = {
  visible: boolean;
  memory: MemoryItem | null;
  colors: ThemeColors;
  isSaving: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onSave: (memory: MemoryItem, patch: MemoryPatchPayload) => Promise<void>;
  onDelete: (memory: MemoryItem) => Promise<void>;
};

export type MemoryPatchPayload = {
  title: string;
  description?: string;
  mood?: string;
  happenedAt?: number;
  dayKey?: string;
  location?: string;
  tags?: string[];
  linkedPeople?: string[];
};

function splitCsv(value: string): string[] | undefined {
  const parsed = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

export function MemoryDetailSheet({
  visible,
  memory,
  colors,
  isSaving,
  isDeleting,
  onClose,
  onSave,
  onDelete,
}: MemoryDetailSheetProps) {
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [mood, setMood] = React.useState<string | undefined>(undefined);
  const [happenedAt, setHappenedAt] = React.useState<number | null>(null);
  const [isDatePickerVisible, setIsDatePickerVisible] = React.useState(false);
  const [location, setLocation] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");
  const [linkedPeopleInput, setLinkedPeopleInput] = React.useState("");

  React.useEffect(() => {
    if (!memory) return;
    setTitle(memory.title ?? "");
    setDescription(memory.description ?? "");
    setMood(memory.mood);
    setHappenedAt(memory.happenedAt ?? null);
    setLocation(memory.location ?? "");
    setTagsInput((memory.tags ?? []).join(", "));
    setLinkedPeopleInput((memory.linkedPeople ?? []).join(", "));
    setIsEditMode(false);
    setIsDatePickerVisible(false);
  }, [memory]);

  const handleSave = async () => {
    if (!memory || !title.trim()) return;
    const patch: MemoryPatchPayload = {
      title: title.trim(),
      description: description.trim() || undefined,
      mood: mood?.trim() ? mood.trim() : undefined,
      location: location.trim() || undefined,
      tags: splitCsv(tagsInput),
      linkedPeople: splitCsv(linkedPeopleInput),
    };
    if (happenedAt !== null && happenedAt !== memory.happenedAt) {
      patch.happenedAt = happenedAt;
      patch.dayKey = getDayKeyForTimestamp(happenedAt, getResolvedTimeZone());
    }
    await onSave(memory, patch);
    setIsEditMode(false);
  };

  const handleDelete = () => {
    if (!memory) return;
    Alert.alert(
      "Delete memory?",
      "This will permanently remove this memory and attached media.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void onDelete(memory);
          },
        },
      ],
    );
  };

  const handleTimestampChange = (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => {
    if (Platform.OS === "android") {
      setIsDatePickerVisible(false);
    }
    if (event.type === "dismissed" || !selectedDate) return;
    setHappenedAt(selectedDate.getTime());
  };

  const dateLabel = happenedAt
    ? new Date(happenedAt).toLocaleString()
    : "Not set";
  const moodLabelForBadge = mood ? (MOOD_LABELS[mood] ?? mood) : null;
  const hasImage = Boolean(memory?.thumbnailUrl);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>
              {isEditMode ? "Edit memory" : "Memory details"}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close memory details"
              accessibilityRole="button"
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {memory ? (
            <ScrollView
              style={styles.scrollWrap}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {hasImage ? (
                <Image
                  source={{ uri: memory.thumbnailUrl ?? "" }}
                  style={styles.image}
                  contentFit="cover"
                  transition={220}
                  cachePolicy="memory-disk"
                  accessibilityLabel={`Memory photo for ${memory.title ?? "this memory"}`}
                />
              ) : mood ? (
                <View style={styles.moodHero}>
                  <MoodEmoji mood={mood} size={64} />
                  <Text style={styles.moodHeroLabel}>{moodLabelForBadge}</Text>
                </View>
              ) : null}

              <View style={styles.formWrap}>
                <Field label="Title">
                  <TextInput
                    style={styles.input}
                    value={title}
                    onChangeText={setTitle}
                    editable={isEditMode && !isSaving}
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Memory title"
                  />
                </Field>

                <Field label="Description">
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    value={description}
                    onChangeText={setDescription}
                    editable={isEditMode && !isSaving}
                    placeholder="Describe what made this moment matter…"
                    placeholderTextColor={colors.textTertiary}
                    multiline
                    accessibilityLabel="Memory description"
                  />
                </Field>

                <Field label="Mood">
                  {isEditMode ? (
                    <View style={styles.moodRow}>
                      {MOOD_OPTIONS.map((option) => {
                        const isSelected = mood === option.value;
                        return (
                          <Pressable
                            key={option.value}
                            style={({ pressed }) => [
                              styles.moodChip,
                              isSelected && styles.moodChipSelected,
                              pressed && styles.moodChipPressed,
                            ]}
                            onPress={() => setMood(option.value)}
                            disabled={isSaving}
                            accessibilityRole="button"
                            accessibilityLabel={`${option.label} mood`}
                            accessibilityState={{ selected: isSelected }}
                          >
                            <MoodEmoji mood={option.value} size={18} />
                            <Text
                              style={[
                                styles.moodChipLabel,
                                isSelected && styles.moodChipLabelSelected,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.moodReadonly}>
                      {mood ? <MoodEmoji mood={mood} size={20} /> : null}
                      <Text style={styles.moodReadonlyLabel}>
                        {moodLabelForBadge ?? "No mood set"}
                      </Text>
                    </View>
                  )}
                </Field>

                <Field label="When">
                  <Pressable
                    style={styles.inputButton}
                    onPress={() => {
                      if (isEditMode && !isSaving) {
                        setIsDatePickerVisible(true);
                      }
                    }}
                    disabled={!isEditMode || isSaving}
                    accessibilityLabel="Memory date and time"
                    accessibilityRole="button"
                  >
                    <Text style={styles.inputValue}>{dateLabel}</Text>
                  </Pressable>
                  {isDatePickerVisible && happenedAt !== null ? (
                    <DateTimePicker
                      value={new Date(happenedAt)}
                      mode="datetime"
                      display={Platform.OS === "ios" ? "inline" : "default"}
                      onChange={handleTimestampChange}
                    />
                  ) : null}
                </Field>

                <Field label="Tags">
                  <TextInput
                    style={styles.input}
                    value={tagsInput}
                    onChangeText={setTagsInput}
                    editable={isEditMode && !isSaving}
                    placeholder="work, gym, friends"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Memory tags"
                  />
                </Field>

                <Field label="Location">
                  <TextInput
                    style={styles.input}
                    value={location}
                    onChangeText={setLocation}
                    editable={isEditMode && !isSaving}
                    placeholder="Add a place"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Memory location"
                  />
                </Field>

                <Field label="People">
                  <TextInput
                    style={styles.input}
                    value={linkedPeopleInput}
                    onChangeText={setLinkedPeopleInput}
                    editable={isEditMode && !isSaving}
                    placeholder="Alice, Bob"
                    placeholderTextColor={colors.textTertiary}
                    accessibilityLabel="Linked people"
                  />
                </Field>
              </View>
            </ScrollView>
          ) : null}

          <View style={styles.actions}>
            {isEditMode ? (
              <>
                <AppButton
                  title="Cancel"
                  variant="secondary"
                  onPress={() => setIsEditMode(false)}
                  size="md"
                  style={styles.actionButton}
                />
                <AppButton
                  title="Save"
                  onPress={handleSave}
                  loading={isSaving}
                  disabled={!title.trim() || isSaving}
                  size="md"
                  style={styles.actionButton}
                />
              </>
            ) : (
              <>
                <AppButton
                  title="Delete"
                  variant="secondary"
                  onPress={handleDelete}
                  loading={isDeleting}
                  size="md"
                  style={styles.actionButton}
                />
                <AppButton
                  title="Edit"
                  onPress={() => setIsEditMode(true)}
                  size="md"
                  style={styles.actionButton}
                />
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.overlay,
      justifyContent: "flex-end",
    },
    sheet: {
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
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: Spacing.md,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: Spacing.xl,
      marginBottom: Spacing.md,
    },
    headerTitle: {
      ...Typography.title3,
      color: c.text,
    },
    scrollWrap: {
      flexGrow: 0,
    },
    scrollContent: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.lg,
      gap: Spacing.lg,
    },
    image: {
      width: "100%",
      height: 180,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceSecondary,
    },
    moodHero: {
      backgroundColor: c.tintLight,
      borderRadius: Radius.xl,
      paddingVertical: Spacing.xl,
      paddingHorizontal: Spacing.xl,
      alignItems: "center",
      gap: Spacing.sm,
    },
    moodHeroLabel: {
      ...Typography.bodyMedium,
      color: c.tint,
    },
    formWrap: {
      gap: Spacing.md,
    },
    input: {
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
    inputButton: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 48,
      backgroundColor: c.surface,
      justifyContent: "center",
    },
    inputValue: {
      ...Typography.body,
      color: c.text,
    },
    textArea: {
      minHeight: 96,
      textAlignVertical: "top",
      paddingTop: Spacing.md,
    },
    moodRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.xs,
    },
    moodChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.full,
      backgroundColor: c.surface,
    },
    moodChipPressed: {
      opacity: 0.85,
    },
    moodChipSelected: {
      backgroundColor: c.tintLight,
      borderColor: c.tint,
    },
    moodChipLabel: {
      ...Typography.caption1,
      color: c.textSecondary,
    },
    moodChipLabelSelected: {
      color: c.tint,
      ...Typography.label,
    },
    moodReadonly: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.md,
      backgroundColor: c.surfaceSecondary,
    },
    moodReadonlyLabel: {
      ...Typography.body,
      color: c.text,
    },
    actions: {
      flexDirection: "row",
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.divider,
    },
    actionButton: {
      flex: 1,
    },
  });
}
