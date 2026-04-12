import { describe, expect, it } from "vitest";

import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";
import * as preferencesModule from "./userPreferences";

type ConvexHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function handler<TArgs, TResult>(fn: unknown) {
  return (fn as ConvexHandler<TArgs, TResult>)._handler;
}

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: "user_admin_001",
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        email: "admin@example.com",
        isAdmin: true,
      },
      {
        _id: "user_member_001",
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        email: "member@example.com",
        isAdmin: false,
      },
    ],
  });
}

const baseArgs = {
  focusAreas: [5, 2, 2, 99],
  reminderType: "daily" as const,
  dailyTime: "09:00",
  weeklyDay: "monday",
  formattedTime: "9:00 AM",
};

describe("user preferences behavior", () => {
  it("syncs by explicit clerk id with normalization and identity checks", async () => {
    const db = seededDb();

    const syncUserPreferencesFromClerk = handler<
      {
        clerkUserId: string;
        focusAreas: number[];
        reminderType: "daily" | "weekly";
        dailyTime: string;
        weeklyDay: string;
        formattedTime: string;
        theme?: "light" | "dark" | "system";
      },
      { focusAreas: number[]; theme?: string } | null
    >(preferencesModule.syncUserPreferencesFromClerk);

    await expect(
      syncUserPreferencesFromClerk(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_admin_001",
        ...baseArgs,
      }),
    ).rejects.toThrow("Forbidden: identity mismatch");

    const created = await syncUserPreferencesFromClerk(
      createAuthCtx(db, "clerk_member_001"),
      {
        clerkUserId: "clerk_member_001",
        ...baseArgs,
      },
    );

    expect(created?.focusAreas).toEqual([4, 2]);
    expect(created?.theme).toBe("system");

    const updated = await syncUserPreferencesFromClerk(
      createAuthCtx(db, "clerk_member_001"),
      {
        clerkUserId: "clerk_member_001",
        ...baseArgs,
        focusAreas: [1, 1, 5],
        theme: "dark",
      },
    );

    expect(updated?.focusAreas).toEqual([1, 4]);
    expect(updated?.theme).toBe("dark");

    const metrics = db.getTable("adminDashboardMetrics");
    expect(metrics[0]?.totalPreferences).toBe(1);
  });

  it("supports my-preferences flow and admin-only reads", async () => {
    const db = seededDb();

    const syncMyUserPreferences = handler<
      {
        focusAreas: number[];
        reminderType: "daily" | "weekly";
        dailyTime: string;
        weeklyDay: string;
        formattedTime: string;
      },
      { focusAreas: number[] } | null
    >(preferencesModule.syncMyUserPreferences);
    const getMyUserPreferences = handler<
      Record<string, never>,
      { focusAreas: number[] } | null
    >(preferencesModule.getMyUserPreferences);
    const getUserPreferencesByClerkId = handler<
      { clerkUserId: string },
      { clerkUserId: string; focusAreas: number[] } | null
    >(preferencesModule.getUserPreferencesByClerkId);
    const listUserPreferences = handler<
      Record<string, never>,
      Array<{ clerkUserId: string }>
    >(preferencesModule.listUserPreferences);

    await expect(
      getUserPreferencesByClerkId(createAuthCtx(db, "clerk_member_001"), {
        clerkUserId: "clerk_member_001",
      }),
    ).rejects.toThrow("Forbidden");

    await syncMyUserPreferences(
      createAuthCtx(db, "clerk_member_001"),
      baseArgs,
    );

    const mine = await getMyUserPreferences(
      createAuthCtx(db, "clerk_member_001"),
      {},
    );
    expect(mine?.focusAreas).toEqual([4, 2]);

    const missing = await getMyUserPreferences(createAuthCtx(db, null), {});
    expect(missing).toBeNull();

    const adminRead = await getUserPreferencesByClerkId(
      createAuthCtx(db, "clerk_admin_001"),
      { clerkUserId: "clerk_member_001" },
    );
    expect(adminRead?.clerkUserId).toBe("clerk_member_001");

    const listed = await listUserPreferences(
      createAuthCtx(db, "clerk_admin_001"),
      {},
    );
    expect(listed).toHaveLength(1);
  });

  it("updates location tracking state when a preference row exists", async () => {
    const db = seededDb();

    const syncMyUserPreferences = handler<
      {
        focusAreas: number[];
        reminderType: "daily" | "weekly";
        dailyTime: string;
        weeklyDay: string;
        formattedTime: string;
      },
      unknown
    >(preferencesModule.syncMyUserPreferences);
    const updateMyLocationTrackingState = handler<
      {
        locationTrackingEnabled?: boolean;
        callLogsTrackingEnabled?: boolean;
        moodDetectionFaceRecognitionEnabled?: boolean;
        fitnessTrackingEnabled?: boolean;
        calendarNotificationsTrackingEnabled?: boolean;
        backgroundLocationTrackingEnabled?: boolean;
        locationPermissionStatus?: "unknown" | "granted" | "denied";
        locationLastUpdatedAt?: number;
        locationLastArea?: string;
        backgroundLocationAutoDisabledAt?: number;
        backgroundLocationAutoDisableReason?: string;
        backgroundLocationBatteryImpactScore?: number;
      },
      {
        locationTrackingEnabled?: boolean;
        callLogsTrackingEnabled?: boolean;
        moodDetectionFaceRecognitionEnabled?: boolean;
        fitnessTrackingEnabled?: boolean;
        calendarNotificationsTrackingEnabled?: boolean;
        backgroundLocationTrackingEnabled?: boolean;
        locationLastArea?: string;
        backgroundLocationAutoDisableReason?: string;
        backgroundLocationBatteryImpactScore?: number;
      } | null
    >(preferencesModule.updateMyLocationTrackingState);

    const noPreference = await updateMyLocationTrackingState(
      createAuthCtx(db, "clerk_member_001"),
      {
        locationTrackingEnabled: true,
      },
    );
    expect(noPreference).toBeNull();

    await syncMyUserPreferences(
      createAuthCtx(db, "clerk_member_001"),
      baseArgs,
    );

    const updated = await updateMyLocationTrackingState(
      createAuthCtx(db, "clerk_member_001"),
      {
        locationTrackingEnabled: true,
        callLogsTrackingEnabled: true,
        moodDetectionFaceRecognitionEnabled: true,
        fitnessTrackingEnabled: true,
        calendarNotificationsTrackingEnabled: true,
        backgroundLocationTrackingEnabled: true,
        locationPermissionStatus: "granted",
        locationLastUpdatedAt: 123,
        locationLastArea: "Colombo",
        backgroundLocationAutoDisabledAt: 456,
        backgroundLocationAutoDisableReason:
          "Auto-disabled due to battery threshold",
        backgroundLocationBatteryImpactScore: 8.5,
      },
    );

    expect(updated?.locationTrackingEnabled).toBe(true);
    expect(updated?.callLogsTrackingEnabled).toBe(true);
    expect(updated?.moodDetectionFaceRecognitionEnabled).toBe(true);
    expect(updated?.fitnessTrackingEnabled).toBe(true);
    expect(updated?.calendarNotificationsTrackingEnabled).toBe(true);
    expect(updated?.backgroundLocationTrackingEnabled).toBe(true);
    expect(updated?.locationLastArea).toBe("Colombo");
    expect(updated?.backgroundLocationAutoDisableReason).toBe(
      "Auto-disabled due to battery threshold",
    );
    expect(updated?.backgroundLocationBatteryImpactScore).toBe(8.5);
  });
});
