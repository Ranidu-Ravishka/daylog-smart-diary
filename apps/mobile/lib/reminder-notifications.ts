import * as Notifications from "expo-notifications";

type ReminderType = "daily" | "weekly";

type ReminderPreferencesInput = {
  reminderType: ReminderType;
  dailyTime: string;
  weeklyDay: string;
  formattedTime: string;
  notificationsEnabled?: boolean;
  dailySummaryEnabled?: boolean;
  weeklyInsightsEnabled?: boolean;
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
};

export type ReminderRuntimeState = {
  permissionStatus: "granted" | "denied" | "undetermined";
  scheduledCount: number;
  deliveryEnabled: boolean;
  lastSyncedAt: number;
  error?: string;
};

const DAYLOG_REMINDER_TAG = "daylog_reminder";
const DEFAULT_QUIET_HOURS_START = "22:00";
const DEFAULT_QUIET_HOURS_END = "07:00";
const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 1,
  Monday: 2,
  Tuesday: 3,
  Wednesday: 4,
  Thursday: 5,
  Friday: 6,
  Saturday: 7,
};

function normalizePermissionStatus(
  status: Notifications.NotificationPermissionsStatus,
): ReminderRuntimeState["permissionStatus"] {
  if (
    status.granted ||
    status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return "granted";
  }

  if (status.canAskAgain) {
    return "undetermined";
  }

  return "denied";
}

function parseReminderTime(dailyTime: string): {
  hour: number;
  minute: number;
} {
  const parsed = new Date(dailyTime);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      hour: parsed.getHours(),
      minute: parsed.getMinutes(),
    };
  }

  return { hour: 20, minute: 0 };
}

function shouldScheduleDaily(preferences: ReminderPreferencesInput): boolean {
  return (
    (preferences.notificationsEnabled ?? true) &&
    preferences.reminderType === "daily" &&
    (preferences.dailySummaryEnabled ?? true)
  );
}

function shouldScheduleWeekly(preferences: ReminderPreferencesInput): boolean {
  return (
    (preferences.notificationsEnabled ?? true) &&
    preferences.reminderType === "weekly" &&
    (preferences.weeklyInsightsEnabled ?? true)
  );
}

function parseHourMinute(
  value: string,
  fallback: { hour: number; minute: number },
) {
  const [rawHour, rawMinute] = value.split(":").map(Number);

  if (
    Number.isFinite(rawHour) &&
    Number.isFinite(rawMinute) &&
    rawHour >= 0 &&
    rawHour <= 23 &&
    rawMinute >= 0 &&
    rawMinute <= 59
  ) {
    return { hour: rawHour, minute: rawMinute };
  }

  return fallback;
}

function isWithinQuietHours(
  hour: number,
  minute: number,
  quietStart: string,
  quietEnd: string,
): boolean {
  const minuteOfDay = hour * 60 + minute;
  const parsedStart = parseHourMinute(quietStart, { hour: 22, minute: 0 });
  const parsedEnd = parseHourMinute(quietEnd, { hour: 7, minute: 0 });

  const quietStartMinuteOfDay = parsedStart.hour * 60 + parsedStart.minute;
  const quietEndMinuteOfDay = parsedEnd.hour * 60 + parsedEnd.minute;

  if (quietStartMinuteOfDay === quietEndMinuteOfDay) {
    return true;
  }

  if (quietStartMinuteOfDay < quietEndMinuteOfDay) {
    return (
      minuteOfDay >= quietStartMinuteOfDay && minuteOfDay < quietEndMinuteOfDay
    );
  }

  return (
    minuteOfDay >= quietStartMinuteOfDay || minuteOfDay < quietEndMinuteOfDay
  );
}

async function ensureAndroidNotificationChannel() {
  await Notifications.setNotificationChannelAsync("daylog-reminders", {
    name: "DayLog Reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 150, 250],
  });
}

export async function ensureReminderPermissions(): Promise<
  ReminderRuntimeState["permissionStatus"]
> {
  const existing = await Notifications.getPermissionsAsync();
  const current = normalizePermissionStatus(existing);
  if (current === "granted") return current;

  if (!existing.canAskAgain) return "denied";

  const requested = await Notifications.requestPermissionsAsync();
  return normalizePermissionStatus(requested);
}

