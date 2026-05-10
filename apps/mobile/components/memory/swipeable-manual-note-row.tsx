import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
  ActionSheetIOS,
  Alert,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Swipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { FadeIn, FadeOut, Layout } from "react-native-reanimated";

import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { MotionTokens } from "@/constants/motion";
import { AppButton } from "@/components/ui/app-button";
import { destructiveImpact, selectionFeedback } from "@/lib/haptics";
import { useReducedMotionPreference } from "@/hooks/use-reduced-motion";

/** Props bundle for inline manual-note editing (parent holds Convex mutations). */
export type ManualNoteEditorBindings = {
  editingIndex: number | null;
  draft: string;
  onDraftChange: (text: string) => void;
  onBeginEdit: (index: number) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  onDelete: (index: number) => void;
  saveDisabled: boolean;
  saveLoading: boolean;
};

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type SwipeableManualNoteRowVariant = "list" | "timeline";

export type SwipeableManualNoteRowProps = {
  noteIndex: number;
  noteText: string;
  colors: ThemeColors;
  variant: SwipeableManualNoteRowVariant;
  isEditing: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onBeginEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  saveDisabled?: boolean;
  saveLoading?: boolean;
};

const ACTION_W = 76;

export const SwipeableManualNoteRow = React.memo(
  function SwipeableManualNoteRow({
    noteIndex,
    noteText,
    colors: c,
    variant,
    isEditing,
    draft,
    onDraftChange,
    onBeginEdit,
    onSave,
    onCancel,
    onDelete,
    saveDisabled,
    saveLoading,
  }: SwipeableManualNoteRowProps) {
    const styles = useMemo(() => createStyles(c, variant), [c, variant]);
    const swipeRef = useRef<SwipeableMethods | null>(null);
    const inputRef = useRef<TextInput>(null);
    const reduceMotion = useReducedMotionPreference();

    useEffect(() => {
      if (!isEditing) {
        swipeRef.current?.close();
        return;
      }
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const t = setTimeout(
        () => {
          inputRef.current?.focus();
        },
        reduceMotion ? 0 : 48,
      );
      return () => {
        clearTimeout(t);
      };
    }, [isEditing, reduceMotion]);

    const closeSwipe = useCallback(() => {
      swipeRef.current?.close();
    }, []);

    const handleDeletePress = useCallback(async () => {
      await destructiveImpact();
      closeSwipe();
      onDelete();
    }, [closeSwipe, onDelete]);

    const handleEditFromSwipe = useCallback(async () => {
      await selectionFeedback();
      closeSwipe();
      onBeginEdit();
    }, [closeSwipe, onBeginEdit]);

    const showContextMenu = useCallback(() => {
      if (isEditing) return;
      void selectionFeedback();
      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Edit", "Delete"],
            cancelButtonIndex: 0,
            destructiveButtonIndex: 2,
          },
          (idx) => {
            if (idx === 1) onBeginEdit();
            if (idx === 2) void handleDeletePress();
          },
        );
      } else {
        Alert.alert("Note", noteText, [
          { text: "Edit", onPress: onBeginEdit },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void handleDeletePress();
            },
          },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    }, [handleDeletePress, isEditing, noteText, onBeginEdit]);

    const onRowPress = useCallback(() => {
      if (isEditing) return;
      void selectionFeedback();
      onBeginEdit();
    }, [isEditing, onBeginEdit]);

    const renderLeftActions = useCallback(() => {
      return (
        <View
          style={[styles.actionPanel, styles.actionEdit, { width: ACTION_W }]}
        >
          <Pressable
            onPress={() => {
              void handleEditFromSwipe();
            }}
            style={({ pressed }) => [
              styles.actionInner,
              { opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              variant === "timeline" ? "Edit note in timeline" : "Edit note"
            }
            hitSlop={6}
          >
            <Ionicons name="create-outline" size={22} color="#fff" />
            <Text style={styles.actionLabel}>Edit</Text>
          </Pressable>
        </View>
      );
    }, [handleEditFromSwipe, styles, variant]);

    const renderRightActions = useCallback(() => {
      return (
        <View
          style={[styles.actionPanel, styles.actionDelete, { width: ACTION_W }]}
        >
          <Pressable
            onPress={() => {
              void handleDeletePress();
            }}
            style={({ pressed }) => [
              styles.actionInner,
              { opacity: pressed ? 0.88 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Delete note"
            hitSlop={6}
          >
            <Ionicons name="trash-outline" size={22} color="#fff" />
            <Text style={styles.actionLabel}>Delete</Text>
          </Pressable>
        </View>
      );
    }, [handleDeletePress, styles]);

    const entering = reduceMotion
      ? undefined
      : FadeIn.duration(MotionTokens.duration.standard);
    const exiting = reduceMotion
      ? undefined
      : FadeOut.duration(MotionTokens.duration.quick);

    const editor = isEditing ? (
      <Animated.View
        entering={entering}
        exiting={exiting}
        layout={reduceMotion ? undefined : Layout.duration(200)}
        style={[styles.editorWrap, variant === "list" && styles.editorWrapList]}
      >
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={onDraftChange}
          style={[styles.input, styles.editorInput]}
          placeholder="Note text"
          placeholderTextColor={c.textTertiary}
          multiline
          textAlignVertical="top"
          accessibilityLabel="Edit note text"
        />
        <View style={styles.editorActions}>
          <AppButton
            title="Cancel"
            variant="secondary"
            onPress={() => {
              Keyboard.dismiss();
              onCancel();
            }}
            size="md"
            style={styles.editorBtn}
          />
          <AppButton
            title="Save"
            onPress={() => {
              void onSave();
              Keyboard.dismiss();
            }}
            disabled={Boolean(saveDisabled)}
            loading={Boolean(saveLoading)}
            size="md"
            style={styles.editorBtn}
          />
        </View>
      </Animated.View>
    ) : null;

    if (isEditing) {
      return (
        <View
          style={variant === "timeline" ? { flex: 1, minWidth: 0 } : undefined}
          accessibilityRole="none"
        >
          <View
            style={[
              styles.rowInner,
              variant === "list" && { marginBottom: Spacing.sm },
            ]}
          >
            {variant === "list" ? <View style={styles.noteBullet} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>{editor}</View>
          </View>
        </View>
      );
    }

    return (
      <View
        style={
          variant === "timeline"
            ? { flex: 1, minWidth: 0, marginBottom: Spacing.sm }
            : undefined
        }
        accessibilityElementsHidden={false}
        importantForAccessibility="yes"
      >
        <Swipeable
          ref={swipeRef}
          enabled={!isEditing}
          friction={2}
          overshootFriction={8}
          renderLeftActions={renderLeftActions}
          renderRightActions={renderRightActions}
          containerStyle={styles.swipeContainer}
        >
          <Pressable
            onPress={onRowPress}
            onLongPress={showContextMenu}
            delayLongPress={380}
            style={({ pressed }) => [
              styles.rowInner,
              variant === "timeline" && styles.timelineRow,
              pressed && styles.rowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Manual note ${noteIndex + 1}. ${noteText}. Swipe or long press for options.`}
          >
            {variant === "list" ? (
              <>
                <View style={styles.noteBullet} />
                <Text style={styles.noteText} numberOfLines={5}>
                  {noteText}
                </Text>
                <Ionicons
                  name="chevron-expand"
                  size={16}
                  color={c.textTertiary}
                  style={styles.chevron}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              </>
            ) : (
              <Text style={styles.timelineBody} numberOfLines={4}>
                {noteText}
              </Text>
            )}
          </Pressable>
        </Swipeable>
      </View>
    );
  },
);

function createStyles(c: ThemeColors, variant: SwipeableManualNoteRowVariant) {
  const timelineCard =
    variant === "timeline"
      ? {
          borderWidth: 1,
          borderColor: c.border,
          borderRadius: Radius.lg,
          backgroundColor: c.surfaceSecondary,
          paddingHorizontal: Spacing.md,
          paddingVertical: Spacing.md,
        }
      : {};

  return StyleSheet.create({
    swipeContainer: {
      overflow: "hidden",
      borderRadius: variant === "list" ? Radius.md : Radius.lg,
    },
    rowInner: {
      flexDirection: variant === "timeline" ? "column" : "row",
      alignItems: variant === "timeline" ? "stretch" : "flex-start",
      marginBottom: variant === "list" ? Spacing.sm : 0,
      minHeight: variant === "list" ? 44 : undefined,
      ...timelineCard,
    },
    timelineRow: {
      marginBottom: 0,
    },
    rowPressed: {
      opacity: 0.92,
    },
    noteBullet: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.tint,
      marginTop: 9,
      marginRight: Spacing.sm,
    },
    noteText: {
      ...Typography.body,
      color: c.text,
      flex: 1,
    },
    chevron: {
      marginLeft: Spacing.sm,
      marginTop: 2,
      opacity: 0.55,
    },
    timelineBody: {
      ...Typography.bodyMedium,
      color: c.text,
      flexGrow: 1,
      width: "100%",
    },
    actionPanel: {
      justifyContent: "center",
      alignItems: "stretch",
    },
    actionEdit: {
      backgroundColor: c.tint,
      borderTopRightRadius: Radius.md,
      borderBottomRightRadius: Radius.md,
    },
    actionDelete: {
      backgroundColor: c.error,
      borderTopLeftRadius: Radius.md,
      borderBottomLeftRadius: Radius.md,
    },
    actionInner: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: Spacing.sm,
      minHeight: 44,
    },
    actionLabel: {
      ...Typography.caption2,
      color: "#fff",
      marginTop: 2,
      fontWeight: "600",
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
    editorWrap: {
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    editorWrapList: {
      paddingLeft: Spacing.md + 6 + Spacing.sm,
    },
    editorInput: {
      minHeight: 112,
      paddingTop: Spacing.md,
    },
    editorActions: {
      flexDirection: "row",
      gap: Spacing.sm,
    },
    editorBtn: {
      flex: 1,
    },
  });
}
