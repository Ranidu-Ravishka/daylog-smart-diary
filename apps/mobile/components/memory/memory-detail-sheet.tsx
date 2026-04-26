import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Image,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { AppButton } from "@/components/ui/app-button";
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
  const [location, setLocation] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");
  const [linkedPeopleInput, setLinkedPeopleInput] = React.useState("");

  React.useEffect(() => {
    if (!memory) return;
    setTitle(memory.title ?? "");
    setDescription(memory.description ?? "");
    setLocation(memory.location ?? "");
    setTagsInput((memory.tags ?? []).join(", "));
    setLinkedPeopleInput((memory.linkedPeople ?? []).join(", "));
    setIsEditMode(false);
  }, [memory]);

  const handleSave = async () => {
    if (!memory || !title.trim()) return;
    await onSave(memory, {
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      tags: splitCsv(tagsInput),
      linkedPeople: splitCsv(linkedPeopleInput),
    });
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Memory details</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close memory details"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {memory ? (
            <>
              {memory.thumbnailUrl ? (
                <Image
                  source={{ uri: memory.thumbnailUrl }}
                  style={styles.image}
                />
              ) : null}
              <View style={styles.formWrap}>
                <TextInput
                  style={styles.input}
                  value={title}
                  onChangeText={setTitle}
                  editable={isEditMode && !isSaving}
                  accessibilityLabel="Memory title"
                />
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={description}
                  onChangeText={setDescription}
                  editable={isEditMode && !isSaving}
                  multiline
                  accessibilityLabel="Memory description"
                />
                <TextInput
                  style={styles.input}
                  value={tagsInput}
                  onChangeText={setTagsInput}
                  editable={isEditMode && !isSaving}
                  placeholder="tags"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Memory tags"
                />
                <TextInput
                  style={styles.input}
                  value={location}
                  onChangeText={setLocation}
                  editable={isEditMode && !isSaving}
                  placeholder="location"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Memory location"
                />
                <TextInput
                  style={styles.input}
                  value={linkedPeopleInput}
                  onChangeText={setLinkedPeopleInput}
                  editable={isEditMode && !isSaving}
                  placeholder="linked people"
                  placeholderTextColor={colors.textTertiary}
                  accessibilityLabel="Linked people"
                />
              </View>
              <View style={styles.actions}>
                {isEditMode ? (
                  <>
                    <AppButton
                      title="Cancel"
                      variant="secondary"
                      onPress={() => setIsEditMode(false)}
                      size="md"
                    />
                    <AppButton
                      title="Save"
                      onPress={handleSave}
                      loading={isSaving}
                      disabled={!title.trim() || isSaving}
                      size="md"
                    />
                  </>
                ) : (
                  <>
                    <AppButton
                      title="Edit"
                      onPress={() => setIsEditMode(true)}
                      size="md"
                    />
                    <AppButton
                      title="Delete"
                      variant="secondary"
                      onPress={handleDelete}
                      loading={isDeleting}
                      size="md"
                    />
                  </>
                )}
              </View>
            </>
          ) : null}
        </View>
      </View>
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
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing["2xl"],
      gap: Spacing.md,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    headerTitle: {
      ...Typography.title3,
      color: c.text,
    },
    image: {
      width: "100%",
      height: 140,
      borderRadius: Radius.lg,
      backgroundColor: c.surfaceSecondary,
    },
    formWrap: {
      gap: Spacing.sm,
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
    textArea: {
      minHeight: 90,
      textAlignVertical: "top",
    },
    actions: {
      flexDirection: "row",
      gap: Spacing.sm,
      justifyContent: "space-between",
    },
  });
}
