import * as Haptics from "expo-haptics";

/**
 * Tiny wrapper around `expo-haptics` so callers don't need to remember the
 * iOS-only guard or the right enum every time. Failures are swallowed:
 * haptics are nice-to-have UX sugar — they must never crash a code path.
 */

function isIOS(): boolean {
  return process.env.EXPO_OS === "ios";
}

async function safeRun(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Swallow — haptics must never break user interactions.
  }
}

export async function lightImpact(): Promise<void> {
  if (!isIOS()) return;
  await safeRun(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export async function mediumImpact(): Promise<void> {
  if (!isIOS()) return;
  await safeRun(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export async function selectionFeedback(): Promise<void> {
  if (!isIOS()) return;
  await safeRun(() => Haptics.selectionAsync());
}

export async function successNotification(): Promise<void> {
  if (!isIOS()) return;
  await safeRun(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  );
}

export async function warningNotification(): Promise<void> {
  if (!isIOS()) return;
  await safeRun(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  );
}
