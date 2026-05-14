import React from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AppCard } from "@/components/ui/app-card";
import { AppButton } from "@/components/ui/app-button";
import { SectionHeader } from "@/components/ui/section-header";
import {
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import {
  formatLastMetLabel,
  usePeopleSuggestions,
  type IntegrationDailyDataForPeople,
} from "@/components/memory/use-people-suggestions";

type PeopleYouMetSectionProps = {
  colors: ThemeColors;
  isAuthenticated: boolean;
  isSaving: boolean;
  personInput: string;
  peopleTags: string[];
  integrationDailyData: IntegrationDailyDataForPeople[];
  onPersonInputChange: (value: string) => void;
  onAddPerson: () => void;
  onRemovePerson: (index: number) => void;
  onMarkKnownPerson: (name: string) => Promise<void>;
};

export function PeopleYouMetSection({
  colors: c,
  isAuthenticated,
  isSaving,
  personInput,
  peopleTags,
  integrationDailyData,
  onPersonInputChange,
  onAddPerson,
  onRemovePerson,
  onMarkKnownPerson,
}: PeopleYouMetSectionProps) {
  const styles = React.useMemo(() => createStyles(c), [c]);
  const {
    contactConsentEnabled,
    groupedSuggestions,
    handleAddToContacts,
    handleEnableContactMatching,
    handleIgnoreSuggestion,
    handleMarkKnown,
  } = usePeopleSuggestions({
    isAuthenticated,
    peopleTags,
    integrationDailyData,
    onMarkKnownPerson,
  });

  return (
    <View>
      <SectionHeader title="People You Met" />
      <AppCard>
        <View style={styles.personInputRow}>
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            placeholder="Name..."
            placeholderTextColor={c.textTertiary}
            value={personInput}
            onChangeText={onPersonInputChange}
            editable={!isSaving}
            onSubmitEditing={onAddPerson}
          />
          <AppButton
            title="Add"
            onPress={onAddPerson}
            variant="secondary"
            size="sm"
            disabled={!personInput.trim() || isSaving}
            style={{ marginLeft: Spacing.sm }}
          />
        </View>

        {peopleTags.length > 0 ? (
          <View style={styles.tagsWrap}>
            {peopleTags.map((person, index) => (
              <TouchableOpacity
                key={`${person}-${index}`}
                style={styles.personTag}
                onLongPress={() => onRemovePerson(index)}
                activeOpacity={0.7}
              >
                <Ionicons name="person-outline" size={12} color={c.tint} />
                <Text style={styles.personTagText}>{person}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {!contactConsentEnabled ? (
          <TouchableOpacity
            style={styles.enableContactMatchRow}
            onPress={handleEnableContactMatching}
            activeOpacity={0.8}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={14}
              color={c.tint}
            />
            <Text style={styles.enableContactMatchText}>
              Enable private contact matching
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.peoplePrivacyHint}>
            Contact matching is enabled on-device only. Raw contact data stays
            on this device.
          </Text>
        )}

        <View style={styles.peopleSuggestionsWrap}>
          {(["frequent", "recent", "occasional"] as const).map((groupKey) => {
            const entries = groupedSuggestions[groupKey];
            if (entries.length === 0) return null;
            const title =
              groupKey === "frequent"
                ? "Frequent"
                : groupKey === "recent"
                  ? "Recent"
                  : "Occasional";
            return (
              <View key={groupKey} style={styles.peopleGroupSection}>
                <Text style={styles.peopleGroupTitle}>{title}</Text>
                {entries.map((person) => (
                  <View key={person.key} style={styles.peopleSuggestionCard}>
                    <View style={styles.peopleSuggestionTopRow}>
                      <View style={styles.peopleAvatar}>
                        <Text style={styles.peopleAvatarText}>
                          {person.avatarText}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.peopleSuggestionName}>
                          {person.name}
                        </Text>
                        <Text style={styles.peopleSuggestionMeta}>
                          {formatLastMetLabel(person.lastMetAt)} - Seen{" "}
                          {person.count} times
                        </Text>
                        <Text style={styles.peopleSuggestionContext}>
                          {person.relationContext}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.peopleSuggestionActions}>
                      <TouchableOpacity
                        style={styles.peopleActionBtn}
                        onPress={() => handleAddToContacts(person)}
                      >
                        <Text style={styles.peopleActionBtnText}>
                          Add to contacts
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.peopleActionBtn}
                        onPress={() => handleMarkKnown(person)}
                      >
                        <Text style={styles.peopleActionBtnText}>
                          Mark as known
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.peopleActionBtn}
                        onPress={() => handleIgnoreSuggestion(person)}
                      >
                        <Text style={styles.peopleActionBtnText}>Ignore</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      </AppCard>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    input: {
      backgroundColor: c.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      minHeight: 48,
      ...Typography.body,
      color: c.text,
    },
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
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs + 2,
    },
    personTagText: {
      ...Typography.caption1,
      color: c.tint,
    },
    enableContactMatchRow: {
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
    },
    enableContactMatchText: {
      ...Typography.caption1,
      color: c.tint,
    },
    peoplePrivacyHint: {
      ...Typography.caption2,
      color: c.textSecondary,
      marginTop: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    peopleSuggestionsWrap: {
      gap: Spacing.md,
      marginTop: Spacing.sm,
    },
    peopleGroupSection: {
      gap: Spacing.sm,
    },
    peopleGroupTitle: {
      ...Typography.label,
      color: c.textSecondary,
    },
    peopleSuggestionCard: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: Radius.lg,
      padding: Spacing.md,
      gap: Spacing.sm,
    },
    peopleSuggestionTopRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
    },
    peopleAvatar: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      backgroundColor: c.tintLight,
      alignItems: "center",
      justifyContent: "center",
    },
    peopleAvatarText: {
      ...Typography.h3,
      fontSize: 12,
      lineHeight: 18,
      color: c.tint,
    },
    peopleSuggestionName: {
      ...Typography.bodyMedium,
      color: c.text,
    },
    peopleSuggestionMeta: {
      ...Typography.caption2,
      color: c.textSecondary,
      marginTop: 2,
    },
    peopleSuggestionContext: {
      ...Typography.caption2,
      color: c.textTertiary,
      marginTop: 2,
    },
    peopleSuggestionActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.xs,
    },
    peopleActionBtn: {
      borderRadius: Radius.full,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    peopleActionBtnText: {
      ...Typography.caption2,
      color: c.textSecondary,
    },
  });
}