export async function cancelDayLogReminderNotifications() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  await Promise.all(
    scheduled
      .filter((request) => {
        const data = request.content.data as
          | Record<string, unknown>
          | undefined;
        return (
          data?.kind === DAYLOG_REMINDER_TAG ||
          data?.daylogReminder === true ||
          data?.daylogReminder === "true"
        );
      })
      .map((request) =>
        Notifications.cancelScheduledNotificationAsync(request.identifier),
      ),
  );
}

export async function getReminderRuntimeState(): Promise<ReminderRuntimeState> {
  const permission = normalizePermissionStatus(
    await Notifications.getPermissionsAsync(),
  );
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const reminderCount = scheduled.filter((request) => {
    const data = request.content.data as Record<string, unknown> | undefined;
    return (
      data?.kind === DAYLOG_REMINDER_TAG ||
      data?.daylogReminder === true ||
      data?.daylogReminder === "true"
    );
  }).length;

  return {
    permissionStatus: permission,
    scheduledCount: reminderCount,
    deliveryEnabled: permission === "granted" && reminderCount > 0,
    lastSyncedAt: Date.now(),
  };
}

export async function syncReminderNotifications(
  preferences: ReminderPreferencesInput | null,
): Promise<ReminderRuntimeState> {
  try {
    if (!preferences) {
      await cancelDayLogReminderNotifications();
      return await getReminderRuntimeState();
    }

    await ensureAndroidNotificationChannel();

    const shouldEnableDelivery =
      shouldScheduleDaily(preferences) || shouldScheduleWeekly(preferences);

    if (!shouldEnableDelivery) {
      await cancelDayLogReminderNotifications();
      return await getReminderRuntimeState();
    }

    const permissionStatus = await ensureReminderPermissions();
    if (permissionStatus !== "granted") {
      await cancelDayLogReminderNotifications();
      const runtime = await getReminderRuntimeState();
      return {
        ...runtime,
        deliveryEnabled: false,
        error:
          permissionStatus === "denied"
            ? "Notification permission denied. Enable notifications in device settings."
            : "Notification permission required for reminders.",
      };
    }

    await cancelDayLogReminderNotifications();

    const { hour, minute } = parseReminderTime(preferences.dailyTime);
    const quietHoursStart =
      preferences.quietHoursStart ?? DEFAULT_QUIET_HOURS_START;
    const quietHoursEnd = preferences.quietHoursEnd ?? DEFAULT_QUIET_HOURS_END;

    if (
      preferences.quietHoursEnabled &&
      isWithinQuietHours(hour, minute, quietHoursStart, quietHoursEnd)
    ) {
      await cancelDayLogReminderNotifications();
      const runtime = await getReminderRuntimeState();
      return {
        ...runtime,
        deliveryEnabled: false,
        error: `Reminder time is inside quiet hours (${quietHoursStart}–${quietHoursEnd}). Choose a time outside quiet hours or disable Quiet Hours.`,
      };
    }

    const scheduledIdentifiers: string[] = [];

    if (shouldScheduleDaily(preferences)) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "DayLog reminder",
          body: "Take a moment to reflect on your day.",
          sound: true,
          data: {
            kind: DAYLOG_REMINDER_TAG,
            daylogReminder: true,
            frequency: "daily",
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          hour,
          minute,
          repeats: true,
        },
      });
      scheduledIdentifiers.push(id);
    }

    if (shouldScheduleWeekly(preferences)) {
      const weekday = WEEKDAY_INDEX[preferences.weeklyDay] ?? 1;
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "DayLog weekly insight",
          body: "Your weekly reflection is ready. Capture this week in DayLog.",
          sound: true,
          data: {
            kind: DAYLOG_REMINDER_TAG,
            daylogReminder: true,
            frequency: "weekly",
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
          weekday,
          hour,
          minute,
          repeats: true,
        },
      });
      scheduledIdentifiers.push(id);
    }

    return {
      permissionStatus: "granted",
      scheduledCount: scheduledIdentifiers.length,
      deliveryEnabled: scheduledIdentifiers.length > 0,
      lastSyncedAt: Date.now(),
    };
  } catch (error) {
    const fallback = await getReminderRuntimeState();
    return {
      ...fallback,
      deliveryEnabled: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to synchronize reminder notifications.",
    };
  }
}
