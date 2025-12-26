import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

const HomeScreen = () => {
  // Mock data
  const userName = "John";
  const placesCount = 3;
  const stepsCount = "5,420";
  const eventsCount = 2;

  const dailySummary =
    "Yesterday, you had a productive workday followed by an evening walk in Central Park. You slept 7.5 hours and caught up with friends over dinner.";

  const timelineEvents = [
    { location: "Home", time: "7.30 AM (45 min)" },
    { location: "Work", time: "9 AM - 5 PM" },
    { location: "Gym", time: "3:30 PM (15 min)" },
    { location: "Central park", time: "8 PM" },
  ];

  const quickActions = [
    { icon: "add-circle-outline", label: "Add Memory" },
    { icon: "target-outline", label: "Today's Focus" },
    { icon: "analytics-outline", label: "Insights" },
    { icon: "settings-outline", label: "Settings" },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Greeting */}
        <View style={styles.greetingContainer}>
          <Text style={styles.greetingText}>Good Morning, {userName}</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Ionicons name="location-outline" size={15} color="black" />
            <Text style={styles.statText}>{placesCount} Places</Text>
          </View>

          <View style={styles.statItem}>
            <Ionicons name="walk-outline" size={15} color="black" />
            <Text style={styles.statText}>{stepsCount} Steps</Text>
          </View>

          <View style={styles.statItem}>
            <Ionicons name="calendar-outline" size={15} color="black" />
            <Text style={styles.statText}>{eventsCount} Events</Text>
          </View>
        </View>

        {/* Main Content */}
        <View style={styles.contentContainer}>
          {/* Daily Summary Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Daily Summary</Text>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.summaryText}>{dailySummary}</Text>
              <TouchableOpacity style={styles.exploreButton}>
                <Text style={styles.exploreText}>
                  Tap facts to explore details →
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Quick Actions Grid */}
          <View style={styles.quickActionsContainer}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.actionsGrid}>
              {quickActions.map((action, index) => (
                <TouchableOpacity key={index} style={styles.actionCard}>
                  <View style={styles.actionIconContainer}>
                    <Ionicons
                      name={action.icon as any}
                      size={30}
                      color="#6366f1"
                    />
                  </View>
                  <Text style={styles.actionLabel}>{action.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Today's Timeline Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Today&apos;s Timeline</Text>
          </View>
          <View style={styles.timelineContainer}>
            {timelineEvents.map((event, index) => (
              <View key={index} style={styles.timelineItem}>
                <View style={styles.timelineLeft}>
                  <Text style={styles.locationText}>{event.location}</Text>
                </View>
                <View style={styles.timelineRight}>
                  <Text style={styles.timeTextSmall}>{event.time}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
        {/* Bottom Navigation Spacer */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f8fafc",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 20,
  },
  greetingContainer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
  },
  greetingText: {
    textAlign: "center",
    color: "black",
    fontSize: 19,
    fontFamily: "Inter",
    fontWeight: "700",
    lineHeight: 22,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statText: {
    textAlign: "center",
    color: "black",
    fontSize: 11,
    fontFamily: "Inter",
    fontWeight: "500",
    lineHeight: 22,
  },
  contentContainer: {
    paddingHorizontal: 24,
    gap: 20,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 18,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    overflow: "hidden",
  },
  cardHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  cardTitle: {
    textAlign: "center",
    color: "black",
    fontSize: 16,
    fontFamily: "Inter",
    fontWeight: "600",
    lineHeight: 22,
  },
  cardContent: {
    padding: 20,
  },
  summaryText: {
    width: "100%",
    color: "black",
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "400",
    lineHeight: 22,
    marginBottom: 12,
  },
  exploreButton: {
    alignSelf: "flex-start",
  },
  exploreText: {
    color: "#0D00FF",
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: "500",
    lineHeight: 22,
  },
  timelineContainer: {
    padding: 20,
    gap: 16,
  },
  timelineItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timelineLeft: {
    flex: 1,
  },
  timelineRight: {
    flex: 1,
    alignItems: "flex-end",
  },
  locationText: {
    textAlign: "left",
    color: "black",
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: "400",
    lineHeight: 22,
  },
  timeTextSmall: {
    textAlign: "right",
    color: "rgba(0, 0, 0, 0.60)",
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: "400",
    lineHeight: 22,
  },
  quickActionsContainer: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
    marginBottom: 16,
    fontFamily: "Inter",
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  actionCard: {
    width: "48%",
    backgroundColor: "white",
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    marginBottom: 12,
  },
  actionIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 15,
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  actionLabel: {
    textAlign: "center",
    color: "black",
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "400",
    lineHeight: 22,
  },
  bottomSpacer: {
    height: 80,
  },
});

export default HomeScreen;
