import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Dimensions,
  SafeAreaView,
  Platform,
  StatusBar,
} from "react-native";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 48; // 354px equivalent with margins

const DailyDetailView = () => {
  const [manualEntry, setManualEntry] = useState("");
  const [peopleTags] = useState<string[]>([]);
  const [rating, setRating] = useState(0);

  const dataSources = [
    "Locations: Map view with time spent",
    "Calendar: Meetings and events",
    "Health: Steps, sleep, activity",
    "Spending: Transaction categories",
    "Digital: Screen time, app usage",
  ];

  const handleAddPeople = () => {
    // In a real app, this would open a people selection modal
    console.log("Add people clicked");
  };

  const handleAddEntry = () => {
    if (manualEntry.trim()) {
      console.log("Adding entry:", manualEntry);
      setManualEntry("");
    }
  };

  const handleRateDay = (stars: number) => {
    setRating(stars);
  };

  const renderStars = () => {
    return (
      <View style={styles.starsContainer}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => handleRateDay(star)}
            style={styles.starButton}
          >
            <Text style={styles.star}>{star <= rating ? "★" : "☆"}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F5F5" />
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Daily Detail View</Text>
          <View style={styles.metricsRow}>
            <Text style={styles.metric}>Overall Mood: Positive</Text>
            <Text style={styles.metric}>Focus Level: 85%</Text>
          </View>
        </View>

        {/* Day Story Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your Day Story</Text>
          <Text style={styles.storyText}>
            Yesterday, you had a productive workday followed by an evening walk
            in Central Park. You slept 7.5 hours and caught up with friends over
            dinner.
          </Text>
        </View>

        {/* Data Sources Card */}
        <View style={styles.card}>
          <View style={styles.emojiHeader}>
            <Text style={styles.cardTitle}>Data Sources</Text>
          </View>
          <View style={styles.dataSourcesContainer}>
            {dataSources.map((source, index) => (
              <View key={index} style={styles.dataSourceRow}>
                <Text style={styles.dataSourceText}>{source}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Manual Additions Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Manual Additions</Text>

          {/* Add Entry Input */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="Add what mattered today..."
              placeholderTextColor="#999"
              value={manualEntry}
              onChangeText={setManualEntry}
              multiline
            />
            <TouchableOpacity
              style={[
                styles.addButton,
                !manualEntry.trim() && styles.addButtonDisabled,
              ]}
              onPress={handleAddEntry}
              disabled={!manualEntry.trim()}
            >
              <Text style={styles.addButtonText}>Add Entry</Text>
            </TouchableOpacity>
          </View>

          {/* Tag People Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tag people you met</Text>
            <TouchableOpacity
              style={styles.tagButton}
              onPress={handleAddPeople}
            >
              <Text style={styles.tagButtonText}>+ Add People</Text>
            </TouchableOpacity>
            {peopleTags.length > 0 && (
              <View style={styles.tagsContainer}>
                {peopleTags.map((person, index) => (
                  <View key={index} style={styles.tag}>
                    <Text style={styles.tagText}>{person}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Rate Your Day Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Rate Your Day</Text>
            {renderStars()}
            <Text style={styles.ratingText}>
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
          </View>
        </View>

        {/* Bottom padding for safe area */}
        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 0 : StatusBar.currentHeight,
  },
  header: {
    alignItems: "center",
    marginBottom: 24,
    paddingTop: Platform.OS === "ios" ? 20 : 16,
  },
  headerTitle: {
    fontSize: 19,
    fontFamily: "Inter",
    fontWeight: "700",
    color: "#000",
    marginBottom: 12,
    textAlign: "center",
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
  },
  metric: {
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "500",
    color: "rgba(0, 0, 0, 0.70)",
    textAlign: "center",
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    marginBottom: 16,
  },
  storyText: {
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
    lineHeight: 22,
  },
  emojiHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  emoji: {
    fontSize: 16,
    color: "rgba(0, 0, 0, 0.70)",
    marginBottom: 8,
  },
  dataSourcesContainer: {
    marginTop: 8,
  },
  dataSourceRow: {
    marginBottom: 12,
  },
  dataSourceText: {
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
    lineHeight: 22,
  },
  inputContainer: {
    marginBottom: 24,
  },
  textInput: {
    backgroundColor: "#ECECEC",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 40,
    fontSize: 15,
    fontFamily: "Inter",
    color: "#000",
    marginBottom: 12,
    textAlignVertical: "top",
  },
  addButton: {
    backgroundColor: "#000",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  addButtonDisabled: {
    backgroundColor: "#666",
  },
  addButtonText: {
    fontSize: 15,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#FFF",
  },
  section: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#000",
    marginBottom: 12,
    textAlign: "center",
  },
  tagButton: {
    backgroundColor: "#F5F5F5",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  tagButtonText: {
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    justifyContent: "center",
  },
  tag: {
    backgroundColor: "#E8E8E8",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tagText: {
    fontSize: 13,
    fontFamily: "Inter",
    color: "#000",
  },
  starsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginBottom: 8,
  },
  starButton: {
    padding: 4,
  },
  star: {
    fontSize: 24,
    color: "#FFD700",
  },
  ratingText: {
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
    textAlign: "center",
    marginTop: 4,
  },
  bottomPadding: {
    height: Platform.OS === "ios" ? 34 : 20, // Extra padding for iPhone home indicator
  },
});

export default DailyDetailView;
