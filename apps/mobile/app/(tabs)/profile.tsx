import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  SafeAreaView,
  Platform,
  StatusBar,
  TouchableOpacity,
  Switch,
} from "react-native";
import { Ionicons as Icon } from "@expo/vector-icons";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 48; // 354px equivalent with margins

const SettingsScreen = () => {
  const [settings, setSettings] = useState({
    locationTracking: true,
    darkMode: false,
    allNotifications: true,
    weeklyInsights: true,
    dailySummary: true,
    quietHours: false,
  });

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const settingsData = [
    {
      title: "Privacy & Data",
      items: [
        {
          title: "Location Tracking",
          subtitle: "While using the app",
          value: settings.locationTracking,
          onToggle: () => toggleSetting("locationTracking"),
          type: "toggle",
        },
        {
          title: "Health Data",
          subtitle: "Apple Health connected",
          type: "info",
        },
        {
          title: "Screen Time Tracking",
          subtitle: "App usage analysis",
          type: "info",
        },
      ],
    },
    {
      title: "App Preferences",
      items: [
        {
          title: "Dark Mode",
          value: settings.darkMode,
          onToggle: () => toggleSetting("darkMode"),
          type: "toggle",
        },
      ],
    },
    {
      title: "Integrations",
      items: [
        {
          title: "Apple Health",
          subtitle: "Connected",
          type: "info",
          icon: "heart",
        },
        {
          title: "Google Calendar",
          subtitle: "Not connected",
          type: "info",
          icon: "calendar",
        },
        {
          title: "Spotify",
          subtitle: "Music mood tracking",
          type: "info",
          icon: "musical-notes",
        },
      ],
    },
    {
      title: "Notifications",
      items: [
        {
          title: "All Notifications",
          subtitle: "Master switch",
          value: settings.allNotifications,
          onToggle: () => toggleSetting("allNotifications"),
          type: "toggle",
        },
        {
          title: "Weekly Insights",
          value: settings.weeklyInsights,
          onToggle: () => toggleSetting("weeklyInsights"),
          type: "toggle",
          disabled: !settings.allNotifications,
        },
        {
          title: "Daily Summary",
          value: settings.dailySummary,
          onToggle: () => toggleSetting("dailySummary"),
          type: "toggle",
          disabled: !settings.allNotifications,
        },
        {
          title: "Quiet Hours",
          subtitle: "10:00 PM - 7:00 AM",
          value: settings.quietHours,
          onToggle: () => toggleSetting("quietHours"),
          type: "toggle",
          disabled: !settings.allNotifications,
        },
      ],
    },
  ];

  type IoniconName = React.ComponentProps<typeof Icon>["name"];

  const actionItems: { title: string; icon: IoniconName; color?: string }[] = [
    { title: "Export My Data", icon: "download-outline" },
    { title: "Delete Account", icon: "trash-outline", color: "#FF3B30" },
  ];

  const aboutItems: { title: string; icon: IoniconName }[] = [
    { title: "Help Center", icon: "help-circle-outline" },
    { title: "Privacy Policy", icon: "shield-checkmark-outline" },
    { title: "Terms of Services", icon: "document-text-outline" },
  ];

  const renderSettingItem = (item: any, index: number) => {
    return (
      <View key={index} style={styles.settingItem}>
        <View style={styles.settingContent}>
          <Text style={styles.settingTitle}>{item.title}</Text>
          {item.subtitle && (
            <Text style={styles.settingSubtitle}>{item.subtitle}</Text>
          )}
        </View>
        {item.type === "toggle" ? (
          <Switch
            value={item.value}
            onValueChange={item.onToggle}
            disabled={item.disabled}
            trackColor={{ false: "#E5E5EA", true: "#007AFF" }}
            thumbColor="#FFFFFF"
          />
        ) : (
          <Icon name="chevron-forward" size={20} color="#999" />
        )}
      </View>
    );
  };

  const renderSection = (section: any, sectionIndex: number) => {
    return (
      <View key={sectionIndex} style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>{section.icon}</Text>
          <Text style={styles.sectionTitle}>{section.title}</Text>
        </View>
        <View style={styles.sectionCard}>
          {section.items.map((item: any, index: number) => (
            <View key={index}>
              {renderSettingItem(item, index)}
              {index < section.items.length - 1 && (
                <View style={styles.itemDivider} />
              )}
            </View>
          ))}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle={settings.darkMode ? "light-content" : "dark-content"}
        backgroundColor={settings.darkMode ? "#000" : "#F5F5F5"}
      />
      <ScrollView
        style={[styles.container, settings.darkMode && styles.darkContainer]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text
            style={[styles.headerTitle, settings.darkMode && styles.darkText]}
          >
            Settings
          </Text>
        </View>

        {/* Profile Section */}
        <View
          style={[styles.profileCard, settings.darkMode && styles.darkCard]}
        >
          <View style={styles.profileImage}>
            <Icon name="person-circle" size={50} color="#007AFF" />
          </View>
          <View style={styles.profileInfo}>
            <Text
              style={[styles.profileName, settings.darkMode && styles.darkText]}
            >
              Ranidu Ravishka
            </Text>
            <Text
              style={[
                styles.profileEmail,
                settings.darkMode && styles.darkText,
              ]}
            >
              raniduravishka1010@gmail.com
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          {actionItems.map((item, index) => (
            <TouchableOpacity key={index} style={styles.actionButton}>
              <Icon
                name={item.icon}
                size={15}
                color={item.color || (settings.darkMode ? "#FFF" : "#000")}
              />
              <Text
                style={[
                  styles.actionButtonText,
                  settings.darkMode && styles.darkText,
                  item.color && { color: item.color },
                ]}
              >
                {item.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Settings Sections */}
        {settingsData.map(renderSection)}

        {/* About Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>ℹ️</Text>
            <Text style={styles.sectionTitle}>About & Help</Text>
          </View>
          <View
            style={[styles.aboutCard, settings.darkMode && styles.darkCard]}
          >
            <View style={styles.versionInfo}>
              <Text
                style={[
                  styles.aboutLabel,
                  settings.darkMode && styles.darkText,
                ]}
              >
                Version
              </Text>
              <Text
                style={[
                  styles.versionText,
                  settings.darkMode && styles.darkText,
                ]}
              >
                DayLog v2.1.4
              </Text>
            </View>
            {aboutItems.map((item, index) => (
              <TouchableOpacity key={index} style={styles.aboutItem}>
                <Icon
                  name={item.icon}
                  size={20}
                  color={settings.darkMode ? "#999" : "#666"}
                />
                <Text
                  style={[
                    styles.aboutItemText,
                    settings.darkMode && styles.darkText,
                  ]}
                >
                  {item.title}
                </Text>
                <Icon name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>
            ))}
          </View>
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
    backgroundColor: "#F5F5F5",
  },
  darkContainer: {
    backgroundColor: "#000",
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
  profileCard: {
    width: CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  darkCard: {
    backgroundColor: "#1C1C1E",
  },
  profileImage: {
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#000",
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    fontFamily: "Inter",
    fontWeight: "300",
    color: "#000",
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginBottom: 32,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionButtonText: {
    fontSize: 10,
    fontFamily: "Inter",
    fontWeight: "300",
    color: "#000",
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    marginLeft: 8,
  },
  sectionIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#000",
  },
  sectionCard: {
    width: CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    overflow: "hidden",
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 49,
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: "Inter",
    fontWeight: "500",
    color: "#000",
    textAlign: "left",
  },
  settingSubtitle: {
    fontSize: 10,
    fontFamily: "Inter",
    fontWeight: "200",
    color: "#666",
    textAlign: "left",
    marginTop: 2,
  },
  itemDivider: {
    height: 1,
    backgroundColor: "rgba(0, 0, 0, 0.1)",
    marginHorizontal: 20,
  },
  aboutCard: {
    width: CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: 18,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  versionInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  aboutLabel: {
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: "300",
    color: "#000",
  },
  versionText: {
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: "400",
    color: "#000",
    width: 92,
    textAlign: "center",
  },
  aboutItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  aboutItemText: {
    fontSize: 12,
    fontFamily: "Inter",
    fontWeight: "300",
    color: "#000",
    flex: 1,
    marginLeft: 12,
  },
  bottomPadding: {
    height: Platform.OS === "ios" ? 34 : 20,
  },
  darkText: {
    color: "#FFF",
  },
});

export default SettingsScreen;
