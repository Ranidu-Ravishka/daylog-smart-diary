import React from "react";

import { captureException, logInfo } from "@/lib/observability";
import { syncReminderNotifications } from "@/lib/reminder-notifications";

type ReminderLaunchPreferences = Parameters<
  typeof syncReminderNotifications
>[0];

type UseForegroundTasksParams = {
  isAuthenticated: boolean;
  launchPreferences: ReminderLaunchPreferences | undefined;
};

export function useForegroundTasks({
  isAuthenticated,
  launchPreferences,
}: UseForegroundTasksParams): void {
  React.useEffect(() => {
    if (!isAuthenticated || launchPreferences === undefined) {
      return;
    }

    let cancelled = false;

    logInfo("mobile_foreground_tasks_module_started", {
      taskId: "sync_reminder_notifications",
    });

    void (async () => {
      try {
        await syncReminderNotifications(launchPreferences);

        if (cancelled) {
          return;
        }

        logInfo("mobile_foreground_tasks_module_succeeded", {
          taskId: "sync_reminder_notifications",
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        captureException("mobile_foreground_tasks_module_failed", error, {
          taskId: "sync_reminder_notifications",
        });
      }
    })();

    return () => {
      cancelled = true;
      logInfo("mobile_foreground_tasks_module_stopped", {
        taskId: "sync_reminder_notifications",
      });
    };
  }, [isAuthenticated, launchPreferences]);
}
