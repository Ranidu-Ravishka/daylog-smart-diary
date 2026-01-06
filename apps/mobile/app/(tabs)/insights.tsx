import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  SafeAreaView,
  Platform,
  StatusBar,
} from "react-native";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 48; // 354px equivalent with margins

const InsightsScreen = () => {
  const days = ["Su", "Sa", "Fr", "Th", "We", "Tu", "Mo"];
  const moods = ["😔", "😐", "😊", "😍"];

  const timeSpentData = [
    { category: "Work", hours: "7.5h", progress: 143, max: 315 },
    { category: "Health", hours: "2h", progress: 68, max: 315 },
    { category: "Social", hours: "2.3h", progress: 76, max: 315 },
    { category: "Entertainment", hours: "1.5h", progress: 52, max: 315 },
  ];

  const moodTrendsData = [
    { value: 60, day: "Mo" },
    { value: 75, day: "Tu" },
    { value: 85, day: "We" },
    { value: 90, day: "Th" },
    { value: 70, day: "Fr" },
    { value: 65, day: "Sa" },
    { value: 80, day: "Su" },
  ];

  const renderMoodChart = () => {
    const maxValue = Math.max(...moodTrendsData.map((d) => d.value));
    const chartHeight = 100;

    return (
      <View style={styles.moodChartContainer}>
        {/* Horizontal grid lines */}
        <View style={styles.gridLine} />
        <View style={[styles.gridLine, { top: chartHeight * 0.25 }]} />
        <View style={[styles.gridLine, { top: chartHeight * 0.5 }]} />
        <View style={[styles.gridLine, { top: chartHeight * 0.75 }]} />
        <View style={[styles.gridLine, { top: chartHeight - 1 }]} />

        {/* Data points and lines */}
        {moodTrendsData.map((item, index) => {
          const nextItem = moodTrendsData[index + 1];
          const xPos = (index * (CARD_WIDTH - 80)) / 6;
          const yPos = chartHeight - (item.value / maxValue) * chartHeight;

          return (
            <View
              key={`point-${index}`}
              style={[styles.dataPoint, { left: xPos, top: yPos - 3.5 }]}
            >
              {nextItem && (
                <View
                  style={[
                    styles.lineSegment,
                    {
                      width: Math.sqrt(
                        Math.pow((CARD_WIDTH - 80) / 6, 2) +
                          Math.pow(
                            ((item.value - nextItem.value) / maxValue) *
                              chartHeight,
                            2,
                          ),
                      ),
                      transform: [
                        {
                          rotate: `${Math.atan2(
                            ((item.value - nextItem.value) / maxValue) *
                              chartHeight,
                            (CARD_WIDTH - 80) / 6,
                          )}rad`,
                        },
                      ],
                      left: 3.5,
                      top: 3.5,
                    },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const renderCircularProgress = (
    value: number,
    max: number,
    size: number = 28,
  ) => {
    const innerSize = size * 0.55;

    return (
      <View style={[styles.circularProgress, { width: size, height: size }]}>
        <View
          style={[
            styles.circularProgressBackground,
            { width: size, height: size },
          ]}
        />
        <View
          style={[
            styles.circularProgressFill,
            { width: innerSize, height: innerSize },
          ]}
        />
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
          <Text style={styles.headerTitle}>Insights</Text>
        </View>

        {/* Mood Trends Card */}
        <View style={[styles.card, styles.largeCard]}>
          <Text style={styles.cardTitle}>Mood Trends</Text>

          {/* Mood Chart */}
          {renderMoodChart()}

          {/* Days of Week */}
          <View style={styles.daysRow}>
            {days.map((day, index) => (
              <View key={index} style={styles.dayContainer}>
                <Text style={styles.dayText}>{day}</Text>
              </View>
            ))}
          </View>

          {/* Mood Scale */}
          <View style={styles.moodScaleContainer}>
            <View style={styles.moodScaleLabels}>
              {moods.map((mood, index) => (
                <Text key={index} style={styles.moodText}>
                  {mood}
                </Text>
              ))}
            </View>
            <View style={styles.moodScaleBar} />
            <View style={styles.moodScaleLabels}>
              <Text style={styles.moodLabel}>Sad</Text>
              <Text style={styles.moodLabel}>Neutral</Text>
              <Text style={styles.moodLabel}>Happy</Text>
              <Text style={styles.moodLabel}>Excited</Text>
            </View>
          </View>
        </View>

        {/* Stats Overview Card */}
        <View style={[styles.card, styles.mediumCard]}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              {renderCircularProgress(7.2, 10)}
              <Text style={styles.statLabel}>Avg. Mood</Text>
              <Text style={styles.statValue}>7.2/10</Text>
            </View>

            <View style={styles.statItem}>
              <View style={styles.stepIcon}>
                <Text style={styles.stepIconText}>👣</Text>
              </View>
              <Text style={styles.statLabel}>Steps</Text>
              <Text style={styles.statValue}>5,420</Text>
            </View>
          </View>
        </View>

        {/* Expenses Trends Card */}
        <View style={[styles.card, styles.largeCard]}>
          <Text style={styles.cardTitle}>Expenses Trends</Text>

          {/* Weekly Expenses */}
          <View style={styles.expensesHeader}>
            <View style={styles.daysRowSmall}>
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day, index) => (
                <View key={index} style={styles.dayContainerSmall}>
                  <Text style={styles.dayTextSmall}>{day}</Text>
                </View>
              ))}
            </View>

            <View style={styles.expenseTag}>
              <View style={styles.expenseTagBackground} />
              <Text style={styles.expenseAmount}>$1,230</Text>
            </View>
          </View>

          {/* Expense Chart */}
          <View style={styles.expenseChart}>
            <View style={styles.expenseBar} />
            <View style={styles.verticalLine} />
          </View>
        </View>

        {/* Time Spent Card */}
        <View style={[styles.card, styles.largeCard]}>
          <Text style={styles.cardTitle}>Time Spent</Text>

          {timeSpentData.map((item, index) => (
            <View key={index} style={styles.timeSpentRow}>
              <Text style={styles.timeSpentCategory}>{item.category}</Text>
              <View style={styles.progressBarContainer}>
                <View style={styles.progressBarBackground}>
                  <View
                    style={[styles.progressBarFill, { width: item.progress }]}
                  />
                </View>
                <Text style={styles.timeSpentHours}>{item.hours}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Bottom padding */}
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
  largeCard: {
    minHeight: 248,
  },
  mediumCard: {
    minHeight: 166,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
    marginBottom: 20,
  },
  moodChartContainer: {
    height: 100,
    marginBottom: 20,
    position: "relative",
  },
  gridLine: {
    position: "absolute",
    width: CARD_WIDTH - 80,
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    left: 10,
  },
  dataPoint: {
    position: "absolute",
    width: 7,
    height: 7,
    backgroundColor: "rgba(0, 0, 0, 0.80)",
    borderRadius: 4,
  },
  lineSegment: {
    position: "absolute",
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.80)",
  },
  daysRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  dayContainer: {
    flex: 1,
    alignItems: "center",
  },
  dayText: {
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "500",
    color: "#000",
  },
  moodScaleContainer: {
    alignItems: "center",
  },
  moodScaleBar: {
    width: 200,
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    marginVertical: 8,
  },
  moodScaleLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: 200,
  },
  moodText: {
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "500",
    color: "#000",
  },
  moodLabel: {
    fontSize: 11,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: 20,
  },
  statItem: {
    alignItems: "center",
  },
  circularProgress: {
    position: "relative",
    marginBottom: 8,
  },
  circularProgressBackground: {
    position: "absolute",
    backgroundColor: "#438883",
    opacity: 0.2,
    borderRadius: 9999,
  },
  circularProgressFill: {
    position: "absolute",
    backgroundColor: "#438883",
    borderRadius: 9999,
    top: "50%",
    left: "50%",
    transform: [{ translateX: -9.18 }, { translateY: -7.635 }],
  },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F1F7F7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  stepIconText: {
    fontSize: 16,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: "Inter",
    fontWeight: "200",
    color: "#000",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 11,
    fontFamily: "Inter",
    fontWeight: "700",
    color: "#000",
  },
  expensesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  daysRowSmall: {
    flexDirection: "row",
    gap: 8,
  },
  dayContainerSmall: {
    minWidth: 16,
    alignItems: "center",
  },
  dayTextSmall: {
    fontSize: 13,
    fontFamily: "Inter",
    fontWeight: "500",
    color: "#000",
  },
  expenseTag: {
    position: "relative",
    width: 53,
    height: 26,
  },
  expenseTagBackground: {
    position: "absolute",
    width: "100%",
    height: "100%",
    backgroundColor: "#F1F7F7",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(67, 136, 131, 0.60)",
  },
  expenseAmount: {
    position: "absolute",
    width: "100%",
    height: "100%",
    fontSize: 9,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#438883",
    textAlign: "center",
    lineHeight: 26,
  },
  expenseChart: {
    height: 100,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  expenseBar: {
    position: "absolute",
    width: "100%",
    height: "100%",
    backgroundColor: "white",
  },
  verticalLine: {
    position: "absolute",
    width: 1,
    height: 60,
    backgroundColor: "#666",
    left: "50%",
    top: 20,
    transform: [{ rotate: "90deg" }],
  },
  timeSpentRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  timeSpentCategory: {
    fontSize: 11,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
    width: 80,
  },
  progressBarContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  progressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: "rgba(217, 217, 217, 0.50)",
    borderRadius: 56,
    marginRight: 12,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#000",
    borderRadius: 56,
  },
  timeSpentHours: {
    fontSize: 11,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
    width: 30,
    textAlign: "center",
  },
  bottomPadding: {
    height: Platform.OS === "ios" ? 34 : 20,
  },
});

export default InsightsScreen;
