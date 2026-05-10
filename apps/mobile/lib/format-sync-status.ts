/**
 * Shared formatting helpers for the "Last sync" status text rendered on the
 * Home, Memory, and Insights tabs.
 *
 * Previously these helpers were copy-pasted into each screen with subtle
 * differences. Centralising them keeps wording consistent and makes it easy
 * to evolve the format in one place (e.g. switch to ISO durations).
 */

export function formatRelativeElapsed(lastSyncAt: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - lastSyncAt) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

export function formatLastSyncTime(
  lastSyncAt: number | null,
  now: number,
): string {
  if (lastSyncAt === null) return "Last sync: pending";

  const absolute = new Date(lastSyncAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  return `Last sync: ${absolute} • Updated ${formatRelativeElapsed(lastSyncAt, now)}`;
}
